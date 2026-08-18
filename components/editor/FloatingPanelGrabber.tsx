"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

export function FloatingPanelGrabber() {
  const dragRef = useRef<{ pointerId: number; panel: HTMLElement; offsetX: number; offsetY: number } | null>(null);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || window.innerWidth < 700 || event.button !== 0) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.classList.add("desktop-floating");
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.bottom = "auto";
    panel.style.transform = "none";
    panel.style.width = `${rect.width}px`;
    dragRef.current = { pointerId: event.pointerId, panel, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = drag.panel.getBoundingClientRect();
    drag.panel.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - drag.offsetX))}px`;
    drag.panel.style.top = `${Math.max(58, Math.min(window.innerHeight - rect.height - 8, event.clientY - drag.offsetY))}px`;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function reset(event: MouseEvent<HTMLDivElement>) {
    if (window.innerWidth < 700) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    panel.classList.remove("desktop-floating");
    panel.style.removeProperty("left");
    panel.style.removeProperty("top");
    panel.style.removeProperty("bottom");
    panel.style.removeProperty("transform");
    panel.style.removeProperty("width");
  }

  return <div className="sheet-grabber" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={reset} />;
}
