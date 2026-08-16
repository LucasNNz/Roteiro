export type CorvoBridgePayload = {
  jobId: string;
  prompt: string;
  specialist?: string;
  meta?: Record<string, unknown>;
};

type BridgeAck = { ok?: boolean; jobId?: string; error?: string };

export function dispatchCorvoBridge(payload: CorvoBridgePayload, timeoutMs = Array.isArray(payload.meta?.attachments) && payload.meta.attachments.length ? 12 * 60 * 1000 : 150000) {
  return new Promise<BridgeAck>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("CORVO_BRIDGE_NOT_AVAILABLE"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_ACK") return;
      const ack = (event.data.payload || {}) as BridgeAck;
      if (ack.jobId && ack.jobId !== payload.jobId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (ack.ok) resolve(ack);
      else reject(new Error(ack.error || "CORVO_BRIDGE_ERROR"));
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "CORVOQUIZ", type: "CORVO_BRIDGE_DISPATCH", payload }, "*");
  });
}

export function completeCorvoBridgeJob(jobId: string, timeoutMs = 3500) {
  return new Promise<BridgeAck>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("CORVO_BRIDGE_COMPLETE_TIMEOUT"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_COMPLETE_ACK") return;
      const ack = (event.data.payload || {}) as BridgeAck;
      if (ack.jobId && ack.jobId !== jobId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (ack.ok) resolve(ack);
      else reject(new Error(ack.error || "CORVO_BRIDGE_COMPLETE_ERROR"));
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "CORVOQUIZ", type: "CORVO_BRIDGE_JOB_COMPLETE", payload: { jobId } }, "*");
  });
}

export function captureCorvoBridgeFile(jobId: string, name: string, type = "THUMBNAIL", timeoutMs = 180000) {
  return new Promise<BridgeAck>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("CORVO_BRIDGE_CAPTURE_TIMEOUT"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_CAPTURE_ACK") return;
      const ack = (event.data.payload || {}) as BridgeAck;
      if (ack.jobId && ack.jobId !== jobId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (ack.ok) resolve(ack);
      else reject(new Error(ack.error || "CORVO_BRIDGE_CAPTURE_ERROR"));
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "CORVOQUIZ", type: "CORVO_BRIDGE_CAPTURE_FILE", payload: { jobId, name, type } }, "*");
  });
}
