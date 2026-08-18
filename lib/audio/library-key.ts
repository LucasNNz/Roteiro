export const AUDIO_LIBRARY_KEY_HEADER = "x-forma-library-key";

// Identidade compartilhada simples da biblioteca do Forma.
// Não é tratada como segredo; serve para garantir que PC, celular e outros aparelhos
// apontem explicitamente para a mesma biblioteca de áudio.
export const SHARED_AUDIO_LIBRARY_KEY = "000";

export function normalizeAudioLibraryKey(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function isSharedAudioLibraryKey(value: string | null | undefined) {
  return normalizeAudioLibraryKey(value) === SHARED_AUDIO_LIBRARY_KEY;
}

export function audioLibraryRequestHeaders(extra: Record<string, string> = {}) {
  return {
    ...extra,
    [AUDIO_LIBRARY_KEY_HEADER]: SHARED_AUDIO_LIBRARY_KEY,
  };
}
