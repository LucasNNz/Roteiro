export type CorvoBridgePayload = {
  jobId: string;
  prompt: string;
  specialist?: string;
  meta?: Record<string, unknown>;
};

type BridgeAck = { ok?: boolean; jobId?: string; error?: string; conversationUrl?: string; closed?: boolean };

export function dispatchCorvoBridge(payload: CorvoBridgePayload, timeoutMs?: number) {
  const hasAttachments = Array.isArray(payload.meta?.attachments) && payload.meta.attachments.length > 0;
  const idleTimeout = timeoutMs || (hasAttachments ? 4 * 60 * 1000 : 150000);
  const hardTimeout = hasAttachments ? 25 * 60 * 1000 : Math.max(idleTimeout, 4 * 60 * 1000);

  return new Promise<BridgeAck>((resolve, reject) => {
    let idleTimer = 0;
    const hardTimer = window.setTimeout(() => finishError("CORVO_BRIDGE_HARD_TIMEOUT"), hardTimeout);

    function armIdleTimer() {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => finishError("CORVO_BRIDGE_PROGRESS_TIMEOUT"), idleTimeout);
    }

    function cleanup() {
      if (idleTimer) window.clearTimeout(idleTimer);
      window.clearTimeout(hardTimer);
      window.removeEventListener("message", onMessage);
    }

    function finishError(code:string) {
      cleanup();
      reject(new Error(code));
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE") return;

      if (event.data?.type === "CORVO_BRIDGE_STATUS") {
        const status = event.data?.payload || {};
        if (String(status.jobId || "") === payload.jobId) armIdleTimer();
        return;
      }

      if (event.data?.type !== "CORVO_BRIDGE_ACK") return;
      const ack = (event.data.payload || {}) as BridgeAck;
      if (ack.jobId && ack.jobId !== payload.jobId) return;
      cleanup();
      if (ack.ok) resolve(ack);
      else reject(new Error(ack.error || "CORVO_BRIDGE_ERROR"));
    }

    window.addEventListener("message", onMessage);
    armIdleTimer();
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

export type CorvoBridgeJobActivity = {
  jobId:string;
  projectId?:string;
  specialist?:string;
  state?:string;
  message?:string;
  updatedAt?:number;
  tabId?:number|null;
  tabStatus?:string;
  active?:boolean;
  conversationUrl?:string;
  bridgeOwned?:boolean;
  batchId?:string;
  batchSize?:number;
};

export function getCorvoBridgeJobActivity(timeoutMs = 3500) {
  return new Promise<{ok?:boolean;jobs?:CorvoBridgeJobActivity[];error?:string}>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("CORVO_BRIDGE_JOB_ACTIVITY_TIMEOUT"));
    }, timeoutMs);
    function onMessage(event:MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_JOB_ACTIVITY_ACK") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      const payload = event.data.payload || {};
      if (payload.ok) resolve(payload);
      else reject(new Error(payload.error || "CORVO_BRIDGE_JOB_ACTIVITY_ERROR"));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source:"CORVOQUIZ", type:"CORVO_BRIDGE_GET_JOB_ACTIVITY" }, "*");
  });
}

export function focusCorvoBridgeJob(jobId:string, timeoutMs = 3500) {
  return new Promise<{ok?:boolean;jobId?:string;conversationUrl?:string;error?:string}>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("CORVO_BRIDGE_FOCUS_JOB_TIMEOUT"));
    }, timeoutMs);
    function onMessage(event:MessageEvent) {
      if (event.source !== window || event.data?.source !== "CORVO_BRIDGE" || event.data?.type !== "CORVO_BRIDGE_FOCUS_JOB_ACK") return;
      const payload = event.data.payload || {};
      if (payload.jobId && payload.jobId !== jobId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (payload.ok) resolve(payload);
      else reject(new Error(payload.error || "CORVO_BRIDGE_FOCUS_JOB_ERROR"));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source:"CORVOQUIZ", type:"CORVO_BRIDGE_FOCUS_JOB", payload:{ jobId } }, "*");
  });
}
