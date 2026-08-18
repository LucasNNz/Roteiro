export const LEGACY_PROGRESS_ICON_SOURCE = "/progress-question-cube.svg";
export const DEFAULT_PROGRESS_ICON_SOURCE = "/progress-question-cube.png";

export function renderableProgressIconSource(source?: string) {
  return source === LEGACY_PROGRESS_ICON_SOURCE ? DEFAULT_PROGRESS_ICON_SOURCE : source;
}
