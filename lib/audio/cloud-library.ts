import type { AudioPresetBindings, ProjectAudioPreset, SceneAudioPreset, SceneStingerSettings } from "../../app/types.ts";
import { normalizeProjectAudioPreset } from "./project.ts";
import { packAudioLibrary, unpackAudioLibrary, type PackedAudioLibrary } from "./scenes.ts";
import { normalizeSceneStingerSettings } from "./stingers.ts";

export type CloudAudioLibrary = {
  version: 1;
  updatedAt: string;
  sceneLibrary: PackedAudioLibrary;
  bindings: AudioPresetBindings;
  stingers: SceneStingerSettings;
  projectPresets: ProjectAudioPreset[];
  activeProjectPresetId?: string | null;
};

export type AudioLibraryState = {
  presets: SceneAudioPreset[];
  bindings: AudioPresetBindings;
  stingers: SceneStingerSettings;
  projectPresets: ProjectAudioPreset[];
  activeProjectPresetId?: string | null;
};

export type AudioLibrarySummary = {
  scenePresetCount: number;
  projectPresetCount: number;
  bindingCount: number;
  assetCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function createCloudAudioLibrary(state: AudioLibraryState, updatedAt = new Date().toISOString()): CloudAudioLibrary {
  return {
    version: 1,
    updatedAt,
    sceneLibrary: packAudioLibrary(state.presets),
    bindings: { ...state.bindings },
    stingers: normalizeSceneStingerSettings(state.stingers),
    projectPresets: state.projectPresets.map(normalizeProjectAudioPreset),
    activeProjectPresetId: state.activeProjectPresetId ?? null,
  };
}

export function audioLibrarySummary(library: CloudAudioLibrary): AudioLibrarySummary {
  return {
    scenePresetCount: library.sceneLibrary.presets.length,
    projectPresetCount: library.projectPresets.length,
    bindingCount: Object.values(library.bindings).filter((presetId) => typeof presetId === "string" && presetId.length > 0).length,
    assetCount: library.sceneLibrary.assets.length,
  };
}

export function formatAudioLibrarySummary(summary: Pick<AudioLibrarySummary, "scenePresetCount" | "projectPresetCount" | "bindingCount">) {
  const sceneLabel = summary.scenePresetCount === 1 ? "preset de cena" : "presets de cena";
  const projectLabel = summary.projectPresetCount === 1 ? "preset principal" : "presets principais";
  const bindingLabel = summary.bindingCount === 1 ? "associação" : "associações";
  return `${summary.scenePresetCount} ${sceneLabel}, ${summary.projectPresetCount} ${projectLabel} e ${summary.bindingCount} ${bindingLabel}`;
}

export function parseCloudAudioLibrary(value: unknown): CloudAudioLibrary | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== "string" || !isRecord(value.sceneLibrary)) return null;
  const sceneLibrary = value.sceneLibrary as unknown as PackedAudioLibrary;
  if (!Array.isArray(sceneLibrary.presets) || !Array.isArray(sceneLibrary.assets)) return null;
  const projectPresets = Array.isArray(value.projectPresets) ? value.projectPresets.map((preset) => normalizeProjectAudioPreset(preset as ProjectAudioPreset)) : [];
  return {
    version: 1,
    updatedAt: value.updatedAt,
    sceneLibrary,
    bindings: isRecord(value.bindings) ? value.bindings as AudioPresetBindings : {},
    stingers: normalizeSceneStingerSettings(value.stingers as SceneStingerSettings | undefined),
    projectPresets,
    ...((typeof value.activeProjectPresetId === "string" || value.activeProjectPresetId === null) ? { activeProjectPresetId: value.activeProjectPresetId as string | null } : {}),
  };
}

export function cloudAudioLibraryState(library: CloudAudioLibrary): AudioLibraryState {
  const presets = unpackAudioLibrary(library.sceneLibrary.presets, library.sceneLibrary.assets);
  const activeProjectPresetId = library.activeProjectPresetId === null
    ? null
    : library.projectPresets.some((preset) => preset.id === library.activeProjectPresetId)
      ? library.activeProjectPresetId ?? null
      : library.activeProjectPresetId === undefined
        ? library.projectPresets[0]?.id ?? null
        : null;
  return { presets, bindings: { ...library.bindings }, stingers: normalizeSceneStingerSettings(library.stingers), projectPresets: library.projectPresets.map(normalizeProjectAudioPreset), activeProjectPresetId };
}

export function audioLibraryHasContent(state: Pick<AudioLibraryState, "presets" | "projectPresets" | "bindings">) {
  return state.presets.length > 0 || state.projectPresets.length > 0 || Object.keys(state.bindings).length > 0;
}

function mergeById<T extends { id: string }>(remote: T[], local: T[]) {
  const merged = new Map(remote.map((item) => [item.id, item]));
  local.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

export function mergeAudioLibraryState(remote: AudioLibraryState, local: AudioLibraryState): AudioLibraryState {
  const presets = mergeById(remote.presets, local.presets);
  const projectPresets = mergeById(remote.projectPresets, local.projectPresets);
  const requestedActive = local.activeProjectPresetId === null ? null : local.activeProjectPresetId ?? remote.activeProjectPresetId ?? null;
  return {
    presets,
    projectPresets,
    bindings: { ...remote.bindings, ...local.bindings },
    stingers: local.stingers,
    activeProjectPresetId: requestedActive === null ? null : projectPresets.some((preset) => preset.id === requestedActive) ? requestedActive : null,
  };
}

export function mergeAudioLibraryByFreshness(remote: CloudAudioLibrary, local: AudioLibraryState, localUpdatedAt?: string | null): AudioLibraryState {
  const remoteState = cloudAudioLibraryState(remote);
  const remoteTime = Date.parse(remote.updatedAt);
  const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime)) return remoteState;
  if (Number.isFinite(localTime) && (!Number.isFinite(remoteTime) || localTime > remoteTime)) return local;
  // Mesmo carimbo: combina defensivamente para migrar bibliotecas antigas sem duplicar IDs.
  return mergeAudioLibraryState(remoteState, local);
}
