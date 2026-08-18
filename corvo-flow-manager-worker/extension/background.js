const attachedTabs = new Set();
const inputCancelEpochByTab = new Map();
const hardStoppedTabs = new Set();

function isHardStopped(tabId) {
  return hardStoppedTabs.has(Number(tabId));
}

function makeStoppedError() {
  const error = new Error('FLOW_BATCH_STOPPED');
  error.code = 'FLOW_BATCH_STOPPED';
  return error;
}

function assertTabActuationAllowed(tabId) {
  if (isHardStopped(tabId)) throw makeStoppedError();
}

async function hardStopTab(tabId) {
  tabId = Number(tabId);
  if (!Number.isFinite(tabId) || tabId <= 0) throw new Error('Aba do Flow não identificada');
  hardStoppedTabs.add(tabId);
  const epoch = cancelPendingInput(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}
  attachedTabs.delete(tabId);
  return { tabId, epoch };
}

async function armTab(tabId) {
  tabId = Number(tabId);
  if (!Number.isFinite(tabId) || tabId <= 0) throw new Error('Aba do Flow não identificada');
  hardStoppedTabs.delete(tabId);
  cancelPendingInput(tabId); // invalida qualquer operação antiga que ainda tenha epoch anterior
  await ensureAttached(tabId);
  return { tabId };
}

function currentCancelEpoch(tabId) {
  return inputCancelEpochByTab.get(tabId) || 0;
}

function cancelPendingInput(tabId) {
  const next = currentCancelEpoch(tabId) + 1;
  inputCancelEpochByTab.set(tabId, next);
  return next;
}

