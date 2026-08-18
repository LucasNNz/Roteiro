import type { AICommand, Shape } from "../../app/types.ts";
import { balancedLines, keyframeFromShape } from "../geometry.ts";
import { createCorvoQuizBranding } from "./branding.ts";
import { createSceneComponents } from "./components.ts";
import { createScenePrimitives, isGreenBackground } from "./primitives.ts";

export function createQuizSceneFactory({ width, height, animationDuration, answerBadgeColor, makeId, answerLetterOpticalOffset }: {
  width: number;
  height: number;
  animationDuration: number;
  answerBadgeColor: string;
  makeId: () => string;
  answerLetterOpticalOffset: (letter: Shape) => { x: number; y: number };
}) {
  const { proShape, entranceFrames, synchronizedEntranceFrames, synchronizedAmbientFrames, ambientFrames } = createScenePrimitives({ animationDuration, makeId });
  const componentShapes = createSceneComponents({ width, height, animationDuration, answerBadgeColor, makeId, answerLetterOpticalOffset });
  const corvoQuizBranding = createCorvoQuizBranding({ animationDuration, makeId });

  function quizScene(scene: string, options: AICommand = {}, sceneDuration = animationDuration): Shape[] {
    const items: Shape[] = [];
    const push = (...next: Shape[]) => items.push(...next);
    const requestedQuestion = typeof options.question === "string" ? options.question : undefined;
    const requestedAnswers = Array.isArray(options.answers) ? options.answers.filter((answer): answer is string => typeof answer === "string").slice(0, 3) : [];
    if (scene === "toguro_quiz") {
      const waveA = proShape("ellipse", "Fundo animado · onda ciano", -360, -420, 1420, 1420, { fill: "#21C8FF", opacity: .24, shadowColor: "#21C8FF77", shadowBlur: 90 });
      const waveB = proShape("ellipse", "Fundo animado · onda azul", 1050, 150, 1180, 1180, { fill: "#375BFF", opacity: .3, shadowColor: "#355CFF66", shadowBlur: 110 });
      const beam = proShape("rect", "Fundo animado · faixa", 500, -420, 250, 1800, { rotation: -18, radius: 110, fill: "#FFFFFF", opacity: .07 });
      waveA.keyframes = [keyframeFromShape(waveA, 0), { ...keyframeFromShape(waveA, sceneDuration), x: -260, y: -350, rotation: 8 }];
      waveB.keyframes = [keyframeFromShape(waveB, 0), { ...keyframeFromShape(waveB, sceneDuration), x: 930, y: 80, rotation: -8 }];
      beam.keyframes = [keyframeFromShape(beam, 0), { ...keyframeFromShape(beam, sceneDuration), x: 760, rotation: -12 }];
      push(waveA, waveB, beam, ...corvoQuizBranding(options, sceneDuration));

      const tag = proShape("rect", "Identidade · Quiz do Toguro", 118, 55, 360, 74, { radius: 37, fill: "#16D6FF", fill2: "#4D7CFF", gradientAngle: 0, stroke: "#FFFFFF", strokeWidth: 4, shadowColor: "#001B5C66", shadowBlur: 16, shadowY: 8 });
      const tagText = proShape("text", "Identidade · texto", 145, 70, 305, 44, { fill: "#FFFFFF", text: "QUIZ DO TOGURO", fontSize: 35, fontWeight: 900, letterSpacing: 1 });
      tag.keyframes = entranceFrames(tag, .05, "left", .45); tagText.keyframes = entranceFrames(tagText, .12, "left", .45);
      push(tag, tagText);

      const questionPanel = proShape("rect", "Pergunta · painel", 105, 150, 1710, 170, { radius: 52, fill: "#09256C", fill2: "#173CA0", gradientAngle: 0, stroke: "#5DE4FF", strokeWidth: 7, shadowColor: "#00143B99", shadowBlur: 28, shadowY: 16 });
      const question = proShape("text", "Pergunta · texto", 165, 188, 1590, 95, { fill: "#FFFFFF", text: requestedQuestion ?? "QUAL CONTEÚDO TORNOU TOGURO CONHECIDO?", fontSize: 66, fontWeight: 900, letterSpacing: -1, stroke: "#00133C", strokeWidth: 3, shadowColor: "#00133C88", shadowBlur: 10, shadowY: 7 });
      questionPanel.keyframes = entranceFrames(questionPanel, .15, "top", .55); question.keyframes = entranceFrames(question, .28, "top", .5);
      push(questionPanel, question);

      const photoShadow = proShape("rect", "Foto · sombra", 105, 355, 760, 545, { radius: 56, fill: "#071B50", shadowColor: "#00102FAA", shadowBlur: 34, shadowY: 22 });
      const photo = proShape("image", "Foto · Toguro", 125, 375, 720, 505, { radius: 42, src: "/toguro-reference.png", objectFit: "cover", fill: "transparent" });
      const photoFrame = proShape("rect", "Foto · moldura", 125, 375, 720, 505, { radius: 42, fill: "transparent", stroke: "#FFFFFF", strokeWidth: 10 });
      photoShadow.keyframes = entranceFrames(photoShadow, .35, "left", .65); photo.keyframes = entranceFrames(photo, .42, "left", .7); photoFrame.keyframes = entranceFrames(photoFrame, .48, "left", .7);
      push(photoShadow, photo, photoFrame);

      const score = proShape("rect", "Selo · pontuação", 125, 920, 300, 62, { radius: 31, fill: "#FFD84D", fill2: "#FF9F1C", gradientAngle: 0, shadowColor: "#00143B88", shadowBlur: 14, shadowY: 8 });
      const scoreText = proShape("text", "Selo · pontuação texto", 152, 934, 246, 34, { fill: "#09205C", text: "VALE 1 PONTO", fontSize: 29, fontWeight: 900 });
      score.keyframes = entranceFrames(score, .8, "bottom", .45); scoreText.keyframes = entranceFrames(scoreText, .86, "bottom", .45);
      push(score, scoreText);

      push(...componentShapes("answer", { x: 1345, y: 430, label: "A", text: requestedAnswers[0] ?? "FITNESS E ACADEMIA", color: "#1ED6FF" }).map((shape) => ({ ...shape, fontSize: shape.name?.endsWith("texto") ? 38 : shape.fontSize, keyframes: synchronizedEntranceFrames(shape, .55, 220) })));
      push(...componentShapes("answer", { x: 1345, y: 610, label: "B", text: requestedAnswers[1] ?? "CULINÁRIA", color: "#5275FF" }).map((shape) => ({ ...shape, fontSize: shape.name?.endsWith("texto") ? 54 : shape.fontSize, keyframes: synchronizedEntranceFrames(shape, .75, 220) })));
      push(...componentShapes("answer", { x: 1345, y: 790, label: "C", text: requestedAnswers[2] ?? "TECNOLOGIA", color: "#7C5CFC" }).map((shape) => ({ ...shape, fontSize: shape.name?.endsWith("texto") ? 52 : shape.fontSize, keyframes: synchronizedEntranceFrames(shape, .95, 220) })));
      const progress = componentShapes("progress", { x: 1345, y: 965, duration: sceneDuration }).map((shape) => shape.name === "Progresso · preenchimento" ? { ...shape, fill: "#16D6FF", fill2: "#5A7CFF" } : shape);
      push(...progress);
      return items;
    }
    const requestedBackground = typeof (options.background ?? options.backgroundColor) === "string" ? String(options.background ?? options.backgroundColor) : "#F02A91";
    const greenBackground = isGreenBackground(requestedBackground);
    const bgGlow = proShape("ellipse", "Fundo animado · luz principal", 365, 75, 1190, 930, { fill: greenBackground ? "#0B5C55" : "#F887FF", opacity: greenBackground ? .34 : .28, shadowColor: greenBackground ? "#073C5177" : "#F887FF99", shadowBlur: 80 });
    const bgGlowB = proShape("ellipse", "Fundo animado · luz secundária", -380, 610, 980, 760, { fill: greenBackground ? "#FFE66D" : "#6E3BFF", opacity: greenBackground ? .1 : .16, shadowColor: greenBackground ? "#FFE66D55" : "#6E3BFF66", shadowBlur: 90 });
    if (options.animatedBackground !== false) {
      bgGlow.keyframes = [keyframeFromShape(bgGlow, 0), { ...keyframeFromShape(bgGlow, sceneDuration * .52), x: 455, y: 18, rotation: 8, opacity: greenBackground ? .42 : .38 }, { ...keyframeFromShape(bgGlow, sceneDuration), x: 390, y: 95, rotation: -5, opacity: greenBackground ? .32 : .27 }];
      bgGlowB.keyframes = [keyframeFromShape(bgGlowB, 0), { ...keyframeFromShape(bgGlowB, sceneDuration * .48), x: -245, y: 535, rotation: -9, opacity: greenBackground ? .15 : .21 }, { ...keyframeFromShape(bgGlowB, sceneDuration), x: -330, y: 650, rotation: 6, opacity: greenBackground ? .1 : .15 }];
    }
    push(bgGlow, bgGlowB, ...corvoQuizBranding(options, sceneDuration));
    if (scene === "letter_challenge") {
      const titleParts = componentShapes("title", { x: 960, y: 180, color: "#CC2ED8", text: "DIGA UMA PALAVRA QUE COMEÇA COM A LETRA…" });
      push(...titleParts);
      const tile = proShape("rect", "Letra · painel", 710, 340, 500, 450, { radius: 64, fill: "#D334E5", fill2: "#A026E8", gradientAngle: 60, stroke: "#FFFFFF", strokeWidth: 11, shadowColor: "#2F005F80", shadowBlur: 32, shadowY: 20 });
      const letter = proShape("text", "Letra · A", 815, 414, 290, 290, { fill: "#FFE70A", text: "A", fontSize: 300, fontWeight: 900, stroke: "#5A166F", strokeWidth: 7, shadowColor: "#26003B77", shadowBlur: 12, shadowY: 12 });
      tile.keyframes = entranceFrames(tile, .35, "zoom", .55); letter.keyframes = entranceFrames(letter, .55, "zoom", .45);
      push(tile, letter, ...componentShapes("progress", { x: 960, y: 920 }));
      return items;
    }
    const rawQuestion = requestedQuestion ?? (scene === "would_you_rather" ? "O QUE VOCÊ PREFERE?" : "QUANTAS HORAS TEM EM 3 DIAS?");
    const questionLines = balancedLines(rawQuestion, 38);
    const questionText = questionLines.join("\n");
    const questionSize = questionLines.length > 1 ? 58 : rawQuestion.length > 36 ? 64 : 72;
    const title = proShape("text", "Pergunta", 230, 32, 1460, 188, { fill: "#FFFFFF", text: questionText, fontSize: questionSize, fontWeight: 900, lineHeight: .98, letterSpacing: -1, stroke: greenBackground ? "#063C38" : "#66125E", strokeWidth: 4, shadowColor: greenBackground ? "#052D2B77" : "#4C075966", shadowBlur: 12, shadowY: 9 });
    title.keyframes = entranceFrames(title, 0, "top", .6); push(title);
    if (scene === "would_you_rather") {
      const left = proShape("rect", "Opção visual A", 120, 245, 790, 590, { radius: 58, fill: "#F7EAF5", stroke: "#FFFFFF", strokeWidth: 12, shadowColor: "#2D075A66", shadowBlur: 30, shadowY: 20 });
      const right = proShape("rect", "Opção visual B", 1010, 245, 790, 590, { radius: 58, fill: "#EDF3FF", stroke: "#FFFFFF", strokeWidth: 12, shadowColor: "#2D075A66", shadowBlur: 30, shadowY: 20 });
      const a = proShape("text", "Legenda A", 170, 720, 690, 90, { fill: "#111319", text: "OPÇÃO A", fontSize: 76, fontWeight: 900 });
      const b = proShape("text", "Legenda B", 1060, 720, 690, 90, { fill: "#111319", text: "OPÇÃO B", fontSize: 76, fontWeight: 900 });
      left.keyframes = entranceFrames(left, .25, "left"); right.keyframes = entranceFrames(right, .35, "right"); a.keyframes = entranceFrames(a, .55, "bottom"); b.keyframes = entranceFrames(b, .65, "bottom");
      push(left, right, a, b, ...componentShapes("progress", { x: 960, y: 970 }));
      return items;
    }
    const frame = proShape("rect", "Imagem da pergunta", 150, 285, 780, 530, { radius: 54, fill: "#F3F3F5", fill2: "#DDE4F0", gradientAngle: 120, stroke: "#FFFFFF", strokeWidth: 12, shadowColor: greenBackground ? "#063E3977" : "#5A174A66", shadowBlur: 30, shadowY: 20 });
    const frameEntrance = entranceFrames(frame, .25, "left", .65);
    frame.keyframes = ambientFrames(frame, frameEntrance, sceneDuration, 5, -9, .014); push(frame);
    const addAnimatedAnswer = (label: string, text: string, y: number, delay: number) => componentShapes("answer", { x: 1385, y, label, text, color: "#FF145B" }).map((shape) => ({
      ...shape,
      keyframes: synchronizedAmbientFrames(shape, delay, sceneDuration, 220),
    }));
    push(...addAnimatedAnswer("A", requestedAnswers[0] ?? "48h", 360, .34));
    push(...addAnimatedAnswer("B", requestedAnswers[1] ?? "72h", 540, .5));
    push(...addAnimatedAnswer("C", requestedAnswers[2] ?? "96h", 720, .66));
    push(...componentShapes("progress", { x: 960, y: 970, w: 1120, h: 86, duration: sceneDuration, color: greenBackground ? "#FFD84D" : "#23D66F", color2: greenBackground ? "#FF8A1F" : "#86F7B2", trackColor: greenBackground ? "#FFF3C4" : "#CCF4D9" }));
    return items;
  }

  return { componentShapes, quizScene };
}

