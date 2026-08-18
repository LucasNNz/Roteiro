import type { AICommand, AIResult, SceneAudioClip, SceneAudioPreset, SceneKind, SceneStingerRole, SceneStingerSettings } from "../../../app/types.ts";
import { clampAudioStart } from "../../audio/scenes.ts";
import { normalizeSceneStingerSettings, SCENE_STINGER_PRESETS } from "../../audio/stingers.ts";

type AudioCommandPorts = {
  presets: SceneAudioPreset[];
  activePresetId?: string;
  selectedClipId?: string;
  activeSceneKind: SceneKind;
  sceneDuration: number;
  playhead: number;
  createPreset: (name?: string) => SceneAudioPreset | null;
  applyPreset: (id: string, applyToKind: boolean) => void;
  updatePreset: (preset: SceneAudioPreset) => void;
  splitClip: (presetId: string, clipId: string, time: number) => { ok: boolean; message: string };
  openAudio: () => void;
  sceneStingers?: SceneStingerSettings;
  updateSceneStingers?: (settings: SceneStingerSettings) => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
};

const clamp = (value: unknown, min: number, max: number, fallback = min) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : Math.max(min, Math.min(max, fallback));
};

export function handleAudioCommand(command: AICommand, ports: AudioCommandPorts): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const findPreset = () => {
    const query = String(command.presetId ?? command.preset ?? command.id ?? ports.activePresetId ?? "").trim().toLocaleLowerCase("pt-BR");
    return ports.presets.find((preset) => preset.id.toLocaleLowerCase("pt-BR") === query || preset.name.toLocaleLowerCase("pt-BR") === query) ?? null;
  };
  if (action === "open_scene_audio" || action === "open_audio") {
    ports.openAudio();
    return ports.report(action, "Painel de áudio da cena aberto.", true, null);
  }
  if (action === "list_audio_presets") {
    ports.openAudio();
    const names = ports.presets.filter((preset) => preset.sceneKind === ports.activeSceneKind).map((preset) => preset.name).join(" · ");
    return ports.report(action, names || "Nenhum preset de áudio compatível com esta cena.", true, null);
  }
  if (action === "list_scene_stingers") {
    const starts = SCENE_STINGER_PRESETS.filter((preset) => preset.role === "main").map((preset) => preset.name).join(" · ");
    const results = SCENE_STINGER_PRESETS.filter((preset) => preset.role === "result").map((preset) => preset.name).join(" · ");
    return ports.report(action, `Início: ${starts}. Resultado: ${results}.`, true, null);
  }
  if (action === "configure_scene_stingers" || action === "set_random_scene_audio") {
    if (!ports.sceneStingers || !ports.updateSceneStingers) return ports.report(action, "Sons automáticos não estão disponíveis.", false, null);
    const rawRole = String(command.role ?? command.kind ?? command.sceneKind ?? "main").toLocaleLowerCase("pt-BR");
    const role: SceneStingerRole = ["result", "resultado", "resultados"].includes(rawRole) ? "result" : "main";
    const current = ports.sceneStingers[role];
    const rawChance = Number(command.probability ?? command.chance ?? command.frequency);
    const probability = Number.isFinite(rawChance) ? clamp(rawChance > 1 ? rawChance / 100 : rawChance, 0, 1, current.probability) : current.probability;
    const requestedIds = Array.isArray(command.presetIds ?? command.presets) ? (command.presetIds ?? command.presets) as unknown[] : null;
    const presetIds = requestedIds ? requestedIds.map(String).filter((id) => SCENE_STINGER_PRESETS.some((preset) => preset.id === id && preset.role === role)) : current.presetIds;
    const next = normalizeSceneStingerSettings({ ...ports.sceneStingers, [role]: { ...current, enabled: command.enabled === undefined ? current.enabled : Boolean(command.enabled), volume: clamp(command.volume, 0, 1, current.volume), probability, presetIds } });
    ports.updateSceneStingers(next);
    return ports.report(action, `Sons de ${role === "main" ? "início" : "resultado"} configurados: ${Math.round(probability * 100)}% de chance e ${Math.round(next[role].volume * 100)}% de volume.`, true, null);
  }
  if (action === "create_audio_preset") {
    const preset = ports.createPreset(typeof command.name === "string" ? command.name : undefined);
    return preset ? ports.report(action, `${preset.name} criado com três faixas.`, true, null) : ports.report(action, "Não há uma cena ativa.", false, null);
  }
  if (action === "apply_audio_preset") {
    const preset = findPreset();
    if (!preset || preset.sceneKind !== ports.activeSceneKind) return ports.report(action, "Preset de áudio compatível não encontrado.", false, null);
    ports.applyPreset(preset.id, String(command.scope ?? "scene") === "kind");
    return ports.report(action, `${preset.name} aplicado${String(command.scope ?? "scene") === "kind" ? " a todas as cenas deste tipo" : " à cena ativa"}.`, true, null);
  }
  const preset = findPreset();
  if (!["set_audio_preset_volume", "set_audio_clip_volume", "move_audio_clip", "split_audio_clip", "set_audio_clip_fades", "toggle_audio_clip_loop", "remove_audio_clip"].includes(action)) return null;
  if (!preset) return ports.report(action, "Preset de áudio não encontrado.", false, null);
  if (preset.sceneKind !== ports.activeSceneKind) return ports.report(action, "Este preset pertence a outro tipo de cena.", false, null);
  if (action === "set_audio_preset_volume") {
    ports.updatePreset({ ...preset, masterVolume: clamp(command.volume ?? command.value, 0, 1, preset.masterVolume) });
    return ports.report(action, `Volume geral de ${preset.name} atualizado.`, true, null);
  }
  const query = String(command.clipId ?? command.clip ?? command.name ?? ports.selectedClipId ?? "").trim().toLocaleLowerCase("pt-BR");
  const found: SceneAudioClip | undefined = preset.tracks.flatMap((track) => track.clips).find((clip) => clip.id.toLocaleLowerCase("pt-BR") === query || clip.name.toLocaleLowerCase("pt-BR") === query);
  if (!found) return ports.report(action, "Item de áudio não encontrado.", false, null);
  if (action === "split_audio_clip") {
    const result = ports.splitClip(preset.id, found.id, clamp(command.time ?? command.at ?? command.value, 0, ports.sceneDuration, ports.playhead));
    return ports.report(action, result.message, result.ok, null);
  }
  const tracks = preset.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => {
    if (clip.id !== found.id) return clip;
    if (action === "set_audio_clip_volume") return { ...clip, volume: clamp(command.volume ?? command.value, 0, 1, clip.volume) };
    if (action === "move_audio_clip") return { ...clip, start: clampAudioStart(clamp(command.start ?? command.time ?? command.value, 0, 3600, clip.start), ports.sceneDuration) };
    if (action === "set_audio_clip_fades") return { ...clip, fadeIn: clamp(command.fadeIn, 0, clip.duration, clip.fadeIn ?? 0), fadeOut: clamp(command.fadeOut, 0, clip.duration, clip.fadeOut ?? 0) };
    if (action === "toggle_audio_clip_loop") return { ...clip, loop: command.loop === undefined ? !clip.loop : Boolean(command.loop) };
    return clip;
  }).filter((clip) => action !== "remove_audio_clip" || clip.id !== found.id) }));
  ports.updatePreset({ ...preset, tracks });
  return ports.report(action, `${found.name} atualizado.`, true, null);
}
