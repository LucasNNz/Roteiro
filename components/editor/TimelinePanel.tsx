"use client";

import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { SelectedKeyframe, Shape } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { layerLabel } from "@/lib/layers/label";

type KeyframeMarquee = { left: number; top: number; width: number; height: number } | null;

type TimelineTracksProps = {
  tracksRef: RefObject<HTMLDivElement | null>;
  shapes: Shape[];
  duration: number;
  selectedId: string | null;
  recordingId: string | null;
  selectedKeyframes: SelectedKeyframe[];
  marquee: KeyframeMarquee;
  onStartMarquee: (event: PointerEvent<HTMLDivElement>) => void;
  onMoveMarquee: (event: PointerEvent<HTMLDivElement>) => void;
  onEndMarquee: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectShape: (id: string) => void;
  onStartKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => void;
  onMoveKeyframe: (event: PointerEvent<HTMLButtonElement>) => void;
  onEndKeyframe: (event: PointerEvent<HTMLButtonElement>, shapeId: string, time: number) => void;
  onSeekFrame: (shapeId: string, time: number) => void;
};

function sameSelectedKeyframes(previous: SelectedKeyframe[], next: SelectedKeyframe[]) {
  return previous.length === next.length && previous.every((item, index) => item.shapeId === next[index].shapeId && item.time === next[index].time);
}

function sameTimelineShape(previous: Shape, next: Shape) {
  const previousFrames = previous.keyframes ?? [];
  const nextFrames = next.keyframes ?? [];
  return previous.id === next.id && previous.type === next.type && previous.name === next.name && previous.fill === next.fill && previousFrames.length === nextFrames.length && previousFrames.every((frame, index) => frame.time === nextFrames[index].time);
}

function sameMarquee(previous: KeyframeMarquee, next: KeyframeMarquee) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.height === next.height;
}

function sameTimelineTracks(previous: Readonly<TimelineTracksProps>, next: Readonly<TimelineTracksProps>) {
  return previous.duration === next.duration && previous.selectedId === next.selectedId && previous.recordingId === next.recordingId && sameMarquee(previous.marquee, next.marquee) && sameSelectedKeyframes(previous.selectedKeyframes, next.selectedKeyframes) && previous.shapes.length === next.shapes.length && previous.shapes.every((shape, index) => sameTimelineShape(shape, next.shapes[index]));
}

const TimelineTracks = benchmarkMemo(function TimelineTracks({ tracksRef, shapes, duration, selectedId, recordingId, selectedKeyframes, marquee, onStartMarquee, onMoveMarquee, onEndMarquee, onSelectShape, onStartKeyframe, onMoveKeyframe, onEndKeyframe, onSeekFrame }: TimelineTracksProps) {
  const isSelected = (shapeId: string, time: number) => selectedKeyframes.some((item) => item.shapeId === shapeId && Math.abs(item.time - time) < .001);
  return (
    <div ref={tracksRef} className="motion-tracks" onPointerDown={onStartMarquee} onPointerMove={onMoveMarquee} onPointerUp={onEndMarquee} onPointerCancel={onEndMarquee}>
      {marquee && <i className="keyframe-marquee" style={marquee} />}
      {[...shapes].reverse().filter((shape) => shape.type !== "empty").map((shape) => (
        <div key={shape.id} className={`motion-row ${selectedId === shape.id ? "selected" : ""} ${recordingId === shape.id ? "recording" : ""}`}>
          <button className="track-name" onClick={() => onSelectShape(shape.id)}><span style={{ background: shape.type === "image" ? "#6f7480" : shape.fill }} />{layerLabel(shape)}</button>
          <div className="keyframe-track">
            <span className="track-fill" />
            <i className="playhead" />
            {(shape.keyframes ?? []).map((frame, frameIndex) => <button key={`${shape.id}-${frameIndex}`} data-keyframe-shape={shape.id} data-keyframe-time={frame.time} className={`keyframe-dot ${isSelected(shape.id, frame.time) ? "selected" : ""}`} aria-label={`Keyframe em ${frame.time.toFixed(1)} segundos`} style={{ left: `${(frame.time / duration) * 100}%` }} onPointerDown={(event) => onStartKeyframe(event, shape.id, frame.time)} onPointerMove={onMoveKeyframe} onPointerUp={(event) => onEndKeyframe(event, shape.id, frame.time)} onPointerCancel={(event) => onEndKeyframe(event, shape.id, frame.time)} onClick={(event) => { if (window.innerWidth < 700) { event.stopPropagation(); onSeekFrame(shape.id, frame.time); } }} />)}
          </div>
        </div>
      ))}
      {!shapes.some((shape) => shape.type !== "empty") && <div className="empty-motion">Selecione ou crie um item para começar.</div>}
    </div>
  );
}, sameTimelineTracks);

