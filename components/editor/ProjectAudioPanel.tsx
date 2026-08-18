"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ProjectAudioPreset, SceneAudioClip } from "@/app/types";
import { clampAudioStart } from "@/lib/audio/scenes";
import { fitProjectAudioPresetToDuration, projectAudioPresetDuration, PROJECT_AUDIO_AUTO_END_FADE } from "@/lib/audio/project";

type Props = {
  duration: number; playhead: number; isPlaying: boolean; preset: ProjectAudioPreset; selectedClipId: string | null; importMessage?: string;
  onClose: () => void; onBack: () => void; onRename: (name: string) => void; onChangeMasterVolume: (value: number) => void;
  onImport: (track: number) => void; onSelectClip: (id: string) => void; onMoveClip: (id: string, start: number) => void;
  onUpdateClip: (id: string, patch: Partial<SceneAudioClip>) => void; onDeleteClip: (id: string) => void; onSplitClip: (id: string, time: number) => void;
  onTogglePlayback: () => void; onSeek: (time: number) => void;
};

export function ProjectAudioPanel({ duration, playhead, isPlaying, preset, selectedClipId, importMessage, onClose, onBack, onRename, onChangeMasterVolume, onImport, onSelectClip, onMoveClip, onUpdateClip, onDeleteClip, onSplitClip, onTogglePlayback, onSeek }: Props) {
  const drag = useRef<{ id: string; pointerId: number; startX: number; start: number; width: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(preset.name);
  useEffect(() => { setName(preset.name); setRenaming(false); }, [preset.id, preset.name]);
  const selected = preset.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? null;
  // A timeline exibida é uma instância adaptada ao tamanho atual do projeto.
  // O preset-fonte permanece intacto: ao aumentar o projeto, trechos antes
  // ocultos voltam automaticamente a partir do áudio original.
  const fittedPreset = fitProjectAudioPresetToDuration(preset, duration);
  const fittedSelected = fittedPreset.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? null;
  const presetDuration = projectAudioPresetDuration(preset);
  const endsAfterProject = presetDuration > duration + .05;
  const leavesFreeSpace = presetDuration > 0 && presetDuration < duration - .05;
  const selectedIsAutoTrimmed = Boolean(selected && fittedSelected && !selected.loop && fittedSelected.duration < selected.duration - .001);
  const selectedOffset = selected ? playhead - clampAudioStart(selected.start, duration) : 0;
  const markerInside = Boolean(selected && selectedOffset >= .05 && selectedOffset <= selected.duration - .05);
  const splitInsideFade = Boolean(selected && markerInside && (selectedOffset < (selected.fadeIn ?? 0) || selected.duration - selectedOffset < (selected.fadeOut ?? 0)));
  const canSplit = Boolean(selected && !selected.loop && markerInside && !splitInsideFade);

  function startDrag(event: PointerEvent<HTMLButtonElement>, clip: SceneAudioClip) {
    drag.current = { id: clip.id, pointerId: event.pointerId, startX: event.clientX, start: clip.start, width: event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1 };
    event.currentTarget.setPointerCapture(event.pointerId); onSelectClip(clip.id);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    onMoveClip(current.id, clampAudioStart(current.start + ((event.clientX - current.startX) / current.width) * duration, duration));
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) { if (drag.current?.pointerId === event.pointerId) drag.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {} }

  return <section className="audio-panel editing project-audio-editor-panel" aria-label="Áudio principal do projeto" onClick={(event) => event.stopPropagation()}>
    <header className="audio-panel-head"><button className="audio-back" aria-label="Voltar aos presets principais" onClick={onBack}>‹</button><div>{renaming ? <form className="audio-rename" onSubmit={(event) => { event.preventDefault(); onRename(name); setRenaming(false); }}><input autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} aria-label="Novo nome do preset principal" /><button>Salvar</button></form> : <strong>{preset.name}</strong>}<small>{duration.toFixed(0)}s · áudio principal · 2 faixas {!renaming && <button className="audio-rename-start" onClick={() => setRenaming(true)}>Renomear</button>}</small></div><button className="audio-close" aria-label="Fechar áudio principal" onClick={onClose}>×</button></header>
    <div className="audio-editor">
      <div className="project-audio-continuous-note"><span>↔</span><div><strong>TIMELINE CONTÍNUA DO PROJETO</strong><small>Começa após a Entrada; a abertura mantém o áudio próprio e não consome a faixa principal</small></div></div>
      {presetDuration > 0 ? <div className={`project-audio-fit-status${endsAfterProject ? " shorter" : leavesFreeSpace ? " longer" : ""}`}>
        <span>{endsAfterProject ? "↔" : leavesFreeSpace ? "＋" : "✓"}</span>
        <div><strong>{endsAfterProject ? "ADAPTAÇÃO AUTOMÁTICA AO PROJETO" : leavesFreeSpace ? "ESPAÇO LIVRE NO FINAL" : "DURAÇÃO ALINHADA"}</strong><small>{endsAfterProject ? `O Forma usa os primeiros ${duration.toFixed(0)}s do preset de ${presetDuration.toFixed(0)}s e move a transição de saída para o final atual. Se o projeto crescer, o áudio original reaparece automaticamente.` : leavesFreeSpace ? `O preset ocupa ${presetDuration.toFixed(0)}s. Os ${(duration - presetDuration).toFixed(0)}s restantes ficam vazios para adicionar outra música.` : "O preset já termina junto com o projeto."}</small></div>
      </div> : null}
      {importMessage ? <div className="project-audio-import-status" role="status"><span>♪</span><small>{importMessage}</small></div> : null}
      <div className="audio-preview-controls"><button aria-label={isPlaying ? "Pausar áudio principal" : "Reproduzir áudio principal"} className={isPlaying ? "playing" : ""} onClick={onTogglePlayback}>{isPlaying ? "Ⅱ" : "▶"}</button><strong>{playhead.toFixed(1)}s</strong><span>/ {duration.toFixed(1)}s</span></div>
      <div className="audio-master"><label>Volume geral</label><input aria-label="Volume geral do áudio principal" type="range" min="0" max="1" step="0.01" value={preset.masterVolume} onChange={(event) => onChangeMasterVolume(Number(event.target.value))} /><output>{Math.round(preset.masterVolume * 100)}%</output></div>
      <button className="audio-ruler" aria-label={`Posicionar áudio principal. Tempo atual ${playhead.toFixed(1)} segundos`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSeek(((event.clientX - rect.left) / rect.width) * duration); }}><span>0s</span><span>{(duration / 2).toFixed(1)}s</span><span>{duration.toFixed(0)}s</span><i style={{ left: `${(playhead / duration) * 100}%` }} /></button>
      <div className="audio-tracks">{fittedPreset.tracks.map((track, trackIndex) => <div className="audio-track-row" key={track.id}><div className="audio-track-name"><strong>{track.name}</strong><button aria-label={`Importar em ${track.name}`} onClick={() => onImport(trackIndex)}>＋</button></div><div className="audio-track-line">{track.clips.map((clip) => {
        const sourceClip = preset.tracks[trackIndex]?.clips.find((item) => item.id === clip.id) ?? clip;
        const start = clampAudioStart(clip.start, duration); const shown = clip.loop ? duration - start : Math.min(clip.duration, duration - start); const width = Math.max(4, Math.min(100 - start / duration * 100, shown / duration * 100)); const fadeIn = shown > 0 ? Math.min(100, (clip.fadeIn ?? 0) / shown * 100) : 0; const fadeOut = shown > 0 ? Math.min(100, (clip.fadeOut ?? 0) / shown * 100) : 0;
        const autoTrimmed = !sourceClip.loop && clip.duration < sourceClip.duration - .001;
        return <button key={clip.id} className={`audio-clip project-music${clip.id === selectedClipId ? " selected" : ""}${autoTrimmed ? " auto-fitted" : ""}`} style={{ left: `${start / duration * 100}%`, width: `${width}%` }} title={`${clip.name} · ${start.toFixed(1)}s${autoTrimmed ? " · adaptado ao final do projeto" : ""}`} onPointerDown={(event) => startDrag(event, { ...sourceClip, start })} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><i className="audio-fade audio-fade-in" style={{ width: `${fadeIn}%` }} /><i className="audio-fade audio-fade-out" style={{ width: `${fadeOut}%` }} /><span className="audio-clip-name">{clip.loop ? "↻ " : ""}{clip.name}</span></button>;
      })}</div></div>)}</div>
      {selected ? <div className="audio-clip-inspector"><div><strong>{selected.name}</strong><button className="audio-delete-effect" onClick={() => onDeleteClip(selected.id)}>Excluir música</button></div><label>Início <input aria-label="Início da música" type="range" min="0" max={Math.max(0, duration - .05)} step="0.05" value={clampAudioStart(selected.start, duration)} onChange={(event) => onMoveClip(selected.id, Number(event.target.value))} /><output>{clampAudioStart(selected.start, duration).toFixed(2)}s</output></label><label>Volume do item <input aria-label="Volume da música" type="range" min="0" max="1" step="0.01" value={selected.volume} onChange={(event) => onUpdateClip(selected.id, { volume: Number(event.target.value) })} /><output>{Math.round(selected.volume * 100)}%</output></label>{selectedIsAutoTrimmed && fittedSelected ? <small className="project-audio-auto-fit-tip">↔ Neste projeto, este bloco usa {fittedSelected.duration.toFixed(2)}s do original e recebe {(fittedSelected.fadeOut ?? PROJECT_AUDIO_AUTO_END_FADE).toFixed(2)}s de saída automática. O arquivo/preset original continua com {selected.duration.toFixed(2)}s.</small> : null}<button className="audio-split-effect" disabled={!canSplit} onClick={() => onSplitClip(selected.id, playhead)}>✂ Dividir no marcador</button><small className="audio-split-tip">{selected.loop ? "Desative Repetir para dividir" : splitInsideFade ? "Mova o marcador para fora da transição de volume" : canSplit ? `Criar dois blocos em ${playhead.toFixed(2)}s` : "Posicione o marcador dentro da música"}</small><div className="audio-inspector-section"><strong>TRANSIÇÃO DE VOLUME</strong><small>Suaviza a passagem entre músicas</small></div><label>Aumentar aos poucos <input aria-label="Fade in da música" type="range" min="0" max={selected.duration} step="0.05" value={selected.fadeIn ?? 0} onChange={(event) => onUpdateClip(selected.id, { fadeIn: Number(event.target.value) })} /><output>{(selected.fadeIn ?? 0).toFixed(2)}s</output></label><label>Diminuir aos poucos <input aria-label="Fade out da música" type="range" min="0" max={selected.duration} step="0.05" value={selected.fadeOut ?? 0} onChange={(event) => onUpdateClip(selected.id, { fadeOut: Number(event.target.value) })} /><output>{(selected.fadeOut ?? 0).toFixed(2)}s</output></label><label className="audio-loop"><input type="checkbox" checked={Boolean(selected.loop)} onChange={(event) => onUpdateClip(selected.id, { loop: event.target.checked })} /> Repetir até o final do projeto</label></div> : <p className="audio-select-tip">Importe músicas nas duas faixas ou selecione um bloco para editar.</p>}
    </div>
  </section>;
}
