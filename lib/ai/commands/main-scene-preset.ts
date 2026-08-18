import type { AICommand, AIResult, CanvasPreset, FormaProject, Shape } from "../../../app/types.ts";
import { CORVOQUIZ_BACKGROUNDS } from "../../background-presets.ts";
import { balancedLines, cloneShapes } from "../../geometry.ts";
import { parseFormaProject } from "../../projects/serialization.ts";
import { adaptShapesForFormat } from "../../layout/corvoquiz-responsive.ts";

export type MainScenePresetId =
  | "quiz_3_options_8s"
  | "true_false_8s"
  | "guess_logo_8s"
  | "guess_logo_result_5s"
  | "emoji_quiz_8s"
  | "emoji_quiz_result_5s"
  | "guess_movie_8s"
  | "guess_movie_result_5s"
  | "would_you_rather_8s"
  | "game_find_thief_ab_8s"
  | "game_chase_lr_8s"
  | "game_find_thief_correct_5s"
  | "game_find_thief_wrong_5s"
  | "game_chase_correct_5s"
  | "game_chase_wrong_5s";

export type MainScenePresetMetadata = {
  id: MainScenePresetId;
  label: string;
  shortLabel: string;
  description: string;
  src: string;
  duration: 5 | 8;
  kind: "main" | "result";
  icon: "three-options" | "true-false" | "logo" | "emoji" | "movie" | "would-rather";
};

export const MAIN_SCENE_PRESETS: MainScenePresetMetadata[] = [
  { id: "quiz_3_options_8s", label: "Quiz 3 opções", shortLabel: "3 OPÇÕES", description: "Imagem + alternativas A/B/C · 8s", src: "/presets/corvoquiz-3-opcoes-8s.forma.json?v=66", duration: 8, kind: "main", icon: "three-options" },
  { id: "true_false_8s", label: "Verdadeiro ou falso", shortLabel: "V/F", description: "Imagem + dois botões · 8s", src: "/presets/corvoquiz-verdadeiro-falso-8s.forma.json?v=66", duration: 8, kind: "main", icon: "true-false" },
  { id: "guess_logo_8s", label: "Adivinhe o Logo", shortLabel: "LOGO", description: "Logo central + cronômetro · 8s", src: "/presets/corvoquiz-adivinhe-logo-8s.forma.json?v=2", duration: 8, kind: "main", icon: "logo" },
  { id: "guess_logo_result_5s", label: "Adivinhe o Logo · Resultado", shortLabel: "LOGO ✓", description: "Logo + nome revelado · 5s", src: "/presets/corvoquiz-adivinhe-logo-resultado-5s.forma.json?v=2", duration: 5, kind: "result", icon: "logo" },
  { id: "emoji_quiz_8s", label: "Descubra pelos Emojis", shortLabel: "EMOJIS", description: "2 pistas visuais editáveis · 8s", src: "/presets/corvoquiz-descubra-emojis-8s.forma.json?v=3", duration: 8, kind: "main", icon: "emoji" },
  { id: "emoji_quiz_result_5s", label: "Emojis · Resultado", shortLabel: "EMOJI ✓", description: "Pistas + imagem + resposta · 5s", src: "/presets/corvoquiz-descubra-emojis-resultado-5s.forma.json?v=3", duration: 5, kind: "result", icon: "emoji" },
  { id: "guess_movie_8s", label: "Adivinhe o Filme", shortLabel: "FILME", description: "3 pistas visuais editáveis · 8s", src: "/presets/corvoquiz-adivinhe-filme-8s.forma.json?v=2", duration: 8, kind: "main", icon: "movie" },
  { id: "guess_movie_result_5s", label: "Adivinhe o Filme · Resultado", shortLabel: "FILME ✓", description: "Imagem + nome do filme · 5s", src: "/presets/corvoquiz-adivinhe-filme-resultado-5s.forma.json?v=2", duration: 5, kind: "result", icon: "movie" },
  { id: "would_you_rather_8s", label: "O que você prefere?", shortLabel: "PREFERE?", description: "2 imagens + 2 textos · 8s", src: "/presets/corvoquiz-o-que-voce-prefere-8s.forma.json?v=4", duration: 8, kind: "main", icon: "would-rather" },
  { id: "game_find_thief_ab_8s", label: "MVP Game · Ache o Ladrão", shortLabel: "LADRÃO A/B", description: "2 personagens + cenário + escolha A/B · 8s", src: "/presets/corvoquiz-mvp-ache-ladrao-ab-8s.forma.json?v=1", duration: 8, kind: "main", icon: "would-rather" },
  { id: "game_chase_lr_8s", label: "MVP Game · Perseguição", shortLabel: "← CORRIDA →", description: "Cenário em movimento + 2 personagens + esquerda/direita · 8s", src: "/presets/corvoquiz-mvp-perseguicao-esquerda-direita-8s.forma.json?v=2", duration: 8, kind: "main", icon: "would-rather" },
  { id: "game_find_thief_correct_5s", label: "MVP Game · Ladrão · Acerto", shortLabel: "LADRÃO ✓", description: "Resultado correto do Ache o Ladrão · 5s", src: "/presets/corvoquiz-mvp-ache-ladrao-resultado-correto-5s.forma.json?v=1", duration: 5, kind: "result", icon: "would-rather" },
  { id: "game_find_thief_wrong_5s", label: "MVP Game · Ladrão · Erro", shortLabel: "LADRÃO ✕", description: "Resultado errado do Ache o Ladrão · 5s", src: "/presets/corvoquiz-mvp-ache-ladrao-resultado-errado-5s.forma.json?v=1", duration: 5, kind: "result", icon: "would-rather" },
  { id: "game_chase_correct_5s", label: "MVP Game · Perseguição · Acerto", shortLabel: "CORRIDA ✓", description: "Resultado correto da perseguição · 5s", src: "/presets/corvoquiz-mvp-perseguicao-resultado-correto-5s.forma.json?v=1", duration: 5, kind: "result", icon: "would-rather" },
  { id: "game_chase_wrong_5s", label: "MVP Game · Perseguição · Erro", shortLabel: "CORRIDA ✕", description: "Resultado errado da perseguição · 5s", src: "/presets/corvoquiz-mvp-perseguicao-resultado-errado-5s.forma.json?v=1", duration: 5, kind: "result", icon: "would-rather" },
];

