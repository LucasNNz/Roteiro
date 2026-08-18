import type { CanvasPreset, MotionKeyframe, Shape } from "../../app/types.ts";

export type TransitionPresetId = "blank" | "brush-lightning";

export const TRANSITION_PRESETS: Array<{ id: TransitionPresetId; label: string; description: string }> = [
  { id: "brush-lightning", label: "Pincel + Corvo", description: "Pincel dourado com o Corvo central substituível" },
  { id: "blank", label: "Transição vazia", description: "Somente a composição entre as cenas" },
];

export const DEFAULT_TRANSITION_COLOR = "#F59E0B";
export const DEFAULT_TRANSITION_ACCENT = "/transitions/corvo-default.png";
const LEGACY_TRANSITION_COLOR = "#35106B";
const LEGACY_TRANSITION_ACCENT = "/transitions/lightning-default.svg";

export function normalizeTransitionPresetId(value: unknown): TransitionPresetId {
  return value === "blank" ? "blank" : "brush-lightning";
}

const FORMAT_SIZE: Record<CanvasPreset, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

function frame(time: number, shape: Pick<Shape, "x" | "y" | "w" | "h" | "rotation" | "radius" | "opacity">, easing: MotionKeyframe["easing"] = "easeInOut"): MotionKeyframe {
  return { time, x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: shape.rotation, radius: shape.radius, opacity: shape.opacity ?? 1, easing };
}

