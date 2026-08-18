import type { Shape } from "../../app/types.ts";

export type PlaybackSample = {
  elapsedMs: number;
  deltaMs: number;
  playhead: number;
  expectedPlayhead: number;
};

export type AnimationAlert = {
  layerId: string;
  layerName: string;
  kind: string;
  from: number;
  to: number;
  detail: string;
};

export function auditAnimation(
  sourceShapes: Shape[],
  width: number,
  height: number,
  label: (shape: Shape) => string,
): AnimationAlert[] {
  const diagonal = Math.hypot(width, height);
  return sourceShapes.flatMap((shape) => {
    const frames = [...(shape.keyframes ?? [])].sort((a, b) => a.time - b.time);
    const alerts: AnimationAlert[] = [];
    for (let index = 1; index < frames.length; index += 1) {
      const before = frames[index - 1];
      const after = frames[index];
      const interval = after.time - before.time;
      const distance = Math.hypot(after.x - before.x, after.y - before.y);
      const scaleRatio = Math.max(after.w / Math.max(1, before.w), before.w / Math.max(1, after.w), after.h / Math.max(1, before.h), before.h / Math.max(1, after.h));
      if (interval < .08) alerts.push({ layerId: shape.id, layerName: label(shape), kind: "keyframes_muito_proximos", from: before.time, to: after.time, detail: `Intervalo de ${Math.round(interval * 1000)} ms` });
      if (interval < .22 && distance > diagonal * .12) alerts.push({ layerId: shape.id, layerName: label(shape), kind: "salto_de_posicao", from: before.time, to: after.time, detail: `Movimento de ${Math.round(distance)} px em ${Math.round(interval * 1000)} ms` });
      if (interval < .25 && scaleRatio > 1.7) alerts.push({ layerId: shape.id, layerName: label(shape), kind: "salto_de_escala", from: before.time, to: after.time, detail: `Escala mudou ${scaleRatio.toFixed(1)}× em ${Math.round(interval * 1000)} ms` });
    }
    return alerts;
  });
}

export function analyzePlaybackSamples(samples: PlaybackSample[], animationAlertCount: number) {
  const deltas = samples.map((sample) => sample.deltaMs).sort((a, b) => a - b);
  const averageDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0;
  const percentile95 = deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * .95))] : 0;
  const worstDelta = deltas.at(-1) ?? 0;
  const longFrames = samples.filter((sample) => sample.deltaMs > 33.4).length;
  const freezes = samples.filter((sample) => sample.deltaMs > 100).length;
  const estimatedDroppedFrames = samples.reduce((sum, sample) => sum + Math.max(0, Math.round(sample.deltaMs / 16.67) - 1), 0);
  const averageFps = averageDelta ? 1000 / averageDelta : 0;
  const longFrameRatio = samples.length ? longFrames / samples.length : 0;
  const droppedFrameRatio = samples.length ? estimatedDroppedFrames / samples.length : 0;
  const performanceIssue = averageFps < 55 || percentile95 > 24 || freezes > 0 || longFrameRatio > .05 || droppedFrameRatio > .1;
  const performanceSeverity = freezes > 0 || averageFps < 30 ? "grave" : averageFps < 50 || longFrameRatio > .1 ? "moderada" : performanceIssue ? "leve" : "estavel";
  const animationIssue = animationAlertCount > 0;
  const diagnosis = performanceIssue && animationIssue ? "misto" : performanceIssue ? "desempenho_do_editor_ou_dispositivo" : animationIssue ? "estrutura_da_animacao" : "sem_problema_claro_na_medicao";
  return {
    diagnosis,
    averageFps: Math.round(averageFps * 10) / 10,
    averageFrameMs: Math.round(averageDelta * 100) / 100,
    p95FrameMs: percentile95,
    worstFrameMs: worstDelta,
    longFrames,
    freezes,
    estimatedDroppedFrames,
    measuredFrames: samples.length,
    longFrameRatio: Math.round(longFrameRatio * 1000) / 10,
    droppedFrameRatio: Math.round(droppedFrameRatio * 1000) / 10,
    performanceSeverity,
    animationAlerts: animationAlertCount,
  };
}

export type ExportDiagnosticEvent =
  | { kind: "stage"; name: string; durationMs: number; detail?: Record<string, unknown> }
  | { kind: "frame"; frame: number; time: number; paintMs: number; encodeSubmitMs: number; queueWaitMs: number; queueSize: number }
  | { kind: "audio"; startFrame: number; numberOfFrames: number; mixMs: number; encodeSubmitMs: number; queueWaitMs: number; queueSize: number }
  | { kind: "info"; name: string; value: unknown }
  | { kind: "error"; stage: string; message: string; frame?: number; time?: number };

