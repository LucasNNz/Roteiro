import type { CanvasPreset, FormaScene, MotionKeyframe, Shape } from "../../app/types.ts";
import { adaptShapesForFormat } from "../layout/corvoquiz-responsive.ts";

export const INTRO_PRESET_DURATION = 18;
export const INTRO_PRESET_ID = "corvoquiz-intro-18s";

type ShapePatch = Partial<Omit<Shape, "id" | "type" | "x" | "y" | "w" | "h" | "rotation" | "fill">>;

function shape(type: Shape["type"], id: string, name: string, x: number, y: number, w: number, h: number, fill: string, patch: ShapePatch = {}): Shape {
  return { id, type, name, x, y, w, h, rotation: 0, radius: type === "rect" ? 32 : 0, fill, opacity: 1, visible: true, ...patch };
}

function frame(source: Shape, time: number, patch: Partial<MotionKeyframe> = {}, easing: MotionKeyframe["easing"] = "easeInOut"): MotionKeyframe {
  return { time, x: source.x, y: source.y, w: source.w, h: source.h, rotation: source.rotation, radius: source.radius, opacity: source.opacity ?? 1, easing, ...patch };
}

function reveal(source: Shape, start: number, end: number, enterScale = .88, fadeOut = true): MotionKeyframe[] {
  const cx = source.x + source.w / 2;
  const cy = source.y + source.h / 2;
  const hidden = { x: cx - source.w * enterScale / 2, y: cy - source.h * enterScale / 2 + 34, w: source.w * enterScale, h: source.h * enterScale, opacity: 0 };
  const overshootScale = 1.025;
  const overshoot = { x: cx - source.w * overshootScale / 2, y: cy - source.h * overshootScale / 2 - 7, w: source.w * overshootScale, h: source.h * overshootScale, opacity: source.opacity ?? 1 };
  const frames: MotionKeyframe[] = [
    frame(source, 0, { opacity: 0 }, "linear"),
    frame(source, start, hidden, "easeOutBack"),
    frame(source, Math.min(end, start + .62), overshoot, "easeOut"),
    frame(source, Math.min(end, start + .86), { opacity: source.opacity ?? 1 }, "easeInOut"),
  ];
  if (!fadeOut) return [...frames, frame(source, Math.max(start + .86, end - 1), { opacity: source.opacity ?? 1 }, "linear"), frame(source, end, { opacity: source.opacity ?? 1 }, "linear")];
  return [...frames, frame(source, Math.max(start + .86, end - .5), { y: source.y - 6, opacity: source.opacity ?? 1 }, "easeInOut"), frame(source, end, { y: source.y - 22, opacity: 0 }, "easeIn"), frame(source, INTRO_PRESET_DURATION, { opacity: 0 }, "linear")];
}

function wipe(id: string, name: string, y: number, color: string, start: number, end: number, delay: number): Shape {
  const item = shape("rect", id, name, -2180, y, 2180, 245, color, { radius: 120, shadowColor: `${color}88`, shadowBlur: 36 });
  item.keyframes = [
    frame(item, 0, { opacity: 0 }, "linear"),
    frame(item, start + delay, { x: -2180, opacity: 0 }, "easeInOut"),
    frame(item, start + .68 + delay, { x: -140, opacity: 1 }, "easeOut"),
    frame(item, end - .62 + delay, { x: 80, opacity: 1 }, "easeInOut"),
    frame(item, Math.min(INTRO_PRESET_DURATION, end + delay), { x: 2100, opacity: 0 }, "easeIn"),
    frame(item, INTRO_PRESET_DURATION, { x: 2100, opacity: 0 }, "linear"),
  ];
  return item;
}