function assertInputNotCancelled(tabId, epoch) {
  assertTabActuationAllowed(tabId);
  if (currentCancelEpoch(tabId) !== epoch) throw makeStoppedError();
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureAttached(tabId) {
  assertTabActuationAllowed(tabId);
  if (attachedTabs.has(tabId)) return;

  // O service worker do MV3 pode dormir e perder o Set local mesmo com o
  // debugger ainda anexado. Confere os targets antes de tentar anexar de novo.
  try {
    const targets = await chrome.debugger.getTargets();
    const already = targets.find(target => target.tabId === tabId && target.attached);
    if (already) {
      attachedTabs.add(tabId);
      return;
    }
  } catch (_) {}

  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTabs.add(tabId);
}

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

async function dispatchKey(tabId, params) {
  assertTabActuationAllowed(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params);
  assertTabActuationAllowed(tabId);
}

async function clearCurrentField(tabId) {
  await dispatchKey(tabId, {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await dispatchKey(tabId, {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2
  });
  await dispatchKey(tabId, {
    type: 'keyDown',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
  await dispatchKey(tabId, {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8
  });
}

// Texto comum: usa eventos CDP do tipo `char`, um caractere por vez.
// Não usa element.value, dispatchEvent nem KeyboardEvent sintético.
async function dispatchRealText(tabId, text, delayMin = 8, delayMax = 20, clearFirst = false) {
  await ensureAttached(tabId);
  const cancelEpoch = currentCancelEpoch(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);
  if (clearFirst) await clearCurrentField(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);

  for (const ch of Array.from(text)) {
    assertInputNotCancelled(tabId, cancelEpoch);
    if (ch === '\n') {
      await dispatchKey(tabId, {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
      await dispatchKey(tabId, {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
    } else {
      await dispatchKey(tabId, {
        type: 'char',
        text: ch,
        unmodifiedText: ch
      });
    }

    const low = Math.max(0, Number(delayMin) || 0);
    const high = Math.max(low, Number(delayMax) || low);
    const wait = Math.floor(low + Math.random() * (high - low + 1));
    if (wait) await sleep(wait);
    assertInputNotCancelled(tabId, cancelEpoch);
  }
}

// O @ é enviado pelo CDP com a sequência canônica rawKeyDown -> char -> keyUp.
// O evento `char` é essencial: ele gera a entrada de texto real que faz o Flow
// reconhecer a menção e abrir o painel. A versão anterior usava apenas keyDown
// com `text`, o que podia desenhar @ sem disparar corretamente o autocomplete.
async function dispatchRealAt(tabId) {
  await ensureAttached(tabId);
  const cancelEpoch = currentCancelEpoch(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);

  await dispatchKey(tabId, {
    type: 'rawKeyDown',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
    modifiers: 8
  });

  assertInputNotCancelled(tabId, cancelEpoch);
  await dispatchKey(tabId, {
    type: 'rawKeyDown',
    key: '@',
    code: 'Digit2',
    windowsVirtualKeyCode: 50,
    nativeVirtualKeyCode: 50,
    modifiers: 8
  });

  assertInputNotCancelled(tabId, cancelEpoch);
  await dispatchKey(tabId, {
    type: 'char',
    key: '@',
    code: 'Digit2',
    text: '@',
    unmodifiedText: '@',
    windowsVirtualKeyCode: 64,
    nativeVirtualKeyCode: 64,
    modifiers: 8
  });

  assertInputNotCancelled(tabId, cancelEpoch);
  await dispatchKey(tabId, {
    type: 'keyUp',
    key: '@',
    code: 'Digit2',
    windowsVirtualKeyCode: 50,
    nativeVirtualKeyCode: 50,
    modifiers: 8
  });

  assertInputNotCancelled(tabId, cancelEpoch);
  await dispatchKey(tabId, {
    type: 'keyUp',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
    modifiers: 0
  });
}


async function dispatchRealClick(tabId, x, y) {
  await ensureAttached(tabId);
  const cancelEpoch = currentCancelEpoch(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    throw new Error('Coordenadas inválidas para clique real');
  }

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: px,
    y: py,
    button: 'none'
  });
  await sleep(40);
  assertInputNotCancelled(tabId, cancelEpoch);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: px,
    y: py,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sleep(55);
  assertInputNotCancelled(tabId, cancelEpoch);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: px,
    y: py,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  assertInputNotCancelled(tabId, cancelEpoch);
}

async function insertTextAtCurrentFocus(tabId, text) {
  await ensureAttached(tabId);
  const cancelEpoch = currentCancelEpoch(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: String(text || '') });
  assertInputNotCancelled(tabId, cancelEpoch);
}

// Entrada rápida para prompts longos: não usa clipboard/paste e também não
// altera element.value diretamente. O texto entra pelo próprio subsistema de
// Input do Chrome em blocos grandes, reduzindo drasticamente o tempo em relação
// ao envio caractere por caractere.
async function insertTextInChunks(tabId, text, chunkSize = 240, delayMin = 12, delayMax = 28, clearFirst = false) {
  await ensureAttached(tabId);
  const cancelEpoch = currentCancelEpoch(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);
  if (clearFirst) await clearCurrentField(tabId);
  assertInputNotCancelled(tabId, cancelEpoch);

  const points = Array.from(String(text || ''));
  const size = Math.max(24, Math.min(1000, Number(chunkSize) || 240));
  const low = Math.max(0, Number(delayMin) || 0);
  const high = Math.max(low, Number(delayMax) || low);

  for (let i = 0; i < points.length; i += size) {
    assertInputNotCancelled(tabId, cancelEpoch);
    const chunk = points.slice(i, i + size).join('');
    if (chunk) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: chunk });
    }

    if (i + size < points.length) {
      const wait = Math.floor(low + Math.random() * (high - low + 1));
      if (wait) await sleep(wait);
      assertInputNotCancelled(tabId, cancelEpoch);
    }
  }
}


const downloadRequestLocks = new Map();
const DOWNLOAD_GUARD_STORAGE_KEY = 'corvoFlowDownloadGuardsV1';

async function startDownloadOnce({ url, filename, exactName = true, downloadToken = '' }) {
  const token = String(downloadToken || '').trim();
  if (!token) {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({ url, filename, saveAs: false, conflictAction: exactName ? 'overwrite' : 'uniquify' }, id => {
        const err = chrome.runtime.lastError;
        if (err || !id) reject(new Error(err?.message || 'Download não iniciado'));
        else resolve(id);
      });
    });
    return { ok: true, downloadId, deduped: false };
  }

  if (downloadRequestLocks.has(token)) return downloadRequestLocks.get(token);

  const task = (async () => {
    const data = await chrome.storage.local.get([DOWNLOAD_GUARD_STORAGE_KEY]);
    const guards = { ...(data[DOWNLOAD_GUARD_STORAGE_KEY] || {}) };
    const previous = guards[token];

    if (previous?.downloadId) {
      return { ok: true, downloadId: previous.downloadId, deduped: true, guarded: true };
    }
    if (previous?.status === 'reserved' || previous?.status === 'start_failed') {
      return { ok: false, guarded: true, error: 'DOWNLOAD_GUARD: já existe uma solicitação para este JOB/asset; novo download automático bloqueado.' };
    }

    guards[token] = { status: 'reserved', filename, createdAt: Date.now() };
    const keys = Object.keys(guards);
    if (keys.length > 600) {
      keys.sort((a,b) => Number(guards[a]?.createdAt || 0) - Number(guards[b]?.createdAt || 0));
      for (const key of keys.slice(0, keys.length - 500)) delete guards[key];
    }
    await chrome.storage.local.set({ [DOWNLOAD_GUARD_STORAGE_KEY]: guards });

    let downloadId;
    try {
      downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false, conflictAction: exactName ? 'overwrite' : 'uniquify' }, id => {
          const err = chrome.runtime.lastError;
          if (err || !id) reject(new Error(err?.message || 'Download não iniciado'));
          else resolve(id);
        });
      });
    } catch (error) {
      guards[token] = { ...guards[token], status: 'start_failed', error: String(error?.message || error), updatedAt: Date.now() };
      await chrome.storage.local.set({ [DOWNLOAD_GUARD_STORAGE_KEY]: guards });
      throw error;
    }

    guards[token] = { status: 'started', downloadId, filename, createdAt: guards[token]?.createdAt || Date.now(), updatedAt: Date.now() };
    await chrome.storage.local.set({ [DOWNLOAD_GUARD_STORAGE_KEY]: guards });
    return { ok: true, downloadId, deduped: false, guarded: true };
  })();

  downloadRequestLocks.set(token, task);
  try {
    return await task;
  } finally {
    downloadRequestLocks.delete(token);
  }
}



