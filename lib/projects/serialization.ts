import type { AudioPresetBindings, CanvasPreset, FormaProject, FormaScene, ProjectAudioPreset, ProjectSoundtrack, SavedProject, SceneAudioPreset, SceneStingerSettings, Shape } from "../../app/types.ts";
import { cloneShapes } from "../geometry.ts";
import { cloneAudioPreset, packAudioLibrary, unpackAudioLibrary } from "../audio/scenes.ts";
import { cloneProjectAudioPreset, normalizeProjectAudioPreset } from "../audio/project.ts";
import { normalizeSceneStingerSettings } from "../audio/stingers.ts";

export type ProjectPayloadInput = {
  currentProjectId: string | null;
  name: string;
  animationDuration: number;
  shapes: Shape[];
  background: string;
  backgroundVideo?: string;
  format: CanvasPreset;
  savedProjects: SavedProject[];
  scenes?: FormaScene[];
  activeSceneId?: string | null;
  audioPresets?: SceneAudioPreset[];
  audioBindings?: AudioPresetBindings;
  sceneStingers?: SceneStingerSettings;
  projectSoundtrack?: ProjectSoundtrack;
  projectAudioPresets?: ProjectAudioPreset[];
  activeProjectAudioPresetId?: string;
};

function cloneScene(scene: FormaScene): FormaScene {
  return { ...scene, ...(scene.transition ? { transition: { ...scene.transition } } : {}), document: { ...scene.document, shapes: cloneShapes(scene.document.shapes) } };
}

export function buildFormaProject(input: ProjectPayloadInput, deps: { now: () => string; makeId: () => string }): FormaProject {
  const now = deps.now();
  const existing = input.savedProjects.find((project) => project.id === input.currentProjectId);
  const document = { shapes: cloneShapes(input.shapes), background: input.background, ...(input.backgroundVideo ? { backgroundVideo: input.backgroundVideo } : {}), format: input.format };
  return {
    schema: "forma-project/1.0",
    id: input.currentProjectId ?? deps.makeId(),
    name: input.name.trim() || "Projeto sem título",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    animationDuration: input.animationDuration,
    document,
    ...(input.scenes?.length ? { scenes: input.scenes.map(cloneScene) } : {}),
    ...(input.activeSceneId ? { activeSceneId: input.activeSceneId } : {}),
    ...(input.audioPresets?.length ? { audioPresets: input.audioPresets.map(cloneAudioPreset) } : {}),
    ...(input.audioBindings && Object.keys(input.audioBindings).length ? { audioBindings: { ...input.audioBindings } } : {}),
    ...(input.sceneStingers ? { sceneStingers: normalizeSceneStingerSettings(input.sceneStingers) } : {}),
    ...(input.projectSoundtrack ? { projectSoundtrack: { ...input.projectSoundtrack } } : {}),
    ...(input.projectAudioPresets?.length ? { projectAudioPresets: input.projectAudioPresets.map(cloneProjectAudioPreset) } : {}),
    ...(input.activeProjectAudioPresetId ? { activeProjectAudioPresetId: input.activeProjectAudioPresetId } : {}),
  };
}

export function toSavedProject(project: FormaProject): SavedProject {
  const audio = packAudioLibrary(project.audioPresets ?? [], project.audioAssets);
  return { id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt, animationDuration: project.animationDuration, document: project.document, ...(project.scenes?.length ? { scenes: project.scenes.map(cloneScene) } : {}), ...(project.activeSceneId ? { activeSceneId: project.activeSceneId } : {}), ...(audio.presets.length ? { audioPresets: audio.presets, audioAssets: audio.assets } : {}), ...(project.audioBindings && Object.keys(project.audioBindings).length ? { audioBindings: { ...project.audioBindings } } : {}), ...(project.sceneStingers ? { sceneStingers: normalizeSceneStingerSettings(project.sceneStingers) } : {}), ...(project.projectSoundtrack ? { projectSoundtrack: { ...project.projectSoundtrack } } : {}), ...(project.projectAudioPresets?.length ? { projectAudioPresets: project.projectAudioPresets.map(cloneProjectAudioPreset) } : {}), ...(project.activeProjectAudioPresetId ? { activeProjectAudioPresetId: project.activeProjectAudioPresetId } : {}) };
}

export function serializeProject(project: FormaProject) {
  const audio = packAudioLibrary(project.audioPresets ?? [], project.audioAssets);
  return JSON.stringify({ ...project, ...(audio.presets.length ? { audioPresets: audio.presets, audioAssets: audio.assets } : { audioPresets: undefined, audioAssets: undefined }) }, null, 2);
}

export function parseFormaProject(text: string): FormaProject {
  const project = JSON.parse(text) as FormaProject;
  if (project.schema !== "forma-project/1.0" || !project.document) throw new Error("Projeto incompatível.");
  return { ...project, ...(Array.isArray(project.audioPresets) ? { audioPresets: unpackAudioLibrary(project.audioPresets, project.audioAssets) } : {}), ...(project.sceneStingers ? { sceneStingers: normalizeSceneStingerSettings(project.sceneStingers) } : {}), ...(Array.isArray(project.projectAudioPresets) ? { projectAudioPresets: project.projectAudioPresets.map(normalizeProjectAudioPreset) } : {}) };
}
