import type { CanvasPreset, MotionKeyframe, QuizResultBase, Shape } from "../../app/types.ts";
import { buildQuizResult, QUIZ_RESULT_DURATION } from "../ai/commands/quiz-result.ts";
import { buildBinaryQuizResult } from "../ai/commands/quiz-binary-result.ts";
import { cloneShapes } from "../geometry.ts";

export const FORMAT_SIZE: Record<CanvasPreset, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

type RefBox = {
  x: number; y: number; w: number; h: number;
  fontSize?: number; radius?: number; rotation?: number;
  motionScaleX?: number; motionScaleY?: number;
  opacity?: number; visible?: boolean;
};

type LayoutMap = Record<string, RefBox>;

const LANDSCAPE_COMMON: LayoutMap = {
  "bg-glow-gold": { x: -450, y: 640, w: 980, h: 720 },
  "bg-beam": { x: 710, y: -400, w: 270, h: 1800 },
  "counter-card": { x: 42, y: 34, w: 150, h: 150, radius: 36, visible: true },
  "counter-number": { x: 42, y: 34, w: 150, h: 150, fontSize: 78, visible: true },
  mascot: { x: 1719, y: 25, w: 168, h: 168, visible: true },
  question: { x: 180, y: 18, w: 1560, h: 220, fontSize: 82 },
  "progress-frame": { x: 420, y: 946, w: 1080, h: 82 },
  "progress-track": { x: 440, y: 964, w: 1040, h: 46 },
  "progress-fill": { x: 440, y: 964, w: 1040, h: 46 },
  "progress-alert": { x: 900, y: 964, w: 580, h: 46 },
  "progress-alert-blend": { x: 1390, y: 968, w: 90, h: 38 },
  "progress-shine": { x: 1416, y: 971, w: 64, h: 32 },
  "progress-icon": { x: 1417.5, y: 924.5, w: 125, h: 125, motionScaleX: 856 / 1040 },
  signature: { x: 1768, y: 400, w: 92, h: 290, fontSize: 34, rotation: -90, opacity: .88 },
};

const PORTRAIT_COMMON: LayoutMap = {
  "bg-glow-gold": { x: -360, y: 1310, w: 900, h: 760 },
  "bg-beam": { x: 420, y: -260, w: 190, h: 2440 },
  // No vertical, o cabeçalho fica propositalmente limpo: contador e mascote
  // continuam no documento (para permitir voltar ao 16:9), mas não são renderizados.
  "counter-card": { x: 42, y: 38, w: 140, h: 140, radius: 34, visible: false },
  "counter-number": { x: 42, y: 38, w: 140, h: 140, fontSize: 70, visible: false },
  mascot: { x: 898, y: 38, w: 140, h: 140, visible: false },
  question: { x: 36, y: 28, w: 1008, h: 270, fontSize: 76 },
  "progress-frame": { x: 90, y: 1688, w: 900, h: 92 },
  "progress-track": { x: 112, y: 1710, w: 856, h: 48 },
  "progress-fill": { x: 112, y: 1710, w: 856, h: 48 },
  "progress-alert": { x: 590, y: 1710, w: 378, h: 48 },
  "progress-alert-blend": { x: 892, y: 1715, w: 76, h: 38 },
  "progress-shine": { x: 914, y: 1718, w: 54, h: 32 },
  "progress-icon": { x: 912, y: 1676, w: 112, h: 112, motionScaleX: 856 / 1040 },
  // No 9:16 a assinatura vai para o rodapé para não cortar nem disputar espaço.
  signature: { x: 300, y: 1828, w: 480, h: 44, fontSize: 24, rotation: 0, opacity: .42 },
};

const LANDSCAPE_THREE: LayoutMap = {
  "visual-card": { x: 150, y: 286, w: 780, h: 532 },
  "answer-a-card": { x: 1055, y: 292, w: 660, h: 136 },
  "answer-a-badge": { x: 1059, y: 296, w: 128, h: 128 },
  "answer-a-letter": { x: 1059, y: 299, w: 128, h: 128, fontSize: 70 },
  "answer-a-text": { x: 1219, y: 317, w: 466, h: 86, fontSize: 54 },
  "answer-b-card": { x: 1055, y: 472, w: 660, h: 136 },
  "answer-b-badge": { x: 1059, y: 476, w: 128, h: 128 },
  "answer-b-letter": { x: 1059, y: 477, w: 128, h: 128, fontSize: 70 },
  "answer-b-text": { x: 1219, y: 497, w: 466, h: 86, fontSize: 54 },
  "answer-c-card": { x: 1055, y: 652, w: 660, h: 136 },
  "answer-c-badge": { x: 1059, y: 656, w: 128, h: 128 },
  "answer-c-letter": { x: 1060, y: 657, w: 128, h: 128, fontSize: 70 },
  "answer-c-text": { x: 1219, y: 677, w: 466, h: 86, fontSize: 54 },
};

const PORTRAIT_THREE: LayoutMap = {
  "visual-card": { x: 90, y: 245, w: 900, h: 700 },
  "answer-a-card": { x: 90, y: 1000, w: 900, h: 160 },
  "answer-a-badge": { x: 110, y: 1020, w: 120, h: 120 },
  "answer-a-letter": { x: 110, y: 1022, w: 120, h: 120, fontSize: 58 },
  "answer-a-text": { x: 270, y: 1032, w: 680, h: 96, fontSize: 46 },
  "answer-b-card": { x: 90, y: 1190, w: 900, h: 160 },
  "answer-b-badge": { x: 110, y: 1210, w: 120, h: 120 },
  "answer-b-letter": { x: 110, y: 1212, w: 120, h: 120, fontSize: 58 },
  "answer-b-text": { x: 270, y: 1222, w: 680, h: 96, fontSize: 46 },
  "answer-c-card": { x: 90, y: 1380, w: 900, h: 160 },
  "answer-c-badge": { x: 110, y: 1400, w: 120, h: 120 },
  "answer-c-letter": { x: 110, y: 1402, w: 120, h: 120, fontSize: 58 },
  "answer-c-text": { x: 270, y: 1412, w: 680, h: 96, fontSize: 46 },
};