export function createBrushLightningShapes(format: CanvasPreset, color = DEFAULT_TRANSITION_COLOR, accentSrc = DEFAULT_TRANSITION_ACCENT): Shape[] {
  const { width, height } = FORMAT_SIZE[format];
  const unit = Math.min(width, height);
  const brushWidth = width + Math.max(420, width * .28);
  const brushXAtCover = -Math.max(220, width * .13);
  const brushBase = { y: 0, w: brushWidth, h: height, rotation: 0, radius: 0, opacity: 1 };
  const brush: Shape = {
    id: "transition-brush-color",
    groupId: "transition-brush-lightning",
    type: "brush",
    name: "Pincel · cor editável",
    x: width + 40,
    ...brushBase,
    fill: color,
    shadowColor: "#7C2D12CC",
    shadowBlur: Math.max(36, unit * .045),
    shadowX: -Math.max(10, unit * .016),
    visible: true,
    keyframes: [
      frame(0, { x: width + 40, ...brushBase }, "easeIn"),
      frame(.72, { x: brushXAtCover, ...brushBase }, "easeOut"),
      frame(1.12, { x: brushXAtCover, ...brushBase }, "linear"),
      frame(2, { x: -brushWidth - 80, ...brushBase }, "easeIn"),
    ],
  };
  const accentW = Math.min(width * .32, height * .46);
  const accentH = accentW;
  const centerX = (width - accentW) / 2;
  const centerY = (height - accentH) / 2;
  const accentBase = { y: centerY, w: accentW, h: accentH, rotation: 0, radius: 0, opacity: 1 };
  const haloSize = accentW * 1.72;
  const haloBase = { x: (width - haloSize) / 2, y: (height - haloSize) / 2, w: haloSize, h: haloSize, rotation: 0, radius: haloSize / 2, opacity: 0 };
  const halo: Shape = {
    id: "transition-accent-halo",
    groupId: "transition-brush-lightning",
    type: "ellipse",
    name: "Impacto · halo luminoso",
    ...haloBase,
    fill: "#FFC247",
    shadowColor: "#FFF1B8EE",
    shadowBlur: Math.max(50, unit * .085),
    visible: true,
    locked: true,
    keyframes: [
      frame(0, haloBase, "linear"),
      frame(.48, { ...haloBase, w: haloSize * .54, h: haloSize * .54, x: (width - haloSize * .54) / 2, y: (height - haloSize * .54) / 2, opacity: 0 }, "easeOut"),
      frame(.70, { ...haloBase, w: haloSize * 1.12, h: haloSize * 1.12, x: (width - haloSize * 1.12) / 2, y: (height - haloSize * 1.12) / 2, radius: haloSize * .56, opacity: .30 }, "easeOut"),
      frame(1.02, { ...haloBase, opacity: .10 }, "easeInOut"),
      frame(1.30, { ...haloBase, opacity: .17 }, "easeOut"),
      frame(1.68, { ...haloBase, w: haloSize * 1.2, h: haloSize * 1.2, x: (width - haloSize * 1.2) / 2, y: (height - haloSize * 1.2) / 2, radius: haloSize * .6, opacity: 0 }, "easeIn"),
      frame(2, { ...haloBase, opacity: 0 }, "linear"),
    ],
  };
  const ringSize = accentW * 1.12;
  const ringBase = { x: (width - ringSize) / 2, y: (height - ringSize) / 2, w: ringSize, h: ringSize, rotation: 0, radius: ringSize / 2, opacity: 0 };
  const ring: Shape = {
    id: "transition-energy-ring",
    groupId: "transition-brush-lightning",
    type: "ellipse",
    name: "Impacto · anel de energia",
    ...ringBase,
    fill: "transparent",
    stroke: "#FFF7D6",
    strokeWidth: Math.max(5, unit * .007),
    shadowColor: "#FFB000FF",
    shadowBlur: Math.max(28, unit * .045),
    visible: true,
    locked: true,
    keyframes: [
      frame(0, ringBase, "linear"),
      frame(.58, { ...ringBase, w: ringSize * .68, h: ringSize * .68, x: (width - ringSize * .68) / 2, y: (height - ringSize * .68) / 2, radius: ringSize * .34, opacity: 0 }, "easeOut"),
      frame(.72, { ...ringBase, opacity: .92 }, "easeOut"),
      frame(1.08, { ...ringBase, w: ringSize * 1.48, h: ringSize * 1.48, x: (width - ringSize * 1.48) / 2, y: (height - ringSize * 1.48) / 2, radius: ringSize * .74, opacity: 0 }, "easeInOut"),
      frame(2, { ...ringBase, w: ringSize * 1.48, h: ringSize * 1.48, x: (width - ringSize * 1.48) / 2, y: (height - ringSize * 1.48) / 2, radius: ringSize * .74, opacity: 0 }, "linear"),
    ],
  };
  const accent: Shape = {
    id: "transition-accent-image",
    groupId: "transition-brush-lightning",
    type: "image",
    name: "Corvo · imagem substituível",
    x: width + accentW,
    ...accentBase,
    fill: "transparent",
    src: accentSrc,
    objectFit: "contain",
    shadowColor: "#FFF1B8EE",
    shadowBlur: Math.max(34, unit * .055),
    shadowY: Math.max(5, unit * .009),
    brightness: 112,
    contrast: 108,
    saturation: 112,
    visible: true,
    keyframes: [
      frame(0, { x: width + accentW, ...accentBase, rotation: -12, opacity: 0 }, "easeOutBack"),
      frame(.48, { x: centerX + accentW * .18, y: centerY + accentH * .13, w: accentW * .74, h: accentH * .74, rotation: -8, radius: 0, opacity: 0 }, "easeOutBack"),
      frame(.70, { x: centerX - accentW * .06, y: centerY - accentH * .06, w: accentW * 1.12, h: accentH * 1.12, rotation: 3, radius: 0, opacity: 1 }, "easeOutBack"),
      frame(.88, { x: centerX, ...accentBase }, "easeOut"),
      frame(1.08, { x: centerX - accentW * .025, y: centerY - accentH * .025, w: accentW * 1.05, h: accentH * 1.05, rotation: -1, radius: 0, opacity: 1 }, "easeInOut"),
      frame(1.24, { x: centerX, ...accentBase }, "easeOut"),
      frame(1.36, { x: centerX, ...accentBase }, "easeIn"),
      frame(2, { x: -accentW * 1.5, y: centerY + accentH * .08, w: accentW * .86, h: accentH * .86, rotation: -9, radius: 0, opacity: 0 }, "easeIn"),
    ],
  };
  const glintSize = Math.max(18, accentW * .13);
  const glintBase = { x: centerX + accentW * .12, y: centerY + accentH * .18, w: glintSize, h: glintSize, rotation: 0, radius: glintSize / 2, opacity: 0 };
  const glint: Shape = {
    id: "transition-accent-glint",
    groupId: "transition-brush-lightning",
    type: "ellipse",
    name: "Logo · brilho de passagem",
    ...glintBase,
    fill: "#FFF8DC",
    shadowColor: "#FFD978",
    shadowBlur: Math.max(22, unit * .035),
    visible: true,
    locked: true,
    keyframes: [
      frame(0, glintBase, "linear"),
      frame(.74, glintBase, "easeOut"),
      frame(.86, { ...glintBase, x: centerX + accentW * .48, y: centerY + accentH * .36, w: glintSize * 1.7, h: glintSize * 1.7, radius: glintSize * .85, opacity: .95 }, "easeOut"),
      frame(1.02, { ...glintBase, x: centerX + accentW * .72, y: centerY + accentH * .62, opacity: 0 }, "easeIn"),
      frame(2, { ...glintBase, x: centerX + accentW * .72, y: centerY + accentH * .62, opacity: 0 }, "linear"),
    ],
  };
  return [brush, halo, ring, accent, glint];
}

