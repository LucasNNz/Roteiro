import type { Shape } from "../../app/types.ts";

export const HEAVY_EXPORT_IMAGE_SOURCE_CHARS = 32_000;

export function heavyExportImageSource(shape: Shape) {
  if (shape.type === "image") return shape.src ?? null;
  if ((shape.type === "rect" || shape.type === "ellipse") && shape.imageSrc) return shape.imageSrc;
  return null;
}

function hasStableZeroRadius(shape: Shape) {
  if ((shape.radius ?? 0) !== 0) return false;
  return (shape.keyframes ?? []).every((frame) => (frame.radius ?? 0) === 0);
}

function hasStableAspectRatio(shape: Shape, tolerance = .08) {
  if (!(shape.w > 0) || !(shape.h > 0)) return false;
  const base = shape.w / shape.h;
  return (shape.keyframes ?? []).every((frame) => {
    if (!(frame.w > 0) || !(frame.h > 0)) return false;
    const ratio = frame.w / frame.h;
    return Math.abs(ratio / base - 1) <= tolerance;
  });
}

/**
 * Conservative opt-in for the lightweight export path.
 * The raster contains the original SVG appearance (image, border and shadow),
 * then only geometry/opacity are transformed per frame on the main canvas.
 */
export function canRasterHeavyExportImage(shape: Shape) {
  const source = heavyExportImageSource(shape);
  if (!source || source.length < HEAVY_EXPORT_IMAGE_SOURCE_CHARS) return false;
  if (shape.visible === false || shape.type === "empty") return false;
  if ((shape.imageOffsetX ?? 0) !== 0 || (shape.imageOffsetY ?? 0) !== 0) return false;
  if (!hasStableZeroRadius(shape)) return false;
  if (!hasStableAspectRatio(shape)) return false;
  return shape.type === "image" || ((shape.type === "rect" || shape.type === "ellipse") && Boolean(shape.imageSrc));
}

export function heavyExportRasterMargin(shape: Shape) {
  const blur = Math.max(0, shape.shadowBlur ?? 0);
  const offsetX = Math.abs(shape.shadowX ?? 0);
  const offsetY = Math.abs(shape.shadowY ?? 0);
  const stroke = Math.max(0, shape.strokeWidth ?? 0);
  return Math.ceil(Math.max(8, blur * 2 + Math.max(offsetX, offsetY) + 8, stroke * 2 + 8));
}
