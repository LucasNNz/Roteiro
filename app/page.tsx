"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  allCandidateUrls,
  buildAnalystRawSelections,
  buildFormaSelections,
  candidateUrl,
  CORVO_COLLECTOR_EXTENSION_ID,
  parseGuideText,
  rankGroups,
  sendCollectorMessage,
  type GuideItem,
  type RankedGroup,
  type SelectionMode,
  type SourceMode,
} from "../lib/corvo-collector";
import { captureCorvoBridgeFile, completeCorvoBridgeJob, dispatchCorvoBridge } from "../lib/corvo-bridge";

type Format = "REELS" | "VÍDEO COMPLETO";
type Quantity = "1 VÍDEO" | "LOTE";
type Mode = "RÁPIDO" | "PESQUISAR ANTES";
type ImagePhase = "connecting" | "searching" | "review" | "packaging" | "done" | "error";
type CorvoIdea = { tema:string; titulo:string };
type WorkflowKind = "ROTEIRO" | "PROMPTS";
type ProjectArtifact = "IDEIA" | "ROTEIRO" | "PROMPTS";
type IdeaRequestOptions = { format:Format; quantity:Quantity; mode:Mode; topic?:string; revisionProjectId?:string };
type PipelineHistoryEvent = {
  at:string; attempt:number; specialist:"REFINADOR"|"GERADOR"|"FALLBACK"; status:string; jobId?:string;
  errorCode?:string; reason?:string; destination?:string; promptRetry?:string;
};
type PipelineItem = {
  id:string; route:"REFINADOR"|"GERADOR"; sourceFile?:string; sourceUrl?:string; refinement?:string; reason?:string; generationPrompt?:string;
  retryPrompt?:string; finalFile:string; jobId?:string; fallbackJobId?:string; status?:string; outputUrl?:string; outputFile?:string;
  error?:string; errorCode?:string; tentativaAtual?:number; finalFailure?:boolean; history?:PipelineHistoryEvent[];
};
type Project = {
  id:string; title:string; topic:string; format:Format; quantity:Quantity; mode:Mode;
  stage:number; createdAt:string; ideaText?:string; scriptText?:string; promptText?:string; packageCode?:string; imageCount?:number;
  thumbJobId?:string; thumbStatus?:string; thumbUrl?:string; thumbFileName?:string; thumbError?:string;
  analysisJobId?:string; analysisStatus?:string; analysisZipUrl?:string; analysisManifest?:string; pipelineStatus?:string; pipelineItems?:PipelineItem[];
  youtubeJobId?:string; youtubeStatus?:string; youtubeMetadata?:string; youtubeError?:string;
  finalZipStatus?:string; finalZipError?:string; finalZipGeneratedAt?:string;
};
type CollectorSettings = {
  selectionMode:SelectionMode; sourceMode:SourceMode; maxCandidates:number; scrollSteps:number;
  extensionId:string; prefix:string; jpegQuality:number; batchText:string; youtubeParallel:boolean;
};

const initialProjects:Project[] = [
  { id:"DESERTO_SOBREVIVENCIA_01", title:"VOCÊ SOBREVIVERIA NO DESERTO?", topic:"sobrevivência no deserto", format:"REELS", quantity:"1 VÍDEO", mode:"RÁPIDO", stage:4, createdAt:"HOJE, 10:42", ideaText:"TÍTULO: VOCÊ SOBREVIVERIA NO DESERTO?\nTEMA: SOBREVIVÊNCIA NO DESERTO", scriptText:"ROTEIRO DE EXEMPLO JÁ REVISADO", promptText:"01|deserto amplo com sol forte e composição para quiz sem texto\n02|mochila de sobrevivência isolada em fundo simples" },
  { id:"ANIMAIS_IMPOSSIVEIS_02", title:"QUAL ANIMAL FARIA ISSO?", topic:"animais curiosos", format:"REELS", quantity:"LOTE", mode:"PESQUISAR ANTES", stage:2, createdAt:"ONTEM, 18:15" },
];
const defaultSettings:CollectorSettings = { selectionMode:"MANUAL", sourceMode:"MIXED", maxCandidates:120, scrollSteps:20, extensionId:CORVO_COLLECTOR_EXTENSION_ID, prefix:"video1_", jpegQuality:.92, batchText:"", youtubeParallel:false };
const collectorEngines:Record<SourceMode,{label:string;shortLabel:string;description:string;icon:string}> = {
  GOOGLE:{ label:"GOOGLE IMAGENS", shortLabel:"GOOGLE", description:"BUSCA SOMENTE NO GOOGLE IMAGENS", icon:"G" },
  PINTEREST:{ label:"PINTEREST", shortLabel:"PINTEREST", description:"BUSCA SOMENTE NO PINTEREST", icon:"P" },
  MIXED:{ label:"MESCLADO", shortLabel:"MESCLADO", description:"DIVIDE AS CANDIDATAS ENTRE GOOGLE E PINTEREST", icon:"G+P" },
};
const steps = ["IDEIA", "ROTEIRO", "PROMPTS", "IMAGENS", "FORMA"];
const wait = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_PIPELINE_ATTEMPTS = 3;

function sameCollectorItems(jobItems:GuideItem[]|undefined, requestedItems:GuideItem[]) {
  if (!Array.isArray(jobItems) || jobItems.length !== requestedItems.length) return false;
  return jobItems.every((item,index) => {
    const requested = requestedItems[index];
    return String(item?.id || "").trim() === String(requested?.id || "").trim()
      && String(item?.query || "").trim() === String(requested?.query || "").trim();
  });
}

function elapsedLabel(rawDate?:string) {
  const started = rawDate ? new Date(rawDate).getTime() : Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours
    ? `${hours}H ${String(minutes).padStart(2,"0")}MIN`
    : minutes ? `${minutes}MIN ${String(seconds).padStart(2,"0")}S` : `${seconds}S`;
}

function safeLoad<T>(key:string, fallback:T):T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}
function loadCollectorSettings():CollectorSettings {
  const saved = safeLoad<Partial<CollectorSettings>>("corvo-collector-settings-v02", {});
  const sourceMode = saved.sourceMode && ["GOOGLE","PINTEREST","MIXED"].includes(saved.sourceMode) ? saved.sourceMode : defaultSettings.sourceMode;
  return { ...defaultSettings, ...saved, sourceMode };
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

function consolidationState(project:Project) {
  const items = [...(project.pipelineItems || [])].sort((a,b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric:true }));
  const idCounts = new Map<string,number>();
  const fileCounts = new Map<string,number>();
  for (const item of items) {
    idCounts.set(String(item.id), (idCounts.get(String(item.id)) || 0) + 1);
    const name = String(item.finalFile || item.outputFile || "").toLowerCase();
    if (name) fileCounts.set(name, (fileCounts.get(name) || 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()].filter(([,count]) => count > 1).map(([id]) => id);
  const duplicateFiles = [...fileCounts.entries()].filter(([,count]) => count > 1).map(([name]) => name);
  const missingIds = items.filter((item) => !item.outputUrl || item.finalFailure).map((item) => item.id);
  const invalidFiles = items.filter((item) => !/\.(png|jpe?g|webp)$/i.test(item.finalFile || item.outputFile || "")).map((item) => item.id);
  const ready = items.length > 0 && !duplicateIds.length && !duplicateFiles.length && !missingIds.length && !invalidFiles.length;
  return { items, duplicateIds, duplicateFiles, missingIds, invalidFiles, ready, completed:items.filter((item) => Boolean(item.outputUrl) && !item.finalFailure).length };
}

function ideaSection(resultText:string, idea:CorvoIdea) {
  const fallback = `TÍTULO: ${idea.titulo}\nTEMA: ${idea.tema}`;
  const text = resultText.trim();
  if (!text) return fallback;
  const matches = [...text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+[.)-]?\s*)?(?:🔥\s*)?\*{0,2}T[IÍ]TULO\*{0,2}\s*:\s*([^\n]+)/gi)];
  const selected = matches.findIndex((match) => String(match[1] || "").toLocaleUpperCase("pt-BR").includes(idea.titulo.toLocaleUpperCase("pt-BR")));
  if (selected < 0) return fallback;
  const start = matches[selected].index || 0;
  const end = matches[selected + 1]?.index ?? text.length;
  return text.slice(start, end).trim() || fallback;
}

