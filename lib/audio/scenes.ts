import type { FormaScene, SceneAudioAsset, SceneAudioClip, SceneAudioPreset, SceneAudioTrack, SceneKind } from "../../app/types.ts";

export const SCENE_AUDIO_TRACKS = ["Efeitos 1", "Efeitos 2", "Efeitos 3"] as const;
export const AUDIO_END_GUARD = .05;

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function clampAudioStart(start: number, sceneDuration: number) {
  const duration = Number.isFinite(sceneDuration) ? Math.max(0, sceneDuration) : 3600;
  return Math.max(0, Math.min(Math.max(0, duration - AUDIO_END_GUARD), Number.isFinite(start) ? start : 0));
}

export function effectiveAudioClipDuration(clip: Pick<SceneAudioClip, "duration">, mediaDuration: number) {
  return Math.max(.05, Math.min(clip.duration, Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : clip.duration));
}

export function audioClipEnvelope(clip: Pick<SceneAudioClip, "fadeIn" | "fadeOut">, elapsed: number, totalDuration: number) {
  const fadeIn = Math.max(0, Math.min(totalDuration, clip.fadeIn ?? 0));
  const fadeOut = Math.max(0, Math.min(totalDuration, clip.fadeOut ?? 0));
  const rising = fadeIn > 0 ? Math.max(0, Math.min(1, elapsed / fadeIn)) : 1;
  const falling = fadeOut > 0 ? Math.max(0, Math.min(1, (totalDuration - elapsed) / fadeOut)) : 1;
  return Math.min(rising, falling);
}

export function cloneAudioClip(clip: SceneAudioClip): SceneAudioClip {
  return { ...clip };
}

export function cloneAudioPreset(preset: SceneAudioPreset): SceneAudioPreset {
  return { ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.map(cloneAudioClip) })) };
}

export type PackedAudioLibrary = { version: 1; assets: SceneAudioAsset[]; presets: SceneAudioPreset[] };

export function packAudioLibrary(presets: SceneAudioPreset[], existingAssets: SceneAudioAsset[] = []): PackedAudioLibrary {
  const assets: SceneAudioAsset[] = [];
  const idsBySource = new Map<string, string>();
  const existingById = new Map(existingAssets.map((asset) => [asset.id, asset]));
  const packed = presets.map((preset) => ({
    ...cloneAudioPreset(preset),
    tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => {
      const source = clip.src || existingById.get(String(clip.assetId || ""))?.src || "";
      const mime = clip.mime || existingById.get(String(clip.assetId || ""))?.mime || "audio/mpeg";
      let assetId = idsBySource.get(source);
      if (!assetId) {
        assetId = `audio-asset-${assets.length + 1}`;
        idsBySource.set(source, assetId);
        assets.push({ id: assetId, src: source, mime });
      }
      return { ...clip, assetId, src: "" };
    }) })),
  }));
  return { version: 1, assets, presets: packed };
}

export function unpackAudioLibrary(presets: SceneAudioPreset[] | undefined, assets: SceneAudioAsset[] | undefined): SceneAudioPreset[] {
  const sources = new Map((Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id), String(asset.src || "")]));
  return (Array.isArray(presets) ? presets : []).map((preset) => normalizeAudioPreset({
    ...preset,
    tracks: (preset.tracks ?? []).map((track) => ({ ...track, clips: (track.clips ?? []).map((clip) => ({ ...clip, src: clip.src || sources.get(String(clip.assetId || "")) || "" })) })),
  }, preset.sceneKind));
}

export function normalizeAudioPreset(preset: Partial<SceneAudioPreset>, fallbackKind: SceneKind = "main"): SceneAudioPreset {
  const sourceTracks = Array.isArray(preset.tracks) ? preset.tracks : [];
  const tracks: SceneAudioTrack[] = SCENE_AUDIO_TRACKS.map((name, index) => {
    const source = sourceTracks[index];
    return {
      id: String(source?.id || `audio-track-${index + 1}`),
      name: String(source?.name || name).trim().slice(0, 32) || name,
      clips: (Array.isArray(source?.clips) ? source.clips : []).map((clip, clipIndex) => {
        const sourceDuration = clamp(clip.sourceDuration ?? clip.duration, .05, 3600, 1);
        const trimStart = clamp(clip.trimStart, 0, Math.max(0, sourceDuration - .05), 0);
        const duration = clamp(clip.duration, .05, Math.max(.05, sourceDuration - trimStart), sourceDuration - trimStart);
        return {
          id: String(clip.id || `audio-clip-${index + 1}-${clipIndex + 1}`),
          name: String(clip.name || `Áudio ${clipIndex + 1}`).trim().slice(0, 60) || `Áudio ${clipIndex + 1}`,
          src: String(clip.src || ""),
          ...(clip.assetId ? { assetId: String(clip.assetId) } : {}),
          ...(clip.cloudSrc ? { cloudSrc: String(clip.cloudSrc) } : {}),
          mime: String(clip.mime || "audio/mpeg"),
          start: clamp(clip.start, 0, 3600, 0),
          duration,
          sourceDuration,
          ...(trimStart > 0 ? { trimStart } : {}),
          volume: clamp(clip.volume, 0, 1, 1),
          ...(clip.loop ? { loop: true } : {}),
          ...(clip.fadeIn ? { fadeIn: clamp(clip.fadeIn, 0, duration, 0) } : {}),
          ...(clip.fadeOut ? { fadeOut: clamp(clip.fadeOut, 0, duration, 0) } : {}),
        };
      }).filter((clip) => Boolean(clip.src || clip.assetId || clip.cloudSrc)),
    };
  });
  const sceneKind = preset.sceneKind === "intro" || preset.sceneKind === "main" || preset.sceneKind === "result" || preset.sceneKind === "transition" ? preset.sceneKind : fallbackKind;
  return {
    version: 1,
    id: String(preset.id || "audio-preset"),
    name: String(preset.name || "Preset de áudio").trim().slice(0, 50) || "Preset de áudio",
    sceneKind,
    masterVolume: clamp(preset.masterVolume, 0, 1, 1),
    tracks,
  };
}

