import { memo } from "react";

export type IconName = "pointer" | "rect" | "circle" | "bucket" | "undo" | "redo" | "trash" | "export" | "copy" | "stroke" | "image" | "layers" | "text" | "audio" | "ai";

export const Icon = memo(function Icon({ name }: { name: IconName }) {
  if (name === "rect") return <span className="shape-icon rect-icon" />;
  if (name === "circle") return <span className="shape-icon circle-icon" />;
  if (name === "pointer") return <span className="pointer-icon">↖</span>;
  if (name === "bucket") return <span className="bucket-icon">◒</span>;
  if (name === "undo") return <span className="line-icon">↶</span>;
  if (name === "redo") return <span className="line-icon">↷</span>;
  if (name === "trash") return <span className="line-icon small">⌫</span>;
  if (name === "copy") return <span className="copy-icon">⧉</span>;
  if (name === "stroke") return <span className="stroke-icon">□</span>;
  if (name === "image") return <span className="image-icon">▧</span>;
  if (name === "layers") return <span className="layers-icon">≡</span>;
  if (name === "text") return <span className="text-icon">T</span>;
  if (name === "audio") return <span className="audio-icon">♫</span>;
  if (name === "ai") return <span className="ai-icon">✦</span>;
  return <span className="export-icon">↑</span>;
});
