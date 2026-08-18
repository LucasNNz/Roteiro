import type { AICommand, AIResult, MotionKeyframe, QuizResultBase, Shape } from "../../../app/types.ts";
import { answerGroupParts } from "../../alignment/answers.ts";
import { keyframeFromShape } from "../../geometry.ts";

export const QUIZ_RESULT_DURATION = 5;
export const QUIZ_RESULT_REVEAL_AT = 0;
export const QUIZ_RESULT_COMPLETE_AT = 1;
const RESULT_PREFIX = "quiz-result-";
const RESULT_GROUP = "quiz-result-effects";
const OPTIONS = ["A", "B", "C"] as const;
type QuizOption = typeof OPTIONS[number];

type ResultBuild = { ok: true; shapes: Shape[]; selectedId: string; revealAt: number } | { ok: false; message: string };

function snapshot(shape: Shape): QuizResultBase {
  return {
    x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: shape.rotation, radius: shape.radius,
    fill: shape.fill,
    ...(shape.fill2 !== undefined ? { fill2: shape.fill2 } : {}),
    ...(shape.opacity !== undefined ? { opacity: shape.opacity } : {}),
    ...(shape.stroke !== undefined ? { stroke: shape.stroke } : {}),
    ...(shape.strokeWidth !== undefined ? { strokeWidth: shape.strokeWidth } : {}),
    ...(shape.shadowColor !== undefined ? { shadowColor: shape.shadowColor } : {}),
    ...(shape.shadowBlur !== undefined ? { shadowBlur: shape.shadowBlur } : {}),
    ...(shape.shadowX !== undefined ? { shadowX: shape.shadowX } : {}),
    ...(shape.shadowY !== undefined ? { shadowY: shape.shadowY } : {}),
    ...(shape.keyframes ? { keyframes: shape.keyframes.map((frame) => ({ ...frame })) } : {}),
  };
}

function restore(shape: Shape): Shape {
  if (!shape.quizResultBase) return { ...shape, keyframes: shape.keyframes?.map((frame) => ({ ...frame })) };
  const base = shape.quizResultBase;
  const restored = { ...shape };
  delete restored.quizResultBase;
  for (const property of ["fill2", "opacity", "stroke", "strokeWidth", "shadowColor", "shadowBlur", "shadowX", "shadowY", "keyframes"] as const) {
    if (!(property in base)) delete restored[property];
  }
  return { ...restored, ...base, keyframes: base.keyframes?.map((frame) => ({ ...frame })) };
}

function isResultHelper(shape: Shape) {
  return shape.id.startsWith(RESULT_PREFIX) || shape.id.startsWith("result-") || shape.groupId === RESULT_GROUP || shape.groupId?.startsWith("result-");
}

function isProgress(shape: Shape) {
  return shape.groupId?.startsWith("progress-") || shape.id.startsWith("progress-") || /^Progresso\s*·/i.test(shape.name ?? "");
}

function optionForLetter(shape: Shape): QuizOption | null {
  if (!/·\s*letra$/i.test(shape.name ?? "")) return null;
  const value = (shape.text ?? shape.name?.match(/^Alternativa\s+([ABC])\b/i)?.[1] ?? "").trim().toUpperCase();
  return OPTIONS.includes(value as QuizOption) ? value as QuizOption : null;
}

function settled(shape: Shape): Shape {
  return { ...shape, opacity: shape.opacity ?? 1, keyframes: undefined };
}

function frame(shape: Shape, time: number, patch: Partial<MotionKeyframe> = {}): MotionKeyframe {
  return { ...keyframeFromShape(shape, time), ...patch };
}

function resultFrames(start: Shape, end: Shape, revealAt: number, duration: number, correct: boolean, expandAtPeak = false) {
  const startFrame = frame(start, revealAt, { easing: "easeOut" });
  if (!correct) return [startFrame, frame(end, revealAt + .52, { easing: "easeInOut" }), frame(end, QUIZ_RESULT_COMPLETE_AT), frame(end, duration)];
  const peak = { ...end, x: end.x - 15, w: end.w + (expandAtPeak ? 20 : 0) };
  return [startFrame, frame(peak, revealAt + .32, { easing: "easeOutBack" }), frame(end, revealAt + .58, { easing: "easeInOut" }), frame(end, QUIZ_RESULT_COMPLETE_AT), frame(end, duration)];
}

