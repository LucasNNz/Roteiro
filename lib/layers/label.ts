import type { Shape } from "@/app/types";

export function layerLabel(shape: Pick<Shape, "name" | "type">) {
  if (shape.name) return shape.name;
  if (shape.type === "image") return "Imagem";
  if (shape.type === "text") return "Texto";
  if (shape.type === "empty") return "Camada vazia";
  if (shape.type === "brush") return "Pincel";
  return shape.type === "rect" ? "Retângulo" : "Círculo";
}
