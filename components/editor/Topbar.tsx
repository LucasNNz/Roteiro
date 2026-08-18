import { Icon } from "@/components/editor/Icon";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type TopbarProps = {
  projectName: string;
  canUndo: boolean;
  canRedo: boolean;
  onOpenProjects: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleExport: () => void;
};

export const Topbar = benchmarkMemo(function Topbar({ projectName, canUndo, canRedo, onOpenProjects, onUndo, onRedo, onToggleExport }: TopbarProps) {
  return (
    <header className="topbar">
      <button className="brand project-trigger" aria-label="Abrir projetos" onClick={onOpenProjects}><span className="brand-mark"><i /><i /></span><span><b>Forma</b><small>{projectName}</small></span></button>
      <div className="history-controls">
        <button aria-label="Desfazer" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
        <button aria-label="Refazer" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
      </div>
      <button className="export-button" onClick={onToggleExport}><Icon name="export" /><span>Exportar</span></button>
    </header>
  );
});
