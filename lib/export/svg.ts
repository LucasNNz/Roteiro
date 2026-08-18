import type { Shape } from "../../app/types.ts";
import { brushPath, escapeXml, hasVisualAdjustments, mediaGeometry } from "../geometry.ts";
import { renderableProgressIconSource } from "../scenes/progress-icon.ts";

export function serializeSvg({ shapes, width, height, background, backgroundImage, origin }: { shapes: Shape[]; width: number; height: number; background: string; backgroundImage?: string; origin: string }) {
  const defs = shapes.filter((shape) => shape.fill2 || hasVisualAdjustments(shape) || shape.type === "image" || shape.type === "brush" || shape.imageSrc).map((shape) => {
    const gradient = shape.fill2 ? `<linearGradient id="gradient-${shape.id}" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${shape.gradientAngle ?? 0} .5 .5)"><stop offset="0" stop-color="${shape.fill}"/><stop offset="1" stop-color="${shape.fill2}"/></linearGradient>` : "";
    const brightness = Math.max(0, Math.min(2, (shape.brightness ?? 100) / 100));
    const contrast = Math.max(0, Math.min(2, (shape.contrast ?? 100) / 100));
    const matrix = shape.colorMatrix?.length === 20 ? `<feColorMatrix type="matrix" values="${shape.colorMatrix.join(" ")}"/>` : "";
    const visualFilter = hasVisualAdjustments(shape) ? `<filter id="visual-${shape.id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="${brightness * contrast}" intercept="${(.5 - .5 * contrast) * brightness}"/><feFuncG type="linear" slope="${brightness * contrast}" intercept="${(.5 - .5 * contrast) * brightness}"/><feFuncB type="linear" slope="${brightness * contrast}" intercept="${(.5 - .5 * contrast) * brightness}"/></feComponentTransfer><feColorMatrix type="saturate" values="${Math.max(0, Math.min(2, (shape.saturation ?? 100) / 100))}"/><feColorMatrix type="hueRotate" values="${shape.hue ?? 0}"/>${matrix}${shape.shadowColor && (shape.shadowBlur ?? 0) > 0 ? `<feDropShadow dx="${shape.shadowX ?? 0}" dy="${shape.shadowY ?? 0}" stdDeviation="${(shape.shadowBlur ?? 0) / 2}" flood-color="${shape.shadowColor}"/>` : ""}</filter>` : "";
    const brushFilter = shape.type === "brush" ? `<filter id="brush-texture-${shape.id}" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.045" numOctaves="2" seed="17" result="brushNoise"/><feDisplacementMap in="SourceGraphic" in2="brushNoise" scale="${Math.max(10, Math.min(shape.w, shape.h) * .018)}" xChannelSelector="R" yChannelSelector="G" result="texturedBrush"/>${shape.shadowColor && (shape.shadowBlur ?? 0) > 0 ? `<feDropShadow in="texturedBrush" dx="${shape.shadowX ?? 0}" dy="${shape.shadowY ?? 0}" stdDeviation="${(shape.shadowBlur ?? 0) / 2}" flood-color="${shape.shadowColor}"/>` : ""}</filter>` : "";
    const clip = shape.type === "image" || shape.imageSrc ? `<clipPath id="clip-${shape.id}">${shape.type === "ellipse" ? `<ellipse cx="${shape.x + shape.w / 2}" cy="${shape.y + shape.h / 2}" rx="${shape.w / 2}" ry="${shape.h / 2}"/>` : `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}"/>`}</clipPath>` : "";
    return gradient + visualFilter + brushFilter + clip;
  }).join("");
  const body = shapes.filter((shape) => shape.visible !== false && shape.type !== "empty").map((shape) => {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const transform = `rotate(${shape.rotation} ${cx} ${cy})`;
    const outline = shape.strokeWidth ? ` stroke="${shape.stroke ?? "#13151A"}" stroke-width="${shape.strokeWidth}"` : "";
    const visual = ` opacity="${shape.opacity ?? 1}"${shape.type === "brush" ? ` filter="url(#brush-texture-${shape.id})"` : hasVisualAdjustments(shape) ? ` filter="url(#visual-${shape.id})"` : ""}`;
    const fill = shape.fill2 ? `url(#gradient-${shape.id})` : shape.fill;
    if (shape.type === "image") {
      const renderableSource = renderableProgressIconSource(shape.src);
      const imageHref = renderableSource?.startsWith("/") ? `${origin}${renderableSource}` : renderableSource;
      const media = mediaGeometry(shape);
      return `<image href="${imageHref}" x="${media.x}" y="${media.y}" width="${media.w}" height="${media.h}" preserveAspectRatio="xMidYMid ${shape.objectFit === "contain" ? "meet" : "slice"}" clip-path="url(#clip-${shape.id})" transform="${transform}"${visual}/>`;
    }
    if (shape.type === "text") {
      const lines = (shape.text ?? "").split(/\r?\n/);
      const lineHeight = (shape.fontSize ?? 120) * (shape.lineHeight ?? 1.08);
      const firstY = cy - ((lines.length - 1) * lineHeight) / 2;
      const tspans = lines.map((line, index) => `<tspan x="${cx}" y="${firstY + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
      return `<text text-anchor="middle" dominant-baseline="middle" font-family="Montserrat, sans-serif" font-size="${shape.fontSize ?? 120}" font-weight="${shape.fontWeight ?? 700}" letter-spacing="${shape.letterSpacing ?? 0}" fill="${fill}"${outline} paint-order="stroke fill" stroke-linejoin="round" transform="${transform}"${visual}>${tspans}</text>`;
    }
    if (shape.type === "brush") {
      return `<path d="${brushPath(shape)}" fill="${fill}"${outline} transform="${transform}"${visual}/>`;
    }
    if (shape.imageSrc && (shape.type === "rect" || shape.type === "ellipse")) {
      const imageHref = shape.imageSrc.startsWith("/") ? `${origin}${shape.imageSrc}` : shape.imageSrc;
      const media = mediaGeometry(shape);
      const base = shape.type === "rect" ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}" fill="${fill}"/>` : `<ellipse cx="${cx}" cy="${cy}" rx="${shape.w / 2}" ry="${shape.h / 2}" fill="${fill}"/>`;
      const border = shape.type === "rect" ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}" fill="none"${outline}/>` : `<ellipse cx="${cx}" cy="${cy}" rx="${shape.w / 2}" ry="${shape.h / 2}" fill="none"${outline}/>`;
      return `<g transform="${transform}"${visual}>${base}<image href="${imageHref}" x="${media.x}" y="${media.y}" width="${media.w}" height="${media.h}" preserveAspectRatio="xMidYMid ${shape.objectFit === "contain" ? "meet" : "slice"}" clip-path="url(#clip-${shape.id})"/>${border}</g>`;
    }
    return shape.type === "rect"
      ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}" fill="${fill}"${outline} transform="${transform}"${visual}/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${shape.w / 2}" ry="${shape.h / 2}" fill="${fill}"${outline} transform="${transform}"${visual}/>`;
  }).join("");
  const backgroundMedia = backgroundImage ? `<image href="${backgroundImage.startsWith("/") ? `${origin}${backgroundImage}` : backgroundImage}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs><rect width="100%" height="100%" fill="${background}"/>${backgroundMedia}${body}</svg>`;
}
