"use client";

import type { Shape } from "@/app/types";
import { Icon } from "@/components/editor/Icon";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";
import { benchmarkMemo } from "@/lib/benchmark/memo";

export type VisualPatch = Partial<Pick<Shape, "brightness" | "contrast" | "saturation" | "hue" | "colorMatrix" | "imageScale" | "imageOffsetX" | "imageOffsetY" | "objectFit">>;

type AdjustmentsPanelProps = {
  selected: Shape;
  onUpdate: (patch: VisualPatch, save?: boolean) => void;
  onCommit: () => void;
  onReset: () => void;
  onRemoveImage: () => void;
  onChooseImage: () => void;
  onClose: () => void;
};

export const AdjustmentsPanel = benchmarkMemo(function AdjustmentsPanel({ selected, onUpdate, onCommit, onReset, onRemoveImage, onChooseImage, onClose }: AdjustmentsPanelProps) {
  return (
    <aside className="palette-sheet adjustments-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>IMAGEM E COR</small><strong>Ajustes rápidos</strong></div><button onClick={onClose}>×</button></div>

      {(selected.imageSrc || selected.type === "image") ? (
        <section className="media-fit-section">
          <div className="adjust-section-title"><span>ENCAIXE DA IMAGEM</span><small>{Math.round((selected.imageScale ?? 1) * 100)}%</small></div>
          <label className="adjust-row"><span><b>Zoom</b><small>Preenche a forma sem escapar</small></span><input type="range" min="100" max="300" step="1" value={Math.round((selected.imageScale ?? 1) * 100)} onChange={(event) => onUpdate({ imageScale: Number(event.target.value) / 100 })} onPointerUp={onCommit} onBlur={onCommit} /></label>
          <label className="adjust-row"><span><b>Horizontal</b><small>Mova para os lados</small></span><input type="range" min="-300" max="300" step="2" value={selected.imageOffsetX ?? 0} onChange={(event) => onUpdate({ imageOffsetX: Number(event.target.value) })} onPointerUp={onCommit} onBlur={onCommit} /></label>
          <label className="adjust-row"><span><b>Vertical</b><small>Mova para cima ou baixo</small></span><input type="range" min="-300" max="300" step="2" value={selected.imageOffsetY ?? 0} onChange={(event) => onUpdate({ imageOffsetY: Number(event.target.value) })} onPointerUp={onCommit} onBlur={onCommit} /></label>
          <div className="fit-actions">
            <button className={selected.objectFit !== "contain" ? "active" : ""} onClick={() => onUpdate({ objectFit: "cover" }, true)}>Preencher</button>
            <button className={selected.objectFit === "contain" ? "active" : ""} onClick={() => onUpdate({ objectFit: "contain" }, true)}>Conter</button>
            {(selected.type === "rect" || selected.type === "ellipse") && <button onClick={onRemoveImage}>Remover</button>}
          </div>
        </section>
      ) : (
        <button className="place-image-cta" onClick={onChooseImage}><Icon name="image" /><span><strong>Colocar imagem nesta forma</strong><small>Ela será recortada pelas bordas automaticamente</small></span><b>＋</b></button>
      )}

      <section className="visual-adjust-section">
        <div className="adjust-section-title"><span>LUZ E COR</span><button onClick={onReset}>Restaurar</button></div>
        {([
          ["Brilho", "0 deixa completamente preto", "brightness", 0, 200, selected.brightness ?? 100],
          ["Contraste", "Separa áreas claras e escuras", "contrast", 0, 200, selected.contrast ?? 100],
          ["Saturação", "Controla a intensidade das cores", "saturation", 0, 200, selected.saturation ?? 100],
          ["Matiz", "Gira a matriz de cores", "hue", -180, 180, selected.hue ?? 0],
        ] as const).map(([label, hint, key, min, max, value]) => (
          <label className="adjust-row" key={key}><span><b>{label}</b><small>{hint}</small></span><input type="range" min={min} max={max} step="1" value={value} onChange={(event) => onUpdate({ [key]: Number(event.target.value) })} onPointerUp={onCommit} onBlur={onCommit} /><em>{Math.round(value)}{key === "hue" ? "°" : "%"}</em></label>
        ))}
      </section>

      <section className="matrix-section">
        <div className="adjust-section-title"><span>MATRIZ DE COR</span><small>Presets rápidos</small></div>
        <div className="matrix-presets">
          <button className={!selected.colorMatrix ? "active" : ""} onClick={() => onUpdate({ colorMatrix: undefined }, true)}><i className="matrix-neutral" /><span>Original</span></button>
          <button onClick={() => onUpdate({ colorMatrix: [1.08,0,0,0,.02, 0,1,0,0,0, 0,0,.86,0,0, 0,0,0,1,0] }, true)}><i className="matrix-warm" /><span>Quente</span></button>
          <button onClick={() => onUpdate({ colorMatrix: [.86,0,0,0,0, 0,1,0,0,0, 0,0,1.12,0,.02, 0,0,0,1,0] }, true)}><i className="matrix-cool" /><span>Frio</span></button>
          <button onClick={() => onUpdate({ colorMatrix: [.2126,.7152,.0722,0,0, .2126,.7152,.0722,0,0, .2126,.7152,.0722,0,0, 0,0,0,1,0] }, true)}><i className="matrix-mono" /><span>Mono</span></button>
        </div>
      </section>
    </aside>
  );
});
