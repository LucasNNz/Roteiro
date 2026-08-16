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
type AutoRunStatus = "RUNNING" | "DONE" | "ERROR" | "CANCELLED";
type AutoRunStep = "VALIDANDO" | "IDEIA" | "ROTEIRO" | "PROMPTS" | "COLLECTOR" | "ANALISTA" | "IMAGENS" | "THUMB" | "METADADOS" | "CONSOLIDANDO" | "CONCLUIDO" | "ERRO";
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
  analysisJobId?:string; analysisStatus?:string; analysisZipUrl?:string; analysisZipName?:string; analysisManifest?:string; analysisExpectedIds?:string[];
  analysisPrompt?:string; analysisUploadToken?:string; analysisPreparedAt?:string; analysisLastDispatchAt?:string; analysisRetryAt?:string; analysisRetryCount?:number; analysisLastError?:string;
  analysisPreparationStage?:"JOB_CREATED"|"CANDIDATES_PREPARING"|"CANDIDATES_STORED"|"ZIP_BUILDING"|"ZIP_SAVED";
  analysisExpectedCandidates?:number; analysisStoredCandidates?:number; analysisStoredIds?:number; analysisBatchTotal?:number; analysisBatchesUploaded?:number;
  analysisCollectorPackageId?:string; analysisCollectorPackageCode?:string; analysisPackageFileName?:string; analysisSelectionMode?:"AUTO"|"MANUAL";
  analysisPreparationRetryAt?:string; analysisPreparationRetryCount?:number; analysisPreparationError?:string;
  pipelineStatus?:string; pipelineItems?:PipelineItem[];
  youtubeJobId?:string; youtubeStatus?:string; youtubeMetadata?:string; youtubeError?:string;
  finalZipStatus?:string; finalZipError?:string; finalZipGeneratedAt?:string;
  autoRunStatus?:AutoRunStatus; autoRunStep?:AutoRunStep; autoRunMessage?:string; autoRunError?:string; autoRunStartedAt?:string; autoRunCompletedAt?:string;
  autoWorkflowJobId?:string; autoWorkflowKind?:WorkflowKind;
};
type CollectorSettings = {
  selectionMode:SelectionMode; sourceMode:SourceMode; maxCandidates:number; analystCandidatesPerId:number; scrollSteps:number;
  extensionId:string; prefix:string; jpegQuality:number; batchText:string; youtubeParallel:boolean;
};

const EMPTY_IMAGE_PIPELINE:Partial<Project> = {
  packageCode:undefined, imageCount:undefined,
  analysisJobId:undefined, analysisStatus:undefined, analysisZipUrl:undefined, analysisZipName:undefined, analysisManifest:undefined,
  analysisExpectedIds:undefined, analysisPrompt:undefined, analysisUploadToken:undefined, analysisPreparedAt:undefined,
  analysisLastDispatchAt:undefined, analysisRetryAt:undefined, analysisRetryCount:undefined, analysisLastError:undefined,
  analysisPreparationStage:undefined, analysisExpectedCandidates:undefined, analysisStoredCandidates:undefined, analysisStoredIds:undefined,
  analysisBatchTotal:undefined, analysisBatchesUploaded:undefined, analysisCollectorPackageId:undefined, analysisCollectorPackageCode:undefined,
  analysisPackageFileName:undefined, analysisSelectionMode:undefined, analysisPreparationRetryAt:undefined, analysisPreparationRetryCount:undefined, analysisPreparationError:undefined,
  pipelineStatus:undefined, pipelineItems:undefined, finalZipStatus:undefined, finalZipError:undefined, finalZipGeneratedAt:undefined,
};

const initialProjects:Project[] = [
  { id:"DESERTO_SOBREVIVENCIA_01", title:"VOCÊ SOBREVIVERIA NO DESERTO?", topic:"sobrevivência no deserto", format:"REELS", quantity:"1 VÍDEO", mode:"RÁPIDO", stage:4, createdAt:"HOJE, 10:42", ideaText:"TÍTULO: VOCÊ SOBREVIVERIA NO DESERTO?\nTEMA: SOBREVIVÊNCIA NO DESERTO", scriptText:"ROTEIRO DE EXEMPLO JÁ REVISADO", promptText:"01|deserto amplo com sol forte e composição para quiz sem texto\n02|mochila de sobrevivência isolada em fundo simples" },
  { id:"ANIMAIS_IMPOSSIVEIS_02", title:"QUAL ANIMAL FARIA ISSO?", topic:"animais curiosos", format:"REELS", quantity:"LOTE", mode:"PESQUISAR ANTES", stage:2, createdAt:"ONTEM, 18:15" },
];
const defaultSettings:CollectorSettings = { selectionMode:"MANUAL", sourceMode:"MIXED", maxCandidates:20, analystCandidatesPerId:10, scrollSteps:20, extensionId:CORVO_COLLECTOR_EXTENSION_ID, prefix:"video1_", jpegQuality:.92, batchText:"", youtubeParallel:false };
const collectorEngines:Record<SourceMode,{label:string;shortLabel:string;description:string;icon:string}> = {
  GOOGLE:{ label:"GOOGLE IMAGENS", shortLabel:"GOOGLE", description:"BUSCA SOMENTE NO GOOGLE IMAGENS", icon:"G" },
  PINTEREST:{ label:"PINTEREST", shortLabel:"PINTEREST", description:"BUSCA SOMENTE NO PINTEREST", icon:"P" },
  MIXED:{ label:"MESCLADO", shortLabel:"MESCLADO", description:"DIVIDE AS CANDIDATAS ENTRE GOOGLE E PINTEREST", icon:"G+P" },
};
const steps = ["IDEIA", "ROTEIRO", "PROMPTS", "IMAGENS", "FORMA"];
const wait = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_PIPELINE_ATTEMPTS = 3;
const ANALYSIS_RETRY_DELAYS = [60_000, 120_000, 300_000, 600_000];

function analysisRetryDelay(retryCount:number) {
  return ANALYSIS_RETRY_DELAYS[Math.min(Math.max(0, retryCount), ANALYSIS_RETRY_DELAYS.length - 1)];
}

function analysisRetryLabel(rawDate?:string) {
  if (!rawDate) return "AGUARDANDO NOVA TENTATIVA";
  const remaining = Math.max(0, new Date(rawDate).getTime() - Date.now());
  if (remaining <= 0) return "NOVA TENTATIVA LIBERADA";
  const seconds = Math.ceil(remaining / 1000);
  if (seconds < 60) return `NOVA TENTATIVA EM ${seconds}S`;
  return `NOVA TENTATIVA EM ${Math.ceil(seconds / 60)} MIN`;
}

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
  const analystCandidatesPerId = Math.max(1, Math.min(30, Math.round(Number(saved.analystCandidatesPerId || defaultSettings.analystCandidatesPerId))));
  const maxCandidates = Math.max(1, Math.min(20, Math.round(Number(saved.maxCandidates || defaultSettings.maxCandidates))));
  return { ...defaultSettings, ...saved, sourceMode, maxCandidates, analystCandidatesPerId };
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

