import type { AICommand, AIResult } from "../../../app/types.ts";

export function handlePlaybackUICommand(command: AICommand, ports: {
  animationDuration: number;
  playhead: number;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
  undo: () => void;
  redo: () => void;
  resetView: () => void;
  openScreen: (screen: string) => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  if (action === "set_duration") {
    const duration = Math.max(1, Math.min(60, number(command.duration ?? command.value, ports.animationDuration)));
    ports.pause(); ports.setDuration(duration); ports.seek(Math.min(ports.playhead, duration));
    return ports.report(action, `Duração da animação ajustada para ${duration}s.`);
  }
  if (action === "screen") {
    const screen = text(command.screen ?? command.value, "ai"); ports.openScreen(screen);
    return ports.report(action, screen === "none" ? "Painéis fechados." : `Tela ${screen} aberta.`);
  }
  if (action === "play") { ports.play(); return ports.report(action, "Animação reproduzindo."); }
  if (action === "pause") { ports.pause(); return ports.report(action, "Animação pausada."); }
  if (action === "seek") { ports.seek(number(command.time ?? command.value, 0)); return ports.report(action, `Tempo movido para ${number(command.time ?? command.value, 0).toFixed(1)}s.`); }
  if (action === "undo") { ports.undo(); return ports.report(action, "Última ação desfeita."); }
  if (action === "redo") { ports.redo(); return ports.report(action, "Ação refeita."); }
  if (action === "reset_view") { ports.resetView(); return ports.report(action, "Visualização centralizada em 100%."); }
  return null;
}
