"use client";

import { benchmarkMemo } from "@/lib/benchmark/memo";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";
import { CORVOQUIZ_BACKGROUNDS } from "@/lib/background-presets";

export const EDITOR_COLORS = ["#F5F1E8", "#FFFFFF", "#FFD43B", "#FF6B5F", "#7C5CFC", "#276EF1", "#30C77B", "#13151A"] as const;

type PalettePanelProps = {
  mode: "background" | "shape";
  background: string;
  selectedFill?: string;
  shapeColor: string;
  backgroundVideo?: string;
  onApplyColor: (color: string) => void;
  onApplyBackgroundVideo: (source: string, fallbackColor: string) => void;
  onClose: () => void;
};

export const PalettePanel = benchmarkMemo(function PalettePanel({ mode, background, selectedFill, shapeColor, backgroundVideo, onApplyColor, onApplyBackgroundVideo, onClose }: PalettePanelProps) {
  return (
    <aside className="palette-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>{mode === "background" ? "BALDE" : "PREENCHIMENTO"}</small><strong>{mode === "background" ? "Cor do fundo" : "Cor da forma"}</strong></div><button onClick={onClose}>×</button></div>
      <div className="color-grid">
        {EDITOR_COLORS.map((color) => <button key={color} className="color-choice" style={{ background: color }} aria-label={`Usar cor ${color}`} onClick={() => onApplyColor(color)}><span /></button>)}
        <label className="custom-color"><input type="color" value={mode === "background" ? background : selectedFill ?? shapeColor} onChange={(event) => onApplyColor(event.target.value)} /><span>+</span></label>
      </div>
      {mode === "background" && <section className="background-presets" aria-label="Fundos animados CorvoQuiz">
        <header><strong>FUNDOS CORVOQUIZ</strong><span>Fundos animados</span></header>
        <div className="background-preset-grid">
          {CORVOQUIZ_BACKGROUNDS.map((preset) => <button key={preset.id} className={backgroundVideo === preset.src ? "active" : ""} onClick={() => onApplyBackgroundVideo(preset.src, preset.color)} aria-label={`Usar fundo animado ${preset.label}`}>
            <img src={preset.poster} alt="" />
            <span><i style={{ background: preset.color }} />{preset.label}</span>
            {backgroundVideo === preset.src && <b>✓</b>}
          </button>)}
        </div>
      </section>}
    </aside>
  );
});
