"use client";

import { useEffect, useRef } from "react";
import { backgroundPlaybackAtTime, backgroundPresetBySource } from "@/lib/background-presets";

export function CanvasBackgroundVideo({ source, playhead, playing }: { source: string; playhead: number; playing: boolean }) {
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const preset = backgroundPresetBySource(source);
  const { activeIndex, blend, activeMediaTime, incomingMediaTime, inTransition, playbackRate } = backgroundPlaybackAtTime(source, playhead);
  const firstActive = activeIndex === 0;
  const firstOpacity = firstActive ? 1 : inTransition ? blend : 0;
  const secondOpacity = !firstActive ? 1 : inTransition ? blend : 0;
  const firstLayer = firstActive ? 1 : 2;
  const secondLayer = !firstActive ? 1 : 2;

  useEffect(() => {
    const videos = [firstRef.current, secondRef.current];
    videos.forEach((video, index) => {
      if (!video) return;
      const active = index === activeIndex;
      const incoming = !active && inTransition;
      const target = active ? activeMediaTime : incomingMediaTime;
      video.playbackRate = playbackRate;
      if (!playing || (!active && !incoming) || Math.abs(video.currentTime - target) > .18) video.currentTime = target;
      if (playing && (active || incoming)) void video.play().catch(() => {});
      else video.pause();
    });
  }, [activeIndex, activeMediaTime, incomingMediaTime, inTransition, playbackRate, playing, source]);

  return <div className="canvas-background-stack" aria-hidden="true">
    <video ref={firstRef} className="canvas-background-video" style={{ opacity: firstOpacity, zIndex: firstLayer }} src={source} poster={preset?.poster} muted playsInline preload="auto" />
    <video ref={secondRef} className="canvas-background-video" style={{ opacity: secondOpacity, zIndex: secondLayer }} src={source} poster={preset?.poster} muted playsInline preload="auto" />
  </div>;
}
