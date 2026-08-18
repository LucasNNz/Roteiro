"use client";

import type { SavedProject } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { FloatingPanelGrabber } from "@/components/editor/FloatingPanelGrabber";

type ProjectsPanelProps = {
  projectName: string;
  currentProjectId: string | null;
  projects: SavedProject[];
  onNameChange: (name: string) => void;
  onNew: () => void;
  onSave: () => void;
  onChooseFile: () => void;
  onOpen: (project: SavedProject) => void;
  onDelete: (id: string) => void;
  onDownload: () => void;
  onDownloadZip: () => void;
  onClose: () => void;
};

export const ProjectsPanel = benchmarkMemo(function ProjectsPanel({ projectName, currentProjectId, projects, onNameChange, onNew, onSave, onChooseFile, onOpen, onDelete, onDownload, onDownloadZip, onClose }: ProjectsPanelProps) {
  return (
    <aside className="palette-sheet project-sheet" aria-label="Projetos do Forma">
      <FloatingPanelGrabber />
      <div className="sheet-title"><div><small>ARQUIVOS DO FORMA</small><strong>Projetos</strong></div><button aria-label="Fechar projetos" onClick={onClose}>×</button></div>
      <label className="project-name-label">NOME DO PROJETO<input value={projectName} maxLength={64} onChange={(event) => onNameChange(event.target.value)} placeholder="Projeto sem título" /></label>
      <div className="project-primary-actions">
        <button onClick={onNew}><i>＋</i><span><strong>Novo projeto</strong><small>Canvas limpo</small></span></button>
        <button className="primary" onClick={onSave}><i>✓</i><span><strong>Salvar</strong><small>Neste aparelho + IA</small></span></button>
        <button onClick={onChooseFile}><i>↥</i><span><strong>Abrir arquivo</strong><small>.forma.json</small></span></button>
      </div>
      <div className="project-section-title"><span>BIBLIOTECA NESTE APARELHO</span><small>{projects.length} salvo(s)</small></div>
      <div className="project-list">
        {projects.map((project) => <div className={`project-row ${project.id === currentProjectId ? "active" : ""}`} key={project.id}><button className="project-open" onClick={() => onOpen(project)}><i>▱</i><span><strong>{project.name}</strong><small>{new Date(project.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span></button><button className="project-delete" aria-label={`Excluir projeto ${project.name}`} onClick={() => onDelete(project.id)}>×</button></div>)}
        {!projects.length && <div className="project-empty"><span>▱</span><strong>Nenhum projeto salvo</strong><small>Salve o canvas atual para ele aparecer aqui.</small></div>}
      </div>
      <div className="project-portable-actions"><button onClick={onDownload}>Baixar projeto</button><button onClick={onDownloadZip}>Baixar pacote ZIP</button></div>
    </aside>
  );
});
