"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ProjectAudioPreset, SceneAudioClip, SceneAudioPreset, SceneKind, SceneStingerRole, SceneStingerSettings } from "@/app/types";
import { clampAudioStart } from "@/lib/audio/scenes";
import { BUILTIN_MAIN_AUDIO_PRESET_ID, projectAudioPresetDuration } from "@/lib/audio/project";
import { normalizeSceneStingerSettings, SCENE_STINGER_PRESETS } from "@/lib/audio/stingers";

type AudioPanelProps = {
  duration: number;
  playhead: number;
  isPlaying: boolean;
  sceneKind: SceneKind;
  presets: SceneAudioPreset[];
  activePresetId?: string;
  editing: boolean;
  selectedClipId: string | null;
  projectPresets: ProjectAudioPreset[];
  activeProjectPresetId?: string;
  sceneStingers: SceneStingerSettings;
  cloudStatus: "local" | "fixed" | "synced" | "saving" | "error";
  cloudMessage: string;
  cloudUpdatedAt: string | null;
  cloudLibraryKey: string;
  onSyncCloud: () => void;
  onRestoreCloud: () => void;
  onDownloadCloudBackup: () => void;
  onClose: () => void;
  onCreate: () => void;
  onCreateProjectPreset: () => void;
  onSelectProjectPreset: (id: string | null) => void;
  onEditProjectPreset: (id: string) => void;
  onDeleteProjectPreset: (id: string) => void;
  onChangeProjectPresetVolume: (id: string, value: number) => void;
  onBack: () => void;
  onSelectPreset: (id: string) => void;
  onEditPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
  onApplyAll: () => void;
  onChangeMasterVolume: (value: number) => void;
  onImport: (trackIndex: number) => void;
  onSelectClip: (id: string) => void;
  onMoveClip: (id: string, start: number) => void;
  onUpdateClip: (id: string, patch: Partial<SceneAudioClip>) => void;
  onDeleteClip: (id: string) => void;
  onSplitClip: (id: string, time: number) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onUpdateSceneStingers: (settings: SceneStingerSettings) => void;
};

const KIND_LABEL: Record<SceneKind, string> = { intro: "entrada", main: "cena principal", result: "resultado", transition: "transição" };

