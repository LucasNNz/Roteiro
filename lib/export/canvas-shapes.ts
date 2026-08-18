import type { Shape } from "../../app/types.ts";
import { hasVisualAdjustments } from "../geometry.ts";
import { renderableProgressIconSource } from "../scenes/progress-icon.ts";

export type ExportImageLoader = (source: string) => Promise<CanvasImageSource>;

export type CanvasShapeRun = {
  direct: boolean;
  shapes: Shape[];
};

export function canPaintShapeDirectly(shape: Shape) {
  if (shape.type === "brush") return false;
  if (shape.colorMatrix?.length === 20) return false;
  return true;
}

export function splitCanvasShapeRuns(shapes: Shape[]): CanvasShapeRun[] {
  const runs: CanvasShapeRun[] = [];
  for (const shape of shapes) {
    if (shape.visible === false || shape.type === "empty" || (shape.opacity ?? 1) <= 0) continue;
    const direct = canPaintShapeDirectly(shape);
    const last = runs[runs.length - 1];
    if (last?.direct === direct) last.shapes.push(shape);
    else runs.push({ direct, shapes: [shape] });
  }
  return runs;
}

export function canvasVisualFilter(shape: Shape) {
  if (!hasVisualAdjustments(shape)) return "none";
  const brightness = Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100));
  const contrast = Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100));
  const saturation = Math.max(0, Math.min(2, (shape.saturation ?? 100) / 100));
  const hue = shape.hue ?? 0;
  const filters = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
    `hue-rotate(${hue}deg)`,
  ];
  if (shape.shadowColor && (shape.shadowBlur ?? 0) > 0) {
    filters.push(`drop-shadow(${shape.shadowX ?? 0}px ${shape.shadowY ?? 0}px ${(shape.shadowBlur ?? 0) / 2}px ${shape.shadowColor})`);
  }
  return filters.join(" ");
}

export function imageFitRect(sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number, fit: "contain" | "cover" = "cover") {
  if (sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) return { x, y, width, height };
  const ratio = fit === "contain"
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * ratio;
  const drawHeight = sourceHeight * ratio;
  return {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(Math.abs(radius), Math.abs(width) / 2, Math.abs(height) / 2));
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, safeRadius);
    return;
  }
  const right = x + width;
  const bottom = y + height;
  context.moveTo(x + safeRadius, y);
  context.lineTo(right - safeRadius, y);
  context.quadraticCurveTo(right, y, right, y + safeRadius);
  context.lineTo(right, bottom - safeRadius);
  context.quadraticCurveTo(right, bottom, right - safeRadius, bottom);
  context.lineTo(x + safeRadius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
}

function ellipsePath(context: CanvasRenderingContext2D, width: number, height: number) {
  context.beginPath();
  context.ellipse(0, 0, Math.max(0, width / 2), Math.max(0, height / 2), 0, 0, Math.PI * 2);
}

function fillStyle(context: CanvasRenderingContext2D, shape: Shape) {
  if (!shape.fill2) return shape.fill;
  const angle = (shape.gradientAngle ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = (Math.abs(shape.w * cos) + Math.abs(shape.h * sin)) / 2;
  const gradient = context.createLinearGradient(-cos * half, -sin * half, cos * half, sin * half);
  gradient.addColorStop(0, shape.fill);
  gradient.addColorStop(1, shape.fill2);
  return gradient;
}

function sourceDimensions(source: CanvasImageSource) {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) return { width: source.width, height: source.height };
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  const candidate = source as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  return { width: candidate.videoWidth ?? candidate.width ?? 1, height: candidate.videoHeight ?? candidate.height ?? 1 };
}

function drawStroke(context: CanvasRenderingContext2D, shape: Shape) {
  if (!(shape.strokeWidth && shape.strokeWidth > 0)) return;
  context.strokeStyle = shape.stroke ?? "#13151A";
  context.lineWidth = shape.strokeWidth;
  context.lineJoin = "round";
  context.stroke();
}

function applyTextLetterSpacing(context: CanvasRenderingContext2D, spacing: number) {
  const target = context as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in target) target.letterSpacing = `${spacing}px`;
}

