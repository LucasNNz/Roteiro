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
  isStructuredGuideText,
  parseGuideText,
  rankGroups,
  sendCollectorMessage,
  type GuideItem,
  type RankedGroup,
  type SelectionMode,
  type SourceMode,
} from "../lib/corvo-collector";
import { captureCorvoBridgeFile, completeCorvoBridgeJob, dispatchCorvoBridge, focusCorvoBridgeJob, getCorvoBridgeJobActivity, probeCorvoBridge, type CorvoBridgeJobActivity } from "../lib/corvo-bridge";
import { addFlowBatch, ensureFlowAgentReady, fetchFlowAsset, getFlowBatchManifest, getFlowManagerState, startFlowManager, stopFlowManager } from "../lib/corvo-flow";

type Format = "REELS" | "VÍDEO COMPLETO";
type Quantity = "1 VÍDEO" | "LOTE";
type Mode = "RÁPIDO" | "PESQUISAR ANTES";
type ImagePhase = "connecting" | "searching" | "review" | "packaging" | "done" | "error";
type CorvoIdea = { tema:string; titulo:string };
type WorkflowKind = "ROTEIRO" | "PROMPTS";
type ProjectArtifact = "IDEIA" | "ROTEIRO" | "PROMPTS";
type AutoRunStatus = "RUNNING" | "DONE" | "ERROR" | "CANCELLED";
type AutoRunStep = "VALIDANDO" | "IDEIA" | "ROTEIRO" | "PROMPTS" | "FLOW" | "COLLECTOR" | "ANALISTA" | "IMAGENS" | "FORMA" | "THUMB" | "METADADOS" | "CONSOLIDANDO" | "CONCLUIDO" | "ERRO";
type ActivityFilter = AutoRunStep | "TODOS";
type IdeaRequestOptions = { format:Format; quantity:Quantity; mode:Mode; topic?:string; revisionProjectId?:string };
type PipelineHistoryEvent = {
  at:string; attempt:number; specialist:"FLOW"|"REFINADOR"|"GERADOR"|"FALLBACK"; status:string; jobId?:string;
  errorCode?:string; reason?:string; destination?:string; promptRetry?:string; batchId?:string; logicalJobId?:string;
};
type PipelineItem = {
  id:string; route:"FLOW"|"REFINADOR"|"GERADOR"; sourceFile?:string; selectedFile?:string; sourceUrl?:string; refinement?:string; reason?:string; generationPrompt?:string;
  sceneId?:string; slot?:"A"|"B"|"SINGLE"; formaField?:string; preset?:string;
  retryPrompt?:string; finalFile:string; jobId?:string; fallbackJobId?:string; status?:string; outputUrl?:string; outputFile?:string;
  error?:string; errorCode?:string; tentativaAtual?:number; finalFailure?:boolean; history?:PipelineHistoryEvent[];
  logicalJobId?:string; batchId?:string; batchIndex?:number; batchSize?:number; routeConversationUrl?:string; fallbackConversationUrl?:string;
  jobPrompt?:string; jobUploadToken?:string;
};
type Project = {
  id:string; title:string; topic:string; format:Format; quantity:Quantity; mode:Mode;
  stage:number; createdAt:string; ideaText?:string; scriptText?:string; promptText?:string; packageCode?:string; imageCount?:number;
  flowBatchId?:string; flowStatus?:string; flowStartedAt?:string; flowCompletedAt?:string; flowTotal?:number; flowDone?:number; flowFailed?:number; flowManifest?:string;
  formaStatus?:string; formaStartedAt?:string; formaCompletedAt?:string; formaSceneCount?:number; formaQuestionCount?:number; formaVideoName?:string; formaVideoSize?:number; formaVideoDuration?:number; formaError?:string;
  thumbJobId?:string; thumbUploadToken?:string; thumbStatus?:string; thumbUrl?:string; thumbFileName?:string; thumbError?:string; thumbFormat?:Format; thumbAspectRatio?:"9:16"|"16:9";
  analysisJobId?:string; analysisStatus?:string; analysisZipUrl?:string; analysisZipName?:string; analysisManifest?:string; analysisExpectedIds?:string[];
  analysisPrompt?:string; analysisUploadToken?:string; analysisPreparedAt?:string; analysisLastDispatchAt?:string; analysisRetryAt?:string; analysisRetryCount?:number; analysisLastError?:string;
  analysisBridgeStage?:string; analysisBridgeUpdatedAt?:string; analysisZipDownloadUrl?:string;
  analysisPreparationStage?:"JOB_CREATED"|"CANDIDATES_PREPARING"|"CANDIDATES_STORED"|"ZIP_BUILDING"|"ZIP_SAVED";
  analysisExpectedCandidates?:number; analysisStoredCandidates?:number; analysisStoredIds?:number; analysisBatchTotal?:number; analysisBatchesUploaded?:number;
  analysisCollectorPackageId?:string; analysisCollectorPackageCode?:string; analysisPackageFileName?:string; analysisSelectionMode?:"AUTO"|"MANUAL";
  analysisPreparationRetryAt?:string; analysisPreparationRetryCount?:number; analysisPreparationError?:string;
  pipelineStatus?:string; pipelineItems?:PipelineItem[]; pipelineCheckpointVersion?:number;
  youtubeJobId?:string; youtubeStatus?:string; youtubeMetadata?:string; youtubeError?:string;
  finalZipStatus?:string; finalZipError?:string; finalZipGeneratedAt?:string;
  autoRunStatus?:AutoRunStatus; autoRunStep?:AutoRunStep; autoRunMessage?:string; autoRunError?:string; autoRunStartedAt?:string; autoRunCompletedAt?:string;
  autoRunRetryAt?:string; autoRunRetryCount?:number;
  autoIdeaJobId?:string; autoIdeaPrompt?:string; autoIdeaDispatchedAt?:string;
  autoWorkflowJobId?:string; autoWorkflowKind?:WorkflowKind; autoWorkflowPrompt?:string; autoWorkflowDispatchedAt?:string;
};
type CollectorSettings = {
  selectionMode:SelectionMode; sourceMode:SourceMode; maxCandidates:number; analystCandidatesPerId:number; scrollSteps:number;
  extensionId:string; prefix:string; jpegQuality:number; batchText:string; youtubeParallel:boolean;
};

const EMPTY_IMAGE_PIPELINE:Partial<Project> = {
  packageCode:undefined, imageCount:undefined, flowBatchId:undefined, flowStatus:undefined, flowStartedAt:undefined, flowCompletedAt:undefined, flowTotal:undefined, flowDone:undefined, flowFailed:undefined, flowManifest:undefined,
  formaStatus:undefined, formaStartedAt:undefined, formaCompletedAt:undefined, formaSceneCount:undefined, formaQuestionCount:undefined, formaVideoName:undefined, formaVideoSize:undefined, formaVideoDuration:undefined, formaError:undefined,
  analysisJobId:undefined, analysisStatus:undefined, analysisZipUrl:undefined, analysisZipName:undefined, analysisManifest:undefined,
  analysisExpectedIds:undefined, analysisPrompt:undefined, analysisUploadToken:undefined, analysisPreparedAt:undefined,
  analysisLastDispatchAt:undefined, analysisRetryAt:undefined, analysisRetryCount:undefined, analysisLastError:undefined, analysisBridgeStage:undefined, analysisBridgeUpdatedAt:undefined, analysisZipDownloadUrl:undefined,
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
const ANALYSIS_COMMITTED_STAGES = new Set(["USER_MESSAGE_COMMITTED", "MESSAGE_CONFIRMED", "WAITING_ACTION"]);
function analysisMessageCommitted(project?:Project | null) {
  return Boolean(project && ANALYSIS_COMMITTED_STAGES.has(String(project.analysisBridgeStage || "")));
}
const MAX_PIPELINE_ATTEMPTS = 3;
const PIPELINE_BATCH_SIZE = 10;
const MAX_PARALLEL_REFINER_BATCHES = 2;
const MAX_PARALLEL_GENERATOR_BATCHES = 1;
const MAX_PARALLEL_FALLBACK_BATCHES = 1;
const ANALYSIS_RETRY_DELAYS = [60_000, 120_000, 300_000, 600_000];

function thumbAspectRatioForFormat(format:Format):"9:16"|"16:9" {
  return format === "REELS" ? "9:16" : "16:9";
}

function thumbOrientationForFormat(format:Format) {
  return format === "REELS" ? "VERTICAL" : "HORIZONTAL";
}

function thumbMatchesProjectFormat(project?:Project | null) {
  if (!project?.thumbUrl) return false;
  const expected = thumbAspectRatioForFormat(project.format);
  // Antes da V0.6.43 toda thumb legada era 16:9. Para vídeo completo ela continua válida.
  if (!project.thumbAspectRatio) return project.format === "VÍDEO COMPLETO";
  return project.thumbAspectRatio === expected && (!project.thumbFormat || project.thumbFormat === project.format);
}

const TERMINAL_PIPELINE_STATUSES = new Set(["FALHA_FINAL", "NAO_RECUPERAVEL", "SELECTED_FILE_MISMATCH"]);
function isTerminalPipelineFailure(item:PipelineItem) {
  return Boolean(item.finalFailure || TERMINAL_PIPELINE_STATUSES.has(String(item.status || "").toUpperCase()));
}
function terminalPipelineFailures(project?:Project | null) {
  return (project?.pipelineItems || []).filter(isTerminalPipelineFailure);
}

function analysisRetryDelay(retryCount:number) {
  return ANALYSIS_RETRY_DELAYS[Math.min(Math.max(0, retryCount), ANALYSIS_RETRY_DELAYS.length - 1)];
}

function analysisRetryDelayForError(error:unknown, retryCount:number) {
  const text = String(error instanceof Error ? error.message : error || "").toUpperCase();
  // Falha de envio/composer: retomar rápido na MESMA aba e aproveitar rascunho/anexo.
  if (/(GPT_SEND|SEND_CONTROL|SEND_PENDING|COMPOSER_|ATTACHMENT_(INPUT|NOT_CONFIRMED)|CORVO_BRIDGE_PROGRESS_TIMEOUT)/.test(text)) {
    const quick = [20_000, 45_000, 90_000, 120_000];
    return quick[Math.min(Math.max(0, retryCount), quick.length - 1)];
  }
  // 403 de conteúdo do R2 não melhora com retry agressivo; mantém o checkpoint sem martelar a store.
  if (/(R2_CONTENT_READ_FORBIDDEN|ATTACHMENT_FETCH_403|ATTACHMENT_PROXY_FETCH_503)/.test(text)) return 10 * 60_000;
  return analysisRetryDelay(retryCount);
}

function analysisRetryLabel(rawDate?:string) {
  if (!rawDate) return "AGUARDANDO NOVA TENTATIVA";
  const remaining = Math.max(0, new Date(rawDate).getTime() - Date.now());
  if (remaining <= 0) return "NOVA TENTATIVA LIBERADA";
  const seconds = Math.ceil(remaining / 1000);
  if (seconds < 60) return `NOVA TENTATIVA EM ${seconds}S`;
  return `NOVA TENTATIVA EM ${Math.ceil(seconds / 60)} MIN`;
}

function isLegacyVercelBlobUrl(value?:string) {
  return /(^|\.)blob\.vercel-storage\.com(?=\/|$)/i.test((() => {
    try { return new URL(String(value || "")).hostname; } catch { return String(value || ""); }
  })());
}

function hasLegacyAnalysisStorage(project:Project | undefined | null) {
  return Boolean(
    project
    && [project.analysisZipUrl, project.analysisZipDownloadUrl].some((url) => isLegacyVercelBlobUrl(url))
    && project.analysisStatus !== "CONCLUÍDA"
  );
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

const PROJECTS_STORAGE_KEY = "corvoquiz-projects-v02";

function safeLoad<T>(key:string, fallback:T):T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}

function persistProjectsSnapshot(projects:Project[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects)); } catch {}
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

type FormaComparisonSlot = {
  key:string; sceneId:string; slot:"A"|"B"; formaField:"IMAGEM_A"|"IMAGEM_B"; fileName:string; optionText:string; question:string; preset:"QUAL_VOCE_PREFERE";
};

function normalizeSceneId(value:string) {
  const clean = String(value || "").trim();
  return /^\d+$/.test(clean) ? clean.padStart(2, "0") : clean;
}

function scriptField(block:string, field:string) {
  const match = block.match(new RegExp(`^\\s*${field}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return String(match?.[1] || "").trim();
}

function upgradeLegacyComparisonScript(scriptText?:string) {
  const source = String(scriptText || "");
  let converted = 0;
  const blockRegex = /(^|\n)(\s*\[([^\]\r\n]+)\]\s*\r?\n)([\s\S]*?)(?=\n\s*\[[^\]\r\n]+\]\s*(?:\r?\n|$)|$)/g;
  const text = source.replace(blockRegex, (whole, prefix:string, _header:string, rawSceneId:string, block:string) => {
    const tipo = scriptField(block, "TIPO").toUpperCase();
    const image1 = scriptField(block, "IMAGEM1");
    const image2 = scriptField(block, "IMAGEM2");
    const question = scriptField(block, "PERGUNTA");
    const looksLikeTwoChoiceComparison = /(?:\b1\s*OU\s*2\b|\bA\s*OU\s*B\b)/i.test(question) || /\b(?:REAL|IA|VERDADEIR[OA]|FALS[OA])\b/i.test(question);
    if (tipo !== "EMOJI_QUIZ" || !image1 || !image2 || !looksLikeTwoChoiceComparison) return whole;
    converted += 1;
    const optionA = scriptField(block, "A") || "1";
    const optionB = scriptField(block, "B") || "2";
    const sceneLabel = String(rawSceneId || "").trim();
    return `${prefix}[${sceneLabel}]\nTIPO: QUAL_VOCE_PREFERE\nPERGUNTA: ${question || "QUAL VOCÊ ESCOLHE?"}\nA: ${optionA}\nB: ${optionB}\nIMAGEM_A: ${image1}\nIMAGEM_B: ${image2}`;
  });
  return { text, converted };
}

function scriptImageReferences(scriptText?:string) {
  const refs:Array<{field:string;file:string}> = [];
  const regex = /^\s*(IMAGEM(?:_A|_B|_RESULTADO|1|2)?)\s*:\s*(.+?)\s*$/gmi;
  for (const match of String(scriptText || "").matchAll(regex)) {
    const file = String(match[2] || "").trim();
    if (file) refs.push({ field:String(match[1] || "").toUpperCase(), file });
  }
  return refs;
}

type ScriptPhysicalAsset = {
  id:string; sceneId:string; formaField:string; targetFile:string; slot?:"A"|"B"|"SINGLE";
};

function scriptPhysicalAssets(scriptText?:string):ScriptPhysicalAsset[] {
  const text = String(scriptText || "");
  const blockRegex = /(?:^|\n)\s*\[([^\]\r\n]+)\]\s*\r?\n([\s\S]*?)(?=\n\s*\[[^\]\r\n]+\]\s*(?:\r?\n|$)|$)/g;
  const assets:ScriptPhysicalAsset[] = [];
  for (const match of text.matchAll(blockRegex)) {
    const sceneId = normalizeSceneId(String(match[1] || ""));
    const block = String(match[2] || "");
    const imageRegex = /^\s*(IMAGEM(?:_A|_B|_RESULTADO|1|2)?)\s*:\s*(.+?)\s*$/gmi;
    for (const image of block.matchAll(imageRegex)) {
      const formaField = String(image[1] || "").toUpperCase();
      const targetFile = String(image[2] || "").trim();
      if (!targetFile) continue;
      const slot = formaField === "IMAGEM_A" ? "A" : formaField === "IMAGEM_B" ? "B" : "SINGLE";
      const id = slot === "A" || slot === "B" ? `${sceneId}_${slot}` : sceneId;
      assets.push({ id, sceneId, formaField, targetFile, slot });
    }
  }
  return assets;
}

function formaComparisonSlots(scriptText?:string):FormaComparisonSlot[] {
  const text = String(scriptText || "");
  const blockRegex = /(?:^|\n)\s*\[([^\]\r\n]+)\]\s*\r?\n([\s\S]*?)(?=\n\s*\[[^\]\r\n]+\]\s*(?:\r?\n|$)|$)/g;
  const slots:FormaComparisonSlot[] = [];
  for (const match of text.matchAll(blockRegex)) {
    const sceneId = normalizeSceneId(String(match[1] || ""));
    const block = String(match[2] || "");
    const tipo = scriptField(block, "TIPO").toUpperCase();
    const imageA = scriptField(block, "IMAGEM_A");
    const imageB = scriptField(block, "IMAGEM_B");
    // O contrato Forma oficial usa QUAL_VOCE_PREFERE. Para recuperar roteiros
    // legados que já tenham IMAGEM_A/IMAGEM_B mas um rótulo antigo de preset,
    // os dois campos físicos são a fonte de verdade da comparação.
    if (!imageA || !imageB) continue;
    if (tipo && !["QUAL_VOCE_PREFERE","OU","COMPARACAO","COMPARAÇÃO"].includes(tipo) && !/PREFERE|COMPAR|\bOU\b/.test(tipo)) continue;
    const question = scriptField(block, "PERGUNTA");
    slots.push({ key:`${sceneId}_A`, sceneId, slot:"A", formaField:"IMAGEM_A", fileName:imageA, optionText:scriptField(block, "A"), question, preset:"QUAL_VOCE_PREFERE" });
    slots.push({ key:`${sceneId}_B`, sceneId, slot:"B", formaField:"IMAGEM_B", fileName:imageB, optionText:scriptField(block, "B"), question, preset:"QUAL_VOCE_PREFERE" });
  }
  return slots;
}

function comparisonSlotPrompt(project:Project, slot:FormaComparisonSlot, baseQuery = "") {
  const fileStem = slot.fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/^q?\d+[-_]?/i, "").replace(/[-_]+/g, " ").trim();
  const option = slot.optionText || fileStem || `${project.topic} opção ${slot.slot}`;
  const context = [baseQuery, option, project.topic].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  return `${context}. Gerar/procurar SOMENTE a opção ${slot.slot} da comparação; um único elemento/cena independente, sem mostrar a opção oposta, sem divisão A/B, sem colagem, sem texto, sem logos e sem marca-d'água.`;
}

function guideItemsForProject(project:Project, rawText?:string):GuideItem[] {
  const base = rawText?.trim() ? parseGuideText(rawText) : defaultQueries(project);
  const physicalAssets = scriptPhysicalAssets(project.scriptText);

  // Formato oficial atual dos prompts: 1 parágrafo = 1 asset físico, sem IDs,
  // nomes de arquivo ou campos IMAGEM_* no próprio TXT. Nesse modo a fonte de
  // verdade para ID/slot/nome final é o ROTEIRO, e o casamento é estritamente
  // posicional. Isso é essencial para QUAL_VOCE_PREFERE: prompt 1 -> IMAGEM_A,
  // prompt 2 -> IMAGEM_B, nunca duplicando o mesmo prompt nas duas opções.
  if (rawText?.trim() && !isStructuredGuideText(rawText) && physicalAssets.length) {
    if (base.length !== physicalAssets.length) {
      throw new Error(`PROMPTS_ASSETS_COUNT_MISMATCH: ${base.length} prompt(s) para ${physicalAssets.length} asset(s) físicos no roteiro.`);
    }
    return base.map((item, index) => {
      const asset = physicalAssets[index];
      return {
        id:asset.id,
        sceneId:asset.sceneId,
        slot:asset.slot,
        formaField:asset.formaField,
        targetFile:asset.targetFile,
        query:item.query,
      };
    });
  }

  const slots = formaComparisonSlots(project.scriptText);
  if (!slots.length) return base;
  const slotByKey = new Map(slots.map((slot) => [slot.key.toUpperCase(), slot]));
  const slotsByScene = new Map<string,FormaComparisonSlot[]>();
  for (const slot of slots) slotsByScene.set(slot.sceneId.toUpperCase(), [...(slotsByScene.get(slot.sceneId.toUpperCase()) || []), slot]);
  const output:GuideItem[] = [];
  const emitted = new Set<string>();
  const emitSlot = (slot:FormaComparisonSlot, source?:GuideItem) => {
    const key = slot.key.toUpperCase();
    if (emitted.has(key)) return;
    emitted.add(key);
    output.push({ id:slot.key, sceneId:slot.sceneId, slot:slot.slot, formaField:slot.formaField, targetFile:slot.fileName, query:comparisonSlotPrompt(project, slot, source?.query || "") });
  };
  for (const item of base) {
    const rawId = String(item.id || "").trim();
    const key = rawId.toUpperCase();
    const direct = slotByKey.get(key);
    if (direct) { emitSlot(direct, item); continue; }
    const scene = normalizeSceneId(rawId).toUpperCase();
    const sceneSlots = slotsByScene.get(scene);
    if (sceneSlots?.length) { sceneSlots.forEach((slot) => emitSlot(slot, item)); continue; }
    output.push(item);
  }
  for (const slot of slots) emitSlot(slot);
  return output;
}

function comparisonSlotForItem(project:Project, id:string) {
  const key = String(id || "").trim().toUpperCase();
  return formaComparisonSlots(project.scriptText).find((slot) => slot.key.toUpperCase() === key);
}

function scriptSingleImageByScene(scriptText?:string) {
  const out = new Map<string,{field:string;file:string}>();
  const text = String(scriptText || "");
  const blockRegex = /(?:^|\n)\s*\[([^\]\r\n]+)\]\s*\r?\n([\s\S]*?)(?=\n\s*\[[^\]\r\n]+\]\s*(?:\r?\n|$)|$)/g;
  for (const match of text.matchAll(blockRegex)) {
    const sceneId = normalizeSceneId(String(match[1] || ""));
    const block = String(match[2] || "");
    const fields = ["IMAGEM","IMAGEM_RESULTADO","IMAGEM1","IMAGEM2"];
    for (const field of fields) {
      const file = scriptField(block, field);
      if (file) { out.set(sceneId.toUpperCase(), {field, file}); break; }
    }
  }
  return out;
}

function flowGuideItemsForProject(project:Project):GuideItem[] {
  const items = guideItemsForProject(project, project.promptText || "");
  const singles = scriptSingleImageByScene(project.scriptText);
  const refs = scriptImageReferences(project.scriptText);
  return items.map((item, index) => {
    if (item.targetFile) return item;
    const single = singles.get(normalizeSceneId(String(item.id || "")).toUpperCase());
    if (single) return { ...item, formaField:item.formaField || single.field, targetFile:single.file };
    const fallback = refs[index];
    return fallback ? { ...item, formaField:item.formaField || fallback.field, targetFile:fallback.file } : item;
  });
}

function flowBatchText(project:Project, batchId:string, items:GuideItem[]) {
  const lines = [
    "[FLOW_BATCH]", "VERSION=1.2", "DELIVERY_MODE=APP", "PROMPT_CONTRACT=PHYSICAL_ASSET_ORDER_V1", `PROJECT_ID=${project.id}`, `BATCH_ID=${batchId}`, `QUANTIDADE=${items.length}`, "",
  ];
  for (const [index, item] of items.entries()) {
    const id = String(item.id || "").trim();
    const filename = String(item.targetFile || "").replace(/^.*[\\/]/, "");
    lines.push(`[ID:${id}]`);
    lines.push(`JOB_ID=${project.id}:FLOW:${id}`);
    lines.push(`SLOT=${id}`);
    lines.push(`ARQUIVO_FINAL=${filename}`);
    lines.push(`METADATA=ORIGEM=ROTEIRO_APP;FORMATO=${project.format};CAMPO=${item.formaField || "IMAGEM"};ORDEM=${index + 1}`);
    lines.push(`PROMPT=${item.query}`);
    lines.push("");
  }
  return lines.join("\n");
}

