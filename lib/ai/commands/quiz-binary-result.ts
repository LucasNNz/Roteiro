import type { AICommand, AIResult, MotionKeyframe, QuizResultBase, Shape } from "../../../app/types.ts";
import { keyframeFromShape, shapeAtTime } from "../../geometry.ts";

export const BINARY_RESULT_DURATION = 5;
export const BINARY_RESULT_BACKGROUNDS = {
  green: "/backgrounds/corvoquiz-resultado-verde-5s.mp4",
  red: "/backgrounds/corvoquiz-resultado-vermelho-5s.mp4",
} as const;

const RESULT_PREFIX = "quiz-vf-result-";
const RESULT_GROUP = "quiz-vf-result-effects";
type BinaryChoice = keyof typeof BINARY_RESULT_BACKGROUNDS;
type BinaryBuild = { ok: true; shapes: Shape[]; selectedId: string; background: string; backgroundVideo: string } | { ok: false; message: string };

function snapshot(shape: Shape): QuizResultBase {
  return {
    x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: shape.rotation, radius: shape.radius, fill: shape.fill,
    ...(shape.fill2 !== undefined ? { fill2: shape.fill2 } : {}),
    ...(shape.opacity !== undefined ? { opacity: shape.opacity } : {}),
    ...(shape.stroke !== undefined ? { stroke: shape.stroke } : {}),
    ...(shape.strokeWidth !== undefined ? { strokeWidth: shape.strokeWidth } : {}),
    ...(shape.shadowColor !== undefined ? { shadowColor: shape.shadowColor } : {}),
    ...(shape.shadowBlur !== undefined ? { shadowBlur: shape.shadowBlur } : {}),
    ...(shape.shadowX !== undefined ? { shadowX: shape.shadowX } : {}),
    ...(shape.shadowY !== undefined ? { shadowY: shape.shadowY } : {}),
    ...(shape.keyframes ? { keyframes: shape.keyframes.map((item) => ({ ...item })) } : {}),
  };
}

function restore(shape: Shape): Shape {
  if (!shape.quizResultBase) return { ...shape, keyframes: shape.keyframes?.map((item) => ({ ...item })) };
  const base = shape.quizResultBase;
  const restored = { ...shape };
  delete restored.quizResultBase;
  for (const property of ["fill2", "opacity", "stroke", "strokeWidth", "shadowColor", "shadowBlur", "shadowX", "shadowY", "keyframes"] as const) {
    if (!(property in base)) delete restored[property];
  }
  return { ...restored, ...base, keyframes: base.keyframes?.map((item) => ({ ...item })) };
}

function isHelper(shape: Shape) {
  return shape.id.startsWith(RESULT_PREFIX)
    || shape.groupId === RESULT_GROUP
    || shape.id === "result-true-halo"
    || shape.id.endsWith("-forgotten")
    || shape.id.startsWith("result-reveal-");
}

function isProgress(shape: Shape) {
  return shape.groupId?.startsWith("progress-") || shape.id.startsWith("progress-") || /^Progresso\s*·/i.test(shape.name ?? "");
}

function normalizeChoice(value: unknown): BinaryChoice | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  if (["green", "verde", "true", "verdadeiro"].includes(normalized)) return "green";
  if (["red", "vermelho", "false", "falso"].includes(normalized)) return "red";
  return null;
}

function buttonMembers(shapes: Shape[], choice: BinaryChoice) {
  const role = choice === "green" ? "true" : "false";
  const group = shapes.find((shape) => shape.groupId?.toLowerCase().includes(`answer-${role}`))?.groupId;
  const members = group
    ? shapes.filter((shape) => shape.groupId === group)
    : shapes.filter((shape) => shape.id.toLowerCase().includes(`answer-${role}-`));
  const image = members.find((shape) => shape.type === "image" || /imagem/i.test(shape.name ?? ""));
  const text = members.find((shape) => shape.type === "text");
  return { group, members, image, text };
}

function frame(shape: Shape, time: number, patch: Partial<MotionKeyframe> = {}): MotionKeyframe {
  return { ...keyframeFromShape(shape, time), ...patch };
}