async function drawImageShape(context: CanvasRenderingContext2D, shape: Shape, loadImage: ExportImageLoader) {
  const sourceValue = renderableProgressIconSource(shape.src);
  if (!sourceValue) return;
  const source = await loadImage(sourceValue);
  const dimensions = sourceDimensions(source);
  const scale = Math.max(1, Math.min(4, shape.imageScale ?? 1));
  const mediaWidth = shape.w * scale;
  const mediaHeight = shape.h * scale;
  const mediaX = -mediaWidth / 2 + (shape.imageOffsetX ?? 0);
  const mediaY = -mediaHeight / 2 + (shape.imageOffsetY ?? 0);
  const draw = imageFitRect(dimensions.width, dimensions.height, mediaX, mediaY, mediaWidth, mediaHeight, shape.objectFit === "contain" ? "contain" : "cover");
  if (shape.type === "ellipse") ellipsePath(context, shape.w, shape.h);
  else roundedRectPath(context, -shape.w / 2, -shape.h / 2, shape.w, shape.h, shape.radius);
  context.clip();
  context.drawImage(source, draw.x, draw.y, draw.width, draw.height);
}

async function drawImageFillShape(context: CanvasRenderingContext2D, shape: Shape, loadImage: ExportImageLoader) {
  if (shape.type === "ellipse") ellipsePath(context, shape.w, shape.h);
  else roundedRectPath(context, -shape.w / 2, -shape.h / 2, shape.w, shape.h, shape.radius);
  context.fillStyle = fillStyle(context, shape);
  context.fill();

  if (!shape.imageSrc) {
    drawStroke(context, shape);
    return;
  }
  const source = await loadImage(shape.imageSrc);
  const dimensions = sourceDimensions(source);
  const scale = Math.max(1, Math.min(4, shape.imageScale ?? 1));
  const mediaWidth = shape.w * scale;
  const mediaHeight = shape.h * scale;
  const mediaX = -mediaWidth / 2 + (shape.imageOffsetX ?? 0);
  const mediaY = -mediaHeight / 2 + (shape.imageOffsetY ?? 0);
  const draw = imageFitRect(dimensions.width, dimensions.height, mediaX, mediaY, mediaWidth, mediaHeight, shape.objectFit === "contain" ? "contain" : "cover");

  context.save();
  if (shape.type === "ellipse") ellipsePath(context, shape.w, shape.h);
  else roundedRectPath(context, -shape.w / 2, -shape.h / 2, shape.w, shape.h, shape.radius);
  context.clip();
  context.drawImage(source, draw.x, draw.y, draw.width, draw.height);
  context.restore();

  if (shape.strokeWidth && shape.strokeWidth > 0) {
    if (shape.type === "ellipse") ellipsePath(context, shape.w, shape.h);
    else roundedRectPath(context, -shape.w / 2, -shape.h / 2, shape.w, shape.h, shape.radius);
    drawStroke(context, shape);
  }
}

function drawTextShape(context: CanvasRenderingContext2D, shape: Shape) {
  const fontSize = shape.fontSize ?? 120;
  const lineHeight = fontSize * (shape.lineHeight ?? 1.08);
  const lines = (shape.text ?? "").split(/\r?\n/);
  const firstY = -((lines.length - 1) * lineHeight) / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${shape.fontWeight ?? 700} ${fontSize}px Montserrat, sans-serif`;
  applyTextLetterSpacing(context, shape.letterSpacing ?? 0);
  context.fillStyle = fillStyle(context, shape);
  if (shape.strokeWidth && shape.strokeWidth > 0) {
    context.strokeStyle = shape.stroke ?? "#13151A";
    context.lineWidth = shape.strokeWidth;
    context.lineJoin = "round";
  }
  lines.forEach((line, index) => {
    const y = firstY + index * lineHeight;
    if (shape.strokeWidth && shape.strokeWidth > 0) context.strokeText(line, 0, y);
    context.fillText(line, 0, y);
  });
}

export async function paintCanvasShape(context: CanvasRenderingContext2D, shape: Shape, loadImage: ExportImageLoader) {
  if (!canPaintShapeDirectly(shape) || shape.visible === false || shape.type === "empty" || (shape.opacity ?? 1) <= 0) return false;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  context.save();
  context.globalAlpha *= shape.opacity ?? 1;
  context.translate(cx, cy);
  context.rotate((shape.rotation ?? 0) * Math.PI / 180);
  context.filter = canvasVisualFilter(shape);

  try {
    if (shape.type === "image") {
      await drawImageShape(context, shape, loadImage);
      return true;
    }
    if (shape.type === "text") {
      drawTextShape(context, shape);
      return true;
    }
    if (shape.type === "rect" || shape.type === "ellipse") {
      await drawImageFillShape(context, shape, loadImage);
      return true;
    }
    return false;
  } finally {
    context.restore();
  }
}
