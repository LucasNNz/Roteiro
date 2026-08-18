import { upload } from "@vercel/blob/client";
import type { AudioLibraryState } from "./cloud-library.ts";
import type { ProjectAudioPreset, SceneAudioClip, SceneAudioPreset } from "../../app/types.ts";
import { cloneAudioPreset } from "./scenes.ts";
import { cloneProjectAudioPreset } from "./project.ts";
import { loadProjectAudioAsset } from "./local-project-assets.ts";
import { audioLibraryRequestHeaders } from "./library-key.ts";

const BLOB_HOST = /\.blob\.vercel-storage\.com(?=\/|$)/i;
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

export type AudioCloudUploadProgress = {
  current: number;
  total: number;
  name: string;
  percentage: number;
};

export type PreparedCloudAudioState = {
  cloudState: AudioLibraryState;
  localState: AudioLibraryState;
  uploadedAssetCount: number;
  reusedAssetCount: number;
  uploadedBytes: number;
};

function isHttpSource(src: string) {
  return /^https?:\/\//i.test(src);
}

function isStaticAppSource(src: string) {
  return src.startsWith("/") && !src.startsWith("//");
}

function isVercelBlobSource(src: string) {
  if (!isHttpSource(src)) return false;
  try { return BLOB_HOST.test(new URL(src).hostname); } catch { return false; }
}

function safePathPart(value: string, fallback: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 90);
}

function extensionForMime(mime: string, name: string) {
  const fromName = name.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const lowered = mime.toLowerCase();
  if (lowered.includes("wav")) return "wav";
  if (lowered.includes("ogg")) return "ogg";
  if (lowered.includes("aac")) return "aac";
  if (lowered.includes("mp4") || lowered.includes("m4a")) return "m4a";
  if (lowered.includes("webm")) return "webm";
  return "mp3";
}

