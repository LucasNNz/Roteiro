import type { FormaScene } from "../../app/types.ts";
import { backgroundPresetBySource } from "../background-presets.ts";
import { backgroundMetadataForPreset } from "../batch/backgrounds.ts";
import { cloneScene } from "./collection.ts";

export function linkedResultForQuestion(scenes: FormaScene[], question: FormaScene) {
  if (question.sceneRole !== "question" || !Number.isFinite(question.questionIndex)) return null;
  return scenes.find((scene) => scene.sceneRole === "result" && scene.linkedQuestionId === question.questionIndex) ?? null;
}

export function applyLinkedBackgroundPreset(
  scenes: FormaScene[],
  questionSceneId: string,
  source: string,
  fallbackColor: string,
  syncLinkedResult = true,
): FormaScene[] {
  const question = scenes.find((scene) => scene.id === questionSceneId);
  if (!question) return scenes.map(cloneScene);
  const linkedResult = syncLinkedResult ? linkedResultForQuestion(scenes, question) : null;
  const preset = backgroundPresetBySource(source);
  const metadata = preset ? backgroundMetadataForPreset(preset) : {};
  return scenes.map((scene) => {
    if (scene.id !== question.id && scene.id !== linkedResult?.id) return cloneScene(scene);
    return cloneScene({
      ...scene,
      ...metadata,
      document: { ...scene.document, background: fallbackColor, backgroundVideo: source },
    });
  });
}
