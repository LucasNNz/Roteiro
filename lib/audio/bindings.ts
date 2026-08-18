import type { AudioBindingTarget, AudioPresetBindings, FormaScene } from "../../app/types.ts";
import { sceneKind } from "../scenes/collection.ts";
import { INTRO_PRESET_ID } from "../scenes/intro-preset.ts";

export function sceneAudioBindingTarget(scene: FormaScene): AudioBindingTarget | null {
  const kind = sceneKind(scene);
  if (kind === "intro") return `intro:${INTRO_PRESET_ID}`;
  if (kind === "transition") return `transition:${scene.transition?.presetId || "blank"}`;
  const ids = new Set(scene.document.shapes.map((shape) => shape.id));
  if (kind === "result") {
    if (ids.has("preset-guess-logo-result")) return "guess_logo_result_5s";
    if (ids.has("preset-emoji-quiz-result")) return "emoji_quiz_result_5s";
    if (ids.has("preset-guess-movie-result")) return "guess_movie_result_5s";
    if (ids.has("preset-mvp-find-thief-result-correct")) return "game_find_thief_correct_5s";
    if (ids.has("preset-mvp-find-thief-result-wrong")) return "game_find_thief_wrong_5s";
    if (ids.has("preset-mvp-chase-result-correct")) return "game_chase_correct_5s";
    if (ids.has("preset-mvp-chase-result-wrong")) return "game_chase_wrong_5s";
    return scene.document.shapes.some((shape) => shape.id.startsWith("quiz-vf-result-") || shape.id.startsWith("result-true-") || shape.id.startsWith("result-false-"))
      ? "true_false_result" : "quiz_result";
  }
  if (ids.has("preset-guess-logo")) return "guess_logo_8s";
  if (ids.has("preset-emoji-quiz")) return "emoji_quiz_8s";
  if (ids.has("preset-guess-movie")) return "guess_movie_8s";
  if (ids.has("preset-would-you-rather")) return "would_you_rather_8s";
  if (ids.has("preset-mvp-find-thief-ab")) return "game_find_thief_ab_8s";
  if (ids.has("preset-mvp-chase-lr")) return "game_chase_lr_8s";
  if (ids.has("answer-true-text") || ids.has("answer-false-text")) return "true_false_8s";
  if (ids.has("answer-c-text")) return "quiz_3_options_8s";
  return null;
}

export function applyAudioBindings(scenes: FormaScene[], bindings: AudioPresetBindings): FormaScene[] {
  return scenes.map((scene) => {
    const target = sceneAudioBindingTarget(scene);
    const presetId = target ? bindings[target] : undefined;
    return presetId && scene.audioPresetId !== presetId ? { ...scene, audioPresetId: presetId } : scene;
  });
}

export function setAudioBinding(scenes: FormaScene[], bindings: AudioPresetBindings, target: AudioBindingTarget, presetId?: string) {
  const previousPresetId = bindings[target];
  const nextBindings = { ...bindings, [target]: presetId || undefined };
  const nextScenes = scenes.map((scene) => {
    if (sceneAudioBindingTarget(scene) !== target) return scene;
    if (presetId) return { ...scene, audioPresetId: presetId };
    return scene.audioPresetId === previousPresetId ? { ...scene, audioPresetId: undefined } : scene;
  });
  return { bindings: nextBindings, scenes: nextScenes };
}

export function removeAudioPresetBindings(bindings: AudioPresetBindings, presetId: string): AudioPresetBindings {
  return Object.fromEntries(Object.entries(bindings).filter(([, id]) => id !== presetId)) as AudioPresetBindings;
}
