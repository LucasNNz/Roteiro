import type { AIArtifact, AIState, CanvasPreset, Shape, Tool } from "../../app/types.ts";

export type AIOpenFlags = {
  ai: boolean; projects: boolean; layers: boolean; timeline: boolean; alignment: boolean;
  adjustments: boolean; colors: boolean; outline: boolean; format: boolean; text: boolean; export: boolean;
};

export function resolveAIOpenScreen(flags: AIOpenFlags) {
  return flags.ai ? "ai" : flags.projects ? "projects" : flags.layers ? "layers" : flags.timeline ? "timeline" : flags.alignment ? "alignment" : flags.adjustments ? "adjustments" : flags.colors ? "colors" : flags.outline ? "outline" : flags.format ? "format" : flags.text ? "text" : flags.export ? "export" : null;
}

export function sanitizeAIShape(shape: Shape) {
  return { ...shape, src: shape.src ? "[imagem incorporada]" : undefined, imageSrc: shape.imageSrc ? "[imagem na forma]" : undefined, keyframes: shape.keyframes?.map((frame) => ({ ...frame })) };
}

export function createAIStateSnapshot(input: {
  hydrated: boolean; format: CanvasPreset; width: number; height: number; background: string; zoom: number;
  shapes: Shape[]; selected: Shape | null; animationDuration: number; playhead: number; isPlaying: boolean;
  recordingId: string | null; aiArtifact: AIArtifact | null; tool: Tool; open: AIOpenFlags;
}): AIState {
  const openScreen = resolveAIOpenScreen(input.open);
  return {
    version: "forma-ai/4.3",
    ready: input.hydrated,
    canvas: { format: input.format, width: input.width, height: input.height, background: input.background, zoom: input.zoom },
    document: { layerCount: input.shapes.length, layers: input.shapes.map(sanitizeAIShape) },
    selection: input.selected ? sanitizeAIShape(input.selected) : null,
    animation: { duration: input.animationDuration, playhead: input.playhead, playing: input.isPlaying, recordingLayerId: input.recordingId },
    artifact: input.aiArtifact ? { id: input.aiArtifact.id, name: input.aiArtifact.name, kind: input.aiArtifact.kind, mime: input.aiArtifact.mime, size: input.aiArtifact.size, width: input.aiArtifact.width, height: input.aiArtifact.height, duration: input.aiArtifact.duration, createdAt: input.aiArtifact.createdAt } : null,
    ui: { openScreen, activeTool: input.tool },
  };
}
