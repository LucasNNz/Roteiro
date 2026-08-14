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
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CORVO_BRIDGE_STATUS") {
      window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_STATUS", payload: message.payload || {} }, "*");
    }
  });

  window.postMessage({ source: "CORVO_BRIDGE", type: "CORVO_BRIDGE_READY", payload: { version: "0.3.2" } }, "*");
})();
