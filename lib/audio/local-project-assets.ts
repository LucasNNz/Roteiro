import type { ProjectAudioPreset } from "../../app/types.ts";

const DB_NAME = "forma-project-audio-assets-v1";
const STORE_NAME = "assets";
const DB_VERSION = 1;
export const PROJECT_AUDIO_CLOUD_RAW_BYTES = 36 * 1024 * 1024;

type StoredProjectAudioAsset = {
  id: string;
  blob: Blob;
  mime: string;
  size: number;
  updatedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Este navegador não oferece armazenamento local para arquivos grandes de áudio."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    }, { once: true });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento de áudio.")), { once: true });
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? transaction.error ?? new Error("Falha ao acessar o arquivo de áudio.")), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("O armazenamento do áudio foi interrompido.")), { once: true });
    });
  } finally {
    db.close();
  }
}

export async function storeProjectAudioAsset(id: string, blob: Blob, mime = blob.type || "audio/mpeg") {
  const record: StoredProjectAudioAsset = { id, blob, mime, size: blob.size, updatedAt: new Date().toISOString() };
  await withStore("readwrite", (store) => store.put(record));
  return record;
}

export async function loadProjectAudioAsset(id: string) {
  return await withStore<StoredProjectAudioAsset | undefined>("readonly", (store) => store.get(id)) ?? null;
}

export function compactProjectAudioPresetsForStorage(presets: ProjectAudioPreset[]) {
  return presets.map((preset) => ({
    ...preset,
    tracks: preset.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.assetId ? { ...clip, src: "" } : { ...clip }),
    })) as ProjectAudioPreset["tracks"],
  }));
}

export function projectAudioStoredBytes(presets: ProjectAudioPreset[]) {
  const seen = new Set<string>();
  let bytes = 0;
  for (const preset of presets) {
    for (const clip of preset.tracks.flatMap((track) => track.clips)) {
      const key = clip.assetId || clip.src;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const sourceBytes = Number(clip.sourceBytes);
      if (Number.isFinite(sourceBytes) && sourceBytes > 0) bytes += sourceBytes;
    }
  }
  return bytes;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Não foi possível preparar o áudio para sincronização.")), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Não foi possível preparar o áudio para sincronização.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function blobFromRuntimeSource(src: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Não foi possível reler um arquivo de áudio importado.");
  return await response.blob();
}

export async function adoptProjectAudioRuntimeSources(presets: ProjectAudioPreset[]) {
  let changed = false;
  const tracksByPreset = await Promise.all(presets.map(async (preset) => {
    const tracks = await Promise.all(preset.tracks.map(async (track) => {
      const clips = await Promise.all(track.clips.map(async (clip) => {
        if (!clip.src.startsWith("data:")) return { ...clip };
        const assetId = clip.assetId || `project-audio-${clip.id}`;
        const blob = await blobFromRuntimeSource(clip.src);
        await storeProjectAudioAsset(assetId, blob, clip.mime);
        changed = true;
        return { ...clip, assetId, sourceBytes: clip.sourceBytes ?? blob.size, src: URL.createObjectURL(blob) };
      }));
      return { ...track, clips };
    }));
    return { ...preset, tracks: tracks as ProjectAudioPreset["tracks"] };
  }));
  return { presets: tracksByPreset, changed };
}

export async function restoreProjectAudioRuntimeSources(presets: ProjectAudioPreset[]) {
  let restored = 0;
  let remoteFallbacks = 0;
  const next = await Promise.all(presets.map(async (preset) => {
    const tracks = await Promise.all(preset.tracks.map(async (track) => {
      const clips = await Promise.all(track.clips.map(async (clip) => {
        if (clip.src) return { ...clip };
        if (clip.assetId) {
          const asset = await loadProjectAudioAsset(clip.assetId).catch(() => null);
          if (asset?.blob) {
            restored += 1;
            return { ...clip, src: URL.createObjectURL(asset.blob), sourceBytes: clip.sourceBytes ?? asset.size, mime: clip.mime || asset.mime };
          }
        }
        if (clip.cloudSrc) {
          remoteFallbacks += 1;
          return { ...clip, src: clip.cloudSrc };
        }
        return { ...clip };
      }));
      return { ...track, clips };
    }));
    return { ...preset, tracks: tracks as ProjectAudioPreset["tracks"] };
  }));
  return { presets: next, restored, remoteFallbacks };
}

export async function projectAudioPresetsForPortableExport(presets: ProjectAudioPreset[]) {
  return await Promise.all(presets.map(async (preset) => {
    const tracks = await Promise.all(preset.tracks.map(async (track) => {
      const clips = await Promise.all(track.clips.map(async (clip) => {
        if (clip.src.startsWith("data:")) return { ...clip };
        if (!clip.assetId) return { ...clip };
        const asset = await loadProjectAudioAsset(clip.assetId).catch(() => null);
        if (asset?.blob) return { ...clip, src: await blobToDataUrl(asset.blob), sourceBytes: clip.sourceBytes ?? asset.size };
        if (clip.cloudSrc) {
          const response = await fetch(clip.cloudSrc, { cache: "no-store" });
          if (!response.ok) throw new Error(`O arquivo “${clip.name}” não pôde ser recuperado da nuvem.`);
          const blob = await response.blob();
          return { ...clip, src: await blobToDataUrl(blob), sourceBytes: clip.sourceBytes ?? blob.size, mime: clip.mime || blob.type || "audio/mpeg" };
        }
        throw new Error(`O arquivo “${clip.name}” não está mais disponível neste navegador. Importe a música novamente.`);
      }));
      return { ...track, clips };
    }));
    return { ...preset, tracks: tracks as ProjectAudioPreset["tracks"] };
  }));
}
