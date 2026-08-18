import type { FormaScene, ProjectAudioPreset, ProjectSoundtrack, SceneAudioClip, SceneAudioPreset, SceneAudioTrack } from "../../app/types.ts";
import { AUDIO_END_GUARD, audioClipEnvelope, cloneAudioPreset } from "./scenes.ts";
import { sceneKind } from "../scenes/collection.ts";

export const PROJECT_AUDIO_TRACKS = ["Música 1", "Música 2"] as const;

export const BUILTIN_MAIN_AUDIO_PRESET_ID = "corvoquiz-faixa-principal-v1";
export const BUILTIN_MAIN_AUDIO_SOURCE = "/audio/faixa-principal.mp3";
export const BUILTIN_MAIN_AUDIO_DURATION = 2664.333042;

export function createBundledMainAudioPreset(): ProjectAudioPreset {
  return normalizeProjectAudioPreset({
    id: BUILTIN_MAIN_AUDIO_PRESET_ID,
    name: "Faixa principal",
    masterVolume: 1,
    tracks: [
      {
        id: "project-audio-track-1",
        name: "Música 1",
        clips: [{
          id: "corvoquiz-faixa-principal-clip-v1",
          name: "Faixa principal",
          src: BUILTIN_MAIN_AUDIO_SOURCE,
          mime: "audio/mpeg",
          start: 0,
          duration: BUILTIN_MAIN_AUDIO_DURATION,
          sourceDuration: BUILTIN_MAIN_AUDIO_DURATION,
          sourceBytes: 63944043,
          volume: 1,
          fadeIn: 1.25,
          fadeOut: 2,
        }],
      },
      { id: "project-audio-track-2", name: "Música 2", clips: [] },
    ],
  });
}

export function ensureBundledMainAudioPreset(presets: ProjectAudioPreset[]) {
  const normalized = presets.map(normalizeProjectAudioPreset);
  return normalized.some((preset) => preset.id === BUILTIN_MAIN_AUDIO_PRESET_ID)
    ? normalized
    : [...normalized, createBundledMainAudioPreset()];
}
export const PROJECT_AUDIO_AUTO_END_FADE = 2;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

const cloneClip = (clip: SceneAudioClip): SceneAudioClip => ({ ...clip });
export const cloneProjectAudioPreset = (preset: ProjectAudioPreset): ProjectAudioPreset => ({ ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.map(cloneClip) })) as [SceneAudioTrack, SceneAudioTrack] });

export function projectDuration(scenes: FormaScene[]) {
  return Math.max(.05, scenes.reduce((total, scene) => total + Math.max(0, Number(scene.animationDuration) || 0), 0));
}

export function projectSceneOffset(scenes: FormaScene[], activeSceneId?: string | null) {
  let offset = 0;
  for (const scene of scenes) {
    if (scene.id === activeSceneId) return offset;
    offset += Math.max(0, Number(scene.animationDuration) || 0);
  }
  return 0;
}

/** O Áudio Principal começa após a(s) cena(s) de Entrada no início do projeto. */
export function projectMainAudioStartOffset(scenes: FormaScene[]) {
  let offset = 0;
  for (const scene of scenes) {
    if (sceneKind(scene) !== "intro") break;
    offset += Math.max(0, Number(scene.animationDuration) || 0);
  }
  return offset;
}

export function projectMainAudioDuration(scenes: FormaScene[]) {
  return Math.max(0, projectDuration(scenes) - projectMainAudioStartOffset(scenes));
}

export function projectMainAudioSceneOffset(scenes: FormaScene[], activeSceneId?: string | null) {
  return projectSceneOffset(scenes, activeSceneId) - projectMainAudioStartOffset(scenes);
}

export function projectAudioPresetDuration(preset?: ProjectAudioPreset | null) {
  if (!preset) return 0;
  return preset.tracks.reduce((maximum, track) => track.clips.reduce((trackMaximum, clip) => Math.max(trackMaximum, Math.max(0, clip.start) + Math.max(.05, clip.duration)), maximum), 0);
}

/**
 * Ajusta uma instância do preset à duração atual do vídeo sem alterar o preset salvo.
 *
 * - vídeo menor: corta somente o trecho que ultrapassa o final e reposiciona o
 *   fade-out no novo fim (usa 2s quando o clipe ainda não tinha fade de saída);
 * - vídeo maior: não estica, não repete e não cria música artificialmente; a
 *   sobra permanece vazia para o usuário adicionar outra música;
 * - `loop` continua sendo respeitado apenas quando foi ativado manualmente.
 */
