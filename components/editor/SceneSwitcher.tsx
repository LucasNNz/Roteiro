"use client";

import { Fragment, useState } from "react";
import type { FormaScene } from "@/app/types";
import { sceneKind } from "@/lib/scenes/collection";

type SceneSwitcherProps = {
  open: boolean;
  scenes: FormaScene[];
  activeSceneId: string | null;
  onAdd: () => void;
  onAddIntro: () => void;
  onAddTransition: (afterSceneId: string, beforeSceneId: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onClose: () => void;
};

export function SceneSwitcher({ open, scenes, activeSceneId, onAdd, onAddIntro, onAddTransition, onSelect, onRename, onDelete, onDeleteAll, onClose }: SceneSwitcherProps) {
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const activeIndex = Math.max(0, scenes.findIndex((scene) => scene.id === activeSceneId));
  const contentCount = scenes.filter((scene) => sceneKind(scene) !== "transition").length;
  function beginRename(scene: FormaScene) { setRenamingId(scene.id); setRenameValue(scene.name); setDeletingId(null); }
  function finishRename(scene: FormaScene) { const name = renameValue.trim(); if (!name) return; onRename(scene.id, name); setRenamingId(null); setActionsId(null); }
  function closePanel() { setActionsId(null); setRenamingId(null); setDeletingId(null); setDeletingAll(false); onClose(); }
  if (!open) return null;
  return (
    <aside className="scene-switcher open" onClick={(event) => event.stopPropagation()}>
        <section className="scene-popover" aria-label="Cenas do projeto" role="dialog" aria-modal="false">
          <i className="scene-sheet-grabber" />
          <header>
            <span><strong>CENAS</strong><small>Projeto atual</small></span>
            <b>{scenes.length} {scenes.length === 1 ? "CENA" : "CENAS"}</b>
            <button aria-label="Fechar cenas" onClick={closePanel}>×</button>
          </header>
          <button className="scene-add" onClick={onAdd}>
            <i>＋</i>
            <span><strong>Adicionar nova cena</strong><small>Cena vazia editável · 8s</small></span>
            <b>›</b>
          </button>
          <button className="scene-add-intro" onClick={onAddIntro}>
            <i>▶</i>
            <span><strong>{scenes.some((scene) => sceneKind(scene) === "intro") ? "Abrir entrada" : "Adicionar entrada"}</strong><small>Preset CorvoQuiz completo · 18s</small></span>
            <b>›</b>
          </button>
          {!deletingAll ? <button className="scene-delete-all" onClick={() => { setDeletingAll(true); setActionsId(null); setRenamingId(null); setDeletingId(null); }}>
            <span>⌫</span><strong>Apagar todas as cenas</strong><small>Limpar projeto de uma vez</small>
          </button> : <div className="scene-delete-all-confirm">
            <span><strong>Apagar todas as cenas?</strong><small>Será criada uma Cena 1 vazia para continuar editando.</small></span>
            <button onClick={() => setDeletingAll(false)}>Cancelar</button>
            <button className="danger" onClick={() => { onDeleteAll(); setDeletingAll(false); setActionsId(null); }}>Apagar todas</button>
          </div>}
          <div className="scene-legend" aria-label="Tipos de cena"><span className="intro"><i /> Entrada</span><span className="main"><i /> Principal</span><span className="result"><i /> Resultado</span><span className="transition"><i /> Transição</span></div>
          <div className="scene-list" role="listbox" aria-label="Selecionar cena">
            {scenes.map((scene, index) => {
              const active = scene.id === activeSceneId;
              const kind = sceneKind(scene);
              const next = scenes[index + 1];
              const label = kind === "intro" ? "CENA DE ENTRADA" : kind === "transition" ? "CENA DE TRANSIÇÃO" : kind === "result" ? "CENA DE RESULTADO" : "CENA PRINCIPAL";
              const linkedTransitions = kind === "transition" ? 0 : [scenes[index - 1], scenes[index + 1]].filter((item) => item && sceneKind(item) === "transition").length;
              const deleteDisabled = kind !== "transition" && contentCount <= 1;
              const cardContent = <>
                  <i className="scene-thumb" style={{ background: scene.document.background }}>
                    <span /><span /><span />
                  </i>
                  <span>{renamingId === scene.id ? <input autoFocus maxLength={40} value={renameValue} aria-label={`Novo nome de ${scene.name}`} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") finishRename(scene); if (event.key === "Escape") setRenamingId(null); }} /> : <strong>{scene.name}</strong>}<em>{label}</em><small>{scene.animationDuration.toFixed(1)}s · {kind === "transition" && scene.transition?.presetId === "brush-lightning" ? "Pincel + Corvo · " : ""}{scene.document.shapes.length} camadas{scene.backgroundVariant ? ` · Fundo ${scene.backgroundVariant}` : ""}</small></span>
                  <b>{active ? "●" : index + 1}</b>
              </>;
              const canAddTransition = next && kind !== "transition" && sceneKind(next) !== "transition" && (scene.document.format ?? "square") === (next.document.format ?? "square");
              return <Fragment key={scene.id}>
                <div className={`scene-card-wrap ${actionsId === scene.id || renamingId === scene.id || deletingId === scene.id ? "actions-open" : ""}`}>
                  {renamingId === scene.id ? <div className={`scene-card editing ${active ? "active " : ""}${kind}`}>{cardContent}</div> : <button className={`scene-card ${active ? "active " : ""}${kind}`} role="option" aria-selected={active} onClick={() => onSelect(scene.id)}>{cardContent}</button>}
                  <button className="scene-actions-trigger" aria-label={`Ações de ${scene.name}`} aria-expanded={actionsId === scene.id} onClick={() => { setActionsId((id) => id === scene.id ? null : scene.id); setDeletingId(null); }}>•••</button>
                  {actionsId === scene.id && renamingId !== scene.id && <div className="scene-card-actions">
                    <button aria-label={`Renomear ${scene.name}`} onClick={() => beginRename(scene)}>✎<span>Renomear</span></button>
                    <button className="danger" disabled={deleteDisabled} aria-label={deleteDisabled ? "A última cena de conteúdo não pode ser apagada" : `Apagar ${scene.name}`} onClick={() => setDeletingId(scene.id)}>⌫<span>Apagar</span></button>
                  </div>}
                  {renamingId === scene.id && <div className="scene-rename-actions"><button onClick={() => setRenamingId(null)}>Cancelar</button><button disabled={!renameValue.trim()} onClick={() => finishRename(scene)}>Salvar</button></div>}
                  {deletingId === scene.id && <div className="scene-delete-confirm"><span><strong>Apagar {scene.name}?</strong><small>{linkedTransitions ? `${linkedTransitions} ${linkedTransitions === 1 ? "transição vinculada será removida" : "transições vinculadas serão removidas"}.` : "Esta ação não pode ser desfeita."}</small></span><button onClick={() => setDeletingId(null)}>Cancelar</button><button className="danger" onClick={() => { onDelete(scene.id); setDeletingId(null); setActionsId(null); }}>Apagar</button></div>}
                </div>
                {canAddTransition && <button className="scene-transition-gap" aria-label={`Adicionar transição Pincel com Corvo entre ${scene.name} e ${next.name}`} onClick={() => onAddTransition(scene.id, next.id)}><i>＋</i><span>Adicionar transição</span><small>Pincel + Corvo · 2s</small></button>}
              </Fragment>;
            })}
          </div>
          <footer><i /> Cena {activeIndex + 1} ativa na timeline</footer>
        </section>
    </aside>
  );
}
