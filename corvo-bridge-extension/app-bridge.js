(() => {
  const BRIDGE_VERSION = "0.6.34";

  function errorMessage(error) {
    return String(error?.message || error || "BRIDGE_ERROR");
  }

  function isContextInvalidated(error) {
    return /extension context invalidated|context invalidated|extension_context_invalidated/i.test(errorMessage(error));
  }

  function postContextInvalidated(error, operation = "UNKNOWN", jobId = null) {
    window.postMessage({
      source: "CORVO_BRIDGE",
      type: "CORVO_BRIDGE_CONTEXT_INVALIDATED",
      payload: {
        ok: false,
        version: BRIDGE_VERSION,
        operation,
        jobId: jobId || null,
        error: "EXTENSION_CONTEXT_INVALIDATED",
        detail: errorMessage(error),
        at: Date.now()
      }
    }, "*");
  }

  function contextAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  async function runtimeSend(message, operation = "UNKNOWN", jobId = null) {
    try {
      if (!contextAlive()) throw new Error("EXTENSION_CONTEXT_INVALIDATED");
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isContextInvalidated(error) || !contextAlive()) postContextInvalidated(error, operation, jobId);
      throw error;
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "CORVOQUIZ") return;

    if (msg.type === "CORVO_BRIDGE_PING_APP") {
      if (!contextAlive()) {
        postContextInvalidated(new Error("EXTENSION_CONTEXT_INVALIDATED"), "PING_APP", null);
        return;
      }
      window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_PONG_APP", payload:{ ok:true, version:BRIDGE_VERSION, at:Date.now() } }, "*");
      return;
    }

    if (msg.type === "CORVO_BRIDGE_DISPATCH") {
      const payload = msg.payload || {};
      if (!payload.prompt || typeof payload.prompt !== "string") {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: "INVALID_PAYLOAD" } }, "*");
        return;
      }
      try {
        const response = await runtimeSend({ type: "CORVO_DISPATCH_FROM_APP", payload }, "DISPATCH", payload.jobId || null);
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ...response, jobId: payload.jobId || response?.jobId || null } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: isContextInvalidated(error) ? "EXTENSION_CONTEXT_INVALIDATED" : (errorMessage(error) || "BRIDGE_ERROR") } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_GET_STATUS") {
      try {
        const status = await runtimeSend({ type: "CORVO_GET_STATUS" }, "GET_STATUS", null);
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_STATUS", payload: status }, "*");
      } catch (error) {
        if (!isContextInvalidated(error)) window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_STATUS", payload:{ ok:false, error:errorMessage(error) } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_GET_JOB_ACTIVITY") {
      try {
        const response = await runtimeSend({ type:"CORVO_GET_JOB_ACTIVITY" }, "GET_JOB_ACTIVITY", null);
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_JOB_ACTIVITY_ACK", payload:response || {} }, "*");
      } catch (error) {
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_JOB_ACTIVITY_ACK", payload:{ ok:false, error:isContextInvalidated(error) ? "EXTENSION_CONTEXT_INVALIDATED" : (errorMessage(error) || "JOB_ACTIVITY_FAILED") } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_FOCUS_JOB") {
      const jobId = String(msg.payload?.jobId || "").trim();
      try {
        const response = await runtimeSend({ type:"CORVO_FOCUS_JOB", payload:{ jobId } }, "FOCUS_JOB", jobId);
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_FOCUS_JOB_ACK", payload:{ ...(response || {}), jobId } }, "*");
      } catch (error) {
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_FOCUS_JOB_ACK", payload:{ ok:false, jobId, error:isContextInvalidated(error) ? "EXTENSION_CONTEXT_INVALIDATED" : (errorMessage(error) || "FOCUS_JOB_FAILED") } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_JOB_COMPLETE") {
      const jobId = String(msg.payload?.jobId || "").trim();
      if (!jobId) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ok: false, error: "JOB_ID_REQUIRED" } }, "*");
        return;
      }
      try {
        const response = await runtimeSend({ type: "CORVO_JOB_COMPLETE", payload: { jobId } }, "JOB_COMPLETE", jobId);
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ...response, jobId } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ok: false, jobId, error: isContextInvalidated(error) ? "EXTENSION_CONTEXT_INVALIDATED" : (errorMessage(error) || "BRIDGE_ERROR") } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_CAPTURE_FILE") {
      const payload = msg.payload || {};
      try {
        const response = await runtimeSend({ type: "CORVO_CAPTURE_AND_UPLOAD", payload }, "CAPTURE_FILE", payload.jobId || null);
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_CAPTURE_ACK", payload: { ...response, jobId: payload.jobId || null } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_CAPTURE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: isContextInvalidated(error) ? "EXTENSION_CONTEXT_INVALIDATED" : (errorMessage(error) || "FILE_CAPTURE_FAILED") } }, "*");
      }
    }
  });

  try {
    if (contextAlive()) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === "CORVO_BRIDGE_STATUS") {
          window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_STATUS", payload: message.payload || {} }, "*");
        }
      });
    } else {
      postContextInvalidated(new Error("EXTENSION_CONTEXT_INVALIDATED"), "LISTENER_INIT", null);
    }
  } catch (error) {
    postContextInvalidated(error, "LISTENER_INIT", null);
  }

  window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_READY", payload: { version: BRIDGE_VERSION } }, "*");
})();
