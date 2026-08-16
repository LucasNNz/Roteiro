const DEFAULTS = {
  gptUrl: "",
  gptIdeasUrl: "",
  gptScriptUrl: "",
  gptPromptsUrl: "",
  gptAnalystUrl: "",
  gptRefinerUrl: "",
  gptGeneratorUrl: "",
  gptFallbackUrl: "",
  gptThumbUrl: "",
  gptYoutubeUrl: "",
  appOrigin: "https://roteiro-mu.vercel.app",
  openMode: "reuse",
  cleanerEnabled: false,
  cleanerHour: "22:00",
  cleanerDryRun: true
};

const pendingByTab = new Map();
const sendingTabs = new Set();
const deliveryByJob = new Map();
const JOB_TABS_KEY = "corvoBridgeJobTabs";
const OWNED_TABS_KEY = "corvoBridgeOwnedTabs";
const CLEANER_RECORDS_KEY = "corvoBridgeCleanerRecords";
const CLEANER_LOG_KEY = "corvoBridgeCleanerLog";
const CLEANER_ALARM = "corvoBridgeDailyCleaner";
const CAPTURE_RECOVERY_KEY = "corvoBridgeCaptureRecovery";
const DIAGNOSTICS_KEY = "corvoBridgeDiagnosticsV1";
const DIAGNOSTIC_MAX_JOBS = 12;
const DIAGNOSTIC_MAX_EVENTS = 180;
const captureByJob = new Map();
let cleanerRunning = false;
let lastStatus = {
  state: "IDLE",
  jobId: null,
  message: "Aguardando trabalho do CorvoQuiz.",
  updatedAt: Date.now()
};


function diagnosticUrl(value = "") {
  try {
    const u = new URL(String(value || ""));
    return `${u.origin}${u.pathname}`;
  } catch { return String(value || "").slice(0, 220); }
}

