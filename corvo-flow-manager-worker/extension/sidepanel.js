let flowTabId = null;
let filter = 'todos';
let lastState = null;
let localText = '';
let localName = '';
let localLoadedSignature = '';
let protocolReadyTabId = null;
let preparedTabId = null;
let reloadAttemptedTabId = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function label(status) {
  return ({
    pending: 'PENDING', pendente: 'PENDING', assigned: 'ASSIGNED',
    sending: 'SENDING', processando: 'SENDING', sent: 'SENT', ok: 'SENT',
    generating: 'GENERATING', result_ready: 'RESULT READY', downloading: 'DOWNLOADING', done: 'DONE',
    retry: 'RETRY', failed: 'FAILED', erro: 'FAILED', limit_reached: 'LIMIT REACHED', limite: 'LIMIT REACHED'
  })[status] || String(status || '').toUpperCase();
}

function countPromptBlocks(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return 0;
  const structured = normalized.match(/\[ID:[^\]]+\]/gi);
  if (/\[FLOW_BATCH\]/i.test(normalized) && structured?.length) return structured.length;
  return normalized
    .split(/\n\s*\n+/)
    .map(block => block.trim().replace(/^x{5,}\s*-\s*/i, '').trim())
    .filter(block => block.length > 10)
    .length;
}

function textSignature(text, name = '') {
  const value = `${name}\n${String(text || '')}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${String(name || 'prompts.txt')}:${String(text || '').length}:${(hash >>> 0).toString(16)}`;
}

function isFlowUrl(url) {
  return /https:\/\/(labs\.google|flow\.google\.com)\//i.test(String(url || ''));
}

function setLocalStatus(text, kind = '') {
  const status = $('#status');
  status.textContent = text;
  status.classList.remove('warn', 'ok', 'err');
  if (kind) status.classList.add(kind);
}

async function prepareFlowTab(tabId) {
  if (!tabId) return { ok: false };
  if (preparedTabId === tabId) return { ok: true, debuggerAttached: true, hardStopped: false };
  const response = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_PREPARE_FLOW_TAB', tabId });
  if (!response?.ok) throw new Error(response?.error || 'Falha ao preparar debugger/CDP');
  if (response.hardStopped) {
    preparedTabId = null;
    return response;
  }
  preparedTabId = tabId;
  return response;
}

async function findFlow() {
  // Mantém a MESMA aba alvo depois de escolhida. O refresh de 1,5 s não pode
  // trocar de Flow no meio do lote caso existam várias abas/janelas abertas.
  if (flowTabId) {
    try {
      const current = await chrome.tabs.get(flowTabId);
      if (current?.id && isFlowUrl(current.url)) {
        const prepared = await prepareFlowTab(flowTabId);
        if (prepared?.hardStopped) {
          $('#conn').textContent = 'Flow conectado · HARD STOP';
          $('#conn').style.color = '#f2c14e';
        } else {
          $('#conn').textContent = 'Flow conectado · CDP ativo';
          $('#conn').style.color = '#35c66b';
        }
        return flowTabId;
      }
    } catch (_) {}
    flowTabId = null;
    protocolReadyTabId = null;
    preparedTabId = null;
  }

  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const allTabs = currentWindowTabs.some(item => isFlowUrl(item.url)) ? currentWindowTabs : await chrome.tabs.query({});
  const flowTabs = allTabs.filter(item => isFlowUrl(item.url));
  const tab = flowTabs.find(item => item.active) || flowTabs.sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  flowTabId = tab?.id || null;
  if (!flowTabId) {
    $('#conn').textContent = 'Abra o Google Flow';
    $('#conn').style.color = '#f2c14e';
    return null;
  }

  try {
    const prepared = await prepareFlowTab(flowTabId);
    if (prepared?.hardStopped) {
      $('#conn').textContent = 'Flow conectado · HARD STOP';
      $('#conn').style.color = '#f2c14e';
    } else {
      $('#conn').textContent = 'Flow conectado · CDP ativo';
      $('#conn').style.color = '#35c66b';
    }
  } catch (error) {
    $('#conn').textContent = 'Flow conectado · CDP falhou';
    $('#conn').style.color = '#ff6b6b';
    throw error;
  }
  return flowTabId;
}

async function rawContentMessage(type, extra = {}) {
  return chrome.tabs.sendMessage(flowTabId, { type, ...extra });
}