type BuildResult = {
  ok: true;
  shapes: Shape[];
  background: string;
  backgroundVideo?: string;
  duration: 5 | 8;
  format: CanvasPreset;
  preset: MainScenePresetId;
  kind: "main" | "result";
} | { ok: false; message: string };

const cache = new Map<MainScenePresetId, FormaProject>();
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

function fittedQuestion(shape: Shape, value: string): Shape {
  const baseSize = shape.fontSize ?? 82;
  const preferredChars = shape.w > 0 ? Math.max(20, Math.floor(shape.w / Math.max(1, baseSize * .52))) : 32;
  const lines = balancedLines(value, preferredChars);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const widthLimited = shape.w > 0 ? Math.floor(shape.w / Math.max(1, longest * .57)) : baseSize;
  const lineLimited = lines.length > 1 ? Math.min(baseSize, Math.floor(shape.h / Math.max(1, lines.length * .98))) : baseSize;
  const minSize = Math.max(46, Math.floor(baseSize * .68));
  const fontSize = Math.max(minSize, Math.min(baseSize, widthLimited, lineLimited));
  return { ...shape, text: lines.join("\n"), fontSize, lineHeight: lines.length > 1 ? .98 : shape.lineHeight };
}

function fittedOverrideText(shape: Shape, value: string): Shape {
  const baseSize = shape.fontSize ?? 54;
  const longest = Math.max(...value.split(/\r?\n/).map((line) => line.trim().length), 1);
  const widthLimited = shape.w > 0 ? Math.floor(shape.w / Math.max(1, longest * .57)) : baseSize;
  const minSize = Math.max(28, Math.floor(baseSize * .65));
  return { ...shape, text: value, fontSize: Math.max(minSize, Math.min(baseSize, widthLimited)) };
}