export function AudioPanel({ duration, playhead, isPlaying, sceneKind, presets, activePresetId, editing, selectedClipId, projectPresets, activeProjectPresetId, sceneStingers, cloudStatus, cloudMessage, cloudUpdatedAt, cloudLibraryKey, onSyncCloud, onRestoreCloud, onDownloadCloudBackup, onClose, onCreate, onCreateProjectPreset, onSelectProjectPreset, onEditProjectPreset, onDeleteProjectPreset, onChangeProjectPresetVolume, onBack, onSelectPreset, onEditPreset, onDeletePreset, onRenamePreset, onApplyAll, onChangeMasterVolume, onImport, onSelectClip, onMoveClip, onUpdateClip, onDeleteClip, onSplitClip, onTogglePlayback, onSeek, onUpdateSceneStingers }: AudioPanelProps) {
  const drag = useRef<{ id: string; pointerId: number; startX: number; start: number; width: number } | null>(null);
  const stingerPreview = useRef<HTMLAudioElement | null>(null);
  const stingerPreviewCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const compatible = presets.filter((preset) => preset.sceneKind === sceneKind);
  const active = presets.find((preset) => preset.id === activePresetId) ?? null;
  const activeProjectPreset = projectPresets.find((preset) => preset.id === activeProjectPresetId) ?? null;
  const activeProjectPresetDuration = projectAudioPresetDuration(activeProjectPreset);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { setName(active?.name ?? ""); setRenaming(false); }, [active?.id]);
  useEffect(() => {
    const previewCache = stingerPreviewCache.current;
    for (const preset of SCENE_STINGER_PRESETS) {
      const audio = new Audio(preset.src);
      audio.preload = "auto";
      previewCache.set(preset.id, audio);
    }
    return () => {
      stingerPreview.current?.pause();
      previewCache.forEach((audio) => audio.pause());
      previewCache.clear();
    };
  }, []);
  const selectedClip = active?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? null;
  const selectedOffset = selectedClip ? playhead - clampAudioStart(selectedClip.start, duration) : 0;
  const markerInsideSelected = Boolean(selectedClip && selectedOffset >= .05 && selectedOffset <= selectedClip.duration - .05);
  const splitInsideFade = Boolean(selectedClip && markerInsideSelected && (selectedOffset < (selectedClip.fadeIn ?? 0) || selectedClip.duration - selectedOffset < (selectedClip.fadeOut ?? 0)));
  const canSplitSelected = Boolean(selectedClip && !selectedClip.loop && markerInsideSelected && !splitInsideFade);

  function updateStingerPool(role: SceneStingerRole, patch: Partial<SceneStingerSettings[SceneStingerRole]>) {
    onUpdateSceneStingers(normalizeSceneStingerSettings({ ...sceneStingers, [role]: { ...sceneStingers[role], ...patch } }));
  }

  function previewStinger(id: string, role: SceneStingerRole) {
    const preset = SCENE_STINGER_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    if (stingerPreview.current) {
      stingerPreview.current.pause();
      stingerPreview.current.currentTime = 0;
    }
    let audio = stingerPreviewCache.current.get(id);
    if (!audio) {
      audio = new Audio(preset.src);
      audio.preload = "auto";
      stingerPreviewCache.current.set(id, audio);
    }
    audio.currentTime = 0;
    audio.volume = sceneStingers[role].volume;
    stingerPreview.current = audio;
    void audio.play().catch(() => {});
  }

  const cloudNotConfigured = /blob store|blob_not_configured|nuvem do forma.*não.*conect|nuvem.*não.*configurad/i.test(cloudMessage);
  const cloudTitle = cloudNotConfigured
    ? "NUVEM NÃO CONFIGURADA"
    : cloudStatus === "synced" ? "LOCAL + NUVEM PROTEGIDOS"
    : cloudStatus === "fixed" ? "LOCAL PROTEGIDO"
    : cloudStatus === "error" ? "SINCRONIZAÇÃO INDISPONÍVEL"
    : cloudStatus === "saving" ? "SINCRONIZANDO"
    : "PRESERVADO NESTE NAVEGADOR";
  const cloudIcon = cloudNotConfigured || cloudStatus === "error"
    ? "!"
    : cloudStatus === "synced" || cloudStatus === "fixed" ? "✓"
    : cloudStatus === "saving" ? "↻"
    : "♫";

  function startDrag(event: PointerEvent<HTMLButtonElement>, clip: SceneAudioClip) {
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
    drag.current = { id: clip.id, pointerId: event.pointerId, startX: event.clientX, start: clip.start, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectClip(clip.id);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onMoveClip(current.id, clampAudioStart(current.start + ((event.clientX - current.startX) / current.width) * duration, duration));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  return (
    <section className={`audio-panel${editing ? " editing" : ""}`} aria-label="Áudio da cena" onClick={(event) => event.stopPropagation()}>
      <header className="audio-panel-head">
        {editing && <button className="audio-back" aria-label="Voltar aos presets" onClick={onBack}>‹</button>}
        <div>{editing && active && renaming ? <form className="audio-rename" onSubmit={(event) => { event.preventDefault(); onRenamePreset(active.id, name); setRenaming(false); }}><input autoFocus maxLength={50} value={name} onChange={(event) => setName(event.target.value)} aria-label="Novo nome do preset" /><button>Salvar</button></form> : <strong>{editing ? active?.name ?? "Preset de áudio" : "ÁUDIO DA CENA"}</strong>}<small>{duration.toFixed(0)}s · {KIND_LABEL[sceneKind]} {editing && active && !renaming && <button className="audio-rename-start" onClick={() => setRenaming(true)}>Renomear</button>}</small></div>
        <button className="audio-close" aria-label="Fechar áudio" onClick={onClose}>×</button>
      </header>

      {!editing ? (
        <div className="audio-library">
          <section className={`audio-cloud-status ${cloudStatus}${cloudNotConfigured ? " unconfigured" : ""}`} aria-label="Sincronização da biblioteca de áudio">
            <span className="audio-cloud-copy"><i>{cloudIcon}</i><span><strong>{cloudTitle}</strong><small><b>Biblioteca {cloudLibraryKey}</b><em>·</em>{cloudMessage}{(cloudStatus === "synced" || cloudStatus === "fixed") && cloudUpdatedAt ? ` · ${new Date(cloudUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</small></span></span>
            <div className="audio-cloud-actions"><button type="button" disabled={cloudStatus === "saving"} onClick={onRestoreCloud}>Restaurar cópia</button><button type="button" onClick={onDownloadCloudBackup}>Baixar cópia</button><button type="button" className="sync" disabled={cloudStatus === "saving"} onClick={onSyncCloud}>{cloudNotConfigured ? "Verificar nuvem" : cloudStatus === "error" ? "Tentar novamente" : "Sincronizar agora"}</button></div>
            {cloudNotConfigured && <p className="audio-cloud-setup-tip">A cópia local está segura. Para compartilhar com celular e PC, conecte um Vercel Blob Store ao projeto Forma e depois toque em “Verificar nuvem”.</p>}
          </section>
          <section className="project-soundtrack" aria-label="Trilha contínua do projeto">
            <div className="project-soundtrack-title"><div><strong>ÁUDIO PRINCIPAL DO PROJETO</strong><small>Presets contínuos · timeline com 2 faixas</small></div>{activeProjectPresetId && <i>CONTÍNUO</i>}</div>
            <div className="project-main-preset-binding">
              <div><strong>PRESET DE MÚSICA DE FUNDO PRINCIPAL</strong><small>Escolha um preset permanente para este projeto ou deixe sem música de fundo.</small></div>
              <div className="project-main-preset-controls">
                <select aria-label="Preset de música de fundo principal" value={activeProjectPresetId ?? ""} onChange={(event) => onSelectProjectPreset(event.target.value || null)}>
                  <option value="">SEM PRESET</option>
                  {projectPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                {activeProjectPreset && <button type="button" onClick={() => onSelectProjectPreset(null)}>Retirar</button>}
              </div>
              {activeProjectPreset ? <><label className="project-main-preset-volume"><span>Volume da faixa principal</span><input aria-label={`Volume de ${activeProjectPreset.name}`} type="range" min="0" max="1" step="0.01" value={activeProjectPreset.masterVolume} onChange={(event) => onChangeProjectPresetVolume(activeProjectPreset.id, Number(event.target.value))} /><output>{Math.round(activeProjectPreset.masterVolume * 100)}%</output></label><small className="project-main-preset-status">{activeProjectPreset.name} selecionado · {activeProjectPresetDuration.toFixed(0)}s de fonte original. O Forma acompanha a duração do projeto sem cortar o preset salvo: reduz e move o fade no fim atual; se o projeto crescer, revela novamente o áudio original. Se ultrapassar o preset, o restante fica livre.</small></> : <small className="project-main-preset-status empty">Nenhum preset principal aplicado ao projeto.</small>}
            </div>
            <button className="project-soundtrack-import" onClick={() => onCreateProjectPreset()}><span>♫</span><div><strong>Criar preset principal</strong><small>Importe várias músicas e organize no projeto</small></div><b>＋</b></button>
            <div className="project-audio-preset-list">{projectPresets.map((preset) => { const bundled = preset.id === BUILTIN_MAIN_AUDIO_PRESET_ID; return <article key={preset.id} className={`${preset.id === activeProjectPresetId ? "active" : ""}${bundled ? " bundled" : ""}`}><button className="main" onClick={() => onSelectProjectPreset(preset.id)}><span>♫</span><div><strong>{preset.name}</strong><small>{preset.tracks.reduce((total, track) => total + track.clips.length, 0)} músicas · {Math.round(preset.masterVolume * 100)}%{bundled ? " · incluído no Forma" : ""}</small></div>{preset.id === activeProjectPresetId ? <i>EM USO</i> : bundled ? <i>PADRÃO</i> : null}</button>{bundled ? <span className="project-audio-bundled-lock">FIXO</span> : <><button onClick={() => onEditProjectPreset(preset.id)}>Editar</button><button aria-label={`Excluir ${preset.name}`} onClick={() => onDeleteProjectPreset(preset.id)}>×</button></>}</article>; })}</div>
          </section>
          <section className="scene-stinger-library" aria-label="Sons automáticos das cenas">
            <div className="scene-stinger-title"><div><strong>SONS AUTOMÁTICOS</strong><small>Fora da timeline · um preset aleatório por cena</small></div><i>ALEATÓRIO</i></div>
            {(["main", "result"] as const).map((role) => {
              const pool = sceneStingers[role];
              const available = SCENE_STINGER_PRESETS.filter((preset) => preset.role === role);
              return <article className="scene-stinger-pool" key={role}>
                <div className="scene-stinger-pool-head"><div><strong>{role === "main" ? "INÍCIO DA CENA" : "CENA DE RESULTADO"}</strong><small>{pool.presetIds.length} presets selecionados</small></div><label className="scene-stinger-switch"><input type="checkbox" checked={pool.enabled} onChange={(event) => updateStingerPool(role, { enabled: event.target.checked })} /><span>{pool.enabled ? "Ativo" : "Desligado"}</span></label></div>
                <div className="scene-stinger-presets">{available.map((preset) => <div key={preset.id} className={pool.presetIds.includes(preset.id) ? "selected" : ""}><label><input type="checkbox" checked={pool.presetIds.includes(preset.id)} onChange={(event) => updateStingerPool(role, { presetIds: event.target.checked ? [...pool.presetIds, preset.id] : pool.presetIds.filter((id) => id !== preset.id) })} /><span>{preset.name}</span></label><button aria-label={`Ouvir ${preset.name}`} onClick={() => previewStinger(preset.id, role)}>▶</button></div>)}</div>
                <label className="scene-stinger-control"><span>Chance de tocar</span><input type="range" min="0" max="1" step="0.05" value={pool.probability} onChange={(event) => updateStingerPool(role, { probability: Number(event.target.value) })} /><output>{Math.round(pool.probability * 100)}%</output></label>
                <label className="scene-stinger-control"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value={pool.volume} onChange={(event) => updateStingerPool(role, { volume: Number(event.target.value) })} /><output>{Math.round(pool.volume * 100)}%</output></label>
              </article>;
            })}
          </section>
          <button className="audio-create" onClick={() => onCreate()}><span>＋</span><strong>Criar preset</strong><small>Timeline com 3 faixas</small></button>
          <div className="audio-preset-list">
            {compatible.map((preset) => (
              <article key={preset.id} className={`audio-preset-card${preset.id === activePresetId ? " active" : ""}`}>
                <button className="audio-preset-main" onClick={() => onSelectPreset(preset.id)}><span>♫</span><div><strong>{preset.name}</strong><small>{preset.tracks.reduce((total, track) => total + track.clips.length, 0)} sons · {Math.round(preset.masterVolume * 100)}%</small></div>{preset.id === activePresetId && <i>ATIVO</i>}</button>
                <button aria-label={`Editar ${preset.name}`} onClick={() => onEditPreset(preset.id)}>Editar</button>
                <button aria-label={`Excluir ${preset.name}`} onClick={() => onDeletePreset(preset.id)}>×</button>
              </article>
            ))}
            {!compatible.length && <p className="audio-empty">Nenhum preset de {KIND_LABEL[sceneKind]} criado.</p>}
          </div>
          {active && <button className="audio-apply-all" onClick={onApplyAll}>Aplicar a todas as cenas de {KIND_LABEL[sceneKind]}</button>}
        </div>
      ) : active ? (
        <div className="audio-editor">
          <div className="audio-preview-controls"><button aria-label={isPlaying ? "Pausar áudio da cena" : "Reproduzir áudio da cena"} className={isPlaying ? "playing" : ""} onClick={onTogglePlayback}>{isPlaying ? "Ⅱ" : "▶"}</button><strong>{playhead.toFixed(1)}s</strong><span>/ {duration.toFixed(1)}s</span></div>
          <div className="audio-master"><label>Volume geral</label><input aria-label="Volume geral do preset" type="range" min="0" max="1" step="0.01" value={active.masterVolume} onChange={(event) => onChangeMasterVolume(Number(event.target.value))} /><output>{Math.round(active.masterVolume * 100)}%</output></div>
          <button className="audio-ruler" aria-label={`Posicionar áudio. Tempo atual ${playhead.toFixed(1)} segundos`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSeek(((event.clientX - rect.left) / rect.width) * duration); }}><span>0s</span><span>{(duration / 2).toFixed(1)}s</span><span>{duration.toFixed(0)}s</span><i style={{ left: `${(playhead / duration) * 100}%` }} /></button>
          <div className="audio-tracks">
            {active.tracks.map((track, trackIndex) => (
              <div className="audio-track-row" key={track.id}>
                <div className="audio-track-name"><strong>{track.name}</strong><button aria-label={`Importar em ${track.name}`} onClick={() => onImport(trackIndex)}>＋</button></div>
                <div className="audio-track-line">
                  {track.clips.map((clip) => {
                    const effectiveStart = clampAudioStart(clip.start, duration);
                    const displayedDuration = clip.loop ? duration - effectiveStart : Math.min(clip.duration, duration - effectiveStart);
                    const width = Math.max(4, Math.min(100 - (effectiveStart / duration) * 100, (displayedDuration / duration) * 100));
                    const fadeInWidth = displayedDuration > 0 ? Math.min(100, ((clip.fadeIn ?? 0) / displayedDuration) * 100) : 0;
                    const fadeOutWidth = displayedDuration > 0 ? Math.min(100, ((clip.fadeOut ?? 0) / displayedDuration) * 100) : 0;
                    return <button key={clip.id} className={`audio-clip${clip.id === selectedClipId ? " selected" : ""}`} style={{ left: `${(effectiveStart / duration) * 100}%`, width: `${width}%` }} title={`${clip.name} · ${effectiveStart.toFixed(1)}s`} onPointerDown={(event) => startDrag(event, { ...clip, start: effectiveStart })} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><i className="audio-fade audio-fade-in" style={{ width: `${fadeInWidth}%` }} /><i className="audio-fade audio-fade-out" style={{ width: `${fadeOutWidth}%` }} /><span className="audio-clip-name">{clip.loop ? "↻ " : ""}{clip.name}</span></button>;
                  })}
                </div>
              </div>
            ))}
          </div>
          {selectedClip ? (
            <div className="audio-clip-inspector">
              <div><strong>{selectedClip.name}</strong><button className="audio-delete-effect" aria-label="Excluir efeito selecionado" onClick={() => onDeleteClip(selectedClip.id)}>Excluir efeito</button></div>
              <label>Início <input aria-label="Início do áudio" type="range" min="0" max={Math.max(0, duration - .05)} step="0.05" value={clampAudioStart(selectedClip.start, duration)} onChange={(event) => onMoveClip(selectedClip.id, clampAudioStart(Number(event.target.value), duration))} /><output>{clampAudioStart(selectedClip.start, duration).toFixed(2)}s</output></label>
              <label>Volume do item <input aria-label="Volume do item de áudio" type="range" min="0" max="1" step="0.01" value={selectedClip.volume} onChange={(event) => onUpdateClip(selectedClip.id, { volume: Number(event.target.value) })} /><output>{Math.round(selectedClip.volume * 100)}%</output></label>
              <button className="audio-split-effect" disabled={!canSplitSelected} onClick={() => onSplitClip(selectedClip.id, playhead)}>✂ Dividir no marcador</button>
              <small className="audio-split-tip">{selectedClip.loop ? "Desative Repetir para dividir" : splitInsideFade ? "Mova o marcador para fora da transição de volume" : canSplitSelected ? `Criar dois blocos em ${playhead.toFixed(2)}s` : "Posicione o marcador dentro do efeito"}</small>
              <div className="audio-inspector-section"><strong>TRANSIÇÃO DE VOLUME</strong><small>Suaviza entrada e saída</small></div>
              <label>Aumentar aos poucos <input aria-label="Fade in do efeito" type="range" min="0" max={selectedClip.duration} step="0.05" value={selectedClip.fadeIn ?? 0} onChange={(event) => onUpdateClip(selectedClip.id, { fadeIn: Number(event.target.value) })} /><output>{(selectedClip.fadeIn ?? 0).toFixed(2)}s</output></label>
              <label>Diminuir aos poucos <input aria-label="Fade out do efeito" type="range" min="0" max={selectedClip.duration} step="0.05" value={selectedClip.fadeOut ?? 0} onChange={(event) => onUpdateClip(selectedClip.id, { fadeOut: Number(event.target.value) })} /><output>{(selectedClip.fadeOut ?? 0).toFixed(2)}s</output></label>
              <label className="audio-loop"><input type="checkbox" checked={Boolean(selectedClip.loop)} onChange={(event) => onUpdateClip(selectedClip.id, { loop: event.target.checked })} /> Repetir até o final da cena</label>
            </div>
          ) : <p className="audio-select-tip">Importe ou selecione um clipe para editar seu volume e posição.</p>}
        </div>
      ) : null}
    </section>
  );
}
