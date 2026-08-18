import type { FormaScene, SceneAudioClip, SceneAudioPreset, SceneStingerRole, SceneStingerSettings } from "../../app/types.ts";
import { sceneKind } from "../scenes/collection.ts";

export type SceneStingerPreset = { id: string; name: string; role: SceneStingerRole; src: string; duration: number };

export const SCENE_STINGER_PRESETS: SceneStingerPreset[] = [
  { id: "start-01", name: "Início 1", role: "main", src: "/audio/scene-stingers/start-01.wav", duration: 2.44 },
  { id: "start-02", name: "Início 2", role: "main", src: "/audio/scene-stingers/start-02.wav", duration: 1.96 },
  { id: "start-03", name: "Início 3", role: "main", src: "/audio/scene-stingers/start-03.wav", duration: 2.64 },
  { id: "start-04", name: "Início 4", role: "main", src: "/audio/scene-stingers/start-04.wav", duration: 2.16 },
  { id: "start-05", name: "Início 5", role: "main", src: "/audio/scene-stingers/start-05.wav", duration: 2.92 },
  { id: "start-06", name: "Início 6", role: "main", src: "/audio/scene-stingers/start-06.wav", duration: 3.12 },
  { id: "start-07", name: "Início 7", role: "main", src: "/audio/scene-stingers/start-07.wav", duration: 2.96 },
  { id: "result-01", name: "Resultado 1", role: "result", src: "/audio/scene-stingers/result-01.wav", duration: 3.20 },
  { id: "result-02", name: "Resultado 2", role: "result", src: "/audio/scene-stingers/result-02.wav", duration: 2.28 },
  { id: "result-03", name: "Resultado 3", role: "result", src: "/audio/scene-stingers/result-03.wav", duration: 2.68 },
  { id: "result-04", name: "Resultado 4", role: "result", src: "/audio/scene-stingers/result-04.wav", duration: 2.00 },
];

const clamp = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

export function defaultSceneStingerSettings(): SceneStingerSettings {
  return {
    version: 1,
    main: { enabled: true, volume: .55, probability: .65, presetIds: SCENE_STINGER_PRESETS.filter((preset) => preset.role === "main").map((preset) => preset.id) },
    result: { enabled: true, volume: .58, probability: .65, presetIds: SCENE_STINGER_PRESETS.filter((preset) => preset.role === "result").map((preset) => preset.id) },
  };
}

export function normalizeSceneStingerSettings(value?: Partial<SceneStingerSettings> | null): SceneStingerSettings {
  const defaults = defaultSceneStingerSettings();
  const known = new Set(SCENE_STINGER_PRESETS.map((preset) => preset.id));
  const pool = (role: SceneStingerRole) => {
    const source = value?.[role];
    const presetIds = Array.isArray(source?.presetIds) ? source.presetIds.map(String).filter((id) => known.has(id) && SCENE_STINGER_PRESETS.some((preset) => preset.id === id && preset.role === role)) : defaults[role].presetIds;
    return { enabled: source?.enabled ?? defaults[role].enabled, volume: clamp(source?.volume, defaults[role].volume), probability: clamp(source?.probability, defaults[role].probability), presetIds };
  };
  return { version: 1, main: pool("main"), result: pool("result") };
}

function pick(role: SceneStingerRole, settings: SceneStingerSettings, random: () => number, previousId?: string) {
  const pool = settings[role];
  if (!pool.enabled || pool.probability <= 0 || !pool.presetIds.length) return null;
  if (pool.probability < 1 && random() >= pool.probability) return null;
  const allowed = SCENE_STINGER_PRESETS.filter((preset) => preset.role === role && pool.presetIds.includes(preset.id));
  const choices = allowed.length > 1 ? allowed.filter((preset) => preset.id !== previousId) : allowed;
  if (!choices.length) return null;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, Math.min(.999999, random())) * choices.length));
  return choices[index];
}

/**
 * Result stingers share a window at the end of the scene sized for the
 * longest selected result preset. Main-scene stingers intentionally remain
 * anchored at the beginning of the scene.
 */
export function sceneStingerWindowStart(role: SceneStingerRole, sceneDuration: number, settings: SceneStingerSettings) {
  if (role === "main") return 0;
  const selectedIds = settings.result.presetIds;
  const longestSelectedDuration = SCENE_STINGER_PRESETS.reduce((longest, preset) => (
    preset.role === "result" && selectedIds.includes(preset.id)
      ? Math.max(longest, preset.duration)
      : longest
  ), 0);
  return Math.max(0, Math.max(0, sceneDuration) - longestSelectedDuration);
}

function clipFor(preset: SceneStingerPreset, role: SceneStingerRole, start: number, end: number, volume: number, sceneId: string): SceneAudioClip {
  return { id: `automatic-${sceneId}-${preset.id}`, name: preset.name, src: preset.src, mime: "audio/wav", start, duration: preset.duration, sourceDuration: preset.duration, end, volume };
}

function merge(base: SceneAudioPreset | null | undefined, clips: SceneAudioClip[]) {
  if (!clips.length) return base ?? null;
  return {
    version: 1 as const,
    id: base?.id ?? "automatic-scene-audio",
    name: base?.name ?? "Sons automáticos",
    sceneKind: base?.sceneKind ?? "main" as const,
    masterVolume: base?.masterVolume ?? 1,
    tracks: [...(base?.tracks ?? []), { id: "automatic-scene-stingers", name: "Sons automáticos", clips }],
  };
}

export function addSceneStinger(base: SceneAudioPreset | null | undefined, scene: FormaScene | null | undefined, settings: SceneStingerSettings, random: () => number = Math.random) {
  if (!scene) return base ?? null;
  const kind = sceneKind(scene);
  if (kind !== "main" && kind !== "result") return base ?? null;
  const preset = pick(kind, settings, random);
  const start = sceneStingerWindowStart(kind, scene.animationDuration, settings);
  return merge(base, preset ? [clipFor(preset, kind, start, scene.animationDuration, settings[kind].volume, scene.id)] : []);
}

export function addProjectStingers(base: SceneAudioPreset | null | undefined, scenes: FormaScene[], settings: SceneStingerSettings, random: () => number = Math.random) {
  const clips: SceneAudioClip[] = [];
  const previous: Partial<Record<SceneStingerRole, string>> = {};
  let offset = 0;
  for (const scene of scenes) {
    const kind = sceneKind(scene);
    if (kind === "main" || kind === "result") {
      const preset = pick(kind, settings, random, previous[kind]);
      if (preset) {
        const localStart = sceneStingerWindowStart(kind, scene.animationDuration, settings);
        clips.push(clipFor(preset, kind, offset + localStart, offset + scene.animationDuration, settings[kind].volume, scene.id));
        previous[kind] = preset.id;
      }
    }
    offset += Math.max(0, scene.animationDuration);
  }
  return merge(base, clips);
}