export function mainScenePresetId(value: unknown): MainScenePresetId | null {
  const id = normalize(value);
  if (["quiz_3_options_8s", "quiz_3_opcoes_8s", "quiz_3_options", "quiz_3_opcoes", "3_options", "3_opcoes", "abc", "a_b_c"].includes(id)) return "quiz_3_options_8s";
  if (["true_false_8s", "verdadeiro_falso_8s", "verdadeiro_ou_falso_8s", "true_false", "verdadeiro_falso", "verdadeiro_ou_falso", "vf", "v_f"].includes(id)) return "true_false_8s";
  if (["guess_logo_8s", "adivinhe_logo_8s", "adivinhe_o_logo", "adivinhar_logo", "logo"].includes(id)) return "guess_logo_8s";
  if (["guess_logo_result_5s", "adivinhe_logo_resultado", "resultado_logo", "logo_resultado", "logo_result"].includes(id)) return "guess_logo_result_5s";
  if (["emoji_quiz_8s", "descubra_pelos_emojis", "quiz_emojis", "emojis", "emoji_quiz"].includes(id)) return "emoji_quiz_8s";
  if (["emoji_quiz_result_5s", "emojis_resultado", "resultado_emojis", "emoji_result", "emoji_resultado"].includes(id)) return "emoji_quiz_result_5s";
  if (["guess_movie_8s", "adivinhe_o_filme", "adivinhe_filme", "filme", "movie_quiz"].includes(id)) return "guess_movie_8s";
  if (["guess_movie_result_5s", "adivinhe_filme_resultado", "resultado_filme", "filme_resultado", "movie_result"].includes(id)) return "guess_movie_result_5s";
  if (["would_you_rather_8s", "o_que_voce_prefere", "voce_prefere", "would_you_rather", "prefere"].includes(id)) return "would_you_rather_8s";
  if (["game_find_thief_ab_8s", "ache_o_ladrao", "ache_ladrao", "ladrao_ab", "find_thief"].includes(id)) return "game_find_thief_ab_8s";
  if (["game_chase_lr_8s", "perseguicao", "perseguicao_esquerda_direita", "corrida_esquerda_direita", "chase_lr"].includes(id)) return "game_chase_lr_8s";
  if (["game_find_thief_correct_5s", "ache_ladrao_correto", "ladrao_acerto", "find_thief_correct"].includes(id)) return "game_find_thief_correct_5s";
  if (["game_find_thief_wrong_5s", "ache_ladrao_errado", "ladrao_erro", "find_thief_wrong"].includes(id)) return "game_find_thief_wrong_5s";
  if (["game_chase_correct_5s", "perseguicao_correta", "corrida_acerto", "chase_correct"].includes(id)) return "game_chase_correct_5s";
  if (["game_chase_wrong_5s", "perseguicao_errada", "corrida_erro", "chase_wrong"].includes(id)) return "game_chase_wrong_5s";
  return null;
}

export function mainScenePresetMetadata(value: unknown): MainScenePresetMetadata | null {
  const id = mainScenePresetId(value);
  return id ? MAIN_SCENE_PRESETS.find((item) => item.id === id) ?? null : null;
}

export async function loadMainScenePreset(id: MainScenePresetId): Promise<FormaProject> {
  const cached = cache.get(id);
  if (cached) return { ...cached, document: { ...cached.document, shapes: cloneShapes(cached.document.shapes) } };
  const metadata = MAIN_SCENE_PRESETS.find((preset) => preset.id === id)!;
  const response = await fetch(metadata.src);
  if (!response.ok) throw new Error(`Preset indisponível (${response.status}).`);
  const project = parseFormaProject(await response.text());
  cache.set(id, project);
  return { ...project, document: { ...project.document, shapes: cloneShapes(project.document.shapes) } };
}

function validatePreset(project: FormaProject, preset: MainScenePresetId): string | null {
  const metadata = MAIN_SCENE_PRESETS.find((item) => item.id === preset)!;
  if (project.animationDuration !== metadata.duration) return `O preset ${metadata.label} precisa ter exatamente ${metadata.duration} segundos.`;
  if (project.document.format !== "landscape") return "O preset precisa estar no formato horizontal.";
  const ids = new Set<string>();
  for (const shape of project.document.shapes) {
    if (!shape.id || ids.has(shape.id)) return "O preset possui camadas duplicadas ou sem identificação.";
    ids.add(shape.id);
    if ((shape.keyframes ?? []).some((frame) => !Number.isFinite(frame.time) || frame.time < 0 || frame.time > metadata.duration)) return `A camada ${shape.name ?? shape.id} possui keyframes fora dos ${metadata.duration} segundos.`;
  }
  return null;
}

function answerOverrides(command: AICommand) {
  const source = command.answers;
  const object = source && typeof source === "object" && !Array.isArray(source) ? source as Record<string, unknown> : {};
  const array = Array.isArray(source) ? source : [];
  return {
    "answer-a-text": text(command.answerA ?? object.A ?? object.a ?? array[0]),
    "answer-b-text": text(command.answerB ?? object.B ?? object.b ?? array[1]),
    "answer-c-text": text(command.answerC ?? object.C ?? object.c ?? array[2]),
    "answer-true-text": text(command.trueText ?? command.greenText ?? object.true ?? object.green ?? object.verdadeiro ?? object.verde ?? array[0]),
    "answer-false-text": text(command.falseText ?? command.redText ?? object.false ?? object.red ?? object.falso ?? object.vermelho ?? array[1]),
    "text-1": text(command.text1 ?? command.leftText ?? command.option1Text ?? command.optionAText ?? object.left ?? object.leftText),
    "text-2": text(command.text2 ?? command.rightText ?? command.option2Text ?? command.optionBText ?? object.right ?? object.rightText),
    "result-answer": text(command.resultText ?? command.answerText ?? command.result ?? command.answer ?? command.logoName ?? command.movieName ?? command.correctName),
    subtitle: text(command.subtitle),
  } as Record<string, string | undefined>;
}

