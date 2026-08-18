import { unzipSync } from "fflate";
import type { BatchIssue, BatchQuizPlan, BatchQuizQuestion } from "./parser.ts";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
const MAX_IMAGES = 250;
const normalizePath = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\/g, "/").replace(/^\.\//, "").toLocaleLowerCase("pt-BR");
const basename = (value: string) => normalizePath(value).split("/").pop() ?? "";

function base64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

type ResolvedImage = { name: string; bytes: Uint8Array };
type ImageMaps = { exact: Map<string, ResolvedImage>; byBase: Map<string, ResolvedImage[]> };

function resolveImage(file: string, maps: ImageMaps) {
  const requested = normalizePath(file);
  const direct = maps.exact.get(requested);
  const candidates = maps.byBase.get(basename(requested)) ?? [];
  return { found: direct ?? (candidates.length === 1 ? candidates[0] : undefined), candidates };
}

function dataUrl(found: ResolvedImage) {
  const extension = found.name.split(".").pop()?.toLowerCase() ?? "png";
  return `data:${MIME[extension]};base64,${base64(found.bytes)}`;
}

function attachQuestionImages(question: BatchQuizQuestion, maps: ImageMaps, issues: BatchIssue[]): BatchQuizQuestion {
  let next = { ...question };
  const fields: Array<{ fileKey: keyof BatchQuizQuestion; srcKey: keyof BatchQuizQuestion; label: string }> = [
    { fileKey: "imageFile", srcKey: "imageSrc", label: "Imagem" },
    { fileKey: "image1File", srcKey: "image1Src", label: "Imagem 1" },
    { fileKey: "image2File", srcKey: "image2Src", label: "Imagem 2" },
    { fileKey: "resultImageFile", srcKey: "resultImageSrc", label: "Imagem de resultado" },
  ];
  for (const field of fields) {
    const file = next[field.fileKey];
    if (typeof file !== "string" || !file) continue;
    const { found, candidates } = resolveImage(file, maps);
    if (!found) {
      issues.push({ level: "error", question: question.number, message: candidates.length > 1 ? `Há mais de uma imagem chamada ${file}. Use o caminho completo no TXT.` : `${field.label} não encontrada no ZIP: ${file}.` });
      continue;
    }
    next = { ...next, [field.srcKey]: dataUrl(found) };
  }
  return next;
}


export type BatchDirectImage = { name: string; bytes: Uint8Array };

export function attachBatchFiles(plan: BatchQuizPlan, input: BatchDirectImage[]): BatchQuizPlan {
  const issues: BatchIssue[] = [...plan.issues];
  const images = input.filter((item) => MIME[item.name.split(".").pop()?.toLowerCase() ?? ""] && item.bytes?.byteLength);
  const total = images.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (images.length > MAX_IMAGES || total > 120 * 1024 * 1024) return { ...plan, issues: [...issues, { level: "error", message: `O lote excede ${MAX_IMAGES} imagens ou 120 MB de assets.` }] };
  const exact = new Map(images.map(({ name, bytes }) => [normalizePath(name), { name, bytes }]));
  const byBase = new Map<string, ResolvedImage[]>();
  for (const { name, bytes } of images) {
    const key = basename(name);
    byBase.set(key, [...(byBase.get(key) ?? []), { name, bytes }]);
  }
  const maps = { exact, byBase };
  const questions = plan.questions.map((question) => attachQuestionImages(question, maps, issues));
  return { ...plan, questions, issues };
}

export function attachBatchZip(plan: BatchQuizPlan, input: Uint8Array): BatchQuizPlan {
  const issues: BatchIssue[] = [...plan.issues];
  if (input.byteLength > 80 * 1024 * 1024) return { ...plan, issues: [...issues, { level: "error", message: "O ZIP ultrapassa o limite de 80 MB." }] };
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(input); }
  catch { return { ...plan, issues: [...issues, { level: "error", message: "Não foi possível abrir o ZIP de imagens." }] }; }
  const images = Object.entries(files).filter(([name]) => MIME[name.split(".").pop()?.toLowerCase() ?? ""]);
  const total = images.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
  if (images.length > MAX_IMAGES || total > 120 * 1024 * 1024) return { ...plan, issues: [...issues, { level: "error", message: `O ZIP excede ${MAX_IMAGES} imagens ou 120 MB descompactados.` }] };
  const exact = new Map(images.map(([name, bytes]) => [normalizePath(name), { name, bytes }]));
  const byBase = new Map<string, ResolvedImage[]>();
  for (const [name, bytes] of images) {
    const key = basename(name);
    byBase.set(key, [...(byBase.get(key) ?? []), { name, bytes }]);
  }
  const maps = { exact, byBase };
  const questions = plan.questions.map((question) => attachQuestionImages(question, maps, issues));
  return { ...plan, questions, issues };
}
