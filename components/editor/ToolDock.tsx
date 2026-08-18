import type { Tool } from "@/app/types";
import { Icon } from "@/components/editor/Icon";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type ToolDockProps = {
  tool: Tool;
  textOpen: boolean;
  backgroundOpen: boolean;
  layersOpen: boolean;
  aiOpen: boolean;
  audioOpen: boolean;
  onSelectTool: (tool: Tool) => void;
  onAddText: () => void;
  onImportImage: () => void;
  onToggleBackground: () => void;
  onToggleLayers: () => void;
  onToggleAI: () => void;
  onToggleAudio: () => void;
};

export const ToolDock = benchmarkMemo(function ToolDock({ tool, textOpen, backgroundOpen, layersOpen, aiOpen, audioOpen, onSelectTool, onAddText, onImportImage, onToggleBackground, onToggleLayers, onToggleAI, onToggleAudio }: ToolDockProps) {
  return (
    <nav className="tool-dock" aria-label="Ferramentas">
      <button data-ai-command="tool.select" className={tool === "select" ? "active" : ""} onClick={() => onSelectTool("select")}><Icon name="pointer" /><span>Selecionar</span></button>
      <button data-ai-command="tool.rect" className={tool === "rect" ? "active" : ""} onClick={() => onSelectTool("rect")}><Icon name="rect" /><span>Retângulo</span></button>
      <button data-ai-command="tool.ellipse" className={tool === "ellipse" ? "active" : ""} onClick={() => onSelectTool("ellipse")}><Icon name="circle" /><span>Círculo</span></button>
      <button data-ai-command="add.text" className={textOpen ? "active" : ""} onClick={onAddText}><Icon name="text" /><span>Texto</span></button>
      <button data-ai-command="import.image" onClick={onImportImage}><Icon name="image" /><span>Imagem</span></button>
      <button data-ai-command="screen.audio" className={audioOpen ? "active audio-tool" : "audio-tool"} onClick={onToggleAudio}><Icon name="audio" /><span>Áudio</span></button>
      <button data-ai-command="screen.background" className={backgroundOpen ? "active" : ""} onClick={onToggleBackground}><Icon name="bucket" /><span>Fundo</span></button>
      <button data-ai-command="screen.layers" className={layersOpen ? "active" : ""} onClick={onToggleLayers}><Icon name="layers" /><span>Camadas</span></button>
      <button data-ai-command="screen.ai" className={aiOpen ? "active ai-tool" : "ai-tool"} aria-label="Central IA" onClick={onToggleAI}><Icon name="ai" /><span>IA</span></button>
    </nav>
  );
});
