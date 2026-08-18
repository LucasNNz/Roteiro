import type { AICommand, AIResult, Shape } from "../../../app/types.ts";

export function handleMediaVisualCommand(command: AICommand, ports: {
  target: Shape | null;
  shapes: Shape[];
  background: string;
  setShapes: (shapes: Shape[]) => void;
  commit: (shapes: Shape[], background: string) => void;
  layerLabel: (shape: Shape) => string;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  const { target } = ports;

  if (["update_intro_content", "edit_intro_content", "update_intro"].includes(action)) {
    const introIds = new Set(ports.shapes.map((shape) => shape.id));
    if (!introIds.has("intro-logo-title") || !introIds.has("intro-presentation-title")) return ports.report(action, "A cena ativa não é o preset de Entrada do CorvoQuiz.", false);
    const textFields: Array<[keyof AICommand, string]> = [
      ["channelName", "intro-logo-title"],
      ["logoTitle", "intro-logo-title"],
      ["badgeText", "intro-presentation-badge-text"],
      ["title", "intro-presentation-title"],
      ["headline", "intro-presentation-title"],
      ["subtitle", "intro-presentation-subtitle"],
      ["ctaTitle", "intro-subscribe-title"],
      ["subscribeBefore", "intro-subscribe-before"],
      ["subscribeAfter", "intro-subscribe-after"],
      ["subscribeTip", "intro-subscribe-tip"],
      ["likeIcon", "intro-like-icon"],
    ];
    const textById = new Map<string, string>();
    for (const [field, id] of textFields) {
      const value = command[field];
      if (typeof value === "string") textById.set(id, value);
    }
    const mascotSrc = text(command.mascotSrc ?? command.logoSrc ?? command.imageSrc ?? command.src);
    if (!textById.size && !mascotSrc) return ports.report(action, "Informe ao menos um texto da Entrada ou mascotSrc para alterar.", false);
    const mascotFit: Shape["objectFit"] = command.objectFit === "cover" ? "cover" : "contain";
    const next: Shape[] = ports.shapes.map((shape) => {
      const nextText = textById.get(shape.id);
      if (nextText !== undefined && shape.type === "text") return { ...shape, text: nextText };
      if (shape.id === "intro-logo-mascot" && mascotSrc) return { ...shape, src: mascotSrc, objectFit: mascotFit };
      return shape;
    });
    ports.setShapes(next); ports.commit(next, ports.background);
    const changed = [...textById.keys(), ...(mascotSrc ? ["intro-logo-mascot"] : [])];
    return ports.report(action, `Entrada atualizada pela IA (${changed.length} elemento(s)).`, true, changed.at(-1) ?? null);
  }

  if (action === "place_image") {
    if (!target || !["rect", "ellipse", "image"].includes(target.type)) return ports.report(action, "Selecione uma forma ou imagem.", false);
    if (target.locked && command.force !== true) return ports.report(action, "A camada está bloqueada. Use force: true para editar.", false);
    const source = text(command.src ?? command.imageSrc);
    if (!source) return ports.report(action, "Informe src ou imageSrc para posicionar a imagem.", false);
    const patch: Partial<Shape> = target.type === "image" ? { src: source } : { imageSrc: source };
    patch.imageScale = Math.max(1, Math.min(4, number(command.imageScale, target.imageScale ?? 1)));
    patch.imageOffsetX = number(command.imageOffsetX, target.imageOffsetX ?? 0);
    patch.imageOffsetY = number(command.imageOffsetY, target.imageOffsetY ?? 0);
    patch.objectFit = command.objectFit === "contain" ? "contain" : "cover";
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, ...patch } : shape);
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, `Imagem posicionada em ${ports.layerLabel(target)}.`, true, target.id);
  }

  if (action === "remove_image") {
    if (!target || !["rect", "ellipse"].includes(target.type)) return ports.report(action, "Selecione uma forma com imagem interna.", false);
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, imageSrc: undefined, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 } : shape);
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, `Imagem removida de ${ports.layerLabel(target)}.`, true, target.id);
  }

  if (action === "adjust_visual" || action === "reset_visual") {
    if (!target || target.type === "empty") return ports.report(action, "Selecione uma forma ou imagem.", false);
    const patch: Partial<Shape> = action === "reset_visual" ? { brightness: 100, contrast: 100, saturation: 100, hue: 0, colorMatrix: undefined } : {
      brightness: Math.max(0, Math.min(200, number(command.brightness, target.brightness ?? 100))),
      contrast: Math.max(0, Math.min(200, number(command.contrast, target.contrast ?? 100))),
      saturation: Math.max(0, Math.min(200, number(command.saturation, target.saturation ?? 100))),
      hue: Math.max(-180, Math.min(180, number(command.hue, target.hue ?? 0))),
      colorMatrix: Array.isArray(command.colorMatrix) && command.colorMatrix.length === 20 ? command.colorMatrix.map((value) => Number(value)) : target.colorMatrix,
    };
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, ...patch } : shape);
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, action === "reset_visual" ? "Ajustes visuais restaurados." : `Ajustes aplicados em ${ports.layerLabel(target)}.`, true, target.id);
  }

  if (action === "update" || action === "rename") {
    if (!target) return ports.report(action, "Selecione ou indique uma camada.", false);
    if (target.locked && command.force !== true) return ports.report(action, "A camada está bloqueada. Use force: true para editar.", false);
    const allowed = ["x", "y", "w", "h", "rotation", "radius", "fill", "fill2", "gradientAngle", "opacity", "stroke", "strokeWidth", "shadowColor", "shadowBlur", "shadowX", "shadowY", "text", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "src", "imageSrc", "imageScale", "imageOffsetX", "imageOffsetY", "objectFit", "brightness", "contrast", "saturation", "hue", "colorMatrix", "name", "visible", "locked"] as const;
    const patch: Partial<Shape> = {};
    for (const key of allowed) if (command[key] !== undefined) Object.assign(patch, { [key]: command[key] });
    if (action === "rename") patch.name = text(command.name ?? command.value, ports.layerLabel(target));
    const next = ports.shapes.map((shape) => shape.id === target.id ? { ...shape, ...patch } : shape);
    ports.setShapes(next); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(target)} atualizado.`, true, target.id);
  }
  return null;
}
