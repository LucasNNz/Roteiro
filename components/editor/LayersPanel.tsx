"use client";

import type { Shape } from "@/app/types";
import { Icon } from "@/components/editor/Icon";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { layerLabel } from "@/lib/layers/label";

type LayersPanelProps = {
  shapes: Shape[];
  selectedId: string | null;
  renamingId: string | null;
  renameValue: string;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onStartRename: (shape: Shape) => void;
  onRenameChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onClose: () => void;
};

function sameLayerPresentation(previous: Shape, next: Shape) {
  return previous.id === next.id && previous.type === next.type && previous.name === next.name && previous.visible === next.visible && previous.locked === next.locked && previous.fill === next.fill && previous.src === next.src && previous.imageSrc === next.imageSrc;
}

function sameLayersPanel(previous: Readonly<LayersPanelProps>, next: Readonly<LayersPanelProps>) {
  return previous.selectedId === next.selectedId && previous.renamingId === next.renamingId && previous.renameValue === next.renameValue && previous.shapes.length === next.shapes.length && previous.shapes.every((shape, index) => sameLayerPresentation(shape, next.shapes[index]));
}

export const LayersPanel = benchmarkMemo(function LayersPanel({ shapes, selectedId, renamingId, renameValue, onAdd, onSelect, onToggleVisibility, onToggleLock, onStartRename, onRenameChange, onFinishRename, onCancelRename, onDelete, onMove, onClose }: LayersPanelProps) {
  return (
    <aside className="palette-sheet layers-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>ORDEM VISUAL</small><strong>Camadas <em>{shapes.length}</em></strong></div><button onClick={onClose}>×</button></div>
      <button className="add-empty-layer" onClick={onAdd}><span>＋</span><span><strong>Adicionar camada vazia</strong><small>Pronta para receber uma forma ou imagem</small></span></button>
      <div className="layers-list">
        {[...shapes].reverse().map((shape, reverseIndex) => {
          const actualIndex = shapes.length - 1 - reverseIndex;
          return (
            <div key={shape.id} className={`layer-row ${selectedId === shape.id ? "selected" : ""} ${shape.visible === false ? "hidden-layer" : ""} ${shape.locked ? "locked-layer" : ""}`}>
              <button className="visibility-button" aria-label={shape.visible === false ? "Mostrar camada" : "Ocultar camada"} onClick={() => onToggleVisibility(shape.id)}>{shape.visible === false ? "○" : "◉"}</button>
              <div className="layer-main" role="button" tabIndex={0} onClick={() => { if (!shape.locked) onSelect(shape.id); }}>
                <span className={`layer-thumb ${shape.type}`} style={shape.type === "image" || shape.imageSrc ? { backgroundImage: `url(${shape.type === "image" ? shape.src : shape.imageSrc})` } : { background: shape.fill }} />
                <span>{renamingId === shape.id ? <input autoFocus value={renameValue} maxLength={40} onClick={(event) => event.stopPropagation()} onChange={(event) => onRenameChange(event.target.value)} onBlur={onFinishRename} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") onCancelRename(); }} /> : <strong>{layerLabel(shape)}</strong>}<small>{shape.type === "image" ? "Imagem substituível" : shape.type === "text" ? "Texto" : shape.type === "brush" ? "Cor editável" : shape.type === "empty" ? "Vazia" : "Forma"}{shape.locked ? " · Bloqueada" : ""}</small></span>
              </div>
              <div className="layer-order layer-actions">
                <button className={`lock-layer ${shape.locked ? "active" : ""}`} aria-label={shape.locked ? "Desbloquear camada" : "Bloquear camada"} onClick={() => onToggleLock(shape.id)}>{shape.locked ? "🔒" : "🔓"}</button>
                <button disabled={shape.locked} aria-label="Renomear camada" onClick={() => onStartRename(shape)}>✎</button>
                <button disabled={shape.locked} className="delete-layer" aria-label="Excluir camada" onClick={() => onDelete(shape.id)}>×</button>
                <button disabled={shape.locked || actualIndex === shapes.length - 1} aria-label="Subir camada" onClick={() => onMove(shape.id, "up")}>↑</button>
                <button disabled={shape.locked || actualIndex === 0} aria-label="Descer camada" onClick={() => onMove(shape.id, "down")}>↓</button>
              </div>
            </div>
          );
        })}
        {!shapes.length && <div className="empty-layers"><Icon name="layers" /><strong>Nenhuma camada ainda</strong><span>Adicione uma forma ou imagem.</span></div>}
      </div>
    </aside>
  );
}, sameLayersPanel);
