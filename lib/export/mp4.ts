import type { SceneAudioPreset } from "../../app/types.ts";
import type { ExportDiagnosticEvent } from "./diagnostic.ts";
import { presetClips } from "../audio/scenes.ts";
import { mixSceneAudioRange, type DecodedAudioSource, type LinkedPeakLimiterState, type MixedSceneAudio } from "./mp4-audio.ts";

export type Mp4Status = (progress: number | null, message: string) => void;

export type RenderMp4Options = {
  width: number;
  height: number;
  duration: number;
  audioPreset?: SceneAudioPreset | null;
  paintFrame: (canvas: HTMLCanvasElement, time: number) => Promise<void>;
  onStatus: Mp4Status;
  onDiagnosticEvent?: (event: ExportDiagnosticEvent) => void;
};

export function mp4FramePlan(duration: number, fps = 30) {
  const frameCount = Math.max(1, Math.round(duration * fps));
  return Array.from({ length: frameCount }, (_, frame) => ({
    frame,
    time: frameCount === 1 ? duration : Math.min(duration, frame * duration / (frameCount - 1)),
    timestamp: Math.round(frame * 1_000_000 / fps),
    frameDuration: Math.round(1_000_000 / fps),
    keyFrame: frame % (fps * VIDEO_KEYFRAME_INTERVAL_SECONDS) === 0,
  }));
}

export const DETERMINISTIC_MP4_UNAVAILABLE = "Este navegador não oferece exportação MP4 com duração precisa. Atualize o Chrome, Edge ou Safari e tente novamente.";

export function assertDeterministicMp4Support(runtime: { VideoEncoder?: unknown; VideoFrame?: unknown }) {
  if (typeof runtime.VideoEncoder !== "function" || typeof runtime.VideoFrame !== "function") {
    throw new Error(DETERMINISTIC_MP4_UNAVAILABLE);
  }
}

export const MP4_AUDIO_UNAVAILABLE = "Este navegador não oferece áudio AAC no MP4. Atualize o Chrome ou Edge e tente novamente.";

export function assertMp4AudioSupport(runtime: { AudioEncoder?: unknown; AudioData?: unknown }) {
  if (typeof runtime.AudioEncoder !== "function" || typeof runtime.AudioData !== "function") throw new Error(MP4_AUDIO_UNAVAILABLE);
}

function pcm16Sample(value: number) {
  if (!Number.isFinite(value)) return 0;
  const safe = Math.max(-1, Math.min(1, value));
  return safe < 0 ? Math.round(safe * 32_768) : Math.round(safe * 32_767);
}

export function pcm16InterleavedChunk(mixed: MixedSceneAudio, startFrame: number, numberOfFrames: number) {
  const interleaved = new Int16Array(numberOfFrames * mixed.numberOfChannels);
  for (let frame = 0; frame < numberOfFrames; frame += 1) {
    const sourceFrame = startFrame + frame;
    interleaved[frame * 2] = pcm16Sample(mixed.channelData[0][sourceFrame]);
    interleaved[frame * 2 + 1] = pcm16Sample(mixed.channelData[1][sourceFrame]);
  }
  return interleaved;
}

const LONG_PROJECT_SECONDS = 5 * 60;
const LONG_RAM_UNSAFE_SECONDS = 10 * 60;
const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 192_000;
const OUTPUT_ESTIMATE_MARGIN = 1.12;
const MP4_AUDIO_CONFIG: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
const PRODUCTION_VIDEO_FPS = 30;
const VIDEO_QUEUE_LIMIT = 6;
const VIDEO_KEYFRAME_INTERVAL_SECONDS = 4;
const AUDIO_QUEUE_LIMIT = 16;
const ENCODER_STALL_MS = 20_000;
const AUDIO_ENCODER_STALL_MS = 45_000;

