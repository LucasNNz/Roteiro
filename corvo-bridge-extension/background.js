const DEFAULTS = {
  gptUrl: "",
  gptIdeasUrl: "",
  gptScriptUrl: "",
  gptPromptsUrl: "",
  appOrigin: "https://roteiro-mu.vercel.app",
  openMode: "reuse"
};

const pendingByTab = new Map();
const sendingTabs = new Set();
const deliveryByJob = new Map();
const JOB_TABS_KEY = "corvoBridgeJobTabs";
const OWNED_TABS_KEY = "corvoBridgeOwnedTabs";
let lastStatus = {
  state: "IDLE",
  jobId: null,
  message: "Aguardando trabalho do CorvoQuiz.",
  updatedAt: Date.now()
};

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const config = { ...DEFAULTS, ...stored };
  if (!config.gptIdeasUrl && config.gptUrl) config.gptIdeasUrl = config.gptUrl;
  return config;
}

async function rememberJobTab(jobId, tabId, openedByBridge) {
  const data = await chrome.storage.local.get([JOB_TABS_KEY, OWNED_TABS_KEY]);
  const jobs = data[JOB_TABS_KEY] || {};
  const owned = new Set(Array.isArray(data[OWNED_TABS_KEY]) ? data[OWNED_TABS_KEY] : []);
  if (openedByBridge) owned.add(tabId);
  jobs[jobId] = { tabId, closeOnComplete: openedByBridge || owned.has(tabId), savedAt: Date.now() };
  await chrome.storage.local.set({ [JOB_TABS_KEY]: jobs, [OWNED_TABS_KEY]: [...owned] });
}

async function completeJobTab(jobId) {
  const data = await chrome.storage.local.get([JOB_TABS_KEY, OWNED_TABS_KEY]);
  const jobs = data[JOB_TABS_KEY] || {};
  const record = jobs[jobId];
  if (!record) return { ok: true, closed: false };
  delete jobs[jobId];
  const owned = new Set(Array.isArray(data[OWNED_TABS_KEY]) ? data[OWNED_TABS_KEY] : []);
  if (record.closeOnComplete) owned.delete(record.tabId);
  await chrome.storage.local.set({ [JOB_TABS_KEY]: jobs, [OWNED_TABS_KEY]: [...owned] });
  if (!record.closeOnComplete) return { ok: true, closed: false };
  await chrome.tabs.remove(record.tabId).catch(() => {});
  return { ok: true, closed: true };
}

async function forgetTab(tabId) {
  const data = await chrome.storage.local.get([JOB_TABS_KEY, OWNED_TABS_KEY]);
  const jobs = data[JOB_TABS_KEY] || {};
  for (const [jobId, record] of Object.entries(jobs)) {
    if (record?.tabId === tabId) delete jobs[jobId];
  }
  const owned = new Set(Array.isArray(data[OWNED_TABS_KEY]) ? data[OWNED_TABS_KEY] : []);
  owned.delete(tabId);
  await chrome.storage.local.set({ [JOB_TABS_KEY]: jobs, [OWNED_TABS_KEY]: [...owned] });
}

function specialistConfig(job) {
  const specialist = String(job?.specialist || "IDEIAS").toUpperCase();
  if (["ROTEIRO", "SCRIPT"].includes(specialist)) return { key: "ROTEIRO", field: "gptScriptUrl", label: "GPT de roteiro" };
  if (["PROMPTS", "PROMPT", "PROMPT_IMAGENS", "IMAGENS"].includes(specialist)) return { key: "PROMPTS", field: "gptPromptsUrl", label: "GPT de prompts de imagem" };
  return { key: "IDEIAS", field: "gptIdeasUrl", label: "GPT de ideias" };
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

function waitForDelivery(payload, tabId, reused, sourceTabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      deliveryByJob.delete(payload.jobId);
      pendingByTab.delete(tabId);
      sendingTabs.delete(tabId);
      reject(new Error("GPT_SEND_FAILED"));
    }, 100000);
    deliveryByJob.set(payload.jobId, { resolve, reject, timeoutId, tabId, reused, sourceTabId });
  });
}

function resolveDelivery(jobId, result) {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  clearTimeout(delivery.timeoutId);
  deliveryByJob.delete(jobId);
  delivery.resolve(result);
}

function rejectDelivery(jobId, error) {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  clearTimeout(delivery.timeoutId);
  deliveryByJob.delete(jobId);
  delivery.reject(error instanceof Error ? error : new Error(String(error || "GPT_SEND_FAILED")));
}

async function pingTabUntilReady(tabId) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "CORVO_BRIDGE_PING" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const pending = pendingByTab.get(tabId);
  if (pending) rejectDelivery(pending.jobId, new Error("GPT_SEND_FAILED"));
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

