import type { AICommand, Shape } from "../../app/types.ts";
import { keyframeFromShape } from "../geometry.ts";
import { createScenePrimitives } from "./primitives.ts";

export function createCorvoQuizBranding({ animationDuration, makeId }: { animationDuration: number; makeId: () => string }) {
  const { proShape, entranceFrames } = createScenePrimitives({ animationDuration, makeId });

  return function corvoQuizBranding(options: AICommand, sceneDuration: number): Shape[] {
    const number = String(options.questionNumber ?? options.number ?? "1");
    const counter = proShape("rect", "CorvoQuiz · contador dourado", 42, 34, 150, 150, { radius: 38, fill: "#FFD84D", fill2: "#F59E0B", gradientAngle: 45, stroke: "#FFF5C2", strokeWidth: 8, shadowColor: "#5C2C0066", shadowBlur: 22, shadowY: 12 });
    const numeral = proShape("text", "CorvoQuiz · número da pergunta", 42, 34, 150, 150, { fill: "#402100", text: number, fontSize: number.length > 2 ? 62 : 78, fontWeight: 900, stroke: "#FFF2A8", strokeWidth: 3, shadowColor: "#7A3A0044", shadowBlur: 8, shadowY: 5 });
    const mascot = proShape("image", "CorvoQuiz · mascote", 1719, 25, 168, 168, { radius: 84, src: "/corvoquiz-mascote.png", objectFit: "cover", fill: "transparent", shadowColor: "#081B4570", shadowBlur: 18, shadowY: 10 });
    const verticalName = proShape("text", "CorvoQuiz · assinatura lateral", 1770, 395, 92, 290, { rotation: -90, fill: "#FFFFFF", text: "CORVOQUIZ", fontSize: 34, fontWeight: 900, letterSpacing: 2, stroke: "#081B45", strokeWidth: 2, opacity: .88, shadowColor: "#081B4566", shadowBlur: 8, shadowY: 4 });

    const counterEntrance = entranceFrames(counter, .05, "zoom", .42);
    const numeralEntrance = entranceFrames(numeral, .05, "zoom", .42);
    counter.keyframes = [...counterEntrance, keyframeFromShape(counter, sceneDuration)];
    numeral.keyframes = [...numeralEntrance, keyframeFromShape(numeral, sceneDuration)];
    const mascotEntrance = entranceFrames(mascot, .12, "zoom", .48);
    const floatA = keyframeFromShape(mascot, Math.max(.75, sceneDuration * .34));
    floatA.y -= 9; floatA.rotation = -3;
    const floatB = keyframeFromShape(mascot, Math.max(1, sceneDuration * .67));
    floatB.y += 5; floatB.rotation = 3;
    mascot.keyframes = [...mascotEntrance, floatA, floatB, keyframeFromShape(mascot, sceneDuration)];
    return [counter, numeral, mascot, verticalName];
  };
}
