import type { CanvasPreset, FormaScene, SceneKind, Shape, Snapshot, TransitionSpec } from "../../app/types.ts";
import { cloneShapes } from "../geometry.ts";
import { transitionPresetShapes, upgradeTransitionPresetShapes } from "./transition-presets.ts";

export type SceneDocumentInput = {
  shapes: Shape[];
  background: string;
  backgroundVideo?: string;
  format: CanvasPreset;
  animationDuration: number;
};

export const DEFAULT_TRANSITION_SPEC: TransitionSpec = { version: 1, freezePrevious: 1, preRollNext: 1, nextRetiming: "stretch", backgroundMode: "transparent", presetId: "blank" };

function kindFromShapes(shapes: Shape[]): Exclude<SceneKind, "transition"> {
  return shapes.some((shape) => shape.id.startsWith("quiz-result-") || shape.id.startsWith("quiz-vf-result-") || shape.id.startsWith("result-") || shape.groupId?.includes("result") || Boolean(shape.quizResultBase)) ? "result" : "main";
}

export function sceneKind(scene: FormaScene): SceneKind {
  if (scene.kind === "intro" || scene.kind === "main" || scene.kind === "result" || scene.kind === "transition") return scene.kind;
  return kindFromShapes(scene.document.shapes);
}

export function cloneScene(scene: FormaScene): FormaScene {
  const kind = sceneKind(scene);
  const transition = kind === "transition" ? normalizeTransitionSpec(scene.transition) : undefined;
  const clonedShapes = cloneShapes(scene.document.shapes);
  const shapes = transition ? upgradeTransitionPresetShapes(clonedShapes, scene.document.format ?? "square", transition.presetId) : clonedShapes;
  return { ...scene, kind, ...(transition ? { transition } : {}), ...(scene.audioPresetId ? { audioPresetId: scene.audioPresetId } : {}), document: { ...scene.document, shapes } };
}

export function sceneFromDocument(id: string, name: string, input: SceneDocumentInput, kind: SceneKind = kindFromShapes(input.shapes)): FormaScene {
  return {
    id,
    name,
    kind,
    animationDuration: input.animationDuration,
    document: { shapes: cloneShapes(input.shapes), background: input.background, backgroundVideo: input.backgroundVideo, format: input.format },
  };
}

export function syncActiveScene(scenes: FormaScene[], activeSceneId: string | null, input: SceneDocumentInput): FormaScene[] {
  if (!activeSceneId) return scenes.map(cloneScene);
  return scenes.map((scene) => {
    if (scene.id !== activeSceneId) return cloneScene(scene);
    const next = { ...scene, ...sceneFromDocument(scene.id, scene.name, input, sceneKind(scene)), ...(scene.audioPresetId ? { audioPresetId: scene.audioPresetId } : {}) };
    return sceneKind(scene) === "transition" ? { ...next, transition: normalizeTransitionSpec(scene.transition) } : next;
  });
}

export function createBlankScene(id: string, name: string, source: Pick<SceneDocumentInput, "background" | "backgroundVideo" | "format">, duration = 8): FormaScene {
  return sceneFromDocument(id, name, { ...source, shapes: [], animationDuration: duration }, "main");
}

export function normalizeTransitionSpec(spec?: Partial<TransitionSpec>): TransitionSpec {
  const freezePrevious = Math.max(.1, Math.min(5, Number(spec?.freezePrevious) || DEFAULT_TRANSITION_SPEC.freezePrevious));
  const preRollNext = Math.max(.1, Math.min(5, Number(spec?.preRollNext) || DEFAULT_TRANSITION_SPEC.preRollNext));
  return { ...DEFAULT_TRANSITION_SPEC, ...spec, version: 1, freezePrevious, preRollNext, nextRetiming: "stretch", backgroundMode: "transparent" };
}

export function createTransitionScene(id: string, name: string, format: CanvasPreset, spec?: Partial<TransitionSpec>): FormaScene {
  const transition = normalizeTransitionSpec({ presetId: "brush-lightning", ...spec });
  return { id, name, kind: "transition", animationDuration: transition.freezePrevious + transition.preRollNext, transition, document: { shapes: transitionPresetShapes(transition.presetId, format), background: "transparent", format } };
}

export function resolveTransitionNeighbors(scenes: FormaScene[], transitionId: string) {
  const index = scenes.findIndex((scene) => scene.id === transitionId);
  const previous = index > 0 ? scenes[index - 1] : null;
  const next = index >= 0 && index < scenes.length - 1 ? scenes[index + 1] : null;
  if (index < 0 || sceneKind(scenes[index]) !== "transition") return { previous: null, next: null, valid: false, reason: "Cena de transição não encontrada." };
  if (!previous || !next) return { previous, next, valid: false, reason: "A transição precisa ficar entre duas cenas de conteúdo." };
  if (sceneKind(previous) === "transition" || sceneKind(next) === "transition") return { previous, next, valid: false, reason: "Não é permitido colocar duas transições consecutivas." };
  if ((previous.document.format ?? "square") !== (next.document.format ?? "square")) return { previous, next, valid: false, reason: "As cenas conectadas precisam usar o mesmo formato." };
  return { previous, next, valid: true as const };
}

export type EnsureTransitionResult = { ok: true; scenes: FormaScene[]; transition: FormaScene; created: boolean } | { ok: false; message: string };