function autoRunChecklist(project:Project, youtubeEnabled:boolean) {
  return [
    { key:"IDEIA", label:"IDEIA", done:Boolean(project.ideaText) },
    { key:"ROTEIRO", label:"ROTEIRO", done:Boolean(project.scriptText) },
    { key:"PROMPTS", label:"PROMPTS", done:Boolean(project.promptText) },
    { key:"COLLECTOR", label:"COLLECTOR", done:Boolean(project.packageCode || project.analysisJobId) },
    { key:"ANALISTA", label:"ANALISTA", done:project.analysisStatus === "CONCLUÍDA" },
    { key:"IMAGENS", label:"IMAGENS", done:project.pipelineStatus === "IMAGENS FINAIS PRONTAS" },
    { key:"THUMB", label:"THUMB", done:Boolean(project.thumbUrl) },
    { key:"METADADOS", label:"METADADOS", done:!youtubeEnabled || Boolean(project.youtubeMetadata) },
    { key:"CONSOLIDANDO", label:"ZIP FINAL", done:project.finalZipStatus === "CONCLUIDO" },
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
  const [, setAnalysisTick] = useState(0);
  const runToken = useRef(0);
  const ideaRunToken = useRef(0);
  const workflowRunToken = useRef(0);
  const thumbRuns = useRef(new Set<string>());
  const generatorQueue = useRef<Promise<void>>(Promise.resolve());
  const packageRetryRef = useRef<RankedGroup[] | null>(null);
  const analysisRetryLocks = useRef(new Set<string>());
  const analysisPreparationLocks = useRef(new Set<string>());
  const autoRunLocks = useRef(new Set<string>());
  const projectsRef = useRef<Project[]>(projects);

  useEffect(() => { projectsRef.current = projects; localStorage.setItem("corvoquiz-projects-v02", JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem("corvo-collector-settings-v02", JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    function onBridgeStatus(event:MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_STATUS") return;
      const payload = event.data?.payload || {};
      const jobId = String(payload.jobId || "");
      if (!jobId) return;
      const project = projectsRef.current.find((item) => item.analysisJobId === jobId);
      if (!project) return;
      const state = String(payload.state || "");
      const message = String(payload.message || "");
      const labels:Record<string,string> = {
        WAITING_COMPOSER:"ANALISTA · ABRINDO EDITOR",
        FILLING_COMPOSER:"ANALISTA · MENSAGEM PREENCHIDA",
        FETCHING_ATTACHMENT:"ANALISTA · BAIXANDO ZIP",
        ATTACHING_FILE:"ANALISTA · ANEXANDO ZIP",
        ATTACHMENT_READY:"ANALISTA · ZIP ANEXADO",
        READY_TO_SEND:"ANALISTA · PRONTO PARA ENVIAR",
        SENDING_MESSAGE:"ANALISTA · ENVIANDO MENSAGEM",
        MESSAGE_CONFIRMED:"ANALISTA · MENSAGEM CONFIRMADA",
        FOCUSED_RETRY:"ANALISTA · RETRY COM ABA ATIVA",
        WAITING_ACTION:"ANALISTA PROCESSANDO",
      };
      const label = labels[state];
      if (!label) return;
      patchProject(project.id, {
        analysisStatus:label,
        pipelineStatus:state === "WAITING_ACTION" || state === "MESSAGE_CONFIRMED" ? "ANALISANDO IMAGENS" : "ENVIANDO AO ANALISTA",
      });
      if (project.autoRunStatus === "RUNNING") updateAutoRun(project.id, "ANALISTA", message || label);
      if (activeId === project.id) {
        setImagePhase("searching");
        setImageProgress(state === "MESSAGE_CONFIRMED" || state === "WAITING_ACTION" ? 92 : 90);
        setImageMessage(message || label);
        setImageStatusLine(label);
      }
    }
    window.addEventListener("message", onBridgeStatus);
    return () => window.removeEventListener("message", onBridgeStatus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  useEffect(() => {
    const interrupted = projectsRef.current.filter((project) => project.autoRunStatus === "RUNNING");
    for (const project of interrupted) {
      if (hasPreparedAnalysis(project)) {
        const retryAt = project.analysisRetryAt || new Date(Date.now() + 45_000).toISOString();
        patchProject(project.id, {
          autoRunStatus:"RUNNING",
          autoRunStep:"ANALISTA",
          autoRunMessage:`Pacote do Analista preservado após recarga. ${analysisRetryLabel(retryAt)}.`,
          autoRunError:undefined,
          analysisRetryAt:retryAt,
          analysisStatus:"PACOTE SALVO · AGUARDANDO ANALISTA",
          pipelineStatus:"AGUARDANDO ANALISTA",
        });
      } else if (hasAnalysisPreparationCheckpoint(project)) {
        const retryAt = project.analysisPreparationRetryAt || new Date(Date.now() + 20_000).toISOString();
        patchProject(project.id, {
          autoRunStatus:"RUNNING",
          autoRunStep:"ANALISTA",
          autoRunMessage:`Preparação do Analista preservada após recarga. ${analysisRetryLabel(retryAt)}.`,
          autoRunError:undefined,
          analysisPreparationRetryAt:retryAt,
          analysisStatus:"CHECKPOINT SALVO · RETOMANDO PREPARAÇÃO",
          pipelineStatus:"CHECKPOINT DO ANALISTA SALVO",
        });
      } else {
        patchProject(project.id, { autoRunStatus:"ERROR", autoRunStep:"ERRO", autoRunMessage:"A página foi recarregada durante o automático.", autoRunError:"A execução automática foi interrompida antes de existir um checkpoint reutilizável. Use RETOMAR dentro deste projeto ou inicie uma nova produção automática pelo botão superior." });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setAnalysisTick((tick:number) => tick + 1);
      const now = Date.now();
      for (const project of projectsRef.current) {
        if (hasPreparedAnalysis(project)) {
          if (analysisRetryLocks.current.has(project.id)) continue;
          const retryAt = project.analysisRetryAt ? new Date(project.analysisRetryAt).getTime() : 0;
          const lastDispatch = project.analysisLastDispatchAt ? new Date(project.analysisLastDispatchAt).getTime() : 0;
          const staleProcessing = !retryAt && lastDispatch > 0 && now - lastDispatch >= 30 * 60_000;
          if ((retryAt > 0 && retryAt <= now) || staleProcessing) void resumePreparedAnalysis(project.id, false);
          continue;
        }
        if (hasAnalysisPreparationCheckpoint(project) && !analysisPreparationLocks.current.has(project.id)) {
          const retryAt = project.analysisPreparationRetryAt ? new Date(project.analysisPreparationRetryAt).getTime() : 0;
          if (!retryAt || retryAt <= now) void resumeAnalysisPreparation(project.id, false);
        }
      }
    }, 12_000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = useMemo(() => projects.find((project) => project.id === activeId) || projects[0], [projects, activeId]);
  const currentGroup = groups[groupIndex];
  const currentRank = currentGroup?.ranked[candidatePos];
  const workflowOutput = active ? (workflowKind === "ROTEIRO" ? active.scriptText : active.promptText) || "" : "";
  const artifactContent = active ? artifactKind === "IDEIA" ? active.ideaText || "" : artifactKind === "ROTEIRO" ? active.scriptText || "" : active.promptText || "" : "";
  const artifactRedoMessage = artifactKind === "IDEIA" ? "REFAZ ROTEIRO, PROMPTS E IMAGENS" : artifactKind === "ROTEIRO" ? "REFAZ PROMPTS E IMAGENS" : "DESCARTA AS IMAGENS ATUAIS";

  function latestProject(projectId:string) {
    return projectsRef.current.find((project) => project.id === projectId);
  }

  function patchProject(projectId:string, patch:Partial<Project>) {
    setProjects((current) => {
      const next = current.map((project) => project.id === projectId ? { ...project, ...patch } : project);
      projectsRef.current = next;
      return next;
    });
  }

  function updateAutoRun(projectId:string, step:AutoRunStep, message:string, patch:Partial<Project> = {}) {
    const current = latestProject(projectId);
    if (current?.autoRunStatus !== "RUNNING" && !patch.autoRunStatus) return;
    patchProject(projectId, { autoRunStep:step, autoRunMessage:message, ...patch });
  }

  function resetCreationFields() {
    setTopic(""); setIdeas([]); setIdeaResultText(""); setSelectedIdea(null); setNotice("");
  }

  function openNewProduction() {
    setIdeaRevisionProjectId(null);
    resetCreationFields();
    setCreateOpen(true);
  }

  function createAutomaticProjectShell() {
    const stamp = Date.now();
    const id = `AUTO_${stamp}`;
    const project:Project = {
      id,
      title:"PRODUÇÃO AUTOMÁTICA",
      topic:"DESCOBERTA AUTOMÁTICA",
      format,
      quantity,
      mode,
      stage:1,
      createdAt:"AGORA",
      autoRunStatus:"RUNNING",
      autoRunStep:"VALIDANDO",
      autoRunMessage:"Preparando uma produção nova do zero...",
      autoRunStartedAt:new Date().toISOString(),
    };
    setProjects((current) => {
      const next = [project, ...current];
      projectsRef.current = next;
      return next;
    });
    setActiveId(id);
    return project;
  }

  function startFullAutomaticProduction() {
    const running = projectsRef.current.find((project) => project.autoRunStatus === "RUNNING");
    if (running) {
      setActiveId(running.id);
      setNotice("JÁ EXISTE UMA PRODUÇÃO AUTOMÁTICA EM ANDAMENTO.");
      setTimeout(() => setNotice(""), 4200);
      return;
    }
    const project = createAutomaticProjectShell();
    void runAutomaticProduction(project.id);
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
        ideaText:project.ideaText, stage:2, scriptText:undefined, promptText:undefined, ...EMPTY_IMAGE_PIPELINE,
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
    if (message.includes("ATTACHMENT_INPUT_NOT_FOUND")) return "O BRIDGE ABRIU O GPT, MAS NÃO ENCONTROU O CONTROLE DE ANEXO DO EDITOR.";
    if (message.includes("ATTACHMENT_NOT_CONFIRMED")) return "O BRIDGE TENTOU ANEXAR O PACOTE, MAS O CHATGPT NÃO CONFIRMOU O ARQUIVO NO EDITOR.";
    if (message.includes("COMPOSER_FILL_FAILED") || message.includes("COMPOSER_LOST_AFTER_ATTACHMENT")) return "O EDITOR DO CHATGPT NÃO MANTEVE A MENSAGEM DO CORVO BRIDGE.";
    if (message.includes("GPT_SEND_NOT_CONFIRMED") || message.includes("GPT_SEND_FAILED")) return "O BRIDGE PREPAROU A SOLICITAÇÃO, MAS A MENSAGEM NÃO APARECEU NA CONVERSA DO GPT.";
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
      ? { ...project, stage:2, scriptText:undefined, promptText:undefined, ...EMPTY_IMAGE_PIPELINE }
      : { ...project, stage:3, promptText:undefined, ...EMPTY_IMAGE_PIPELINE };
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
          entrada:kind === "ROTEIRO" ? workingProject.ideaText : undefined,
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
              ? { ...item, stage:2, scriptText:output, promptText:undefined, ...EMPTY_IMAGE_PIPELINE }
              : { ...item, stage:3, promptText:output, ...EMPTY_IMAGE_PIPELINE }
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

  async function runAutomaticIdeaDiscovery(project:Project) {
    updateAutoRun(project.id, "IDEIA", "O Corvo Scout está descobrindo e escolhendo a melhor ideia para esta produção...");
    const response = await fetch("/api/corvo/job", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({
        specialist:"IDEIAS",
        tema:null,
        format:project.format,
        quantity:project.quantity,
        mode:project.mode,
        automaticTotal:true,
        recentes:projectsRef.current
          .filter((item) => item.id !== project.id && item.ideaText)
          .slice(0, 12)
          .map((item) => ({ titulo:item.title, tema:item.topic })),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.jobId || !result?.prompt) throw new Error(result?.message || "Não foi possível iniciar a descoberta automática de ideias.");
    const scoutJobId = String(result.jobId);
    await dispatchCorvoBridge({
      jobId:scoutJobId,
      prompt:result.prompt,
      specialist:"SCOUT",
      meta:{ projectId:project.id, automaticTotal:true, fromScratch:true },
    });

    while (autoRunLocks.current.has(project.id)) {
      await wait(2200);
      const statusResponse = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(scoutJobId)}`, { cache:"no-store" });
      const status = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(status?.message || "Não foi possível acompanhar o Corvo Scout.");
      if (status.status === "DONE") {
        await completeCorvoBridgeJob(scoutJobId).catch(() => {});
        if (!Array.isArray(status.ideias) || !status.ideias.length) throw new Error("O Corvo Scout concluiu sem devolver uma ideia válida.");
        const chosen = status.ideias[0] as CorvoIdea;
        const rawResult = typeof status.resultado === "string" ? status.resultado : "";
        const updated:Project = {
          ...(latestProject(project.id) || project),
          title:String(chosen.titulo || "QUIZ AUTOMÁTICO").toUpperCase(),
          topic:String(chosen.tema || "QUIZ"),
          ideaText:ideaSection(rawResult, chosen),
          stage:2,
        };
        patchProject(project.id, updated);
        return updated;
      }
      if (status.status === "ERROR") throw new Error(status?.message || "O Corvo Scout não conseguiu concluir a descoberta automática.");
    }
    throw new Error("AUTOMATIC_CANCELLED");
  }

  async function runAutomaticSpecialist(kind:WorkflowKind, project:Project) {
    if (kind === "PROMPTS" && !project.scriptText?.trim()) throw new Error("O roteiro precisa estar pronto antes dos prompts.");
    let jobId = project.autoWorkflowKind === kind ? project.autoWorkflowJobId : undefined;
    if (!jobId) {
      const response = await fetch("/api/corvo/job", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          specialist:kind, projetoId:project.id, titulo:project.title, tema:project.topic,
          format:project.format, quantity:project.quantity, mode:project.mode,
          roteiro:kind === "PROMPTS" ? project.scriptText : undefined,
          entrada:kind === "ROTEIRO" ? project.ideaText : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.jobId || !result?.prompt) throw new Error(result?.message || `Não foi possível criar ${kind}.`);
      await dispatchCorvoBridge({
        jobId:result.jobId, prompt:result.prompt, specialist:kind,
        meta:{ projectId:project.id, automaticTotal:true },
      });
      jobId = result.jobId;
      patchProject(project.id, { autoWorkflowJobId:jobId, autoWorkflowKind:kind });
    }

    if (!jobId) throw new Error(`Não foi possível determinar o JOB_ID de ${kind}.`);
    const activeJobId = jobId;

    while (autoRunLocks.current.has(project.id)) {
      await wait(2200);
      const response = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(activeJobId)}`, { cache:"no-store" });
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(status?.message || `Não foi possível acompanhar ${kind}.`);
      if (status.status === "DONE") {
        await completeCorvoBridgeJob(activeJobId).catch(() => {});
        const output = String(status.resultado || "").trim();
        if (!output) throw new Error(`${kind} concluiu sem devolver conteúdo.`);
        const current = latestProject(project.id) || project;
        const updated:Project = kind === "ROTEIRO"
          ? { ...current, stage:3, scriptText:output, promptText:undefined, ...EMPTY_IMAGE_PIPELINE, autoWorkflowJobId:undefined, autoWorkflowKind:undefined }
          : { ...current, stage:4, promptText:output, ...EMPTY_IMAGE_PIPELINE, autoWorkflowJobId:undefined, autoWorkflowKind:undefined };
        patchProject(project.id, updated);
        return updated;
      }
      if (status.status === "ERROR") throw new Error(status?.error || status?.manifest?.reason || `${kind} informou uma falha.`);
    }
    throw new Error("AUTOMATIC_CANCELLED");
  }

  async function waitForAutomaticParallelAssets(projectId:string) {
    while (autoRunLocks.current.has(projectId)) {
      const project = latestProject(projectId);
      if (!project) throw new Error("Projeto automático não encontrado.");
      if (project.thumbStatus === "FALHOU") throw new Error(project.thumbError || "A thumbnail falhou.");
      if (settings.youtubeParallel && project.youtubeStatus === "FALHOU") throw new Error(project.youtubeError || "Os metadados falharam.");
      const thumbReady = Boolean(project.thumbUrl);
      const youtubeReady = !settings.youtubeParallel || Boolean(project.youtubeMetadata);
      if (thumbReady && youtubeReady) return project;
      const waiting = [!thumbReady ? "THUMB" : "", !youtubeReady ? "METADADOS" : ""].filter(Boolean).join(" + ");
      updateAutoRun(projectId, !thumbReady ? "THUMB" : "METADADOS", `Aguardando ${waiting}...`);
      await wait(2200);
    }
    throw new Error("AUTOMATIC_CANCELLED");
  }

  async function runAutomaticProduction(projectId:string) {
    if (autoRunLocks.current.has(projectId)) return;
    const initial = latestProject(projectId);
    if (!initial) return;
    autoRunLocks.current.add(projectId);
    const startedAt = initial.autoRunStatus === "RUNNING" && initial.autoRunStartedAt ? initial.autoRunStartedAt : new Date().toISOString();
    patchProject(projectId, { autoRunStatus:"RUNNING", autoRunStep:"VALIDANDO", autoRunMessage:"Validando Bridge, Collector e armazenamento...", autoRunError:undefined, autoRunStartedAt:startedAt, autoRunCompletedAt:undefined });
    setNotice("MODO AUTOMÁTICO TOTAL INICIADO.");
    setTimeout(() => setNotice(""), 2400);
    try {
      await ensurePipelineStorageReady();
      const preflightProject = latestProject(projectId) || initial;
      const needsCollectorNow = !(preflightProject.pipelineStatus === "IMAGENS FINAIS PRONTAS" && consolidationState(preflightProject).ready)
        && !hasPreparedAnalysis(preflightProject)
        && !hasAnalysisPreparationCheckpoint(preflightProject);
      if (needsCollectorNow) {
        const ping = await sendCollectorMessage<{ok?:boolean;authorized?:boolean;error?:string}>("PING", undefined, settings.extensionId);
        if (!ping?.ok) throw new Error(ping?.error || "COLLECTOR_CONNECTION_ERROR");
        if (ping.authorized === false) throw new Error("ORIGIN_NOT_AUTHORIZED");
      }

      let project = latestProject(projectId) || initial;
      if (!project.ideaText?.trim()) {
        project = await runAutomaticIdeaDiscovery(project);
      }
      if (!project.scriptText?.trim()) {
        updateAutoRun(projectId, "ROTEIRO", "Criando o roteiro automaticamente...");
        project = await runAutomaticSpecialist("ROTEIRO", project);
      }
      if (!project.promptText?.trim()) {
        updateAutoRun(projectId, "PROMPTS", "Transformando o roteiro em buscas de imagem...");
        project = await runAutomaticSpecialist("PROMPTS", project);
      }

      project = latestProject(projectId) || project;
      updateAutoRun(projectId, "COLLECTOR", "Collector trabalhando. Todas as candidatas seguirão ao Analista...");
      if (!project.thumbUrl) void startThumbBranch(project);
      if (settings.youtubeParallel && !project.youtubeMetadata) void startYoutubeBranch(project);
      const imagesAlreadyReady = project.pipelineStatus === "IMAGENS FINAIS PRONTAS" && consolidationState(project).ready;
      const imageOk = imagesAlreadyReady ? true : await startImageFlow(project, { automaticRun:true, skipParallelBranches:true, selectionMode:"AUTO" });
      if (!imageOk) {
        const waitingProject = latestProject(projectId);
        if (hasPreparedAnalysis(waitingProject) && waitingProject?.analysisRetryAt) throw new Error("ANALYST_RETRY_SCHEDULED");
        if (hasAnalysisPreparationCheckpoint(waitingProject)) throw new Error("ANALYSIS_PREPARATION_RETRY_SCHEDULED");
        throw new Error("O pipeline de imagens não chegou a um resultado final completo.");
      }

      updateAutoRun(projectId, "THUMB", "Imagens finais prontas. Aguardando thumbnail e ramos paralelos...");
      project = await waitForAutomaticParallelAssets(projectId);

      const summary = consolidationState(project);
      if (!summary.ready) throw new Error(summary.missingIds.length ? `Ainda faltam imagens finais nos IDs: ${summary.missingIds.join(", ")}.` : "A consolidação encontrou arquivos ausentes, duplicados ou inválidos.");
      updateAutoRun(projectId, "CONSOLIDANDO", `Consolidando ${summary.items.length} imagens e preparando o ZIP final...`);
      const zipOk = await buildFinalZip(project, { automaticRun:true });
      if (!zipOk) throw new Error(latestProject(projectId)?.finalZipError || "Não foi possível gerar o ZIP final.");

      patchProject(projectId, {
        autoRunStatus:"DONE", autoRunStep:"CONCLUIDO", autoRunMessage:"Produção automática concluída. O ZIP final foi entregue.",
        autoRunError:undefined, autoRunCompletedAt:new Date().toISOString(), stage:5,
      });
      setImageOpen(false);
      setNotice("AUTOMÁTICO CONCLUÍDO · ZIP FINAL ENTREGUE.");
      setTimeout(() => setNotice(""), 5000);
    } catch (error) {
      const rawMessage = String(error instanceof Error ? error.message : error);
      const message = friendlyError(error);
      if (rawMessage.includes("AUTOMATIC_CANCELLED")) {
        patchProject(projectId, { autoRunStatus:"CANCELLED", autoRunStep:"ERRO", autoRunMessage:"Automático interrompido.", autoRunError:undefined });
      } else if (rawMessage.includes("ANALYST_RETRY_SCHEDULED")) {
        const waiting = latestProject(projectId);
        patchProject(projectId, {
          autoRunStatus:"RUNNING",
          autoRunStep:"ANALISTA",
          autoRunMessage:`Pacote preservado. ${analysisRetryLabel(waiting?.analysisRetryAt)}. O automático continuará sozinho.`,
          autoRunError:undefined,
        });
        setNotice("ANALISTA INDISPONÍVEL · PACOTE SALVO · O APP TENTARÁ NOVAMENTE.");
        setTimeout(() => setNotice(""), 5200);
      } else if (rawMessage.includes("ANALYSIS_PREPARATION_RETRY_SCHEDULED")) {
        const waiting = latestProject(projectId);
        patchProject(projectId, {
          autoRunStatus:"RUNNING",
          autoRunStep:"ANALISTA",
          autoRunMessage:`${preparationStageLabel(waiting)}. ${analysisRetryLabel(waiting?.analysisPreparationRetryAt)}. O automático retomará deste checkpoint.`,
          autoRunError:undefined,
        });
        setNotice("PREPARAÇÃO DO ANALISTA PRESERVADA · RETOMADA AUTOMÁTICA PROGRAMADA.");
        setTimeout(() => setNotice(""), 5200);
      } else {
        patchProject(projectId, { autoRunStatus:"ERROR", autoRunStep:"ERRO", autoRunMessage:"O automático parou porque precisa de atenção.", autoRunError:message });
        setNotice(`AUTOMÁTICO PAROU: ${message}`);
        setTimeout(() => setNotice(""), 6500);
      }
    } finally {
      autoRunLocks.current.delete(projectId);
    }
  }

  async function cancelAutomaticProduction(projectId:string) {
    autoRunLocks.current.delete(projectId);
    runToken.current += 1;
    await sendCollectorMessage("CANCEL_JOB", undefined, settings.extensionId).catch(() => {});
    setCollectorRunning(false);
    patchProject(projectId, { autoRunStatus:"CANCELLED", autoRunStep:"ERRO", autoRunMessage:"Automático interrompido pelo usuário.", autoRunError:undefined });
  }

  async function downloadProject(project:Project) {
    const zip = new JSZip();
    const { analysisUploadToken: _privateAnalysisToken, ...safeProject } = project;
    void _privateAnalysisToken;
    zip.file("projeto.json", JSON.stringify(safeProject, null, 2));
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
    if (message.includes("PACKAGE_ALREADY_RUNNING")) return "O Collector já está montando o pacote de outra produção. O pacote da produção atual será retomado automaticamente quando for o mesmo trabalho; se for outro projeto, aguarde a montagem atual terminar.";
    if (message.includes("VERCEL_BLOB_NOT_CONFIGURED") || message.toLowerCase().includes("vercel blob não configurado")) return "O Vercel Blob ainda não está conectado ao projeto. As imagens foram salvas pelo Collector, mas o app não tem onde armazená-las. Conecte um Blob Store ao projeto roteiro na Vercel e tente novamente.";
    if (message.includes("TRATAMENTO_MANUAL_NECESSARIO")) return "Uma ou mais imagens chegaram ao limite de tentativas ou foram marcadas como não recuperáveis. O automático parou para tratamento manual.";
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
    patchProject(projectId, patch);
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
      if (project.thumbJobId && project.thumbStatus !== "FALHOU") {
        updateThumb(project.id, { thumbStatus:"RETOMANDO THUMBNAIL", thumbError:undefined });
        await monitorThumbJob(project, project.thumbJobId);
        return;
      }
      if (project.thumbStatus === "FALHOU") updateThumb(project.id, { thumbJobId:undefined, thumbStatus:"NOVA TENTATIVA", thumbError:undefined });
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
      patchProject(project.id, { youtubeStatus:"PREPARANDO", youtubeError:undefined });
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
      patchProject(project.id, { youtubeJobId:job.jobId, youtubeStatus:"ENVIANDO" });
      await dispatchCorvoBridge({ jobId:job.jobId, prompt:job.prompt, specialist:"YOUTUBE", meta:{ projectId:project.id } });
      patchProject(project.id, { youtubeStatus:"PROCESSANDO" });
      const status = await pollPipelineJob(job.jobId, project.id);
      patchProject(project.id, { youtubeStatus:"CONCLUÍDO", youtubeMetadata:String(status.resultado || ""), youtubeError:undefined });
    } catch (error) {
      patchProject(project.id, { youtubeStatus:"FALHOU", youtubeError:bridgeErrorMessage(error) });
    }
  }

  async function startImageFlow(projectArg?:Project, options:{automaticRun?:boolean;skipParallelBranches?:boolean;selectionMode?:SelectionMode} = {}) {
    const project = projectArg || active;
    if (!project) return false;
    if (hasPreparedAnalysis(project) && project.pipelineStatus !== "IMAGENS FINAIS PRONTAS") {
      return await resumePreparedAnalysis(project.id, !options.automaticRun);
    }
    if (hasAnalysisPreparationCheckpoint(project) && project.pipelineStatus !== "IMAGENS FINAIS PRONTAS") {
      return await resumeAnalysisPreparation(project.id, !options.automaticRun);
    }
    const token = ++runToken.current;
    const selectionMode = options.selectionMode || settings.selectionMode;
    setImageOpen(true); setImagePhase("connecting"); setImageProgress(4); setImageMessage("Conectando ao coletor..."); setImageStatusLine(""); setGroups([]); setPackageCode("");
    try {
      const ping = await sendCollectorMessage<{ok?:boolean;authorized?:boolean;error?:string}>("PING", undefined, settings.extensionId);
      if (!ping?.ok) throw new Error(ping?.error || "COLLECTOR_CONNECTION_ERROR");
      if (ping.authorized === false) throw new Error("ORIGIN_NOT_AUTHORIZED");
      await ensurePipelineStorageReady();
      if (token !== runToken.current) return false;
      if (!options.skipParallelBranches) { void startThumbBranch(project); void startYoutubeBranch(project); }
      const items = settings.batchText.trim()
        ? parseGuideText(settings.batchText)
        : project.promptText?.trim() ? parseGuideText(project.promptText) : defaultQueries(project);
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
          items, productionId:project.id, maxCandidates:settings.maxCandidates, scrollSteps:settings.scrollSteps, sourceMode:settings.sourceMode,
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
      if (token !== runToken.current) return false;
      if (!finalJob?.results) throw new Error("Não foi possível recuperar o resultado da busca.");
      setCollectorRunning(false);
      const ranked = rankGroups(finalJob.results);
      if (!ranked.length || ranked.some((group) => !group.ranked.length)) throw new Error("Uma ou mais cenas não retornaram imagens utilizáveis.");
      setGroups(ranked); setGroupIndex(0); setCandidatePos(0);
      if (selectionMode === "MANUAL" && !options.automaticRun) { setImagePhase("review"); setImageProgress(84); setImageMessage("Escolha rapidamente uma imagem por cena."); setImageStatusLine(""); return true; }
      const packaged = await buildPackage(ranked, token, project, selectionMode, options.automaticRun === true);
      return packaged !== false;
    } catch (error) {
      if (token !== runToken.current) return false;
      setCollectorRunning(false);
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
      if (options.automaticRun) throw error;
      return false;
    }
  }

  function updatePipelineItem(projectId:string, itemId:string, patch:Partial<PipelineItem>) {
    setProjects((current) => {
      const next = current.map((project) => project.id === projectId
        ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => item.id === itemId ? { ...item, ...patch } : item) }
        : project);
      projectsRef.current = next;
      return next;
    });
  }

  function appendPipelineHistory(projectId:string, itemId:string, event:PipelineHistoryEvent) {
    setProjects((current) => {
      const next = current.map((project) => project.id === projectId
        ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => item.id === itemId ? { ...item, history:[...(item.history || []), event] } : item) }
        : project);
      projectsRef.current = next;
      return next;
    });
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
    const finalItems = new Map<string,PipelineItem>(items.map((item) => [String(item.id), item]));
    let completed = 0;
    const total = items.length;
    const setProgress = (label:string) => {
      setImagePhase("searching");
      setImageProgress(Math.max(90, Math.min(99, 90 + (completed / Math.max(1,total)) * 9)));
      setImageMessage(label);
      setImageStatusLine(`${completed}/${total} IMAGENS FINAIS · FALLBACK AUTOMÁTICO · GERADOR 1 POR VEZ`);
      updateAutoRun(project.id, "IMAGENS", `${label} · ${completed}/${total}`);
    };
    patchProject(project.id, { pipelineStatus:"ROTEANDO IMAGENS", pipelineItems:items });
    setProgress("O Analista terminou. Distribuindo imagens entre Refinador e Gerador...");

    let refinerIndex = 0;
    const refinerWorker = async () => {
      while (refinerIndex < refiners.length) {
        const item = refiners[refinerIndex++];
        const result = await runRoutedWithFallback(project, item);
        finalItems.set(String(item.id), result.item);
        if (!result.ok) failures.push({ id:item.id, error:result.error });
        completed += 1;
        setProgress(`Refinando e recuperando imagens... ${completed}/${total}`);
      }
    };
    const refinerWorkers = Array.from({ length:Math.min(3, Math.max(1, refiners.length)) }, () => refinerWorker());

    const generatorWorker = (async () => {
      for (const item of generators) {
        const result = await runRoutedWithFallback(project, item);
        finalItems.set(String(item.id), result.item);
        if (!result.ok) failures.push({ id:item.id, error:result.error });
        completed += 1;
        setProgress(`Gerador/Fallback trabalhando em fila única... ${completed}/${total}`);
      }
    })();

    await Promise.all([...refinerWorkers, generatorWorker]);
    await wait(50);
    const liveItems = latestProject(project.id)?.pipelineItems || [];
    const liveById = new Map<string,PipelineItem>(liveItems.map((item) => [String(item.id), item]));
    const consolidatedItems = items.map((original) => ({ ...original, ...(finalItems.get(String(original.id)) || {}), ...(liveById.get(String(original.id)) || {}) }));
    if (failures.length) {
      patchProject(project.id, { pipelineStatus:"TRATAMENTO MANUAL NECESSÁRIO", pipelineItems:consolidatedItems });
      setImagePhase("error");
      setImageProgress(100);
      setImageMessage(`${failures.length} imagem(ns) chegaram ao limite ou foram marcadas como não recuperáveis.`);
      setImageStatusLine(`${total-failures.length}/${total} FINAIS · ${failures.length} MANUAIS`);
      return false;
    }
    patchProject(project.id, { pipelineStatus:"IMAGENS FINAIS PRONTAS", imageCount:items.length, pipelineItems:consolidatedItems });
    setImagePhase("done");
    setImageProgress(100);
    setImageMessage("Refinador, Gerador e Fallback concluíram todas as imagens finais. A Consolidação já pode gerar o ZIP final.");
    setImageStatusLine(`${items.length}/${items.length} IMAGENS FINAIS`);
    return true;
  }

  function hasPreparedAnalysis(project:Project | undefined | null) {
    return Boolean(
      project?.analysisJobId
      && project?.analysisZipUrl
      && project?.analysisZipName
      && project?.analysisPrompt
      && project?.analysisUploadToken
      && project?.analysisExpectedIds?.length
      && project.analysisStatus !== "CONCLUÍDA"
    );
  }

  function hasAnalysisPreparationCheckpoint(project:Project | undefined | null) {
    return Boolean(
      project?.analysisJobId
      && project?.analysisPrompt
      && project?.analysisUploadToken
      && project?.analysisExpectedIds?.length
      && ["CANDIDATES_STORED", "ZIP_BUILDING", "ZIP_SAVED"].includes(String(project.analysisPreparationStage || ""))
      && project.analysisStatus !== "CONCLUÍDA"
    );
  }

  function preparationStageLabel(project:Project | undefined | null) {
    const stage = project?.analysisPreparationStage;
    if (stage === "CANDIDATES_STORED") return "CANDIDATAS PREPARADAS · CHECKPOINT SALVO";
    if (stage === "ZIP_BUILDING") return "LOTES SALVOS · MONTANDO ZIP DO ANALISTA";
    if (stage === "ZIP_SAVED") return "ZIP DO ANALISTA SALVO";
    if (stage === "CANDIDATES_PREPARING") return "PREPARANDO CANDIDATAS";
    if (stage === "JOB_CREATED") return "JOB DO ANALISTA CRIADO";
    return "PREPARAÇÃO DO ANALISTA";
  }

  async function writeAnalysisCheckpoint(
    project:Project,
    stage:NonNullable<Project["analysisPreparationStage"]>,
    patch:Record<string,unknown> = {},
  ) {
    if (!project.analysisJobId || !project.analysisUploadToken) return null;
    const response = await fetch("/api/corvo/checkpoint", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-corvo-upload-token":String(project.analysisUploadToken) },
      body:JSON.stringify({ jobId:project.analysisJobId, stage, ...patch }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) throw new Error(result?.message || "Não foi possível salvar o checkpoint da preparação do Analista.");
    return result;
  }

  async function readAnalysisCheckpoint(project:Project) {
    if (!project.analysisJobId || !project.analysisUploadToken) throw new Error("CHECKPOINT_SEM_JOB_ANALISTA");
    const response = await fetch(`/api/corvo/checkpoint?jobId=${encodeURIComponent(project.analysisJobId)}`, {
      cache:"no-store",
      headers:{ "x-corvo-upload-token":String(project.analysisUploadToken) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) throw new Error(result?.message || "Não foi possível recuperar o checkpoint do Analista.");
    return result;
  }

  function scheduleAnalysisPreparationRetry(projectId:string, error:unknown) {
    const current = latestProject(projectId);
    if (!current || !hasAnalysisPreparationCheckpoint(current)) return;
    const count = (current.analysisPreparationRetryCount || 0) + 1;
    const nextAt = new Date(Date.now() + analysisRetryDelay(count - 1)).toISOString();
    const message = bridgeErrorMessage(error);
    patchProject(projectId, {
      analysisStatus:"CHECKPOINT SALVO · AGUARDANDO RETOMADA",
      analysisPreparationRetryCount:count,
      analysisPreparationRetryAt:nextAt,
      analysisPreparationError:message,
      pipelineStatus:"CHECKPOINT DO ANALISTA SALVO",
      autoRunStatus:current.autoRunStatus === "RUNNING" ? "RUNNING" : current.autoRunStatus,
      autoRunStep:current.autoRunStatus === "RUNNING" ? "ANALISTA" : current.autoRunStep,
      autoRunMessage:current.autoRunStatus === "RUNNING" ? `${preparationStageLabel(current)}. ${analysisRetryLabel(nextAt)}.` : current.autoRunMessage,
      autoRunError:current.autoRunStatus === "RUNNING" ? undefined : current.autoRunError,
    });
    setImagePhase("packaging");
    setImageProgress(89);
    setImageMessage("A preparação já está salva. O app retomará do checkpoint sem refazer o Collector.");
    setImageStatusLine(`${preparationStageLabel(current)} · ${analysisRetryLabel(nextAt)} · RETOMADA ${count + 1}`);
  }

  async function materializeAnalysisZipFromCheckpoint(project:Project) {
    const analysisJob = {
      jobId:String(project.analysisJobId || ""),
      prompt:String(project.analysisPrompt || ""),
      uploadToken:String(project.analysisUploadToken || ""),
    };
    const expectedIds = [...(project.analysisExpectedIds || [])];
    if (!analysisJob.jobId || !analysisJob.uploadToken || !expectedIds.length) throw new Error("CHECKPOINT_INCOMPLETO");
    const fileName = project.analysisPackageFileName || `${project.id}_ANALISE_CANDIDATAS.zip`;
    patchProject(project.id, {
      analysisPreparationStage:"ZIP_BUILDING",
      analysisStatus:"CHECKPOINT SALVO · MONTANDO ZIP",
      pipelineStatus:"MONTANDO ZIP DO ANALISTA",
      analysisPreparationError:undefined,
    });
    await writeAnalysisCheckpoint({ ...project, analysisJobId:analysisJob.jobId, analysisUploadToken:analysisJob.uploadToken }, "ZIP_BUILDING", {
      packageFileName:fileName,
      selectionMode:project.analysisSelectionMode || "AUTO",
      storedCandidates:project.analysisStoredCandidates || 0,
      storedIds:project.analysisStoredIds || expectedIds.length,
      expectedIds:expectedIds.length,
    });
    setImagePhase("packaging"); setImageProgress(89);
    setImageMessage("Checkpoint recuperado. Montando somente o ZIP do Analista a partir dos lotes já salvos...");
    setImageStatusLine("LOTES PRESERVADOS · SEM REPROCESSAR IMAGENS");
    const packageResponse = await fetch("/api/corvo/pacote", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-corvo-upload-token":analysisJob.uploadToken },
      body:JSON.stringify({ jobId:analysisJob.jobId, fileName, selectionMode:(project.analysisSelectionMode || "AUTO") }),
    });
    const packageResult = await packageResponse.json().catch(() => ({}));
    if (!packageResponse.ok || !packageResult?.file?.url) throw new Error(packageResult?.message || "Não foi possível montar o ZIP do Analista a partir do checkpoint.");
    patchProject(project.id, {
      analysisPreparationStage:"ZIP_SAVED",
      analysisStatus:"PACOTE DO ANALISTA SALVO",
      analysisZipUrl:String(packageResult.file.url),
      analysisZipName:String(packageResult.file.name || fileName),
      analysisPreparedAt:new Date().toISOString(),
      analysisPreparationRetryAt:undefined,
      analysisPreparationRetryCount:0,
      analysisPreparationError:undefined,
      pipelineStatus:"PACOTE DO ANALISTA SALVO",
    });
    return packageResult.file;
  }

  async function resumeAnalysisPreparation(projectId:string, manual = false) {
    if (analysisPreparationLocks.current.has(projectId)) return false;
    const project = latestProject(projectId);
    if (!project || !hasAnalysisPreparationCheckpoint(project)) return false;
    analysisPreparationLocks.current.add(projectId);
    if (manual) setImageOpen(true);
    try {
      setImagePhase("packaging"); setImageProgress(88);
      setImageMessage("Recuperando o checkpoint da preparação do Analista...");
      setImageStatusLine(preparationStageLabel(project));
      const checkpoint = await readAnalysisCheckpoint(project);
      const expectedIds = [...(project.analysisExpectedIds || [])];
      const serverPreparation = checkpoint?.preparation || {};
      const checkpointPatch:Partial<Project> = {
        analysisStoredCandidates:Number(checkpoint?.storedCandidates || serverPreparation?.storedCandidates || project.analysisStoredCandidates || 0),
        analysisStoredIds:Number(checkpoint?.storedIds || serverPreparation?.storedIds || project.analysisStoredIds || 0),
      };
      if (serverPreparation?.stage) checkpointPatch.analysisPreparationStage = String(serverPreparation.stage) as Project["analysisPreparationStage"];
      patchProject(projectId, checkpointPatch);

      let zipFile = checkpoint?.zipFile || null;
      if (!zipFile) {
        if (!checkpoint?.readyForZip) {
          const missing = Array.isArray(checkpoint?.missingIds) ? checkpoint.missingIds.join(", ") : "";
          throw new Error(`CHECKPOINT_AINDA_INCOMPLETO${missing ? ` · IDs: ${missing}` : ""}`);
        }
        const liveForZip = latestProject(projectId) || { ...project, ...checkpointPatch };
        patchProject(projectId, { analysisPreparationStage:"CANDIDATES_STORED", analysisStatus:"CANDIDATAS PREPARADAS · CHECKPOINT SALVO" });
        zipFile = await materializeAnalysisZipFromCheckpoint({ ...liveForZip, analysisPreparationStage:"CANDIDATES_STORED" });
      } else {
        patchProject(projectId, {
          analysisPreparationStage:"ZIP_SAVED",
          analysisStatus:"PACOTE DO ANALISTA SALVO",
          analysisZipUrl:String(zipFile.url),
          analysisZipName:String(zipFile.name || project.analysisPackageFileName || `${project.id}_ANALISE_CANDIDATAS.zip`),
          analysisPreparedAt:project.analysisPreparedAt || new Date().toISOString(),
          analysisPreparationRetryAt:undefined,
          analysisPreparationRetryCount:0,
          analysisPreparationError:undefined,
          pipelineStatus:"PACOTE DO ANALISTA SALVO",
        });
      }

      const live = latestProject(projectId) || project;
      const analysisJob = { jobId:String(live.analysisJobId), prompt:String(live.analysisPrompt), uploadToken:String(live.analysisUploadToken) };
      try {
        const routed = await dispatchAnalysis(live, analysisJob, zipFile, expectedIds);
        if (routed && latestProject(projectId)?.autoRunStatus === "RUNNING") setTimeout(() => void runAutomaticProduction(projectId), 100);
        return routed;
      } catch (analysisError) {
        scheduleAnalysisRetry(projectId, analysisError);
        return false;
      }
    } catch (error) {
      scheduleAnalysisPreparationRetry(projectId, error);
      return false;
    } finally {
      analysisPreparationLocks.current.delete(projectId);
    }
  }

  function scheduleAnalysisRetry(projectId:string, error:unknown) {
    const current = latestProject(projectId);
    if (!current || !hasPreparedAnalysis(current)) return;
    const count = (current.analysisRetryCount || 0) + 1;
    const nextAt = new Date(Date.now() + analysisRetryDelay(count - 1)).toISOString();
    const message = bridgeErrorMessage(error);
    patchProject(projectId, {
      analysisStatus:"PACOTE SALVO · AGUARDANDO ANALISTA",
      analysisRetryCount:count,
      analysisRetryAt:nextAt,
      analysisLastError:message,
      pipelineStatus:"AGUARDANDO ANALISTA",
      autoRunStatus:current.autoRunStatus === "RUNNING" ? "RUNNING" : current.autoRunStatus,
      autoRunStep:current.autoRunStatus === "RUNNING" ? "ANALISTA" : current.autoRunStep,
      autoRunMessage:current.autoRunStatus === "RUNNING" ? `Pacote do Analista preservado. ${analysisRetryLabel(nextAt)}.` : current.autoRunMessage,
      autoRunError:current.autoRunStatus === "RUNNING" ? undefined : current.autoRunError,
    });
    setImagePhase("searching");
    setImageProgress(90);
    setImageMessage("O pacote já está salvo. O Analista será chamado novamente sem repetir o Collector.");
    setImageStatusLine(`PACOTE PRESERVADO · ${analysisRetryLabel(nextAt)} · TENTATIVA ${count + 1}`);
  }

  async function resetAnalysisJob(jobId:string, uploadToken:string) {
    const response = await fetch("/api/corvo/retry", {
      method:"POST",
      headers:{ "content-type":"application/json", "x-corvo-upload-token":uploadToken },
      body:JSON.stringify({ jobId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) throw new Error(result?.message || "Não foi possível preparar o job do Analista para nova tentativa.");
  }

  async function finishAnalysisFromStatus(project:Project, analysisJob:{jobId:string;prompt:string;uploadToken:string}, expectedIds:string[], status:any) {
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
    patchProject(project.id, {
      analysisStatus:"CONCLUÍDA",
      analysisManifest:String(status.resultado || ""),
      analysisRetryAt:undefined,
      analysisRetryCount:0,
      analysisLastError:undefined,
      pipelineItems,
    });
    return await runRoutedPipeline(project, pipelineItems);
  }

  async function dispatchAnalysis(project:Project, analysisJob:{jobId:string;prompt:string;uploadToken:string}, zipFile:any, expectedIds:string[]) {
    patchProject(project.id, {
      analysisJobId:analysisJob.jobId,
      analysisStatus:"ENVIANDO AO ANALISTA",
      analysisZipUrl:zipFile.url,
      analysisZipName:zipFile.name,
      analysisExpectedIds:expectedIds,
      analysisPrompt:analysisJob.prompt,
      analysisUploadToken:analysisJob.uploadToken,
      analysisLastDispatchAt:new Date().toISOString(),
      analysisRetryAt:undefined,
      pipelineStatus:"ANALISANDO IMAGENS",
    });
    updateAutoRun(project.id, "ANALISTA", `Corvo Analista comparando a shortlist de candidatas de ${expectedIds.length} IDs...`);
    setImagePhase("searching"); setImageProgress(90); setImageMessage("Enviando o pacote persistente ao Corvo Analista..."); setImageStatusLine("ZIP SALVO NO BLOB · ANALISTA ESCOLHENDO POR ID");
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
    patchProject(project.id, { analysisStatus:"ANALISTA PROCESSANDO", analysisLastDispatchAt:new Date().toISOString() });
    const status = await pollPipelineJob(analysisJob.jobId, project.id);
    return await finishAnalysisFromStatus(project, analysisJob, expectedIds, status);
  }

  async function resumePreparedAnalysis(projectId:string, manual = false) {
    if (analysisRetryLocks.current.has(projectId)) return false;
    const project = latestProject(projectId);
    if (!project || !hasPreparedAnalysis(project)) return false;
    analysisRetryLocks.current.add(projectId);
    const token = ++runToken.current;
    if (manual) setImageOpen(true);
    setImagePhase("searching"); setImageProgress(90);
    setImageMessage("Pacote do Analista recuperado. Tentando continuar sem refazer o Collector...");
    setImageStatusLine("PACOTE PERSISTENTE · RETOMANDO ANALISTA");
    try {
      const analysisJob = {
        jobId:String(project.analysisJobId),
        prompt:String(project.analysisPrompt),
        uploadToken:String(project.analysisUploadToken),
      };
      const expectedIds = [...(project.analysisExpectedIds || [])];
      const zipFile = { url:String(project.analysisZipUrl), name:String(project.analysisZipName || `${project.id}_ANALISE_CANDIDATAS.zip`) };

      const currentResponse = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(analysisJob.jobId)}`, { cache:"no-store" });
      const currentStatus = await currentResponse.json().catch(() => ({}));
      if (currentResponse.ok && currentStatus?.status === "DONE") {
        try {
          const routed = await finishAnalysisFromStatus(project, analysisJob, expectedIds, currentStatus);
          if (routed && latestProject(projectId)?.autoRunStatus === "RUNNING") setTimeout(() => void runAutomaticProduction(projectId), 100);
          return routed;
        } catch {
          await resetAnalysisJob(analysisJob.jobId, analysisJob.uploadToken);
        }
      } else {
        await resetAnalysisJob(analysisJob.jobId, analysisJob.uploadToken);
      }

      const routed = await dispatchAnalysis(project, analysisJob, zipFile, expectedIds);
      if (routed && latestProject(projectId)?.autoRunStatus === "RUNNING") setTimeout(() => void runAutomaticProduction(projectId), 100);
      return routed;
    } catch (error) {
      if (token !== runToken.current) return false;
      scheduleAnalysisRetry(projectId, error);
      return false;
    } finally {
      analysisRetryLocks.current.delete(projectId);
    }
  }

  async function buildPackage(selectedGroups:RankedGroup[], token = runToken.current, projectArg?:Project, selectionModeOverride?:SelectionMode, throwOnError = false) {
    const project = projectArg || active;
    if (!project) return false;
    packageRetryRef.current = selectedGroups;
    const automatic = (selectionModeOverride || settings.selectionMode) === "AUTO";
    setImagePhase("packaging"); setImageProgress(84);
    setImageMessage(automatic ? `Preparando até ${settings.analystCandidatesPerId} candidatas por ID para o Analista...` : "Preparando as imagens escolhidas e a entrada do Analista...");
    try {
      await ensurePipelineStorageReady();
      const expectedIds = selectedGroups.map((group) => String(group.id));
      const selections = automatic ? buildAnalystRawSelections(selectedGroups, settings.prefix, settings.analystCandidatesPerId) : buildFormaSelections(selectedGroups, settings.prefix);
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
            ? `O app NÃO escolheu a imagem vencedora. Para desempenho, o Collector criou uma shortlist técnica de ATÉ ${settings.analystCandidatesPerId} candidatas por ID; compare visualmente TODAS as candidatas presentes no ZIP e escolha a melhor.`
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
      const analysisPackageFileName = `${project.id}_ANALISE_CANDIDATAS.zip`;
      patchProject(project.id, {
        analysisJobId:analysisJob.jobId,
        analysisStatus:automatic?"RECEBENDO CANDIDATAS":"RECEBENDO IMAGENS",
        analysisExpectedIds:expectedIds,
        analysisPrompt:analysisJob.prompt,
        analysisUploadToken:analysisJob.uploadToken,
        analysisPreparationStage:"JOB_CREATED",
        analysisExpectedCandidates:selections.length,
        analysisStoredCandidates:0,
        analysisStoredIds:0,
        analysisBatchTotal:Math.ceil(selections.length / 36),
        analysisBatchesUploaded:0,
        analysisPackageFileName,
        analysisSelectionMode:automatic?"AUTO":"MANUAL",
        analysisPreparationRetryAt:undefined,
        analysisPreparationRetryCount:0,
        analysisPreparationError:undefined,
        pipelineStatus:"PREPARANDO ANÁLISE",
      });
      await writeAnalysisCheckpoint({
        ...project,
        analysisJobId:analysisJob.jobId,
        analysisUploadToken:analysisJob.uploadToken,
      }, "JOB_CREATED", {
        expectedCandidates:selections.length,
        expectedIds:expectedIds.length,
        batchTotal:Math.ceil(selections.length / 36),
        packageFileName:analysisPackageFileName,
        selectionMode:automatic?"AUTO":"MANUAL",
      });
      const expectedPackageFile = automatic ? `${project.id}_CANDIDATAS_BRUTAS.zip` : `${project.id}_COLLECTOR.zip`;
      let response = await sendCollectorMessage<any>("BUILD_FORMA_PACKAGE", {
        selections, productionId:project.id, prefix:settings.prefix, jpegQuality:settings.jpegQuality,
        fileName:expectedPackageFile,
        includeManifest:true, autoDownload:false, pipelineOnly:automatic, packageMode:automatic?"ANALYST_RAW":"FORMA",
        pipelineUpload:{ jobId:analysisJob.jobId, uploadToken:analysisJob.uploadToken, appOrigin:window.location.origin },
      }, settings.extensionId);
      if (!response?.ok && response?.error === "PACKAGE_ALREADY_RUNNING") {
        const running = response?.package;
        const samePackage = String(running?.fileName || "") === expectedPackageFile
          && Number(running?.total || 0) === selections.length;
        if (samePackage) {
          response = {
            ok:true,
            resumed:true,
            packageId:running?.id,
            packageCode:running?.packageCode,
            fileName:running?.fileName,
            total:running?.total,
          };
          setImageMessage("O pacote desta produção já estava sendo montado. Retomando o acompanhamento...");
        }
      }
      if (!response?.ok) throw new Error(response?.error || "Falha ao montar o pacote.");
      patchProject(project.id, {
        analysisPreparationStage:"CANDIDATES_PREPARING",
        analysisCollectorPackageId:String(response.packageId || ""),
        analysisCollectorPackageCode:String(response.packageCode || ""),
        analysisStatus:"PREPARANDO CANDIDATAS · CHECKPOINT ATIVO",
      });
      await writeAnalysisCheckpoint({ ...project, analysisJobId:analysisJob.jobId, analysisUploadToken:analysisJob.uploadToken }, "CANDIDATES_PREPARING", {
        expectedCandidates:selections.length, expectedIds:expectedIds.length, batchTotal:Math.ceil(selections.length / 36),
        collectorPackageId:String(response.packageId || ""), collectorPackageCode:String(response.packageCode || ""),
        packageFileName:analysisPackageFileName, selectionMode:automatic?"AUTO":"MANUAL",
      });
      const code = response.packageCode || "";
      while (token === runToken.current) {
        await wait(700);
        let status:any;
        try { status = (await sendCollectorMessage<any>("GET_PACKAGE_STATUS", undefined, settings.extensionId))?.package; }
        catch { setImageMessage("O pacote continua sendo preparado. Reconectando..."); await wait(1800); continue; }
        const total = Number(status?.total || selections.length); const current = Number(status?.current || 0);
        setImageProgress(Math.max(84, Math.min(89, 84 + (current / Math.max(1, total)) * 5)));
        setImageMessage(status?.currentName
          ? automatic ? `Preparando candidata ${current}/${total}: ${status.currentName}` : `Salvando ${status.currentName} no app...`
          : automatic ? "Finalizando envio das candidatas brutas..." : "Finalizando o pacote do Collector...");
        const batches = Number(status?.batchTotal || 0);
        const batchProgress = batches ? ` · ${Number(status?.batchesUploaded || 0)}/${batches} LOTES` : "";
        setImageStatusLine(`${Number(status?.pipelineUploaded || 0)}/${total} CANDIDATAS NO APP · ${expectedIds.length} IDS${batchProgress}`);
        patchProject(project.id, {
          analysisPreparationStage:"CANDIDATES_PREPARING",
          analysisStoredCandidates:Number(status?.pipelineUploaded || 0),
          analysisBatchTotal:batches || Math.ceil(selections.length / 36),
          analysisBatchesUploaded:Number(status?.batchesUploaded || 0),
          analysisStatus:`PREPARANDO CANDIDATAS · ${Number(status?.batchesUploaded || 0)}/${batches || Math.ceil(selections.length / 36)} LOTES`,
        });
        if (status?.status === "DONE") {
          if (Number(status.pipelineUploadFailed || 0) > 0) {
            const detail = Array.isArray(status.pipelineErrors) && status.pipelineErrors.length ? ` Motivo: ${status.pipelineErrors[0]}` : "";
            throw new Error(`Falhou o envio de ${Number(status.pipelineUploadFailed || 0)} candidata(s) em lote.${detail}`);
          }
          if (Number(status.pipelineUploaded || 0) < expectedIds.length) {
            throw new Error(`O app recebeu apenas ${Number(status.pipelineUploaded || 0)} candidatas para ${expectedIds.length} IDs.`);
          }
          const finalCode = status.packageCode || code;
          setPackageCode(finalCode);
          const checkpointState = await readAnalysisCheckpoint({
            ...(latestProject(project.id) || project),
            analysisJobId:analysisJob.jobId, analysisUploadToken:analysisJob.uploadToken,
          });
          if (!checkpointState?.readyForZip) {
            const missing = Array.isArray(checkpointState?.missingIds) ? checkpointState.missingIds.join(", ") : "";
            throw new Error(`A preparação terminou sem candidatas para todos os IDs${missing ? `: ${missing}` : "."}`);
          }
          const storedCandidates = Number(checkpointState?.storedCandidates || status.pipelineUploaded || selections.length);
          const storedIds = Number(checkpointState?.storedIds || expectedIds.length);
          patchProject(project.id, {
            packageCode:finalCode, imageCount:expectedIds.length,
            analysisPreparationStage:"CANDIDATES_STORED",
            analysisStoredCandidates:storedCandidates, analysisStoredIds:storedIds,
            analysisBatchTotal:Number(status?.batchTotal || Math.ceil(selections.length / 36)),
            analysisBatchesUploaded:Number(status?.batchesUploaded || 0),
            analysisStatus:"CANDIDATAS PREPARADAS · CHECKPOINT SALVO",
            pipelineStatus:"CHECKPOINT DO ANALISTA SALVO",
          });
          await writeAnalysisCheckpoint({ ...project, analysisJobId:analysisJob.jobId, analysisUploadToken:analysisJob.uploadToken }, "CANDIDATES_STORED", {
            expectedCandidates:selections.length, storedCandidates, storedIds, expectedIds:expectedIds.length,
            batchesUploaded:Number(status?.batchesUploaded || 0), batchTotal:Number(status?.batchTotal || Math.ceil(selections.length / 36)),
            collectorPackageId:String(response.packageId || ""), collectorPackageCode:finalCode,
            packageFileName:analysisPackageFileName, selectionMode:automatic?"AUTO":"MANUAL",
          });
          setImageProgress(89); setImageMessage(`Checkpoint salvo. Consolidando ${storedCandidates} candidatas no ZIP do Analista sem reprocessar imagens...`);
          const checkpointProject:Project = {
            ...(latestProject(project.id) || project),
            analysisJobId:analysisJob.jobId, analysisPrompt:analysisJob.prompt, analysisUploadToken:analysisJob.uploadToken,
            analysisExpectedIds:expectedIds, analysisPreparationStage:"CANDIDATES_STORED", analysisStoredCandidates:storedCandidates, analysisStoredIds:storedIds,
            analysisPackageFileName, analysisSelectionMode:automatic?"AUTO":"MANUAL",
          };
          const analysisZipFile = await materializeAnalysisZipFromCheckpoint(checkpointProject);
          try {
            const routedOk = await dispatchAnalysis(latestProject(project.id) || checkpointProject, analysisJob, analysisZipFile, expectedIds);
            if (!routedOk) throw new Error("TRATAMENTO_MANUAL_NECESSARIO");
            packageRetryRef.current = null;
            return true;
          } catch (analysisError) {
            scheduleAnalysisRetry(project.id, analysisError);
            packageRetryRef.current = null;
            if (throwOnError) throw new Error("ANALYST_RETRY_SCHEDULED");
            return false;
          }
        }
        if (status?.status === "ERROR") throw new Error(status.error || "Falha no pacote.");
      }
      return false;
    } catch (error) {
      if (token !== runToken.current) return false;
      if (String(error instanceof Error ? error.message : error) === "ANALYST_RETRY_SCHEDULED") {
        const live = latestProject(project.id);
        setImagePhase("searching"); setImageProgress(90);
        setImageMessage("O pacote do Analista está preservado. O app tentará novamente sem refazer o Collector.");
        setImageStatusLine(`PACOTE SALVO · ${analysisRetryLabel(live?.analysisRetryAt)}`);
        if (throwOnError) throw error;
        return false;
      }
      const checkpointProject = latestProject(project.id);
      if (hasAnalysisPreparationCheckpoint(checkpointProject)) {
        scheduleAnalysisPreparationRetry(project.id, error);
        if (throwOnError) throw new Error("ANALYSIS_PREPARATION_RETRY_SCHEDULED");
        return false;
      }
      setImagePhase("error"); setImageMessage(friendlyError(error)); setImageProgress(0);
      patchProject(project.id, { pipelineStatus:"ERRO NO PIPELINE", analysisStatus:latestProject(project.id)?.analysisStatus || "FALHOU" });
      if (throwOnError) throw error;
      return false;
    }
  }

  async function retryImageFlow() {
    const currentProject = latestProject(active?.id || "");
    if (hasPreparedAnalysis(currentProject)) {
      await resumePreparedAnalysis(String(currentProject?.id), true);
      return;
    }
    if (hasAnalysisPreparationCheckpoint(currentProject)) {
      await resumeAnalysisPreparation(String(currentProject?.id), true);
      return;
    }
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

  async function buildFinalZip(project:Project, options:{automaticRun?:boolean} = {}) {
    const liveProject = latestProject(project.id) || project;
    const summary = consolidationState(liveProject);
    if (!summary.ready || consolidationBusy) {
      setConsolidationMessage(summary.missingIds.length ? `Ainda faltam os IDs: ${summary.missingIds.join(", ")}.` : "A consolidação ainda possui pendências de IDs ou nomes.");
      return false;
    }
    setConsolidationBusy(true);
    setConsolidationMessage("Baixando as imagens finais e validando o pacote...");
    patchProject(project.id, { finalZipStatus:"GERANDO", finalZipError:undefined });
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
        thumbnail:liveProject.thumbFileName || null, youtubeMetadata:Boolean(liveProject.youtubeMetadata), automaticTotal:options.automaticRun === true, images:manifestItems,
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
      patchProject(project.id, { finalZipStatus:"CONCLUIDO", finalZipGeneratedAt:generatedAt, finalZipError:undefined });
      setConsolidationMessage(`ZIP final criado com ${summary.items.length} imagens. Thumbnail e metadados foram incluídos quando disponíveis.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Falha ao gerar ZIP final.");
      patchProject(project.id, { finalZipStatus:"FALHOU", finalZipError:message });
      setConsolidationMessage(message);
      return false;
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

    <section className="hero" id="top"><div><span className="eyebrow"><i /> CENTRAL DE PRODUÇÃO</span><h1>DA IDEIA AO <em>PACOTE FINAL.</em></h1><p>No automático, um clique inicia uma produção nova e o Corvo conduz tudo até o ZIP final.<br />No modo assistido, você continua controlando cada etapa.</p></div><div className="hero-actions"><button className="auto-project" onClick={startFullAutomaticProduction}><span>⚡</span><b>INICIAR AUTOMÁTICO</b><small>1 CLIQUE · IDEIA → ZIP FINAL</small></button><button className="new-project" onClick={openNewProduction}><span>＋</span><b>NOVA PRODUÇÃO</b><small>MODO ASSISTIDO</small></button></div></section>

    <section className="workspace" id="producao">
      <div className="section-heading"><div><span className="section-number">01</span><h2>EM PRODUÇÃO</h2></div><button className="text-button" onClick={openNewProduction}>CRIAR OUTRA <span>↗</span></button></div>
      {active && <article className="production-card">
        <div className="card-main">
          <div className="project-meta"><span className="format-tag">{active.format}</span><span>{active.quantity}</span><span>{active.createdAt}</span></div>
          <h3>{active.title}</h3><p>{active.id}</p>
          <div className="stepper">{steps.map((step,index) => { const complete=index+1<active.stage; const current=index+1===active.stage; return <div className={`step ${complete?"complete":""} ${current?"current":""}`} key={step}><span>{complete?"✓":String(index+1).padStart(2,"0")}</span><small>{step}</small></div>; })}</div>
          <div className="card-actions">
            {active.autoRunStatus==="ERROR"||active.autoRunStatus==="CANCELLED"?<button className="resume-auto-action" onClick={()=>void runAutomaticProduction(active.id)}><span>⚡</span><b>RETOMAR ESTA PRODUÇÃO</b><i>→</i></button>:null}
            <button className="primary-action" onClick={continueProduction}>{active.stage<=2?(active.scriptText?"REVISAR ROTEIRO":"CRIAR ROTEIRO"):active.stage===3?(active.promptText?"REVISAR PROMPTS":"CRIAR PROMPTS"):active.stage===4?"BUSCAR IMAGENS":"BAIXAR PRODUÇÃO"} <span>→</span></button>
            <button className="secondary-action" onClick={() => downloadProject(active)}>↓ BAIXAR PROJETO</button>
          </div>
          {active.autoRunStatus&&<div className={`auto-run-panel ${active.autoRunStatus.toLowerCase()}`}><div className="auto-run-head"><div><span>AUTOMÁTICO TOTAL</span><b>{active.autoRunMessage||"Acompanhando a produção automática."}</b>{active.autoRunError&&<small>{active.autoRunError}</small>}</div>{active.autoRunStatus==="RUNNING"?<button onClick={()=>void cancelAutomaticProduction(active.id)}>PARAR</button>:<em>{active.autoRunStatus==="DONE"?"CONCLUÍDO":active.autoRunStatus==="ERROR"?"PRECISA DE ATENÇÃO":"INTERROMPIDO"}</em>}</div><div className="auto-run-steps">{autoRunChecklist(active,settings.youtubeParallel).map((item)=><span className={item.done?"done":active.autoRunStep===item.key?"current":""} key={item.key}><i>{item.done?"✓":active.autoRunStep===item.key?"•":"○"}</i>{item.label}</span>)}</div></div>}
        </div>
        <aside className="card-side" id="arquivos">
          <div className="mini-title"><span>MEMÓRIA DA PRODUÇÃO</span><b>{[active.ideaText,active.scriptText,active.promptText].filter(Boolean).length}/3</b></div>
          <button className="file-row done action" onClick={()=>openArtifact("IDEIA")}><span>◆</span><div><b>IDEIA ESCOLHIDA</b><small>ABRIR CONCEITO ORIGINAL</small></div><i>→</i></button>
          <button className={`file-row action ${active.scriptText?"done":"pending"}`} disabled={!active.scriptText} onClick={()=>openArtifact("ROTEIRO")}><span>▤</span><div><b>ROTEIRO.TXT</b><small>{active.scriptText?"ABRIR ROTEIRO COMPLETO":"AGUARDANDO ROTEIRISTA"}</small></div><i>{active.scriptText?"→":"○"}</i></button>
          <button className={`file-row action ${active.promptText?"done":"pending"}`} disabled={!active.promptText} onClick={()=>openArtifact("PROMPTS")}><span>✦</span><div><b>PROMPTS.TXT</b><small>{active.promptText?"ABRIR BUSCAS DE IMAGEM":"AGUARDANDO ROTEIRO"}</small></div><i>{active.promptText?"→":"○"}</i></button>
          <button className={`file-row action ${active.thumbUrl?"done":active.thumbStatus==="FALHOU"?"pending":""}`} disabled={!active.thumbUrl} onClick={()=>active.thumbUrl&&window.open(active.thumbUrl,"_blank","noopener,noreferrer")}><span>▰</span><div><b>THUMBNAIL</b><small>{active.thumbUrl?"ABRIR IMAGEM FINAL":active.thumbError||active.thumbStatus||"INICIA EM PARALELO COM O COLLECTOR"}</small></div><i>{active.thumbUrl?"→":"○"}</i></button>
          <button className={`file-row action ${active.analysisStatus==="CONCLUÍDA"?"done":active.analysisStatus?"pending":""}`} disabled={!active.analysisManifest&&!hasPreparedAnalysis(active)&&!hasAnalysisPreparationCheckpoint(active)} onClick={()=>{if(active.analysisManifest){setNotice("MANIFESTO DO ANALISTA SALVO NO PROJETO.");setTimeout(()=>setNotice(""),2800);}else if(hasPreparedAnalysis(active)){void resumePreparedAnalysis(active.id,true);}else if(hasAnalysisPreparationCheckpoint(active)){void resumeAnalysisPreparation(active.id,true);}}}><span>◫</span><div><b>{hasPreparedAnalysis(active)?"PACOTE DO ANALISTA SALVO":hasAnalysisPreparationCheckpoint(active)?"CHECKPOINT DO ANALISTA SALVO":"ANÁLISE DE IMAGENS"}</b><small>{hasPreparedAnalysis(active)?`${active.analysisStatus||"AGUARDANDO ANALISTA"} · ${analysisRetryLabel(active.analysisRetryAt)}`:hasAnalysisPreparationCheckpoint(active)?`${preparationStageLabel(active)} · ${analysisRetryLabel(active.analysisPreparationRetryAt)}`:active.analysisStatus||"COMEÇA APÓS O PACOTE DO COLLECTOR"}</small>{active.analysisLastError&&hasPreparedAnalysis(active)?<em>{active.analysisLastError}</em>:null}{active.analysisPreparationError&&hasAnalysisPreparationCheckpoint(active)?<em>{active.analysisPreparationError}</em>:null}</div><i>{active.analysisStatus==="CONCLUÍDA"?"✓":hasPreparedAnalysis(active)||hasAnalysisPreparationCheckpoint(active)?"↻":"○"}</i></button>
          <button className={`file-row action ${active.youtubeMetadata?"done":active.youtubeStatus==="FALHOU"?"pending":""}`} disabled={!active.youtubeMetadata} onClick={()=>{if(active.youtubeMetadata)downloadTextFile(`${active.id}_YOUTUBE.txt`,active.youtubeMetadata);}}><span>▶</span><div><b>YOUTUBE / METADADOS</b><small>{active.youtubeMetadata?"BAIXAR DADOS EDITORIAIS":active.youtubeError||active.youtubeStatus||(settings.youtubeParallel?"INICIA EM PARALELO":"DESATIVADO NAS CONFIGURAÇÕES")}</small></div><i>{active.youtubeMetadata?"↓":"○"}</i></button>
          <button className={`file-row action ${consolidationState(active).ready?"done":active.pipelineItems?.length?"pending":""}`} disabled={!active.pipelineItems?.length} onClick={()=>{setConsolidationMessage("");setConsolidationOpen(true);}}><span>▦</span><div><b>CONSOLIDAÇÃO / ZIP FINAL</b><small>{active.pipelineItems?.length ? `${consolidationState(active).completed}/${consolidationState(active).items.length} FINAIS · ${consolidationState(active).ready ? "PRONTO PARA GERAR" : active.pipelineStatus || "AGUARDANDO"}` : "AGUARDANDO O ANALISTA"}</small></div><i>{active.finalZipStatus==="CONCLUIDO"?"✓":consolidationState(active).ready?"→":"○"}</i></button>
          {active.packageCode ? <button className="package-ready" onClick={() => hasPreparedAnalysis(active) ? void resumePreparedAnalysis(active.id,true) : hasAnalysisPreparationCheckpoint(active) ? void resumeAnalysisPreparation(active.id,true) : active.pipelineStatus==="ERRO NO PIPELINE" ? void startImageFlow() : setImageOpen(true)}><span>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"✓":hasPreparedAnalysis(active)||hasAnalysisPreparationCheckpoint(active)?"↻":"⌁"}</span><div><b>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"IMAGENS FINAIS PRONTAS":hasPreparedAnalysis(active)?"PACOTE PRESERVADO · REENVIAR ANALISTA":hasAnalysisPreparationCheckpoint(active)?"CHECKPOINT PRESERVADO · RETOMAR PREPARAÇÃO":"PIPELINE DE IMAGENS"}</b><small>{hasPreparedAnalysis(active)?`${active.analysisZipName||"ZIP DO ANALISTA"} · ${analysisRetryLabel(active.analysisRetryAt)}`:hasAnalysisPreparationCheckpoint(active)?`${preparationStageLabel(active)} · ${analysisRetryLabel(active.analysisPreparationRetryAt)}`:active.pipelineStatus||`${active.imageCount || 0} ARQUIVOS · ${active.packageCode}`}</small></div></button> : <button className="collector-box" disabled={!active.promptText || active.stage<4} onClick={()=>void startImageFlow()}><span>⌁</span><b>{collectorRunning?"ACOMPANHAR BUSCA":active.promptText&&active.stage>=4?"BUSCAR COM O CORVO":"AGUARDANDO PROMPTS"}</b><small>{collectorRunning?"O COLLECTOR CONTINUA TRABALHANDO":active.promptText&&active.stage>=4?`MOTOR: ${collectorEngines[settings.sourceMode].label} · SEGUNDO PLANO`:"A PRÓXIMA ETAPA SERÁ LIBERADA"}</small></button>}
        </aside>
      </article>}
    </section>

    <section className="projects" id="projetos"><div className="section-heading"><div><span className="section-number">02</span><h2>PROJETOS RECENTES</h2></div><span className="project-count">{String(projects.length).padStart(2,"0")} PRODUÇÕES</span></div><div className="project-list">{projects.map((project) => <button className={`project-row ${project.id===activeId?"selected":""}`} key={project.id} onClick={() => setActiveId(project.id)}><span className="project-icon">{project.format==="REELS"?"▯":"▭"}</span><span className="project-name"><b>{project.title}</b><small>{project.id}</small></span><span className="project-format">{project.format}</span><span className="progress"><i style={{width:`${project.stage*20}%`}} /></span><span className="stage-label">ETAPA {project.stage}/5</span><span className="row-arrow">→</span></button>)}</div></section>
    <footer><span>CORVOQUIZ PRODUÇÃO <i>V0.6.28</i></span><span>ENVIO CONFIRMADO AO ANALISTA · CHECKPOINT PRESERVADO · V0.6.28</span></footer>
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
      <div className="choice-cards"><button className={settings.selectionMode==="AUTO"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"AUTO"})}><b>⚡ AUTOMÁTICO</b><small>ENVIA ATÉ {settings.analystCandidatesPerId} CANDIDATAS/ID AO ANALISTA</small></button><button className={settings.selectionMode==="MANUAL"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"MANUAL"})}><b>◉ REVISÃO RÁPIDA</b><small>VOCÊ ESCOLHE UMA CANDIDATA POR ID</small></button></div>
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
          <a className="download-card" href="/downloads/CORVO_COLLECTOR_V080_EXTENSION.zip" download><span>⌁</span><div><b>EXTENSÃO DE IMAGENS</b><small>CORVO COLLECTOR V0.8.0</small></div><i>↓</i></a>
          <a className="download-card" href="/downloads/CORVO_BRIDGE_V0615_EXTENSION.zip" download><span>↗</span><div><b>EXTENSÃO DO BRIDGE</b><small>CORVO BRIDGE V0.6.15 · ANEXO + MENSAGEM CONFIRMADOS NO ANALISTA</small></div><i>↓</i></a>
          <a className="download-card featured" href="/downloads/CORVOQUIZ_KIT_COMPLETO_V0628.zip" download><span>◆</span><div><b>KIT COMPLETO CORVOQUIZ</b><small>APP + EXTENSÕES + SCHEMA</small></div><i>↓</i></a>
        </div>
      </section>
      <details className="advanced-settings"><summary>CONFIGURAÇÕES AVANÇADAS</summary><div className="settings-grid"><label>CANDIDATAS COLETADAS/ID<input type="number" min="1" max="20" value={settings.maxCandidates} onChange={(event)=>setSettings({...settings,maxCandidates:Math.max(1,Math.min(20,Number(event.target.value)||20))})}/></label><label>CANDIDATAS/ID → ANALISTA<input type="number" min="1" max="30" value={settings.analystCandidatesPerId} onChange={(event)=>setSettings({...settings,analystCandidatesPerId:Math.max(1,Math.min(30,Number(event.target.value)||10))})}/></label><label>VARREDURA<input type="number" value={settings.scrollSteps} onChange={(event)=>setSettings({...settings,scrollSteps:Number(event.target.value)})}/></label><label>QUALIDADE JPEG<input type="number" step=".01" value={settings.jpegQuality} onChange={(event)=>setSettings({...settings,jpegQuality:Number(event.target.value)})}/></label><label>PREFIXO<input value={settings.prefix} onChange={(event)=>setSettings({...settings,prefix:event.target.value})}/></label></div><p>A busca coleta no máximo 20 candidatas únicas por ID. No modo Mesclado, a meta é dividida entre Google e Pinterest. Depois, o limite do Analista reduz apenas o transporte; o app não escolhe a vencedora.</p><label className="batch-label">COMANDOS EM LOTE — OPCIONAL<textarea value={settings.batchText} onChange={(event)=>setSettings({...settings,batchText:event.target.value})} placeholder={"01|primeira busca\n02|segunda busca"} /></label></details>
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