function autoRunChecklist(project:Project, youtubeEnabled:boolean):Array<{key:ActivityFilter;label:string;done:boolean}> {
  return [
    { key:"IDEIA", label:"IDEIA", done:Boolean(project.ideaText) },
    { key:"ROTEIRO", label:"ROTEIRO", done:Boolean(project.scriptText) },
    { key:"PROMPTS", label:"PROMPTS", done:Boolean(project.promptText) },
    { key:"FLOW", label:"FLOW", done:project.pipelineStatus === "IMAGENS FINAIS PRONTAS" },
    { key:"IMAGENS", label:"IMAGENS", done:project.pipelineStatus === "IMAGENS FINAIS PRONTAS" },
    { key:"FORMA", label:"FORMA / VÍDEO", done:project.formaStatus === "CONCLUÍDO" },
    { key:"THUMB", label:"THUMB", done:thumbMatchesProjectFormat(project) },
    { key:"METADADOS", label:"METADADOS", done:!youtubeEnabled || Boolean(project.youtubeMetadata) },
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
  const invalidFiles = items.filter((item) => !/\.(png|jpe?g|webp|gif|avif)$/i.test(item.finalFile || item.outputFile || "")).map((item) => item.id);
  const itemIds = new Set(items.map((item) => String(item.id || "").toUpperCase()));
  const missingFormaSlots = formaComparisonSlots(project.scriptText).filter((slot) => !itemIds.has(slot.key.toUpperCase())).map((slot) => slot.key);
  const finalFileNames = new Set(items.map((item) => String(item.finalFile || item.outputFile || "").replace(/^.*[\\/]/, "").toLocaleLowerCase("pt-BR")).filter(Boolean));
  const missingScriptFiles = scriptImageReferences(project.scriptText)
    .filter((ref) => !finalFileNames.has(ref.file.replace(/^.*[\\/]/, "").toLocaleLowerCase("pt-BR")))
    .map((ref) => ref.file);
  const ready = items.length > 0 && !duplicateIds.length && !duplicateFiles.length && !missingIds.length && !invalidFiles.length && !missingFormaSlots.length && !missingScriptFiles.length;
  return { items, duplicateIds, duplicateFiles, missingIds, invalidFiles, missingFormaSlots, missingScriptFiles, ready, completed:items.filter((item) => Boolean(item.outputUrl) && !item.finalFailure).length };
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

function migratePipelineCheckpoint(project:Project):Project {
  if (Number(project.pipelineCheckpointVersion || 0) >= 2) return project;
  let recovered = 0;
  const items = (project.pipelineItems || []).map((item) => {
    if (item.outputUrl) return item;
    const historyFileFailure = (item.history || []).some((event) => event.specialist === "REFINADOR" && String(event.errorCode || "").toUpperCase() === "FILE_ERROR");
    const text = `${item.errorCode || ""} ${item.error || ""}`.toUpperCase();
    const knownAttachmentBug = historyFileFailure || /FILE_ERROR|ARQUIVO.*(AUSENTE|INACESS|DISPON)|IMAGEM.*(AUSENTE|INACESS|DISPON)/.test(text);
    if (!knownAttachmentBug || !item.selectedFile || !item.sourceUrl) return item;
    recovered += 1;
    return {
      ...item,
      route:"REFINADOR" as const,
      sourceFile:item.selectedFile,
      status:"PENDENTE",
      tentativaAtual:1,
      finalFailure:false,
      error:undefined, errorCode:undefined, retryPrompt:undefined,
      jobId:undefined, fallbackJobId:undefined, jobPrompt:undefined, jobUploadToken:undefined,
      batchId:undefined, batchIndex:undefined, batchSize:undefined,
      routeConversationUrl:undefined, fallbackConversationUrl:undefined,
    };
  });
  return {
    ...project,
    pipelineCheckpointVersion:2,
    pipelineItems:items,
    ...(recovered ? { pipelineStatus:`CHECKPOINT V2 · ${recovered} REFINO(S) REABERTO(S) COM ARQUIVO DE ORIGEM` } : {}),
  };
}

function migrateComparisonPipelineCheckpoint(project:Project):Project {
  if (Number(project.pipelineCheckpointVersion || 0) >= 3) return project;
  const slots = formaComparisonSlots(project.scriptText);
  if (!slots.length) return { ...project, pipelineCheckpointVersion:3 };
  const slotsByScene = new Map<string,FormaComparisonSlot[]>();
  const slotByKey = new Map(slots.map((slot) => [slot.key.toUpperCase(), slot]));
  for (const slot of slots) slotsByScene.set(slot.sceneId.toUpperCase(), [...(slotsByScene.get(slot.sceneId.toUpperCase()) || []), slot]);

  if (project.pipelineItems?.length) {
    let migrated = 0;
    const nextItems:PipelineItem[] = [];
    for (const item of project.pipelineItems) {
      const directSlot = slotByKey.get(String(item.id || "").toUpperCase());
      if (directSlot) {
        nextItems.push({ ...item, sceneId:directSlot.sceneId, slot:directSlot.slot, formaField:directSlot.formaField, preset:directSlot.preset, finalFile:directSlot.fileName });
        continue;
      }
      const sceneId = normalizeSceneId(String(item.id || ""));
      const sceneSlots = slotsByScene.get(sceneId.toUpperCase());
      if (!sceneSlots?.length) { nextItems.push(item); continue; }
      migrated += 1;
      for (const slot of sceneSlots) {
        nextItems.push({
          ...item,
          id:slot.key,
          sceneId:slot.sceneId,
          slot:slot.slot,
          formaField:slot.formaField,
          preset:slot.preset,
          route:"GERADOR",
          sourceFile:"", selectedFile:undefined, sourceUrl:undefined, refinement:undefined,
          generationPrompt:comparisonSlotPrompt(project, slot, item.generationPrompt || item.reason || ""),
          retryPrompt:undefined, finalFile:slot.fileName, outputUrl:undefined, outputFile:undefined,
          jobId:undefined, fallbackJobId:undefined, jobPrompt:undefined, jobUploadToken:undefined,
          status:"PENDENTE", tentativaAtual:1, finalFailure:false, error:undefined, errorCode:undefined,
          batchId:undefined, batchIndex:undefined, batchSize:undefined, routeConversationUrl:undefined, fallbackConversationUrl:undefined,
          logicalJobId:`${project.id}:ITEM:${slot.key}`,
          reason:`Preset Forma QUAL_VOCE_PREFERE · ${slot.formaField} · opção ${slot.slot}.`,
        });
      }
    }
    return {
      ...project, pipelineCheckpointVersion:3, pipelineItems:nextItems,
      ...(migrated ? {
        pipelineStatus:`CHECKPOINT V3 · ${migrated} CENA(S) OU EXPANDIDA(S) PARA ${migrated * 2} SLOTS A/B`,
        finalZipStatus:undefined, finalZipError:undefined, finalZipGeneratedAt:undefined,
        autoRunStep:project.autoRunStatus === "RUNNING" ? "IMAGENS" : project.autoRunStep,
        autoRunMessage:project.autoRunStatus === "RUNNING" ? "Comparações do preset OU migradas para dois assets físicos A/B por cena. Retomando somente a geração das imagens afetadas." : project.autoRunMessage,
      } : {}),
    };
  }

  const expected = new Set((project.analysisExpectedIds || []).map((id) => normalizeSceneId(String(id)).toUpperCase()));
  const legacyAnalysis = slots.some((slot) => expected.has(slot.sceneId.toUpperCase()) && !expected.has(slot.key.toUpperCase()));
  if (legacyAnalysis && (project.analysisJobId || project.packageCode)) {
    return {
      ...project, ...EMPTY_IMAGE_PIPELINE, pipelineCheckpointVersion:3,
      pipelineStatus:"CHECKPOINT V3 · PRESET OU REABERTO EM 2 SLOTS A/B POR CENA",
      autoRunStep:project.autoRunStatus === "RUNNING" ? "COLLECTOR" : project.autoRunStep,
      autoRunMessage:project.autoRunStatus === "RUNNING" ? "Comparação antiga tinha 1 ID por cena. Reexecutando somente o pipeline de imagens com IMAGEM_A e IMAGEM_B separadas." : project.autoRunMessage,
      autoRunError:undefined,
    };
  }
  return { ...project, pipelineCheckpointVersion:3 };
}

function migrateComparisonContractV4(project:Project):Project {
  const upgraded = upgradeLegacyComparisonScript(project.scriptText);
  if (!upgraded.converted) {
    return Number(project.pipelineCheckpointVersion || 0) >= 4 ? project : { ...project, pipelineCheckpointVersion:4 };
  }
  const automaticWasActive = project.autoRunStatus === "RUNNING" || project.autoRunStatus === "ERROR" || project.autoRunStatus === "DONE";
  return {
    ...project,
    ...EMPTY_IMAGE_PIPELINE,
    pipelineCheckpointVersion:4,
    scriptText:upgraded.text,
    promptText:undefined,
    stage:3,
    pipelineStatus:`CHECKPOINT V4 · ${upgraded.converted} COMPARAÇÃO(ÕES) CONVERTIDA(S) PARA QUAL_VOCE_PREFERE · 2 SLOTS A/B`,
    autoWorkflowJobId:undefined, autoWorkflowKind:undefined, autoWorkflowPrompt:undefined, autoWorkflowDispatchedAt:undefined,
    autoRunStatus:automaticWasActive ? "RUNNING" : project.autoRunStatus,
    autoRunStep:automaticWasActive ? "PROMPTS" : project.autoRunStep,
    autoRunMessage:automaticWasActive ? `Contrato de comparação corrigido. Recriando prompts para ${upgraded.converted * 2} slots físicos A/B.` : project.autoRunMessage,
    autoRunError:undefined, autoRunCompletedAt:undefined, autoRunRetryAt:undefined, autoRunRetryCount:0,
  };
}

function migrateLogicalGeneratorContractV5(project:Project):Project {
  if (Number(project.pipelineCheckpointVersion || 0) >= 5) return project;
  let reopened = 0;
  const items = (project.pipelineItems || []).map((item) => {
    const comparisonGenerator = item.route === "GERADOR" && item.preset === "QUAL_VOCE_PREFERE" && (item.slot === "A" || item.slot === "B");
    const alreadyDone = Boolean(item.outputUrl && item.status === "CONCLUIDO");
    const hasOldActiveJob = Boolean(item.jobId) && !String(item.jobPrompt || "").includes("cada imagem/opção descrita deve resultar em UM arquivo físico individual");
    if (!comparisonGenerator || alreadyDone || !hasOldActiveJob) return item;
    reopened += 1;
    return {
      ...item, status:"PENDENTE", tentativaAtual:Math.max(1, Number(item.tentativaAtual || 1)), finalFailure:false,
      error:undefined, errorCode:undefined, retryPrompt:item.retryPrompt,
      jobId:undefined, jobPrompt:undefined, jobUploadToken:undefined, batchId:undefined, batchIndex:undefined, batchSize:undefined, routeConversationUrl:undefined,
    };
  });
  return {
    ...project, pipelineCheckpointVersion:5, pipelineItems:items,
    ...(reopened ? {
      pipelineStatus:`CHECKPOINT V5 · ${reopened} SLOT(S) DO GERADOR REABERTO(S) NO CONTRATO DE IDS LÓGICOS A/B`,
      finalZipStatus:undefined, finalZipError:undefined, finalZipGeneratedAt:undefined,
      autoRunStatus:project.autoRunStatus === "ERROR" ? "RUNNING" : project.autoRunStatus,
      autoRunStep:["RUNNING","ERROR"].includes(String(project.autoRunStatus || "")) ? "IMAGENS" : project.autoRunStep,
      autoRunMessage:["RUNNING","ERROR"].includes(String(project.autoRunStatus || "")) ? "Reabrindo somente o Gerador com 4 IDs lógicos e assets físicos A/B separados." : project.autoRunMessage,
      autoRunError:undefined,
    } : {}),
  };
}

function migrateThumbnailCheckpoint(project:Project):Project {
  const expectedAspect = thumbAspectRatioForFormat(project.format);
  const expectedFormat = project.format;

  // Até a V0.6.42 o prompt do Corvo Thumb era sempre horizontal 16:9.
  // Portanto, uma thumb legada de VÍDEO COMPLETO continua correta; uma thumb legada de REELS precisa ser refeita em 9:16.
  if (!project.thumbAspectRatio && project.format === "VÍDEO COMPLETO") {
    return { ...project, thumbFormat:expectedFormat, thumbAspectRatio:expectedAspect };
  }

  const wrongFinishedThumb = Boolean(project.thumbUrl) && !thumbMatchesProjectFormat(project);
  const oldReelsJobInFlight = project.format === "REELS" && Boolean(project.thumbJobId) && !project.thumbAspectRatio;
  const explicitMismatch = Boolean(project.thumbAspectRatio) && project.thumbAspectRatio !== expectedAspect;

  if (wrongFinishedThumb || oldReelsJobInFlight || explicitMismatch) {
    return {
      ...project,
      thumbJobId:undefined,
      thumbUploadToken:undefined,
      thumbStatus:`PENDENTE · REFAZER THUMB ${expectedAspect}`,
      thumbUrl:undefined,
      thumbFileName:undefined,
      thumbError:undefined,
      finalZipStatus:undefined, finalZipError:undefined, finalZipGeneratedAt:undefined,
      thumbFormat:expectedFormat,
      thumbAspectRatio:expectedAspect,
    };
  }

  return { ...project, thumbFormat:project.thumbFormat || expectedFormat, thumbAspectRatio:project.thumbAspectRatio || expectedAspect };
}

function loadProjects() {
  return safeLoad<Project[]>(PROJECTS_STORAGE_KEY, initialProjects).map((rawProject) => {
    const project = migrateThumbnailCheckpoint(migrateLogicalGeneratorContractV5(migrateComparisonContractV4(migrateComparisonPipelineCheckpoint(migratePipelineCheckpoint(rawProject)))));
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
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("TODOS");
  const [activityJobs, setActivityJobs] = useState<CorvoBridgeJobActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityUpdatedAt, setActivityUpdatedAt] = useState<number>(0);
  const runToken = useRef(0);
  const ideaRunToken = useRef(0);
  const workflowRunToken = useRef(0);
  const thumbRuns = useRef(new Set<string>());
  const packageRetryRef = useRef<RankedGroup[] | null>(null);
  const analysisRetryLocks = useRef(new Set<string>());
  const analysisPreparationLocks = useRef(new Set<string>());
  const autoRunLocks = useRef(new Set<string>());
  const formaRunLocks = useRef(new Set<string>());
  const formaFrameRef = useRef<HTMLIFrameElement | null>(null);
  const projectsRef = useRef<Project[]>(projects);

  function specialistToActivityStep(specialist?:string):ActivityFilter {
    const key = String(specialist || "").toUpperCase();
    if (["IDEIAS","SCOUT"].includes(key)) return "IDEIA";
    if (key === "ROTEIRO") return "ROTEIRO";
    if (key === "PROMPTS") return "PROMPTS";
    if (key === "ANALISTA") return "ANALISTA";
    if (["REFINADOR","GERADOR","FALLBACK"].includes(key)) return "IMAGENS";
    if (key === "THUMB") return "THUMB";
    if (key === "YOUTUBE") return "METADADOS";
    return "TODOS";
  }

  function activityStepStatus(project:Project, step:ActivityFilter) {
    if (step === "IDEIA") return project.ideaText ? "CONCLUÍDA" : project.autoRunStep === "IDEIA" ? project.autoRunMessage || "EM ANDAMENTO" : "AGUARDANDO";
    if (step === "ROTEIRO") return project.scriptText ? "CONCLUÍDO" : project.autoRunStep === "ROTEIRO" ? project.autoRunMessage || "EM ANDAMENTO" : "AGUARDANDO";
    if (step === "PROMPTS") return project.promptText ? "CONCLUÍDOS" : project.autoRunStep === "PROMPTS" ? project.autoRunMessage || "EM ANDAMENTO" : "AGUARDANDO";
    if (step === "FLOW") return project.flowStatus || (project.autoRunStep === "FLOW" ? project.autoRunMessage || "EM PRODUÇÃO" : project.pipelineStatus === "IMAGENS FINAIS PRONTAS" ? "CONCLUÍDO" : "AGUARDANDO");
    if (step === "COLLECTOR") return project.analysisPreparationStage ? preparationStageLabel(project) : project.autoRunStep === "COLLECTOR" ? project.autoRunMessage || "COLETANDO" : project.packageCode ? "CONCLUÍDO" : "AGUARDANDO";
    if (step === "ANALISTA") return project.analysisStatus || (project.autoRunStep === "ANALISTA" ? project.autoRunMessage || "EM ANDAMENTO" : "AGUARDANDO");
    if (step === "IMAGENS") return project.pipelineStatus || (project.autoRunStep === "IMAGENS" ? project.autoRunMessage || "EM ANDAMENTO" : "AGUARDANDO");
    if (step === "FORMA") return project.formaStatus || (project.autoRunStep === "FORMA" ? project.autoRunMessage || "MONTANDO / EXPORTANDO" : "AGUARDANDO");
    if (step === "THUMB") return project.thumbStatus || (project.thumbUrl ? "CONCLUÍDA" : "AGUARDANDO");
    if (step === "METADADOS") return project.youtubeStatus || (project.youtubeMetadata ? "CONCLUÍDOS" : settings.youtubeParallel ? "AGUARDANDO" : "DESATIVADO");
    if (step === "CONSOLIDANDO") return project.finalZipStatus || "AGUARDANDO";
    if (step === "CONCLUIDO") return project.autoRunStatus === "DONE" ? "CONCLUÍDO" : "AGUARDANDO";
    return project.autoRunMessage || project.pipelineStatus || "ACOMPANHANDO";
  }

  async function refreshActivity(projectId = activeId) {
    setActivityLoading(true);
    try {
      const response = await getCorvoBridgeJobActivity();
      setActivityJobs((response.jobs || []).filter((job) => job.projectId === projectId));
      setActivityError("");
      setActivityUpdatedAt(Date.now());
    } catch (error) {
      setActivityError(bridgeErrorMessage(error));
    } finally { setActivityLoading(false); }
  }

  function openActivity(step:ActivityFilter = "TODOS") {
    setActivityFilter(step);
    setActivityOpen(true);
    void refreshActivity(activeId);
  }

  async function openBridgeConversation(job:CorvoBridgeJobActivity) {
    try {
      await focusCorvoBridgeJob(job.jobId);
    } catch (error) {
      if (job.conversationUrl) { window.open(job.conversationUrl, "_blank", "noopener,noreferrer"); return; }
      setActivityError(bridgeErrorMessage(error));
    }
  }

  useEffect(() => { projectsRef.current = projects; persistProjectsSnapshot(projects); }, [projects]);
  useEffect(() => { localStorage.setItem("corvo-collector-settings-v02", JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    if (!activityOpen) return;
    void refreshActivity(activeId);
    const timer = window.setInterval(() => void refreshActivity(activeId), 2500);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityOpen, activeId]);
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
        FILLING_COMPOSER:"ANALISTA · PREENCHENDO MENSAGEM",
        DRAFT_RECOVERED:"ANALISTA · RASCUNHO RECUPERADO",
        FETCHING_ATTACHMENT:"ANALISTA · BAIXANDO ZIP",
        FETCHING_ATTACHMENT_PROXY:"ANALISTA · RECUPERANDO ZIP PELO APP",
        ATTACHING_FILE:"ANALISTA · ANEXANDO ZIP",
        ATTACHMENT_READY:"ANALISTA · ZIP ANEXADO",
        WAITING_SEND_CONTROL:"ANALISTA · AGUARDANDO BOTÃO ENVIAR",
        READY_TO_SEND:"ANALISTA · PRONTO PARA ENVIAR",
        SEND_TRIGGERED:"ANALISTA · CLIQUE EM ENVIAR",
        SENDING_MESSAGE:"ANALISTA · ENVIANDO MENSAGEM",
        USER_MESSAGE_COMMITTED:"ANALISTA · MENSAGEM ENVIADA",
        MESSAGE_CONFIRMED:"ANALISTA · MENSAGEM CONFIRMADA",
        SEND_PENDING_RECOVERY:"ANALISTA · ENVIO PRESERVADO PARA RETOMADA",
        BACKGROUND_RETRY:"ANALISTA · RETRY EM SEGUNDO PLANO",
        WAITING_PREVIOUS_RESPONSE:"ANALISTA · RESPOSTA ANTERIOR EM ANDAMENTO",
        WAITING_ACTION:"ANALISTA PROCESSANDO · SEM REENVIO",
      };
      const label = labels[state];
      if (!label) return;
      patchProject(project.id, {
        analysisStatus:label,
        analysisBridgeStage:state,
        analysisBridgeUpdatedAt:new Date().toISOString(),
        pipelineStatus:["WAITING_ACTION","MESSAGE_CONFIRMED","USER_MESSAGE_COMMITTED"].includes(state) ? "ANALISANDO IMAGENS" : "ENVIANDO AO ANALISTA",
      });
      if (project.autoRunStatus === "RUNNING") updateAutoRun(project.id, "ANALISTA", message || label);
      if (activeId === project.id) {
        setImagePhase("searching");
        setImageProgress(["MESSAGE_CONFIRMED","USER_MESSAGE_COMMITTED","WAITING_ACTION"].includes(state) ? 92 : state === "ATTACHMENT_READY" || state === "WAITING_SEND_CONTROL" ? 91 : 90);
        setImageMessage(message || label);
        setImageStatusLine(label);
      }
    }
    window.addEventListener("message", onBridgeStatus);
    return () => window.removeEventListener("message", onBridgeStatus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  useEffect(() => {
    function onBridgeLifecycle(event:MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_CONTEXT_INVALIDATED") return;
      const running = projectsRef.current.find((project) => project.autoRunStatus === "RUNNING");
      scheduleBridgeContextReload(running?.id);
    }
    window.addEventListener("message", onBridgeLifecycle);
    // Ping explícito: CORVO_BRIDGE_READY pode ter sido emitido antes do React montar.
    probeCorvoBridge(1200).catch((error) => {
      if (isBridgeContextInvalidated(error)) {
        const running = projectsRef.current.find((project) => project.autoRunStatus === "RUNNING");
        scheduleBridgeContextReload(running?.id);
      }
    });
    return () => window.removeEventListener("message", onBridgeLifecycle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Migração V0.6.50: se a versão anterior marcou Extension context invalidated
    // como ERRO terminal, reabra automaticamente o mesmo projeto no checkpoint.
    for (const project of projectsRef.current) {
      if (project.autoRunStatus !== "ERROR" || !isBridgeContextInvalidated(project.autoRunError)) continue;
      const inferredStep:AutoRunStep = project.formaStatus === "CONCLUÍDO" ? "THUMB" : project.pipelineStatus === "IMAGENS FINAIS PRONTAS" ? "FORMA" : project.pipelineItems?.length ? "IMAGENS" : project.promptText ? "FLOW" : project.scriptText ? "PROMPTS" : project.ideaText ? "ROTEIRO" : "IDEIA";
      patchProject(project.id, {
        autoRunStatus:"RUNNING",
        autoRunStep:inferredStep,
        autoRunMessage:"Contexto antigo da extensão descartado. Retomando automaticamente com o Bridge atual...",
        autoRunError:undefined,
        autoRunRetryAt:undefined,
        autoRunRetryCount:0,
      });
      setTimeout(() => void runAutomaticProduction(project.id), 700);
    }
    const interrupted = projectsRef.current.filter((project) => project.autoRunStatus === "RUNNING");
    for (const project of interrupted) {
      if (hasLegacyAnalysisStorage(project)) {
        patchProject(project.id, {
          ...EMPTY_IMAGE_PIPELINE,
          autoRunStatus:"RUNNING", autoRunStep:"COLLECTOR", autoRunError:undefined,
          autoRunMessage:"Checkpoint antigo do Vercel Blob detectado após a migração. Reconstruindo o pacote no R2.",
          pipelineStatus:"MIGRANDO CHECKPOINT PARA R2",
        });
        setTimeout(() => void startImageFlow({ ...project, ...EMPTY_IMAGE_PIPELINE }, { automaticRun:true, skipParallelBranches:true, selectionMode:"AUTO" }), 800);
      } else if (hasPreparedAnalysis(project)) {
        if (analysisMessageCommitted(project)) {
          patchProject(project.id, {
            autoRunStatus:"RUNNING",
            autoRunStep:"ANALISTA",
            autoRunMessage:"O Analista já recebeu o ZIP. Aguardando a Action sem reenviar o prompt.",
            autoRunError:undefined,
            analysisRetryAt:undefined,
            analysisStatus:"ANALISTA PROCESSANDO · SEM REENVIO",
            pipelineStatus:"ANALISANDO IMAGENS",
          });
          setTimeout(() => void resumePreparedAnalysis(project.id, false), 800);
        } else {
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
        }
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
        patchProject(project.id, {
          autoRunStatus:"RUNNING",
          autoRunStep:project.ideaText ? project.scriptText ? project.promptText ? "FLOW" : "PROMPTS" : "ROTEIRO" : "IDEIA",
          autoRunMessage:"Produção automática recuperada. Retomando sozinha do último ponto salvo...",
          autoRunError:undefined,
        });
        setTimeout(() => void runAutomaticProduction(project.id), 900);
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
          // Depois que a mensagem entrou na conversa, tempo NÃO significa falha.
          // O Analista pode levar muito tempo em ZIPs grandes; apenas retomamos o polling da Action.
          if (analysisMessageCommitted(project)) {
            void resumePreparedAnalysis(project.id, false);
            continue;
          }
          const retryAt = project.analysisRetryAt ? new Date(project.analysisRetryAt).getTime() : 0;
          const lastDispatch = project.analysisLastDispatchAt ? new Date(project.analysisLastDispatchAt).getTime() : 0;
          const staleBeforeCommit = !retryAt && lastDispatch > 0 && now - lastDispatch >= 30 * 60_000;
          if ((retryAt > 0 && retryAt <= now) || staleBeforeCommit) void resumePreparedAnalysis(project.id, false);
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
  useEffect(() => {
    // Supervisor do AUTOMÁTICO TOTAL: se uma rotina assíncrona terminar, a página
    // recarregar ou um retry liberar, o fluxo volta a andar sem clique do usuário.
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const project of projectsRef.current) {
        if (project.autoRunStatus !== "RUNNING") continue;
        if (autoRunLocks.current.has(project.id)) continue;
        if (analysisRetryLocks.current.has(project.id) || analysisPreparationLocks.current.has(project.id)) continue;
        if (hasPreparedAnalysis(project) || hasAnalysisPreparationCheckpoint(project)) continue;
        const retryAt = project.autoRunRetryAt ? new Date(project.autoRunRetryAt).getTime() : 0;
        if (retryAt > now) continue;
        void runAutomaticProduction(project.id);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = useMemo(() => projects.find((project) => project.id === activeId) || projects[0], [projects, activeId]);
  const currentGroup = groups[groupIndex];
  const currentRank = currentGroup?.ranked[candidatePos];
  const workflowOutput = active ? (workflowKind === "ROTEIRO" ? active.scriptText : active.promptText) || "" : "";
  const artifactContent = active ? artifactKind === "IDEIA" ? active.ideaText || "" : artifactKind === "ROTEIRO" ? active.scriptText || "" : active.promptText || "" : "";
  const artifactRedoMessage = artifactKind === "IDEIA" ? "REFAZ ROTEIRO, PROMPTS E IMAGENS" : artifactKind === "ROTEIRO" ? "REFAZ PROMPTS E IMAGENS" : "DESCARTA AS IMAGENS ATUAIS";
  const terminalFailureCount = terminalPipelineFailures(active).length;

  function latestProject(projectId:string) {
    return projectsRef.current.find((project) => project.id === projectId);
  }

  function patchProject(projectId:string, patch:Partial<Project>) {
    setProjects((current) => {
      const next = current.map((project) => project.id === projectId ? { ...project, ...patch } : project);
      projectsRef.current = next;
      persistProjectsSnapshot(next);
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

  function createAutomaticProjectShell(targetFormat:Format) {
    const stamp = Date.now();
    const id = `AUTO_${stamp}`;
    const targetAspect = thumbAspectRatioForFormat(targetFormat);
    const project:Project = {
      id,
      title:"PRODUÇÃO AUTOMÁTICA",
      topic:"DESCOBERTA AUTOMÁTICA",
      format:targetFormat,
      quantity:"1 VÍDEO",
      mode:"RÁPIDO",
      stage:1,
      createdAt:"AGORA",
      thumbFormat:targetFormat,
      thumbAspectRatio:targetAspect,
      autoRunStatus:"RUNNING",
      autoRunStep:"VALIDANDO",
      autoRunMessage:`Preparando Automático ${targetFormat === "REELS" ? "Reels" : "Vídeo Completo"} · thumb ${targetAspect}...`,
      autoRunStartedAt:new Date().toISOString(),
    };
    setProjects((current) => {
      const next = [project, ...current];
      projectsRef.current = next;
      persistProjectsSnapshot(next);
      return next;
    });
    setActiveId(id);
    return project;
  }

  function startFullAutomaticProduction(targetFormat:Format) {
    const running = projectsRef.current.find((project) => project.autoRunStatus === "RUNNING");
    if (running) {
      setActiveId(running.id);
      setNotice(`JÁ EXISTE UMA PRODUÇÃO AUTOMÁTICA ${running.format} EM ANDAMENTO.`);
      setTimeout(() => setNotice(""), 4200);
      return;
    }
    const project = createAutomaticProjectShell(targetFormat);
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
        ideaText:project.ideaText, stage:2, scriptText:undefined, promptText:undefined,
        thumbJobId:undefined, thumbUploadToken:undefined, thumbStatus:undefined, thumbUrl:undefined, thumbFileName:undefined, thumbError:undefined,
        thumbFormat:project.format, thumbAspectRatio:thumbAspectRatioForFormat(project.format),
        ...EMPTY_IMAGE_PIPELINE,
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
          const normalizedOutput = kind === "ROTEIRO" ? upgradeLegacyComparisonScript(output).text : output;
          setProjects((current) => current.map((item) => item.id === workingProject.id
            ? kind === "ROTEIRO"
              ? { ...item, stage:2, scriptText:normalizedOutput, promptText:undefined, ...EMPTY_IMAGE_PIPELINE, pipelineCheckpointVersion:4 }
              : { ...item, stage:3, promptText:normalizedOutput, ...EMPTY_IMAGE_PIPELINE }
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
    if (active.stage === 4) { void startFlowImageProduction(active); return; }
    void runFormaProduction(active, { force: active.formaStatus === "CONCLUÍDO" });
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
      setNotice("PROMPTS APROVADOS. A PRODUÇÃO AUTOMÁTICA NO FLOW ESTÁ LIBERADA.");
      setTimeout(() => setNotice(""), 4200);
    }
  }

  async function runAutomaticIdeaDiscovery(project:Project) {
    updateAutoRun(project.id, "IDEIA", "O Corvo Scout está descobrindo a melhor ideia automaticamente...");
    let live = latestProject(project.id) || project;
    let scoutJobId = live.autoIdeaJobId;
    let scoutPrompt = live.autoIdeaPrompt;

    if (!scoutJobId || !scoutPrompt) {
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
      scoutJobId = String(result.jobId);
      scoutPrompt = String(result.prompt);
      patchProject(project.id, {
        autoIdeaJobId:scoutJobId,
        autoIdeaPrompt:scoutPrompt,
        autoIdeaDispatchedAt:undefined,
        autoRunStep:"IDEIA",
        autoRunMessage:"Ideia criada no orquestrador. Enviando ao Corvo Scout em segundo plano...",
      });
      live = latestProject(project.id) || live;
    }

    if (!live.autoIdeaDispatchedAt) {
      await dispatchCorvoBridge({
        jobId:scoutJobId,
        prompt:scoutPrompt,
        specialist:"SCOUT",
        meta:{ projectId:project.id, automaticTotal:true, fromScratch:true },
      });
      patchProject(project.id, {
        autoIdeaDispatchedAt:new Date().toISOString(),
        autoRunStep:"IDEIA",
        autoRunMessage:"Corvo Scout trabalhando em segundo plano. O resultado será capturado automaticamente.",
      });
    }

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
          autoIdeaJobId:undefined,
          autoIdeaPrompt:undefined,
          autoIdeaDispatchedAt:undefined,
          autoRunRetryAt:undefined,
          autoRunRetryCount:0,
        };
        patchProject(project.id, updated);
        updateAutoRun(project.id, "ROTEIRO", "Ideia escolhida automaticamente. Iniciando o roteiro...");
        return updated;
      }
      if (status.status === "ERROR") throw new Error(status?.message || status?.error || "O Corvo Scout não conseguiu concluir a descoberta automática.");
    }
    throw new Error("AUTOMATIC_CANCELLED");
  }

  async function runAutomaticSpecialist(kind:WorkflowKind, project:Project) {
    if (kind === "PROMPTS" && !project.scriptText?.trim()) throw new Error("O roteiro precisa estar pronto antes dos prompts.");
    let live = latestProject(project.id) || project;
    let jobId = live.autoWorkflowKind === kind ? live.autoWorkflowJobId : undefined;
    let prompt = live.autoWorkflowKind === kind ? live.autoWorkflowPrompt : undefined;

    if (!jobId || !prompt) {
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
      jobId = String(result.jobId);
      prompt = String(result.prompt);
      patchProject(project.id, {
        autoWorkflowJobId:jobId,
        autoWorkflowKind:kind,
        autoWorkflowPrompt:prompt,
        autoWorkflowDispatchedAt:undefined,
        autoRunStep:kind,
        autoRunMessage:`${kind === "ROTEIRO" ? "Roteiro" : "Prompts"} preparado. Enviando ao especialista em segundo plano...`,
      });
      live = latestProject(project.id) || live;
    }

    if (!live.autoWorkflowDispatchedAt) {
      await dispatchCorvoBridge({
        jobId, prompt, specialist:kind,
        meta:{ projectId:project.id, automaticTotal:true },
      });
      patchProject(project.id, {
        autoWorkflowDispatchedAt:new Date().toISOString(),
        autoRunStep:kind,
        autoRunMessage:`${kind === "ROTEIRO" ? "Roteiro" : "Prompts"} em processamento no GPT. A continuação é automática.`,
      });
    }

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
        const normalizedOutput = kind === "ROTEIRO" ? upgradeLegacyComparisonScript(output).text : output;
        const current = latestProject(project.id) || project;
        const clearWorkflow = { autoWorkflowJobId:undefined, autoWorkflowKind:undefined, autoWorkflowPrompt:undefined, autoWorkflowDispatchedAt:undefined, autoRunRetryAt:undefined, autoRunRetryCount:0 };
        const updated:Project = kind === "ROTEIRO"
          ? { ...current, stage:3, scriptText:normalizedOutput, promptText:undefined, ...EMPTY_IMAGE_PIPELINE, pipelineCheckpointVersion:4, ...clearWorkflow }
          : { ...current, stage:4, promptText:normalizedOutput, ...EMPTY_IMAGE_PIPELINE, ...clearWorkflow };
        patchProject(project.id, updated);
        updateAutoRun(project.id, kind === "ROTEIRO" ? "PROMPTS" : "FLOW", kind === "ROTEIRO" ? "Roteiro recebido. Iniciando prompts automaticamente..." : "Prompts recebidos. Preparando produção no Flow automaticamente...");
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
      const thumbReady = thumbMatchesProjectFormat(project);
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
    const initialStep:AutoRunStep = initial.ideaText ? initial.scriptText ? initial.promptText ? (initial.pipelineStatus === "IMAGENS FINAIS PRONTAS" ? (initial.formaStatus === "CONCLUÍDO" ? "THUMB" : "FORMA") : "FLOW") : "PROMPTS" : "ROTEIRO" : "IDEIA";
    patchProject(projectId, { autoRunStatus:"RUNNING", autoRunStep:initialStep, autoRunMessage:"Automático ativo. Retomando do último ponto salvo...", autoRunError:undefined, autoRunStartedAt:startedAt, autoRunCompletedAt:undefined, autoRunRetryAt:undefined });
    setNotice("MODO AUTOMÁTICO TOTAL INICIADO.");
    setTimeout(() => setNotice(""), 2400);
    try {
      let project = latestProject(projectId) || initial;
      if (!project.ideaText?.trim()) {
        project = await runAutomaticIdeaDiscovery(project);
      }
      if (!project.scriptText?.trim()) {
        updateAutoRun(projectId, "ROTEIRO", "Criando o roteiro automaticamente...");
        project = await runAutomaticSpecialist("ROTEIRO", project);
      }
      if (!project.promptText?.trim()) {
        updateAutoRun(projectId, "PROMPTS", "Transformando o roteiro em prompts de geração para o Flow...");
        project = await runAutomaticSpecialist("PROMPTS", project);
      }

      project = latestProject(projectId) || project;
      const imagesAlreadyReady = project.pipelineStatus === "IMAGENS FINAIS PRONTAS" && consolidationState(project).ready;
      updateAutoRun(projectId, "FLOW", imagesAlreadyReady ? "Imagens do Flow já estão preservadas no projeto." : "Prompts concluídos. Enviando os JOBs ao Corvo Flow Manager...");
      if (!project.thumbUrl) void startThumbBranch(project);
      if (settings.youtubeParallel && !project.youtubeMetadata) void startYoutubeBranch(project);
      const imageOk = imagesAlreadyReady ? true : await startFlowImageProduction(project, { automaticRun:true, skipParallelBranches:true });
      if (!imageOk) throw new Error("O Flow não chegou a um conjunto final completo de imagens.");

      project = latestProject(projectId) || project;
      const summary = consolidationState(project);
      if (!summary.ready) throw new Error(summary.missingIds.length ? `Ainda faltam imagens finais nos IDs: ${summary.missingIds.join(", ")}.` : "A consolidação encontrou arquivos ausentes, duplicados ou inválidos.");
      const formaAlreadyReady = project.formaStatus === "CONCLUÍDO";
      updateAutoRun(projectId, "FORMA", formaAlreadyReady ? "Vídeo do Forma já concluído neste projeto." : `Imagens finais prontas. Enviando ${summary.items.length} asset(s) ao módulo Lote do Forma...`);
      const formaOk = formaAlreadyReady ? true : await runFormaProduction(project, { automaticRun:true });
      if (!formaOk) throw new Error(latestProject(projectId)?.formaError || "O Forma não conseguiu concluir o vídeo final.");

      updateAutoRun(projectId, "THUMB", "Vídeo final entregue. Finalizando thumbnail e ramos paralelos sem novos downloads...");
      project = await waitForAutomaticParallelAssets(projectId);

      patchProject(projectId, {
        autoRunStatus:"DONE", autoRunStep:"CONCLUIDO", autoRunMessage:"Produção automática concluída. O MP4 final foi entregue pelo Forma; o ZIP permanece disponível apenas como opção manual.",
        autoRunError:undefined, autoRunCompletedAt:new Date().toISOString(), stage:5,
      });
      setImageOpen(false);
      setNotice("AUTOMÁTICO CONCLUÍDO · VÍDEO FINAL ENTREGUE.");
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
      } else if (isBridgeContextInvalidated(error) && scheduleBridgeContextReload(projectId)) {
        // A extensão MV3 foi recarregada enquanto esta página ainda mantinha o content-script antigo.
        // O checkpoint já foi persistido; o reload reinjeta o Bridge novo e o useEffect de retomada continua o automático.
      } else if (isAutomaticTransientError(error)) {
        const current = latestProject(projectId);
        const retryCount = Math.min(6, Number(current?.autoRunRetryCount || 0) + 1);
        if (retryCount <= 5) {
          const delays = [15_000, 30_000, 60_000, 120_000, 180_000];
          const retryAt = new Date(Date.now() + delays[Math.min(retryCount - 1, delays.length - 1)]).toISOString();
          patchProject(projectId, {
            autoRunStatus:"RUNNING",
            autoRunStep:current?.autoRunStep || initialStep,
            autoRunMessage:`Falha transitória. O automático tentará novamente sozinho (${analysisRetryLabel(retryAt)}).`,
            autoRunError:message,
            autoRunRetryAt:retryAt,
            autoRunRetryCount:retryCount,
          });
          setNotice("AUTOMÁTICO AGUARDANDO RETRY · NÃO PRECISA CLICAR.");
          setTimeout(() => setNotice(""), 4200);
        } else {
          patchProject(projectId, { autoRunStatus:"ERROR", autoRunStep:"ERRO", autoRunMessage:"O automático parou após várias tentativas consecutivas.", autoRunError:message, autoRunRetryAt:undefined });
          setNotice(`AUTOMÁTICO PAROU: ${message}`);
          setTimeout(() => setNotice(""), 6500);
        }
      } else {
        patchProject(projectId, { autoRunStatus:"ERROR", autoRunStep:"ERRO", autoRunMessage:"O automático parou porque precisa de atenção.", autoRunError:message, autoRunRetryAt:undefined });
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
    const safePipelineItems = (project.pipelineItems || []).map(({ jobUploadToken: _privateJobToken, ...item }) => { void _privateJobToken; return item; });
    const { analysisUploadToken: _privateAnalysisToken, pipelineItems: _privatePipelineItems, ...safeProjectBase } = project;
    void _privateAnalysisToken; void _privatePipelineItems;
    const safeProject = { ...safeProjectBase, pipelineItems:safePipelineItems };
    zip.file("projeto.json", JSON.stringify(safeProject, null, 2));
    zip.folder("ideia")?.file(`IDEIA_${project.id}.txt`, project.ideaText || `TÍTULO: ${project.title}\nTEMA: ${project.topic}`);
    zip.folder("roteiro")?.file(`${project.id}.txt`, project.scriptText || `PROJETO: ${project.id}\nROTEIRO AINDA NÃO CONCLUÍDO\n`);
    zip.folder("prompts")?.file(`PROMPTS_${project.id}.txt`, project.promptText || defaultQueries(project).map((item) => `${item.id}|${item.query}`).join("\n"));
    zip.folder("forma")?.file("PACOTE.txt", project.packageCode ? `PACOTE_CODE=${project.packageCode}` : "O pacote de imagens ainda não foi concluído.");
    zip.folder("thumbnail")?.file("THUMBNAIL.txt", project.thumbUrl ? `ARQUIVO=${project.thumbFileName || "thumbnail.png"}\nURL=${project.thumbUrl}` : `STATUS=${project.thumbStatus || "PENDENTE"}\n${project.thumbError ? `ERRO=${project.thumbError}` : ""}`);
    zip.folder("flow")?.file("CORVO_FLOW_RESULT.txt", project.flowManifest || `STATUS=${project.flowStatus || "PENDENTE"}\nBATCH_ID=${project.flowBatchId || ""}\nTOTAL=${project.flowTotal || 0}\nDONE=${project.flowDone || 0}\nFAILED=${project.flowFailed || 0}\n`);
    zip.folder("pipeline")?.file("IMAGENS_FINAIS.json", JSON.stringify(safePipelineItems, null, 2));
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

  function isBridgeContextInvalidated(error:unknown) {
    const message = String(error instanceof Error ? error.message : error || "").toUpperCase();
    return /EXTENSION[_ ]CONTEXT[_ ]INVALIDATED|EXTENSION CONTEXT INVALIDATED/.test(message);
  }

  function scheduleBridgeContextReload(projectId?:string) {
    const key = `corvoBridgeContextReload:${projectId || "GLOBAL"}`;
    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(key) || 0);
    if (last && now - last < 15000) return false;
    window.sessionStorage.setItem(key, String(now));
    if (projectId) {
      const current = latestProject(projectId);
      const inferredStep:AutoRunStep = current?.formaStatus === "CONCLUÍDO" ? "THUMB" : current?.pipelineStatus === "IMAGENS FINAIS PRONTAS" ? "FORMA" : current?.pipelineItems?.length ? "IMAGENS" : current?.promptText ? "FLOW" : current?.scriptText ? "PROMPTS" : current?.ideaText ? "ROTEIRO" : "IDEIA";
      patchProject(projectId, {
        autoRunStatus:"RUNNING",
        autoRunStep:current?.autoRunStep && current.autoRunStep !== "ERRO" ? current.autoRunStep : inferredStep,
        autoRunMessage:"Bridge foi atualizado/recarregado. Reconectando a extensão e retomando do checkpoint...",
        autoRunError:undefined,
        autoRunRetryAt:undefined,
      });
    }
    setNotice("BRIDGE ATUALIZADO · RECONECTANDO AUTOMATICAMENTE...");
    window.setTimeout(() => window.location.reload(), 220);
    return true;
  }

  function isAutomaticTransientError(error:unknown) {
    const message = String(error instanceof Error ? error.message : error || "").toUpperCase();
    if (/R2_(NOT_CONFIGURED|ENDPOINT_INVALID|BUCKET_NOT_FOUND|ACCESS_KEY_INVALID|SIGNATURE_FAILED|ACCESS_DENIED)|ORIGIN_NOT_AUTHORIZED|GPT_URL_NOT_CONFIGURED|TRATAMENTO_MANUAL_NECESSARIO/.test(message)) return false;
    return /CORVO_BRIDGE|GPT_SEND|GPT_CONTENT|PROGRESS_TIMEOUT|HARD_TIMEOUT|FETCH FAILED|NETWORK|TIMEOUT|COLLECTOR_CONNECTION_ERROR|JOB_ALREADY_RUNNING|PACKAGE_ALREADY_RUNNING|TEMPORAR|HTTP 5\d\d|EXTENSION[_ ]CONTEXT[_ ]INVALIDATED|RECEIVING END DOES NOT EXIST|FLOW_MANAGER|FLOW_HTTP|FLOW_ASSET_HTTP|FORMA_BRIDGE|FORMA_AUTOMATION_BUSY|FORMA_MP4/.test(message);
  }

  function friendlyError(error:unknown) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("FLOW_AGENT_NOT_INSTALLED_OR_UNAVAILABLE") || message.includes("FLOW_MANAGER_OFFLINE")) return "O motor do Flow não respondeu. Instale o CORVO FLOW AGENT uma única vez neste PC; depois disso ele inicia sozinho e o Roteiro passa a chamá-lo automaticamente.";
    if (message.includes("FLOW_MANAGER_APP_INTEGRATION_REQUIRED")) return "O Manager aberto é a versão antiga. Use o Flow Manager integrado incluído nesta versão do Roteiro.";
    if (message.includes("FLOW_ASSET_HTTP")) return "A imagem foi gerada, mas o app ainda não conseguiu puxar o asset do Manager local. O lote ficou preservado e pode ser retomado.";
    if (message.includes("FORMA_BRIDGE_NOT_READY") || message.includes("FORMA_BRIDGE_NOT_MOUNTED")) return "O Forma embutido não ficou pronto para receber o lote. A produção e as imagens ficaram preservadas; recarregue o app e retome a etapa Forma.";
    if (message.includes("FORMA_LOTE_INVALIDO")) return `O módulo Lote do Forma recusou o roteiro ou algum asset: ${message.replace("FORMA_LOTE_INVALIDO:", "").trim()}`;
    if (message.includes("FORMA_ASSETS_ACIMA_DE_120MB")) return "As imagens desta produção ultrapassaram 120 MB. Use o ZIP de fallback do Forma ou reduza o peso dos assets antes da exportação.";
    if (message.includes("FORMA_INPUT_INCOMPLETO")) return `O Forma ainda não recebeu todos os arquivos físicos exigidos pelo roteiro. ${message.includes(":") ? message.split(":").slice(1).join(":").trim() : ""}`.trim();
    if (message.includes("FORMA_MP4")) return "O Forma montou o lote, mas a exportação do MP4 não retornou um vídeo válido. O lote permanece preservado para tentar novamente.";
    const r2Trail = message.includes("|") ? ` [${message.split("|").at(-1)?.trim() || ""}]` : "";
    if (message.includes("EXTENSION_CONTEXT_INVALIDATED") || message.toLowerCase().includes("extension context invalidated")) return "O Bridge foi atualizado enquanto esta página estava aberta. O app vai recarregar a página e retomar automaticamente do checkpoint.";
    if (message.includes("ORIGIN_NOT_AUTHORIZED")) return "Autorize este endereço uma única vez no Corvo Collector e tente novamente.";
    if (message.includes("COLLECTOR_NOT_AVAILABLE") || message.includes("Receiving end does not exist")) return "O Corvo Collector não foi encontrado. Instale ou atualize a extensão incluída no pacote.";
    if (message.includes("JOB_ALREADY_RUNNING_DIFFERENT")) return "O Collector está trabalhando em outra produção. Aguarde essa busca terminar ou cancele-a antes de iniciar esta.";
    if (message.includes("JOB_ALREADY_RUNNING")) return "Já existe uma busca em andamento. Abra novamente esta etapa para acompanhar o trabalho atual.";
    if (message.includes("PACKAGE_ALREADY_RUNNING")) return "O Collector já está montando o pacote de outra produção. O pacote da produção atual será retomado automaticamente quando for o mesmo trabalho; se for outro projeto, aguarde a montagem atual terminar.";
    if (message.includes("R2_NOT_CONFIGURED") || message.toLowerCase().includes("cloudflare r2 não configurado")) return "O Cloudflare R2 ainda não está configurado no projeto. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME e R2_ENDPOINT na Vercel e tente novamente.";
    if (message.includes("LEGACY_VERCEL_BLOB_CHECKPOINT") || message.includes("Objeto R2 não permitido para este trabalho")) return "Este projeto ainda aponta para um checkpoint antigo do Vercel Blob. O CorvoQuiz vai descartar somente esse checkpoint de arquivos e reconstruí-lo no Cloudflare R2.";
    if (message.includes("R2_ENDPOINT_INVALID")) return `O R2_ENDPOINT está inválido. Use https://<ACCOUNT_ID>.r2.cloudflarestorage.com, sem /bucket no final.${r2Trail}`;
    if (message.includes("R2_DNS_FAILED")) return `O endpoint do Cloudflare R2 não resolveu por DNS. Confira R2_ENDPOINT e R2_ACCOUNT_ID.${r2Trail}`;
    if (message.includes("R2_BUCKET_NOT_FOUND")) return `O endpoint respondeu, mas o bucket configurado não foi encontrado. Confira R2_BUCKET_NAME.${r2Trail}`;
    if (message.includes("R2_ACCESS_KEY_INVALID")) return `O Cloudflare R2 recusou o R2_ACCESS_KEY_ID. Confira se você colocou o Access Key ID S3 do token R2.${r2Trail}`;
    if (message.includes("R2_SIGNATURE_FAILED")) return `A assinatura S3 foi recusada. Confira R2_SECRET_ACCESS_KEY, R2_ACCESS_KEY_ID e R2_ENDPOINT; as duas chaves precisam pertencer ao mesmo token R2.${r2Trail}`;
    if (message.includes("R2_ACCESS_DENIED")) return `O R2 respondeu, mas recusou a operação. O token precisa de Object Read & Write para o bucket configurado.${r2Trail}`;
    if (message.includes("R2_WRITE_FAILED")) return `O R2 respondeu e o bucket existe, mas o teste de escrita falhou.${r2Trail}`;
    if (message.includes("R2_READ_FAILED") || message.includes("R2_READ_MISMATCH")) return `O R2 gravou o probe, mas o teste de leitura falhou.${r2Trail}`;
    if (message.includes("R2_DELETE_FAILED")) return `O R2 leu e gravou corretamente, mas a limpeza do objeto de teste falhou.${r2Trail}`;
    if (message.includes("R2_CANDIDATE_RECOVERY_FAILED")) return `O R2 está online, mas algumas candidatas do checkpoint foram gravadas com a configuração antiga. O app tentará recuperá-las pela URL assinada e migrar o pacote.${r2Trail}`;
    if (message.includes("R2_LEGACY_SIGNED_URL_EXPIRED")) return `As URLs temporárias do checkpoint malformado expiraram. Esse lote específico precisará ser reempacotado pelo Collector, sem refazer roteiro/prompts.${r2Trail}`;
    if (message.includes("R2_PROBE_") || message.includes("R2_HEAD_BUCKET_FAILED") || message.includes("R2_CONNECTION_")) return `O teste real do Cloudflare R2 falhou antes do Collector: ${message}`;
    if (message.includes("TRATAMENTO_MANUAL_NECESSARIO")) return "Uma ou mais imagens chegaram ao limite de tentativas ou foram marcadas como não recuperáveis. O automático parou para tratamento manual.";
    return message || "Não foi possível concluir esta etapa.";
  }

  async function ensurePipelineStorageReady() {
    const response = await fetch("/api/corvo/diagnostico", { cache:"no-store" });
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status?.message || "Não foi possível verificar o armazenamento do pipeline.");
    if (!status?.configured) throw new Error("O Upstash Redis não está configurado para os jobs do Corvo.");
    if (!status?.storageConfigured) throw new Error("R2_NOT_CONFIGURED");
    if (status?.storageReachable === false) {
      const diagnostics = Array.isArray(status?.storageDiagnostics)
        ? status.storageDiagnostics.map((item:any) => `${String(item?.code || item?.step || "R2")}${item?.status ? `(${item.status})` : ""}`).join(" > ")
        : "";
      throw new Error([String(status?.storageCode || "R2_PROBE_FAILED"), String(status?.storageMessage || ""), diagnostics].filter(Boolean).join(" | "));
    }
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
          const liveThumbProject = latestProject(project.id) || project;
          await captureCorvoBridgeFile(jobId, expectedFile, "THUMBNAIL", 180000, {
            expectedFiles:[expectedFile],
            expectedIndex:0,
            compositeSplitMode:"AUTO",
            uploadToken:String(liveThumbProject.thumbUploadToken || ""),
            specialist:"THUMB"
          });
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
    const expectedAspect = thumbAspectRatioForFormat(project.format);
    const expectedOrientation = thumbOrientationForFormat(project.format);
    if (thumbMatchesProjectFormat(project) || thumbRuns.current.has(project.id)) return;
    if (project.thumbUrl || (project.format === "REELS" && project.thumbJobId && !project.thumbAspectRatio) || (project.thumbAspectRatio && project.thumbAspectRatio !== expectedAspect)) {
      updateThumb(project.id, {
        thumbJobId:undefined, thumbUploadToken:undefined, thumbStatus:`PREPARANDO THUMB ${expectedAspect}`, thumbUrl:undefined, thumbFileName:undefined, thumbError:undefined,
        finalZipStatus:undefined, finalZipError:undefined, finalZipGeneratedAt:undefined,
        thumbFormat:project.format, thumbAspectRatio:expectedAspect,
      });
      project = { ...project, thumbJobId:undefined, thumbUploadToken:undefined, thumbUrl:undefined, thumbFileName:undefined, thumbError:undefined, thumbFormat:project.format, thumbAspectRatio:expectedAspect };
    }
    thumbRuns.current.add(project.id);
    try {
      if (project.thumbJobId && project.thumbStatus !== "FALHOU") {
        updateThumb(project.id, { thumbStatus:"RETOMANDO THUMBNAIL", thumbError:undefined });
        await monitorThumbJob(project, project.thumbJobId);
        return;
      }
      if (project.thumbStatus === "FALHOU") updateThumb(project.id, { thumbJobId:undefined, thumbUploadToken:undefined, thumbStatus:"NOVA TENTATIVA", thumbError:undefined });
      const fileName = `thumb_${project.id.toLowerCase()}.png`;
      updateThumb(project.id, { thumbStatus:`PREPARANDO THUMBNAIL ${expectedAspect}`, thumbFileName:fileName, thumbError:undefined, thumbFormat:project.format, thumbAspectRatio:expectedAspect });
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
            `TIPO_DE_VIDEO=${project.format}`,
            `ORIENTACAO_THUMB=${expectedOrientation}`,
            `PROPORCAO_THUMB=${expectedAspect}`,
            `REGRA_DE_FORMATO=${project.format === "REELS" ? "A imagem final deve ser VERTICAL 9:16; não entregar composição horizontal 16:9." : "A imagem final deve ser HORIZONTAL 16:9; não entregar composição vertical 9:16."}`,
            `PADRAO_ARQUIVO_FINAL=${fileName}`,
            "",
            "ROTEIRO / CONTEXTO:",
            project.scriptText || "",
          ].join("\n"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.jobId || !result?.prompt || !result?.uploadToken) throw new Error(result?.message || "Não foi possível criar o trabalho da thumbnail.");
      updateThumb(project.id, { thumbJobId:result.jobId, thumbUploadToken:result.uploadToken, thumbStatus:"ENVIANDO AO CORVO THUMB" });
      await dispatchCorvoBridge({
        jobId:result.jobId,
        prompt:result.prompt,
        specialist:"THUMB",
        meta:{ projectId:project.id, uploadToken:result.uploadToken, expectedFile:fileName, format:project.format, aspectRatio:expectedAspect, forceNewConversation:true },
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

  async function startFlowImageProduction(projectArg?:Project, options:{automaticRun?:boolean;skipParallelBranches?:boolean} = {}) {
    let project = projectArg || active;
    if (!project?.promptText?.trim()) { setNotice("CRIE OS PROMPTS DE IMAGEM ANTES DE ABRIR O FLOW."); return false; }
    let items:GuideItem[] = [];
    try {
      items = flowGuideItemsForProject(project);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "PROMPTS_INVÁLIDOS");
      setImageOpen(true); setImagePhase("error");
      if (message.includes("PROMPTS_ASSETS_COUNT_MISMATCH")) {
        setImageMessage(`Os PROMPTS.TXT não correspondem aos assets físicos do roteiro. ${message.replace("PROMPTS_ASSETS_COUNT_MISMATCH:", "").trim()} Cada parágrafo precisa representar exatamente uma IMAGEM/IMAGEM_A/IMAGEM_B do roteiro, na mesma ordem.`);
      } else setImageMessage(message);
      return false;
    }
    if (!items.length) { setNotice("NENHUM PROMPT DE IMAGEM FOI IDENTIFICADO."); return false; }
    const withoutFile = items.filter((item) => !String(item.targetFile || "").trim());
    if (withoutFile.length) {
      setImageOpen(true); setImagePhase("error"); setImageMessage(`Faltam nomes de arquivo no roteiro/prompts para: ${withoutFile.map((item)=>item.id).join(", ")}.`);
      return false;
    }

    setImageOpen(true); setImagePhase("connecting"); setImageProgress(4); setImageStatusLine("INICIANDO / CONECTANDO AO MOTOR FLOW AUTOMÁTICO");
    setImageMessage("Preparando o motor Flow em segundo plano...");
    try {
      await ensurePipelineStorageReady();
      const health = await ensureFlowAgentReady();
      if (!health?.ok) throw new Error("FLOW_AGENT_NOT_INSTALLED_OR_UNAVAILABLE");
      if (!health.appIntegration) throw new Error("FLOW_MANAGER_APP_INTEGRATION_REQUIRED");

      project = latestProject(project.id) || project;
      let batchId = String(project.flowBatchId || "").trim();
      if (!batchId) {
        batchId = `${project.id}:APP_FLOW:${Date.now()}`;
        patchProject(project.id, { flowBatchId:batchId, flowStatus:"PREPARANDO", flowStartedAt:new Date().toISOString(), flowTotal:items.length, flowDone:0, flowFailed:0, pipelineItems:[] });
      }

      let state = await getFlowManagerState();
      let batch = state.batches.find((candidate) => candidate.batchId === batchId && candidate.projectId === project!.id);
      if (!batch) {
        await addFlowBatch(flowBatchText(project, batchId, items), `${project.id}_FLOW_APP.txt`);
        state = await getFlowManagerState();
        batch = state.batches.find((candidate) => candidate.batchId === batchId && candidate.projectId === project!.id);
      }
      if (!batch) throw new Error("O Manager recebeu o lote, mas ele não apareceu no estado local.");
      if (!state.control?.running && batch.status !== "COMPLETE") await startFlowManager();

      setImagePhase("searching"); setImageMessage("Flow produzindo as imagens automaticamente...");
      patchProject(project.id, { flowStatus:"EM PRODUÇÃO", flowBatchId:batchId, flowTotal:items.length });
      if (options.automaticRun) updateAutoRun(project.id, "FLOW", `Flow iniciado com ${items.length} JOB(s). O app receberá cada imagem sem baixar na pasta Downloads.`);

      const guideById = new Map(items.map((item) => [String(item.id).toUpperCase(), item]));
      const started = Date.now();
      while (true) {
        state = await getFlowManagerState();
        batch = state.batches.find((candidate) => candidate.batchId === batchId && candidate.projectId === project!.id);
        if (!batch) throw new Error("O lote desapareceu do Manager local.");
        const done = Number(batch.done || 0); const failed = Number(batch.failed || 0); const total = Number(batch.total || items.length);
        const progress = total ? Math.min(92, 8 + Math.round(((done + failed) / total) * 80)) : 8;
        setImageProgress(progress); setImageStatusLine(`FLOW · ${done}/${total} PRONTAS · ${failed} FALHA(S) · ${Math.max(0,total-done-failed)} EM FILA/EXECUÇÃO`);
        patchProject(project.id, { flowStatus:batch.status === "COMPLETE" ? "RECEBENDO ASSETS" : "EM PRODUÇÃO", flowTotal:total, flowDone:done, flowFailed:failed });

        const current = latestProject(project.id) || project;
        const existing = new Map((current.pipelineItems || []).filter((item) => item.outputUrl).map((item) => [String(item.id).toUpperCase(), item]));
        for (const job of batch.jobs || []) {
          const key = String(job.id || "").toUpperCase();
          if (existing.has(key) || job.managerStatus !== "DONE" || !job.appAssetReady) continue;
          setImagePhase("packaging"); setImageMessage(`Recebendo ${job.id} do Flow e guardando no projeto...`); setImageStatusLine(`FLOW → APP · SALVANDO ${job.id}`);
          const blob = await fetchFlowAsset(batchId, job.jobId);
          const guide = guideById.get(key);
          const finalFile = String(guide?.targetFile || job.arquivoFinal || job.appAssetFile || `${job.id}.png`).replace(/^.*[\\/]/, "");
          const form = new FormData();
          form.set("projectId", project.id); form.set("batchId", batchId); form.set("id", String(job.id)); form.set("fileName", finalFile);
          form.set("file", new File([blob], finalFile, { type:blob.type || job.appAssetContentType || "application/octet-stream" }));
          const upload = await fetch("/api/corvo/flow-asset", { method:"POST", body:form });
          const saved = await upload.json().catch(() => ({}));
          if (!upload.ok || !saved?.url) throw new Error(saved?.message || `Falha ao guardar o asset ${job.id} no projeto.`);
          const slotInfo = comparisonSlotForItem(project, String(job.id));
          const nextItem:PipelineItem = {
            id:String(job.id), route:"FLOW", sourceFile:"", selectedFile:undefined, sourceUrl:undefined,
            sceneId:slotInfo?.sceneId || guide?.sceneId || normalizeSceneId(String(job.id).replace(/[_-][AB]$/i,"")),
            slot:(slotInfo?.slot || guide?.slot || "SINGLE") as "A"|"B"|"SINGLE",
            formaField:slotInfo?.formaField || guide?.formaField, preset:slotInfo?.preset,
            generationPrompt:guide?.query, finalFile, outputFile:finalFile, outputUrl:String(saved.url), status:"CONCLUÍDO", tentativaAtual:1,
            logicalJobId:job.jobId, batchId,
            history:[{ at:new Date().toISOString(), attempt:1, specialist:"FLOW", status:"DONE", jobId:job.jobId, batchId }],
          };
          const latest = latestProject(project.id) || project;
          const merged = [...(latest.pipelineItems || []).filter((item) => String(item.id).toUpperCase() !== key), nextItem]
            .sort((a,b) => String(a.id).localeCompare(String(b.id), "pt-BR", {numeric:true}));
          patchProject(project.id, { pipelineItems:merged, pipelineStatus:`FLOW · ${merged.filter((item)=>item.outputUrl).length}/${total} IMAGENS RECEBIDAS`, imageCount:merged.length, packageCode:`FLOW-${batchId.split(":").pop()}` });
          existing.set(key,nextItem);
          setImagePhase("searching");
        }

        const latest = latestProject(project.id) || project;
        const completeCount = (latest.pipelineItems || []).filter((item) => item.outputUrl).length;
        if (batch.status === "COMPLETE") {
          if (failed > 0) {
            const failedIds = (batch.jobs || []).filter((job) => ["FAILED","MANUAL_REVIEW"].includes(String(job.managerStatus))).map((job)=>job.id);
            throw new Error(`FLOW concluiu com ${failed} falha(s): ${failedIds.join(", ")}.`);
          }
          if (completeCount >= total) {
            const completedAt = new Date().toISOString();
            const flowResult = await getFlowBatchManifest(batchId).catch(() => null);
            patchProject(project.id, { flowStatus:"CONCLUÍDO", flowCompletedAt:completedAt, flowDone:total, flowFailed:0, flowManifest:flowResult?.manifest || undefined, pipelineStatus:"IMAGENS FINAIS PRONTAS", imageCount:total, stage:5 });
            setPackageCode(`FLOW-${batchId.split(":").pop()}`); setImageProgress(100); setImagePhase("done"); setImageMessage(`${total} imagens produzidas no Flow e preservadas no projeto.`); setImageStatusLine("FLOW CONCLUÍDO · ASSETS NO APP · NENHUM DOWNLOAD INDIVIDUAL");
            if (options.automaticRun) updateAutoRun(project.id, "IMAGENS", `${total} imagens recebidas do Flow. Preparando consolidação final...`);
            return true;
          }
        }
        if (Date.now() - started > 45 * 60 * 1000) throw new Error("Tempo máximo de acompanhamento do Flow excedido. O lote permanece preservado no Manager e pode ser retomado.");
        await wait(1200);
      }
    } catch (error) {
      const message = friendlyError(error);
      patchProject(project.id, { flowStatus:"ERRO", pipelineStatus:"ERRO NO FLOW" });
      setImagePhase("error"); setImageMessage(message); setImageStatusLine("O LOTE E OS ASSETS JÁ GERADOS FICAM PRESERVADOS PARA RETOMADA.");
      return false;
    }
  }

  async function ensureEmbeddedFormaReady() {
    const frame = formaFrameRef.current;
    if (!frame) throw new Error("FORMA_BRIDGE_NOT_MOUNTED");
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try {
        const bridge = (frame.contentWindow as any)?.CorvoForma;
        if (bridge?.version === "corvo-forma/1.0" && typeof bridge.runBatch === "function") return bridge as {
          version:string;
          getStatus:() => { ready:boolean; busy:boolean; stage:string; message:string };
          runBatch:(input:{ projectId?:string; scriptText:string; images?:Array<{name:string;bytes:ArrayBuffer}>; zipBytes?:ArrayBuffer|Uint8Array; format:"portrait"|"landscape"|"square"; autoExport:boolean }) => Promise<{ ok:true; questionCount:number; sceneCount:number; artifactName?:string; artifactSize?:number; duration?:number; blob?:Blob }>;
        };
      } catch (_) {}
      await wait(250);
    }
    throw new Error("FORMA_BRIDGE_NOT_READY");
  }

  async function collectFormaInputAssets(project:Project) {
    const summary = consolidationState(project);
    if (!summary.ready) {
      if (summary.missingIds.length) throw new Error(`FORMA_INPUT_INCOMPLETO: faltam os IDs ${summary.missingIds.join(", ")}.`);
      if (summary.missingFormaSlots.length) throw new Error(`FORMA_INPUT_INCOMPLETO: faltam os slots ${summary.missingFormaSlots.join(", ")}.`);
      if (summary.missingScriptFiles.length) throw new Error(`FORMA_INPUT_INCOMPLETO: o roteiro referencia arquivos ausentes: ${summary.missingScriptFiles.slice(0,8).join(", ")}.`);
      throw new Error("FORMA_INPUT_INCOMPLETO");
    }
    const images:Array<{name:string;bytes:ArrayBuffer}> = [];
    let totalBytes = 0;
    for (let index = 0; index < summary.items.length; index += 1) {
      const item = summary.items[index];
      const name = String(item.finalFile || item.outputFile || "").replace(/^.*[\\/]/, "");
      if (!name) throw new Error(`FORMA_ARQUIVO_SEM_NOME: ${item.id}`);
      const response = await fetch(String(item.outputUrl), { cache:"no-store" });
      if (!response.ok) throw new Error(`FORMA_ASSET_HTTP_${response.status}: ${name}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error(`FORMA_ASSET_VAZIO: ${name}`);
      const bytes = await blob.arrayBuffer();
      totalBytes += bytes.byteLength;
      if (totalBytes > 120 * 1024 * 1024) throw new Error("FORMA_ASSETS_ACIMA_DE_120MB");
      images.push({ name, bytes });
      setImageProgress(Math.min(96, 92 + Math.round(((index + 1) / Math.max(1, summary.items.length)) * 4)));
      setImageStatusLine(`FORMA · PREPARANDO ASSETS ${index + 1}/${summary.items.length}`);
    }
    return images;
  }

  async function buildFormaInMemoryZip(images:Array<{name:string;bytes:ArrayBuffer}>) {
    const zip = new JSZip();
    for (const image of images) zip.file(image.name, image.bytes, { binary:true });
    return zip.generateAsync({ type:"uint8array", compression:"STORE" });
  }

  function downloadFinalVideoBlob(blob:Blob, fileName:string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function runFormaProduction(projectArg?:Project, options:{ automaticRun?:boolean; force?:boolean } = {}) {
    let project = projectArg || active;
    if (!project) return false;
    project = latestProject(project.id) || project;
    if (!project.scriptText?.trim()) throw new Error("FORMA_ROTEIRO_AUSENTE");
    if (project.formaStatus === "CONCLUÍDO" && options.automaticRun && !options.force) return true;
    if (formaRunLocks.current.has(project.id)) return false;
    formaRunLocks.current.add(project.id);
    const startedAt = new Date().toISOString();
    patchProject(project.id, { formaStatus:"PREPARANDO", formaStartedAt:startedAt, formaCompletedAt:undefined, formaError:undefined });
    setImageOpen(true); setImagePhase("packaging"); setImageProgress(92);
    setImageMessage("Imagens prontas. Entregando o roteiro e os assets diretamente ao Forma…");
    setImageStatusLine("FLOW → FORMA · PREPARANDO MÓDULO LOTE");
    if (options.automaticRun) updateAutoRun(project.id, "FORMA", "Flow concluído. Enviando ROTEIRO.TXT + imagens diretamente ao módulo Lote do Forma…");

    let statusTimer:number | null = null;
    try {
      const images = await collectFormaInputAssets(latestProject(project.id) || project);
      const bridge = await ensureEmbeddedFormaReady();
      patchProject(project.id, { formaStatus:"MONTANDO LOTE" });
      setImageProgress(97); setImageMessage("Forma validando nomes, perguntas, presets e imagens…"); setImageStatusLine("FORMA · IMPORTAR LOTE AUTOMÁTICO");

      statusTimer = window.setInterval(() => {
        try {
          const status = bridge.getStatus();
          if (!status) return;
          patchProject(project!.id, { formaStatus:status.stage || "PROCESSANDO" });
          setImageMessage(status.message || "Forma processando o lote…");
          setImageStatusLine(`FORMA · ${String(status.stage || "PROCESSANDO").replaceAll("_", " ")}`);
          if (options.automaticRun) updateAutoRun(project!.id, "FORMA", status.message || "Forma montando e exportando o vídeo…");
        } catch (_) {}
      }, 1000);

      const formaInput = {
        projectId:project.id,
        scriptText:project.scriptText,
        format:(project.format === "REELS" ? "portrait" : "landscape") as "portrait" | "landscape",
        autoExport:true,
      };
      let result: Awaited<ReturnType<typeof bridge.runBatch>>;
      try {
        result = await bridge.runBatch({ ...formaInput, images });
      } catch (directError) {
        const directMessage = String(directError instanceof Error ? directError.message : directError || "");
        if (!/FORMA_LOTE_INVALIDO|FORMA_ASSETS_AUSENTES/i.test(directMessage)) throw directError;
        patchProject(project.id, { formaStatus:"FALLBACK ZIP EM MEMÓRIA" });
        setImageMessage("O transporte direto foi recusado. Refazendo a mesma entrada pelo ZIP original do módulo Lote, sem download intermediário…");
        setImageStatusLine("FORMA · FALLBACK ZIP EM MEMÓRIA");
        if (options.automaticRun) updateAutoRun(project.id, "FORMA", "Forma validando novamente pelo contrato TXT + ZIP original do módulo Lote…");
        const zipBytes = await buildFormaInMemoryZip(images);
        result = await bridge.runBatch({ ...formaInput, zipBytes });
      }
      if (!result?.ok || !result.blob || typeof (result.blob as any).arrayBuffer !== "function" || !Number((result.blob as any).size)) throw new Error("FORMA_MP4_VAZIO");
      const finalName = `${project.id}_VIDEO_FINAL.mp4`;
      downloadFinalVideoBlob(result.blob, finalName);
      const completedAt = new Date().toISOString();
      patchProject(project.id, {
        formaStatus:"CONCLUÍDO", formaCompletedAt:completedAt, formaError:undefined,
        formaSceneCount:Number(result.sceneCount || 0), formaQuestionCount:Number(result.questionCount || 0),
        formaVideoName:finalName, formaVideoSize:Number((result.blob as any).size || 0), formaVideoDuration:Number(result.duration || 0), stage:5,
      });
      setImageProgress(100); setImagePhase("done");
      setImageMessage(`Vídeo final pronto. O download automático foi iniciado: ${finalName}`);
      setImageStatusLine("FORMA CONCLUÍDO · MP4 FINAL ENTREGUE");
      if (options.automaticRun) updateAutoRun(project.id, "FORMA", `Forma concluiu ${result.sceneCount || 0} cenas. MP4 final entregue automaticamente.`);
      return true;
    } catch (error) {
      const message = friendlyError(error);
      patchProject(project.id, { formaStatus:"FALHOU", formaError:message });
      setImagePhase("error"); setImageMessage(message); setImageStatusLine("FORMA · FALHA PRESERVADA PARA RETOMADA");
      if (options.automaticRun) throw error;
      setNotice(`FORMA: ${message}`); setTimeout(() => setNotice(""), 6000);
      return false;
    } finally {
      if (statusTimer !== null) window.clearInterval(statusTimer);
      formaRunLocks.current.delete(project.id);
    }
  }

  async function cancelFlowProduction() {
    await stopFlowManager().catch(() => {});
    if (active) patchProject(active.id, { flowStatus:"PAUSADO" });
    setImageOpen(false);
  }

  async function startImageFlow(projectArg?:Project, options:{automaticRun?:boolean;skipParallelBranches?:boolean;selectionMode?:SelectionMode} = {}) {
    let project = projectArg || active;
    if (!project) return false;
    if (hasLegacyAnalysisStorage(project)) {
      const wasAutomatic = project.autoRunStatus === "RUNNING" || options.automaticRun === true;
      patchProject(project.id, {
        ...EMPTY_IMAGE_PIPELINE,
        autoRunStatus:wasAutomatic ? "RUNNING" : project.autoRunStatus,
        autoRunStep:wasAutomatic ? "COLLECTOR" : project.autoRunStep,
        autoRunMessage:wasAutomatic ? "Checkpoint antigo do Vercel Blob detectado. Reconstruindo o pacote no Cloudflare R2 sem reutilizar o arquivo legado." : project.autoRunMessage,
        autoRunError:undefined,
        pipelineStatus:"MIGRANDO CHECKPOINT PARA R2",
      });
      project = { ...project, ...EMPTY_IMAGE_PIPELINE, pipelineStatus:"MIGRANDO CHECKPOINT PARA R2" };
      setImageOpen(true);
      setImagePhase("connecting"); setImageProgress(3);
      setImageMessage("Checkpoint antigo do Vercel Blob detectado. Recuperando o resultado do Collector para gravar um novo pacote no R2...");
      setImageStatusLine("MIGRAÇÃO DE STORAGE · VERCEL BLOB → CLOUDFLARE R2");
    }
    if (hasPipelineRoutingCheckpoint(project)) {
      runToken.current = Math.max(1, runToken.current);
      setImageOpen(true); setImagePhase("searching"); setImageProgress(90);
      setImageMessage("Pipeline de imagens já existe. Retomando os lotes salvos sem voltar ao Collector...");
      setImageStatusLine("CHECKPOINT DO PIPELINE · RETOMADA SEM NOVA COLETA");
      return await runRoutedPipeline(project, project.pipelineItems || []);
    }
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
      const guideText = settings.batchText.trim() ? settings.batchText : project.promptText?.trim() ? project.promptText : "";
      const items = guideItemsForProject(project, guideText);
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
        ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => {
            if (item.id !== itemId) return item;
            const lockedFile = String(item.selectedFile || item.sourceFile || "").trim();
            const requestedFile = String(patch.sourceFile || "").trim();
            if (lockedFile && requestedFile && requestedFile.toLowerCase() !== lockedFile.toLowerCase()) {
              return {
                ...item,
                status:"SELECTED_FILE_MISMATCH",
                errorCode:"SELECTED_FILE_MISMATCH",
                error:`Arquivo imutável do Analista: ${lockedFile}. O pipeline tentou trocar para ${requestedFile}.`,
                finalFailure:true,
              };
            }
            const merged = { ...item, ...patch };
            if (lockedFile) {
              merged.selectedFile = lockedFile;
              merged.sourceFile = lockedFile;
            }
            return merged;
          }) }
        : project);
      projectsRef.current = next;
      persistProjectsSnapshot(next);
      return next;
    });
  }

  function appendPipelineHistory(projectId:string, itemId:string, event:PipelineHistoryEvent) {
    setProjects((current) => {
      const next = current.map((project) => project.id === projectId
        ? { ...project, pipelineItems:(project.pipelineItems || []).map((item) => item.id === itemId ? { ...item, history:[...(item.history || []), event] } : item) }
        : project);
      projectsRef.current = next;
      persistProjectsSnapshot(next);
      return next;
    });
  }

  function chunkPipelineItems<T>(items:T[], size = PIPELINE_BATCH_SIZE) {
    const chunks:T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function retryAwareChunks(items:PipelineItem[]) {
    const groups = new Map<string,PipelineItem[]>();
    for (const item of items) {
      const key = `${String(item.routeConversationUrl || "__NEW__")}|A${Math.max(1, Number(item.tentativaAtual || 1))}|P:${item.preset || "SINGLE"}`;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    return [...groups.values()].flatMap((group) => chunkPipelineItems(group));
  }

  async function runPool<T>(tasks:Array<()=>Promise<T>>, concurrency:number) {
    const results:T[] = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        results[index] = await tasks[index]();
      }
    };
    await Promise.all(Array.from({ length:Math.min(Math.max(1, concurrency), Math.max(1, tasks.length)) }, () => worker()));
    return results;
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

  async function pollPipelineBatchJob(jobId:string, projectId:string, itemIds:string[], captureType?:"REFINED_IMAGE"|"GENERATED_IMAGE") {
    const captureAttempts = new Map<string,number>();
    while (runToken.current > 0) {
      await wait(2500);
      const response = await fetch(`/api/corvo/resultado?jobId=${encodeURIComponent(jobId)}`, { cache:"no-store" });
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(status?.message || "Não foi possível acompanhar o trabalho em lote."), { corvoStatus:status });
      for (const itemId of itemIds) updatePipelineItem(projectId, itemId, { status:status.status || "PROCESSANDO" });
      if (status.status === "WAITING_FILE" && captureType) {
        let expectedFiles = Array.isArray(status.expectedFiles) && status.expectedFiles.length ? status.expectedFiles : [status.expectedFile].filter(Boolean);
        const liveBeforeCapture = latestProject(projectId);
        const orderedBatchItems = itemIds.map((id) => (liveBeforeCapture?.pipelineItems || []).find((item) => String(item.id) === String(id))).filter(Boolean) as PipelineItem[];
        const comparisonBatchOrdered = orderedBatchItems.length === itemIds.length && orderedBatchItems.length > 1 && orderedBatchItems.every((item) => item.preset === "QUAL_VOCE_PREFERE" && (item.slot === "A" || item.slot === "B"));
        if (comparisonBatchOrdered) {
          const serverSet = new Set(expectedFiles.map((file:any) => String(file || "").toLowerCase()));
          const orderedFiles = orderedBatchItems.map((item) => String(item.finalFile || item.outputFile || "")).filter(Boolean);
          if (orderedFiles.length === expectedFiles.length && orderedFiles.every((file) => serverSet.has(file.toLowerCase()))) expectedFiles = orderedFiles;
        }
        for (let expectedIndex = 0; expectedIndex < expectedFiles.length; expectedIndex += 1) {
          const expectedFileRaw = expectedFiles[expectedIndex];
          const expectedFile = String(expectedFileRaw || "");
          if (!expectedFile) continue;
          if (Array.isArray(status.files) && status.files.some((file:any) => String(file?.name || "").toLowerCase() === expectedFile.toLowerCase())) continue;
          const attempts = (captureAttempts.get(expectedFile) || 0) + 1;
          captureAttempts.set(expectedFile, attempts);
          for (const itemId of itemIds) updatePipelineItem(projectId, itemId, { status:`CAPTURANDO_LOTE_${captureType === "REFINED_IMAGE" ? "REFINADOR" : "GERADOR"}` });
          const officialFiles = expectedFiles.map((value:any) => String(value || "")).filter(Boolean);
          const liveCaptureProject = latestProject(projectId);
          const batchItems = (liveCaptureProject?.pipelineItems || []).filter((item) => officialFiles.some((file:string) => file.toLowerCase() === String(item.finalFile || item.outputFile || "").toLowerCase()));
          const comparisonGrid = officialFiles.length > 1 && batchItems.length === officialFiles.length && batchItems.every((item) => item.preset === "QUAL_VOCE_PREFERE" && (item.slot === "A" || item.slot === "B"));
          const captureToken = String(batchItems[0]?.jobUploadToken || orderedBatchItems[0]?.jobUploadToken || "");
          const captureConversationUrl = String(batchItems[0]?.routeConversationUrl || orderedBatchItems[0]?.routeConversationUrl || "");
          const captureSpecialist = captureType === "REFINED_IMAGE" ? "REFINADOR" : "GERADOR";
          try {
            await captureCorvoBridgeFile(jobId, expectedFile, captureType, 180000, {
              expectedFiles:officialFiles,
              expectedIndex,
              compositeSplitMode:comparisonGrid ? "GRID" : "ROWS",
              compositeColumns:undefined,
              uploadToken:captureToken,
              conversationUrl:captureConversationUrl,
              specialist:captureSpecialist,
            });
          }
          catch (error) {
            const captureMessage = bridgeErrorMessage(error);
            if (attempts >= 3) {
              throw Object.assign(error instanceof Error ? error : new Error(String(error)), { corvoStatus:status });
            }
            await wait(5000);
          }
        }
        continue;
      }
      if (status.status === "DONE" || status.status === "ERROR") {
        const completion = await completeCorvoBridgeJob(jobId).catch(() => null);
        return { ...status, bridgeConversationUrl:String(completion?.conversationUrl || "") };
      }
    }
    throw new Error("PIPELINE_INTERRUPTED");
  }

  async function pollPipelineJob(jobId:string, projectId:string, itemId?:string, captureType?:"REFINED_IMAGE"|"GENERATED_IMAGE") {
    const status = await pollPipelineBatchJob(jobId, projectId, itemId ? [itemId] : [], captureType);
    if (status.status === "ERROR") {
      const failure = new Error(status.error || status.manifest?.reason || status.manifest?.errorCode || "O especialista informou uma falha.");
      throw Object.assign(failure, { corvoStatus:status });
    }
    return status;
  }

  function buildRoutedBatchEntry(project:Project, item:PipelineItem) {
    const isRefiner = item.route === "REFINADOR";
    const lockedSource = String(item.selectedFile || item.sourceFile || "").trim();
    if (isRefiner && item.selectedFile && item.sourceFile && item.selectedFile.toLowerCase() !== item.sourceFile.toLowerCase()) {
      throw new Error(`SELECTED_FILE_MISMATCH:${item.id}:${item.selectedFile}:${item.sourceFile}`);
    }
    const baseRefinerInstruction = [
      "OBJETIVO_FINAL:",
      "- preservar integralmente a identidade e o conteúdo principal da candidata escolhida pelo Analista;",
      "- melhorar nitidez, definição, contraste e iluminação sem substituir o elemento principal;",
      item.refinement === "FORTE" ? "- pode reenquadrar cuidadosamente para 16:9 quando necessário;" : "- aplicar somente melhoria técnica leve, sem recriar a composição;",
      "- não adicionar títulos, legendas, logos ou marca-d'água;",
      `- ARQUIVO_IMUTAVEL=${lockedSource || "N/A"}; não trocar por outra candidata.`,
    ].join("\n");
    const slotMetadata = item.preset === "QUAL_VOCE_PREFERE" ? [
      `CENA_BASE=${item.sceneId || item.id}`,
      `PRESET_FORMA=QUAL_VOCE_PREFERE`,
      `SLOT_COMPARACAO=${item.slot || ""}`,
      `CAMPO_FORMA=${item.formaField || ""}`,
      `REGRA_SLOT=Este ID representa UM SLOT físico da comparação. Produza somente ${item.formaField || item.slot || "este slot"}; NÃO mostre nem componha a opção oposta no mesmo asset.`,
    ] : [];
    return isRefiner
      ? [
          `[ID:${item.id}]`,
          ...slotMetadata,
          `ARQUIVO_ORIGINAL=${lockedSource}`,
          `ARQUIVO_SELECIONADO_IMUTAVEL=${lockedSource}`,
          `STATUS_ORIGEM=${item.refinement === "FORTE" ? "PASSOU_COM_RESSALVAS" : "PASSOU"}`,
          `REFINAMENTO=${item.refinement || "LEVE"}`,
          `MOTIVO=${item.reason || "Imagem aprovada pelo Analista."}`,
          item.retryPrompt ? `INSTRUCAO_RETRY=${item.retryPrompt}` : baseRefinerInstruction,
          `PADRAO_ARQUIVO_FINAL=${item.finalFile}`,
        ].join("\n")
      : [
          `[ID:${item.id}]`,
          ...slotMetadata,
          `PROMPT_GERACAO=${item.retryPrompt || item.generationPrompt || "Gerar uma imagem clara e reconhecível para o quiz, sem texto e sem marca-d'água."}`,
          `CONTEXTO=${project.topic}. Imagem final para o CorvoQuiz.`,
          `IDENTIDADE_ESPERADA=${item.reason || project.topic}`,
          `PADRAO_ARQUIVO_FINAL=${item.finalFile}`,
        ].join("\n");
  }

  function isTechnicalPipelineFailure(errorCode?:string, reason?:string) {
    const text = `${errorCode || ""} ${reason || ""}`.toUpperCase();
    return /(CORVO_BRIDGE|BRIDGE_BUSY|PROGRESS_TIMEOUT|HARD_TIMEOUT|ATTACHMENT_|GPT_SEND|COMPOSER_|SEND_CONTROL|SEND_BUTTON|CHATGPT_RATE_LIMITED|RATE_LIMITED|NETWORK|FETCH FAILED|TAB_CREATE|CONTENT_SCRIPT|FILE_CAPTURE|CAPTURE_BRIDGE|CAPTURE_SLICE|GENERATED_IMAGE_CAPTURE_TIMEOUT|MESSAGE CHANNEL CLOSED|LISTENER INDICATED AN ASYNCHRONOUS RESPONSE|RECEIVING END DOES NOT EXIST|EXTENSION CONTEXT INVALIDATED)/.test(text);
  }

  async function dispatchPipelineJobResilient(payload:{jobId:string;prompt:string;specialist:string;meta:Record<string,unknown>}, projectId:string, itemIds:string[]) {
    let lastError:unknown = null;
    for (let dispatchAttempt = 0; dispatchAttempt < 3; dispatchAttempt++) {
      try {
        return await dispatchCorvoBridge({
          ...payload,
          meta:{ ...payload.meta, forceNewConversation:dispatchAttempt === 0 ? payload.meta.forceNewConversation !== false : false },
        });
      } catch (error) {
        lastError = error;
        const message = bridgeErrorMessage(error);
        if (!isTechnicalPipelineFailure("", message) || dispatchAttempt >= 2) throw error;
        const rateLimited = /RATE_LIMIT/i.test(message);
        const delay = rateLimited ? (dispatchAttempt === 0 ? 180_000 : 300_000) : (dispatchAttempt === 0 ? 15_000 : 35_000);
        const resumeAt = new Date(Date.now() + delay).toISOString();
        for (const itemId of itemIds) updatePipelineItem(projectId, itemId, { status:rateLimited ? "PAUSADO_RATE_LIMIT" : "RETRY_TECNICO_MESMO_JOB", error:message, errorCode:rateLimited ? "CHATGPT_RATE_LIMITED" : "BRIDGE_TRANSIENT" });
        setImageStatusLine(rateLimited
          ? `LIMITE TEMPORÁRIO DO CHATGPT · LOTE PAUSADO · RETOMA ${analysisRetryLabel(resumeAt)}`
          : `FALHA TÉCNICA TRANSITÓRIA · MESMO JOB/CONVERSA · ${analysisRetryLabel(resumeAt)}`);
        await wait(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || "CORVO_BRIDGE_ERROR"));
  }

  function batchFailure(error:unknown, status:any, item:PipelineItem) {
    const manifestItem = Array.isArray(status?.manifest?.items)
      ? status.manifest.items.find((candidate:any) => String(candidate?.id || "") === String(item.id))
      : undefined;
    const rawError = String(error instanceof Error ? error.message : error || "");
    const inferredErrorCode = rawError.startsWith("SELECTED_FILE_MISMATCH")
      ? "SELECTED_FILE_MISMATCH"
      : rawError.startsWith("BATCH_COMPOSITE_IMAGE_DETECTED")
        ? "BATCH_COMPOSITE_IMAGE"
        : "TOOL_ERROR";
    const errorCode = String(manifestItem?.errorCode || status?.manifest?.errorCode || inferredErrorCode).toUpperCase();
    const reason = String(manifestItem?.reason || status?.manifest?.reason || rawError || "Falha sem motivo informado.");
    return { errorCode, reason, technical:isTechnicalPipelineFailure(errorCode, reason) };

  }

  function resolveRoutedBatchStatus(project:Project, batch:PipelineItem[], jobId:string, batchId:string, attempt:number, status:any, preferredConversationUrl = "") {
    const route = batch[0]?.route;
    const routeConversationUrl = String(status?.bridgeConversationUrl || preferredConversationUrl || "");
    const manifestItems = Array.isArray(status?.manifest?.items) ? status.manifest.items : [];
    const successes:PipelineItem[] = [];
    const failures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> = [];
    for (const item of batch) {
      const manifestItem = manifestItems.find((candidate:any) => String(candidate?.id || "") === String(item.id));
      const successStatus = route === "REFINADOR" ? "REFINADA" : "GERADA";
      const itemStatus = String(manifestItem?.status || "").toUpperCase();
      const outputName = String(manifestItem?.file || item.finalFile || "").trim();
      const file = Array.isArray(status?.files)
        ? status.files.find((candidate:any) => String(candidate?.name || "").toLowerCase() === outputName.toLowerCase())
        : null;
      if (itemStatus === successStatus && file?.url) {
        const output = { ...item, jobId, status:"CONCLUIDO", outputUrl:file.url, outputFile:file.name, error:undefined, errorCode:undefined, finalFailure:false, batchId, routeConversationUrl } as PipelineItem;
        updatePipelineItem(project.id, item.id, output);
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:route, status:"CONCLUIDO", jobId, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        successes.push(output);
      } else {
        const failure = batchFailure(new Error(itemStatus === successStatus ? `${route} concluiu o ID ${item.id} sem arquivo real.` : `Falha no ${route} para ID ${item.id}.`), status, item);
        const failedItem = { ...item, jobId, status:"FALHOU", error:failure.reason, errorCode:failure.errorCode, batchId, routeConversationUrl } as PipelineItem;
        updatePipelineItem(project.id, item.id, failedItem);
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:route, status:"FALHOU", jobId, errorCode:failure.errorCode, reason:failure.reason, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        failures.push({ item:failedItem, ...failure });
      }
    }
    return { successes, failures };
  }

  function latestPipelineHistory(item:PipelineItem, specialist:"REFINADOR"|"GERADOR"|"FALLBACK") {
    return [...(item.history || [])].reverse().find((event) => event.specialist === specialist);
  }

  function hasPipelineRoutingCheckpoint(project:Project | undefined | null) {
    return Boolean(
      project?.analysisStatus === "CONCLUÍDA"
      && project?.pipelineItems?.length
      && project.pipelineStatus !== "IMAGENS FINAIS PRONTAS"
    );
  }

  async function resumeExistingRoutedBatch(project:Project, batch:PipelineItem[]) {
    const jobId = String(batch[0]?.jobId || "");
    const route = batch[0]?.route;
    const batchId = String(batch[0]?.batchId || `${project.id}:${route}:RECOVERED`);
    const attempt = Math.max(1, ...batch.map((item) => Number(item.tentativaAtual || 1)));
    if (!jobId || !route) return null;
    try {
      const activity = await getCorvoBridgeJobActivity().catch(() => ({ jobs:[] as CorvoBridgeJobActivity[] }));
      const bridgeJob = (activity.jobs || []).find((entry) => String(entry.jobId || "") === jobId);
      const bridgeState = String(bridgeJob?.state || "").toUpperCase();
      const committed = /WAITING_ACTION|USER_MESSAGE_COMMITTED|MESSAGE_CONFIRMED/.test(bridgeState);
      const prompt = String(batch[0]?.jobPrompt || "");
      const uploadToken = String(batch[0]?.jobUploadToken || "");

      if (!committed && prompt && uploadToken) {
        const attachments = route === "REFINADOR"
          ? batch.map((item) => ({
              url:String(item.sourceUrl || ""),
              name:String(item.selectedFile || item.sourceFile || `entrada_${item.id}.jpg`),
              contentType:"image/jpeg",
              sourceJobId:String(project.analysisJobId || ""),
              sourceUploadToken:String(project.analysisUploadToken || ""),
            })).filter((item) => item.url)
          : [];
        if (route === "REFINADOR" && attachments.length !== batch.length) throw new Error("REFINER_BATCH_SOURCE_MISSING");
        for (const item of batch) updatePipelineItem(project.id, item.id, { status:"RETOMANDO_ENVIO_PERSISTIDO" });
        await dispatchPipelineJobResilient({
          jobId, prompt, specialist:route,
          meta:{
            projectId:project.id, uploadToken, appOrigin:window.location.origin, attachments,
            batchId, batchSize:batch.length, logicalBatch:true,
            preferredConversationUrl:String(batch[0]?.routeConversationUrl || bridgeJob?.conversationUrl || ""),
            forceNewConversation:false,
          },
        }, project.id, batch.map((item) => item.id));
      }

      for (const item of batch) updatePipelineItem(project.id, item.id, { status:"RETOMANDO_JOB_EXISTENTE" });
      const status = await pollPipelineBatchJob(jobId, project.id, batch.map((item) => item.id), route === "REFINADOR" ? "REFINED_IMAGE" : "GENERATED_IMAGE");
      return resolveRoutedBatchStatus(project, batch, jobId, batchId, attempt, status, String(batch[0]?.routeConversationUrl || bridgeJob?.conversationUrl || ""));
    } catch (error) {
      const status = (error as any)?.corvoStatus;
      const failures = batch.map((item) => {
        const failure = batchFailure(error, status, item);
        const failedItem = { ...item, status:"FALHOU", error:failure.reason, errorCode:failure.errorCode, batchId } as PipelineItem;
        updatePipelineItem(project.id, item.id, failedItem);
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:route, status:"FALHOU", jobId, errorCode:failure.errorCode, reason:failure.reason, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        return { item:failedItem, ...failure };
      });
      await completeCorvoBridgeJob(jobId).catch(() => {});
      return { successes:[] as PipelineItem[], failures };
    }
  }

  async function resumeExistingFallbackBatch(project:Project, failures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}>) {
    const jobId = String(failures[0]?.item.fallbackJobId || "");
    const batchId = String(failures[0]?.item.batchId || `${project.id}:FB:RECOVERED`);
    const attempt = Math.max(1, ...failures.map((failure) => Number(failure.item.tentativaAtual || 1)));
    if (!jobId) return null;
    try {
      for (const failure of failures) updatePipelineItem(project.id, failure.item.id, { status:"RETOMANDO_FALLBACK_EXISTENTE" });
      const status = await pollPipelineBatchJob(jobId, project.id, failures.map((failure) => failure.item.id));
      if (status?.status === "ERROR") throw Object.assign(new Error(status?.error || status?.manifest?.reason || status?.manifest?.errorCode || "O Fallback informou uma falha."), { corvoStatus:status });
      const manifestItems = Array.isArray(status?.manifest?.items) ? status.manifest.items : [];
      const fallbackConversationUrl = String(status?.bridgeConversationUrl || failures[0]?.item.fallbackConversationUrl || "");
      return failures.map((failure) => {
        const item = failure.item;
        const decision = manifestItems.find((candidate:any) => String(candidate?.id || "") === String(item.id));
        const fallbackStatus = String(decision?.status || "INVALID_OUTPUT").toUpperCase();
        const destination = String(decision?.destination || "").toUpperCase();
        const promptRetry = String(decision?.retryPrompt || "");
        const reason = String(decision?.reason || failure.reason);
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:fallbackStatus, jobId, errorCode:failure.errorCode, reason, destination, promptRetry, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        updatePipelineItem(project.id, item.id, { fallbackConversationUrl:fallbackConversationUrl || item.fallbackConversationUrl });
        return { item:{ ...item, fallbackJobId:jobId, fallbackConversationUrl:fallbackConversationUrl || item.fallbackConversationUrl }, fallbackStatus, destination, promptRetry, reason, jobId, fallbackConversationUrl:fallbackConversationUrl || item.fallbackConversationUrl };
      });
    } catch (error) {
      const message = bridgeErrorMessage(error);
      const completion = await completeCorvoBridgeJob(jobId).catch(() => null);
      const fallbackConversationUrl = String(completion?.conversationUrl || failures[0]?.item.fallbackConversationUrl || "");
      return failures.map((failure) => ({ item:{ ...failure.item, fallbackConversationUrl:fallbackConversationUrl || failure.item.fallbackConversationUrl }, fallbackStatus:"FALHOU", destination:"", promptRetry:"", reason:failure.reason, jobId, fallbackError:message, fallbackTechnical:isTechnicalPipelineFailure("", message), fallbackConversationUrl:fallbackConversationUrl || failure.item.fallbackConversationUrl }));
    }
  }


  function comparisonGeneratorGroups(project:Project, batch:PipelineItem[]) {
    const byScene = new Map<string,PipelineItem[]>();
    for (const item of batch) {
      if (item.preset !== "QUAL_VOCE_PREFERE" || !item.sceneId || !["A","B"].includes(String(item.slot || ""))) continue;
      const key = String(item.sceneId);
      byScene.set(key, [...(byScene.get(key) || []), item]);
    }
    const grouped = new Map<string,{sceneId:string;a:PipelineItem;b:PipelineItem}>();
    for (const [sceneId,items] of byScene) {
      const a = items.find((item) => item.slot === "A");
      const b = items.find((item) => item.slot === "B");
      if (a && b) grouped.set(sceneId, { sceneId, a, b });
    }
    return grouped;
  }

  function comparisonLogicalBaseFile(sceneId:string, a:PipelineItem, b:PipelineItem) {
    const aName = String(a.finalFile || "").replace(/^.*[\\/]/, "");
    const bName = String(b.finalFile || "").replace(/^.*[\\/]/, "");
    const aMatch = aName.match(/^(.*?)(?:[_-]A)(\.[^.]+)$/i);
    const bMatch = bName.match(/^(.*?)(?:[_-]B)(\.[^.]+)$/i);
    if (aMatch && bMatch && aMatch[1].toLowerCase() === bMatch[1].toLowerCase() && aMatch[2].toLowerCase() === bMatch[2].toLowerCase()) return `${aMatch[1]}${aMatch[2]}`;
    const ext = aName.match(/(\.[^.]+)$/)?.[1] || bName.match(/(\.[^.]+)$/)?.[1] || ".png";
    return `video1_${sceneId}${ext}`;
  }

  function buildLogicalComparisonGeneratorEntry(project:Project, sceneId:string, a:PipelineItem, b:PipelineItem) {
    const promptA = String(a.retryPrompt || a.generationPrompt || a.reason || `${project.topic} opção A`).trim();
    const promptB = String(b.retryPrompt || b.generationPrompt || b.reason || `${project.topic} opção B`).trim();
    const baseFile = comparisonLogicalBaseFile(sceneId, a, b);
    return [
      `[ID:${sceneId}]`,
      `PROMPT_GERACAO=Produza para este ID os assets físicos individuais necessários, sem juntar duas imagens no mesmo arquivo. Crie a comparação do quiz com: opção 1, ${promptA}; opção 2, ${promptB}. Gere a opção 1 como arquivo individual _A e a opção 2 como arquivo individual _B. Mantenha as duas opções visualmente coerentes em escala e enquadramento quando isso fizer sentido, mas cada arquivo deve conter somente sua própria opção. Alta definição, composição limpa, sem marcas-d'água, logos, textos ou números. Não coloque as duas opções no mesmo asset.`,
      `CONTEXTO=${project.topic}. Imagens finais para o preset QUAL_VOCE_PREFERE do CorvoQuiz.`,
      `IDENTIDADE_ESPERADA_A=${a.reason || project.topic}`,
      `IDENTIDADE_ESPERADA_B=${b.reason || project.topic}`,
      `PADRAO_ARQUIVO_FINAL=${baseFile}`,
      `PADRAO_ARQUIVO_FINAL_A=${a.finalFile}`,
      `PADRAO_ARQUIVO_FINAL_B=${b.finalFile}`,
    ].join("\n");
  }

  function generatorDispatchEntries(project:Project, batch:PipelineItem[]) {
    const pairGroups = comparisonGeneratorGroups(project, batch);
    const consumed = new Set<string>();
    const entries:Array<{id:string;text:string;physicalIds:string[]}> = [];
    for (const item of batch) {
      if (consumed.has(item.id)) continue;
      const sceneId = String(item.sceneId || "");
      const pair = pairGroups.get(sceneId);
      if (pair && (item.id === pair.a.id || item.id === pair.b.id)) {
        consumed.add(pair.a.id); consumed.add(pair.b.id);
        entries.push({ id:sceneId, text:buildLogicalComparisonGeneratorEntry(project, sceneId, pair.a, pair.b), physicalIds:[pair.a.id, pair.b.id] });
        continue;
      }
      consumed.add(item.id);
      entries.push({ id:item.id, text:buildRoutedBatchEntry(project, item), physicalIds:[item.id] });
    }
    return entries;
  }

  async function runRoutedBatch(project:Project, batch:PipelineItem[], batchId:string, attempt:number) {
    if (!batch.length) return { successes:[] as PipelineItem[], failures:[] as Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> };
    const route = batch[0].route;
    if (route === "FLOW") throw new Error("PIPELINE_FLOW_ITEM_NOT_ROUTABLE");
    if (batch.some((item) => item.route !== route)) throw new Error("PIPELINE_BATCH_ROUTE_MISMATCH");
    if (batch.length > PIPELINE_BATCH_SIZE) throw new Error("PIPELINE_BATCH_TOO_LARGE");
    const ids = batch.map((item) => item.id);
    const dispatchEntries = route === "GERADOR" ? generatorDispatchEntries(project, batch) : batch.map((item) => ({ id:item.id, text:buildRoutedBatchEntry(project, item), physicalIds:[item.id] }));
    const requestIds = dispatchEntries.map((entry) => entry.id);
    const logicalComparisonCount = route === "GERADOR" ? dispatchEntries.filter((entry) => entry.physicalIds.length === 2).length : 0;
    const physicalAssetCount = batch.length;
    let job:any = null;
    try {
      const entrada = [
        `LOTE_ID=${batchId}`,
        `QUANTIDADE_ITENS=${dispatchEntries.length}`,
        route === "GERADOR" ? `ASSETS_FISICOS_ESPERADOS=${physicalAssetCount}` : `ASSETS_FISICOS_ESPERADOS=${batch.length}`,
        route === "GERADOR" && logicalComparisonCount
          ? `REGRA=Processe todos os IDs lógicos deste lote em uma única conversa. Quando um ID contiver duas opções, gere dois assets físicos separados (_A e _B), mantendo a primeira opção como _A e a segunda como _B. ${dispatchEntries.length} ID(s) lógico(s) deste lote correspondem a ${physicalAssetCount} asset(s) físico(s) esperados.`
          : `REGRA=Processe todos os IDs deste lote em uma única conversa e devolva um bloco [ID:...] para cada item.`,
        "",
        ...dispatchEntries.flatMap((entry,index) => [entry.text, index < dispatchEntries.length - 1 ? "" : ""]),
      ].join("\n");
      job = await createPipelineJob(route, project, entrada, requestIds, attempt);
      const attachments = route === "REFINADOR"
        ? batch.map((item) => ({
            url:String(item.sourceUrl || ""),
            name:String(item.selectedFile || item.sourceFile || `entrada_${item.id}.jpg`),
            contentType:"image/jpeg",
            sourceJobId:String(project.analysisJobId || ""),
            sourceUploadToken:String(project.analysisUploadToken || ""),
          })).filter((item) => item.url)
        : [];
      if (route === "REFINADOR" && attachments.length !== batch.length) throw new Error("REFINER_BATCH_SOURCE_MISSING");

      for (const item of batch) {
        const logicalJobId = item.logicalJobId || `${project.id}:ITEM:${item.id}`;
        updatePipelineItem(project.id, item.id, {
          jobId:job.jobId, jobPrompt:job.prompt, jobUploadToken:job.uploadToken,
          status:"ENVIANDO_LOTE", tentativaAtual:attempt, error:undefined, errorCode:undefined,
          logicalJobId, batchId, batchIndex:ids.indexOf(item.id) + 1, batchSize:batch.length,
        });
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:route, status:"ENVIANDO_LOTE", jobId:job.jobId, batchId, logicalJobId });
      }
      const preferredConversationUrl = batch.length && batch.every((item) => item.routeConversationUrl && item.routeConversationUrl === batch[0].routeConversationUrl)
        ? String(batch[0].routeConversationUrl || "")
        : "";
      await dispatchPipelineJobResilient({
        jobId:job.jobId,
        prompt:job.prompt,
        specialist:route,
        meta:{
          projectId:project.id,
          uploadToken:job.uploadToken,
          appOrigin:window.location.origin,
          attachments,
          batchId,
          batchSize:dispatchEntries.length,
          physicalAssetCount,
          logicalBatch:true,
          preferredConversationUrl,
          forceNewConversation:!preferredConversationUrl,
        },
      }, project.id, ids);
      for (const item of batch) updatePipelineItem(project.id, item.id, { status:"PROCESSANDO_LOTE" });
      const status = await pollPipelineBatchJob(job.jobId, project.id, ids, route === "REFINADOR" ? "REFINED_IMAGE" : "GENERATED_IMAGE");
      return resolveRoutedBatchStatus(project, batch, job.jobId, batchId, attempt, status, preferredConversationUrl);
    } catch (error) {
      const status = (error as any)?.corvoStatus;
      const completion = job?.jobId ? await completeCorvoBridgeJob(job.jobId).catch(() => null) : null;
      const recoveredConversationUrl = String(completion?.conversationUrl || batch[0]?.routeConversationUrl || "");
      const failures = batch.map((item) => {
        const failure = batchFailure(error, status, item);
        const failedItem = { ...item, jobId:job?.jobId || item.jobId, status:"FALHOU", error:failure.reason, errorCode:failure.errorCode, batchId, routeConversationUrl:recoveredConversationUrl || item.routeConversationUrl } as PipelineItem;
        updatePipelineItem(project.id, item.id, failedItem);
        appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:route, status:"FALHOU", jobId:job?.jobId, errorCode:failure.errorCode, reason:failure.reason, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        return { item:failedItem, ...failure };
      });
      return { successes:[] as PipelineItem[], failures };
    }
  }

  async function runFallbackBatch(project:Project, failures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}>, batchId:string, attempt:number) {
    if (!failures.length) return [] as Array<{item:PipelineItem;fallbackStatus:string;destination:string;promptRetry:string;reason:string;jobId?:string;fallbackError?:string;fallbackTechnical?:boolean;fallbackConversationUrl?:string}>;
    if (failures.length > PIPELINE_BATCH_SIZE) throw new Error("FALLBACK_BATCH_TOO_LARGE");
    const origin = failures[0].item.route;
    if (origin === "FLOW") throw new Error("PIPELINE_FLOW_ITEM_NOT_FALLBACK");
    if (failures.some((failure) => failure.item.route !== origin)) throw new Error("FALLBACK_BATCH_ORIGIN_MISMATCH");
    const entrada = [
      `LOTE_ID=${batchId}`,
      `ORIGEM=${origin}`,
      `QUANTIDADE_FALHAS=${failures.length}`,
      "Analise todos os IDs do lote numa única resposta. Não gere nem edite imagens.",
      "REGRAS_DE_CONTINUIDADE=Este é um JOB lógico em lote. Uma falha técnica do Bridge não cria um novo trabalho lógico; quando houver retry, preserve os mesmos IDs e arquivos imutáveis.",
      "",
      ...failures.flatMap((failure,index) => {
        const item = failure.item;
        const originalInstruction = item.route === "GERADOR"
          ? item.retryPrompt || item.generationPrompt || "Gerar imagem final conforme o contexto do projeto."
          : item.retryPrompt || `Refinar ${item.selectedFile || item.sourceFile || item.id} com intensidade ${item.refinement || "LEVE"}, preservando identidade e conteúdo principal.`;
        return [[
          `[ID:${item.id}]`,
          `LOGICAL_JOB_ID=${item.logicalJobId || `${project.id}:ITEM:${item.id}`}`,
          `ORIGEM=${item.route}`,
          `ERROR_CODE=${failure.errorCode}`,
          `MOTIVO=${failure.reason}`,
          item.route === "GERADOR" ? `PROMPT_ORIGINAL=${originalInstruction}` : `INSTRUCAO_ORIGINAL=${originalInstruction}`,
          item.selectedFile ? `ARQUIVO_SELECIONADO_IMUTAVEL=${item.selectedFile}` : "",
          `CONTEXTO=${project.topic}. Projeto ${project.id}.`,
          `IDENTIDADE=${item.reason || project.topic}`,
          `TENTATIVA_ATUAL=${attempt}`,
        ].filter(Boolean).join("\n"), index < failures.length - 1 ? "" : ""];
      }),
    ].join("\n");

    let preferredConversationUrl = failures.length && failures.every((failure) => failure.item.fallbackConversationUrl && failure.item.fallbackConversationUrl === failures[0].item.fallbackConversationUrl)
      ? String(failures[0].item.fallbackConversationUrl || "")
      : "";
    let lastJob:any = null;
    let lastError = "";

    // Falha técnica do próprio Fallback não cria cascata de conversas. Fazemos até
    // duas recuperações de transporte na MESMA conversa antes de devolver erro ao scheduler.
    for (let transportAttempt = 0; transportAttempt < 2; transportAttempt++) {
      let job:any = null;
      try {
        job = await createPipelineJob("FALLBACK", project, entrada, failures.map((failure) => failure.item.id), attempt, origin);
        lastJob = job;
        for (const failure of failures) {
          const item = failure.item;
          updatePipelineItem(project.id, item.id, { fallbackJobId:job.jobId, status:"AGUARDANDO_FALLBACK_LOTE", error:failure.reason, errorCode:failure.errorCode, batchId, fallbackConversationUrl:preferredConversationUrl || item.fallbackConversationUrl });
          appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:"ENVIANDO_LOTE", jobId:job.jobId, errorCode:failure.errorCode, reason:failure.reason, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
        }
        await dispatchPipelineJobResilient({
          jobId:job.jobId,
          prompt:job.prompt,
          specialist:"FALLBACK",
          meta:{ projectId:project.id, batchId, batchSize:failures.length, logicalBatch:true, preferredConversationUrl, forceNewConversation:!preferredConversationUrl },
        }, project.id, failures.map((failure) => failure.item.id));
        const status = await pollPipelineBatchJob(job.jobId, project.id, failures.map((failure) => failure.item.id));
        if (status?.status === "ERROR") throw Object.assign(new Error(status?.error || status?.manifest?.reason || status?.manifest?.errorCode || "O Fallback informou uma falha."), { corvoStatus:status });
        const conversationUrl = String(status?.bridgeConversationUrl || preferredConversationUrl || "");
        const manifestItems = Array.isArray(status?.manifest?.items) ? status.manifest.items : [];
        return failures.map((failure) => {
          const item = failure.item;
          const decision = manifestItems.find((candidate:any) => String(candidate?.id || "") === String(item.id));
          const fallbackStatus = String(decision?.status || "INVALID_OUTPUT").toUpperCase();
          const destination = String(decision?.destination || "").toUpperCase();
          const promptRetry = String(decision?.retryPrompt || "");
          const reason = String(decision?.reason || failure.reason);
          updatePipelineItem(project.id, item.id, { fallbackConversationUrl:conversationUrl || item.fallbackConversationUrl });
          appendPipelineHistory(project.id, item.id, { at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:fallbackStatus, jobId:job.jobId, errorCode:failure.errorCode, reason, destination, promptRetry, batchId, logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}` });
          return { item:{ ...item, fallbackJobId:job.jobId, fallbackConversationUrl:conversationUrl || item.fallbackConversationUrl }, fallbackStatus, destination, promptRetry, reason, jobId:job.jobId, fallbackConversationUrl:conversationUrl || item.fallbackConversationUrl };
        });
      } catch (error) {
        lastError = bridgeErrorMessage(error);
        const completion = job?.jobId ? await completeCorvoBridgeJob(job.jobId).catch(() => null) : null;
        preferredConversationUrl = String(completion?.conversationUrl || preferredConversationUrl || "");
        const technical = isTechnicalPipelineFailure("", lastError);
        if (technical && transportAttempt < 1) {
          for (const failure of failures) updatePipelineItem(project.id, failure.item.id, { status:"RETRY_TECNICO_FALLBACK_MESMA_CONVERSA", fallbackConversationUrl:preferredConversationUrl || failure.item.fallbackConversationUrl });
          const delay = /RATE_LIMIT/i.test(lastError) ? 180_000 : 20_000;
          setImageStatusLine(/RATE_LIMIT/i.test(lastError)
            ? `FALLBACK PAUSADO POR RATE LIMIT · MESMA CONVERSA · ${analysisRetryLabel(new Date(Date.now()+delay).toISOString())}`
            : "FALLBACK COM FALHA TÉCNICA · RETOMANDO A MESMA CONVERSA");
          await wait(delay);
          continue;
        }
        break;
      }
    }

    const technical = isTechnicalPipelineFailure("", lastError);
    return failures.map((failure) => {
      appendPipelineHistory(project.id, failure.item.id, { at:new Date().toISOString(), attempt, specialist:"FALLBACK", status:"FALHOU", jobId:lastJob?.jobId, reason:lastError, batchId, logicalJobId:failure.item.logicalJobId || `${project.id}:ITEM:${failure.item.id}` });
      return {
        item:{ ...failure.item, fallbackJobId:lastJob?.jobId, fallbackConversationUrl:preferredConversationUrl || failure.item.fallbackConversationUrl },
        fallbackStatus:"FALHOU", destination:"", promptRetry:"", reason:failure.reason, jobId:lastJob?.jobId,
        fallbackError:lastError || "Falha no Fallback.", fallbackTechnical:technical, fallbackConversationUrl:preferredConversationUrl || failure.item.fallbackConversationUrl,
      };
    });
  }


  async function runRoutedPipeline(project:Project, items:PipelineItem[]) {
    const failuresFinal:{id:string;error:string}[] = [];
    const finalItems = new Map<string,PipelineItem>();
    const completedIds = new Set<string>();
    const total = items.length;
    const normalizedItems:PipelineItem[] = items.map((item) => {
      const legacyCompositeCapture = Boolean(
        item.jobId
        && /BATCH_COMPOSITE_IMAGE/i.test(`${String(item.errorCode || "")} ${String(item.error || "")}`)
        && !item.outputUrl
      );
      return {
        ...item,
        selectedFile:item.route === "REFINADOR" ? String(item.selectedFile || item.sourceFile || "") : item.selectedFile,
        sourceFile:item.route === "REFINADOR" ? String(item.selectedFile || item.sourceFile || "") : item.sourceFile,
        logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}`,
        tentativaAtual:Math.max(1, Number(item.tentativaAtual || 1)),
        ...(legacyCompositeCapture ? {
          status:"WAITING_FILE",
          error:undefined,
          errorCode:undefined,
          finalFailure:false,
        } : {}),
      } as PipelineItem;
    });

    for (const item of normalizedItems) {
      if (item.status === "CONCLUIDO" && item.outputUrl) {
        finalItems.set(String(item.id), item);
        completedIds.add(String(item.id));
      } else if (item.finalFailure || ["FALHA_FINAL","NAO_RECUPERAVEL","SELECTED_FILE_MISMATCH"].includes(String(item.status || ""))) {
        finalItems.set(String(item.id), item);
        failuresFinal.push({ id:item.id, error:item.error || item.errorCode || "Tratamento manual necessário." });
      }
    }
    let pending = normalizedItems.filter((item) => !completedIds.has(String(item.id)) && !item.finalFailure && !["FALHA_FINAL","NAO_RECUPERAVEL","SELECTED_FILE_MISMATCH"].includes(String(item.status || "")));

    const setProgress = (label:string) => {
      const completed = completedIds.size;
      setImagePhase("searching");
      setImageProgress(Math.max(90, Math.min(99, 90 + (completed / Math.max(1,total)) * 9)));
      setImageMessage(label);
      setImageStatusLine(`${completed}/${total} FINAIS · LOTES DE ATÉ ${PIPELINE_BATCH_SIZE} · REFINADOR ${MAX_PARALLEL_REFINER_BATCHES} EM PARALELO · GERADOR/FALLBACK CONTROLADOS`);
      updateAutoRun(project.id, "IMAGENS", `${label} · ${completed}/${total}`);
    };

    const markFinalFailure = (item:PipelineItem, message:string, status = "FALHA_FINAL") => {
      const failed = { ...item, status, finalFailure:true, error:message } as PipelineItem;
      updatePipelineItem(project.id, item.id, failed);
      finalItems.set(String(item.id), failed);
      if (!failuresFinal.some((failure) => String(failure.id) === String(item.id))) failuresFinal.push({ id:item.id, error:message });
      return failed;
    };

    const applyFallbackDecisions = (decisions:Array<{item:PipelineItem;fallbackStatus:string;destination:string;promptRetry:string;reason:string;jobId?:string;fallbackError?:string;fallbackTechnical?:boolean;fallbackConversationUrl?:string}>, nextPending:PipelineItem[]) => {
      for (const fallback of decisions) {
        const item = fallback.item;
        const currentAttempt = Math.max(1, Number(item.tentativaAtual || 1));
        if (fallback.fallbackError) {
          markFinalFailure(item, fallback.fallbackError);
          continue;
        }
        if (fallback.fallbackStatus !== "RETRY") {
          markFinalFailure(item, fallback.reason || "Fallback marcou o ID como não recuperável.", "NAO_RECUPERAVEL");
          continue;
        }
        if (currentAttempt >= MAX_PIPELINE_ATTEMPTS) {
          markFinalFailure(item, `O ID ${item.id} atingiu o limite de ${MAX_PIPELINE_ATTEMPTS} tentativas. ${fallback.reason || ""}`.trim());
          continue;
        }
        if (!["GERADOR","REFINADOR"].includes(fallback.destination) || !fallback.promptRetry) {
          markFinalFailure(item, "Fallback retornou RETRY sem DESTINO/PROMPT_RETRY válidos.");
          continue;
        }
        if (fallback.destination === "REFINADOR" && !item.sourceUrl) {
          markFinalFailure(item, "Fallback apontou para o Refinador, mas este ID não possui a candidata original selecionada pelo Analista.");
          continue;
        }
        const nextItem:PipelineItem = {
          ...item,
          route:fallback.destination as "GERADOR"|"REFINADOR",
          tentativaAtual:currentAttempt + 1,
          retryPrompt:fallback.promptRetry,
          fallbackJobId:fallback.jobId,
          status:"RETRY_PENDENTE_LOTE",
          error:undefined,
          errorCode:undefined,
          finalFailure:false,
          selectedFile:item.selectedFile,
          sourceFile:item.selectedFile || item.sourceFile,
          routeConversationUrl:fallback.destination === item.route ? item.routeConversationUrl : undefined,
          fallbackConversationUrl:fallback.fallbackConversationUrl || item.fallbackConversationUrl,
        };
        updatePipelineItem(project.id, item.id, nextItem);
        nextPending.push(nextItem);
      }
    };

    patchProject(project.id, { pipelineStatus:`PIPELINE EM LOTES DE ATÉ ${PIPELINE_BATCH_SIZE}`, pipelineItems:normalizedItems });
    setProgress(completedIds.size ? `Retomando o pipeline salvo: ${completedIds.size}/${total} imagens já estavam concluídas.` : "O Analista terminou. Organizando Refinador e Gerador em lotes controlados...");

    // 1) Retoma FALLBACKs que já tinham sido enviados antes de um reload. O histórico
    // é a fonte de verdade: só há fallback pendente se o último evento dele ainda é ENVIANDO_LOTE.
    const pendingFallbackGroups = new Map<string,PipelineItem[]>();
    for (const item of pending) {
      const lastFallback = latestPipelineHistory(item, "FALLBACK");
      if (item.fallbackJobId && lastFallback?.status === "ENVIANDO_LOTE") {
        const group = pendingFallbackGroups.get(item.fallbackJobId) || [];
        group.push(item);
        pendingFallbackGroups.set(item.fallbackJobId, group);
      }
    }
    if (pendingFallbackGroups.size) {
      setProgress(`Retomando ${pendingFallbackGroups.size} lote(s) de Fallback já enviados, sem abrir novas conversas...`);
      const recoveredIds = new Set<string>();
      const tasks = [...pendingFallbackGroups.values()].map((group) => async () => {
        group.forEach((item) => recoveredIds.add(String(item.id)));
        const failures = group.map((item) => ({ item, errorCode:String(item.errorCode || "TOOL_ERROR"), reason:String(item.error || "Falha anterior aguardando Fallback."), technical:false }));
        return await resumeExistingFallbackBatch(project, failures);
      });
      const results = await runPool(tasks, MAX_PARALLEL_FALLBACK_BATCHES);
      const next = pending.filter((item) => !recoveredIds.has(String(item.id)));
      for (const decisions of results) if (decisions) applyFallbackDecisions(decisions, next);
      pending = next;
    }

    // 2) Retoma Refinador/Gerador que já estavam PROCESSANDO no mesmo JOB. Em vez de
    // despachar uma nova conversa, só fazemos polling/captura do job que já existe.
    const activeRouteGroups = new Map<string,PipelineItem[]>();
    const activeCheckpointStatuses = new Set([
      "ENVIANDO_LOTE", "PROCESSANDO_LOTE", "RETOMANDO_JOB_EXISTENTE",
      "PENDING", "SENT", "PROCESSING", "WAITING_ACTION", "RESULT_RECEIVED", "WAITING_FILE",
      "CAPTURANDO_LOTE_REFINADOR", "CAPTURANDO_LOTE_GERADOR",
    ]);
    for (const item of pending) {
      if (item.route === "FLOW") continue;
      const lastRoute = latestPipelineHistory(item, item.route);
      const itemStatus = String(item.status || "").toUpperCase();
      const checkpointLooksActive = activeCheckpointStatuses.has(itemStatus) || lastRoute?.status === "ENVIANDO_LOTE";
      if (item.jobId && checkpointLooksActive) {
        const key = `${item.route}:${item.jobId}`;
        const group = activeRouteGroups.get(key) || [];
        group.push(item);
        activeRouteGroups.set(key, group);
      }
    }
    if (activeRouteGroups.size) {
      setProgress(`Retomando ${activeRouteGroups.size} lote(s) já ativos no ChatGPT, sem duplicar conversas...`);
      const recoveredIds = new Set<string>();
      const tasks = [...activeRouteGroups.values()].map((group) => async () => {
        group.forEach((item) => recoveredIds.add(String(item.id)));
        return await resumeExistingRoutedBatch(project, group);
      });
      const recovered = await runPool(tasks, Math.max(MAX_PARALLEL_REFINER_BATCHES, MAX_PARALLEL_GENERATOR_BATCHES));
      let next = pending.filter((item) => !recoveredIds.has(String(item.id)));
      const recoveredSemantic:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> = [];
      for (const result of recovered) {
        if (!result) continue;
        for (const success of result.successes) {
          finalItems.set(String(success.id), success);
          completedIds.add(String(success.id));
        }
        for (const failure of result.failures) {
          const currentAttempt = Math.max(1, Number(failure.item.tentativaAtual || 1));
          if (currentAttempt >= MAX_PIPELINE_ATTEMPTS) {
            markFinalFailure(failure.item, failure.reason);
          } else if (failure.technical) {
            const retry = { ...failure.item, tentativaAtual:currentAttempt + 1, status:"RETRY_TECNICO_PENDENTE", finalFailure:false } as PipelineItem;
            updatePipelineItem(project.id, retry.id, retry);
            next.push(retry);
          } else recoveredSemantic.push(failure);
        }
      }
      if (recoveredSemantic.length) {
        const fallbackTasks:Array<()=>Promise<Awaited<ReturnType<typeof runFallbackBatch>>>> = [];
        const grouped = new Map<string,typeof recoveredSemantic>();
        for (const failure of recoveredSemantic) {
          const key = `${failure.item.route}|A${Math.max(1, Number(failure.item.tentativaAtual || 1))}|FB:${failure.item.fallbackConversationUrl || "__NEW__"}`;
          const group = grouped.get(key) || [];
          group.push(failure);
          grouped.set(key, group);
        }
        for (const failures of grouped.values()) {
          chunkPipelineItems(failures).forEach((batch,index) => {
            const attempt = Math.max(1, Number(batch[0]?.item.tentativaAtual || 1));
            fallbackTasks.push(() => runFallbackBatch(project, batch, `${project.id}:FB:RECOVERED:A${attempt}:B${String(index + 1).padStart(2,"0")}`, attempt));
          });
        }
        const fallbackGroups = await runPool(fallbackTasks, MAX_PARALLEL_FALLBACK_BATCHES);
        for (const decisions of fallbackGroups) applyFallbackDecisions(decisions, next);
      }
      pending = next;
    }

    // 3) Scheduler normal. A tentativa agora pertence ao ITEM, não à volta global.
    // Isso impede que um reload zere a contagem e também evita misturar tentativa 1 e 2 no mesmo lote.
    let schedulerRound = 0;
    const schedulerRoundLimit = MAX_PIPELINE_ATTEMPTS * 3;
    while (pending.length && schedulerRound < schedulerRoundLimit) {
      schedulerRound++;
      const refiners = pending.filter((item) => item.route === "REFINADOR");
      const generators = pending.filter((item) => item.route === "GERADOR");
      const refinerChunks = retryAwareChunks(refiners);
      const generatorChunks = retryAwareChunks(generators);
      setProgress(`Scheduler: ${refinerChunks.length} lote(s) de Refinador e ${generatorChunks.length} lote(s) de Gerador · ${pending.length} item(ns) pendentes.`);

      const refinerTasks = refinerChunks.map((batch,index) => () => {
        const attempt = Math.max(1, Number(batch[0]?.tentativaAtual || 1));
        return runRoutedBatch(project, batch, `${project.id}:REF:A${attempt}:B${String(index + 1).padStart(2,"0")}`, attempt);
      });
      const generatorTasks = generatorChunks.map((batch,index) => () => {
        const attempt = Math.max(1, Number(batch[0]?.tentativaAtual || 1));
        return runRoutedBatch(project, batch, `${project.id}:GEN:A${attempt}:B${String(index + 1).padStart(2,"0")}`, attempt);
      });
      const [refinerResults, generatorResults] = await Promise.all([
        runPool(refinerTasks, MAX_PARALLEL_REFINER_BATCHES),
        runPool(generatorTasks, MAX_PARALLEL_GENERATOR_BATCHES),
      ]);
      const roundResults = [...refinerResults, ...generatorResults];
      const roundFailures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> = [];
      for (const result of roundResults) {
        for (const success of result.successes) {
          finalItems.set(String(success.id), success);
          completedIds.add(String(success.id));
        }
        roundFailures.push(...result.failures);
      }
      setProgress(`${completedIds.size}/${total} concluídas; ${roundFailures.length} falha(s) serão classificadas sem criar retry desnecessário.`);
      if (!roundFailures.length) { pending = []; break; }

      const technicalFailures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> = [];
      const semanticFailures:Array<{item:PipelineItem;errorCode:string;reason:string;technical?:boolean}> = [];
      for (const failure of roundFailures) {
        const currentAttempt = Math.max(1, Number(failure.item.tentativaAtual || 1));
        if (currentAttempt >= MAX_PIPELINE_ATTEMPTS) markFinalFailure(failure.item, failure.reason);
        else if (failure.technical) technicalFailures.push(failure);
        else semanticFailures.push(failure);
      }

      const nextPending:PipelineItem[] = technicalFailures.map((failure) => {
        const currentAttempt = Math.max(1, Number(failure.item.tentativaAtual || 1));
        const nextItem:PipelineItem = {
          ...failure.item,
          tentativaAtual:currentAttempt + 1,
          status:"RETRY_TECNICO_PENDENTE",
          error:failure.reason,
          errorCode:failure.errorCode,
          finalFailure:false,
          selectedFile:failure.item.selectedFile,
          sourceFile:failure.item.selectedFile || failure.item.sourceFile,
        };
        updatePipelineItem(project.id, nextItem.id, nextItem);
        appendPipelineHistory(project.id, nextItem.id, {
          at:new Date().toISOString(), attempt:currentAttempt, specialist:nextItem.route, status:"RETRY_TECNICO_SEM_FALLBACK",
          errorCode:failure.errorCode, reason:failure.reason, batchId:nextItem.batchId, logicalJobId:nextItem.logicalJobId,
        });
        return nextItem;
      });
      if (technicalFailures.length) {
        const rateLimited = technicalFailures.some((failure) => /RATE_LIMIT/i.test(`${failure.errorCode} ${failure.reason}`));
        const delay = rateLimited ? 180_000 : 20_000;
        setProgress(`${technicalFailures.length} falha(s) técnicas: nenhum Fallback novo será aberto; os mesmos trabalhos lógicos aguardam uma pausa.`);
        await wait(delay);
      }

      const fallbackTasks:Array<()=>Promise<Awaited<ReturnType<typeof runFallbackBatch>>>> = [];
      const semanticGroups = new Map<string,typeof semanticFailures>();
      for (const failure of semanticFailures) {
        const key = `${failure.item.route}|A${Math.max(1, Number(failure.item.tentativaAtual || 1))}|FB:${failure.item.fallbackConversationUrl || "__NEW__"}`;
        const group = semanticGroups.get(key) || [];
        group.push(failure);
        semanticGroups.set(key, group);
      }
      for (const [key, failures] of semanticGroups) {
        const origin = failures[0]?.item.route || "REFINADOR";
        const attempt = Math.max(1, Number(failures[0]?.item.tentativaAtual || 1));
        chunkPipelineItems(failures).forEach((batch,index) => fallbackTasks.push(() => runFallbackBatch(project, batch, `${project.id}:FB:${origin}:A${attempt}:B${String(index + 1).padStart(2,"0")}`, attempt)));
      }
      const fallbackGroups = await runPool(fallbackTasks, MAX_PARALLEL_FALLBACK_BATCHES);
      for (const decisions of fallbackGroups) applyFallbackDecisions(decisions, nextPending);
      pending = nextPending;
    }

    if (pending.length) {
      for (const item of pending) markFinalFailure(item, "O scheduler atingiu o limite de segurança antes de concluir este item.");
      pending = [];
    }

    await wait(80);
    const liveItems = latestProject(project.id)?.pipelineItems || [];
    const liveById = new Map<string,PipelineItem>(liveItems.map((item) => [String(item.id), item]));
    const consolidatedItems = normalizedItems.map((original) => ({ ...original, ...(liveById.get(String(original.id)) || {}), ...(finalItems.get(String(original.id)) || {}) }));
    if (failuresFinal.length) {
      patchProject(project.id, { pipelineStatus:"TRATAMENTO MANUAL NECESSÁRIO", pipelineItems:consolidatedItems });
      setImagePhase("error");
      setImageProgress(100);
      setImageMessage(`${failuresFinal.length} imagem(ns) chegaram ao limite ou foram marcadas como não recuperáveis.`);
      setImageStatusLine(`${total-failuresFinal.length}/${total} FINAIS · ${failuresFinal.length} MANUAIS · LOTES LÓGICOS CONCLUÍDOS`);
      return false;
    }
    patchProject(project.id, { pipelineStatus:"IMAGENS FINAIS PRONTAS", imageCount:items.length, pipelineItems:consolidatedItems });
    setImagePhase("done");
    setImageProgress(100);
    setImageMessage(`Refinador, Gerador e Fallback concluíram em lotes de até ${PIPELINE_BATCH_SIZE}. A Consolidação já pode gerar o ZIP final.`);
    setImageStatusLine(`${items.length}/${items.length} IMAGENS FINAIS · LOTES LÓGICOS CONCLUÍDOS`);
    return true;
  }


  function hasPreparedAnalysis(project:Project | undefined | null) {
    if (hasLegacyAnalysisStorage(project)) return false;
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
    if (hasLegacyAnalysisStorage(project)) return false;
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
    const message = bridgeErrorMessage(error);
    const nextAt = new Date(Date.now() + analysisRetryDelayForError(error, count - 1)).toISOString();
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
    if (!packageResponse.ok || !packageResult?.file?.url) {
      const failureSample = Array.isArray(packageResult?.failures) ? packageResult.failures.slice(0, 3).join(" | ") : "";
      throw new Error([packageResult?.code, packageResult?.message || "Não foi possível montar o ZIP do Analista a partir do checkpoint.", failureSample].filter(Boolean).join(" | "));
    }
    patchProject(project.id, {
      analysisPreparationStage:"ZIP_SAVED",
      analysisStatus:"PACOTE DO ANALISTA SALVO",
      analysisZipUrl:String(packageResult.file.url),
      analysisZipDownloadUrl:String(packageResult.file.downloadUrl || packageResult.file.url),
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
      if (checkpoint?.legacyStorage) {
        patchProject(projectId, {
          ...EMPTY_IMAGE_PIPELINE,
          autoRunStatus:project.autoRunStatus,
          autoRunStep:project.autoRunStatus === "RUNNING" ? "COLLECTOR" : project.autoRunStep,
          autoRunMessage:project.autoRunStatus === "RUNNING" ? "Checkpoint legado do Vercel Blob descartado. Recriando o pacote no Cloudflare R2." : project.autoRunMessage,
          autoRunError:undefined,
          pipelineStatus:"MIGRANDO CHECKPOINT PARA R2",
        });
        setImageMessage("O checkpoint do servidor usa arquivos antigos do Vercel Blob. Recriando apenas o pacote de imagens no R2...");
        setImageStatusLine("CHECKPOINT LEGADO DESCARTADO · R2 ATIVO");
        setTimeout(() => void startImageFlow({ ...project, ...EMPTY_IMAGE_PIPELINE }, { automaticRun:project.autoRunStatus === "RUNNING", skipParallelBranches:true, selectionMode:"AUTO" }), 200);
        return false;
      }
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
          analysisZipDownloadUrl:String(zipFile.downloadUrl || zipFile.url),
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
    if (analysisMessageCommitted(current)) {
      patchProject(projectId, {
        analysisStatus:"ANALISTA PROCESSANDO · SEM REENVIO",
        analysisRetryAt:undefined,
        analysisLastError:bridgeErrorMessage(error),
        pipelineStatus:"ANALISANDO IMAGENS",
        autoRunStatus:current.autoRunStatus === "RUNNING" ? "RUNNING" : current.autoRunStatus,
        autoRunStep:current.autoRunStatus === "RUNNING" ? "ANALISTA" : current.autoRunStep,
        autoRunMessage:current.autoRunStatus === "RUNNING" ? "O Analista já recebeu a mensagem. Houve falha apenas no acompanhamento; o app continuará consultando a Action sem reenviar." : current.autoRunMessage,
      });
      setImagePhase("searching"); setImageProgress(92);
      setImageMessage("O Analista continua processando. O app não enviará outra mensagem; apenas retomará o acompanhamento da Action.");
      setImageStatusLine("ANALISTA PROCESSANDO · REENVIO BLOQUEADO");
      return;
    }
    const count = (current.analysisRetryCount || 0) + 1;
    const message = bridgeErrorMessage(error);
    const nextAt = new Date(Date.now() + analysisRetryDelayForError(error, count - 1)).toISOString();
    patchProject(projectId, {
      analysisStatus:"PACOTE SALVO · AGUARDANDO ANALISTA",
      analysisRetryCount:count,
      analysisRetryAt:nextAt,
      analysisLastError:message,
      pipelineStatus:"AGUARDANDO ANALISTA",
      autoRunStatus:current.autoRunStatus === "RUNNING" ? "RUNNING" : current.autoRunStatus,
      autoRunStep:current.autoRunStatus === "RUNNING" ? "ANALISTA" : current.autoRunStep,
      autoRunMessage:current.autoRunStatus === "RUNNING" ? `Envio ao Analista preservado no último ponto. ${analysisRetryLabel(nextAt)}.` : current.autoRunMessage,
      autoRunError:current.autoRunStatus === "RUNNING" ? undefined : current.autoRunError,
    });
    setImagePhase("searching");
    setImageProgress(90);
    setImageMessage("O pacote e o estado de envio estão preservados. O Bridge retomará da mesma aba sem repetir o Collector.");
    setImageStatusLine(`ENVIO PRESERVADO · ${analysisRetryLabel(nextAt)} · TENTATIVA ${count + 1}`);
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
      const comparisonSlot = comparisonSlotForItem(project, id);
      const finalFile = comparisonSlot?.fileName || (sourceFile ? sourceFile.replace(/_c\d+(?=\.[^.]+$)/i, "").replace(/\.[^.]+$/, ".png") : `video1_${String(id).padStart(2,"0")}.png`);
      const slotMeta = comparisonSlot ? { sceneId:comparisonSlot.sceneId, slot:comparisonSlot.slot, formaField:comparisonSlot.formaField, preset:comparisonSlot.preset } : {};
      if (statusName === "PASSOU" || statusName === "PASSOU_COM_RESSALVAS") return [{
        id,
        ...slotMeta,
        route:"REFINADOR" as const,
        sourceFile,
        selectedFile:sourceFile,
        sourceUrl:sourceRecord?.url,
        refinement:String(manifestItem.refinement || (statusName === "PASSOU" ? "LEVE" : "FORTE")),
        reason:String(manifestItem.reason || ""),
        finalFile,
        status:"PENDENTE",
        tentativaAtual:1,
      }];
      if (statusName === "NAO_PASSOU") return [{
        id,
        ...slotMeta,
        route:"GERADOR" as const,
        sourceFile:"",
        generationPrompt:comparisonSlot ? comparisonSlotPrompt(project, comparisonSlot, String(manifestItem.generationPrompt || "")) : String(manifestItem.generationPrompt || ""),
        reason:String(manifestItem.reason || ""),
        finalFile,
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
    const liveBeforeDispatch = latestProject(project.id) || project;
    if (liveBeforeDispatch.analysisJobId === analysisJob.jobId && analysisMessageCommitted(liveBeforeDispatch)) {
      patchProject(project.id, {
        analysisStatus:"ANALISTA PROCESSANDO · SEM REENVIO",
        analysisRetryAt:undefined,
        analysisLastError:undefined,
        pipelineStatus:"ANALISANDO IMAGENS",
      });
      setImagePhase("searching"); setImageProgress(92);
      setImageMessage("O ZIP já foi enviado ao Analista. Aguardando a Action sem enviar outra mensagem.");
      setImageStatusLine("ANALISTA PROCESSANDO · REENVIO BLOQUEADO");
      const status = await pollPipelineJob(analysisJob.jobId, project.id);
      return await finishAnalysisFromStatus(liveBeforeDispatch, analysisJob, expectedIds, status);
    }
    patchProject(project.id, {
      analysisJobId:analysisJob.jobId,
      analysisStatus:"ENVIANDO AO ANALISTA",
      analysisZipUrl:zipFile.url,
      analysisZipDownloadUrl:zipFile.downloadUrl || zipFile.url,
      analysisZipName:zipFile.name,
      analysisExpectedIds:expectedIds,
      analysisPrompt:analysisJob.prompt,
      analysisUploadToken:analysisJob.uploadToken,
      analysisLastDispatchAt:new Date().toISOString(),
      analysisBridgeStage:"DISPATCHING",
      analysisBridgeUpdatedAt:new Date().toISOString(),
      analysisRetryAt:undefined,
      pipelineStatus:"ANALISANDO IMAGENS",
    });
    updateAutoRun(project.id, "ANALISTA", `Corvo Analista comparando a shortlist de candidatas de ${expectedIds.length} IDs...`);
    setImagePhase("searching"); setImageProgress(90); setImageMessage("Enviando o pacote persistente ao Corvo Analista..."); setImageStatusLine("ZIP SALVO NO R2 · ANALISTA ESCOLHENDO POR ID");
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
      meta:{
        projectId:project.id,
        uploadToken:analysisJob.uploadToken,
        appOrigin:window.location.origin,
        attachments:[{ url:zipFile.downloadUrl || zipFile.url, name:zipFile.name, contentType:"application/zip" }],
      },
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
      const zipFile = { url:String(project.analysisZipUrl), downloadUrl:String(project.analysisZipDownloadUrl || project.analysisZipUrl), name:String(project.analysisZipName || `${project.id}_ANALISE_CANDIDATAS.zip`) };

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
        const committed = analysisMessageCommitted(project);
        if (currentResponse.ok && committed && currentStatus?.status !== "ERROR") {
          patchProject(projectId, {
            analysisStatus:"ANALISTA PROCESSANDO · SEM REENVIO",
            pipelineStatus:"ANALISANDO IMAGENS",
            analysisRetryAt:undefined,
            analysisLastError:undefined,
          });
          setImageMessage("A mensagem já foi enviada ao Analista. Aguardando somente a Action, sem limite de tempo e sem reenviar o prompt.");
          setImageStatusLine("MENSAGEM ENVIADA · REENVIO AUTOMÁTICO BLOQUEADO");
          const completedStatus = await pollPipelineJob(analysisJob.jobId, project.id);
          const routed = await finishAnalysisFromStatus(project, analysisJob, expectedIds, completedStatus);
          if (routed && latestProject(projectId)?.autoRunStatus === "RUNNING") setTimeout(() => void runAutomaticProduction(projectId), 100);
          return routed;
        }
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

  async function reopenTerminalPipelineFailures(project:Project) {
    const terminalItems = terminalPipelineFailures(project);
    if (!terminalItems.length) return false;
    const terminalIds = new Set(terminalItems.map((item) => String(item.id)));
    const reopenedAt = new Date().toISOString();
    const reopenedItems:PipelineItem[] = (project.pipelineItems || []).map((item) => {
      if (!terminalIds.has(String(item.id))) return item;
      const manualEvent:PipelineHistoryEvent = {
        at:reopenedAt,
        attempt:1,
        specialist:item.route,
        status:"RETRY_MANUAL_REABERTO",
        reason:"Usuário solicitou TENTAR NOVAMENTE após falha terminal. Novo ciclo de tentativas iniciado sem refazer Collector/Analista.",
        logicalJobId:item.logicalJobId || `${project.id}:ITEM:${item.id}`,
      };
      return {
        ...item,
        tentativaAtual:1,
        status:"RETRY_MANUAL_PENDENTE",
        finalFailure:false,
        error:undefined,
        errorCode:undefined,
        outputUrl:undefined,
        outputFile:undefined,
        jobId:undefined,
        fallbackJobId:undefined,
        jobPrompt:undefined,
        jobUploadToken:undefined,
        batchId:undefined,
        batchIndex:undefined,
        batchSize:undefined,
        routeConversationUrl:undefined,
        fallbackConversationUrl:undefined,
        history:[...(item.history || []), manualEvent],
      };
    });
    const resumeAutomatic = project.autoRunStatus === "ERROR" || project.autoRunStatus === "RUNNING";
    const reopenedProject:Project = {
      ...project,
      pipelineItems:reopenedItems,
      pipelineStatus:`RETRY MANUAL · ${terminalItems.length} ITEM(NS) REABERTO(S)`,
      finalZipStatus:undefined,
      finalZipError:undefined,
      finalZipGeneratedAt:undefined,
      autoRunStatus:project.autoRunStatus === "ERROR" ? "RUNNING" : project.autoRunStatus,
      autoRunStep:resumeAutomatic ? "IMAGENS" : project.autoRunStep,
      autoRunMessage:resumeAutomatic ? `${terminalItems.length} falha(s) terminal(is) reaberta(s) manualmente. Retomando somente Gerador/Refinador.` : project.autoRunMessage,
      autoRunError:undefined,
      autoRunRetryAt:undefined,
      autoRunRetryCount:resumeAutomatic ? 0 : project.autoRunRetryCount,
    };
    packageRetryRef.current = null;
    patchProject(project.id, reopenedProject);
    setImageOpen(true);
    setImagePhase("searching");
    setImageProgress(1);
    setImageMessage(`Reabrindo ${terminalItems.length} falha(s). O que já foi concluído será preservado.`);
    setImageStatusLine("RETRY MANUAL · LIMPANDO BLOQUEIO TERMINAL · NOVO CICLO DE TENTATIVAS");
    await wait(80);
    const routed = await runRoutedPipeline(reopenedProject, reopenedItems);
    if (routed && resumeAutomatic) setTimeout(() => void runAutomaticProduction(project.id), 120);
    return true;
  }

  async function retryImageFlow() {
    const currentProject = latestProject(active?.id || "");
    if (currentProject && terminalPipelineFailures(currentProject).length) {
      await reopenTerminalPipelineFailures(currentProject);
      return;
    }
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
      setConsolidationMessage(summary.missingIds.length ? `Ainda faltam os IDs: ${summary.missingIds.join(", ")}.` : summary.missingFormaSlots.length ? `O preset OU ainda está sem os slots: ${summary.missingFormaSlots.join(", ")}.` : summary.missingScriptFiles.length ? `O ROTEIRO ainda referencia arquivos ausentes no ZIP: ${summary.missingScriptFiles.slice(0,8).join(", ")}${summary.missingScriptFiles.length>8?"…":""}.` : "A consolidação ainda possui pendências de IDs ou nomes.");
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
        manifestItems.push({ id:item.id, cena:item.sceneId || item.id, slot:item.slot || "SINGLE", preset:item.preset || null, campoForma:item.formaField || null, arquivo:fileName, origem:item.route, tentativaFinal:item.tentativaAtual || 1, historico:item.history || [] });
      }

      const thumbFolder = zip.folder("thumbnail");
      if (project.thumbUrl) {
        const response = await fetch(project.thumbUrl, { cache:"no-store" });
        if (response.ok) thumbFolder?.file(project.thumbFileName || `thumb_${project.id.toLowerCase()}.png`, await response.blob());
        else thumbFolder?.file("STATUS.txt", `STATUS=FALHOU_AO_BAIXAR\\nURL=${project.thumbUrl}`);
      } else thumbFolder?.file("STATUS.txt", `STATUS=${project.thumbStatus || "PENDENTE"}\\n${project.thumbError ? `ERRO=${project.thumbError}` : ""}`);

      zip.file("ROTEIRO.txt", project.scriptText || "");
      zip.folder("youtube")?.file("METADADOS.txt", project.youtubeMetadata || `STATUS=${project.youtubeStatus || "PENDENTE"}\\n${project.youtubeError ? `ERRO=${project.youtubeError}` : ""}`);
      zip.folder("flow")?.file("CORVO_FLOW_RESULT.txt", project.flowManifest || `STATUS=${project.flowStatus || "CONCLUIDO"}\nBATCH_ID=${project.flowBatchId || ""}\nTOTAL=${project.flowTotal || summary.items.length}\nDONE=${project.flowDone || summary.items.length}\nFAILED=${project.flowFailed || 0}`);
      zip.file("CORVO_FINAL_MANIFEST.json", JSON.stringify({
        protocol:"corvo-final/1", projectId:project.id, generatedAt:new Date().toISOString(), total:summary.items.length,
        thumbnail:liveProject.thumbFileName || null, youtubeMetadata:Boolean(liveProject.youtubeMetadata), automaticTotal:options.automaticRun === true, images:manifestItems,
      }, null, 2));
      zip.file("LEIA-ME.txt", [
        "CORVOQUIZ — PACOTE FINAL", `PROJETO=${project.id}`, `TOTAL_IMAGENS=${summary.items.length}`,
        "", "ROTEIRO.txt = roteiro compatível com o Forma", "imagens/ = imagens finais; QUAL_VOCE_PREFERE usa IMAGEM_A + IMAGEM_B como dois arquivos físicos separados", "thumbnail/ = thumbnail real quando disponível", "youtube/ = metadados editoriais", "flow/ = manifesto da produção do Corvo Flow Manager",
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

    <section className="hero" id="top"><div><span className="eyebrow"><i /> CENTRAL DE PRODUÇÃO</span><h1>DA IDEIA AO <em>VÍDEO FINAL.</em></h1><p>Escolha Automático Reels ou Automático Vídeo Completo e o Corvo conduz a esteira até o MP4 final.<br />Flow e Forma trabalham integrados; o download automático acontece somente quando o vídeo estiver pronto.</p></div><div className="hero-actions"><button className="auto-project reels" onClick={()=>startFullAutomaticProduction("REELS")}><span>▯</span><b>AUTOMÁTICO REELS</b><small>9:16 · IDEIA → VÍDEO FINAL</small></button><button className="auto-project full" onClick={()=>startFullAutomaticProduction("VÍDEO COMPLETO")}><span>▭</span><b>AUTOMÁTICO VÍDEO COMPLETO</b><small>16:9 · IDEIA → VÍDEO FINAL</small></button><button className="new-project" onClick={openNewProduction}><span>＋</span><b>NOVA PRODUÇÃO</b><small>MODO ASSISTIDO</small></button></div></section>

    <section className="workspace" id="producao">
      <div className="section-heading"><div><span className="section-number">01</span><h2>EM PRODUÇÃO</h2></div><button className="text-button" onClick={openNewProduction}>CRIAR OUTRA <span>↗</span></button></div>
      {active && <article className="production-card">
        <div className="card-main">
          <div className="project-meta"><span className="format-tag">{active.format}</span><span>{active.quantity}</span><span>{active.createdAt}</span></div>
          <h3>{active.title}</h3><p>{active.id}</p>
          <div className="stepper">{steps.map((step,index) => { const complete=index+1<active.stage; const current=index+1===active.stage; return <div className={`step ${complete?"complete":""} ${current?"current":""}`} key={step}><span>{complete?"✓":String(index+1).padStart(2,"0")}</span><small>{step}</small></div>; })}</div>
          <div className="card-actions">
            {active.autoRunStatus==="ERROR"||active.autoRunStatus==="CANCELLED"?<button className="resume-auto-action" onClick={()=>void runAutomaticProduction(active.id)}><span>⚡</span><b>RETOMAR ESTA PRODUÇÃO</b><i>→</i></button>:null}
            <button className="primary-action" onClick={continueProduction}>{active.stage<=2?(active.scriptText?"REVISAR ROTEIRO":"CRIAR ROTEIRO"):active.stage===3?(active.promptText?"REVISAR PROMPTS":"CRIAR PROMPTS"):active.stage===4?"BUSCAR IMAGENS":active.formaStatus==="CONCLUÍDO"?"GERAR VÍDEO NOVAMENTE":"GERAR VÍDEO NO FORMA"} <span>→</span></button>
            <button className="secondary-action" onClick={() => downloadProject(active)}>↓ BAIXAR PROJETO</button>
          </div>
          {active.autoRunStatus&&<div className={`auto-run-panel ${active.autoRunStatus.toLowerCase()}`}><div className="auto-run-head"><div><span>{active.format==="REELS"?"AUTOMÁTICO REELS":"AUTOMÁTICO VÍDEO COMPLETO"}</span><b>{active.autoRunMessage||"Acompanhando a produção automática."}</b>{active.autoRunError&&<small>{active.autoRunError}</small>}</div>{active.autoRunStatus==="RUNNING"?<div className="auto-run-actions"><button className="monitor" onClick={()=>openActivity(active.autoRunStep || "TODOS")}>ACOMPANHAR</button><button onClick={()=>void cancelAutomaticProduction(active.id)}>PARAR</button></div>:<em>{active.autoRunStatus==="DONE"?"CONCLUÍDO":active.autoRunStatus==="ERROR"?"PRECISA DE ATENÇÃO":"INTERROMPIDO"}</em>}</div><div className="auto-run-steps">{autoRunChecklist(active,settings.youtubeParallel).map((item)=><button type="button" className={item.done?"done":active.autoRunStep===item.key?"current":""} key={item.key} onClick={()=>openActivity(item.key)} title={`Acompanhar ${item.label}`}><i>{item.done?"✓":active.autoRunStep===item.key?"•":"○"}</i>{item.label}</button>)}</div></div>}
        </div>
        <aside className="card-side" id="arquivos">
          <div className="mini-title"><span>MEMÓRIA DA PRODUÇÃO</span><b>{[active.ideaText,active.scriptText,active.promptText].filter(Boolean).length}/3</b></div>
          <button className="file-row done action" onClick={()=>openArtifact("IDEIA")}><span>◆</span><div><b>IDEIA ESCOLHIDA</b><small>ABRIR CONCEITO ORIGINAL</small></div><i>→</i></button>
          <button className={`file-row action ${active.scriptText?"done":"pending"}`} disabled={!active.scriptText} onClick={()=>openArtifact("ROTEIRO")}><span>▤</span><div><b>ROTEIRO.TXT</b><small>{active.scriptText?"ABRIR ROTEIRO COMPLETO":"AGUARDANDO ROTEIRISTA"}</small></div><i>{active.scriptText?"→":"○"}</i></button>
          <button className={`file-row action ${active.promptText?"done":"pending"}`} disabled={!active.promptText} onClick={()=>openArtifact("PROMPTS")}><span>✦</span><div><b>PROMPTS.TXT</b><small>{active.promptText?"ABRIR BUSCAS DE IMAGEM":"AGUARDANDO ROTEIRO"}</small></div><i>{active.promptText?"→":"○"}</i></button>
          <button className={`file-row action ${thumbMatchesProjectFormat(active)?"done":active.thumbStatus==="FALHOU"?"pending":""}`} disabled={!active.scriptText && !thumbMatchesProjectFormat(active)} onClick={()=>thumbMatchesProjectFormat(active)?window.open(active.thumbUrl,"_blank","noopener,noreferrer"):void startThumbBranch(active)}><span>▰</span><div><b>THUMBNAIL · {thumbAspectRatioForFormat(active.format)}</b><small>{thumbMatchesProjectFormat(active)?"ABRIR IMAGEM FINAL":active.thumbError||active.thumbStatus||`CLIQUE PARA GERAR · ${thumbOrientationForFormat(active.format)}`}</small></div><i>{thumbMatchesProjectFormat(active)?"→":"↻"}</i></button>
          <button className={`file-row action ${active.youtubeMetadata?"done":active.youtubeStatus==="FALHOU"?"pending":""}`} disabled={!active.youtubeMetadata} onClick={()=>{if(active.youtubeMetadata)downloadTextFile(`${active.id}_YOUTUBE.txt`,active.youtubeMetadata);}}><span>▶</span><div><b>YOUTUBE / METADADOS</b><small>{active.youtubeMetadata?"BAIXAR DADOS EDITORIAIS":active.youtubeError||active.youtubeStatus||(settings.youtubeParallel?"INICIA EM PARALELO":"DESATIVADO NAS CONFIGURAÇÕES")}</small></div><i>{active.youtubeMetadata?"↓":"○"}</i></button>
          <button className={`file-row action ${active.formaStatus==="CONCLUÍDO"?"done":consolidationState(active).ready?"pending":""}`} disabled={!consolidationState(active).ready} onClick={()=>void runFormaProduction(active,{force:active.formaStatus==="CONCLUÍDO"})}><span>▶</span><div><b>FORMA / VÍDEO FINAL</b><small>{active.formaStatus==="CONCLUÍDO" ? `${active.formaSceneCount||0} CENAS · MP4 ENTREGUE` : active.formaError || active.formaStatus || (consolidationState(active).ready?"PRONTO PARA ENVIAR AO FORMA":"AGUARDANDO IMAGENS")}</small></div><i>{active.formaStatus==="CONCLUÍDO"?"↻":consolidationState(active).ready?"→":"○"}</i></button><button className={`file-row action ${consolidationState(active).ready?"done":active.pipelineItems?.length?"pending":""}`} disabled={!active.pipelineItems?.length} onClick={()=>{setConsolidationMessage("");setConsolidationOpen(true);}}><span>▦</span><div><b>ZIP DE BACKUP / FORMA MANUAL</b><small>{active.pipelineItems?.length ? `${consolidationState(active).completed}/${consolidationState(active).items.length} FINAIS · ${consolidationState(active).ready ? "PRONTO PARA GERAR" : active.pipelineStatus || "AGUARDANDO"}` : "AGUARDANDO O FLOW"}</small></div><i>{active.finalZipStatus==="CONCLUIDO"?"✓":consolidationState(active).ready?"→":"○"}</i></button>
          {active.packageCode ? <button className="package-ready" onClick={()=>active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?setImageOpen(true):void startFlowImageProduction(active)}><span>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"✓":"⌁"}</span><div><b>{active.pipelineStatus==="IMAGENS FINAIS PRONTAS"?"IMAGENS DO FLOW PRONTAS":"FLOW EM PRODUÇÃO / RETOMADA"}</b><small>{active.flowStatus||active.pipelineStatus||`${active.imageCount||0} ASSET(S) RECEBIDO(S)`}</small></div></button> : <button className="collector-box" disabled={!active.promptText || active.stage<4} onClick={()=>void startFlowImageProduction(active)}><span>⌁</span><b>{active.flowStatus==="EM PRODUÇÃO"?"ACOMPANHAR FLOW":active.promptText&&active.stage>=4?"PRODUZIR NO FLOW":"AGUARDANDO PROMPTS"}</b><small>{active.flowStatus||(active.promptText&&active.stage>=4?"MOTOR FLOW AUTOMÁTICO · PERFIS · ENTREGA DIRETO AO APP":"A PRÓXIMA ETAPA SERÁ LIBERADA")}</small></button>}
        </aside>
      </article>}
    </section>

    <section className="projects" id="projetos"><div className="section-heading"><div><span className="section-number">02</span><h2>PROJETOS RECENTES</h2></div><span className="project-count">{String(projects.length).padStart(2,"0")} PRODUÇÕES</span></div><div className="project-list">{projects.map((project) => <button className={`project-row ${project.id===activeId?"selected":""}`} key={project.id} onClick={() => setActiveId(project.id)}><span className="project-icon">{project.format==="REELS"?"▯":"▭"}</span><span className="project-name"><b>{project.title}</b><small>{project.id}</small></span><span className="project-format">{project.format}</span><span className="progress"><i style={{width:`${project.stage*20}%`}} /></span><span className="stage-label">ETAPA {project.stage}/5</span><span className="row-arrow">→</span></button>)}</div></section>
    {activityOpen && active && <div className="modal-backdrop activity-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target)setActivityOpen(false);}}><section className="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-title">
      <button className="modal-x" onClick={()=>setActivityOpen(false)}>×</button>
      <span className="modal-kicker">CENTRAL AO VIVO</span><h2 id="activity-title">ACOMPANHAR PRODUÇÃO</h2><p>{active.title}</p>
      <div className="activity-tabs">{(["TODOS","IDEIA","ROTEIRO","PROMPTS","FLOW","IMAGENS","FORMA","THUMB","METADADOS"] as ActivityFilter[]).map((step)=><button key={step} className={activityFilter===step?"active":""} onClick={()=>setActivityFilter(step)}>{step}</button>)}</div>
      <div className="activity-current"><span>ETAPA SELECIONADA</span><b>{activityFilter}</b><small>{activityStepStatus(active,activityFilter)}</small></div>
      <div className="activity-list">
        {activityJobs.filter((job)=>activityFilter==="TODOS" || specialistToActivityStep(job.specialist)===activityFilter).map((job)=><div className="activity-job" key={job.jobId}>
          <div className="activity-job-head"><span>{job.specialist||"GPT"}</span><em className={String(job.state||"").includes("ERROR")?"error":String(job.state||"").includes("WAITING")||String(job.state||"").includes("PROCESS")?"working":""}>{job.state||"ABERTO"}</em></div>
          <b>{job.message||"Conversa aberta pelo Corvo Bridge."}</b>
          <small>{job.batchId?`LOTE ${job.batchId}${job.batchSize?` · ${job.batchSize} ITEM(NS)`:""} · `:""}JOB {job.jobId} · {job.tabStatus?`ABA ${job.tabStatus.toUpperCase()} · `:""}{job.updatedAt?`ATUALIZADO HÁ ${elapsedLabel(new Date(job.updatedAt).toISOString())}`:""}</small>
          <div className="activity-job-actions"><button onClick={()=>void openBridgeConversation(job)}>ABRIR CONVERSA ↗</button>{job.conversationUrl?<span>CONVERSA LOCALIZADA</span>:<span>AGUARDANDO URL DA CONVERSA</span>}</div>
        </div>)}
        {!activityLoading && !activityJobs.filter((job)=>activityFilter==="TODOS" || specialistToActivityStep(job.specialist)===activityFilter).length && <div className="activity-empty"><b>NENHUMA CONVERSA ATIVA NESTA ETAPA</b><small>Etapas concluídas podem ter a aba fechada automaticamente pelo Bridge. O status persistido do projeto continua acima.</small></div>}
      </div>
      {activityError&&<div className="activity-error">{activityError}</div>}
      <div className="activity-footer"><small>{activityLoading?"ATUALIZANDO...":activityUpdatedAt?`ÚLTIMA LEITURA · ${new Date(activityUpdatedAt).toLocaleTimeString("pt-BR")}`:"AGUARDANDO BRIDGE"}</small><button onClick={()=>void refreshActivity(active.id)}>ATUALIZAR AGORA</button></div>
    </section></div>}

    <footer><span>CORVOQUIZ PRODUÇÃO <i>V0.6.41</i></span><span>BATCHING 10 + JOB LÓGICO + CLEANER · V0.6.41</span></footer>
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
      <button className="modal-submit success" disabled={!consolidationState(active).ready||consolidationBusy} onClick={()=>void buildFinalZip(active)}>{consolidationBusy?"GERANDO ZIP...":"GERAR ZIP DE BACKUP PARA O FORMA"} <span>→</span></button>
      <button className="plain-close" disabled={consolidationBusy} onClick={()=>setConsolidationOpen(false)}>FECHAR</button>
    </section></div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setSettingsOpen(false)}><section className="settings-modal">
      <button className="modal-close" onClick={()=>setSettingsOpen(false)} aria-label="Fechar configurações">×</button>
      <span className="modal-kicker">COMPORTAMENTO DAS IMAGENS</span><h2>COMO O CORVO DEVE ESCOLHER?</h2><p>Estas opções ficam salvas e não aparecem durante a produção.</p>
      <div className="choice-cards"><button className={settings.selectionMode==="AUTO"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"AUTO"})}><b>⚡ AUTOMÁTICO</b><small>ENVIA ATÉ {settings.analystCandidatesPerId} CANDIDATAS/ID AO ANALISTA</small></button><button className={settings.selectionMode==="MANUAL"?"selected":""} onClick={()=>setSettings({...settings,selectionMode:"MANUAL"})}><b>◉ REVISÃO RÁPIDA</b><small>VOCÊ ESCOLHE UMA CANDIDATA POR ID</small></button></div>
      <div className="choice-cards"><button className={settings.youtubeParallel?"selected":""} onClick={()=>setSettings({...settings,youtubeParallel:true})}><b>▶ METADADOS EM PARALELO</b><small>CHAMA O CORVO YOUTUBE EM PARALELO AO FLOW</small></button><button className={!settings.youtubeParallel?"selected":""} onClick={()=>setSettings({...settings,youtubeParallel:false})}><b>○ METADADOS DESATIVADOS</b><small>PODE SER ATIVADO QUANDO O GPT YOUTUBE ESTIVER PRONTO</small></button></div>
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
          <a className="download-card" href="/downloads/CORVO_FLOW_AGENT_V4_2_9_AUTO.zip" download><span>⌁</span><div><b>FLOW AGENT AUTOMÁTICO</b><small>V4.2.9 · APP DELIVERY 1.1 · SEM DOWNLOAD INDIVIDUAL</small></div><i>↓</i></a><a className="download-card" href="/downloads/CORVO_COLLECTOR_V080_EXTENSION.zip" download><span>⌁</span><div><b>EXTENSÃO DE IMAGENS</b><small>CORVO COLLECTOR V0.8.0</small></div><i>↓</i></a>
          <a className="download-card" href="/downloads/CORVO_BRIDGE_V0636_EXTENSION.zip" download><span>↗</span><div><b>EXTENSÃO DO BRIDGE</b><small>CORVO BRIDGE V0.6.36 · BACKUP/IMPORTAÇÃO DE GPTs + CAPTURA A/B</small></div><i>↓</i></a>
          <a className="download-card featured" href="/downloads/CORVOQUIZ_KIT_COMPLETO_V0653.zip" download><span>◆</span><div><b>KIT COMPLETO CORVOQUIZ</b><small>APP + EXTENSÕES + SCHEMA</small></div><i>↓</i></a>
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
        <div className="workflow-file-head"><span>{workflowKind==="ROTEIRO"?"ROTEIRO.TXT":"PROMPTS.TXT"}</span><small>{workflowKind==="PROMPTS"?`${parseGuideText(workflowOutput).length} IMAGENS IDENTIFICADAS`:"TEXTO COMPLETO RECEBIDO"}</small></div>
        <pre className="workflow-output">{workflowOutput}</pre>
        <div className="workflow-actions"><button onClick={()=>runSpecialist(workflowKind)}>↻ PEDIR OUTRO</button><button onClick={()=>downloadTextFile(workflowKind==="ROTEIRO"?`${active.id}_ROTEIRO.txt`:`${active.id}_PROMPTS.txt`,workflowOutput)}>↓ BAIXAR TXT</button></div>
        <button className="modal-submit" onClick={approveWorkflow}>{workflowKind==="ROTEIRO"?"APROVAR E CRIAR PROMPTS":"APROVAR E IR PARA IMAGENS"} <span>→</span></button>
      </> : <div className="workflow-wait"><p>Esta etapa ainda não foi iniciada.</p><button className="modal-submit" onClick={()=>runSpecialist(workflowKind)}>COMEÇAR AGORA <span>→</span></button></div>}
    </section></div>}

    <iframe ref={formaFrameRef} src="/forma?embedded=1" title="Forma automation engine" className="forma-automation-frame" aria-hidden="true" tabIndex={-1} />

    {imageOpen && <div className="modal-backdrop image-backdrop"><section className={`image-modal phase-${imagePhase}`}>
      <button className="modal-close" onClick={()=>setImageOpen(false)} aria-label="Ocultar janela">×</button>
      {imagePhase==="review" && currentGroup && currentRank ? <>
        <div className="review-top"><div><span className="modal-kicker">SELEÇÃO RÁPIDA · {groupIndex+1}/{groups.length}</span><h2>{currentGroup.query}</h2></div><div className="review-counter">CENA {String(groupIndex+1).padStart(2,"0")}</div></div>
        <div className="review-layout"><div className="candidate-stage"><img src={currentRank.candidate.previewUrl} alt={currentGroup.query} referrerPolicy="no-referrer" /><div className="image-quality"><span>{currentRank.candidate.width||"—"} × {currentRank.candidate.height||"—"}</span><span>OPÇÃO {candidatePos+1}/{currentGroup.ranked.length}</span></div></div><aside className="review-side"><span className="review-label">ESTA IMAGEM FUNCIONA?</span><p>Escolha rapidamente. O Corvo guarda reservas e prepara os nomes automaticamente.</p><button className="use-image" onClick={useCurrentCandidate}>✓ USAR ESTA IMAGEM</button><button className="next-image" onClick={()=>setCandidatePos((value)=>Math.min(value+1,currentGroup.ranked.length-1))}>VER PRÓXIMA <span>→</span></button><button className="search-more" disabled={searchingMore} onClick={searchMore}>{searchingMore?"PROCURANDO...":"↻ PROCURAR MAIS"}</button><div className="thumb-strip">{currentGroup.ranked.slice(0,4).map((rank,index)=><button className={candidatePos===index?"active":""} onClick={()=>setCandidatePos(index)} key={candidateUrl(rank.candidate)}><img src={rank.candidate.previewUrl} alt="" referrerPolicy="no-referrer"/></button>)}</div></aside></div>
      </> : <div className="image-status-view"><div className={`status-orb ${imagePhase}`}>{imagePhase==="done"?"✓":imagePhase==="error"?"!":"⌁"}</div><span className="modal-kicker">{imagePhase==="connecting"?"CONECTANDO":imagePhase==="searching"?"PRODUZINDO NO FLOW":imagePhase==="packaging"?"PREPARANDO / EXPORTANDO":imagePhase==="done"?(active?.formaStatus==="CONCLUÍDO"?"VÍDEO PRONTO":"ETAPA PRONTA"):"PRECISAMOS AJUSTAR"}</span><h2>{imagePhase==="done"?"TUDO CERTO.":imagePhase==="error"?"NÃO FOI POSSÍVEL CONTINUAR":imageMessage}</h2>{!["searching","packaging"].includes(imagePhase)&&<p>{imageMessage}</p>}<div className="image-progress"><i style={{width:`${imageProgress}%`}} /></div>{imagePhase==="searching"&&<div className="collector-live-status"><b>{imageStatusLine}</b><small>SEM LIMITE CURTO DE TEMPO · VOCÊ PODE OCULTAR ESTA JANELA E VOLTAR DEPOIS</small><button onClick={cancelFlowProduction}>PARAR FLOW</button></div>}{imagePhase==="packaging"&&<div className="collector-live-status"><b>{imageStatusLine||"ASSET RECEBIDO DO FLOW · SALVANDO NO PROJETO"}</b><small>FLOW, APP E FORMA OPERAM SEM DOWNLOAD INTERMEDIÁRIO; O ZIP FICA DISPONÍVEL COMO BACKUP.</small></div>}{imagePhase==="done"&&<><div className="package-summary">{active?.formaStatus==="CONCLUÍDO"?<><span>✓ ROTEIRO</span><span>✓ IMAGENS</span><span>✓ FORMA</span><b>{active.formaVideoName||"MP4 FINAL"}</b></>:<><span>✓ IMAGENS</span><span>✓ NOMES CONFERIDOS</span><span>✓ FLOW → APP</span><b>{packageCode||active?.packageCode}</b></>}</div><button className="modal-submit success" onClick={()=>setImageOpen(false)}>CONCLUIR ETAPA <span>→</span></button></>}{imagePhase==="error"&&<><button className="modal-submit" onClick={()=>active&&void startFlowImageProduction(active)}>RETOMAR FLOW <span>↻</span></button><button className="plain-close" onClick={()=>setImageOpen(false)}>FECHAR</button></>}</div>}
    </section></div>}
  </main>;
}