function imageOverrides(command: AICommand) {
  return {
    "visual-card": text(command.resultImage ?? command.imageSrc ?? command.image ?? command.mainImage ?? command.logoImage ?? command.movieImage ?? command.posterImage),
    "preset-mvp-find-thief-ab": text(command.sceneImage ?? command.backgroundImage ?? command.imageSrc ?? command.image),
    "preset-mvp-chase-lr": text(command.sceneImage ?? command.backgroundImage ?? command.imageSrc ?? command.image),
    "image-1": text(command.image1 ?? command.emoji1 ?? command.leftImage ?? command.option1Image ?? command.optionAImage ?? command.leftMedia),
    "image-2": text(command.image2 ?? command.emoji2 ?? command.rightImage ?? command.option2Image ?? command.optionBImage ?? command.rightMedia),
    "image-3": text(command.image3 ?? command.emoji3 ?? command.option3Image ?? command.optionCImage),
    "image-4": text(command.image4 ?? command.emoji4 ?? command.option4Image),
  } as Record<string, string | undefined>;
}

function resolveBackground(command: AICommand, project: FormaProject, current: { shapes: Shape[]; background: string; backgroundVideo?: string }) {
  const requestedPreset = text(command.backgroundPreset ?? command.backgroundStyle);
  const requestedVideo = text(command.backgroundVideo);
  const preset = requestedPreset ? CORVOQUIZ_BACKGROUNDS.find((item) => normalize(item.id) === normalize(requestedPreset) || normalize(item.label) === normalize(requestedPreset) || item.src === requestedPreset) : undefined;
  if (requestedPreset && !preset) return { ok: false as const, message: `Fundo animado não reconhecido: ${requestedPreset}.` };
  if (preset) return { ok: true as const, background: preset.color, backgroundVideo: preset.src };
  if (requestedVideo) {
    const bySource = CORVOQUIZ_BACKGROUNDS.find((item) => item.src === requestedVideo);
    return { ok: true as const, background: text(command.background) ?? bySource?.color ?? project.document.background, backgroundVideo: requestedVideo };
  }
  if (current.shapes.length && current.backgroundVideo) return { ok: true as const, background: current.background, backgroundVideo: current.backgroundVideo };
  return { ok: true as const, background: text(command.background) ?? project.document.background, backgroundVideo: project.document.backgroundVideo };
}

function retainedMedia(existing: Shape | undefined) {
  if (!existing) return undefined;
  return existing.type === "image" ? existing.src : existing.imageSrc;
}

function withMedia(shape: Shape, source: string, existing?: Shape): Shape {
  return {
    ...shape,
    ...(shape.type === "image" ? { src: source } : { imageSrc: source }),
    objectFit: existing?.objectFit ?? shape.objectFit ?? (shape.id === "visual-card" ? "cover" : "contain"),
    imageScale: existing?.imageScale ?? 1,
    imageOffsetX: existing?.imageOffsetX ?? 0,
    imageOffsetY: existing?.imageOffsetY ?? 0,
  };
}

