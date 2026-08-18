import type { CloudAudioLibrary, AudioLibraryState } from "./cloud-library.ts";
import { createCloudAudioLibrary, parseCloudAudioLibrary } from "./cloud-library.ts";
import { compactProjectAudioPresetsForStorage } from "./local-project-assets.ts";

const DB_NAME = "forma-audio-library-state-v1";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const PRIMARY_KEY = "primary";

type StoredSnapshot = {
  id: string;
  library: CloudAudioLibrary;
  updatedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Este navegador não oferece armazenamento persistente para fixar a biblioteca de áudio."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    }, { once: true });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Não foi possível abrir a cópia fixa da biblioteca de áudio.")), { once: true });
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? transaction.error ?? new Error("Falha ao acessar a cópia fixa da biblioteca.")), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("A gravação da cópia fixa foi interrompida.")), { once: true });
    });
  } finally {
    db.close();
  }
}

export function createFixedAudioLibrary(state: AudioLibraryState, updatedAt = new Date().toISOString()): CloudAudioLibrary {
  return createCloudAudioLibrary({
    ...state,
    projectPresets: compactProjectAudioPresetsForStorage(state.projectPresets),
  }, updatedAt);
}

export async function saveFixedAudioLibrary(state: AudioLibraryState, updatedAt = new Date().toISOString()) {
  const library = createFixedAudioLibrary(state, updatedAt);
  const record: StoredSnapshot = { id: PRIMARY_KEY, library, updatedAt: library.updatedAt };
  await withStore("readwrite", (store) => store.put(record));
  return library;
}

export async function loadFixedAudioLibrary(): Promise<CloudAudioLibrary | null> {
  const record = await withStore<StoredSnapshot | undefined>("readonly", (store) => store.get(PRIMARY_KEY));
  return parseCloudAudioLibrary(record?.library) ?? null;
}