function createIntroPresetLandscapeShapes(): Shape[] {
  const logoHalo = shape("ellipse", "intro-logo-halo", "Entrada · halo do logo", 615, 155, 690, 690, "#FFFFFF", { opacity: .16, shadowColor: "#FFFFFF", shadowBlur: 95 });
  const logoMascot = shape("image", "intro-logo-mascot", "Entrada · mascote", 735, 215, 450, 450, "transparent", { src: "/transitions/corvo-default.png", objectFit: "contain" });
  const logoTitle = shape("text", "intro-logo-title", "Entrada · nome do canal", 485, 700, 950, 150, "#FFFFFF", { text: "CORVO QUIZ", fontSize: 118, fontWeight: 900, letterSpacing: 4, stroke: "#102356", strokeWidth: 9, shadowColor: "#07163A99", shadowBlur: 24, shadowY: 12 });
  logoHalo.keyframes = [frame(logoHalo, 0, { x: 700, y: 240, w: 520, h: 520, opacity: 0 }, "easeOut"), frame(logoHalo, .78, { x: 600, y: 140, w: 720, h: 720, opacity: .18 }, "easeInOut"), frame(logoHalo, 1.72, { x: 615, y: 155, w: 690, h: 690, opacity: .16 }, "easeInOut"), frame(logoHalo, 2.12, { opacity: 0 }, "easeIn"), frame(logoHalo, 18, { opacity: 0 }, "linear")];
  logoMascot.keyframes = [frame(logoMascot, 0, { x: 795, y: 275, w: 330, h: 330, rotation: -5, opacity: 0 }, "easeOutBack"), frame(logoMascot, .72, { x: 720, y: 200, w: 480, h: 480, rotation: 1.5, opacity: 1 }, "easeOut"), frame(logoMascot, 1.02, { rotation: 0, opacity: 1 }, "easeInOut"), frame(logoMascot, 1.76, { y: 207, opacity: 1 }, "easeInOut"), frame(logoMascot, 2.12, { y: 190, opacity: 0 }, "easeIn"), frame(logoMascot, 18, { opacity: 0 }, "linear")];
  logoTitle.keyframes = [frame(logoTitle, 0, { y: 770, opacity: 0 }, "easeOutBack"), frame(logoTitle, .35, { y: 770, opacity: 0 }, "easeOutBack"), frame(logoTitle, .98, { y: 688, opacity: 1 }, "easeOut"), frame(logoTitle, 1.22, { y: 700, opacity: 1 }, "easeInOut"), frame(logoTitle, 1.74, { opacity: 1 }, "easeInOut"), frame(logoTitle, 2.1, { y: 680, opacity: 0 }, "easeIn"), frame(logoTitle, 18, { opacity: 0 }, "linear")];

  const introBadge = shape("rect", "intro-presentation-badge", "Apresentação · selo", 650, 180, 620, 82, "#FFD94A", { radius: 41, shadowColor: "#07163A66", shadowBlur: 18, shadowY: 9 });
  const introBadgeText = shape("text", "intro-presentation-badge-text", "Apresentação · selo texto", 650, 196, 620, 58, "#102356", { text: "CORVO QUIZ APRESENTA", fontSize: 38, fontWeight: 900, letterSpacing: 3 });
  const introHeadline = shape("text", "intro-presentation-title", "Apresentação · título", 210, 320, 1500, 315, "#FFFFFF", { text: "VOCÊ CONSEGUE\nACERTAR?", fontSize: 142, fontWeight: 900, lineHeight: 1.02, stroke: "#102356", strokeWidth: 11, shadowColor: "#06153AAA", shadowBlur: 28, shadowY: 16 });
  const introSub = shape("text", "intro-presentation-subtitle", "Apresentação · subtítulo", 360, 720, 1200, 85, "#A9F6FF", { text: "DESAFIOS RÁPIDOS • RESPOSTAS SURPREENDENTES", fontSize: 38, fontWeight: 900, letterSpacing: 2, stroke: "#102356", strokeWidth: 4 });
  [introBadge, introBadgeText, introHeadline, introSub].forEach((item, index) => { item.keyframes = reveal(item, 4.05 + index * .12, 10.05, index === 2 ? .76 : .9); });

  const subscribePanel = shape("rect", "intro-subscribe-panel", "Inscrição · painel", 285, 280, 1350, 500, "#FFFFFF", { radius: 72, shadowColor: "#06153AAA", shadowBlur: 48, shadowY: 24 });
  const likeCircle = shape("ellipse", "intro-like-circle", "Inscrição · curtir", 405, 410, 250, 250, "#FF4D5E", { shadowColor: "#FF4D5E88", shadowBlur: 30 });
  const likeText = shape("text", "intro-like-icon", "Inscrição · ícone curtir", 405, 455, 250, 150, "#FFFFFF", { text: "♥", fontSize: 132, fontWeight: 900 });
  const subscribeTitle = shape("text", "intro-subscribe-title", "Inscrição · chamada", 700, 335, 720, 105, "#102356", { text: "GOSTOU DO QUIZ?", fontSize: 66, fontWeight: 900, letterSpacing: 1 });
  const subscribeButton = shape("rect", "intro-subscribe-button", "Inscrição · botão", 700, 485, 660, 150, "#FF334A", { radius: 40, shadowColor: "#FF334A77", shadowBlur: 30, shadowY: 12 });
  const subscribeBefore = shape("text", "intro-subscribe-before", "Inscrição · texto inscreva-se", 700, 522, 660, 82, "#FFFFFF", { text: "INSCREVA-SE", fontSize: 61, fontWeight: 900, letterSpacing: 2 });
  const subscribeAfter = shape("text", "intro-subscribe-after", "Inscrição · texto inscrito", 700, 522, 660, 82, "#FFFFFF", { text: "INSCRITO  ✓", fontSize: 61, fontWeight: 900, letterSpacing: 2 });
  const subscribeTip = shape("text", "intro-subscribe-tip", "Inscrição · lembrete", 700, 665, 660, 55, "#52617E", { text: "ATIVE O SININHO PARA NÃO PERDER NENHUM DESAFIO", fontSize: 25, fontWeight: 900, letterSpacing: 1 });
  [subscribePanel, likeCircle, likeText, subscribeTitle, subscribeButton, subscribeTip].forEach((item, index) => { item.keyframes = reveal(item, 12.05 + index * .1, INTRO_PRESET_DURATION, index === 0 ? .82 : .9, false); });
  subscribeBefore.keyframes = reveal(subscribeBefore, 12.48, 14.55, .88);
  subscribeAfter.keyframes = reveal(subscribeAfter, 14.5, INTRO_PRESET_DURATION, .9, false);
  likeCircle.keyframes = [...(likeCircle.keyframes ?? []).slice(0, 3), frame(likeCircle, 13.4, { x: 382, y: 387, w: 296, h: 296, opacity: 1 }, "easeOutBack"), frame(likeCircle, 13.78, { opacity: 1 }, "easeInOut"), frame(likeCircle, 17, { opacity: 1 }, "linear"), frame(likeCircle, 18, { opacity: 1 }, "linear")];

  return [
    logoHalo, logoMascot, logoTitle,
    wipe("intro-wipe-a1", "Passagem 1 · faixa amarela", -85, "#FFD94A", 1.88, 3.82, 0),
    wipe("intro-wipe-a2", "Passagem 1 · faixa ciano", 245, "#21D7E8", 1.88, 3.82, .1),
    wipe("intro-wipe-a3", "Passagem 1 · faixa azul", 575, "#355CFF", 1.88, 3.82, .2),
    introBadge, introBadgeText, introHeadline, introSub,
    wipe("intro-wipe-b1", "Passagem 2 · faixa roxa", -85, "#7B4DFF", 9.86, 11.82, 0),
    wipe("intro-wipe-b2", "Passagem 2 · faixa rosa", 245, "#FF4D92", 9.86, 11.82, .1),
    wipe("intro-wipe-b3", "Passagem 2 · faixa amarela", 575, "#FFD94A", 9.86, 11.82, .2),
    subscribePanel, likeCircle, likeText, subscribeTitle, subscribeButton, subscribeBefore, subscribeAfter, subscribeTip,
  ];
}

