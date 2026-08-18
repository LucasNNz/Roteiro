import type { AICommand, AIResult, Shape } from "../../../app/types.ts";

export function handleLayerCommand(command: AICommand, ports: {
  target: Shape | null; shapes: Shape[]; background: string; selectedId: string | null; width: number; height: number;
  makeId: () => string; setShapes: (shapes: Shape[]) => void; select: (id: string | null) => void;
  commit: (shapes: Shape[], background: string) => void; layerLabel: (shape: Shape) => string;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  const { target } = ports;
  if (action === "align") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const mode = text(command.mode ?? command.value, "center");
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape,
      x: mode === "left" ? 0 : mode === "right" ? ports.width - shape.w : ["center", "horizontal"].includes(mode) ? (ports.width - shape.w) / 2 : shape.x,
      y: mode === "top" ? 0 : mode === "bottom" ? ports.height - shape.h : ["center", "vertical"].includes(mode) ? (ports.height - shape.h) / 2 : shape.y,
    } : shape);
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} alinhado em ${mode}.`, true, target.id);
  }
  if (action === "duplicate") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const copy = { ...target, id: ports.makeId(), name: `${ports.layerLabel(target)} cópia`, x: target.x + 36, y: target.y + 36, keyframes: target.keyframes?.map((frame) => ({ ...frame })) };
    const next = [...ports.shapes, copy]; ports.setShapes(next); ports.select(copy.id); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} duplicado.`, true, copy.id);
  }
  if (action === "delete") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    if (target.locked && command.force !== true) return ports.report(action, "A camada está bloqueada.", false);
    const next = ports.shapes.filter((shape) => shape.id !== target.id); ports.setShapes(next); if (ports.selectedId === target.id) ports.select(null); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} excluído.`, true, null);
  }
  if (action === "lock" || action === "visibility") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const property = action === "lock" ? "locked" : "visible";
    const fallback = action === "lock" ? !target.locked : target.visible === false;
    const value = typeof command.value === "boolean" ? command.value : fallback;
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, [property]: value } : shape);
    ports.setShapes(next); if ((property === "visible" && !value) || (property === "locked" && value)) ports.select(null); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} ${value ? (action === "lock" ? "bloqueado" : "visível") : (action === "lock" ? "desbloqueado" : "oculto")}.`, true);
  }
  if (action === "lock_all" || action === "show_all") {
    const value = typeof command.value === "boolean" ? command.value : action === "lock_all";
    const next = ports.shapes.map((shape) => action === "lock_all" ? { ...shape, locked: value } : { ...shape, visible: value });
    ports.setShapes(next); if (action === "lock_all" && value) ports.select(null); ports.commit(next, ports.background);
    return ports.report(action, action === "lock_all" ? (value ? "Todas as camadas foram bloqueadas." : "Todas as camadas foram desbloqueadas.") : "Todas as camadas estão visíveis.");
  }
  if (action === "layer_order") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    const without = ports.shapes.filter((shape) => shape.id !== target.id);
    const mode = text(command.mode ?? command.value, "front");
    const next = mode === "back" ? [target, ...without] : [...without, target];
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} movido para ${mode === "back" ? "trás" : "frente"}.`, true, target.id);
  }
  return null;
}
