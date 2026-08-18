import type { AICommand, AIResult, FormaScene } from "../../../app/types.ts";

type SceneCommandPorts = {
  scenes: FormaScene[];
  activeSceneId: string | null;
  addScene: (name?: string) => FormaScene;
  addIntro: (name?: string) => { scene: FormaScene; created: boolean };
  addTransition: (afterSceneId?: unknown, beforeSceneId?: unknown, name?: string, preset?: unknown) => { ok: true; scene: FormaScene; created: boolean } | { ok: false; message: string };
  selectScene: (query: unknown) => FormaScene | null;
  renameScene: (query: unknown, name: unknown) => { ok: true; scene: FormaScene } | { ok: false; message: string };
  deleteScene: (query: unknown) => { ok: true; scene: FormaScene; removed: FormaScene[] } | { ok: false; message: string };
  openScenes: () => void;
  report: (action: string, message: string, ok?: boolean, selectedId?: string | null) => AIResult;
};

export function handleSceneCommand(command: AICommand, ports: SceneCommandPorts): AIResult | null {
  const action = String(command.action ?? "").trim().toLowerCase();
  if (action === "add_scene" || action === "new_scene") {
    const scene = ports.addScene(typeof command.name === "string" ? command.name : undefined);
    return ports.report(action, `${scene.name} criada e selecionada com ${scene.animationDuration}s.`, true, null);
  }
  if (action === "create_intro_scene" || action === "add_intro" || action === "apply_intro_preset") {
    const result = ports.addIntro(typeof command.name === "string" ? command.name : undefined);
    return ports.report(action, result.created ? `${result.scene.name} criada com o preset completo de 18s.` : `${result.scene.name} já existe e foi selecionada.`, true, null);
  }
  if (action === "ensure_transition_scene" || action === "add_transition" || action === "create_transition") {
    const result = ports.addTransition(command.afterSceneId ?? command.after ?? command.from, command.beforeSceneId ?? command.before ?? command.to, typeof command.name === "string" ? command.name : undefined, command.preset);
    if (!result.ok) return ports.report(action, result.message, false, null);
    return ports.report(action, result.created ? `${result.scene.name} criada entre as duas cenas.` : `${result.scene.name} já existe e foi selecionada.`, true, null);
  }
  if (action === "select_scene" || action === "open_scene") {
    const query = command.sceneId ?? command.id ?? command.scene ?? command.index ?? command.name;
    const scene = ports.selectScene(query);
    return scene
      ? ports.report(action, `${scene.name} selecionada na timeline.`, true, null)
      : ports.report(action, "Cena não encontrada. Use o nome, ID ou número da cena.", false, null);
  }
  if (action === "rename_scene") {
    const query = command.sceneId ?? command.id ?? command.scene ?? command.index;
    const result = ports.renameScene(query, command.newName ?? command.name ?? command.value);
    return result.ok
      ? ports.report(action, `Cena renomeada para ${result.scene.name}.`, true, null)
      : ports.report(action, result.message, false, null);
  }
  if (action === "delete_scene" || action === "remove_scene") {
    const query = command.sceneId ?? command.id ?? command.scene ?? command.index ?? command.name;
    const result = ports.deleteScene(query);
    if (!result.ok) return ports.report(action, result.message, false, null);
    const transitionCount = result.removed.filter((scene) => scene.kind === "transition").length;
    const collateral = transitionCount ? ` ${transitionCount} ${transitionCount === 1 ? "transição conectada também foi removida" : "transições conectadas também foram removidas"}.` : "";
    return ports.report(action, `Cena removida. ${result.scene.name} está ativa.${collateral}`, true, null);
  }
  if (action === "list_scenes") {
    ports.openScenes();
    const summary = ports.scenes.map((scene, index) => `${index + 1}. ${scene.name} [${scene.kind ?? "main"}]${scene.id === ports.activeSceneId ? " (ativa)" : ""}`).join(" · ");
    return ports.report(action, summary || "O projeto ainda não possui cenas.", true, null);
  }
  if (action === "screen" && String(command.screen ?? "").toLowerCase() === "scenes") {
    ports.openScenes();
    return ports.report(action, "Painel de cenas aberto.", true, null);
  }
  return null;
}