function diagnosticSafe(value, depth = 0) {
  if (depth > 4) return "[depth]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return diagnosticUrl(value);
    return value.length > 800 ? `${value.slice(0, 800)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => diagnosticSafe(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (/token|secret|authorization|cookie|dataurl|base64/i.test(key)) { out[key] = "[redacted]"; continue; }
      out[key] = diagnosticSafe(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

async function appendDiagnostic(jobId, event, details = {}, origin = "background") {
  const id = String(jobId || lastStatus?.jobId || "NO_JOB");
  const data = await chrome.storage.local.get(DIAGNOSTICS_KEY);
  const store = data[DIAGNOSTICS_KEY] && typeof data[DIAGNOSTICS_KEY] === "object" ? data[DIAGNOSTICS_KEY] : { order: [], jobs: {} };
  if (!store.jobs || typeof store.jobs !== "object") store.jobs = {};
  if (!Array.isArray(store.order)) store.order = [];
  const job = store.jobs[id] || { jobId:id, createdAt:Date.now(), events:[] };
  if (!Array.isArray(job.events)) job.events = [];
  job.updatedAt = Date.now();
  job.events.push({ at:Date.now(), origin, event:String(event || "EVENT"), details:diagnosticSafe(details) });
  job.events = job.events.slice(-DIAGNOSTIC_MAX_EVENTS);
  store.jobs[id] = job;
  store.order = [...store.order.filter((item) => item !== id), id].slice(-DIAGNOSTIC_MAX_JOBS);
  for (const key of Object.keys(store.jobs)) if (!store.order.includes(key)) delete store.jobs[key];
  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]:store });
}

async function getDiagnostic(jobId) {
  const data = await chrome.storage.local.get([DIAGNOSTICS_KEY, "corvoBridgeStatus"]);
  const store = data[DIAGNOSTICS_KEY] || { order:[], jobs:{} };
  const id = String(jobId || data.corvoBridgeStatus?.jobId || store.order?.at?.(-1) || "");
  const job = store.jobs?.[id] || null;
  if (!job) return { ok:false, error:"DIAGNOSTIC_NOT_FOUND", jobId:id };
  const events = Array.isArray(job.events) ? job.events : [];
  const start = events[0]?.at || job.createdAt || Date.now();
  const lines = [
    "CORVO BRIDGE DIAGNÓSTICO V1",
    `Bridge: V0.6.24`,
    `JOB_ID: ${id}`,
    `Eventos: ${events.length}`,
    `Status atual: ${data.corvoBridgeStatus?.state || ""} | ${data.corvoBridgeStatus?.message || ""}`,
    ""
  ];
  for (const item of events) {
    const delta = Math.max(0, Number(item.at || 0) - Number(start || 0));
    let detail = "";
    try { detail = JSON.stringify(item.details || {}); } catch { detail = String(item.details || ""); }
    lines.push(`${new Date(item.at).toISOString()} +${delta}ms [${item.origin}] ${item.event}${detail && detail !== "{}" ? ` ${detail}` : ""}`);
  }
  return { ok:true, jobId:id, events:events.length, text:lines.join("\n"), last:events.at(-1) || null };
}

function localDay(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function conversationKey(url) {
  try {
    const u = new URL(url);
    // Conversas de GPTs personalizados podem usar /g/<gpt>/c/<conversationId>,
    // enquanto chats comuns usam /c/<conversationId>. Aceitar /c/ em qualquer
    // ponto do pathname evita perder o ID das conversas abertas pelo Bridge.
    const match = u.pathname.match(/(?:^|\/)c\/([^/?#]+)/);
    return match ? match[1] : "";
  } catch { return ""; }
}

async function getCleanerRecords() {
  const data = await chrome.storage.local.get(CLEANER_RECORDS_KEY);
  return Array.isArray(data[CLEANER_RECORDS_KEY]) ? data[CLEANER_RECORDS_KEY] : [];
}

async function saveCleanerRecords(records) {
  await chrome.storage.local.set({ [CLEANER_RECORDS_KEY]: records.slice(-1000) });
}

async function repairCleanerRecords() {
  const records = await getCleanerRecords();
  let changed = false;
  const repaired = records.map((record) => {
    if (!record?.conversationUrl) return record;
    const conversationId = conversationKey(record.conversationUrl);
    if (!conversationId || conversationId === record.conversationId) return record;
    changed = true;
    return { ...record, conversationId, repairedAt: Date.now(), updatedAt: Date.now() };
  });
  if (changed) await saveCleanerRecords(repaired);
  return repaired;
}

async function upsertCleanerRecord(jobId, patch = {}) {
  if (!jobId) return;
  const records = await getCleanerRecords();
  const index = records.findIndex((r) => r.jobId === jobId);
  const now = Date.now();
  const current = index >= 0 ? records[index] : { jobId, createdAt: now, day: localDay(now), done: false, deleted: false };
  const next = { ...current, ...patch, jobId, updatedAt: now };
  if (next.conversationUrl) next.conversationId = conversationKey(next.conversationUrl);
  if (index >= 0) records[index] = next; else records.push(next);
  await saveCleanerRecords(records);
}

async function patchEligibleCleanerRecord(jobId, patch = {}) {
  if (!jobId) return false;
  const records = await getCleanerRecords();
  const index = records.findIndex((record) => record.jobId === jobId && record.eligible === true);
  if (index < 0) return false;
  const next = { ...records[index], ...patch, jobId, updatedAt: Date.now() };
  if (next.conversationUrl) next.conversationId = conversationKey(next.conversationUrl);
  records[index] = next;
  await saveCleanerRecords(records);
  return true;
}

async function appendCleanerLog(entry) {
  const data = await chrome.storage.local.get(CLEANER_LOG_KEY);
  const log = Array.isArray(data[CLEANER_LOG_KEY]) ? data[CLEANER_LOG_KEY] : [];
  log.push({ at: Date.now(), ...entry });
  await chrome.storage.local.set({ [CLEANER_LOG_KEY]: log.slice(-300) });
}

async function scheduleCleaner() {
  const config = await getConfig();
  await chrome.alarms.clear(CLEANER_ALARM);
  if (!config.cleanerEnabled) return;
  const [h, m] = String(config.cleanerHour || "22:00").split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  chrome.alarms.create(CLEANER_ALARM, { when: next.getTime(), periodInMinutes: 1440 });
}

async function waitTabReady(tabId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        await chrome.tabs.sendMessage(tabId, { type: "CORVO_BRIDGE_PING" }).catch(() => null);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("CLEANER_TAB_TIMEOUT");
}

async function navigateCleanerTab(tabId, url, timeout = 18000) {
  await chrome.tabs.update(tabId, { url, active: false });
  await waitTabReady(tabId, timeout);
  // document.complete não significa que a SPA do ChatGPT já hidratou.
  // Um ping extra curto evita gastar 30s em cada conversa, mas dá tempo
  // para o content script e a interface principal ficarem disponíveis.
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "CORVO_BRIDGE_PING" });
      if (pong?.ok !== false) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function deleteConversationInTab(tabId, record, dryRun) {
  if (!record.conversationUrl || !record.conversationId) throw new Error("CONVERSATION_URL_MISSING");
  if (dryRun) return { ok: true, dryRun: true };

  // 1) Abre a conversa exata e pede a exclusão pelo menu da linha exata.
  await navigateCleanerTab(tabId, record.conversationUrl);
  const requested = await chrome.tabs.sendMessage(tabId, {
    type: "CORVO_DELETE_CURRENT_CHAT",
    payload: { conversationUrl: record.conversationUrl, conversationId: record.conversationId }
  });
  if (!requested?.ok || !requested?.deleteRequested) {
    throw new Error(requested?.error || "DELETE_REQUEST_NOT_APPLIED");
  }

  // 2) Verificação forte: só navegar DEPOIS que o content script esperou o
  // alertdialog fechar e deu tempo para a mutação ser aplicada.
  await new Promise((r) => setTimeout(r, requested.applyObserved ? 1400 : 3000));

  // Reabrimos até duas vezes para tolerar consistência eventual do histórico.
  let lastVerified = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await navigateCleanerTab(tabId, "https://chatgpt.com/", 14000).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await navigateCleanerTab(tabId, record.conversationUrl, 18000);
    await new Promise((r) => setTimeout(r, 1200));
    const verified = await chrome.tabs.sendMessage(tabId, {
      type: "CORVO_VERIFY_CHAT_DELETED",
      payload: { conversationId: record.conversationId }
    });
    if (!verified?.ok) throw new Error(verified?.error || "DELETE_VERIFY_FAILED");
    lastVerified = verified;
    if (verified.deleted === true) {
      return { ok: true, deleted: true, verifiedBy: verified.reason || "REOPEN_CHECK" };
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 3500));
  }

  if (lastVerified?.exists === true) {
    throw new Error(`DELETE_DID_NOT_HAPPEN:${requested.applyReason || lastVerified.reason || 'UNKNOWN'}`);
  }
  throw new Error(`DELETE_VERIFICATION_UNKNOWN:${requested.applyReason || lastVerified?.reason || 'UNKNOWN'}`);
}

async function runCleaner({ manual = false, forceDelete = false } = {}) {
  if (cleanerRunning) return { ok: false, error: "CLEANER_BUSY" };
  cleanerRunning = true;
  let cleanerTabId = null;
  try {
    const config = await getConfig();
    if (!manual && !config.cleanerEnabled) return { ok: true, skipped: true };
    const records = await repairCleanerRecords();
    const jobData = await chrome.storage.local.get(JOB_TABS_KEY);
    const openJobs = jobData[JOB_TABS_KEY] || {};
    const nowTs = Date.now();
    const staleErrorMs = 15 * 60 * 1000;
    const activeConversationIds = new Set(records.filter((r) => {
      if (!(r.eligible === true && !r.done && !r.deleted && r.conversationId)) return false;
      const live = openJobs[r.jobId] || {};
      const bridgeState = String(r.lastBridgeState || live.lastState || "").toUpperCase();
      if (!bridgeState) return false;
      return !["ERROR", "COMPLETED"].includes(bridgeState);
    }).map((r) => r.conversationId));
    const rawCandidates = records.filter((r) => {
      if (!(r.eligible === true && !r.deleted && r.conversationUrl && r.conversationId)) return false;
      if (activeConversationIds.has(r.conversationId)) return false;
      if (r.done) return true;
      const live = openJobs[r.jobId] || {};
      const errorState = String(r.lastBridgeState || live.lastState || r.cleanerState || "").toUpperCase() === "ERROR";
      const errorAt = Number(r.lastBridgeErrorAt || live.lastUpdatedAt || r.updatedAt || 0);
      return errorState && errorAt > 0 && nowTs - errorAt >= staleErrorMs;
    });
    // Uma mesma conversa pode ter sido associada a mais de um JOB em versões antigas.
    // O Cleaner trabalha por CONVERSA, não por registro, para não tentar excluir a
    // mesma URL várias vezes e não contaminar a fila com falhas duplicadas.
    const groupedCandidates = new Map();
    for (const record of rawCandidates) {
      const key = record.conversationId || record.conversationUrl;
      const current = groupedCandidates.get(key);
      if (current) {
        current.jobIds.push(record.jobId);
        if ((record.updatedAt || 0) > (current.updatedAt || 0)) Object.assign(current, { ...record, jobIds:current.jobIds });
      } else groupedCandidates.set(key, { ...record, jobIds:[record.jobId] });
    }
    const candidates = [...groupedCandidates.values()];
    const dryRun = forceDelete ? false : config.cleanerDryRun !== false;
    let deleted = 0, failed = 0;
    const errors = [];

    await chrome.storage.local.set({ corvoBridgeCleanerStatus: {
      at: Date.now(), running: true, current: 0, candidates: candidates.length,
      deleted: 0, failed: 0, dryRun, manual, forceDelete, errors: []
    }});

    if (!dryRun && candidates.length) {
      const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
      cleanerTabId = tab.id || null;
      if (!cleanerTabId) throw new Error("CLEANER_TAB_CREATE_FAILED");
      await waitTabReady(cleanerTabId, 18000).catch(() => {});
    }

    for (let index = 0; index < candidates.length; index++) {
      const record = candidates[index];
      await chrome.storage.local.set({ corvoBridgeCleanerStatus: {
        at: Date.now(), running: true, current: index + 1, candidates: candidates.length,
        deleted, failed, dryRun, manual, forceDelete, errors: errors.slice(0, 10),
        currentJobId: record.jobId, currentConversationId: record.conversationId
      }});
      try {
        let result;
        if (dryRun) result = { ok:true, dryRun:true };
        else {
          let lastDeleteError = null;
          for (let deleteAttempt = 0; deleteAttempt < 2; deleteAttempt++) {
            try {
              result = await deleteConversationInTab(cleanerTabId, record, false);
              lastDeleteError = null;
              break;
            } catch (error) {
              lastDeleteError = error;
              // Uma conversa com menu/modal quebrado não pode contaminar a próxima.
              // Na primeira falha, reseta a aba de manutenção e tenta ESTE alvo mais
              // uma vez. Se continuar falhando, registra e segue a fila normalmente.
              if (deleteAttempt < 1 && cleanerTabId) {
                await chrome.tabs.update(cleanerTabId, { url:"https://chatgpt.com/", active:false }).catch(() => {});
                await waitTabReady(cleanerTabId, 15000).catch(() => {});
                await new Promise((resolve) => setTimeout(resolve, 900));
              }
            }
          }
          if (!result) throw lastDeleteError || new Error("DELETE_FAILED");
        }
        const jobIds = Array.isArray(record.jobIds) && record.jobIds.length ? record.jobIds : [record.jobId];
        for (const mappedJobId of jobIds) {
          await upsertCleanerRecord(mappedJobId, {
            deleted: !result.dryRun,
            ...(result.dryRun ? {} : { done:true }),
            lastCleanerAt: Date.now(),
            lastCleanerResult: result.dryRun ? "DRY_RUN" : "DELETED",
            cleanerError: "",
            cleanerState: result.dryRun ? "DRY_RUN" : "DELETED"
          });
        }
        await appendCleanerLog({ jobId: record.jobId, jobIds, conversationId: record.conversationId, result: result.dryRun ? "DRY_RUN" : "DELETED" });
        if (!result.dryRun) deleted++;
      } catch (error) {
        failed++;
        const errorCode = String(error?.message || "DELETE_FAILED");
        const jobIds = Array.isArray(record.jobIds) && record.jobIds.length ? record.jobIds : [record.jobId];
        for (const mappedJobId of jobIds) {
          await upsertCleanerRecord(mappedJobId, {
            lastCleanerAt: Date.now(), lastCleanerResult: "ERROR", cleanerError: errorCode,
            cleanerState:"FAILED", cleanerAttempts:Number(record.cleanerAttempts || 0) + 1
          });
        }
        await appendCleanerLog({ jobId: record.jobId, jobIds, conversationId: record.conversationId, result: "ERROR", error: errorCode });
        errors.push({ jobId: record.jobId, jobIds, conversationId: record.conversationId, error: errorCode });
        if (!dryRun && cleanerTabId) {
          await chrome.tabs.update(cleanerTabId, { url:"https://chatgpt.com/", active:false }).catch(() => {});
          await waitTabReady(cleanerTabId, 15000).catch(() => {});
        }
        // Falha de uma conversa NÃO encerra a fila. A próxima conversa é
        // independente e deve ser tentada normalmente. As falhas permanecem
        // mapeadas para um retry posterior do Cleaner.
      }
      // Dá tempo para o histórico estabilizar, especialmente após uma falha,
      // mas nunca bloqueia todas as conversas restantes.
      if (index < candidates.length - 1) await new Promise((r) => setTimeout(r, failed ? 700 : 350));
    }

    const finalStatus = {
      at: Date.now(), running: false, current: candidates.length, candidates: candidates.length,
      deleted, failed, dryRun, manual, forceDelete, errors: errors.slice(0, 10)
    };
    await chrome.storage.local.set({ corvoBridgeCleanerStatus: finalStatus });
    return { ok: failed === 0, candidates: candidates.length, deleted, failed, dryRun, forceDelete, errors: errors.slice(0, 10) };
  } catch (error) {
    const existing = (await chrome.storage.local.get("corvoBridgeCleanerStatus")).corvoBridgeCleanerStatus || {};
    await chrome.storage.local.set({ corvoBridgeCleanerStatus: {
      ...existing, at: Date.now(), running: false, fatalError: String(error?.message || "CLEANER_FAILED")
    }});
    throw error;
  } finally {
    if (cleanerTabId) await chrome.tabs.remove(cleanerTabId).catch(() => {});
    cleanerRunning = false;
  }
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const config = { ...DEFAULTS, ...stored };
  if (!config.gptIdeasUrl && config.gptUrl) config.gptIdeasUrl = config.gptUrl;
  return config;
}

async function rememberJobTab(jobId, tabId, openedByBridge, meta = {}) {
  const data = await chrome.storage.local.get([JOB_TABS_KEY, OWNED_TABS_KEY]);
  const jobs = data[JOB_TABS_KEY] || {};
  const owned = new Set(Array.isArray(data[OWNED_TABS_KEY]) ? data[OWNED_TABS_KEY] : []);
  if (openedByBridge) owned.add(tabId);
  const bridgeOwned = openedByBridge || owned.has(tabId);
  jobs[jobId] = {
    ...(jobs[jobId] || {}),
    tabId,
    closeOnComplete: bridgeOwned,
    bridgeOwned,
    uploadToken: String(meta.uploadToken || jobs[jobId]?.uploadToken || ""),
    projectId: String(meta.projectId || jobs[jobId]?.projectId || ""),
    specialist: String(meta.specialist || jobs[jobId]?.specialist || ""),
    batchId: String(meta.batchId || jobs[jobId]?.batchId || ""),
    batchSize: Number(meta.batchSize || jobs[jobId]?.batchSize || 0),
    logicalBatch: meta.logicalBatch === true || jobs[jobId]?.logicalBatch === true,
    savedAt: Date.now()
  };
  await chrome.storage.local.set({ [JOB_TABS_KEY]: jobs, [OWNED_TABS_KEY]: [...owned] });
  return { bridgeOwned };
}

async function fetchAttachmentForChat(payload = {}) {
  const rawUrl = String(payload.url || "").trim();
  if (!/^https:\/\//i.test(rawUrl)) throw new Error("ATTACHMENT_URL_INVALID");
  const jobId = String(payload.jobId || "").trim();
  const uploadToken = String(payload.uploadToken || "").trim();
  const config = await getConfig();
  const appOrigin = String(payload.appOrigin || config.appOrigin || "").trim().replace(/\/$/, "");
  let response = null;
  let source = "blob-direct";
  let proxyFailure = "";

  if (jobId && uploadToken && /^https:\/\//i.test(appOrigin)) {
    const proxyUrl = `${appOrigin}/api/corvo/download?jobId=${encodeURIComponent(jobId)}&url=${encodeURIComponent(rawUrl)}&name=${encodeURIComponent(String(payload.name || "arquivo"))}`;
    await appendDiagnostic(jobId, "ATTACHMENT_BACKGROUND_PROXY_START", { appOrigin, fileName:String(payload.name || "arquivo") }, "background").catch(() => {});
    try {
      response = await fetch(proxyUrl, {
        method:"GET", cache:"no-store", credentials:"omit",
        headers:{ "x-corvo-upload-token":uploadToken },
      });
      if (!response.ok) {
        let body = {};
        try { body = await response.clone().json(); } catch {}
        const code = String(body?.code || "").trim();
        const message = String(body?.message || "").trim();
        proxyFailure = code || (message ? `ATTACHMENT_PROXY_FETCH_${response.status}:${message}` : `ATTACHMENT_PROXY_FETCH_${response.status}`);
        await appendDiagnostic(jobId, "ATTACHMENT_BACKGROUND_PROXY_FAIL", { status:response.status, code, message }, "background").catch(() => {});
        response = null;
      } else {
        source = "app-proxy";
        await appendDiagnostic(jobId, "ATTACHMENT_BACKGROUND_PROXY_OK", { status:response.status, contentLength:response.headers.get("content-length") || "", downloadSource:response.headers.get("x-corvo-download-source") || "" }, "background").catch(() => {});
      }
    } catch (error) {
      proxyFailure = String(error?.message || error || "ATTACHMENT_PROXY_EXCEPTION");
      await appendDiagnostic(jobId, "ATTACHMENT_BACKGROUND_PROXY_EXCEPTION", { error:proxyFailure }, "background").catch(() => {});
      response = null;
    }
  }

  if (!response) {
    response = await fetch(rawUrl, { cache: "no-store", credentials: "omit" });
    if (!response.ok) {
      if (proxyFailure) throw new Error(proxyFailure);
      throw new Error(`ATTACHMENT_FETCH_${response.status}`);
    }
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error("ATTACHMENT_EMPTY");
  if (buffer.byteLength > 40 * 1024 * 1024) throw new Error("ATTACHMENT_BACKGROUND_MESSAGE_TOO_LARGE");
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  const contentType = response.headers.get("content-type") || String(payload.contentType || "application/octet-stream");
  return {
    ok: true,
    name: String(payload.name || "arquivo").trim() || "arquivo",
    contentType,
    size: buffer.byteLength,
    source,
    dataUrl: `data:${contentType};base64,${btoa(binary)}`
  };
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function setCaptureRecovery(jobId, payload = {}, patch = {}) {
  const data = await chrome.storage.local.get(CAPTURE_RECOVERY_KEY);
  const current = data[CAPTURE_RECOVERY_KEY] || {};
  current[jobId] = {
    ...(current[jobId] || {}),
    jobId,
    name: String(payload.name || current[jobId]?.name || "").trim(),
    type: String(payload.type || current[jobId]?.type || "THUMBNAIL").trim().toUpperCase(),
    updatedAt: Date.now(),
    ...patch
  };
  await chrome.storage.local.set({ [CAPTURE_RECOVERY_KEY]: current });
}

async function clearCaptureRecovery(jobId) {
  const data = await chrome.storage.local.get(CAPTURE_RECOVERY_KEY);
  const current = data[CAPTURE_RECOVERY_KEY] || {};
  delete current[jobId];
  await chrome.storage.local.set({ [CAPTURE_RECOVERY_KEY]: current });
}

async function fetchCapturedBlob(captured) {
  if (captured?.dataUrl) {
    const response = await withTimeout(fetch(captured.dataUrl), 12000, "DATA_URL_FETCH_TIMEOUT");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) throw new Error("INVALID_CAPTURED_IMAGE");
    return blob;
  }
  const src = String(captured?.src || "").trim();
  if (!/^https:\/\//i.test(src)) throw new Error("CAPTURED_IMAGE_SOURCE_MISSING");
  const response = await withTimeout(fetch(src, { cache: "no-store", credentials: "include" }), 15000, "IMAGE_BACKGROUND_FETCH_TIMEOUT");
  if (!response.ok) throw new Error(`IMAGE_BACKGROUND_FETCH_${response.status}`);
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/")) throw new Error("INVALID_CAPTURED_IMAGE");
  return blob;
}

async function performCaptureAndUploadFile(jobId, payload = {}) {
  const data = await chrome.storage.local.get(JOB_TABS_KEY);
  const record = (data[JOB_TABS_KEY] || {})[jobId];
  if (!record?.tabId) throw new Error("JOB_TAB_NOT_FOUND");
  if (!record.uploadToken) throw new Error("UPLOAD_TOKEN_MISSING");
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("FILE_NAME_REQUIRED");
  const fileType = String(payload.type || "THUMBNAIL").trim().toUpperCase();
  await setCaptureRecovery(jobId, { name, type: fileType }, { stage: "CAPTURING", startedAt: Date.now() });
  await setStatus("CAPTURING_FILE", jobId, `Capturando ${name} na conversa...`, { fileName: name, fileType });
  const captured = await withTimeout(chrome.tabs.sendMessage(record.tabId, {
    type: "CORVO_CAPTURE_GENERATED_IMAGE",
    payload: { jobId, name, timeout: 30000 }
  }), 38000, "GENERATED_IMAGE_CAPTURE_TIMEOUT");
  if (!captured?.ok || (!captured.dataUrl && !captured.src)) throw new Error(captured?.error || "GENERATED_IMAGE_NOT_FOUND");
  const blob = await fetchCapturedBlob(captured);
  if (blob.size > 8 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const config = await getConfig();
  const form = new FormData();
  form.append("jobId", jobId);
  form.append("tipo", fileType);
  form.append("nomeArquivo", name);
  form.append("arquivo", blob, name);
  await setCaptureRecovery(jobId, { name, type: fileType }, { stage: "UPLOADING" });
  await setStatus("UPLOADING_FILE", jobId, `Enviando ${name} ao CorvoQuiz...`, { fileName: name, fileType });
  const upload = await withTimeout(fetch(`${config.appOrigin}/api/corvo/arquivo`, {
    method: "POST",
    headers: { "x-corvo-upload-token": record.uploadToken },
    body: form
  }), 45000, "FILE_UPLOAD_TIMEOUT");
  const result = await upload.json().catch(() => ({}));
  if (!upload.ok || !result?.ok) throw new Error(result?.message || `FILE_UPLOAD_${upload.status}`);
  await clearCaptureRecovery(jobId);
  await setStatus("FILE_DELIVERED", jobId, `${name} associado ao trabalho.`, { file: result.file, fileName: name, fileType });
  return { ok: true, jobId, file: result.file, status: result.status };
}

async function captureAndUploadFile(jobId, payload = {}) {
  if (captureByJob.has(jobId)) return captureByJob.get(jobId);
  const operation = performCaptureAndUploadFile(jobId, payload)
    .finally(() => captureByJob.delete(jobId));
  captureByJob.set(jobId, operation);
  return operation;
}

async function retryLastCapture() {
  const data = await chrome.storage.local.get(["corvoBridgeStatus", CAPTURE_RECOVERY_KEY, JOB_TABS_KEY]);
  const status = data.corvoBridgeStatus || lastStatus;
  const jobId = String(status?.jobId || "").trim();
  if (!jobId) throw new Error("CAPTURE_JOB_NOT_FOUND");
  const recovery = (data[CAPTURE_RECOVERY_KEY] || {})[jobId] || {};
  let name = String(recovery.name || status.fileName || "").trim();
  if (!name) {
    const match = String(status.message || "").match(/(?:Capturando|Enviando)\s+(.+?)\s+(?:na conversa|ao CorvoQuiz)/i);
    name = String(match?.[1] || "").trim();
  }
  if (!name) throw new Error("CAPTURE_FILE_NAME_UNKNOWN");
  let type = String(recovery.type || status.fileType || "").trim().toUpperCase();
  if (!type) type = /^thumb_/i.test(name) ? "THUMBNAIL" : "OTHER";
  return captureAndUploadFile(jobId, { name, type });
}


async function completeJobTab(jobId) {
  const data = await chrome.storage.local.get([JOB_TABS_KEY, OWNED_TABS_KEY]);
  const jobs = data[JOB_TABS_KEY] || {};
  const record = jobs[jobId];
  if (!record) return { ok: true, closed: false, conversationUrl:"" };

  // Captura a URL FINAL antes de fechar a aba. Ela também volta ao app para que
  // um RETRY SEMÂNTICO do mesmo lote possa continuar NA MESMA CONVERSA, em vez
  // de poluir o histórico com uma conversa nova.
  let finalConversationUrl = String(record.conversationUrl || "");
  try {
    const tab = await chrome.tabs.get(record.tabId);
    const conversationUrl = String(tab?.url || "");
    if (conversationKey(conversationUrl)) {
      finalConversationUrl = conversationUrl;
      await patchEligibleCleanerRecord(jobId, { conversationUrl, completedAt: Date.now() });
    }
  } catch {}

  delete jobs[jobId];
  const owned = new Set(Array.isArray(data[OWNED_TABS_KEY]) ? data[OWNED_TABS_KEY] : []);
  if (record.closeOnComplete) owned.delete(record.tabId);
  await chrome.storage.local.set({ [JOB_TABS_KEY]: jobs, [OWNED_TABS_KEY]: [...owned] });
  if (!record.closeOnComplete) return { ok: true, closed: false, conversationUrl:finalConversationUrl };
  await chrome.tabs.remove(record.tabId).catch(() => {});
  return { ok: true, closed: true, conversationUrl:finalConversationUrl };
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
  if (["ANALISTA", "ANALYSIS"].includes(specialist)) return { key: "ANALISTA", field: "gptAnalystUrl", label: "Corvo Analista de Imagens" };
  if (["REFINADOR", "REFINER", "REFINEMENT"].includes(specialist)) return { key: "REFINADOR", field: "gptRefinerUrl", label: "Corvo Refinador" };
  if (["GERADOR", "GENERATOR", "GENERATION"].includes(specialist)) return { key: "GERADOR", field: "gptGeneratorUrl", label: "Corvo Gerador de Imagens" };
  if (["FALLBACK", "RECUPERACAO"].includes(specialist)) return { key: "FALLBACK", field: "gptFallbackUrl", label: "Corvo Fallback" };
  if (["THUMB", "THUMBNAIL"].includes(specialist)) return { key: "THUMB", field: "gptThumbUrl", label: "Corvo Thumb" };
  if (["YOUTUBE", "METADADOS", "METADATA"].includes(specialist)) return { key: "YOUTUBE", field: "gptYoutubeUrl", label: "Corvo YouTube" };
  return { key: "IDEIAS", field: "gptIdeasUrl", label: "GPT de ideias" };
}

async function setStatus(state, jobId, message, extra = {}) {
  lastStatus = { state, jobId: jobId || null, message, updatedAt: Date.now(), ...extra };
  const storagePatch = { corvoBridgeStatus: lastStatus };
  if (jobId) {
    const data = await chrome.storage.local.get(JOB_TABS_KEY);
    const jobs = data[JOB_TABS_KEY] || {};
    if (jobs[jobId]) {
      jobs[jobId] = { ...jobs[jobId], lastState:state, lastMessage:message, lastUpdatedAt:Date.now(), specialist:String(extra.specialist || jobs[jobId]?.specialist || "") };
      storagePatch[JOB_TABS_KEY] = jobs;
    }
  }
  await chrome.storage.local.set(storagePatch);
  if (jobId) {
    patchEligibleCleanerRecord(jobId, {
      lastBridgeState:String(state || ""),
      lastBridgeStateAt:Date.now(),
      ...(state === "ERROR" ? { lastBridgeError:String(message || ""), lastBridgeErrorAt:Date.now() } : {})
    }).catch(() => {});
  }
  await appendDiagnostic(jobId, `STATUS:${state}`, { message, ...extra }, "background").catch(() => {});
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

function clearDeliveryTimers(delivery) {
  if (!delivery) return;
  if (delivery.idleTimeoutId) clearTimeout(delivery.idleTimeoutId);
  if (delivery.hardTimeoutId) clearTimeout(delivery.hardTimeoutId);
}

function armDeliveryIdleTimeout(jobId) {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  if (delivery.idleTimeoutId) clearTimeout(delivery.idleTimeoutId);
  delivery.lastProgressAt = Date.now();
  delivery.idleTimeoutId = setTimeout(() => {
    appendDiagnostic(jobId, "DELIVERY_PROGRESS_TIMEOUT", { tabId:delivery.tabId, lastProgressAt:delivery.lastProgressAt }, "background").catch(() => {});
    deliveryByJob.delete(jobId);
    pendingByTab.delete(delivery.tabId);
    sendingTabs.delete(delivery.tabId);
    clearDeliveryTimers(delivery);
    delivery.reject(new Error("GPT_SEND_PROGRESS_TIMEOUT"));
  }, 5 * 60 * 1000);
}

function touchDelivery(jobId, state = "") {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  armDeliveryIdleTimeout(jobId);
  appendDiagnostic(jobId, "DELIVERY_PROGRESS", { state, tabId:delivery.tabId }, "background").catch(() => {});
}

function waitForDelivery(payload, tabId, reused, sourceTabId) {
  return new Promise((resolve, reject) => {
    const delivery = {
      resolve, reject, tabId, reused, sourceTabId,
      startedAt:Date.now(), lastProgressAt:Date.now(),
      idleTimeoutId:null, hardTimeoutId:null,
    };
    delivery.hardTimeoutId = setTimeout(() => {
      appendDiagnostic(payload.jobId, "DELIVERY_HARD_TIMEOUT", { tabId, reused, sourceTabId, startedAt:delivery.startedAt }, "background").catch(() => {});
      deliveryByJob.delete(payload.jobId);
      pendingByTab.delete(tabId);
      sendingTabs.delete(tabId);
      clearDeliveryTimers(delivery);
      reject(new Error("GPT_SEND_HARD_TIMEOUT"));
    }, 25 * 60 * 1000);
    deliveryByJob.set(payload.jobId, delivery);
    armDeliveryIdleTimeout(payload.jobId);
  });
}

function resolveDelivery(jobId, result) {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  clearDeliveryTimers(delivery);
  deliveryByJob.delete(jobId);
  delivery.resolve(result);
}

function rejectDelivery(jobId, error) {
  const delivery = deliveryByJob.get(jobId);
  if (!delivery) return;
  clearDeliveryTimers(delivery);
  deliveryByJob.delete(jobId);
  delivery.reject(error instanceof Error ? error : new Error(String(error || "GPT_SEND_FAILED")));
}

function isMissingReceiverError(error) {
  const text = String(error?.message || error || "");
  return /Receiving end does not exist|Could not establish connection/i.test(text);
}

async function waitTabComplete(tabId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return tab;
    } catch (error) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("TAB_RELOAD_TIMEOUT");
}

async function injectChatGptBridge(tabId, pending) {
  await appendDiagnostic(pending?.jobId, "CONTENT_SCRIPT_INJECT_START", { tabId }, "background").catch(() => {});
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["chatgpt-bridge.js"]
    });
    await appendDiagnostic(pending?.jobId, "CONTENT_SCRIPT_INJECT_OK", { tabId, frames:Array.isArray(result) ? result.length : 0 }, "background").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));
    return true;
  } catch (error) {
    await appendDiagnostic(pending?.jobId, "CONTENT_SCRIPT_INJECT_FAILED", { tabId, error:String(error?.message || error || "") }, "background").catch(() => {});
    return false;
  }
}

async function reloadTabForBridge(tabId, pending) {
  await appendDiagnostic(pending?.jobId, "TAB_RELOAD_FOR_CONTENT_SCRIPT", { tabId }, "background").catch(() => {});
  await chrome.tabs.reload(tabId);
  await waitTabComplete(tabId, 35000);
  // document.complete pode chegar antes do content script em document_idle.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await appendDiagnostic(pending?.jobId, "TAB_RELOAD_COMPLETE", { tabId }, "background").catch(() => {});
}

async function pingTabUntilReady(tabId) {
  const pending = pendingByTab.get(tabId);
  if (pending) appendDiagnostic(pending.jobId, "PING_START", { tabId }, "background").catch(() => {});
  let injectionTried = false;
  let reloadTried = false;

  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "CORVO_BRIDGE_PING" });
      if (pending) appendDiagnostic(pending.jobId, "PING_OK", { tabId, attempt:attempt + 1, pong, recovered:injectionTried || reloadTried }, "background").catch(() => {});
      return;
    } catch (error) {
      const errorText = String(error?.message || error || "");
      if (pending && [0, 3, 9, 19, 39, 79].includes(attempt)) appendDiagnostic(pending.jobId, "PING_WAIT", { tabId, attempt:attempt + 1, error:errorText }, "background").catch(() => {});

      if (isMissingReceiverError(error) && !injectionTried) {
        injectionTried = true;
        if (pending) await appendDiagnostic(pending.jobId, "CONTENT_SCRIPT_MISSING", { tabId, error:errorText }, "background").catch(() => {});
        const injected = await injectChatGptBridge(tabId, pending);
        if (injected) continue;
      }

      if (isMissingReceiverError(error) && injectionTried && !reloadTried && attempt >= 2) {
        reloadTried = true;
        try {
          await reloadTabForBridge(tabId, pending);
          continue;
        } catch (reloadError) {
          if (pending) await appendDiagnostic(pending.jobId, "TAB_RELOAD_FAILED", { tabId, error:String(reloadError?.message || reloadError || "") }, "background").catch(() => {});
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (pending) {
    appendDiagnostic(pending.jobId, "PING_FAILED", { tabId, injectionTried, reloadTried }, "background").catch(() => {});
    rejectDelivery(pending.jobId, new Error("GPT_CONTENT_SCRIPT_UNAVAILABLE"));
  }
}

async function findExistingJobTab(jobId) {
  if (!jobId) return null;
  const data = await chrome.storage.local.get(JOB_TABS_KEY);
  const record = (data[JOB_TABS_KEY] || {})[jobId];
  if (!record?.tabId) return null;
  return await chrome.tabs.get(record.tabId).catch(() => null);
}

async function findReusableGptTab(gptUrl) {
  const target = normalizeUrl(gptUrl);
  const data = await chrome.storage.local.get(JOB_TABS_KEY);
  const jobs = data[JOB_TABS_KEY] || {};
  const busyTabIds = new Set(Object.values(jobs)
    .filter((record) => /WAITING_ACTION|USER_MESSAGE_COMMITTED|PROCESS|SENDING|WAITING_FILE|CAPTURING/i.test(String(record?.lastState || "")))
    .map((record) => record?.tabId)
    .filter(Boolean));
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  for (const tab of tabs) {
    if (busyTabIds.has(tab.id) || pendingByTab.has(tab.id) || sendingTabs.has(tab.id)) continue;
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
  await appendDiagnostic(payload.jobId, "DISPATCH_START", {
    specialist:target.key, gptUrl:diagnosticUrl(gptUrl), promptLength:payload.prompt.length,
    attachments:Array.isArray(payload.meta?.attachments) ? payload.meta.attachments.map((item) => ({ name:item?.name || "", contentType:item?.contentType || "", url:diagnosticUrl(item?.url || "") })) : [],
    sourceTabId, openMode:config.openMode
  }, "background").catch(() => {});
  await setStatus("OPENING_GPT", payload.jobId, `Abrindo ${target.label} no ChatGPT...`, { specialist: target.key });
  let tab = null;
  const forceNewConversation = payload.meta?.forceNewConversation === true;
  const preferredConversationUrl = /^https:\/\/chatgpt\.com\//i.test(String(payload.meta?.preferredConversationUrl || ""))
    ? String(payload.meta.preferredConversationUrl)
    : "";
  // Retry técnico do MESMO JOB volta primeiro para a aba que já pertence a ele.
  // Isso impede um retry de LOTE A de cair na conversa ocupada do LOTE B.
  if (!forceNewConversation) tab = await findExistingJobTab(payload.jobId);
  if (!tab && preferredConversationUrl) {
    const openTabs = await chrome.tabs.query({ url:"https://chatgpt.com/*" });
    tab = openTabs.find((candidate) => normalizeUrl(candidate.url || "") === normalizeUrl(preferredConversationUrl)) || null;
  }
  if (!tab && config.openMode === "reuse" && !forceNewConversation && !preferredConversationUrl) tab = await findReusableGptTab(gptUrl);

  if (tab?.id) {
    await appendDiagnostic(payload.jobId, "TAB_REUSED", { tabId:tab.id, url:diagnosticUrl(tab.url || ""), status:tab.status, active:tab.active }, "background").catch(() => {});
    const ownership = await rememberJobTab(payload.jobId, tab.id, false, { ...payload.meta, specialist:target.key });
    if (ownership.bridgeOwned) {
      await upsertCleanerRecord(payload.jobId, { eligible: true, tabId: tab.id, specialist: target.key, createdAt: payload.createdAt, day: localDay(payload.createdAt), done: false, deleted: false });
    }
    pendingByTab.set(tab.id, payload);
    const delivery = waitForDelivery(payload, tab.id, true, sourceTabId);
    pingTabUntilReady(tab.id).catch(() => {});
    return await delivery;
  }

  const launchUrl = preferredConversationUrl || gptUrl;
  tab = await chrome.tabs.create({ url: launchUrl, active: false });
  if (!tab.id) throw new Error("TAB_CREATE_FAILED");
  await appendDiagnostic(payload.jobId, "TAB_CREATED", { tabId:tab.id, url:diagnosticUrl(launchUrl), preferredConversation:Boolean(preferredConversationUrl), status:tab.status, active:tab.active }, "background").catch(() => {});
  await rememberJobTab(payload.jobId, tab.id, true, { ...payload.meta, specialist:target.key });
  await upsertCleanerRecord(payload.jobId, { eligible: true, tabId: tab.id, specialist: target.key, createdAt: payload.createdAt, day: localDay(payload.createdAt), done: false, deleted: false });
  pendingByTab.set(tab.id, payload);
  const delivery = waitForDelivery(payload, tab.id, false, sourceTabId);
  pingTabUntilReady(tab.id).catch(() => {});
  return await delivery;
}

function shouldBackgroundRetry(errorCode = "") {
  const code = String(errorCode || "").toUpperCase();
  return /GPT_SEND|COMPOSER_|ATTACHMENT_(INPUT|NOT_CONFIRMED)|READY_TO_SEND|SEND_BUTTON|BRIDGE_BUSY/.test(code);
}

async function sendWithBackgroundRetry(tabId, pending) {
  await appendDiagnostic(pending.jobId, "SEND_TO_CONTENT_START", { tabId, attempt:"background" }, "background").catch(() => {});
  let result;
  try { result = await chrome.tabs.sendMessage(tabId, { type: "CORVO_SEND_PROMPT", payload: pending }); }
  catch (error) {
    await appendDiagnostic(pending.jobId, "SEND_TO_CONTENT_EXCEPTION", { tabId, error:String(error?.message || error || "") }, "background").catch(() => {});
    throw error;
  }
  await appendDiagnostic(pending.jobId, "SEND_TO_CONTENT_RESULT", { tabId, result }, "background").catch(() => {});
  if (result?.ok) return result;

  let lastError = result?.error || "GPT_SEND_FAILED";
  if (!shouldBackgroundRetry(lastError)) throw new Error(lastError);

  // Nunca rouba o foco do usuário. As tentativas adicionais continuam na mesma
  // aba oculta; o usuário só traz uma conversa ao primeiro plano quando clica
  // explicitamente em ABRIR CONVERSA na Central ao Vivo.
  const retryDelays = [1800, 3500];
  for (let index = 0; index < retryDelays.length; index++) {
    await setStatus("BACKGROUND_RETRY", pending.jobId, `O envio ainda não confirmou (${lastError}). Tentando novamente em segundo plano...`, { firstError:lastError, retry:index + 1 });
    await new Promise((resolve) => setTimeout(resolve, retryDelays[index]));
    await appendDiagnostic(pending.jobId, "BACKGROUND_RETRY_START", { tabId, retry:index + 1, previousError:lastError }, "background").catch(() => {});
    try {
      const retryResult = await chrome.tabs.sendMessage(tabId, {
        type: "CORVO_SEND_PROMPT",
        payload: { ...pending, bridgeAttempt: `background-retry-${index + 1}` }
      });
      await appendDiagnostic(pending.jobId, "BACKGROUND_RETRY_RESULT", { tabId, retry:index + 1, result:retryResult }, "background").catch(() => {});
      if (retryResult?.ok) return retryResult;
      lastError = retryResult?.error || "GPT_SEND_FAILED";
      if (!shouldBackgroundRetry(lastError)) break;
    } catch (error) {
      lastError = String(error?.message || error || "GPT_SEND_FAILED");
      await appendDiagnostic(pending.jobId, "BACKGROUND_RETRY_EXCEPTION", { tabId, retry:index + 1, error:lastError }, "background").catch(() => {});
      if (!shouldBackgroundRetry(lastError)) break;
    }
  }
  throw new Error(lastError);
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
    appendDiagnostic(pending.jobId, "CONTENT_READY_SIGNAL", { tabId, senderUrl:diagnosticUrl(sender.tab?.url || "") }, "background").catch(() => {});
    if (sendingTabs.has(tabId)) { sendResponse({ ok: true, pending: true, sending: true }); return; }

    sendingTabs.add(tabId);
    setStatus("SENDING_TO_GPT", pending.jobId, "GPT carregado. Enviando solicitação...").catch(() => {});
    sendWithBackgroundRetry(tabId, pending)
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

  if (message.type === "CORVO_GPT_DIAG") {
    const payload = message.payload || {};
    appendDiagnostic(payload.jobId, payload.event || "CONTENT_DIAG", payload.details || {}, "content").catch(() => {});
    sendResponse({ ok:true });
    return;
  }

  if (message.type === "CORVO_GPT_STAGE") {
    const payload = message.payload || {};
    const jobId = payload.jobId || null;
    const state = String(payload.state || "SENDING_TO_GPT");
    const statusMessage = String(payload.message || "Preparando envio ao GPT...");
    touchDelivery(jobId, state);
    setStatus(state, jobId, statusMessage, payload).catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CORVO_GPT_SENT") {
    const tabId = sender.tab?.id;
    const jobId = message.payload?.jobId || null;
    const conversationUrl = message.payload?.conversationUrl || sender.tab?.url || "";
    if (jobId) {
      patchEligibleCleanerRecord(jobId, { conversationUrl, sentAt: Date.now() }).catch(() => {});
      chrome.storage.local.get(JOB_TABS_KEY).then(async (data) => {
        const jobs = data[JOB_TABS_KEY] || {};
        if (!jobs[jobId]) return;
        jobs[jobId] = { ...jobs[jobId], conversationUrl, sentAt:Date.now(), lastState:"WAITING_ACTION", lastMessage:"Solicitação enviada. Aguardando retorno pela Action.", lastUpdatedAt:Date.now() };
        await chrome.storage.local.set({ [JOB_TABS_KEY]:jobs });
      }).catch(() => {});
    }
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

  if (message.type === "CORVO_GET_JOB_ACTIVITY") {
    Promise.all([chrome.storage.local.get([JOB_TABS_KEY, CLEANER_RECORDS_KEY]), chrome.tabs.query({ url:"https://chatgpt.com/*" })])
      .then(([data, tabs]) => {
        const jobs = data[JOB_TABS_KEY] || {};
        const cleaner = Array.isArray(data[CLEANER_RECORDS_KEY]) ? data[CLEANER_RECORDS_KEY] : [];
        const tabMap = new Map((tabs || []).filter((tab) => tab?.id).map((tab) => [tab.id, tab]));
        const items = Object.entries(jobs).map(([id, record]) => {
          const tab = tabMap.get(record?.tabId);
          const clean = cleaner.find((item) => item?.jobId === id) || {};
          return {
            jobId:id, projectId:String(record?.projectId || ""), specialist:String(record?.specialist || clean?.specialist || ""),
            state:String(record?.lastState || "OPEN"), message:String(record?.lastMessage || "Conversa aberta no ChatGPT."),
            updatedAt:Number(record?.lastUpdatedAt || record?.savedAt || Date.now()), tabId:record?.tabId || null,
            tabStatus:String(tab?.status || ""), active:Boolean(tab?.active),
            conversationUrl:String(record?.conversationUrl || clean?.conversationUrl || tab?.url || ""),
            bridgeOwned:Boolean(record?.bridgeOwned),
            batchId:String(record?.batchId || ""), batchSize:Number(record?.batchSize || 0),
          };
        });
        sendResponse({ ok:true, jobs:items });
      })
      .catch((error) => sendResponse({ ok:false, error:String(error?.message || error || "JOB_ACTIVITY_FAILED") }));
    return true;
  }

  if (message.type === "CORVO_FOCUS_JOB") {
    const jobId = String(message.payload?.jobId || "").trim();
    if (!jobId) { sendResponse({ ok:false, error:"JOB_ID_REQUIRED" }); return; }
    chrome.storage.local.get([JOB_TABS_KEY, CLEANER_RECORDS_KEY]).then(async (data) => {
      const jobs = data[JOB_TABS_KEY] || {};
      const record = jobs[jobId];
      const cleaner = Array.isArray(data[CLEANER_RECORDS_KEY]) ? data[CLEANER_RECORDS_KEY] : [];
      const clean = cleaner.find((item) => item?.jobId === jobId) || {};
      let tab = record?.tabId ? await chrome.tabs.get(record.tabId).catch(() => null) : null;
      const url = String(record?.conversationUrl || clean?.conversationUrl || tab?.url || "");
      if (!tab && /^https:\/\/chatgpt\.com\//i.test(url)) tab = await chrome.tabs.create({ url, active:true });
      if (!tab?.id) { sendResponse({ ok:false, error:"JOB_TAB_NOT_FOUND", conversationUrl:url }); return; }
      await chrome.tabs.update(tab.id, { active:true });
      if (typeof tab.windowId === "number") await chrome.windows.update(tab.windowId, { focused:true }).catch(() => {});
      sendResponse({ ok:true, jobId, tabId:tab.id, conversationUrl:url || tab.url || "" });
    }).catch((error) => sendResponse({ ok:false, error:String(error?.message || error || "FOCUS_JOB_FAILED") }));
    return true;
  }

  if (message.type === "CORVO_GET_STATUS") {
    chrome.storage.local.get(["corvoBridgeStatus", CAPTURE_RECOVERY_KEY]).then((data) => {
      const status = data.corvoBridgeStatus || lastStatus;
      const recovery = status?.jobId ? (data[CAPTURE_RECOVERY_KEY] || {})[status.jobId] : null;
      sendResponse({ ...status, canRetryCapture: Boolean(status?.jobId && (["CAPTURING_FILE", "UPLOADING_FILE", "ERROR"].includes(status.state))), captureRecovery: recovery ? { stage: recovery.stage, updatedAt: recovery.updatedAt } : null });
    });
    return true;
  }

  if (message.type === "CORVO_GET_DIAGNOSTIC") {
    getDiagnostic(message.payload?.jobId).then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message || error || "DIAGNOSTIC_FAILED") }));
    return true;
  }

  if (message.type === "CORVO_CLEAR_DIAGNOSTIC") {
    const jobId = String(message.payload?.jobId || lastStatus?.jobId || "");
    chrome.storage.local.get(DIAGNOSTICS_KEY).then(async (data) => {
      const store = data[DIAGNOSTICS_KEY] || { order:[], jobs:{} };
      if (jobId && store.jobs) delete store.jobs[jobId];
      if (Array.isArray(store.order)) store.order = store.order.filter((id) => id !== jobId);
      await chrome.storage.local.set({ [DIAGNOSTICS_KEY]:store });
      sendResponse({ ok:true, jobId });
    }).catch((error) => sendResponse({ ok:false, error:String(error?.message || error || "DIAGNOSTIC_CLEAR_FAILED") }));
    return true;
  }

  if (message.type === "CORVO_CLEANER_GET_STATE") {
    Promise.all([repairCleanerRecords(), chrome.storage.local.get([CLEANER_LOG_KEY, "corvoBridgeCleanerStatus", JOB_TABS_KEY]), getConfig()])
      .then(([records, data, config]) => {
        const jobs = data[JOB_TABS_KEY] || {};
        const hydrated = records.map((record) => {
          const live = jobs[record.jobId] || {};
          return {
            ...record,
            lastBridgeState:record.lastBridgeState || live.lastState || "",
            lastBridgeStateAt:record.lastBridgeStateAt || live.lastUpdatedAt || 0,
            lastBridgeErrorAt:record.lastBridgeErrorAt || (String(live.lastState || "").toUpperCase() === "ERROR" ? live.lastUpdatedAt : 0),
          };
        });
        sendResponse({ ok: true, records:hydrated, log: data[CLEANER_LOG_KEY] || [], status: data.corvoBridgeCleanerStatus || null, config });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CORVO_FETCH_ATTACHMENT") {
    fetchAttachmentForChat(message.payload || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || "ATTACHMENT_FETCH_FAILED" }));
    return true;
  }

  if (message.type === "CORVO_CAPTURE_AND_UPLOAD") {
    const jobId = String(message.payload?.jobId || "").trim();
    if (!jobId) { sendResponse({ ok: false, error: "JOB_ID_REQUIRED" }); return; }
    captureAndUploadFile(jobId, message.payload)
      .then(sendResponse)
      .catch(async (error) => {
        await setStatus("ERROR", jobId, `Falha ao capturar arquivo: ${error.message}`);
        sendResponse({ ok: false, error: error.message || "FILE_CAPTURE_FAILED" });
      });
    return true;
  }


  if (message.type === "CORVO_RETRY_LAST_CAPTURE") {
    retryLastCapture()
      .then(sendResponse)
      .catch(async (error) => {
        const data = await chrome.storage.local.get("corvoBridgeStatus");
        const jobId = data.corvoBridgeStatus?.jobId || null;
        await setStatus("ERROR", jobId, `Falha ao capturar arquivo: ${error.message}`);
        sendResponse({ ok: false, error: error.message || "FILE_CAPTURE_FAILED" });
      });
    return true;
  }

  if (message.type === "CORVO_CLEANER_RUN_NOW") {
    runCleaner({ manual: true }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CORVO_CLEANER_DELETE_MAPPED_NOW") {
    runCleaner({ manual: true, forceDelete: true }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CORVO_CLEANER_RESCHEDULE") {
    scheduleCleaner().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CORVO_JOB_COMPLETE") {
    const jobId = String(message.payload?.jobId || "").trim();
    if (!jobId) { sendResponse({ ok: false, error: "JOB_ID_REQUIRED" }); return; }
    patchEligibleCleanerRecord(jobId, { done: true, completedAt: Date.now() })
      .then(() => completeJobTab(jobId))
      .then(async (result) => {
        await setStatus("COMPLETED", jobId, result.closed ? "Resultado recebido. Aba do GPT fechada." : "Resultado recebido.");
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || "TAB_CLOSE_FAILED" }));
    return true;
  }
});


chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANER_ALARM) runCleaner().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => { scheduleCleaner().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => {
  scheduleCleaner().catch(() => {});
  getConfig().then(async (config) => {
    if (!config.cleanerEnabled) return;
    const [h, m] = String(config.cleanerHour || "22:00").split(":").map(Number);
    const now = new Date();
    const todayRun = new Date();
    todayRun.setHours(h || 0, m || 0, 0, 0);
    const status = (await chrome.storage.local.get("corvoBridgeCleanerStatus")).corvoBridgeCleanerStatus;
    if (now >= todayRun && (!status?.at || localDay(status.at) !== localDay(now.getTime()))) runCleaner().catch(() => {});
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = String(changeInfo?.url || tab?.url || "");
  if (!conversationKey(url)) return;
  chrome.storage.local.get(JOB_TABS_KEY).then((data) => {
    const jobs = data[JOB_TABS_KEY] || {};
    const matches = Object.entries(jobs).filter(([, record]) => record?.tabId === tabId);
    return Promise.all(matches.map(([jobId]) => patchEligibleCleanerRecord(jobId, { conversationUrl: url, conversationSeenAt: Date.now() })));
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const pending = pendingByTab.get(tabId);
  if (pending) rejectDelivery(pending.jobId, new Error("GPT_SEND_FAILED"));
  pendingByTab.delete(tabId);
  sendingTabs.delete(tabId);
  forgetTab(tabId).catch(() => {});
});
