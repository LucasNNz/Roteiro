"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  allCandidateUrls,
  buildFormaSelections,
  candidateUrl,
  CORVO_COLLECTOR_EXTENSION_ID,
  parseGuideText,
  rankGroups,
  sendCollectorMessage,
  type RankedGroup,
  type SelectionMode,
  type SourceMode,
} from "../lib/corvo-collector";
import { dispatchCorvoBridge } from "../lib/corvo-bridge";

type Format = "REELS" | "VÍDEO COMPLETO";
type Quantity = "1 VÍDEO" | "LOTE";
type Mode = "RÁPIDO" | "PESQUISAR ANTES";
type ImagePhase = "connecting" | "searching" | "review" | "packaging" | "done" | "error";
type CorvoIdea = { tema:string; titulo:string };
type Project = {
  id:string; title:string; topic:string; format:Format; quantity:Quantity; mode:Mode;
  stage:number; createdAt:string; packageCode?:string; imageCount?:number;
};
type CollectorSettings = {
  selectionMode:SelectionMode; sourceMode:SourceMode; maxCandidates:number; scrollSteps:number;
  extensionId:string; prefix:string; jpegQuality:number; batchText:string;
};

const initialProjects:Project[] = [
  { id:"DESERTO_SOBREVIVENCIA_01", title:"VOCÊ SOBREVIVERIA NO DESERTO?", topic:"sobrevivência no deserto", format:"REELS", quantity:"1 VÍDEO", mode:"RÁPIDO", stage:4, createdAt:"HOJE, 10:42" },
  { id:"ANIMAIS_IMPOSSIVEIS_02", title:"QUAL ANIMAL FARIA ISSO?", topic:"animais curiosos", format:"REELS", quantity:"LOTE", mode:"PESQUISAR ANTES", stage:2, createdAt:"ONTEM, 18:15" },
];
const defaultSettings:CollectorSettings = { selectionMode:"MANUAL", sourceMode:"MIXED", maxCandidates:120, scrollSteps:20, extensionId:CORVO_COLLECTOR_EXTENSION_ID, prefix:"video1_", jpegQuality:.92, batchText:"" };
const steps = ["IDEIA", "ROTEIRO", "PROMPTS", "IMAGENS", "FORMA"];
const wait = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));