// H.264 via WebCodecs varia conforme SO, GPU e implementação do navegador.
// Não prendemos a exportação a um único perfil/nível nem a hardware obrigatório.
// Preservamos primeiro o perfil/nível original do Forma e só ampliamos para
// Level 4.2/Main/High quando o encoder do aparelho exigir outra combinação.
export const H264_CODEC_CANDIDATES = [
  "avc1.420028", // baseline · level 4.0 (compatibilidade original do Forma)
  "avc1.42e028", // constrained baseline · level 4.0
  "avc1.42002a", // baseline · level 4.2
  "avc1.42e02a", // constrained baseline · level 4.2
  "avc1.4d4028", // main · level 4.0
  "avc1.4d402a", // main · level 4.2
  "avc1.640028", // high · level 4.0
  "avc1.64002a", // high · level 4.2
] as const;

const H264_ACCELERATION_CANDIDATES: HardwareAcceleration[] = [
  // Para exportação longa, tente primeiro o caminho acelerado pela GPU/codec
  // dedicado. Se o navegador rejeitar, mantemos os fallbacks já existentes.
  "prefer-hardware",
  "no-preference",
  "prefer-software",
];

export async function resolveSupportedH264Config(
  encoderClass: Pick<typeof VideoEncoder, "isConfigSupported">,
  width: number,
  height: number,
  fps = 30,
  bitrate = VIDEO_BITRATE,
): Promise<VideoEncoderConfig | null> {
  // Priorize a aceleração antes do perfil. Alguns aparelhos recusam
  // Baseline via hardware, mas aceitam Main/High acelerados. Se iterarmos
  // codec primeiro, um Baseline em no-preference pode ser aceito cedo demais
  // e impedir que o Forma descubra um perfil realmente acelerado.
  for (const hardwareAcceleration of H264_ACCELERATION_CANDIDATES) {
    for (const codec of H264_CODEC_CANDIDATES) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: "quality",
        hardwareAcceleration,
        contentHint: "motion",
      };
      try {
        const support = await encoderClass.isConfigSupported(config);
        if (support.supported) {
          // isConfigSupported() pode devolver uma cópia normalizada com
          // hardwareAcceleration="no-preference" mesmo quando o pedido
          // prefer-hardware foi aceito. Configuramos com o pedido que foi
          // efetivamente testado para não perder a preferência do Forma.
          return config;
        }
      } catch {
        // Um perfil pode ser rejeitado com TypeError/NotSupportedError; seguimos
        // para os demais em vez de declarar o aparelho incompatível cedo demais.
      }
    }
  }
  return null;
}
const AUDIO_MIX_CHUNK_FRAMES = 4_096;
let renderInProgress = false;

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function assertSupportedMp4AudioConfig() {
  assertMp4AudioSupport(window);
  try {
    const support = await AudioEncoder.isConfigSupported(MP4_AUDIO_CONFIG);
    if (!support.supported) throw new Error(MP4_AUDIO_UNAVAILABLE);
    return support.config ?? MP4_AUDIO_CONFIG;
  } catch (error) {
    if (error instanceof Error && error.message === MP4_AUDIO_UNAVAILABLE) throw error;
    throw new Error(MP4_AUDIO_UNAVAILABLE);
  }
}

type AudioSourceFetchPlan = {
  src: string;
  requiredSeconds: number | null;
  sourceDuration: number | null;
  sourceBytes: number | null;
  rangeEnd: number | null;
};

function audioSourceFetchPlan(preset: SceneAudioPreset, src: string): AudioSourceFetchPlan {
  const clips = presetClips(preset).filter((clip) => clip.src === src);
  const sourceDuration = clips.map((clip) => Number(clip.sourceDuration)).find((value) => Number.isFinite(value) && value > 0) ?? null;
  const sourceBytes = clips.map((clip) => Number(clip.sourceBytes)).find((value) => Number.isFinite(value) && value > 0) ?? null;
  let requiredSeconds = 0;
  for (const clip of clips) {
    if (clip.loop) return { src, requiredSeconds: null, sourceDuration, sourceBytes, rangeEnd: null };
    const sourceStart = Math.max(0, Number(clip.timelineOffset ?? clip.trimStart ?? 0) || 0);
    const audible = Math.max(.05, Number(clip.duration) || .05);
    requiredSeconds = Math.max(requiredSeconds, sourceStart + audible);
  }
  if (!sourceDuration || !sourceBytes || sourceBytes < 1_000_000 || requiredSeconds >= sourceDuration - 2) {
    return { src, requiredSeconds: requiredSeconds || null, sourceDuration, sourceBytes, rangeEnd: null };
  }
  const safeSeconds = Math.min(sourceDuration, requiredSeconds + 12);
  const proportionalBytes = Math.ceil(sourceBytes * safeSeconds / sourceDuration);
  const rangeEnd = Math.min(sourceBytes - 1, Math.max(1_048_575, proportionalBytes + 768 * 1024));
  return { src, requiredSeconds, sourceDuration, sourceBytes, rangeEnd };
}