const LANDSCAPE_BINARY: LayoutMap = {
  "visual-card": { x: 650, y: 312.5, w: 620, h: 503 },
  "answer-true-image": { x: 150, y: 330, w: 450, h: 369 },
  "answer-true-text": { x: 217, y: 611, w: 316, h: 62, fontSize: 43 },
  "answer-false-image": { x: 1320, y: 330, w: 450, h: 369 },
  "answer-false-text": { x: 1387, y: 611, w: 316, h: 62, fontSize: 53 },
};

const PORTRAIT_BINARY: LayoutMap = {
  "visual-card": { x: 90, y: 245, w: 900, h: 745 },
  "answer-true-image": { x: 115, y: 1045, w: 390, h: 335 },
  "answer-true-text": { x: 155, y: 1302, w: 310, h: 62, fontSize: 41 },
  "answer-false-image": { x: 575, y: 1045, w: 390, h: 335 },
  "answer-false-text": { x: 615, y: 1302, w: 310, h: 62, fontSize: 44 },
  // No V/F há menos respostas; a barra sobe um pouco para não ficar isolada.
  "progress-frame": { x: 90, y: 1605, w: 900, h: 92 },
  "progress-track": { x: 112, y: 1627, w: 856, h: 48 },
  "progress-fill": { x: 112, y: 1627, w: 856, h: 48 },
  "progress-alert": { x: 590, y: 1627, w: 378, h: 48 },
  "progress-alert-blend": { x: 892, y: 1632, w: 76, h: 38 },
  "progress-shine": { x: 914, y: 1635, w: 54, h: 32 },
  "progress-icon": { x: 912, y: 1593, w: 112, h: 112, motionScaleX: 856 / 1040 },
};

const INTRO_LANDSCAPE: LayoutMap = {
  "intro-logo-halo": { x: 615, y: 155, w: 690, h: 690 },
  "intro-logo-mascot": { x: 735, y: 215, w: 450, h: 450 },
  "intro-logo-title": { x: 485, y: 700, w: 950, h: 150, fontSize: 118 },
  "intro-presentation-badge": { x: 650, y: 180, w: 620, h: 82 },
  "intro-presentation-badge-text": { x: 650, y: 196, w: 620, h: 58, fontSize: 38 },
  "intro-presentation-title": { x: 210, y: 320, w: 1500, h: 315, fontSize: 142 },
  "intro-presentation-subtitle": { x: 360, y: 720, w: 1200, h: 85, fontSize: 38 },
  "intro-subscribe-panel": { x: 285, y: 280, w: 1350, h: 500 },
  "intro-like-circle": { x: 405, y: 410, w: 250, h: 250 },
  "intro-like-icon": { x: 405, y: 455, w: 250, h: 150, fontSize: 132 },
  "intro-subscribe-title": { x: 700, y: 335, w: 720, h: 105, fontSize: 66 },
  "intro-subscribe-button": { x: 700, y: 485, w: 660, h: 150 },
  "intro-subscribe-before": { x: 700, y: 522, w: 660, h: 82, fontSize: 61 },
  "intro-subscribe-after": { x: 700, y: 522, w: 660, h: 82, fontSize: 61 },
  "intro-subscribe-tip": { x: 700, y: 665, w: 660, h: 55, fontSize: 25 },
  "intro-wipe-a1": { x: -2180, y: -85, w: 2180, h: 245 },
  "intro-wipe-a2": { x: -2180, y: 245, w: 2180, h: 245 },
  "intro-wipe-a3": { x: -2180, y: 575, w: 2180, h: 245 },
  "intro-wipe-b1": { x: -2180, y: -85, w: 2180, h: 245 },
  "intro-wipe-b2": { x: -2180, y: 245, w: 2180, h: 245 },
  "intro-wipe-b3": { x: -2180, y: 575, w: 2180, h: 245 },
};

const INTRO_PORTRAIT: LayoutMap = {
  "intro-logo-halo": { x: 165, y: 260, w: 750, h: 750 },
  "intro-logo-mascot": { x: 270, y: 355, w: 540, h: 540 },
  "intro-logo-title": { x: 90, y: 1010, w: 900, h: 170, fontSize: 104 },
  "intro-presentation-badge": { x: 200, y: 300, w: 680, h: 92 },
  "intro-presentation-badge-text": { x: 200, y: 317, w: 680, h: 62, fontSize: 37 },
  "intro-presentation-title": { x: 90, y: 540, w: 900, h: 430, fontSize: 118 },
  "intro-presentation-subtitle": { x: 130, y: 1080, w: 820, h: 150, fontSize: 34 },
  "intro-subscribe-panel": { x: 90, y: 330, w: 900, h: 1100 },
  "intro-like-circle": { x: 365, y: 455, w: 350, h: 350 },
  "intro-like-icon": { x: 365, y: 520, w: 350, h: 220, fontSize: 170 },
  "intro-subscribe-title": { x: 140, y: 885, w: 800, h: 125, fontSize: 60 },
  "intro-subscribe-button": { x: 150, y: 1060, w: 780, h: 175 },
  "intro-subscribe-before": { x: 150, y: 1103, w: 780, h: 92, fontSize: 58 },
  "intro-subscribe-after": { x: 150, y: 1103, w: 780, h: 92, fontSize: 58 },
  "intro-subscribe-tip": { x: 170, y: 1280, w: 740, h: 125, fontSize: 28 },
  "intro-wipe-a1": { x: -1280, y: 250, w: 1280, h: 320 },
  "intro-wipe-a2": { x: -1280, y: 710, w: 1280, h: 320 },
  "intro-wipe-a3": { x: -1280, y: 1170, w: 1280, h: 320 },
  "intro-wipe-b1": { x: -1280, y: 250, w: 1280, h: 320 },
  "intro-wipe-b2": { x: -1280, y: 710, w: 1280, h: 320 },
  "intro-wipe-b3": { x: -1280, y: 1170, w: 1280, h: 320 },
};

