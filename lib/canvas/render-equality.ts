import type { Shape } from "../../app/types.ts";

const RENDERED_SHAPE_FIELDS: ReadonlyArray<keyof Shape> = [
  "id", "groupId", "type", "x", "y", "w", "h", "rotation", "radius", "fill", "fill2", "gradientAngle", "stroke", "strokeWidth", "opacity",
  "shadowColor", "shadowBlur", "shadowX", "shadowY", "brightness", "contrast", "saturation", "hue", "src", "imageSrc", "imageScale",
  "imageOffsetX", "imageOffsetY", "objectFit", "text", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "name", "visible", "locked",
];

function sameNumberArray(previous?: number[], next?: number[]) {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}

function sameKeyframes(previous: Shape["keyframes"], next: Shape["keyframes"]) {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((frame, index) => {
    const candidate = next[index];
    return frame.time === candidate.time && frame.x === candidate.x && frame.y === candidate.y && frame.w === candidate.w && frame.h === candidate.h
      && frame.rotation === candidate.rotation && frame.radius === candidate.radius && frame.opacity === candidate.opacity && frame.easing === candidate.easing;
  });
}

export function sameRenderedShape(previous: Shape, next: Shape) {
  return RENDERED_SHAPE_FIELDS.every((field) => previous[field] === next[field])
    && sameNumberArray(previous.colorMatrix, next.colorMatrix)
    && sameKeyframes(previous.keyframes, next.keyframes);
}