function cover(original: Shape, start: Shape, end: Shape, option: QuizOption, role: string, revealAt: number, duration: number): Shape {
  return {
    ...end,
    id: `${RESULT_PREFIX}${option.toLowerCase()}-${role}`,
    groupId: RESULT_GROUP,
    name: `Resultado ${option} · cobertura ${role}`,
    fill: original.fill,
    fill2: original.fill2,
    opacity: 0,
    quizResultBase: undefined,
    keyframes: [
      frame(start, Math.max(0, revealAt - .01), { opacity: 1, easing: "easeOut" }),
      frame({ ...end, opacity: .14 }, revealAt + .32, { opacity: .14, easing: "easeOut" }),
      frame({ ...end, opacity: 0 }, revealAt + .5, { opacity: 0, easing: "easeInOut" }),
      frame({ ...end, opacity: 0 }, QUIZ_RESULT_COMPLETE_AT, { opacity: 0 }),
      frame({ ...end, opacity: 0 }, duration, { opacity: 0 }),
    ],
  };
}

function confetti(correctCard: Shape, revealAt: number, duration: number): Shape[] {
  const colors = ["#FFD84D", "#23D978", "#4FA8FF", "#FF5C9A", "#9A73FF", "#FFFFFF"];
  const offsets = [
    [-260, -190], [-170, -240], [-80, -205], [30, -250], [130, -200], [240, -235],
    [-235, 175], [-140, 230], [-35, 185], [75, 235], [165, 180], [255, 215],
  ];
  const cx = correctCard.x + correctCard.w / 2;
  const cy = correctCard.y + correctCard.h / 2;
  return offsets.map(([dx, dy], index) => {
    const size = 18 + index % 3 * 5;
    const startX = cx + dx * .18;
    const startY = cy + dy * .12;
    const endX = cx + dx;
    const endY = cy + dy;
    const base: Shape = {
      id: `${RESULT_PREFIX}confetti-${index + 1}`,
      groupId: RESULT_GROUP,
      type: index % 3 === 0 ? "ellipse" : "rect",
      name: `Resultado · confete ${index + 1}`,
      x: endX, y: endY, w: size, h: index % 3 === 0 ? size : Math.max(9, size * .45),
      rotation: index * 29 - 70, radius: index % 3 === 0 ? size / 2 : 4,
      fill: colors[index % colors.length], opacity: 0, visible: true,
    };
    return {
      ...base,
      keyframes: [
        frame({ ...base, x: startX, y: startY }, revealAt, { opacity: 0, easing: "easeOut" }),
        frame({ ...base, x: startX + dx * .12, y: startY + dy * .08 }, revealAt + .08, { opacity: 1, easing: "easeOut" }),
        frame(base, revealAt + .62, { opacity: 1, rotation: base.rotation + 145, easing: "easeOut" }),
        frame({ ...base, y: endY + 75 }, revealAt + 1, { opacity: 0, rotation: base.rotation + 230, easing: "easeIn" }),
        frame({ ...base, y: endY + 75 }, duration, { opacity: 0, rotation: base.rotation + 230 }),
      ],
    };
  });
}