export function transitionPresetShapes(preset: string | undefined, format: CanvasPreset) {
  return preset === "blank" ? [] : createBrushLightningShapes(format);
}

export function upgradeTransitionPresetShapes(shapes: Shape[], format: CanvasPreset, preset: string | undefined) {
  if (preset !== "brush-lightning") return shapes;
  const withoutStraightBars = shapes.filter((shape) => shape.id !== "transition-light-sweep");
  const brush = withoutStraightBars.find((shape) => shape.id === "transition-brush-color");
  const accent = withoutStraightBars.find((shape) => shape.id === "transition-accent-image");
  if (!brush || !accent) return withoutStraightBars;
  const needsPremiumLayers = !withoutStraightBars.some((shape) => shape.id === "transition-accent-halo");
  const needsWarmPalette = brush.fill.toUpperCase() === LEGACY_TRANSITION_COLOR;
  const needsCorvo = accent.src === LEGACY_TRANSITION_ACCENT;
  if (!needsPremiumLayers && !needsWarmPalette && !needsCorvo) return withoutStraightBars;
  const nextColor = needsWarmPalette ? DEFAULT_TRANSITION_COLOR : brush.fill;
  const nextAccent = needsCorvo ? DEFAULT_TRANSITION_ACCENT : accent.src;
  const fresh = createBrushLightningShapes(format, nextColor, nextAccent);
  if (needsPremiumLayers) return fresh.map((shape) => {
    if (shape.id === brush.id) return { ...shape, name: brush.name ?? shape.name, visible: brush.visible, locked: brush.locked };
    if (shape.id === accent.id) return { ...shape, name: needsCorvo ? shape.name : accent.name ?? shape.name, visible: accent.visible, locked: accent.locked };
    return shape;
  });
  const freshById = new Map(fresh.map((shape) => [shape.id, shape]));
  return withoutStraightBars.map((shape) => {
    const replacement = freshById.get(shape.id);
    if (!replacement) return shape;
    if (shape.id === brush.id && needsWarmPalette) return { ...shape, fill: replacement.fill, shadowColor: replacement.shadowColor, shadowBlur: replacement.shadowBlur, shadowX: replacement.shadowX };
    if (shape.id === accent.id && needsCorvo) return { ...replacement, visible: shape.visible, locked: shape.locked };
    if (needsWarmPalette && shape.id === "transition-accent-halo") return { ...shape, fill: replacement.fill, shadowColor: replacement.shadowColor, shadowBlur: replacement.shadowBlur };
    if (needsWarmPalette && shape.id === "transition-energy-ring") return { ...shape, stroke: replacement.stroke, shadowColor: replacement.shadowColor, shadowBlur: replacement.shadowBlur };
    if (needsWarmPalette && shape.id === "transition-accent-glint") return { ...shape, fill: replacement.fill, shadowColor: replacement.shadowColor, shadowBlur: replacement.shadowBlur };
    return shape;
  });
}
