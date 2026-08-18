"use client";

import type { AIArtifact } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type ExportPanelProps = {
  artifact: AIArtifact | null;
  progress: number | null;
  message: string;
  diagnosticActive: boolean;
  exportDiagnosticActive: boolean;
  width: number;
  height: number;
  sceneCount: number;
  projectDuration: number;
  hasSceneAudio: boolean;
  onPreparePng: () => void;
  onExportMp4: () => void;
  onExportProjectMp4: () => void;
  onPrepareMp4: () => void;
  onExportZip: () => void;
  onDiagnostic: () => void;
  onExportDiagnostic: () => void;
  onDownloadProject: () => void;
  onExportPng: (scale: number) => void;
  onExportSvg: () => void;
};

export const ExportPanel = benchmarkMemo(function ExportPanel({ artifact, progress, message, diagnosticActive, exportDiagnosticActive, width, height, sceneCount, projectDuration, hasSceneAudio, onPreparePng, onExportMp4, onExportProjectMp4, onPrepareMp4, onExportZip, onDiagnostic, onExportDiagnostic, onDownloadProject, onExportPng, onExportSvg }: ExportPanelProps) {
  return (
    <aside className="export-menu">
      <small>EXPORTAR E ENTREGAR</small>
      <button className="ai-export-option" onClick={onPreparePng}><span><strong><i>✦</i> Preparar para a IA</strong><em>Cria uma entrega recuperável</em></span><b>→</b></button>
      {artifact && <div className="ai-export-ready"><span><i>✓</i><strong>Disponível para a IA</strong></span><em>{artifact.name}{artifact.width ? ` · ${artifact.width} × ${artifact.height}` : ""}</em><a href={artifact.downloadUrl} download={artifact.name}>Baixar arquivo preparado</a></div>}
      {progress !== null && <div className="export-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{message}</small></div>}
      {progress === null && message && <p className="export-message">{message}</p>}
      <button className="video-export project-video-export" onClick={onExportProjectMp4}><span><strong>Projeto inteiro · MP4 1080p · 30 FPS</strong><em>{sceneCount} {sceneCount === 1 ? "cena" : "cenas"} · {projectDuration.toFixed(1)}s · vídeo e áudio contínuos</em></span><b>▶</b></button>
      <button className="video-export scene-video-export" onClick={onExportMp4}><span><strong>Cena atual · MP4 1080p · 30 FPS</strong><em>{hasSceneAudio ? "Animação + áudio da cena · H.264/AAC" : "Animação da cena · H.264"}</em></span><b>▷</b></button>
      <button onClick={onPrepareMp4}><span><strong>MP4 para a IA</strong><em>Prepara para trazer ao chat</em></span><b>✦</b></button>
      <button onClick={onExportZip}><span><strong>ZIP para o chat</strong><em>Projeto + prévia + manifesto</em></span><b>✦</b></button>
      <button className="export-bottleneck-diagnostic" disabled={exportDiagnosticActive || diagnosticActive} onClick={onExportDiagnostic}><span><strong>{exportDiagnosticActive ? "Medindo a exportação…" : "Exportar diagnóstico da exportação"}</strong><em>Executa o MP4 real e baixa um ZIP com gargalos, encoder, áudio e cenas</em></span><b>⌁</b></button>
      <button className="diagnostic-export" disabled={diagnosticActive || exportDiagnosticActive} onClick={onDiagnostic}><span><strong>{diagnosticActive ? "Medindo o canvas…" : "Gravar diagnóstico do canvas"}</strong><em>FPS de reprodução + frames + keyframes + projeto</em></span><b>●</b></button>
      <button onClick={onDownloadProject}><span><strong>Projeto editável</strong><em>Arquivo .forma.json</em></span><b>→</b></button>
      <button onClick={() => onExportPng(1)}><span><strong>PNG original</strong><em>{width} × {height}</em></span><b>→</b></button>
      <button onClick={() => onExportPng(2)}><span><strong>PNG alta resolução</strong><em>{width * 2} × {height * 2}</em></span><b>→</b></button>
      <button onClick={onExportSvg}><span><strong>SVG vetorial</strong><em>Qualidade ilimitada</em></span><b>→</b></button>
    </aside>
  );
});