function merge(...maps: LayoutMap[]): LayoutMap {
  return Object.assign({}, ...maps);
}

const THREE_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, LANDSCAPE_THREE),
  portrait: merge(PORTRAIT_COMMON, PORTRAIT_THREE),
};
const BINARY_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, LANDSCAPE_BINARY),
  portrait: merge(PORTRAIT_COMMON, PORTRAIT_BINARY),
};
const INTRO_LAYOUTS = { landscape: INTRO_LANDSCAPE, portrait: INTRO_PORTRAIT };

const LOGO_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "logo-card": { x: 520, y: 230, w: 880, h: 570 },
    "visual-card": { x: 600, y: 300, w: 720, h: 430 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    "logo-card": { x: 90, y: 330, w: 900, h: 720 },
    "visual-card": { x: 170, y: 420, w: 740, h: 540 },
  }),
};

const LOGO_RESULT_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "logo-card": { x: 550, y: 185, w: 820, h: 555 },
    "visual-card": { x: 625, y: 255, w: 670, h: 410 },
    "result-answer-pill": { x: 590, y: 790, w: 740, h: 150 },
    "result-answer": { x: 625, y: 820, w: 670, h: 90, fontSize: 64 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    "logo-card": { x: 90, y: 340, w: 900, h: 720 },
    "visual-card": { x: 165, y: 430, w: 750, h: 540 },
    "result-answer-pill": { x: 120, y: 1140, w: 840, h: 180 },
    "result-answer": { x: 170, y: 1182, w: 740, h: 100, fontSize: 58 },
  }),
};

const EMOJI_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "emoji-1-halo": { x: 435, y: 305, w: 350, h: 350 }, "image-1": { x: 460, y: 330, w: 300, h: 300 },
    "emoji-2-halo": { x: 1035, y: 305, w: 350, h: 350 }, "image-2": { x: 1060, y: 330, w: 300, h: 300 },
    "emoji-plus": { x: 875, y: 400, w: 170, h: 150, fontSize: 100 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    question: { x: 36, y: 24, w: 1008, h: 270, fontSize: 88 },
    // 9:16 nativo: pistas empilhadas para aproveitar largura e legibilidade.
    "emoji-1-halo": { x: 312, y: 330, w: 456, h: 456 }, "image-1": { x: 350, y: 368, w: 380, h: 380 },
    "emoji-plus": { x: 440, y: 805, w: 200, h: 160, fontSize: 112 },
    "emoji-2-halo": { x: 312, y: 985, w: 456, h: 456 }, "image-2": { x: 350, y: 1023, w: 380, h: 380 },
    // Barra horizontal compacta: zona exclusiva de rodapé no 9:16.
    "progress-frame": { x: 130, y: 1735, w: 820, h: 74 },
    "progress-track": { x: 150, y: 1753, w: 780, h: 38 },
    "progress-fill": { x: 150, y: 1753, w: 780, h: 38 },
    "progress-alert": { x: 575, y: 1753, w: 355, h: 38 },
    "progress-alert-blend": { x: 860, y: 1757, w: 70, h: 30 },
    "progress-shine": { x: 880, y: 1760, w: 50, h: 24 },
    "progress-icon": { x: 874, y: 1722, w: 100, h: 100, motionScaleX: 780 / 1040 },
  }),
};

const EMOJI_RESULT_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "image-1": { x: 140, y: 285, w: 230, h: 230 }, "image-2": { x: 140, y: 585, w: 230, h: 230 },
    "result-media-frame": { x: 480, y: 210, w: 1260, h: 630 }, "visual-card": { x: 510, y: 240, w: 1200, h: 570 },
    "result-answer-pill": { x: 660, y: 855, w: 900, h: 130 }, "result-answer": { x: 700, y: 880, w: 820, h: 80, fontSize: 55 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    "image-1": { x: 170, y: 270, w: 240, h: 240 }, "image-2": { x: 670, y: 270, w: 240, h: 240 },
    "result-media-frame": { x: 70, y: 555, w: 940, h: 720 }, "visual-card": { x: 100, y: 585, w: 880, h: 660 },
    "result-answer-pill": { x: 120, y: 1335, w: 840, h: 170 }, "result-answer": { x: 170, y: 1375, w: 740, h: 90, fontSize: 52 },
  }),
};

const MOVIE_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "emoji-1-halo": { x: 280, y: 310, w: 320, h: 320 }, "image-1": { x: 300, y: 330, w: 280, h: 280 },
    "emoji-2-halo": { x: 790, y: 310, w: 320, h: 320 }, "image-2": { x: 810, y: 330, w: 280, h: 280 },
    "emoji-3-halo": { x: 1300, y: 310, w: 320, h: 320 }, "image-3": { x: 1320, y: 330, w: 280, h: 280 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    "emoji-1-halo": { x: 70, y: 380, w: 400, h: 400 }, "image-1": { x: 105, y: 415, w: 330, h: 330 },
    "emoji-2-halo": { x: 610, y: 380, w: 400, h: 400 }, "image-2": { x: 645, y: 415, w: 330, h: 330 },
    "emoji-3-halo": { x: 340, y: 865, w: 400, h: 400 }, "image-3": { x: 375, y: 900, w: 330, h: 330 },
  }),
};