async function fetchBlob(src: string) {
  const response = await fetch(src, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível reler um arquivo de áudio antes de enviá-lo para a nuvem.");
  return await response.blob();
}

async function sourceBlob(clip: SceneAudioClip, preferLocalAsset: boolean) {
  if (preferLocalAsset && clip.assetId) {
    const local = await loadProjectAudioAsset(clip.assetId).catch(() => null);
    if (local?.blob) return local.blob;
  }
  if (clip.src) return await fetchBlob(clip.src);
  if (clip.cloudSrc) return await fetchBlob(clip.cloudSrc);
  if (clip.assetId) {
    const local = await loadProjectAudioAsset(clip.assetId).catch(() => null);
    if (local?.blob) return local.blob;
  }
  throw new Error(`O arquivo “${clip.name}” não está disponível para sincronização.`);
}

function cloneState(state: AudioLibraryState): AudioLibraryState {
  return {
    presets: state.presets.map(cloneAudioPreset),
    bindings: { ...state.bindings },
    stingers: structuredClone(state.stingers),
    projectPresets: state.projectPresets.map(cloneProjectAudioPreset),
    activeProjectPresetId: state.activeProjectPresetId ?? null,
  };
}

type EnsureContext = {
  scope: "scene" | "project";
  preferLocalAsset: boolean;
  cache: Map<string, Promise<{ url: string; bytes: number; uploaded: boolean }>>;
  onProgress?: (progress: AudioCloudUploadProgress) => void;
  counter: { current: number; total: number; uploadedAssetCount: number; reusedAssetCount: number; uploadedBytes: number };
};

async function ensureCloudSource(clip: SceneAudioClip, context: EnsureContext) {
  const explicitCloud = clip.cloudSrc || (isVercelBlobSource(clip.src) ? clip.src : "");
  if (explicitCloud) {
    context.counter.reusedAssetCount += 1;
    return { url: explicitCloud, assetId: clip.assetId || `${context.scope}-audio-${clip.id}` };
  }

  if (isStaticAppSource(clip.src) || (isHttpSource(clip.src) && !clip.src.startsWith(location.origin))) {
    context.counter.reusedAssetCount += 1;
    return { url: clip.src, assetId: clip.assetId || `${context.scope}-audio-${clip.id}` };
  }

  const assetId = clip.assetId || `${context.scope}-audio-${clip.id}`;
  const cacheKey = `${context.scope}:${assetId}`;
  let pending = context.cache.get(cacheKey);
  const created = !pending;
  if (!pending) {
    pending = (async () => {
      const blob = await sourceBlob({ ...clip, assetId }, context.preferLocalAsset);
      const extension = extensionForMime(clip.mime || blob.type || "audio/mpeg", clip.name);
      const baseName = safePathPart(clip.name.replace(/\.[^.]+$/, ""), "audio");
      const pathname = `forma/audio/assets/${context.scope}-${safePathPart(assetId, "asset")}-${baseName}.${extension}`;
      const result = await upload(pathname, blob, {
        access: "public",
        handleUploadUrl: "/api/audio-library/upload",
        contentType: clip.mime || blob.type || "audio/mpeg",
        multipart: blob.size >= MULTIPART_THRESHOLD,
        clientPayload: JSON.stringify({ assetId, scope: context.scope }),
        headers: audioLibraryRequestHeaders(),
        onUploadProgress: ({ percentage }) => {
          context.onProgress?.({
            current: context.counter.current + 1,
            total: context.counter.total,
            name: clip.name,
            percentage: Math.max(0, Math.min(100, percentage)),
          });
        },
      });
      return { url: result.url, bytes: blob.size, uploaded: true };
    })();
    context.cache.set(cacheKey, pending);
  } else {
    context.counter.reusedAssetCount += 1;
  }
  const result = await pending;
  if (created && result.uploaded) {
    context.counter.uploadedAssetCount += 1;
    context.counter.uploadedBytes += result.bytes;
    context.counter.current += 1;
    context.onProgress?.({ current: context.counter.current, total: context.counter.total, name: clip.name, percentage: 100 });
  }
  return { url: result.url, assetId };
}

function uploadCandidates(state: AudioLibraryState) {
  const keys = new Set<string>();
  for (const preset of state.presets) for (const clip of preset.tracks.flatMap((track) => track.clips)) {
    if (clip.cloudSrc || isVercelBlobSource(clip.src) || isStaticAppSource(clip.src) || (isHttpSource(clip.src) && !clip.src.startsWith(location.origin))) continue;
    keys.add(`scene:${clip.assetId || `scene-audio-${clip.id}`}`);
  }
  for (const preset of state.projectPresets) for (const clip of preset.tracks.flatMap((track) => track.clips)) {
    if (clip.cloudSrc || isVercelBlobSource(clip.src) || isStaticAppSource(clip.src) || (isHttpSource(clip.src) && !clip.src.startsWith(location.origin))) continue;
    keys.add(`project:${clip.assetId || `project-audio-${clip.id}`}`);
  }
  return keys.size;
}

async function prepareScenePresets(local: SceneAudioPreset[], cloud: SceneAudioPreset[], context: Omit<EnsureContext, "scope" | "preferLocalAsset">) {
  for (let p = 0; p < local.length; p += 1) {
    for (let t = 0; t < local[p].tracks.length; t += 1) {
      for (let c = 0; c < local[p].tracks[t].clips.length; c += 1) {
        const localClip = local[p].tracks[t].clips[c];
        const cloudClip = cloud[p].tracks[t].clips[c];
        const source = await ensureCloudSource(localClip, { ...context, scope: "scene", preferLocalAsset: false });
        local[p].tracks[t].clips[c] = { ...localClip, assetId: source.assetId, ...(isHttpSource(source.url) ? { cloudSrc: source.url } : {}) };
        cloud[p].tracks[t].clips[c] = { ...cloudClip, assetId: source.assetId, src: source.url, ...(isHttpSource(source.url) ? { cloudSrc: source.url } : {}) };
      }
    }
  }
}

async function prepareProjectPresets(local: ProjectAudioPreset[], cloud: ProjectAudioPreset[], context: Omit<EnsureContext, "scope" | "preferLocalAsset">) {
  for (let p = 0; p < local.length; p += 1) {
    for (let t = 0; t < local[p].tracks.length; t += 1) {
      for (let c = 0; c < local[p].tracks[t].clips.length; c += 1) {
        const localClip = local[p].tracks[t].clips[c];
        const cloudClip = cloud[p].tracks[t].clips[c];
        const source = await ensureCloudSource(localClip, { ...context, scope: "project", preferLocalAsset: true });
        local[p].tracks[t].clips[c] = { ...localClip, assetId: source.assetId, ...(isHttpSource(source.url) ? { cloudSrc: source.url } : {}) };
        cloud[p].tracks[t].clips[c] = { ...cloudClip, assetId: source.assetId, src: source.url, ...(isHttpSource(source.url) ? { cloudSrc: source.url } : {}) };
      }
    }
  }
}

export async function prepareAudioLibraryForCloud(state: AudioLibraryState, onProgress?: (progress: AudioCloudUploadProgress) => void): Promise<PreparedCloudAudioState> {
  const localState = cloneState(state);
  const cloudState = cloneState(state);
  const counter = { current: 0, total: uploadCandidates(state), uploadedAssetCount: 0, reusedAssetCount: 0, uploadedBytes: 0 };
  const context = { cache: new Map<string, Promise<{ url: string; bytes: number; uploaded: boolean }>>(), onProgress, counter };
  await prepareScenePresets(localState.presets, cloudState.presets, context);
  await prepareProjectPresets(localState.projectPresets, cloudState.projectPresets, context);
  return { cloudState, localState, uploadedAssetCount: counter.uploadedAssetCount, reusedAssetCount: counter.reusedAssetCount, uploadedBytes: counter.uploadedBytes };
}