function loadProjects() {
  return safeLoad<Project[]>("corvoquiz-projects-v02", initialProjects).map((project) => {
    const withIdea = project.ideaText ? project : { ...project, ideaText:`TÍTULO: ${project.title}\nTEMA: ${project.topic}` };
    if (withIdea.stage >= 3 && !withIdea.scriptText) return { ...withIdea, stage:2 };
    if (withIdea.stage >= 4 && !withIdea.promptText) return { ...withIdea, stage:3 };
    return withIdea;
  });
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [activeId, setActiveId] = useState(() => loadProjects()[0]?.id || initialProjects[0].id);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consolidationOpen, setConsolidationOpen] = useState(false);
  const [consolidationBusy, setConsolidationBusy] = useState(false);
  const [consolidationMessage, setConsolidationMessage] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [format, setFormat] = useState<Format>("REELS");
  const [quantity, setQuantity] = useState<Quantity>("1 VÍDEO");
  const [mode, setMode] = useState<Mode>("RÁPIDO");
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState<CorvoIdea[]>([]);
  const [ideaResultText, setIdeaResultText] = useState("");
  const [ideaRevisionProjectId, setIdeaRevisionProjectId] = useState<string|null>(null);
  const [selectedIdea, setSelectedIdea] = useState<number|null>(null);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaMessage, setIdeaMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowKind, setWorkflowKind] = useState<WorkflowKind>("ROTEIRO");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactKind, setArtifactKind] = useState<ProjectArtifact>("IDEIA");
  const [settings, setSettings] = useState<CollectorSettings>(loadCollectorSettings);
  const [imagePhase, setImagePhase] = useState<ImagePhase>("connecting");
  const [imageMessage, setImageMessage] = useState("Preparando o Corvo Collector...");
  const [imageStatusLine, setImageStatusLine] = useState("");
  const [imageProgress, setImageProgress] = useState(0);
  const [collectorRunning, setCollectorRunning] = useState(false);
  const [groups, setGroups] = useState<RankedGroup[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [candidatePos, setCandidatePos] = useState(0);
  const [searchingMore, setSearchingMore] = useState(false);
  const [packageCode, setPackageCode] = useState("");
  const runToken = useRef(0);
  const ideaRunToken = useRef(0);
  const workflowRunToken = useRef(0);
  const thumbRuns = useRef(new Set<string>());
  const generatorQueue = useRef<Promise<void>>(Promise.resolve());
  const packageRetryRef = useRef<RankedGroup[] | null>(null);

  useEffect(() => { localStorage.setItem("corvoquiz-projects-v02", JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem("corvo-collector-settings-v02", JSON.stringify(settings)); }, [settings]);
  const active = useMemo(() => projects.find((project) => project.id === activeId) || projects[0], [projects, activeId]);
  const currentGroup = groups[groupIndex];
  const currentRank = currentGroup?.ranked[candidatePos];
  const workflowOutput = active ? (workflowKind === "ROTEIRO" ? active.scriptText : active.promptText) || "" : "";
  const artifactContent = active ? artifactKind === "IDEIA" ? active.ideaText || "" : artifactKind === "ROTEIRO" ? active.scriptText || "" : active.promptText || "" : "";
  const artifactRedoMessage = artifactKind === "IDEIA" ? "REFAZ ROTEIRO, PROMPTS E IMAGENS" : artifactKind === "ROTEIRO" ? "REFAZ PROMPTS E IMAGENS" : "DESCARTA AS IMAGENS ATUAIS";

  function resetCreationFields() {
    setTopic(""); setIdeas([]); setIdeaResultText(""); setSelectedIdea(null); setNotice("");
  }

  function openNewProduction() {
    setIdeaRevisionProjectId(null);
    resetCreationFields();
    setCreateOpen(true);
  }

  function closeCreationModal() {
    if (ideaLoading) return;
    setCreateOpen(false);
    setIdeaRevisionProjectId(null);
    resetCreationFields();
  }

  function createProject() {
    const idea = selectedIdea === null ? null : ideas[selectedIdea];
    const finalTopic = idea?.tema || topic.trim();
    if (!finalTopic) { setNotice("ESCOLHA UMA IDEIA OU INFORME UM TEMA."); return; }
    const finalTitle = idea?.titulo || `NOVO QUIZ: ${finalTopic.toUpperCase()}`;
    const id = `${slugify(finalTitle || finalTopic)}_${String(projects.length + 1).padStart(2, "0")}`;
    const project:Project = {
      id, title:finalTitle.toUpperCase(), topic:finalTopic, format, quantity, mode, stage:2, createdAt:"AGORA",
      ideaText:idea ? ideaSection(ideaResultText, idea) : `TÍTULO: ${finalTitle.toUpperCase()}\nTEMA: ${finalTopic}\nORIGEM: TEMA INFORMADO MANUALMENTE`,
    };
    if (ideaRevisionProjectId) {
      const previous = projects.find((item) => item.id === ideaRevisionProjectId);
      if (!previous) { setNotice("O PROJETO NÃO FOI ENCONTRADO."); return; }
      const revised:Project = {
        ...previous,
        title:project.title, topic:project.topic, format:project.format, quantity:project.quantity, mode:project.mode,
        ideaText:project.ideaText, stage:2, scriptText:undefined, promptText:undefined, packageCode:undefined, imageCount:undefined,
      };
      runToken.current += 1; setImageOpen(false); setGroups([]); setPackageCode("");
      setProjects((current) => current.map((item) => item.id === previous.id ? revised : item));
      setActiveId(previous.id); setCreateOpen(false); setIdeaRevisionProjectId(null); resetCreationFields();
      void runSpecialist("ROTEIRO", revised);
      return;
    }
    setProjects((current) => [project, ...current]); setActiveId(id); setTopic(""); setIdeas([]); setIdeaResultText(""); setSelectedIdea(null); setCreateOpen(false); setNotice("");
  }

  async function generateCorvoIdeas(options?:IdeaRequestOptions) {
    if (ideaLoading) return;
    const requestFormat = options?.format || format;
    const requestQuantity = options?.quantity || quantity;
    const requestMode = options?.mode || mode;
    const requestTopic = options?.topic ?? topic;
    const token = ++ideaRunToken.current;
    setIdeaLoading(true); setIdeaMessage("PREPARANDO O PEDIDO..."); setSelectedIdea(null); setIdeaResultText(""); setNotice("");
    try {
      const response = await fetch("/api/corvo/job", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          tema:requestTopic.trim() || null, format:requestFormat, quantity:requestQuantity, mode:requestMode,
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
        meta:{ format:requestFormat, quantity:requestQuantity, mode:requestMode },
      });
      setIdeaMessage("O CORVO ESTÁ CRIANDO AS OPÇÕES...");

      for (let attempt = 0; attempt < 180 && token === ideaRunToken.current; attempt++) {
        await wait(2000);
        const statusResponse = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(result.jobId)}`, { cache:"no-store" });
        const status = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(status?.message || "Não foi possível acompanhar o trabalho.");
        if (status.status === "DONE") {
          await completeCorvoBridgeJob(result.jobId).catch(() => {});
          if (!Array.isArray(status.ideias) || !status.ideias.length) throw new Error("O Corvo não retornou ideias válidas.");
          setIdeas(status.ideias); setIdeaResultText(typeof status.resultado === "string" ? status.resultado : ""); setTopic(""); setSelectedIdea(null); setIdeaMessage("");
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

  function bridgeErrorMessage(error:unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (message.includes("CORVO_BRIDGE_NOT_AVAILABLE")) return "CORVO BRIDGE NÃO ENCONTRADO. INSTALE OU RECARREGUE A EXTENSÃO.";
    if (message.includes("GPT_URL_NOT_CONFIGURED_ROTEIRO")) return "CONFIGURE O GPT DE ROTEIRO NAS OPÇÕES DO CORVO BRIDGE.";
    if (message.includes("GPT_URL_NOT_CONFIGURED_PROMPTS")) return "CONFIGURE O GPT DE PROMPTS DE IMAGEM NAS OPÇÕES DO CORVO BRIDGE.";
    if (message.includes("GPT_URL_NOT_CONFIGURED")) return "CONFIGURE OS GPTS NAS OPÇÕES DO CORVO BRIDGE.";
    if (message.includes("GPT_SEND_FAILED")) return "O BRIDGE PREENCHEU A MENSAGEM, MAS O CHATGPT NÃO CONFIRMOU O ENVIO.";
    return message || "NÃO FOI POSSÍVEL CONCLUIR ESTA ETAPA.";
  }

  async function runSpecialist(kind:WorkflowKind, project = active) {
    if (!project || workflowLoading) return;
    if (kind === "PROMPTS" && !project.scriptText?.trim()) {
      setNotice("O ROTEIRO PRECISA ESTAR PRONTO ANTES DOS PROMPTS.");
      setTimeout(() => setNotice(""), 4200);
      return;
    }
    const workingProject:Project = kind === "ROTEIRO"
      ? { ...project, stage:2, scriptText:undefined, promptText:undefined, packageCode:undefined, imageCount:undefined }
      : { ...project, stage:3, promptText:undefined, packageCode:undefined, imageCount:undefined };
    runToken.current += 1; setImageOpen(false); setGroups([]); setPackageCode("");
    setProjects((current) => current.map((item) => item.id === workingProject.id ? workingProject : item));
    const token = ++workflowRunToken.current;
    setWorkflowKind(kind); setWorkflowOpen(true); setWorkflowLoading(true); setWorkflowError("");
    setWorkflowMessage(kind === "ROTEIRO" ? "PREPARANDO A IDEIA PARA O ROTEIRISTA..." : "ENVIANDO O ROTEIRO PARA O ESPECIALISTA DE IMAGENS...");
    try {
      const response = await fetch("/api/corvo/job", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          specialist:kind,
          projetoId:workingProject.id,
          titulo:workingProject.title,
          tema:workingProject.topic,
          format:workingProject.format,
          quantity:workingProject.quantity,
          mode:workingProject.mode,
          roteiro:kind === "PROMPTS" ? workingProject.scriptText : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.jobId || !result?.prompt) throw new Error(result?.message || "O trabalho não pôde ser criado.");
      setWorkflowMessage(kind === "ROTEIRO" ? "O CORVO ROTEIRO ESTÁ ESCREVENDO..." : "O CORVO ESTÁ DEFININDO AS IMAGENS...");
      await dispatchCorvoBridge({
        jobId:result.jobId,
        prompt:result.prompt,
        specialist:kind,
        meta:{ projectId:workingProject.id, format:workingProject.format, quantity:workingProject.quantity, mode:workingProject.mode },
      });

      for (let attempt = 0; attempt < 240 && token === workflowRunToken.current; attempt++) {
        await wait(2000);
        const statusResponse = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(result.jobId)}`, { cache:"no-store" });
        const status = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(status?.message || "Não foi possível acompanhar o especialista.");
        if (status.status === "DONE") {
          await completeCorvoBridgeJob(result.jobId).catch(() => {});
          const output = typeof status.resultado === "string" ? status.resultado.trim() : "";
          if (!output) throw new Error("O especialista concluiu sem devolver conteúdo.");
          setProjects((current) => current.map((item) => item.id === workingProject.id
            ? kind === "ROTEIRO"
              ? { ...item, stage:2, scriptText:output, promptText:undefined, packageCode:undefined, imageCount:undefined }
              : { ...item, stage:3, promptText:output, packageCode:undefined, imageCount:undefined }
            : item));
          setWorkflowMessage("");
          return;
        }
        if (status.status === "ERROR") throw new Error(status?.message || "O especialista não conseguiu concluir o trabalho.");
      }
      if (token === workflowRunToken.current) throw new Error("O especialista ainda não respondeu. Tente novamente em alguns instantes.");
    } catch (error) {
      if (token === workflowRunToken.current) setWorkflowError(bridgeErrorMessage(error));
    } finally {
      if (token === workflowRunToken.current) { setWorkflowLoading(false); setWorkflowMessage(""); }
    }
  }

  function continueProduction() {
    if (!active) return;
    if (active.stage <= 2) {
      setWorkflowKind("ROTEIRO"); setWorkflowOpen(true); setWorkflowError("");
      if (!active.scriptText) void runSpecialist("ROTEIRO", active);
      return;
    }
    if (active.stage === 3) {
      setWorkflowKind("PROMPTS"); setWorkflowOpen(true); setWorkflowError("");
      if (!active.promptText) void runSpecialist("PROMPTS", active);
      return;
    }
    if (active.stage === 4) { void startImageFlow(); return; }
    void downloadProject(active);
  }

  function approveWorkflow() {
    if (!active) return;
    if (workflowKind === "ROTEIRO" && active.scriptText) {
      const nextProject = { ...active, stage:3 };
      setProjects((current) => current.map((item) => item.id === active.id ? nextProject : item));
      void runSpecialist("PROMPTS", nextProject);
      return;
    }
    if (workflowKind === "PROMPTS" && active.promptText) {
      setProjects((current) => current.map((item) => item.id === active.id ? { ...item, stage:4 } : item));
      setWorkflowOpen(false);
      setNotice("PROMPTS APROVADOS. A BUSCA DE IMAGENS ESTÁ LIBERADA.");
      setTimeout(() => setNotice(""), 4200);
    }
  }

  async function downloadProject(project:Project) {
    const zip = new JSZip();
    zip.file("projeto.json", JSON.stringify(project, null, 2));
    zip.folder("ideia")?.file(`IDEIA_${project.id}.txt`, project.ideaText || `TÍTULO: ${project.title}\nTEMA: ${project.topic}`);
    zip.folder("roteiro")?.file(`${project.id}.txt`, project.scriptText || `PROJETO: ${project.id}\nROTEIRO AINDA NÃO CONCLUÍDO\n`);
    zip.folder("prompts")?.file(`PROMPTS_${project.id}.txt`, project.promptText || defaultQueries(project).map((item) => `${item.id}|${item.query}`).join("\n"));
    zip.folder("forma")?.file("PACOTE.txt", project.packageCode ? `PACOTE_CODE=${project.packageCode}` : "O pacote de imagens ainda não foi concluído.");
    zip.folder("thumbnail")?.file("THUMBNAIL.txt", project.thumbUrl ? `ARQUIVO=${project.thumbFileName || "thumbnail.png"}\nURL=${project.thumbUrl}` : `STATUS=${project.thumbStatus || "PENDENTE"}\n${project.thumbError ? `ERRO=${project.thumbError}` : ""}`);
    zip.folder("analise")?.file("CORVO_IMAGE_ANALYSIS.txt", project.analysisManifest || `STATUS=${project.analysisStatus || "PENDENTE"}\n`);
    zip.folder("pipeline")?.file("IMAGENS_FINAIS.json", JSON.stringify(project.pipelineItems || [], null, 2));
    zip.folder("youtube")?.file("METADADOS.txt", project.youtubeMetadata || `STATUS=${project.youtubeStatus || "PENDENTE"}\n${project.youtubeError ? `ERRO=${project.youtubeError}` : ""}`);
    zip.folder("consolidacao")?.file("STATUS.txt", `STATUS=${project.finalZipStatus || "PENDENTE"}\nGERADO_EM=${project.finalZipGeneratedAt || ""}\n${project.finalZipError ? `ERRO=${project.finalZipError}` : ""}`);
    const blob = await zip.generateAsync({ type:"blob" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${project.id}.zip`; link.click(); URL.revokeObjectURL(url);
  }

  function downloadTextFile(fileName:string, content:string) {
    const url = URL.createObjectURL(new Blob([content], { type:"text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
  }

  function openArtifact(kind:ProjectArtifact) {
    setArtifactKind(kind);
    setArtifactOpen(true);
  }

  function startIdeaRevision() {
    if (!active || ideaLoading || workflowLoading) return;
    setArtifactOpen(false); setIdeaRevisionProjectId(active.id);
    setFormat(active.format); setQuantity(active.quantity); setMode(active.mode);
    resetCreationFields(); setCreateOpen(true);
    void generateCorvoIdeas({ format:active.format, quantity:active.quantity, mode:active.mode, topic:"", revisionProjectId:active.id });
  }

  function redoArtifact() {
    if (!active || workflowLoading || ideaLoading) return;
    if (artifactKind === "IDEIA") { startIdeaRevision(); return; }
    setArtifactOpen(false);
    void runSpecialist(artifactKind, active);
  }

  async function copyArtifact() {
    if (!artifactContent) return;
    try {
      await navigator.clipboard.writeText(artifactContent);
      setNotice("CONTEÚDO COPIADO.");
    } catch {
      setNotice("NÃO FOI POSSÍVEL COPIAR AUTOMATICAMENTE.");
    }
    setTimeout(() => setNotice(""), 3000);
  }

  function friendlyError(error:unknown) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("ORIGIN_NOT_AUTHORIZED")) return "Autorize este endereço uma única vez no Corvo Collector e tente novamente.";
    if (message.includes("COLLECTOR_NOT_AVAILABLE") || message.includes("Receiving end does not exist")) return "O Corvo Collector não foi encontrado. Instale ou atualize a extensão incluída no pacote.";
    if (message.includes("JOB_ALREADY_RUNNING_DIFFERENT")) return "O Collector está trabalhando em outra produção. Aguarde essa busca terminar ou cancele-a antes de iniciar esta.";
    if (message.includes("JOB_ALREADY_RUNNING")) return "Já existe uma busca em andamento. Abra novamente esta etapa para acompanhar o trabalho atual.";
    if (message.includes("VERCEL_BLOB_NOT_CONFIGURED") || message.toLowerCase().includes("vercel blob não configurado")) return "O Vercel Blob ainda não está conectado ao projeto. As imagens foram salvas pelo Collector, mas o app não tem onde armazená-las. Conecte um Blob Store ao projeto roteiro na Vercel e tente novamente.";
    return message || "Não foi possível concluir esta etapa.";
  }

  async function ensurePipelineStorageReady() {
    const response = await fetch("/api/corvo/diagnostico", { cache:"no-store" });
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status?.message || "Não foi possível verificar o armazenamento do pipeline.");
    if (!status?.configured) throw new Error("O Upstash Redis não está configurado para os jobs do Corvo.");
    if (!status?.blobConfigured) throw new Error("VERCEL_BLOB_NOT_CONFIGURED");
    return status;
  }

  function updateThumb(projectId:string, patch:Partial<Project>) {
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, ...patch } : project));
  }

  async function monitorThumbJob(project:Project, jobId:string) {
    let captureAttempts = 0;
    while (thumbRuns.current.has(project.id)) {
      await wait(2500);
      const response = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(jobId)}`, { cache:"no-store" });
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(status?.message || "Não foi possível acompanhar a thumbnail.");
      if (status.status === "WAITING_FILE") {
        const expectedFile = String(status.expectedFile || `thumb_${project.id.toLowerCase()}.png`);
        updateThumb(project.id, { thumbStatus:"CAPTURANDO ARQUIVO", thumbFileName:expectedFile, thumbError:undefined });
        captureAttempts += 1;
        try {
          await captureCorvoBridgeFile(jobId, expectedFile, "THUMBNAIL");
        } catch (error) {
          if (captureAttempts >= 3) throw error;
          updateThumb(project.id, { thumbStatus:"AGUARDANDO CAPTURA", thumbError:bridgeErrorMessage(error) });
          await wait(5000);
        }
        continue;
      }
      if (status.status === "DONE") {
        const file = Array.isArray(status.files) ? status.files.find((item:any) => item?.type === "THUMBNAIL") || status.files.at(-1) : null;
        if (!file?.url) throw new Error("O job terminou sem a URL da thumbnail.");
        updateThumb(project.id, { thumbStatus:"CONCLUÍDA", thumbUrl:file.url, thumbFileName:file.name, thumbError:undefined });
        await completeCorvoBridgeJob(jobId).catch(() => {});
        return;
      }
      if (status.status === "ERROR") throw new Error(status.error || status.manifest?.reason || "O Corvo Thumb informou uma falha.");
      updateThumb(project.id, { thumbStatus:status.status === "PENDING" ? "ENVIANDO" : "CRIANDO THUMBNAIL" });
    }
  }

  async function startThumbBranch(project:Project) {
    if (project.thumbUrl || thumbRuns.current.has(project.id)) return;
    thumbRuns.current.add(project.id);
    try {
      if (project.thumbJobId) {
        updateThumb(project.id, { thumbStatus:"RETOMANDO THUMBNAIL", thumbError:undefined });
        await monitorThumbJob(project, project.thumbJobId);
        return;
      }
      const fileName = `thumb_${project.id.toLowerCase()}.png`;
      updateThumb(project.id, { thumbStatus:"PREPARANDO THUMBNAIL", thumbFileName:fileName, thumbError:undefined });
      const response = await fetch("/api/corvo/job", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          specialist:"THUMB",
          projetoId:project.id,
          titulo:project.title,
          tema:project.topic,
          format:project.format,
          quantity:project.quantity,
          mode:project.mode,
          entrada:[
            `IDEIA=${project.ideaText || project.topic}`,
            `TITULO_BASE=${project.title}`,
            `TEMA=${project.topic}`,
            `PUBLICO=INFANTIL, PRE-ADOLESCENTE E ADOLESCENTE`,
            `IDENTIDADE_VISUAL=CORVOQUIZ`,
            `PADRAO_ARQUIVO_FINAL=${fileName}`,
            "",
            "ROTEIRO / CONTEXTO:",
            project.scriptText || "",
          ].join("\n"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.jobId || !result?.prompt || !result?.uploadToken) throw new Error(result?.message || "Não foi possível criar o trabalho da thumbnail.");
      updateThumb(project.id, { thumbJobId:result.jobId, thumbStatus:"ENVIANDO AO CORVO THUMB" });
      await dispatchCorvoBridge({
        jobId:result.jobId,
        prompt:result.prompt,
        specialist:"THUMB",
        meta:{ projectId:project.id, uploadToken:result.uploadToken, expectedFile:fileName },
      });
      updateThumb(project.id, { thumbStatus:"CRIANDO THUMBNAIL" });
      await monitorThumbJob(project, result.jobId);
    } catch (error) {
      updateThumb(project.id, { thumbStatus:"FALHOU", thumbError:bridgeErrorMessage(error) });
    } finally {
      thumbRuns.current.delete(project.id);
    }
  }

  async function startYoutubeBranch(project:Project) {
    if (!settings.youtubeParallel || project.youtubeMetadata || project.youtubeStatus === "PROCESSANDO" || project.youtubeStatus === "ENVIANDO") return;
    try {
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, youtubeStatus:"PREPARANDO", youtubeError:undefined } : entry));
      const entrada = [
        `IDEIA=${project.ideaText || project.topic}`,
        `TITULO_BASE=${project.title}`,
        `TEMA=${project.topic}`,
        `TIPO_DE_VIDEO=${project.format}`,
        "PUBLICO=INFANTIL, PRE-ADOLESCENTE E ADOLESCENTE",
        "",
        "ROTEIRO:",
        project.scriptText || "",
        "",
        "ENTREGAR: TITULO_FINAL, TITULO_ALTERNATIVO_1, TITULO_ALTERNATIVO_2, DESCRICAO, TAGS, HASHTAGS, CATEGORIA, PUBLICO, DATA_RECOMENDADA, HORARIO_RECOMENDADO e ESTRATEGIA_DE_PUBLICACAO.",
      ].join("\n");
      const job = await createPipelineJob("YOUTUBE", project, entrada);
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, youtubeJobId:job.jobId, youtubeStatus:"ENVIANDO" } : entry));
      await dispatchCorvoBridge({ jobId:job.jobId, prompt:job.prompt, specialist:"YOUTUBE", meta:{ projectId:project.id } });
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, youtubeStatus:"PROCESSANDO" } : entry));
      const status = await pollPipelineJob(job.jobId, project.id);
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, youtubeStatus:"CONCLUÍDO", youtubeMetadata:String(status.resultado || ""), youtubeError:undefined } : entry));
    } catch (error) {
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, youtubeStatus:"FALHOU", youtubeError:bridgeErrorMessage(error) } : entry));
    }
  }

  async function startImageFlow() {
    if (!active) return;
    const token = ++runToken.current;
    setImageOpen(true); setImagePhase("connecting"); setImageProgress(4); setImageMessage("Conectando ao coletor..."); setImageStatusLine(""); setGroups([]); setPackageCode("");
    try {
      const ping = await sendCollectorMessage<{ok?:boolean;authorized?:boolean;error?:string}>("PING", undefined, settings.extensionId);
      if (!ping?.ok) throw new Error(ping?.error || "COLLECTOR_CONNECTION_ERROR");
      if (ping.authorized === false) throw new Error("ORIGIN_NOT_AUTHORIZED");
      await ensurePipelineStorageReady();
      if (token !== runToken.current) return;
      void startThumbBranch(active);
      void startYoutubeBranch(active);
      const items = settings.batchText.trim()
        ? parseGuideText(settings.batchText)
        : active.promptText?.trim() ? parseGuideText(active.promptText) : defaultQueries(active);
      if (!items.length) throw new Error("Os prompts retornados não contêm buscas utilizáveis.");
      let finalJob:any = null;
      const currentResponse = await sendCollectorMessage<any>("GET_STATUS", undefined, settings.extensionId);
      const currentJob = currentResponse?.job;
      const currentMatches = sameCollectorItems(currentJob?.items, items);

      if (currentJob && ["RUNNING","QUEUED"].includes(currentJob.status)) {
        if (!currentMatches) throw new Error("JOB_ALREADY_RUNNING_DIFFERENT");
        setCollectorRunning(true); setImagePhase("searching"); setImageProgress(8);
        setImageMessage("Reconectando à busca que já está em andamento...");
        setImageStatusLine(`RETOMANDO ${items.length} IMAGENS · NENHUM RESULTADO SERÁ PERDIDO`);
      } else if (currentJob?.status === "DONE" && currentMatches) {
        finalJob = (await sendCollectorMessage<any>("GET_RESULT", undefined, settings.extensionId))?.job;
        setImageMessage("Recuperando as imagens que o Collector já terminou...");
      } else {
        setImagePhase("searching"); setImageProgress(8); setImageMessage(`Buscando ${items.length} cenas com ${collectorEngines[settings.sourceMode].label}...`);
        setImageStatusLine(`0/${items.length} CONCLUÍDAS · TEMPO 0S`);
        const started = await sendCollectorMessage<{ok?:boolean;error?:string}>("START_JOB", {
          items, productionId:active.id, maxCandidates:settings.maxCandidates, scrollSteps:settings.scrollSteps, sourceMode:settings.sourceMode,
          backgroundTab:true, closeTabOnFinish:true,
        }, settings.extensionId);
        if (!started?.ok) throw new Error(started?.error || "Falha ao iniciar a busca.");
        setCollectorRunning(true);
      }

      while (!finalJob && token === runToken.current) {
        await wait(1200);
        let response:any;
        try {
          response = await sendCollectorMessage<any>("GET_STATUS", undefined, settings.extensionId);
        } catch {
          setImageMessage("A coleta continua. Reconectando ao Collector...");
          setImageStatusLine("CONEXÃO TEMPORARIAMENTE INTERROMPIDA · TENTANDO NOVAMENTE");
          await wait(2500);
          continue;
        }
        const job = response?.job;
        if (!job) {
          setImageMessage("Aguardando o Collector confirmar o trabalho...");
          continue;
        }
        if (!sameCollectorItems(job.items, items)) throw new Error("JOB_ALREADY_RUNNING_DIFFERENT");
        const total = Number(job?.progress?.total || items.length);
        const current = Number(job?.progress?.current || 0);
        const completed = Number(job?.summary?.completed || 0);
        setImageProgress(Math.max(10, Math.min(82, ((completed + (current ? .35 : 0)) / Math.max(1, total)) * 78 + 8)));
        const jobSource = (job?.settings?.sourceMode || settings.sourceMode) as SourceMode;
        const engineNow = job?.progress?.providerNow === "GOOGLE" ? "GOOGLE IMAGENS" : job?.progress?.providerNow === "PINTEREST" ? "PINTEREST" : collectorEngines[jobSource].label;
        setImageMessage(job?.progress?.query ? `${engineNow}: ${job.progress.query}` : `A busca continua em ${collectorEngines[jobSource].label}...`);
        setImageStatusLine(`${completed}/${total} CONCLUÍDAS · IMAGEM ${Math.min(current,total)}/${total} · TEMPO ${elapsedLabel(job.startedAt || job.createdAt)}`);
        if (job?.status === "DONE") {
          try { finalJob = (await sendCollectorMessage<any>("GET_RESULT", undefined, settings.extensionId))?.job; }
          catch { setImageMessage("Busca concluída. Recuperando o resultado..."); }
          continue;
        }
        if (["ERROR", "CANCELLED"].includes(job?.status)) throw new Error(job?.error || "A busca foi interrompida.");
      }
      if (token !== runToken.current) return;
      if (!finalJob?.results) throw new Error("Não foi possível recuperar o resultado da busca.");
      setCollectorRunning(false);
      const ranked = rankGroups(finalJob.results);
      if (!ranked.length || ranked.some((group) => !group.ranked.length)) throw new Error("Uma ou mais cenas não retornaram imagens utilizáveis.");
      setGroups(ranked); setGroupIndex(0); setCandidatePos(0);
      if (settings.selectionMode === "MANUAL") { setImagePhase("review"); setImageProgress(84); setImageMessage("Escolha rapidamente uma imagem por cena."); setImageStatusLine(""); }
      else await buildPackage(ranked, token);
    } catch (error) {
      if (token !== runToken.current) return;
      setCollectorRunning(false);
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
    }
  }

  function updatePipelineItem(projectId:string, itemId:string, patch:Partial<PipelineItem>) {
    setProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => item.id === itemId ? { ...item, ...patch } : item) }
      : project));
  }

  function appendPipelineHistory(projectId:string, itemId:string, event:PipelineHistoryEvent) {
    setProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => item.id === itemId ? { ...item, history:[...(item.history || []), event] } : item) }
      : project));
  }

  async function runGeneratorSerialized<T>(task:()=>Promise<T>):Promise<T> {
    const previous = generatorQueue.current;
    let release = () => {};
    generatorQueue.current = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try { return await task(); }
    finally { release(); }
  }

  async function createPipelineJob(specialist:"ANALISTA"|"REFINADOR"|"GERADOR"|"FALLBACK"|"YOUTUBE", project:Project, entrada:string, ids:string[] = [], tentativaAtual = 1, origem?:"GERADOR"|"REFINADOR") {
    const response = await fetch("/api/corvo/job", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({
        specialist,
        projetoId:project.id,
        titulo:project.title,
        tema:project.topic,
        format:project.format,
        quantity:project.quantity,
        mode:project.mode,
        roteiro:project.scriptText,
        entrada,
        ids,
        tentativaAtual,
        origem,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.jobId || !result?.prompt || !result?.uploadToken) throw new Error(result?.message || `Não foi possível criar o trabalho ${specialist}.`);
    return result as {jobId:string;prompt:string;uploadToken:string;status:string};
  }

  async function pollPipelineJob(jobId:string, projectId:string, itemId?:string, captureType?:"REFINED_IMAGE"|"GENERATED_IMAGE") {
    let captureAttempts = 0;
    while (runToken.current > 0) {
      await wait(2500);
      const response = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(jobId)}`, { cache:"no-store" });
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(status?.message || "Não foi possível acompanhar o trabalho.");
      if (itemId) updatePipelineItem(projectId, itemId, { status:status.status || "PROCESSANDO" });
      if (status.status === "WAITING_FILE" && captureType) {
        const expectedFiles = Array.isArray(status.expectedFiles) && status.expectedFiles.length ? status.expectedFiles : [status.expectedFile].filter(Boolean);
        for (const expectedFile of expectedFiles) {
          if (Array.isArray(status.files) && status.files.some((file:any) => String(file?.name || "").toLowerCase() === String(expectedFile).toLowerCase())) continue;
          captureAttempts += 1;
          if (itemId) updatePipelineItem(projectId, itemId, { status:"CAPTURANDO_ARQUIVO" });
          try { await captureCorvoBridgeFile(jobId, String(expectedFile), captureType, 180000); }
          catch (error) {
            if (captureAttempts >= 3) throw error;
            await wait(5000);
          }
        }
        continue;
      }
      if (status.status === "DONE") {
        await completeCorvoBridgeJob(jobId).catch(() => {});
        return status;
      }
      if (status.status === "ERROR") {
        const failure = new Error(status.error || status.manifest?.reason || status.manifest?.errorCode || "O especialista informou uma falha.");
        throw Object.assign(failure, { corvoStatus:status });
      }
    }
    throw new Error("PIPELINE_INTERRUPTED");
  }

  async function runRoutedItem(project:Project, item:PipelineItem) {
    const isRefiner = item.route === "REFINADOR";
    const baseRefinerInstruction = [
      "OBJETIVO_FINAL:",
      "- preservar identidade, jogo, personagem, objeto e conteúdo principal;",
      "- melhorar nitidez, definição, contraste, iluminação e enquadramento;",
      item.refinement === "FORTE" ? "- adaptar para composição horizontal 16:9 quando necessário;" : "- fazer apenas melhoria técnica leve, sem recriar a cena;",
      "- não adicionar títulos, legendas, logos ou marca-d'água;",
    ].join("\n");
    const entrada = isRefiner
      ? [
          `[ID:${item.id}]`,
          `ARQUIVO_ORIGINAL=${item.sourceFile || ""}`,
          `STATUS_ORIGEM=${item.refinement === "FORTE" ? "PASSOU_COM_RESSALVAS" : "PASSOU"}`,
          `REFINAMENTO=${item.refinement || "LEVE"}`,
          `MOTIVO=${item.reason || "Imagem aprovada pelo Analista."}`,
          item.retryPrompt ? `INSTRUCAO_RETRY=${item.retryPrompt}` : baseRefinerInstruction,
          `PADRAO_ARQUIVO_FINAL=${item.finalFile}`,
        ].join("\n")
      : [
          `[ID:${item.id}]`,
          `PROMPT_GERACAO=${item.retryPrompt || item.generationPrompt || "Gerar uma imagem clara e reconhecível para o quiz, sem texto e sem marca-d'água."}`,
          `CONTEXTO=${project.topic}. Imagem final para o CorvoQuiz.`,
          `IDENTIDADE_ESPERADA=${item.reason || project.topic}`,
          `PADRAO_ARQUIVO_FINAL=${item.finalFile}`,
        ].join("\n");
    const attempt = item.tentativaAtual || 1;
    const job = await createPipelineJob(item.route, project, entrada, [item.id], attempt);
    updatePipelineItem(project.id, item.id, { jobId:job.jobId, status:"ENVIANDO", tentativaAtual:attempt, error:undefined, errorCode:undefined });
    appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:item.route, status:"ENVIANDO", jobId:job.jobId });
    await dispatchCorvoBridge({
      jobId:job.jobId,
      prompt:job.prompt,
      specialist:item.route,
      meta:{
        projectId:project.id,
        uploadToken:job.uploadToken,
        expectedFile:item.finalFile,
        attachments:isRefiner && item.sourceUrl ? [{ url:item.sourceUrl, name:item.sourceFile || `entrada_${item.id}.jpg`, contentType:"image/jpeg" }] : [],
      },
    });
    updatePipelineItem(project.id, item.id, { status:"PROCESSANDO" });
    const status = await pollPipelineJob(job.jobId, project.id, item.id, isRefiner ? "REFINED_IMAGE" : "GENERATED_IMAGE");
    const expectedType = isRefiner ? "REFINED_IMAGE" : "GENERATED_IMAGE";
    const file = Array.isArray(status.files) ? status.files.find((candidate:any) => candidate?.type === expectedType) || status.files.find((candidate:any) => candidate?.name === item.finalFile) : null;
    if (!file?.url) throw Object.assign(new Error(`${item.route} concluiu sem devolver o arquivo real.`), { corvoStatus:status });
    updatePipelineItem(project.id, item.id, { status:"CONCLUIDO", outputUrl:file.url, outputFile:file.name, error:undefined, errorCode:undefined, finalFailure:false });
    appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:item.route, status:"CONCLUIDO", jobId:job.jobId });
    return { ...item, jobId:job.jobId, status:"CONCLUIDO", outputUrl:file.url, outputFile:file.name, error:undefined, finalFailure:false } as PipelineItem;
  }

  function structuredFailure(error:unknown, item:PipelineItem) {
    const status = (error as any)?.corvoStatus;
    const manifestItem = Array.isArray(status?.manifest?.items)
      ? status.manifest.items.find((candidate:any) => String(candidate?.id || "") === String(item.id)) || status.manifest.items[0]
      : undefined;
    return {
      status,
      errorCode:String(manifestItem?.errorCode || status?.manifest?.errorCode || "TOOL_ERROR").toUpperCase(),
      reason:String(manifestItem?.reason || status?.manifest?.reason || (error instanceof Error ? error.message : error) || "Falha sem motivo informado."),
    };
  }

  async function runFallback(project:Project, item:PipelineItem, failure:{errorCode:string;reason:string}) {
    const attempt = item.tentativaAtual || 1;
    const originalInstruction = item.route === "GERADOR"
      ? item.retryPrompt || item.generationPrompt || "Gerar imagem final conforme o contexto do projeto."
      : item.retryPrompt || `Refinar ${item.sourceFile || item.id} com intensidade ${item.refinement || "LEVE"}, preservando identidade e conteúdo principal.`;
    const entrada = [
      `[ID:${item.id}]`,
      `ORIGEM=${item.route}`,
      `ERROR_CODE=${failure.errorCode}`,
      `MOTIVO=${failure.reason}`,
      item.route === "GERADOR" ? `PROMPT_ORIGINAL=${originalInstruction}` : `INSTRUCAO_ORIGINAL=${originalInstruction}`,
      `CONTEXTO=${project.topic}. Projeto ${project.id}.`,
      `IDENTIDADE=${item.reason || project.topic}`,
      `TENTATIVA_ATUAL=${attempt}`,
      "",
      "Decida RETRY ou NAO_RECUPERAVEL. Não gere nem edite imagem nesta etapa.",
    ].join("\n");
    const job = await createPipelineJob("FALLBACK", project, entrada, [item.id], attempt, item.route);
    updatePipelineItem(project.id, item.id, { fallbackJobId:job.jobId, status:"AGUARDANDO_FALLBACK", error:failure.reason, errorCode:failure.errorCode });
    appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:"ENVIANDO", jobId:job.jobId, errorCode:failure.errorCode, reason:failure.reason });
    await dispatchCorvoBridge({ jobId:job.jobId, prompt:job.prompt, specialist:"FALLBACK", meta:{ projectId:project.id, itemId:item.id } });
    const status = await pollPipelineJob(job.jobId, project.id);
    const decision = Array.isArray(status?.manifest?.items)
      ? status.manifest.items.find((candidate:any) => String(candidate?.id || "") === String(item.id)) || status.manifest.items[0]
      : undefined;
    const fallbackStatus = String(decision?.status || "").toUpperCase();
    const destination = String(decision?.destination || "").toUpperCase();
    const promptRetry = String(decision?.retryPrompt || "");
    appendPipelineHistory(project.id, item.id, {
      at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:fallbackStatus || "INVALID_OUTPUT", jobId:job.jobId,
      errorCode:failure.errorCode, reason:String(decision?.reason || failure.reason), destination, promptRetry,
    });
    return { fallbackStatus, destination, promptRetry, reason:String(decision?.reason || failure.reason), jobId:job.jobId };
  }

  async function runRoutedWithFallback(project:Project, initialItem:PipelineItem) {
    let item = { ...initialItem, tentativaAtual:initialItem.tentativaAtual || 1 };
    while ((item.tentativaAtual || 1) <= MAX_PIPELINE_ATTEMPTS) {
      try {
        const output = item.route === "GERADOR"
          ? await runGeneratorSerialized(() => runRoutedItem(project, item))
          : await runRoutedItem(project, item);
        return { ok:true as const, item:output };
      } catch (error) {
        const failure = structuredFailure(error, item);
        appendPipelineHistory(project.id, item.id, {
          at:new Date().toISOString(), attempt:item.tentativaAtual || 1, specialist:item.route, status:"FALHOU",
          jobId:String(failure.status?.jobId || item.jobId || "") || undefined, errorCode:failure.errorCode, reason:failure.reason,
        });
        updatePipelineItem(project.id, item.id, { status:"FALHOU", error:failure.reason, errorCode:failure.errorCode });

        if ((item.tentativaAtual || 1) >= MAX_PIPELINE_ATTEMPTS) {
          updatePipelineItem(project.id, item.id, { status:"FALHA_FINAL", finalFailure:true, error:failure.reason, errorCode:failure.errorCode });
          return { ok:false as const, item, error:failure.reason };
        }

        let fallback;
        try { fallback = await runFallback(project, item, failure); }
        catch (fallbackError) {
          const message = bridgeErrorMessage(fallbackError);
          appendPipelineHistory(project.id, item.id, {
            at:new Date().toISOString(), attempt:item.tentativaAtual || 1, specialist:"FALLBACK", status:"FALHOU", reason:message,
          });
          updatePipelineItem(project.id, item.id, { status:"FALHA_FINAL", finalFailure:true, error:message });
          return { ok:false as const, item, error:message };
        }

        if (fallback.fallbackStatus !== "RETRY") {
          const message = fallback.reason || "Fallback marcou o ID como não recuperável.";
          updatePipelineItem(project.id, item.id, { status:"NAO_RECUPERAVEL", finalFailure:true, error:message });
          return { ok:false as const, item, error:message };
        }
        if (!["GERADOR","REFINADOR"].includes(fallback.destination) || !fallback.promptRetry) {
          const message = "Fallback retornou RETRY sem DESTINO/PROMPT_RETRY válidos.";
          updatePipelineItem(project.id, item.id, { status:"FALHA_FINAL", finalFailure:true, error:message });
          return { ok:false as const, item, error:message };
        }
        if (fallback.destination === "REFINADOR" && !item.sourceUrl) {
          const message = "Fallback apontou para o Refinador, mas este ID não possui imagem de origem disponível.";
          updatePipelineItem(project.id, item.id, { status:"FALHA_FINAL", finalFailure:true, error:message });
          return { ok:false as const, item, error:message };
        }

        const nextAttempt = (item.tentativaAtual || 1) + 1;
        item = {
          ...item,
          route:fallback.destination as "GERADOR"|"REFINADOR",
          tentativaAtual:nextAttempt,
          retryPrompt:fallback.promptRetry,
          fallbackJobId:fallback.jobId,
          status:"RETRY_PENDENTE",
          error:undefined,
          errorCode:undefined,
          finalFailure:false,
        };
        updatePipelineItem(project.id, item.id, {
          route:item.route, tentativaAtual:item.tentativaAtual, retryPrompt:item.retryPrompt, fallbackJobId:item.fallbackJobId,
          status:item.status, error:undefined, errorCode:undefined, finalFailure:false,
        });
      }
    }
    return { ok:false as const, item, error:"Limite de tentativas atingido." };
  }

  async function runRoutedPipeline(project:Project, items:PipelineItem[]) {
    const refiners = items.filter((item) => item.route === "REFINADOR");
    const generators = items.filter((item) => item.route === "GERADOR");
    const failures:{id:string;error:string}[] = [];
    let completed = 0;
    const total = items.length;
    const setProgress = (label:string) => {
      setImagePhase("searching");
      setImageProgress(Math.max(90, Math.min(99, 90 + (completed / Math.max(1,total)) * 9)));
      setImageMessage(label);
      setImageStatusLine(`${completed}/${total} IMAGENS FINAIS · FALLBACK AUTOMÁTICO · GERADOR 1 POR VEZ`);
    };
    setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, pipelineStatus:"ROTEANDO IMAGENS", pipelineItems:items } : entry));
    setProgress("O Analista terminou. Distribuindo imagens entre Refinador e Gerador...");

    let refinerIndex = 0;
    const refinerWorker = async () => {
      while (refinerIndex < refiners.length) {
        const item = refiners[refinerIndex++];
        const result = await runRoutedWithFallback(project, item);
        if (!result.ok) failures.push({ id:item.id, error:result.error });
        completed += 1;
        setProgress(`Refinando e recuperando imagens... ${completed}/${total}`);
      }
    };
    const refinerWorkers = Array.from({ length:Math.min(3, Math.max(1, refiners.length)) }, () => refinerWorker());

    const generatorWorker = (async () => {
      for (const item of generators) {
        const result = await runRoutedWithFallback(project, item);
        if (!result.ok) failures.push({ id:item.id, error:result.error });
        completed += 1;
        setProgress(`Gerador/Fallback trabalhando em fila única... ${completed}/${total}`);
      }
    })();

    await Promise.all([...refinerWorkers, generatorWorker]);
    if (failures.length) {
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, pipelineStatus:"TRATAMENTO MANUAL NECESSÁRIO" } : entry));
      setImagePhase("error");
      setImageProgress(100);
      setImageMessage(`${failures.length} imagem(ns) chegaram ao limite ou foram marcadas como não recuperáveis.`);
      setImageStatusLine(`${total-failures.length}/${total} FINAIS · ${failures.length} MANUAIS`);
      return;
    }
    setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, pipelineStatus:"IMAGENS FINAIS PRONTAS", imageCount:items.length } : entry));
    setImagePhase("done");
    setImageProgress(100);
    setImageMessage("Refinador, Gerador e Fallback concluíram todas as imagens finais. A Consolidação já pode gerar o ZIP final.");
    setImageStatusLine(`${items.length}/${items.length} IMAGENS FINAIS`);
  }

  async function dispatchAnalysis(project:Project, analysisJob:{jobId:string;prompt:string;uploadToken:string}, zipFile:any, expectedIds:string[]) {
    setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, analysisJobId:analysisJob.jobId, analysisStatus:"ENVIANDO AO ANALISTA", analysisZipUrl:zipFile.url, pipelineStatus:"ANALISANDO IMAGENS" } : entry));
    setImagePhase("searching"); setImageProgress(90); setImageMessage("Enviando todas as candidatas ao Corvo Analista..."); setImageStatusLine("ZIP BRUTO SALVO · ANALISTA ESCOLHENDO POR ID");
    await dispatchCorvoBridge({
      jobId:analysisJob.jobId,
      prompt:[
        analysisJob.prompt,
        "",
        "O ZIP bruto completo do Collector está anexado a esta conversa.",
        "Para CADA ID, compare TODAS as candidatas disponíveis antes de decidir.",
        "Não escolha pela ordem do arquivo. Elimine erros e duplicatas inferiores.",
        "Em PASSOU/PASSOU_COM_RESSALVAS, ARQUIVO deve conter exatamente o nome real da candidata escolhida no ZIP.",
        "Em NAO_PASSOU, deixe ARQUIVO vazio e forneça PROMPT_GERACAO completo.",
        "Preserve todos os IDs e entregue [CORVO_IMAGE_ANALYSIS] VERSION=1.1.",
      ].join("\n"),
      specialist:"ANALISTA",
      meta:{ projectId:project.id, attachments:[{ url:zipFile.url, name:zipFile.name, contentType:"application/zip" }] },
    });
    const status = await pollPipelineJob(analysisJob.jobId, project.id);
    const manifestItems = Array.isArray(status.manifest?.items) ? status.manifest.items : [];
    if (!manifestItems.length) throw new Error("O Analista concluiu sem um manifesto por ID.");
    const returnedIds = manifestItems.map((manifestItem:any) => String(manifestItem?.id || "").trim()).filter(Boolean);
    const duplicateReturned = returnedIds.filter((id:string,index:number) => returnedIds.indexOf(id) !== index);
    const missingReturned = expectedIds.filter((id:string) => !returnedIds.includes(id));
    const unexpectedReturned = returnedIds.filter((id:string) => !expectedIds.includes(id));
    if (duplicateReturned.length || missingReturned.length || unexpectedReturned.length) {
      throw new Error(`Manifesto do Analista inconsistente. Ausentes: ${missingReturned.join(",") || "nenhum"}; duplicados: ${[...new Set(duplicateReturned)].join(",") || "nenhum"}; inesperados: ${unexpectedReturned.join(",") || "nenhum"}.`);
    }

    const chosenNames = manifestItems.flatMap((manifestItem:any) => {
      const statusName = String(manifestItem.status || "").toUpperCase();
      if (statusName !== "PASSOU" && statusName !== "PASSOU_COM_RESSALVAS") return [];
      const file = String(manifestItem.file || "").trim();
      if (!file) throw new Error(`O Analista aprovou o ID ${String(manifestItem.id || "?")} sem informar ARQUIVO.`);
      return [file];
    });
    const sourceResponse = chosenNames.length ? await fetch("/api/corvo/candidato", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-corvo-upload-token":analysisJob.uploadToken },
      body:JSON.stringify({ jobId:analysisJob.jobId, fileNames:chosenNames }),
    }) : null;
    const sourceResult = sourceResponse ? await sourceResponse.json().catch(() => ({})) : { ok:true, files:[] };
    if (sourceResponse && (!sourceResponse.ok || !sourceResult?.ok)) throw new Error(sourceResult?.message || "Não foi possível localizar as candidatas escolhidas pelo Analista.");
    const collectorFiles = Array.isArray(sourceResult?.files) ? sourceResult.files : [];

    const pipelineItems:PipelineItem[] = manifestItems.flatMap((manifestItem:any) => {
      const id = String(manifestItem.id || "").trim();
      const statusName = String(manifestItem.status || "").toUpperCase();
      const sourceFile = String(manifestItem.file || "").trim();
      const sourceRecord = sourceFile ? collectorFiles.find((file:any) => String(file?.name || "").toLowerCase() === sourceFile.toLowerCase()) : null;
      const finalFile = sourceFile ? sourceFile.replace(/_c\d+(?=\.[^.]+$)/i, "").replace(/\.[^.]+$/, ".png") : `video1_${String(id).padStart(2,"0")}.png`;
      if (statusName === "PASSOU" || statusName === "PASSOU_COM_RESSALVAS") return [{
        id,
        route:"REFINADOR" as const,
        sourceFile,
        sourceUrl:sourceRecord?.url,
        refinement:String(manifestItem.refinement || (statusName === "PASSOU" ? "LEVE" : "FORTE")),
        reason:String(manifestItem.reason || ""),
        finalFile,
        status:"PENDENTE",
        tentativaAtual:1,
      }];
      if (statusName === "NAO_PASSOU") return [{
        id,
        route:"GERADOR" as const,
        sourceFile:"",
        generationPrompt:String(manifestItem.generationPrompt || ""),
        reason:String(manifestItem.reason || ""),
        finalFile:`video1_${String(id).padStart(2,"0")}.png`,
        status:"PENDENTE",
        tentativaAtual:1,
      }];
      return [];
    });
    if (pipelineItems.length !== expectedIds.length) throw new Error(`O Analista devolveu ${pipelineItems.length}/${expectedIds.length} IDs roteáveis.`);
    if (pipelineItems.some((item) => item.route === "REFINADOR" && !item.sourceUrl)) throw new Error("Uma candidata aprovada pelo Analista não foi localizada no pacote bruto do Collector.");
    setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, analysisStatus:"CONCLUÍDA", analysisManifest:String(status.resultado || ""), pipelineItems } : entry));
    await runRoutedPipeline(project, pipelineItems);
  }

  async function buildPackage(selectedGroups:RankedGroup[], token = runToken.current) {
    if (!active) return;
    const project = active;
    packageRetryRef.current = selectedGroups;
    const automatic = settings.selectionMode === "AUTO";
    setImagePhase("packaging"); setImageProgress(84);
    setImageMessage(automatic ? "Preparando todas as candidatas para o Analista..." : "Preparando as imagens escolhidas e a entrada do Analista...");
    try {
      await ensurePipelineStorageReady();
      const expectedIds = selectedGroups.map((group) => String(group.id));
      const selections = automatic ? buildAnalystRawSelections(selectedGroups, settings.prefix) : buildFormaSelections(selectedGroups, settings.prefix);
      if (!selections.length) throw new Error("O Collector não possui candidatas utilizáveis para enviar ao Analista.");
      const idsWithCandidates = new Set(selections.map((selection:any) => String(selection.id)));
      const missingCandidateIds = expectedIds.filter((id) => !idsWithCandidates.has(id));
      if (missingCandidateIds.length) throw new Error(`Sem candidatas para os IDs: ${missingCandidateIds.join(", ")}.`);
      const analysisJob = await createPipelineJob(
        "ANALISTA",
        project,
        [
          `PROJETO=${project.id}`,
          `MODO_SELECAO=${automatic ? "AUTOMATICO_ANALISTA" : "MANUAL_USUARIO"}`,
          `TOTAL_IDS=${expectedIds.length}`,
          `TOTAL_CANDIDATAS=${selections.length}`,
          `IDS_ESPERADOS=${expectedIds.join(",")}`,
          automatic
            ? "O app NÃO selecionou candidatas. O ZIP anexado conterá TODAS as candidatas disponíveis do Collector para cada ID."
            : "O usuário escolheu uma candidata por ID no modo manual; ainda assim valide visualmente cada imagem antes de classificar.",
          "Para PASSOU ou PASSOU_COM_RESSALVAS, informe ARQUIVO com o nome EXATO do arquivo escolhido no ZIP.",
          "Para NAO_PASSOU, ARQUIVO= e PROMPT_GERACAO completo.",
          "",
          "PROMPTS / CONTEXTO POR ID:",
          project.promptText || "",
          "",
          "ROTEIRO COMPLETO:",
          project.scriptText || "",
        ].join("\n"),
        expectedIds,
      );
      setProjects((currentProjects) => currentProjects.map((entry) => entry.id === project.id ? { ...entry, analysisJobId:analysisJob.jobId, analysisStatus:automatic?"RECEBENDO CANDIDATAS":"RECEBENDO IMAGENS", pipelineStatus:"PREPARANDO ANÁLISE" } : entry));
      const response = await sendCollectorMessage<any>("BUILD_FORMA_PACKAGE", {
        selections, productionId:project.id, prefix:settings.prefix, jpegQuality:settings.jpegQuality,
        fileName:automatic ? `${project.id}_CANDIDATAS_BRUTAS.zip` : `${project.id}_COLLECTOR.zip`,
        includeManifest:true, autoDownload:false, pipelineOnly:automatic, packageMode:automatic?"ANALYST_RAW":"FORMA",
        pipelineUpload:{ jobId:analysisJob.jobId, uploadToken:analysisJob.uploadToken, appOrigin:window.location.origin },
      }, settings.extensionId);
      if (!response?.ok) throw new Error(response?.error || "Falha ao montar o pacote.");
      const code = response.packageCode || "";
      while (token === runToken.current) {
        await wait(700);
        let status:any;
        try { status = (await sendCollectorMessage<any>("GET_PACKAGE_STATUS", undefined, settings.extensionId))?.package; }
        catch { setImageMessage("O pacote continua sendo preparado. Reconectando..."); await wait(1800); continue; }
        const total = Number(status?.total || selections.length); const current = Number(status?.current || 0);
        setImageProgress(Math.max(84, Math.min(89, 84 + (current / Math.max(1, total)) * 5)));
        setImageMessage(status?.currentName
          ? automatic ? `Enviando candidata ${current}/${total}: ${status.currentName}` : `Salvando ${status.currentName} no app...`
          : automatic ? "Finalizando envio das candidatas brutas..." : "Finalizando o pacote do Collector...");
        setImageStatusLine(`${Number(status?.pipelineUploaded || 0)}/${total} CANDIDATAS NO APP · ${expectedIds.length} IDS`);
        if (status?.status === "DONE") {
          if (Number(status.failed || 0) > 0) throw new Error(`O Collector não conseguiu preparar ${status.failed} candidata(s).`);
          if (Number(status.pipelineUploadFailed || 0) > 0 || Number(status.pipelineUploaded || 0) !== selections.length) {
            const detail = Array.isArray(status.pipelineErrors) && status.pipelineErrors.length ? ` Motivo: ${status.pipelineErrors[0]}` : "";
            throw new Error(`O app recebeu ${Number(status.pipelineUploaded || 0)}/${selections.length} candidatas.${detail}`);
          }
          const finalCode = status.packageCode || code;
          setPackageCode(finalCode);
          setProjects((currentProjects) => currentProjects.map((entry) => entry.id === project.id ? { ...entry, packageCode:finalCode, imageCount:expectedIds.length, analysisStatus:"MONTANDO ZIP BRUTO DE ANÁLISE" } : entry));
          setImageProgress(89); setImageMessage(`Montando ZIP com ${selections.length} candidatas para o Analista...`);
          const packageResponse = await fetch("/api/corvo/pacote", {
            method:"POST",
            headers:{ "content-type":"application/json", "x-corvo-upload-token":analysisJob.uploadToken },
            body:JSON.stringify({ jobId:analysisJob.jobId, fileName:`${project.id}_ANALISE_CANDIDATAS.zip`, selectionMode:automatic?"AUTO":"MANUAL" }),
          });
          const packageResult = await packageResponse.json().catch(() => ({}));
          if (!packageResponse.ok || !packageResult?.file?.url) throw new Error(packageResult?.message || "Não foi possível consolidar o ZIP bruto do Analista.");
          await dispatchAnalysis(project, analysisJob, packageResult.file, expectedIds);
          packageRetryRef.current = null;
          return;
        }
        if (status?.status === "ERROR") throw new Error(status.error || "Falha no pacote.");
      }
      return;
    } catch (error) {
      if (token !== runToken.current) return;
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, pipelineStatus:"ERRO NO PIPELINE", analysisStatus:entry.analysisStatus || "FALHOU" } : entry));
    }
  }

  async function retryImageFlow() {
    if (packageRetryRef.current?.length) {
      const token = ++runToken.current;
      setImageOpen(true);
      try {
        await ensurePipelineStorageReady();
        if (token !== runToken.current) return;
        await buildPackage(packageRetryRef.current, token);
      } catch (error) {
        if (token !== runToken.current) return;
        setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
      }
      return;
    }
    await startImageFlow();
  }

  async function buildFinalZip(project:Project) {
    const summary = consolidationState(project);
    if (!summary.ready || consolidationBusy) {
      setConsolidationMessage(summary.missingIds.length ? `Ainda faltam os IDs: ${summary.missingIds.join(", ")}.` : "A consolidação ainda possui pendências de IDs ou nomes.");
      return;
    }
    setConsolidationBusy(true);
    setConsolidationMessage("Baixando as imagens finais e validando o pacote...");
    setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, finalZipStatus:"GERANDO", finalZipError:undefined } : entry));
    try {
      const zip = new JSZip();
      const imagesFolder = zip.folder("imagens");
      const manifestItems:any[] = [];
      for (let index=0; index<summary.items.length; index++) {
        const item = summary.items[index];
        setConsolidationMessage(`Consolidando ${index+1}/${summary.items.length}: ID ${item.id}...`);
        const response = await fetch(String(item.outputUrl), { cache:"no-store" });
        if (!response.ok) throw new Error(`Não foi possível baixar a imagem final do ID ${item.id}.`);
        const blob = await response.blob();
        if (!blob.size) throw new Error(`O arquivo final do ID ${item.id} está vazio.`);
        const fileName = item.finalFile || item.outputFile || `video1_${String(item.id).padStart(2,"0")}.png`;
        imagesFolder?.file(fileName, blob);
        manifestItems.push({ id:item.id, arquivo:fileName, origem:item.route, tentativaFinal:item.tentativaAtual || 1, historico:item.history || [] });
      }

      const thumbFolder = zip.folder("thumbnail");
      if (project.thumbUrl) {
        const response = await fetch(project.thumbUrl, { cache:"no-store" });
        if (response.ok) thumbFolder?.file(project.thumbFileName || `thumb_${project.id.toLowerCase()}.png`, await response.blob());
        else thumbFolder?.file("STATUS.txt", `STATUS=FALHOU_AO_BAIXAR\\nURL=${project.thumbUrl}`);
      } else thumbFolder?.file("STATUS.txt", `STATUS=${project.thumbStatus || "PENDENTE"}\\n${project.thumbError ? `ERRO=${project.thumbError}` : ""}`);

      zip.folder("youtube")?.file("METADADOS.txt", project.youtubeMetadata || `STATUS=${project.youtubeStatus || "PENDENTE"}\\n${project.youtubeError ? `ERRO=${project.youtubeError}` : ""}`);
      zip.folder("analise")?.file("CORVO_IMAGE_ANALYSIS.txt", project.analysisManifest || "STATUS=NAO_DISPONIVEL");
      zip.file("CORVO_FINAL_MANIFEST.json", JSON.stringify({
        protocol:"corvo-final/1", projectId:project.id, generatedAt:new Date().toISOString(), total:summary.items.length,
        thumbnail:project.thumbFileName || null, youtubeMetadata:Boolean(project.youtubeMetadata), images:manifestItems,
      }, null, 2));
      zip.file("LEIA-ME.txt", [
        "CORVOQUIZ — PACOTE FINAL", `PROJETO=${project.id}`, `TOTAL_IMAGENS=${summary.items.length}`,
        "", "imagens/ = imagens finais ordenadas por ID", "thumbnail/ = thumbnail real quando disponível", "youtube/ = metadados editoriais", "analise/ = manifesto do Corvo Analista",
      ].join("\\n"));
      const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${project.id}_CORVO_FINAL.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      const generatedAt = new Date().toISOString();
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, finalZipStatus:"CONCLUIDO", finalZipGeneratedAt:generatedAt, finalZipError:undefined } : entry));
      setConsolidationMessage(`ZIP final criado com ${summary.items.length} imagens. Thumbnail e metadados foram incluídos quando disponíveis.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Falha ao gerar ZIP final.");
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, finalZipStatus:"FALHOU", finalZipError:message } : entry));
      setConsolidationMessage(message);
    } finally { setConsolidationBusy(false); }
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
    setCollectorRunning(false);
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
      <div className="header-actions"><button className="corvo-link" onClick={openNewProduction}><span className="online-dot" /> PEDIR IDEIAS AO CORVO</button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Configurações">•••</button></div>
    </header>

    <section className="hero" id="top"><div><span className="eyebrow"><i /> CENTRAL DE PRODUÇÃO</span><h1>DA IDEIA AO <em>PACOTE FINAL.</em></h1><p>O Corvo cuida da pesquisa, das imagens e da organização.<br />Você só acompanha, escolhe e aprova.</p></div><button className="new-project" onClick={openNewProduction}><span>＋</span><b>NOVA PRODUÇÃO</b><small>COMEÇAR DO ZERO</small></button></section>

    <section className="workspace" id="producao">
      <div className="section-heading"><div><span className="section-number">01</span><h2>EM PRODUÇÃO</h2></div><button className="text-button" onClick={openNewProduction}>CRIAR OUTRA <span>↗</span></button></div>
      {active && <article className="production-card">
        <div className="card-main">
          <div className="project-meta"><span className="format-tag">{active.format}</span><span>{active.quantity}</span><span>{active.createdAt}</span></div>
          <h3>{active.title}</h3><p>{active.id}</p>
          <div className="stepper">{steps.map((step,index) => { const complete=index+1<active.stage; const current=index+1===active.stage; return <div className={`step ${complete?"complete":""} ${current?"current":""}`} key={step}><span>{complete?"✓":String(index+1).padStart(2,"0")}</span><small>{step}</small></div>; })}</div>
          <div className="card-actions">
            <button className="primary-action" onClick={continueProduction}>{active.stage<=2?(active.scriptText?"REVISAR ROTEIRO":"CRIAR ROTEIRO"):active.stage===3?(active.promptText?"REVISAR PROMPTS":"CRIAR PROMPTS"):active.stage===4?"BUSCAR IMAGENS":"BAIXAR PRODUÇÃO"} <span>→</span></button>
            <button className="secondary-action" onClick={() => downloadProject(active)}>↓ BAIXAR PROJETO</button>
          </div>
        </div>
        <aside className="card-side" id="arquivos">
          <div className="mini-title"><span>MEMÓRIA DA PRODUÇÃO</span><b>{[active.ideaText,active.scriptText,active.promptText].filter(Boolean).length}/3</b></div>
          <button className="file-row done action" onClick={()=>openArtifact("IDEIA")}><span>◆</span><div><b>IDEIA ESCOLHIDA</b><small>ABRIR CONCEITO ORIGINAL</small></div><i>→</i></button>
          <button className={`file-row action ${active.scriptText?"done":"pending"}`} disabled={!active.scriptText} onClick={()=>openArtifact("ROTEIRO")}><span>▤</span><div><b>ROTEIRO.TXT</b><small>{active.scriptText?"ABRIR ROTEIRO COMPLETO":"AGUARDANDO ROTEIRISTA"}</small></div><i>{active.scriptText?"→":"○"}</i></button>
          <button className={`file-row action ${active.promptText?"done":"pending"}`} disabled={!active.promptText} onClick={()=>openArtifact("PROMPTS")}><span>✦</span><div><b>PROMPTS.TXT</b><small>{active.promptText?"ABRIR BUSCAS DE IMAGEM":"AGUARDANDO ROTEIRO"}</small></div><i>{active.promptText?"→":"○"}</i></button>
          <button className={`file-row action ${active.thumbUrl?"done":active.thumbStatus==="FALHOU"?"pending":""}`} disabled={!active.thumbUrl} onClick={()=>active.thumbUrl&&window.open(active.thumbUrl,"_blank","noopener,noreferrer")}><span>▰</span><div><b>THUMBNAIL</b><small>{active.thumbUrl?"ABRIR IMAGEM FINAL":active.thumbError||active.thumbStatus||"INICIA EM PARALELO COM O COLLECTOR"}</small></div><i>{active.thumbUrl?"→":"○"}</i></button>
          <button className={`file-row action ${active.analysisStatus==="CONCLUÍDA"?"done":active.analysisStatus?"pending":""}`} disabled={!active.analysisManifest} onClick={()=>{if(active.analysisManifest){setNotice("MANIFESTO DO ANALISTA SALVO NO PROJETO.");setTimeout(()=>setNotice(""),2800);}}}><span>◫</span><div><b>ANÁLISE DE IMAGENS</b><small>{active.analysisStatus||"COMEÇA APÓS O PACOTE DO COLLECTOR"}</small></div><i>{active.analysisStatus==="CONCLUÍDA"?"✓":"○"}</i></button>
          <button className={`file-row action ${active.youtubeMetadata?"done":active.youtubeStatus==="FALHOU"?"pending":""}`} disabled={!active.youtubeMetadata} onClick={()=>{if(active.youtubeMetadata)downloadTextFile(`${active.id}_YOUTUBE.txt`,active.youtubeMetadata);}}><span>▶</span><div><b>YOUTUBE / METADADOS</b><small>{active.youtubeMetadata?"BAIXAR DADOS EDITORIAIS":active.youtubeError||active.youtubeStatus||(settings.youtubeParallel?"INICIA EM PARALELO":"DESATIVADO NAS CONFIGURAÇÕES")}</small></div><i>{active.youtubeMetadata?"↓":"○"}</i></button>
          <button className={`file-row action ${consolidationState(active).ready?"done":active.pipelineItems?.length?"pending":""}`} disabled={!active.pipelineItems?.length} onClick={()=>{setConsolidationMessage("");setConsolidationOpen(true);}}><span>▦</span><div><b>CONSOLIDAÇÃO / ZIP FINAL</b><small>{active.pipelineItems?.length ? `${consolidationState(active).completed}/${consolidationState(active).items.length} FINAIS · ${consolidationState(active).ready ? "PRONTO PARA GERAR" : active.pipelineStatus || "AGUARDANDO"}` : "AGUARDANDO O ANALISTA"}</small></div><i>{active.finalZipStatus==="CONCLUIDO"?"✓":consolidationState(active).ready?"→":"○"}</i></button>
          {active.packageCode ? <button className="package-ready" onClick={() => active.pipelineStatus==="ERRO NO PIPELINE" ? void startImageFlow() : setImageOpen(true)}><span>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"✓":"⌁"}</span><div><b>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"IMAGENS FINAIS PRONTAS":"PIPELINE DE IMAGENS"}</b><small>{active.pipelineStatus||`${active.imageCount || 0} ARQUIVOS · ${active.packageCode}`}</small></div></button> : <button className="collector-box" disabled={!active.promptText || active.stage<4} onClick={startImageFlow}><span>⌁</span><b>{collectorRunning?"ACOMPANHAR BUSCA":active.promptText&&active.stage>=4?"BUSCAR COM O CORVO":"AGUARDANDO PROMPTS"}</b><small>{collectorRunning?"O COLLECTOR CONTINUA TRABALHANDO":active.promptText&&active.stage>=4?`MOTOR: ${collectorEngines[settings.sourceMode].label} · SEGUNDO PLANO`:"A PRÓXIMA ETAPA SERÁ LIBERADA"}</small></button>}
        </aside>
      </article>}
    </section>

    <section className="projects" id="projetos"><div className="section-heading"><div><span className="section-number">02</span><h2>PROJETOS RECENTES</h2></div><span className="project-count">{String(projects.length).padStart(2,"0")} PRODUÇÕES</span></div><div className="project-list">{projects.map((project) => <button className={`project-row ${project.id===activeId?"selected":""}`} key={project.id} onClick={() => setActiveId(project.id)}><span className="project-icon">{project.format==="REELS"?"▯":"▭"}</span><span className="project-name"><b>{project.title}</b><small>{project.id}</small></span><span className="project-format">{project.format}</span><span className="progress"><i style={{width:`${project.stage*20}%`}} /></span><span className="stage-label">ETAPA {project.stage}/5</span><span className="row-arrow">→</span></button>)}</div></section>
    <footer><span>CORVOQUIZ PRODUÇÃO <i>V0.6.11</i></span><span>ANALISTA ESCOLHE · ROTEAMENTO · ZIP FINAL · V0.6.11</span></footer>
    {notice && <div className="toast">{notice}</div>}

    {createOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target===event.currentTarget&&closeCreationModal()}><section className="creation-modal idea-modal" role="dialog" aria-modal="true" aria-labelledby="new-production-title"><button className="modal-close" disabled={ideaLoading} onClick={closeCreationModal} aria-label="Fechar">×</button><div className="modal-symbol">✦</div><span className="modal-kicker">{ideaRevisionProjectId?"REFAZER IDEIA":"NOVA PRODUÇÃO"}</span><h2 id="new-production-title">{ideaRevisionProjectId?"ESCOLHA UMA NOVA DIREÇÃO":"O QUE VAMOS CRIAR?"}</h2><p>{ideaRevisionProjectId?"Ao confirmar, roteiro, prompts e imagens serão refeitos automaticamente.":"Comece sem tema e peça ideias ao Corvo, ou informe uma direção opcional."}</p>
      <div className="field-group"><label>FORMATO</label><div className="segmented">{(["REELS","VÍDEO COMPLETO"] as Format[]).map((item)=><button className={format===item?"selected":""} onClick={()=>setFormat(item)} key={item}>{item}</button>)}</div></div>
      <div className="modal-grid"><div className="field-group"><label>QUANTIDADE</label><div className="segmented compact">{(["1 VÍDEO","LOTE"] as Quantity[]).map((item)=><button className={quantity===item?"selected":""} onClick={()=>setQuantity(item)} key={item}>{item}</button>)}</div></div><div className="field-group"><label>MODO</label><div className="segmented compact">{(["RÁPIDO","PESQUISAR ANTES"] as Mode[]).map((item)=><button className={mode===item?"selected":""} onClick={()=>setMode(item)} key={item}>{item}</button>)}</div></div></div>
      <div className="field-group topic-field"><label>TEMA OPCIONAL</label><input value={topic} onChange={(event)=>{setTopic(event.target.value);setSelectedIdea(null);}} onKeyDown={(event)=>event.key==="Enter"&&createProject()} placeholder="SEM TEMA SELECIONADO" /></div>
      {ideas.length ? <div className="idea-results"><div className="idea-results-head"><span>IDEIAS DO CORVO</span><small>ESCOLHA UMA</small></div>{ideas.map((idea,index)=><button className={`idea-card ${selectedIdea===index?"selected":""}`} onClick={()=>{setSelectedIdea(index);setTopic("");}} key={`${idea.titulo}-${index}`}><span>{String(index+1).padStart(2,"0")}</span><div><b>{idea.titulo}</b><small>{idea.tema}</small></div><i>{selectedIdea===index?"✓":"→"}</i></button>)}</div> : <button className="empty-theme selected" onClick={()=>{setTopic("");setSelectedIdea(null);}}><span>○</span><div><b>SEM TEMA SELECIONADO</b><small>O CORVO PODE CRIAR AS OPÇÕES PARA VOCÊ</small></div><i>PADRÃO</i></button>}
      <button className={`corvo-ideas ${selectedIdea===null&&!topic.trim()?"primary":""} ${ideaLoading?"loading":""}`} onClick={()=>void generateCorvoIdeas()} disabled={ideaLoading}><span className={ideaLoading?"idea-spinner":"online-dot"} /> {ideaLoading?(ideaMessage||"CORVO ESTÁ CRIANDO..."):ideas.length?"GERAR NOVAS IDEIAS":"GERAR IDEIAS COM O CORVO"} <i>{ideaLoading?"":"✦"}</i></button>
      {(selectedIdea!==null||topic.trim())&&<button className="modal-submit" onClick={createProject}>{ideaRevisionProjectId?"APLICAR E REFAZER O FLUXO":selectedIdea!==null?"USAR ESTA IDEIA":"COMEÇAR COM ESTE TEMA"} <span>→</span></button>}
      <small className="idea-return-note">O BRIDGE ENVIA AO GPT EM SEGUNDO PLANO. A ACTION DEVOLVE AS IDEIAS DIRETAMENTE A ESTE MODAL.</small>
    </section></div>}

    {consolidationOpen && active && <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&!consolidationBusy&&setConsolidationOpen(false)}><section className="workflow-modal consolidation-modal">
      <button className="modal-close" disabled={consolidationBusy} onClick={()=>setConsolidationOpen(false)} aria-label="Fechar consolidação">×</button>
      <span className="modal-kicker">CONSOLIDAÇÃO / ZIP FINAL</span><h2>{consolidationState(active).ready?"PACOTE PRONTO PARA FECHAR":"AGUARDANDO AS IMAGENS FINAIS"}</h2>
      <p>{consolidationState(active).completed}/{consolidationState(active).items.length} imagens finais disponíveis. O ZIP só libera quando não há ID ausente ou duplicado.</p>
      <div className="consolidation-summary"><span>IDS <b>{consolidationState(active).items.length}</b></span><span>CONCLUÍDOS <b>{consolidationState(active).completed}</b></span><span>AUSENTES <b>{consolidationState(active).missingIds.length}</b></span><span>DUPLICADOS <b>{consolidationState(active).duplicateIds.length + consolidationState(active).duplicateFiles.length}</b></span></div>
      <div className="consolidation-list">{consolidationState(active).items.map((item)=><div className={item.outputUrl&&!item.finalFailure?"ok":item.finalFailure?"fail":"waiting"} key={`${item.id}-${item.finalFile}`}><span>{item.id}</span><div><b>{item.finalFile}</b><small>{item.status||"PENDENTE"} · TENTATIVA {item.tentativaAtual||1}{item.errorCode?` · ${item.errorCode}`:""}</small>{item.history?.length?<small>HISTÓRICO: {item.history.map((event)=>`${event.specialist}:${event.status}`).join(" → ")}</small>:null}{item.error&&<em>{item.error}</em>}</div><i>{item.outputUrl&&!item.finalFailure?"✓":item.finalFailure?"!":"…"}</i></div>)}</div>
      {(consolidationState(active).duplicateIds.length>0||consolidationState(active).duplicateFiles.length>0||consolidationState(active).invalidFiles.length>0)&&<div className="consolidation-warning">{consolidationState(active).duplicateIds.length?`IDs duplicados: ${consolidationState(active).duplicateIds.join(", ")}. `:""}{consolidationState(active).duplicateFiles.length?`Arquivos duplicados: ${consolidationState(active).duplicateFiles.join(", ")}. `:""}{consolidationState(active).invalidFiles.length?`Formato/nome inválido nos IDs: ${consolidationState(active).invalidFiles.join(", ")}.`:""}</div>}
      {consolidationMessage&&<div className="consolidation-message">{consolidationMessage}</div>}
      <button className="modal-submit success" disabled={!consolidationState(active).ready||consolidationBusy} onClick={()=>void buildFinalZip(active)}>{consolidationBusy?"GERANDO ZIP...":"GERAR ZIP FINAL PARA O FORMA"} <span>→</span></button>
      <button className="plain-close" disabled={consolidationBusy} onClick={()=>setConsolidationOpen(false)}>FECHAR</button>
    </section></div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setSettingsOpen(false)}><section className="settings-modal">
      <button className="modal-close" onClick={()=>setSettingsOpen(false)} aria-label="Fechar configurações">×</button>
      <span className="modal-kicker">COMPORTAMENTO DAS IMAGENS</span><h2>COMO O CORVO DEVE ESCOLHER?</h2><p>Estas opções ficam salvas e não aparecem durante a produção.</p>
      <div className="choice-cards"><button className={settings.selectionMode==="AUTO"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"AUTO"})}><b>⚡ AUTOMÁTICO</b><small>ENVIA TODAS AS CANDIDATAS AO ANALISTA</small></button><button className={settings.selectionMode==="MANUAL"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"MANUAL"})}><b>◉ REVISÃO RÁPIDA</b><small>VOCÊ ESCOLHE UMA CANDIDATA POR ID</small></button></div>
      <div className="choice-cards"><button className={settings.youtubeParallel?"selected":""} onClick={()=>setSettings({...settings,youtubeParallel:true})}><b>▶ METADADOS EM PARALELO</b><small>CHAMA O CORVO YOUTUBE JUNTO AO COLLECTOR</small></button><button className={!settings.youtubeParallel?"selected":""} onClick={()=>setSettings({...settings,youtubeParallel:false})}><b>○ METADADOS DESATIVADOS</b><small>PODE SER ATIVADO QUANDO O GPT YOUTUBE ESTIVER PRONTO</small></button></div>
      <section className="collector-engine-settings" aria-labelledby="collector-engine-title">
        <div className="engine-heading"><div><span>MOTOR DO COLETOR</span><h3 id="collector-engine-title">ONDE BUSCAR AS IMAGENS?</h3></div><small>ATIVO: {collectorEngines[settings.sourceMode].label}</small></div>
        <div className="engine-cards">{(["MIXED","GOOGLE","PINTEREST"] as SourceMode[]).map((item)=>{
          const engine=collectorEngines[item];
          return <button type="button" className={settings.sourceMode===item?"selected":""} aria-pressed={settings.sourceMode===item} onClick={()=>setSettings({...settings,sourceMode:item})} key={item}><span>{engine.icon}</span><div><b>{engine.label}</b><small>{engine.description}</small></div><i>{settings.sourceMode===item?"ATIVO":"USAR"}</i></button>;
        })}</div>
        <p>A escolha fica salva neste navegador e também é usada em “PROCURAR MAIS”.</p>
      </section>
      <section className="downloads-section" aria-labelledby="downloads-title">
        <div className="downloads-head"><div><span>INSTALAÇÃO E SUPORTE</span><h3 id="downloads-title">ARQUIVOS PARA BAIXAR</h3></div><small>SE PRECISAR REINSTALAR</small></div>
        <div className="download-grid">
          <a className="download-card" href="/downloads/CORVO_COLLECTOR_V077_EXTENSION.zip" download><span>⌁</span><div><b>EXTENSÃO DE IMAGENS</b><small>CORVO COLLECTOR V0.7.7</small></div><i>↓</i></a>
          <a className="download-card" href="/downloads/CORVO_BRIDGE_V065_EXTENSION.zip" download><span>↗</span><div><b>EXTENSÃO DO BRIDGE</b><small>CORVO BRIDGE V0.6.5 · ZIP GRANDE + CAPTURA + LIMPEZA</small></div><i>↓</i></a>
          <a className="download-card featured" href="/downloads/CORVOQUIZ_KIT_COMPLETO_V0611.zip" download><span>◆</span><div><b>KIT COMPLETO CORVOQUIZ</b><small>APP + EXTENSÕES + SCHEMA</small></div><i>↓</i></a>
        </div>
      </section>
      <details className="advanced-settings"><summary>CONFIGURAÇÕES AVANÇADAS</summary><div className="settings-grid"><label>CANDIDATAS<input type="number" value={settings.maxCandidates} onChange={(event)=>setSettings({...settings,maxCandidates:Number(event.target.value)})}/></label><label>VARREDURA<input type="number" value={settings.scrollSteps} onChange={(event)=>setSettings({...settings,scrollSteps:Number(event.target.value)})}/></label><label>QUALIDADE JPEG<input type="number" step=".01" value={settings.jpegQuality} onChange={(event)=>setSettings({...settings,jpegQuality:Number(event.target.value)})}/></label><label>PREFIXO<input value={settings.prefix} onChange={(event)=>setSettings({...settings,prefix:event.target.value})}/></label></div><label className="batch-label">COMANDOS EM LOTE — OPCIONAL<textarea value={settings.batchText} onChange={(event)=>setSettings({...settings,batchText:event.target.value})} placeholder={"01|primeira busca\n02|segunda busca"} /></label></details>
      <button className="modal-submit" onClick={()=>setSettingsOpen(false)}>SALVAR E FECHAR <span>✓</span></button>
    </section></div>}

    {artifactOpen && active && <div className="modal-backdrop artifact-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setArtifactOpen(false)}><section className="artifact-modal" role="dialog" aria-modal="true" aria-labelledby="artifact-title">
      <button className="modal-close" onClick={()=>setArtifactOpen(false)} aria-label="Fechar">×</button>
      <span className="modal-kicker">MEMÓRIA DA PRODUÇÃO</span><h2 id="artifact-title">CONTEÚDO DO PROJETO</h2><p>{active.title}</p>
      <div className="artifact-tabs">{(["IDEIA","ROTEIRO","PROMPTS"] as ProjectArtifact[]).map((kind)=>{
        const available=kind==="IDEIA"?Boolean(active.ideaText):kind==="ROTEIRO"?Boolean(active.scriptText):Boolean(active.promptText);
        return <button className={artifactKind===kind?"active":""} disabled={!available} onClick={()=>setArtifactKind(kind)} key={kind}><span>{kind==="IDEIA"?"◆":kind==="ROTEIRO"?"▤":"✦"}</span>{kind}<small>{available?"DISPONÍVEL":"PENDENTE"}</small></button>;
      })}</div>
      <div className="artifact-file-head"><span>{artifactKind==="IDEIA"?"IDEIA_ESCOLHIDA.TXT":artifactKind==="ROTEIRO"?"ROTEIRO.TXT":"PROMPTS_IMAGENS.TXT"}</span><small>SALVO NESTE PROJETO</small></div>
      <pre className="artifact-output">{artifactContent}</pre>
      <div className="artifact-actions"><button onClick={copyArtifact}>⧉ COPIAR CONTEÚDO</button><button onClick={()=>downloadTextFile(`${active.id}_${artifactKind}.txt`,artifactContent)}>↓ BAIXAR TXT</button></div>
      <div className="artifact-redo"><div><b>↻ REFAZER COM O GPT</b><small>{artifactRedoMessage}</small></div><button onClick={redoArtifact}>REFAZER ESTA ETAPA <span>→</span></button></div>
    </section></div>}

    {workflowOpen && active && <div className="modal-backdrop workflow-backdrop"><section className="workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-title">
      <button className="modal-close" onClick={()=>setWorkflowOpen(false)} aria-label="Fechar">×</button>
      <div className={`workflow-icon ${workflowLoading?"working":""}`}>{workflowKind==="ROTEIRO"?"▤":"✦"}</div>
      <span className="modal-kicker">{workflowKind==="ROTEIRO"?"CORVO ROTEIRO":"PROMPTS DE IMAGEM"}</span>
      <h2 id="workflow-title">{workflowLoading?workflowKind==="ROTEIRO"?"CRIANDO O ROTEIRO...":"LENDO O ROTEIRO...":workflowError?"PRECISAMOS TENTAR NOVAMENTE":workflowKind==="ROTEIRO"?"ROTEIRO DISPONÍVEL":"PROMPTS DISPONÍVEIS"}</h2>
      {workflowLoading ? <div className="workflow-wait"><div className="idea-spinner" /><p>{workflowMessage||"O especialista está trabalhando em segundo plano."}</p><small>O RESULTADO VOLTA AUTOMATICAMENTE PARA ESTE CAMPO.</small></div> : workflowError ? <div className="workflow-error"><p>{workflowError}</p><button className="modal-submit" onClick={()=>runSpecialist(workflowKind)}>TENTAR NOVAMENTE <span>↻</span></button></div> : workflowOutput ? <>
        <div className="workflow-file-head"><span>{workflowKind==="ROTEIRO"?"ROTEIRO.TXT":"PROMPTS.TXT"}</span><small>{workflowKind==="PROMPTS"?`${parseGuideText(workflowOutput).length} BUSCAS IDENTIFICADAS`:"TEXTO COMPLETO RECEBIDO"}</small></div>
        <pre className="workflow-output">{workflowOutput}</pre>
        <div className="workflow-actions"><button onClick={()=>runSpecialist(workflowKind)}>↻ PEDIR OUTRO</button><button onClick={()=>downloadTextFile(workflowKind==="ROTEIRO"?`${active.id}_ROTEIRO.txt`:`${active.id}_PROMPTS.txt`,workflowOutput)}>↓ BAIXAR TXT</button></div>
        <button className="modal-submit" onClick={approveWorkflow}>{workflowKind==="ROTEIRO"?"APROVAR E CRIAR PROMPTS":"APROVAR E IR PARA IMAGENS"} <span>→</span></button>
      </> : <div className="workflow-wait"><p>Esta etapa ainda não foi iniciada.</p><button className="modal-submit" onClick={()=>runSpecialist(workflowKind)}>COMEÇAR AGORA <span>→</span></button></div>}
    </section></div>}

    {imageOpen && <div className="modal-backdrop image-backdrop"><section className={`image-modal phase-${imagePhase}`}>
      <button className="modal-close" onClick={()=>setImageOpen(false)} aria-label="Ocultar janela">×</button>
      {imagePhase==="review" && currentGroup && currentRank ? <>
        <div className="review-top"><div><span className="modal-kicker">SELEÇÃO RÁPIDA · {groupIndex+1}/{groups.length}</span><h2>{currentGroup.query}</h2></div><div className="review-counter">CENA {String(groupIndex+1).padStart(2,"0")}</div></div>
        <div className="review-layout"><div className="candidate-stage"><img src={currentRank.candidate.previewUrl} alt={currentGroup.query} referrerPolicy="no-referrer" /><div className="image-quality"><span>{currentRank.candidate.width||"—"} × {currentRank.candidate.height||"—"}</span><span>OPÇÃO {candidatePos+1}/{currentGroup.ranked.length}</span></div></div><aside className="review-side"><span className="review-label">ESTA IMAGEM FUNCIONA?</span><p>Escolha rapidamente. O Corvo guarda reservas e prepara os nomes automaticamente.</p><button className="use-image" onClick={useCurrentCandidate}>✓ USAR ESTA IMAGEM</button><button className="next-image" onClick={()=>setCandidatePos((value)=>Math.min(value+1,currentGroup.ranked.length-1))}>VER PRÓXIMA <span>→</span></button><button className="search-more" disabled={searchingMore} onClick={searchMore}>{searchingMore?"PROCURANDO...":"↻ PROCURAR MAIS"}</button><div className="thumb-strip">{currentGroup.ranked.slice(0,4).map((rank,index)=><button className={candidatePos===index?"active":""} onClick={()=>setCandidatePos(index)} key={candidateUrl(rank.candidate)}><img src={rank.candidate.previewUrl} alt="" referrerPolicy="no-referrer"/></button>)}</div></aside></div>
      </> : <div className="image-status-view"><div className={`status-orb ${imagePhase}`}>{imagePhase==="done"?"✓":imagePhase==="error"?"!":"⌁"}</div><span className="modal-kicker">{imagePhase==="connecting"?"CONECTANDO":imagePhase==="searching"?"BUSCANDO IMAGENS":imagePhase==="packaging"?"ORGANIZANDO":imagePhase==="done"?"PACOTE PRONTO":"PRECISAMOS AJUSTAR"}</span><h2>{imagePhase==="done"?"TUDO CERTO.":imagePhase==="error"?"NÃO FOI POSSÍVEL CONTINUAR":imageMessage}</h2>{!["searching","packaging"].includes(imagePhase)&&<p>{imageMessage}</p>}<div className="image-progress"><i style={{width:`${imageProgress}%`}} /></div>{imagePhase==="searching"&&<div className="collector-live-status"><b>{imageStatusLine}</b><small>SEM LIMITE CURTO DE TEMPO · VOCÊ PODE OCULTAR ESTA JANELA E VOLTAR DEPOIS</small><button onClick={cancelImageFlow}>CANCELAR BUSCA</button></div>}{imagePhase==="done"&&<><div className="package-summary"><span>✓ IMAGENS</span><span>✓ NOMES CONFERIDOS</span><span>✓ PIPELINE</span><b>{packageCode||active?.packageCode}</b></div><button className="modal-submit success" onClick={()=>setImageOpen(false)}>CONCLUIR ETAPA <span>→</span></button><details className="package-options"><summary>OPÇÕES DO PACOTE</summary><button onClick={savePackageCopy}>SALVAR ZIP ORIGINAL DO COLLECTOR</button></details></>}{imagePhase==="error"&&<><button className="modal-submit" onClick={retryImageFlow}>{packageRetryRef.current?.length?"REENVIAR AS IMAGENS":"TENTAR NOVAMENTE"} <span>↻</span></button><button className="plain-close" onClick={()=>setImageOpen(false)}>FECHAR</button></>}</div>}
    </section></div>}
  </main>;
}
