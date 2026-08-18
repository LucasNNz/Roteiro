"use client";

import type { Shape } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";

export type TextPatch = Partial<Pick<Shape, "text" | "fontSize" | "fontWeight">>;

type TextPanelProps = {
  selected: Shape;
  onUpdate: (patch: TextPatch, save?: boolean) => void;
  onCommit: () => void;
  onClose: () => void;
};

export const TextPanel = benchmarkMemo(function TextPanel({ selected, onUpdate, onCommit, onClose }: TextPanelProps) {
  return (
    <aside className="palette-sheet text-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>MONTSERRAT</small><strong>Editar texto</strong></div><button onClick={onClose}>×</button></div>
      <input className="text-input" autoFocus value={selected.text ?? ""} maxLength={80} placeholder="Digite seu texto" onChange={(event) => onUpdate({ text: event.target.value }, false)} onBlur={onCommit} />
      <small className="color-label">TAMANHO</small>
      <div className="text-options size-options">
        {[72, 120, 180, 260].map((size) => <button key={size} className={Math.round(selected.fontSize ?? 120) === size ? "active" : ""} onClick={() => onUpdate({ fontSize: size })}>{size}</button>)}
      </div>
      <small className="color-label">PESO</small>
      <div className="text-options weight-buttons">
        {([["Regular", 400], ["Negrito", 700], ["Extra", 900]] as const).map(([label, weight]) => <button key={weight} className={(selected.fontWeight ?? 700) === weight ? "active" : ""} style={{ fontWeight: weight }} onClick={() => onUpdate({ fontWeight: weight })}>{label}</button>)}
      </div>
    </aside>
  );
});
