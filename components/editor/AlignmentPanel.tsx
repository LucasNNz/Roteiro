"use client";

import type { AlignmentAudit } from "@/app/types";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type AlignmentPanelProps = {
  audit: AlignmentAudit;
  label: string;
  onRepair: () => void;
  onRepairAll: () => void;
  onDistribute: () => void;
  onClose: () => void;
};

function sameAlignmentPanel(previous: Readonly<AlignmentPanelProps>, next: Readonly<AlignmentPanelProps>) {
  return previous.label === next.label && previous.audit.ok === next.audit.ok && previous.audit.score === next.audit.score && previous.audit.issues.length === next.audit.issues.length && previous.audit.issues.every((issue, index) => {
    const nextIssue = next.audit.issues[index];
    return issue.key === nextIssue.key && issue.label === nextIssue.label && issue.delta === nextIssue.delta;
  });
}

export const AlignmentPanel = benchmarkMemo(function AlignmentPanel({ audit, label, onRepair, onRepairAll, onDistribute, onClose }: AlignmentPanelProps) {
  return (
    <aside className="palette-sheet alignment-sheet" onClick={(event) => event.stopPropagation()}>
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>PRECISÃO DE COMPONENTE</small><strong>Alinhamento da alternativa {label}</strong></div><button onClick={onClose}>×</button></div>
      <div className={`alignment-score ${audit.ok ? "perfect" : "warning"}`}>
        <span className="score-ring" style={{ "--score": `${audit.score * 3.6}deg` } as React.CSSProperties}><b>{audit.score}</b><small>%</small></span>
        <span><strong>{audit.ok ? "Tudo no eixo" : `${audit.issues.length} pontos para corrigir`}</strong><small>{audit.ok ? "Círculo, letra e texto seguem o mesmo eixo visual." : "O Forma mede a ponta do cartão, o círculo e a letra separadamente."}</small></span>
      </div>
      <div className="alignment-schematic" aria-hidden="true"><span className="mini-card"><i className="mini-badge">{label}</i><b>ALTERNATIVA</b><em /></span></div>
      <div className="alignment-checks">
        {["Círculo na ponta do cartão", "Cor e escala da referência", "Letra no centro óptico", "Texto e margens no eixo"].map((item) => {
          const keys = item.startsWith("Círculo") ? ["badge-x", "badge-y"] : item.startsWith("Cor") ? ["badge-size", "badge-color"] : item.startsWith("Letra") ? ["letter-x", "letter-y"] : ["text-y", "text-gap", "text-right"];
          const broken = audit.issues.some((issue) => keys.includes(issue.key));
          return <span className={broken ? "check-warning" : "check-ok"} key={item}><i>{broken ? "!" : "✓"}</i><b>{item}</b></span>;
        })}
      </div>
      <div className="alignment-actions">
        <button className="primary" onClick={onRepair}><span>⌖</span><b>Corrigir esta alternativa</b><small>Círculo e letra no eixo</small></button>
        <button onClick={onRepairAll}><span>◎</span><b>Corrigir A / B / C</b><small>Mesma régua visual</small></button>
        <button onClick={onDistribute}><span>↕</span><b>Distribuir coluna</b><small>44 px entre cartões</small></button>
      </div>
      <p className="alignment-note"><i />A malha aparece apenas durante a correção e nunca será exportada.</p>
    </aside>
  );
}, sameAlignmentPanel);