export function buildMainScenePreset(project: FormaProject, preset: MainScenePresetId, command: AICommand, current: { shapes: Shape[]; background: string; backgroundVideo?: string; format?: CanvasPreset }): BuildResult {
  const metadata = MAIN_SCENE_PRESETS.find((item) => item.id === preset)!;
  const validation = validatePreset(project, preset);
  if (validation) return { ok: false, message: validation };
  const background = resolveBackground(command, project, current);
  if (!background.ok) return background;

  const preserve = command.preserveContent !== false;
  const currentById = new Map(current.shapes.map((shape) => [shape.id, shape]));
  const textOverrides = answerOverrides(command);
  const mediaOverrides = imageOverrides(command);
  const explicitQuestion = text(command.question ?? command.title ?? command.questionTitle ?? command.sceneTitle);
  const explicitNumber = text(command.questionNumber ?? command.number ?? command.sceneNumber);

  const shapes = cloneShapes(project.document.shapes).map((shape) => {
    const existing = currentById.get(shape.id);
    if (shape.id === "question") {
      const value = explicitQuestion ?? (preserve ? existing?.text : undefined) ?? shape.text;
      return value ? { ...shape, text: value } : shape;
    }
    if (shape.id === "counter-number") {
      const value = explicitNumber ?? (preserve ? existing?.text : undefined) ?? shape.text;
      return { ...shape, text: value };
    }
    if (textOverrides[shape.id]) return { ...shape, text: textOverrides[shape.id]! };
    if (shape.id in mediaOverrides) {
      const explicit = mediaOverrides[shape.id];
      if (explicit) return withMedia(shape, explicit);
      const retained = preserve ? retainedMedia(existing) : undefined;
      return retained ? withMedia(shape, retained, existing) : shape;
    }
    if (preserve && existing?.type === "text" && shape.type === "text" && (shape.id.startsWith("answer-") || ["text-1", "text-2", "result-answer", "subtitle"].includes(shape.id))) return { ...shape, text: existing.text ?? shape.text };
    return shape;
  });

  const targetFormat = current.format ?? "landscape";
  const responsiveShapes = targetFormat === "landscape" ? shapes : adaptShapesForFormat(shapes, "landscape", targetFormat);
  const fittedShapes = responsiveShapes.map((shape) => {
    if (shape.id === "question" && shape.text) return fittedQuestion(shape, shape.text);
    if (shape.id === "counter-number") {
      const value = shape.text ?? "";
      const baseSize = shape.fontSize ?? (targetFormat === "portrait" ? 70 : 78);
      return { ...shape, ...(String(value).length > 2 ? { fontSize: Math.max(54, Math.min(baseSize, targetFormat === "portrait" ? 58 : 62)) } : {}) };
    }
    if (textOverrides[shape.id] && shape.text) return fittedOverrideText(shape, shape.text);
    return shape;
  });
  return { ok: true, shapes: fittedShapes, background: background.background, backgroundVideo: background.backgroundVideo, duration: metadata.duration, format: targetFormat, preset, kind: metadata.kind };
}

export async function handleMainScenePresetCommand(command: AICommand, ports: {
  shapes: Shape[];
  background: string;
  backgroundVideo?: string;
  format?: CanvasPreset;
  loadPreset?: (id: MainScenePresetId) => Promise<FormaProject>;
  setShapes: (shapes: Shape[]) => void;
  setBackground: (background: string) => void;
  setBackgroundVideo: (source?: string) => void;
  setDuration: (duration: number) => void;
  setFormat: (format: CanvasPreset) => void;
  pause: () => void;
  stopRecording: () => void;
  seek: (time: number) => void;
  select: (id: string | null) => void;
  resetView: () => void;
  openTimeline: () => void;
  schedulePlay: () => void;
  commit: (shapes: Shape[], background: string, format: CanvasPreset, backgroundVideo?: string) => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): Promise<AIResult | null> {
  const action = normalize(command.action);
  if (action !== "apply_main_scene_preset") return null;
  const preset = mainScenePresetId(command.preset ?? command.scene ?? command.value);
  if (!preset) return ports.report(action, `Escolha um preset válido: ${MAIN_SCENE_PRESETS.map((item) => item.id).join(", ")}.`, false);
  try {
    const project = await (ports.loadPreset ?? loadMainScenePreset)(preset);
    const result = buildMainScenePreset(project, preset, command, { shapes: ports.shapes, background: ports.background, backgroundVideo: ports.backgroundVideo, format: ports.format });
    if (!result.ok) return ports.report(action, result.message, false);
    ports.pause();
    ports.stopRecording();
    ports.setDuration(result.duration);
    ports.setFormat(result.format);
    ports.setBackground(result.background);
    ports.setBackgroundVideo(result.backgroundVideo);
    ports.setShapes(result.shapes);
    ports.select(null);
    ports.resetView();
    ports.openTimeline();
    ports.commit(result.shapes, result.background, result.format, result.backgroundVideo);
    ports.seek(0);
    ports.schedulePlay();
    const label = MAIN_SCENE_PRESETS.find((item) => item.id === preset)!.label;
    return ports.report(action, `${label} inserido em ${result.format === "portrait" ? "9:16" : result.format === "landscape" ? "16:9" : "1:1"} com ${result.duration}s e conteúdo editável pela IA.`, true, null);
  } catch (error) {
    return ports.report(action, error instanceof Error ? error.message : "Não foi possível carregar o preset.", false);
  }
}
