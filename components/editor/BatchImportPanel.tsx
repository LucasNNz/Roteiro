"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { attachBatchZip } from "@/lib/batch/assets";
import { BATCH_TXT_EXAMPLE, parseBatchQuizText, type BatchQuizPlan, type BatchQuizQuestion } from "@/lib/batch/parser";

type BatchImportPanelProps = { onClose: () => void; onApply: (plan: BatchQuizPlan) => Promise<void> };

function imageStats(question: BatchQuizQuestion) {
  const refs = [question.imageFile, question.image1File, question.image2File, question.resultImageFile].filter(Boolean).length;
  const attached = [question.imageSrc, question.image1Src, question.image2Src, question.resultImageSrc].filter(Boolean).length;
  return { refs, attached };
}

function kindLabel(question: BatchQuizQuestion) {
  if (question.kind === "three_options") return "3 opções";
  if (question.kind === "true_false") return "Verdadeiro/Falso";
  if (question.kind === "emoji_quiz") return "Descubra pelos Emojis";
  if (question.kind === "find_thief") return "Game · Ache o Ladrão";
  if (question.kind === "chase_lr") return "Game · Perseguição";
  return "Qual Você Prefere";
}

function questionDetail(question: BatchQuizQuestion) {
  if (question.kind === "emoji_quiz") return `resultado: ${question.resultText || "—"}`;
  if (question.kind === "would_you_rather") return `${question.answers.A || "—"} × ${question.answers.B || "—"}`;
  if (question.kind === "find_thief" || question.kind === "chase_lr") return `correta: ${String(question.correct).toUpperCase()} · ${question.outcome === "wrong" ? "resultado errado" : "resultado correto"}`;
  return `correta: ${String(question.correct).toUpperCase()}`;
}

export function BatchImportPanel({ onClose, onApply }: BatchImportPanelProps) {
  const [txtName, setTxtName] = useState("");
  const [txtText, setTxtText] = useState("");
  const [zipName, setZipName] = useState("");
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null);
  const [plan, setPlan] = useState<BatchQuizPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!txtText) { setPlan(null); return; }
    let next = parseBatchQuizText(txtText);
    if (zipBytes) next = attachBatchZip(next, zipBytes);
    else if (next.questions.some((question) => imageStats(question).refs > 0)) next = { ...next, issues: [...next.issues, { level: "error", message: "Adicione o ZIP com as imagens indicadas no TXT." }] };
    setPlan(next);
    setMessage("");
  }, [txtText, zipBytes]);

  const errorCount = plan?.issues.filter((issue) => issue.level === "error").length ?? 0;
  const imageCount = plan?.questions.reduce((sum, question) => sum + imageStats(question).attached, 0) ?? 0;
  const sceneCount = useMemo(() => {
    if (!plan) return 0;
    const contentScenes = plan.questions.reduce((sum, question) => sum + (question.kind === "would_you_rather" ? 1 : 2), 0);
    const introScenes = plan.includeIntro ? 1 : 0;
    const transitionScenes = plan.includeTransitions ? Math.max(0, plan.questions.length - 1) + (plan.includeIntro ? 1 : 0) : 0;
    return contentScenes + introScenes + transitionScenes;
  }, [plan]);

  async function readTxt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setTxtName(file.name);
    setTxtText(await file.text());
  }

  async function readZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) { setMessage("O ZIP ultrapassa o limite de 80 MB."); return; }
    setZipName(file.name);
    setZipBytes(new Uint8Array(await file.arrayBuffer()));
  }

  function downloadExample() {
    const url = URL.createObjectURL(new Blob([BATCH_TXT_EXAMPLE], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-lote-corvoquiz.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function apply() {
    if (!plan || errorCount) return;
    setBusy(true); setMessage("Montando todas as cenas…");
    try { await onApply(plan); }
    catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : "Não foi possível criar o lote."); }
  }

  return <section className="batch-import-backdrop" aria-label="Importar quiz em lote" onClick={(event) => event.stopPropagation()}>
    <div className="batch-import-panel">
      <header><div><small>PRODUÇÃO AUTOMÁTICA</small><strong>IMPORTAR LOTE</strong><span>TXT + ZIP → cenas sincronizadas</span></div><button aria-label="Fechar importação em lote" onClick={onClose}>×</button></header>
      <div className="batch-import-files">
        <label className={txtName ? "ready" : ""}><input type="file" accept=".txt,text/plain" onChange={(event) => { void readTxt(event); }} /><i>TXT</i><span><strong>{txtName || "Roteiro do quiz"}</strong><small>Perguntas, alternativas e respostas</small></span><b>{txtName ? "✓" : "＋"}</b></label>
        <label className={zipName ? "ready" : ""}><input type="file" accept=".zip,application/zip" onChange={(event) => { void readZip(event); }} /><i>ZIP</i><span><strong>{zipName || "Imagens do lote"}</strong><small>Até 250 arquivos citados no roteiro</small></span><b>{zipName ? "✓" : "＋"}</b></label>
      </div>
      <button className="batch-example" onClick={downloadExample}>Baixar modelo de TXT</button>
      {plan && <>
        <div className={`batch-summary${errorCount ? " error" : " ready"}`}><span><strong>{plan.questions.length}</strong><small>perguntas</small></span><span><strong>{imageCount}</strong><small>imagens</small></span><span><strong>{sceneCount}</strong><small>cenas</small></span><span><strong>{errorCount}</strong><small>pendências</small></span></div>
        <div className="batch-question-list">{plan.questions.map((question) => {
          const stats = imageStats(question);
          const imageClass = stats.refs ? stats.attached === stats.refs ? "ok" : "missing" : "none";
          const imageText = stats.refs ? `${stats.attached}/${stats.refs} IMG${stats.attached === stats.refs ? " ✓" : " !"}` : "SEM IMG";
          return <article key={question.number}>
            <i>{String(question.number).padStart(2, "0")}</i><span><strong>{question.question || "Pergunta sem texto"}</strong><small>{kindLabel(question)} · {questionDetail(question)}</small></span><b className={imageClass}>{imageText}</b>
          </article>;
        })}</div>
        {!!plan.issues.length && <div className="batch-issues">{plan.issues.map((issue, index) => <p className={issue.level} key={`${issue.message}-${index}`}><i>{issue.level === "error" ? "!" : "•"}</i>{issue.question ? `Pergunta ${issue.question}: ` : ""}{issue.message}</p>)}</div>}
      </>}
      {message && <p className="batch-message">{message}</p>}
      <footer><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!plan || Boolean(errorCount) || busy} onClick={() => { void apply(); }}>{busy ? "Criando…" : `Substituir cenas e criar ${sceneCount || ""}`}</button></footer>
      <p className="batch-safety">As cenas atuais serão substituídas. Seus presets e associações de áudio serão mantidos.</p>
    </div>
  </section>;
}
