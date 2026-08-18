"use client";

import type { CanvasPreset } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";

export const CANVAS_FORMATS: Record<CanvasPreset, { width: number; height: number; ratio: string; title: string; subtitle: string }> = {
  square: { width: 1080, height: 1080, ratio: "1:1", title: "Quadrado", subtitle: "Posts e elementos" },
  landscape: { width: 1920, height: 1080, ratio: "16:9", title: "Horizontal", subtitle: "YouTube e telas" },
  portrait: { width: 1080, height: 1920, ratio: "9:16", title: "Vertical", subtitle: "Shorts e Stories" },
};

type FormatPanelProps = {
  format: CanvasPreset;
  onChange: (format: CanvasPreset) => void;
  onClose: () => void;
};

export const FormatPanel = benchmarkMemo(function FormatPanel({ format, onChange, onClose }: FormatPanelProps) {
  return (
    <aside className="palette-sheet format-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>PROPORÇÃO</small><strong>Formato do canvas</strong></div><button onClick={onClose}>×</button></div>
      <div className="format-options">
        {(Object.entries(CANVAS_FORMATS) as [CanvasPreset, (typeof CANVAS_FORMATS)[CanvasPreset]][]).map(([key, item]) => (
          <button key={key} className={format === key ? "active" : ""} onClick={() => onChange(key)}>
            <span className={`format-preview ${key}`}><i /></span>
            <span><strong>{item.ratio} · {item.title}</strong><em>{item.width} × {item.height}</em><small>{item.subtitle}</small></span>
            <b>{format === key ? "✓" : "→"}</b>
          </button>
        ))}
      </div>
    </aside>
  );
});