async function dispatchToGpt(job, sourceTabId) {
  const config = await getConfig();
  const target = specialistConfig(job);
  const gptUrl = config[target.field];
  if (!gptUrl || !gptUrl.startsWith("https://chatgpt.com/")) {
    await setStatus("CONFIG_REQUIRED", job.jobId, `Configure o ${target.label} nas opções da extensão.`, { specialist: target.key });
    throw new Error(`GPT_URL_NOT_CONFIGURED_${target.key}`);
  }

  const payload = {
    jobId: String(job.jobId || `corvo_${Date.now()}`),
    prompt: String(job.prompt || "").trim(),
    specialist: target.key,
    meta: job.meta || {},
    createdAt: Date.now()
  };
  if (!payload.prompt) throw new Error("EMPTY_PROMPT");

  await setStatus("OPENING_GPT", payload.jobId, `Abrindo ${target.label} no ChatGPT...`, { specialist: target.key });
  let tab = null;
  if (config.openMode === "reuse") tab = await findReusableGptTab(gptUrl);

  if (tab?.id) {
    await rememberJobTab(payload.jobId, tab.id, false);
    pendingByTab.set(tab.id, payload);
    const delivery = waitForDelivery(payload, tab.id, true, sourceTabId);
    pingTabUntilReady(tab.id).catch(() => {});
    return await delivery;
  }

  tab = await chrome.tabs.create({ url: gptUrl, active: false });
  if (!tab.id) throw new Error("TAB_CREATE_FAILED");
  await rememberJobTab(payload.jobId, tab.id, true);
  pendingByTab.set(tab.id, payload);
  const delivery = waitForDelivery(payload, tab.id, false, sourceTabId);
  pingTabUntilReady(tab.id).catch(() => {});
  return await delivery;
}

async function sendWithFocusedRetry(tabId, pending) {
  const firstResult = await chrome.tabs.sendMessage(tabId, { type: "CORVO_SEND_PROMPT", payload: pending });
  if (firstResult?.ok) return firstResult;

  const firstError = firstResult?.error || "GPT_SEND_FAILED";
  if (firstError !== "GPT_SEND_FAILED") throw new Error(firstError);

  const delivery = deliveryByJob.get(pending.jobId);
  const sourceTabId = delivery?.sourceTabId;
  const gptTab = await chrome.tabs.get(tabId);
  let activatedForRetry = false;

  await setStatus("SENDING_TO_GPT", pending.jobId, "Sincronizando o editor do GPT para concluir o envio...");
  try {
    if (!gptTab.active) {
      await chrome.tabs.update(tabId, { active: true });
      activatedForRetry = true;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    const retryResult = await chrome.tabs.sendMessage(tabId, {
      type: "CORVO_SEND_PROMPT",
      payload: { ...pending, bridgeAttempt: "focused-retry" }
    });
    if (!retryResult?.ok) throw new Error(retryResult?.error || "GPT_SEND_FAILED");
    return retryResult;
  } finally {
    if (activatedForRetry && sourceTabId && sourceTabId !== tabId) {
      await chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "CORVO_DISPATCH_FROM_APP") {
    const job = message.payload || {};
    dispatchToGpt(job, sender.tab?.id)
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
    if (sendingTabs.has(tabId)) { sendResponse({ ok: true, pending: true, sending: true }); return; }

    sendingTabs.add(tabId);
    setStatus("SENDING_TO_GPT", pending.jobId, "GPT carregado. Enviando solicitação...").catch(() => {});
    sendWithFocusedRetry(tabId, pending)
      .then((result) => {
        sendResponse({ ok: true, pending: true, confirmed: result.confirmed === true });
      })
      .catch((error) => {
        sendingTabs.delete(tabId);
        rejectDelivery(pending.jobId, new Error(error.message || "GPT_SEND_FAILED"));
        setStatus("ERROR", pending.jobId, error.message || "GPT_SEND_FAILED").catch(() => {});
        sendResponse({ ok: false, error: error.message || "GPT_SEND_FAILED" });
      });
    return true;
  }

  if (message.type === "CORVO_GPT_SENT") {
    const tabId = sender.tab?.id;
    const jobId = message.payload?.jobId || null;
    if (tabId) { pendingByTab.delete(tabId); sendingTabs.delete(tabId); }
    setStatus("WAITING_ACTION", jobId, "Solicitação enviada. Aguardando o GPT concluir e devolver pela Action.").catch(() => {});
    resolveDelivery(jobId, { ok: true, tabId, jobId, confirmed: true });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CORVO_GPT_ERROR") {
    const tabId = sender.tab?.id;
    const jobId = message.payload?.jobId || null;
    const errorMessage = message.payload?.message || "GPT_SEND_FAILED";
    if (tabId) { pendingByTab.delete(tabId); sendingTabs.delete(tabId); }
    rejectDelivery(jobId, new Error(errorMessage));
    setStatus("ERROR", jobId, errorMessage).catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CORVO_GET_STATUS") {
    chrome.storage.local.get("corvoBridgeStatus").then((data) => sendResponse(data.corvoBridgeStatus || lastStatus));
    return true;
  }

  if (message.type === "CORVO_JOB_COMPLETE") {
    const jobId = String(message.payload?.jobId || "").trim();
    if (!jobId) { sendResponse({ ok: false, error: "JOB_ID_REQUIRED" }); return; }
    completeJobTab(jobId)
      .then(async (result) => {
        await setStatus("COMPLETED", jobId, result.closed ? "Resultado recebido. Aba do GPT fechada." : "Resultado recebido.");
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || "TAB_CLOSE_FAILED" }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const pending = pendingByTab.get(tabId);
  if (pending) rejectDelivery(pending.jobId, new Error("GPT_SEND_FAILED"));
  pendingByTab.delete(tabId);
  sendingTabs.delete(tabId);
  forgetTab(tabId).catch(() => {});
});