// ---------------------------------------------------------------------------
// V4.0.2 — Bridge do Worker com o CORVO FLOW MANAGER local.
// Cada instância do Chrome é vinculada a um profileId persistente pelo URL
// /worker-bootstrap aberto pelo Manager. A extensão nunca armazena senha Google.
// ---------------------------------------------------------------------------
const FLOW_MANAGER_BINDING_KEY = 'corvoFlowManagerBindingV4';
const FLOW_MANAGER_DEFAULT_BASE = 'http://127.0.0.1:32145';
let managerTickLock = null;

async function getManagerBinding() {
  const data = await chrome.storage.local.get([FLOW_MANAGER_BINDING_KEY]);
  return data[FLOW_MANAGER_BINDING_KEY] || null;
}

async function bindManagerProfile(profileId, token, managerBase = FLOW_MANAGER_DEFAULT_BASE) {
  const binding = {
    profileId: String(profileId || '').trim(),
    token: String(token || '').trim(),
    managerBase: String(managerBase || FLOW_MANAGER_DEFAULT_BASE).replace(/\/$/, ''),
    boundAt: new Date().toISOString()
  };
  if (!binding.profileId || !binding.token) throw new Error('Binding do Manager incompleto');
  await chrome.storage.local.set({ [FLOW_MANAGER_BINDING_KEY]: binding });
  return binding;
}

