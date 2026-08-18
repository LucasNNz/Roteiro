import type { MotionEasing, MotionKeyframe, Shape } from "@/app/types";

export function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "projeto";
}

export function cloneShapes(shapes: Shape[]) {
  return shapes.map((shape) => {
    const legacyAnswer = shape.name?.match(/^Alternativa\s+([^·]+?)\s*·/i)?.[1]?.trim();
    return {
      ...shape,
      groupId: shape.groupId ?? (legacyAnswer ? `answer-${safeFileName(legacyAnswer)}` : undefined),
      colorMatrix: shape.colorMatrix ? [...shape.colorMatrix] : undefined,
      keyframes: shape.keyframes?.map((keyframe) => ({ ...keyframe })),
      ...(shape.quizResultBase ? { quizResultBase: { ...shape.quizResultBase, keyframes: shape.quizResultBase.keyframes?.map((keyframe) => ({ ...keyframe })) } } : {}),
    };
  });
}

export function keyframeFromShape(shape: Shape, time: number): MotionKeyframe {
  return { time, x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: shape.rotation, radius: shape.radius, opacity: shape.opacity ?? 1 };
}

export function easeMotion(progress: number, easing: MotionEasing = "easeInOut") {
  const value = Math.max(0, Math.min(1, progress));
  if (easing === "linear") return value;
  if (easing === "easeIn") return value * value * value;
  if (easing === "easeOut") return 1 - Math.pow(1 - value, 3);
  if (easing === "easeOutBack") { const c = 1.24; return 1 + (c + 1) * Math.pow(value - 1, 3) + c * Math.pow(value - 1, 2); }
  return value < .5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function hasVisualAdjustments(shape: Shape) {
  return (shape.brightness ?? 100) !== 100 || (shape.contrast ?? 100) !== 100 || (shape.saturation ?? 100) !== 100 || (shape.hue ?? 0) !== 0 || shape.colorMatrix?.length === 20 || Boolean(shape.shadowColor && (shape.shadowBlur ?? 0) > 0);
}

export function mediaGeometry(shape: Shape) {
  const scale = Math.max(1, Math.min(4, shape.imageScale ?? 1));
  const width = shape.w * scale;
  const height = shape.h * scale;
  return { x: shape.x - (width - shape.w) / 2 + (shape.imageOffsetX ?? 0), y: shape.y - (height - shape.h) / 2 + (shape.imageOffsetY ?? 0), w: width, h: height };
}

export function brushPath(shape: Pick<Shape, "x" | "y" | "w" | "h">) {
  const { x, y, w, h } = shape;
  const edge = Math.min(w * .18, h * .28);
  const leftProfile: Array<[number, number]> = [
    [.58,0],[.30,.014],[.76,.032],[.68,.045],[.12,.061],[.84,.087],[.40,.103],[.92,.128],
    [.74,.151],[.18,.164],[.66,.183],[.46,.197],[.96,.232],[.70,.257],[.08,.276],[.82,.302],
    [.54,.321],[.16,.338],[.88,.374],[.64,.398],[.94,.431],[.28,.449],[.72,.472],[.10,.493],
    [.86,.527],[.60,.548],[.20,.567],[.98,.608],[.76,.636],[.36,.651],[.90,.684],[.14,.707],
    [.68,.729],[.44,.744],[.92,.781],[.24,.803],[.80,.829],[.56,.844],[.06,.866],[.88,.902],
    [.34,.919],[.74,.941],[.18,.957],[.82,.981],[.52,1],
  ];
  const rightProfile: Array<[number, number]> = [
    [.42,0],[.72,.013],[.16,.029],[.84,.052],[.62,.073],[.08,.091],[.78,.111],[.34,.126],
    [.92,.157],[.52,.181],[.12,.197],[.70,.216],[.48,.229],[.96,.265],[.74,.291],[.20,.307],
    [.86,.335],[.38,.351],[.10,.367],[.82,.401],[.58,.424],[.94,.459],[.30,.476],[.68,.496],
    [.06,.514],[.88,.551],[.64,.578],[.18,.594],[.76,.616],[.46,.632],[.98,.673],[.72,.699],
    [.14,.716],[.84,.744],[.40,.759],[.92,.793],[.26,.811],[.66,.831],[.04,.848],[.80,.884],
    [.54,.905],[.18,.919],[.90,.954],[.36,.971],[.70,1],
  ];
  const left = leftProfile.map(([depth, progress]) => [x + edge * depth, y + h * progress]);
  const right = [...rightProfile].reverse().map(([depth, progress]) => [x + w - edge * depth, y + h * progress]);
  const points = [...left, ...right];
  return `M ${points.map(([px, py]) => `${px} ${py}`).join(" L ")} Z`;
}

const sortedMotionKeyframeCache = new WeakMap<MotionKeyframe[], MotionKeyframe[]>();

export function sortedMotionKeyframes(frames: MotionKeyframe[] | undefined) {
  if (!frames?.length) return [] as MotionKeyframe[];
  const cached = sortedMotionKeyframeCache.get(frames);
  if (cached) return cached;
  const alreadySorted = frames.every((frame, index) => index === 0 || frames[index - 1].time <= frame.time);
  const sorted = alreadySorted ? frames : [...frames].sort((a, b) => a.time - b.time);
  sortedMotionKeyframeCache.set(frames, sorted);
  return sorted;
}

export function shapeAtTime(shape: Shape, time: number) {
  const frames = sortedMotionKeyframes(shape.keyframes);
  if (!frames.length) return shape;
  const values = (frame: MotionKeyframe) => ({ x: frame.x, y: frame.y, w: frame.w, h: frame.h, rotation: frame.rotation, radius: frame.radius, opacity: frame.opacity ?? 1 });
  if (frames.length === 1 || time <= frames[0].time) return { ...shape, ...values(frames[0]), keyframes: shape.keyframes };
  const last = frames[frames.length - 1];
  if (time >= last.time) return { ...shape, ...values(last), keyframes: shape.keyframes };
  const nextIndex = frames.findIndex((frame) => frame.time >= time);
  const before = frames[nextIndex - 1]; const after = frames[nextIndex];
  const eased = easeMotion((time - before.time) / Math.max(.001, after.time - before.time), before.easing);
  const mix = (start: number, end: number) => start + (end - start) * eased;
  return { ...shape, x: mix(before.x, after.x), y: mix(before.y, after.y), w: mix(before.w, after.w), h: mix(before.h, after.h), rotation: mix(before.rotation, after.rotation), radius: mix(before.radius, after.radius), opacity: mix(before.opacity ?? 1, after.opacity ?? 1) };
}

export function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[character]!));
}

export function balancedLines(value: string, maxCharacters = 40) {
  const explicit = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicit.length > 1 || value.length <= maxCharacters) return explicit.length ? explicit : [value];
  const words = value.trim().split(/\s+/);
  let bestIndex = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ");
    const right = words.slice(index).join(" ");
    const longest = Math.max(left.length, right.length);
    const overflow = Math.max(0, longest - maxCharacters);
    // Primeiro evita estouro; quando inevitável, ainda escolhe a divisão mais equilibrada.
    const score = overflow * 100 + Math.abs(left.length - right.length);
    if (score < bestScore) { bestIndex = index; bestScore = score; }
  }
  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")].filter(Boolean);
}
