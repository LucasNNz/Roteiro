import type { AICommand, AIResult, AlignmentAudit, CanvasPreset, Shape } from "../../../app/types.ts";

export function handleOrganizationCommand(command: AICommand, ports: {
  target: Shape | null; shapes: Shape[]; background: string; selectedId: string | null; selectedAnswerGroup: string | null; width: number; height: number;
  setShapes: (shapes: Shape[]) => void; select: (id: string | null) => void; setBackground: (background: string) => void;
  commit: (shapes: Shape[], background: string) => void; changeFormat: (format: CanvasPreset) => void;
  auditAnswerGroup: (groupId: string) => AlignmentAudit; repairAnswerAlignment: (groupId: string) => void; distributeAnswerGroups: () => void; openAlignment: () => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  if (action === "arrange_grid") {
    const items = ports.shapes.filter((shape) => shape.type !== "empty" && !shape.locked);
    const columns = Math.max(1, Math.ceil(Math.sqrt(items.length))); const gap = number(command.gap, 32); const cellW = ports.width / columns;
    const rows = Math.max(1, Math.ceil(items.length / columns)); const cellH = ports.height / rows; const indexById = new Map(items.map((shape, index) => [shape.id, index]));
    const next = ports.shapes.map((shape) => { const index = indexById.get(shape.id); if (index === undefined) return shape; const scale = Math.min(1, (cellW - gap * 2) / shape.w, (cellH - gap * 2) / shape.h); const w = shape.w * scale; const h = shape.h * scale; const column = index % columns; const row = Math.floor(index / columns); return { ...shape, w, h, x: column * cellW + (cellW - w) / 2, y: row * cellH + (cellH - h) / 2 }; });
    ports.setShapes(next); ports.commit(next, ports.background); return ports.report(action, `${items.length} camadas organizadas em grade.`);
  }
  if (action === "audit_alignment") {
    const groupId = ports.target?.groupId?.startsWith("answer-") ? ports.target.groupId : ports.selectedAnswerGroup;
    if (!groupId) return ports.report(action, "Selecione uma alternativa A, B ou C.", false);
    const audit = ports.auditAnswerGroup(groupId); ports.select(ports.target?.id ?? ports.selectedId); ports.openAlignment();
    return ports.report(action, audit.ok ? `Componente alinhado com precisão de ${audit.score}%.` : `${audit.issues.length} ajuste(s) necessário(s). Precisão atual: ${audit.score}%.`, audit.ok, ports.target?.id ?? ports.selectedId);
  }
  if (action === "align_component") {
    const groupId = ports.target?.groupId?.startsWith("answer-") ? ports.target.groupId : ports.selectedAnswerGroup;
    if (!groupId) return ports.report(action, "Selecione uma alternativa A, B ou C.", false);
    ports.repairAnswerAlignment(groupId); ports.openAlignment(); return ports.report(action, "Círculo, letra e texto foram alinhados ao cartão.", true, ports.target?.id ?? ports.selectedId);
  }
  if (action === "distribute_answers") { ports.distributeAnswerGroups(); ports.openAlignment(); return ports.report(action, "Alternativas distribuídas com eixo e espaçamento uniformes."); }
  if (action === "apply_palette") {
    const palette = Array.isArray(command.colors) ? command.colors.filter((color): color is string => typeof color === "string") : ["#7C5CFC", "#FFD43B", "#30C77B", "#FF6B5F"];
    if (!palette.length) return ports.report(action, "Informe ao menos uma cor.", false);
    let index = 0; const next = ports.shapes.map((shape) => shape.type === "image" || shape.type === "empty" || shape.locked ? shape : { ...shape, fill: palette[index++ % palette.length] });
    ports.setShapes(next); ports.commit(next, ports.background); return ports.report(action, "Paleta aplicada às camadas editáveis.");
  }
  if (action === "canvas") {
    const nextBackground = text(command.background, ports.background); if (nextBackground !== ports.background) { ports.setBackground(nextBackground); ports.commit(ports.shapes, nextBackground); }
    const requestedFormat = text(command.format) as CanvasPreset; if (["square", "landscape", "portrait"].includes(requestedFormat)) ports.changeFormat(requestedFormat);
    return ports.report(action, `Canvas atualizado${requestedFormat ? ` para ${requestedFormat}` : ""}.`);
  }
  if (action === "clear") {
    const next = command.force === true ? [] : ports.shapes.filter((shape) => shape.locked);
    ports.setShapes(next); ports.select(null); ports.commit(next, ports.background); return ports.report(action, command.force === true ? "Documento limpo." : "Camadas desbloqueadas removidas.", true, null);
  }
  return null;
}