async function managerFetch(binding, pathname, payload) {
  const base = String(binding?.managerBase || FLOW_MANAGER_DEFAULT_BASE).replace(/\/$/, '');
  const response = await fetch(`${base}${pathname}`, {
    method: payload == null ? 'GET' : 'POST',
    headers: payload == null ? undefined : { 'content-type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
    cache: 'no-store'
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) throw new Error(json?.error || `Manager HTTP ${response.status}`);
  return json;
}


function isFlowWorkerUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.hostname === 'labs.google' && url.pathname.startsWith('/fx/tools/flow')) return true;
    if (url.hostname === 'flow.google.com') return true;
    return false;
  } catch (_) {
    return false;
  }
}

function isManagerBootstrapUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/worker-bootstrap';
  } catch (_) {
    return false;
  }
}

async function closeDuplicateBootstrapTabs(keepTabId = null) {
  const tabs = await chrome.tabs.query({});
  const ids = tabs
    .filter(tab => isManagerBootstrapUrl(tab.url) && tab.id !== keepTabId)
    .map(tab => tab.id)
    .filter(Number.isInteger);
  if (ids.length) await chrome.tabs.remove(ids).catch(() => {});
  return ids.length;
}

async function ensureSingleFlowTab(flowUrl, keepBootstrapTabId = null) {
  const targetUrl = String(flowUrl || 'https://labs.google/fx/tools/flow').trim() || 'https://labs.google/fx/tools/flow';
  const tabs = await chrome.tabs.query({});
  const flowTabs = tabs.filter(tab => isFlowWorkerUrl(tab.url));

  let keep = null;
  if (flowTabs.length) {
    keep = flowTabs.find(tab => tab.active) ||
      flowTabs.find(tab => String(tab.url || '').startsWith(targetUrl)) ||
      flowTabs.find(tab => tab.status === 'complete') ||
      flowTabs[0];
  }

  if (!keep) {
    keep = await chrome.tabs.create({ url: targetUrl, active: true });
  } else {
    // Se a aba conservada estiver em uma rota antiga do Flow, leva-a para a URL configurada.
    if (!isFlowWorkerUrl(keep.url)) {
      keep = await chrome.tabs.update(keep.id, { url: targetUrl, active: true });
    } else {
      await chrome.tabs.update(keep.id, { active: true }).catch(() => {});
    }
  }

  const duplicateIds = flowTabs
    .filter(tab => tab.id !== keep.id)
    .map(tab => tab.id)
    .filter(Number.isInteger);
  if (duplicateIds.length) await chrome.tabs.remove(duplicateIds).catch(() => {});

  const bootstrapClosed = await closeDuplicateBootstrapTabs(keepBootstrapTabId);

  // V4.2.3: checagens extras após abrir/reativar o perfil. O erro client-side pode
  // surgir alguns segundos depois do primeiro load e, em certos casos, não há DOM
  // utilizável. Consultar tab.title pelo background cobre esse cenário.
  if (Number.isInteger(keep?.id)) {
    [900, 2200, 5000].forEach(delay => setTimeout(() => {
      chrome.tabs.get(keep.id).then(current => {
        if (!current?.url || !isFlowWorkerUrl(current.url)) return;
        return maybeRecoverFlowClientErrorFromTab(current.id, current.url, current.title || '', `post_open_${delay}ms`);
      }).catch(() => {});
    }, delay));
  }

  return { tabId: keep?.id || null, duplicatesClosed: duplicateIds.length, bootstrapClosed };
}

async function notifyManagerBootstrap(binding) {
  try {
    return await managerFetch(binding, '/api/worker/bootstrap', {
      profileId: binding.profileId,
      token: binding.token,
      workerId: `FLOW_WORKER_${binding.profileId}`,
      protocol: '4.2.9'
    });
  } catch (error) {
    return { ok:false, error:String(error?.message || error) };
  }
}

