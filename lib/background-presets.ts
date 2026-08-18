export type BackgroundPreset = {
  id: string;
  label: string;
  color: string;
  src: string;
  poster: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  transitionDuration: number;
  exportFps?: number;
};

const LOOP_BACKGROUND_EXPORT_FPS = 24;
const RESULT_BACKGROUND_EXPORT_FPS = 30;

export const CORVOQUIZ_BACKGROUNDS: BackgroundPreset[] = [
  { id: "vinho", label: "Vinho", color: "#991344", src: "/backgrounds/corvoquiz-vinho.mp4", poster: "/backgrounds/corvoquiz-vinho.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "ciano", label: "Ciano", color: "#18B8B6", src: "/backgrounds/corvoquiz-ciano.mp4", poster: "/backgrounds/corvoquiz-ciano.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "roxo", label: "Roxo", color: "#9745DA", src: "/backgrounds/corvoquiz-roxo.mp4", poster: "/backgrounds/corvoquiz-roxo.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "azul", label: "Azul", color: "#287BF1", src: "/backgrounds/corvoquiz-azul.mp4", poster: "/backgrounds/corvoquiz-azul.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "laranja", label: "Laranja", color: "#FF8318", src: "/backgrounds/corvoquiz-laranja.mp4", poster: "/backgrounds/corvoquiz-laranja.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "verde", label: "Verde", color: "#219B42", src: "/backgrounds/corvoquiz-verde.mp4", poster: "/backgrounds/corvoquiz-verde.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "menta", label: "Menta", color: "#80E3D2", src: "/backgrounds/corvoquiz-menta.mp4", poster: "/backgrounds/corvoquiz-menta.jpg", duration: 4, trimStart: 1.75, trimEnd: .1, transitionDuration: .45, exportFps: LOOP_BACKGROUND_EXPORT_FPS },
  { id: "resultado-verde", label: "Resultado verde", color: "#219B42", src: "/backgrounds/corvoquiz-resultado-verde-5s.mp4", poster: "/backgrounds/corvoquiz-resultado-verde-5s.jpg", duration: 5.1, trimStart: 0, trimEnd: 0, transitionDuration: .001, exportFps: RESULT_BACKGROUND_EXPORT_FPS },
  { id: "resultado-vermelho", label: "Resultado vermelho", color: "#D92F56", src: "/backgrounds/corvoquiz-resultado-vermelho-5s.mp4", poster: "/backgrounds/corvoquiz-resultado-vermelho-5s.jpg", duration: 5.1, trimStart: 0, trimEnd: 0, transitionDuration: .001, exportFps: RESULT_BACKGROUND_EXPORT_FPS },
];

export function backgroundPresetBySource(source?: string) {
  return CORVOQUIZ_BACKGROUNDS.find((preset) => preset.src === source);
}

export function backgroundExportFps(source?: string) {
  return backgroundPresetBySource(source)?.exportFps ?? LOOP_BACKGROUND_EXPORT_FPS;
}

export function backgroundExportFrameIndex(source: string, mediaTime: number) {
  const fps = backgroundExportFps(source);
  const duration = Math.max(1 / fps, backgroundPresetBySource(source)?.duration ?? 4);
  const frameCount = Math.max(1, Math.round(duration * fps));
  const clampedTime = Math.max(0, Math.min(duration - 1 / (fps * 10), mediaTime));
  return Math.max(0, Math.min(frameCount - 1, Math.round(clampedTime * fps)));
}

export function backgroundQuantizedMediaTime(source: string, mediaTime: number) {
  return backgroundExportFrameIndex(source, mediaTime) / backgroundExportFps(source);
}

export function backgroundExportFrameKey(source: string, mediaTime: number) {
  return `${source}#${backgroundExportFrameIndex(source, mediaTime)}`;
}

export function backgroundPlaybackAtTime(source: string, time: number) {
  const preset = backgroundPresetBySource(source);
  const duration = preset?.duration ?? 4;
  const transitionDuration = preset?.transitionDuration ?? .45;
  const trimStart = preset?.trimStart ?? 0;
  const trimEnd = preset?.trimEnd ?? 0;
  const mediaEnd = Math.max(trimStart + .01, duration - trimEnd);
  const mediaSpan = mediaEnd - trimStart;
  const clipLifetime = duration + transitionDuration;
  const playbackRate = mediaSpan / clipLifetime;
  const cycleIndex = Math.floor(Math.max(0, time) / duration);
  const cycleTime = ((time % duration) + duration) % duration;
  const activeIndex = cycleIndex % 2;
  const blend = Math.max(0, Math.min(1, (cycleTime - (duration - transitionDuration)) / transitionDuration));
  const activeLocalTime = cycleTime + transitionDuration;
  const incomingLocalTime = Math.max(0, cycleTime - (duration - transitionDuration));
  const toMediaTime = (localTime: number) => trimStart + mediaSpan * Math.min(1, Math.max(0, localTime / clipLifetime));

  return {
    activeIndex,
    blend,
    activeMediaTime: toMediaTime(activeLocalTime),
    incomingMediaTime: toMediaTime(incomingLocalTime),
    inTransition: blend > 0,
    playbackRate,
  };
}
