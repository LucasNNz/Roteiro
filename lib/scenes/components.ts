import type { AICommand, Shape } from "../../app/types.ts";
import { keyframeFromShape, safeFileName } from "../geometry.ts";
import { createScenePrimitives } from "./primitives.ts";
import { DEFAULT_PROGRESS_ICON_SOURCE } from "./progress-icon.ts";

export function createSceneComponents({ width, height, animationDuration, answerBadgeColor, makeId, answerLetterOpticalOffset }: {
  width: number;
  height: number;
  animationDuration: number;
  answerBadgeColor: string;
  makeId: () => string;
  answerLetterOpticalOffset: (letter: Shape) => { x: number; y: number };
}) {
  const { proShape, entranceFrames, synchronizedEntranceFrames } = createScenePrimitives({ animationDuration, makeId });
  return function componentShapes(component: string, options: AICommand = {}): Shape[] {
    const cx = typeof options.x === "number" ? options.x : width / 2;
    const cy = typeof options.y === "number" ? options.y : height / 2;
    const primary = typeof options.color === "string" ? options.color : "#FF145B";
    const label = typeof options.label === "string" ? options.label : "A";
    const content = typeof options.text === "string" ? options.text : "Alternativa";
    if (component === "answer") {
      const groupId = `answer-${safeFileName(label)}-${makeId()}`;
      const card = proShape("rect", `Alternativa ${label} · card`, cx - 330, cy - 68, 660, 136, { radius: 42, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 7, shadowColor: "#5B174B66", shadowBlur: 22, shadowY: 14 });
      const badge = proShape("ellipse", `Alternativa ${label} · selo`, cx - 326, cy - 64, 128, 128, { fill: answerBadgeColor, stroke: "#FFFFFF", strokeWidth: 7, shadowColor: "#62183A55", shadowBlur: 12, shadowY: 7 });
      const letterSeed = proShape("text", `Alternativa ${label} · letra`, cx - 326, cy - 64, 128, 128, { fill: "#FFFFFF", text: label, fontSize: 70, fontWeight: 900, lineHeight: 1 });
      const optical = answerLetterOpticalOffset(letterSeed);
      const letter = { ...letterSeed, x: letterSeed.x + optical.x, y: letterSeed.y + optical.y };
      const answer = proShape("text", `Alternativa ${label} · texto`, cx - 166, cy - 43, 466, 86, { fill: "#111319", text: content, fontSize: 60, fontWeight: 900, lineHeight: 1 });
      return [card, badge, letter, answer].map((shape) => ({ ...shape, groupId, keyframes: synchronizedEntranceFrames(shape, 0, 220) }));
    }
    if (component === "progress") {
      const groupId = `progress-${makeId()}`;
      const progressWidth = typeof options.w === "number" ? Math.max(420, options.w) : 1080;
      const progressHeight = typeof options.h === "number" ? Math.max(58, options.h) : 82;
      const insetX = 20;
      const insetY = 18;
      const innerWidth = progressWidth - insetX * 2;
      const innerHeight = progressHeight - insetY * 2;
      const secondary = typeof options.color2 === "string" ? options.color2 : "#86F7B2";
      const trackColor = typeof options.trackColor === "string" ? options.trackColor : "#CCF4D9";
      const outer = proShape("rect", "Progresso · moldura", cx - progressWidth / 2, cy - progressHeight / 2, progressWidth, progressHeight, { radius: progressHeight / 2, fill: "#FFFFFF", stroke: "#DFFFEA", strokeWidth: 8, shadowColor: "#2C0B5950", shadowBlur: 20, shadowY: 11 });
      const track = proShape("rect", "Progresso · trilho", cx - progressWidth / 2 + insetX, cy - progressHeight / 2 + insetY, innerWidth, innerHeight, { radius: innerHeight / 2, fill: trackColor });
      const fill = proShape("rect", "Progresso · preenchimento", cx - progressWidth / 2 + insetX, cy - progressHeight / 2 + insetY, innerWidth, innerHeight, { radius: innerHeight / 2, fill: primary, fill2: secondary, gradientAngle: 0, shadowColor: `${primary}88`, shadowBlur: 14 });
      const progressDuration = typeof options.duration === "number" ? options.duration : animationDuration;
      const startX = cx - progressWidth / 2 + insetX;
      const completionAt = Math.max(.8, progressDuration * .9);
      fill.keyframes = [
        { ...keyframeFromShape(fill, Math.min(.35, progressDuration * .08)), w: 8, opacity: .35, easing: "easeOut" },
        { ...keyframeFromShape(fill, Math.max(.6, progressDuration * .82)), w: innerWidth * .93, easing: "easeInOut" },
        { ...keyframeFromShape(fill, completionAt), y: fill.y - 2, h: fill.h + 4, easing: "easeOut" },
        keyframeFromShape(fill, progressDuration),
      ];
  
      const shineWidth = Math.min(120, Math.max(70, innerWidth * .1));
      const shine = proShape("rect", "Progresso · brilho", startX + 12, fill.y + 4, shineWidth, Math.max(8, innerHeight - 8), { radius: innerHeight / 2, fill: "#FFFFFF", opacity: 0, shadowColor: "#FFFFFF", shadowBlur: 18 });
      const shineEndX = startX + innerWidth - shineWidth - 12;
      shine.keyframes = [
        { ...keyframeFromShape(shine, Math.min(.4, progressDuration * .1)), opacity: 0, easing: "easeOut" },
        { ...keyframeFromShape(shine, Math.max(.7, progressDuration * .22)), x: startX + innerWidth * .18, opacity: .16, easing: "easeInOut" },
        { ...keyframeFromShape(shine, Math.max(.9, progressDuration * .82)), x: shineEndX, opacity: .26, easing: "easeInOut" },
        { ...keyframeFromShape(shine, progressDuration), x: shineEndX, opacity: 0, easing: "easeOut" },
      ];
  
      const iconSize = typeof options.iconSize === "number" ? Math.max(70, Math.min(190, options.iconSize)) : Math.max(104, Math.min(148, progressHeight * 1.52));
      const iconOffsetX = typeof options.iconOffsetX === "number" ? options.iconOffsetX : 0;
      const iconOffsetY = typeof options.iconOffsetY === "number" ? options.iconOffsetY : 0;
      const iconX = startX + innerWidth - iconSize / 2 + iconOffsetX;
      const iconY = cy - iconSize / 2 + (typeof options.iconOffsetY === "number" ? options.iconOffsetY : 0);
      const iconSource = typeof options.iconSrc === "string" ? options.iconSrc : DEFAULT_PROGRESS_ICON_SOURCE;
      const icon = proShape("image", "Progresso · ícone", iconX, iconY, iconSize, iconSize, { src: iconSource, objectFit: "contain", fill: "transparent", shadowColor: "#47230055", shadowBlur: 18, shadowY: 10 });
      const iconStart = keyframeFromShape(icon, Math.min(.35, progressDuration * .08));
      iconStart.x = startX + 8 - iconSize / 2 + iconOffsetX;
      iconStart.y = cy - iconSize / 2 + iconOffsetY;
      iconStart.easing = "easeOut";
      const iconNearFinish = keyframeFromShape(icon, Math.max(.6, progressDuration * .82));
      iconNearFinish.x = startX + innerWidth * .93 - iconSize / 2 + iconOffsetX;
      iconNearFinish.y = cy - iconSize / 2 + iconOffsetY;
      iconNearFinish.easing = "easeInOut";
      const iconFinish = keyframeFromShape(icon, completionAt);
      iconFinish.x = startX + innerWidth - iconSize * .525 + iconOffsetX;
      iconFinish.y = cy - iconSize * .525 + iconOffsetY;
      iconFinish.w *= 1.05; iconFinish.h *= 1.05; iconFinish.rotation = -4; iconFinish.easing = "easeOut";
      const iconSettled = keyframeFromShape(icon, progressDuration);
      iconSettled.x = startX + innerWidth - iconSize / 2 + iconOffsetX;
      iconSettled.y = cy - iconSize / 2 + iconOffsetY;
      icon.keyframes = [iconStart, iconNearFinish, iconFinish, iconSettled];
  
      return [outer, track, fill, shine, icon].map((shape) => ({ ...shape, groupId }));
    }
    if (component === "progress_icon") {
      const iconSize = typeof options.w === "number" ? Math.max(70, Math.min(240, options.w)) : 132;
      const icon = proShape("image", "Progresso · ícone", cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize, { src: typeof options.iconSrc === "string" ? options.iconSrc : DEFAULT_PROGRESS_ICON_SOURCE, objectFit: "contain", fill: "transparent", shadowColor: "#47230055", shadowBlur: 18, shadowY: 10 });
      icon.keyframes = entranceFrames(icon, 0, "zoom", .45);
      return [icon];
    }
    if (component === "badge") {
      const badge = proShape("ellipse", "Selo numerado", cx - 70, cy - 70, 140, 140, { fill: primary, fill2: "#8E28FF", gradientAngle: 45, stroke: "#FFFFFF", strokeWidth: 9, shadowColor: "#25004477", shadowBlur: 22, shadowY: 10 });
      const number = proShape("text", "Número do selo", cx - 42, cy - 43, 84, 86, { fill: "#FFFFFF", text: label, fontSize: 78, fontWeight: 900, stroke: "#541C75", strokeWidth: 4 });
      return [badge, number].map((shape) => ({ ...shape, keyframes: entranceFrames(shape, 0, "zoom", .45) }));
    }
    if (component === "title") {
      const panel = proShape("rect", "Título · painel", cx - 430, cy - 100, 860, 200, { radius: 54, fill: primary, fill2: "#B42BFF", gradientAngle: 8, stroke: "#FFFFFF", strokeWidth: 10, shadowColor: "#31006370", shadowBlur: 28, shadowY: 18 });
      const title = proShape("text", "Título · texto", cx - 370, cy - 58, 740, 116, { fill: "#FFFFFF", text: content, fontSize: 78, fontWeight: 900, stroke: "#34144D", strokeWidth: 3 });
      return [panel, title].map((shape, index) => ({ ...shape, keyframes: entranceFrames(shape, index * .08, "top", .6) }));
    }
    if (component === "image_frame" || component === "panel") {
      const panel = proShape("rect", component === "image_frame" ? "Moldura de imagem" : "Painel premium", cx - 310, cy - 210, 620, 420, { radius: 48, fill: component === "image_frame" ? "#FFFFFF" : primary, fill2: component === "panel" ? "#B42BFF" : undefined, gradientAngle: 25, stroke: "#FFFFFF", strokeWidth: 10, shadowColor: "#32006766", shadowBlur: 28, shadowY: 18 });
      panel.keyframes = entranceFrames(panel, 0, "zoom", .55);
      return [panel];
    }
    return [];
  }
}
