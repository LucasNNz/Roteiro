import type { Shape } from "../../app/types.ts";
import { cloneShapes } from "../geometry.ts";

export async function blobDataUrl(blob: Blob, createReader: () => FileReader = () => new FileReader()) {
  return await new Promise<string>((resolve, reject) => {
    const reader = createReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function embedImageSources(sourceShapes: Shape[], deps: { origin: string; fetch: typeof fetch; toDataUrl?: (blob: Blob) => Promise<string> }) {
  const embedded = cloneShapes(sourceShapes);
  const sources = [...new Set(embedded.flatMap((shape) => [shape.src, shape.imageSrc]).filter((source): source is string => Boolean(source && !source.startsWith("data:"))))];
  for (const source of sources) {
    const absolute = source.startsWith("/") ? `${deps.origin}${source}` : source;
    try {
      const response = await deps.fetch(absolute);
      if (!response.ok) continue;
      const dataUrl = await (deps.toDataUrl ?? blobDataUrl)(await response.blob());
      embedded.forEach((shape) => {
        if (shape.src === source || shape.src === absolute) shape.src = dataUrl;
        if (shape.imageSrc === source || shape.imageSrc === absolute) shape.imageSrc = dataUrl;
      });
    } catch { /* mantém a referência original se o recurso externo não puder ser incorporado */ }
  }
  return embedded;
}


/**
 * Incorpora imagens de várias cenas com uma única leitura por asset.
 * Em projetos longos, muitos presets reutilizam os mesmos botões/ícones;
 * buscar e converter o mesmo arquivo cena por cena aumenta tempo, rede e RAM.
 */
export async function embedImageSourceSets(
  sourceShapeSets: Shape[][],
  deps: { origin: string; fetch: typeof fetch; toDataUrl?: (blob: Blob) => Promise<string>; concurrency?: number },
) {
  const embeddedSets = sourceShapeSets.map((shapes) => cloneShapes(shapes));
  const sources = [...new Set(embeddedSets.flatMap((shapes) => shapes.flatMap((shape) => [shape.src, shape.imageSrc]).filter((source): source is string => Boolean(source && !source.startsWith("data:")))) )];
  const replacements = new Map<string, string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      const absolute = source.startsWith("/") ? `${deps.origin}${source}` : source;
      try {
        const response = await deps.fetch(absolute);
        if (!response.ok) continue;
        const dataUrl = await (deps.toDataUrl ?? blobDataUrl)(await response.blob());
        replacements.set(source, dataUrl);
        replacements.set(absolute, dataUrl);
      } catch { /* mantém a referência original */ }
    }
  };
  const workerCount = Math.max(1, Math.min(6, Math.floor(deps.concurrency ?? 4), sources.length || 1));
  await Promise.all(Array.from({ length: workerCount }, worker));
  for (const shapes of embeddedSets) {
    for (const shape of shapes) {
      if (shape.src && replacements.has(shape.src)) shape.src = replacements.get(shape.src);
      if (shape.imageSrc && replacements.has(shape.imageSrc)) shape.imageSrc = replacements.get(shape.imageSrc);
    }
  }
  return embeddedSets;
}
