"use client";

import type { PointerEvent, RefObject } from "react";
import type { Shape } from "@/app/types";
import { answerGroupParts } from "@/lib/alignment/answers";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { sameRenderedShape } from "@/lib/canvas/render-equality";
import { brushPath, hasVisualAdjustments, mediaGeometry } from "@/lib/geometry";
import { renderableProgressIconSource } from "@/lib/scenes/progress-icon";

type CanvasShapeProps = {
  shape: Shape;
  active: boolean;
  inverseZoom: number;
  onStartMove: (event: PointerEvent<Element>, shape: Shape) => void;
  onStartHandle: (event: PointerEvent<Element>, kind: "rotate" | "radius" | "resize", shape: Shape, handle?: string) => void;
};

const CanvasShapeDefs = benchmarkMemo(function CanvasShapeDefs({ shape }: { shape: Shape }) {
  return (
    <g>
      {shape.fill2 && <linearGradient id={`gradient-${shape.id}`} x1="0" y1="0" x2="1" y2="0" gradientTransform={`rotate(${shape.gradientAngle ?? 0} .5 .5)`}><stop offset="0" stopColor={shape.fill} /><stop offset="1" stopColor={shape.fill2} /></linearGradient>}
      {hasVisualAdjustments(shape) && <filter id={`visual-${shape.id}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="linear" slope={Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100)) * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))} intercept={(.5 - .5 * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))) * Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100))} />
          <feFuncG type="linear" slope={Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100)) * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))} intercept={(.5 - .5 * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))) * Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100))} />
          <feFuncB type="linear" slope={Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100)) * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))} intercept={(.5 - .5 * Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100))) * Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100))} />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values={String(Math.max(0, Math.min(2, (shape.saturation ?? 100) / 100)))} />
        <feColorMatrix type="hueRotate" values={String(shape.hue ?? 0)} />
        {shape.colorMatrix?.length === 20 && <feColorMatrix type="matrix" values={shape.colorMatrix.join(" ")} />}
        {shape.shadowColor && (shape.shadowBlur ?? 0) > 0 && <feDropShadow dx={shape.shadowX ?? 0} dy={shape.shadowY ?? 0} stdDeviation={(shape.shadowBlur ?? 0) / 2} floodColor={shape.shadowColor} />}
      </filter>}
      {shape.type === "brush" && <filter id={`brush-texture-${shape.id}`} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.045" numOctaves="2" seed="17" result="brushNoise" />
        <feDisplacementMap in="SourceGraphic" in2="brushNoise" scale={Math.max(10, Math.min(shape.w, shape.h) * .018)} xChannelSelector="R" yChannelSelector="G" result="texturedBrush" />
        {shape.shadowColor && (shape.shadowBlur ?? 0) > 0 && <feDropShadow in="texturedBrush" dx={shape.shadowX ?? 0} dy={shape.shadowY ?? 0} stdDeviation={(shape.shadowBlur ?? 0) / 2} floodColor={shape.shadowColor} />}
      </filter>}
      {(shape.type === "image" || shape.imageSrc) && <clipPath id={`clip-${shape.id}`}>{shape.type === "ellipse" ? <ellipse cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2} rx={shape.w / 2} ry={shape.h / 2} /> : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.radius} />}</clipPath>}
    </g>
  );
}, (previous, next) => sameRenderedShape(previous.shape, next.shape));

const CanvasShapeLayer = benchmarkMemo(function CanvasShapeLayer({ shape, active, inverseZoom, onStartMove, onStartHandle }: CanvasShapeProps) {
  if (shape.visible === false || shape.type === "empty") return null;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const transform = `rotate(${shape.rotation} ${cx} ${cy})`;
  const visual = { opacity: shape.opacity ?? 1, filter: shape.type === "brush" ? `url(#brush-texture-${shape.id})` : hasVisualAdjustments(shape) ? `url(#visual-${shape.id})` : undefined };
  const shapeFill = shape.fill2 ? `url(#gradient-${shape.id})` : shape.fill;
  const media = mediaGeometry(shape);
  return (
    <g transform={transform} data-forma-shape-id={shape.id} data-forma-shape-name={shape.name}>
      {shape.type === "image" ? (
        <image href={renderableProgressIconSource(shape.src)} x={media.x} y={media.y} width={media.w} height={media.h} preserveAspectRatio={`xMidYMid ${shape.objectFit === "contain" ? "meet" : "slice"}`} clipPath={`url(#clip-${shape.id})`} {...visual} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
      ) : shape.type === "text" ? (
        <text textAnchor="middle" dominantBaseline="middle" fontFamily="Montserrat, sans-serif" fontSize={shape.fontSize ?? 120} fontWeight={shape.fontWeight ?? 700} letterSpacing={shape.letterSpacing ?? 0} fill={shapeFill} stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} paintOrder="stroke fill" strokeLinejoin="round" {...visual} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)}>
          {(shape.text ?? "").split(/\r?\n/).map((line, index, lines) => {
            const lineHeight = (shape.fontSize ?? 120) * (shape.lineHeight ?? 1.08);
            const firstY = cy - ((lines.length - 1) * lineHeight) / 2;
            return <tspan key={`${shape.id}-line-${index}`} x={cx} y={firstY + index * lineHeight}>{line}</tspan>;
          })}
        </text>
      ) : shape.type === "brush" ? (
        <path d={brushPath(shape)} fill={shapeFill} stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} {...visual} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
      ) : shape.type === "rect" ? shape.imageSrc ? (
        <g {...visual}>
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.radius} fill={shapeFill} />
          <image href={shape.imageSrc} x={media.x} y={media.y} width={media.w} height={media.h} preserveAspectRatio={`xMidYMid ${shape.objectFit === "contain" ? "meet" : "slice"}`} clipPath={`url(#clip-${shape.id})`} />
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.radius} fill="transparent" stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
        </g>
      ) : (
        <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.radius} fill={shapeFill} stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} {...visual} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
      ) : shape.imageSrc ? (
        <g {...visual}>
          <ellipse cx={cx} cy={cy} rx={shape.w / 2} ry={shape.h / 2} fill={shapeFill} />
          <image href={shape.imageSrc} x={media.x} y={media.y} width={media.w} height={media.h} preserveAspectRatio={`xMidYMid ${shape.objectFit === "contain" ? "meet" : "slice"}`} clipPath={`url(#clip-${shape.id})`} />
          <ellipse cx={cx} cy={cy} rx={shape.w / 2} ry={shape.h / 2} fill="transparent" stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
        </g>
      ) : (
        <ellipse cx={cx} cy={cy} rx={shape.w / 2} ry={shape.h / 2} fill={shapeFill} stroke={shape.stroke} strokeWidth={shape.strokeWidth ?? 0} {...visual} pointerEvents={shape.locked ? "none" : "auto"} onPointerDown={(event) => onStartMove(event, shape)} />
      )}
      {active && (
        <g className="selection-ui">
          <rect className="selection-box" x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.type === "rect" ? shape.radius : shape.type === "ellipse" ? shape.h / 2 : 0} />
          {[["lt", shape.x, shape.y], ["rt", shape.x + shape.w, shape.y], ["lb", shape.x, shape.y + shape.h], ["rb", shape.x + shape.w, shape.y + shape.h]].map(([handle, x, y]) => (
            <circle key={handle as string} className="resize-handle" cx={x as number} cy={y as number} r={17 * inverseZoom} onPointerDown={(event) => onStartHandle(event, "resize", shape, handle as string)} />
          ))}
          <line className="rotate-line" x1={cx} y1={shape.y} x2={cx} y2={shape.y - 74 * inverseZoom} />
          <circle className="action-handle rotate-handle" cx={cx} cy={shape.y - 92 * inverseZoom} r={31 * inverseZoom} onPointerDown={(event) => onStartHandle(event, "rotate", shape)} />
          <path className="rotate-symbol" d={`M ${cx - 11 * inverseZoom} ${shape.y - 97 * inverseZoom} A ${15 * inverseZoom} ${15 * inverseZoom} 0 1 1 ${cx + 12 * inverseZoom} ${shape.y - 82 * inverseZoom}`} />
          {shape.type === "rect" && <>
            <circle className="action-handle radius-handle" cx={shape.x + shape.w - Math.max(26 * inverseZoom, shape.radius)} cy={shape.y + 30 * inverseZoom} r={27 * inverseZoom} onPointerDown={(event) => onStartHandle(event, "radius", shape)} />
            <path className="radius-symbol" d={`M ${shape.x + shape.w - Math.max(26 * inverseZoom, shape.radius) - 10 * inverseZoom} ${shape.y + 40 * inverseZoom} V ${shape.y + 30 * inverseZoom} A ${10 * inverseZoom} ${10 * inverseZoom} 0 0 1 ${shape.x + shape.w - Math.max(26 * inverseZoom, shape.radius)} ${shape.y + 20 * inverseZoom} H ${shape.x + shape.w - Math.max(26 * inverseZoom, shape.radius) + 10 * inverseZoom}`} />
          </>}
        </g>
      )}
    </g>
  );
}, (previous, next) => sameRenderedShape(previous.shape, next.shape) && previous.active === next.active && (!previous.active || previous.inverseZoom === next.inverseZoom));

