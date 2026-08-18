export type BrowserExportRuntime = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createImage: () => HTMLImageElement;
  createCanvas: () => HTMLCanvasElement;
  createLink: () => HTMLAnchorElement;
  appendLink: (link: HTMLAnchorElement) => void;
  scheduleTimeout: (callback: () => void, delay: number) => unknown;
};

function browserRuntime(): BrowserExportRuntime {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createImage: () => new Image(),
    createCanvas: () => document.createElement("canvas"),
    createLink: () => document.createElement("a"),
    appendLink: (link) => document.body.appendChild(link),
    scheduleTimeout: (callback, delay) => setTimeout(callback, delay),
  };
}

export async function saveBlob(blob: Blob, filename: string, runtime = browserRuntime()) {
  const url = runtime.createObjectURL(blob);
  const link = runtime.createLink();
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  runtime.appendLink(link);
  link.click();
  link.remove();
  runtime.scheduleTimeout(() => runtime.revokeObjectURL(url), 1000);
}

export async function loadSvgAsImage(svg: string, runtime = browserRuntime()) {
  const load = async (source: string) => {
    const image = runtime.createImage();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      const timeout = typeof window !== "undefined" ? window.setTimeout(() => finish(new Error("Um frame demorou demais para ser convertido. Tente exportar novamente.")), 15_000) : null;
      const settle = (error?: Error) => { if (timeout !== null) window.clearTimeout(timeout); finish(error); };
      image.onload = () => settle();
      image.onerror = () => settle(new Error("Falha ao converter o frame do canvas."));
      image.src = source;
    });
    return image;
  };
  const blobUrl = runtime.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    return await load(blobUrl);
  } catch {
    return await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  } finally {
    runtime.revokeObjectURL(blobUrl);
  }
}

export async function renderSvgPngBlob(svg: string, width: number, height: number, scale: number, runtime = browserRuntime()) {
  const svgUrl = runtime.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = runtime.createImage();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = svgUrl; });
  const canvas = runtime.createCanvas();
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  runtime.revokeObjectURL(svgUrl);
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
}
