import type { AICommand, AIResult, MotionEasing, MotionKeyframe, Shape } from "../../../app/types.ts";
import { keyframeFromShape } from "../../geometry.ts";

export function handleAnimationCommand(command: AICommand, ports: {
  target: Shape | null; shapes: Shape[]; background: string; width: number; height: number; animationDuration: number; playhead: number;
  addOrReplaceKeyframe: (shapes: Shape[], targetId: string, time: number) => Shape[]; setShapes: (shapes: Shape[]) => void; select: (id: string | null) => void;
  openTimeline: () => void; setRecording: (id: string | null) => void; seek: (time: number) => void; commit: (shapes: Shape[], background: string) => void;
  layerLabel: (shape: Shape) => string; report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  const { target } = ports;
  if (action === "keyframe") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const mode = text(command.mode ?? command.value, "add");
    if (mode === "start") { ports.select(target.id); ports.openTimeline(); ports.setRecording(target.id); }
    else if (mode === "stop") ports.setRecording(null);
    else if (mode === "clear") { const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, keyframes: [] } : shape); ports.setShapes(next); ports.commit(next, ports.background); }
    else { const time = Math.max(0, Math.min(ports.animationDuration, number(command.time, ports.playhead))); const next = ports.addOrReplaceKeyframe(ports.shapes, target.id, time); ports.setShapes(next); ports.seek(time); ports.commit(next, ports.background); }
    return ports.report(action, `Keyframes de ${ports.layerLabel(target)}: ${mode}.`, true, target.id);
  }
  if (action === "set_keyframes") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    if (!Array.isArray(command.keyframes)) return ports.report(action, "Envie uma lista de keyframes.", false);
    const frames = command.keyframes.map((value) => { const frame = value as Partial<MotionKeyframe>; const base = keyframeFromShape(target, number(frame.time, 0)); return { ...base, time: Math.max(0, Math.min(ports.animationDuration, number(frame.time, 0))), x: number(frame.x, base.x), y: number(frame.y, base.y), w: number(frame.w, base.w), h: number(frame.h, base.h), rotation: number(frame.rotation, base.rotation), radius: number(frame.radius, base.radius), opacity: number(frame.opacity, base.opacity), easing: (["linear", "easeIn", "easeOut", "easeInOut", "easeOutBack"].includes(String(frame.easing)) ? frame.easing : "easeInOut") as MotionEasing }; }).sort((a, b) => a.time - b.time);
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, keyframes: frames } : shape); ports.setShapes(next); ports.openTimeline(); ports.seek(0); ports.commit(next, ports.background);
    return ports.report(action, `${frames.length} keyframes definidos em ${ports.layerLabel(target)}.`, true, target.id);
  }
  if (action === "animation_preset") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const preset = text(command.preset ?? command.value, "enter_left"); const endTime = Math.max(.2, Math.min(ports.animationDuration, number(command.duration, 1))); const end = keyframeFromShape(target, endTime); let start = keyframeFromShape(target, 0);
    if (preset === "enter_left") start = { ...start, x: -target.w - 40 }; else if (preset === "enter_right") start = { ...start, x: ports.width + 40 }; else if (preset === "enter_top") start = { ...start, y: -target.h - 40 }; else if (preset === "enter_bottom") start = { ...start, y: ports.height + 40 }; else if (preset === "zoom_in") start = { ...start, x: target.x + target.w / 2, y: target.y + target.h / 2, w: 8, h: 8, radius: 4 }; else if (preset === "spin_in") start = { ...start, rotation: target.rotation - 180, x: target.x + target.w * .2, y: target.y + target.h * .2, w: target.w * .6, h: target.h * .6 };
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, keyframes: [start, end] } : shape); ports.setShapes(next); ports.select(target.id); ports.openTimeline(); ports.seek(0); ports.commit(next, ports.background);
    return ports.report(action, `Animação ${preset} aplicada a ${ports.layerLabel(target)}.`, true, target.id);
  }
  return null;
}
