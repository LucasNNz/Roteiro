import type { FormaScene } from "../../app/types.ts";
import { shapeAtTime } from "../geometry.ts";
import { normalizeTransitionSpec, resolveTransitionNeighbors } from "./collection.ts";

export function retimedEditorialTime(scene: FormaScene, internalTime: number, preRoll = 1) {
  const duration = Math.max(.001, scene.animationDuration || 1);
  const internalDuration = duration + Math.max(0, preRoll);
  return Math.max(0, Math.min(duration, internalTime * duration / internalDuration));
}

export function deriveTransitionFrame(scenes: FormaScene[], transitionId: string, localTime: number) {
  const transition = scenes.find((scene) => scene.id === transitionId);
  if (!transition) return { valid: false as const, reason: "Cena de transição não encontrada." };
  const neighbors = resolveTransitionNeighbors(scenes, transitionId);
  if (!neighbors.valid || !neighbors.previous || !neighbors.next) return { valid: false as const, reason: neighbors.reason ?? "Transição inválida." };
  const spec = normalizeTransitionSpec(transition.transition);
  const time = Math.max(0, Math.min(spec.freezePrevious + spec.preRollNext, localTime));
  if (time < spec.freezePrevious) return { valid: true as const, phase: "freeze-previous" as const, baseScene: neighbors.previous, baseTime: neighbors.previous.animationDuration, overlayTime: time, previous: neighbors.previous, next: neighbors.next, spec };
  // A transicao revela a proxima cena sem consumir o relogio dela. O primeiro
  // frame fica parado ate a transicao terminar e a cena passar a ser ativa.
  return { valid: true as const, phase: "hold-next" as const, baseScene: neighbors.next, baseTime: 0, overlayTime: time, previous: neighbors.previous, next: neighbors.next, spec };
}

export function deriveContentFrameWithPreroll(scene: FormaScene, visibleTime: number, preRoll = 1) {
  return retimedEditorialTime(scene, Math.max(0, preRoll) + Math.max(0, visibleTime), preRoll);
}

export function deriveTransitionComposition(scenes: FormaScene[], transitionId: string, localTime: number) {
  const frame = deriveTransitionFrame(scenes, transitionId, localTime);
  const transition = scenes.find((scene) => scene.id === transitionId);
  if (!frame.valid || !transition) {
    return {
      ...frame,
      shapes: [],
      background: undefined,
      backgroundVideo: undefined,
      backgroundTime: 0,
    };
  }
  const prefix = `transition-source-${frame.baseScene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-`;
  const source = frame.baseScene.document.shapes.map((shape) => ({
    ...shapeAtTime(shape, frame.baseTime),
    id: `${prefix}${shape.id}`,
    groupId: shape.groupId ? `${prefix}${shape.groupId}` : undefined,
    locked: true,
  }));
  const overlay = transition.document.shapes.map((shape) => shapeAtTime(shape, frame.overlayTime));
  return {
    ...frame,
    shapes: [...source, ...overlay],
    background: frame.baseScene.document.background,
    backgroundVideo: frame.baseScene.document.backgroundVideo,
    backgroundTime: frame.baseTime,
  };
}