const MOVIE_RESULT_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "result-media-frame": { x: 350, y: 180, w: 1220, h: 650 }, "visual-card": { x: 385, y: 215, w: 1150, h: 580 },
    "image-1": { x: 690, y: 760, w: 150, h: 150 }, "image-2": { x: 875, y: 760, w: 150, h: 150 }, "image-3": { x: 1060, y: 760, w: 150, h: 150 },
    "result-answer": { x: 560, y: 900, w: 800, h: 90, fontSize: 64 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    "result-media-frame": { x: 70, y: 300, w: 940, h: 790 }, "visual-card": { x: 100, y: 330, w: 880, h: 730 },
    "image-1": { x: 180, y: 1120, w: 160, h: 160 }, "image-2": { x: 460, y: 1120, w: 160, h: 160 }, "image-3": { x: 740, y: 1120, w: 160, h: 160 },
    "result-answer": { x: 120, y: 1340, w: 840, h: 110, fontSize: 58 },
  }),
};

const WOULD_RATHER_LAYOUTS = {
  landscape: merge(LANDSCAPE_COMMON, {
    "image-1": { x: 100, y: 245, w: 760, h: 560 }, "image-2": { x: 1060, y: 245, w: 760, h: 560 },
    "or-line": { x: 920, y: 220, w: 80, h: 610 },
    "or-progress-track": { x: 939, y: 245, w: 42, h: 560 },
    "or-progress-fill": { x: 939, y: 785, w: 42, h: 20 },
    "or-progress-shine": { x: 943, y: 778, w: 34, h: 18 },
    "or-circle": { x: 850, y: 410, w: 220, h: 220 }, "or-text": { x: 850, y: 455, w: 220, h: 115, fontSize: 64 },
    "text-1-pill": { x: 140, y: 770, w: 680, h: 110 }, "text-1": { x: 175, y: 792, w: 610, h: 70, fontSize: 48 },
    "text-2-pill": { x: 1100, y: 770, w: 680, h: 110 }, "text-2": { x: 1135, y: 792, w: 610, h: 70, fontSize: 48 },
  }),
  portrait: merge(PORTRAIT_COMMON, {
    question: { x: 36, y: 28, w: 1008, h: 248, fontSize: 88 },
    // 9:16: opções empilhadas. Mantém respiro entre título, imagens, faixas e separador.
    "image-1": { x: 90, y: 332, w: 900, h: 388 },
    "text-1-pill": { x: 130, y: 748, w: 820, h: 106 }, "text-1": { x: 180, y: 769, w: 720, h: 68, fontSize: 50 },
    // O separador e seu preenchimento são horizontais e ficam em uma zona própria.
    "or-line": { x: 90, y: 930, w: 900, h: 56 },
    "or-progress-track": { x: 155, y: 946, w: 770, h: 24, visible: true },
    "or-progress-fill": { x: 155, y: 946, w: 770, h: 24, visible: true },
    "or-progress-shine": { x: 155, y: 950, w: 770, h: 16, visible: true },
    "or-circle": { x: 452, y: 888, w: 176, h: 140 }, "or-text": { x: 452, y: 917, w: 176, h: 78, fontSize: 56 },
    "image-2": { x: 90, y: 1088, w: 900, h: 388 },
    "text-2-pill": { x: 130, y: 1504, w: 820, h: 106 }, "text-2": { x: 180, y: 1525, w: 720, h: 68, fontSize: 50 },
    // A barra global desse preset continua oculta; o cronômetro visual é o separador central.
    "progress-frame": { x: 130, y: 1715, w: 820, h: 74, visible: false },
    "progress-track": { x: 150, y: 1733, w: 780, h: 38, visible: false },
    "progress-fill": { x: 150, y: 1733, w: 780, h: 38, visible: false },
    "progress-alert": { x: 575, y: 1733, w: 355, h: 38, visible: false },
    "progress-alert-blend": { x: 860, y: 1737, w: 70, h: 30, visible: false },
    "progress-shine": { x: 880, y: 1740, w: 50, h: 24, visible: false },
    "progress-icon": { x: 874, y: 1702, w: 100, h: 100, motionScaleX: 780 / 1040, visible: false },
  }),
};
function scaleValue(value: number | undefined, factor: number) {
  return value === undefined ? undefined : value * factor;
}

function transformFrame(frame: MotionKeyframe, source: RefBox, target: RefBox): MotionKeyframe {
  const sx = target.motionScaleX ?? (source.w ? target.w / source.w : 1);
  const sy = target.motionScaleY ?? (source.h ? target.h / source.h : 1);
  const sizeX = source.w ? target.w / source.w : 1;
  const sizeY = source.h ? target.h / source.h : 1;
  const sr = Math.min(Math.abs(sizeX), Math.abs(sizeY));
  return {
    ...frame,
    x: target.x + (frame.x - source.x) * sx,
    y: target.y + (frame.y - source.y) * sy,
    w: Math.max(.01, target.w + (frame.w - source.w) * sizeX),
    h: Math.max(.01, target.h + (frame.h - source.h) * sizeY),
    radius: Math.max(0, (target.radius ?? source.radius ?? 0) + (frame.radius - (source.radius ?? frame.radius)) * sr),
  };
}

