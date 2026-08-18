import type { AIArtifact, AICommand, AIResponse, AIResult, AIState, SavedProject } from "../../app/types.ts";

export type FormaAIBridge = {
  version: string;
  capabilities: typeof AI_CAPABILITIES;
  getState: () => AIState;
  getArtifact: () => AIArtifact | null;
  prepareExport: (options?: { kind?: "png" | "svg" | "mp4" | "project" | "zip" | "diagnostic"; scale?: number }) => Promise<AIArtifact>;
  downloadArtifact: () => Promise<void>;
  listProjects: () => Array<Pick<SavedProject, "id" | "name" | "updatedAt">>;
  execute: (command: AICommand) => Promise<AIResult>;
  batch: (commands: AICommand[]) => Promise<AIResult[]>;
  command: (prompt: string) => Promise<AIResult>;
  run: (input: string | AICommand | AICommand[]) => Promise<AIResponse>;
  subscribe: (listener: (state: AIState) => void) => () => void;
  open: () => void;
};

export const AI_CAPABILITIES = {
  version: "forma-ai/4.4",
  bridge: "window.FormaAI",
  transports: ["window.FormaAI", "CustomEvent", "postMessage", "BroadcastChannel", "DOM console"],
  events: ["forma:command", "forma:ready", "forma:state", "forma:action", "forma:response", "forma:artifact-ready"],
  commands: {
    creation: ["add", "add_component", "create_scene", "apply_main_scene_preset", "create_intro_scene", "add_scene", "ensure_transition_scene", "transition preset brush-lightning|blank", "duplicate", "delete", "clear"],
    transform: ["update", "align", "align_component", "audit_alignment", "distribute_answers", "arrange_grid", "multiline text"],
    style: ["update fill/fill2/gradientAngle/opacity/stroke/strokeWidth/radius/shadow", "apply_palette", "adjust_visual", "reset_visual"],
    media: ["place_image", "replace_progress_icon", "remove_image", "update_intro_content", "imageScale", "imageOffsetX", "imageOffsetY", "objectFit"],
    layers: ["select", "rename", "lock", "visibility", "layer_order", "lock_all", "show_all"],
    canvas: ["canvas", "reset_view"],
    animation: ["set_duration", "keyframe", "set_keyframes", "animation_preset", "apply_quiz_result", "apply_binary_quiz_result", "play", "pause", "seek"],
    interface: ["screen", "undo", "redo", "export", "export_to_ai", "capture_diagnostic", "get_artifact", "download_artifact"],
    projects: ["new_project", "save_project", "open_project", "list_projects", "create_intro_scene", "add_scene", "ensure_transition_scene", "select_scene", "rename_scene", "delete_scene", "list_scenes", "export_project", "export_project_zip", "import_project"],
    audio: ["open_scene_audio", "list_audio_presets", "create_audio_preset", "apply_audio_preset", "set_audio_preset_volume", "set_audio_clip_volume", "move_audio_clip", "split_audio_clip", "set_audio_clip_fades", "toggle_audio_clip_loop", "remove_audio_clip", "list_scene_stingers", "configure_scene_stingers"],
  },
  targets: ["selected", "first", "last", "layer id", "layer name"],
  screens: ["ai", "scenes", "audio", "layers", "timeline", "alignment", "colors", "adjustments", "outline", "format", "text", "projects", "export", "none"],
  components: ["panel", "answer", "badge", "progress", "progress_icon", "image_frame", "title"],
  scenes: ["quiz_question", "letter_challenge", "would_you_rather", "toguro_quiz"],
  animatable: ["x", "y", "w", "h", "rotation", "radius", "opacity", "easing", "groupId"],
  textLayout: ["newline", "lineHeight", "balanced quiz titles"],
  visualAdjustments: ["brightness", "contrast", "saturation", "hue", "colorMatrix"],
  progressBehavior: ["icon follows fill edge", "replaceable icon", "completion glow", "iconOffsetX", "iconOffsetY"],
  quizPresets: {
    command: "apply_main_scene_preset",
    ids: ["quiz_3_options_8s", "true_false_8s", "guess_logo_8s", "guess_logo_result_5s", "emoji_quiz_8s", "emoji_quiz_result_5s", "guess_movie_8s", "guess_movie_result_5s", "would_you_rather_8s"],
    editableText: {
      title: "question", questionNumber: "counter-number",
      answerA: "answer-a-text", answerB: "answer-b-text", answerC: "answer-c-text",
      trueText: "answer-true-text", falseText: "answer-false-text",
      text1: "text-1", text2: "text-2", resultText: "result-answer", subtitle: "subtitle",
    },
    editableMedia: { imageSrc: "visual-card", image1: "image-1", image2: "image-2", image3: "image-3", image4: "image-4" },
    mediaAliases: ["mainImage", "resultImage", "logoImage", "movieImage", "posterImage", "emoji1..4", "leftImage", "rightImage", "leftMedia", "rightMedia", "optionAImage", "optionBImage", "optionCImage"],
    textAliases: ["title", "question", "questionTitle", "sceneTitle", "questionNumber", "number", "sceneNumber", "leftText", "rightText", "option1Text", "option2Text", "answerText", "result", "logoName", "movieName", "correctName"],
  },
  introPreset: {
    command: "update_intro_content",
    editableText: {
      channelName: "intro-logo-title",
      badgeText: "intro-presentation-badge-text",
      title: "intro-presentation-title",
      subtitle: "intro-presentation-subtitle",
      ctaTitle: "intro-subscribe-title",
      subscribeBefore: "intro-subscribe-before",
      subscribeAfter: "intro-subscribe-after",
      subscribeTip: "intro-subscribe-tip",
      likeIcon: "intro-like-icon",
    },
    editableMedia: { mascotSrc: "intro-logo-mascot" },
  },
  diagnostics: ["real playback frame timing", "PNG frame sequence", "performance report", "keyframe audit", "project snapshot", "ZIP artifact"],
};
export const AI_QUICK_ACTIONS: Array<{ icon: string; label: string; hint: string; command: AICommand }> = [
  { icon: "▭", label: "Retângulo", hint: "Criar central", command: { action: "add", type: "rect" } },
  { icon: "T", label: "Título", hint: "Montserrat", command: { action: "add", type: "text", text: "Novo título" } },
  { icon: "◎", label: "Centralizar", hint: "Item selecionado", command: { action: "align", mode: "center" } },
  { icon: "↳", label: "Entrada", hint: "Da esquerda", command: { action: "animation_preset", preset: "enter_left" } },
  { icon: "⊞", label: "Organizar", hint: "Grade automática", command: { action: "arrange_grid" } },
  { icon: "◐", label: "Paleta", hint: "Cores rápidas", command: { action: "apply_palette" } },
  { icon: "☼", label: "Ajustes", hint: "Brilho e matriz", command: { action: "screen", screen: "adjustments" } },
  { icon: "▥", label: "Camadas", hint: "Abrir painel", command: { action: "screen", screen: "layers" } },
  { icon: "◆", label: "Timeline", hint: "Ver keyframes", command: { action: "screen", screen: "timeline" } },
  { icon: "▤", label: "Cena Quiz", hint: "Pergunta completa", command: { action: "create_scene", scene: "quiz_question" } },
  { icon: "A", label: "Desafio letra", hint: "Tela animada", command: { action: "create_scene", scene: "letter_challenge" } },
  { icon: "▰", label: "Alternativa", hint: "Card composto", command: { action: "add_component", component: "answer" } },
  { icon: "➜", label: "Progresso", hint: "Barra animada", command: { action: "add_component", component: "progress" } },
  { icon: "▱", label: "Projetos", hint: "Salvar e abrir", command: { action: "screen", screen: "projects" } },
  { icon: "✓", label: "Salvar", hint: "Projeto atual", command: { action: "save_project" } },
  { icon: "▶", label: "MP4", hint: "Preparar 1080p", command: { action: "export_to_ai", kind: "mp4" } },
  { icon: "ZIP", label: "Pacote", hint: "Entregar no chat", command: { action: "export_project_zip" } },
  { icon: "REC", label: "Diagnóstico", hint: "Frames + desempenho", command: { action: "capture_diagnostic" } },
];
