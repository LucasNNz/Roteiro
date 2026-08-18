import type { AlignmentAudit, MotionKeyframe, Shape } from "../../app/types.ts";
import { keyframeFromShape } from "../geometry.ts";

export const ANSWER_BADGE_COLOR = "#FF145B";

export function answerGroupParts(source: Shape[], groupId: string) {
  const members = source.filter((shape) => shape.groupId === groupId);
  return {
    members,
    card: members.find((shape) => /·\s*card$/i.test(shape.name ?? "")),
    badge: members.find((shape) => /·\s*selo$/i.test(shape.name ?? "")),
    letter: members.find((shape) => /·\s*letra$/i.test(shape.name ?? "")),
    text: members.find((shape) => /·\s*texto$/i.test(shape.name ?? "")),
  };
}

export function answerLetterOpticalOffset(letter: Shape) {
  const glyph = (letter.text ?? "").trim().toUpperCase();
  if (glyph === "A") return { x: 0, y: 3 };
  if (glyph === "B") return { x: 0, y: 1 };
  if (glyph === "C") return { x: 1, y: 1 };
  return { x: 0, y: 0 };
}

export function auditAnswerGroup(groupId: string, source: Shape[]): AlignmentAudit {
  const { card, badge, letter, text } = answerGroupParts(source, groupId);
  if (!card || !badge || !letter || !text) return { ok: false, score: 0, issues: [{ key: "structure", label: "Estrutura incompleta", delta: 100 }] };
  const optical = answerLetterOpticalOffset(letter);
  const badgeDiameter = Math.max(32, card.h - 8);
  const badgeTargetX = card.x + (card.h - badgeDiameter) / 2;
  const badgeTargetY = card.y + (card.h - badgeDiameter) / 2;
  const checks = [
    { key: "badge-x", label: "Círculo no centro da ponta", delta: Math.abs(badge.x - badgeTargetX) },
    { key: "badge-y", label: "Círculo no eixo do cartão", delta: Math.abs(badge.y - badgeTargetY) },
    { key: "badge-size", label: "Círculo na escala da referência", delta: Math.max(Math.abs(badge.w - badgeDiameter), Math.abs(badge.h - badgeDiameter)) },
    { key: "badge-color", label: "Cor sólida única nos selos", delta: badge.fill.toUpperCase() === ANSWER_BADGE_COLOR ? 0 : 20 },
    { key: "letter-x", label: "Letra centralizada horizontalmente", delta: Math.abs((letter.x + letter.w / 2) - (badge.x + badge.w / 2 + optical.x)) },
    { key: "letter-y", label: "Letra centralizada visualmente", delta: Math.abs((letter.y + letter.h / 2) - (badge.y + badge.h / 2 + optical.y)) },
    { key: "text-y", label: "Texto no eixo do cartão", delta: Math.abs((text.y + text.h / 2) - (card.y + card.h / 2)) },
    { key: "text-gap", label: "Respiro entre círculo e texto", delta: Math.abs((text.x - (badge.x + badge.w)) - 32) },
    { key: "text-right", label: "Margem direita do texto", delta: Math.abs(((card.x + card.w) - (text.x + text.w)) - 30) },
  ];
  const issues = checks.filter((check) => check.delta > 1.5);
  const average = checks.reduce((sum, check) => sum + Math.min(20, check.delta), 0) / checks.length;
  return { ok: issues.length === 0, score: Math.max(0, Math.round(100 - average * 5)), issues };
}

export function alignAnswerGroup(source: Shape[], groupId: string) {
  const { card, badge, letter, text } = answerGroupParts(source, groupId);
  if (!card || !badge || !letter || !text) return source;
  const optical = answerLetterOpticalOffset(letter);
  const targetBadge = (cardState: Pick<MotionKeyframe, "x" | "y" | "w" | "h">) => ({
    x: cardState.x + 4,
    y: cardState.y + 4,
    w: Math.max(32, cardState.h - 8),
    h: Math.max(32, cardState.h - 8),
  });
  const desired = (shape: Shape, cardState: Pick<MotionKeyframe, "x" | "y" | "w" | "h">, badgeState?: Pick<MotionKeyframe, "x" | "y" | "w" | "h">) => {
    if (shape.id === card.id) return { x: cardState.x, y: cardState.y, w: cardState.w, h: cardState.h };
    if (shape.id === badge.id) return targetBadge(cardState);
    const resolvedBadge = badgeState ?? targetBadge(cardState);
    if (shape.id === letter.id) return { x: resolvedBadge.x + optical.x, y: resolvedBadge.y + optical.y, w: resolvedBadge.w, h: resolvedBadge.h };
    const x = resolvedBadge.x + resolvedBadge.w + 32;
    return { x, y: cardState.y + (cardState.h - shape.h) / 2, w: Math.max(40, cardState.x + cardState.w - 30 - x), h: shape.h };
  };
  return source.map((shape) => {
    if (shape.groupId !== groupId) return shape;
    if (shape.id === card.id) return shape;
    const baseBadge = targetBadge(card);
    const base = desired(shape, card, baseBadge);
    const keyframes = shape.keyframes?.map((frame) => {
      const cardFrame = card.keyframes?.find((item) => Math.abs(item.time - frame.time) < .01) ?? { ...keyframeFromShape(card, frame.time), x: card.x + (frame.x - shape.x), y: card.y + (frame.y - shape.y) };
      const badgeFrame = targetBadge(cardFrame);
      return { ...frame, ...desired(shape, cardFrame, badgeFrame) };
    });
    return { ...shape, ...base, fill: shape.id === badge.id ? ANSWER_BADGE_COLOR : shape.fill, fill2: shape.id === badge.id ? undefined : shape.fill2, fontSize: shape.id === letter.id ? Math.round(baseBadge.h * .55) : shape.fontSize, keyframes };
  });
}
