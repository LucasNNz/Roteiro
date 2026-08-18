import type { FormaProject } from "../../app/types.ts";
import { serializeProject } from "./serialization.ts";

export function createProjectManifest(project: FormaProject) {
  return { schema: "forma-bundle/1.0", project: "project.forma.json", preview: "preview.svg", createdAt: project.updatedAt, compatibleWith: "forma-ai/4.3" };
}

export function createProjectBundleFiles(project: FormaProject, previewSvg: string) {
  return {
    "project.forma.json": serializeProject(project),
    "manifest.json": JSON.stringify(createProjectManifest(project), null, 2),
    "preview.svg": previewSvg,
  };
}