export function fitProjectAudioPresetToDuration(preset: ProjectAudioPreset, totalDuration: number) {
  const projectEnd = Math.max(.05, Number(totalDuration) || .05);
  const tracks = preset.tracks.map((track) => ({
    ...track,
    clips: track.clips.flatMap((clip) => {
      const start = Math.max(0, clip.start);
      if (start >= projectEnd - .001) return [];
      const remaining = Math.max(.05, projectEnd - start);
      if (clip.loop || clip.duration <= remaining + .001) return [{ ...clip }];
      const duration = Math.min(clip.duration, remaining);
      const fadeOut = Math.min(duration, Math.max(.05, clip.fadeOut ?? PROJECT_AUDIO_AUTO_END_FADE));
      return [{ ...clip, duration, fadeOut }];
    }),
  })) as [SceneAudioTrack, SceneAudioTrack];
  return { ...cloneProjectAudioPreset(preset), tracks };
}

export function normalizeProjectAudioPreset(preset?: Partial<ProjectAudioPreset> | null): ProjectAudioPreset {
  const sourceTracks = Array.isArray(preset?.tracks) ? preset.tracks : [];
  const tracks = PROJECT_AUDIO_TRACKS.map((name, trackIndex) => {
    const source = sourceTracks[trackIndex];
    return {
      id: String(source?.id || `project-audio-track-${trackIndex + 1}`),
      name,
      clips: (Array.isArray(source?.clips) ? source.clips : []).map((clip, clipIndex) => {
        const rawSourceDuration = Number(clip.sourceDuration ?? clip.duration);
        const sourceDuration = Number.isFinite(rawSourceDuration) && rawSourceDuration >= .05 ? rawSourceDuration : 1;
        const trimStart = clamp(clip.trimStart, 0, Math.max(0, sourceDuration - .05), 0);
        const duration = clamp(clip.duration, .05, Math.max(.05, sourceDuration - trimStart), sourceDuration - trimStart);
        const rawStart = Number(clip.start);
        const start = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0;
        const rawBytes = Number(clip.sourceBytes);
        return {
          id: String(clip.id || `project-audio-clip-${trackIndex + 1}-${clipIndex + 1}`), name: String(clip.name || `Música ${clipIndex + 1}`).trim().slice(0, 80) || `Música ${clipIndex + 1}`,
          src: String(clip.src || ""), ...(clip.assetId ? { assetId: String(clip.assetId) } : {}), ...(clip.cloudSrc ? { cloudSrc: String(clip.cloudSrc) } : {}), mime: String(clip.mime || "audio/mpeg"), start, duration, sourceDuration,
          ...(Number.isFinite(rawBytes) && rawBytes > 0 ? { sourceBytes: rawBytes } : {}),
          ...(trimStart > 0 ? { trimStart } : {}), volume: clamp(clip.volume, 0, 1, 1), ...(clip.loop ? { loop: true } : {}),
          ...(clip.fadeIn ? { fadeIn: clamp(clip.fadeIn, 0, duration, 0) } : {}), ...(clip.fadeOut ? { fadeOut: clamp(clip.fadeOut, 0, duration, 0) } : {}),
        };
      }).filter((clip) => Boolean(clip.src || clip.assetId || clip.cloudSrc)),
    };
  }) as [SceneAudioTrack, SceneAudioTrack];
  return { version: 1, id: String(preset?.id || "project-audio-preset"), name: String(preset?.name || "Áudio principal").trim().slice(0, 60) || "Áudio principal", masterVolume: clamp(preset?.masterVolume, 0, 1, 1), tracks };
}

export function createProjectAudioPreset(id: string, name = "Áudio principal") {
  return normalizeProjectAudioPreset({ id, name, masterVolume: 1, tracks: [] as unknown as [SceneAudioTrack, SceneAudioTrack] });
}

export function renameProjectAudioPreset(preset: ProjectAudioPreset, name: string) {
  return { ...cloneProjectAudioPreset(preset), name: String(name).trim().slice(0, 60) || preset.name };
}

