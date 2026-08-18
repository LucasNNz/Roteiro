import type { Snapshot } from "../../app/types.ts";
import { cloneShapes } from "../geometry.ts";

export const HISTORY_LIMIT = 40;
export type HistoryState = { entries: Snapshot[]; index: number };

export function createSnapshot(snapshot: Snapshot): Snapshot {
  return { shapes: cloneShapes(snapshot.shapes), background: snapshot.background, backgroundVideo: snapshot.backgroundVideo, format: snapshot.format ?? "square" };
}

export function createHistory(snapshot: Snapshot): HistoryState {
  return { entries: [createSnapshot(snapshot)], index: 0 };
}

export function historyStatus(history: HistoryState) {
  return { canUndo: history.index > 0, canRedo: history.index < history.entries.length - 1 };
}

export function commitHistory(history: HistoryState, snapshot: Snapshot, limit = HISTORY_LIMIT): HistoryState {
  const entries = [...history.entries.slice(0, history.index + 1), createSnapshot(snapshot)].slice(-limit);
  return { entries, index: entries.length - 1 };
}

export function restoreHistory(history: HistoryState, index: number) {
  if (index < 0 || index >= history.entries.length) return null;
  const next = { entries: history.entries, index };
  return { history: next, snapshot: createSnapshot(history.entries[index]), ...historyStatus(next) };
}

export function moveHistory(history: HistoryState, direction: "undo" | "redo") {
  return restoreHistory(history, history.index + (direction === "undo" ? -1 : 1));
}
