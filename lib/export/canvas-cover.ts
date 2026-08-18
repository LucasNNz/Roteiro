export type CoverCropRect = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

/**
 * Calcula o recorte central equivalente a CSS object-fit: cover.
 * O source nunca é deformado: apenas ampliado e recortado para preencher
 * completamente o destino.
 */
export function coverCropRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): CoverCropRect {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const tw = Math.max(1, Number(targetWidth) || 1);
  const th = Math.max(1, Number(targetHeight) || 1);
  const sourceAspect = sw / sh;
  const targetAspect = tw / th;

  if (Math.abs(sourceAspect - targetAspect) <= 1e-9) return { sx: 0, sy: 0, sw, sh };

  if (sourceAspect > targetAspect) {
    // Source mais largo que o destino: preserva toda a altura e corta laterais.
    const cropWidth = sh * targetAspect;
    return { sx: (sw - cropWidth) / 2, sy: 0, sw: cropWidth, sh };
  }

  // Source mais alto/estreito que o destino: preserva toda a largura e corta topo/baixo.
  const cropHeight = sw / targetAspect;
  return { sx: 0, sy: (sh - cropHeight) / 2, sw, sh: cropHeight };
}

function canvasImageSourceDimensions(source: CanvasImageSource) {
  const media = source as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  const width = Number(media.videoWidth) || Number(media.naturalWidth) || Number(media.displayWidth) || Number(media.width) || 0;
  const height = Number(media.videoHeight) || Number(media.naturalHeight) || Number(media.displayHeight) || Number(media.height) || 0;
  return { width, height };
}

/** Desenha um CanvasImageSource com o mesmo enquadramento do preview (.canvas-background-video { object-fit: cover }). */
export function drawCanvasImageCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const { width, height } = canvasImageSourceDimensions(source);
  if (width <= 0 || height <= 0) {
    // Fallback defensivo para fontes sem dimensões expostas pelo navegador.
    context.drawImage(source, dx, dy, dw, dh);
    return;
  }
  const crop = coverCropRect(width, height, dw, dh);
  context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, dw, dh);
}