export type ExportDiagnosticSummary = {
  mediaDurationSeconds: number;
  wallTimeSeconds: number;
  realtimeFactor: number;
  outputBytes: number;
  frameCount: number;
  averagePaintMs: number;
  p95PaintMs: number;
  worstPaintMs: number;
  totalPaintMs: number;
  totalVideoQueueWaitMs: number;
  maxVideoQueueSize: number;
  audioChunkCount: number;
  totalAudioMixMs: number;
  totalAudioQueueWaitMs: number;
  stages: Array<{ name: string; durationMs: number }>;
  bottleneck: string;
  bottleneckDurationMs: number;
  bottleneckSharePercent: number;
  warnings: string[];
};

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

export function summarizeExportDiagnostics(
  events: ExportDiagnosticEvent[],
  mediaDurationSeconds: number,
  wallTimeMs: number,
  outputBytes = 0,
): ExportDiagnosticSummary {
  const frames = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "frame" }> => event.kind === "frame");
  const audio = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "audio" }> => event.kind === "audio");
  const stageEvents = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "stage" }> => event.kind === "stage");
  const stageMap = new Map<string, number>();
  for (const event of stageEvents) stageMap.set(event.name, (stageMap.get(event.name) ?? 0) + Math.max(0, event.durationMs));

  const paintTimes = frames.map((event) => Math.max(0, event.paintMs));
  const totalPaintMs = paintTimes.reduce((sum, value) => sum + value, 0);
  const totalVideoQueueWaitMs = frames.reduce((sum, event) => sum + Math.max(0, event.queueWaitMs), 0);
  const totalAudioMixMs = audio.reduce((sum, event) => sum + Math.max(0, event.mixMs), 0);
  const totalAudioQueueWaitMs = audio.reduce((sum, event) => sum + Math.max(0, event.queueWaitMs), 0);

  const buckets = [
    { name: "pintura_de_frames", durationMs: totalPaintMs },
    { name: "espera_encoder_video", durationMs: totalVideoQueueWaitMs },
    { name: "mistura_de_audio", durationMs: totalAudioMixMs },
    { name: "espera_encoder_audio", durationMs: totalAudioQueueWaitMs },
    ...[...stageMap.entries()].map(([name, durationMs]) => ({ name, durationMs })),
  ].filter((item) => item.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs);
  const bottleneck = buckets[0] ?? { name: "sem_dados_suficientes", durationMs: 0 };
  const wall = Math.max(0, wallTimeMs);
  const averagePaintMs = paintTimes.length ? totalPaintMs / paintTimes.length : 0;
  const p95PaintMs = percentile(paintTimes, .95);
  const worstPaintMs = paintTimes.length ? Math.max(...paintTimes) : 0;
  const realtimeFactor = mediaDurationSeconds > 0 ? wall / 1000 / mediaDurationSeconds : 0;
  const warnings: string[] = [];
  if (p95PaintMs > 33.4) warnings.push("P95 da pintura ultrapassa o orçamento de 33,4 ms para 30 fps.");
  if (averagePaintMs > 25) warnings.push("A pintura média dos frames está alta e pode dominar a exportação.");
  if (totalVideoQueueWaitMs > wall * .15) warnings.push("Há espera relevante pela fila do encoder de vídeo; GPU/codec pode estar limitando o fluxo.");
  if (totalAudioQueueWaitMs > wall * .1) warnings.push("Há espera relevante pela fila do encoder de áudio.");
  if (realtimeFactor > 2) warnings.push("A exportação leva mais de 2× a duração do vídeo.");
  if (events.some((event) => event.kind === "error")) warnings.push("A execução registrou pelo menos um erro antes de concluir o diagnóstico.");

  return {
    mediaDurationSeconds: rounded(mediaDurationSeconds, 3),
    wallTimeSeconds: rounded(wall / 1000, 3),
    realtimeFactor: rounded(realtimeFactor, 3),
    outputBytes,
    frameCount: frames.length,
    averagePaintMs: rounded(averagePaintMs),
    p95PaintMs: rounded(p95PaintMs),
    worstPaintMs: rounded(worstPaintMs),
    totalPaintMs: rounded(totalPaintMs),
    totalVideoQueueWaitMs: rounded(totalVideoQueueWaitMs),
    maxVideoQueueSize: frames.reduce((max, event) => Math.max(max, event.queueSize), 0),
    audioChunkCount: audio.length,
    totalAudioMixMs: rounded(totalAudioMixMs),
    totalAudioQueueWaitMs: rounded(totalAudioQueueWaitMs),
    stages: [...stageMap.entries()].map(([name, durationMs]) => ({ name, durationMs: rounded(durationMs) })).sort((a, b) => b.durationMs - a.durationMs),
    bottleneck: bottleneck.name,
    bottleneckDurationMs: rounded(bottleneck.durationMs),
    bottleneckSharePercent: wall ? rounded((bottleneck.durationMs / wall) * 100, 1) : 0,
    warnings,
  };
}