async function fetchAudioArrayBuffer(plan: AudioSourceFetchPlan) {
  if (plan.rangeEnd === null || plan.src.startsWith("data:") || plan.src.startsWith("blob:")) {
    const response = await fetch(plan.src);
    if (!response.ok) throw new Error("Não foi possível ler um dos áudios do projeto.");
    return { bytes: await response.arrayBuffer(), partial: false, transferredBytes: Number(response.headers.get("content-length")) || null };
  }
  try {
    const response = await fetch(plan.src, { headers: { Range: `bytes=0-${plan.rangeEnd}` } });
    if (!response.ok) throw new Error("range-failed");
    const bytes = await response.arrayBuffer();
    const partial = response.status === 206 || Boolean(response.headers.get("content-range"));
    return { bytes, partial, transferredBytes: bytes.byteLength };
  } catch {
    const response = await fetch(plan.src);
    if (!response.ok) throw new Error("Não foi possível ler um dos áudios do projeto.");
    const bytes = await response.arrayBuffer();
    return { bytes, partial: false, transferredBytes: bytes.byteLength };
  }
}

async function decodePresetAudioSources(preset: SceneAudioPreset, onStatus: Mp4Status, onDiagnosticEvent?: (event: ExportDiagnosticEvent) => void) {
  const clips = presetClips(preset);
  if (!clips.length) return null;
  assertMp4AudioSupport(window);
  onStatus(0, "Decodificando fontes de áudio…");
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error(MP4_AUDIO_UNAVAILABLE);
  const context = new AudioContextClass();
  try {
    const sources = new Map<string, DecodedAudioSource>();
    const uniqueSources = [...new Set(clips.map((clip) => clip.src))];
    for (let index = 0; index < uniqueSources.length; index += 1) {
      const src = uniqueSources[index];
      const plan = audioSourceFetchPlan(preset, src);
      let fetched = await fetchAudioArrayBuffer(plan);
      let buffer: AudioBuffer;
      try {
        buffer = await context.decodeAudioData(fetched.bytes.slice(0));
      } catch (error) {
        if (!fetched.partial) throw error;
        const response = await fetch(src);
        if (!response.ok) throw new Error("Não foi possível ler um dos áudios do projeto.");
        const bytes = await response.arrayBuffer();
        fetched = { bytes, partial: false, transferredBytes: bytes.byteLength };
        buffer = await context.decodeAudioData(bytes.slice(0));
      }
      if (fetched.partial && plan.requiredSeconds !== null && buffer.duration + .25 < plan.requiredSeconds) {
        const response = await fetch(src);
        if (!response.ok) throw new Error("Não foi possível ler um dos áudios do projeto.");
        const bytes = await response.arrayBuffer();
        fetched = { bytes, partial: false, transferredBytes: bytes.byteLength };
        buffer = await context.decodeAudioData(bytes.slice(0));
      }
      sources.set(src, {
        sampleRate: buffer.sampleRate,
        channelData: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
      });
      onDiagnosticEvent?.({ kind: "info", name: "audio_source_decode", value: {
        src: src.startsWith("data:") ? "data-url" : src,
        partial: fetched.partial,
        transferredBytes: fetched.transferredBytes,
        decodedDurationSeconds: Number(buffer.duration.toFixed(3)),
        requiredSeconds: plan.requiredSeconds,
        sourceDurationSeconds: plan.sourceDuration,
        sourceBytes: plan.sourceBytes,
      } });
      if (index % 3 === 0) await yieldToBrowser();
    }
    return sources;
  } finally {
    await context.close().catch(() => {});
  }
}

