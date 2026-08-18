import type { AIArtifact, AICommand, AIResult, SavedProject } from "../../../app/types.ts";

export async function handleProjectExportCommand(command: AICommand, ports: {
  newProject: () => void;
  saveCurrentProject: (download: boolean, name?: string) => Promise<AIArtifact>;
  savedProjects: SavedProject[];
  openProject: (project: SavedProject) => void;
  exportProjectZip: (download: boolean) => Promise<AIArtifact>;
  captureDiagnostic: (download: boolean) => Promise<AIArtifact>;
  exportSvg: () => Promise<unknown>;
  exportMp4: (prepareForAI: boolean) => Promise<unknown>;
  exportPng: (scale: number) => Promise<unknown>;
  getExportMessage: () => string;
  prepareExport: (options: { kind: "png" | "svg" | "mp4" | "project" | "zip" | "diagnostic"; scale: number }) => Promise<AIArtifact>;
  artifact: AIArtifact | null;
  downloadArtifact: () => Promise<void>;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
}): Promise<AIResult | null> {
  const action = String(command.action ?? "").trim().toLowerCase();
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  if (action === "new_project") { ports.newProject(); return ports.report(action, "Novo projeto criado.", true, null); }
  if (action === "save_project") {
    const artifact = await ports.saveCurrentProject(command.download === true, typeof command.name === "string" ? command.name : undefined);
    return ports.report(action, `${artifact.name} salvo e exposto para a IA.`);
  }
  if (action === "list_projects") return ports.report(action, `${ports.savedProjects.length} projeto(s) disponível(is): ${ports.savedProjects.map((project) => project.name).join(", ") || "nenhum"}.`);
  if (action === "open_project") {
    const query = text(command.id ?? command.name ?? command.target).toLocaleLowerCase("pt-BR");
    const project = ports.savedProjects.find((item) => item.id === query || item.name.toLocaleLowerCase("pt-BR") === query);
    if (!project) return ports.report(action, "Projeto não encontrado.", false);
    ports.openProject(project);
    return ports.report(action, `Projeto ${project.name} aberto.`, true, null);
  }
  if (action === "export_project") {
    const artifact = await ports.saveCurrentProject(command.download === true);
    return ports.report(action, `${artifact.name} pronto para recuperar no chat.`);
  }
  if (action === "export_project_zip") {
    const artifact = await ports.exportProjectZip(command.download === true);
    return ports.report(action, `${artifact.name} pronto para recuperar e anexar no chat.`);
  }
  if (action === "capture_diagnostic") {
    try { const artifact = await ports.captureDiagnostic(command.download === true); return ports.report(action, `${artifact.name} contém frames, projeto, keyframes e relatório de desempenho.`); }
    catch { return ports.report(action, "Não foi possível concluir o diagnóstico do canvas.", false); }
  }
  if (action === "export") {
    const kind = text(command.kind, "png");
    try { if (kind === "svg") await ports.exportSvg(); else if (kind === "mp4") await ports.exportMp4(false); else await ports.exportPng(number(command.scale, 2)); }
    catch { return ports.report(action, ports.getExportMessage() || `Não foi possível exportar ${kind.toUpperCase()} neste navegador.`, false); }
    return ports.report(action, `Exportação ${kind.toUpperCase()} iniciada.`);
  }
  if (action === "export_to_ai") {
    try {
      const requested = text(command.kind, "png");
      const kind = (["svg", "mp4", "project", "zip", "diagnostic"].includes(requested) ? requested : "png") as "png" | "svg" | "mp4" | "project" | "zip" | "diagnostic";
      const artifact = await ports.prepareExport({ kind, scale: number(command.scale, 1) });
      return ports.report(action, `${artifact.name} está pronto para a IA recuperar e anexar no chat.`);
    } catch { return ports.report(action, "Não foi possível preparar o arquivo para a IA.", false); }
  }
  if (action === "get_artifact") return ports.report(action, ports.artifact ? `${ports.artifact.name} disponível em FormaAI.getArtifact().` : "Nenhum arquivo foi preparado ainda.", Boolean(ports.artifact));
  if (action === "download_artifact") { await ports.downloadArtifact(); return ports.report(action, ports.artifact ? `Download de ${ports.artifact.name} iniciado.` : "Nenhum arquivo preparado.", Boolean(ports.artifact)); }
  if (action === "get_state") return ports.report(action, "Estado completo disponível em FormaAI.getState().");
  return null;
}