function transformResultBase(base: QuizResultBase, source: RefBox, target: RefBox): QuizResultBase {
  const transformed = transformFrame({ time: 0, x: base.x, y: base.y, w: base.w, h: base.h, rotation: base.rotation, radius: base.radius, opacity: base.opacity ?? 1 }, source, target);
  const scale = Math.min(target.w / source.w, target.h / source.h);
  return {
    ...base,
    x: transformed.x, y: transformed.y, w: transformed.w, h: transformed.h, radius: transformed.radius,
    ...(base.strokeWidth !== undefined ? { strokeWidth: base.strokeWidth * scale } : {}),
    ...(base.shadowBlur !== undefined ? { shadowBlur: base.shadowBlur * scale } : {}),
    ...(base.shadowX !== undefined ? { shadowX: base.shadowX * scale } : {}),
    ...(base.shadowY !== undefined ? { shadowY: base.shadowY * scale } : {}),
    ...(base.keyframes ? { keyframes: base.keyframes.map((frame) => transformFrame(frame, source, target)) } : {}),
  };
}

function transformKnownShape(shape: Shape, source: RefBox, target: RefBox): Shape {
  const frame = transformFrame({ time: 0, x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: shape.rotation, radius: shape.radius, opacity: shape.opacity ?? 1 }, source, target);
  const scale = Math.min(target.w / source.w, target.h / source.h);
  const baseFont = source.fontSize;
  const nextFont = shape.fontSize === undefined ? undefined : target.fontSize !== undefined && baseFont
    ? target.fontSize * (shape.fontSize / baseFont)
    : shape.fontSize * scale;
  return {
    ...shape,
    x: frame.x, y: frame.y, w: frame.w, h: frame.h,
    radius: target.radius !== undefined ? target.radius + (shape.radius - (source.radius ?? shape.radius)) * scale : frame.radius,
    rotation: target.rotation ?? shape.rotation,
    ...(target.opacity !== undefined ? { opacity: target.opacity } : {}),
    ...(target.visible !== undefined ? { visible: target.visible } : {}),
    ...(nextFont !== undefined ? { fontSize: nextFont } : {}),
    ...(shape.strokeWidth !== undefined ? { strokeWidth: shape.strokeWidth * scale } : {}),
    ...(shape.shadowBlur !== undefined ? { shadowBlur: shape.shadowBlur * scale } : {}),
    ...(shape.shadowX !== undefined ? { shadowX: shape.shadowX * scale } : {}),
    ...(shape.shadowY !== undefined ? { shadowY: shape.shadowY * scale } : {}),
    keyframes: shape.keyframes?.map((item) => transformFrame(item, source, target)),
    ...(shape.quizResultBase ? { quizResultBase: transformResultBase(shape.quizResultBase, source, target) } : {}),
  };
}

export function genericAdaptShapes(shapes: Shape[], fromFormat: CanvasPreset, toFormat: CanvasPreset): Shape[] {
  if (fromFormat === toFormat) return cloneShapes(shapes);
  const from = FORMAT_SIZE[fromFormat];
  const to = FORMAT_SIZE[toFormat];
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  const shapeScale = Math.min(scaleX, scaleY);
  return cloneShapes(shapes).map((shape) => {
    const nextW = shape.w * shapeScale;
    const nextH = shape.h * shapeScale;
    const centerX = ((shape.x + shape.w / 2) / from.width) * to.width;
    const centerY = ((shape.y + shape.h / 2) / from.height) * to.height;
    return {
      ...shape,
      x: centerX - nextW / 2,
      y: centerY - nextH / 2,
      w: nextW,
      h: nextH,
      radius: shape.radius * shapeScale,
      strokeWidth: scaleValue(shape.strokeWidth, shapeScale),
      fontSize: scaleValue(shape.fontSize, shapeScale),
      shadowBlur: scaleValue(shape.shadowBlur, shapeScale),
      shadowX: scaleValue(shape.shadowX, shapeScale),
      shadowY: scaleValue(shape.shadowY, shapeScale),
      keyframes: shape.keyframes?.map((frame) => ({ ...frame, x: frame.x * scaleX, y: frame.y * scaleY, w: frame.w * shapeScale, h: frame.h * shapeScale, radius: frame.radius * shapeScale })),
      ...(shape.quizResultBase ? { quizResultBase: {
        ...shape.quizResultBase,
        x: shape.quizResultBase.x * scaleX,
        y: shape.quizResultBase.y * scaleY,
        w: shape.quizResultBase.w * shapeScale,
        h: shape.quizResultBase.h * shapeScale,
        radius: shape.quizResultBase.radius * shapeScale,
        ...(shape.quizResultBase.strokeWidth !== undefined ? { strokeWidth: shape.quizResultBase.strokeWidth * shapeScale } : {}),
        keyframes: shape.quizResultBase.keyframes?.map((frame) => ({ ...frame, x: frame.x * scaleX, y: frame.y * scaleY, w: frame.w * shapeScale, h: frame.h * shapeScale, radius: frame.radius * shapeScale })),
      } } : {}),
    };
  });
}

function adaptByLayout(shapes: Shape[], fromFormat: "landscape" | "portrait", toFormat: "landscape" | "portrait", layouts: { landscape: LayoutMap; portrait: LayoutMap }) {
  const source = layouts[fromFormat];
  const target = layouts[toFormat];
  const generic = new Map(genericAdaptShapes(shapes, fromFormat, toFormat).map((shape) => [shape.id, shape]));
  return cloneShapes(shapes).map((shape) => {
    const sourceRef = source[shape.id];
    const targetRef = target[shape.id];
    return sourceRef && targetRef ? transformKnownShape(shape, sourceRef, targetRef) : generic.get(shape.id) ?? shape;
  });
}

function isThreeOptions(shapes: Shape[]) {
  const ids = new Set(shapes.map((shape) => shape.id));
  return ids.has("answer-a-card") && ids.has("answer-b-card") && ids.has("answer-c-card") && ids.has("visual-card");
}

