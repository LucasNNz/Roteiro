import type { Shape } from "@/app/types";
import { Icon } from "@/components/editor/Icon";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type ObjectBarProps = {
  selected: Shape;
  timelineOpen: boolean;
  recording: boolean;
  answerGroupSelected: boolean;
  alignmentOkay: boolean;
  onToggleKeyframes: () => void;
  onOpenAlignment: () => void;
  onEditText: () => void;
  onChooseImage: () => void;
  onOpenAdjustments: () => void;
  onOpenColor: () => void;
  onOpenOutline: () => void;
  onOpenLayers: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
};

export const ObjectBar = benchmarkMemo(function ObjectBar({ selected, timelineOpen, recording, answerGroupSelected, alignmentOkay, onToggleKeyframes, onOpenAlignment, onEditText, onChooseImage, onOpenAdjustments, onOpenColor, onOpenOutline, onOpenLayers, onDuplicate, onRemove }: ObjectBarProps) {
  const mediaLabel = selected.type === "image" ? (selected.name === "Progresso · ícone" ? "Trocar ícone" : "Trocar imagem") : selected.imageSrc ? "Trocar imagem" : "Imagem interna";
  return (
    <div className={`object-bar ${timelineOpen ? "timeline-visible" : ""}`}>
      {selected.type !== "empty" && <><button className={recording ? "recording-action" : "keyframe-action"} onClick={onToggleKeyframes}><span className="keyframe-symbol">◆</span>{recording ? "Parar keyframes" : "Keyframes"}</button><span className="object-separator" /></>}
      {answerGroupSelected && <><button className={`alignment-action ${alignmentOkay ? "aligned" : "needs-fix"}`} onClick={onOpenAlignment}><span className="alignment-symbol">⌖</span>Alinhar<i /></button><span className="object-separator" /></>}
      {selected.type === "text" && <><button onClick={onEditText}><Icon name="text" />Editar</button><span className="object-separator" /></>}
      {(selected.type === "rect" || selected.type === "ellipse" || selected.type === "image") && <><button onClick={onChooseImage}><Icon name="image" />{mediaLabel}</button><span className="object-separator" /></>}
      {(selected.type === "rect" || selected.type === "ellipse" || selected.type === "image") && <><button onClick={onOpenAdjustments}><span className="adjust-icon">☼</span>Ajustes</button><span className="object-separator" /></>}
      {(selected.type === "rect" || selected.type === "ellipse" || selected.type === "text" || selected.type === "brush") && <><button onClick={onOpenColor}><span className="color-dot" style={{ background: selected.fill }} />Cor</button><span className="object-separator" /><button onClick={onOpenOutline}><Icon name="stroke" />Contorno</button><span className="object-separator" /></>}
      <button onClick={onOpenLayers}><Icon name="layers" />Camadas</button>
      <span className="object-separator" />
      <button onClick={onDuplicate}><Icon name="copy" />Duplicar</button>
      <span className="object-separator" />
      <button className="danger-action" onClick={onRemove}><Icon name="trash" />Apagar</button>
    </div>
  );
});
