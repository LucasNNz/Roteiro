export const MEMO_BENCHMARK_SCENARIO = Object.freeze({
  id: "memo-quiz-question-v1",
  expectedLayerCount: 25,
  duration: 8,
  createSceneCommand: Object.freeze({
    action: "create_scene",
    scene: "quiz_question",
    duration: 8,
    background: "#18A957",
    animatedBackground: true,
    questionNumber: "01",
    question: "QUAL É O MAIOR PLANETA DO SISTEMA SOLAR?",
    answers: Object.freeze(["MARTE", "JÚPITER", "VÊNUS"]),
  }),
  playback: Object.freeze({ startTime: 0, waitMs: 8250 }),
  drag: Object.freeze({ playhead: 4, targetName: "Alternativa A · card", deltaX: 120, deltaY: 0, steps: 24 }),
});
