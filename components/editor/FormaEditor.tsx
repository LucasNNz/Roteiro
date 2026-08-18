"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AIArtifact, AICommand, AIResponse, AIResult, AIState, AudioBindingTarget, AudioPresetBindings, CanvasPreset, FormaProject, FormaScene, Interaction, MotionEasing, PinchState, ProjectAudioPreset, ProjectSoundtrack, SavedProject, SceneAudioAsset, SceneAudioClip, SceneAudioPreset, SceneKind, SceneStingerSettings, SelectedKeyframe, Shape, Snapshot, Tool, ViewState } from "@/app/types";
import { cloneShapes, keyframeFromShape, safeFileName, shapeAtTime } from "@/lib/geometry";
import { commitHistory, createHistory, historyStatus, moveHistory, restoreHistory, type HistoryState } from "@/lib/state/history";
import { derivePlaybackFrame } from "@/lib/state/playback";
import { zipFiles } from "@/lib/export/zip";
import { buildFormaProject, parseFormaProject, serializeProject, toSavedProject } from "@/lib/projects/serialization";
import { createProjectBundleFiles } from "@/lib/projects/bundle";
import { serializeSvg } from "@/lib/export/svg";
import { blobDataUrl, embedImageSourceSets, embedImageSources as embedSources } from "@/lib/export/assets";
import { loadSvgAsImage, renderSvgPngBlob, saveBlob } from "@/lib/export/browser";
import { exportShapeRuns } from "@/lib/export/render-plan";
import { canRasterHeavyExportImage, heavyExportRasterMargin } from "@/lib/export/heavy-image-raster";
import { canPaintExportVector, paintExportVector } from "@/lib/export/canvas-vector";
import { canPaintExportMedia, paintExportMedia } from "@/lib/export/canvas-media";
import { drawCanvasImageCover } from "@/lib/export/canvas-cover";
import { analyzePlaybackSamples, auditAnimation, summarizeExportDiagnostics, type ExportDiagnosticEvent, type PlaybackSample } from "@/lib/export/diagnostic";
import { renderMp4 } from "@/lib/export/mp4";
import { createQuizSceneFactory } from "@/lib/scenes/factory";
import { AI_CAPABILITIES, type FormaAIBridge } from "@/lib/ai/contracts";
import { commandFromPrompt } from "@/lib/ai/prompt";
import { createAIStateSnapshot } from "@/lib/ai/state";
import { runAIController } from "@/lib/ai/controller";
import { installFormaAITransports } from "@/lib/ai/runtime";
import { handleProjectExportCommand } from "@/lib/ai/commands/project-export";
import { handlePlaybackUICommand } from "@/lib/ai/commands/playback-ui";
import { handleCreationCommand } from "@/lib/ai/commands/creation";
import { handleMediaVisualCommand } from "@/lib/ai/commands/media-visual";
import { handleLayerCommand } from "@/lib/ai/commands/layers";
import { handleOrganizationCommand } from "@/lib/ai/commands/organization";
import { handleAnimationCommand } from "@/lib/ai/commands/animation";
import { handleQuizResultCommand } from "@/lib/ai/commands/quiz-result";
import { handleBinaryQuizResultCommand } from "@/lib/ai/commands/quiz-binary-result";
import { handleMainScenePresetCommand, mainScenePresetMetadata } from "@/lib/ai/commands/main-scene-preset";
import { handleSceneCommand } from "@/lib/ai/commands/scenes";
import { handleAudioCommand } from "@/lib/ai/commands/audio";
import { Topbar } from "@/components/editor/Topbar";
import { ToolDock } from "@/components/editor/ToolDock";
import { AIObservabilityOutputs } from "@/components/editor/AIObservabilityOutputs";
import { CanvasMeta } from "@/components/editor/CanvasMeta";
import { ObjectBar } from "@/components/editor/ObjectBar";
import { PalettePanel } from "@/components/editor/PalettePanel";
import { OutlinePanel } from "@/components/editor/OutlinePanel";
import { CANVAS_FORMATS, FormatPanel } from "@/components/editor/FormatPanel";
import { TextPanel, type TextPatch } from "@/components/editor/TextPanel";
import { AdjustmentsPanel, type VisualPatch } from "@/components/editor/AdjustmentsPanel";
import { ProjectsPanel } from "@/components/editor/ProjectsPanel";
import { ExportPanel } from "@/components/editor/ExportPanel";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { AlignmentPanel } from "@/components/editor/AlignmentPanel";
import { TimelinePanel } from "@/components/editor/TimelinePanel";
import { CanvasSurface } from "@/components/editor/CanvasSurface";
import { CanvasBackgroundVideo } from "@/components/editor/CanvasBackgroundVideo";
import { AIPanel } from "@/components/editor/AIPanel";
import { BatchImportPanel } from "@/components/editor/BatchImportPanel";
import { SceneSwitcher } from "@/components/editor/SceneSwitcher";
import { AudioPanel } from "@/components/editor/AudioPanel";
import { ProjectAudioPanel } from "@/components/editor/ProjectAudioPanel";
import { alignAnswerGroup, answerGroupParts, answerLetterOpticalOffset, auditAnswerGroup, ANSWER_BADGE_COLOR } from "@/lib/alignment/answers";
import { layerLabel } from "@/lib/layers/label";
import { backgroundExportFps, backgroundExportFrameIndex, backgroundExportFrameKey, backgroundPlaybackAtTime, backgroundPresetBySource, backgroundQuantizedMediaTime } from "@/lib/background-presets";
import { BACKGROUND_EXPORT_READY_TIMEOUT_MS, BACKGROUND_EXPORT_SEEK_ATTEMPTS, BACKGROUND_EXPORT_SEEK_TIMEOUT_MS, clampBackgroundSeekTime, nearestBackgroundFrameIndex } from "@/lib/export/background-recovery";
import { cloneScene, createBlankScene, createTransitionScene, deleteScene, ensureTransitionBetween, renameScene, resetSceneCollection, resolveScene, resolveTransitionNeighbors, sceneFromDocument, sceneKind, syncActiveScene } from "@/lib/scenes/collection";
import { adaptShapesForFormat } from "@/lib/layout/corvoquiz-responsive";
import { applyLinkedBackgroundPreset, linkedResultForQuestion } from "@/lib/scenes/background-linking";
import { deriveTransitionComposition, deriveTransitionFrame } from "@/lib/scenes/transition-playback";
import { normalizeTransitionPresetId } from "@/lib/scenes/transition-presets";
import { addAudioClip, assignAudioPreset, audioClipEnvelope, clampAudioStart, cloneAudioPreset, createSceneAudioPreset, effectiveAudioClipDuration, normalizeAudioPreset, packAudioLibrary, presetClips, removeAudioClip, renameAudioPreset, splitAudioClip, unpackAudioLibrary, updateAudioClip } from "@/lib/audio/scenes";
import { applyAudioBindings, removeAudioPresetBindings, setAudioBinding } from "@/lib/audio/bindings";
import { addProjectAudioClip, BUILTIN_MAIN_AUDIO_PRESET_ID, cloneProjectAudioPreset, createProjectAudioPreset, ensureBundledMainAudioPreset, migrateProjectSoundtrack, normalizeProjectAudioPreset, projectDuration, projectExportAudioPreset, projectFullExportAudioPreset, projectMainAudioDuration, projectMainAudioSceneOffset, projectMainAudioStartOffset, removeProjectAudioClip, renameProjectAudioPreset, splitProjectAudioClip, updateProjectAudioClip } from "@/lib/audio/project";
import { createIntroScene, refreshIntroPresetMotion } from "@/lib/scenes/intro-preset";
import { addProjectStingers, addSceneStinger, defaultSceneStingerSettings, normalizeSceneStingerSettings } from "@/lib/audio/stingers";
import { projectFrameAtTime } from "@/lib/scenes/project-playback";
import { buildBatchProject } from "@/lib/batch/project";
import { attachBatchFiles, attachBatchZip } from "@/lib/batch/assets";
import { parseBatchQuizText, type BatchQuizPlan } from "@/lib/batch/parser";
import { audioLibrarySummary, cloudAudioLibraryState, createCloudAudioLibrary, formatAudioLibrarySummary, mergeAudioLibraryByFreshness, mergeAudioLibraryState, parseCloudAudioLibrary, type AudioLibraryState, type AudioLibrarySummary } from "@/lib/audio/cloud-library";
import { adoptProjectAudioRuntimeSources, compactProjectAudioPresetsForStorage, projectAudioPresetsForPortableExport, restoreProjectAudioRuntimeSources, storeProjectAudioAsset } from "@/lib/audio/local-project-assets";
import { loadFixedAudioLibrary, saveFixedAudioLibrary } from "@/lib/audio/local-library-snapshot";
import { prepareAudioLibraryForCloud } from "@/lib/audio/vercel-cloud";
import { audioLibraryRequestHeaders, SHARED_AUDIO_LIBRARY_KEY } from "@/lib/audio/library-key";

const DEFAULT_ANIMATION_DURATION = 4;
const DEFAULT_AUDIO_LIBRARY_URL = "/audio/forma-biblioteca-audio-2026-08-09.json";
const NO_PROJECT_AUDIO_PRESET = "__none__";
const MAX_EXPORT_STATIC_RASTERS = 12;
const MAX_EXPORT_BACKGROUND_CACHE_PIXELS = 64_000_000;

function audioLibraryHasUserContent(state: Pick<AudioLibraryState, "presets" | "projectPresets" | "bindings">) {
  return state.presets.length > 0 || state.projectPresets.some((preset) => preset.id !== BUILTIN_MAIN_AUDIO_PRESET_ID) || Object.keys(state.bindings).length > 0;
}

type CorvoFormaBatchInput = {
  projectId?: string;
  scriptText: string;
  zipBytes?: ArrayBuffer | Uint8Array;
  images?: Array<{ name:string; bytes:ArrayBuffer | Uint8Array }>;
  format?: CanvasPreset;
  autoExport?: boolean;
};

type CorvoFormaBatchResult = {
  ok: true;
  projectId?: string;
  questionCount: number;
  sceneCount: number;
  artifactName?: string;
  artifactSize?: number;
  duration?: number;
  blob?: Blob;
};

type CorvoFormaBridge = {
  version: "corvo-forma/1.0";
  getStatus: () => { ready: boolean; busy: boolean; stage: string; message: string };
  runBatch: (input: CorvoFormaBatchInput) => Promise<CorvoFormaBatchResult>;
};

declare global {
  interface Window {
    FormaAI?: FormaAIBridge;
    CorvoForma?: CorvoFormaBridge;
  }
}

const AI_CAPABILITIES_JSON = JSON.stringify(AI_CAPABILITIES);

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `forma-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatAudioFileSize(bytes: number) {
  const mb = Math.max(0, bytes) / 1024 / 1024;
  return mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}

function formatAudioDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}h ${minutes}min ${secs}s` : `${minutes}min ${secs}s`;
}

