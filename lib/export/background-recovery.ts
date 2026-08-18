export const BACKGROUND_EXPORT_SEEK_ATTEMPTS = 2;
export const BACKGROUND_EXPORT_SEEK_TIMEOUT_MS = 4_500;
export const BACKGROUND_EXPORT_READY_TIMEOUT_MS = 10_000;

export function clampBackgroundSeekTime(target: number, duration: number, fps = 30) {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
  if (!Number.isFinite(duration) || duration <= 0) return safeTarget;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  // Evita pedir exatamente o limite final do arquivo, ponto em que alguns
  // decoders disparam MEDIA_ERR_DECODE/seek error em exportações longas.
  const margin = Math.max(0.001, 1 / (safeFps * 8));
  return Math.min(safeTarget, Math.max(0, duration - margin));
}

export function nearestBackgroundFrameIndex(targetIndex: number, candidates: readonly number[]) {
  if (!candidates.length) return null;
  let nearest = candidates[0];
  let distance = Math.abs(nearest - targetIndex);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const nextDistance = Math.abs(candidate - targetIndex);
    if (nextDistance < distance) {
      nearest = candidate;
      distance = nextDistance;
    }
  }
  return nearest;
}