function scaleAround(shape: Shape, centerX: number, centerY: number, scale: number): Shape {
  return {
    ...shape,
    x: centerX + (shape.x - centerX) * scale,
    y: centerY + (shape.y - centerY) * scale,
    w: shape.w * scale,
    h: shape.h * scale,
  };
}

function motionFrames(start: Shape, centerX: number, centerY: number, correct: boolean): MotionKeyframe[] {
  if (!correct) {
    const back = scaleAround(start, centerX, centerY, .87);
    const settle = scaleAround(start, centerX, centerY, .92);
    return [frame(start, 0), frame(start, 1.05, { easing: "easeInOut" }), frame(back, 1.45, { easing: "easeOut" }), frame(settle, 1.82, { easing: "easeInOut" }), frame(settle, BINARY_RESULT_DURATION)];
  }
  const anticipate = scaleAround(start, centerX, centerY, .97);
  const peak = scaleAround(start, centerX, centerY, 1.18);
  const settle = scaleAround(start, centerX, centerY, 1.10);
  const breathe = scaleAround(start, centerX, centerY, 1.115);
  return [
    frame(start, 0),
    frame(start, 1.05, { easing: "easeInOut" }),
    frame(anticipate, 1.16, { easing: "easeInOut" }),
    frame(peak, 1.42, { easing: "easeOutBack" }),
    frame(settle, 1.82, { easing: "easeInOut" }),
    frame(breathe, 3.55, { easing: "easeInOut" }),
    frame(settle, BINARY_RESULT_DURATION),
  ];
}