async function ensureProtocol() {
  if (!flowTabId && !(await findFlow())) throw new Error('Nenhuma aba do Flow aberta');
  if (protocolReadyTabId === flowTabId) return true;

  try {
    const hello = await rawContentMessage('FLOW_BATCH_REMOTE_HELLO');
    if (hello?.ok && hello.protocol === '4.0.2') {
      protocolReadyTabId = flowTabId;
      return true;
    }
  } catch (_) {}

  // Quando a extensão é atualizada com o Flow já aberto, o Chrome mantém o
  // content script antigo naquela página. Faz um reload ÚNICO para injetar a
  // versão atual e evitar painel V3 falando com worker V2/V3.0 antigo.
  if (reloadAttemptedTabId !== flowTabId) {
    reloadAttemptedTabId = flowTabId;
    setLocalStatus('Atualizando a aba do Flow para sincronizar o Worker v4.0.2…', 'warn');
    await chrome.tabs.reload(flowTabId);
    for (let i = 0; i < 40; i += 1) {
      await sleep(300);
      try {
        const hello = await rawContentMessage('FLOW_BATCH_REMOTE_HELLO');
        if (hello?.ok && hello.protocol === '4.0.2') {
          protocolReadyTabId = flowTabId;
          preparedTabId = null;
          await prepareFlowTab(flowTabId);
          return true;
        }
      } catch (_) {}
    }
  }

  throw new Error('Worker da aba Flow não está na versão 4.0.2. Recarregue a aba do Flow uma vez.');
}

async function send(type, extra = {}) {
  if (!flowTabId && !(await findFlow())) throw new Error('Nenhuma aba do Flow aberta');
  await ensureProtocol();
  const response = await rawContentMessage(type, extra);
  if (!response?.ok) throw new Error(response?.error || 'Comando não respondeu corretamente');
  return response;
}

function render(state) {
  if (!state?.ok) return;
  lastState = state;
  const managerInfo = $('#managerInfo');
  if (managerInfo) managerInfo.textContent = state.managerProfileId ? `Manager: ${state.managerProfileId}${state.managerConnected ? ' · conectado' : ' · aguardando'}` : 'Modo local · sem perfil do Manager';

  if (state.total > 0) {
    $('#status').textContent = state.statusText || `Item ${state.index + 1}/${state.total}`;
    $('#status').classList.remove('warn', 'ok', 'err');
    if (state.mappingConflicts > 0) $('#status').classList.add('err');
    else if (['STOPPED','PENDING'].includes(state.batchStatus)) $('#status').classList.add('warn');
    else $('#status').classList.add('ok');
  } else if (localText) {
    const blocks = countPromptBlocks(localText);
    setLocalStatus(`${blocks} prompts lidos localmente de ${localName}. Clique em Iniciar para enviar ao Flow.`, 'warn');
  } else {
    $('#status').textContent = state.statusText || 'Nenhum arquivo carregado.';
    $('#status').classList.remove('warn', 'ok', 'err');
  }

  $('#log').textContent = state.logText || '';
  $('#log').scrollTop = $('#log').scrollHeight;

  const queue = $('#queue');
  queue.innerHTML = '';
  for (const prompt of state.prompts || []) {
    if (filter !== 'todos' && prompt.status !== filter && !(filter === 'failed' && ['retry','limit_reached'].includes(prompt.status))) continue;
    const row = document.createElement('div');
    row.className = 'item ' + prompt.status;
    const fileLabel = prompt.file || prompt.arquivoFinal || '';
    const mappingLabel = prompt.mappingMethod
      ? `mapa: ${prompt.mappingMethod} · ${prompt.mappingConfidence ?? 0}%${prompt.generationSequence ? ` · geração #${prompt.generationSequence}` : ''}`
      : '';
    const retryAction = ['RETRY_SAME_PROMPT','RETRY_DOWNLOAD','RESYNC_RESULT'].includes(prompt.nextAction) && ['failed','retry'].includes(prompt.status);
    const retryText = prompt.nextAction === 'RETRY_DOWNLOAD' ? 'Repetir download' : (prompt.nextAction === 'RESYNC_RESULT' ? 'Ressincronizar' : 'Tentar novamente');
    const actionLabel = prompt.nextAction ? `<div class="guard">próximo: ${esc(prompt.nextAction)}</div>` : '';
    row.innerHTML = `<div class="top"><span class="idx">${esc(prompt.slot || prompt.id || String(prompt.index + 1).padStart(3, '0'))}</span><span class="txt" title="${esc(prompt.prompt)}">${esc(prompt.prompt)}</span><span class="tag">${label(prompt.status)}</span></div>${fileLabel ? `<div class="meta">${esc(fileLabel)}</div>` : ''}${mappingLabel ? `<div class="mapmeta">${esc(mappingLabel)}</div>` : ''}${prompt.mappingGuard ? `<div class="guard">⚠ ${esc(prompt.mappingGuard)}</div>` : ''}${prompt.error ? `<div class="err">${esc(prompt.errorCode ? prompt.errorCode + ': ' : '')}${esc(prompt.error)}</div>${actionLabel}` : ''}${retryAction ? `<button class="retry" data-i="${prompt.index}">${retryText}</button>` : ''}`;
    queue.appendChild(row);
  }

  $$('.retry').forEach(button => {
    button.onclick = async () => {
      try {
        render(await send('FLOW_BATCH_REMOTE_RETRY', { index: Number(button.dataset.i) }));
      } catch (error) {
        setLocalStatus(`Erro ao tentar novamente: ${error.message}`, 'err');
      }
    };
  });
}