export function FormaEditor() {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shapeImageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectAudioInputRef = useRef<HTMLInputElement>(null);
  const projectAudioImportTrackRef = useRef(0);
  const audioImportTrackRef = useRef(0);
  const sceneAudioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const sceneAudioPlaybackRef = useRef(new Map<string, { wasPlayable: boolean; wasPlaying: boolean; lastRelative: number; loopIndex: number; signature: string }>());
  const audioUnlockedRef = useRef(false);
  const audioBlockedNotifiedRef = useRef(false);
  const artifactBlobRef = useRef<Blob | null>(null);
  const backgroundExportVideoRef = useRef(new Map<string, { video: HTMLVideoElement; ready: Promise<void> }>());
  const backgroundExportPosterRef = useRef(new Map<string, Promise<HTMLImageElement | null>>());
  const backgroundExportRetryCooldownRef = useRef(new Map<string, number>());
  const backgroundExportFrameCacheRef = useRef<{ totalPixels: number; order: string[]; entries: Map<string, { pixels: number; promise: Promise<CanvasImageSource> }> }>({ totalPixels: 0, order: [], entries: new Map() });
  const exportStaticRasterRef = useRef<{ sceneId: string | null; entries: Map<string, Promise<HTMLImageElement>> }>({ sceneId: null, entries: new Map() });
  const exportHeavyImageRasterRef = useRef<{ sceneId: string | null; entries: Map<string, Promise<{ image: HTMLImageElement; baseW: number; baseH: number; margin: number }>> }>({ sceneId: null, entries: new Map() });
  const exportMediaImageRef = useRef<{ sceneId: string | null; entries: Map<string, Promise<HTMLImageElement>> }>({ sceneId: null, entries: new Map() });
  const exportRenderStatsRef = useRef({ heavyRasterBuilds: 0, heavyRasterDraws: 0, transitionBaseDraws: 0, transitionBaseKeys: new Set<string>() });
  const exportPaintProfileRef = useRef({
    backgroundSizingMode: "cover-resilient-v18",
    backgroundRequests: 0, backgroundCacheHits: 0, backgroundCacheMisses: 0, backgroundSeeks: 0, backgroundSourceLoads: 0, backgroundAcquireMs: 0, backgroundDrawMs: 0,
    backgroundSeekRetries: 0, backgroundRecoveredFrames: 0, backgroundPosterFallbacks: 0, backgroundSolidFallbacks: 0, backgroundCooldownFallbacks: 0, backgroundVideoResets: 0,
    staticRasterHits: 0, staticRasterBuilds: 0, staticRasterBuildMs: 0, staticRasterDrawMs: 0,
    heavyRasterBuildMs: 0, heavyRasterDrawMs: 0,
    dynamicSvgRasters: 0, dynamicSvgChars: 0, dynamicSvgSerializeMs: 0, dynamicSvgLoadMs: 0, dynamicSvgDrawMs: 0,
    directVectorDraws: 0, directVectorDrawMs: 0,
    directMediaLoads: 0, directMediaLoadMs: 0, directMediaDraws: 0, directMediaDrawMs: 0, skippedInvisibleShapes: 0,
    transitionBaseDrawMs: 0,
  });
  const interaction = useRef<Interaction>(null);
  const activeTouches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<PinchState | null>(null);
  const canvasPanRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const gestureStartShapes = useRef<Shape[] | null>(null);
  const lastSnap = useRef("");
  const history = useRef<HistoryState>(createHistory({ shapes: [], background: "#F5F1E8", format: "square" }));
  const animationFrameRef = useRef<number | null>(null);
  const diagnosticFrameRef = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const motionPanelRef = useRef<HTMLElement>(null);
  const motionTracksRef = useRef<HTMLDivElement>(null);
  const timelineDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const marqueeRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; base: SelectedKeyframe[] } | null>(null);
  const keyframeDragRef = useRef<{ pointerId: number; startX: number; trackWidth: number; selected: SelectedKeyframe[]; source: Shape[]; latest: Shape[]; moved: boolean } | null>(null);
  const floatingPanelDragRef = useRef<{ pointerId: number; panel: HTMLElement; offsetX: number; offsetY: number } | null>(null);
  const aiSubscribersRef = useRef(new Set<(state: AIState) => void>());
  const aiReadySentRef = useRef(false);
  const aiStateOutputRef = useRef<HTMLOutputElement>(null);
  const aiPublishRef = useRef<{ timer: number | null; last: number }>({ timer: null, last: 0 });
  const scenesRef = useRef<FormaScene[]>([]);
  const activeSceneIdRef = useRef<string | null>(null);
  const chromeActionRef = useRef({ undo: () => {}, redo: () => {}, addText: () => {}, toggleAI: () => {}, resetZoom: () => {} });
  const objectActionRef = useRef({ toggleKeyframes: () => {}, openAlignment: () => {}, duplicate: () => {}, remove: () => {} });
  const panelActionRef = useRef<{
    applyColor: (color: string) => void;
    applyBackgroundVideo: (source: string, fallbackColor: string) => void;
    updateOutline: (stroke: string, width: number) => void;
    changeFormat: (format: CanvasPreset) => void;
    updateText: (patch: TextPatch, save?: boolean) => void;
    commitCurrent: () => void;
    updateVisual: (patch: VisualPatch, save?: boolean) => void;
    resetVisual: () => void;
    removeShapeImage: () => void;
  }>({
    applyColor: () => {},
    applyBackgroundVideo: () => {},
    updateOutline: () => {},
    changeFormat: () => {},
    updateText: () => {},
    commitCurrent: () => {},
    updateVisual: () => {},
    resetVisual: () => {},
    removeShapeImage: () => {},
  });
  const deliveryActionRef = useRef<{
    newProject: () => void;
    openProject: (project: SavedProject) => void;
    saveProject: (download: boolean) => Promise<AIArtifact>;
    exportZip: (download: boolean) => Promise<AIArtifact>;
    prepareExport: (options: { kind?: "png" | "svg" | "mp4" | "project" | "zip" | "diagnostic"; scale?: number }) => Promise<AIArtifact>;
    exportMp4: (prepareForAI: boolean) => Promise<AIArtifact>;
    exportProjectMp4: (prepareForAI: boolean) => Promise<AIArtifact>;
    captureDiagnostic: (download: boolean) => Promise<AIArtifact>;
    captureExportDiagnostic: (download: boolean) => Promise<AIArtifact>;
    exportPng: (scale: number) => void;
    exportSvg: () => void;
  }>({
    newProject: () => {},
    openProject: () => {},
    saveProject: async () => { throw new Error("Salvamento indisponível."); },
    exportZip: async () => { throw new Error("Exportação ZIP indisponível."); },
    prepareExport: async () => { throw new Error("Exportação indisponível."); },
    exportMp4: async () => { throw new Error("Exportação MP4 indisponível."); },
    exportProjectMp4: async () => { throw new Error("Exportação do projeto indisponível."); },
    captureDiagnostic: async () => { throw new Error("Diagnóstico indisponível."); },
    captureExportDiagnostic: async () => { throw new Error("Diagnóstico da exportação indisponível."); },
    exportPng: () => {},
    exportSvg: () => {},
  });
  const layerActionRef = useRef<{
    add: () => void;
    toggleVisibility: (id: string) => void;
    toggleLock: (id: string) => void;
    startRename: (shape: Shape) => void;
    finishRename: () => void;
    remove: (id: string) => void;
    move: (id: string, direction: "up" | "down") => void;
  }>({ add: () => {}, toggleVisibility: () => {}, toggleLock: () => {}, startRename: () => {}, finishRename: () => {}, remove: () => {}, move: () => {} });
  const alignmentActionRef = useRef({ repair: () => {}, repairAll: () => {}, distribute: () => {} });
  const timelineActionRef = useRef<{
    startPanelDrag: (event: PointerEvent<HTMLDivElement>) => void;
    movePanel: (event: PointerEvent<HTMLDivElement>) => void;
    endPanelDrag: (event: PointerEvent<HTMLDivElement>) => void;
    togglePlayback: () => void;
    toggleKeyframes: () => void;
    close: () => void;
    startScrub: (event: PointerEvent<HTMLDivElement>) => void;
    scrub: (event: PointerEvent<HTMLDivElement>) => void;
    startMarquee: (event: PointerEvent<HTMLDivElement>) => void;
    moveMarquee: (event: PointerEvent<HTMLDivElement>) => void;
    endMarquee: (event: PointerEvent<HTMLDivElement>) => void;
    startKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => void;
    moveKeyframe: (event: PointerEvent<HTMLButtonElement>) => void;
    endKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => void;
    seekFrame: (shapeId: string, time: number) => void;
  }>({
    startPanelDrag: () => {}, movePanel: () => {}, endPanelDrag: () => {}, togglePlayback: () => {}, toggleKeyframes: () => {}, close: () => {}, startScrub: () => {}, scrub: () => {}, startMarquee: () => {}, moveMarquee: () => {}, endMarquee: () => {}, startKeyframe: () => {}, moveKeyframe: () => {}, endKeyframe: () => {}, seekFrame: () => {},
  });
  const canvasActionRef = useRef<{
    beginTouch: (event: PointerEvent<SVGSVGElement>) => void;
    startCanvas: (event: PointerEvent<SVGSVGElement>) => void;
    movePointer: (event: PointerEvent<SVGSVGElement>) => void;
    endPointer: (event: PointerEvent<SVGSVGElement>) => void;
    startMove: (event: PointerEvent<Element>, shape: Shape) => void;
    startHandle: (event: PointerEvent<Element>, kind: "rotate" | "radius" | "resize", shape: Shape, handle?: string) => void;
  }>({ beginTouch: () => {}, startCanvas: () => {}, movePointer: () => {}, endPointer: () => {}, startMove: () => {}, startHandle: () => {} });
  const aiPanelActionRef = useRef<{
    startDrag: (event: PointerEvent<HTMLDivElement>) => void;
    moveDrag: (event: PointerEvent<HTMLDivElement>) => void;
    endDrag: (event: PointerEvent<HTMLDivElement>) => void;
    resetPosition: (event: React.MouseEvent<HTMLDivElement>) => void;
    submitPrompt: () => void;
    runWebScript: () => void;
    execute: (command: AICommand) => void;
  }>({ startDrag: () => {}, moveDrag: () => {}, endDrag: () => {}, resetPosition: () => {}, submitPrompt: () => {}, runWebScript: () => {}, execute: () => {} });
  const aiRuntimeRef = useRef<{ getState: () => AIState; getArtifact: () => AIArtifact | null; prepareExport: FormaAIBridge["prepareExport"]; downloadArtifact: () => Promise<void>; listProjects: FormaAIBridge["listProjects"]; execute: FormaAIBridge["execute"]; run: (input: string | AICommand | AICommand[], requestId?: string) => Promise<AIResponse>; open: () => void } | null>(null);
  const corvoFormaRunRef = useRef<(input: CorvoFormaBatchInput) => Promise<CorvoFormaBatchResult>>(async () => { throw new Error("Ponte automática do Forma ainda não está pronta."); });
  const corvoFormaPendingRef = useRef<{
    projectId?: string; questionCount: number; sceneCount: number;
    resolve: (value: CorvoFormaBatchResult) => void; reject: (reason?: unknown) => void;
  } | null>(null);
  const corvoFormaBusyRef = useRef(false);
  const corvoFormaStatusRef = useRef({ ready:false, busy:false, stage:"BOOT", message:"Inicializando Forma…" });
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [background, setBackground] = useState("#F5F1E8");
  const [backgroundVideo, setBackgroundVideo] = useState<string | undefined>();
  const [format, setFormat] = useState<CanvasPreset>("square");
  const [hydrated, setHydrated] = useState(false);
  const [tool, setTool] = useState<Tool>("rect");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shapeColor, setShapeColor] = useState("#7C5CFC");
  const [paletteOpen, setPaletteOpen] = useState<"background" | "shape" | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [scenes, setScenes] = useState<FormaScene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [audioPresets, setAudioPresets] = useState<SceneAudioPreset[]>([]);
  const [audioBindings, setAudioBindings] = useState<AudioPresetBindings>({});
  const [audioCloudReady, setAudioCloudReady] = useState(false);
  const [audioCloudStatus, setAudioCloudStatus] = useState<"local" | "fixed" | "synced" | "saving" | "error">("local");
  const [audioCloudMessage, setAudioCloudMessage] = useState("Seus presets continuam salvos neste navegador.");
  const [audioCloudUpdatedAt, setAudioCloudUpdatedAt] = useState<string | null>(null);
  const [sceneStingers, setSceneStingers] = useState<SceneStingerSettings>(() => defaultSceneStingerSettings());
  const [projectAudioPresets, setProjectAudioPresets] = useState<ProjectAudioPreset[]>([]);
  const [activeProjectAudioPresetId, setActiveProjectAudioPresetId] = useState<string | null>(null);
  const [projectAudioEditing, setProjectAudioEditing] = useState(false);
  const [editingProjectAudioPresetId, setEditingProjectAudioPresetId] = useState<string | null>(null);
  const [selectedProjectAudioClipId, setSelectedProjectAudioClipId] = useState<string | null>(null);
  const [projectAudioImportMessage, setProjectAudioImportMessage] = useState("");
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioEditing, setAudioEditing] = useState(false);
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [diagnosticActive, setDiagnosticActive] = useState(false);
  const [exportDiagnosticActive, setExportDiagnosticActive] = useState(false);
  const [guides, setGuides] = useState<{ x?: number; y?: number; angle?: number }>({});
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [liveShapeIds, setLiveShapeIds] = useState<Set<string>>(() => new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [animationDuration, setAnimationDuration] = useState(DEFAULT_ANIMATION_DURATION);
  const [timelinePosition, setTimelinePosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedKeyframes, setSelectedKeyframes] = useState<SelectedKeyframe[]>([]);
  const [keyframeMarquee, setKeyframeMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [corvoFormaExportTrigger, setCorvoFormaExportTrigger] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWebScript, setAiWebScript] = useState("");
  const [aiLastResponse, setAiLastResponse] = useState<AIResponse | null>(null);
  const [aiLog, setAiLog] = useState<Array<{ id: string; message: string; ok: boolean }>>([]);
  const [aiArtifact, setAiArtifact] = useState<AIArtifact | null>(null);
  const audioCloudSaveTimerRef = useRef<number | null>(null);
  const audioBundledDefaultsAttemptedRef = useRef(false);
  const audioLibraryLiveStateRef = useRef<AudioLibraryState>({
    presets: audioPresets,
    bindings: audioBindings,
    stingers: sceneStingers,
    projectPresets: projectAudioPresets,
    activeProjectPresetId: activeProjectAudioPresetId,
  });
  audioLibraryLiveStateRef.current = {
    presets: audioPresets,
    bindings: audioBindings,
    stingers: sceneStingers,
    projectPresets: projectAudioPresets,
    activeProjectPresetId: activeProjectAudioPresetId,
  };
  const audioCloudApplyingRef = useRef(false);
  const audioCloudSkipAutoOnceRef = useRef(false);
  const audioCloudRestoreAttemptedRef = useRef(false);
  const { width: W, height: H } = CANVAS_FORMATS[format];
  const { componentShapes, quizScene } = createQuizSceneFactory({ width: W, height: H, animationDuration, answerBadgeColor: ANSWER_BADGE_COLOR, makeId, answerLetterOpticalOffset });

  const selected = useMemo(() => shapes.find((shape) => shape.id === selectedId) ?? null, [shapes, selectedId]);
  const activeScene = useMemo(() => scenes.find((scene) => scene.id === activeSceneId) ?? null, [scenes, activeSceneId]);
  const activeAudioPreset = useMemo(() => audioPresets.find((preset) => preset.id === activeScene?.audioPresetId) ?? null, [audioPresets, activeScene]);
  const totalProjectDuration = useMemo(() => projectDuration(scenes), [scenes]);
  const projectAudioStartOffset = useMemo(() => projectMainAudioStartOffset(scenes), [scenes]);
  const projectAudioTimelineDuration = useMemo(() => Math.max(.05, projectMainAudioDuration(scenes)), [scenes]);
  const activeProjectAudioOffset = useMemo(() => projectMainAudioSceneOffset(scenes, activeSceneId), [scenes, activeSceneId]);
  const activeProjectAudioPreset = useMemo(() => projectAudioPresets.find((preset) => preset.id === activeProjectAudioPresetId) ?? null, [projectAudioPresets, activeProjectAudioPresetId]);
  const editingProjectAudioPreset = useMemo(() => projectAudioPresets.find((preset) => preset.id === editingProjectAudioPresetId) ?? null, [projectAudioPresets, editingProjectAudioPresetId]);
  const previewProjectAudioPreset = projectAudioEditing ? editingProjectAudioPreset : activeProjectAudioPreset;
  const activePlaybackAudioPreset = useMemo(() => addSceneStinger(projectExportAudioPreset(activeAudioPreset, previewProjectAudioPreset, activeProjectAudioOffset, animationDuration, projectAudioTimelineDuration), activeScene, sceneStingers), [activeAudioPreset, previewProjectAudioPreset, activeProjectAudioOffset, animationDuration, projectAudioTimelineDuration, activeScene, sceneStingers]);
  const transitionFrame = useMemo(() => activeScene && sceneKind(activeScene) === "transition" ? deriveTransitionFrame(scenes, activeScene.id, playhead) : null, [activeScene, scenes, playhead]);
  const displayedShapes = useMemo(() => {
    const overlay = derivePlaybackFrame(shapes, playhead, liveShapeIds);
    if (!transitionFrame?.valid) return overlay;
    const prefix = `transition-source-${transitionFrame.baseScene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-`;
    const source = derivePlaybackFrame(transitionFrame.baseScene.document.shapes, transitionFrame.baseTime).map((shape) => ({ ...shape, id: `${prefix}${shape.id}`, groupId: shape.groupId ? `${prefix}${shape.groupId}` : undefined, locked: true, name: `Fonte · ${shape.name ?? shape.id}` }));
    return [...source, ...overlay];
  }, [shapes, playhead, liveShapeIds, transitionFrame]);
  const renderedBackground = transitionFrame?.valid ? transitionFrame.baseScene.document.background : background;
  const renderedBackgroundVideo = transitionFrame?.valid ? transitionFrame.baseScene.document.backgroundVideo : backgroundVideo;
  const renderedBackgroundTime = transitionFrame?.valid ? transitionFrame.baseTime : playhead;
  const inverseCanvasZoom = 1 / view.zoom;
  const hasAnimation = useMemo(() => Boolean(backgroundVideo) || Boolean(activePlaybackAudioPreset) || activeScene && sceneKind(activeScene) === "transition" || shapes.some((shape) => (shape.keyframes?.length ?? 0) > 0), [backgroundVideo, shapes, activeScene, activePlaybackAudioPreset]);
  const visibleShapeCount = useMemo(() => shapes.filter((shape) => shape.visible !== false).length, [shapes]);
  const selectedAnswerGroup = selected?.groupId?.startsWith("answer-") ? selected.groupId : null;
  const selectedAlignmentAudit = useMemo(() => selectedAnswerGroup ? auditAnswerGroup(selectedAnswerGroup, shapes) : null, [selectedAnswerGroup, shapes]);
  const aiStaticState = useMemo(() => createAIStateSnapshot({ hydrated, format, width: W, height: H, background, zoom: view.zoom, shapes, selected, animationDuration, playhead: 0, isPlaying: false, recordingId, aiArtifact, tool, open: { ai: aiOpen, projects: projectOpen, layers: layersOpen, timeline: timelineOpen, alignment: alignmentOpen, adjustments: adjustmentsOpen, colors: Boolean(paletteOpen), outline: outlineOpen, format: formatOpen, text: textOpen, export: exportOpen } }), [hydrated, format, W, H, background, view.zoom, shapes, selected, animationDuration, recordingId, aiArtifact, tool, aiOpen, projectOpen, layersOpen, timelineOpen, alignmentOpen, adjustmentsOpen, paletteOpen, outlineOpen, formatOpen, textOpen, exportOpen]);
  const aiResponseJson = useMemo(() => aiLastResponse ? JSON.stringify(aiLastResponse) : "", [aiLastResponse]);
  const aiProjectsJson = useMemo(() => JSON.stringify(savedProjects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))), [savedProjects]);
  const aiAlignmentJson = useMemo(() => selectedAlignmentAudit ? JSON.stringify(selectedAlignmentAudit) : "", [selectedAlignmentAudit]);
  const topbarCallbacks = useMemo(() => ({
    onOpenProjects: () => setProjectOpen(true),
    onUndo: () => chromeActionRef.current.undo(),
    onRedo: () => chromeActionRef.current.redo(),
    onToggleExport: () => setExportOpen((open) => !open),
  }), []);
  const dockCallbacks = useMemo(() => ({
    onSelectTool: (nextTool: Tool) => setTool(nextTool),
    onAddText: () => chromeActionRef.current.addText(),
    onImportImage: () => fileInputRef.current?.click(),
    onToggleBackground: () => setPaletteOpen((open) => open === "background" ? null : "background"),
    onToggleLayers: () => setLayersOpen((open) => !open),
    onToggleAudio: () => { setAudioOpen((open) => !open); setAudioEditing(false); setProjectAudioEditing(false); setSelectedAudioClipId(null); setSelectedProjectAudioClipId(null); },
    onToggleAI: () => chromeActionRef.current.toggleAI(),
  }), []);
  const canvasMetaCallbacks = useMemo(() => ({
    onOpenFormat: () => setFormatOpen(true),
    onResetZoom: () => chromeActionRef.current.resetZoom(),
    onToggleScenes: () => setSceneOpen((open) => !open),
  }), []);
  const objectBarCallbacks = useMemo(() => ({
    onToggleKeyframes: () => objectActionRef.current.toggleKeyframes(),
    onOpenAlignment: () => objectActionRef.current.openAlignment(),
    onEditText: () => setTextOpen(true),
    onChooseImage: () => shapeImageInputRef.current?.click(),
    onOpenAdjustments: () => { setAdjustmentsOpen(true); setPaletteOpen(null); setOutlineOpen(false); },
    onOpenColor: () => setPaletteOpen("shape"),
    onOpenOutline: () => { setOutlineOpen(true); setPaletteOpen(null); },
    onOpenLayers: () => setLayersOpen(true),
    onDuplicate: () => objectActionRef.current.duplicate(),
    onRemove: () => objectActionRef.current.remove(),
  }), []);
  const panelCallbacks = useMemo(() => ({
    onApplyColor: (color: string) => panelActionRef.current.applyColor(color),
    onApplyBackgroundVideo: (source: string, fallbackColor: string) => panelActionRef.current.applyBackgroundVideo(source, fallbackColor),
    onClosePalette: () => setPaletteOpen(null),
    onUpdateOutline: (stroke: string, width: number) => panelActionRef.current.updateOutline(stroke, width),
    onCloseOutline: () => setOutlineOpen(false),
    onChangeFormat: (nextFormat: CanvasPreset) => panelActionRef.current.changeFormat(nextFormat),
    onCloseFormat: () => setFormatOpen(false),
    onUpdateText: (patch: TextPatch, save?: boolean) => panelActionRef.current.updateText(patch, save),
    onCommitCurrent: () => panelActionRef.current.commitCurrent(),
    onCloseText: () => setTextOpen(false),
    onUpdateVisual: (patch: VisualPatch, save?: boolean) => panelActionRef.current.updateVisual(patch, save),
    onResetVisual: () => panelActionRef.current.resetVisual(),
    onRemoveShapeImage: () => panelActionRef.current.removeShapeImage(),
    onChooseShapeImage: () => shapeImageInputRef.current?.click(),
    onCloseAdjustments: () => setAdjustmentsOpen(false),
  }), []);
  const projectCallbacks = useMemo(() => ({
    onNameChange: (name: string) => setProjectName(name),
    onNew: () => deliveryActionRef.current.newProject(),
    onSave: () => { void deliveryActionRef.current.saveProject(false); },
    onChooseFile: () => projectInputRef.current?.click(),
    onOpen: (project: SavedProject) => deliveryActionRef.current.openProject(project),
    onDelete: (id: string) => setSavedProjects((current) => current.filter((item) => item.id !== id)),
    onDownload: () => { void deliveryActionRef.current.saveProject(true); },
    onDownloadZip: () => { void deliveryActionRef.current.exportZip(true); },
    onClose: () => setProjectOpen(false),
  }), []);
  const exportCallbacks = useMemo(() => ({
    onPreparePng: () => { void deliveryActionRef.current.prepareExport({ kind: "png", scale: 1 }); },
    onExportMp4: () => { void deliveryActionRef.current.exportMp4(false).catch(() => {}); },
    onExportProjectMp4: () => { void deliveryActionRef.current.exportProjectMp4(false).catch(() => {}); },
    onPrepareMp4: () => { void deliveryActionRef.current.prepareExport({ kind: "mp4" }).catch(() => {}); },
    onExportZip: () => { void deliveryActionRef.current.exportZip(false).catch(() => {}); },
    onDiagnostic: () => { void deliveryActionRef.current.captureDiagnostic(false).catch(() => {}); },
    onExportDiagnostic: () => { void deliveryActionRef.current.captureExportDiagnostic(true).catch(() => {}); },
    onDownloadProject: () => { void deliveryActionRef.current.saveProject(true); },
    onExportPng: (scale: number) => deliveryActionRef.current.exportPng(scale),
    onExportSvg: () => deliveryActionRef.current.exportSvg(),
  }), []);
  const layerCallbacks = useMemo(() => ({
    onAdd: () => layerActionRef.current.add(),
    onSelect: (id: string) => { setSelectedId(id); setTool("select"); },
    onToggleVisibility: (id: string) => layerActionRef.current.toggleVisibility(id),
    onToggleLock: (id: string) => layerActionRef.current.toggleLock(id),
    onStartRename: (shape: Shape) => layerActionRef.current.startRename(shape),
    onRenameChange: (value: string) => setRenameValue(value),
    onFinishRename: () => layerActionRef.current.finishRename(),
    onCancelRename: () => setRenamingId(null),
    onDelete: (id: string) => layerActionRef.current.remove(id),
    onMove: (id: string, direction: "up" | "down") => layerActionRef.current.move(id, direction),
    onClose: () => setLayersOpen(false),
  }), []);
  const alignmentCallbacks = useMemo(() => ({
    onRepair: () => alignmentActionRef.current.repair(),
    onRepairAll: () => alignmentActionRef.current.repairAll(),
    onDistribute: () => alignmentActionRef.current.distribute(),
    onClose: () => setAlignmentOpen(false),
  }), []);
  const timelineCallbacks = useMemo(() => ({
    onStartPanelDrag: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.startPanelDrag(event),
    onMovePanel: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.movePanel(event),
    onEndPanelDrag: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.endPanelDrag(event),
    onResetPosition: () => setTimelinePosition(null),
    onTogglePlayback: () => timelineActionRef.current.togglePlayback(),
    onToggleKeyframes: () => timelineActionRef.current.toggleKeyframes(),
    onClose: () => timelineActionRef.current.close(),
    onStartScrub: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.startScrub(event),
    onScrub: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.scrub(event),
    onStartMarquee: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.startMarquee(event),
    onMoveMarquee: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.moveMarquee(event),
    onEndMarquee: (event: PointerEvent<HTMLDivElement>) => timelineActionRef.current.endMarquee(event),
    onSelectShape: (id: string) => { setSelectedId(id); setTool("select"); },
    onStartKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => timelineActionRef.current.startKeyframe(event, shapeId, time),
    onMoveKeyframe: (event: PointerEvent<HTMLButtonElement>) => timelineActionRef.current.moveKeyframe(event),
    onEndKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => timelineActionRef.current.endKeyframe(event, shapeId, time),
    onSeekFrame: (shapeId: string, time: number) => timelineActionRef.current.seekFrame(shapeId, time),
  }), []);
  const canvasCallbacks = useMemo(() => ({
    onBeginTouch: (event: PointerEvent<SVGSVGElement>) => canvasActionRef.current.beginTouch(event),
    onStartCanvas: (event: PointerEvent<SVGSVGElement>) => canvasActionRef.current.startCanvas(event),
    onMovePointer: (event: PointerEvent<SVGSVGElement>) => canvasActionRef.current.movePointer(event),
    onEndPointer: (event: PointerEvent<SVGSVGElement>) => canvasActionRef.current.endPointer(event),
    onStartMove: (event: PointerEvent<Element>, shape: Shape) => canvasActionRef.current.startMove(event, shape),
    onStartHandle: (event: PointerEvent<Element>, kind: "rotate" | "radius" | "resize", shape: Shape, handle?: string) => canvasActionRef.current.startHandle(event, kind, shape, handle),
  }), []);
  const aiPanelCallbacks = useMemo(() => ({
    onStartDrag: (event: PointerEvent<HTMLDivElement>) => aiPanelActionRef.current.startDrag(event),
    onMoveDrag: (event: PointerEvent<HTMLDivElement>) => aiPanelActionRef.current.moveDrag(event),
    onEndDrag: (event: PointerEvent<HTMLDivElement>) => aiPanelActionRef.current.endDrag(event),
    onResetPosition: (event: React.MouseEvent<HTMLDivElement>) => aiPanelActionRef.current.resetPosition(event),
    onClose: () => setAiOpen(false),
    onOpenBatchImport: () => { setAiOpen(false); setBatchOpen(true); },
    onPromptChange: (value: string) => setAiPrompt(value),
    onSubmitPrompt: () => aiPanelActionRef.current.submitPrompt(),
    onChooseSuggestion: (value: string) => setAiPrompt(value),
    onWebScriptChange: (value: string) => setAiWebScript(value),
    onUseExample: () => setAiWebScript(JSON.stringify({ action: "create_scene", scene: "quiz_question", duration: 8, background: "#18A957", animatedBackground: true, question: "QUAL É O MAIOR PLANETA DO SISTEMA SOLAR?", answers: ["MARTE", "JÚPITER", "VÊNUS"] }, null, 2)),
    onRunWebScript: () => aiPanelActionRef.current.runWebScript(),
    onExecute: (command: AICommand) => aiPanelActionRef.current.execute(command),
  }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem("forma-document-v1") ?? "null") as Snapshot | null;
        const restored = { shapes: parsed?.shapes ?? [], background: parsed?.background ?? "#F5F1E8", backgroundVideo: parsed?.backgroundVideo, format: parsed?.format ?? "square" as CanvasPreset };
        const storedDuration = Math.max(1, Math.min(60, Number(localStorage.getItem("forma-animation-duration-v1")) || DEFAULT_ANIMATION_DURATION));
        const workspace = JSON.parse(localStorage.getItem("forma-scenes-v1") ?? "null") as { scenes?: FormaScene[]; activeSceneId?: string } | null;
        const storedAudio = JSON.parse(localStorage.getItem("forma-audio-presets-v1") ?? "[]") as SceneAudioPreset[] | { presets?: SceneAudioPreset[]; assets?: SceneAudioAsset[] };
        const storedAudioBindings = JSON.parse(localStorage.getItem("forma-audio-bindings-v1") ?? "{}") as AudioPresetBindings;
        const storedSceneStingers = JSON.parse(localStorage.getItem("forma-scene-stingers-v1") ?? "null") as SceneStingerSettings | null;
        const storedProjectSoundtrack = JSON.parse(localStorage.getItem("forma-project-soundtrack-v1") ?? "null") as ProjectSoundtrack | null;
        const storedProjectAudioPresets = JSON.parse(localStorage.getItem("forma-project-audio-presets-v1") ?? "[]") as ProjectAudioPreset[];
        const storedActiveProjectAudioPresetId = localStorage.getItem("forma-project-audio-active-v1");
        const restoredScenes = Array.isArray(workspace?.scenes) && workspace.scenes.length
          ? workspace.scenes.map(cloneScene)
          : [sceneFromDocument(makeId(), "Cena 1", { ...restored, animationDuration: storedDuration })];
        const restoredActiveId = restoredScenes.some((scene) => scene.id === workspace?.activeSceneId) ? workspace!.activeSceneId! : restoredScenes[0].id;
        const activeScene = restoredScenes.find((scene) => scene.id === restoredActiveId)!;
        scenesRef.current = restoredScenes;
        activeSceneIdRef.current = restoredActiveId;
        setScenes(restoredScenes);
        setActiveSceneId(restoredActiveId);
        setAudioPresets(Array.isArray(storedAudio) ? unpackAudioLibrary(storedAudio, undefined) : unpackAudioLibrary(storedAudio.presets, storedAudio.assets));
        setAudioBindings(storedAudioBindings && typeof storedAudioBindings === "object" ? storedAudioBindings : {});
        setSceneStingers(normalizeSceneStingerSettings(storedSceneStingers));
        const migratedProjectAudioBase = Array.isArray(storedProjectAudioPresets) && storedProjectAudioPresets.length ? storedProjectAudioPresets.map(normalizeProjectAudioPreset) : [migrateProjectSoundtrack(storedProjectSoundtrack)].filter((preset): preset is ProjectAudioPreset => Boolean(preset));
        const migratedProjectAudio = ensureBundledMainAudioPreset(migratedProjectAudioBase);
        setProjectAudioPresets(migratedProjectAudio);
        const restoredProjectAudioPresetId = storedActiveProjectAudioPresetId === NO_PROJECT_AUDIO_PRESET
          ? null
          : migratedProjectAudio.some((preset) => preset.id === storedActiveProjectAudioPresetId)
            ? storedActiveProjectAudioPresetId
            : storedProjectSoundtrack && migratedProjectAudio.length
              ? migratedProjectAudio[0].id
              : null;
        setActiveProjectAudioPresetId(restoredProjectAudioPresetId);
        setShapes(cloneShapes(activeScene.document.shapes));
        setBackground(activeScene.document.background);
        setBackgroundVideo(activeScene.document.backgroundVideo);
        setFormat(activeScene.document.format ?? "square");
        setAnimationDuration(Math.max(1, Math.min(60, activeScene.animationDuration || storedDuration)));
        history.current = createHistory({ shapes: activeScene.document.shapes, background: activeScene.document.background, backgroundVideo: activeScene.document.backgroundVideo, format: activeScene.document.format ?? "square" });
        const library = JSON.parse(localStorage.getItem("forma-projects-v1") ?? "[]") as SavedProject[];
        setSavedProjects(Array.isArray(library) ? library : []);
        setProjectName(localStorage.getItem("forma-project-name-v1") || "Projeto sem título");
        setCurrentProjectId(localStorage.getItem("forma-project-id-v1"));
      } catch {}
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || isPlaying) return;
    try { localStorage.setItem("forma-document-v1", JSON.stringify({ shapes, background, backgroundVideo, format })); } catch {}
  }, [shapes, background, backgroundVideo, format, hydrated, isPlaying]);

  useEffect(() => {
    if (!hydrated || isPlaying || !activeSceneIdRef.current) return;
    const next = applyAudioBindings(syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration }), audioBindings);
    scenesRef.current = next;
    setScenes(next);
    try { localStorage.setItem("forma-scenes-v1", JSON.stringify({ scenes: next, activeSceneId: activeSceneIdRef.current })); } catch {}
  }, [shapes, background, backgroundVideo, format, animationDuration, audioBindings, hydrated, isPlaying]);

  useEffect(() => {
    if (!hydrated || isPlaying || !scenes.length) return;
    try { localStorage.setItem("forma-scenes-v1", JSON.stringify({ scenes, activeSceneId: activeSceneIdRef.current })); } catch {}
  }, [scenes, hydrated, isPlaying]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const localProjects = savedProjects.map((project) => project.projectAudioPresets?.length ? { ...project, projectAudioPresets: compactProjectAudioPresetsForStorage(project.projectAudioPresets) } : project);
      localStorage.setItem("forma-projects-v1", JSON.stringify(localProjects));
      localStorage.setItem("forma-project-name-v1", projectName);
      if (currentProjectId) localStorage.setItem("forma-project-id-v1", currentProjectId); else localStorage.removeItem("forma-project-id-v1");
      localStorage.setItem("forma-animation-duration-v1", String(animationDuration));
    } catch { window.setTimeout(() => setExportMessage("O armazenamento local está cheio. Exporte o projeto para não perder as alterações."), 0); }
  }, [savedProjects, projectName, currentProjectId, animationDuration, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("forma-audio-presets-v1", JSON.stringify(packAudioLibrary(audioPresets))); } catch { window.setTimeout(() => setExportMessage("O armazenamento local está cheio. Exporte o projeto para não perder o áudio."), 0); }
  }, [audioPresets, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("forma-audio-bindings-v1", JSON.stringify(audioBindings)); } catch {}
  }, [audioBindings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("forma-scene-stingers-v1", JSON.stringify(sceneStingers)); } catch {}
  }, [sceneStingers, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("forma-project-audio-presets-v1", JSON.stringify(compactProjectAudioPresetsForStorage(projectAudioPresets)));
      localStorage.setItem("forma-project-audio-active-v1", activeProjectAudioPresetId ?? NO_PROJECT_AUDIO_PRESET);
      localStorage.removeItem("forma-project-soundtrack-v1");
    } catch { window.setTimeout(() => setExportMessage("O armazenamento local está cheio. Exporte o projeto para não perder o áudio principal."), 0); }
  }, [projectAudioPresets, activeProjectAudioPresetId, hydrated]);

  useEffect(() => {
    if (!hydrated || !projectAudioPresets.length) return;
    const needsAdoption = projectAudioPresets.some((preset) => preset.tracks.some((track) => track.clips.some((clip) => clip.src.startsWith("data:"))));
    const needsRestore = projectAudioPresets.some((preset) => preset.tracks.some((track) => track.clips.some((clip) => !clip.src && Boolean(clip.assetId))));
    if (!needsAdoption && !needsRestore) return;
    let cancelled = false;
    const prepareLocalSources = async () => {
      try {
        let next = projectAudioPresets;
        let changed = false;
        if (needsAdoption) {
          const adopted = await adoptProjectAudioRuntimeSources(next);
          next = adopted.presets;
          changed = changed || adopted.changed;
        }
        const restored = await restoreProjectAudioRuntimeSources(next);
        next = restored.presets;
        changed = changed || restored.restored > 0;
        if (!cancelled && changed) setProjectAudioPresets(next);
      } catch (error) {
        if (!cancelled) setProjectAudioImportMessage(error instanceof Error ? error.message : "Não foi possível restaurar um arquivo grande de áudio.");
      }
    };
    void prepareLocalSources();
    return () => { cancelled = true; };
  }, [hydrated, projectAudioPresets]);

  useEffect(() => {
    if (!audioCloudReady || audioCloudApplyingRef.current) return;
    if (audioCloudSkipAutoOnceRef.current) { audioCloudSkipAutoOnceRef.current = false; return; }
    if (audioCloudSaveTimerRef.current !== null) window.clearTimeout(audioCloudSaveTimerRef.current);
    setAudioCloudStatus("saving");
    setAudioCloudMessage("Fixando automaticamente as alterações…");
    audioCloudSaveTimerRef.current = window.setTimeout(() => {
      const state = audioLibraryLiveStateRef.current;
      void saveFixedAudioLibrary(state).then((fixed) => {
        const summary = audioLibrarySummary(fixed);
        localStorage.setItem("forma-audio-fixed-updated-v1", fixed.updatedAt);
        setAudioCloudUpdatedAt(fixed.updatedAt);
        setAudioCloudStatus("fixed");
        setAudioCloudMessage(`${formatAudioLibrarySummary(summary)} fixados automaticamente neste aparelho.`);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "Não foi possível atualizar a cópia fixa.";
        setAudioCloudStatus("error");
        setAudioCloudMessage(`${message} Baixe uma cópia antes de fechar o Forma.`);
      });
    }, 1200);
    return () => { if (audioCloudSaveTimerRef.current !== null) window.clearTimeout(audioCloudSaveTimerRef.current); };
  }, [audioPresets, audioBindings, sceneStingers, projectAudioPresets, activeProjectAudioPresetId, audioCloudReady]);

  useEffect(() => {
    if (!hydrated || audioBundledDefaultsAttemptedRef.current || audioLibraryHasUserContent(audioLibraryLiveStateRef.current)) return;
    audioBundledDefaultsAttemptedRef.current = true;
    let cancelled = false;
    const restoreBundledDefaults = async () => {
      try {
        const fixed = await loadFixedAudioLibrary().catch(() => null);
        if (cancelled || audioLibraryHasUserContent(audioLibraryLiveStateRef.current) || (fixed && audioLibraryHasUserContent(cloudAudioLibraryState(fixed)))) return;
        const response = await fetch(DEFAULT_AUDIO_LIBRARY_URL, { cache: "force-cache" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const bundled = parseCloudAudioLibrary(payload);
        if (!bundled || cancelled || audioLibraryHasUserContent(audioLibraryLiveStateRef.current)) return;
        applyCloudAudioState(cloudAudioLibraryState(bundled));
        localStorage.setItem("forma-audio-cloud-updated-v1", bundled.updatedAt);
        setAudioCloudUpdatedAt(bundled.updatedAt);
        setAudioCloudStatus("local");
        setAudioCloudMessage(`${formatAudioLibrarySummary(audioLibrarySummary(bundled))} carregados como biblioteca padrão deste aparelho.`);
      } catch {
        // Se o pacote padrão não estiver disponível, o editor continua usando a biblioteca local vazia.
      }
    };
    void restoreBundledDefaults();
    return () => { cancelled = true; };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || audioCloudRestoreAttemptedRef.current) return;
    audioCloudRestoreAttemptedRef.current = true;
    let cancelled = false;
    const restoreInBackground = async () => {
      let merged = audioLibraryLiveStateRef.current;
      let fixed = null;
      let localUpdatedAt: string | null = localStorage.getItem("forma-audio-fixed-updated-v1");
      try {
        fixed = await loadFixedAudioLibrary();
        if (fixed && !cancelled) {
          merged = mergeAudioLibraryState(cloudAudioLibraryState(fixed), merged);
          localUpdatedAt = fixed.updatedAt;
          audioCloudSkipAutoOnceRef.current = true;
          applyCloudAudioState(merged);
          setAudioCloudUpdatedAt(fixed.updatedAt);
          setAudioCloudStatus("fixed");
          setAudioCloudMessage(`LOCAL ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(fixed))} recuperados deste aparelho. Buscando a nuvem…`);
          setAudioCloudReady(true);
        }
      } catch {
        // A restauração remota continua disponível mesmo sem IndexedDB.
      }

      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30000);
        const response = await fetch("/api/audio-library", { cache: "no-store", headers: audioLibraryRequestHeaders(), signal: controller.signal }).finally(() => window.clearTimeout(timeout));
        const payload = await response.json().catch(() => null) as { library?: unknown; message?: string; configured?: boolean } | null;
        if (!response.ok) {
          if (!cancelled) {
            if (fixed) {
              setAudioCloudStatus("fixed");
              setAudioCloudMessage(`LOCAL ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(fixed))}. NUVEM ✕ · ${payload?.message || "indisponível"}`);
            } else {
              setAudioCloudStatus("local");
              setAudioCloudMessage(`Preservado neste navegador. NUVEM ✕ · ${payload?.message || "indisponível"}`);
              setAudioCloudReady(true);
            }
          }
          return;
        }
        const remote = parseCloudAudioLibrary(payload && typeof payload === "object" && "library" in payload ? payload.library : payload);
        if (cancelled) return;
        if (!remote) {
          if (!fixed) {
            setAudioCloudStatus("local");
            setAudioCloudMessage("NUVEM ✓ · conectada e ainda vazia. Sincronize uma vez para compartilhar seus presets entre aparelhos.");
            setAudioCloudReady(true);
          } else {
            setAudioCloudStatus("fixed");
            setAudioCloudMessage(`LOCAL ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(fixed))}. NUVEM ✓ · conectada, ainda sem biblioteca salva.`);
          }
          return;
        }

        const remoteTime = Date.parse(remote.updatedAt);
        const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
        const remoteWins = Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime >= localTime);
        merged = mergeAudioLibraryByFreshness(remote, merged, localUpdatedAt);
        audioCloudSkipAutoOnceRef.current = true;
        applyCloudAudioState(merged);
        const snapshotStamp = remoteWins ? remote.updatedAt : localUpdatedAt || remote.updatedAt;
        await saveFixedAudioLibrary(merged, snapshotStamp).catch(() => null);
        localStorage.setItem("forma-audio-fixed-updated-v1", snapshotStamp);
        localStorage.setItem("forma-audio-cloud-updated-v1", remote.updatedAt);
        setAudioCloudUpdatedAt(remoteWins ? remote.updatedAt : snapshotStamp);
        setAudioCloudReady(true);
        if (remoteWins) {
          setAudioCloudStatus("synced");
          setAudioCloudMessage(`LOCAL ✓ · NUVEM ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(createCloudAudioLibrary(merged, remote.updatedAt)))} disponíveis neste aparelho.`);
        } else {
          setAudioCloudStatus("fixed");
          setAudioCloudMessage("LOCAL ✓ · há alterações mais recentes neste aparelho. NUVEM ✓ · clique em Sincronizar agora para enviá-las aos outros aparelhos.");
        }
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof DOMException && error.name === "AbortError"
          ? "tempo de resposta excedido"
          : error instanceof Error ? error.message : "indisponível";
        if (fixed) {
          setAudioCloudStatus("fixed");
          setAudioCloudMessage(`LOCAL ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(fixed))}. NUVEM ✕ · ${detail}`);
          setAudioCloudReady(true);
        } else {
          setAudioCloudStatus("local");
          setAudioCloudMessage(`Preservado neste navegador. NUVEM ✕ · ${detail}`);
          setAudioCloudReady(true);
        }
      }
    };
    void restoreInBackground();
    return () => { cancelled = true; };
  }, [hydrated]);


  useEffect(() => {
    const clips = presetClips(activePlaybackAudioPreset);
    const activeIds = new Set(clips.map((clip) => clip.id));
    for (const [id, audio] of sceneAudioElementsRef.current) {
      if (!activeIds.has(id)) { audio.pause(); sceneAudioElementsRef.current.delete(id); sceneAudioPlaybackRef.current.delete(id); }
    }
    for (const clip of clips) {
      const effectiveStart = clampAudioStart(clip.start, animationDuration);
      let audio = sceneAudioElementsRef.current.get(clip.id);
      // `HTMLMediaElement.src` is always resolved to an absolute URL. Comparing it
      // with our relative preset path (`/audio/...`) recreated the element on every
      // playhead tick, which made short stingers restart continuously.
      if (!audio || audio.dataset.formaSource !== clip.src) {
        audio?.pause();
        audio = new Audio(clip.src);
        audio.dataset.formaSource = clip.src;
        audio.preload = "auto";
        sceneAudioElementsRef.current.set(clip.id, audio);
      }
      audio.loop = false;
      const relative = playhead - effectiveStart;
      const sourceDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : clip.duration;
      const trimStart = Math.max(0, Math.min(sourceDuration - .05, clip.trimStart ?? 0));
      const playableDuration = effectiveAudioClipDuration(clip, sourceDuration - trimStart);
      const audibleDuration = clip.loop ? animationDuration - effectiveStart : Math.min(playableDuration, animationDuration - effectiveStart);
      const playable = relative >= 0 && relative < audibleDuration;
      const previous = sceneAudioPlaybackRef.current.get(clip.id);
      const loopIndex = clip.loop && relative >= 0 ? Math.floor(relative / playableDuration) : 0;
      const signature = `${clip.src}|${trimStart}|${playableDuration}|${clip.timelineOffset ?? "scene"}`;
      if (!playable) {
        audio.pause();
        if (relative < 0) audio.currentTime = trimStart;
        sceneAudioPlaybackRef.current.set(clip.id, { wasPlayable: false, wasPlaying: false, lastRelative: relative, loopIndex, signature });
        continue;
      }
      const totalDuration = audibleDuration;
      audio.volume = Math.max(0, Math.min(1, clip.volume * (activePlaybackAudioPreset?.masterVolume ?? 1) * audioClipEnvelope(clip, relative, totalDuration)));
      const target = clip.timelineOffset === undefined ? trimStart + (clip.loop ? relative % playableDuration : Math.min(relative, Math.max(0, playableDuration - .01))) : clip.loop ? (clip.timelineOffset + relative) % sourceDuration : Math.min(sourceDuration - .01, clip.timelineOffset + relative);
      const forceSeek = !previous?.wasPlayable || previous.signature !== signature || previous.loopIndex !== loopIndex || isPlaying && !previous.wasPlaying || !isPlaying || Math.abs(relative - (previous?.lastRelative ?? relative)) > .12;
      if (forceSeek || Math.abs(audio.currentTime - target) > .15) {
        try { audio.currentTime = target; } catch {}
      }
      if (isPlaying) {
        if (audio.paused) void audio.play().catch(() => {
          if (!audioBlockedNotifiedRef.current) {
            audioBlockedNotifiedRef.current = true;
            setExportMessage("O navegador bloqueou o áudio automático. Toque na tela e depois em ▶ para ativar o som.");
          }
        });
      } else { audio.pause(); audioBlockedNotifiedRef.current = false; }
      sceneAudioPlaybackRef.current.set(clip.id, { wasPlayable: true, wasPlaying: isPlaying, lastRelative: relative, loopIndex, signature });
    }
  }, [activePlaybackAudioPreset, playhead, isPlaying, animationDuration]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if (diagnosticFrameRef.current !== null) cancelAnimationFrame(diagnosticFrameRef.current);
    sceneAudioElementsRef.current.forEach((audio) => audio.pause());
    sceneAudioElementsRef.current.clear();
    sceneAudioPlaybackRef.current.clear();
  }, []);

  function clientPoint(event: PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  }

  function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginTouch(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") return;
    if (activeTouches.current.size === 0) gestureStartShapes.current = cloneShapes(shapes);
    activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouches.current.size !== 2) return;

    const [a, b] = [...activeTouches.current.values()];
    const rect = canvasFrameRef.current!.getBoundingClientRect();
    const mid = midpoint(a, b);
    const localMid = { x: mid.x - rect.left, y: mid.y - rect.top };
    pinch.current = {
      startDistance: Math.max(1, distance(a, b)),
      startZoom: view.zoom,
      worldX: (localMid.x - view.panX) / view.zoom,
      worldY: (localMid.y - view.panY) / view.zoom,
    };
    interaction.current = null;
    setLiveShapeIds(new Set());
    if (gestureStartShapes.current) setShapes(cloneShapes(gestureStartShapes.current));
    for (const pointerId of activeTouches.current.keys()) {
      try { svgRef.current?.setPointerCapture(pointerId); } catch {}
    }
  }

  function updatePinch(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch" || !activeTouches.current.has(event.pointerId)) return false;
    activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinch.current || activeTouches.current.size < 2) return false;

    event.preventDefault();
    const [a, b] = [...activeTouches.current.values()];
    const currentDistance = distance(a, b);
    const nextZoom = Math.max(0.55, Math.min(6, pinch.current.startZoom * currentDistance / pinch.current.startDistance));
    const mid = midpoint(a, b);
    const rect = canvasFrameRef.current!.getBoundingClientRect();
    const localMid = { x: mid.x - rect.left, y: mid.y - rect.top };
    setView({
      zoom: nextZoom,
      panX: localMid.x - pinch.current.worldX * nextZoom,
      panY: localMid.y - pinch.current.worldY * nextZoom,
    });
    return true;
  }

  function resetZoom() {
    setView({ zoom: 1, panX: 0, panY: 0 });
  }

  function zoomCanvasWithWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (window.innerWidth < 700) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    setView((current) => {
      const factor = Math.exp(-event.deltaY * .0015);
      const zoom = Math.max(.55, Math.min(6, current.zoom * factor));
      const worldX = (cursorX - current.panX) / current.zoom;
      const worldY = (cursorY - current.panY) / current.zoom;
      return { zoom, panX: cursorX - worldX * zoom, panY: cursorY - worldY * zoom };
    });
  }

  function startCanvasPan(event: PointerEvent<HTMLDivElement>) {
    if (window.innerWidth < 700 || event.pointerType !== "mouse" || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    interaction.current = null;
    setLiveShapeIds(new Set());
    canvasPanRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY };
    setIsCanvasPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCanvasPan(event: PointerEvent<HTMLDivElement>) {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setView((current) => ({ ...current, panX: pan.panX + event.clientX - pan.startX, panY: pan.panY + event.clientY - pan.startY }));
  }

  function endCanvasPan(event: PointerEvent<HTMLDivElement>) {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    canvasPanRef.current = null;
    setIsCanvasPanning(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function setTime(nextTime: number, stopPlayback = true) {
    const time = Math.max(0, Math.min(animationDuration, nextTime));
    if (stopPlayback && animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      setIsPlaying(false);
    }
    playheadRef.current = time;
    setPlayhead(time);
  }

  // Navegadores mobile (Safari/iOS e, em menor grau, Chrome/Android) só liberam
  // `HTMLMediaElement.play()` com som depois que a página recebeu uma interação
  // real do usuário. Se o primeiro `.play()` de cada sessão acontece dentro de um
  // efeito assíncrono (ex.: depois de restaurar presets da nuvem), o navegador
  // recusa silenciosamente e o áudio nunca sai. Esta função roda de forma
  // síncrona dentro do próprio handler de toque para "destravar" a reprodução
  // de áudio nessa aba; uma vez destravada, os elementos `Audio()` criados
  // depois (inclusive os recriados após sincronizar com a nuvem) tocam normalmente.
  function unlockAudioPlayback() {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    try {
      const primer = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA");
      primer.volume = 0;
      const attempt = primer.play();
      if (attempt && typeof attempt.then === "function") attempt.then(() => primer.pause()).catch(() => { audioUnlockedRef.current = false; });
    } catch { audioUnlockedRef.current = false; }
  }

  function playAnimation() {
    unlockAudioPlayback();
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    const startAt = playheadRef.current >= animationDuration - .01 ? 0 : playheadRef.current;
    let started: number | null = null;
    playheadRef.current = startAt;
    setPlayhead(startAt);
    setIsPlaying(true);
    const tick = (now: number) => {
      if (started === null) started = now;
      const time = Math.min(animationDuration, startAt + (now - started) / 1000);
      playheadRef.current = time;
      setPlayhead(time);
      if (time < animationDuration) animationFrameRef.current = requestAnimationFrame(tick);
      else { animationFrameRef.current = null; setIsPlaying(false); }
    };
    animationFrameRef.current = requestAnimationFrame(tick);
  }

  function pauseAnimation() {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    setIsPlaying(false);
  }

  function isDesktopMouse(event: PointerEvent<HTMLElement>) {
    return event.pointerType === "mouse" && window.innerWidth >= 700;
  }

  function startFloatingPanelDrag(event: PointerEvent<HTMLDivElement>) {
    if (!isDesktopMouse(event) || event.button !== 0) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.classList.add("desktop-floating");
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.bottom = "auto";
    panel.style.transform = "none";
    panel.style.width = `${rect.width}px`;
    floatingPanelDragRef.current = { pointerId: event.pointerId, panel, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveFloatingPanel(event: PointerEvent<HTMLDivElement>) {
    const drag = floatingPanelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = drag.panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - drag.offsetX));
    const top = Math.max(58, Math.min(window.innerHeight - rect.height - 8, event.clientY - drag.offsetY));
    drag.panel.style.left = `${left}px`;
    drag.panel.style.top = `${top}px`;
  }

  function endFloatingPanelDrag(event: PointerEvent<HTMLDivElement>) {
    if (floatingPanelDragRef.current?.pointerId !== event.pointerId) return;
    floatingPanelDragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function resetFloatingPanel(event: React.MouseEvent<HTMLDivElement>) {
    if (window.innerWidth < 700) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    panel.classList.remove("desktop-floating");
    panel.style.removeProperty("left"); panel.style.removeProperty("top"); panel.style.removeProperty("bottom"); panel.style.removeProperty("transform"); panel.style.removeProperty("width");
  }

  function isKeyframeSelected(shapeId: string, time: number, source = selectedKeyframes) {
    return source.some((item) => item.shapeId === shapeId && Math.abs(item.time - time) < .001);
  }

  function startTimelineDrag(event: PointerEvent<HTMLDivElement>) {
    if (!isDesktopMouse(event) || event.button !== 0 || !motionPanelRef.current) return;
    const rect = motionPanelRef.current.getBoundingClientRect();
    timelineDragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveTimeline(event: PointerEvent<HTMLDivElement>) {
    const drag = timelineDragRef.current;
    const panel = motionPanelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - drag.offsetX));
    const top = Math.max(58, Math.min(window.innerHeight - rect.height - 8, event.clientY - drag.offsetY));
    setTimelinePosition({ left, top });
  }

  function endTimelineDrag(event: PointerEvent<HTMLDivElement>) {
    if (timelineDragRef.current?.pointerId !== event.pointerId) return;
    timelineDragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function scrubTimelineRuler(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTime(((event.clientX - rect.left) / Math.max(1, rect.width)) * animationDuration);
  }

  function startTimelineScrub(event: PointerEvent<HTMLDivElement>) {
    if (!isDesktopMouse(event) || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTimelineRuler(event);
    event.preventDefault();
  }

  function startKeyframeMarquee(event: PointerEvent<HTMLDivElement>) {
    if (!isDesktopMouse(event) || event.button !== 0 || !motionTracksRef.current) return;
    if ((event.target as Element).closest("button")) return;
    const rect = motionTracksRef.current.getBoundingClientRect();
    const startLeft = event.clientX - rect.left + motionTracksRef.current.scrollLeft;
    const startTop = event.clientY - rect.top + motionTracksRef.current.scrollTop;
    const base = event.shiftKey ? selectedKeyframes : [];
    marqueeRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, base };
    setKeyframeMarquee({ left: startLeft, top: startTop, width: 0, height: 0 });
    if (!event.shiftKey) setSelectedKeyframes([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveKeyframeMarquee(event: PointerEvent<HTMLDivElement>) {
    const marquee = marqueeRef.current;
    const tracks = motionTracksRef.current;
    if (!marquee || marquee.pointerId !== event.pointerId || !tracks) return;
    const rect = tracks.getBoundingClientRect();
    const startX = marquee.startClientX;
    const startY = marquee.startClientY;
    const clientLeft = Math.min(startX, event.clientX);
    const clientTop = Math.min(startY, event.clientY);
    const clientRight = Math.max(startX, event.clientX);
    const clientBottom = Math.max(startY, event.clientY);
    setKeyframeMarquee({ left: clientLeft - rect.left + tracks.scrollLeft, top: clientTop - rect.top + tracks.scrollTop, width: clientRight - clientLeft, height: clientBottom - clientTop });
    const covered = [...tracks.querySelectorAll<HTMLElement>("[data-keyframe-shape]")].flatMap((element) => {
      const dot = element.getBoundingClientRect();
      if (dot.right < clientLeft || dot.left > clientRight || dot.bottom < clientTop || dot.top > clientBottom) return [];
      return [{ shapeId: element.dataset.keyframeShape!, time: Number(element.dataset.keyframeTime) }];
    });
    const merged = [...marquee.base];
    covered.forEach((item) => { if (!isKeyframeSelected(item.shapeId, item.time, merged)) merged.push(item); });
    setSelectedKeyframes(merged);
  }

  function endKeyframeMarquee(event: PointerEvent<HTMLDivElement>) {
    if (marqueeRef.current?.pointerId !== event.pointerId) return;
    marqueeRef.current = null;
    setKeyframeMarquee(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function startKeyframeDrag(event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) {
    if (!isDesktopMouse(event) || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    pauseAnimation();
    let selection = selectedKeyframes;
    if (!isKeyframeSelected(shapeId, time)) selection = event.shiftKey ? [...selection, { shapeId, time }] : [{ shapeId, time }];
    setSelectedKeyframes(selection);
    setSelectedId(shapeId);
    setTool("select");
    const track = event.currentTarget.closest(".keyframe-track") as HTMLElement | null;
    const source = cloneShapes(shapes);
    keyframeDragRef.current = { pointerId: event.pointerId, startX: event.clientX, trackWidth: track?.getBoundingClientRect().width ?? 1, selected: selection, source, latest: source, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSelectedKeyframes(event: PointerEvent<HTMLButtonElement>) {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pixelDelta = event.clientX - drag.startX;
    if (Math.abs(pixelDelta) > 2) drag.moved = true;
    const minimum = Math.min(...drag.selected.map((item) => item.time));
    const maximum = Math.max(...drag.selected.map((item) => item.time));
    const requested = (pixelDelta / Math.max(1, drag.trackWidth)) * animationDuration;
    const delta = Math.max(-minimum, Math.min(animationDuration - maximum, requested));
    const next = drag.source.map((shape) => ({
      ...shape,
      keyframes: shape.keyframes?.map((frame) => {
        const selectedFrame = drag.selected.find((item) => item.shapeId === shape.id && Math.abs(item.time - frame.time) < .001);
        return selectedFrame ? { ...frame, time: Math.round((frame.time + delta) * 1000) / 1000 } : frame;
      }),
    }));
    drag.latest = next;
    setShapes(next);
    setSelectedKeyframes(drag.selected.map((item) => ({ ...item, time: Math.round((item.time + delta) * 1000) / 1000 })));
  }

  function endSelectedKeyframes(event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      const sorted = drag.latest.map((shape) => ({ ...shape, keyframes: shape.keyframes ? [...shape.keyframes].sort((a, b) => a.time - b.time) : undefined }));
      setShapes(sorted);
      commit(sorted, background);
    } else setTime(time);
    keyframeDragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    setSelectedId(shapeId);
  }

  function addOrReplaceKeyframe(current: Shape[], shapeId: string, time: number) {
    const source = current.find((shape) => shape.id === shapeId);
    const affectedIds = new Set(source?.groupId ? current.filter((shape) => shape.groupId === source.groupId).map((shape) => shape.id) : [shapeId]);
    return current.map((shape) => {
      if (!affectedIds.has(shape.id)) return shape;
      const frame = { ...keyframeFromShape(shape, time), easing: "easeInOut" as MotionEasing };
      const existing = shape.keyframes ?? [];
      const withoutNearby = existing.filter((item) => Math.abs(item.time - time) > .07);
      return { ...shape, keyframes: [...withoutNearby, frame].sort((a, b) => a.time - b.time) };
    });
  }

  function toggleKeyframes() {
    if (!selected || selected.type === "empty" || selected.locked) return;
    setTimelineOpen(true);
    if (recordingId === selected.id) { setRecordingId(null); return; }
    const time = selected.keyframes?.length ? playheadRef.current : 0;
    setTime(time);
    const next = addOrReplaceKeyframe(shapes, selected.id, time);
    setShapes(next);
    setRecordingId(selected.id);
    commit(next, background);
  }

  function signalSnap(key: string) {
    if (lastSnap.current === key) return;
    lastSnap.current = key;
    navigator.vibrate?.(8);
  }

  function localPoint(point: { x: number; y: number }, shape: Shape) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const angle = (-shape.rotation * Math.PI) / 180;
    const dx = point.x - cx;
    const dy = point.y - cy;
    return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
  }

  function commit(nextShapes = shapes, nextBackground = background, nextFormat = format, nextBackgroundVideo = backgroundVideo) {
    history.current = commitHistory(history.current, { shapes: nextShapes, background: nextBackground, backgroundVideo: nextBackgroundVideo, format: nextFormat });
    const status = historyStatus(history.current);
    setCanUndo(status.canUndo);
    setCanRedo(status.canRedo);
  }

  function restore(index: number) {
    const result = restoreHistory(history.current, index);
    if (!result) return;
    history.current = result.history;
    setShapes(result.snapshot.shapes);
    setBackground(result.snapshot.background);
    setBackgroundVideo(result.snapshot.backgroundVideo);
    setFormat(result.snapshot.format ?? "square");
    setSelectedId(null);
    setCanUndo(result.canUndo);
    setCanRedo(result.canRedo);
  }

  function undo() {
    pauseAnimation();
    setRecordingId(null);
    const result = moveHistory(history.current, "undo");
    if (result) restore(result.history.index);
  }

  function redo() {
    pauseAnimation();
    setRecordingId(null);
    const result = moveHistory(history.current, "redo");
    if (result) restore(result.history.index);
  }

  function startCanvas(event: PointerEvent<SVGSVGElement>) {
    if (pinch.current || activeTouches.current.size > 1) return;
    if (event.target !== event.currentTarget && (event.target as Element).getAttribute("data-canvas") !== "true") return;
    setPaletteOpen(null);
    setOutlineOpen(false);
    setFormatOpen(false);
    setLayersOpen(false);
    setTextOpen(false);
    setExportOpen(false);
    if (tool === "select") {
      setSelectedId(null);
      return;
    }
    event.preventDefault();
    const p = clientPoint(event);
    const emptyTarget = selected?.type === "empty" && !selected.locked ? selected : null;
    const id = emptyTarget?.id ?? makeId();
    const defaultName = tool === "rect" ? "Retângulo" : "Círculo";
    const shape: Shape = { id, type: tool, x: p.x, y: p.y, w: 1, h: 1, rotation: 0, radius: 0, fill: shapeColor, stroke: "#13151A", strokeWidth: 0, name: emptyTarget?.name ?? defaultName, visible: true };
    interaction.current = { kind: "draw", pointerId: event.pointerId, startX: p.x, startY: p.y, id };
    setLiveShapeIds(new Set([id]));
    svgRef.current?.setPointerCapture(event.pointerId);
    setShapes((current) => emptyTarget ? current.map((item) => item.id === emptyTarget.id ? shape : item) : [...current, shape]);
    setSelectedId(id);
  }

  function startMove(event: PointerEvent, shape: Shape) {
    if (shape.locked || pinch.current || activeTouches.current.size > 1) return;
    event.stopPropagation();
    event.preventDefault();
    const p = clientPoint(event);
    const group = cloneShapes(shape.groupId ? displayedShapes.filter((item) => item.groupId === shape.groupId) : [shape]);
    interaction.current = { kind: "move", pointerId: event.pointerId, startX: p.x, startY: p.y, shape: { ...shape }, group };
    setLiveShapeIds(new Set(group.map((item) => item.id)));
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelectedId(shape.id);
    setTool("select");
  }

  function startHandle(event: PointerEvent, kind: "rotate" | "radius" | "resize", shape: Shape, handle = "") {
    if (shape.locked || pinch.current || activeTouches.current.size > 1) return;
    event.stopPropagation();
    event.preventDefault();
    const p = clientPoint(event);
    if (kind === "rotate") {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      interaction.current = { kind, pointerId: event.pointerId, shape: { ...shape }, startAngle: Math.atan2(p.y - cy, p.x - cx), startRotation: shape.rotation };
    } else if (kind === "radius") interaction.current = { kind, pointerId: event.pointerId, shape: { ...shape } };
    else interaction.current = { kind, pointerId: event.pointerId, shape: { ...shape }, handle };
    setLiveShapeIds(new Set([shape.id]));
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function movePointer(event: PointerEvent<SVGSVGElement>) {
    if (updatePinch(event)) return;
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const p = clientPoint(event);

    if (active.kind === "draw") {
      const x = Math.min(active.startX, p.x);
      const y = Math.min(active.startY, p.y);
      const w = Math.max(8, Math.abs(p.x - active.startX));
      const h = Math.max(8, Math.abs(p.y - active.startY));
      setShapes((current) => current.map((shape) => shape.id === active.id ? { ...shape, x, y, w, h } : shape));
      return;
    }
    if (active.kind === "move") {
      const dx = p.x - active.startX;
      const dy = p.y - active.startY;
      let nextX = active.shape.x + dx;
      let nextY = active.shape.y + dy;
      const threshold = 14 / view.zoom;
      const xTargets = [0, W / 2, W];
      const yTargets = [0, H / 2, H];
      const xPoints = [nextX, nextX + active.shape.w / 2, nextX + active.shape.w];
      const yPoints = [nextY, nextY + active.shape.h / 2, nextY + active.shape.h];
      let snappedX: number | undefined;
      let snappedY: number | undefined;
      let bestX = threshold;
      let bestY = threshold;
      xTargets.forEach((target) => xPoints.forEach((point) => {
        const gap = Math.abs(target - point);
        if (gap < bestX) { bestX = gap; snappedX = target; }
      }));
      yTargets.forEach((target) => yPoints.forEach((point) => {
        const gap = Math.abs(target - point);
        if (gap < bestY) { bestY = gap; snappedY = target; }
      }));
      if (snappedX !== undefined) {
        const closestPoint = xPoints.reduce((best, point) => Math.abs(snappedX! - point) < Math.abs(snappedX! - best) ? point : best);
        nextX += snappedX - closestPoint;
      }
      if (snappedY !== undefined) {
        const closestPoint = yPoints.reduce((best, point) => Math.abs(snappedY! - point) < Math.abs(snappedY! - best) ? point : best);
        nextY += snappedY - closestPoint;
      }
      setGuides({ x: snappedX, y: snappedY });
      if (snappedX !== undefined || snappedY !== undefined) signalSnap(`move-${snappedX ?? ""}-${snappedY ?? ""}`);
      else lastSnap.current = "";
      const finalDx = nextX - active.shape.x;
      const finalDy = nextY - active.shape.y;
      const starts = new Map(active.group.map((shape) => [shape.id, shape]));
      setShapes((current) => current.map((shape) => {
        const start = starts.get(shape.id);
        return start ? { ...shape, x: start.x + finalDx, y: start.y + finalDy } : shape;
      }));
      return;
    }
    if (active.kind === "rotate") {
      const cx = active.shape.x + active.shape.w / 2;
      const cy = active.shape.y + active.shape.h / 2;
      const angle = Math.atan2(p.y - cy, p.x - cx);
      const degrees = active.startRotation + ((angle - active.startAngle) * 180) / Math.PI;
      const snapAngle = Math.round(degrees / 45) * 45;
      const isSnapped = Math.abs(degrees - snapAngle) <= 5;
      const rotation = Math.round(isSnapped ? snapAngle : degrees);
      setGuides(isSnapped ? { angle: ((rotation % 360) + 360) % 360 } : {});
      if (isSnapped) signalSnap(`angle-${rotation}`); else lastSnap.current = "";
      setShapes((current) => current.map((shape) => shape.id === active.shape.id ? { ...shape, rotation } : shape));
      return;
    }
    if (active.kind === "radius") {
      const local = localPoint(p, active.shape);
      const max = Math.min(active.shape.w, active.shape.h) / 2;
      const radius = Math.max(0, Math.min(max, active.shape.x + active.shape.w - local.x));
      setShapes((current) => current.map((shape) => shape.id === active.shape.id ? { ...shape, radius } : shape));
      return;
    }
    const base = active.shape;
    const local = localPoint(p, base);
    let left = base.x;
    let right = base.x + base.w;
    let top = base.y;
    let bottom = base.y + base.h;
    if (active.handle.includes("l")) left = Math.min(local.x, right - 24);
    if (active.handle.includes("r")) right = Math.max(local.x, left + 24);
    if (active.handle.includes("t")) top = Math.min(local.y, bottom - 24);
    if (active.handle.includes("b")) bottom = Math.max(local.y, top + 24);
    if (base.type === "image" || base.type === "text") {
      let nextW = right - left;
      let nextH = bottom - top;
      const ratio = base.w / base.h;
      if (Math.abs(nextW / base.w - 1) >= Math.abs(nextH / base.h - 1)) nextH = nextW / ratio;
      else nextW = nextH * ratio;
      if (active.handle.includes("l")) left = right - nextW; else right = left + nextW;
      if (active.handle.includes("t")) top = bottom - nextH; else bottom = top + nextH;
    }
    setShapes((current) => current.map((shape) => shape.id === base.id ? { ...shape, x: left, y: top, w: right - left, h: bottom - top, radius: Math.min(shape.radius, (right - left) / 2, (bottom - top) / 2), fontSize: base.type === "text" ? (base.fontSize ?? 120) * ((bottom - top) / base.h) : shape.fontSize } : shape));
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" && activeTouches.current.has(event.pointerId)) {
      const wasPinching = pinch.current !== null;
      activeTouches.current.delete(event.pointerId);
      if (activeTouches.current.size < 2) pinch.current = null;
      if (activeTouches.current.size === 0) gestureStartShapes.current = null;
      if (wasPinching) {
        interaction.current = null;
        setLiveShapeIds(new Set());
        try { svgRef.current?.releasePointerCapture(event.pointerId); } catch {}
        return;
      }
    }
    if (!interaction.current || interaction.current.pointerId !== event.pointerId) return;
    interaction.current = null;
    setLiveShapeIds(new Set());
    setGuides({});
    lastSnap.current = "";
    try { svgRef.current?.releasePointerCapture(event.pointerId); } catch {}
    setShapes((current) => {
      const next = recordingId && current.some((shape) => shape.id === recordingId) ? addOrReplaceKeyframe(current, recordingId, playheadRef.current) : current;
      commit(next, background);
      return next;
    });
  }

  function applyColor(color: string) {
    if (paletteOpen === "background") {
      setBackground(color);
      setBackgroundVideo(undefined);
      commit(shapes, color, format, undefined);
    } else if (selectedId && !selected?.locked) {
      const next = shapes.map((shape) => shape.id === selectedId ? { ...shape, fill: color } : shape);
      setShapes(next);
      setShapeColor(color);
      commit(next, background);
    } else setShapeColor(color);
    setPaletteOpen(null);
  }

  function applyBackgroundVideo(source: string, fallbackColor: string) {
    const activeId = activeSceneIdRef.current;
    const activeScene = activeId ? scenesRef.current.find((scene) => scene.id === activeId) ?? null : null;
    const linkedResult = activeScene ? linkedResultForQuestion(scenesRef.current, activeScene) : null;
    const syncLinkedResult = linkedResult
      ? window.confirm(`Deseja aplicar o mesmo fundo ao resultado vinculado (${linkedResult.name})?`)
      : false;
    if (activeId && activeScene) {
      const nextScenes = applyLinkedBackgroundPreset(scenesRef.current, activeId, source, fallbackColor, syncLinkedResult);
      scenesRef.current = nextScenes;
      setScenes(nextScenes);
    }
    setBackground(fallbackColor);
    setBackgroundVideo(source);
    commit(shapes, fallbackColor, format, source);
    setPaletteOpen(null);
  }

  function removeSelected() {
    if (!selectedId || selected?.locked) return;
    if (recordingId === selectedId) setRecordingId(null);
    const next = shapes.filter((shape) => shape.id !== selectedId);
    setShapes(next);
    setSelectedId(null);
    commit(next, background);
  }

  function duplicateSelected() {
    if (!selected || selected.locked) return;
    const duplicate = {
      ...selected,
      keyframes: selected.keyframes?.map((frame) => ({ ...frame })),
      id: makeId(),
      x: Math.min(W - selected.w, Math.max(0, selected.x + 36)),
      y: Math.min(H - selected.h, Math.max(0, selected.y + 36)),
    };
    const next = [...shapes, duplicate];
    setShapes(next);
    setSelectedId(duplicate.id);
    commit(next, background);
  }

  function updateOutline(stroke: string, strokeWidth: number) {
    if (!selectedId || selected?.locked) return;
    const next = shapes.map((shape) => shape.id === selectedId ? { ...shape, stroke, strokeWidth } : shape);
    setShapes(next);
    commit(next, background);
  }

  function updateVisual(patch: Partial<Pick<Shape, "brightness" | "contrast" | "saturation" | "hue" | "colorMatrix" | "imageScale" | "imageOffsetX" | "imageOffsetY" | "objectFit">>, save = false) {
    if (!selected || selected.locked || selected.type === "empty") return;
    const next = shapes.map((shape) => shape.id === selected.id ? { ...shape, ...patch } : shape);
    setShapes(next);
    if (save) commit(next, background);
  }

  function resetVisual() {
    if (!selected || selected.locked) return;
    const next = shapes.map((shape) => shape.id === selected.id ? { ...shape, brightness: 100, contrast: 100, saturation: 100, hue: 0, colorMatrix: undefined } : shape);
    setShapes(next);
    commit(next, background);
  }

  function removeShapeImage() {
    if (!selected || selected.locked || !selected.imageSrc) return;
    const next = shapes.map((shape) => shape.id === selected.id ? { ...shape, imageSrc: undefined, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 } : shape);
    setShapes(next);
    commit(next, background);
  }

  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = objectUrl; });
      const maxSource = 2400;
      const sourceScale = Math.min(1, maxSource / Math.max(image.naturalWidth, image.naturalHeight));
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * sourceScale));
      sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * sourceScale));
      sourceCanvas.getContext("2d")!.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      const src = sourceCanvas.toDataURL("image/webp", 0.9);
      const imageTarget = selected?.type === "image" && !selected.locked ? selected : null;
      if (imageTarget) {
        const next = shapes.map((item) => item.id === imageTarget.id ? { ...item, src, objectFit: "cover" as const, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 } : item);
        setShapes(next);
        setAdjustmentsOpen(true);
        commit(next, background);
        return;
      }
      const shapeTarget = selected && (selected.type === "rect" || selected.type === "ellipse") && !selected.locked ? selected : null;
      if (shapeTarget) {
        const next = shapes.map((item) => item.id === shapeTarget.id ? { ...item, imageSrc: src, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, objectFit: "cover" as const } : item);
        setShapes(next);
        setAdjustmentsOpen(true);
        commit(next, background);
        return;
      }
      const fit = Math.min((W * 0.68) / image.naturalWidth, (H * 0.68) / image.naturalHeight, 1);
      const w = image.naturalWidth * fit;
      const h = image.naturalHeight * fit;
      const emptyTarget = selected?.type === "empty" && !selected.locked ? selected : null;
      const newShape: Shape = {
        id: emptyTarget?.id ?? makeId(), type: "image", x: (W - w) / 2, y: (H - h) / 2, w, h,
        rotation: 0, radius: 0, fill: "transparent", src, objectFit: "cover", imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, brightness: 100, contrast: 100, saturation: 100, hue: 0, name: emptyTarget?.name ?? (file.name.replace(/\.[^.]+$/, "") || "Imagem"), visible: true,
      };
      const next = emptyTarget ? shapes.map((item) => item.id === emptyTarget.id ? newShape : item) : [...shapes, newShape];
      setShapes(next);
      setSelectedId(newShape.id);
      setTool("select");
      commit(next, background);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function addText() {
    const emptyTarget = selected?.type === "empty" && !selected.locked ? selected : null;
    const fontSize = 120;
    const textShape: Shape = {
      id: emptyTarget?.id ?? makeId(), type: "text", x: W / 2 - 260, y: H / 2 - 75, w: 520, h: 150,
      rotation: 0, radius: 0, fill: shapeColor, stroke: "#13151A", strokeWidth: 0, text: "Seu texto", fontSize, fontWeight: 700,
      name: emptyTarget?.name ?? "Texto", visible: true,
    };
    const next = emptyTarget ? shapes.map((item) => item.id === emptyTarget.id ? textShape : item) : [...shapes, textShape];
    setShapes(next);
    setSelectedId(textShape.id);
    setTool("select");
    setTextOpen(true);
    setLayersOpen(false);
    commit(next, background);
  }

  function updateText(patch: Partial<Pick<Shape, "text" | "fontSize" | "fontWeight">>, save = true) {
    if (!selected || selected.type !== "text" || selected.locked) return;
    const nextText = patch.text ?? selected.text ?? "";
    const nextSize = patch.fontSize ?? selected.fontSize ?? 120;
    const w = Math.max(90, nextText.length * nextSize * 0.62);
    const h = nextSize * 1.25;
    const cx = selected.x + selected.w / 2;
    const cy = selected.y + selected.h / 2;
    const next = shapes.map((shape) => shape.id === selected.id ? { ...shape, ...patch, x: cx - w / 2, y: cy - h / 2, w, h } : shape);
    setShapes(next);
    if (save) commit(next, background);
  }

  function toggleLayer(id: string) {
    const next = shapes.map((shape) => shape.id === id ? { ...shape, visible: shape.visible === false } : shape);
    setShapes(next);
    if (selectedId === id && next.find((shape) => shape.id === id)?.visible === false) setSelectedId(null);
    commit(next, background);
  }

  function moveLayer(id: string, direction: "up" | "down") {
    const index = shapes.findIndex((shape) => shape.id === id);
    if (shapes[index]?.locked) return;
    const target = direction === "up" ? index + 1 : index - 1;
    if (index < 0 || target < 0 || target >= shapes.length) return;
    const next = [...shapes];
    [next[index], next[target]] = [next[target], next[index]];
    setShapes(next);
    commit(next, background);
  }

  function repairAnswerAlignment(groupId = selectedAnswerGroup) {
    if (!groupId) return;
    pauseAnimation();
    const next = alignAnswerGroup(shapes, groupId);
    setShapes(next);
    commit(next, background);
  }

  function repairAllAnswerAlignments() {
    pauseAnimation();
    const groups = [...new Set(shapes.map((shape) => shape.groupId).filter((id): id is string => Boolean(id?.startsWith("answer-"))))];
    const next = groups.reduce((current, groupId) => alignAnswerGroup(current, groupId), shapes);
    setShapes(next);
    commit(next, background);
  }

  function distributeAnswerGroups() {
    pauseAnimation();
    const groups = [...new Set(shapes.map((shape) => shape.groupId).filter((id): id is string => Boolean(id?.startsWith("answer-"))))]
      .map((groupId) => ({ groupId, card: answerGroupParts(shapes, groupId).card }))
      .filter((item): item is { groupId: string; card: Shape } => Boolean(item.card))
      .sort((a, b) => a.card.y - b.card.y);
    if (groups.length < 2) return;
    const anchor = groups[0].card;
    let next = shapes;
    groups.forEach(({ groupId, card }, index) => {
      const dx = anchor.x - card.x;
      const dy = anchor.y + index * (anchor.h + 44) - card.y;
      next = next.map((shape) => shape.groupId === groupId ? {
        ...shape, x: shape.x + dx, y: shape.y + dy,
        keyframes: shape.keyframes?.map((frame) => ({ ...frame, x: frame.x + dx, y: frame.y + dy })),
      } : shape);
      next = alignAnswerGroup(next, groupId);
    });
    setShapes(next);
    commit(next, background);
  }

  function addEmptyLayer() {
    const count = shapes.filter((shape) => shape.type === "empty").length + 1;
    const empty: Shape = { id: makeId(), type: "empty", x: 0, y: 0, w: 0, h: 0, rotation: 0, radius: 0, fill: "transparent", name: `Camada vazia ${count}`, visible: true };
    const next = [...shapes, empty];
    setShapes(next);
    setSelectedId(empty.id);
    commit(next, background);
  }

  function deleteLayer(id: string) {
    if (shapes.find((shape) => shape.id === id)?.locked) return;
    if (recordingId === id) setRecordingId(null);
    const next = shapes.filter((shape) => shape.id !== id);
    setShapes(next);
    if (selectedId === id) setSelectedId(null);
    if (renamingId === id) setRenamingId(null);
    commit(next, background);
  }

  function startRename(shape: Shape) {
    if (shape.locked) return;
    setRenamingId(shape.id);
    setRenameValue(layerLabel(shape));
  }

  function finishRename() {
    if (!renamingId) return;
    const cleanName = renameValue.trim();
    const next = shapes.map((shape) => shape.id === renamingId ? { ...shape, name: cleanName || layerLabel(shape) } : shape);
    setShapes(next);
    setRenamingId(null);
    commit(next, background);
  }

  function toggleLock(id: string) {
    const target = shapes.find((shape) => shape.id === id);
    if (!target) return;
    const willLock = !target.locked;
    const next = shapes.map((shape) => shape.id === id ? { ...shape, locked: willLock } : shape);
    setShapes(next);
    if (willLock && selectedId === id) setSelectedId(null);
    if (willLock && recordingId === id) setRecordingId(null);
    if (willLock && renamingId === id) setRenamingId(null);
    commit(next, background);
  }

  function changeFormat(nextFormat: CanvasPreset) {
    if (nextFormat === format) { setFormatOpen(false); return; }
    pauseAnimation();
    setRecordingId(null);
    const next = adaptShapesForFormat(shapes, format, nextFormat);
    setShapes(next);
    setFormat(nextFormat);
    setFormatOpen(false);
    setSelectedId(null);
    resetZoom();
    commit(next, background, nextFormat);
  }

  function makeSvg(sourceShapes: Shape[] = displayedShapes, sourceBackground = renderedBackground, sourceBackgroundImage: string | null = backgroundPresetBySource(renderedBackgroundVideo)?.poster ?? null) {
    return serializeSvg({ shapes: sourceShapes, width: W, height: H, background: sourceBackground, backgroundImage: sourceBackgroundImage ?? undefined, origin: window.location.origin });
  }

  async function exportSvg() {
    setExportOpen(false);
    await saveBlob(new Blob([await makeExportSvg()], { type: "image/svg+xml" }), "forma.svg");
  }

  async function embedImageSources(sourceShapes: Shape[] = shapes) {
    return embedSources(sourceShapes, { origin: window.location.origin, fetch: window.fetch.bind(window) });
  }

  async function makeExportSvg(sourceShapes: Shape[] = displayedShapes) {
    return makeSvg(await embedImageSources(sourceShapes));
  }

  function clearExportStaticRasterCache(sceneId: string | null = null) {
    exportStaticRasterRef.current.sceneId = sceneId;
    exportStaticRasterRef.current.entries.clear();
  }

  function clearExportHeavyImageRasterCache(sceneId: string | null = null) {
    exportHeavyImageRasterRef.current.sceneId = sceneId;
    exportHeavyImageRasterRef.current.entries.clear();
  }

  function clearExportMediaImageCache(sceneId: string | null = null) {
    exportMediaImageRef.current.sceneId = sceneId;
    exportMediaImageRef.current.entries.clear();
  }

  function clearBackgroundExportFrameCache() {
    const cache = backgroundExportFrameCacheRef.current;
    for (const entry of cache.entries.values()) {
      entry.promise.then((frame) => {
        if (typeof (frame as ImageBitmap & { close?: () => void }).close === "function") {
          try { (frame as ImageBitmap & { close?: () => void }).close?.(); } catch {}
        }
      }).catch(() => {});
    }
    cache.totalPixels = 0;
    cache.order = [];
    cache.entries.clear();
  }

  function touchBackgroundExportCacheKey(key: string) {
    const cache = backgroundExportFrameCacheRef.current;
    const index = cache.order.indexOf(key);
    if (index >= 0) cache.order.splice(index, 1);
    cache.order.push(key);
  }

  function trimBackgroundExportCache(maxPixels = MAX_EXPORT_BACKGROUND_CACHE_PIXELS) {
    const cache = backgroundExportFrameCacheRef.current;
    while (cache.totalPixels > maxPixels && cache.order.length > 0) {
      const oldest = cache.order.shift();
      if (!oldest) break;
      const entry = cache.entries.get(oldest);
      if (!entry) continue;
      cache.entries.delete(oldest);
      cache.totalPixels = Math.max(0, cache.totalPixels - entry.pixels);
      entry.promise.then((frame) => {
        if (typeof (frame as ImageBitmap & { close?: () => void }).close === "function") {
          try { (frame as ImageBitmap & { close?: () => void }).close?.(); } catch {}
        }
      }).catch(() => {});
    }
  }

  async function snapshotBackgroundExportFrame(video: HTMLVideoElement) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(video);
      } catch {
        // Alguns navegadores recusam createImageBitmap(video); fazemos fallback
        // para um canvas 2D no tamanho nativo do arquivo.
      }
    }
    const snapshot = document.createElement("canvas");
    snapshot.width = Math.max(1, video.videoWidth || W);
    snapshot.height = Math.max(1, video.videoHeight || H);
    const context = snapshot.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível capturar um frame do fundo animado.");
    context.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    return snapshot;
  }

  function disposeBackgroundExportVideo(source: string) {
    const entry = backgroundExportVideoRef.current.get(source);
    if (!entry) return;
    backgroundExportVideoRef.current.delete(source);
    exportPaintProfileRef.current.backgroundVideoResets += 1;
    try { entry.video.pause(); } catch {}
    try {
      entry.video.removeAttribute("src");
      entry.video.load();
    } catch {}
  }

  function clearBackgroundExportVideos() {
    for (const source of [...backgroundExportVideoRef.current.keys()]) disposeBackgroundExportVideo(source);
    backgroundExportPosterRef.current.clear();
    backgroundExportRetryCooldownRef.current.clear();
  }

  function createBackgroundExportVideoEntry(source: string) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("error", onError);
        if (error) reject(error); else resolve();
      };
      const onLoaded = () => finish();
      const onError = () => finish(new Error("Não foi possível carregar um dos fundos animados."));
      const timeout = window.setTimeout(() => finish(new Error("Um fundo animado demorou demais para carregar.")), BACKGROUND_EXPORT_READY_TIMEOUT_MS);
      video.addEventListener("loadeddata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = source;
      try { video.load(); } catch {}
    });
    const entry = { video, ready };
    backgroundExportVideoRef.current.set(source, entry);
    exportPaintProfileRef.current.backgroundSourceLoads += 1;
    return entry;
  }

  async function seekBackgroundExportVideo(video: HTMLVideoElement, target: number, source: string) {
    const safeTarget = clampBackgroundSeekTime(target, video.duration, backgroundExportFps(source));
    if (Math.abs(video.currentTime - safeTarget) <= .002) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        if (error) reject(error); else resolve();
      };
      const onSeeked = () => finish();
      const onError = () => finish(new Error("Falha ao posicionar um fundo animado durante a exportação."));
      const timeout = window.setTimeout(() => finish(new Error("Um fundo animado demorou demais para posicionar um frame.")), BACKGROUND_EXPORT_SEEK_TIMEOUT_MS);
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      try { video.currentTime = safeTarget; } catch { finish(new Error("Não foi possível posicionar o fundo animado.")); }
    });
  }

  async function loadBackgroundExportPoster(source: string) {
    const preset = backgroundPresetBySource(source);
    if (!preset?.poster) return null;
    const cached = backgroundExportPosterRef.current.get(source);
    if (cached) return await cached;
    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (value: HTMLImageElement | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(value);
      };
      const timeout = window.setTimeout(() => finish(null), 8_000);
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = preset.poster;
    });
    backgroundExportPosterRef.current.set(source, promise);
    return await promise;
  }

  async function nearestCachedBackgroundExportFrame(source: string, target: number) {
    const cache = backgroundExportFrameCacheRef.current;
    const prefix = `${source}#`;
    const candidates = [...cache.entries.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .filter((value) => Number.isFinite(value));
    const targetIndex = backgroundExportFrameIndex(source, target);
    const nearest = nearestBackgroundFrameIndex(targetIndex, candidates);
    if (nearest === null) return null;
    const ordered = candidates.slice().sort((a, b) => Math.abs(a - targetIndex) - Math.abs(b - targetIndex));
    for (const index of ordered) {
      const key = `${source}#${index}`;
      const entry = cache.entries.get(key);
      if (!entry) continue;
      try {
        const frame = await entry.promise;
        touchBackgroundExportCacheKey(key);
        return frame;
      } catch {
        cache.entries.delete(key);
        cache.totalPixels = Math.max(0, cache.totalPixels - entry.pixels);
        const orderIndex = cache.order.indexOf(key);
        if (orderIndex >= 0) cache.order.splice(orderIndex, 1);
      }
    }
    return null;
  }

  async function fallbackBackgroundExportFrame(source: string, target: number, cooldown = false): Promise<CanvasImageSource | null> {
    if (cooldown) exportPaintProfileRef.current.backgroundCooldownFallbacks += 1;
    const cachedFallback = await nearestCachedBackgroundExportFrame(source, target);
    if (cachedFallback) {
      exportPaintProfileRef.current.backgroundRecoveredFrames += 1;
      return cachedFallback;
    }
    const poster = await loadBackgroundExportPoster(source);
    if (poster) {
      exportPaintProfileRef.current.backgroundRecoveredFrames += 1;
      exportPaintProfileRef.current.backgroundPosterFallbacks += 1;
      return poster;
    }
    exportPaintProfileRef.current.backgroundRecoveredFrames += 1;
    exportPaintProfileRef.current.backgroundSolidFallbacks += 1;
    return null;
  }

  async function acquireBackgroundExportFrame(source: string, target: number) {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < BACKGROUND_EXPORT_SEEK_ATTEMPTS; attempt += 1) {
      let entry = backgroundExportVideoRef.current.get(source);
      if (!entry) entry = createBackgroundExportVideoEntry(source);
      try {
        await entry.ready;
        exportPaintProfileRef.current.backgroundSeeks += 1;
        await seekBackgroundExportVideo(entry.video, target, source);
        const frame = await snapshotBackgroundExportFrame(entry.video);
        backgroundExportRetryCooldownRef.current.delete(source);
        return frame;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Falha ao obter um frame do fundo animado.");
        disposeBackgroundExportVideo(source);
        if (attempt + 1 < BACKGROUND_EXPORT_SEEK_ATTEMPTS) {
          exportPaintProfileRef.current.backgroundSeekRetries += 1;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
        }
      }
    }
    throw lastError ?? new Error("Falha ao obter um frame do fundo animado.");
  }

  async function prepareExportScenes() {
    // Cada exportação começa com um cache visual limpo. Durante o projeto ele
    // é reaproveitado apenas dentro da cena atual, evitando imagens antigas e
    // mantendo o teto de memória previsível em vídeos longos.
    clearExportStaticRasterCache();
    clearExportHeavyImageRasterCache();
    clearExportMediaImageCache();
    clearBackgroundExportFrameCache();
    clearBackgroundExportVideos();
    exportRenderStatsRef.current = { heavyRasterBuilds: 0, heavyRasterDraws: 0, transitionBaseDraws: 0, transitionBaseKeys: new Set<string>() };
    exportPaintProfileRef.current = {
      backgroundSizingMode: "cover-resilient-v18",
      backgroundRequests: 0, backgroundCacheHits: 0, backgroundCacheMisses: 0, backgroundSeeks: 0, backgroundSourceLoads: 0, backgroundAcquireMs: 0, backgroundDrawMs: 0,
      backgroundSeekRetries: 0, backgroundRecoveredFrames: 0, backgroundPosterFallbacks: 0, backgroundSolidFallbacks: 0, backgroundCooldownFallbacks: 0, backgroundVideoResets: 0,
      staticRasterHits: 0, staticRasterBuilds: 0, staticRasterBuildMs: 0, staticRasterDrawMs: 0,
      heavyRasterBuildMs: 0, heavyRasterDrawMs: 0, dynamicSvgRasters: 0, dynamicSvgChars: 0, dynamicSvgSerializeMs: 0, dynamicSvgLoadMs: 0, dynamicSvgDrawMs: 0, directVectorDraws: 0, directVectorDrawMs: 0, directMediaLoads: 0, directMediaLoadMs: 0, directMediaDraws: 0, directMediaDrawMs: 0, skippedInvisibleShapes: 0, transitionBaseDrawMs: 0,
    };
    const synced = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    // O projeto inteiro costuma reutilizar os mesmos botões, ícones e assets em
    // dezenas de cenas. Incorporamos cada fonte uma única vez para evitar
    // centenas de fetches/conversões Base64 repetidas antes do primeiro frame.
    const embeddedShapeSets = await embedImageSourceSets(synced.map((scene) => scene.document.shapes), {
      origin: window.location.origin,
      fetch: window.fetch.bind(window),
      concurrency: 4,
    });
    return synced.map((scene, index) => ({ ...cloneScene(scene), document: { ...scene.document, shapes: embeddedShapeSets[index] } }));
  }

  async function renderPngBlob(scale: number, sourceShapes: Shape[] = displayedShapes) {
    return renderSvgPngBlob(await makeExportSvg(sourceShapes), W, H, scale);
  }

  async function exportPng(scale: number) {
    setExportOpen(false);
    const blob = await renderPngBlob(scale);
    if (blob) await saveBlob(blob, `forma-${W * scale}x${H * scale}.png`);
  }

  async function registerArtifact(blob: Blob, details: Omit<AIArtifact, "id" | "size" | "createdAt" | "downloadUrl" | "dataUrl">, openMenu = true) {
    if (aiArtifact?.downloadUrl) URL.revokeObjectURL(aiArtifact.downloadUrl);
    artifactBlobRef.current = blob;
    const artifact: AIArtifact = {
      ...details,
      id: makeId(),
      size: blob.size,
      createdAt: new Date().toISOString(),
      downloadUrl: URL.createObjectURL(blob),
      dataUrl: undefined,
    };
    setAiArtifact(artifact);
    if (openMenu) setExportOpen(true);
    window.dispatchEvent(new CustomEvent("forma:artifact-ready", { detail: { ...artifact, dataUrl: undefined } }));
    return artifact;
  }

  async function getBackgroundVideoFrame(source: string, time: number): Promise<CanvasImageSource | null> {
    exportPaintProfileRef.current.backgroundRequests += 1;
    const duration = backgroundPresetBySource(source)?.duration ?? 4;
    const target = ((time % duration) + duration) % duration;
    const frameKey = backgroundExportFrameKey(source, target);
    const frameCache = backgroundExportFrameCacheRef.current;
    const cached = frameCache.entries.get(frameKey);
    if (cached) {
      exportPaintProfileRef.current.backgroundCacheHits += 1;
      touchBackgroundExportCacheKey(frameKey);
      const acquireStarted = performance.now();
      try { return await cached.promise; }
      catch {
        frameCache.entries.delete(frameKey);
        frameCache.totalPixels = Math.max(0, frameCache.totalPixels - cached.pixels);
        const orderIndex = frameCache.order.indexOf(frameKey);
        if (orderIndex >= 0) frameCache.order.splice(orderIndex, 1);
      } finally {
        exportPaintProfileRef.current.backgroundAcquireMs += performance.now() - acquireStarted;
      }
    }
    exportPaintProfileRef.current.backgroundCacheMisses += 1;

    const quantizedTarget = backgroundQuantizedMediaTime(source, target);
    const cooldown = backgroundExportRetryCooldownRef.current.get(source) ?? 0;
    if (cooldown > 0) {
      if (cooldown <= 1) backgroundExportRetryCooldownRef.current.delete(source);
      else backgroundExportRetryCooldownRef.current.set(source, cooldown - 1);
      return await fallbackBackgroundExportFrame(source, quantizedTarget, true);
    }
    let pixels = W * H;
    const currentVideo = backgroundExportVideoRef.current.get(source)?.video;
    if (currentVideo) pixels = Math.max(1, currentVideo.videoWidth || W) * Math.max(1, currentVideo.videoHeight || H);
    let rasterEntry: { pixels: number; promise: Promise<CanvasImageSource> } | null = null;
    const rasterPromise = acquireBackgroundExportFrame(source, quantizedTarget);
    rasterEntry = { pixels, promise: rasterPromise };
    frameCache.entries.set(frameKey, rasterEntry);
    frameCache.totalPixels += pixels;
    touchBackgroundExportCacheKey(frameKey);
    trimBackgroundExportCache();

    const acquireStarted = performance.now();
    try {
      return await rasterPromise;
    } catch {
      // Um decoder de vídeo pode falhar depois de milhares de seeks mesmo com
      // o arquivo correto. Isso não deve destruir uma exportação de 10+ min.
      if (frameCache.entries.get(frameKey) === rasterEntry) {
        frameCache.entries.delete(frameKey);
        frameCache.totalPixels = Math.max(0, frameCache.totalPixels - pixels);
        const orderIndex = frameCache.order.indexOf(frameKey);
        if (orderIndex >= 0) frameCache.order.splice(orderIndex, 1);
      }

      // Evita repetir dois timeouts em todos os frames se o decoder do Chrome
      // entrou num estado ruim. Nos próximos 8 requests usamos cache/poster e
      // então tentamos recriar o decoder novamente.
      backgroundExportRetryCooldownRef.current.set(source, 8);
      return await fallbackBackgroundExportFrame(source, quantizedTarget);
    } finally {
      exportPaintProfileRef.current.backgroundAcquireMs += performance.now() - acquireStarted;
    }
  }

  async function cachedStaticRaster(sceneId: string, cacheKey: string, sourceShapes: Shape[]) {
    const cache = exportStaticRasterRef.current;
    if (cache.sceneId !== sceneId) {
      cache.sceneId = sceneId;
      cache.entries.clear();
    }
    const existing = cache.entries.get(cacheKey);
    if (existing) {
      exportPaintProfileRef.current.staticRasterHits += 1;
      return await existing;
    }
    while (cache.entries.size >= MAX_EXPORT_STATIC_RASTERS) {
      const oldest = cache.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      cache.entries.delete(oldest);
    }
    let raster: Promise<HTMLImageElement>;
    exportPaintProfileRef.current.staticRasterBuilds += 1;
    const buildStarted = performance.now();
    raster = loadSvgAsImage(makeSvg(sourceShapes, "transparent", null)).then((image) => {
      exportPaintProfileRef.current.staticRasterBuildMs += performance.now() - buildStarted;
      return image;
    }).catch((error) => {
      if (cache.entries.get(cacheKey) === raster) cache.entries.delete(cacheKey);
      throw error;
    });
    cache.entries.set(cacheKey, raster);
    return await raster;
  }

  async function cachedHeavyImageRaster(sceneId: string, sourceShape: Shape) {
    const cache = exportHeavyImageRasterRef.current;
    if (cache.sceneId !== sceneId) {
      cache.sceneId = sceneId;
      cache.entries.clear();
    }
    const existing = cache.entries.get(sourceShape.id);
    if (existing) return await existing;
    const margin = heavyExportRasterMargin(sourceShape);
    const baseW = Math.max(1, sourceShape.w);
    const baseH = Math.max(1, sourceShape.h);
    const rasterShape: Shape = {
      ...sourceShape,
      id: `export-heavy-${sourceShape.id}`,
      x: margin,
      y: margin,
      w: baseW,
      h: baseH,
      rotation: 0,
      opacity: 1,
      keyframes: undefined,
    };
    const rasterWidth = Math.max(1, Math.ceil(baseW + margin * 2));
    const rasterHeight = Math.max(1, Math.ceil(baseH + margin * 2));
    let raster: Promise<{ image: HTMLImageElement; baseW: number; baseH: number; margin: number }>;
    const buildStarted = performance.now();
    raster = loadSvgAsImage(serializeSvg({ shapes: [rasterShape], width: rasterWidth, height: rasterHeight, background: "transparent", origin: window.location.origin }))
      .then((image) => {
        exportPaintProfileRef.current.heavyRasterBuildMs += performance.now() - buildStarted;
        return { image, baseW, baseH, margin };
      })
      .catch((error) => {
        if (cache.entries.get(sourceShape.id) === raster) cache.entries.delete(sourceShape.id);
        throw error;
      });
    cache.entries.set(sourceShape.id, raster);
    exportRenderStatsRef.current.heavyRasterBuilds += 1;
    return await raster;
  }

  async function paintHeavyImageRaster(context: CanvasRenderingContext2D, sourceShape: Shape, renderedShape: Shape, sceneId: string) {
    if ((renderedShape.opacity ?? 1) <= .0001) return;
    const raster = await cachedHeavyImageRaster(sceneId, sourceShape);
    exportRenderStatsRef.current.heavyRasterDraws += 1;
    const drawStarted = performance.now();
    const scaleX = renderedShape.w / Math.max(.001, raster.baseW);
    const scaleY = renderedShape.h / Math.max(.001, raster.baseH);
    const centerX = renderedShape.x + renderedShape.w / 2;
    const centerY = renderedShape.y + renderedShape.h / 2;
    context.save();
    context.globalAlpha *= renderedShape.opacity ?? 1;
    context.translate(centerX, centerY);
    context.rotate(renderedShape.rotation * Math.PI / 180);
    context.scale(scaleX, scaleY);
    context.drawImage(
      raster.image,
      -raster.baseW / 2 - raster.margin,
      -raster.baseH / 2 - raster.margin,
      raster.baseW + raster.margin * 2,
      raster.baseH + raster.margin * 2,
    );
    context.restore();
    exportPaintProfileRef.current.heavyRasterDrawMs += performance.now() - drawStarted;
  }

  async function cachedExportMediaImage(sceneId: string, sourceShape: Shape) {
    const cache = exportMediaImageRef.current;
    if (cache.sceneId !== sceneId) {
      cache.sceneId = sceneId;
      cache.entries.clear();
    }
    const source = sourceShape.imageSrc;
    if (!source) throw new Error("Uma imagem dinâmica não possui fonte durante a exportação.");
    const key = `${sourceShape.id}:${source.length}:${source.slice(0, 48)}`;
    const existing = cache.entries.get(key);
    if (existing) return await existing;
    const started = performance.now();
    let promise: Promise<HTMLImageElement>;
    promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "sync";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error); else resolve(image);
      };
      const timeout = window.setTimeout(() => finish(new Error("Uma imagem dinâmica demorou demais para carregar durante a exportação.")), 15_000);
      image.onload = () => finish();
      image.onerror = () => finish(new Error("Falha ao carregar uma imagem dinâmica durante a exportação."));
      image.src = source;
    }).then((image) => {
      exportPaintProfileRef.current.directMediaLoads += 1;
      exportPaintProfileRef.current.directMediaLoadMs += performance.now() - started;
      return image;
    }).catch((error) => {
      if (cache.entries.get(key) === promise) cache.entries.delete(key);
      throw error;
    });
    cache.entries.set(key, promise);
    return await promise;
  }

  async function paintDynamicShapeRun(context: CanvasRenderingContext2D, sourceShapes: Shape[], renderedShapes: Shape[], sceneId: string) {
    let svgSegment: Shape[] = [];
    const flushSvgSegment = async () => {
      if (!svgSegment.length) return;
      const serializeStarted = performance.now();
      const svg = makeSvg(svgSegment, "transparent", null);
      exportPaintProfileRef.current.dynamicSvgSerializeMs += performance.now() - serializeStarted;
      exportPaintProfileRef.current.dynamicSvgRasters += 1;
      exportPaintProfileRef.current.dynamicSvgChars += svg.length;
      const loadStarted = performance.now();
      const image = await loadSvgAsImage(svg);
      exportPaintProfileRef.current.dynamicSvgLoadMs += performance.now() - loadStarted;
      const drawStarted = performance.now();
      context.drawImage(image, 0, 0, W, H);
      exportPaintProfileRef.current.dynamicSvgDrawMs += performance.now() - drawStarted;
      svgSegment = [];
    };
    for (let index = 0; index < sourceShapes.length; index += 1) {
      const sourceShape = sourceShapes[index];
      const renderedShape = renderedShapes[index];
      if (renderedShape.visible === false || renderedShape.type === "empty" || (renderedShape.opacity ?? 1) <= .0001) {
        exportPaintProfileRef.current.skippedInvisibleShapes += 1;
        continue;
      }
      if (canRasterHeavyExportImage(sourceShape)) {
        await flushSvgSegment();
        await paintHeavyImageRaster(context, sourceShape, renderedShape, sceneId);
      } else if (canPaintExportMedia(renderedShape)) {
        await flushSvgSegment();
        const image = await cachedExportMediaImage(sceneId, sourceShape);
        const mediaStarted = performance.now();
        if (paintExportMedia(context, renderedShape, image)) {
          exportPaintProfileRef.current.directMediaDraws += 1;
          exportPaintProfileRef.current.directMediaDrawMs += performance.now() - mediaStarted;
        }
      } else if (canPaintExportVector(renderedShape)) {
        await flushSvgSegment();
        const vectorStarted = performance.now();
        if (paintExportVector(context, renderedShape)) {
          exportPaintProfileRef.current.directVectorDraws += 1;
          exportPaintProfileRef.current.directVectorDrawMs += performance.now() - vectorStarted;
        }
      } else {
        svgSegment.push(renderedShape);
      }
    }
    await flushSvgSegment();
  }

  async function paintExportShapeRuns(context: CanvasRenderingContext2D, sourceShapes: Shape[], sceneId: string, time: number) {
    const runs = exportShapeRuns(sourceShapes, time);
    for (const run of runs) {
      const rendered = run.shapes.map((shape) => shapeAtTime(shape, time));
      if (run.cacheable) {
        const image = await cachedStaticRaster(sceneId, run.cacheKey, rendered);
        const drawStarted = performance.now();
        context.drawImage(image, 0, 0, W, H);
        exportPaintProfileRef.current.staticRasterDrawMs += performance.now() - drawStarted;
      } else {
        await paintDynamicShapeRun(context, run.shapes, rendered, sceneId);
      }
    }
  }

  async function paintVideoFrame(canvas: HTMLCanvasElement, sourceScenes: FormaScene[], sourceActiveSceneId: string | null, time: number) {
    const context = canvas.getContext("2d", { alpha: false })!;
    const active = sourceScenes.find((scene) => scene.id === sourceActiveSceneId);
    const composition = active && sceneKind(active) === "transition" ? deriveTransitionComposition(sourceScenes, active.id, time) : null;
    const transitionShapes = composition?.valid ? composition.shapes : null;
    const regularShapes = active?.document.shapes ?? shapes;
    const sourceBackground = composition?.valid ? (composition.background ?? active?.document.background ?? background) : active?.document.background ?? background;
    const sourceBackgroundVideo = composition?.valid ? composition.backgroundVideo : active?.document.backgroundVideo ?? backgroundVideo;
    const sourceBackgroundTime = composition?.valid ? composition.backgroundTime : time;
    const sceneRasterId = active?.id ?? sourceActiveSceneId ?? "__active-document__";

    context.globalAlpha = 1;
    context.fillStyle = sourceBackground;
    context.fillRect(0, 0, W, H);
    if (sourceBackgroundVideo) {
      const { blend, activeMediaTime, incomingMediaTime, inTransition } = backgroundPlaybackAtTime(sourceBackgroundVideo, sourceBackgroundTime);
      const activeBackgroundFrame = await getBackgroundVideoFrame(sourceBackgroundVideo, activeMediaTime);
      let drawStarted = performance.now();
      if (activeBackgroundFrame) drawCanvasImageCover(context, activeBackgroundFrame, 0, 0, W, H);
      exportPaintProfileRef.current.backgroundDrawMs += performance.now() - drawStarted;
      if (inTransition) {
        context.globalAlpha = blend;
        const incomingBackgroundFrame = await getBackgroundVideoFrame(sourceBackgroundVideo, incomingMediaTime);
        drawStarted = performance.now();
        if (incomingBackgroundFrame) drawCanvasImageCover(context, incomingBackgroundFrame, 0, 0, W, H);
        exportPaintProfileRef.current.backgroundDrawMs += performance.now() - drawStarted;
      }
      context.globalAlpha = 1;
    }

    if (transitionShapes && composition?.valid && active) {
      // O conteúdo de base da transição é congelado (último frame anterior ou
      // primeiro frame seguinte). Rasterizamos esse quadro uma única vez por
      // fase e animamos somente o overlay da transição. Isso mantém o visual
      // original sem reconstruir uma cena inteira 30 vezes por segundo.
      const baseShapes = composition.baseScene.document.shapes.map((shape) => shapeAtTime(shape, composition.baseTime));
      const baseKey = `transition-base:${composition.phase}:${composition.baseScene.id}:${composition.baseTime.toFixed(4)}`;
      const baseRaster = await cachedStaticRaster(sceneRasterId, baseKey, baseShapes);
      exportRenderStatsRef.current.transitionBaseDraws += 1;
      exportRenderStatsRef.current.transitionBaseKeys.add(baseKey);
      const transitionDrawStarted = performance.now();
      context.drawImage(baseRaster, 0, 0, W, H);
      exportPaintProfileRef.current.transitionBaseDrawMs += performance.now() - transitionDrawStarted;
      await paintExportShapeRuns(context, active.document.shapes, sceneRasterId, composition.overlayTime);
      return;
    }
    await paintExportShapeRuns(context, regularShapes, sceneRasterId, time);
  }

  async function paintProjectVideoFrame(canvas: HTMLCanvasElement, sourceScenes: FormaScene[], time: number) {
    const frame = projectFrameAtTime(sourceScenes, time);
    if (!frame) throw new Error("O projeto não possui cenas para exportar.");
    await paintVideoFrame(canvas, sourceScenes, frame.scene.id, frame.localTime);
  }

  async function renderDiagnosticFrame(sourceScenes: FormaScene[], sourceActiveSceneId: string | null, time: number) {
    const scale = .5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = W;
    fullCanvas.height = H;
    await paintVideoFrame(fullCanvas, sourceScenes, sourceActiveSceneId, time);
    const context = canvas.getContext("2d", { alpha: false })!;
    context.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", .92));
    if (!blob) throw new Error("Não foi possível gerar um frame do diagnóstico.");
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function captureCanvasDiagnostic(download = false) {
    if (diagnosticActive) throw new Error("O diagnóstico já está em andamento.");
    setDiagnosticActive(true);
    pauseAnimation();
    setExportOpen(true);
    setExportProgress(0);
    setExportMessage("Medindo a reprodução real… não toque no canvas");
    const sourceShapes = cloneShapes(shapes);
    const startedAt = new Date().toISOString();
    const samples: PlaybackSample[] = [];
    try {
      setIsPlaying(true);
      playheadRef.current = 0;
      setPlayhead(0);
      await new Promise<void>((resolve) => {
        let first: number | null = null;
        let previous: number | null = null;
        const tick = (now: number) => {
          if (first === null) first = now;
          const elapsedMs = now - first;
          const time = Math.min(animationDuration, elapsedMs / 1000);
          if (previous !== null) samples.push({ elapsedMs: Math.round(elapsedMs * 100) / 100, deltaMs: Math.round((now - previous) * 100) / 100, playhead: Math.round(time * 1000) / 1000, expectedPlayhead: Math.round((elapsedMs / 1000) * 1000) / 1000 });
          previous = now;
          playheadRef.current = time;
          setPlayhead(time);
          setExportProgress(Math.min(55, Math.round((time / animationDuration) * 55)));
          if (time < animationDuration) diagnosticFrameRef.current = requestAnimationFrame(tick);
          else { diagnosticFrameRef.current = null; resolve(); }
        };
        diagnosticFrameRef.current = requestAnimationFrame(tick);
      });
      setIsPlaying(false);
      const animationAlerts = auditAnimation(sourceShapes, W, H, layerLabel);
      const summary = analyzePlaybackSamples(samples, animationAlerts.length);
      const { diagnosis, longFrames, freezes } = summary;
      setExportMessage("Medição concluída. Gerando os frames sem afetar o teste…");
      const embeddedScenes = await prepareExportScenes();
      const exportActiveSceneId = activeSceneIdRef.current;
      const frameRate = 4;
      const totalFrames = Math.ceil(animationDuration * frameRate);
      const files: Record<string, string | Uint8Array> = {};
      for (let frame = 0; frame <= totalFrames; frame += 1) {
        const time = Math.min(animationDuration, frame / frameRate);
        const label = String(frame).padStart(3, "0");
        files[`frames/frame_${label}_${time.toFixed(2)}s.png`] = await renderDiagnosticFrame(embeddedScenes, exportActiveSceneId, time);
        setExportProgress(55 + Math.round((frame / Math.max(1, totalFrames)) * 43));
        setExportMessage(`Gerando frames para análise · ${frame + 1}/${totalFrames + 1}`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const project = await makeProjectPayload();
      project.document.shapes = sourceShapes;
      const report = {
        schema: "forma-diagnostic/1.0",
        startedAt,
        finishedAt: new Date().toISOString(),
        device: { userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight }, devicePixelRatio: window.devicePixelRatio },
        canvas: { width: W, height: H, format, background },
        animation: { duration: animationDuration, layerCount: sourceShapes.length, animatedLayerCount: sourceShapes.filter((shape) => (shape.keyframes?.length ?? 0) > 1).length },
        summary,
        animationAlerts,
        samples,
      };
      files["performance.json"] = JSON.stringify(report, null, 2);
      files["project.forma.json"] = JSON.stringify(project, null, 2);
      files["keyframes.json"] = JSON.stringify(sourceShapes.map((shape) => ({ id: shape.id, name: layerLabel(shape), type: shape.type, keyframes: shape.keyframes ?? [] })), null, 2);
      files["README.txt"] = `DIAGNÓSTICO DO CANVAS — FORMA\n\nDiagnóstico automático: ${diagnosis}\nFPS médio: ${summary.averageFps}\nP95: ${summary.p95FrameMs} ms\nPior frame: ${summary.worstFrameMs} ms\nFrames longos: ${longFrames}\nTravadas acima de 100 ms: ${freezes}\nAlertas na animação: ${animationAlerts.length}\n\nA pasta frames contém uma sequência visual a 4 fps. O arquivo performance.json contém a medição real, feita antes da captura das imagens. Anexe este ZIP no chat para análise.`;
      const zipBuffer = await zipFiles(files, 1);
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const artifact = await registerArtifact(blob, { name: `${safeFileName(project.name)}-diagnostico-canvas.zip`, mime: "application/zip", kind: "bundle", width: W, height: H, duration: animationDuration });
      setExportProgress(null);
      setExportMessage(`Diagnóstico pronto · ${summary.averageFps} FPS · ${diagnosis.replaceAll("_", " ")}`);
      playheadRef.current = 0;
      setPlayhead(0);
      if (download) await saveBlob(blob, artifact.name);
      return artifact;
    } catch (error) {
      setExportProgress(null);
      setExportMessage(error instanceof Error ? error.message : "Não foi possível concluir o diagnóstico.");
      throw error;
    } finally {
      if (diagnosticFrameRef.current !== null) cancelAnimationFrame(diagnosticFrameRef.current);
      diagnosticFrameRef.current = null;
      setIsPlaying(false);
      setDiagnosticActive(false);
      clearExportStaticRasterCache();
      clearExportHeavyImageRasterCache();
      clearExportMediaImageCache();
      clearBackgroundExportFrameCache();
      clearBackgroundExportVideos();
    }
  }

  function backgroundExportRecoveryNotice() {
    const stats = exportPaintProfileRef.current;
    if (!stats.backgroundRecoveredFrames) return null;
    const detail = stats.backgroundPosterFallbacks > 0
      ? ` · ${stats.backgroundPosterFallbacks} usaram o poster estático`
      : stats.backgroundSolidFallbacks > 0
        ? ` · ${stats.backgroundSolidFallbacks} usaram apenas a cor da cena`
        : "";
    return `MP4 pronto · ${stats.backgroundRecoveredFrames} frame${stats.backgroundRecoveredFrames === 1 ? "" : "s"} de fundo recuperado${stats.backgroundRecoveredFrames === 1 ? "" : "s"} automaticamente${detail}.`;
  }

  async function exportMp4(prepareForAI = false) {
    try {
      pauseAnimation();
      setExportProgress(0);
      setExportMessage("Preparando imagens…");
      const sourceScenes = await prepareExportScenes();
      const sourceActiveSceneId = activeSceneIdRef.current;
      const sourceActiveScene = sourceScenes.find((scene) => scene.id === sourceActiveSceneId) ?? activeScene;
      const exportAudioPreset = addSceneStinger(projectExportAudioPreset(activeAudioPreset, activeProjectAudioPreset, projectMainAudioSceneOffset(sourceScenes, sourceActiveSceneId), animationDuration, Math.max(.05, projectMainAudioDuration(sourceScenes))), sourceActiveScene, sceneStingers);
      const blob = await renderMp4({
        width: W,
        height: H,
        duration: animationDuration,
        audioPreset: exportAudioPreset,
        paintFrame: (canvas, time) => paintVideoFrame(canvas, sourceScenes, sourceActiveSceneId, time),
        onStatus: (progress, message) => { setExportProgress(progress); setExportMessage(message); },
      });
      const name = `forma-${W}x${H}-${animationDuration}s.mp4`;
      const artifact = await registerArtifact(blob, { name, mime: "video/mp4", kind: "video", width: W, height: H, duration: animationDuration });
      if (!prepareForAI) await saveBlob(blob, name);
      const recoveryNotice = backgroundExportRecoveryNotice();
      if (recoveryNotice) setExportMessage(recoveryNotice);
      return artifact;
    } catch (error) {
      setExportProgress(null);
      const message = error instanceof Error ? error.message : "Não foi possível gerar o MP4.";
      setExportMessage(`${message} · A exportação foi liberada; você pode tentar novamente sem recarregar a página.`);
      throw error;
    } finally {
      clearExportStaticRasterCache();
      clearExportHeavyImageRasterCache();
      clearExportMediaImageCache();
      clearBackgroundExportFrameCache();
      clearBackgroundExportVideos();
    }
  }

  async function exportProjectMp4(prepareForAI = false) {
    try {
      pauseAnimation();
      setExportProgress(0);
      setExportMessage("Preparando todas as cenas do projeto…");
      const sourceScenes = await prepareExportScenes();
      if (!sourceScenes.length) throw new Error("O projeto não possui cenas para exportar.");
      const totalDuration = projectDuration(sourceScenes);
      const exportAudioPreset = addProjectStingers(projectFullExportAudioPreset(sourceScenes, audioPresets, activeProjectAudioPreset), sourceScenes, sceneStingers);
      const blob = await renderMp4({
        width: W,
        height: H,
        duration: totalDuration,
        audioPreset: exportAudioPreset,
        paintFrame: (canvas, time) => paintProjectVideoFrame(canvas, sourceScenes, time),
        onStatus: (progress, message) => { setExportProgress(progress); setExportMessage(message.replace("animação", "projeto inteiro")); },
      });
      const roundedDuration = Math.round(totalDuration * 10) / 10;
      const name = `forma-projeto-${sourceScenes.length}-cenas-${roundedDuration}s.mp4`;
      const artifact = await registerArtifact(blob, { name, mime: "video/mp4", kind: "video", width: W, height: H, duration: totalDuration });
      if (!prepareForAI) await saveBlob(blob, name);
      const recoveryNotice = backgroundExportRecoveryNotice();
      if (recoveryNotice) setExportMessage(recoveryNotice);
      return artifact;
    } catch (error) {
      setExportProgress(null);
      const message = error instanceof Error ? error.message : "Não foi possível exportar o projeto inteiro.";
      setExportMessage(`${message} · A exportação foi liberada; você pode tentar novamente sem recarregar a página.`);
      throw error;
    } finally {
      clearExportStaticRasterCache();
      clearExportHeavyImageRasterCache();
      clearExportMediaImageCache();
      clearBackgroundExportFrameCache();
      clearBackgroundExportVideos();
    }
  }

  async function captureProjectExportDiagnostic(download = true) {
    if (exportDiagnosticActive) throw new Error("O diagnóstico da exportação já está em andamento.");
    if (diagnosticActive) throw new Error("Finalize o diagnóstico do canvas antes de medir a exportação.");
    setExportDiagnosticActive(true);
    pauseAnimation();
    setExportOpen(true);
    setExportProgress(0);
    setExportMessage("Diagnóstico da exportação · preparando o projeto…");

    const events: ExportDiagnosticEvent[] = [];
    const startedAt = new Date().toISOString();
    let wallStarted = performance.now();
    let renderEnded = wallStarted;
    let outputBytes = 0;
    let exportError: { name: string; message: string; stack?: string } | null = null;
    let sourceScenes: FormaScene[] = [];
    let totalDuration = projectDuration(scenesRef.current.length ? scenesRef.current : scenes);

    const describeSource = (source?: string | null) => {
      if (!source) return null;
      const kind = source.startsWith("data:") ? "data-url" : source.startsWith("blob:") ? "blob-url" : /^https?:/i.test(source) ? "remote-url" : source.startsWith("/") ? "app-path" : "other";
      return { kind, length: source.length, prefix: kind === "data-url" ? source.slice(0, Math.min(48, source.indexOf(",") + 1 || 48)) : source.slice(0, 160) };
    };
    const csvCell = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const toCsv = (headers: string[], rows: Array<Array<unknown>>) => [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const browserEnvironment = async () => {
      const memoryPerformance = performance as Performance & { memory?: { jsHeapSizeLimit?: number; totalJSHeapSize?: number; usedJSHeapSize?: number } };
      const navigatorExtended = navigator as Navigator & { deviceMemory?: number };
      let storage: { quota?: number; usage?: number; available?: number } | null = null;
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate) storage = { quota: estimate.quota, usage: estimate.usage, available: typeof estimate.quota === "number" && typeof estimate.usage === "number" ? Math.max(0, estimate.quota - estimate.usage) : undefined };
      } catch { storage = null; }
      let gpu: { vendor?: string; renderer?: string } | null = null;
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        const extension = gl?.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
        if (gl && extension) gpu = { vendor: String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)), renderer: String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) };
      } catch { gpu = null; }
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        capturedAt: new Date().toISOString(),
        page: { href: window.location.href, origin: window.location.origin, hostname: window.location.hostname, pathname: window.location.pathname, isVercelHost: window.location.hostname.endsWith(".vercel.app") },
        browser: { userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGb: navigatorExtended.deviceMemory, cookieEnabled: navigator.cookieEnabled },
        display: { viewport: { width: window.innerWidth, height: window.innerHeight }, screen: { width: window.screen.width, height: window.screen.height }, devicePixelRatio: window.devicePixelRatio },
        document: { visibilityState: document.visibilityState, hasFocus: document.hasFocus() },
        capabilities: { videoEncoder: typeof VideoEncoder === "function", videoFrame: typeof VideoFrame === "function", audioEncoder: typeof AudioEncoder === "function", audioData: typeof AudioData === "function", secureContext: window.isSecureContext, crossOriginIsolated: window.crossOriginIsolated, opfs: typeof (navigator.storage as StorageManager & { getDirectory?: unknown })?.getDirectory === "function" },
        memory: memoryPerformance.memory ?? null,
        storage,
        gpu,
        navigation: navigation?.toJSON?.() ?? null,
      };
    };

    const environmentBefore = await browserEnvironment().catch(() => null);
    wallStarted = performance.now();
    renderEnded = wallStarted;

    try {
      const prepStarted = performance.now();
      sourceScenes = await prepareExportScenes();
      events.push({ kind: "stage", name: "preparacao_cenas_exportacao", durationMs: performance.now() - prepStarted, detail: { sceneCount: sourceScenes.length } });
      if (!sourceScenes.length) throw new Error("O projeto não possui cenas para diagnosticar.");
      totalDuration = projectDuration(sourceScenes);

      const audioStarted = performance.now();
      const exportAudioPreset = addProjectStingers(projectFullExportAudioPreset(sourceScenes, audioPresets, activeProjectAudioPreset), sourceScenes, sceneStingers);
      events.push({ kind: "stage", name: "montagem_audio_projeto", durationMs: performance.now() - audioStarted, detail: { clipCount: presetClips(exportAudioPreset).length } });

      const result = await renderMp4({
        width: W,
        height: H,
        duration: totalDuration,
        audioPreset: exportAudioPreset,
        paintFrame: (canvas, time) => paintProjectVideoFrame(canvas, sourceScenes, time),
        onStatus: (progress, message) => {
          setExportProgress(progress);
          setExportMessage(`Diagnóstico da exportação · ${message.replace("animação", "projeto inteiro")}`);
        },
        onDiagnosticEvent: (event) => events.push(event),
      });
      outputBytes = result.size;
      renderEnded = performance.now();
    } catch (error) {
      renderEnded = performance.now();
      const normalized = error instanceof Error ? error : new Error("Falha desconhecida na exportação.");
      exportError = { name: normalized.name, message: normalized.message, stack: normalized.stack };
      if (!events.some((event) => event.kind === "error" && event.message === normalized.message)) events.push({ kind: "error", stage: "diagnostico_exportacao", message: normalized.message });
    }

    try {
      setExportProgress(null);
      setExportMessage("Diagnóstico da exportação · montando ZIP técnico…");
      events.push({ kind: "info", name: "export_cache", value: { renderer: "canvas-vector-media-hybrid-background-resilient-v18", staticRasterEntries: exportStaticRasterRef.current.entries.size, heavyImageRasterEntries: exportHeavyImageRasterRef.current.entries.size, heavyRasterBuilds: exportRenderStatsRef.current.heavyRasterBuilds, heavyRasterDraws: exportRenderStatsRef.current.heavyRasterDraws, transitionBaseDraws: exportRenderStatsRef.current.transitionBaseDraws, transitionBaseRasterCount: exportRenderStatsRef.current.transitionBaseKeys.size, backgroundFrameEntries: backgroundExportFrameCacheRef.current.entries.size, backgroundFramePixels: backgroundExportFrameCacheRef.current.totalPixels, imageRasterThresholdChars: 32000 } });
      events.push({ kind: "info", name: "paint_profile_v18", value: exportPaintProfileRef.current });
      const environmentAfter = await browserEnvironment().catch(() => null);
      const environment = { before: environmentBefore, after: environmentAfter };
      const summary = summarizeExportDiagnostics(events, totalDuration, Math.max(0, renderEnded - wallStarted), outputBytes);
      const project = await makeProjectPayload();
      const diagnosticScenes = sourceScenes.length ? sourceScenes : (project.scenes ?? []);
      const frameEvents = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "frame" }> => event.kind === "frame");
      const audioEvents = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "audio" }> => event.kind === "audio");
      const stageEvents = events.filter((event): event is Extract<ExportDiagnosticEvent, { kind: "stage" }> => event.kind === "stage");

      const sceneSamples = new Map<string, { sceneId: string; sceneName: string; kind: string; frameCount: number; totalPaintMs: number; worstPaintMs: number; totalQueueWaitMs: number; paints: number[] }>();
      const frameRows = frameEvents.map((event) => {
        const frame = projectFrameAtTime(diagnosticScenes, event.time);
        const sceneId = frame?.scene.id ?? "unknown";
        const entry = sceneSamples.get(sceneId) ?? { sceneId, sceneName: frame?.scene.name ?? "Desconhecida", kind: frame?.scene ? sceneKind(frame.scene) : "unknown", frameCount: 0, totalPaintMs: 0, worstPaintMs: 0, totalQueueWaitMs: 0, paints: [] };
        entry.frameCount += 1;
        entry.totalPaintMs += event.paintMs;
        entry.worstPaintMs = Math.max(entry.worstPaintMs, event.paintMs);
        entry.totalQueueWaitMs += event.queueWaitMs;
        entry.paints.push(event.paintMs);
        sceneSamples.set(sceneId, entry);
        return [event.frame, event.time.toFixed(4), frame?.sceneIndex ?? "", sceneId, frame?.scene.name ?? "", frame?.scene ? sceneKind(frame.scene) : "", frame?.localTime.toFixed(4) ?? "", event.paintMs.toFixed(3), event.encodeSubmitMs.toFixed(3), event.queueWaitMs.toFixed(3), event.queueSize];
      });
      const scenePerformance = [...sceneSamples.values()].map((entry) => {
        const sorted = [...entry.paints].sort((a, b) => a - b);
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : 0;
        return { sceneId: entry.sceneId, sceneName: entry.sceneName, kind: entry.kind, frameCount: entry.frameCount, averagePaintMs: entry.frameCount ? Math.round(entry.totalPaintMs / entry.frameCount * 100) / 100 : 0, p95PaintMs: Math.round(p95 * 100) / 100, worstPaintMs: Math.round(entry.worstPaintMs * 100) / 100, totalPaintMs: Math.round(entry.totalPaintMs * 100) / 100, totalQueueWaitMs: Math.round(entry.totalQueueWaitMs * 100) / 100 };
      }).sort((a, b) => b.averagePaintMs - a.averagePaintMs);

      const projectInventory = {
        sceneCount: diagnosticScenes.length,
        totalDuration,
        canvas: { width: W, height: H, format },
        scenes: diagnosticScenes.map((scene, index) => ({
          index,
          id: scene.id,
          name: scene.name,
          kind: sceneKind(scene),
          duration: scene.animationDuration,
          shapeCount: scene.document.shapes.length,
          animatedShapeCount: scene.document.shapes.filter((shape) => (shape.keyframes?.length ?? 0) > 1).length,
          keyframeCount: scene.document.shapes.reduce((sum, shape) => sum + (shape.keyframes?.length ?? 0), 0),
          imageShapeCount: scene.document.shapes.filter((shape) => Boolean(shape.imageSrc || shape.src)).length,
          imageSources: scene.document.shapes.filter((shape) => Boolean(shape.imageSrc || shape.src)).map((shape) => ({ id: shape.id, name: layerLabel(shape), source: describeSource(shape.imageSrc || shape.src) })),
          backgroundVideo: describeSource(scene.document.backgroundVideo),
          audioPresetId: scene.audioPresetId ?? null,
          transition: scene.transition ?? null,
        })),
        audio: { scenePresetCount: audioPresets.length, projectPresetCount: projectAudioPresets.length, activeProjectPresetId: activeProjectAudioPresetId, exportClipCount: diagnosticScenes.reduce((sum, scene) => sum + presetClips(audioPresets.find((preset) => preset.id === scene.audioPresetId)).length, 0) + (activeProjectAudioPreset?.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0) },
      };

      const trace = {
        schema: "forma-export-diagnostic/1.0",
        startedAt,
        finishedAt: new Date().toISOString(),
        success: !exportError,
        error: exportError,
        summary,
        environment,
        projectInventory,
        scenePerformance,
        events,
      };
      const readme = [
        "DIAGNÓSTICO DA EXPORTAÇÃO — FORMA",
        "",
        `Resultado: ${exportError ? "FALHOU" : "CONCLUÍDO"}`,
        `Projeto: ${project.name}`,
        `Cenas: ${diagnosticScenes.length}`,
        `Duração do vídeo: ${totalDuration.toFixed(2)} s`,
        `Tempo real medido: ${summary.wallTimeSeconds.toFixed(2)} s`,
        `Fator tempo real: ${summary.realtimeFactor.toFixed(2)}×`,
        `Frames medidos: ${summary.frameCount}`,
        `Pintura média: ${summary.averagePaintMs.toFixed(2)} ms`,
        `P95 da pintura: ${summary.p95PaintMs.toFixed(2)} ms`,
        `Pior pintura: ${summary.worstPaintMs.toFixed(2)} ms`,
        `Maior gargalo calculado: ${summary.bottleneck.replaceAll("_", " ")} (${summary.bottleneckDurationMs.toFixed(0)} ms; ${summary.bottleneckSharePercent.toFixed(1)}% do tempo medido)`,
        `Saída MP4 produzida durante o teste: ${outputBytes ? `${(outputBytes / 1_000_000).toFixed(2)} MB` : "não produzida"}`,
        ...(exportError ? ["", `ERRO: ${exportError.message}`] : []),
        ...(summary.warnings.length ? ["", "ALERTAS:", ...summary.warnings.map((warning) => `- ${warning}`)] : []),
        "",
        "ARQUIVOS:",
        "- export-trace.json: todos os eventos e resumo do teste real do MP4.",
        "- frames.csv: tempo de pintura/encoder/fila de cada frame, com a cena correspondente.",
        "- scene-performance.json: ranking das cenas mais pesadas.",
        "- stages.csv: duração das grandes etapas da exportação.",
        "- audio-chunks.csv: mixagem e espera do encoder de áudio por bloco.",
        "- environment.json: navegador, WebCodecs, GPU, memória, armazenamento e URL/deployment host.",
        "- paint-profile.json: separação do tempo de pintura entre fundo, SVG dinâmico, rasters e transições.",
        "- project-inventory.json: quantidade de cenas, camadas, keyframes, imagens, fundos e áudio.",
        "- project.forma.json: projeto editável para reproduzir o problema.",
        "",
        "O MP4 gerado pelo teste não entra no ZIP para evitar um pacote enorme. O ZIP contém o tamanho da saída e todo o trace necessário para localizar o gargalo. Anexe este ZIP no chat; o horário e o hostname permitem cruzar o teste com o deployment/logs do Vercel quando necessário.",
      ].join("\n");

      const files: Record<string, string | Uint8Array> = {
        "README.txt": readme,
        "export-trace.json": JSON.stringify(trace, null, 2),
        "environment.json": JSON.stringify(environment, null, 2),
        "paint-profile.json": JSON.stringify(exportPaintProfileRef.current, null, 2),
        "project-inventory.json": JSON.stringify(projectInventory, null, 2),
        "scene-performance.json": JSON.stringify(scenePerformance, null, 2),
        "project.forma.json": JSON.stringify(project, null, 2),
        "frames.csv": toCsv(["frame", "global_time_s", "scene_index", "scene_id", "scene_name", "scene_kind", "local_time_s", "paint_ms", "encode_submit_ms", "queue_wait_ms", "queue_size"], frameRows),
        "stages.csv": toCsv(["stage", "duration_ms", "detail_json"], stageEvents.map((event) => [event.name, event.durationMs.toFixed(3), event.detail ? JSON.stringify(event.detail) : ""])),
        "audio-chunks.csv": toCsv(["start_frame", "number_of_frames", "mix_ms", "encode_submit_ms", "queue_wait_ms", "queue_size"], audioEvents.map((event) => [event.startFrame, event.numberOfFrames, event.mixMs.toFixed(3), event.encodeSubmitMs.toFixed(3), event.queueWaitMs.toFixed(3), event.queueSize])),
      };
      if (exportError) files["error.txt"] = `${exportError.name}: ${exportError.message}\n\n${exportError.stack ?? "Sem stack disponível."}`;
      const zipBuffer = await zipFiles(files, 1);
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const artifact = await registerArtifact(blob, { name: `${safeFileName(project.name)}-diagnostico-exportacao.zip`, mime: "application/zip", kind: "bundle", width: W, height: H, duration: totalDuration });
      setExportMessage(exportError ? `ZIP de diagnóstico pronto · exportação falhou: ${exportError.message}` : `ZIP de diagnóstico pronto · gargalo: ${summary.bottleneck.replaceAll("_", " ")}`);
      if (download) await saveBlob(blob, artifact.name);
      return artifact;
    } catch (packageError) {
      setExportProgress(null);
      setExportMessage(packageError instanceof Error ? packageError.message : "Não foi possível montar o ZIP de diagnóstico da exportação.");
      throw packageError;
    } finally {
      setExportDiagnosticActive(false);
      clearExportStaticRasterCache();
      clearExportHeavyImageRasterCache();
      clearExportMediaImageCache();
      clearBackgroundExportFrameCache();
      clearBackgroundExportVideos();
    }
  }

  async function makeProjectPayload(name = projectName): Promise<FormaProject> {
    const nextScenes = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    scenesRef.current = nextScenes;
    return buildFormaProject({ currentProjectId, name, animationDuration, shapes, background, backgroundVideo, format, savedProjects, scenes: nextScenes, activeSceneId: activeSceneIdRef.current, audioPresets, audioBindings, sceneStingers, projectAudioPresets, activeProjectAudioPresetId: activeProjectAudioPresetId ?? undefined }, { now: () => new Date().toISOString(), makeId });
  }

  function currentAudioLibraryState(): AudioLibraryState {
    return {
      presets: audioPresets,
      bindings: audioBindings,
      stingers: sceneStingers,
      projectPresets: projectAudioPresets,
      activeProjectPresetId: activeProjectAudioPresetId,
    };
  }

  function applyCloudAudioState(state: AudioLibraryState) {
    audioCloudApplyingRef.current = true;
    setAudioPresets(state.presets);
    setAudioBindings(state.bindings);
    setSceneStingers(state.stingers);
    const nextProjectPresets = ensureBundledMainAudioPreset(state.projectPresets);
    setProjectAudioPresets(nextProjectPresets);
    setActiveProjectAudioPresetId(state.activeProjectPresetId && nextProjectPresets.some((preset) => preset.id === state.activeProjectPresetId) ? state.activeProjectPresetId : null);
    window.setTimeout(() => { audioCloudApplyingRef.current = false; }, 0);
  }

  async function fixAudioLibraryLocally(state = currentAudioLibraryState()) {
    const fixed = await saveFixedAudioLibrary(state);
    const summary = audioLibrarySummary(fixed);
    localStorage.setItem("forma-audio-fixed-updated-v1", fixed.updatedAt);
    setAudioCloudUpdatedAt(fixed.updatedAt);
    setAudioCloudStatus("fixed");
    setAudioCloudMessage(`${formatAudioLibrarySummary(summary)} fixados neste aparelho, incluindo as associações.`);
    return fixed;
  }

  async function uploadAudioLibrary(state = currentAudioLibraryState()) {
    const hadPendingLocalChanges = audioCloudSaveTimerRef.current !== null || audioCloudStatus === "saving";
    const previousLocalUpdatedAt = localStorage.getItem("forma-audio-fixed-updated-v1");
    if (audioCloudSaveTimerRef.current !== null) {
      window.clearTimeout(audioCloudSaveTimerRef.current);
      audioCloudSaveTimerRef.current = null;
    }

    setAudioCloudStatus("saving");
    setAudioCloudMessage("LOCAL: salvando presets, músicas e associações…");

    let fixedLibrary;
    try {
      fixedLibrary = await fixAudioLibraryLocally(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível fixar a biblioteca neste navegador.";
      setAudioCloudStatus("error");
      setAudioCloudMessage(`${message} Baixe uma cópia antes de fechar o Forma.`);
      setExportMessage(message);
      return false;
    }

    let workingState = state;
    const localFreshnessStamp = hadPendingLocalChanges || !previousLocalUpdatedAt ? fixedLibrary.updatedAt : previousLocalUpdatedAt;
    let baseUpdatedAt = localStorage.getItem("forma-audio-cloud-updated-v1") || "";
    let fixedSummary = audioLibrarySummary(fixedLibrary);
    let fixedPrefix = `LOCAL ✓ · ${formatAudioLibrarySummary(fixedSummary)}.`;

    setAudioCloudStatus("saving");
    setAudioCloudMessage(`${fixedPrefix} Verificando o Vercel Blob…`);
    try {
      const probeController = new AbortController();
      const probeTimeout = window.setTimeout(() => probeController.abort(), 20000);
      const probe = await fetch("/api/audio-library", { cache: "no-store", headers: audioLibraryRequestHeaders(), signal: probeController.signal }).finally(() => window.clearTimeout(probeTimeout));
      const probePayload = await probe.json().catch(() => null) as { library?: unknown; message?: string; configured?: boolean } | null;
      if (!probe.ok && probe.status !== 404) {
        throw new Error(probePayload?.message || "A nuvem do Forma não está configurada.");
      }

      const remote = probe.ok ? parseCloudAudioLibrary(probePayload && typeof probePayload === "object" && "library" in probePayload ? probePayload.library : probePayload) : null;
      if (remote) {
        if (baseUpdatedAt !== remote.updatedAt) {
          const resolved = mergeAudioLibraryByFreshness(remote, workingState, localFreshnessStamp);
          const remoteTime = Date.parse(remote.updatedAt);
          const localTime = Date.parse(localFreshnessStamp);
          const remoteWins = Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime);
          workingState = resolved;
          audioCloudSkipAutoOnceRef.current = true;
          applyCloudAudioState(resolved);
          const resolvedStamp = remoteWins ? remote.updatedAt : localFreshnessStamp;
          const resolvedFixed = await saveFixedAudioLibrary(resolved, resolvedStamp);
          localStorage.setItem("forma-audio-fixed-updated-v1", resolvedFixed.updatedAt);
          fixedSummary = audioLibrarySummary(resolvedFixed);
          fixedPrefix = `LOCAL ✓ · ${formatAudioLibrarySummary(fixedSummary)}.`;
          if (remoteWins) setAudioCloudMessage(`${fixedPrefix} A nuvem tinha uma versão mais recente; ela foi restaurada antes de continuar.`);
          else setAudioCloudMessage(`${fixedPrefix} Este aparelho tinha a versão mais recente; preparando envio para os outros aparelhos.`);
        }
        baseUpdatedAt = remote.updatedAt;
        localStorage.setItem("forma-audio-cloud-updated-v1", remote.updatedAt);
      } else {
        baseUpdatedAt = "";
      }

      const prepared = await prepareAudioLibraryForCloud(workingState, (progress) => {
        const item = progress.total > 0 ? `Arquivo ${Math.min(progress.current, progress.total)}/${progress.total}` : "Preparando metadata";
        setAudioCloudMessage(`${fixedPrefix} NUVEM: ${item} · ${progress.name} · ${Math.round(progress.percentage)}%`);
      });

      const library = createCloudAudioLibrary(prepared.cloudState);
      const body = JSON.stringify(library);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch("/api/audio-library", {
        method: "PUT",
        headers: audioLibraryRequestHeaders({ "content-type": "application/json", "x-forma-cloud-base": baseUpdatedAt }),
        body,
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const result = await response.json().catch(() => null) as ({ code?: string; message?: string; library?: unknown; updatedAt?: string } & Partial<AudioLibrarySummary>) | null;

      if (response.status === 409) {
        const conflictRemote = parseCloudAudioLibrary(result?.library);
        if (conflictRemote) {
          localStorage.setItem("forma-audio-cloud-updated-v1", conflictRemote.updatedAt);
        }
        setAudioCloudStatus("fixed");
        setAudioCloudMessage(`${fixedPrefix} NUVEM mudou enquanto os arquivos eram enviados. Sua cópia local foi preservada; toque em “Restaurar cópia” e depois em “Sincronizar agora” para resolver sem sobrescrever outro aparelho.`);
        return true;
      }
      if (!response.ok) throw new Error(result?.message || "A nuvem não respondeu.");

      const expected = audioLibrarySummary(library);
      if (result?.scenePresetCount !== expected.scenePresetCount || result.projectPresetCount !== expected.projectPresetCount || result.bindingCount !== expected.bindingCount || result.assetCount !== expected.assetCount) {
        throw new Error("A nuvem não confirmou todos os presets e associações.");
      }

      audioCloudSkipAutoOnceRef.current = true;
      applyCloudAudioState(prepared.localState);
      const fixedWithCloudRefs = await saveFixedAudioLibrary(prepared.localState, library.updatedAt);
      localStorage.setItem("forma-audio-fixed-updated-v1", fixedWithCloudRefs.updatedAt);
      localStorage.setItem("forma-audio-cloud-updated-v1", library.updatedAt);
      setAudioCloudUpdatedAt(library.updatedAt);
      setAudioCloudStatus("synced");
      const uploadNote = prepared.uploadedAssetCount > 0
        ? ` ${prepared.uploadedAssetCount} arquivo${prepared.uploadedAssetCount === 1 ? "" : "s"} de áudio enviado${prepared.uploadedAssetCount === 1 ? "" : "s"} separadamente.`
        : " Arquivos de áudio já estavam disponíveis na nuvem.";
      setAudioCloudMessage(`LOCAL ✓ · NUVEM ✓ · ${formatAudioLibrarySummary(expected)} sincronizados entre aparelhos.${uploadNote}`);
      return true;
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "AbortError"
        ? "A nuvem demorou demais para responder."
        : error instanceof Error ? error.message : "A nuvem não respondeu.";
      setAudioCloudStatus("fixed");
      setAudioCloudMessage(`${fixedPrefix} NUVEM ✕ · ${detail} A cópia local continua protegida.`);
      return true;
    }
  }

  async function forceAudioCloudSync() {
    try {
      const saved = await uploadAudioLibrary(currentAudioLibraryState());
      if (saved && !audioCloudReady) { audioCloudSkipAutoOnceRef.current = true; setAudioCloudReady(true); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível fixar os presets.";
      setAudioCloudStatus("error");
      setAudioCloudMessage(`${message} Baixe uma cópia antes de fechar o Forma.`);
    }
  }

  async function restoreAudioCloudLibrary() {
    setAudioCloudStatus("saving");
    setAudioCloudMessage("Buscando a cópia local e a biblioteca compartilhada na nuvem…");

    let merged = currentAudioLibraryState();
    let fixed = null;
    let localUpdatedAt: string | null = null;
    try {
      fixed = await loadFixedAudioLibrary();
      if (fixed) {
        merged = mergeAudioLibraryState(cloudAudioLibraryState(fixed), merged);
        localUpdatedAt = fixed.updatedAt;
      } else {
        localUpdatedAt = localStorage.getItem("forma-audio-fixed-updated-v1");
      }
    } catch {
      localUpdatedAt = localStorage.getItem("forma-audio-fixed-updated-v1");
    }

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch("/api/audio-library", { cache: "no-store", headers: audioLibraryRequestHeaders(), signal: controller.signal }).finally(() => window.clearTimeout(timeout));
      const payload = await response.json().catch(() => null) as { library?: unknown; message?: string; configured?: boolean } | null;
      if (!response.ok) throw new Error(payload?.message || "A nuvem não respondeu.");
      const remote = parseCloudAudioLibrary(payload && typeof payload === "object" && "library" in payload ? payload.library : payload);

      if (remote) {
        const remoteTime = Date.parse(remote.updatedAt);
        const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
        const remoteWins = Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime >= localTime);
        merged = mergeAudioLibraryByFreshness(remote, merged, localUpdatedAt);
        audioCloudSkipAutoOnceRef.current = true;
        applyCloudAudioState(merged);
        const snapshotStamp = remoteWins ? remote.updatedAt : localUpdatedAt || remote.updatedAt;
        await saveFixedAudioLibrary(merged, snapshotStamp).catch(() => null);
        localStorage.setItem("forma-audio-fixed-updated-v1", snapshotStamp);
        localStorage.setItem("forma-audio-cloud-updated-v1", remote.updatedAt);
        setAudioCloudUpdatedAt(remoteWins ? remote.updatedAt : snapshotStamp);
        if (remoteWins) {
          setAudioCloudStatus("synced");
          setAudioCloudMessage(`LOCAL ✓ · NUVEM ✓ · ${formatAudioLibrarySummary(audioLibrarySummary(createCloudAudioLibrary(merged, remote.updatedAt)))} restaurados. A versão mais recente da nuvem venceu conflitos do mesmo preset.`);
        } else {
          setAudioCloudStatus("fixed");
          setAudioCloudMessage(`LOCAL ✓ · NUVEM disponível · alterações locais mais recentes foram preservadas. Clique em Sincronizar agora para enviá-las aos outros aparelhos.`);
        }
      } else if (fixed) {
        audioCloudSkipAutoOnceRef.current = true;
        applyCloudAudioState(merged);
        setAudioCloudUpdatedAt(fixed.updatedAt);
        setAudioCloudStatus("fixed");
        setAudioCloudMessage(`${formatAudioLibrarySummary(audioLibrarySummary(fixed))} restaurados da cópia fixa. A nuvem está conectada, mas ainda não tem uma biblioteca salva.`);
      } else {
        setAudioCloudStatus("local");
        setAudioCloudMessage("NUVEM ✓ · biblioteca ainda vazia. Crie seus presets e toque em Sincronizar agora.");
      }
      setAudioCloudReady(true);
    } catch (error) {
      if (fixed) {
        audioCloudSkipAutoOnceRef.current = true;
        applyCloudAudioState(merged);
        setAudioCloudUpdatedAt(fixed.updatedAt);
        setAudioCloudStatus("fixed");
        setAudioCloudMessage(`${formatAudioLibrarySummary(audioLibrarySummary(fixed))} restaurados localmente. ${error instanceof Error ? error.message : "A nuvem não respondeu."}`);
        setAudioCloudReady(true);
        return;
      }
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "A busca da nuvem demorou demais e ainda não há cópia fixa neste aparelho."
        : error instanceof Error ? error.message : "Não foi possível restaurar a biblioteca.";
      setAudioCloudStatus("error");
      setAudioCloudMessage(message);
    }
  }

  async function downloadAudioLibraryBackup() {
    try {
      setAudioCloudMessage("Preparando a cópia completa dos presets…");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const state = currentAudioLibraryState();
      const portableProjectPresets = await projectAudioPresetsForPortableExport(state.projectPresets);
      const library = createCloudAudioLibrary({ ...state, projectPresets: portableProjectPresets });
      await saveBlob(new Blob([JSON.stringify(library, null, 2)], { type: "application/json" }), `forma-biblioteca-audio-${new Date().toISOString().slice(0, 10)}.json`);
      setAudioCloudMessage("Cópia completa baixada neste aparelho, com presets e associações.");
      setExportMessage("Cópia de segurança da biblioteca de áudio baixada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível baixar a cópia dos presets.";
      setAudioCloudStatus("error");
      setAudioCloudMessage(message);
    }
  }

  function setSceneAudioPreset(presetId: string | undefined, applyToKind = false) {
    const sceneId = activeSceneIdRef.current;
    if (!sceneId) return;
    const next = assignAudioPreset(scenesRef.current, sceneId, presetId, applyToKind);
    scenesRef.current = next;
    setScenes(next);
  }

  function bindAudioPreset(target: AudioBindingTarget, presetId?: string) {
    const result = setAudioBinding(scenesRef.current, audioBindings, target, presetId);
    scenesRef.current = result.scenes;
    setScenes(result.scenes);
    setAudioBindings(result.bindings);
  }

  function createAudioPresetForScene(requestedName?: string) {
    if (!activeScene) return null;
    const kind = sceneKind(activeScene);
    const count = audioPresets.filter((preset) => preset.sceneKind === kind).length + 1;
    const preset = createSceneAudioPreset(makeId(), requestedName?.trim() || `Áudio ${kind === "intro" ? "entrada" : kind === "main" ? "principal" : kind === "result" ? "resultado" : "transição"} ${count}`, kind);
    setAudioPresets((current) => [...current, preset]);
    setSceneAudioPreset(preset.id);
    setAudioEditing(true);
    setSelectedAudioClipId(null);
    return preset;
  }

  function replaceAudioPreset(nextPreset: SceneAudioPreset) {
    setAudioPresets((current) => current.map((preset) => preset.id === nextPreset.id ? cloneAudioPreset(nextPreset) : preset));
  }

  function updateActiveAudioPreset(updater: (preset: SceneAudioPreset) => SceneAudioPreset) {
    if (!activeAudioPreset) return;
    replaceAudioPreset(updater(activeAudioPreset));
  }

  function splitPresetAudioClip(presetId: string, clipId: string, time: number) {
    const preset = audioPresets.find((item) => item.id === presetId);
    if (!preset) return { ok: false, message: "Preset de áudio não encontrado." };
    const result = splitAudioClip(preset, clipId, time, makeId(), animationDuration);
    if (!result.ok) return result;
    replaceAudioPreset(result.preset);
    if (activeScene?.audioPresetId === presetId) setSelectedAudioClipId(result.rightId);
    return { ok: true, message: "Efeito dividido em dois blocos." };
  }

  async function importSceneAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeAudioPreset) return;
    if (file.size > 2 * 1024 * 1024) { setExportMessage("Use efeitos de áudio de até 2 MB nesta primeira versão."); return; }
    const objectUrl = URL.createObjectURL(file);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = new Audio(objectUrl);
        audio.preload = "metadata";
        audio.addEventListener("loadedmetadata", () => resolve(Number.isFinite(audio.duration) ? audio.duration : 1), { once: true });
        audio.addEventListener("error", () => reject(new Error("Áudio inválido.")), { once: true });
      });
      const clipId = makeId();
      const clip: SceneAudioClip = { id: clipId, assetId: `scene-audio-${clipId}`, name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Novo áudio", src: await blobDataUrl(file), mime: file.type || "audio/mpeg", start: clampAudioStart(playheadRef.current, animationDuration), duration: Math.max(.05, duration), sourceDuration: Math.max(.05, duration), sourceBytes: file.size, volume: 1 };
      replaceAudioPreset(addAudioClip(activeAudioPreset, audioImportTrackRef.current, clip));
      setSelectedAudioClipId(clip.id);
    } catch {
      setExportMessage("Não foi possível importar este áudio.");
    } finally { URL.revokeObjectURL(objectUrl); }
  }

  function replaceProjectAudioPreset(nextPreset: ProjectAudioPreset) {
    setProjectAudioPresets((current) => current.map((preset) => preset.id === nextPreset.id ? cloneProjectAudioPreset(nextPreset) : preset));
  }

  function updateEditingProjectAudioPreset(updater: (preset: ProjectAudioPreset) => ProjectAudioPreset) {
    if (!editingProjectAudioPreset) return;
    replaceProjectAudioPreset(updater(editingProjectAudioPreset));
  }

  function createProjectAudioPresetForProject() {
    const preset = createProjectAudioPreset(makeId(), `Áudio principal ${projectAudioPresets.length + 1}`);
    setProjectAudioPresets((current) => [...current, preset]);
    setEditingProjectAudioPresetId(preset.id);
    setProjectAudioEditing(true);
    setSelectedProjectAudioClipId(null);
    setProjectAudioImportMessage("");
    return preset;
  }

  function splitProjectPresetAudioClip(clipId: string, time: number) {
    if (!editingProjectAudioPreset) return;
    const result = splitProjectAudioClip(editingProjectAudioPreset, clipId, time, makeId(), projectAudioTimelineDuration);
    if (!result.ok) { setExportMessage(result.message); return; }
    replaceProjectAudioPreset(result.preset);
    setSelectedProjectAudioClipId(result.rightId);
    setExportMessage("Música dividida em dois blocos.");
  }

  async function importProjectAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editingProjectAudioPreset) return;
    const objectUrl = URL.createObjectURL(file);
    let keepObjectUrl = false;
    setProjectAudioImportMessage(`Importando “${file.name}” · ${formatAudioFileSize(file.size)}…`);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = new Audio(objectUrl);
        audio.preload = "metadata";
        const timeout = window.setTimeout(() => reject(new Error("O navegador demorou demais para ler os dados desta música. Tente outro formato de áudio.")), 20000);
        audio.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1); }, { once: true });
        audio.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("Este arquivo não pôde ser lido como áudio.")); }, { once: true });
      });
      const assetId = `project-audio-${makeId()}`;
      try { await navigator.storage?.persist?.(); } catch {}
      await storeProjectAudioAsset(assetId, file, file.type || "audio/mpeg");
      const clip: SceneAudioClip = { id: makeId(), assetId, name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Nova música", src: objectUrl, mime: file.type || "audio/mpeg", start: clampAudioStart(Math.max(0, activeProjectAudioOffset) + playheadRef.current, projectAudioTimelineDuration), duration: Math.max(.05, duration), sourceDuration: Math.max(.05, duration), sourceBytes: file.size, volume: 1 };
      replaceProjectAudioPreset(addProjectAudioClip(editingProjectAudioPreset, projectAudioImportTrackRef.current, clip));
      keepObjectUrl = true;
      setSelectedProjectAudioClipId(clip.id);
      const message = `${clip.name} · ${formatAudioDuration(duration)} · ${formatAudioFileSize(file.size)} adicionado à timeline. Ao sincronizar, o arquivo será enviado separadamente para a nuvem.`;
      setProjectAudioImportMessage(message);
      setExportMessage("Música adicionada à timeline contínua do projeto.");
    } catch (error) {
      const message = error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "UnknownError")
        ? "Não há espaço suficiente no armazenamento deste navegador para guardar essa música. Libere espaço ou use um arquivo menor."
        : error instanceof Error ? error.message : "Não foi possível importar esta música.";
      setProjectAudioImportMessage(message);
      setExportMessage(message);
    } finally {
      if (!keepObjectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function loadSceneDocument(scene: FormaScene) {
    const document = scene.document;
    const nextShapes = cloneShapes(document.shapes ?? []);
    const nextBackground = document.background ?? "#F5F1E8";
    const nextFormat = document.format ?? "square";
    pauseAnimation();
    setShapes(nextShapes); setBackground(nextBackground); setBackgroundVideo(document.backgroundVideo); setFormat(nextFormat);
    setAnimationDuration(Math.max(1, Math.min(60, scene.animationDuration || 8))); setSelectedId(null); setTime(0); setRecordingId(null);
    history.current = createHistory({ shapes: nextShapes, background: nextBackground, backgroundVideo: document.backgroundVideo, format: nextFormat });
    setCanUndo(false); setCanRedo(false); resetZoom();
  }

  function seekProjectAudio(time: number) {
    const soundtrackTime = Math.max(0, Math.min(projectAudioTimelineDuration, time));
    const globalTime = Math.max(0, Math.min(totalProjectDuration, projectAudioStartOffset + soundtrackTime));
    let offset = 0;
    let target = scenesRef.current[scenesRef.current.length - 1];
    for (const scene of scenesRef.current) {
      const end = offset + scene.animationDuration;
      if (globalTime < end || scene === scenesRef.current[scenesRef.current.length - 1]) { target = scene; break; }
      offset = end;
    }
    if (!target) return;
    const localTime = Math.max(0, Math.min(target.animationDuration, globalTime - offset));
    if (target.id !== activeSceneIdRef.current) {
      const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
      scenesRef.current = current;
      activeSceneIdRef.current = target.id;
      setScenes(current);
      setActiveSceneId(target.id);
      loadSceneDocument(target);
      playheadRef.current = localTime;
      setPlayhead(localTime);
      return;
    }
    setTime(localTime);
  }

  function addProjectScene(requestedName?: string) {
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const scene = createBlankScene(makeId(), requestedName?.trim() || `Cena principal ${current.length + 1}`, { background, backgroundVideo, format }, 8);
    const next = [...current, scene];
    scenesRef.current = next; activeSceneIdRef.current = scene.id;
    setScenes(next); setActiveSceneId(scene.id); setSceneOpen(false); loadSceneDocument(scene);
    return scene;
  }

  function addProjectIntro(requestedName?: string) {
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const existing = current.find((scene) => sceneKind(scene) === "intro");
    if (existing) {
      const refreshed = applyAudioBindings([refreshIntroPresetMotion(existing)], audioBindings)[0];
      const next = current.map((scene) => scene.id === existing.id ? refreshed : scene);
      scenesRef.current = next; activeSceneIdRef.current = refreshed.id;
      setScenes(next); setActiveSceneId(refreshed.id); setSceneOpen(false); loadSceneDocument(refreshed);
      return { scene: refreshed, created: false };
    }
    const scene = applyAudioBindings([createIntroScene(makeId(), requestedName?.trim() || "Entrada", format)], audioBindings)[0];
    const next = [scene, ...current];
    scenesRef.current = next; activeSceneIdRef.current = scene.id;
    setScenes(next); setActiveSceneId(scene.id); setSceneOpen(false); loadSceneDocument(scene);
    return { scene, created: true };
  }

  function addProjectTransition(afterQuery?: unknown, beforeQuery?: unknown, requestedName?: string, requestedPreset?: unknown): { ok: true; scene: FormaScene; created: boolean } | { ok: false; message: string } {
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const after = afterQuery === undefined ? current.find((scene) => scene.id === activeSceneIdRef.current) ?? null : resolveScene(current, afterQuery);
    const afterIndex = after ? current.findIndex((scene) => scene.id === after.id) : -1;
    const before = beforeQuery === undefined ? current[afterIndex + 1] ?? null : resolveScene(current, beforeQuery);
    if (!after || !before) return { ok: false, message: "A transição precisa ficar entre duas cenas de conteúdo." };
    const transitionCount = current.filter((scene) => sceneKind(scene) === "transition").length;
    const candidate = createTransitionScene(makeId(), requestedName?.trim() || `Transição ${transitionCount + 1}`, after.document.format ?? "square", { presetId: normalizeTransitionPresetId(requestedPreset) });
    const result = ensureTransitionBetween(current, after.id, before.id, candidate);
    if (!result.ok) return result;
    scenesRef.current = result.scenes; activeSceneIdRef.current = result.transition.id;
    setScenes(result.scenes); setActiveSceneId(result.transition.id); setSceneOpen(false); loadSceneDocument(result.transition);
    return { ok: true, scene: result.transition, created: result.created };
  }

  function setActiveSceneKind(kind: SceneKind) {
    const id = activeSceneIdRef.current;
    if (!id) return null;
    const next = scenesRef.current.map((scene) => scene.id === id ? { ...scene, kind } : scene);
    scenesRef.current = next; setScenes(next);
    return next.find((scene) => scene.id === id) ?? null;
  }

  function selectProjectScene(query: unknown) {
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const scene = resolveScene(current, query);
    if (!scene) return null;
    scenesRef.current = current; activeSceneIdRef.current = scene.id;
    setScenes(current); setActiveSceneId(scene.id); setSceneOpen(false); loadSceneDocument(scene);
    return scene;
  }

  function renameProjectScene(query: unknown, name: unknown) {
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const result = renameScene(current, query, name);
    if (!result.ok) return result;
    scenesRef.current = result.scenes;
    setScenes(result.scenes);
    return { ok: true as const, scene: result.scene };
  }

  function deleteProjectScene(query: unknown) {
    const previousActiveId = activeSceneIdRef.current;
    const current = syncActiveScene(scenesRef.current, activeSceneIdRef.current, { shapes, background, backgroundVideo, format, animationDuration });
    const result = deleteScene(current, query, activeSceneIdRef.current);
    if (!result.ok) return result;
    scenesRef.current = result.scenes;
    activeSceneIdRef.current = result.selected.id;
    setScenes(result.scenes);
    setActiveSceneId(result.selected.id);
    if (result.selected.id !== previousActiveId) loadSceneDocument(result.selected);
    return { ok: true as const, scene: result.selected, removed: result.removed };
  }

  function deleteAllProjectScenes() {
    const replacement = createBlankScene(makeId(), "Cena 1", { background: "#F5F1E8", format }, 8);
    const result = resetSceneCollection(scenesRef.current, replacement);
    scenesRef.current = result.scenes;
    activeSceneIdRef.current = result.selected.id;
    setScenes(result.scenes);
    setActiveSceneId(result.selected.id);
    setSceneOpen(false);
    loadSceneDocument(result.selected);
  }

  async function applyBatchImport(plan: BatchQuizPlan, requestedFormat: CanvasPreset = format) {
    pauseAnimation();
    const built = await buildBatchProject(plan, { makeId, audioBindings, format: requestedFormat });
    const active = built.activeScene;
    scenesRef.current = built.scenes;
    activeSceneIdRef.current = active.id;
    setScenes(built.scenes);
    setActiveSceneId(active.id);
    setProjectName(plan.projectName);
    setCurrentProjectId(null);
    setSceneOpen(false);
    setBatchOpen(false);
    setAiOpen(false);
    setSelectedId(null);
    loadSceneDocument(active);
    const message = `${plan.questions.length} perguntas criadas em ${built.scenes.length} cenas.`;
    setExportMessage(message);
    reportAI("import_batch", message, true, null);
  }

  async function runCorvoFormaBatch(input: CorvoFormaBatchInput): Promise<CorvoFormaBatchResult> {
    if (corvoFormaBusyRef.current) throw new Error("FORMA_AUTOMATION_BUSY");
    const scriptText = String(input?.scriptText || "").trim();
    if (!scriptText) throw new Error("FORMA_ROTEIRO_AUSENTE");
    const directImages = (input.images || []).map((item) => ({ name:String(item.name || ""), bytes:item.bytes instanceof Uint8Array ? item.bytes : new Uint8Array(item.bytes) })).filter((item) => item.name && item.bytes.byteLength);
    const zipBytes = input.zipBytes ? (input.zipBytes instanceof Uint8Array ? input.zipBytes : new Uint8Array(input.zipBytes)) : null;
    if (!directImages.length && !zipBytes?.byteLength) throw new Error("FORMA_ASSETS_AUSENTES");

    corvoFormaBusyRef.current = true;
    corvoFormaStatusRef.current = { ready:true, busy:true, stage:"IMPORTANDO", message:"Validando ROTEIRO.TXT e imagens no módulo Lote…" };
    try {
      let plan = parseBatchQuizText(scriptText);
      plan = directImages.length ? attachBatchFiles(plan, directImages) : attachBatchZip(plan, zipBytes!);
      const errors = plan.issues.filter((issue) => issue.level === "error");
      if (errors.length) {
        const detail = errors.slice(0, 6).map((issue) => `${issue.question ? `Pergunta ${issue.question}: ` : ""}${issue.message}`).join(" | ");
        throw new Error(`FORMA_LOTE_INVALIDO: ${detail}`);
      }

      const targetFormat = input.format ?? "portrait";
      corvoFormaStatusRef.current = { ready:true, busy:true, stage:"MONTANDO", message:`Montando ${plan.questions.length} pergunta(s) com os presets originais do Forma…` };
      await applyBatchImport(plan, targetFormat);
      const sceneCount = scenesRef.current.length;

      if (input.autoExport === false) {
        corvoFormaBusyRef.current = false;
        corvoFormaStatusRef.current = { ready:true, busy:false, stage:"LOTE_PRONTO", message:`${sceneCount} cena(s) prontas no Forma.` };
        return { ok:true, projectId:input.projectId, questionCount:plan.questions.length, sceneCount };
      }

      corvoFormaStatusRef.current = { ready:true, busy:true, stage:"AGUARDANDO_RENDER", message:"Lote carregado. Sincronizando o estado visual antes do MP4…" };
      return await new Promise<CorvoFormaBatchResult>((resolve, reject) => {
        corvoFormaPendingRef.current = { projectId:input.projectId, questionCount:plan.questions.length, sceneCount, resolve, reject };
        setCorvoFormaExportTrigger((value) => value + 1);
      });
    } catch (error) {
      corvoFormaBusyRef.current = false;
      const message = error instanceof Error ? error.message : "Falha automática no Forma.";
      corvoFormaStatusRef.current = { ready:true, busy:false, stage:"ERRO", message };
      throw error;
    }
  }

  useEffect(() => {
    corvoFormaRunRef.current = runCorvoFormaBatch;
  });

  useEffect(() => {
    if (!corvoFormaExportTrigger) return;
    const pending = corvoFormaPendingRef.current;
    if (!pending) return;
    let cancelled = false;
    const exportLoadedBatch = async () => {
      try {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (cancelled) return;
        corvoFormaStatusRef.current = { ready:true, busy:true, stage:"EXPORTANDO", message:"Forma exportando o projeto inteiro em MP4…" };
        const artifact = await exportProjectMp4(true);
        if (cancelled) return;
        const blob = artifactBlobRef.current;
        if (!blob || !blob.size) throw new Error("FORMA_MP4_VAZIO");
        corvoFormaPendingRef.current = null;
        corvoFormaBusyRef.current = false;
        corvoFormaStatusRef.current = { ready:true, busy:false, stage:"CONCLUIDO", message:`MP4 pronto: ${artifact.name}` };
        pending.resolve({
          ok:true, projectId:pending.projectId, questionCount:pending.questionCount, sceneCount:pending.sceneCount,
          artifactName:artifact.name, artifactSize:blob.size, duration:artifact.duration, blob,
        });
      } catch (error) {
        if (cancelled) return;
        corvoFormaPendingRef.current = null;
        corvoFormaBusyRef.current = false;
        const message = error instanceof Error ? error.message : "Não foi possível exportar o projeto inteiro.";
        corvoFormaStatusRef.current = { ready:true, busy:false, stage:"ERRO", message };
        pending.reject(error);
      }
    };
    void exportLoadedBatch();
    return () => { cancelled = true; };
  }, [corvoFormaExportTrigger]);

  useEffect(() => {
    if (corvoFormaBusyRef.current && exportMessage) {
      const current = corvoFormaStatusRef.current;
      corvoFormaStatusRef.current = { ...current, message:exportMessage };
    }
  }, [exportMessage, exportProgress]);

  useEffect(() => {
    corvoFormaStatusRef.current = { ready:true, busy:false, stage:"PRONTO", message:"Forma pronto para receber a esteira do Corvo Roteiro." };
    const bridge: CorvoFormaBridge = {
      version:"corvo-forma/1.0",
      getStatus:() => ({ ...corvoFormaStatusRef.current }),
      runBatch:(input) => corvoFormaRunRef.current(input),
    };
    window.CorvoForma = bridge;
    if (window.parent && window.parent !== window) window.parent.postMessage({ type:"corvo-forma:ready", version:bridge.version }, window.location.origin);
    return () => {
      if (window.CorvoForma === bridge) delete window.CorvoForma;
      const pending = corvoFormaPendingRef.current;
      if (pending) { pending.reject(new Error("FORMA_BRIDGE_UNMOUNTED")); corvoFormaPendingRef.current = null; }
      corvoFormaBusyRef.current = false;
    };
  }, []);

  function loadProject(project: FormaProject | SavedProject) {
    const projectScenes = project.scenes?.length ? project.scenes.map(cloneScene) : [sceneFromDocument(makeId(), "Cena 1", { shapes: project.document.shapes ?? [], background: project.document.background ?? "#F5F1E8", backgroundVideo: project.document.backgroundVideo, format: project.document.format ?? "square", animationDuration: project.animationDuration || DEFAULT_ANIMATION_DURATION })];
    const nextActiveId = projectScenes.some((scene) => scene.id === project.activeSceneId) ? project.activeSceneId! : projectScenes[0].id;
    const active = projectScenes.find((scene) => scene.id === nextActiveId)!;
    scenesRef.current = projectScenes; activeSceneIdRef.current = nextActiveId;
    setScenes(projectScenes); setActiveSceneId(nextActiveId); loadSceneDocument(active);
    setAudioPresets(unpackAudioLibrary(project.audioPresets, project.audioAssets));
    setAudioBindings(project.audioBindings ? { ...project.audioBindings } : {});
    setSceneStingers(normalizeSceneStingerSettings(project.sceneStingers));
    const normalizedProjectPresets = project.projectAudioPresets?.map((preset) => normalizeProjectAudioPreset(preset)) ?? [];
    const migratedPreset = normalizedProjectPresets.length ? null : migrateProjectSoundtrack(project.projectSoundtrack, makeId());
    const nextProjectPresets = normalizedProjectPresets.length ? normalizedProjectPresets : migratedPreset ? [migratedPreset] : [];
    const nextProjectPresetId = nextProjectPresets.some((preset) => preset.id === project.activeProjectAudioPresetId)
      ? project.activeProjectAudioPresetId!
      : migratedPreset
        ? migratedPreset.id
        : null;
    setProjectAudioPresets(nextProjectPresets); setActiveProjectAudioPresetId(nextProjectPresetId); setProjectAudioEditing(false); setEditingProjectAudioPresetId(null); setSelectedProjectAudioClipId(null);
    setProjectName(project.name || "Projeto sem título"); setCurrentProjectId(project.id); setProjectOpen(false); setSceneOpen(false);
  }

  async function saveCurrentProject(download = false, requestedName?: string) {
    const project = await makeProjectPayload(requestedName ?? projectName);
    const saved = toSavedProject(project);
    setSavedProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setCurrentProjectId(project.id); setProjectName(project.name);
    const portableProject = project.projectAudioPresets?.length ? { ...project, projectAudioPresets: await projectAudioPresetsForPortableExport(project.projectAudioPresets) } : project;
    const blob = new Blob([serializeProject(portableProject)], { type: "application/json" });
    const artifact = await registerArtifact(blob, { name: `${safeFileName(project.name)}.forma.json`, mime: "application/json", kind: "project" }, false);
    if (download) await saveBlob(blob, artifact.name);
    setExportMessage("Projeto salvo e disponível para a IA");
    return artifact;
  }

  async function exportProjectZip(download = false) {
    const project = await makeProjectPayload();
    const portableProject = project.projectAudioPresets?.length ? { ...project, projectAudioPresets: await projectAudioPresetsForPortableExport(project.projectAudioPresets) } : project;
    const previewSvg = makeSvg(project.document.shapes);
    const zipBuffer = await zipFiles(createProjectBundleFiles(portableProject, previewSvg), 0);
    const blob = new Blob([zipBuffer], { type: "application/zip" });
    const artifact = await registerArtifact(blob, { name: `${safeFileName(project.name)}.forma.zip`, mime: "application/zip", kind: "bundle", width: W, height: H, duration: animationDuration }, false);
    if (download) await saveBlob(blob, artifact.name);
    setExportMessage("ZIP do projeto pronto para o chat");
    return artifact;
  }

  function newProject() {
    pauseAnimation();
    const scene = createBlankScene(makeId(), "Cena 1", { background: "#F5F1E8", format: "square" }, DEFAULT_ANIMATION_DURATION);
    scenesRef.current = [scene]; activeSceneIdRef.current = scene.id; setScenes([scene]); setActiveSceneId(scene.id); loadSceneDocument(scene);
    setProjectName("Projeto sem título"); setCurrentProjectId(null); setProjectOpen(false); setSceneOpen(false);
    setAudioPresets([]); setSceneStingers(defaultSceneStingerSettings()); setProjectAudioPresets([]); setActiveProjectAudioPresetId(null); setAudioOpen(false); setAudioEditing(false); setProjectAudioEditing(false); setEditingProjectAudioPresetId(null); setSelectedAudioClipId(null); setSelectedProjectAudioClipId(null); setProjectAudioImportMessage("");
  }

  async function importProjectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseFormaProject(await file.text());
      let prepared = parsed;
      if (parsed.projectAudioPresets?.length) {
        const adopted = await adoptProjectAudioRuntimeSources(parsed.projectAudioPresets);
        prepared = { ...parsed, projectAudioPresets: adopted.presets };
      }
      loadProject(prepared);
      setSavedProjects((current) => [toSavedProject(prepared), ...current.filter((item) => item.id !== prepared.id)]);
      setExportMessage("Projeto importado com sucesso");
    } catch { setExportMessage("Arquivo de projeto inválido"); }
  }

  async function prepareAIExport(options: { kind?: "png" | "svg" | "mp4" | "project" | "zip" | "diagnostic"; scale?: number } = {}) {
    const kind = options.kind ?? "png";
    if (kind === "mp4") return await exportMp4(true);
    if (kind === "project") return await saveCurrentProject(false);
    if (kind === "zip") return await exportProjectZip(false);
    if (kind === "diagnostic") return await captureCanvasDiagnostic(false);
    const scale = Math.max(1, Math.min(2, options.scale ?? 1));
    const blob = kind === "svg" ? new Blob([await makeExportSvg()], { type: "image/svg+xml" }) : await renderPngBlob(scale);
    if (!blob) throw new Error("Não foi possível gerar o arquivo.");
    const width = kind === "svg" ? W : W * scale;
    const height = kind === "svg" ? H : H * scale;
    return await registerArtifact(blob, { name: `forma-${width}x${height}.${kind}`, mime: kind === "svg" ? "image/svg+xml" : "image/png", kind: "image", width, height });
  }

  async function sharePreparedArtifact() {
    if (!aiArtifact || !artifactBlobRef.current) return;
    await saveBlob(artifactBlobRef.current, aiArtifact.name);
  }

  function aiStateSnapshot(): AIState {
    return {
      ...aiStaticState,
      animation: { ...aiStaticState.animation, playhead, playing: isPlaying },
      scenes: {
        activeId: activeSceneIdRef.current,
        count: scenesRef.current.length,
        items: scenesRef.current.map((scene) => {
          const kind = sceneKind(scene);
          const neighbors = kind === "transition" ? resolveTransitionNeighbors(scenesRef.current, scene.id) : null;
          return { id: scene.id, name: scene.name, kind, duration: scene.animationDuration, active: scene.id === activeSceneIdRef.current, ...(neighbors ? { previousSceneId: neighbors.previous?.id, nextSceneId: neighbors.next?.id, valid: neighbors.valid } : {}) };
        }),
      },
      audio: {
        activePresetId: activeScene?.audioPresetId ?? null,
        presets: audioPresets.map((preset) => ({ id: preset.id, name: preset.name, sceneKind: preset.sceneKind, masterVolume: preset.masterVolume, clipCount: preset.tracks.reduce((total, track) => total + track.clips.length, 0), clips: preset.tracks.flatMap((track, trackIndex) => track.clips.map((clip) => ({ id: clip.id, name: clip.name, start: clip.start, duration: clip.duration, fadeIn: clip.fadeIn ?? 0, fadeOut: clip.fadeOut ?? 0, volume: clip.volume, loop: Boolean(clip.loop), track: trackIndex }))) })),
        automatic: sceneStingers,
      },
    };
  }

  function resolveAITarget(target?: string) {
    if (!target || target === "selected") return selected;
    if (target === "first") return shapes.find((shape) => shape.type !== "empty") ?? null;
    if (target === "last") return [...shapes].reverse().find((shape) => shape.type !== "empty") ?? null;
    const normalized = target.toLocaleLowerCase("pt-BR");
    return shapes.find((shape) => shape.id === target || layerLabel(shape).toLocaleLowerCase("pt-BR") === normalized) ?? null;
  }

  function closeAIScreens() {
    setAiOpen(false);
    setProjectOpen(false);
    setLayersOpen(false);
    setTimelineOpen(false);
    setPaletteOpen(null);
    setOutlineOpen(false);
    setFormatOpen(false);
    setTextOpen(false);
    setAdjustmentsOpen(false);
    setAlignmentOpen(false);
    setExportOpen(false);
    setSceneOpen(false);
    setAudioOpen(false);
    setAudioEditing(false);
  }

  function openAIScreen(screen: string) {
    closeAIScreens();
    if (screen === "ai") setAiOpen(true);
    else if (screen === "layers") setLayersOpen(true);
    else if (screen === "timeline") setTimelineOpen(true);
    else if (screen === "alignment" && selectedAnswerGroup) setAlignmentOpen(true);
    else if (screen === "colors") setPaletteOpen(selected ? "shape" : "background");
    else if (screen === "outline" && selected) setOutlineOpen(true);
    else if (screen === "format") setFormatOpen(true);
    else if (screen === "text" && selected?.type === "text") setTextOpen(true);
    else if (screen === "adjustments" && selected && selected.type !== "empty") setAdjustmentsOpen(true);
    else if (screen === "projects") setProjectOpen(true);
    else if (screen === "scenes") setSceneOpen(true);
    else if (screen === "audio") setAudioOpen(true);
    else if (screen === "export") setExportOpen(true);
  }

  function reportAI(action: string, message: string, ok = true, nextSelectedId: string | null = selectedId): AIResult {
    const result = { ok, action, message, selectedId: nextSelectedId };
    setAiLog((current) => [{ id: makeId(), message, ok }, ...current].slice(0, 6));
    window.dispatchEvent(new CustomEvent("forma:action", { detail: result }));
    return result;
  }



  async function executeAICommand(command: AICommand): Promise<AIResult> {
    const action = String(command.action ?? "").trim().toLowerCase();
    const target = resolveAITarget(command.target);

    const sceneResult = handleSceneCommand(command, {
      scenes: scenesRef.current,
      activeSceneId: activeSceneIdRef.current,
      addScene: addProjectScene,
      addIntro: addProjectIntro,
      addTransition: addProjectTransition,
      selectScene: selectProjectScene,
      renameScene: renameProjectScene,
      deleteScene: deleteProjectScene,
      openScenes: () => { closeAIScreens(); setSceneOpen(true); },
      report: reportAI,
    });
    if (sceneResult) return sceneResult;

    const audioResult = handleAudioCommand(command, {
      presets: audioPresets,
      activePresetId: activeScene?.audioPresetId,
      selectedClipId: selectedAudioClipId ?? undefined,
      activeSceneKind: activeScene ? sceneKind(activeScene) : "main",
      sceneDuration: animationDuration,
      playhead: playheadRef.current,
      createPreset: createAudioPresetForScene,
      applyPreset: setSceneAudioPreset,
      updatePreset: replaceAudioPreset,
      splitClip: splitPresetAudioClip,
      openAudio: () => { closeAIScreens(); setAudioOpen(true); },
      sceneStingers,
      updateSceneStingers: setSceneStingers,
      report: reportAI,
    });
    if (audioResult) return audioResult;

    const mainScenePresetResult = await handleMainScenePresetCommand(command, {
      shapes,
      background,
      backgroundVideo,
      format,
      setShapes,
      setBackground,
      setBackgroundVideo,
      setDuration: setAnimationDuration,
      setFormat,
      pause: pauseAnimation,
      stopRecording: () => setRecordingId(null),
      seek: setTime,
      select: setSelectedId,
      resetView: resetZoom,
      openTimeline: () => setTimelineOpen(true),
      schedulePlay: () => window.setTimeout(() => { void window.FormaAI?.execute({ action: "play" }); }, 120),
      commit,
      report: reportAI,
    });
    if (mainScenePresetResult) {
      if (mainScenePresetResult.ok) setActiveSceneKind(mainScenePresetMetadata(command.preset ?? command.scene ?? command.value)?.kind ?? "main");
      return mainScenePresetResult;
    }

    const creationResult = handleCreationCommand(command, {
      target,
      shapes,
      background,
      shapeColor,
      width: W,
      height: H,
      animationDuration,
      makeId,
      addEmptyLayer,
      componentShapes,
      createScene: quizScene,
      setShapes,
      select: setSelectedId,
      selectTool: () => setTool("select"),
      pause: pauseAnimation,
      stopRecording: () => setRecordingId(null),
      setDuration: setAnimationDuration,
      setLandscape: () => setFormat("landscape"),
      setBackground,
      resetView: resetZoom,
      openTimeline: () => setTimelineOpen(true),
      commit,
      seek: setTime,
      schedulePlay: () => window.setTimeout(() => { void window.FormaAI?.execute({ action: "play" }); }, 120),
      layerLabel,
      report: reportAI,
    });
    if (creationResult) return creationResult;

    const mediaVisualResult = handleMediaVisualCommand(command, { target, shapes, background, setShapes, commit, layerLabel, report: reportAI });
    if (mediaVisualResult) return mediaVisualResult;

    const layerResult = handleLayerCommand(command, { target, shapes, background, selectedId, width: W, height: H, makeId, setShapes, select: setSelectedId, commit, layerLabel, report: reportAI });
    if (layerResult) return layerResult;

    const organizationResult = handleOrganizationCommand(command, { target, shapes, background, selectedId, selectedAnswerGroup, width: W, height: H, setShapes, select: setSelectedId, setBackground, commit, changeFormat, auditAnswerGroup: (groupId) => auditAnswerGroup(groupId, shapes), repairAnswerAlignment, distributeAnswerGroups, openAlignment: () => setAlignmentOpen(true), report: reportAI });
    if (organizationResult) return organizationResult;

    const animationResult = handleAnimationCommand(command, { target, shapes, background, width: W, height: H, animationDuration, playhead: playheadRef.current, addOrReplaceKeyframe, setShapes, select: setSelectedId, openTimeline: () => setTimelineOpen(true), setRecording: setRecordingId, seek: setTime, commit, layerLabel, report: reportAI });
    if (animationResult) return animationResult;

    const binaryQuizResult = handleBinaryQuizResultCommand(command, { shapes, background, backgroundVideo, setShapes, setBackground, setBackgroundVideo, setDuration: setAnimationDuration, pause: pauseAnimation, seek: setTime, select: setSelectedId, commit, report: reportAI });
    if (binaryQuizResult) {
      if (binaryQuizResult.ok) setActiveSceneKind("result");
      return binaryQuizResult;
    }

    const quizResult = handleQuizResultCommand(command, { shapes, background, setShapes, setDuration: setAnimationDuration, pause: pauseAnimation, seek: setTime, select: setSelectedId, commit, report: reportAI });
    if (quizResult) {
      if (quizResult.ok) setActiveSceneKind("result");
      return quizResult;
    }

    const playbackUIResult = handlePlaybackUICommand(command, {
      animationDuration,
      playhead: playheadRef.current,
      play: playAnimation,
      pause: pauseAnimation,
      seek: setTime,
      setDuration: setAnimationDuration,
      undo,
      redo,
      resetView: resetZoom,
      openScreen: openAIScreen,
      report: reportAI,
    });
    if (playbackUIResult) return playbackUIResult;
    const projectExportResult = await handleProjectExportCommand(command, {
      newProject,
      saveCurrentProject,
      savedProjects,
      openProject: (project) => loadProject({ ...project, schema: "forma-project/1.0", animationDuration }),
      exportProjectZip,
      captureDiagnostic: captureCanvasDiagnostic,
      exportSvg,
      exportMp4,
      exportPng,
      getExportMessage: () => exportMessage,
      prepareExport: (options) => prepareAIExport(options),
      artifact: aiArtifact,
      downloadArtifact: sharePreparedArtifact,
      report: reportAI,
    });
    if (projectExportResult) return projectExportResult;
    return reportAI(action || "unknown", `Comando não reconhecido: ${action || "vazio"}.`, false);
  }


  async function runAIPrompt(prompt: string) {
    if (!prompt.trim()) return;
    setAiPrompt("");
    await executeAICommand(commandFromPrompt(prompt));
  }

  async function runAIInput(input: string | AICommand | AICommand[], requestId: string = makeId()): Promise<AIResponse> {
    return runAIController(input, { requestId, parsePrompt: commandFromPrompt, execute: (command) => window.FormaAI?.execute(command) ?? executeAICommand(command), nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())), getState: () => window.FormaAI?.getState() ?? aiStateSnapshot(), publish: (response) => { setAiLastResponse(response); window.dispatchEvent(new CustomEvent("forma:response", { detail: response })); } });
  }

  async function runWebScript() {
    if (!aiWebScript.trim()) return;
    try { await runAIInput(aiWebScript); }
    catch (error) { reportAI("web_script", error instanceof Error ? `JSON inválido: ${error.message}` : "JSON inválido.", false); }
  }

  useEffect(() => {
    aiRuntimeRef.current = { getState: aiStateSnapshot, getArtifact: () => aiArtifact, prepareExport: prepareAIExport, downloadArtifact: sharePreparedArtifact, listProjects: () => savedProjects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })), execute: executeAICommand, run: runAIInput, open: () => setAiOpen(true) };
  });

  useEffect(() => {
    objectActionRef.current = {
      toggleKeyframes,
      openAlignment: () => { pauseAnimation(); openAIScreen("alignment"); },
      duplicate: duplicateSelected,
      remove: removeSelected,
    };
  });

  useEffect(() => {
    layerActionRef.current = { add: addEmptyLayer, toggleVisibility: toggleLayer, toggleLock, startRename, finishRename, remove: deleteLayer, move: moveLayer };
  });

  useEffect(() => {
    alignmentActionRef.current = { repair: repairAnswerAlignment, repairAll: repairAllAnswerAlignments, distribute: distributeAnswerGroups };
  });

  useEffect(() => {
    timelineActionRef.current = {
      startPanelDrag: startTimelineDrag,
      movePanel: moveTimeline,
      endPanelDrag: endTimelineDrag,
      togglePlayback: isPlaying ? pauseAnimation : playAnimation,
      toggleKeyframes,
      close: () => { pauseAnimation(); setRecordingId(null); setSelectedKeyframes([]); setTimelineOpen(false); },
      startScrub: startTimelineScrub,
      scrub: scrubTimelineRuler,
      startMarquee: startKeyframeMarquee,
      moveMarquee: moveKeyframeMarquee,
      endMarquee: endKeyframeMarquee,
      startKeyframe: startKeyframeDrag,
      moveKeyframe: moveSelectedKeyframes,
      endKeyframe: endSelectedKeyframes,
      seekFrame: (shapeId, time) => { setTime(time); setSelectedId(shapeId); },
    };
  });

  useEffect(() => {
    canvasActionRef.current = { beginTouch, startCanvas, movePointer, endPointer, startMove, startHandle };
  });

  useEffect(() => {
    aiPanelActionRef.current = {
      startDrag: startFloatingPanelDrag,
      moveDrag: moveFloatingPanel,
      endDrag: endFloatingPanelDrag,
      resetPosition: resetFloatingPanel,
      submitPrompt: () => { void runAIPrompt(aiPrompt); },
      runWebScript: () => { void runWebScript(); },
      execute: (command) => { void executeAICommand(command); },
    };
  });

  useEffect(() => {
    deliveryActionRef.current = {
      newProject,
      openProject: (project) => loadProject({ ...project, schema: "forma-project/1.0", animationDuration }),
      saveProject: (download) => saveCurrentProject(download),
      exportZip: (download) => exportProjectZip(download),
      prepareExport: (options) => prepareAIExport(options),
      exportMp4: (prepareForAI) => exportMp4(prepareForAI),
      exportProjectMp4: (prepareForAI) => exportProjectMp4(prepareForAI),
      captureDiagnostic: (download) => captureCanvasDiagnostic(download),
      captureExportDiagnostic: (download) => captureProjectExportDiagnostic(download),
      exportPng,
      exportSvg,
    };
  });

  useEffect(() => {
    const publishState = aiPublishRef.current;
    const current = () => {
      if (!aiRuntimeRef.current) throw new Error("Runtime FormaAI indisponível.");
      return aiRuntimeRef.current;
    };
    const bridge: FormaAIBridge = {
      version: "forma-ai/4.3",
      capabilities: AI_CAPABILITIES,
      getState: () => current().getState(),
      getArtifact: () => current().getArtifact(),
      prepareExport: (options) => current().prepareExport(options),
      downloadArtifact: () => current().downloadArtifact(),
      listProjects: () => current().listProjects(),
      execute: (command) => current().execute(command),
      batch: async (commands) => {
        const results: AIResult[] = [];
        for (const command of commands) {
          const result = await (window.FormaAI?.execute(command) ?? Promise.resolve({ ok: false, action: String(command.action ?? "unknown"), message: "Ponte IA indisponível." }));
          results.push(result);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return results;
      },
      command: (prompt) => current().execute(commandFromPrompt(prompt)),
      run: (input) => current().run(input),
      subscribe: (listener) => { aiSubscribersRef.current.add(listener); listener(current().getState()); return () => aiSubscribersRef.current.delete(listener); },
      open: () => current().open(),
    };
    Object.defineProperty(window, "FormaAI", { configurable: true, writable: true, value: bridge });
    const cleanupTransports = installFormaAITransports({ target: window, bridge, run: (input, requestId) => current().run(input, requestId), makeId, createChannel: () => typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("forma-ai") : null });
    return () => { cleanupTransports(); if (publishState.timer !== null) window.clearTimeout(publishState.timer); };
  }, []);

  useEffect(() => {
    const publish = () => {
      aiPublishRef.current.timer = null;
      aiPublishRef.current.last = performance.now();
      const state = aiRuntimeRef.current?.getState() ?? aiStateSnapshot();
      if (aiStateOutputRef.current) aiStateOutputRef.current.dataset.json = JSON.stringify(state);
      aiSubscribersRef.current.forEach((listener) => listener(state));
      window.dispatchEvent(new CustomEvent("forma:state", { detail: state }));
      if (state.ready && !aiReadySentRef.current) {
        aiReadySentRef.current = true;
        window.dispatchEvent(new CustomEvent("forma:ready", { detail: { version: "forma-ai/4.3", capabilities: AI_CAPABILITIES } }));
      }
    };
    const remaining = Math.max(0, 100 - (performance.now() - aiPublishRef.current.last));
    if (aiPublishRef.current.last === 0 || remaining === 0) publish();
    else if (aiPublishRef.current.timer === null) aiPublishRef.current.timer = window.setTimeout(publish, remaining);
  });

  useEffect(() => {
    chromeActionRef.current = {
      undo,
      redo,
      addText,
      toggleAI: () => openAIScreen(aiOpen ? "none" : "ai"),
      resetZoom,
    };
  });

  useEffect(() => {
    panelActionRef.current = {
      applyColor,
      applyBackgroundVideo,
      updateOutline,
      changeFormat,
      updateText,
      commitCurrent: () => commit(shapes, background),
      updateVisual,
      resetVisual,
      removeShapeImage,
    };
  });

  return (
    <main className="app-shell" data-forma-ready={hydrated ? "true" : "false"} data-forma-selected={selectedId ?? ""} data-forma-screen={aiOpen ? "ai" : projectOpen ? "projects" : sceneOpen ? "scenes" : audioOpen ? "audio" : layersOpen ? "layers" : timelineOpen ? "timeline" : alignmentOpen ? "alignment" : adjustmentsOpen ? "adjustments" : "canvas"} data-forma-artifact-ready={aiArtifact ? "true" : "false"} onPointerDownCapture={unlockAudioPlayback}>
      <AIObservabilityOutputs stateOutputRef={aiStateOutputRef} capabilitiesJson={AI_CAPABILITIES_JSON} response={aiLastResponse} responseJson={aiResponseJson} artifact={aiArtifact} currentProjectId={currentProjectId} projectName={projectName} projectCount={savedProjects.length} projectsJson={aiProjectsJson} selectedAnswerGroup={selectedAnswerGroup} alignmentAudit={selectedAlignmentAudit} alignmentJson={aiAlignmentJson} />
      <Topbar projectName={projectName} canUndo={canUndo} canRedo={canRedo} {...topbarCallbacks} />

      <input ref={projectInputRef} className="gallery-input" type="file" accept=".json,.forma.json,application/json" onChange={(event) => { void importProjectFile(event); }} />
      <input ref={shapeImageInputRef} className="gallery-input" type="file" accept="image/*" onChange={importImage} />
      <input ref={audioInputRef} className="gallery-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" onChange={(event) => { void importSceneAudio(event); }} />
      <input ref={projectAudioInputRef} className="gallery-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" onChange={(event) => { void importProjectAudio(event); }} />

      <section className="workspace" onClick={() => { setPaletteOpen(null); setExportOpen(false); setSceneOpen(false); }}>
        <div className="canvas-toolbar" onClick={(event) => event.stopPropagation()}>
          <CanvasMeta
            width={W}
            height={H}
            zoom={view.zoom}
            layerCount={shapes.length}
            sceneCount={scenes.length}
            activeSceneName={scenes.find((scene) => scene.id === activeSceneId)?.name ?? "Cena 1"}
            activeSceneKind={scenes.length ? sceneKind(scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0]) : "main"}
            scenesOpen={sceneOpen}
            {...canvasMetaCallbacks}
          />
          <SceneSwitcher
            open={sceneOpen}
            scenes={scenes}
            activeSceneId={activeSceneId}
            onAdd={() => { void executeAICommand({ action: "add_scene" }); }}
            onAddIntro={() => { void executeAICommand({ action: "create_intro_scene" }); }}
            onAddTransition={(afterSceneId, beforeSceneId) => { void executeAICommand({ action: "ensure_transition_scene", afterSceneId, beforeSceneId }); }}
            onRename={(sceneId, newName) => { void executeAICommand({ action: "rename_scene", sceneId, newName }); }}
            onDelete={(sceneId) => { void executeAICommand({ action: "delete_scene", sceneId }); }}
            onDeleteAll={deleteAllProjectScenes}
            onSelect={(id) => { void executeAICommand({ action: "select_scene", sceneId: id }); }}
            onClose={() => setSceneOpen(false)}
          />
        </div>
        <div ref={canvasFrameRef} className={`canvas-frame${isCanvasPanning ? " is-panning" : ""}`} style={{ aspectRatio: `${W} / ${H}`, width: format === "portrait" ? "min(100%, calc((100dvh - 260px) * .5625))" : format === "landscape" ? "min(100%, 660px)" : "min(100%, 660px, calc(100dvh - 260px))" }} onWheel={zoomCanvasWithWheel} onPointerDownCapture={startCanvasPan} onPointerMove={moveCanvasPan} onPointerUp={endCanvasPan} onPointerCancel={endCanvasPan} onAuxClick={(event) => { if (event.button === 1 && window.innerWidth >= 700) event.preventDefault(); }} onMouseDown={(event) => { if (event.button === 1 && window.innerWidth >= 700) event.preventDefault(); }} onClick={(event) => event.stopPropagation()}>
          <div className="canvas-zoom" style={{ transform: `translate3d(${view.panX}px, ${view.panY}px, 0) scale(${view.zoom})` }}>
            {renderedBackgroundVideo && <CanvasBackgroundVideo key={renderedBackgroundVideo} source={renderedBackgroundVideo} playhead={renderedBackgroundTime} playing={isPlaying && transitionFrame?.phase !== "freeze-previous"} />}
            <CanvasSurface
              svgRef={svgRef}
              width={W}
              height={H}
              background={renderedBackgroundVideo ? "transparent" : renderedBackground}
              displayedShapes={displayedShapes}
              authorialShapes={shapes}
              selectedId={selectedId}
              selected={selected}
              inverseZoom={inverseCanvasZoom}
              guides={guides}
              alignmentOpen={alignmentOpen}
              selectedAnswerGroup={selectedAnswerGroup}
              {...canvasCallbacks}
            />
          </div>
        </div>
        {hasAnimation && (
          <div className="transport-bar" onClick={(event) => event.stopPropagation()}>
            <button className={`transport-play ${isPlaying ? "playing" : ""}`} aria-label={isPlaying ? "Pausar animação" : "Reproduzir animação"} onClick={isPlaying ? pauseAnimation : playAnimation}>{isPlaying ? "Ⅱ" : "▶"}</button>
            <button className="transport-track" aria-label={`Ir para outro ponto da animação. Tempo atual ${playhead.toFixed(1)} de ${animationDuration.toFixed(1)} segundos`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTime(((event.clientX - rect.left) / rect.width) * animationDuration); }}>
              <span style={{ width: `${(playhead / animationDuration) * 100}%` }} />
            </button>
            <span className="transport-time"><strong>{playhead.toFixed(1)}s</strong><small>/ {animationDuration.toFixed(1)}s</small></span>
            <button className={`transport-diagnostic ${diagnosticActive ? "active" : ""}`} disabled={diagnosticActive} onClick={() => { void captureCanvasDiagnostic(false).catch(() => {}); }}>{diagnosticActive ? "MEDINDO" : "DIAG"}</button>
            <button className="transport-open" aria-label="Abrir timeline" onClick={() => setTimelineOpen(true)}>Timeline</button>
          </div>
        )}
        <p className="gesture-tip"><span className="desktop-canvas-tip">Roda: zoom · Segure o botão central: mover canvas</span><span className="touch-canvas-tip">Desenhe com um dedo. Use dois dedos para aproximar ou afastar.</span></p>
      </section>

      {selected && <ObjectBar selected={selected} timelineOpen={timelineOpen} recording={recordingId === selected.id} answerGroupSelected={Boolean(selectedAnswerGroup)} alignmentOkay={Boolean(selectedAlignmentAudit?.ok)} {...objectBarCallbacks} />}

      {alignmentOpen && selectedAnswerGroup && selectedAlignmentAudit && (
        <AlignmentPanel audit={selectedAlignmentAudit} label={selectedAnswerGroup.replace(/^answer-/, "").toUpperCase()} {...alignmentCallbacks} />
      )}

      {timelineOpen && (
        <TimelinePanel panelRef={motionPanelRef} tracksRef={motionTracksRef} position={timelinePosition} playhead={playhead} duration={animationDuration} isPlaying={isPlaying} selected={selected} recordingId={recordingId} selectedKeyframes={selectedKeyframes} shapes={shapes} selectedId={selectedId} marquee={keyframeMarquee} {...timelineCallbacks} />
      )}

      <ToolDock tool={tool} textOpen={textOpen} backgroundOpen={paletteOpen === "background"} layersOpen={layersOpen} audioOpen={audioOpen} aiOpen={aiOpen} {...dockCallbacks} />
      <input ref={fileInputRef} className="gallery-input" type="file" accept="image/*" onChange={importImage} />

      {aiOpen && <AIPanel
        formatRatio={CANVAS_FORMATS[format].ratio}
        width={W}
        height={H}
        layerCount={shapes.length}
        visibleLayerCount={visibleShapeCount}
        selectionLabel={selected ? layerLabel(selected) : "Nenhuma"}
        selectionPosition={selected ? `${Math.round(selected.x)}, ${Math.round(selected.y)}` : "Aguardando"}
        duration={animationDuration}
        playbackStatus={recordingId ? "Gravando" : isPlaying ? `${playhead.toFixed(1)}s reproduzindo` : "Pronta"}
        prompt={aiPrompt}
        webScript={aiWebScript}
        response={aiLastResponse}
        log={aiLog}
        audioPresets={audioPresets}
        audioBindings={audioBindings}
        onBindAudio={bindAudioPreset}
        {...aiPanelCallbacks}
      />}

      {batchOpen && <BatchImportPanel onClose={() => setBatchOpen(false)} onApply={applyBatchImport} />}

      {audioOpen && activeScene && !projectAudioEditing && <AudioPanel
        duration={animationDuration}
        playhead={playhead}
        isPlaying={isPlaying}
        sceneKind={sceneKind(activeScene)}
        presets={audioPresets}
        activePresetId={activeScene.audioPresetId}
        editing={audioEditing}
        selectedClipId={selectedAudioClipId}
        projectPresets={projectAudioPresets}
        activeProjectPresetId={activeProjectAudioPresetId ?? undefined}
        sceneStingers={sceneStingers}
        cloudStatus={audioCloudStatus}
        cloudMessage={audioCloudMessage}
        cloudUpdatedAt={audioCloudUpdatedAt}
        cloudLibraryKey={SHARED_AUDIO_LIBRARY_KEY}
        onSyncCloud={() => { void forceAudioCloudSync(); }}
        onRestoreCloud={() => { void restoreAudioCloudLibrary(); }}
        onDownloadCloudBackup={() => { void downloadAudioLibraryBackup(); }}
        onClose={() => { setAudioOpen(false); setAudioEditing(false); setProjectAudioEditing(false); setEditingProjectAudioPresetId(null); setSelectedAudioClipId(null); setSelectedProjectAudioClipId(null); }}
        onCreate={createAudioPresetForScene}
        onCreateProjectPreset={createProjectAudioPresetForProject}
        onSelectProjectPreset={setActiveProjectAudioPresetId}
        onEditProjectPreset={(id) => { setEditingProjectAudioPresetId(id); setProjectAudioEditing(true); setAudioEditing(false); setSelectedProjectAudioClipId(null); }}
        onDeleteProjectPreset={(id) => {
          if (id === BUILTIN_MAIN_AUDIO_PRESET_ID) return;
          setProjectAudioPresets((current) => {
            const next = current.filter((preset) => preset.id !== id);
            if (activeProjectAudioPresetId === id) setActiveProjectAudioPresetId(null);
            return next;
          });
          if (editingProjectAudioPresetId === id) { setEditingProjectAudioPresetId(null); setProjectAudioEditing(false); }
          setSelectedProjectAudioClipId(null);
        }}
        onChangeProjectPresetVolume={(id, value) => setProjectAudioPresets((current) => current.map((preset) => preset.id === id ? normalizeProjectAudioPreset({ ...preset, masterVolume: value }) : preset))}
        onBack={() => { setAudioEditing(false); setSelectedAudioClipId(null); }}
        onSelectPreset={(id) => setSceneAudioPreset(id)}
        onEditPreset={(id) => { setSceneAudioPreset(id); setAudioEditing(true); setSelectedAudioClipId(null); }}
        onDeletePreset={(id) => {
          setAudioPresets((current) => current.filter((preset) => preset.id !== id));
          setAudioBindings((current) => removeAudioPresetBindings(current, id));
          const next = scenesRef.current.map((scene) => scene.audioPresetId === id ? { ...scene, audioPresetId: undefined } : scene);
          scenesRef.current = next; setScenes(next); setSelectedAudioClipId(null); setAudioEditing(false);
        }}
        onRenamePreset={(id, name) => setAudioPresets((current) => current.map((preset) => preset.id === id ? renameAudioPreset(preset, name) : preset))}
        onApplyAll={() => activeScene.audioPresetId && setSceneAudioPreset(activeScene.audioPresetId, true)}
        onChangeMasterVolume={(value) => updateActiveAudioPreset((preset) => normalizeAudioPreset({ ...preset, masterVolume: value }, preset.sceneKind))}
        onImport={(trackIndex) => { audioImportTrackRef.current = trackIndex; audioInputRef.current?.click(); }}
        onSelectClip={setSelectedAudioClipId}
        onMoveClip={(id, start) => updateActiveAudioPreset((preset) => updateAudioClip(preset, id, { start: clampAudioStart(start, animationDuration) }))}
        onUpdateClip={(id, patch) => updateActiveAudioPreset((preset) => updateAudioClip(preset, id, patch))}
        onDeleteClip={(id) => { updateActiveAudioPreset((preset) => removeAudioClip(preset, id)); setSelectedAudioClipId(null); }}
        onSplitClip={(id, time) => { if (activeAudioPreset) splitPresetAudioClip(activeAudioPreset.id, id, time); }}
        onTogglePlayback={isPlaying ? pauseAnimation : playAnimation}
        onSeek={setTime}
        onUpdateSceneStingers={setSceneStingers}
      />}

      {audioOpen && projectAudioEditing && editingProjectAudioPreset && <ProjectAudioPanel
        duration={projectAudioTimelineDuration}
        playhead={Math.max(0, activeProjectAudioOffset + playhead)}
        isPlaying={isPlaying}
        preset={editingProjectAudioPreset}
        selectedClipId={selectedProjectAudioClipId}
        importMessage={projectAudioImportMessage}
        onClose={() => { setAudioOpen(false); setProjectAudioEditing(false); setEditingProjectAudioPresetId(null); setSelectedProjectAudioClipId(null); }}
        onBack={() => { setProjectAudioEditing(false); setEditingProjectAudioPresetId(null); setSelectedProjectAudioClipId(null); }}
        onRename={(name) => replaceProjectAudioPreset(renameProjectAudioPreset(editingProjectAudioPreset, name))}
        onChangeMasterVolume={(value) => updateEditingProjectAudioPreset((preset) => normalizeProjectAudioPreset({ ...preset, masterVolume: value }))}
        onImport={(trackIndex) => { projectAudioImportTrackRef.current = trackIndex; projectAudioInputRef.current?.click(); }}
        onSelectClip={setSelectedProjectAudioClipId}
        onMoveClip={(id, start) => updateEditingProjectAudioPreset((preset) => updateProjectAudioClip(preset, id, { start: clampAudioStart(start, projectAudioTimelineDuration) }))}
        onUpdateClip={(id, patch) => updateEditingProjectAudioPreset((preset) => updateProjectAudioClip(preset, id, patch))}
        onDeleteClip={(id) => { updateEditingProjectAudioPreset((preset) => removeProjectAudioClip(preset, id)); setSelectedProjectAudioClipId(null); }}
        onSplitClip={splitProjectPresetAudioClip}
        onTogglePlayback={isPlaying ? pauseAnimation : playAnimation}
        onSeek={seekProjectAudio}
      />}

      {textOpen && selected?.type === "text" && (
        <TextPanel selected={selected} onUpdate={panelCallbacks.onUpdateText} onCommit={panelCallbacks.onCommitCurrent} onClose={panelCallbacks.onCloseText} />
      )}

      {paletteOpen && <PalettePanel mode={paletteOpen} background={background} backgroundVideo={backgroundVideo} selectedFill={selected?.fill} shapeColor={shapeColor} onApplyColor={panelCallbacks.onApplyColor} onApplyBackgroundVideo={panelCallbacks.onApplyBackgroundVideo} onClose={panelCallbacks.onClosePalette} />}

      {outlineOpen && selected && (selected.type === "rect" || selected.type === "ellipse" || selected.type === "text" || selected.type === "brush") && (
        <OutlinePanel selected={selected} onUpdate={panelCallbacks.onUpdateOutline} onClose={panelCallbacks.onCloseOutline} />
      )}

      {adjustmentsOpen && selected && (selected.type === "rect" || selected.type === "ellipse" || selected.type === "image") && (
        <AdjustmentsPanel selected={selected} onUpdate={panelCallbacks.onUpdateVisual} onCommit={panelCallbacks.onCommitCurrent} onReset={panelCallbacks.onResetVisual} onRemoveImage={panelCallbacks.onRemoveShapeImage} onChooseImage={panelCallbacks.onChooseShapeImage} onClose={panelCallbacks.onCloseAdjustments} />
      )}

      {formatOpen && <FormatPanel format={format} onChange={panelCallbacks.onChangeFormat} onClose={panelCallbacks.onCloseFormat} />}

      {layersOpen && (
        <LayersPanel shapes={shapes} selectedId={selectedId} renamingId={renamingId} renameValue={renameValue} {...layerCallbacks} />
      )}

      {projectOpen && (
        <ProjectsPanel projectName={projectName} currentProjectId={currentProjectId} projects={savedProjects} {...projectCallbacks} />
      )}

      {exportOpen && (
        <ExportPanel artifact={aiArtifact} progress={exportProgress} message={exportMessage} diagnosticActive={diagnosticActive} exportDiagnosticActive={exportDiagnosticActive} width={W} height={H} sceneCount={scenes.length} projectDuration={totalProjectDuration} hasSceneAudio={Boolean(activeProjectAudioPreset?.tracks.some((track) => track.clips.length)) || presetClips(activeAudioPreset).length > 0} {...exportCallbacks} />
      )}
    </main>
  );
}