export function ensureTransitionBetween(scenes: FormaScene[], afterSceneId: string, beforeSceneId: string, transition: FormaScene): EnsureTransitionResult {
  const afterIndex = scenes.findIndex((scene) => scene.id === afterSceneId);
  const beforeIndex = scenes.findIndex((scene) => scene.id === beforeSceneId);
  if (afterIndex < 0 || beforeIndex < 0) return { ok: false, message: "Cena anterior ou próxima não encontrada." };
  const after = scenes[afterIndex];
  const before = scenes[beforeIndex];
  if (sceneKind(after) === "transition" || sceneKind(before) === "transition") return { ok: false, message: "A transição precisa ficar entre duas cenas de conteúdo." };
  if ((after.document.format ?? "square") !== (before.document.format ?? "square")) return { ok: false, message: "As cenas conectadas precisam usar o mesmo formato." };
  if (beforeIndex === afterIndex + 2 && sceneKind(scenes[afterIndex + 1]) === "transition") return { ok: true, scenes: scenes.map(cloneScene), transition: cloneScene(scenes[afterIndex + 1]), created: false };
  if (beforeIndex !== afterIndex + 1) return { ok: false, message: "As cenas informadas não são vizinhas. Atualize o estado e tente novamente." };
  const next = scenes.map(cloneScene);
  next.splice(beforeIndex, 0, cloneScene(transition));
  return { ok: true, scenes: next, transition: cloneScene(transition), created: true };
}

export function resolveScene(scenes: FormaScene[], query: unknown): FormaScene | null {
  if (typeof query === "number" && Number.isFinite(query)) return scenes[Math.max(0, Math.floor(query) - 1)] ?? null;
  const value = String(query ?? "").trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return scenes[Math.max(0, Number(value) - 1)] ?? null;
  const normalized = value.toLocaleLowerCase("pt-BR");
  return scenes.find((scene) => scene.id === value || scene.name.toLocaleLowerCase("pt-BR") === normalized) ?? null;
}

export type RenameSceneResult = { ok: true; scenes: FormaScene[]; scene: FormaScene } | { ok: false; message: string };

export function renameScene(scenes: FormaScene[], query: unknown, requestedName: unknown): RenameSceneResult {
  const scene = resolveScene(scenes, query);
  if (!scene) return { ok: false, message: "Cena não encontrada. Use o nome, ID ou número da cena." };
  const name = String(requestedName ?? "").trim().slice(0, 40);
  if (!name) return { ok: false, message: "Informe um nome para a cena." };
  if (scenes.some((item) => item.id !== scene.id && item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) return { ok: false, message: "Já existe uma cena com esse nome." };
  const next = scenes.map((item) => cloneScene(item.id === scene.id ? { ...item, name } : item));
  return { ok: true, scenes: next, scene: cloneScene(next.find((item) => item.id === scene.id)!) };
}

export type DeleteSceneResult = { ok: true; scenes: FormaScene[]; selected: FormaScene; removed: FormaScene[] } | { ok: false; message: string };

export function deleteScene(scenes: FormaScene[], query: unknown, activeSceneId: string | null): DeleteSceneResult {
  const scene = resolveScene(scenes, query);
  if (!scene) return { ok: false, message: "Cena não encontrada. Use o nome, ID ou número da cena." };
  const targetIndex = scenes.findIndex((item) => item.id === scene.id);
  const contentScenes = scenes.filter((item) => sceneKind(item) !== "transition");
  if (sceneKind(scene) !== "transition" && contentScenes.length <= 1) return { ok: false, message: "O projeto precisa manter pelo menos uma cena de conteúdo." };
  const removedIds = new Set([scene.id]);
  if (sceneKind(scene) !== "transition") {
    const previous = scenes[targetIndex - 1];
    const next = scenes[targetIndex + 1];
    if (previous && sceneKind(previous) === "transition") removedIds.add(previous.id);
    if (next && sceneKind(next) === "transition") removedIds.add(next.id);
  }
  const nextScenes = scenes.filter((item) => !removedIds.has(item.id)).map(cloneScene);
  if (!nextScenes.length) return { ok: false, message: "O projeto precisa manter pelo menos uma cena." };
  const keepActive = activeSceneId ? nextScenes.find((item) => item.id === activeSceneId) ?? null : null;
  const after = scenes.slice(targetIndex + 1).find((item) => !removedIds.has(item.id));
  const before = [...scenes.slice(0, targetIndex)].reverse().find((item) => !removedIds.has(item.id));
  const selected = keepActive ?? (after ? nextScenes.find((item) => item.id === after.id) : null) ?? (before ? nextScenes.find((item) => item.id === before.id) : null) ?? nextScenes[0];
  return { ok: true, scenes: nextScenes, selected: cloneScene(selected), removed: scenes.filter((item) => removedIds.has(item.id)).map(cloneScene) };
}

export function resetSceneCollection(scenes: FormaScene[], replacement: FormaScene) {
  const selected = cloneScene(replacement);
  return {
    scenes: [cloneScene(selected)],
    selected,
    removed: scenes.map(cloneScene),
  };
}

export function sceneSnapshot(scene: FormaScene): Snapshot {
  return { ...scene.document, shapes: cloneShapes(scene.document.shapes) };
}