async function waitForEncoderQueue(
  queueSize: () => number,
  limit: number,
  failure: () => Error | null,
  label: string,
) {
  const started = performance.now();
  while (queueSize() > limit) {
    const error = failure();
    if (error) throw error;
    if (performance.now() - started > ENCODER_STALL_MS) throw new Error(`${label} parou de responder. Tente fechar outras abas e exportar novamente.`);
    await yieldToBrowser();
  }
  return performance.now() - started;
}

type QueueEventEncoder = EventTarget & { readonly encodeQueueSize: number };

async function waitForEncoderDequeue(
  encoder: QueueEventEncoder,
  limit: number,
  failure: () => Error | null,
  label: string,
  stallMs = ENCODER_STALL_MS,
) {
  const started = performance.now();
  const deadline = started + stallMs;
  while (encoder.encodeQueueSize > limit) {
    const error = failure();
    if (error) throw error;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`${label} parou de responder. Tente fechar outras abas e exportar novamente.`);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        encoder.removeEventListener("dequeue", onDequeue);
        clearTimeout(watchdog);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const check = () => {
        const currentFailure = failure();
        if (currentFailure) return finish(() => reject(currentFailure));
        if (encoder.encodeQueueSize <= limit) return finish(resolve);
      };
      const onDequeue = () => check();
      const watchdog = setTimeout(() => {
        finish(() => reject(new Error(`${label} parou de responder. Tente fechar outras abas e exportar novamente.`)));
      }, Math.max(1, remaining));
      encoder.addEventListener("dequeue", onDequeue);
      // Fecha a janela de corrida caso a fila tenha drenado entre o primeiro
      // teste e o registro do listener.
      check();
    });
  }
  return performance.now() - started;
}