async function readSelectedFile() {
  const file = $('#file').files?.[0];
  if (!file) {
    setLocalStatus('Nenhum TXT selecionado. Clique em Escolher arquivo primeiro.', 'err');
    return false;
  }

  localText = await file.text();
  localName = file.name || 'prompts.txt';
  localLoadedSignature = textSignature(localText, localName);

  const blocks = countPromptBlocks(localText);
  if (!blocks) {
    setLocalStatus(`TXT lido, mas nenhum prompt válido foi encontrado em ${localName}.`, 'err');
    return false;
  }

  setLocalStatus(`${blocks} prompts lidos de ${localName}. Enviando para o Flow...`, 'warn');
  try {
    const state = await send('FLOW_BATCH_REMOTE_LOAD_TEXT', { text: localText, name: localName });
    render(state);
    $('#fileHint').textContent = `TXT carregado: ${localName} (${blocks} prompts).`;
    return true;
  } catch (error) {
    setLocalStatus(`${blocks} prompts lidos, mas ainda não consegui enviar ao Flow: ${error.message}`, 'warn');
    $('#fileHint').textContent = 'O TXT está lido no painel. Abra/atualize o Flow e clique em Iniciar.';
    return true;
  }
}

async function ensureTextLoadedInFlow() {
  const file = $('#file').files?.[0];
  if (file && !localText) {
    const ok = await readSelectedFile();
    if (!ok) return false;
  }

  if (!localText) {
    setLocalStatus('Nenhum TXT selecionado. Escolha o arquivo antes de iniciar.', 'err');
    return false;
  }

  // Não confia apenas em "total > 0": aquilo pode ser um checkpoint antigo.
  // O arquivo selecionado precisa ter a mesma assinatura no Worker remoto.
  if (lastState?.loadedSignature === localLoadedSignature && lastState?.total > 0) return true;

  try {
    const loadedState = await send('FLOW_BATCH_REMOTE_LOAD_TEXT', { text: localText, name: localName || 'prompts.txt' });
    render(loadedState);
    if (loadedState.loadedSignature !== localLoadedSignature) throw new Error('Worker recebeu um TXT diferente do selecionado');
    return true;
  } catch (error) {
    setLocalStatus(`Não consegui enviar o TXT para o Flow: ${error.message}`, 'err');
    return false;
  }
}

async function refresh() {
  try {
    await findFlow();
    if (flowTabId) render(await send('FLOW_BATCH_REMOTE_GET_STATE'));
  } catch (error) {
    $('#conn').textContent = 'Atualize o Flow';
    if (localText) {
      const blocks = countPromptBlocks(localText);
      setLocalStatus(`${blocks} prompts lidos localmente. Atualize/abra o Flow e clique em Iniciar.`, 'warn');
    }
  }
}

$('#file').addEventListener('change', readSelectedFile);
$('#loadFile').onclick = readSelectedFile;

$$('[data-mode]').forEach(button => {
  button.onclick = async () => {
    $$('[data-mode]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    try {
      render(await send('FLOW_BATCH_REMOTE_SET_MODE', {
        mode: button.dataset.mode,
        fixedRef: $('#fixedRef').value,
        scenePrefix: $('#scenePrefix').value
      }));
    } catch (error) {
      setLocalStatus(`Modo selecionado no painel. Abra/atualize o Flow para sincronizar: ${error.message}`, 'warn');
    }
  };
});