type CanvasSurfaceProps = {
  svgRef: RefObject<SVGSVGElement | null>;
  width: number;
  height: number;
  background: string;
  displayedShapes: Shape[];
  authorialShapes: Shape[];
  selectedId: string | null;
  selected: Shape | null;
  inverseZoom: number;
  guides: { x?: number; y?: number; angle?: number };
  alignmentOpen: boolean;
  selectedAnswerGroup: string | null;
  onBeginTouch: (event: PointerEvent<SVGSVGElement>) => void;
  onStartCanvas: (event: PointerEvent<SVGSVGElement>) => void;
  onMovePointer: (event: PointerEvent<SVGSVGElement>) => void;
  onEndPointer: (event: PointerEvent<SVGSVGElement>) => void;
  onStartMove: (event: PointerEvent<Element>, shape: Shape) => void;
  onStartHandle: (event: PointerEvent<Element>, kind: "rotate" | "radius" | "resize", shape: Shape, handle?: string) => void;
};

export function CanvasSurface({ svgRef, width, height, background, displayedShapes, authorialShapes, selectedId, selected, inverseZoom, guides, alignmentOpen, selectedAnswerGroup, onBeginTouch, onStartCanvas, onMovePointer, onEndPointer, onStartMove, onStartHandle }: CanvasSurfaceProps) {
  const alignedParts = alignmentOpen && selectedAnswerGroup ? answerGroupParts(authorialShapes, selectedAnswerGroup) : null;
  return (
    <svg ref={svgRef} className="artboard" viewBox={`0 0 ${width} ${height}`} onPointerDownCapture={onBeginTouch} onPointerDown={onStartCanvas} onPointerMove={onMovePointer} onPointerUp={onEndPointer} onPointerCancel={onEndPointer}>
      <defs>{displayedShapes.map((shape) => <CanvasShapeDefs key={`defs-${shape.id}`} shape={shape} />)}</defs>
      <rect data-canvas="true" width={width} height={height} fill={background} />
      {displayedShapes.map((shape) => <CanvasShapeLayer key={shape.id} shape={shape} active={selectedId === shape.id && !shape.locked} inverseZoom={inverseZoom} onStartMove={onStartMove} onStartHandle={onStartHandle} />)}
      {selected?.keyframes && selected.keyframes.length > 1 && <g className="motion-path">
        <polyline points={[...selected.keyframes].sort((a, b) => a.time - b.time).map((frame) => `${frame.x + frame.w / 2},${frame.y + frame.h / 2}`).join(" ")} />
        {selected.keyframes.map((frame) => <circle key={frame.time} cx={frame.x + frame.w / 2} cy={frame.y + frame.h / 2} r="11" />)}
      </g>}
      {guides.x !== undefined && <line className="alignment-guide" x1={guides.x} x2={guides.x} y1="0" y2={height} />}
      {guides.y !== undefined && <line className="alignment-guide" x1="0" x2={width} y1={guides.y} y2={guides.y} />}
      {guides.angle !== undefined && selected && <g className="angle-badge" transform={`translate(${selected.x + selected.w / 2 - 42} ${selected.y + selected.h / 2 - 22})`}><rect width="84" height="44" rx="22" /><text x="42" y="29" textAnchor="middle">{guides.angle}°</text></g>}
      {alignedParts?.card && alignedParts.badge && alignedParts.letter && alignedParts.text && (() => {
        const { card, badge, letter, text } = alignedParts;
        const centerY = card.y + card.h / 2;
        const letterCenterX = letter.x + letter.w / 2;
        const letterCenterY = letter.y + letter.h / 2;
        return <g className="alignment-audit-overlay" pointerEvents="none">
          <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={card.radius} />
          <line x1={card.x - 24} y1={centerY} x2={card.x + card.w + 24} y2={centerY} />
          <circle cx={badge.x + badge.w / 2} cy={badge.y + badge.h / 2} r={badge.w / 2 + 8} />
          <line x1={letterCenterX - 22} y1={letterCenterY} x2={letterCenterX + 22} y2={letterCenterY} />
          <line x1={letterCenterX} y1={letterCenterY - 22} x2={letterCenterX} y2={letterCenterY + 22} />
          <line x1={text.x} y1={card.y + 12} x2={text.x} y2={card.y + card.h - 12} />
          <text x={card.x + card.w - 8} y={card.y - 12} textAnchor="end">MODO PRECISÃO</text>
        </g>;
      })()}
    </svg>
  );
}