function isBinary(shapes: Shape[]) {
  const ids = new Set(shapes.map((shape) => shape.id));
  return ids.has("answer-true-image") && ids.has("answer-false-image") && ids.has("visual-card");
}

function isIntro(shapes: Shape[]) {
  return shapes.some((shape) => shape.id === "intro-logo-title") && shapes.some((shape) => shape.id === "intro-subscribe-panel");
}

function hasMarker(shapes: Shape[], id: string) { return shapes.some((shape) => shape.id === id); }
function isLogoPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-guess-logo"); }
function isLogoResultPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-guess-logo-result"); }
function isEmojiPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-emoji-quiz"); }
function isEmojiResultPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-emoji-quiz-result"); }
function isMoviePreset(shapes: Shape[]) { return hasMarker(shapes, "preset-guess-movie"); }
function isMovieResultPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-guess-movie-result"); }
function isWouldRatherPreset(shapes: Shape[]) { return hasMarker(shapes, "preset-would-you-rather"); }

const motionFrame = (time: number, x: number, y: number, w: number, h: number, radius: number, opacity = 1, rotation = 0, easing: MotionKeyframe["easing"] = "linear"): MotionKeyframe => ({
  time, x, y, w, h, radius, opacity, rotation, ...(easing ? { easing } : {}),
});

function normalizeWouldRatherMotion(shapes: Shape[], format: "landscape" | "portrait") {
  return cloneShapes(shapes).map((shape) => {
    if (format === "portrait") {
      if (shape.id === "or-progress-track") return {
        ...shape, x: 155, y: 946, w: 770, h: 24, radius: 12, visible: true,
        keyframes: [
          motionFrame(.3, 155, 946, 770, 24, 12, 0, 0, "easeOutBack"),
          motionFrame(.76, 155, 946, 770, 24, 12, .92, 0, "easeInOut"),
          motionFrame(8, 155, 946, 770, 24, 12, .92),
        ],
      };
      if (shape.id === "or-progress-fill") return {
        ...shape, x: 155, y: 946, w: 770, h: 24, radius: 12, visible: true,
        // IMPORTANTE: no vertical o cronômetro cresce da esquerda para a direita.
        keyframes: [
          motionFrame(0, 155, 946, 12, 24, 12, 1),
          motionFrame(7, 155, 946, 770, 24, 12, 1),
          motionFrame(8, 155, 946, 770, 24, 12, 1),
        ],
      };
      if (shape.id === "or-progress-shine") return {
        ...shape, x: 871, y: 950, w: 54, h: 16, radius: 8, visible: true,
        keyframes: [
          motionFrame(0, 155, 950, 12, 16, 8, .18),
          motionFrame(7, 871, 950, 54, 16, 8, .45),
          motionFrame(8, 871, 950, 54, 16, 8, .45),
        ],
      };
      if (shape.id.startsWith("progress-")) return { ...shape, visible: false };
      return shape;
    }

    // Ao voltar para 16:9, restaura a leitura vertical original do separador.
    if (shape.id === "or-progress-track") return {
      ...shape, x: 939, y: 245, w: 42, h: 560, radius: 21, visible: true,
      keyframes: [
        motionFrame(.3, 955, 378, 10, 280, 5, 0, 0, "easeOutBack"),
        motionFrame(.76, 939, 245, 42, 560, 21, .92, 0, "easeInOut"),
        motionFrame(8, 939, 245, 42, 560, 21, .92),
      ],
    };
    if (shape.id === "or-progress-fill") return {
      ...shape, x: 939, y: 785, w: 42, h: 20, radius: 21, visible: true,
      keyframes: [
        motionFrame(0, 939, 785, 42, 20, 21, 1),
        motionFrame(7, 939, 245, 42, 560, 21, 1),
        motionFrame(8, 939, 245, 42, 560, 21, 1),
      ],
    };
    if (shape.id === "or-progress-shine") return {
      ...shape, x: 943, y: 778, w: 34, h: 18, radius: 17, visible: true,
      keyframes: [
        motionFrame(0, 943, 785, 34, 8, 17, .18),
        motionFrame(7, 943, 252, 34, 24, 17, .45),
        motionFrame(8, 943, 252, 34, 24, 17, .45),
      ],
    };
    return shape;
  });
}

const portraitEmojiResultTargets = {
  image1: { x: 170, y: 270, w: 240, h: 240 },
  image2: { x: 670, y: 270, w: 240, h: 240 },
};

