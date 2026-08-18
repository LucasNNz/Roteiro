import type { Shape } from "../../app/types.ts";
import { cloneShapes, shapeAtTime } from "../geometry.ts";

export function derivePlaybackFrame(documentShapes: Shape[], time: number, liveShapeIds: ReadonlySet<string> = new Set()) {
  return documentShapes.map((shape) => liveShapeIds.has(shape.id) ? cloneShapes([shape])[0] : cloneShapes([shapeAtTime(shape, time)])[0]);
}