function safeLoad<T>(key:string, fallback:T):T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}
function slugify(value:string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36);
}
function defaultQueries(project:Project) {
  const subject = project.topic;
  return [
    { id:"01", query:`${subject} cena principal ilustração limpa` },
    { id:"02", query:`${subject} situação visual fundo simples` },
    { id:"03", query:`${subject} composição para quiz sem texto` },
    { id:"04", query:`${subject} imagem clara alta qualidade` },
  ];
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>(() => safeLoad("corvoquiz-projects-v02", initialProjects));
  const [activeId, setActiveId] = useState(() => safeLoad<Project[]>("corvoquiz-projects-v02", initialProjects)[0]?.id || initialProjects[0].id);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [format, setFormat] = useState<Format>("REELS");
  const [quantity, setQuantity] = useState<Quantity>("1 VÍDEO");
  const [mode, setMode] = useState<Mode>("RÁPIDO");
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState<CorvoIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<number|null>(null);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaMessage, setIdeaMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<CollectorSettings>(() => ({ ...defaultSettings, ...safeLoad("corvo-collector-settings-v02", defaultSettings) }));
  const [imagePhase, setImagePhase] = useState<ImagePhase>("connecting");
  const [imageMessage, setImageMessage] = useState("Preparando o Corvo Collector...");
  const [imageProgress, setImageProgress] = useState(0);
  const [groups, setGroups] = useState<RankedGroup[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [candidatePos, setCandidatePos] = useState(0);
  const [searchingMore, setSearchingMore] = useState(false);
  const [packageCode, setPackageCode] = useState("");
  const runToken = useRef(0);
  const ideaRunToken = useRef(0);

  useEffect(() => { localStorage.setItem("corvoquiz-projects-v02", JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem("corvo-collector-settings-v02", JSON.stringify(settings)); }, [settings]);
  const active = useMemo(() => projects.find((project) => project.id === activeId) || projects[0], [projects, activeId]);
  const currentGroup = groups[groupIndex];
  const currentRank = currentGroup?.ranked[candidatePos];

  function createProject() {
    const idea = selectedIdea === null ? null : ideas[selectedIdea];
    const finalTopic = idea?.tema || topic.trim();
    if (!finalTopic) { setNotice("ESCOLHA UMA IDEIA OU INFORME UM TEMA."); return; }
    const finalTitle = idea?.titulo || `NOVO QUIZ: ${finalTopic.toUpperCase()}`;
    const id = `${slugify(finalTitle || finalTopic)}_${String(projects.length + 1).padStart(2, "0")}`;
    const project:Project = { id, title:finalTitle.toUpperCase(), topic:finalTopic, format, quantity, mode, stage:1, createdAt:"AGORA" };
    setProjects((current) => [project, ...current]); setActiveId(id); setTopic(""); setIdeas([]); setSelectedIdea(null); setCreateOpen(false); setNotice("");
  }

  async function generateCorvoIdeas() {
    if (ideaLoading) return;
    const token = ++ideaRunToken.current;
    setIdeaLoading(true); setIdeaMessage("PREPARANDO O PEDIDO..."); setSelectedIdea(null); setNotice("");
    try {
      const response = await fetch("/api/corvo/job", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          tema:topic.trim() || null, format, quantity, mode,
          recentes:projects.slice(0, 12).map((project) => ({ titulo:project.title, tema:project.topic })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.jobId || !result?.prompt) throw new Error(result?.message || "O Corvo não conseguiu criar o trabalho.");
      setIdeaMessage("ENVIANDO AO CORVO EM SEGUNDO PLANO...");
      await dispatchCorvoBridge({
        jobId:result.jobId,
        prompt:result.prompt,
        specialist:"SCOUT",
        meta:{ format, quantity, mode },
      });
      setIdeaMessage("O CORVO ESTÁ CRIANDO AS OPÇÕES...");

      for (let attempt = 0; attempt < 180 && token === ideaRunToken.current; attempt++) {
        await wait(2000);
        const statusResponse = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(result.jobId)}`, { cache:"no-store" });
        const status = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(status?.message || "Não foi possível acompanhar o trabalho.");
        if (status.status === "DONE") {
          if (!Array.isArray(status.ideias) || !status.ideias.length) throw new Error("O Corvo não retornou ideias válidas.");
          setIdeas(status.ideias); setTopic(""); setSelectedIdea(null); setIdeaMessage("");
          return;
        }
        if (status.status === "ERROR") throw new Error(status?.message || "O Corvo não conseguiu concluir o trabalho.");
      }
      throw new Error("O Corvo ainda não respondeu. Tente novamente em alguns instantes.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "NÃO FOI POSSÍVEL GERAR AS IDEIAS.";
      const friendly = message.includes("CORVO_BRIDGE_NOT_AVAILABLE")
        ? "CORVO BRIDGE NÃO ENCONTRADO. INSTALE A EXTENSÃO INCLUÍDA NO PACOTE."
        : message.includes("GPT_URL_NOT_CONFIGURED")
          ? "CONFIGURE A URL DO GPT NAS OPÇÕES DO CORVO BRIDGE."
          : message.includes("GPT_SEND_FAILED")
            ? "O BRIDGE PREENCHEU A MENSAGEM, MAS O CHATGPT NÃO CONFIRMOU O ENVIO. TENTE NOVAMENTE."
            : message;
      setNotice(friendly.toUpperCase());
      setTimeout(() => setNotice(""), 5200);
    } finally {
      if (token === ideaRunToken.current) { setIdeaLoading(false); setIdeaMessage(""); }
    }
  }

  async function downloadProject(project:Project) {
    const zip = new JSZip();
    zip.file("projeto.json", JSON.stringify(project, null, 2));
    zip.folder("roteiro")?.file(`${project.id}.txt`, `PROJETO: ${project.id}\nENTRADA: NAO\nTRANSICOES: SIM\n`);
    zip.folder("prompts")?.file(`PROMPTS_${project.id}.txt`, defaultQueries(project).map((item) => item.query).join("\n\n"));
    zip.folder("forma")?.file("PACOTE.txt", project.packageCode ? `PACOTE_CODE=${project.packageCode}` : "O pacote de imagens ainda não foi concluído.");
    const blob = await zip.generateAsync({ type:"blob" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${project.id}.zip`; link.click(); URL.revokeObjectURL(url);
  }

  function friendlyError(error:unknown) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("ORIGIN_NOT_AUTHORIZED")) return "Autorize este endereço uma única vez no Corvo Collector e tente novamente.";
    if (message.includes("COLLECTOR_NOT_AVAILABLE") || message.includes("Receiving end does not exist")) return "O Corvo Collector não foi encontrado. Instale ou atualize a extensão incluída no pacote.";
    if (message.includes("JOB_ALREADY_RUNNING")) return "Já existe uma busca em andamento. Aguarde um pouco e tente novamente.";
    return message || "Não foi possível concluir esta etapa.";
  }

  async function startImageFlow() {
    if (!active) return;
    const token = ++runToken.current;
    setImageOpen(true); setImagePhase("connecting"); setImageProgress(4); setImageMessage("Conectando ao coletor..."); setGroups([]); setPackageCode("");
    try {
      const ping = await sendCollectorMessage<{ok?:boolean;authorized?:boolean;error?:string}>("PING", undefined, settings.extensionId);
      if (!ping?.ok) throw new Error(ping?.error || "COLLECTOR_CONNECTION_ERROR");
      if (ping.authorized === false) throw new Error("ORIGIN_NOT_AUTHORIZED");
      if (token !== runToken.current) return;
      const items = settings.batchText.trim() ? parseGuideText(settings.batchText) : defaultQueries(active);
      setImagePhase("searching"); setImageProgress(8); setImageMessage(`Buscando imagens para ${items.length} cenas...`);
      const started = await sendCollectorMessage<{ok?:boolean;error?:string}>("START_JOB", {
        items, maxCandidates:settings.maxCandidates, scrollSteps:settings.scrollSteps, sourceMode:settings.sourceMode,
        backgroundTab:true, closeTabOnFinish:true,
      }, settings.extensionId);
      if (!started?.ok) throw new Error(started?.error || "Falha ao iniciar a busca.");

      let finalJob:any = null;
      for (let attempt = 0; attempt < 180 && token === runToken.current; attempt++) {
        await wait(1000);
        const response = await sendCollectorMessage<any>("GET_STATUS", undefined, settings.extensionId);
        const job = response?.job;
        const total = Number(job?.progress?.total || items.length);
        const current = Number(job?.progress?.current || 0);
        const completed = Number(job?.summary?.completed || 0);
        setImageProgress(Math.max(10, Math.min(82, ((completed + (current ? .35 : 0)) / Math.max(1, total)) * 78 + 8)));
        setImageMessage(job?.progress?.query ? `Buscando: ${job.progress.query}` : "A busca continua em segundo plano...");
        if (job?.status === "DONE") { finalJob = (await sendCollectorMessage<any>("GET_RESULT", undefined, settings.extensionId))?.job; break; }
        if (["ERROR", "CANCELLED"].includes(job?.status)) throw new Error(job?.error || "A busca foi interrompida.");
      }
      if (!finalJob?.results) throw new Error("Tempo esgotado aguardando as imagens.");
      const ranked = rankGroups(finalJob.results);
      if (!ranked.length || ranked.some((group) => !group.ranked.length)) throw new Error("Uma ou mais cenas não retornaram imagens utilizáveis.");
      setGroups(ranked); setGroupIndex(0); setCandidatePos(0);
      if (settings.selectionMode === "MANUAL") { setImagePhase("review"); setImageProgress(84); setImageMessage("Escolha rapidamente uma imagem por cena."); }
      else await buildPackage(ranked, token);
    } catch (error) {
      if (token !== runToken.current) return;
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
    }
  }

  async function buildPackage(selectedGroups:RankedGroup[], token = runToken.current) {
    if (!active) return;
    setImagePhase("packaging"); setImageProgress(88); setImageMessage("Organizando e nomeando as imagens...");
    try {
      const selections = buildFormaSelections(selectedGroups, settings.prefix);
      const response = await sendCollectorMessage<any>("BUILD_FORMA_PACKAGE", {
        selections, productionId:active.id, prefix:settings.prefix, jpegQuality:settings.jpegQuality,
        fileName:`${active.id}_FORMA.zip`, includeManifest:true, autoDownload:false,
      }, settings.extensionId);
      if (!response?.ok) throw new Error(response?.error || "Falha ao montar o pacote.");
      const code = response.packageCode || "";
      for (let attempt = 0; attempt < 120 && token === runToken.current; attempt++) {
        await wait(700);
        const status = (await sendCollectorMessage<any>("GET_PACKAGE_STATUS", undefined, settings.extensionId))?.package;
        const total = Number(status?.total || selections.length); const current = Number(status?.current || 0);
        setImageProgress(Math.max(88, Math.min(99, 88 + (current / Math.max(1, total)) * 11)));
        setImageMessage(status?.currentName ? `Preparando ${status.currentName}` : "Finalizando o pacote...");
        if (status?.status === "DONE") {
          const finalCode = status.packageCode || code;
          setPackageCode(finalCode); setImagePhase("done"); setImageProgress(100); setImageMessage("Imagens prontas para o Forma.");
          setProjects((currentProjects) => currentProjects.map((project) => project.id === active.id ? { ...project, stage:5, packageCode:finalCode, imageCount:status.success || selections.length } : project));
          return;
        }
        if (status?.status === "ERROR") throw new Error(status.error || "Falha no pacote.");
      }
      throw new Error("Tempo esgotado montando o pacote.");
    } catch (error) {
      if (token !== runToken.current) return;
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
    }
  }

  function useCurrentCandidate() {
    if (!currentGroup || !currentRank) return;
    const next = groups.map((group, index) => index === groupIndex ? { ...group, principalIndex:currentRank.index, reserveIndices:group.ranked.filter((item) => item.index !== currentRank.index).slice(0, 2).map((item) => item.index), selectionMode:"MANUAL" as const } : group);
    setGroups(next);
    if (groupIndex >= next.length - 1) buildPackage(next);
    else { setGroupIndex((value) => value + 1); setCandidatePos(0); setImageProgress(84 + ((groupIndex + 1) / next.length) * 4); }
  }

  async function searchMore() {
    if (!currentGroup || searchingMore) return;
    setSearchingMore(true);
    try {
      const response = await sendCollectorMessage<any>("SEARCH_MORE_GROUP", {
        id:currentGroup.id, query:currentGroup.query, sourceMode:settings.sourceMode,
        maxCandidates:settings.maxCandidates, scrollSteps:settings.scrollSteps, backgroundTab:true, closeTabOnFinish:true,
        excludeUrls:allCandidateUrls(currentGroup),
      }, settings.extensionId);
      if (!response?.ok || !response?.group?.candidates?.length) throw new Error(response?.error || "Nenhuma imagem nova foi encontrada.");
      const fresh = rankGroups([response.group])[0];
      setGroups((current) => current.map((group, index) => index === groupIndex ? fresh : group)); setCandidatePos(0);
    } catch (error) { setNotice(friendlyError(error)); setTimeout(() => setNotice(""), 3800); }
    finally { setSearchingMore(false); }
  }

  async function cancelImageFlow() {
    runToken.current += 1;
    await sendCollectorMessage("CANCEL_JOB", undefined, settings.extensionId).catch(() => {});
    setImageOpen(false);
  }

  async function savePackageCopy() {
    const response = await sendCollectorMessage<any>("SAVE_PACKAGE_AS", undefined, settings.extensionId).catch((error) => ({ ok:false, error:friendlyError(error) }));
    setNotice(response?.ok ? "ESCOLHA ONDE SALVAR A CÓPIA DO PACOTE." : friendlyError(response?.error)); setTimeout(() => setNotice(""), 3800);
  }

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark">C</span><span><strong>CORVO</strong>QUIZ <small>PRODUÇÃO</small></span></a>
      <nav className="nav-links"><a className="active" href="#producao">PRODUÇÃO</a><a href="#projetos">PROJETOS</a><a href="#arquivos">ARQUIVOS</a></nav>
      <div className="header-actions"><button className="corvo-link" onClick={() => setCreateOpen(true)}><span className="online-dot" /> PEDIR IDEIAS AO CORVO</button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Configurações">•••</button></div>
    </header>

    <section className="hero" id="top"><div><span className="eyebrow"><i /> CENTRAL DE PRODUÇÃO</span><h1>DA IDEIA AO <em>PACOTE FINAL.</em></h1><p>O Corvo cuida da pesquisa, das imagens e da organização.<br />Você só acompanha, escolhe e aprova.</p></div><button className="new-project" onClick={() => setCreateOpen(true)}><span>＋</span><b>NOVA PRODUÇÃO</b><small>COMEÇAR DO ZERO</small></button></section>

    <section className="workspace" id="producao">
      <div className="section-heading"><div><span className="section-number">01</span><h2>EM PRODUÇÃO</h2></div><button className="text-button" onClick={() => setCreateOpen(true)}>CRIAR OUTRA <span>↗</span></button></div>
      {active && <article className="production-card">
        <div className="card-main">
          <div className="project-meta"><span className="format-tag">{active.format}</span><span>{active.quantity}</span><span>{active.createdAt}</span></div>
          <h3>{active.title}</h3><p>{active.id}</p>
          <div className="stepper">{steps.map((step,index) => { const complete=index+1<active.stage; const current=index+1===active.stage; return <div className={`step ${complete?"complete":""} ${current?"current":""}`} key={step}><span>{complete?"✓":String(index+1).padStart(2,"0")}</span><small>{step}</small></div>; })}</div>
          <div className="card-actions">
            <button className="primary-action" onClick={() => active.stage===4 ? startImageFlow() : setProjects((current) => current.map((project) => project.id===active.id ? {...project,stage:Math.min(5,project.stage+1)} : project))}>{active.stage===4?"BUSCAR IMAGENS":active.stage===5?"ABRIR PRODUÇÃO":"CONTINUAR PRODUÇÃO"} <span>→</span></button>
            <button className="secondary-action" onClick={() => downloadProject(active)}>↓ BAIXAR PROJETO</button>
          </div>
        </div>
        <aside className="card-side" id="arquivos">
          <div className="mini-title"><span>ARQUIVOS</span><b>{active.stage>=5?"4/4":"2/4"}</b></div>
          <div className="file-row done"><span>▤</span><div><b>ROTEIRO.TXT</b><small>REVISADO</small></div><i>✓</i></div>
          <div className="file-row done"><span>✦</span><div><b>PROMPTS.TXT</b><small>PRONTO PARA BUSCA</small></div><i>✓</i></div>
          {active.packageCode ? <button className="package-ready" onClick={() => setImageOpen(true)}><span>✓</span><div><b>IMAGENS PRONTAS</b><small>{active.imageCount || 0} ARQUIVOS · {active.packageCode}</small></div></button> : <button className="collector-box" onClick={startImageFlow}><span>⌁</span><b>BUSCAR COM O CORVO</b><small>TRABALHA EM SEGUNDO PLANO</small></button>}
        </aside>
      </article>}
    </section>

    <section className="projects" id="projetos"><div className="section-heading"><div><span className="section-number">02</span><h2>PROJETOS RECENTES</h2></div><span className="project-count">{String(projects.length).padStart(2,"0")} PRODUÇÕES</span></div><div className="project-list">{projects.map((project) => <button className={`project-row ${project.id===activeId?"selected":""}`} key={project.id} onClick={() => setActiveId(project.id)}><span className="project-icon">{project.format==="REELS"?"▯":"▭"}</span><span className="project-name"><b>{project.title}</b><small>{project.id}</small></span><span className="project-format">{project.format}</span><span className="progress"><i style={{width:`${project.stage*20}%`}} /></span><span className="stage-label">ETAPA {project.stage}/5</span><span className="row-arrow">→</span></button>)}</div></section>
    <footer><span>CORVOQUIZ PRODUÇÃO <i>V0.5.6</i></span><span>IDEIA → ROTEIRO → PROMPTS → IMAGENS → FORMA</span></footer>
    {notice && <div className="toast">{notice}</div>}

    {createOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target===event.currentTarget&&setCreateOpen(false)}><section className="creation-modal idea-modal" role="dialog" aria-modal="true" aria-labelledby="new-production-title"><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Fechar">×</button><div className="modal-symbol">✦</div><span className="modal-kicker">NOVA PRODUÇÃO</span><h2 id="new-production-title">O QUE VAMOS CRIAR?</h2><p>Comece sem tema e peça ideias ao Corvo, ou informe uma direção opcional.</p>
      <div className="field-group"><label>FORMATO</label><div className="segmented">{(["REELS","VÍDEO COMPLETO"] as Format[]).map((item)=><button className={format===item?"selected":""} onClick={()=>setFormat(item)} key={item}>{item}</button>)}</div></div>
      <div className="modal-grid"><div className="field-group"><label>QUANTIDADE</label><div className="segmented compact">{(["1 VÍDEO","LOTE"] as Quantity[]).map((item)=><button className={quantity===item?"selected":""} onClick={()=>setQuantity(item)} key={item}>{item}</button>)}</div></div><div className="field-group"><label>MODO</label><div className="segmented compact">{(["RÁPIDO","PESQUISAR ANTES"] as Mode[]).map((item)=><button className={mode===item?"selected":""} onClick={()=>setMode(item)} key={item}>{item}</button>)}</div></div></div>
      <div className="field-group topic-field"><label>TEMA OPCIONAL</label><input value={topic} onChange={(event)=>{setTopic(event.target.value);setSelectedIdea(null);}} onKeyDown={(event)=>event.key==="Enter"&&createProject()} placeholder="SEM TEMA SELECIONADO" /></div>
      {ideas.length ? <div className="idea-results"><div className="idea-results-head"><span>IDEIAS DO CORVO</span><small>ESCOLHA UMA</small></div>{ideas.map((idea,index)=><button className={`idea-card ${selectedIdea===index?"selected":""}`} onClick={()=>{setSelectedIdea(index);setTopic("");}} key={`${idea.titulo}-${index}`}><span>{String(index+1).padStart(2,"0")}</span><div><b>{idea.titulo}</b><small>{idea.tema}</small></div><i>{selectedIdea===index?"✓":"→"}</i></button>)}</div> : <button className="empty-theme selected" onClick={()=>{setTopic("");setSelectedIdea(null);}}><span>○</span><div><b>SEM TEMA SELECIONADO</b><small>O CORVO PODE CRIAR AS OPÇÕES PARA VOCÊ</small></div><i>PADRÃO</i></button>}
      <button className={`corvo-ideas ${selectedIdea===null&&!topic.trim()?"primary":""} ${ideaLoading?"loading":""}`} onClick={generateCorvoIdeas} disabled={ideaLoading}><span className={ideaLoading?"idea-spinner":"online-dot"} /> {ideaLoading?(ideaMessage||"CORVO ESTÁ CRIANDO..."):ideas.length?"GERAR NOVAS IDEIAS":"GERAR IDEIAS COM O CORVO"} <i>{ideaLoading?"":"✦"}</i></button>
      {(selectedIdea!==null||topic.trim())&&<button className="modal-submit" onClick={createProject}>{selectedIdea!==null?"USAR ESTA IDEIA":"COMEÇAR COM ESTE TEMA"} <span>→</span></button>}
      <small className="idea-return-note">O BRIDGE ENVIA AO GPT EM SEGUNDO PLANO. A ACTION DEVOLVE AS IDEIAS DIRETAMENTE A ESTE MODAL.</small>
    </section></div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setSettingsOpen(false)}><section className="settings-modal">
      <button className="modal-close" onClick={()=>setSettingsOpen(false)} aria-label="Fechar configurações">×</button>
      <span className="modal-kicker">COMPORTAMENTO DAS IMAGENS</span><h2>COMO O CORVO DEVE ESCOLHER?</h2><p>Estas opções ficam salvas e não aparecem durante a produção.</p>
      <div className="choice-cards"><button className={settings.selectionMode==="AUTO"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"AUTO"})}><b>⚡ AUTOMÁTICO</b><small>BUSCA, ESCOLHE E ORGANIZA SOZINHO</small></button><button className={settings.selectionMode==="MANUAL"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"MANUAL"})}><b>◉ REVISÃO RÁPIDA</b><small>MOSTRA UMA IMAGEM POR CENA</small></button></div>
      <div className="field-group"><label>FONTE DA BUSCA</label><div className="segmented triple">{(["MIXED","GOOGLE","PINTEREST"] as SourceMode[]).map((item)=><button className={settings.sourceMode===item?"selected":""} onClick={()=>setSettings({...settings,sourceMode:item})} key={item}>{item==="MIXED"?"MESCLADO":item}</button>)}</div></div>
      <section className="downloads-section" aria-labelledby="downloads-title">
        <div className="downloads-head"><div><span>INSTALAÇÃO E SUPORTE</span><h3 id="downloads-title">ARQUIVOS PARA BAIXAR</h3></div><small>SE PRECISAR REINSTALAR</small></div>
        <div className="download-grid">
          <a className="download-card" href="/downloads/CORVO_COLLECTOR_V074_EXTENSION.zip" download><span>⌁</span><div><b>EXTENSÃO DE IMAGENS</b><small>CORVO COLLECTOR V0.7.4</small></div><i>↓</i></a>
          <a className="download-card" href="/downloads/CORVO_BRIDGE_V032_EXTENSION.zip" download><span>↗</span><div><b>EXTENSÃO DO BRIDGE</b><small>CORVO BRIDGE V0.3.2</small></div><i>↓</i></a>
          <a className="download-card featured" href="/downloads/CORVOQUIZ_KIT_COMPLETO_V056.zip" download><span>◆</span><div><b>KIT COMPLETO CORVOQUIZ</b><small>APP + EXTENSÕES + SCHEMA</small></div><i>↓</i></a>
        </div>
      </section>
      <details className="advanced-settings"><summary>CONFIGURAÇÕES AVANÇADAS</summary><div className="settings-grid"><label>CANDIDATAS<input type="number" value={settings.maxCandidates} onChange={(event)=>setSettings({...settings,maxCandidates:Number(event.target.value)})}/></label><label>VARREDURA<input type="number" value={settings.scrollSteps} onChange={(event)=>setSettings({...settings,scrollSteps:Number(event.target.value)})}/></label><label>QUALIDADE JPEG<input type="number" step=".01" value={settings.jpegQuality} onChange={(event)=>setSettings({...settings,jpegQuality:Number(event.target.value)})}/></label><label>PREFIXO<input value={settings.prefix} onChange={(event)=>setSettings({...settings,prefix:event.target.value})}/></label></div><label className="batch-label">COMANDOS EM LOTE — OPCIONAL<textarea value={settings.batchText} onChange={(event)=>setSettings({...settings,batchText:event.target.value})} placeholder={"01|primeira busca\n02|segunda busca"} /></label></details>
      <button className="modal-submit" onClick={()=>setSettingsOpen(false)}>SALVAR E FECHAR <span>✓</span></button>
    </section></div>}

    {imageOpen && <div className="modal-backdrop image-backdrop"><section className={`image-modal phase-${imagePhase}`}>
      <button className="modal-close" onClick={()=>imagePhase==="searching"?cancelImageFlow():setImageOpen(false)}>×</button>
      {imagePhase==="review" && currentGroup && currentRank ? <>
        <div className="review-top"><div><span className="modal-kicker">SELEÇÃO RÁPIDA · {groupIndex+1}/{groups.length}</span><h2>{currentGroup.query}</h2></div><div className="review-counter">CENA {String(groupIndex+1).padStart(2,"0")}</div></div>
        <div className="review-layout"><div className="candidate-stage"><img src={currentRank.candidate.previewUrl} alt={currentGroup.query} referrerPolicy="no-referrer" /><div className="image-quality"><span>{currentRank.candidate.width||"—"} × {currentRank.candidate.height||"—"}</span><span>OPÇÃO {candidatePos+1}/{currentGroup.ranked.length}</span></div></div><aside className="review-side"><span className="review-label">ESTA IMAGEM FUNCIONA?</span><p>Escolha rapidamente. O Corvo guarda reservas e prepara os nomes automaticamente.</p><button className="use-image" onClick={useCurrentCandidate}>✓ USAR ESTA IMAGEM</button><button className="next-image" onClick={()=>setCandidatePos((value)=>Math.min(value+1,currentGroup.ranked.length-1))}>VER PRÓXIMA <span>→</span></button><button className="search-more" disabled={searchingMore} onClick={searchMore}>{searchingMore?"PROCURANDO...":"↻ PROCURAR MAIS"}</button><div className="thumb-strip">{currentGroup.ranked.slice(0,4).map((rank,index)=><button className={candidatePos===index?"active":""} onClick={()=>setCandidatePos(index)} key={candidateUrl(rank.candidate)}><img src={rank.candidate.previewUrl} alt="" referrerPolicy="no-referrer"/></button>)}</div></aside></div>
      </> : <div className="image-status-view"><div className={`status-orb ${imagePhase}`}>{imagePhase==="done"?"✓":imagePhase==="error"?"!":"⌁"}</div><span className="modal-kicker">{imagePhase==="connecting"?"CONECTANDO":imagePhase==="searching"?"BUSCANDO IMAGENS":imagePhase==="packaging"?"ORGANIZANDO":imagePhase==="done"?"PACOTE PRONTO":"PRECISAMOS AJUSTAR"}</span><h2>{imagePhase==="done"?"TUDO CERTO.":imagePhase==="error"?"NÃO FOI POSSÍVEL CONTINUAR":imageMessage}</h2>{!["searching","packaging"].includes(imagePhase)&&<p>{imageMessage}</p>}<div className="image-progress"><i style={{width:`${imageProgress}%`}} /></div>{imagePhase==="searching"&&<small>A pesquisa acontece em uma aba discreta e fecha sozinha.</small>}{imagePhase==="done"&&<><div className="package-summary"><span>✓ IMAGENS</span><span>✓ NOMES CONFERIDOS</span><span>✓ PACOTE FORMA</span><b>{packageCode||active?.packageCode}</b></div><button className="modal-submit success" onClick={()=>setImageOpen(false)}>CONCLUIR ETAPA <span>→</span></button><details className="package-options"><summary>OPÇÕES DO PACOTE</summary><button onClick={savePackageCopy}>SALVAR UMA CÓPIA DO ZIP</button></details></>}{imagePhase==="error"&&<><button className="modal-submit" onClick={startImageFlow}>TENTAR NOVAMENTE <span>↻</span></button><button className="plain-close" onClick={()=>setImageOpen(false)}>FECHAR</button></>}</div>}
    </section></div>}
  </main>;
}
