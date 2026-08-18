import type { MotionKeyframe, Shape } from "../../app/types.ts";
import { sortedMotionKeyframes } from "../geometry.ts";

export type ExportShapeRun = {
  cacheable: boolean;
  cacheKey: string;
  shapes: Shape[];
};

const motionDifference = (a: MotionKeyframe, b: MotionKeyframe) => (
  a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h
  || a.rotation !== b.rotation || a.radius !== b.radius
  || (a.opacity ?? 1) !== (b.opacity ?? 1)
);

/**
 * Returns a stable phase key while a shape is visually frozen.
 * null means the shape is actively interpolating and must be rasterized again.
 */
export function staticShapePhase(shape: Shape, time: number): string | null {
  const frames = sortedMotionKeyframes(shape.keyframes);
  if (frames.length <= 1) return "fixed";

  const first = frames[0];
  const last = frames[frames.length - 1];
  const hasMotion = frames.some((frame, index) => index > 0 && motionDifference(frames[index - 1], frame));
  if (!hasMotion) return "fixed";
  if (time <= first.time) return `before:${first.time}`;
  if (time >= last.time) return `after:${last.time}`;

  const nextIndex = frames.findIndex((frame) => frame.time >= time);
  const before = frames[Math.max(0, nextIndex - 1)];
  const after = frames[Math.max(0, nextIndex)];
  if (!motionDifference(before, after)) return `hold:${before.time}:${after.time}`;
  return null;
}

function cacheKey(shapes: Shape[], phases: Array<string | null>, offset: number) {
  return shapes.map((shape, index) => `${shape.id}@${phases[offset + index] ?? "dynamic"}`).join("|");
}

/**
 * Keeps z-order identical while limiting each frame to at most one live SVG.
 * Everything between the first and last actively moving layer remains in the
 * live core. Only the frozen prefix/suffix are cached. This avoids turning one
 * SVG conversion into many smaller conversions, which is slower in browsers.
 */
export function exportShapeRuns(shapes: Shape[], time: number): ExportShapeRun[] {
  if (!shapes.length) return [];
  const phases = shapes.map((shape) => staticShapePhase(shape, time));
  const firstDynamic = phases.findIndex((phase) => phase === null);
  if (firstDynamic < 0) return [{ cacheable: true, cacheKey: cacheKey(shapes, phases, 0), shapes }];
  let lastDynamic = firstDynamic;
  for (let index = phases.length - 1; index >= firstDynamic; index -= 1) {
    if (phases[index] === null) { lastDynamic = index; break; }
  }

  const runs: ExportShapeRun[] = [];
  if (firstDynamic > 0) {
    const prefix = shapes.slice(0, firstDynamic);
    runs.push({ cacheable: true, cacheKey: cacheKey(prefix, phases, 0), shapes: prefix });
  }
  runs.push({ cacheable: false, cacheKey: "dynamic-core", shapes: shapes.slice(firstDynamic, lastDynamic + 1) });
  if (lastDynamic < shapes.length - 1) {
    const suffix = shapes.slice(lastDynamic + 1);
    runs.push({ cacheable: true, cacheKey: cacheKey(suffix, phases, lastDynamic + 1), shapes: suffix });
  }
  const cachedShapes = runs.filter((run) => run.cacheable).flatMap((run) => run.shapes);
  const worthwhile = cachedShapes.length >= 3 || cachedShapes.some((shape) => Boolean(shape.src || shape.imageSrc));
  return worthwhile ? runs : [{ cacheable: false, cacheKey: "dynamic-full", shapes }];
}