export function buildQuizResult(source: Shape[], correctAnswer: string, duration = QUIZ_RESULT_DURATION): ResultBuild {
  const correct = correctAnswer.trim().toUpperCase() as QuizOption;
  if (!OPTIONS.includes(correct)) return { ok: false, message: "Escolha a alternativa A, B ou C." };

  const restored = source.filter((shape) => !isResultHelper(shape)).map(restore);
  const originals = new Map(restored.map((shape) => [shape.id, shape]));
  const clean = restored.map(settled);
  const groupIds = new Map<QuizOption, string[]>();
  for (const option of OPTIONS) groupIds.set(option, []);
  for (const shape of clean) {
    const option = optionForLetter(shape);
    if (option && shape.groupId && !groupIds.get(option)!.includes(shape.groupId)) groupIds.get(option)!.push(shape.groupId);
  }
  for (const option of OPTIONS) {
    const matches = groupIds.get(option)!;
    if (matches.length !== 1) return { ok: false, message: matches.length ? `A alternativa ${option} está duplicada.` : `Não encontrei a alternativa ${option} completa.` };
    const parts = answerGroupParts(clean, matches[0]);
    if (!parts.card || !parts.badge || !parts.letter || !parts.text) return { ok: false, message: `A alternativa ${option} precisa de card, selo, letra e texto.` };
  }

  const partsByOption = Object.fromEntries(OPTIONS.map((option) => [option, answerGroupParts(clean, groupIds.get(option)![0])])) as Record<QuizOption, ReturnType<typeof answerGroupParts>>;
  const revealAt = QUIZ_RESULT_REVEAL_AT;
  const updates = new Map<string, Shape>();
  const helpersAfter = new Map<string, Shape[]>();

  for (const option of OPTIONS) {
    const parts = partsByOption[option];
    const card = parts.card!;
    const baseCard = settled(card);
    const isCorrect = option === correct;
    const cardEnd = { ...baseCard, x: baseCard.x + (isCorrect ? -50 : 0), w: Math.max(360, baseCard.w + (isCorrect ? 100 : -120)) };
    for (const member of parts.members) {
      const start = settled(member);
      const isText = member.id === parts.text!.id;
      const moveLeft = isCorrect && member.id !== card.id;
      const end = {
        ...start,
        x: start.x + (moveLeft ? -50 : 0),
        w: isText ? Math.max(40, start.w + (isCorrect ? 100 : -120)) : start.w,
      };
      if (member.id === card.id) Object.assign(end, { x: cardEnd.x, w: cardEnd.w });
      const styled = {
        ...member,
        ...end,
        quizResultBase: snapshot(originals.get(member.id) ?? member),
        keyframes: resultFrames(start, end, revealAt, duration, isCorrect, member.id === card.id || isText),
      } as Shape;
      if (isCorrect && member.id === card.id) { styled.fill = "#23D978"; styled.fill2 = "#12B968"; styled.shadowColor = "#08744366"; }
      if (isCorrect && member.id === parts.badge!.id) { styled.fill = "#0E9F63"; styled.fill2 = undefined; }
      if (isCorrect && member.id === parts.text!.id) styled.fill = "#FFFFFF";
      updates.set(member.id, styled);
      if (isCorrect && (member.id === card.id || member.id === parts.badge!.id || member.id === parts.text!.id)) {
        const role = member.id === card.id ? "card" : member.id === parts.badge!.id ? "selo" : "texto";
        helpersAfter.set(member.id, [cover(member, start, end, option, role, revealAt, duration)]);
      }
    }
  }

  const visualCard = clean.find((shape) => shape.id === "visual-card") ?? clean.find((shape) => /^Imagem da pergunta$/i.test(shape.name ?? ""));
  if (visualCard) {
    const start = settled(visualCard);
    const zoom = { ...start, x: start.x - start.w * .015, y: start.y - start.h * .015, w: start.w * 1.03, h: start.h * 1.03 };
    updates.set(visualCard.id, { ...visualCard, ...start, quizResultBase: snapshot(originals.get(visualCard.id) ?? visualCard), keyframes: [frame(start, revealAt, { easing: "easeOut" }), frame(zoom, revealAt + .26, { easing: "easeOutBack" }), frame(start, revealAt + .58, { easing: "easeInOut" }), frame(start, QUIZ_RESULT_COMPLETE_AT), frame(start, duration)] });
  }

  const next: Shape[] = [];
  for (const shape of clean) {
    if (isProgress(shape)) continue;
    const updated = updates.get(shape.id) ?? shape;
    next.push(updated, ...(helpersAfter.get(shape.id) ?? []));
  }
  const correctCard = updates.get(partsByOption[correct].card!.id)!;
  next.push(...confetti(correctCard, revealAt, duration));
  return { ok: true, shapes: next, selectedId: partsByOption[correct].card!.id, revealAt };
}

export function handleQuizResultCommand(command: AICommand, ports: {
  shapes: Shape[];
  background: string;
  setShapes: (shapes: Shape[]) => void;
  setDuration: (duration: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  select: (id: string | null) => void;
  commit: (shapes: Shape[], background: string) => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  if (action !== "apply_quiz_result") return null;
  const answer = String(command.correctAnswer ?? command.answer ?? command.option ?? "");
  const result = buildQuizResult(ports.shapes, answer, QUIZ_RESULT_DURATION);
  if (!result.ok) return ports.report(action, result.message, false);
  ports.pause();
  ports.setDuration(QUIZ_RESULT_DURATION);
  ports.setShapes(result.shapes);
  ports.select(result.selectedId);
  ports.seek(0);
  ports.commit(result.shapes, ports.background);
  return ports.report(action, `Resultado ${answer.trim().toUpperCase()} revelado em 1s e mantido até 5s.`, true, result.selectedId);
}