async function encodePresetAudioStreaming(
  muxer: { addAudioChunk: (chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata) => void },
  preset: SceneAudioPreset,
  duration: number,
  sources: ReadonlyMap<string, DecodedAudioSource>,
  config: AudioEncoderConfig,
  onStatus: Mp4Status,
  onDiagnosticEvent?: (event: ExportDiagnosticEvent) => void,
) {
  let encoderFailure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      try { muxer.addAudioChunk(chunk, metadata); }
      catch (error) { encoderFailure = error instanceof Error ? error : new Error("Falha ao gravar o áudio no MP4."); }
    },
    error: (error) => { encoderFailure = error; },
  });
  const sampleRate = config.sampleRate ?? MP4_AUDIO_CONFIG.sampleRate!;
  const totalFrames = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
  const limiterState: LinkedPeakLimiterState = { gain: 1 };
  try {
    encoder.configure(config);
    for (let startFrame = 0; startFrame < totalFrames; startFrame += AUDIO_MIX_CHUNK_FRAMES) {
      if (encoderFailure) throw encoderFailure;
      const numberOfFrames = Math.min(AUDIO_MIX_CHUNK_FRAMES, totalFrames - startFrame);
      const mixStarted = performance.now();
      const mixed = mixSceneAudioRange(preset, duration, sources, startFrame, numberOfFrames, sampleRate, limiterState);
      const interleaved = pcm16InterleavedChunk(mixed, 0, mixed.length);
      const mixMs = performance.now() - mixStarted;
      const timestamp = Math.round(startFrame * 1_000_000 / sampleRate);
      const data = new AudioData({ format: "s16", sampleRate, numberOfFrames: mixed.length, numberOfChannels: mixed.numberOfChannels, timestamp, data: interleaved });
      const encodeStarted = performance.now();
      try { encoder.encode(data); } finally { data.close(); }
      const encodeSubmitMs = performance.now() - encodeStarted;
      const queueSize = encoder.encodeQueueSize;
      const queueWaitMs = await waitForEncoderDequeue(encoder, AUDIO_QUEUE_LIMIT, () => encoderFailure, "O encoder de áudio", AUDIO_ENCODER_STALL_MS);
      onDiagnosticEvent?.({ kind: "audio", startFrame, numberOfFrames, mixMs, encodeSubmitMs, queueWaitMs, queueSize });
      if (startFrame % (AUDIO_MIX_CHUNK_FRAMES * 64) === 0) {
        const progress = 92 + Math.round((startFrame / Math.max(1, totalFrames)) * 7);
        onStatus(Math.min(99, progress), `Codificando áudio AAC · ${Math.min(99, progress)}%`);
        await yieldToBrowser();
      }
    }
    const audioFlushStarted = performance.now();
    await encoder.flush();
    onDiagnosticEvent?.({ kind: "stage", name: "flush_encoder_audio", durationMs: performance.now() - audioFlushStarted });
    if (encoderFailure) throw encoderFailure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

type MuxTargetSession = {
  target: object;
  fastStart: false | "in-memory";
  diskBacked: boolean;
  finish: () => Promise<Blob>;
  abort: () => Promise<void>;
};

function estimatedMp4Bytes(duration: number) {
  return Math.ceil(Math.max(0, duration) * (VIDEO_BITRATE + AUDIO_BITRATE) / 8 * OUTPUT_ESTIMATE_MARGIN);
}

async function assertLongRenderStorage(duration: number) {
  if (duration < LONG_PROJECT_SECONDS || typeof navigator.storage?.estimate !== "function") return;
  try {
    const estimate = await navigator.storage.estimate();
    if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
    const available = Math.max(0, estimate.quota! - estimate.usage!);
    const required = estimatedMp4Bytes(duration);
    if (available < required) {
      const requiredMb = Math.ceil(required / 1_000_000);
      const availableMb = Math.floor(available / 1_000_000);
      throw new Error(`Espaço local insuficiente para uma exportação longa. O Forma estima cerca de ${requiredMb} MB e há aproximadamente ${availableMb} MB disponíveis para este site.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Espaço local insuficiente")) throw error;
    // Alguns navegadores não informam quota com precisão; nesse caso deixamos
    // a escrita real no OPFS decidir, em vez de bloquear uma exportação válida.
  }
}

async function createMuxTarget(duration: number, onStatus: Mp4Status, muxerModule: typeof import("mp4-muxer")): Promise<MuxTargetSession> {
  if (duration >= LONG_PROJECT_SECONDS) {
    await assertLongRenderStorage(duration);
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage.getDirectory === "function") {
      try {
        const root = await storage.getDirectory();
        const handle = await root.getFileHandle("forma-render-cache.mp4", { create: true });
        const writable = await handle.createWritable();
        const target = new muxerModule.FileSystemWritableFileStreamTarget(writable, { chunkSize: 8 * 1024 * 1024 });
        onStatus(0, "Modo projeto longo · gravando o MP4 no armazenamento temporário para poupar memória…");
        return {
          target,
          fastStart: false,
          diskBacked: true,
          finish: async () => { await writable.close(); return await handle.getFile(); },
          abort: async () => { try { await writable.abort(); } catch { /* já fechado */ } },
        };
      } catch (error) {
        if (duration >= LONG_RAM_UNSAFE_SECONDS) {
          const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
          throw new Error(`Este navegador não conseguiu abrir o armazenamento temporário necessário para exportar ${Math.round(duration / 60)} min com segurança${detail}. Saia do modo privado, libere espaço e tente novamente.`);
        }
      }
    } else if (duration >= LONG_RAM_UNSAFE_SECONDS) {
      throw new Error("Este navegador não oferece o armazenamento temporário necessário para exportações de 10 minutos ou mais sem risco de falta de memória.");
    }
  }
  const target = new muxerModule.ArrayBufferTarget();
  if (duration >= LONG_PROJECT_SECONDS) onStatus(0, "Modo compatibilidade · este navegador manterá o MP4 final na memória durante a exportação.");
  return {
    target,
    fastStart: "in-memory",
    diskBacked: false,
    finish: async () => new Blob([target.buffer], { type: "video/mp4" }),
    abort: async () => {},
  };
}

async function renderWithWebCodecs(options: RenderMp4Options) {
  const { width, height, duration, paintFrame, onStatus, audioPreset, onDiagnosticEvent } = options;
  // Perfil de produção consolidado após os diagnósticos V3–V15.
  // Mantemos 30 fps + quality para preservar fluidez e todos os frames.
  const fps = PRODUCTION_VIDEO_FPS;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const muxImportStarted = performance.now();
  const muxerModule = await import("mp4-muxer");
  onDiagnosticEvent?.({ kind: "stage", name: "carregamento_muxer", durationMs: performance.now() - muxImportStarted });
  const codecStarted = performance.now();
  const config = await resolveSupportedH264Config(VideoEncoder, width, height, fps, VIDEO_BITRATE);
  onDiagnosticEvent?.({ kind: "stage", name: "selecao_encoder_h264", durationMs: performance.now() - codecStarted, detail: { supported: Boolean(config) } });
  if (!config) throw new Error("O Chrome não encontrou um encoder H.264 compatível para 1080p neste aparelho. Atualize o navegador e verifique se a aceleração gráfica está habilitada.");
  onDiagnosticEvent?.({ kind: "info", name: "video_config", value: { codec: config.codec, width: config.width, height: config.height, bitrate: config.bitrate, framerate: config.framerate, hardwareAcceleration: config.hardwareAcceleration, latencyMode: config.latencyMode, contentHint: config.contentHint } });
  onDiagnosticEvent?.({ kind: "info", name: "video_encoder_tuning", value: { queueLimit: VIDEO_QUEUE_LIMIT, queueWaitStrategy: "dequeue-event", keyframeIntervalSeconds: VIDEO_KEYFRAME_INTERVAL_SECONDS, latencyMode: "quality", preserveEveryFrame: true } });
  const hasAudio = Boolean(audioPreset && presetClips(audioPreset).length);
  const audioConfigStarted = performance.now();
  const audioConfig = hasAudio ? await assertSupportedMp4AudioConfig() : null;
  if (hasAudio) {
    onDiagnosticEvent?.({ kind: "stage", name: "configuracao_encoder_audio", durationMs: performance.now() - audioConfigStarted });
    onDiagnosticEvent?.({ kind: "info", name: "audio_encoder_tuning", value: { queueLimit: AUDIO_QUEUE_LIMIT, queueWaitStrategy: "dequeue-event", stallWatchdogMs: AUDIO_ENCODER_STALL_MS, preserveEveryChunk: true } });
  }
  const decodeStarted = performance.now();
  const decodedAudio = audioPreset && hasAudio ? await decodePresetAudioSources(audioPreset, onStatus, onDiagnosticEvent) : null;
  if (hasAudio) onDiagnosticEvent?.({ kind: "stage", name: "decodificacao_audio", durationMs: performance.now() - decodeStarted, detail: { sourceCount: decodedAudio?.size ?? 0 } });
  const targetStarted = performance.now();
  const targetSession = await createMuxTarget(duration, onStatus, muxerModule);
  onDiagnosticEvent?.({ kind: "stage", name: "preparacao_armazenamento_saida", durationMs: performance.now() - targetStarted, detail: { diskBacked: targetSession.diskBacked } });
  onDiagnosticEvent?.({ kind: "info", name: "output_target", value: { diskBacked: targetSession.diskBacked, fastStart: targetSession.fastStart } });
  let encoder: VideoEncoder | null = null;
  let encoderFailure: Error | null = null;
  let finalized = false;
  try {
    const muxer = new muxerModule.Muxer({
      target: targetSession.target as never,
      video: { codec: "avc", width, height, frameRate: fps },
      ...(decodedAudio ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: audioConfig?.sampleRate ?? 48_000 } } : {}),
      fastStart: targetSession.fastStart,
    });
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        try { muxer.addVideoChunk(chunk, metadata); }
        catch (error) { encoderFailure = error instanceof Error ? error : new Error("Falha ao gravar o vídeo no MP4."); }
      },
      error: (error) => { encoderFailure = error; },
    });
    encoder.configure(config);
    const frameCount = Math.max(1, Math.round(duration * fps));
    const frameDuration = Math.round(1_000_000 / fps);
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (encoderFailure) throw encoderFailure;
      const time = frameCount === 1 ? duration : Math.min(duration, frame * duration / (frameCount - 1));
      const timestamp = Math.round(frame * 1_000_000 / fps);
      const paintStarted = performance.now();
      try {
        await paintFrame(canvas, time);
      } catch (error) {
        onDiagnosticEvent?.({ kind: "error", stage: "pintura_frame", message: error instanceof Error ? error.message : "Falha ao pintar frame.", frame, time });
        throw error;
      }
      const paintMs = performance.now() - paintStarted;
      const videoFrame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
      const encodeStarted = performance.now();
      try {
        encoder.encode(videoFrame, { keyFrame: frame % (fps * VIDEO_KEYFRAME_INTERVAL_SECONDS) === 0 });
      } finally {
        videoFrame.close();
      }
      const encodeSubmitMs = performance.now() - encodeStarted;
      const queueSize = encoder.encodeQueueSize;
      // Antes havia encoder.flush() sempre que a fila passava de 8 frames.
      // Isso drenava todo o pipeline milhares de vezes. Agora só aplicamos
      // backpressure e deixamos o codec trabalhar continuamente.
      const queueWaitMs = await waitForEncoderDequeue(encoder, VIDEO_QUEUE_LIMIT, () => encoderFailure, "O encoder de vídeo");
      onDiagnosticEvent?.({ kind: "frame", frame, time, paintMs, encodeSubmitMs, queueWaitMs, queueSize });
      if (frame % 30 === 0 || frame === frameCount - 1) {
        const progress = Math.round((frame / Math.max(1, frameCount - 1)) * (decodedAudio ? 91 : 99));
        onStatus(progress, `Renderizando animação · ${progress}%`);
      }
      // setTimeout continua funcionando com a aba em segundo plano; rAF pode
      // ser suspenso e fazer uma exportação longa parecer travada.
      if (frame % 12 === 0) await yieldToBrowser();
    }
    const flushStarted = performance.now();
    await encoder.flush();
    onDiagnosticEvent?.({ kind: "stage", name: "flush_encoder_video", durationMs: performance.now() - flushStarted });
    if (encoderFailure) throw encoderFailure;
    if (decodedAudio && audioPreset) {
      onStatus(92, "Codificando áudio AAC em blocos…");
      const audioEncodeStarted = performance.now();
      await encodePresetAudioStreaming(muxer, audioPreset, duration, decodedAudio, audioConfig ?? MP4_AUDIO_CONFIG, onStatus, onDiagnosticEvent);
      onDiagnosticEvent?.({ kind: "stage", name: "codificacao_audio_total", durationMs: performance.now() - audioEncodeStarted });
    }
    const finalizeStarted = performance.now();
    muxer.finalize();
    onDiagnosticEvent?.({ kind: "stage", name: "finalizacao_mux", durationMs: performance.now() - finalizeStarted });
    finalized = true;
    const finishStarted = performance.now();
    const blob = await targetSession.finish();
    onDiagnosticEvent?.({ kind: "stage", name: "materializacao_mp4", durationMs: performance.now() - finishStarted, detail: { bytes: blob.size } });
    onDiagnosticEvent?.({ kind: "info", name: "output_blob", value: { bytes: blob.size, type: blob.type } });
    onStatus(null, targetSession.diskBacked ? "MP4 1080p pronto · renderização longa concluída com memória protegida" : "MP4 1080p pronto");
    return blob;
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    if (!finalized) await targetSession.abort();
  }
}

export async function renderMp4(options: RenderMp4Options) {
  assertDeterministicMp4Support(window);
  if (renderInProgress) throw new Error("Já existe uma exportação MP4 em andamento. Aguarde a conclusão antes de iniciar outra.");
  renderInProgress = true;
  try {
    return await renderWithWebCodecs(options);
  } catch (error) {
    options.onDiagnosticEvent?.({ kind: "error", stage: "render_mp4", message: error instanceof Error ? error.message : "Falha desconhecida na exportação MP4." });
    throw error;
  } finally {
    renderInProgress = false;
  }
}
