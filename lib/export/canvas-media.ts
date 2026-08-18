import type { Shape } from "../../app/types.ts";
import { mediaGeometry } from "../geometry.ts";

function hasUnsupportedVisualAdjustments(shape: Shape) {
  return (shape.brightness ?? 100) !== 100
    || (shape.contrast ?? 100) !== 100
    || (shape.saturation ?? 100) !== 100
    || (shape.hue ?? 0) !== 0
    || shape.colorMatrix?.length === 20
    || Boolean(shape.shadowColor && (shape.shadowBlur ?? 0) > 0)
    || Boolean(shape.fill2);
}

/**
 * Conservative direct-Canvas path for image-filled rects/ellipses whose box
 * may change aspect ratio during motion. This preserves objectFit semantics by
 * re-cropping the already-decoded image instead of stretching a cached raster.
 */
export function canPaintExportMedia(shape: Shape) {
  if (shape.visible === false || (shape.opacity ?? 1) <= .0001) return false;
  if (shape.type !== "rect" && shape.type !== "ellipse") return false;
  if (!shape.imageSrc) return false;
  if (hasUnsupportedVisualAdjustments(shape)) return false;
  return true;
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

function mediaClipPath(context: CanvasRenderingContext2D, shape: Shape) {
  if (shape.type === "ellipse") {
    context.beginPath();
    context.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.max(0, shape.w / 2), Math.max(0, shape.h / 2), 0, 0, Math.PI * 2);
  } else {
    roundedRectPath(context, shape);
  }
}

function drawContainedOrCovered(context: CanvasRenderingContext2D, image: HTMLImageElement, shape: Shape) {
  const media = mediaGeometry(shape);
  const naturalW = Math.max(1, image.naturalWidth || image.width || 1);
  const naturalH = Math.max(1, image.naturalHeight || image.height || 1);
  const scale = shape.objectFit === "contain"
    ? Math.min(media.w / naturalW, media.h / naturalH)
    : Math.max(media.w / naturalW, media.h / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  const drawX = media.x + (media.w - drawW) / 2;
  const drawY = media.y + (media.h - drawH) / 2;
  context.drawImage(image, drawX, drawY, drawW, drawH);
}

export function paintExportMedia(context: CanvasRenderingContext2D, shape: Shape, image: HTMLImageElement) {
  if (!canPaintExportMedia(shape)) return false;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  context.save();
  context.globalAlpha *= shape.opacity ?? 1;
  context.translate(cx, cy);
  context.rotate(shape.rotation * Math.PI / 180);
  context.translate(-cx, -cy);

  // Matches the SVG group order: base fill -> clipped media -> border.
  mediaClipPath(context, shape);
  context.fillStyle = shape.fill;
  context.fill();

  context.save();
  mediaClipPath(context, shape);
  context.clip();
  drawContainedOrCovered(context, image, shape);
  context.restore();

  if ((shape.strokeWidth ?? 0) > 0) {
    mediaClipPath(context, shape);
    context.strokeStyle = shape.stroke ?? "#13151A";
    context.lineWidth = Math.max(0, shape.strokeWidth ?? 0);
    context.lineJoin = "round";
    context.stroke();
  }
  context.restore();
  return true;
}