export function addProjectAudioClip(preset: ProjectAudioPreset, trackIndex: number, clip: SceneAudioClip) {
  const safeTrack = Math.max(0, Math.min(1, trackIndex));
  return normalizeProjectAudioPreset({ ...preset, tracks: preset.tracks.map((track, index) => ({ ...track, clips: index === safeTrack ? [...track.clips, clip] : track.clips })) as [SceneAudioTrack, SceneAudioTrack] });
}

export function updateProjectAudioClip(preset: ProjectAudioPreset, clipId: string, patch: Partial<SceneAudioClip>) {
  return normalizeProjectAudioPreset({ ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch, id: clip.id, src: clip.src } : clip) })) as [SceneAudioTrack, SceneAudioTrack] });
}

export function removeProjectAudioClip(preset: ProjectAudioPreset, clipId: string) {
  return { ...cloneProjectAudioPreset(preset), tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== clipId) })) as [SceneAudioTrack, SceneAudioTrack] };
}

export function splitProjectAudioClip(preset: ProjectAudioPreset, clipId: string, playhead: number, rightId: string, duration: number) {
  const clip = preset.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
  if (!clip) return { ok: false as const, message: "Música não encontrada." };
  const offset = playhead - clip.start;
  if (clip.loop || offset <= AUDIO_END_GUARD || offset >= clip.duration - AUDIO_END_GUARD) return { ok: false as const, message: "Posicione o marcador dentro da música e desative Repetir." };
  if (offset < (clip.fadeIn ?? 0) || clip.duration - offset < (clip.fadeOut ?? 0)) return { ok: false as const, message: "Mova o marcador para fora da transição de volume." };
  const baseName = clip.name.replace(/ · [12]$/, "");
  const left: SceneAudioClip = { ...clip, name: `${baseName} · 1`, duration: offset, fadeOut: undefined };
  const right: SceneAudioClip = { ...clip, id: rightId, name: `${baseName} · 2`, start: playhead, trimStart: (clip.trimStart ?? 0) + offset, duration: clip.duration - offset, fadeIn: undefined };
  return { ok: true as const, preset: normalizeProjectAudioPreset({ ...preset, tracks: preset.tracks.map((track) => ({ ...track, clips: track.clips.flatMap((item) => item.id === clipId ? [left, right] : [item]) })) as [SceneAudioTrack, SceneAudioTrack] }), leftId: clip.id, rightId };
}

export function migrateProjectSoundtrack(soundtrack?: ProjectSoundtrack | null, id = "project-audio-migrated") {
  if (!soundtrack?.src) return null;
  const preset = createProjectAudioPreset(id, soundtrack.name || "Áudio principal");
  return addProjectAudioClip(preset, 0, { id: `${id}-clip`, name: soundtrack.name || "Música", src: soundtrack.src, mime: soundtrack.mime || "audio/mpeg", start: 0, duration: Math.max(.05, soundtrack.duration || .05), sourceDuration: Math.max(.05, soundtrack.duration || .05), volume: clamp(soundtrack.volume, 0, 1, .55), loop: true });
}

function mapProjectClip(clip: SceneAudioClip, sceneOffset: number, sceneDuration: number, totalDuration: number): SceneAudioClip | null {
  const sceneEnd = sceneOffset + sceneDuration;
  const naturalClipEnd = clip.loop ? totalDuration : clip.start + clip.duration;
  const clipEnd = Math.min(totalDuration, naturalClipEnd);
  if (clip.start >= sceneEnd || clipEnd <= sceneOffset) return null;
  const elapsedBeforeScene = Math.max(0, sceneOffset - clip.start);
  const localStart = Math.max(0, clip.start - sceneOffset);
  const audibleDuration = Math.max(.05, Math.min(sceneDuration - localStart, clip.loop ? totalDuration - Math.max(sceneOffset, clip.start) : clip.duration - elapsedBeforeScene));
  const sourceDuration = Math.max(.05, clip.sourceDuration ?? clip.duration);
  const playableDuration = Math.max(.05, sourceDuration - (clip.trimStart ?? 0));
  const timelineOffset = (clip.trimStart ?? 0) + (clip.loop ? elapsedBeforeScene % playableDuration : elapsedBeforeScene);
  return { ...clip, start: localStart, duration: audibleDuration, sourceDuration, timelineOffset, fadeIn: elapsedBeforeScene < (clip.fadeIn ?? 0) ? (clip.fadeIn ?? 0) - elapsedBeforeScene : undefined, fadeOut: clipEnd <= sceneEnd ? clip.fadeOut : undefined };
}

