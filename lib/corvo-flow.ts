export const CORVO_FLOW_MANAGER_BASE = "http://127.0.0.1:32145";

export type FlowManagerJob = {
  id:string; jobId:string; slot:string; arquivoFinal:string;
  managerStatus:string; workerStatus?:string; assignedProfileId?:string; lastProfileId?:string;
  errorCode?:string; nextAction?:string; file?:string;
  appDelivery?:boolean; appAssetReady?:boolean; appAssetSize?:number; appAssetContentType?:string; appAssetFile?:string;
};

export type FlowManagerBatch = {
  batchId:string; projectId:string; status:string; result?:string; total:number; done:number; failed:number; pending:number;
  jobs:FlowManagerJob[];
};

export type FlowManagerState = {
  version:string;
  control?:{ running?:boolean; lastAction?:string };
  orchestration?:Record<string,number>;
  batches:FlowManagerBatch[];
};

async function flowFetch<T>(path:string, init?:RequestInit):Promise<T> {
  const response = await fetch(`${CORVO_FLOW_MANAGER_BASE}${path}`, { cache:"no-store", ...init });
  const type = response.headers.get("content-type") || "";
  const payload:any = type.includes("application/json") ? await response.json().catch(() => ({})) : await response.text().catch(() => "");
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.error || payload?.message || `FLOW_HTTP_${response.status}`;
    const error = new Error(String(message || `FLOW_HTTP_${response.status}`));
    (error as Error & {status?:number}).status = response.status;
    throw error;
  }
  return payload as T;
}

export async function probeFlowManager() {
  return flowFetch<{ok:boolean;version:string;appIntegration?:string}>("/health");
}

export async function getFlowManagerState() {
  const result = await flowFetch<{ok:boolean;state:FlowManagerState}>("/api/state");
  return result.state;
}

export async function addFlowBatch(text:string, name:string) {
  return flowFetch<{ok:boolean;batchId:string;jobs:number}>("/api/batch/add", {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, name }),
  });
}

export async function startFlowManager() {
  return flowFetch<{ok:boolean}>("/api/control", {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ action:"start", mode:"APP" }),
  });
}

export async function stopFlowManager() {
  return flowFetch<{ok:boolean}>("/api/control", {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ action:"stop" }),
  });
}

export async function fetchFlowAsset(batchId:string, jobId:string) {
  const response = await fetch(`${CORVO_FLOW_MANAGER_BASE}/api/batch/asset?batchId=${encodeURIComponent(batchId)}&jobId=${encodeURIComponent(jobId)}`, { cache:"no-store" });
  if (!response.ok) throw new Error(`FLOW_ASSET_HTTP_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("FLOW_ASSET_EMPTY");
  return blob;
}

export async function getFlowBatchManifest(batchId:string) {
  return flowFetch<{ok:boolean;batchId:string;filename:string;complete:boolean;manifest:string}>(`/api/batch/manifest?batchId=${encodeURIComponent(batchId)}`);
}

export function requestFlowAgentStart() {
  if (typeof window === "undefined") return;
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  frame.src = "corvoflow://start";
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 1800);
}

export async function ensureFlowAgentReady(options:{attempts?:number;delayMs?:number} = {}) {
  const attempts = Math.max(1, options.attempts ?? 12);
  const delayMs = Math.max(250, options.delayMs ?? 650);
  try {
    const ready = await probeFlowManager();
    if (ready?.ok) return ready;
  } catch (_) {}

  requestFlowAgentStart();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const ready = await probeFlowManager();
      if (ready?.ok) return ready;
    } catch (_) {}
  }
  throw new Error("FLOW_AGENT_NOT_INSTALLED_OR_UNAVAILABLE");
}
