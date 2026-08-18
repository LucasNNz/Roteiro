"use client";

import type { FormEvent, MouseEvent, PointerEvent } from "react";
import type { AICommand, AIResponse, AudioBindingTarget, AudioPresetBindings, SceneAudioPreset, SceneKind } from "@/app/types";
import { AI_CAPABILITIES, AI_QUICK_ACTIONS } from "@/lib/ai/contracts";
import { MAIN_SCENE_PRESETS } from "@/lib/ai/commands/main-scene-preset";
import { benchmarkMemo } from "@/lib/benchmark/memo";
import { INTRO_PRESET_ID } from "@/lib/scenes/intro-preset";
import { Icon } from "@/components/editor/Icon";

type AILogEntry = { id: string; message: string; ok: boolean };

type AIPanelProps = {
  formatRatio: string;
  width: number;
  height: number;
  layerCount: number;
  visibleLayerCount: number;
  selectionLabel: string;
  selectionPosition: string;
  duration: number;
  playbackStatus: string;
  prompt: string;
  webScript: string;
  response: AIResponse | null;
  log: AILogEntry[];
  audioPresets: SceneAudioPreset[];
  audioBindings: AudioPresetBindings;
  onBindAudio: (target: AudioBindingTarget, presetId?: string) => void;
  onStartDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onMoveDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onEndDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onResetPosition: (event: MouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  onSubmitPrompt: () => void;
  onChooseSuggestion: (value: string) => void;
  onWebScriptChange: (value: string) => void;
  onUseExample: () => void;
  onRunWebScript: () => void;
  onOpenBatchImport: () => void;
  onExecute: (command: AICommand) => void;
};

function AudioBindingSelect({ target, kind, presets, bindings, onBind }: { target: AudioBindingTarget; kind: SceneKind; presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  const compatible = presets.filter((preset) => preset.sceneKind === kind);
  return <label className={`ai-audio-binding${bindings[target] ? " active" : ""}`} title="Associar áudio a todas as cenas deste modelo">
    <span>♫</span>
    <select aria-label="Preset de áudio associado" value={bindings[target] ?? ""} onChange={(event) => onBind(target, event.target.value || undefined)}>
      <option value="">Sem áudio</option>
      {compatible.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select>
  </label>;
}

const AIQuickActions = benchmarkMemo(function AIQuickActions({ onExecute }: { onExecute: (command: AICommand) => void }) {
  return <div className="ai-quick-grid">
    {AI_QUICK_ACTIONS.map((item) => <button key={item.label} data-ai-action={item.command.action} onClick={() => onExecute(item.command)}><i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}
  </div>;
});

const AISuggestions = benchmarkMemo(function AISuggestions({ onChoose }: { onChoose: (value: string) => void }) {
  return <div className="ai-suggestions"><span>Experimente:</span><button onClick={() => onChoose("crie uma tela de quiz")}>cena completa</button><button onClick={() => onChoose("adicione uma alternativa")}>alternativa</button><button onClick={() => onChoose("anime a entrada pela esquerda")}>animar entrada</button></div>;
});

const AIIntroScenePreset = benchmarkMemo(function AIIntroScenePreset({ onExecute, presets, bindings, onBind }: { onExecute: (command: AICommand) => void; presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  return <section className="ai-intro-scene-preset" aria-label="Preset de cena de entrada">
    <button onClick={() => onExecute({ action: "create_intro_scene" })}>
      <i>▶</i><span><strong>ENTRADA</strong><small>Preset CorvoQuiz premium · 18s</small></span><b>＋</b>
    </button>
    <AudioBindingSelect target={`intro:${INTRO_PRESET_ID}`} kind="intro" presets={presets} bindings={bindings} onBind={onBind} />
  </section>;
});

const AIMainScenePresets = benchmarkMemo(function AIMainScenePresets({ onExecute, presets, bindings, onBind }: { onExecute: (command: AICommand) => void; presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  return <section className="ai-main-scene-presets" aria-label="Presets de quiz editáveis pela IA">
    <header><span><strong>PRESETS DE QUIZ</strong><small>Perguntas e resultados editáveis</small></span><b>{MAIN_SCENE_PRESETS.length} MODELOS</b></header>
    <div>{MAIN_SCENE_PRESETS.map((preset) => <article key={preset.id}>
      <button aria-label={`Inserir ${preset.label} com ${preset.duration} segundos`} data-ai-action="apply_main_scene_preset" data-preset={preset.id} onClick={() => onExecute({ action: "apply_main_scene_preset", preset: preset.id, ...(preset.id.startsWith("game_") ? { preserveContent: false } : {}) })}>
        <i className={preset.icon}><span /><span /><span /></i>
        <span><strong>{preset.shortLabel}</strong><small>{preset.description}</small></span><b>＋</b>
      </button>
      <AudioBindingSelect target={preset.id} kind={preset.kind} presets={presets} bindings={bindings} onBind={onBind} />
    </article>)}</div>
  </section>;
});

const AIQuizResult = benchmarkMemo(function AIQuizResult({ onExecute, presets, bindings, onBind }: { onExecute: (command: AICommand) => void; presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  return <section className="ai-result-picker" aria-label="Revelar resposta do quiz">
    <span><strong>REVELAR RESPOSTA</strong><small>Revelação em 1s · total 5s</small></span>
    <div>{(["A", "B", "C"] as const).map((option) => <button key={option} aria-label={`Revelar resultado ${option}`} data-ai-action="apply_quiz_result" data-answer={option} onClick={() => onExecute({ action: "apply_quiz_result", correctAnswer: option })}>{option}</button>)}</div>
    <AudioBindingSelect target="quiz_result" kind="result" presets={presets} bindings={bindings} onBind={onBind} />
  </section>;
});

const AIBinaryQuizResult = benchmarkMemo(function AIBinaryQuizResult({ onExecute, presets, bindings, onBind }: { onExecute: (command: AICommand) => void; presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  return <section className="ai-result-picker ai-binary-result-picker" aria-label="Escolher botão correto do quiz verdadeiro ou falso">
    <span><strong>RESULTADO V/F</strong><small>Funciona com qualquer texto</small></span>
    <div>
      <button className="green" aria-label="Definir botão verde como correto" data-ai-action="apply_binary_quiz_result" data-answer="green" onClick={() => onExecute({ action: "apply_binary_quiz_result", correctButton: "green" })}>VERDE</button>
      <button className="red" aria-label="Definir botão vermelho como correto" data-ai-action="apply_binary_quiz_result" data-answer="red" onClick={() => onExecute({ action: "apply_binary_quiz_result", correctButton: "red" })}>VERMELHO</button>
    </div>
    <AudioBindingSelect target="true_false_result" kind="result" presets={presets} bindings={bindings} onBind={onBind} />
  </section>;
});

const AITransitionAudio = benchmarkMemo(function AITransitionAudio({ presets, bindings, onBind }: { presets: SceneAudioPreset[]; bindings: AudioPresetBindings; onBind: (target: AudioBindingTarget, presetId?: string) => void }) {
  return <section className="ai-transition-audio"><span><strong>TRANSIÇÃO PINCEL + CORVO</strong><small>Áudio padrão para todas as transições deste modelo</small></span><AudioBindingSelect target="transition:brush-lightning" kind="transition" presets={presets} bindings={bindings} onBind={onBind} /></section>;
});

const AIWebStatus = benchmarkMemo(function AIWebStatus({ response }: { response: AIResponse | null }) {
  return <div className={`ai-web-status ${response?.ok === false ? "error" : ""}`}><i>{response ? (response.ok ? "✓" : "!") : "↔"}</i><span>{response ? `${response.results.length} comando(s) · ${response.requestId.slice(0, 8)}` : "Aguardando comunicação"}</span></div>;
});

const AIActivity = benchmarkMemo(function AIActivity({ log }: { log: AILogEntry[] }) {
  return <div className="ai-feedback">
    <div><span>ATIVIDADE DA IA</span><small>Estado em tempo real</small></div>
    {log.length ? log.slice(0, 3).map((item) => <p key={item.id} className={item.ok ? "ok" : "error"}><i>{item.ok ? "✓" : "!"}</i>{item.message}</p>) : <p className="idle"><i>•</i>Pronta para receber comandos.</p>}
  </div>;
});

const AISceneCommands = benchmarkMemo(function AISceneCommands({ onExecute }: { onExecute: (command: AICommand) => void }) {
  return <section className="ai-scene-commands" aria-label="Comandos rápidos de cenas">
    <span><strong>PROJETO EM CENAS</strong><small>Crie ou escolha a cena ativa</small></span>
    <div>
      <button onClick={() => onExecute({ action: "add_scene" })}><i>＋</i><span><b>Nova cena</b><small>Vazia · 8s</small></span></button>
      <button onClick={() => onExecute({ action: "screen", screen: "scenes" })}><i>▱</i><span><b>Selecionar</b><small>Cenas criadas</small></span></button>
    </div>
  </section>;
});

const AIBatchImport = benchmarkMemo(function AIBatchImport({ onOpen }: { onOpen: () => void }) {
  return <button className="ai-batch-import" onClick={onOpen}><i>↯</i><span><strong>IMPORTAR LOTE</strong><small>TXT + ZIP · perguntas, imagens e resultados</small></span><b>ABRIR</b></button>;
});

export const AIPanel = benchmarkMemo(function AIPanel({ formatRatio, width, height, layerCount, visibleLayerCount, selectionLabel, selectionPosition, duration, playbackStatus, prompt, webScript, response, log, audioPresets, audioBindings, onBindAudio, onStartDrag, onMoveDrag, onEndDrag, onResetPosition, onClose, onPromptChange, onSubmitPrompt, onChooseSuggestion, onWebScriptChange, onUseExample, onRunWebScript, onOpenBatchImport, onExecute }: AIPanelProps) {
  const submitPrompt = (event: FormEvent) => { event.preventDefault(); onSubmitPrompt(); };
  return <aside className="palette-sheet ai-sheet" aria-label="Central IA do Forma" onClick={(event) => event.stopPropagation()}>
    <div className="sheet-grabber" onPointerDown={onStartDrag} onPointerMove={onMoveDrag} onPointerUp={onEndDrag} onPointerCancel={onEndDrag} onDoubleClick={onResetPosition} />
    <div className="ai-heading">
      <div className="ai-orb"><Icon name="ai" /><i /></div>
      <div><small>PONTE DE COMANDO</small><strong>Central IA</strong><span><i /> Conectada e vendo o Forma</span></div>
      <button aria-label="Fechar Central IA" onClick={onClose}>×</button>
    </div>
    <div className="ai-vision">
      <div><small>CANVAS</small><strong>{formatRatio}</strong><span>{width} × {height}</span></div>
      <div><small>CAMADAS</small><strong>{layerCount}</strong><span>{visibleLayerCount} visíveis</span></div>
      <div><small>SELEÇÃO</small><strong>{selectionLabel}</strong><span>{selectionPosition}</span></div>
      <div><small>ANIMAÇÃO</small><strong>{duration.toFixed(1)}s</strong><span>{playbackStatus}</span></div>
    </div>
    <form className="ai-command-box" onSubmit={submitPrompt}>
      <span><Icon name="ai" /></span>
      <input value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder='Ex.: crie uma tela de quiz' aria-label="Comando para o Forma" />
      <button aria-label="Executar comando" disabled={!prompt.trim()}>↑</button>
    </form>
    <AISuggestions onChoose={onChooseSuggestion} />
    <AIBatchImport onOpen={onOpenBatchImport} />
    <AISceneCommands onExecute={onExecute} />
    <AIIntroScenePreset onExecute={onExecute} presets={audioPresets} bindings={audioBindings} onBind={onBindAudio} />
    <AIMainScenePresets onExecute={onExecute} presets={audioPresets} bindings={audioBindings} onBind={onBindAudio} />
    <AIQuizResult onExecute={onExecute} presets={audioPresets} bindings={audioBindings} onBind={onBindAudio} />
    <AIBinaryQuizResult onExecute={onExecute} presets={audioPresets} bindings={audioBindings} onBind={onBindAudio} />
    <AITransitionAudio presets={audioPresets} bindings={audioBindings} onBind={onBindAudio} />
    <section className="ai-web-console" aria-label="Console de comunicação web">
      <div className="ai-web-console-heading"><span><i /> COMUNICAÇÃO WEB</span><small>JSON · lote · resposta identificada</small></div>
      <textarea value={webScript} onChange={(event) => onWebScriptChange(event.target.value)} placeholder='{"action":"create_scene","scene":"quiz_question","duration":8,"background":"#18A957","animatedBackground":true}' aria-label="Comandos JSON para o Forma" spellCheck={false} />
      <div className="ai-web-console-actions">
        <button onClick={onUseExample}>Usar exemplo 8s</button>
        <button className="primary" onClick={onRunWebScript} disabled={!webScript.trim()}>Executar roteiro</button>
      </div>
      <AIWebStatus response={response} />
    </section>
    <div className="ai-section-title"><span>AÇÕES DIRETAS</span><small>{Object.values(AI_CAPABILITIES.commands).flat().length} comandos expostos</small></div>
    <AIQuickActions onExecute={onExecute} />
    <AIActivity log={log} />
  </aside>;
});
