import type { RefObject } from "react";
import type { AIArtifact, AIResponse, AlignmentAudit } from "@/app/types";
import { benchmarkMemo } from "@/lib/benchmark/memo";

type AIObservabilityOutputsProps = {
  stateOutputRef: RefObject<HTMLOutputElement | null>;
  capabilitiesJson: string;
  response: AIResponse | null;
  responseJson: string;
  artifact: AIArtifact | null;
  currentProjectId: string | null;
  projectName: string;
  projectCount: number;
  projectsJson: string;
  selectedAnswerGroup: string | null;
  alignmentAudit: AlignmentAudit | null;
  alignmentJson: string;
};

export const AIObservabilityOutputs = benchmarkMemo(function AIObservabilityOutputs({ stateOutputRef, capabilitiesJson, response, responseJson, artifact, currentProjectId, projectName, projectCount, projectsJson, selectedAnswerGroup, alignmentAudit, alignmentJson }: AIObservabilityOutputsProps) {
  return (
    <>
      <output id="forma-ai-manifest" hidden data-json={capabilitiesJson} />
      <output ref={stateOutputRef} id="forma-ai-state" hidden data-json="" />
      <output id="forma-ai-response" hidden data-request-id={response?.requestId ?? ""} data-ok={response ? String(response.ok) : ""} data-json={responseJson} />
      <output id="forma-ai-artifact" hidden data-ready={artifact ? "true" : "false"} data-id={artifact?.id ?? ""} data-name={artifact?.name ?? ""} data-kind={artifact?.kind ?? ""} data-mime={artifact?.mime ?? ""} data-size={artifact?.size ?? ""} data-width={artifact?.width ?? ""} data-height={artifact?.height ?? ""} data-duration={artifact?.duration ?? ""} data-created-at={artifact?.createdAt ?? ""} data-download-url={artifact?.downloadUrl ?? ""} data-url={artifact?.dataUrl ?? ""} />
      <output id="forma-ai-projects" hidden data-current-id={currentProjectId ?? ""} data-current-name={projectName} data-count={projectCount} data-json={projectsJson} />
      <output id="forma-ai-alignment" hidden data-group-id={selectedAnswerGroup ?? ""} data-ok={alignmentAudit ? String(alignmentAudit.ok) : ""} data-score={alignmentAudit?.score ?? ""} data-json={alignmentJson} />
    </>
  );
});
