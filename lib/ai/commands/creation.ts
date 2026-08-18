import type { AICommand, AIResult, Shape, ShapeType } from "../../../app/types.ts";

export function handleCreationCommand(command: AICommand, ports: {
  target: Shape | null;
  shapes: Shape[];
  background: string;
  shapeColor: string;
  width: number;
  height: number;
  animationDuration: number;
  makeId: () => string;
  addEmptyLayer: () => void;
  componentShapes: (component: string, options: AICommand) => Shape[];
  createScene: (scene: string, options: AICommand, duration: number) => Shape[];
  setShapes: (shapes: Shape[]) => void;
  select: (id: string | null) => void;
  selectTool: () => void;
  pause: () => void;
  stopRecording: () => void;
  setDuration: (duration: number) => void;
  setLandscape: () => void;
  setBackground: (background: string) => void;
  resetView: () => void;
  openTimeline: () => void;
  commit: (shapes: Shape[], background: string, format?: "landscape") => void;
  seek: (time: number) => void;
  schedulePlay: () => void;
  layerLabel: (shape: Shape) => string;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;

  if (action === "add") {
    const requestedType = text(command.type, "rect") as ShapeType;
    if (!["rect", "ellipse", "text", "image", "empty"].includes(requestedType)) return ports.report(action, "Tipo de camada não reconhecido.", false);
    if (requestedType === "empty") { ports.addEmptyLayer(); return ports.report(action, "Camada vazia criada.", true); }
    const defaultW = requestedType === "text" ? 520 : requestedType === "image" ? 560 : 360;
    const defaultH = requestedType === "text" ? 150 : requestedType === "image" ? 360 : 260;
    const w = Math.max(8, number(command.w, defaultW));
    const h = Math.max(8, number(command.h, defaultH));
    const id = ports.makeId();
    const shape: Shape = {
      id, type: requestedType, x: number(command.x, (ports.width - w) / 2), y: number(command.y, (ports.height - h) / 2), w, h,
      rotation: number(command.rotation, 0), radius: number(command.radius, requestedType === "rect" ? 24 : 0),
      fill: text(command.fill, ports.shapeColor), fill2: text(command.fill2) || undefined, gradientAngle: number(command.gradientAngle, 0), opacity: number(command.opacity, 1),
      stroke: text(command.stroke, "#13151A"), strokeWidth: number(command.strokeWidth, 0), shadowColor: text(command.shadowColor) || undefined,
      shadowBlur: number(command.shadowBlur, 0), shadowX: number(command.shadowX, 0), shadowY: number(command.shadowY, 0),
      name: text(command.name, requestedType === "rect" ? "Retângulo IA" : requestedType === "ellipse" ? "Círculo IA" : requestedType === "text" ? "Texto IA" : "Imagem IA"), visible: true,
      text: requestedType === "text" ? text(command.text, "Seu texto") : undefined,
      fontSize: requestedType === "text" ? number(command.fontSize, 120) : undefined,
      fontWeight: requestedType === "text" ? 700 : undefined,
      letterSpacing: requestedType === "text" ? number(command.letterSpacing, 0) : undefined,
      lineHeight: requestedType === "text" ? number(command.lineHeight, 1.08) : undefined,
      src: requestedType === "image" ? text(command.src) : undefined,
      imageSrc: (requestedType === "rect" || requestedType === "ellipse") ? text(command.imageSrc) || undefined : undefined,
      imageScale: number(command.imageScale, 1), imageOffsetX: number(command.imageOffsetX, 0), imageOffsetY: number(command.imageOffsetY, 0),
      brightness: number(command.brightness, 100), contrast: number(command.contrast, 100), saturation: number(command.saturation, 100), hue: number(command.hue, 0),
      objectFit: command.objectFit === "contain" ? "contain" : "cover",
    };
    if (requestedType === "image" && !shape.src) return ports.report(action, "Para criar uma imagem por comando, informe src ou use a Galeria.", false);
    const next = [...ports.shapes, shape];
    ports.setShapes(next); ports.select(id); ports.selectTool(); ports.commit(next, ports.background);
    return ports.report(action, `${ports.layerLabel(shape)} criado e selecionado.`, true, id);
  }

  if (action === "add_component") {
    const component = text(command.component ?? command.value, "panel");
    const created = ports.componentShapes(component, command);
    if (!created.length) return ports.report(action, `Componente não reconhecido: ${component}.`, false);
    const next = [...ports.shapes, ...created];
    ports.setShapes(next); ports.select(created.at(-1)?.id ?? null); ports.selectTool(); ports.commit(next, ports.background);
    return ports.report(action, `Componente ${component} criado com ${created.length} camadas animadas.`, true, created.at(-1)?.id ?? null);
  }

  if (action === "create_scene") {
    const scene = text(command.scene ?? command.value, "quiz_question");
    if (!["quiz_question", "letter_challenge", "would_you_rather", "toguro_quiz"].includes(scene)) return ports.report(action, `Cena não reconhecida: ${scene}.`, false);
    const requestedDuration = Math.max(1, Math.min(60, number(command.duration, ports.animationDuration)));
    const next = ports.createScene(scene, command, requestedDuration);
    const defaultBackground = scene === "toguro_quiz" ? "#071E5C" : scene === "quiz_question" ? "#F02A91" : "#6300CF";
    const sceneBackground = text(command.background ?? command.backgroundColor, defaultBackground);
    ports.pause(); ports.stopRecording(); ports.setDuration(requestedDuration); ports.setLandscape(); ports.setBackground(sceneBackground); ports.setShapes(next); ports.select(null); ports.resetView(); ports.openTimeline();
    ports.commit(next, sceneBackground, "landscape"); ports.seek(0); ports.schedulePlay();
    return ports.report(action, `Cena ${scene} criada com ${next.length} camadas, fundo animado e ${requestedDuration}s.`, true, null);
  }

  if (action === "select") {
    if (!ports.target) return ports.report(action, "Camada não encontrada.", false);
    ports.select(ports.target.id); ports.selectTool();
    return ports.report(action, `${ports.layerLabel(ports.target)} selecionado.`, true, ports.target.id);
  }
  return null;
}