export function createSceneAudioPreset(id: string, name: string, sceneKind: SceneKind): SceneAudioPreset {
  return normalizeAudioPreset({ id, name, sceneKind, masterVolume: 1, tracks: [] }, sceneKind);
}

export function renameAudioPreset(preset: SceneAudioPreset, name: string): SceneAudioPreset {
  return { ...cloneAudioPreset(preset), name: String(name).trim().slice(0, 50) || preset.name };
}

export function updateAudioClip(preset: SceneAudioPreset, clipId: string, patch: Partial<SceneAudioClip>): SceneAudioPreset {
  return normalizeAudioPreset({ ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch, id: clip.id, src: clip.src } : clip) })) }, preset.sceneKind);
}

export function removeAudioClip(preset: SceneAudioPreset, clipId: string): SceneAudioPreset {
  return { ...cloneAudioPreset(preset), tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== clipId).map(cloneAudioClip) })) };
}

export type SplitAudioClipResult =
  | { ok: true; preset: SceneAudioPreset; leftId: string; rightId: string }
  | { ok: false; message: string };

export function splitAudioClip(preset: SceneAudioPreset, clipId: string, playhead: number, rightId: string, sceneDuration = 3600): SplitAudioClipResult {
  const clip = preset.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return { ok: false, message: "Efeito de áudio não encontrado." };
  if (clip.loop) return { ok: false, message: "Desative a repetição antes de dividir este efeito." };
  const offset = playhead - clampAudioStart(clip.start, sceneDuration);
  if (!Number.isFinite(offset) || offset < .05 || offset > clip.duration - .05) return { ok: false, message: "Posicione o marcador dentro do efeito para dividir." };
  if (offset < (clip.fadeIn ?? 0) || clip.duration - offset < (clip.fadeOut ?? 0)) return { ok: false, message: "Mova o marcador para fora da transição de volume antes de dividir." };
  const baseName = clip.name.slice(0, 52);
  const left: SceneAudioClip = { ...clip, name: `${baseName} · 1`, duration: offset, fadeOut: undefined };
  const right: SceneAudioClip = { ...clip, id: rightId, name: `${baseName} · 2`, start: playhead, trimStart: (clip.trimStart ?? 0) + offset, duration: clip.duration - offset, fadeIn: undefined };
  const next = normalizeAudioPreset({ ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.flatMap((item) => item.id === clipId ? [left, right] : [item]) })) }, preset.sceneKind);
  return { ok: true, preset: next, leftId: clip.id, rightId };
}

export function addAudioClip(preset: SceneAudioPreset, trackIndex: number, clip: SceneAudioClip): SceneAudioPreset {
  const safeTrack = Math.max(0, Math.min(2, Math.floor(trackIndex)));
  return normalizeAudioPreset({ ...preset, tracks: preset.tracks.map((track, index) => ({ ...track, clips: index === safeTrack ? [...track.clips, clip] : track.clips })) }, preset.sceneKind);
}

export function assignAudioPreset(scenes: FormaScene[], sceneId: string, presetId: string | undefined, applyToKind = false): FormaScene[] {
  const selected = scenes.find((scene) => scene.id === sceneId);
  if (!selected) return scenes.map((scene) => ({ ...scene }));
  const kind = selected.kind ?? "main";
  return scenes.map((scene) => ((applyToKind && (scene.kind ?? "main") === kind) || scene.id === sceneId) ? { ...scene, ...(presetId ? { audioPresetId: presetId } : { audioPresetId: undefined }) } : { ...scene });
}

export function presetClips(preset?: SceneAudioPreset | null) {
  return preset ? preset.tracks.flatMap((track) => track.clips) : [];
}
