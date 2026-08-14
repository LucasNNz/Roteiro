const DEFAULTS = {
  gptUrl: "",
  appOrigin: "https://roteiro-mu.vercel.app",
  openMode: "reuse"
};

const pendingByTab = new Map();
let lastStatus = {
  state: "IDLE",
  jobId: null,
  message: "Aguardando trabalho do CorvoQuiz.",
  updatedAt: Date.now()
};

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function setStatus(state, jobId, message, extra = {}) {
  lastStatus = { state, jobId: jobId || null, message, updatedAt: Date.now(), ...extra };
  await chrome.storage.local.set({ corvoBridgeStatus: lastStatus });
  const config = await getConfig();
  try {
    const appTabs = await chrome.tabs.query({ url: `${config.appOrigin}/*` });
    for (const tab of appTabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "CORVO_BRIDGE_STATUS", payload: lastStatus }).catch(() => {});
    }
  } catch {}
}

function normalizeUrl(url) {
  try { const u = new URL(url); u.hash = ""; return u.toString(); }
  catch { return ""; }
}

async function findReusableGptTab(gptUrl) {
  const target = normalizeUrl(gptUrl);
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  for (const tab of tabs) {
    const current = normalizeUrl(tab.url || "");
    if (target && current.startsWith(target)) return tab;
  }
  return null;
}

async function dispatchToGpt(job) {
  const config = await getConfig();
  if (!config.gptUrl || !config.gptUrl.startsWith("https://chatgpt.com/")) {
    await setStatus("CONFIG_REQUIRED", job.jobId, "Configure a URL do GPT personalizado nas opções da extensão.");
    throw new Error("GPT_URL_NOT_CONFIGURED");
  }

  const payload = {
    jobId: String(job.jobId || `corvo_${Date.now()}`),
    prompt: String(job.prompt || "").trim(),
    specialist: String(job.specialist || "SCOUT"),
    meta: job.meta || {},
    createdAt: Date.now()
  };
  if (!payload.prompt) throw new Error("EMPTY_PROMPT");

  await setStatus("OPENING_GPT", payload.jobId, "Abrindo o especialista no ChatGPT...");
  let tab = null;
  if (config.openMode === "reuse") tab = await findReusableGptTab(config.gptUrl);

  if (tab?.id) {
    pendingByTab.set(tab.id, payload);
    chrome.tabs.sendMessage(tab.id, { type: "CORVO_BRIDGE_PING" }).catch(() => {});
    return { ok: true, tabId: tab.id, reused: true, jobId: payload.jobId };
  }

  tab = await chrome.tabs.create({ url: config.gptUrl, active: false });
  if (!tab.id) throw new Error("TAB_CREATE_FAILED");
  pendingByTab.set(tab.id, payload);
  return { ok: true, tabId: tab.id, reused: false, jobId: payload.jobId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "CORVO_DISPATCH_FROM_APP") {
    const job = message.payload || {};
    dispatchToGpt(job)
      .then(sendResponse)
      .catch(async (error) => {
        await setStatus("ERROR", job.jobId, `Falha ao despachar: ${error.message}`);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "CORVO_GPT_READY") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    const pending = pendingByTab.get(tabId);
    if (!pending) { sendResponse({ ok: true, pending: false }); return; }

    setStatus("SENDING_TO_GPT", pending.jobId, "GPT carregado. Enviando solicitação...").catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "CORVO_SEND_PROMPT", payload: pending })
      .then(() => sendResponse({ ok: true, pending: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CORVO_GPT_SENT") {
    const tabId = sender.tab?.id;
    const jobId = message.payload?.jobId || null;
    if (tabId) pendingByTab.delete(tabId);
    setStatus("WAITING_ACTION", jobId, "Solicitação enviada. Aguardando o GPT concluir e devolver pela Action.").catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CORVO_GPT_ERROR") {
    const jobId = message.payload?.jobId || null;
    setStatus("ERROR", jobId, message.payload?.message || "Falha ao interagir com o ChatGPT.").catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CORVO_GET_STATUS") {
    chrome.storage.local.get("corvoBridgeStatus").then((data) => sendResponse(data.corvoBridgeStatus || lastStatus));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => pendingByTab.delete(tabId));
