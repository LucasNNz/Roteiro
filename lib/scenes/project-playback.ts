import type { FormaScene } from "../../app/types.ts";

type ProjectTimelineCache = { totalDuration: number; offsets: number[]; durations: number[] };
const timelineCache = new WeakMap<FormaScene[], ProjectTimelineCache>();

function timelineFor(scenes: FormaScene[]): ProjectTimelineCache {
  const cached = timelineCache.get(scenes);
  if (cached) return cached;
  const offsets: number[] = [];
  const durations: number[] = [];
  let totalDuration = 0;
  for (const scene of scenes) {
    offsets.push(totalDuration);
    const duration = Math.max(0, Number(scene.animationDuration) || 0);
    durations.push(duration);
    totalDuration += duration;
  }
  const timeline = { totalDuration, offsets, durations };
  timelineCache.set(scenes, timeline);
  return timeline;
}

export function projectFrameAtTime(scenes: FormaScene[], time: number) {
  if (!scenes.length) return null;
  const timeline = timelineFor(scenes);
  const clampedTime = Math.max(0, Math.min(timeline.totalDuration, Number.isFinite(time) ? time : 0));
  let low = 0;
  let high = scenes.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const end = timeline.offsets[middle] + timeline.durations[middle];
    if (clampedTime < end) high = middle;
    else low = middle + 1;
  }
  const sceneIndex = low;
  const scene = scenes[sceneIndex];
  const offset = timeline.offsets[sceneIndex];
  const sceneDuration = timeline.durations[sceneIndex];
  return { scene, sceneIndex, offset, localTime: Math.max(0, Math.min(sceneDuration, clampedTime - offset)), totalDuration: timeline.totalDuration };
}
