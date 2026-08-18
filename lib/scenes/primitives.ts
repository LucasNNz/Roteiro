import type { MotionEasing, MotionKeyframe, Shape, ShapeType } from "../../app/types.ts";
import { keyframeFromShape } from "../geometry.ts";

export function createScenePrimitives({ animationDuration, makeId }: { animationDuration: number; makeId: () => string }) {
  function proShape(type: ShapeType, name: string, x: number, y: number, w: number, h: number, patch: Partial<Shape> = {}): Shape {
    return { id: makeId(), type, name, x, y, w, h, rotation: 0, radius: type === "rect" ? 32 : 0, fill: "#FFFFFF", opacity: 1, visible: true, ...patch };
  }

  function entranceFrames(shape: Shape, delay = 0, direction: "left" | "right" | "top" | "bottom" | "zoom" = "left", duration = .55): MotionKeyframe[] {
    const endTime = Math.min(animationDuration, delay + duration);
    const end = keyframeFromShape(shape, endTime);
    let start = { ...keyframeFromShape(shape, delay), opacity: 0 };
    if (direction === "left") start.x -= Math.max(120, shape.w * .35);
    else if (direction === "right") start.x += Math.max(120, shape.w * .35);
    else if (direction === "top") start.y -= Math.max(90, shape.h * .5);
    else if (direction === "bottom") start.y += Math.max(90, shape.h * .5);
    else start = { ...start, x: shape.x + shape.w * .12, y: shape.y + shape.h * .12, w: shape.w * .76, h: shape.h * .76 };
    return [start, end];
  }

  function synchronizedEntranceFrames(shape: Shape, delay: number, dx: number, dy = 0, duration = .58): MotionKeyframe[] {
    const start = { ...keyframeFromShape(shape, delay), x: shape.x + dx, y: shape.y + dy, opacity: 0, easing: "easeOut" as MotionEasing };
    const end = keyframeFromShape(shape, Math.min(animationDuration, delay + duration));
    return [start, end];
  }

  function synchronizedAmbientFrames(shape: Shape, delay: number, sceneDuration: number, dx = 220): MotionKeyframe[] {
    const entrance = synchronizedEntranceFrames(shape, delay, dx, 0, .62);
    const settledAt = entrance[1].time;
    const middleAt = Math.max(settledAt + .2, sceneDuration * .58);
    if (middleAt >= sceneDuration - .12) return entrance;
    return [...entrance, { ...keyframeFromShape(shape, middleAt), y: shape.y - 5, easing: "easeInOut" }, keyframeFromShape(shape, sceneDuration)];
  }

  function ambientFrames(shape: Shape, entrance: MotionKeyframe[], sceneDuration: number, dx = 0, dy = -8, scale = .012): MotionKeyframe[] {
    const settledAt = entrance.at(-1)?.time ?? 0;
    const middleAt = Math.max(settledAt + .12, sceneDuration * .56);
    if (middleAt >= sceneDuration - .08) return entrance;
    const middle = keyframeFromShape(shape, middleAt);
    middle.x += dx - shape.w * scale / 2; middle.y += dy - shape.h * scale / 2; middle.w *= 1 + scale; middle.h *= 1 + scale;
    return [...entrance, middle, keyframeFromShape(shape, sceneDuration)];
  }

  return { proShape, entranceFrames, synchronizedEntranceFrames, synchronizedAmbientFrames, ambientFrames };
}

export function isGreenBackground(value: unknown) {
  if (typeof value !== "string") return false;
  const hex = value.trim().match(/^#([\da-f]{6})$/i)?.[1];
  if (!hex) return /green|verde/i.test(value);
  const red = parseInt(hex.slice(0, 2), 16); const green = parseInt(hex.slice(2, 4), 16); const blue = parseInt(hex.slice(4, 6), 16);
  return green > red * 1.22 && green > blue * 1.12;
}
