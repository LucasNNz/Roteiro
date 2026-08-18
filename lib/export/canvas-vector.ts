import type { Shape } from "../../app/types.ts";

function hasUnsupportedColorFilter(shape: Shape) {
  return (shape.brightness ?? 100) !== 100
    || (shape.contrast ?? 100) !== 100
    || (shape.saturation ?? 100) !== 100
    || (shape.hue ?? 0) !== 0
    || shape.colorMatrix?.length === 20;
}

/**
 * Conservative direct-Canvas path for vector primitives.
 * Images/brushes/color filters stay in the SVG fallback so visual semantics
 * remain unchanged. Shadows, gradients, strokes and text are handled here.
 */
export function canPaintExportVector(shape: Shape) {
  if (shape.visible === false || shape.type === "empty") return false;
  if (shape.type !== "rect" && shape.type !== "ellipse" && shape.type !== "text") return false;
  if (shape.src || shape.imageSrc) return false;
  if (hasUnsupportedColorFilter(shape)) return false;
  return true;
}

function setShadow(context: CanvasRenderingContext2D, shape: Shape) {
  const blur = Math.max(0, shape.shadowBlur ?? 0);
  if (shape.shadowColor && blur > 0) {
    context.shadowColor = shape.shadowColor;
    // SVG uses stdDeviation = shadowBlur / 2. Canvas shadowBlur is not defined
    // in exactly the same units, but the full stored blur gives the closest
    // visual match in Chromium for the Forma presets.
    context.shadowBlur = blur;
    context.shadowOffsetX = shape.shadowX ?? 0;
    context.shadowOffsetY = shape.shadowY ?? 0;
  } else {
    context.shadowColor = "rgba(0,0,0,0)";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }
}

function shapeFill(context: CanvasRenderingContext2D, shape: Shape): string | CanvasGradient {
  if (!shape.fill2) return shape.fill;
  const angle = (shape.gradientAngle ?? 0) * Math.PI / 180;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  // Mirrors the SVG objectBoundingBox gradient rotated around .5/.5.
  const dx = Math.cos(angle) * shape.w / 2;
  const dy = Math.sin(angle) * shape.h / 2;
  const gradient = context.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, shape.fill);
  gradient.addColorStop(1, shape.fill2);
  return gradient;
}

function roundedRectPath(context: CanvasRenderingContext2D, shape: Shape) {
  const radius = Math.max(0, Math.min(shape.radius ?? 0, shape.w / 2, shape.h / 2));
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(shape.x, shape.y, shape.w, shape.h, radius);
    return;
  }
  const x = shape.x, y = shape.y, w = shape.w, h = shape.h;
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.quadraticCurveTo(x + w, y, x + w, y + radius);
  context.lineTo(x + w, y + h - radius);
  context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  context.lineTo(x + radius, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function setCommonPaint(context: CanvasRenderingContext2D, shape: Shape) {
  context.globalAlpha *= shape.opacity ?? 1;
  context.fillStyle = shapeFill(context, shape);
  context.strokeStyle = shape.stroke ?? "#13151A";
  context.lineWidth = Math.max(0, shape.strokeWidth ?? 0);
  context.lineJoin = "round";
  context.lineCap = "butt";
  setShadow(context, shape);
}

function paintGeometry(context: CanvasRenderingContext2D, shape: Shape) {
  if (shape.type === "rect") roundedRectPath(context, shape);
  else {
    context.beginPath();
    context.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.max(0, shape.w / 2), Math.max(0, shape.h / 2), 0, 0, Math.PI * 2);
  }
  context.fill();
  if ((shape.strokeWidth ?? 0) > 0) context.stroke();
}

function paintText(context: CanvasRenderingContext2D, shape: Shape) {
  const fontSize = shape.fontSize ?? 120;
  const fontWeight = shape.fontWeight ?? 700;
  const lines = (shape.text ?? "").split(/\r?\n/);
  const lineHeight = fontSize * (shape.lineHeight ?? 1.08);
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const firstY = cy - ((lines.length - 1) * lineHeight) / 2;
  context.font = `${fontWeight} ${fontSize}px Montserrat, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const letterSpacingContext = context as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in letterSpacingContext) letterSpacingContext.letterSpacing = `${shape.letterSpacing ?? 0}px`;
  for (let index = 0; index < lines.length; index += 1) {
    const y = firstY + index * lineHeight;
    if ((shape.strokeWidth ?? 0) > 0) context.strokeText(lines[index], cx, y);
    context.fillText(lines[index], cx, y);
  }
}

export function paintExportVector(context: CanvasRenderingContext2D, shape: Shape) {
  if (!canPaintExportVector(shape) || (shape.opacity ?? 1) <= .0001) return false;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  context.save();
  context.translate(cx, cy);
  context.rotate(shape.rotation * Math.PI / 180);
  context.translate(-cx, -cy);
  setCommonPaint(context, shape);
  if (shape.type === "text") paintText(context, shape);
  else paintGeometry(context, shape);
  context.restore();
  return true;
}
