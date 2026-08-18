import type { AICommand, AudioPresetBindings, CanvasPreset, FormaProject, FormaScene, MotionKeyframe, Shape } from "../../app/types.ts";
import { applyAudioBindings } from "../audio/bindings.ts";
import { buildMainScenePreset, loadMainScenePreset, type MainScenePresetId } from "../ai/commands/main-scene-preset.ts";
import { buildQuizResult, QUIZ_RESULT_DURATION } from "../ai/commands/quiz-result.ts";
import { BINARY_RESULT_DURATION, buildBinaryQuizResult } from "../ai/commands/quiz-binary-result.ts";
import { createIntroScene } from "../scenes/intro-preset.ts";
import { createTransitionScene, sceneFromDocument } from "../scenes/collection.ts";
import type { BatchQuizPlan, BatchQuizQuestion } from "./parser.ts";
import { resolveBackgroundForQuestion } from "./backgrounds.ts";

export type BatchBuildResult = { scenes: FormaScene[]; activeScene: FormaScene };

type BuiltQuestion = { main: FormaScene; result?: FormaScene };

function presetFor(question: BatchQuizQuestion): MainScenePresetId {
  if (question.kind === "three_options") return "quiz_3_options_8s";
  if (question.kind === "true_false") return "true_false_8s";
  if (question.kind === "emoji_quiz") return "emoji_quiz_8s";
  if (question.kind === "find_thief") return "game_find_thief_ab_8s";
  if (question.kind === "chase_lr") return "game_chase_lr_8s";
  return "would_you_rather_8s";
}

function commandFor(question: BatchQuizQuestion, preset: MainScenePresetId, backgroundPreset: string): AICommand {
  const base: AICommand = {
    action: "apply_main_scene_preset",
    preset,
    preserveContent: false,
    question: question.question,
    questionNumber: String(question.number),
    backgroundPreset,
  };
  if (question.kind === "three_options") return { ...base, imageSrc: question.imageSrc, answers: { A: question.answers.A, B: question.answers.B, C: question.answers.C } };
  if (question.kind === "true_false") return { ...base, imageSrc: question.imageSrc, trueText: question.answers.A, falseText: question.answers.B };
  if (question.kind === "emoji_quiz") return { ...base, image1: question.image1Src, image2: question.image2Src };
  return { ...base, imageSrc: question.imageSrc, image1: question.image1Src, image2: question.image2Src, leftText: question.answers.A, rightText: question.answers.B };
}

function emojiResultCommand(question: BatchQuizQuestion, backgroundPreset: string): AICommand {
  return {
    action: "apply_main_scene_preset",
    preset: "emoji_quiz_result_5s",
    preserveContent: false,
    question: question.question,
    questionNumber: String(question.number),
    image1: question.image1Src,
    image2: question.image2Src,
    resultImage: question.resultImageSrc,
    resultText: question.resultText,
    backgroundPreset,
  };
}

function gameResultPreset(question: BatchQuizQuestion): MainScenePresetId {
  const correct = question.outcome !== "wrong";
  if (question.kind === "find_thief") return correct ? "game_find_thief_correct_5s" : "game_find_thief_wrong_5s";
  return correct ? "game_chase_correct_5s" : "game_chase_wrong_5s";
}

function gameResultText(question: BatchQuizQuestion) {
  if (question.resultText?.trim()) return question.resultText.trim();
  const letter = question.correct === "B" ? "B" : "A";
  const answer = question.answers[letter] || letter;
  return question.outcome === "wrong" ? `O CERTO ERA ${answer}` : `ACERTOU! ${answer}`;
}

function gameResultCommand(question: BatchQuizQuestion, preset: MainScenePresetId, backgroundPreset: string): AICommand {
  return {
    action: "apply_main_scene_preset",
    preset,
    preserveContent: false,
    questionNumber: String(question.number),
    imageSrc: question.imageSrc,
    image1: question.image1Src,
    image2: question.image2Src,
    leftText: question.answers.A,
    rightText: question.answers.B,
    resultText: gameResultText(question),
    backgroundPreset,
  };
}

function motionFrame(shape: Shape, time: number, values: Partial<MotionKeyframe> = {}): MotionKeyframe {
  return {
    time,
    x: values.x ?? shape.x,
    y: values.y ?? shape.y,
    w: values.w ?? shape.w,
    h: values.h ?? shape.h,
    rotation: values.rotation ?? shape.rotation,
    radius: values.radius ?? shape.radius,
    opacity: values.opacity ?? shape.opacity ?? 1,
    ...(values.easing ? { easing: values.easing } : {}),
  };
}

function scaled(shape: Shape, factor: number) {
  const w = shape.w * factor;
  const h = shape.h * factor;
  return { x: shape.x - (w - shape.w) / 2, y: shape.y - (h - shape.h) / 2, w, h };
}