async function handleManagerTick(message, sender) {
  const binding = await getManagerBinding();
  if (!binding?.profileId || !binding?.token) return { ok: true, managed: false };
  const workerState = message?.workerState || {};
  const workerId = workerState.workerId || `FLOW_WORKER_${binding.profileId}`;
  const result = await managerFetch(binding, '/api/worker/tick', {
    profileId: binding.profileId,
    token: binding.token,
    workerId,
    protocol: '4.2.9',
    tabId: sender?.tab?.id || null,
    workerState
  });
  return { ...result, managed: true, binding: { profileId: binding.profileId, managerBase: binding.managerBase } };
}

async function handleManagerLifecycleEvent(message) {
  const binding = await getManagerBinding();
  if (!binding?.profileId || !binding?.token) return { ok:true, managed:false };
  const event = message?.event || {};
  const result = await managerFetch(binding, '/api/worker/event', {
    profileId: binding.profileId,
    token: binding.token,
    workerId: event.workerId || `FLOW_WORKER_${binding.profileId}`,
    protocol: '4.2.9',
    event
  });
  return { ...result, managed:true, binding:{ profileId:binding.profileId, managerBase:binding.managerBase } };
}

async function tryBindBootstrapTab(tabId, rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/worker-bootstrap') return false;
    const profileId = url.searchParams.get('profileId') || '';
    const token = url.searchParams.get('token') || '';
    if (!profileId || !token) return false;
    const binding = await bindManagerProfile(profileId, token, `${url.protocol}//${url.host}`);
    const ping = await notifyManagerBootstrap(binding);
    if (ping?.ok) await ensureSingleFlowTab(ping.flowUrl, tabId);
    // Limpa automaticamente todas as abas bootstrap antigas. O navegador de cada
    // perfil é dedicado ao Worker, portanto deve permanecer com uma única aba Flow.
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 500);
    return true;
  } catch (_) {
    return false;
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  if (url) tryBindBootstrapTab(tabId, url).catch(() => {});

  // V4.2.3: o erro do Next/Flow frequentemente aparece primeiro no TITULO da aba
  // (o balão do Chrome mostra "Application error..."), enquanto o body pode estar
  // vazio/quebrado e o content script V4.2.2 não consegue enxergar a mensagem.
  // O service worker agora observa o título diretamente via chrome.tabs, sem depender
  // do DOM/content script para decidir o reload.
  const title = changeInfo.title || tab?.title || '';
  if (url && isFlowWorkerUrl(url) && (changeInfo.title || changeInfo.status === 'complete')) {
    maybeRecoverFlowClientErrorFromTab(tabId, url, title, 'tabs_onUpdated').catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(tab => {
    if (!tab?.url || !isFlowWorkerUrl(tab.url)) return;
    return maybeRecoverFlowClientErrorFromTab(tab.id, tab.url, tab.title || '', 'tab_activated');
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(async tab => {
    await tryBindBootstrapTab(tab.id, tab.url);
    if (tab?.url && isFlowWorkerUrl(tab.url)) {
      await maybeRecoverFlowClientErrorFromTab(tab.id, tab.url, tab.title || '', 'extension_startup');
    }
  }))).catch(() => {});
  getManagerBinding().then(async binding => {
    if (!binding?.profileId) return;
    const ping = await notifyManagerBootstrap(binding);
    if (ping?.ok) await ensureSingleFlowTab(ping.flowUrl);
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// V4.2.3 — AUTO RELOAD PARA ERRO CLIENT-SIDE DO FLOW
// O content script detecta a tela de exceção e pede reload da MESMA aba.
// O guard é persistente por perfil para sobreviver ao próprio reload e impedir loop.
// ---------------------------------------------------------------------------
const FLOW_CLIENT_RELOAD_GUARD_KEY = 'corvoFlowClientReloadGuardV422';

async function flowClientReloadGuard(profileId = '', tabId = 0) {
  const now = Date.now();
  const key = String(profileId || `TAB_${tabId || 0}`);
  const stored = await chrome.storage.local.get(FLOW_CLIENT_RELOAD_GUARD_KEY).catch(() => ({}));
  const all = stored?.[FLOW_CLIENT_RELOAD_GUARD_KEY] && typeof stored[FLOW_CLIENT_RELOAD_GUARD_KEY] === 'object'
    ? stored[FLOW_CLIENT_RELOAD_GUARD_KEY]
    : {};
  const recent = Array.isArray(all[key]) ? all[key].map(Number).filter(ts => now - ts < 120000) : [];
  const last = recent.length ? recent[recent.length - 1] : 0;

  if (last && now - last < 3500) {
    all[key] = recent;
    await chrome.storage.local.set({ [FLOW_CLIENT_RELOAD_GUARD_KEY]: all }).catch(() => {});
    return { allowed: false, cooldown: true, attempt: recent.length || 1 };
  }
  if (recent.length >= 4) {
    all[key] = recent;
    await chrome.storage.local.set({ [FLOW_CLIENT_RELOAD_GUARD_KEY]: all }).catch(() => {});
    return { allowed: false, blocked: true, attempt: recent.length };
  }

  recent.push(now);
  all[key] = recent;
  // Prune perfis antigos para não crescer indefinidamente.
  for (const [guardKey, values] of Object.entries(all)) {
    const filtered = Array.isArray(values) ? values.map(Number).filter(ts => now - ts < 120000) : [];
    if (filtered.length) all[guardKey] = filtered;
    else delete all[guardKey];
  }
  await chrome.storage.local.set({ [FLOW_CLIENT_RELOAD_GUARD_KEY]: all });
  return { allowed: true, attempt: recent.length };
}

// V4.2.3 — BACKGROUND TITLE WATCHDOG
// O screenshot real revelou que a mensagem pode existir apenas como título da aba
// do Chrome (tab hover card), sem texto confiável no DOM. Nesse caso o content script
// não consegue pedir o reload. O background observa tab.title e recarrega sozinho.
const FLOW_CLIENT_ERROR_TITLE_PATTERNS = [
  /application error\s*:\s*a client-side exception has occurred/i,
  /client-side exception has occurred/i,
  /application error.*client-side/i,
  /erro (?:do|de) aplicativo.*(?:cliente|navegador)/i,
  /exce[cç][aã]o.*(?:lado do cliente|client-side)/i
];

function isFlowClientErrorSignalText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return FLOW_CLIENT_ERROR_TITLE_PATTERNS.some(re => re.test(text));
}

async function reloadFlowClientErrorTab(tabId, rawUrl, reason = 'background_watchdog', signalText = '') {
  if (!Number.isInteger(tabId)) return { ok:false, error:'Aba inválida para Auto Reload.' };
  const url = String(rawUrl || '');
  if (!isFlowWorkerUrl(url)) return { ok:false, error:'Reload recusado: aba fora do Google Flow.' };

  const binding = await getManagerBinding().catch(() => null);
  const guard = await flowClientReloadGuard(binding?.profileId || '', tabId);
  if (guard.cooldown) return { ok:true, skipped:true, cooldown:true, attempt:guard.attempt };
  if (guard.blocked) {
    await chrome.storage.local.set({
      corvoFlowClientErrorLastBackgroundRecovery: {
        at: new Date().toISOString(), profileId: binding?.profileId || '', tabId, url,
        reason, signalText: String(signalText || ''), blocked: true, attempt: guard.attempt
      }
    }).catch(() => {});
    return { ok:false, blocked:true, attempt:guard.attempt, error:'Auto Reload interrompido após 4 tentativas em 2 minutos.' };
  }

  await chrome.storage.local.set({
    corvoFlowClientErrorLastBackgroundRecovery: {
      at: new Date().toISOString(), profileId: binding?.profileId || '', tabId, url,
      reason, signalText: String(signalText || ''), blocked: false, attempt: guard.attempt
    }
  }).catch(() => {});

  setTimeout(() => {
    chrome.tabs.reload(tabId, { bypassCache: guard.attempt >= 3 }).catch(() => {});
  }, 350);
  return { ok:true, reloading:true, attempt:guard.attempt, bypassCache:guard.attempt >= 3 };
}

async function maybeRecoverFlowClientErrorFromTab(tabId, rawUrl, title = '', reason = 'background_watchdog') {
  if (!isFlowWorkerUrl(rawUrl)) return false;
  let signal = String(title || '');
  if (!signal) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    signal = String(tab?.title || '');
    rawUrl = tab?.url || rawUrl;
  }
  if (!isFlowClientErrorSignalText(signal)) return false;
  await reloadFlowClientErrorTab(tabId, rawUrl, reason, signal);
  return true;
}

async function handleFlowClientErrorReload(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return { ok: false, error: 'Aba do Flow não identificada para reload.' };
  const url = String(sender?.tab?.url || message?.url || '');
  if (!/^https:\/\/(?:labs\.google|flow\.google)\//i.test(url)) {
    return { ok: false, error: 'Reload recusado: a aba não pertence ao Google Flow.' };
  }

  return reloadFlowClientErrorTab(
    tabId,
    url,
    String(message?.reason || 'content_script'),
    String(message?.message || '')
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message?.type === 'FLOW_CLIENT_ERROR_RELOAD') {
    handleFlowClientErrorReload(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ ok:false, error:String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_MANAGER_BIND_PROFILE') {
    bindManagerProfile(message.profileId, message.token, message.managerBase || FLOW_MANAGER_DEFAULT_BASE)
      .then(async binding => {
        const ping = await notifyManagerBootstrap(binding);
        const flowTab = ping?.ok ? await ensureSingleFlowTab(ping.flowUrl, sender?.tab?.id || null) : null;
        sendResponse({ ok:true, profileId:binding.profileId, managerBase:binding.managerBase, managerPing:ping, flowTab });
      })
      .catch(err => sendResponse({ ok:false, error:String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_MANAGER_GET_BINDING') {
    getManagerBinding()
      .then(binding => sendResponse({ ok: true, managed: !!binding?.profileId, binding: binding ? { profileId: binding.profileId, managerBase: binding.managerBase } : null }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_MANAGER_LIFECYCLE_EVENT') {
    handleManagerLifecycleEvent(message)
      .then(sendResponse)
      .catch(err => sendResponse({ ok:false, managed:true, error:String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_MANAGER_TICK') {
    if (managerTickLock) {
      managerTickLock.then(sendResponse).catch(err => sendResponse({ ok:false, error:String(err?.message || err) }));
      return true;
    }
    managerTickLock = handleManagerTick(message, sender).finally(() => { managerTickLock = null; });
    managerTickLock.then(sendResponse).catch(err => sendResponse({ ok:false, managed:true, error:String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_HARD_STOP_TAB') {
    const targetTabId = Number(message.tabId || tabId);
    hardStopTab(targetTabId)
      .then(info => sendResponse({ ok: true, hardStopped: true, debuggerAttached: false, ...info }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_ARM_TAB') {
    const targetTabId = Number(message.tabId || tabId);
    armTab(targetTabId)
      .then(info => sendResponse({ ok: true, hardStopped: false, debuggerAttached: true, ...info }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_PREPARE_FLOW_TAB') {
    const targetTabId = Number(message.tabId || tabId);
    if (!Number.isFinite(targetTabId) || targetTabId <= 0) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }
    if (isHardStopped(targetTabId)) {
      sendResponse({ ok: true, tabId: targetTabId, debuggerAttached: false, hardStopped: true });
      return;
    }
    ensureAttached(targetTabId)
      .then(() => sendResponse({ ok: true, tabId: targetTabId, debuggerAttached: true, hardStopped: false }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_DEBUGGER_STATUS') {
    const targetTabId = Number(message.tabId || tabId);
    chrome.debugger.getTargets()
      .then(targets => {
        const target = targets.find(item => item.tabId === targetTabId);
        sendResponse({ ok: true, attached: !!target?.attached, hardStopped: isHardStopped(targetTabId), tabId: targetTabId });
      })
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_CANCEL_INPUT') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }
    const epoch = cancelPendingInput(tabId);
    sendResponse({ ok: true, cancelled: true, epoch });
    return;
  }

  if (message?.type === 'FLOW_BATCH_CLEAR_FIELD') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    ensureAttached(tabId)
      .then(() => clearCurrentField(tabId))
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_REAL_TYPE') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    dispatchRealText(
      tabId,
      message.text || '',
      message.delayMin ?? 8,
      message.delayMax ?? 20,
      !!message.clearFirst
    )
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_REAL_AT') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    dispatchRealAt(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }



  if (message?.type === 'FLOW_BATCH_REAL_CLICK') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    dispatchRealClick(tabId, message.x, message.y)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_FAST_TYPE') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    insertTextInChunks(
      tabId,
      message.text || '',
      message.chunkSize ?? 240,
      message.delayMin ?? 12,
      message.delayMax ?? 28,
      !!message.clearFirst
    )
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_INSERT_TEXT') {
    if (!tabId) {
      sendResponse({ ok: false, error: 'Aba do Flow não identificada' });
      return;
    }

    insertTextAtCurrentFocus(tabId, message.text || '')
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_DOWNLOAD') {
    const blob = new Blob([message.content || ''], { type: 'text/plain;charset=utf-8' });
    const reader = new FileReader();
    reader.onload = () => {
      chrome.downloads.download({
        url: reader.result,
        filename: message.filename || 'flow_batch_resultado.txt',
        saveAs: true
      });
    };
    reader.readAsDataURL(blob);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'FLOW_BATCH_DELIVER_APP_ASSET') {
    getManagerBinding()
      .then(binding => {
        if (!binding?.profileId || !binding?.token) throw new Error('Manager não vinculado a este Worker');
        return (async () => {
          let dataUrl = String(message.dataUrl || '');
          let contentType = String(message.contentType || '');
          const assetUrl = String(message.assetUrl || '');
          if (!dataUrl && assetUrl) {
            const response = await fetch(assetUrl, { cache:'no-store' });
            if (!response.ok) throw new Error(`ASSET_FETCH_${response.status}`);
            const blob = await response.blob();
            contentType = contentType || blob.type || '';
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            dataUrl = `data:${contentType || 'application/octet-stream'};base64,${btoa(binary)}`;
          }
          return managerFetch(binding, '/api/worker/asset', {
            profileId:binding.profileId, token:binding.token, jobId:String(message.jobId || ''),
            filename:String(message.filename || ''), dataUrl, contentType
          });
        })();
      })
      .then(sendResponse)
      .catch(error => sendResponse({ ok:false, error:String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_DOWNLOAD_URL') {
    const url = String(message.url || '');
    const filename = String(message.filename || 'corvo-flow-asset.png').replace(/^[/\\]+/, '');
    if (!url) {
      sendResponse({ ok: false, error: 'URL do asset ausente' });
      return;
    }
    startDownloadOnce({ url, filename, exactName: !!message.exactName, downloadToken: message.downloadToken || '' })
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'FLOW_BATCH_DOWNLOAD_STATUS') {
    const id = Number(message.downloadId);
    if (!Number.isFinite(id)) {
      sendResponse({ ok: false, state: 'interrupted', error: 'downloadId inválido' });
      return;
    }
    chrome.downloads.search({ id }, items => {
      const err = chrome.runtime.lastError;
      const item = items?.[0];
      if (err) return sendResponse({ ok: false, state: 'interrupted', error: err.message });
      if (!item) return sendResponse({ ok: false, state: 'interrupted', error: 'Download não encontrado' });
      sendResponse({ ok: true, state: item.state || 'in_progress', error: item.error || '', filename: item.filename || '' });
    });
    return true;
  }
});


// Side Panel nativo: o Chrome redimensiona a página em vez de sobrepor o Flow.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
