import { CORVOQUIZ_BACKGROUNDS, type BackgroundPreset } from "../background-presets.ts";

export type BatchBackgroundMode = "round_robin";
export type ResolvedBatchBackground = {
  preset: BackgroundPreset;
  backgroundPresetId: string;
  backgroundVariant: string;
};

export const BATCH_BACKGROUND_PRESETS = CORVOQUIZ_BACKGROUNDS.filter((preset) => !preset.id.startsWith("resultado-"));

export function backgroundMetadataForPreset(preset: BackgroundPreset) {
  return {
    backgroundPresetId: `preset_bg_${preset.id}`,
    backgroundVariant: preset.label.toLocaleUpperCase("pt-BR"),
  };
}

export function resolveBackgroundForQuestion(
  questionIndex: number,
  availableBackgrounds: BackgroundPreset[] = BATCH_BACKGROUND_PRESETS,
  mode: BatchBackgroundMode = "round_robin",
): ResolvedBatchBackground {
  if (!availableBackgrounds.length) throw new Error("Nenhum fundo de preset está disponível para o lote.");
  if (mode !== "round_robin") throw new Error(`Modo de distribuição de fundos não suportado: ${mode}.`);
  const normalizedIndex = Math.max(1, Math.floor(Number(questionIndex) || 1));
  const preset = availableBackgrounds[(normalizedIndex - 1) % availableBackgrounds.length];
  return { preset, ...backgroundMetadataForPreset(preset) };
}