function decorateFindThiefResult(shapes: Shape[], question: BatchQuizQuestion): Shape[] {
  const correctIndex = question.correct === "B" ? 2 : 1;
  const wrongIndex = correctIndex === 1 ? 2 : 1;
  const failed = question.outcome === "wrong";
  return shapes.map((shape) => {
    if (shape.id === `choice-${correctIndex}-card`) return { ...shape, fill: "#123D31", stroke: "#65F1BE", strokeWidth: 8, shadowColor: "#37E4A388", shadowBlur: 34 };
    if (shape.id === `text-${correctIndex}-pill`) return { ...shape, fill: "#19C982", stroke: "#BFFFE8", strokeWidth: 5 };
    if (shape.id === `choice-${wrongIndex}-card`) return failed
      ? { ...shape, fill: "#4A2028", stroke: "#FF7580", strokeWidth: 7, shadowColor: "#FF4D5E55", shadowBlur: 24 }
      : { ...shape, opacity: .48, saturation: 0 };
    if (shape.id === `text-${wrongIndex}-pill`) return failed ? { ...shape, fill: "#FF5B68", stroke: "#FFD1D5", strokeWidth: 5 } : { ...shape, opacity: .48, saturation: 0 };
    if (shape.id === `text-${wrongIndex}`) return { ...shape, opacity: failed ? .9 : .48 };
    if (shape.id === `image-${correctIndex}`) {
      const big = scaled(shape, 1.11);
      return { ...shape, keyframes: [motionFrame(shape, 0), motionFrame(shape, .85, { ...big, easing: "easeOutBack" }), motionFrame(shape, 5, { ...scaled(shape, 1.07), easing: "easeInOut" })] };
    }
    if (shape.id === `image-${wrongIndex}`) {
      const bump = scaled(shape, failed ? 1.05 : .96);
      return { ...shape, opacity: failed ? .78 : .42, saturation: failed ? .45 : 0, keyframes: [motionFrame(shape, 0), motionFrame(shape, .45, { ...bump, opacity: failed ? .92 : .55, easing: "easeOut" }), motionFrame(shape, 1.15, { opacity: failed ? .72 : .42, easing: "easeInOut" }), motionFrame(shape, 5, { opacity: failed ? .72 : .42 })] };
    }
    return shape;
  });
}

function decorateChaseResult(shapes: Shape[], question: BatchQuizQuestion): Shape[] {
  const correctIndex = question.correct === "B" ? 2 : 1;
  const wrongIndex = correctIndex === 1 ? 2 : 1;
  const direction = correctIndex === 1 ? -1 : 1;
  const failed = question.outcome === "wrong";
  return shapes.map((shape) => {
    if (shape.id === `choice-${correctIndex}-glow`) return { ...shape, fill: "#27E6A4", opacity: .55, shadowColor: "#27E6A4AA", shadowBlur: 40 };
    if (shape.id === `choice-${wrongIndex}-glow`) return failed ? { ...shape, fill: "#FF5B68", opacity: .5, shadowColor: "#FF5B6888", shadowBlur: 32 } : { ...shape, opacity: .16 };
    if (shape.id === `choice-${wrongIndex}-button` || shape.id === `text-${wrongIndex}`) return { ...shape, opacity: failed ? .78 : .42, saturation: failed ? .55 : 0 };
    if (shape.id === `image-1`) {
      const endScale = scaled(shape, 1.08);
      return { ...shape, keyframes: [
        motionFrame(shape, 0),
        motionFrame(shape, 1.1, { x: shape.x + direction * 115, y: shape.y - 22, easing: "easeIn" }),
        motionFrame(shape, 2.7, { x: shape.x + direction * 275, y: shape.y - 35, easing: "easeInOut" }),
        motionFrame(shape, 5, { ...endScale, x: endScale.x + direction * 430, y: endScale.y - 45, easing: "easeOut" }),
      ] };
    }
    if (shape.id === `image-2`) {
      const runnerDirection = failed ? -direction : direction;
      const endScale = scaled(shape, failed ? .96 : 1.1);
      return { ...shape, keyframes: [
        motionFrame(shape, 0),
        motionFrame(shape, 1.15, { x: shape.x + runnerDirection * 105, y: shape.y - (failed ? 0 : 45), easing: "easeIn" }),
        motionFrame(shape, 2.8, { x: shape.x + runnerDirection * 255, y: shape.y - (failed ? -10 : 105), easing: "easeInOut" }),
        motionFrame(shape, 5, { ...endScale, x: endScale.x + runnerDirection * 410, y: endScale.y - (failed ? -20 : 165), easing: "easeOut" }),
      ] };
    }
    return shape;
  });
}

function decorateGameResult(shapes: Shape[], question: BatchQuizQuestion) {
  return question.kind === "find_thief" ? decorateFindThiefResult(shapes, question) : decorateChaseResult(shapes, question);
}

function resultMetadata(question: BatchQuizQuestion, backgroundPresetId: string, backgroundVariant: string) {
  return {
    sceneRole: "result" as const,
    questionIndex: question.number,
    linkedQuestionId: question.number,
    backgroundPresetId,
    backgroundVariant,
  };
}