type TimelinePanelProps = TimelineTracksProps & {
  panelRef: RefObject<HTMLElement | null>;
  position: { left: number; top: number } | null;
  playhead: number;
  isPlaying: boolean;
  selected: Shape | null;
  onStartPanelDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onMovePanel: (event: PointerEvent<HTMLDivElement>) => void;
  onEndPanelDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onResetPosition: () => void;
  onTogglePlayback: () => void;
  onToggleKeyframes: () => void;
  onClose: () => void;
  onStartScrub: (event: PointerEvent<HTMLDivElement>) => void;
  onScrub: (event: PointerEvent<HTMLDivElement>) => void;
};

export function TimelinePanel({ panelRef, tracksRef, position, playhead, duration, isPlaying, selected, recordingId, selectedKeyframes, onStartPanelDrag, onMovePanel, onEndPanelDrag, onResetPosition, onTogglePlayback, onToggleKeyframes, onClose, onStartScrub, onScrub, ...trackProps }: TimelinePanelProps) {
  const style = { ...(position ? { left: position.left, top: position.top, bottom: "auto", transform: "none" } : {}), "--timeline-progress": `${(playhead / duration) * 100}%` } as CSSProperties;
  return (
    <section ref={panelRef} className="motion-panel" style={style} onClick={(event) => event.stopPropagation()}>
      <div className="motion-window-bar" onPointerDown={onStartPanelDrag} onPointerMove={onMovePanel} onPointerUp={onEndPanelDrag} onPointerCancel={onEndPanelDrag} onDoubleClick={onResetPosition}><span>•••</span><strong>TIMELINE</strong><small>Arraste para mover · duplo clique para centralizar</small></div>
      <div className="motion-controls">
        <button className={`play-control ${isPlaying ? "playing" : ""}`} aria-label={isPlaying ? "Pausar" : "Reproduzir"} onClick={onTogglePlayback}>{isPlaying ? "Ⅱ" : "▶"}</button>
        <div className="motion-time"><strong>{playhead.toFixed(1)}s</strong><span>/ {duration.toFixed(1)}s</span></div>
        {selected && selected.type !== "empty" && <button className={`record-control ${recordingId === selected.id ? "active" : ""}`} onClick={onToggleKeyframes}><i />{recordingId === selected.id ? "Parar keyframes" : "Gravar keyframes"}</button>}
        <span className="keyframe-selection-count">{selectedKeyframes.length ? `${selectedKeyframes.length} selecionado${selectedKeyframes.length > 1 ? "s" : ""}` : "Selecione ou arraste uma área"}</span>
        <button className="close-motion" aria-label="Fechar timeline" onClick={onClose}>×</button>
      </div>
      <div className="time-ruler" onPointerDown={onStartScrub} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onScrub(event); }} onPointerUp={(event) => { try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {} }}>
        {[0, 1, 2, 3, 4].map((step) => <span key={step}>{(duration * step / 4).toFixed(step === 0 || step === 4 ? 0 : 1)}s</span>)}
        <i className="ruler-playhead" />
      </div>
      <TimelineTracks tracksRef={tracksRef} duration={duration} recordingId={recordingId} selectedKeyframes={selectedKeyframes} {...trackProps} />
    </section>
  );
}
