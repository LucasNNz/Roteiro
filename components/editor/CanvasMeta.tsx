import type { SceneKind } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type CanvasMetaProps = {
  width: number;
  height: number;
  zoom: number;
  layerCount: number;
  sceneCount: number;
  activeSceneName: string;
  activeSceneKind: SceneKind;
  scenesOpen: boolean;
  onOpenFormat: () => void;
  onResetZoom: () => void;
  onToggleScenes: () => void;
};

export const CanvasMeta = benchmarkMemo(function CanvasMeta({ width, height, zoom, layerCount, sceneCount, activeSceneName, activeSceneKind, scenesOpen, onOpenFormat, onResetZoom, onToggleScenes }: CanvasMetaProps) {
  return (
    <div className="canvas-meta">
      <button className="format-trigger" onClick={onOpenFormat}>{width} × {height} <b>⌄</b></button>
      <button onClick={onResetZoom}>{Math.round(zoom * 100)}%</button>
      <button className={`scenes-trigger ${activeSceneKind}${scenesOpen ? " open" : ""}`} aria-expanded={scenesOpen} aria-label={`Abrir cenas. Cena ativa: ${activeSceneName}`} onClick={onToggleScenes}>
        <i><span /><span /></i>
        <span><strong>Cenas</strong><small>{activeSceneName}</small></span>
        <b>{sceneCount}</b>
      </button>
      <span>{layerCount} {layerCount === 1 ? "camada" : "camadas"}</span>
    </div>
  );
});