export async function buildBatchProject(plan: BatchQuizPlan, options: {
  makeId: () => string;
  audioBindings: AudioPresetBindings;
  loadPreset?: (id: MainScenePresetId) => Promise<FormaProject>;
  format?: CanvasPreset;
}): Promise<BatchBuildResult> {
  if (!plan.questions.length) throw new Error("O lote não possui perguntas.");
  const error = plan.issues.find((issue) => issue.level === "error");
  if (error) throw new Error(error.question ? `Pergunta ${error.question}: ${error.message}` : error.message);
  const loadPreset = options.loadPreset ?? loadMainScenePreset;
  const targetFormat = options.format ?? "landscape";
  const groups: BuiltQuestion[] = [];

  for (const question of plan.questions) {
    const preset = presetFor(question);
    const backgroundData = resolveBackgroundForQuestion(question.number);
    const template = await loadPreset(preset);
    const built = buildMainScenePreset(template, preset, commandFor(question, preset, backgroundData.preset.id), { shapes: [], background: template.document.background, backgroundVideo: template.document.backgroundVideo, format: targetFormat });
    if (!built.ok) throw new Error(`Pergunta ${question.number}: ${built.message}`);
    const main: FormaScene = {
      ...sceneFromDocument(options.makeId(), `Pergunta ${String(question.number).padStart(2, "0")}`, { shapes: built.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: built.format, animationDuration: 8 }, "main"),
      sceneRole: "question",
      questionIndex: question.number,
      backgroundPresetId: backgroundData.backgroundPresetId,
      backgroundVariant: backgroundData.backgroundVariant,
    };

    if (question.kind === "would_you_rather") {
      groups.push({ main });
      continue;
    }

    const metadata = resultMetadata(question, backgroundData.backgroundPresetId, backgroundData.backgroundVariant);
    if (question.kind === "three_options") {
      const result = buildQuizResult(built.shapes, String(question.correct), QUIZ_RESULT_DURATION);
      if (!result.ok) throw new Error(`Pergunta ${question.number}: ${result.message}`);
      groups.push({ main, result: { ...sceneFromDocument(options.makeId(), `Resultado ${String(question.number).padStart(2, "0")}`, { shapes: result.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: built.format, animationDuration: QUIZ_RESULT_DURATION }, "result"), ...metadata } });
      continue;
    }

    if (question.kind === "true_false") {
      const result = buildBinaryQuizResult(built.shapes, question.correct === "red" ? "red" : "green");
      if (!result.ok) throw new Error(`Pergunta ${question.number}: ${result.message}`);
      groups.push({ main, result: { ...sceneFromDocument(options.makeId(), `Resultado ${String(question.number).padStart(2, "0")}`, { shapes: result.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: built.format, animationDuration: BINARY_RESULT_DURATION }, "result"), ...metadata } });
      continue;
    }

    if (question.kind === "find_thief" || question.kind === "chase_lr") {
      const resultPreset = gameResultPreset(question);
      const resultTemplate = await loadPreset(resultPreset);
      const resultBuilt = buildMainScenePreset(resultTemplate, resultPreset, gameResultCommand(question, resultPreset, backgroundData.preset.id), { shapes: built.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: targetFormat });
      if (!resultBuilt.ok) throw new Error(`Pergunta ${question.number}: ${resultBuilt.message}`);
      const resultShapes = decorateGameResult(resultBuilt.shapes, question);
      groups.push({
        main,
        result: {
          ...sceneFromDocument(options.makeId(), `Resultado ${String(question.number).padStart(2, "0")}`, { shapes: resultShapes, background: resultBuilt.background, backgroundVideo: resultBuilt.backgroundVideo, format: resultBuilt.format, animationDuration: 5 }, "result"),
          ...metadata,
        },
      });
      continue;
    }

    const resultPreset: MainScenePresetId = "emoji_quiz_result_5s";
    const resultTemplate = await loadPreset(resultPreset);
    const resultBuilt = buildMainScenePreset(resultTemplate, resultPreset, emojiResultCommand(question, backgroundData.preset.id), { shapes: built.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: targetFormat });
    if (!resultBuilt.ok) throw new Error(`Pergunta ${question.number}: ${resultBuilt.message}`);
    groups.push({
      main,
      result: {
        ...sceneFromDocument(options.makeId(), `Resultado ${String(question.number).padStart(2, "0")}`, { shapes: resultBuilt.shapes, background: built.background, backgroundVideo: built.backgroundVideo, format: resultBuilt.format, animationDuration: 5 }, "result"),
        ...metadata,
      },
    });
  }

  const scenes: FormaScene[] = [];
  if (plan.includeIntro) scenes.push(createIntroScene(options.makeId(), "Entrada", targetFormat));
  if (plan.includeIntro && plan.includeTransitions) scenes.push(createTransitionScene(options.makeId(), "Transição da entrada", targetFormat, { presetId: "brush-lightning" }));
  groups.forEach((group, index) => {
    scenes.push(group.main);
    if (group.result) scenes.push(group.result);
    if (plan.includeTransitions && index < groups.length - 1) scenes.push(createTransitionScene(options.makeId(), `Transição ${String(index + 1).padStart(2, "0")}`, targetFormat, { presetId: "brush-lightning" }));
  });
  const linked = applyAudioBindings(scenes, options.audioBindings);
  return { scenes: linked, activeScene: linked[0] };
}