function bounds(members: Shape[], time: number) {
  const states = members.map((shape) => shapeAtTime(shape, time));
  const left = Math.min(...states.map((shape) => shape.x));
  const top = Math.min(...states.map((shape) => shape.y));
  const right = Math.max(...states.map((shape) => shape.x + shape.w));
  const bottom = Math.max(...states.map((shape) => shape.y + shape.h));
  return { states, left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

function halo(centerX: number, centerY: number, w: number, h: number, choice: BinaryChoice): Shape {
  const color = choice === "green" ? "#73FF9F" : "#FF6686";
  const base: Shape = {
    id: `${RESULT_PREFIX}${choice}-halo`, groupId: RESULT_GROUP, type: "ellipse", name: `Resultado · impacto do botão ${choice === "green" ? "verde" : "vermelho"}`,
    x: centerX - w * .63, y: centerY - h * .63, w: w * 1.26, h: h * 1.26, rotation: 0, radius: h * .63,
    fill: color, opacity: .10, visible: true, locked: true, shadowColor: `${color}99`, shadowBlur: 46,
  };
  const hidden = { ...base, x: centerX - w * .54, y: centerY - h * .54, w: w * 1.08, h: h * 1.08, radius: h * .54, opacity: 0 };
  const peak = { ...base, x: centerX - w * .69, y: centerY - h * .69, w: w * 1.38, h: h * 1.38, radius: h * .69, opacity: .38 };
  const settle = { ...base, opacity: .15 };
  return { ...base, keyframes: [frame(hidden, 0, { easing: "easeOut" }), frame(hidden, 1.05, { easing: "easeOut" }), frame(peak, 1.42, { easing: "easeOutBack" }), frame(settle, 1.82, { easing: "easeInOut" }), frame(base, BINARY_RESULT_DURATION)] };
}

export function buildBinaryQuizResult(source: Shape[], correctButton: unknown): BinaryBuild {
  const correct = normalizeChoice(correctButton);
  if (!correct) return { ok: false, message: "Escolha o botão verde ou o botão vermelho." };
  const restored = source.filter((shape) => !isHelper(shape)).map(restore);
  const originals = new Map(restored.map((shape) => [shape.id, shape]));
  // A cena de resultado deve abrir já montada no estado final da entrada da
  // cena principal. Só a revelação do resultado começa depois de 1,05 s.
  const clean = restored.map((shape) => ({ ...shapeAtTime(shape, 1.05), keyframes: undefined }));
  const green = buttonMembers(clean, "green");
  const red = buttonMembers(clean, "red");
  if (!green.image || !green.text) return { ok: false, message: "Não encontrei o botão verde completo." };
  if (!red.image || !red.text) return { ok: false, message: "Não encontrei o botão vermelho completo." };

  const updates = new Map<string, Shape>();
  const additions = new Map<string, Shape[]>();
  for (const [choice, button] of [["green", green], ["red", red]] as const) {
    const box = bounds(button.members, 1.05);
    const isCorrect = choice === correct;
    for (let index = 0; index < button.members.length; index += 1) {
      const member = button.members[index];
      const start = box.states[index];
      const finalScale = isCorrect ? 1.10 : .92;
      const end = scaleAround(start, box.centerX, box.centerY, finalScale);
      updates.set(member.id, {
        ...member,
        ...end,
        quizResultBase: snapshot(originals.get(member.id) ?? member),
        keyframes: motionFrames(start, box.centerX, box.centerY, isCorrect),
      });
    }
    if (!isCorrect) {
      const original = button.image!;
      const styled = updates.get(original.id)!;
      additions.set(original.id, [{
        ...styled,
        id: `${RESULT_PREFIX}${choice}-forgotten`, groupId: RESULT_GROUP,
        name: `Resultado · botão ${choice === "green" ? "verde" : "vermelho"} esquecido`,
        saturation: 0, brightness: 82, contrast: 88, opacity: 1, quizResultBase: undefined,
        keyframes: styled.keyframes?.map((item) => ({ ...item, opacity: item.time <= 1.05 ? 0 : 1 })),
      }]);
    }
  }

  const next: Shape[] = [];
  for (const shape of clean) {
    if (isProgress(shape)) continue;
    const updated = updates.get(shape.id) ?? shape;
    next.push(updated, ...(additions.get(shape.id) ?? []));
  }
  const correctButtonParts = correct === "green" ? green : red;
  const correctBox = bounds(correctButtonParts.members, 1.05);
  next.unshift(halo(correctBox.centerX, correctBox.centerY, correctBox.right - correctBox.left, correctBox.bottom - correctBox.top, correct));

  const visual = clean.find((shape) => shape.id === "visual-card" || /^Imagem da pergunta$/i.test(shape.name ?? ""));
  if (visual) {
    const start = visual;
    const peak = scaleAround(start, start.x + start.w / 2, start.y + start.h / 2, 1.03);
    const updated = {
      ...visual,
      ...start,
      quizResultBase: snapshot(originals.get(visual.id) ?? visual),
      keyframes: [frame(start, 0), frame(start, 1.05, { easing: "easeOut" }), frame(peak, 1.31, { easing: "easeOutBack" }), frame(start, 1.63, { easing: "easeInOut" }), frame(start, BINARY_RESULT_DURATION)],
    };
    const index = next.findIndex((shape) => shape.id === visual.id);
    if (index >= 0) next[index] = updated;
  }

  return {
    ok: true,
    shapes: next,
    selectedId: correctButtonParts.image!.id,
    background: correct === "green" ? "#219B42" : "#D92F56",
    backgroundVideo: BINARY_RESULT_BACKGROUNDS[correct],
  };
}

export function handleBinaryQuizResultCommand(command: AICommand, ports: {
  shapes: Shape[];
  background: string;
  backgroundVideo?: string;
  setShapes: (shapes: Shape[]) => void;
  setBackground: (background: string) => void;
  setBackgroundVideo: (source: string | undefined) => void;
  setDuration: (duration: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  select: (id: string | null) => void;
  commit: (shapes: Shape[], background: string, format?: undefined, backgroundVideo?: string) => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  if (action !== "apply_binary_quiz_result") return null;
  const choice = command.correctButton ?? command.correctAnswer ?? command.button ?? command.color;
  const result = buildBinaryQuizResult(ports.shapes, choice);
  if (!result.ok) return ports.report(action, result.message, false);
  ports.pause();
  ports.setDuration(BINARY_RESULT_DURATION);
  ports.setShapes(result.shapes);
  ports.setBackground(result.background);
  ports.setBackgroundVideo(result.backgroundVideo);
  ports.select(result.selectedId);
  ports.seek(0);
  ports.commit(result.shapes, result.background, undefined, result.backgroundVideo);
  const label = normalizeChoice(choice) === "green" ? "verde" : "vermelho";
  return ports.report(action, `Botão ${label} definido como correto com resultado de 5s.`, true, result.selectedId);
}