function normalizeEmojiQuestionMotion(shapes: Shape[], format: "landscape" | "portrait") {
  if (format === "landscape") return cloneShapes(shapes).map((shape) => {
    // Remove a convergência exclusiva do vertical caso o usuário volte ao 16:9.
    if (shape.id === "image-1") return { ...shape, keyframes: [
      motionFrame(.24, 500, 380, 235, 235, 0, 0, -12, "easeOutBack"),
      motionFrame(.82, 460, 330, 300, 300, 0, 1, -4, "easeInOut"),
      motionFrame(2, 454, 320, 312, 312, 0, 1, -6, "easeInOut"),
      motionFrame(3.4, 466, 338, 296, 296, 0, 1, 3, "easeInOut"),
      motionFrame(5, 457, 323, 308, 308, 0, 1, -3, "easeInOut"),
      motionFrame(6.6, 468, 339, 294, 294, 0, 1, 4, "easeInOut"),
      motionFrame(8, 460, 330, 300, 300, 0, 1),
    ] };
    if (shape.id === "image-2") return { ...shape, keyframes: [
      motionFrame(.38, 1090, 385, 235, 235, 0, 0, 12, "easeOutBack"),
      motionFrame(.96, 1060, 330, 300, 300, 0, 1, 4, "easeInOut"),
      motionFrame(2.2, 1054, 338, 294, 294, 0, 1, 5, "easeInOut"),
      motionFrame(3.8, 1066, 320, 312, 312, 0, 1, -4, "easeInOut"),
      motionFrame(5.4, 1058, 336, 298, 298, 0, 1, 4, "easeInOut"),
      motionFrame(6.9, 1070, 321, 309, 309, 0, 1, -5, "easeInOut"),
      motionFrame(8, 1060, 330, 300, 300, 0, 1),
    ] };
    return shape;
  });

  return cloneShapes(shapes).map((shape) => {
    if (shape.id === "emoji-1-halo") return { ...shape, keyframes: [
      motionFrame(.18, 388, 406, 304, 304, 152, 0, 0, "easeOutBack"),
      motionFrame(.72, 312, 330, 456, 456, 228, 1, 0, "easeInOut"),
      motionFrame(2.2, 298, 316, 484, 484, 242, .85, 0, "easeInOut"),
      motionFrame(3.8, 324, 342, 432, 432, 216, .68, 0, "easeInOut"),
      motionFrame(5.6, 304, 322, 472, 472, 236, .86, 0, "easeInOut"),
      motionFrame(7.05, 312, 330, 456, 456, 228, 1, 0, "easeInOut"),
      motionFrame(7.8, 130, 230, 320, 320, 160, 0, 0, "easeInOut"),
      motionFrame(8, 130, 230, 320, 320, 160, 0),
    ] };
    if (shape.id === "image-1") return { ...shape, keyframes: [
      motionFrame(.24, 405, 423, 270, 270, 0, 0, -10, "easeOutBack"),
      motionFrame(.82, 350, 368, 380, 380, 0, 1, -3, "easeInOut"),
      motionFrame(2.2, 340, 358, 400, 400, 0, 1, -4, "easeInOut"),
      motionFrame(3.8, 360, 378, 365, 365, 0, 1, 2, "easeInOut"),
      motionFrame(5.6, 344, 362, 392, 392, 0, 1, -2, "easeInOut"),
      motionFrame(7.05, 350, 368, 380, 380, 0, 1, 0, "easeInOut"),
      motionFrame(7.82, portraitEmojiResultTargets.image1.x, portraitEmojiResultTargets.image1.y, portraitEmojiResultTargets.image1.w, portraitEmojiResultTargets.image1.h, 0, 1, 0, "easeInOut"),
      motionFrame(8, portraitEmojiResultTargets.image1.x, portraitEmojiResultTargets.image1.y, portraitEmojiResultTargets.image1.w, portraitEmojiResultTargets.image1.h, 0, 1),
    ] };
    if (shape.id === "emoji-2-halo") return { ...shape, keyframes: [
      motionFrame(.3, 388, 1061, 304, 304, 152, 0, 0, "easeOutBack"),
      motionFrame(.84, 312, 985, 456, 456, 228, 1, 0, "easeInOut"),
      motionFrame(2.4, 298, 971, 484, 484, 242, .84, 0, "easeInOut"),
      motionFrame(4.1, 324, 997, 432, 432, 216, .68, 0, "easeInOut"),
      motionFrame(5.9, 304, 977, 472, 472, 236, .86, 0, "easeInOut"),
      motionFrame(7.05, 312, 985, 456, 456, 228, 1, 0, "easeInOut"),
      motionFrame(7.8, 630, 230, 320, 320, 160, 0, 0, "easeInOut"),
      motionFrame(8, 630, 230, 320, 320, 160, 0),
    ] };
    if (shape.id === "image-2") return { ...shape, keyframes: [
      motionFrame(.38, 405, 1078, 270, 270, 0, 0, 10, "easeOutBack"),
      motionFrame(.96, 350, 1023, 380, 380, 0, 1, 3, "easeInOut"),
      motionFrame(2.4, 340, 1013, 400, 400, 0, 1, 4, "easeInOut"),
      motionFrame(4.1, 360, 1033, 365, 365, 0, 1, -2, "easeInOut"),
      motionFrame(5.9, 344, 1017, 392, 392, 0, 1, 2, "easeInOut"),
      motionFrame(7.05, 350, 1023, 380, 380, 0, 1, 0, "easeInOut"),
      motionFrame(7.82, portraitEmojiResultTargets.image2.x, portraitEmojiResultTargets.image2.y, portraitEmojiResultTargets.image2.w, portraitEmojiResultTargets.image2.h, 0, 1, 0, "easeInOut"),
      motionFrame(8, portraitEmojiResultTargets.image2.x, portraitEmojiResultTargets.image2.y, portraitEmojiResultTargets.image2.w, portraitEmojiResultTargets.image2.h, 0, 1),
    ] };
    if (shape.id === "emoji-plus") return { ...shape, keyframes: [
      motionFrame(.44, 500, 855, 80, 80, 0, 0, -18, "easeOutBack"),
      motionFrame(.92, 440, 805, 200, 160, 0, 1, 0, "easeInOut"),
      motionFrame(5.7, 440, 805, 200, 160, 0, 1, 2, "easeInOut"),
      motionFrame(7.05, 440, 805, 200, 160, 0, 1, 0, "easeInOut"),
      motionFrame(7.55, 485, 850, 110, 80, 0, 0, 0, "easeInOut"),
      motionFrame(8, 485, 850, 110, 80, 0, 0),
    ] };
    return shape;
  });
}

