export type Tool = "select" | "rect" | "ellipse";
export type ShapeType = "rect" | "ellipse" | "image" | "text" | "brush" | "empty";
export type CanvasPreset = "square" | "landscape" | "portrait";
export type MotionEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "easeOutBack";
export type MotionKeyframe = { time: number; x: number; y: number; w: number; h: number; rotation: number; radius: number; opacity: number; easing?: MotionEasing };
export type QuizResultBase = {
  x: number; y: number; w: number; h: number; rotation: number; radius: number; fill: string;
  fill2?: string; opacity?: number; stroke?: string; strokeWidth?: number; shadowColor?: string;
  shadowBlur?: number; shadowX?: number; shadowY?: number; keyframes?: MotionKeyframe[];
};
export type SelectedKeyframe = { shapeId: string; time: number };
export type AlignmentAudit = { ok: boolean; score: number; issues: Array<{ key: string; label: string; delta: number }> };
export type AICommand = { action?: string; target?: string; [key: string]: unknown };
export type AIResult = { ok: boolean; action: string; message: string; selectedId?: string | null };
export type AIEnvelope = { type: "forma:command"; requestId?: string; command?: AICommand | string; commands?: AICommand[] };
export type AIResponse = { type: "forma:response"; requestId: string; ok: boolean; results: AIResult[]; state: AIState; artifact: AIState["artifact"] };
export type AIArtifact = { id: string; name: string; mime: string; kind: "image" | "video" | "project" | "bundle"; width?: number; height?: number; duration?: number; size: number; createdAt: string; downloadUrl: string; dataUrl?: string };
export type AIState = {
  version: string;
  ready: boolean;
  canvas: { format: CanvasPreset; width: number; height: number; background: string; zoom: number };
  document: { layerCount: number; layers: Shape[] };
  selection: Shape | null;
  animation: { duration: number; playhead: number; playing: boolean; recordingLayerId: string | null };
  artifact: Pick<AIArtifact, "id" | "name" | "kind" | "mime" | "size" | "width" | "height" | "duration" | "createdAt"> | null;
  ui: { openScreen: string | null; activeTool: Tool };
  scenes?: { activeId: string | null; count: number; items: Array<{ id: string; name: string; kind: SceneKind; duration: number; active: boolean; previousSceneId?: string; nextSceneId?: string; valid?: boolean }> };
  audio?: { activePresetId: string | null; presets: Array<{ id: string; name: string; sceneKind: SceneKind; masterVolume: number; clipCount: number; clips: Array<{ id: string; name: string; start: number; duration: number; fadeIn: number; fadeOut: number; volume: number; loop: boolean; track: number }> }>; automatic?: SceneStingerSettings };
};
export type Shape = {
  id: string; groupId?: string; type: ShapeType; x: number; y: number; w: number; h: number; rotation: number; radius: number; fill: string;
  fill2?: string; gradientAngle?: number; opacity?: number; stroke?: string; strokeWidth?: number; shadowColor?: string; shadowBlur?: number; shadowX?: number; shadowY?: number;
  src?: string; imageSrc?: string; imageScale?: number; imageOffsetX?: number; imageOffsetY?: number; objectFit?: "contain" | "cover";
  brightness?: number; contrast?: number; saturation?: number; hue?: number; colorMatrix?: number[]; name?: string; visible?: boolean; locked?: boolean;
  text?: string; fontSize?: number; fontWeight?: 400 | 700 | 900; letterSpacing?: number; lineHeight?: number; keyframes?: MotionKeyframe[];
  quizResultBase?: QuizResultBase;
};
export type Snapshot = { shapes: Shape[]; background: string; backgroundVideo?: string; format?: CanvasPreset };
export type SceneKind = "intro" | "main" | "result" | "transition";
export type SceneAudioClip = {
  id: string;
  name: string;
  src: string;
  assetId?: string;
  cloudSrc?: string;
  mime: string;
  start: number;
  duration: number;
  sourceDuration?: number;
  sourceBytes?: number;
  trimStart?: number;
  timelineOffset?: number;
  end?: number;
  volume: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
};
export type ProjectSoundtrack = {
  version: 1;
  name: string;
  src: string;
  mime: string;
  duration: number;
  volume: number;
  loop: true;
};
export type ProjectAudioPreset = {
  version: 1;
  id: string;
  name: string;
  masterVolume: number;
  tracks: [SceneAudioTrack, SceneAudioTrack];
};
export type SceneAudioAsset = { id: string; src: string; mime: string };
export type SceneAudioTrack = { id: string; name: string; clips: SceneAudioClip[] };
export type SceneAudioPreset = {
  version: 1;
  id: string;
  name: string;
  sceneKind: SceneKind;
  masterVolume: number;
  tracks: SceneAudioTrack[];
};
export type SceneStingerRole = "main" | "result";
export type SceneStingerPoolSettings = { enabled: boolean; volume: number; probability: number; presetIds: string[] };
export type SceneStingerSettings = { version: 1; main: SceneStingerPoolSettings; result: SceneStingerPoolSettings };
export type AudioBindingTarget = "quiz_3_options_8s" | "true_false_8s" | "guess_logo_8s" | "guess_logo_result_5s" | "emoji_quiz_8s" | "emoji_quiz_result_5s" | "guess_movie_8s" | "guess_movie_result_5s" | "would_you_rather_8s" | "game_find_thief_ab_8s" | "game_chase_lr_8s" | "game_find_thief_correct_5s" | "game_find_thief_wrong_5s" | "game_chase_correct_5s" | "game_chase_wrong_5s" | "quiz_result" | "true_false_result" | `intro:${string}` | `transition:${string}`;
export type AudioPresetBindings = Partial<Record<AudioBindingTarget, string>>;
export type TransitionSpec = {
  version: 1;
  freezePrevious: number;
  preRollNext: number;
  nextRetiming: "stretch";
  backgroundMode: "transparent";
  presetId?: string;
};
export type FormaScene = { id: string; name: string; kind?: SceneKind; animationDuration: number; document: Snapshot; transition?: TransitionSpec; audioPresetId?: string; sceneRole?: "question" | "result"; questionIndex?: number; linkedQuestionId?: number; backgroundPresetId?: string; backgroundVariant?: string };
export type FormaProject = { schema: "forma-project/1.0"; id: string; name: string; createdAt: string; updatedAt: string; animationDuration: number; document: Snapshot; scenes?: FormaScene[]; activeSceneId?: string; audioPresets?: SceneAudioPreset[]; audioAssets?: SceneAudioAsset[]; audioBindings?: AudioPresetBindings; sceneStingers?: SceneStingerSettings; projectSoundtrack?: ProjectSoundtrack; projectAudioPresets?: ProjectAudioPreset[]; activeProjectAudioPresetId?: string };
export type SavedProject = Pick<FormaProject, "id" | "name" | "createdAt" | "updatedAt" | "animationDuration" | "activeSceneId" | "audioPresets" | "audioAssets" | "audioBindings" | "sceneStingers" | "projectSoundtrack" | "projectAudioPresets" | "activeProjectAudioPresetId"> & { document: Snapshot; scenes?: FormaScene[] };
export type ViewState = { zoom: number; panX: number; panY: number };
export type PinchState = { startDistance: number; startZoom: number; worldX: number; worldY: number };
export type Interaction =
  | { kind: "draw"; pointerId: number; startX: number; startY: number; id: string }
  | { kind: "move"; pointerId: number; startX: number; startY: number; shape: Shape; group: Shape[] }
  | { kind: "rotate"; pointerId: number; shape: Shape; startAngle: number; startRotation: number }
  | { kind: "radius"; pointerId: number; shape: Shape }
  | { kind: "resize"; pointerId: number; shape: Shape; handle: string }
  | null;
