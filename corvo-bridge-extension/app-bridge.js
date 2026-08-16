(() => {
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "CORVOQUIZ") return;

    if (msg.type === "CORVO_BRIDGE_DISPATCH") {
      const payload = msg.payload || {};
      if (!payload.prompt || typeof payload.prompt !== "string") {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: "INVALID_PAYLOAD" } }, "*");
        return;
      }
      try {
        const response = await chrome.runtime.sendMessage({ type: "CORVO_DISPATCH_FROM_APP", payload });
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ...response, jobId: payload.jobId || response?.jobId || null } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: error.message || "BRIDGE_ERROR" } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_GET_STATUS") {
      try {
        const status = await chrome.runtime.sendMessage({ type: "CORVO_GET_STATUS" });
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_STATUS", payload: status }, "*");
      } catch {}
    }

    if (msg.type === "CORVO_BRIDGE_GET_JOB_ACTIVITY") {
      try {
        const response = await chrome.runtime.sendMessage({ type:"CORVO_GET_JOB_ACTIVITY" });
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_JOB_ACTIVITY_ACK", payload:response || {} }, "*");
      } catch (error) {
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_JOB_ACTIVITY_ACK", payload:{ ok:false, error:error.message || "JOB_ACTIVITY_FAILED" } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_FOCUS_JOB") {
      const jobId = String(msg.payload?.jobId || "").trim();
      try {
        const response = await chrome.runtime.sendMessage({ type:"CORVO_FOCUS_JOB", payload:{ jobId } });
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_FOCUS_JOB_ACK", payload:{ ...(response || {}), jobId } }, "*");
      } catch (error) {
        window.postMessage({ source:"CORVO_BRIDGE", type:"CORVO_BRIDGE_FOCUS_JOB_ACK", payload:{ ok:false, jobId, error:error.message || "FOCUS_JOB_FAILED" } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_JOB_COMPLETE") {
      const jobId = String(msg.payload?.jobId || "").trim();
      if (!jobId) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ok: false, error: "JOB_ID_REQUIRED" } }, "*");
        return;
      }
      try {
        const response = await chrome.runtime.sendMessage({ type: "CORVO_JOB_COMPLETE", payload: { jobId } });
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ...response, jobId } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_COMPLETE_ACK", payload: { ok: false, jobId, error: error.message || "BRIDGE_ERROR" } }, "*");
      }
    }

    if (msg.type === "CORVO_BRIDGE_CAPTURE_FILE") {
      const payload = msg.payload || {};
      try {
        const response = await chrome.runtime.sendMessage({ type: "CORVO_CAPTURE_AND_UPLOAD", payload });
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_CAPTURE_ACK", payload: { ...response, jobId: payload.jobId || null } }, "*");
      } catch (error) {
        window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_CAPTURE_ACK", payload: { ok: false, jobId: payload.jobId || null, error: error.message || "FILE_CAPTURE_FAILED" } }, "*");
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CORVO_BRIDGE_STATUS") {
      window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_STATUS", payload: message.payload || {} }, "*");
    }
  });

  window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_READY", payload: { version: "0.6.32" } }, "*");
})();