function normalizeEmojiResultMotion(shapes: Shape[], format: "landscape" | "portrait") {
  if (format !== "portrait") return cloneShapes(shapes);
  return cloneShapes(shapes).map((shape) => {
    if (shape.id === "image-1") return {
      ...shape, ...portraitEmojiResultTargets.image1,
      // Começa exatamente onde a pista 1 terminou na pergunta anterior.
      keyframes: [
        motionFrame(0, 170, 270, 240, 240, 0, 1),
        motionFrame(2.2, 166, 266, 248, 248, 0, 1, -3, "easeInOut"),
        motionFrame(3.6, 173, 273, 234, 234, 0, 1, 3, "easeInOut"),
        motionFrame(5, 170, 270, 240, 240, 0, 1),
      ],
    };
    if (shape.id === "image-2") return {
      ...shape, ...portraitEmojiResultTargets.image2,
      // Começa exatamente onde a pista 2 terminou na pergunta anterior.
      keyframes: [
        motionFrame(0, 670, 270, 240, 240, 0, 1),
        motionFrame(2.4, 673, 273, 234, 234, 0, 1, 3, "easeInOut"),
        motionFrame(3.8, 666, 266, 248, 248, 0, 1, -3, "easeInOut"),
        motionFrame(5, 670, 270, 240, 240, 0, 1),
      ],
    };
    return shape;
  });
}

function isResultShape(shape: Shape) {
  return shape.id.startsWith("quiz-result-") || shape.id.startsWith("quiz-vf-result-") || shape.id.startsWith("result-") || shape.groupId?.includes("result") === true;
}

function restoreResultShape(shape: Shape): Shape {
  if (!shape.quizResultBase) return { ...shape, keyframes: shape.keyframes?.map((frame) => ({ ...frame })) };
  const base = shape.quizResultBase;
  const restored: Shape = { ...shape, ...base, quizResultBase: undefined, keyframes: base.keyframes?.map((frame) => ({ ...frame })) };
  for (const property of ["fill2", "opacity", "stroke", "strokeWidth", "shadowColor", "shadowBlur", "shadowX", "shadowY", "keyframes"] as const) {
    if (!(property in base)) delete restored[property];
  }
  return restored;
}

function threeOptionCorrect(shapes: Shape[]): "A" | "B" | "C" | null {
  for (const shape of shapes) {
    const match = shape.id.match(/^quiz-result-([abc])-card$/i);
    if (match) return match[1].toUpperCase() as "A" | "B" | "C";
  }
  const card = shapes.find((shape) => /^answer-[abc]-card$/i.test(shape.id) && shape.fill?.toUpperCase() === "#23D978");
  return card ? card.id.match(/^answer-([abc])-card$/i)?.[1].toUpperCase() as "A" | "B" | "C" : null;
}

function binaryCorrect(shapes: Shape[]): "green" | "red" | null {
  for (const shape of shapes) {
    const match = shape.id.match(/^quiz-vf-result-(green|red)-halo$/i);
    if (match) return match[1].toLowerCase() as "green" | "red";
  }
  return null;
}

function rebuildResultForTarget(shapes: Shape[], fromFormat: "landscape" | "portrait", toFormat: "landscape" | "portrait") {
  const clean = shapes.filter((shape) => !isResultShape(shape)).map(restoreResultShape);
  if (isThreeOptions(clean)) {
    const correct = threeOptionCorrect(shapes);
    if (correct) {
      const adapted = adaptByLayout(clean, fromFormat, toFormat, THREE_LAYOUTS);
      const result = buildQuizResult(adapted, correct, QUIZ_RESULT_DURATION);
      if (result.ok) return result.shapes;
    }
  }
  if (isBinary(clean)) {
    const correct = binaryCorrect(shapes);
    if (correct) {
      const adapted = adaptByLayout(clean, fromFormat, toFormat, BINARY_LAYOUTS);
      const result = buildBinaryQuizResult(adapted, correct);
      if (result.ok) return result.shapes;
    }
  }
  return null;
}

export function adaptShapesForFormat(shapes: Shape[], fromFormat: CanvasPreset, toFormat: CanvasPreset): Shape[] {
  if (fromFormat === toFormat) return cloneShapes(shapes);
  if ((fromFormat === "landscape" || fromFormat === "portrait") && (toFormat === "landscape" || toFormat === "portrait")) {
    const rebuiltResult = rebuildResultForTarget(shapes, fromFormat, toFormat);
    if (rebuiltResult) return rebuiltResult;
    if (isThreeOptions(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, THREE_LAYOUTS);
    if (isBinary(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, BINARY_LAYOUTS);
    if (isLogoPreset(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, LOGO_LAYOUTS);
    if (isLogoResultPreset(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, LOGO_RESULT_LAYOUTS);
    if (isEmojiPreset(shapes)) return normalizeEmojiQuestionMotion(adaptByLayout(shapes, fromFormat, toFormat, EMOJI_LAYOUTS), toFormat);
    if (isEmojiResultPreset(shapes)) return normalizeEmojiResultMotion(adaptByLayout(shapes, fromFormat, toFormat, EMOJI_RESULT_LAYOUTS), toFormat);
    if (isMoviePreset(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, MOVIE_LAYOUTS);
    if (isMovieResultPreset(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, MOVIE_RESULT_LAYOUTS);
    if (isWouldRatherPreset(shapes)) return normalizeWouldRatherMotion(adaptByLayout(shapes, fromFormat, toFormat, WOULD_RATHER_LAYOUTS), toFormat);
    if (isIntro(shapes)) return adaptByLayout(shapes, fromFormat, toFormat, INTRO_LAYOUTS);
  }
  return genericAdaptShapes(shapes, fromFormat, toFormat);
}

export function isResponsiveCorvoQuizPreset(shapes: Shape[]) {
  return isThreeOptions(shapes) || isBinary(shapes) || isLogoPreset(shapes) || isLogoResultPreset(shapes) || isEmojiPreset(shapes) || isEmojiResultPreset(shapes) || isMoviePreset(shapes) || isMovieResultPreset(shapes) || isWouldRatherPreset(shapes) || isIntro(shapes) || shapes.some(isResultShape);
}