export function projectExportAudioPreset(scenePreset: SceneAudioPreset | null | undefined, projectPreset: ProjectAudioPreset | null | undefined, sceneOffset: number, sceneDuration: number, totalDuration = sceneOffset + sceneDuration): SceneAudioPreset | null {
  const scene = scenePreset ? cloneAudioPreset(scenePreset) : null;
  const fittedProjectPreset = projectPreset ? fitProjectAudioPresetToDuration(projectPreset, totalDuration) : null;
  const projectTracks = fittedProjectPreset?.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => mapProjectClip(clip, sceneOffset, sceneDuration, totalDuration)).filter((clip): clip is SceneAudioClip => Boolean(clip)).map((clip) => ({ ...clip, volume: clip.volume * fittedProjectPreset.masterVolume })) })) ?? [];
  const sceneTracks = scene?.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, volume: clip.volume * (scene?.masterVolume ?? 1) })) })) ?? [];
  if (!projectTracks.some((track) => track.clips.length) && !sceneTracks.some((track) => track.clips.length)) return null;
  return { version: 1, id: "project-export-audio", name: "Áudio do projeto", sceneKind: scene?.sceneKind ?? "main", masterVolume: 1, tracks: [...projectTracks, ...sceneTracks] };
}

export function projectFullExportAudioPreset(scenes: FormaScene[], audioPresets: SceneAudioPreset[], projectPreset?: ProjectAudioPreset | null): SceneAudioPreset | null {
  const presetsById = new Map(audioPresets.map((preset) => [preset.id, preset]));
  const totalDuration = projectDuration(scenes);
  const mainAudioStart = projectMainAudioStartOffset(scenes);
  const mainAudioDuration = Math.max(0, totalDuration - mainAudioStart);
  const fittedProjectPreset = projectPreset && mainAudioDuration > .001 ? fitProjectAudioPresetToDuration(projectPreset, mainAudioDuration) : null;
  const projectTracks = fittedProjectPreset?.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({ ...clip, start: mainAudioStart + clip.start, volume: clip.volume * fittedProjectPreset.masterVolume })),
  })) ?? [];
  let offset = 0;
  const sceneTracks: SceneAudioTrack[] = [];
  for (const scene of scenes) {
    const preset = scene.audioPresetId ? presetsById.get(scene.audioPresetId) : undefined;
    // Um vinculo antigo ou trocado nao pode transportar o som de outro tipo
    // de cena para dentro de uma transicao ou resultado.
    if (preset && preset.sceneKind === sceneKind(scene)) {
      for (const track of preset.tracks) {
        sceneTracks.push({
          id: `project-${scene.id}-${track.id}`,
          name: `${scene.name} · ${track.name}`,
          clips: track.clips.map((clip) => ({
            ...clip,
            id: `project-${scene.id}-${clip.id}`,
            start: offset + clip.start,
            end: offset + scene.animationDuration,
            volume: clip.volume * preset.masterVolume,
          })),
        });
      }
    }
    offset += Math.max(0, scene.animationDuration);
  }
  if (!projectTracks.some((track) => track.clips.length) && !sceneTracks.some((track) => track.clips.length)) return null;
  return { version: 1, id: "project-full-export-audio", name: "Áudio completo do projeto", sceneKind: "main", masterVolume: 1, tracks: [...projectTracks, ...sceneTracks] };
}

export function projectAudioEnvelope(clip: SceneAudioClip, globalTime: number, totalDuration: number) {
  const elapsed = globalTime - clip.start;
  const available = Math.max(0, totalDuration - clip.start);
  const clipDuration = clip.loop ? available : Math.min(clip.duration, available);
  const effectiveClip = !clip.loop && clip.duration > available + .001
    ? { ...clip, fadeOut: Math.min(clipDuration, Math.max(.05, clip.fadeOut ?? PROJECT_AUDIO_AUTO_END_FADE)) }
    : clip;
  return elapsed >= 0 && elapsed < clipDuration ? audioClipEnvelope(effectiveClip, elapsed, clipDuration) : 0;
}