$$('[data-delay]').forEach(button => {
  button.onclick = async () => {
    $$('[data-delay]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    await saveDelay();
  };
});

async function saveDelay() {
  const mode = $('[data-delay].active')?.dataset.delay || 'random';
  try {
    render(await send('FLOW_BATCH_REMOTE_SET_DELAY', {
      delayMode: mode,
      fixedSeconds: Number($('#fixed').value),
      minSeconds: Number($('#min').value),
      maxSeconds: Number($('#max').value)
    }));
  } catch (error) {
    setLocalStatus(`Delay ajustado no painel. Abra/atualize o Flow para sincronizar: ${error.message}`, 'warn');
  }
}

['fixed', 'min', 'max'].forEach(id => {
  $('#' + id).onchange = saveDelay;
});

$('#start').onclick = async () => {
  try {
    if (!flowTabId && !(await findFlow())) throw new Error('Nenhuma aba do Flow aberta');
    const armed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB', tabId: flowTabId });
    if (!armed?.ok) throw new Error(armed?.error || 'Não foi possível liberar o HARD STOP');
    preparedTabId = flowTabId;
    $('#conn').textContent = 'Flow conectado · CDP ativo';
    $('#conn').style.color = '#35c66b';

    const loaded = await ensureTextLoadedInFlow();
    if (!loaded) return;
    // Envia o TXT junto com START como segunda trava de sincronização.
    render(await send('FLOW_BATCH_REMOTE_START', { text: localText, name: localName || 'prompts.txt' }));
  } catch (error) {
    setLocalStatus(`Erro ao iniciar: ${error.message}`, 'err');
  }
};

$('#pause').onclick = async () => {
  try { render(await send('FLOW_BATCH_REMOTE_PAUSE')); } catch (error) { setLocalStatus(`Erro ao pausar: ${error.message}`, 'err'); }
};
$('#stop').onclick = async () => {
  try {
    if (!flowTabId && !(await findFlow())) throw new Error('Nenhuma aba do Flow aberta');

    // KILL SWITCH direto no service worker ANTES de falar com o content script.
    // Assim o STOP não depende da fila/DOM estar responsiva para cortar TYPE/CLICK.
    const killed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_HARD_STOP_TAB', tabId: flowTabId });
    if (!killed?.ok) throw new Error(killed?.error || 'Falha no HARD STOP do CDP');
    preparedTabId = null;
    $('#conn').textContent = 'Flow conectado · HARD STOP';
    $('#conn').style.color = '#f2c14e';

    try {
      const state = await rawContentMessage('FLOW_BATCH_REMOTE_STOP');
      if (state?.ok) render(state);
    } catch (_) {
      // O corte do CDP já aconteceu; falha de UI remota não pode desfazer o STOP.
    }
    setLocalStatus('PARADO — HARD STOP ativo. Iniciar libera novamente o Worker.', 'warn');
  } catch (error) {
    setLocalStatus(`Erro ao parar: ${error.message}`, 'err');
  }
};
$('#calPrompt').onclick = async () => {
  try { await send('FLOW_BATCH_REMOTE_CAL_PROMPT'); if (flowTabId) chrome.tabs.update(flowTabId, { active: true }); } catch (error) { setLocalStatus(`Erro na calibração: ${error.message}`, 'err'); }
};
$('#calGenerate').onclick = async () => {
  try { await send('FLOW_BATCH_REMOTE_CAL_GENERATE'); if (flowTabId) chrome.tabs.update(flowTabId, { active: true }); } catch (error) { setLocalStatus(`Erro na calibração: ${error.message}`, 'err'); }
};
$('#exportFull').onclick = async () => {
  try { await send('FLOW_BATCH_REMOTE_EXPORT_FULL'); } catch (error) { setLocalStatus(`Erro ao exportar: ${error.message}`, 'err'); }
};
$('#exportErrors').onclick = async () => {
  try { await send('FLOW_BATCH_REMOTE_EXPORT_ERRORS'); } catch (error) { setLocalStatus(`Erro ao exportar erros: ${error.message}`, 'err'); }
};
$('#exportManifest').onclick = async () => {
  try { await send('FLOW_BATCH_REMOTE_EXPORT_MANIFEST'); } catch (error) { setLocalStatus(`Erro ao exportar manifesto: ${error.message}`, 'err'); }
};

$$('[data-filter]').forEach(button => {
  button.onclick = () => {
    $$('[data-filter]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    filter = button.dataset.filter;
    if (lastState) render(lastState);
  };
});

refresh();
setInterval(refresh, 1500);