export function createIntroPresetShapes(format: CanvasPreset = "landscape"): Shape[] {
  const base = createIntroPresetLandscapeShapes();
  return format === "landscape" ? base : adaptShapesForFormat(base, "landscape", format);
}

export function createIntroScene(id: string, name = "Entrada", format: CanvasPreset = "landscape"): FormaScene {
  return {
    id,
    name,
    kind: "intro",
    animationDuration: INTRO_PRESET_DURATION,
    document: { shapes: createIntroPresetShapes(format), background: "#087EDB", backgroundVideo: "/backgrounds/corvoquiz-azul.mp4", format },
  };
}

export function refreshIntroPresetMotion(scene: FormaScene): FormaScene {
  const isCorvoIntro = scene.document.shapes.some((item) => item.id === "intro-logo-title");
  if (!isCorvoIntro) return scene;
  const premiumMotion = new Map(createIntroPresetShapes(scene.document.format ?? "landscape").map((item) => [item.id, item.keyframes]));
  const shapes = scene.document.shapes.flatMap((item) => {
    if (item.id === "intro-outro-wipe") return [];
    const keyframes = premiumMotion.get(item.id);
    return [{ ...item, ...(keyframes ? { keyframes: keyframes.map((keyframe) => ({ ...keyframe })) } : {}) }];
  });
  return { ...scene, kind: "intro", animationDuration: INTRO_PRESET_DURATION, document: { ...scene.document, shapes } };
}
