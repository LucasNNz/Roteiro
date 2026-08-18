"use client";

import type { Shape } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";
import { EDITOR_COLORS } from "@/components/editor/PalettePanel";

type OutlinePanelProps = {
  selected: Shape;
  onUpdate: (stroke: string, strokeWidth: number) => void;
  onClose: () => void;
};

export const OutlinePanel = benchmarkMemo(function OutlinePanel({ selected, onUpdate, onClose }: OutlinePanelProps) {
  const fallbackWidth = selected.type === "text" ? 5 : 16;
  return (
    <aside className="palette-sheet outline-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>ACABAMENTO</small><strong>Contorno</strong></div><button onClick={onClose}>×</button></div>
      <div className="weight-options">
        {(selected.type === "text" ? [["Sem", 0], ["Fino", 2], ["Médio", 5], ["Forte", 9]] : [["Sem", 0], ["Fino", 8], ["Médio", 16], ["Forte", 28]]).map(([label, width]) => (
          <button key={label} className={(selected.strokeWidth ?? 0) === width ? "active" : ""} onClick={() => onUpdate(selected.stroke ?? "#13151A", width as number)}><span style={{ borderWidth: Math.max(1, Number(width) / 4) }} />{label}</button>
        ))}
      </div>
      <small className="color-label">COR DO CONTORNO</small>
      <div className="color-grid compact-colors">
        {EDITOR_COLORS.map((color) => <button key={color} className="color-choice" style={{ background: color }} aria-label={`Usar contorno ${color}`} onClick={() => onUpdate(color, selected.strokeWidth || fallbackWidth)}><span /></button>)}
        <label className="custom-color"><input type="color" value={selected.stroke ?? "#13151A"} onChange={(event) => onUpdate(event.target.value, selected.strokeWidth || fallbackWidth)} /><span>+</span></label>
      </div>
    </aside>
  );
});
