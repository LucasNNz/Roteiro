(() => {
  if (window.__FLOW_BATCH_LOADED__) return;
  window.__FLOW_BATCH_LOADED__ = true;

  const state = {
    prompts: [],
    originalText: '',
    running: false,
    paused: false,
    index: 0,
    mode: 'sem_referencia',
    delayMode: 'random',
    fixedDelay: 3000,
    minDelay: 2000,
    maxDelay: 4000,
    timeout: 12000,
    results: [],
    calibratedPromptSelector: null,
    calibratedGenerateSelector: null,
    panel: null,
    operationLock: false,
    processingIndex: null,
    batch: { version: '1.0', projectId: '', batchId: '', sourceName: '', structured: false, testMode: false, appDelivery: false, managerControlled: false, managerAssignmentId: '', managerProfileId: '' },
    workerId: 'FLOW_WORKER_LOCAL',
    managerProfileId: '',
    managerConnected: false,
    managerLastTickAt: '',
    managerHold: false,
    workspaceStatus: 'UNKNOWN',
    workspaceReady: false,
    workspaceLastError: '',
    workspaceLastActionAt: '',
    bindingTimeout: 1800,
    loadedSignature: '',
    runEpoch: 0,
    activeRunId: null,
    stopRequested: false,
    sendSequence: 0,
    batchCompletedAt: '',
    mappingConflicts: 0,
    captureArmed: false,
    failureSequence: 0,
    clientErrorRecoveryActive: false,
    clientErrorDetectedAt: '',
    clientErrorReloadRequestedAt: '',
    clientErrorLastMessage: '',
    managerStartLastAttemptAt: '',
    managerStartLastError: '',
    managerStartFailureCount: 0,
    managerForceStartCount: 0
  };

  const liveTracking = new Map();
  const rootAssignments = new WeakMap();
  const rootMeta = new WeakMap();
  const assetAssignments = new Map();
  let rootSequence = 0;
  let trackingObserver = null;
  let trackingScanTimer = null;
  let restorePromise = Promise.resolve(false);

  const MARKER = 'xxxxxxxxxxx - ';
  const ERROR_WORDS = ['error', 'erro', 'failed', 'falhou', 'try again', 'tente novamente', 'couldn\'t', 'não foi possível'];
  let managerLimitPhrases = [];
  const LIMIT_PATTERNS = [
    /limite (?:di[aá]rio )?(?:atingido|alcan[cç]ado|esgotado)/i,
    /cr[eé]dito(?:s)? (?:di[aá]rio(?:s)? )?(?:atingido|esgotado|acabou|acabaram)/i,
    /quota(?: exceeded| reached)?/i,
    /rate limit/i,
    /too many requests/i,
    /try again later/i,
    /tente novamente mais tarde/i
  ];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextDelay = () => {
    if (state.delayMode === 'fixed') return state.fixedDelay;
    return Math.floor(state.minDelay + Math.random() * (state.maxDelay - state.minDelay + 1));
  };
  const visible = el => !!el && el.isConnected && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const TERMINAL_STATUSES = new Set(['done','failed','retry','limit_reached']);
  const ACTIVE_RESULT_STATUSES = new Set(['sent','generating','result_ready','downloading']);
  const FAILURE_POLICIES = {
    PROMPT_REJECTED: { errorClass: 'PROMPT', nextAction: 'FALLBACK_PROMPT', retryAllowed: false },
    CONTENT_BLOCK: { errorClass: 'PROMPT', nextAction: 'FALLBACK_PROMPT', retryAllowed: false },
    GENERATION_FAILED: { errorClass: 'GENERATION', nextAction: 'RETRY_SAME_PROMPT', retryAllowed: true },
    NETWORK_ERROR: { errorClass: 'TECHNICAL', nextAction: 'RETRY_SAME_PROMPT', retryAllowed: true },
    UI_ERROR: { errorClass: 'TECHNICAL', nextAction: 'RETRY_SAME_PROMPT', retryAllowed: true },
    DOWNLOAD_FAILED: { errorClass: 'DOWNLOAD', nextAction: 'RETRY_DOWNLOAD', retryAllowed: true },
    DOWNLOAD_INTERRUPTED: { errorClass: 'DOWNLOAD', nextAction: 'RETRY_DOWNLOAD', retryAllowed: true },
    DOWNLOAD_STATUS_UNKNOWN: { errorClass: 'DOWNLOAD', nextAction: 'RETRY_DOWNLOAD', retryAllowed: true },
    RESULT_NOT_FOUND: { errorClass: 'RESULT', nextAction: 'RESYNC_RESULT', retryAllowed: true },
    FLOW_LIMIT_REACHED: { errorClass: 'WORKER', nextAction: 'OTHER_WORKER', retryAllowed: false },
    SESSION_EXPIRED: { errorClass: 'WORKER', nextAction: 'LOGIN_REQUIRED', retryAllowed: false },
    MAPPING_UNCERTAIN: { errorClass: 'MAPPING', nextAction: 'MANUAL_REVIEW', retryAllowed: false },
    MAPPING_CONFLICT: { errorClass: 'MAPPING', nextAction: 'MANUAL_REVIEW', retryAllowed: false },
    FILE_NAME_MISMATCH: { errorClass: 'FILE', nextAction: 'MANUAL_REVIEW', retryAllowed: false },
    INPUT_INVALID: { errorClass: 'INPUT', nextAction: 'FIX_INPUT', retryAllowed: false },
    UNKNOWN_ERROR: { errorClass: 'UNKNOWN', nextAction: 'MANUAL_REVIEW', retryAllowed: false }
  };

  function failurePolicy(errorCode) {
    return FAILURE_POLICIES[String(errorCode || '').toUpperCase()] || FAILURE_POLICIES.UNKNOWN_ERROR;
  }

  function syncFailurePolicy(item) {
    if (!item) return failurePolicy('UNKNOWN_ERROR');
    if (!item.errorCode) {
      item.errorClass = '';
      item.nextAction = '';
      item.retryAllowed = false;
      return { errorClass: '', nextAction: '', retryAllowed: false };
    }
    const policy = failurePolicy(item.errorCode);
    item.errorClass = policy.errorClass;
    item.nextAction = policy.nextAction;
    item.retryAllowed = !!policy.retryAllowed;
    if (!item.failureAt) item.failureAt = new Date().toISOString();
    if (!item.failureSequence) item.failureSequence = ++state.failureSequence;
    return policy;
  }

  function setJobFailure(item, errorCode, message, explicitStatus = '') {
    if (!item) return;
    const policy = failurePolicy(errorCode);
    item.errorCode = String(errorCode || 'UNKNOWN_ERROR').toUpperCase();
    item.error = String(message || '').trim();
    item.errorClass = policy.errorClass;
    item.nextAction = policy.nextAction;
    item.retryAllowed = !!policy.retryAllowed;
    item.failureAt = new Date().toISOString();
    item.failureSequence = ++state.failureSequence;
    if (explicitStatus) item.status = explicitStatus;
    else if (item.errorCode === 'FLOW_LIMIT_REACHED') item.status = 'limit_reached';
    else if (policy.nextAction === 'RETRY_SAME_PROMPT' || policy.nextAction === 'RETRY_DOWNLOAD' || policy.nextAction === 'RESYNC_RESULT') item.status = 'retry';
    else item.status = 'failed';
    emitManagerLifecycleEvent(item, 'FAILED');
  }

  function clearJobFailure(item) {
    if (!item) return;
    for (const key of ['error','errorCode','errorClass','nextAction','failureAt','failureSequence']) delete item[key];
    item.retryAllowed = false;
  }

  const managerTelemetryDedupe = new Map();
  function emitManagerLifecycleEvent(item, lifecycle, extra = {}) {
    if (!item?.jobId || !state.batch?.managerControlled || !state.batch?.managerAssignmentId) return;
    const name = String(lifecycle || '').toUpperCase();
    if (!name) return;
    const data = {
      workerStatus: item.status || '',
      sentAt: item.sentAt || '', sendSequence: item.sendSequence || 0,
      generationDetectedAt: item.generationDetectedAt || '', generationSequence: item.generationSequence || 0,
      mappingMethod: item.mappingMethod || '', mappingConfidence: item.mappingConfidence ?? null,
      resultDetectedAt: item.resultDetectedAt || '', downloadRequestIssuedAt: item.downloadRequestIssuedAt || '',
      doneAt: item.doneAt || '', file: item.file || item.downloadedFile || '',
      failureAt: item.failureAt || '', errorCode: item.errorCode || '', errorClass: item.errorClass || '',
      nextAction: item.nextAction || '', error: item.error || '', ...extra
    };
    const signature = [state.batch.managerAssignmentId,item.jobId,name,data.sendSequence,data.generationSequence,data.sentAt,data.generationDetectedAt,data.resultDetectedAt,data.downloadRequestIssuedAt,data.doneAt,data.file,data.errorCode,data.failureAt].join('|');
    const dedupeKey = `${state.batch.managerAssignmentId}|${item.jobId}|${name}`;
    if (managerTelemetryDedupe.get(dedupeKey) === signature) return;
    managerTelemetryDedupe.set(dedupeKey, signature);
    chrome.runtime.sendMessage({ type:'FLOW_MANAGER_LIFECYCLE_EVENT', event:{ workerId:state.workerId, assignmentId:state.batch.managerAssignmentId, jobId:item.jobId, lifecycle:name, at:extra.at || new Date().toISOString(), data } }).catch(() => {});
  }

  function batchResult() {
    const done = state.prompts.filter(x => x.status === 'done').length;
    const errors = state.prompts.filter(x => ['failed','retry','limit_reached'].includes(x.status)).length;
    if (!state.prompts.length) return 'EMPTY';
    if (!errors && done === state.prompts.length) return 'SUCCESS';
    if (done > 0 && errors > 0) return 'PARTIAL';
    if (errors === state.prompts.length) return 'FAILED';
    return 'IN_PROGRESS';
  }

  function safeFileName(value, fallback = 'corvo-flow-asset.png') {
    const raw = String(value || '').trim().replace(/^[/\\]+/, '');
    const base = raw.split(/[/\\]/).pop().replace(/[<>:"|?*\x00-\x1F]/g, '_').trim();
    return base || fallback;
  }

  function downloadedBaseName(value) {
    return String(value || '').split(/[/\\]/).pop() || '';
  }

  // O Flow costuma entregar JPEG mesmo quando ARQUIVO_FINAL foi solicitado como PNG.
  // Isso nao e erro de mapeamento: aceitamos JPG/JPEG quando somente a extensao mudou
  // e o nome-base continua exatamente o mesmo. O manifesto usa o nome realmente salvo.
  function compatibleDownloadedFileName(expected, actual) {
    const exp = downloadedBaseName(expected).trim();
    const act = downloadedBaseName(actual).trim();
    if (!exp || !act) return false;
    if (exp.toLowerCase() === act.toLowerCase()) return true;

    const split = name => {
      const m = String(name).match(/^(.*?)(\.[^.]+)?$/);
      return { stem: String(m?.[1] || ''), ext: String(m?.[2] || '').toLowerCase() };
    };
    const a = split(exp);
    const b = split(act);
    if (a.stem.toLowerCase() !== b.stem.toLowerCase()) return false;

    // Suporte explicito ao formato nativo JPEG/JPG devolvido pelo Flow.
    // PNG -> JPG/JPEG e JPG <-> JPEG sao equivalentes para o Worker.
    const jpeg = new Set(['.jpg', '.jpeg']);
    if (jpeg.has(b.ext) && (a.ext === '.png' || jpeg.has(a.ext))) return true;
    return false;
  }

  function batchLifecycle() {
    if (!state.prompts.length) return 'EMPTY';
    const terminal = state.prompts.filter(item => TERMINAL_STATUSES.has(item.status)).length;
    const active = state.prompts.filter(item => ACTIVE_RESULT_STATUSES.has(item.status)).length;
    const pending = state.prompts.filter(item => ['pending','assigned','sending'].includes(item.status)).length;
    if (terminal === state.prompts.length) return 'COMPLETE';
    if (state.stopRequested) return 'STOPPED';
    if (state.running) return 'SENDING';
    if (active > 0 && pending === 0) return 'WAITING_RESULTS';
    if (active > 0) return 'ACTIVE';
    return 'PENDING';
  }

  function maybeMarkBatchComplete() {
    if (!state.prompts.length) return false;
    if (!state.prompts.every(item => TERMINAL_STATUSES.has(item.status))) return false;
    state.captureArmed = false;
    if (!state.batchCompletedAt) {
      state.batchCompletedAt = new Date().toISOString();
      log(`BATCH_COMPLETE — ${state.batch?.batchId || 'FLOW'} — ${state.prompts.length} JOBs terminalizados.`);
    }
    return true;
  }

  function stableAssetKey(asset) {
    if (!asset) return '';
    let url = String(asset.url || '');
    // Fragmentos e parâmetros efêmeros não devem fazer o mesmo asset parecer outro.
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      try {
        const parsed = new URL(url, location.href);
        parsed.hash = '';
        ['cache','cacheBust','cb','t','timestamp'].forEach(key => parsed.searchParams.delete(key));
        url = parsed.toString();
      } catch (_) {}
    }
    return `${url}|${Number(asset.width || 0)}x${Number(asset.height || 0)}`;
  }

  function makeStopError() {
    const error = new Error('FLOW_BATCH_STOPPED');
    error.code = 'FLOW_BATCH_STOPPED';
    return error;
  }

  function isStopError(error) {
    return error?.code === 'FLOW_BATCH_STOPPED' || String(error?.message || '').includes('FLOW_BATCH_STOPPED');
  }

  function assertRunActive(runId) {
    if (!state.running || state.stopRequested || state.activeRunId !== runId) throw makeStopError();
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

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log('[Flow Batch]', message);
    const box = state.panel?.querySelector('#fbl-log');
    if (box) {
      box.textContent += `${line}\n`;
      box.scrollTop = box.scrollHeight;
    }
  }

  function setStatus(extra = '') {
    const box = state.panel?.querySelector('#fbl-status');
    if (!box) return;
    const done = state.prompts.filter(x => x.status === 'done').length;
    const active = state.prompts.filter(x => ['sent','generating','result_ready','downloading'].includes(x.status)).length;
    const err = state.prompts.filter(x => ['failed','retry','limit_reached'].includes(x.status)).length;
    const pending = state.prompts.filter(x => ['pending','assigned','sending'].includes(x.status)).length;
    box.textContent = `Batch: ${batchLifecycle()}\nItem: ${Math.min(state.index + 1, state.prompts.length)}/${state.prompts.length}\nDONE: ${done} | Ativos: ${active} | Pendentes: ${pending} | Erros: ${err}${state.mappingConflicts ? ` | Conflitos: ${state.mappingConflicts}` : ''}\n${extra}`;
  }


  function statusLabel(status) {
    return ({
      pending: 'PENDING', pendente: 'PENDING',
      assigned: 'ASSIGNED',
      sending: 'SENDING', processando: 'SENDING',
      sent: 'SENT', ok: 'SENT',
      generating: 'GENERATING',
      result_ready: 'RESULT READY',
      downloading: 'DOWNLOADING',
      done: 'DONE',
      retry: 'RETRY',
      failed: 'FAILED', erro: 'FAILED',
      limit_reached: 'LIMIT REACHED', limite: 'LIMIT REACHED'
    })[status] || String(status || '').toUpperCase();
  }

  function updateQueueUI() {
    const queue = state.panel?.querySelector('#fbl-queue');
    if (!queue) return;
    queue.innerHTML = '';
    state.prompts.forEach((item, idx) => {
      const policy = syncFailurePolicy(item);
      const canRetryHere = ['RETRY_SAME_PROMPT','RETRY_DOWNLOAD','RESYNC_RESULT'].includes(policy.nextAction) && ['failed','erro','retry'].includes(item.status);
      const retryLabel = policy.nextAction === 'RETRY_DOWNLOAD' ? 'Repetir download' : (policy.nextAction === 'RESYNC_RESULT' ? 'Ressincronizar' : 'Tentar novamente');
      const row = document.createElement('div');
      row.className = `fbl-queue-item status-${item.status || 'pending'}`;
      const title = item.prompt.replace(/\s+/g, ' ').trim();
      const jobLabel = item.slot || item.id;
      row.innerHTML = `
        <div class="fbl-queue-main">
          <span class="fbl-queue-index">${jobLabel}</span>
          <span class="fbl-queue-text" title="${title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}">${title}</span>
          <span class="fbl-queue-status">${statusLabel(item.status)}</span>
        </div>
        <div class="fbl-queue-detail">
          ${item.error ? `<span>${item.error}${item.nextAction ? ` · próximo: ${item.nextAction}` : ''}</span>` : '<span></span>'}
          ${canRetryHere ? `<button class="fbl-retry" data-index="${idx}">${retryLabel}</button>` : ''}
        </div>`;
      queue.appendChild(row);
    });
    queue.querySelectorAll('.fbl-retry').forEach(button => {
      button.addEventListener('click', () => retryItem(Number(button.dataset.index)));
    });
  }

  function hasAttachedChipNearPrompt(promptEl) {
    if (!promptEl) return false;

    const promptRect = promptEl.getBoundingClientRect();
    const composerRoot = promptEl.closest('form') || promptEl.parentElement?.parentElement || promptEl.parentElement;
    if (!composerRoot) return false;

    // Limita a detecção à região imediata do compositor. Antes, a busca no parentElement
    // podia alcançar cartões/imagens do projeto ao fundo e gerar falso positivo.
    const candidates = [...composerRoot.querySelectorAll('span, div, button, img')]
      .filter(node => visible(node) && !node.closest('#fbl-panel'));

    return candidates.some(node => {
      if (node === promptEl || promptEl.contains(node)) return false;
      const rect = node.getBoundingClientRect();

      // O chip fica dentro ou logo acima do campo inferior, com sobreposição horizontal.
      const horizontalOverlap = rect.right >= promptRect.left && rect.left <= promptRect.right;
      const verticallyNear = rect.bottom >= promptRect.top - 170 && rect.top <= promptRect.bottom + 30;
      if (!horizontalOverlap || !verticallyNear) return false;

      const text = norm(`${node.textContent || ''} ${node.getAttribute?.('alt') || ''} ${node.getAttribute?.('aria-label') || ''}`);
      if (!text) return false;

      // Exige aparência de arquivo/chip, evitando palavras soltas existentes no restante da página.
      const looksLikeReferenceChip = /(?:scene\d+|vasty)[^\s]{0,80}(?:\.jpeg|\.jpg|\.png)|(?:\.jpeg|\.jpg|\.png)/i.test(text);
      if (!looksLikeReferenceChip) return false;

      // Evita considerar contêineres gigantes que englobam a página inteira.
      return rect.width < Math.max(520, promptRect.width * 0.9) && rect.height < 140;
    });
  }

  function normalizedPromptContent(promptEl) {
    if (!promptEl) return '';

    let raw = promptTextValue(promptEl).replace(/[\u200B-\u200D\uFEFF]/g, '');
    let text = norm(raw);

    // O Flow renderiza o placeholder como conteúdo visível dentro do próprio
    // contenteditable. Isso não representa texto digitado pelo usuário.
    const placeholderCandidates = [
      promptEl.getAttribute?.('placeholder'),
      promptEl.getAttribute?.('aria-placeholder'),
      promptEl.getAttribute?.('data-placeholder'),
      'What do you want to create?',
      'O que você quer criar?',
      '¿Qué quieres crear?'
    ].filter(Boolean).map(norm);

    if (placeholderCandidates.includes(text)) return '';

    // Alguns editores colocam o placeholder em um filho separado. Remove-o
    // somente quando ele aparece isolado no início/fim, sem apagar texto real.
    for (const placeholder of placeholderCandidates) {
      if (!placeholder) continue;
      if (text === placeholder) return '';
      if (text.startsWith(placeholder + ' ')) text = text.slice(placeholder.length).trim();
      if (text.endsWith(' ' + placeholder)) text = text.slice(0, -placeholder.length).trim();
    }

    return text;
  }

  function composerIsEmpty() {
    const promptEl = findPromptInput();
    if (!promptEl) return false;

    const text = normalizedPromptContent(promptEl);
    const hasAnyChip = hasAttachedChipNearPrompt(promptEl);
    if (text.length > 0 || hasAnyChip) {
      log(`Diagnóstico do compositor: texto=${text ? JSON.stringify(text.slice(0, 80)) : 'vazio'}; chip=${hasAnyChip ? 'sim' : 'não'}; elemento=${promptEl.tagName.toLowerCase()}${promptEl.getAttribute('role') ? `[role=${promptEl.getAttribute('role')}]` : ''}${promptEl.isContentEditable ? '[contenteditable]' : ''}`);
    }
    return text.length === 0 && !hasAnyChip;
  }

  async function ensureSafeToStart(label = 'operação') {
    if (state.running || state.operationLock || state.processingIndex !== null) {
      throw new Error(`Não é seguro iniciar ${label}: a fila principal ou outro prompt ainda está em execução.`);
    }
  }

  function composerRootFor(promptEl) {
    return promptEl?.closest('form') || promptEl?.parentElement?.parentElement || promptEl?.parentElement || null;
  }

  function findComposerClearButtons(promptEl) {
    const root = composerRootFor(promptEl);
    if (!root) return [];
    const promptRect = promptEl.getBoundingClientRect();
    return [...root.querySelectorAll('button, [role="button"]')]
      .filter(el => visible(el) && !el.closest('#fbl-panel'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const nearComposer = rect.bottom >= promptRect.top - 180 && rect.top <= promptRect.bottom + 40;
        if (!nearComposer) return false;
        const label = norm(`${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.textContent || ''}`);
        return /remove|remover|delete|excluir|close|fechar|clear|limpar|detach|desanexar/.test(label) || label === '×' || label === 'x';
      });
  }

  async function clearComposer({ silent = false } = {}) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const promptEl = await waitFor(findPromptInput, 4000, 100);
      if (!promptEl) throw new Error('Campo principal do prompt não encontrado para limpeza');

      try {
        await forceFocusOnPrompt(promptEl);
      } catch (_) {
        try { promptEl.click(); promptEl.focus({ preventScroll: true }); } catch (_) {}
      }

      const response = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_CLEAR_FIELD' });
      if (!response?.ok) throw new Error(response?.error || 'Falha ao limpar o texto do compositor');
      await sleep(260);

      const clearButtons = findComposerClearButtons(promptEl);
      for (const button of clearButtons.slice(0, 6)) {
        try {
          await realClickElement(button, 'botão de remover anexo');
          await sleep(180);
        } catch (_) {
          try { button.click(); } catch (_) {}
        }
      }

      // Uma segunda exclusão remove chips inline que ficaram ao lado do cursor.
      try {
        await forceFocusOnPrompt(findPromptInput() || promptEl);
        await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_CLEAR_FIELD' });
      } catch (_) {}
      await sleep(300);

      if (composerIsEmpty()) {
        if (!silent) log(`Compositor limpo${attempt > 1 ? ` após ${attempt} tentativas` : ''}.`);
        return true;
      }
    }

    const promptEl = findPromptInput();
    const text = normalizedPromptContent(promptEl);
    const hasChip = hasAttachedChipNearPrompt(promptEl);
    throw new Error(`Não foi possível limpar completamente o compositor (texto=${text ? 'sim' : 'não'}, anexo=${hasChip ? 'sim' : 'não'}).`);
  }

  function resetJobTrackingForRetry(item) {
    liveTracking.delete(item.jobId);
    clearJobFailure(item);
    if (item.assetKey && assetAssignments.get(item.assetKey) === item.jobId) assetAssignments.delete(item.assetKey);
    for (const key of [
      'generationDetectedAt','generationSequence','mappingMethod','mappingConfidence','mappingScore','mappingRootFirstSeenAt',
      'mappingGuard','mappingConflictWith','assetKey','assetUrl','assetWidth','assetHeight','resultDetectedAt',
      'downloadId','downloadPath','downloadedFile','requestedFile','downloadToken','downloadRequestIssuedAt','downloadAttemptCount','downloadRetryNonce','doneAt','file'
    ]) delete item[key];
  }

  async function retryDownloadOnly(index) {
    const item = state.prompts[index];
    if (!item || !item.assetUrl) {
      if (item) setJobFailure(item, 'RESULT_NOT_FOUND', 'Asset anterior não está mais disponível para repetir somente o download.');
      updateQueueUI(); setStatus();
      await persistManagerState('retry_download_asset_missing');
      return false;
    }
    try {
      await ensureSafeToStart('o retry de download');
      const armed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB' });
      if (!armed?.ok) throw new Error(armed?.error || 'Não foi possível armar o Flow para retry de download');
    } catch (error) {
      log(`RETRY DOWNLOAD BLOQUEADO — ${item.id}: ${error.message}`);
      return false;
    }

    // Mantém geração/mapeamento e repete exclusivamente a recuperação do asset.
    for (const key of ['downloadId','downloadPath','downloadedFile','requestedFile','downloadToken','downloadRequestIssuedAt','downloadAttemptCount','doneAt','file']) delete item[key];
    item.downloadRetryNonce = Number(item.downloadRetryNonce || 0) + 1;
    clearJobFailure(item);
    item.status = 'result_ready';
    item.resultDetectedAt = item.resultDetectedAt || new Date().toISOString();
    emitManagerLifecycleEvent(item, 'RESULT_READY');
    state.captureArmed = true;
    const entry = { item, root: null, downloadStarted: false, restored: false };
    const asset = { url: item.assetUrl, width: item.assetWidth || 0, height: item.assetHeight || 0 };
    log(`RETRY_DOWNLOAD — ${item.id}: reutilizando o asset já gerado; nenhum novo prompt será enviado.`);
    updateQueueUI(); setStatus(`Repetindo download de ${item.id}`);
    await downloadTrackedAsset(entry, asset);
    await persistManagerState('retry_download_only');
    return item.status === 'done';
  }

  async function resyncResultOnly(index) {
    const item = state.prompts[index];
    if (!item) return false;
    try {
      await ensureSafeToStart('a ressincronização do resultado');
      const armed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB' });
      if (!armed?.ok) throw new Error(armed?.error || 'Não foi possível armar o Flow');
    } catch (error) {
      log(`RESSINCRONIZAÇÃO BLOQUEADA — ${item.id}: ${error.message}`);
      return false;
    }
    clearJobFailure(item);
    item.status = 'sent';
    state.captureArmed = true;
    registerSentJob(item, null, true, []);
    log(`RESYNC_RESULT — ${item.id}: procurando resultado existente sem reenviar o prompt.`);
    updateQueueUI(); setStatus(`Ressincronizando ${item.id}`);
    await persistManagerState('resync_result_only');
    return true;
  }

  async function retryItem(index) {
    const item = state.prompts[index];
    if (!item || !['failed','erro','retry'].includes(item.status)) return;
    const policy = syncFailurePolicy(item);
    if (policy.nextAction === 'RETRY_DOWNLOAD') return retryDownloadOnly(index);
    if (policy.nextAction === 'RESYNC_RESULT') return resyncResultOnly(index);
    if (policy.nextAction !== 'RETRY_SAME_PROMPT') {
      log(`RETRY BLOQUEADO — ${item.id}: ${item.errorCode || 'ERRO'} exige ${policy.nextAction}, não novo envio do mesmo prompt.`);
      return false;
    }
    try {
      await ensureSafeToStart('a nova tentativa');
    } catch (error) {
      log(`NOVA TENTATIVA BLOQUEADA — ${item.id}: ${error.message}`);
      return;
    }

    try {
      const armed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB' });
      if (!armed?.ok) throw new Error(armed?.error || 'Não foi possível armar o Flow para retry');
    } catch (error) {
      log(`NOVA TENTATIVA BLOQUEADA — ${item.id}: ${error.message}`);
      return;
    }

    const runId = ++state.runEpoch;
    state.activeRunId = runId;
    state.stopRequested = false;
    state.batchCompletedAt = '';
    state.captureArmed = true;
    state.running = true;
    state.operationLock = true;
    state.processingIndex = index;
    resetJobTrackingForRetry(item);
    item.status = 'sending';
    clearJobFailure(item);
    item.attempts = (item.attempts || 0) + 1;
    updateQueueUI();
    setStatus(`Tentando novamente ${item.id}`);

    try {
      await clearComposer();
      assertRunActive(runId);
      const tracking = await processOne(item, { skipInitialClear: true, runId });
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      item.sendSequence = ++state.sendSequence;
      clearJobFailure(item);
      emitManagerLifecycleEvent(item, 'SENT');
      registerSentJob(item, tracking?.generationBaseline, false, tracking?.immediateRoots || []);
      log(`SENT NA NOVA TENTATIVA — ${item.id} — aguardando geração/asset`);
    } catch (error) {
      if (isStopError(error) || state.stopRequested || state.activeRunId !== runId) {
        item.status = 'pending';
        clearJobFailure(item);
        item.attempts = Math.max(0, (item.attempts || 1) - 1);
        log(`PARADO — retry de ${item.id} cancelado; item voltou para PENDING.`);
      } else {
        const classified = classifyOperationalError(error);
        setJobFailure(item, classified.errorCode, error.message, classified.status);
        log(`ERRO NA NOVA TENTATIVA — ${item.id}: ${error.message}`);
        try { await clearComposer({ silent: true }); } catch (clearError) { log(`Aviso: limpeza após erro falhou: ${clearError.message}`); }
      }
    } finally {
      if (state.activeRunId === runId) state.activeRunId = null;
      state.running = false;
      state.processingIndex = null;
      state.operationLock = false;
      state.results = state.prompts.filter(x => !['pending','pendente','assigned','sending','processando'].includes(x.status)).map(serializableJob);
      maybeMarkBatchComplete();
      updateQueueUI();
      setStatus();
      await persistManagerState('retry');
    }
  }

  function parseKeyValueSection(text) {
    const out = {};
    let currentKey = null;
    for (const rawLine of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      const line = rawLine.trimEnd();
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) {
        currentKey = match[1].toUpperCase();
        out[currentKey] = match[2].trim();
      } else if (currentKey && line.trim()) {
        out[currentKey] += `\n${line}`;
      }
    }
    return out;
  }

  function legacyPrompts(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    return normalized
      .split(/\n\s*\n+/)
      .map((block, idx) => {
        const clean = block.trim();
        const marked = /^x{5,}\s*-\s*/i.test(clean);
        const prompt = clean.replace(/^x{5,}\s*-\s*/i, '').trim();
        const titleMatch = prompt.match(/\b(?:AUXILIAR|PROMPT|CENA)\s+([0-9]+[A-Z]?)/i);
        const id = titleMatch?.[1] || String(idx + 1).padStart(3, '0');
        return {
          jobId: `LEGACY:${Date.now()}:${id}:${idx + 1}`,
          id, slot: id, arquivoFinal: '', originalBlock: clean, prompt, marked,
          reference: null, status: 'pending', error: '', errorCode: '', attempts: 0,
          tentativa: 1, createdAt: new Date().toISOString()
        };
      })
      .filter(x => x.prompt.length > 10);
  }

  function parsePrompts(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    const structured = /\[FLOW_BATCH\]/i.test(normalized) && /\[ID:[^\]]+\]/i.test(normalized);
    if (!structured) {
      state.batch = { version: 'legacy', projectId: '', batchId: `LEGACY:${Date.now()}`, sourceName: state.batch?.sourceName || '', structured: false, testMode: false, appDelivery: false, managerControlled: false, managerAssignmentId: '', managerProfileId: '' };
      return legacyPrompts(normalized);
    }

    const firstId = normalized.search(/\[ID:[^\]]+\]/i);
    const header = parseKeyValueSection(firstId >= 0 ? normalized.slice(0, firstId) : normalized);
    const projectId = header.PROJECT_ID || header.PROJETO || '';
    const batchId = header.BATCH_ID || `${projectId || 'FLOW'}:FLOW:${Date.now()}`;
    const version = header.VERSION || '1.0';
    const testMode = /^(1|true|yes|sim)$/i.test(String(header.TEST_MODE || ''));
    const appDelivery = String(header.DELIVERY_MODE || '').toUpperCase() === 'APP' || /^(1|true|yes|sim)$/i.test(String(header.APP_DELIVERY || ''));
    const managerControlled = /^(1|true|yes|sim)$/i.test(String(header.MANAGER_CONTROLLED || ''));
    const managerAssignmentId = header.MANAGER_ASSIGNMENT_ID || '';
    const managerProfileId = header.MANAGER_PROFILE_ID || state.managerProfileId || '';
    state.batch = { version, projectId, batchId, sourceName: state.batch?.sourceName || '', structured: true, testMode, appDelivery, managerControlled, managerAssignmentId, managerProfileId };
    if (managerProfileId) { state.managerProfileId = managerProfileId; state.workerId = `FLOW_WORKER_${managerProfileId}`; }

    const matches = [...normalized.matchAll(/\[ID:([^\]]+)\]/gi)];
    return matches.map((match, idx) => {
      const sectionStart = match.index + match[0].length;
      const sectionEnd = idx + 1 < matches.length ? matches[idx + 1].index : normalized.length;
      const fields = parseKeyValueSection(normalized.slice(sectionStart, sectionEnd));
      const id = match[1].trim();
      const slot = fields.SLOT || id;
      const prompt = fields.PROMPT || fields.PROMPT_GERACAO || '';
      const tentativa = Math.max(1, Number(fields.TENTATIVA || fields.TENTATIVA_ATUAL || 1) || 1);
      const managerStatus = String(fields.MANAGER_STATUS || '').toUpperCase();
      const workerStatus = String(fields.WORKER_STATUS || '').toLowerCase();
      const activeWorkerStatus = ACTIVE_RESULT_STATUSES.has(workerStatus) ? workerStatus : '';
      const managerActive = ['RUNNING','RESULT_READY','DOWNLOADING'].includes(managerStatus);
      const managerDefaultStatus = managerStatus === 'RESULT_READY' ? 'result_ready' : (managerStatus === 'DOWNLOADING' ? 'downloading' : (Number(fields.GENERATION_SEQUENCE || 0) > 0 ? 'generating' : 'sent'));
      const initialStatus = managerActive ? (activeWorkerStatus || managerDefaultStatus) : 'pending';
      return {
        jobId: fields.JOB_ID || fields.LOGICAL_JOB_ID || `${batchId}:JOB:${id}`,
        projectId: fields.PROJECT_ID || projectId,
        batchId: fields.BATCH_ID || batchId,
        id, slot,
        arquivoFinal: fields.ARQUIVO_FINAL || fields.PADRAO_ARQUIVO_FINAL || '',
        prompt: prompt.trim(), originalBlock: normalized.slice(match.index, sectionEnd).trim(), marked: false,
        reference: null, status: initialStatus, error: '', errorCode: '', attempts: 0,
        sendSequence: Math.max(0, Number(fields.SEND_SEQUENCE || 0) || 0),
        generationSequence: Math.max(0, Number(fields.GENERATION_SEQUENCE || 0) || 0),
        tentativa, createdAt: fields.CREATED_AT || new Date().toISOString(), metadata: fields.METADATA || '',
        testErrorCode: fields.TEST_ERROR_CODE || '', testErrorProfile: fields.TEST_ERROR_PROFILE || '', testErrorConsumed: false
      };
    }).filter(x => x.prompt.length > 0);
  }

  function validateLoadedJobs() {
    const seenJobs = new Map();
    const seenSlots = new Map();
    const seenFiles = new Map();
    let invalid = 0;

    for (const item of state.prompts) {
      const problems = [];
      const jobKey = norm(item.jobId);
      const slotKey = norm(item.slot);
      const fileKey = norm(safeFileName(item.arquivoFinal, ''));

      if (state.batch?.structured && !String(item.arquivoFinal || '').trim()) problems.push('ARQUIVO_FINAL ausente');
      if (jobKey && seenJobs.has(jobKey)) problems.push(`JOB_ID duplicado com ${seenJobs.get(jobKey)}`);
      if (state.batch?.structured && slotKey && seenSlots.has(slotKey)) problems.push(`SLOT duplicado com ${seenSlots.get(slotKey)}`);
      if (state.batch?.structured && fileKey && seenFiles.has(fileKey)) problems.push(`ARQUIVO_FINAL duplicado com ${seenFiles.get(fileKey)}`);

      if (jobKey && !seenJobs.has(jobKey)) seenJobs.set(jobKey, item.id);
      if (state.batch?.structured && slotKey && !seenSlots.has(slotKey)) seenSlots.set(slotKey, item.id);
      if (state.batch?.structured && fileKey && !seenFiles.has(fileKey)) seenFiles.set(fileKey, item.id);

      if (problems.length) {
        invalid += 1;
        setJobFailure(item, 'INPUT_INVALID', problems.join('; '), 'failed');
        log(`INPUT_INVALID — ${item.id}: ${item.error}`);
      }
    }
    return invalid;
  }

  function extractReference(prompt) {
    if (state.mode === 'referencia') {
      const fixed = state.panel.querySelector('#fbl-fixed-ref').value.trim().replace(/^@/, '') || 'vasty';
      if (new RegExp(`@${fixed}\\b`, 'i').test(prompt)) return fixed;
      return null;
    }
    if (state.mode === 'auxiliar') {
      const prefix = state.panel.querySelector('#fbl-scene-prefix').value.trim().replace(/^@/, '') || 'scene';
      const re = new RegExp(`@(${prefix}\\d+)\\b`, 'i');
      return prompt.match(re)?.[1] || null;
    }
    const mandatory = prompt.match(/Usar\s+@([\w-]+)\s+como\s+referência\s+visual\s+obrigatória/i);
    if (mandatory) return mandatory[1];
    return prompt.match(/@(scene\d+)\b/i)?.[1] || (/@vasty\b/i.test(prompt) ? 'vasty' : null);
  }

  function cssPath(el) {
    if (!el) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let selector = node.tagName.toLowerCase();
      const classes = [...node.classList].filter(c => !/^(ng-|mat-|css-|sc-)/.test(c)).slice(0, 2);
      if (classes.length) selector += '.' + classes.map(CSS.escape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(child => child.tagName === node.tagName);
        if (same.length > 1) selector += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  }

  function findByText(text, selector = '*') {
    const target = norm(text);
    return [...document.querySelectorAll(selector)].find(el => visible(el) && norm(el.textContent) === target);
  }

  function findSearchInput() {
    const candidates = [...document.querySelectorAll('input')]
      .filter(el => visible(el) && !el.closest('#fbl-panel'))
      .filter(el => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', ''].includes(type);
      });

    return candidates.find(el => {
      const p = norm(el.placeholder);
      const a = norm(el.getAttribute('aria-label'));
      const role = norm(el.getAttribute('role'));
      return p.includes('search') || p.includes('pesquisar') ||
             a.includes('search') || a.includes('pesquisar') ||
             role === 'searchbox';
    }) || null;
  }


  function findMentionSearchInput() {
    const candidates = [...document.querySelectorAll('input')]
      .filter(el => visible(el) && !el.closest('#fbl-panel'))
      .filter(el => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', ''].includes(type);
      })
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const p = norm(el.placeholder);
        const a = norm(el.getAttribute('aria-label'));
        const role = norm(el.getAttribute('role'));
        const looksSearch = p.includes('search') || p.includes('pesquisar') || a.includes('search') || a.includes('pesquisar') || role === 'searchbox';
        const nearTop = rect.top < window.innerHeight * 0.45;
        return looksSearch && nearTop;
      });

    // Prefere o campo que realmente recebeu o foco após digitar @.
    return candidates.find(el => document.activeElement === el) || candidates[0] || null;
  }

  async function waitForMentionPanelAndFocus() {
    const search = await waitFor(() => findMentionSearchInput(), 5000, 80);
    if (!search) throw new Error('O painel de referências não abriu após digitar @');

    // Em alguns carregamentos o painel já apareceu, mas o foco ainda não chegou à busca.
    // Espera um pouco; se necessário, aplica foco diretamente no campo de busca visível.
    const focused = await waitFor(() => document.activeElement === search ? search : null, 2200, 60);
    if (!focused) {
      try { search.click(); } catch (_) {}
      search.focus({ preventScroll: true });
      await sleep(120);
    }

    if (document.activeElement !== search) {
      throw new Error('A busca de referências abriu, mas não recebeu foco');
    }
    return search;
  }


  function normalizePromptElement(raw) {
    if (!raw) return null;

    const isEditable = el => {
      if (!el || !visible(el)) return false;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) {
        const type = (el.type || 'text').toLowerCase();
        return ['text', 'search', 'url', 'tel', 'email', 'password'].includes(type);
      }
      return el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('role') === 'textbox';
    };

    if (isEditable(raw)) return raw;

    const closest = raw.closest?.('textarea, input, [contenteditable="true"], [role="textbox"]');
    if (isEditable(closest)) return closest;

    const descendants = [...raw.querySelectorAll?.('textarea, input, [contenteditable="true"], [role="textbox"]') || []]
      .filter(isEditable)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return descendants[0] || null;
  }

  function promptCandidateScore(el) {
    if (!el || !visible(el) || el.closest('#fbl-panel')) return -Infinity;
    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 18) return -Infinity;

    const attrs = norm(`${el.getAttribute?.('placeholder') || ''} ${el.getAttribute?.('aria-placeholder') || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('data-placeholder') || ''}`);
    let score = rect.top * 2 + Math.min(rect.width, 900) + Math.min(rect.height, 180) * 2;

    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') score += 900;
    if (el instanceof HTMLTextAreaElement) score += 700;
    if (el.getAttribute?.('role') === 'textbox') score += 450;
    if (/what do you want to create|o que você quer criar|qué quieres crear|create|criar|prompt/.test(attrs)) score += 5000;
    if (/search|buscar|pesquisar|filter|filtrar|reference|referência|referencia/.test(attrs)) score -= 7000;

    const root = el.closest('form') || el.parentElement?.parentElement || el.parentElement;
    if (root) {
      const buttons = [...root.querySelectorAll('button, [role="button"]')].filter(node => visible(node) && !node.closest('#fbl-panel'));
      if (buttons.some(node => /generate|gerar|send|enviar|submit/.test(norm(`${node.getAttribute?.('aria-label') || ''} ${node.title || ''} ${node.textContent || ''}`)))) {
        score += 3500;
      }
    }
    return score;
  }

  function findPromptInput() {
    if (state.calibratedPromptSelector) {
      const raw = document.querySelector(state.calibratedPromptSelector);
      const el = normalizePromptElement(raw);
      if (el && !el.closest('#fbl-panel') && visible(el)) return el;
    }
    const candidates = [...document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]')]
      .map(normalizePromptElement)
      .filter(Boolean)
      .filter((el, index, arr) => arr.indexOf(el) === index)
      .filter(el => !el.closest('#fbl-panel'));
    return candidates
      .map(el => ({ el, score: promptCandidateScore(el) }))
      .filter(x => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  function findGenerateButton(promptEl) {
    if (state.calibratedGenerateSelector) {
      const el = document.querySelector(state.calibratedGenerateSelector);
      if (visible(el)) return el;
    }
    const root = promptEl?.closest('form') || promptEl?.parentElement?.parentElement || document;
    const buttons = [...root.querySelectorAll('button, [role="button"]')].filter(el => visible(el) && !el.closest('#fbl-panel'));
    const named = buttons.find(el => {
      const label = norm(`${el.getAttribute('aria-label')} ${el.title} ${el.textContent}`);
      return /generate|gerar|send|enviar|submit/.test(label) && !/add to prompt/.test(label);
    });
    if (named) return named;
    return buttons.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null;
  }

  // -----------------------------------------------------------------------
  // V4.1 — AUTO PROJECT / WORKSPACE BOOTSTRAP
  // O Manager pode atribuir JOBs enquanto o perfil ainda está na home do Flow.
  // Nesse caso o Worker entra sozinho em um novo projeto e só então inicia a fila.
  // -----------------------------------------------------------------------
  function flowWorkspaceReady() {
    const prompt = findPromptInput();
    if (!prompt || !visible(prompt)) return false;
    const button = findGenerateButton(prompt);
    return !!button && visible(button);
  }

  function findNewProjectButton() {
    const patterns = [
      /^\+?\s*new project$/i,
      /^\+?\s*novo projeto$/i,
      /^\+?\s*criar projeto$/i,
      /^\+?\s*create project$/i,
      /^\+?\s*new$/i,
      /^\+?\s*novo$/i
    ];
    const raw = [...document.querySelectorAll('button, a, [role="button"], [tabindex], div')]
      .filter(el => visible(el) && !el.closest('#fbl-panel'))
      .filter(el => {
        const label = String(`${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${el.textContent || ''}`).replace(/\s+/g, ' ').trim();
        return label && patterns.some(re => re.test(label));
      });
    if (!raw.length) return null;
    raw.sort((a, b) => {
      const score = el => {
        const tag = String(el.tagName || '').toLowerCase();
        const semantic = tag === 'button' || tag === 'a' || el.getAttribute?.('role') === 'button' ? 0 : (el.hasAttribute?.('tabindex') ? 1 : 2);
        const r = el.getBoundingClientRect();
        return semantic * 1e9 + Math.max(1, r.width * r.height);
      };
      return score(a) - score(b);
    });
    const hit = raw[0];
    return hit.closest?.('button, a, [role="button"], [tabindex]') || hit;
  }

  function findCreateProjectConfirmation() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog')].filter(visible);
    if (!dialogs.length) return null;
    const patterns = [/^create$/i, /^create project$/i, /^criar$/i, /^criar projeto$/i, /^continue$/i, /^continuar$/i, /^start$/i, /^iniciar$/i];
    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible);
      const match = buttons.find(el => {
        const label = String(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`).replace(/\s+/g, ' ').trim();
        return patterns.some(re => re.test(label));
      });
      if (match) return match;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // V4.2.3 — FLOW CLIENT ERROR AUTO RECOVERY
  // Em algumas aberturas o app do Flow cai em uma tela "Application error:
  // a client-side exception has occurred". Nessa condição não existe compositor
  // nem botão New project confiável. O Worker detecta a própria tela de erro e
  // pede ao service worker para recarregar a MESMA aba, sem abrir outra janela.
  // O background mantém um guard persistente para impedir reload infinito.
  // -----------------------------------------------------------------------
  const FLOW_CLIENT_ERROR_PATTERNS = [
    /application error\s*:\s*a client-side exception has occurred/i,
    /client-side exception has occurred/i,
    /application error.*client-side/i,
    /erro (?:do|de) aplicativo.*(?:cliente|navegador)/i,
    /exce[cç][aã]o.*(?:lado do cliente|client-side)/i
  ];
  let flowClientErrorHealthBusy = false;
  let flowClientErrorLastLogAt = 0;

  function detectFlowClientErrorPage() {
    const host = String(location.hostname || '').toLowerCase();
    if (!host.includes('labs.google') && !host.includes('flow.google')) return '';
    const body = String(document.body?.innerText || document.documentElement?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
    if (!body) return '';
    const matched = FLOW_CLIENT_ERROR_PATTERNS.find(re => re.test(body));
    if (!matched) return '';
    const exact = body.match(/application error\s*:\s*a client-side exception has occurred[^.]*\.?/i)?.[0];
    return String(exact || 'Application error: client-side exception detected').trim();
  }

  async function recoverFlowClientError(reason = 'healthcheck') {
    const message = detectFlowClientErrorPage();
    if (!message) return false;
    if (state.clientErrorRecoveryActive || flowClientErrorHealthBusy) return true;

    flowClientErrorHealthBusy = true;
    state.clientErrorRecoveryActive = true;
    state.clientErrorDetectedAt = state.clientErrorDetectedAt || new Date().toISOString();
    state.clientErrorLastMessage = message;
    state.workspaceReady = false;
    state.workspaceStatus = 'FLOW_CLIENT_ERROR';
    state.workspaceLastError = message;
    updateQueueUI();
    setStatus('Flow com erro — recarregando automaticamente');

    const now = Date.now();
    if (now - flowClientErrorLastLogAt > 2500) {
      log(`FLOW AUTO RECOVERY — erro client-side detectado (${reason}); recarregando a mesma aba automaticamente...`);
      flowClientErrorLastLogAt = now;
    }

    try {
      await persistManagerState('flow_client_error_detected');
    } catch (_) {}

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FLOW_CLIENT_ERROR_RELOAD',
        reason,
        message,
        url: location.href
      });
      if (response?.ok) {
        state.clientErrorReloadRequestedAt = new Date().toISOString();
        state.workspaceStatus = response.skipped ? 'FLOW_CLIENT_ERROR_RELOAD_WAIT' : 'FLOW_CLIENT_ERROR_RELOADING';
        state.workspaceLastError = response.skipped
          ? 'Reload já solicitado recentemente; aguardando a aba estabilizar.'
          : `Recarregamento automático solicitado (tentativa ${response.attempt || 1}).`;
        updateQueueUI();
        // O reload ocorre pelo background após a resposta. Mantemos o guard ativo
        // para nenhuma outra rotina tentar clicar/digitar nesta página quebrada.
        return true;
      }

      state.workspaceStatus = response?.blocked ? 'FLOW_CLIENT_ERROR_RELOAD_LIMIT' : 'FLOW_CLIENT_ERROR_RELOAD_FAILED';
      state.workspaceLastError = response?.error || 'Não foi possível recarregar automaticamente a página do Flow.';
      state.clientErrorRecoveryActive = false;
      log(`FLOW AUTO RECOVERY — ${state.workspaceLastError}`);
      updateQueueUI();
      return true;
    } catch (error) {
      state.workspaceStatus = 'FLOW_CLIENT_ERROR_RELOAD_FAILED';
      state.workspaceLastError = String(error?.message || error);
      state.clientErrorRecoveryActive = false;
      log(`FLOW AUTO RECOVERY — falha ao solicitar reload: ${state.workspaceLastError}`);
      updateQueueUI();
      return true;
    } finally {
      flowClientErrorHealthBusy = false;
    }
  }

  async function flowClientErrorHealthCheck() {
    const detected = detectFlowClientErrorPage();
    if (detected) {
      await recoverFlowClientError('periodic_healthcheck');
      return;
    }
    // Se a página já estabilizou sem precisar navegar (caso raro), libera o guard.
    if (state.clientErrorRecoveryActive && flowWorkspaceReady()) {
      state.clientErrorRecoveryActive = false;
      state.clientErrorLastMessage = '';
      state.workspaceLastError = '';
      state.workspaceReady = true;
      state.workspaceStatus = 'PROJECT_READY';
    }
  }

  function workspaceSnapshot() {
    const clientError = detectFlowClientErrorPage();
    if (clientError) {
      state.workspaceReady = false;
      state.workspaceStatus = state.workspaceStatus?.startsWith('FLOW_CLIENT_ERROR') ? state.workspaceStatus : 'FLOW_CLIENT_ERROR';
      state.workspaceLastError = clientError;
      return {
        ready: false,
        status: state.workspaceStatus,
        url: location.href,
        canCreateProject: false,
        lastError: state.workspaceLastError || clientError,
        lastActionAt: state.workspaceLastActionAt || ''
      };
    }
    const ready = flowWorkspaceReady();
    const newProject = !ready && !!findNewProjectButton();
    const status = ready ? 'PROJECT_READY' : (state.workspaceStatus && state.workspaceStatus !== 'PROJECT_READY'
      ? state.workspaceStatus
      : (newProject ? 'FLOW_HOME' : 'WAITING_FLOW_UI'));
    state.workspaceReady = ready;
    if (ready) {
      state.workspaceStatus = 'PROJECT_READY';
      state.workspaceLastError = '';
    }
    return {
      ready,
      status,
      url: location.href,
      canCreateProject: newProject,
      lastError: state.workspaceLastError || '',
      lastActionAt: state.workspaceLastActionAt || ''
    };
  }

  async function ensureFlowGenerationWorkspace() {
    if (detectFlowClientErrorPage()) {
      await recoverFlowClientError('workspace_preflight');
      return false;
    }
    if (flowWorkspaceReady()) {
      state.clientErrorRecoveryActive = false;
      state.clientErrorLastMessage = '';
      state.workspaceReady = true;
      state.workspaceStatus = 'PROJECT_READY';
      state.workspaceLastError = '';
      return true;
    }

    state.workspaceReady = false;
    state.workspaceStatus = 'FLOW_HOME';
    state.workspaceLastError = '';
    updateQueueUI();

    const newProject = findNewProjectButton();
    if (!newProject) {
      state.workspaceStatus = 'WAITING_FLOW_UI';
      state.workspaceLastError = 'Campo de geração ausente e botão New project não encontrado.';
      return false;
    }

    state.workspaceStatus = 'OPENING_PROJECT';
    state.workspaceLastActionAt = new Date().toISOString();
    setStatus('Manager: abrindo novo projeto no Flow');
    log('MANAGER WORKSPACE — home do Flow detectada; abrindo New project automaticamente...');

    try {
      await realClickElement(newProject, 'New project');
    } catch (error) {
      state.workspaceStatus = 'PROJECT_OPEN_ERROR';
      state.workspaceLastError = String(error?.message || error);
      log(`MANAGER WORKSPACE — falha ao clicar em New project: ${state.workspaceLastError}`);
      return false;
    }

    let ready = await waitFor(flowWorkspaceReady, 30000, 250);
    if (!ready) {
      const confirm = findCreateProjectConfirmation();
      if (confirm) {
        try {
          log('MANAGER WORKSPACE — confirmação de criação detectada; continuando automaticamente...');
          await realClickElement(confirm, 'confirmação de criação do projeto');
          ready = await waitFor(flowWorkspaceReady, 25000, 250);
        } catch (error) {
          state.workspaceLastError = String(error?.message || error);
        }
      }
    }

    if (!ready) {
      state.workspaceReady = false;
      state.workspaceStatus = 'WAITING_PROJECT';
      state.workspaceLastError = state.workspaceLastError || 'Novo projeto foi solicitado, mas o compositor de geração ainda não apareceu.';
      log(`MANAGER WORKSPACE — aguardando compositor do Flow: ${state.workspaceLastError}`);
      return false;
    }

    state.workspaceReady = true;
    state.workspaceStatus = 'PROJECT_READY';
    state.workspaceLastError = '';
    state.workspaceLastActionAt = new Date().toISOString();
    setStatus('Manager: projeto pronto');
    log('MANAGER WORKSPACE — projeto pronto; demanda sincronizada e fila liberada para envio.');
    return true;
  }

  function setInputValue(el, value) {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
  }

  function keyboardCodeFor(char) {
    if (char === '@') return { code: 'Digit2', keyCode: 50 };
    if (/^[a-z]$/i.test(char)) return { code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0) };
    if (/^[0-9]$/.test(char)) return { code: `Digit${char}`, keyCode: char.charCodeAt(0) };
    return { code: '', keyCode: char.charCodeAt(0) || 0 };
  }

  async function typeLikeKeyboard(el, text, minMs = 18, maxMs = 42, clearFirst = true) {
    if (!el) throw new Error('Elemento de digitação não encontrado');
    el.focus();

    if (clearFirst) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      } else {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('delete', false);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      }
      await sleep(80);
    }

    for (const char of text) {
      const { code, keyCode } = keyboardCodeFor(char);
      const keyInit = {
        key: char,
        code,
        keyCode,
        which: keyCode,
        charCode: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey: char === '@'
      };

      el.dispatchEvent(new KeyboardEvent('keydown', keyInit));
      el.dispatchEvent(new KeyboardEvent('keypress', keyInit));
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: char
      }));

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
        el.setRangeText(char, start, end, 'end');
      } else {
        document.execCommand('insertText', false, char);
      }

      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: char
      }));
      el.dispatchEvent(new KeyboardEvent('keyup', keyInit));

      const wait = Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
      await sleep(wait);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }


  function promptOwnsActiveFocus(promptEl) {
    if (!promptEl) return false;
    const active = document.activeElement;
    if (!active) return false;
    if (active === promptEl || promptEl.contains?.(active)) return true;
    const root = composerRootFor(promptEl);
    if (!root || !root.contains(active)) return false;
    return active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active.isContentEditable || active.getAttribute?.('role') === 'textbox';
  }

  function placeCaretAtPromptEnd(el) {
    if (!el) return;
    if (el.isContentEditable) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const type = el instanceof HTMLInputElement ? (el.type || 'text').toLowerCase() : 'textarea';
      const supportsSelection = el instanceof HTMLTextAreaElement || ['text', 'search', 'tel', 'url', 'password'].includes(type);
      if (supportsSelection && typeof el.setSelectionRange === 'function') {
        try {
          const len = (el.value || '').length;
          el.setSelectionRange(len, len);
        } catch (_) {}
      }
    }
  }

  async function forceFocusOnPrompt(el) {
    if (!el) throw new Error('Campo do prompt não encontrado para foco');

    let current = el;
    let lastActive = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (!current?.isConnected || !visible(current)) current = findPromptInput();
      if (!current) {
        await sleep(140);
        continue;
      }

      const active = document.activeElement;
      if (active && active !== current && typeof active.blur === 'function') {
        try { active.blur(); } catch (_) {}
      }

      // Primeiro tenta o foco DOM, que é barato. Depois confirma com clique real CDP,
      // importante quando o Flow troca/rerenderiza o contenteditable entre frames React.
      try { current.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch (_) {}
      try { current.click(); } catch (_) {}
      try { current.focus({ preventScroll: true }); } catch (_) {}
      placeCaretAtPromptEnd(current);
      await sleep(90);

      let fresh = findPromptInput() || current;
      if (promptOwnsActiveFocus(current) || promptOwnsActiveFocus(fresh)) return fresh;

      try {
        await realClickElement(fresh, `campo do prompt (foco ${attempt}/4)`);
      } catch (_) {
        try { fresh.click(); } catch (_) {}
      }
      try { fresh.focus({ preventScroll: true }); } catch (_) {}
      placeCaretAtPromptEnd(fresh);
      await sleep(attempt === 1 ? 180 : 260);

      const afterClick = findPromptInput() || fresh;
      if (promptOwnsActiveFocus(fresh) || promptOwnsActiveFocus(afterClick)) return afterClick;

      const a = document.activeElement;
      lastActive = a ? `${String(a.tagName || '').toLowerCase()}${a.getAttribute?.('role') ? `[role=${a.getAttribute('role')}]` : ''}` : 'none';
      current = afterClick;
      await sleep(120 * attempt);
    }

    throw new Error(`O Flow não manteve o foco no campo do prompt após 4 tentativas (active=${lastActive || 'none'})`);
  }

  async function typeRealText(el, text, clearFirst = false, delayMin = 3, delayMax = 10) {
    if (!el) throw new Error('Elemento de digitação não encontrado');
    await forceFocusOnPrompt(el);
    const response = await chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_REAL_TYPE',
      text,
      clearFirst,
      delayMin,
      delayMax
    });
    if (!response?.ok) throw new Error(response?.error || 'Falha ao enviar teclas reais');
  }


  async function typeFastText(el, text, clearFirst = false, chunkSize = 240, delayMin = 12, delayMax = 28) {
    if (!el) throw new Error('Elemento de digitação rápida não encontrado');
    await forceFocusOnPrompt(el);
    const response = await chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_FAST_TYPE',
      text,
      clearFirst,
      chunkSize,
      delayMin,
      delayMax
    });
    if (!response?.ok) throw new Error(response?.error || 'Falha ao inserir texto em blocos');
  }

  async function typeRealTextOnCurrentFocus(text, delayMin = 3, delayMax = 10) {
    const response = await chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_REAL_TYPE',
      text,
      clearFirst: false,
      delayMin,
      delayMax
    });
    if (!response?.ok) throw new Error(response?.error || 'Falha ao enviar teclas reais no foco atual');
  }

  async function typeRealAt(el) {
    if (!el) throw new Error('Campo principal do prompt não encontrado para digitar @');
    await forceFocusOnPrompt(el);
    const response = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_REAL_AT' });
    if (!response?.ok) throw new Error(response?.error || 'Falha ao enviar @ como tecla real');
  }

  function findExactReferenceCard(reference) {
    const ref = reference.toLowerCase();
    const all = [...document.querySelectorAll('button, [role="button"], [role="option"], li, div')]
      .filter(el => visible(el) && !el.closest('#fbl-panel'));

    const matches = all.filter(el => {
      const text = norm(el.textContent);
      if (!text || text.includes('add to prompt')) return false;
      const firstToken = text.split(' ')[0];
      return firstToken === ref || firstToken.startsWith(`${ref}_`) || text.startsWith(`${ref} `) || text.startsWith(`${ref}_`);
    });

    if (!matches.length) return null;

    // Prefere o menor elemento clicável, evitando contêineres que englobam a lista inteira.
    matches.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });

    const raw = matches[0];
    return raw.closest('button, [role="button"], [role="option"], li') || raw;
  }


  function findAddToPromptButton() {
    return findByText('Add to Prompt', 'button, [role="button"]') ||
           findByText('Adicionar ao prompt', 'button, [role="button"]');
  }

  function isReferenceAttached(reference, promptEl = null) {
    const prompt = promptEl || findPromptInput();
    if (!prompt) return false;

    // O chip normalmente fica dentro do próprio editor ou no contêiner imediato dele.
    const roots = [
      prompt,
      prompt.parentElement,
      prompt.parentElement?.parentElement,
      prompt.closest('form')
    ].filter(Boolean);

    const ref = String(reference || '').toLowerCase();
    for (const root of roots) {
      const nodes = [root, ...root.querySelectorAll?.('*') || []];
      for (const node of nodes) {
        if (!visible(node) || node.closest?.('#fbl-panel')) continue;
        const text = norm(node.textContent);
        if (!text) continue;
        const tokens = text.split(' ');
        if (tokens.some(token => token === ref || token.startsWith(`${ref}_`) || token.startsWith(`${ref}.`))) {
          return true;
        }
      }
    }
    return false;
  }

  async function insertRemainingText(promptEl, text) {
    if (!text) return;
    await forceFocusOnPrompt(promptEl);
    const response = await chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_INSERT_TEXT',
      text
    });
    if (!response?.ok) throw new Error(response?.error || 'Falha ao inserir o restante do prompt');
    log('Texto inserido no compositor.');
  }


  function promptTextValue(el) {
    if (!el) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return String(el.value || '');
    }
    return String(el.innerText || el.textContent || '');
  }

  async function realClickElement(el, label = 'elemento') {
    if (!el || !visible(el)) throw new Error(`${label} não está visível para clique`);
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
    await sleep(120);
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      throw new Error(`${label} ficou fora da área visível`);
    }
    const response = await chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_REAL_CLICK',
      x,
      y
    });
    if (!response?.ok) throw new Error(response?.error || `Falha no clique real em ${label}`);
  }

  function countGenerationCards() {
    const selectors = [
      '[role="progressbar"]',
      '[aria-busy="true"]',
      '[data-testid*="generation"]',
      '[class*="generation"]',
      '[class*="loading"]',
      '[class*="progress"]'
    ];
    const seen = new Set();
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (visible(el) && !el.closest('#fbl-panel')) seen.add(el);
      });
    });
    return seen.size;
  }

  function captureFlowState(promptEl, reference) {
    const generateButton = findGenerateButton(promptEl || findPromptInput());
    return {
      composerEmpty: composerIsEmpty(),
      promptText: normalizedPromptContent(promptEl || findPromptInput()),
      referenceAttached: isReferenceAttached(reference, promptEl || findPromptInput()),
      progressCount: countGenerationCards(),
      generateDisabled: !!generateButton && (generateButton.disabled || generateButton.getAttribute('aria-disabled') === 'true'),
      bodyText: norm(document.body.innerText).slice(-12000)
    };
  }

  function submissionLooksConfirmed(before, after) {
    // Confirmação estrita: nunca considerar o próprio texto ainda presente no
    // compositor como sinal de envio. A v1.8 podia marcar como concluído só
    // porque o ID (ex.: 004A) continuava visível na caixa de prompt.
    if (after.composerEmpty) return true;
    if (!after.referenceAttached && after.promptText.length === 0) return true;
    if (after.progressCount > before.progressCount) return true;

    // Aceita mudança do botão somente quando vem acompanhada de mudança real
    // no compositor. Isso evita falso positivo causado por foco/hover.
    const composerChanged = after.promptText !== before.promptText ||
      after.referenceAttached !== before.referenceAttached;
    if (composerChanged && after.generateDisabled && !before.generateDisabled) return true;

    return false;
  }

  async function waitForFlexibleSubmission(before, promptEl, reference, item, timeout = 6500) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = findPromptInput() || promptEl;
      if (!promptEl?.isConnected || !visible(promptEl)) return true;
      const after = captureFlowState(current, reference);
      if (submissionLooksConfirmed(before, after)) return true;
      await sleep(180);
    }
    return false;
  }

  function serializableJob(item) {
    const copy = {};
    for (const [key, value] of Object.entries(item || {})) {
      if (key.startsWith('_')) continue;
      if (typeof value === 'function') continue;
      copy[key] = value;
    }
    return copy;
  }

  async function persistManagerState(reason = '') {
    const payload = {
      version: '0.3', reason, workerId: state.workerId, managerProfileId: state.managerProfileId, batch: state.batch,
      index: state.index, running: state.running, paused: state.paused, managerHold: state.managerHold,
      sendSequence: state.sendSequence, batchCompletedAt: state.batchCompletedAt, mappingConflicts: state.mappingConflicts,
      loadedSignature: state.loadedSignature || '', captureArmed: state.captureArmed,
      prompts: state.prompts.map(serializableJob), timestamp: Date.now()
    };
    state.results = payload.prompts.filter(x => !['pending','assigned','sending'].includes(x.status));
    await chrome.storage.local.set({ corvoFlowManagerState: payload, flowBatchProgress: payload, corvoFlowLastManifest: buildManagerManifest() });
  }

  async function restoreManagerState() {
    try {
      const data = await chrome.storage.local.get(['corvoFlowManagerState']);
      const saved = data.corvoFlowManagerState;
      if (!saved?.prompts?.length) return false;
      state.batch = saved.batch || state.batch;
      state.managerProfileId = saved.managerProfileId || state.batch?.managerProfileId || state.managerProfileId || '';
      if (state.managerProfileId) state.workerId = `FLOW_WORKER_${state.managerProfileId}`;
      state.loadedSignature = saved.loadedSignature || '';
      state.prompts = saved.prompts.map(item => ({ ...item }));
      state.index = Math.max(0, Number(saved.index) || 0);
      state.sendSequence = Math.max(Number(saved.sendSequence) || 0, ...state.prompts.map(item => Number(item.sendSequence) || 0));
      state.batchCompletedAt = saved.batchCompletedAt || '';
      state.mappingConflicts = Number(saved.mappingConflicts) || 0;
      assetAssignments.clear();
      state.prompts.forEach(item => { if (item.assetKey && item.jobId) assetAssignments.set(item.assetKey, item.jobId); });
      state.results = state.prompts.filter(x => !['pending','assigned','sending'].includes(x.status)).map(serializableJob);
      // Nunca reinicia envio nem captura/download automaticamente. O checkpoint é restaurado
      // apenas como estado; START rearma a captura. Isso evita baixar cartões antigos enquanto
      // o usuário ainda está ajustando o Flow.
      state.running = false; state.paused = false; state.captureArmed = false;
      state.managerHold = saved.managerHold === true;
      state.prompts.filter(item => ['sent','generating','result_ready','downloading'].includes(item.status)).forEach(item => registerSentJob(item, null, true));
      log(`Checkpoint restaurado: ${state.prompts.length} JOBs; nenhum prompt foi relançado automaticamente.`);
      updateQueueUI(); setStatus('Checkpoint restaurado');
      return true;
    } catch (error) {
      log(`Falha ao restaurar checkpoint: ${error.message}`);
      return false;
    }
  }

  function detectLimitMessage() {
    const text = String(document.body?.innerText || '').slice(-20000);
    const found = LIMIT_PATTERNS.find(re => re.test(text));
    if (found) return text.match(found)?.[0] || 'limite detectado';
    const normalized = norm(text);
    const custom = (managerLimitPhrases || []).find(phrase => phrase && normalized.includes(norm(phrase)));
    return custom || '';
  }

  function classifyOperationalError(error) {
    const message = String(error?.message || error || 'Erro desconhecido');
    const explicit = String(error?.corvoErrorCode || error?.code || '').toUpperCase();
    if (FAILURE_POLICIES[explicit]) {
      const policy = failurePolicy(explicit);
      const status = explicit === 'FLOW_LIMIT_REACHED' ? 'limit_reached' : (policy.retryAllowed ? 'retry' : 'failed');
      return { status, errorCode: explicit };
    }
    if (/limite|quota|rate limit|too many|cr[eé]dito/i.test(message) || detectLimitMessage()) return { status: 'limit_reached', errorCode: 'FLOW_LIMIT_REACHED' };
    if (/session expired|sess[aã]o expir|sign in|fazer login|login required/i.test(message)) return { status: 'failed', errorCode: 'SESSION_EXPIRED' };
    if (/prompt rejected|prompt recusado|prompt bloqueado|request rejected/i.test(message)) return { status: 'failed', errorCode: 'PROMPT_REJECTED' };
    if (/content block|conte[uú]do bloqueado|policy|safety|not allowed|n[aã]o permitido/i.test(message)) return { status: 'failed', errorCode: 'CONTENT_BLOCK' };
    if (/network|rede|fetch|connection|conex[aã]o|offline/i.test(message)) return { status: 'retry', errorCode: 'NETWORK_ERROR' };
    if (/download/i.test(message)) return { status: 'retry', errorCode: 'DOWNLOAD_FAILED' };
    if (/resultado|result.*not found|asset/i.test(message)) return { status: 'failed', errorCode: 'RESULT_NOT_FOUND' };
    if (/prompt|compositor|bot[aã]o|campo|elemento|painel|refer[eê]ncia|clique|selector|seletor/i.test(message)) return { status: 'retry', errorCode: 'UI_ERROR' };
    return { status: 'failed', errorCode: 'UNKNOWN_ERROR' };
  }

  function findGenerationRoots() {
    const seeds = [];
    const selectors = [
      '[data-testid*="generation"]','[data-testid*="result"]','[data-testid*="output"]',
      '[class*="generation"]','[class*="result"]','[class*="output"]','[aria-busy="true"]',
      '[role="progressbar"]','img'
    ];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(el => {
      if (!visible(el) || el.closest('#fbl-panel')) return;
      if (el.tagName === 'IMG') {
        const r = el.getBoundingClientRect();
        if (r.width < 180 || r.height < 140) return;
      }
      seeds.push(el);
    }));

    const roots = [];
    const seen = new Set();
    for (const seed of seeds) {
      let root = seed.closest('[data-testid*="generation"], [data-testid*="result"], [data-testid*="output"], article, [role="listitem"], [role="group"]');
      if (!root) {
        root = seed;
        for (let i = 0; i < 4 && root?.parentElement; i++) {
          const parent = root.parentElement;
          const rect = parent.getBoundingClientRect();
          if (rect.width > 240 && rect.height > 160 && rect.width < window.innerWidth * 0.98 && rect.height < window.innerHeight * 0.95) root = parent;
          else break;
        }
      }
      if (!root || seen.has(root) || root.closest('#fbl-panel')) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 150 || rect.width > window.innerWidth * 1.02 || rect.height > window.innerHeight * 1.5) continue;
      seen.add(root);
      if (!rootMeta.has(root)) {
        rootMeta.set(root, {
          sequence: ++rootSequence,
          firstSeenAt: Date.now(),
          initialText: norm(root.innerText || '').slice(0, 1000)
        });
      }
      roots.push(root);
    }
    return roots;
  }

  function rootBusy(root) {
    if (!root?.isConnected) return false;
    if (root.querySelector('[role="progressbar"], [aria-busy="true"], [class*="loading"], [class*="progress"], [data-testid*="loading"]')) return true;
    const text = norm(root.innerText).slice(-1500);
    return /generating|gerando|creating|criando|processing|processando|loading|carregando/.test(text);
  }

  function bestImageInRoot(root) {
    if (!root?.isConnected) return null;
    let best = null, bestScore = -1;
    const images = root.tagName === 'IMG' ? [root, ...root.querySelectorAll('img')] : [...root.querySelectorAll('img')];
    for (const img of images) {
      if (!visible(img)) continue;
      const src = img.currentSrc || img.src || '';
      if (!src || /avatar|icon|logo|favicon|profile/i.test(`${src} ${img.alt || ''}`)) continue;
      const rect = img.getBoundingClientRect();
      const natural = Math.max(1, (img.naturalWidth || 0) * (img.naturalHeight || 0));
      const displayed = rect.width * rect.height;
      if (rect.width < 220 || rect.height < 150) continue;
      let candidate = src;
      const srcset = String(img.getAttribute('srcset') || '');
      if (srcset) {
        const choices = srcset.split(',').map(part => part.trim().split(/\s+/)).filter(x => x[0]);
        choices.sort((a,b) => (parseInt(b[1])||0) - (parseInt(a[1])||0));
        if (choices[0]?.[0]) candidate = choices[0][0];
      }
      const score = natural + displayed * 4;
      if (score > bestScore) { bestScore = score; best = { img, url: candidate, width: img.naturalWidth || Math.round(rect.width), height: img.naturalHeight || Math.round(rect.height) }; }
    }
    return best;
  }


  // V4.1.4: alguns projetos novos do Flow reutilizam um cartão/placeholder que já
  // existia antes do clique em Gerar. A lógica antiga guardava apenas o elemento
  // no baseline e, por isso, ignorava para sempre esse mesmo cartão quando ele
  // mudava de "vazio/gerando" para "resultado pronto". Agora guardamos também
  // uma assinatura do conteúdo do cartão e aceitamos raízes pré-existentes que
  // tenham mudado depois do envio.
  function generationRootFingerprint(root) {
    if (!root?.isConnected) return 'disconnected';
    const asset = bestImageInRoot(root);
    const text = norm(root.innerText || '').slice(-900);
    const busy = rootBusy(root) ? '1' : '0';
    const ariaBusy = String(root.getAttribute?.('aria-busy') || '');
    const imageCount = root.querySelectorAll?.('img')?.length || 0;
    const progressCount = root.querySelectorAll?.('[role="progressbar"], [aria-busy="true"]')?.length || 0;
    return [busy, ariaBusy, imageCount, progressCount, asset?.url || '', asset?.width || 0, asset?.height || 0, text].join('|');
  }

  function captureGenerationBaseline() {
    const baseline = new Map();
    for (const root of findGenerationRoots()) baseline.set(root, generationRootFingerprint(root));
    return baseline;
  }

  function baselineBlocksRoot(entry, root) {
    const baseline = entry?.baseline;
    if (!baseline) return false;
    if (baseline instanceof Map) {
      if (!baseline.has(root)) return false;
      return baseline.get(root) === generationRootFingerprint(root);
    }
    return !!baseline.has?.(root);
  }

  function rootsChangedSinceBaseline(baseline) {
    return findGenerationRoots().filter(root => {
      if (baseline instanceof Map) {
        if (!baseline.has(root)) return true;
        return baseline.get(root) !== generationRootFingerprint(root);
      }
      return !baseline?.has?.(root);
    });
  }

  function rootFailure(root) {
    const text = norm(root?.innerText || '');
    if (!text) return null;
    if (/prompt rejected|prompt recusado|request rejected/.test(text)) return { errorCode: 'PROMPT_REJECTED', message: text.slice(0, 600) };
    if (/policy|safety|content.*block|conte[uú]do.*bloque|violat|not allowed|n[aã]o permitido/.test(text)) return { errorCode: 'CONTENT_BLOCK', message: text.slice(0, 600) };
    if (/failed|falhou|couldn.t generate|n[aã]o foi poss[ií]vel gerar|generation error/.test(text)) return { errorCode: 'GENERATION_FAILED', message: text.slice(0, 600) };
    return null;
  }

  function candidateScore(root, item) {
    let score = 0;
    const text = norm(root?.innerText || '');
    const id = norm(item?.id);
    const slot = norm(item?.slot);
    const jobId = norm(item?.jobId);
    if (jobId && text.includes(jobId)) score += 100;
    if (slot && text.includes(slot)) score += 55;
    if (id && id !== slot && text.includes(id)) score += 35;
    const words = norm(item?.prompt).split(' ').filter(w => w.length >= 5).slice(0, 10);
    score += words.filter(w => text.includes(w)).length * 3;
    if (rootBusy(root)) score += 2;
    return score;
  }

  function mappingConfidenceFor(method, score = 0) {
    if (method === 'submission_window_single') return 100;
    if (method === 'dom_exact') return Math.min(99, 88 + Math.min(11, Math.floor(score / 20)));
    if (method === 'submission_window_scored') return Math.min(96, 82 + Math.min(14, Math.floor(score / 10)));
    if (method === 'fifo_birth_order') return 72;
    if (method === 'manager_recovery_fifo') return 72;
    if (method === 'restored_rebind') return 60;
    return 50;
  }

  function rootOwner(root) {
    if (!root) return '';
    const direct = rootAssignments.get(root);
    if (direct) return direct;
    for (const tracked of liveTracking.values()) {
      const owned = tracked?.root;
      if (!owned?.isConnected) continue;
      if (owned === root || owned.contains?.(root) || root.contains?.(owned)) return tracked.item?.jobId || '';
    }
    return '';
  }

  function bindRootToJob(entry, root, method = 'fifo_birth_order', score = 0) {
    if (!entry || !root || !root.isConnected) return false;
    const assigned = rootOwner(root);
    if (assigned && assigned !== entry.item.jobId) return false;

    rootAssignments.set(root, entry.item.jobId);
    try { root.dataset.corvoFlowJobId = entry.item.jobId; } catch (_) {}
    entry.root = root;
    const meta = rootMeta.get(root) || { sequence: ++rootSequence, firstSeenAt: Date.now() };
    if (!rootMeta.has(root)) rootMeta.set(root, meta);

    entry.item.status = 'generating';
    entry.item.generationDetectedAt = entry.item.generationDetectedAt || new Date().toISOString();
    entry.item.generationSequence = meta.sequence;
    entry.item.mappingMethod = method;
    entry.item.mappingConfidence = mappingConfidenceFor(method, score);
    entry.item.mappingScore = score;
    entry.item.mappingRootFirstSeenAt = new Date(meta.firstSeenAt).toISOString();
    emitManagerLifecycleEvent(entry.item, 'GENERATION_STARTED');

    log(`BOUND — ${entry.item.id} -> geração #${meta.sequence} | ${method} | confiança ${entry.item.mappingConfidence}%`);
    persistManagerState('generation_bound');
    return true;
  }

  function rootsEligibleForEntry(entry, roots = findGenerationRoots()) {
    return roots.filter(root => {
      const assigned = rootOwner(root);
      if (assigned && assigned !== entry.item.jobId) return false;
      if (baselineBlocksRoot(entry, root)) return false;
      return true;
    });
  }

  function tryImmediateBind(entry) {
    const candidates = (entry.immediateRoots || []).filter(root => root?.isConnected && !rootOwner(root) && !baselineBlocksRoot(entry, root));
    if (!candidates.length) return false;
    if (candidates.length === 1) return bindRootToJob(entry, candidates[0], 'submission_window_single', candidateScore(candidates[0], entry.item));

    const ranked = candidates.map(root => ({ root, score: candidateScore(root, entry.item) })).sort((a,b) => b.score - a.score);
    if (ranked[0].score > ranked[1].score && ranked[0].score >= 12) {
      return bindRootToJob(entry, ranked[0].root, 'submission_window_scored', ranked[0].score);
    }
    return false;
  }

  function reconcileTrackingAssignments() {
    const allRoots = findGenerationRoots();
    const entries = [...liveTracking.values()]
      .filter(entry => entry?.item && entry.item.status !== 'done' && !entry.root?.isConnected)
      .sort((a,b) => Number(a.item.sendSequence || 0) - Number(b.item.sendSequence || 0));

    // 1) A janela imediatamente após o clique é o vínculo mais forte.
    for (const entry of entries) tryImmediateBind(entry);

    // 2) Se o próprio cartão contiver ID/SLOT/JOB, usa essa pista antes do FIFO.
    for (const entry of entries.filter(e => !e.root?.isConnected)) {
      const ranked = rootsEligibleForEntry(entry, allRoots)
        .map(root => ({ root, score: candidateScore(root, entry.item) }))
        .filter(row => row.score >= 35)
        .sort((a,b) => b.score - a.score || (rootMeta.get(a.root)?.sequence || 0) - (rootMeta.get(b.root)?.sequence || 0));
      if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
        bindRootToJob(entry, ranked[0].root, 'dom_exact', ranked[0].score);
      }
    }

    // 3) Fallback determinístico: placeholders/cartões nascem na ordem dos envios.
    // Só usa raízes que não existiam no baseline individual daquele JOB.
    const remainingEntries = entries.filter(e => !e.root?.isConnected);
    const freeRoots = allRoots
      .filter(root => !rootOwner(root))
      .sort((a,b) => (rootMeta.get(a)?.sequence || 0) - (rootMeta.get(b)?.sequence || 0));

    for (const entry of remainingEntries) {
      const idx = freeRoots.findIndex(root => !baselineBlocksRoot(entry, root));
      if (idx < 0) continue;
      const root = freeRoots.splice(idx, 1)[0];
      bindRootToJob(entry, root, entry.managerRecovery ? 'manager_recovery_fifo' : (entry.restored ? 'restored_rebind' : 'fifo_birth_order'), candidateScore(root, entry.item));
    }
  }

  function tryBindEntry(entry) {
    if (!entry) return false;
    if (entry.root?.isConnected) return true;
    reconcileTrackingAssignments();
    return !!entry.root?.isConnected;
  }

  async function resumeExistingDownload(entry) {
    const item = entry?.item;
    if (!item?.downloadId || item.status !== 'downloading') return false;
    try {
      const status = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_DOWNLOAD_STATUS', downloadId: item.downloadId });
      if (status?.state === 'complete') {
        const expected = safeFileName(item.requestedFile || item.arquivoFinal, downloadedBaseName(status.filename) || 'corvo-flow-asset.png');
        const actualBase = downloadedBaseName(status.filename) || expected;
        item.downloadPath = status.filename || '';
        item.downloadedFile = actualBase;
        if (!compatibleDownloadedFileName(expected, actualBase)) {
          setJobFailure(item, 'FILE_NAME_MISMATCH', `Chrome salvou ${actualBase}, mas ARQUIVO_FINAL exige ${expected}`, 'failed');
          entry.downloadStarted = false;
          maybeMarkBatchComplete();
          await persistManagerState('restore_filename_mismatch');
          return false;
        }
        if (actualBase.toLowerCase() !== expected.toLowerCase()) {
          item.extensionAdjusted = true;
          item.requestedFileOriginal = expected;
          log(`JPG_SUPPORT — ${item.id}: Flow entregou ${actualBase}; aceito no lugar de ${expected}.`);
        }
        item.status = 'done';
        item.file = actualBase;
        item.doneAt = item.doneAt || new Date().toISOString();
        clearJobFailure(item);
        emitManagerLifecycleEvent(item, 'DONE');
        liveTracking.delete(item.jobId);
        log(`DONE RESTAURADO — ${item.id} -> ${actualBase}`);
        maybeMarkBatchComplete();
        await persistManagerState('restore_download_complete');
        updateQueueUI(); setStatus();
        return true;
      }
      if (status?.state === 'interrupted' || status?.ok === false) {
        entry.downloadStarted = false;
        setJobFailure(item, 'DOWNLOAD_INTERRUPTED', status?.error || 'Download anterior não está mais ativo', 'retry');
        liveTracking.delete(item.jobId);
        log(`DOWNLOAD_INTERRUPTED — ${item.id}: não será iniciado outro download automaticamente.`);
        maybeMarkBatchComplete();
        await persistManagerState('restore_download_interrupted');
        updateQueueUI(); setStatus();
        return false;
      }
      // Ainda em progresso: uma nova verificação ocorrerá pelo scanner.
      return true;
    } catch (error) {
      entry.downloadStarted = false;
      setJobFailure(item, 'DOWNLOAD_STATUS_UNKNOWN', String(error?.message || error || 'Não foi possível confirmar o download anterior'), 'retry');
      liveTracking.delete(item.jobId);
      log(`DOWNLOAD_STATUS_UNKNOWN — ${item.id}: bloqueado novo download automático.`);
      maybeMarkBatchComplete();
      await persistManagerState('restore_download_status_unknown');
      updateQueueUI(); setStatus();
      return false;
    }
  }

  async function downloadTrackedAsset(entry, asset) {
    const item = entry.item;
    if (!state.captureArmed) return;
    if (entry.downloadStarted || item.status === 'done') return;

    const confidence = Number(item.mappingConfidence || 0);
    if (confidence < 70) {
      item.mappingGuard = 'LOW_CONFIDENCE';
      setJobFailure(item, 'MAPPING_UNCERTAIN', `Confiança de mapeamento ${confidence}% insuficiente para atribuir automaticamente o asset a este JOB`, 'failed');
      liveTracking.delete(item.jobId);
      if (!entry.lowConfidenceLogged) {
        entry.lowConfidenceLogged = true;
        log(`MAPPING_UNCERTAIN — ${item.id}: confiança ${confidence}%. Download bloqueado para evitar arquivo no ID errado.`);
      }
      maybeMarkBatchComplete();
      await persistManagerState('mapping_low_confidence');
      updateQueueUI(); setStatus();
      return;
    }

    const assetKey = stableAssetKey(asset);
    const downloadToken = textSignature(`${state.loadedSignature}|${state.batch?.batchId || ''}|${item.jobId || item.id}|send:${item.sendSequence || 0}|retry:${item.downloadRetryNonce || 0}|${assetKey}`, 'download');

    // Regra de idempotência: o mesmo JOB + asset só pode pedir UM download automático.
    // Se uma execução anterior já emitiu o pedido, nunca cria outro registro no Chrome.
    // O usuário pode liberar uma nova tentativa somente pelo botão de retry, que limpa estes campos.
    if (item.downloadToken === downloadToken && item.downloadRequestIssuedAt && !item.downloadId) {
      setJobFailure(item, 'DOWNLOAD_STATUS_UNKNOWN', 'Já houve uma solicitação de download para este asset, mas o downloadId não pôde ser confirmado. Novo download automático bloqueado para evitar duplicatas.', 'retry');
      liveTracking.delete(item.jobId);
      log(`DOWNLOAD_GUARD — ${item.id}: pedido anterior sem downloadId; duplicata bloqueada.`);
      maybeMarkBatchComplete();
      await persistManagerState('download_guard_unknown');
      updateQueueUI(); setStatus();
      return;
    }

    const claimedBy = assetAssignments.get(assetKey);
    if (claimedBy && claimedBy !== item.jobId) {
      item.mappingGuard = 'ASSET_ALREADY_CLAIMED';
      item.mappingConflictWith = claimedBy;
      setJobFailure(item, 'MAPPING_CONFLICT', `O mesmo asset já foi atribuído ao JOB ${claimedBy}`, 'failed');
      liveTracking.delete(item.jobId);
      if (!entry.assetConflictLogged) {
        entry.assetConflictLogged = true;
        state.mappingConflicts += 1;
        log(`MAPPING_CONFLICT — ${item.id}: o asset já pertence a ${claimedBy}. Download bloqueado.`);
      }
      maybeMarkBatchComplete();
      await persistManagerState('mapping_asset_conflict');
      updateQueueUI(); setStatus();
      return;
    }

    assetAssignments.set(assetKey, item.jobId);
    item.assetKey = assetKey;
    item.mappingGuard = '';
    entry.downloadStarted = true;
    item.status = 'downloading';
    item.downloadToken = downloadToken;
    item.downloadRequestIssuedAt = item.downloadRequestIssuedAt || new Date().toISOString();
    item.downloadAttemptCount = Number(item.downloadAttemptCount || 0) + 1;
    item.resultDetectedAt = item.resultDetectedAt || new Date().toISOString();
    item.assetUrl = asset.url;
    item.assetWidth = asset.width;
    item.assetHeight = asset.height;
    emitManagerLifecycleEvent(item, 'DOWNLOAD_REQUESTED');
    await persistManagerState('download_start'); updateQueueUI();

    try {
      let url = asset.url;
      if (url.startsWith('blob:')) {
        const response = await fetch(url);
        const blob = await response.blob();
        url = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }

      const fallback = `${String(item.slot || item.id).replace(/[^a-z0-9_-]+/gi,'_')}.png`;
      const filename = safeFileName(item.arquivoFinal, fallback);
      item.requestedFile = filename;

      if (state.batch?.appDelivery) {
        let dataUrl = url;
        let contentType = '';
        let assetUrl = '';
        if (!url.startsWith('data:')) {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            const blob = await response.blob();
            contentType = blob.type || '';
            dataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob);
            });
          } catch (_) { dataUrl = ''; assetUrl = url; }
        } else {
          contentType = String(url.match(/^data:([^;,]+)/)?.[1] || '');
        }
        const delivered = await chrome.runtime.sendMessage({ type:'FLOW_BATCH_DELIVER_APP_ASSET', jobId:item.jobId, filename, dataUrl, assetUrl, contentType });
        if (!delivered?.ok) throw new Error(delivered?.error || 'Falha ao entregar asset ao Manager para o app');
        item.downloadId = undefined;
        item.downloadPath = '';
        item.downloadedFile = filename;
        item.status = 'done';
        item.doneAt = new Date().toISOString();
        item.file = filename;
        clearJobFailure(item);
        emitManagerLifecycleEvent(item, 'DONE', { deliveryMode:'APP', appAssetReady:true });
        liveTracking.delete(item.jobId);
        log(`DONE APP — ${item.id} -> ${filename} | asset enviado ao Roteiro sem download em Downloads`);
        maybeMarkBatchComplete();
        await persistManagerState('app_delivery_done'); updateQueueUI(); setStatus();
        return;
      }

      const started = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_DOWNLOAD_URL', url, filename, exactName: true, downloadToken });
      if (!started?.ok) throw new Error(started?.error || 'Falha ao iniciar download');
      item.downloadId = started.downloadId;
      if (started.deduped) log(`DOWNLOAD_GUARD — ${item.id}: reutilizando download #${started.downloadId}; nenhum novo download foi criado.`);
      await persistManagerState('download_id_confirmed');

      const startedAt = Date.now();
      while (Date.now() - startedAt < 45000) {
        const status = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_DOWNLOAD_STATUS', downloadId: started.downloadId });
        if (status?.state === 'complete') {
          const actualBase = downloadedBaseName(status.filename) || filename;
          item.downloadPath = status.filename || '';
          item.downloadedFile = actualBase;
          if (!compatibleDownloadedFileName(filename, actualBase)) {
            setJobFailure(item, 'FILE_NAME_MISMATCH', `Chrome salvou ${actualBase}, mas ARQUIVO_FINAL exige ${filename}`, 'failed');
            entry.downloadStarted = false;
            liveTracking.delete(item.jobId);
            log(`FILE_NAME_MISMATCH — ${item.id}: esperado ${filename}, recebido ${actualBase}; novo download automático bloqueado.`);
            maybeMarkBatchComplete();
            await persistManagerState('filename_mismatch'); updateQueueUI(); setStatus();
            return;
          }

          if (actualBase.toLowerCase() !== filename.toLowerCase()) {
            item.extensionAdjusted = true;
            item.requestedFileOriginal = filename;
            log(`JPG_SUPPORT — ${item.id}: Flow entregou ${actualBase}; aceito no lugar de ${filename}.`);
          }
          item.status = 'done';
          item.doneAt = new Date().toISOString();
          item.file = actualBase;
          clearJobFailure(item);
          emitManagerLifecycleEvent(item, 'DONE');
          liveTracking.delete(item.jobId);
          log(`DONE — ${item.id} -> ${actualBase} | mapa ${item.mappingMethod || 'n/d'} ${item.mappingConfidence || 0}%`);
          maybeMarkBatchComplete();
          await persistManagerState('done'); updateQueueUI(); setStatus();
          return;
        }
        if (status?.state === 'interrupted') throw new Error(status.error || 'Download interrompido');
        await sleep(500);
      }
      throw new Error('Timeout aguardando conclusão do download');
    } catch (error) {
      setJobFailure(item, 'DOWNLOAD_FAILED', String(error?.message || error), 'retry');
      entry.downloadStarted = false;
      liveTracking.delete(item.jobId);
      log(`DOWNLOAD_FAILED — ${item.id}: ${item.error}. Novo download automático bloqueado; use retry manual se necessário.`);
      maybeMarkBatchComplete();
      await persistManagerState('download_failed'); updateQueueUI(); setStatus();
    }
  }

  async function inspectEntry(entry) {
    if (!entry?.item || entry.item.status === 'done') return;
    if (!state.captureArmed) return;
    if (entry.restored && entry.item.status === 'downloading' && entry.item.downloadId && entry.downloadStarted) {
      await resumeExistingDownload(entry);
      if (entry.item.status === 'done' || entry.downloadStarted) return;
    }
    if (!entry.root?.isConnected && !tryBindEntry(entry)) return;
    const failure = rootFailure(entry.root);
    if (failure) {
      setJobFailure(entry.item, failure.errorCode, failure.message);
      liveTracking.delete(entry.item.jobId);
      log(`${failure.errorCode} — ${entry.item.id}`);
      maybeMarkBatchComplete();
      await persistManagerState('generation_failed'); updateQueueUI(); setStatus();
      return;
    }
    const asset = bestImageInRoot(entry.root);
    if (asset && !rootBusy(entry.root)) {
      entry.item.status = 'result_ready'; entry.item.resultDetectedAt = entry.item.resultDetectedAt || new Date().toISOString();
      emitManagerLifecycleEvent(entry.item, 'RESULT_READY');
      await persistManagerState('result_ready'); updateQueueUI();
      await downloadTrackedAsset(entry, asset);
    } else if (entry.root && entry.item.status === 'sent') {
      entry.item.status = 'generating'; updateQueueUI();
    }
  }

  function scheduleTrackingScan() {
    if (trackingScanTimer) return;
    trackingScanTimer = setTimeout(async () => {
      trackingScanTimer = null;
      for (const entry of [...liveTracking.values()]) await inspectEntry(entry);
    }, 180);
  }

  function ensureTrackingObserver() {
    if (trackingObserver) return;
    trackingObserver = new MutationObserver(scheduleTrackingScan);
    trackingObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','srcset','aria-busy','class'] });
    setInterval(scheduleTrackingScan, 1500);
  }

  function registerSentJob(item, generationBaseline = null, restored = false, immediateRoots = []) {
    ensureTrackingObserver();
    const baseline = (generationBaseline instanceof Set || generationBaseline instanceof Map)
      ? generationBaseline
      : (restored ? new Map() : captureGenerationBaseline());
    if (!item.sendSequence) item.sendSequence = ++state.sendSequence;
    else state.sendSequence = Math.max(state.sendSequence, Number(item.sendSequence) || 0);
    const entry = {
      item,
      baseline,
      immediateRoots: Array.isArray(immediateRoots) ? immediateRoots : [],
      root: null,
      downloadStarted: item.status === 'downloading',
      restored,
      managerRecovery: restored && !!state.batch?.managerControlled,
      registeredAt: Date.now()
    };
    liveTracking.set(item.jobId, entry);
    if (restored && state.captureArmed && item.status === 'downloading' && item.downloadId) {
      resumeExistingDownload(entry).catch(() => {});
    }
    if (!restored) tryImmediateBind(entry);
    // Em execução normal, tenta associar o cartão novo imediatamente sem bloquear o disparo seguinte.
    setTimeout(scheduleTrackingScan, restored ? 250 : 80);
    setTimeout(scheduleTrackingScan, restored ? 900 : state.bindingTimeout);
  }

  function buildManagerManifest() {
    const jobs = state.prompts;
    jobs.forEach(syncFailurePolicy);
    const done = jobs.filter(x => x.status === 'done').length;
    const failed = jobs.filter(x => ['failed','retry','limit_reached'].includes(x.status)).length;
    const active = jobs.filter(x => ACTIVE_RESULT_STATUSES.has(x.status)).length;
    const pending = jobs.filter(x => ['pending','assigned','sending'].includes(x.status)).length;
    const retrySame = jobs.filter(x => x.nextAction === 'RETRY_SAME_PROMPT').length;
    const retryDownload = jobs.filter(x => x.nextAction === 'RETRY_DOWNLOAD').length;
    const fallback = jobs.filter(x => x.nextAction === 'FALLBACK_PROMPT').length;
    const otherWorker = jobs.filter(x => x.nextAction === 'OTHER_WORKER').length;
    const manual = jobs.filter(x => ['MANUAL_REVIEW','FIX_INPUT','LOGIN_REQUIRED'].includes(x.nextAction)).length;
    const lifecycle = batchLifecycle();
    const lines = [
      '[CORVO_FLOW_BATCH_RESULT]','VERSION=1.2','',
      `PROJECT_ID=${state.batch?.projectId || ''}`,
      `BATCH_ID=${state.batch?.batchId || ''}`,
      `WORKER=${state.workerId}`,
      `BATCH_STATUS=${lifecycle}`,
      `BATCH_RESULT=${batchResult()}`,
      `COMPLETED_AT=${state.batchCompletedAt || ''}`,'',
      '[TOTAL]',
      `JOBS=${jobs.length}`,
      `DONE=${done}`,
      `FAILED=${failed}`,
      `ACTIVE=${active}`,
      `PENDING=${pending}`,
      `RETRY_SAME_PROMPT=${retrySame}`,
      `RETRY_DOWNLOAD=${retryDownload}`,
      `FALLBACK_REQUIRED=${fallback}`,
      `OTHER_WORKER=${otherWorker}`,
      `MANUAL_REVIEW=${manual}`,
      `MAPPING_CONFLICTS=${state.mappingConflicts || 0}`,'',
    ];

    for (const item of jobs) {
      lines.push(
        `[ID:${item.id}]`,
        `JOB_ID=${item.jobId || ''}`,
        `SLOT=${item.slot || item.id}`,
        `STATUS=${String(item.status || '').toUpperCase()}`,
        `WORKER=${state.workerId}`,
        `ARQUIVO_FINAL=${item.arquivoFinal || ''}`,
        `ARQUIVO=${item.file || item.downloadedFile || ''}`,
        `SEND_SEQUENCE=${item.sendSequence || ''}`,
        `GENERATION_SEQUENCE=${item.generationSequence || ''}`,
        `MAPPING_METHOD=${item.mappingMethod || ''}`,
        `MAPPING_CONFIDENCE=${item.mappingConfidence != null ? item.mappingConfidence : ''}`,
        `MAPPING_GUARD=${item.mappingGuard || ''}`,
        `ASSET_SIZE=${item.assetWidth && item.assetHeight ? `${item.assetWidth}x${item.assetHeight}` : ''}`,
        `SENT_AT=${item.sentAt || ''}`,
        `GENERATION_DETECTED_AT=${item.generationDetectedAt || ''}`,
        `RESULT_DETECTED_AT=${item.resultDetectedAt || ''}`,
        `DONE_AT=${item.doneAt || ''}`,
        `ERROR_CODE=${item.errorCode || ''}`,
        `ERROR_CLASS=${item.errorClass || ''}`,
        `NEXT_ACTION=${item.nextAction || ''}`,
        `RETRY_ALLOWED=${item.retryAllowed ? 'YES' : 'NO'}`,
        `FAILURE_AT=${item.failureAt || ''}`,
        `MOTIVO=${String(item.error || '').replace(/\s+/g,' ').trim()}`,
        ''
      );
    }
    return lines.join('\n');
  }

  function buildFlowErrorsManifest() {
    const errors = state.prompts.filter(item => ['failed','retry','limit_reached'].includes(item.status));
    errors.forEach(syncFailurePolicy);
    const lines = [
      '[CORVO_FLOW_ERRORS]','VERSION=1.0','',
      `PROJECT_ID=${state.batch?.projectId || ''}`,
      `BATCH_ID=${state.batch?.batchId || ''}`,
      `WORKER=${state.workerId}`,'',
      '[TOTAL]',
      `ERRORS=${errors.length}`,
      `RETRY_SAME_PROMPT=${errors.filter(x => x.nextAction === 'RETRY_SAME_PROMPT').length}`,
      `RETRY_DOWNLOAD=${errors.filter(x => x.nextAction === 'RETRY_DOWNLOAD').length}`,
      `FALLBACK_REQUIRED=${errors.filter(x => x.nextAction === 'FALLBACK_PROMPT').length}`,
      `OTHER_WORKER=${errors.filter(x => x.nextAction === 'OTHER_WORKER').length}`,
      `MANUAL_REVIEW=${errors.filter(x => ['MANUAL_REVIEW','FIX_INPUT','LOGIN_REQUIRED'].includes(x.nextAction)).length}`,'',
    ];
    for (const item of errors) {
      lines.push(
        `[ID:${item.id}]`,
        `JOB_ID=${item.jobId || ''}`,
        `SLOT=${item.slot || item.id}`,
        `STATUS=${String(item.status || '').toUpperCase()}`,
        `ERROR_CODE=${item.errorCode || 'UNKNOWN_ERROR'}`,
        `ERROR_CLASS=${item.errorClass || ''}`,
        `NEXT_ACTION=${item.nextAction || ''}`,
        `RETRY_ALLOWED=${item.retryAllowed ? 'YES' : 'NO'}`,
        `TENTATIVA=${item.tentativa || 1}`,
        `ATTEMPTS_WORKER=${item.attempts || 0}`,
        `ARQUIVO_FINAL=${item.arquivoFinal || ''}`,
        `PROMPT_ORIGINAL=${String(item.prompt || '').replace(/\s+/g,' ').trim()}`,
        `MENSAGEM_FLOW=${String(item.error || '').replace(/\s+/g,' ').trim()}`,
        `FAILURE_AT=${item.failureAt || ''}`,
        ''
      );
    }
    return lines.join('\n');
  }

  function splitPromptAroundReference(prompt, reference) {
    const token = `@${reference}`;
    const index = prompt.toLowerCase().indexOf(token.toLowerCase());
    if (index < 0) throw new Error(`Referência ${token} não encontrada no prompt`);
    return {
      prefix: prompt.slice(0, index),
      token: prompt.slice(index, index + token.length),
      suffix: prompt.slice(index + token.length)
    };
  }

  async function waitFor(fn, timeout = state.timeout, step = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(step);
    }
    return null;
  }

  async function attachReference(promptText, reference, runId) {
    assertRunActive(runId);
    const promptEl = await waitFor(findPromptInput);
    assertRunActive(runId);
    if (!promptEl) throw new Error('Campo principal do prompt não encontrado');

    const parts = splitPromptAroundReference(promptText, reference);

    // 1) Digita o prefixo por CDP no campo inferior.
    if (parts.prefix) {
      await typeFastText(promptEl, parts.prefix, true, 220, 14, 30);
      assertRunActive(runId);
      log(`Prefixo inserido rapidamente em blocos: ${parts.prefix}`);
    } else {
      await typeFastText(promptEl, '', true, 220, 14, 30);
      assertRunActive(runId);
    }

    // 2) Envia @ por CDP como rawKeyDown + char + keyUp.
    await sleep(250);
    assertRunActive(runId);
    await typeRealAt(promptEl);
    assertRunActive(runId);
    log('Caractere @ enviado por CDP com evento char real.');

    // 3) Apenas detecta que o painel abriu. Não localiza, não clica e não foca a busca.
    // O próprio Flow deve roubar o foco depois do @.
    const panelOpened = await waitFor(() => {
      const add = findByText('Add to Prompt', 'button, [role="button"]') ||
                  findByText('Adicionar ao prompt', 'button, [role="button"]');
      return add && visible(add) ? add : null;
    }, 7500, 80);
    assertRunActive(runId);
    if (!panelOpened) throw new Error('O painel de referências não abriu após digitar @');

    // 4) Tempo extra para a animação terminar e o Flow transferir internamente o foco.
    log('Painel detectado; aguardando o Flow transferir o foco automaticamente...');
    await sleep(1100);
    assertRunActive(runId);

    // 5) Continua enviando teclas reais para a aba, sem tocar no DOM da busca.
    await typeRealTextOnCurrentFocus(reference, 25, 40);
    assertRunActive(runId);
    log(`Nome enviado ao foco assumido pelo Flow: ${reference}`);

    // 6) Aguarda filtragem e seleciona o resultado correto.
    await sleep(1100);
    const card = await waitFor(() => findExactReferenceCard(reference), 8000, 180);
    assertRunActive(runId);
    if (!card) throw new Error(`Resultado exato da referência ${reference} não encontrado`);

    assertRunActive(runId);
    card.click();
    log(`Referência selecionada: ${reference}`);

    // O Flow possui dois comportamentos possíveis:
    // 1) clicar no resultado apenas abre a prévia e exige "Add to Prompt";
    // 2) clicar no resultado já anexa a imagem como chip e fecha o painel.
    const outcome = await waitFor(() => {
      const currentPrompt = findPromptInput();
      if (isReferenceAttached(reference, currentPrompt)) {
        return { kind: 'attached', promptEl: currentPrompt };
      }
      const add = findAddToPromptButton();
      if (add && visible(add)) return { kind: 'add', button: add };
      return null;
    }, 7000, 100);

    assertRunActive(runId);
    if (!outcome) {
      throw new Error('A referência foi selecionada, mas não apareceu como chip e o botão Add to Prompt não foi encontrado');
    }

    if (outcome.kind === 'add') {
      assertRunActive(runId);
      outcome.button.click();
      log('Add to Prompt acionado.');
      const attached = await waitFor(() => {
        const currentPrompt = findPromptInput();
        return isReferenceAttached(reference, currentPrompt) ? currentPrompt : null;
      }, 7000, 100);
      if (!attached) throw new Error('Add to Prompt foi acionado, mas a referência não apareceu no campo');
    } else {
      log('Referência anexada automaticamente como chip; Add to Prompt não foi necessário.');
    }

    await sleep(350);
    assertRunActive(runId);
    return parts.suffix;
  }

  async function submitPrompt(promptSuffix, reference, item, runId) {
    assertRunActive(runId);
    const promptEl = await waitFor(findPromptInput, 7000);
    assertRunActive(runId);
    if (!promptEl) throw new Error('Campo principal não encontrado após anexar referência');

    await insertRemainingText(promptEl, promptSuffix);
    assertRunActive(runId);
    await sleep(500);
    assertRunActive(runId);

    let button = findGenerateButton(promptEl);
    if (!button) throw new Error('Botão de gerar não encontrado');
    if (button.getAttribute('aria-disabled') === 'true' || button.disabled) {
      throw new Error('Botão de gerar está desabilitado');
    }

    const before = captureFlowState(promptEl, reference);
    const generationBaseline = captureGenerationBaseline();

    for (let attempt = 1; attempt <= 2; attempt++) {
      log(attempt === 1
        ? 'Clicando no botão de gerar com clique real via CDP...'
        : 'Envio ainda não confirmado; tentando clicar novamente no botão de gerar...');

      button = findGenerateButton(findPromptInput() || promptEl);
      if (!button || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') {
        if (attempt === 1) await sleep(700);
        continue;
      }

      assertRunActive(runId);
      await realClickElement(button, 'botão de gerar');
      // Depois que o clique de gerar foi enviado, não abortamos a confirmação do JOB:
      // a geração pode já ter começado e precisa ser registrada como SENT para evitar duplicata.
      const submitted = await waitForFlexibleSubmission(before, promptEl, reference, item, attempt === 1 ? 6000 : 4500);
      if (submitted) {
        log('Envio confirmado por alteração de estado do Flow.');
        return { generationBaseline, immediateRoots: rootsChangedSinceBaseline(generationBaseline) };
      }
      await sleep(800);
    }

    throw new Error('Envio não confirmado após 2 tentativas');
  }

  async function submitPlainPrompt(promptText, item, runId) {
    assertRunActive(runId);
    const promptEl = await waitFor(findPromptInput, 7000);
    assertRunActive(runId);
    if (!promptEl) throw new Error('Campo principal do prompt não encontrado');

    // Caminho rápido: insere o prompt em blocos grandes pelo CDP Input.insertText.
    // Não é paste/clipboard nem atribuição direta de value. Se o Flow não refletir
    // o texto no compositor, fazemos fallback automático para o método antigo.
    await typeFastText(promptEl, promptText, true, 240, 12, 28);
    assertRunActive(runId);
    await sleep(220);
    assertRunActive(runId);

    const fastValue = normalizedPromptContent(findPromptInput() || promptEl);
    const expectedCompact = String(promptText || '').replace(/\s+/g, ' ').trim();
    const actualCompact = String(fastValue || '').replace(/\s+/g, ' ').trim();
    if (!actualCompact || (expectedCompact && !actualCompact.includes(expectedCompact.slice(0, Math.min(120, expectedCompact.length))))) {
      log('Entrada rápida não foi confirmada pelo compositor; usando fallback por teclas reais.');
      await typeRealText(findPromptInput() || promptEl, promptText, true, 3, 7);
      assertRunActive(runId);
    } else {
      log('Prompt completo inserido em blocos rápidos, sem clipboard.');
    }
    await sleep(280);
    assertRunActive(runId);

    let button = findGenerateButton(promptEl);
    if (!button) throw new Error('Botão de gerar não encontrado');
    if (button.getAttribute('aria-disabled') === 'true' || button.disabled) {
      throw new Error('Botão de gerar está desabilitado');
    }

    const before = captureFlowState(promptEl, null);
    const generationBaseline = captureGenerationBaseline();

    for (let attempt = 1; attempt <= 2; attempt++) {
      log(attempt === 1
        ? 'Clicando no botão de gerar sem referência...'
        : 'Envio sem referência ainda não confirmado; tentando novamente...');

      button = findGenerateButton(findPromptInput() || promptEl);
      if (!button || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') {
        if (attempt === 1) await sleep(700);
        continue;
      }

      assertRunActive(runId);
      await realClickElement(button, 'botão de gerar');
      const submitted = await waitForFlexibleSubmission(before, promptEl, null, item, attempt === 1 ? 6000 : 4500);
      if (submitted) {
        log('Envio sem referência confirmado pelo Flow.');
        return { generationBaseline, immediateRoots: rootsChangedSinceBaseline(generationBaseline) };
      }
      await sleep(800);
    }

    throw new Error('Envio sem referência não confirmado após 2 tentativas');
  }

  function visibleErrorText() {
    const bodyText = norm(document.body.innerText);
    return ERROR_WORDS.find(word => bodyText.includes(word)) || null;
  }

  async function processOne(item, { skipInitialClear = false, runId } = {}) {
    if (state.batch?.testMode && item?.testErrorCode && !item.testErrorConsumed && (!item.testErrorProfile || item.testErrorProfile === state.managerProfileId)) {
      item.testErrorConsumed = true;
      const simulated = new Error(`TEST_MODE: falha simulada ${item.testErrorCode} para validar isolamento do JOB ${item.id}`);
      simulated.corvoErrorCode = String(item.testErrorCode).toUpperCase();
      throw simulated;
    }
    assertRunActive(runId);
    if (!skipInitialClear) {
      await clearComposer();
      assertRunActive(runId);
    }

    if (state.mode === 'sem_referencia') {
      item.reference = null;
      var tracking = await submitPlainPrompt(item.prompt, item, runId);
    } else {
      const reference = extractReference(item.prompt);
      item.reference = reference;
      if (!reference) throw new Error('Referência não encontrada no texto');

      const suffix = await attachReference(item.prompt, reference, runId);
      var tracking = await submitPrompt(suffix, reference, item, runId);
    }

    // Não varrer o texto global da página em busca de palavras como
    // "failed"/"error" logo após o envio. O Flow mantém mensagens antigas,
    // avisos de alta demanda e cartões de outras gerações no DOM; isso causava
    // falsos erros antes mesmo da imagem atual começar a processar.
    // Neste ponto, sucesso significa que a solicitação foi realmente enviada
    // e confirmada pelos sinais do compositor/cartão capturados em submitPrompt().
    await sleep(350);
    return tracking || { generationBaseline: captureGenerationBaseline() };
  }

  function safeComposerFailureForLocalRetry(error) {
    const msg = String(error?.message || error || '');
    return /não manteve o foco no campo do prompt|campo do prompt não encontrado para foco|campo principal do prompt não encontrado|campo principal não encontrado após anexar referência/i.test(msg);
  }

  async function runQueue() {
    if (state.running || state.operationLock) return;
    const runId = ++state.runEpoch;
    state.activeRunId = runId;
    state.stopRequested = false;
    state.running = true;
    state.paused = false;
    state.panel?.classList.add('fbl-running-lock');
    setStatus('Preparando execução');

    try {
      await clearComposer();
    } catch (error) {
      state.running = false;
      state.managerStartLastError = `Compositor: ${error.message}`;
      state.managerStartFailureCount += 1;
      state.panel?.classList.remove('fbl-running-lock');
      log(`FILA NÃO INICIADA — ${error.message}`);
      setStatus('Falha ao limpar o compositor');
      return false;
    }

    setStatus('Execução iniciada');

    while (state.index < state.prompts.length && state.running) {
      if (state.paused) {
        await sleep(300);
        continue;
      }

      const item = state.prompts[state.index];
      if (['sent','generating','result_ready','downloading','done','failed','retry','limit_reached'].includes(item.status)) {
        state.index += 1;
        continue;
      }

      state.operationLock = true;
      state.processingIndex = state.index;
      item.status = 'sending';
      clearJobFailure(item);
      item.attempts = (item.attempts || 0) + 1;
      updateQueueUI();
      setStatus(`Processando ${item.id}`);

      let retrySameJobLocally = false;
      try {
        const tracking = await processOne(item, { runId });
        item.status = 'sent';
        item.sentAt = new Date().toISOString();
        item.sendSequence = ++state.sendSequence;
        clearJobFailure(item);
        state.managerStartLastError = '';
        emitManagerLifecycleEvent(item, 'SENT');
        registerSentJob(item, tracking?.generationBaseline, false, tracking?.immediateRoots || []);
        log(`SENT — ${item.id} — prompt confirmado; aguardando geração/asset`);
      } catch (error) {
        if (isStopError(error) || state.activeRunId !== runId || state.stopRequested) {
          item.status = 'pending';
          clearJobFailure(item);
          item.attempts = Math.max(0, (item.attempts || 1) - 1);
          log(`PARADO — ${item.id} não foi enviado e continuará PENDING.`);
          break;
        }
        const classified = classifyOperationalError(error);

        // V4.2.9 — falha de foco/compositor antes de SENT é segura para retry local:
        // nenhum clique de geração foi confirmado e SENT_AT ainda está vazio.
        if (!item.sentAt && safeComposerFailureForLocalRetry(error) && Number(item.attempts || 0) < 3) {
          retrySameJobLocally = true;
          item.status = 'pending';
          clearJobFailure(item);
          state.managerStartLastError = `Composer focus retry ${item.attempts}/3: ${error.message}`;
          state.managerStartFailureCount += 1;
          log(`COMPOSER_FOCUS_RETRY — ${item.id}: tentativa ${item.attempts}/3 falhou antes de SENT; recuperando foco e repetindo o mesmo JOB sem avançar a fila.`);
          try {
            await clearComposer({ silent: true });
          } catch (clearError) {
            log(`COMPOSER_FOCUS_RETRY — limpeza intermediária não confirmou vazio: ${clearError.message}`);
          }
        } else {
          setJobFailure(item, classified.errorCode, error.message, classified.status);
          log(`${classified.errorCode} — ${item.id}: ${error.message}`);

          try {
            await clearComposer({ silent: true });
            log(`Compositor limpo após falha em ${item.id}; seguindo a fila.`);
          } catch (clearError) {
            log(`ERRO DE RECUPERAÇÃO — ${item.id}: ${clearError.message}`);
          }
        }

        if (item.status === 'limit_reached') {
          state.paused = true;
          log('Fila pausada automaticamente porque um limite foi detectado.');
        }
      } finally {
        state.processingIndex = null;
        state.operationLock = false;
      }

      if (retrySameJobLocally && state.running && !state.paused && state.activeRunId === runId && !state.stopRequested) {
        state.results = state.prompts.filter(x => !['pending','assigned','sending'].includes(x.status)).map(serializableJob);
        await persistManagerState('composer_focus_retry');
        updateQueueUI();
        setStatus(`Recuperando foco para ${item.id}`);
        await sleep(650);
        continue;
      }

      state.index += 1;
      state.results = state.prompts.filter(x => !['pending','assigned','sending'].includes(x.status)).map(serializableJob);
      await persistManagerState('queue_progress');

      updateQueueUI();
      setStatus();
      if (state.index < state.prompts.length && state.running && !state.paused) {
        const delay = nextDelay();
        log(`Aguardando ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
      }
    }

    const wasStopped = state.stopRequested || state.activeRunId !== runId;
    if (state.activeRunId === runId) state.activeRunId = null;
    state.running = false;
    if (!wasStopped) state.stopRequested = false;
    state.panel?.classList.remove('fbl-running-lock');
    maybeMarkBatchComplete();
    updateQueueUI();
    setStatus(state.index >= state.prompts.length ? 'Fila finalizada' : (wasStopped ? 'PARADO — HARD STOP ativo' : 'Execução interrompida'));
    return true;
  }

  function buildFullStatusText() {
    return state.prompts.map(item => {
      const cleanPrompt = item.prompt.trim();
      if (['failed','retry','limit_reached','erro','limite'].includes(item.status)) return `${MARKER}${cleanPrompt}`;
      if (item.status === 'done') return `- concluido - ${cleanPrompt}`;
      if (['sent','generating','result_ready','downloading','ok'].includes(item.status)) return `- enviado - ${cleanPrompt}`;
      return cleanPrompt;
    }).join('\n\n');
  }

  function buildMarkedText() {
    return buildFullStatusText();
  }

  function buildErrorsText() {
    return buildFlowErrorsManifest();
  }

  function downloadText(filename, content) {
    chrome.runtime.sendMessage({ type: 'FLOW_BATCH_DOWNLOAD', filename, content });
  }

  function startPicker(type) {
    log(`Calibração: clique no ${type === 'prompt' ? 'campo principal do prompt' : 'botão de gerar'}.`);
    const onMove = event => {
      document.querySelectorAll('.fbl-picker-outline').forEach(el => el.classList.remove('fbl-picker-outline'));
      const el = event.target.closest('textarea, input, [contenteditable="true"], button, [role="button"], [role="textbox"]') || event.target;
      if (!el.closest('#fbl-panel')) el.classList.add('fbl-picker-outline');
    };
    const onClick = event => {
      const el = event.target.closest('textarea, input, [contenteditable="true"], button, [role="button"], [role="textbox"]') || event.target;
      if (el.closest('#fbl-panel')) return;
      event.preventDefault();
      event.stopPropagation();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.querySelectorAll('.fbl-picker-outline').forEach(node => node.classList.remove('fbl-picker-outline'));
      const target = type === 'prompt' ? (normalizePromptElement(el) || el) : el;
      const selector = cssPath(target);
      if (type === 'prompt') state.calibratedPromptSelector = selector;
      else state.calibratedGenerateSelector = selector;
      chrome.storage.local.set({
        flowBatchCalibration: {
          prompt: state.calibratedPromptSelector,
          generate: state.calibratedGenerateSelector
        }
      });
      log(`Calibrado: ${selector}`);
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  }

  async function startOrResumeQueue() {
    const panel = state.panel || createPanel();
    if (!state.prompts.length) {
      log('Carregue um TXT primeiro.');
      setStatus('Nenhum JOB carregado');
      return false;
    }

    if (state.operationLock && !state.running) {
      log('Aguardando a operação anterior reconhecer a parada...');
      const released = await waitFor(() => !state.operationLock, 3500, 50);
      if (!released) {
        setStatus('Ainda finalizando parada anterior');
        return false;
      }
    }
    state.stopRequested = false;

    // Anexa o CDP antes de iniciar. É o mesmo mecanismo do V2.5 original e
    // faz o Chrome exibir o aviso de que a extensão está controlando/depurando
    // o navegador. O alvo continua sendo a aba do Flow mesmo se ela não estiver ativa.
    try {
      const prepared = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB' });
      if (!prepared?.ok) throw new Error(prepared?.error || 'Não foi possível armar a aba do Flow');
      state.captureArmed = true;
      log('Flow armado via Chrome DevTools Protocol. HARD STOP liberado e captura/download armados para esta execução.');
      scheduleTrackingScan();
    } catch (error) {
      state.managerStartLastError = `CDP: ${error.message}`;
      state.managerStartFailureCount += 1;
      log(`FILA NÃO INICIADA — debugger/CDP indisponível: ${error.message}`);
      setStatus('Falha ao preparar o Flow');
      return false;
    }

    state.managerStartLastError = '';
    const fixedSeconds = Math.min(120, Math.max(0.5, Number(panel.querySelector('#fbl-fixed-delay').value) || 3));
    const minSeconds = Math.min(120, Math.max(0.5, Number(panel.querySelector('#fbl-min').value) || 2));
    const maxSeconds = Math.min(120, Math.max(minSeconds, Number(panel.querySelector('#fbl-max').value) || 4));
    state.fixedDelay = Math.round(fixedSeconds * 1000);
    state.minDelay = Math.round(minSeconds * 1000);
    state.maxDelay = Math.round(maxSeconds * 1000);
    await chrome.storage.local.set({
      flowBatchDelaySettings: {
        mode: state.delayMode, fixedSeconds, minSeconds, maxSeconds
      }
    });
    if (state.delayMode === 'fixed') {
      log(`Intervalo configurado: fixo de ${fixedSeconds.toFixed(1)}s.`);
    } else {
      log(`Intervalo configurado: aleatório entre ${minSeconds.toFixed(1)}s e ${maxSeconds.toFixed(1)}s.`);
    }

    if (state.running && state.paused) {
      try {
        await clearComposer();
        state.paused = false;
        log('Compositor limpo e fila retomada.');
        return true;
      } catch (error) {
        log(`Não foi possível retomar: ${error.message}`);
        return false;
      }
    }

    runQueue();
    return true;
  }

  async function hardStopQueue() {
    // Primeiro trava o estado local. Nada novo pode sair desta instância.
    state.stopRequested = true;
    state.running = false;
    state.paused = false;
    state.captureArmed = false;
    state.runEpoch += 1;
    state.activeRunId = null;
    log('HARD STOP solicitado — bloqueando fila e cortando o canal CDP desta aba...');

    // Depois derruba o atuador no service worker. Mesmo que alguma Promise antiga
    // continue viva, TYPE/CLICK/CLEAR passam a ser recusados no nível mais baixo.
    try {
      const stopped = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_HARD_STOP_TAB' });
      if (!stopped?.ok) throw new Error(stopped?.error || 'Falha no HARD STOP');
      log('HARD STOP confirmado — debugger destacado e novos TYPE/CLICK bloqueados.');
    } catch (error) {
      log(`ERRO NO HARD STOP: ${error.message}`);
    }

    // Se ainda estava digitando o item atual, ele deve permanecer retomável.
    if (Number.isInteger(state.processingIndex)) {
      const current = state.prompts[state.processingIndex];
      if (current && current.status === 'sending') {
        current.status = 'pending';
        current.error = '';
        current.errorCode = '';
        current.attempts = Math.max(0, (current.attempts || 1) - 1);
      }
    }

    updateQueueUI();
    setStatus('PARADO — HARD STOP ativo');
    try { await persistManagerState('hard_stop'); } catch (_) {}
    return true;
  }

  function createPanel() {
    if (document.getElementById('fbl-panel')) return document.getElementById('fbl-panel');
    const panel = document.createElement('section');
    panel.id = 'fbl-panel';
    panel.innerHTML = `
      <header><h2>Corvo Flow Worker</h2><button id="fbl-close" title="Fechar">×</button></header>
      <div class="fbl-body">
        <label>Arquivo TXT</label>
        <input id="fbl-file" type="file" accept=".txt,text/plain" />

        <label>Modo de envio</label>
        <div class="fbl-modes">
          <button data-mode="sem_referencia" class="active">Sem ref</button>
          <button data-mode="referencia">Referência</button>
          <button data-mode="auxiliar">Auxiliar</button>
          <button data-mode="automatico">Auto</button>
        </div>
        <div class="fbl-note">Sem ref envia apenas o texto do prompt, sem procurar @scene ou @vasty.</div>

        <div class="fbl-row">
          <div><label>Referência fixa</label><input id="fbl-fixed-ref" type="text" value="@vasty" /></div>
          <div><label>Prefixo auxiliar</label><input id="fbl-scene-prefix" type="text" value="@scene" /></div>
        </div>

        <label>Intervalo entre gerações</label>
        <div class="fbl-delay-modes">
          <button data-delay-mode="fixed">Fixo</button>
          <button data-delay-mode="random" class="active">Aleatório</button>
        </div>

        <div id="fbl-fixed-delay-wrap" style="display:none">
          <label>Delay fixo (segundos)</label>
          <input id="fbl-fixed-delay" type="number" min="0.5" max="120" step="0.5" value="3" />
        </div>

        <div id="fbl-random-delay-wrap" class="fbl-row">
          <div><label>Delay mínimo (s)</label><input id="fbl-min" type="number" min="0.5" max="120" step="0.5" value="2" /></div>
          <div><label>Delay máximo (s)</label><input id="fbl-max" type="number" min="0.5" max="120" step="0.5" value="4" /></div>
        </div>
        <div class="fbl-note">O intervalo começa somente depois que o Flow confirma o envio atual.</div>

        <label>Calibração opcional</label>
        <div class="fbl-row">
          <button id="fbl-cal-prompt">Campo do prompt</button>
          <button id="fbl-cal-generate">Botão gerar</button>
        </div>
        <div class="fbl-note">Use a calibração apenas se a detecção automática falhar.</div>

        <div class="fbl-actions">
          <button id="fbl-start" class="primary">Iniciar</button>
          <button id="fbl-pause">Pausar</button>
          <button id="fbl-stop" class="danger">Parar</button>
        </div>

        <div class="fbl-row" style="margin-top:8px">
          <button id="fbl-marked">Exportar TXT completo</button>
          <button id="fbl-errors">Exportar somente erros</button>
          <button id="fbl-manifest">Manifesto Manager</button>
        </div>

        <div id="fbl-status" class="fbl-status">Nenhum arquivo carregado.</div>
        <label>Fila visual</label>
        <div class="fbl-queue-filters"><button data-filter="todos" class="active">Todos</button><button data-filter="pending">Pendentes</button><button data-filter="sent">Enviados</button><button data-filter="generating">Gerando</button><button data-filter="done">Done</button><button data-filter="failed">Erros</button></div>
        <div id="fbl-queue" class="fbl-queue"></div>
        <div id="fbl-log" class="fbl-log"></div>
        <div class="fbl-note">V3.2: falha de um JOB não para o lote. Retry técnico atua somente no ID afetado; erro de prompt vai para Fallback; erro de download tenta reutilizar o asset existente.</div>
      </div>`;
    document.documentElement.appendChild(panel);
    state.panel = panel;

    panel.querySelector('#fbl-close').onclick = () => panel.style.display = 'none';
    panel.querySelectorAll('[data-mode]').forEach(button => {
      button.onclick = () => {
        panel.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        state.mode = button.dataset.mode;
      };
    });

    const applyDelayModeUI = mode => {
      state.delayMode = mode === 'fixed' ? 'fixed' : 'random';
      panel.querySelectorAll('[data-delay-mode]').forEach(button => {
        button.classList.toggle('active', button.dataset.delayMode === state.delayMode);
      });
      panel.querySelector('#fbl-fixed-delay-wrap').style.display = state.delayMode === 'fixed' ? 'block' : 'none';
      panel.querySelector('#fbl-random-delay-wrap').style.display = state.delayMode === 'random' ? 'grid' : 'none';
    };

    const readAndSaveDelaySettings = async () => {
      const fixedSeconds = Math.min(120, Math.max(0.5, Number(panel.querySelector('#fbl-fixed-delay').value) || 3));
      const minSeconds = Math.min(120, Math.max(0.5, Number(panel.querySelector('#fbl-min').value) || 2));
      const maxSeconds = Math.min(120, Math.max(minSeconds, Number(panel.querySelector('#fbl-max').value) || 4));

      panel.querySelector('#fbl-fixed-delay').value = String(fixedSeconds);
      panel.querySelector('#fbl-min').value = String(minSeconds);
      panel.querySelector('#fbl-max').value = String(maxSeconds);

      state.fixedDelay = Math.round(fixedSeconds * 1000);
      state.minDelay = Math.round(minSeconds * 1000);
      state.maxDelay = Math.round(maxSeconds * 1000);

      await chrome.storage.local.set({
        flowBatchDelaySettings: {
          mode: state.delayMode,
          fixedSeconds,
          minSeconds,
          maxSeconds
        }
      });
    };

    panel.querySelectorAll('[data-delay-mode]').forEach(button => {
      button.onclick = async () => {
        applyDelayModeUI(button.dataset.delayMode);
        await readAndSaveDelaySettings();
      };
    });

    ['#fbl-fixed-delay', '#fbl-min', '#fbl-max'].forEach(selector => {
      panel.querySelector(selector).addEventListener('change', readAndSaveDelaySettings);
    });

    panel.querySelector('#fbl-file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      state.originalText = await file.text();
      state.batch.sourceName = file.name || 'prompts.txt';
      state.loadedSignature = textSignature(state.originalText, state.batch.sourceName);
      state.running = false;
      state.paused = false;
      liveTracking.clear();
      assetAssignments.clear();
      state.sendSequence = 0; state.batchCompletedAt = ''; state.mappingConflicts = 0; state.failureSequence = 0;
      state.prompts = parsePrompts(state.originalText);
      validateLoadedJobs();
      maybeMarkBatchComplete();
      state.batch.sourceName = file.name || 'prompts.txt';
      state.results = [];
      state.index = 0;
      setStatus(`${state.prompts.length} prompts carregados`);
      updateQueueUI();
      log(`Arquivo carregado: ${file.name} — ${state.prompts.length} JOBs${state.batch.structured ? ' estruturados' : ' legados'}.`);
      await persistManagerState('load_file');
    });

    panel.querySelector('#fbl-start').onclick = startOrResumeQueue;
    panel.querySelector('#fbl-pause').onclick = () => {
      state.paused = !state.paused;
      log(state.paused ? 'Pausado.' : 'Retomado.');
    };
    panel.querySelector('#fbl-stop').onclick = async () => {
      if (!state.running && !state.operationLock && state.stopRequested) {
        log('HARD STOP já está ativo.');
        return;
      }
      await hardStopQueue();
    };
    panel.querySelector('#fbl-marked').onclick = () => downloadText('prompts_status_completo.txt', buildFullStatusText());
    panel.querySelector('#fbl-errors').onclick = () => downloadText('corvo_flow_errors.txt', buildErrorsText());
    panel.querySelector('#fbl-manifest').onclick = () => downloadText('corvo_flow_batch_result.txt', buildManagerManifest());
    panel.querySelector('#fbl-cal-prompt').onclick = () => startPicker('prompt');
    panel.querySelector('#fbl-cal-generate').onclick = () => startPicker('generate');


    panel.querySelectorAll('[data-filter]').forEach(button => {
      button.onclick = () => {
        panel.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        const filter = button.dataset.filter;
        panel.querySelectorAll('.fbl-queue-item').forEach(row => {
          const show = filter === 'todos' || row.classList.contains(`status-${filter}`) || (filter === 'failed' && (row.classList.contains('status-retry') || row.classList.contains('status-limit_reached')));
          row.style.display = show ? 'block' : 'none';
        });
      };
    });

    chrome.storage.local.get(['flowBatchCalibration', 'flowBatchDelaySettings'], data => {
      state.calibratedPromptSelector = data.flowBatchCalibration?.prompt || null;
      state.calibratedGenerateSelector = data.flowBatchCalibration?.generate || null;
      if (state.calibratedPromptSelector || state.calibratedGenerateSelector) log('Calibração salva carregada.');

      const saved = data.flowBatchDelaySettings;
      if (saved) {
        const mode = saved.mode === 'fixed' ? 'fixed' : 'random';
        const fixedSeconds = Math.min(120, Math.max(0.5, Number(saved.fixedSeconds) || 3));
        const minSeconds = Math.min(120, Math.max(0.5, Number(saved.minSeconds) || 2));
        const maxSeconds = Math.min(120, Math.max(minSeconds, Number(saved.maxSeconds) || 4));
        panel.querySelector('#fbl-fixed-delay').value = String(fixedSeconds);
        panel.querySelector('#fbl-min').value = String(minSeconds);
        panel.querySelector('#fbl-max').value = String(maxSeconds);
        state.fixedDelay = Math.round(fixedSeconds * 1000);
        state.minDelay = Math.round(minSeconds * 1000);
        state.maxDelay = Math.round(maxSeconds * 1000);
        applyDelayModeUI(mode);
        log(mode === 'fixed'
          ? `Delay salvo carregado: ${fixedSeconds.toFixed(1)}s fixos.`
          : `Delay salvo carregado: ${minSeconds.toFixed(1)}–${maxSeconds.toFixed(1)}s aleatórios.`);
      } else {
        applyDelayModeUI('random');
      }
    });

    return panel;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'FLOW_BATCH_TOGGLE_PANEL') return;
    const panel = createPanel();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // API remota usada pelo Side Panel nativo.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith('FLOW_BATCH_REMOTE_')) return;
    const panel = createPanel();

    const snapshot = () => {
      const done = state.prompts.filter(x => x.status === 'done').length;
      const active = state.prompts.filter(x => ['sent','generating','result_ready','downloading'].includes(x.status)).length;
      const errors = state.prompts.filter(x => ['failed','retry','limit_reached'].includes(x.status)).length;
      const pending = state.prompts.filter(x => ['pending','assigned','sending'].includes(x.status)).length;
      const lifecycle = batchLifecycle();
      const statusText = state.prompts.length
        ? `Batch: ${lifecycle}\nItem: ${Math.min(state.index + 1, state.prompts.length)}/${state.prompts.length}\nDONE: ${done} | Ativos: ${active} | Pendentes: ${pending} | Erros: ${errors}${state.mappingConflicts ? ` | Conflitos: ${state.mappingConflicts}` : ''}`
        : 'Nenhum arquivo carregado.';
      return ({
      ok: true,
      protocol: '4.2.9',
      running: state.running,
      paused: state.paused,
      captureArmed: state.captureArmed,
      index: state.index,
      total: state.prompts.length,
      loadedSignature: state.loadedSignature || '',
      batch: state.batch, workerId: state.workerId, managerProfileId: state.managerProfileId || state.batch?.managerProfileId || '', managerAssignmentId: state.batch?.managerAssignmentId || '', managerControlled: !!state.batch?.managerControlled, managerConnected: !!state.managerConnected,
      batchStatus: lifecycle, batchCompletedAt: state.batchCompletedAt || '', mappingConflicts: state.mappingConflicts || 0, manifestReady: lifecycle === 'COMPLETE',
      mode: state.mode,
      delayMode: state.delayMode,
      fixedDelay: state.fixedDelay,
      minDelay: state.minDelay,
      maxDelay: state.maxDelay,
      statusText,
      logText: panel.querySelector('#fbl-log')?.textContent || '',
      prompts: state.prompts.map((item, index) => ({
        index, id: item.id, jobId: item.jobId, slot: item.slot, arquivoFinal: item.arquivoFinal, prompt: item.prompt, reference: item.reference,
        status: item.status || 'pending', error: item.error || '', errorCode: item.errorCode || '', attempts: item.attempts || 0,
        sendSequence: item.sendSequence || 0, generationSequence: item.generationSequence || 0,
        mappingMethod: item.mappingMethod || '', mappingConfidence: item.mappingConfidence ?? null, mappingGuard: item.mappingGuard || '', errorClass: item.errorClass || '', nextAction: item.nextAction || '', retryAllowed: !!item.retryAllowed,
        file: item.file || item.downloadedFile || '', assetWidth: item.assetWidth || 0, assetHeight: item.assetHeight || 0
      }))
      });
    };

    (async () => {
      if (message.type === 'FLOW_BATCH_REMOTE_HELLO') {
        return { ok: true, protocol: '4.2.9', workerId: state.workerId };
      }
      await restorePromise;
      switch (message.type) {
        case 'FLOW_BATCH_REMOTE_GET_STATE':
          return snapshot();
        case 'FLOW_BATCH_REMOTE_GET_MANIFEST':
          return { ...snapshot(), manifest: buildManagerManifest() };
        case 'FLOW_BATCH_REMOTE_LOAD_TEXT': {
          state.originalText = String(message.text || '');
          state.batch.sourceName = message.name || 'prompts.txt';
          state.loadedSignature = textSignature(state.originalText, state.batch.sourceName);
          state.running = false;
          state.paused = false;
          state.captureArmed = false;
          liveTracking.clear();
          assetAssignments.clear();
          state.sendSequence = 0; state.batchCompletedAt = ''; state.mappingConflicts = 0; state.failureSequence = 0;
          state.prompts = parsePrompts(state.originalText);
          validateLoadedJobs();
          maybeMarkBatchComplete();
          state.batch.sourceName = message.name || 'prompts.txt';
          state.results = [];
          state.index = 0;
          if (!state.prompts.length) {
            setStatus('Nenhum prompt válido encontrado');
            log(`TXT recebido pelo Side Panel, mas nenhum JOB válido foi encontrado: ${state.batch.sourceName}.`);
            return { ...snapshot(), ok: false, error: 'Nenhum prompt válido encontrado no TXT' };
          }
          setStatus(`${state.prompts.length} prompts carregados`);
          updateQueueUI();
          log(`Arquivo carregado pelo Side Panel: ${state.batch.sourceName} — ${state.prompts.length} JOBs.`);
          await persistManagerState('remote_load');
          return snapshot();
        }
        case 'FLOW_BATCH_REMOTE_SET_MODE': {
          const mode = ['sem_referencia','referencia','auxiliar','automatico'].includes(message.mode) ? message.mode : 'sem_referencia';
          state.mode = mode;
          panel.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
          if (message.fixedRef != null) panel.querySelector('#fbl-fixed-ref').value = message.fixedRef;
          if (message.scenePrefix != null) panel.querySelector('#fbl-scene-prefix').value = message.scenePrefix;
          return snapshot();
        }
        case 'FLOW_BATCH_REMOTE_SET_DELAY': {
          state.delayMode = message.delayMode === 'fixed' ? 'fixed' : 'random';
          const fixed = Math.max(.5, Number(message.fixedSeconds)||3);
          const min = Math.max(.5, Number(message.minSeconds)||2);
          const max = Math.max(min, Number(message.maxSeconds)||4);
          state.fixedDelay = Math.round(fixed*1000); state.minDelay = Math.round(min*1000); state.maxDelay = Math.round(max*1000);
          panel.querySelector('#fbl-fixed-delay').value = fixed;
          panel.querySelector('#fbl-min').value = min;
          panel.querySelector('#fbl-max').value = max;
          panel.querySelectorAll('[data-delay-mode]').forEach(b => b.classList.toggle('active', b.dataset.delayMode === state.delayMode));
          await chrome.storage.local.set({flowBatchDelaySettings:{mode:state.delayMode,fixedSeconds:fixed,minSeconds:min,maxSeconds:max}});
          return snapshot();
        }
        case 'FLOW_BATCH_REMOTE_START': {
          // Hotfix: o START carrega novamente o TXT enviado pelo Side Panel se
          // o estado remoto estiver vazio/desatualizado. Assim a fila visual e
          // a fila realmente executada nunca ficam em instâncias diferentes.
          const incomingText = String(message.text || '');
          const incomingName = message.name || state.batch.sourceName || 'prompts.txt';
          const incomingSignature = incomingText ? textSignature(incomingText, incomingName) : '';
          if (incomingText && (!state.prompts.length || state.loadedSignature !== incomingSignature)) {
            state.originalText = incomingText;
            state.batch.sourceName = incomingName;
            state.loadedSignature = incomingSignature;
            state.running = false;
            state.paused = false;
            state.captureArmed = false;
            liveTracking.clear();
            assetAssignments.clear();
            state.sendSequence = 0; state.batchCompletedAt = ''; state.mappingConflicts = 0; state.failureSequence = 0;
            state.prompts = parsePrompts(state.originalText);
            validateLoadedJobs();
            maybeMarkBatchComplete();
            state.results = [];
            state.index = 0;
            updateQueueUI();
            setStatus(`${state.prompts.length} prompts carregados no START`);
            log(`START sincronizou ${state.prompts.length} JOBs de ${incomingName}.`);
            await persistManagerState('start_sync_load');
          }
          await startOrResumeQueue();
          return snapshot();
        }
        // V3.1.3: comandos remotos não dependem mais de .click() em botões do painel
        // injetado dentro do Flow. O Google pode reconstruir partes do DOM e deixar
        // o container existente sem um desses botões, causando `null.click()`.
        // O Side Panel agora chama diretamente a função correspondente no Worker.
        case 'FLOW_BATCH_REMOTE_PAUSE':
          state.paused = !state.paused;
          log(state.paused ? 'Pausado.' : 'Retomado.');
          await persistManagerState('remote_pause_toggle');
          return snapshot();
        case 'FLOW_BATCH_REMOTE_STOP': await hardStopQueue(); return snapshot();
        case 'FLOW_BATCH_REMOTE_CAL_PROMPT': startPicker('prompt'); return snapshot();
        case 'FLOW_BATCH_REMOTE_CAL_GENERATE': startPicker('generate'); return snapshot();
        case 'FLOW_BATCH_REMOTE_RETRY': await retryItem(Number(message.index)); return snapshot();
        case 'FLOW_BATCH_REMOTE_EXPORT_FULL':
          downloadText('prompts_status_completo.txt', buildFullStatusText());
          log('Exportação solicitada: TXT completo.');
          return snapshot();
        case 'FLOW_BATCH_REMOTE_EXPORT_ERRORS':
          downloadText('corvo_flow_errors.txt', buildErrorsText());
          log('Exportação solicitada: manifesto estruturado somente de erros.');
          return snapshot();
        case 'FLOW_BATCH_REMOTE_EXPORT_MANIFEST': {
          const manifest = buildManagerManifest();
          await chrome.storage.local.set({ corvoFlowLastManifest: manifest });
          downloadText('corvo_flow_batch_result.txt', manifest);
          log('Exportação solicitada: manifesto Manager V1.2.');
          return { ...snapshot(), manifest };
        }
        default: return {ok:false,error:'Comando desconhecido'};
      }
    })().then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message||err)}));
    return true;
  });


  // -------------------------------------------------------------------------
  // V4.0 — Worker gerenciado pelo Flow Manager local.
  // O content script faz o heartbeat; o service worker realiza o fetch localhost.
  // Isto mantém cada Chrome Profile independente, mas coordenado pela fila central.
  // -------------------------------------------------------------------------
  let managerTickBusy = false;
  let managerTickTimer = null;
  let managerWorkspaceBusy = false;
  let managerWorkspaceRetryAt = 0;
  let managerResultRecoveryBusy = false;
  let managerResultRecoveryLastLogAt = 0;

  function managerWorkerSnapshot() {
    return {
      workerId: state.workerId,
      managerProfileId: state.managerProfileId || state.batch?.managerProfileId || '',
      managerAssignmentId: state.batch?.managerAssignmentId || '',
      workspace: workspaceSnapshot(),
      running: state.running,
      paused: state.paused,
      captureArmed: state.captureArmed,
      trackingCount: liveTracking.size,
      managerHold: state.managerHold,
      clientErrorRecovery: {
        active: !!state.clientErrorRecoveryActive,
        detectedAt: state.clientErrorDetectedAt || '',
        reloadRequestedAt: state.clientErrorReloadRequestedAt || '',
        message: state.clientErrorLastMessage || ''
      },
      batchStatus: batchLifecycle(),
      batch: state.batch,
      flowLimitMessage: state.batch?.managerAssignmentId ? detectLimitMessage() : '',
      startHealth: {
        assignmentId: state.batch?.managerAssignmentId || '',
        lastAttemptAt: state.managerStartLastAttemptAt || '',
        lastError: state.managerStartLastError || '',
        failureCount: Number(state.managerStartFailureCount || 0),
        forceStartCount: Number(state.managerForceStartCount || 0),
        promptDetected: !!findPromptInput(),
        operationLock: !!state.operationLock,
        paused: !!state.paused,
        managerHold: !!state.managerHold
      },
      prompts: state.prompts.map(item => ({
        jobId: item.jobId, id: item.id, slot: item.slot, status: item.status || 'pending',
        error: item.error || '', errorCode: item.errorCode || '', errorClass: item.errorClass || '', nextAction: item.nextAction || '',
        file: item.file || item.downloadedFile || '', sendSequence: item.sendSequence || 0, generationSequence: item.generationSequence || 0,
        mappingMethod: item.mappingMethod || '', mappingConfidence: item.mappingConfidence ?? null,
        sentAt: item.sentAt || '', generationDetectedAt: item.generationDetectedAt || '', resultDetectedAt: item.resultDetectedAt || '',
        downloadRequestIssuedAt: item.downloadRequestIssuedAt || '', doneAt: item.doneAt || '', failureAt: item.failureAt || '',
        assetWidth: item.assetWidth || 0, assetHeight: item.assetHeight || 0
      }))
    };
  }

  async function resetManagerLocalAssignment(expectedAssignmentId = '') {
    if (expectedAssignmentId && state.batch?.managerAssignmentId && state.batch.managerAssignmentId !== expectedAssignmentId) return false;
    const active = state.prompts.some(item => ['sending','sent','generating','result_ready','downloading'].includes(item.status));
    if (state.running || state.operationLock || active) return false;
    liveTracking.clear(); assetAssignments.clear();
    state.prompts = []; state.results = []; state.originalText = ''; state.index = 0;
    state.running = false; state.paused = false; state.captureArmed = false; state.stopRequested = false;
    state.sendSequence = 0; state.batchCompletedAt = ''; state.mappingConflicts = 0; state.failureSequence = 0;
    state.loadedSignature = '';
    state.batch = { version:'1.0', projectId:'', batchId:'', sourceName:'', structured:false, testMode:false, managerControlled:false, managerAssignmentId:'', managerProfileId:state.managerProfileId || '' };
    state.workspaceReady = flowWorkspaceReady();
    state.workspaceStatus = state.workspaceReady ? 'PROJECT_READY' : (!!findNewProjectButton() ? 'FLOW_HOME' : 'WAITING_FLOW_UI');
    state.workspaceLastError = '';
    updateQueueUI(); setStatus('Worker disponível para o Manager');
    await persistManagerState('manager_reset_local');
    return true;
  }

  async function startManagerAssignment(command, binding) {
    if (!command?.text || !command?.assignmentId) return false;
    if (state.running || state.operationLock) return false;
    if (state.batch?.managerAssignmentId === command.assignmentId && state.prompts.length) {
      state.paused = false;
      state.managerHold = false;
      state.stopRequested = false;
      state.managerStartLastAttemptAt = new Date().toISOString();
      return maybeStartManagedAssignment();
    }

    state.managerProfileId = binding?.profileId || state.managerProfileId || '';
    if (state.managerProfileId) state.workerId = `FLOW_WORKER_${state.managerProfileId}`;
    state.originalText = String(command.text || '');
    state.batch.sourceName = command.name || 'manager_batch.txt';
    state.loadedSignature = textSignature(state.originalText, state.batch.sourceName);
    state.running = false; state.paused = false; state.captureArmed = false; state.stopRequested = false; state.managerHold = false;
    state.managerStartLastAttemptAt = new Date().toISOString(); state.managerStartLastError = ''; state.managerStartFailureCount = 0;
    liveTracking.clear(); assetAssignments.clear();
    state.sendSequence = 0; state.batchCompletedAt = ''; state.mappingConflicts = 0; state.failureSequence = 0;
    state.prompts = parsePrompts(state.originalText);
    validateLoadedJobs();
    state.sendSequence = Math.max(0, ...state.prompts.map(item => Number(item.sendSequence) || 0));
    state.results = state.prompts.filter(x => ACTIVE_RESULT_STATUSES.has(x.status)).map(serializableJob);
    state.index = 0;
    updateQueueUI();
    log(`MANAGER ASSIGN — ${command.assignmentId} — ${state.prompts.length} JOB(s) recebidos por ${state.managerProfileId}.`);
    setStatus(`Manager: ${state.prompts.length} JOB(s) atribuídos`);
    await persistManagerState('manager_assignment_received');
    return maybeStartManagedAssignment();
  }

  async function prepareManagedWorkspace(reason = '') {
    if (state.running || state.operationLock || state.paused || state.managerHold) return false;
    if (flowWorkspaceReady()) {
      state.workspaceReady = true;
      state.workspaceStatus = 'PROJECT_READY';
      state.workspaceLastError = '';
      return true;
    }
    if (managerWorkspaceBusy || Date.now() < managerWorkspaceRetryAt) return false;

    managerWorkspaceBusy = true;
    try {
      if (reason) log(`MANAGER PREFLIGHT — preparando projeto antes da demanda (${reason}).`);
      const ready = await ensureFlowGenerationWorkspace();
      if (!ready) {
        managerWorkspaceRetryAt = Date.now() + 4500;
        await persistManagerState('manager_workspace_preflight_wait');
        return false;
      }
      managerWorkspaceRetryAt = 0;
      await persistManagerState('manager_workspace_preflight_ready');
      return true;
    } finally {
      managerWorkspaceBusy = false;
    }
  }

  async function maybeStartManagedAssignment(force = false) {
    if (managerWorkspaceBusy || state.running) return false;
    if (state.operationLock) {
      state.managerStartLastError = 'operationLock ativo antes do início';
      return false;
    }
    if (state.paused && !force) { state.managerStartLastError = 'Worker pausado antes do início'; return false; }
    if (state.managerHold && !force) { state.managerStartLastError = 'Manager HOLD antes do início'; return false; }
    if (!state.batch?.managerControlled || !state.batch?.managerAssignmentId || !state.prompts.length) return false;
    const hasPending = state.prompts.some(item => ['pending','assigned'].includes(item.status || 'pending'));
    if (!hasPending) return false;
    if (!force && Date.now() < managerWorkspaceRetryAt) return false;

    state.managerStartLastAttemptAt = new Date().toISOString();
    if (force) {
      state.paused = false;
      state.managerHold = false;
      state.stopRequested = false;
      managerWorkspaceRetryAt = 0;
    }
    const ready = await prepareManagedWorkspace(force ? 'assignment_force_start' : 'assignment_ready_to_start');
    if (!ready) {
      state.managerStartLastError = `Workspace ainda não pronto (${state.workspaceStatus || 'UNKNOWN'})`;
      state.managerStartFailureCount += 1;
      return false;
    }
    const started = await startOrResumeQueue();
    if (!started && !state.running) {
      state.managerStartFailureCount += 1;
      if (!state.managerStartLastError) state.managerStartLastError = 'startOrResumeQueue não iniciou a fila';
    }
    return !!started;
  }


  // V4.1.4 — RESULT TRACKER KEEPALIVE
  // Em modo Manager, o envio dos prompts e o acompanhamento dos resultados são
  // duas fases independentes. Se o Flow navegar/reidratar o projeto, o content
  // script pode restaurar o checkpoint com captureArmed=false. Isso não deve
  // deixar JOBs eternamente RUNNING. Enquanto houver JOBs já enviados, o Worker
  // rearma o tracker e reconstrói os vínculos de acompanhamento automaticamente.
  async function ensureManagedResultTracking(reason = '') {
    if (managerResultRecoveryBusy || state.managerHold) return false;
    if (!state.batch?.managerControlled || !state.batch?.managerAssignmentId) return false;
    const active = state.prompts.filter(item => ACTIVE_RESULT_STATUSES.has(item.status));
    if (!active.length) return false;

    managerResultRecoveryBusy = true;
    try {
      if (!state.captureArmed) {
        const armed = await chrome.runtime.sendMessage({ type: 'FLOW_BATCH_ARM_TAB' });
        if (!armed?.ok) throw new Error(armed?.error || 'Não foi possível rearmar o rastreador de resultados');
        state.captureArmed = true;
        log(`MANAGER RESULT TRACKER — captura/download rearmados${reason ? ` (${reason})` : ''}.`);
      }

      let rebuilt = 0;
      for (const item of active) {
        if (!item?.jobId || liveTracking.has(item.jobId)) continue;
        // Baseline vazio de propósito: após reidratação precisamos considerar os
        // cartões já presentes no projeto. O método manager_recovery_fifo mantém
        // a mesma proteção de ordem usada no lote validado 8/8.
        registerSentJob(item, new Map(), true, []);
        rebuilt += 1;
      }
      if (rebuilt) {
        const now = Date.now();
        if (now - managerResultRecoveryLastLogAt > 2500) {
          log(`MANAGER RESULT RECOVERY — ${rebuilt} JOB(s) reanexados ao observador de geração/asset.`);
          managerResultRecoveryLastLogAt = now;
        }
        await persistManagerState('manager_result_tracking_recovered');
      }
      scheduleTrackingScan();
      return true;
    } catch (error) {
      state.workspaceLastError = `RESULT_TRACKER: ${String(error?.message || error)}`;
      const now = Date.now();
      if (now - managerResultRecoveryLastLogAt > 5000) {
        log(`MANAGER RESULT TRACKER — falha ao rearmar: ${error.message}`);
        managerResultRecoveryLastLogAt = now;
      }
      return false;
    } finally {
      managerResultRecoveryBusy = false;
    }
  }

  async function flowManagerTick() {
    if (managerTickBusy) return;
    managerTickBusy = true;
    try {
      const response = await chrome.runtime.sendMessage({ type:'FLOW_MANAGER_TICK', workerState: managerWorkerSnapshot() });
      if (!response?.managed) { state.managerConnected = false; return; }
      state.managerConnected = !!response.ok;
      state.managerLastTickAt = new Date().toISOString();
      if (response.binding?.profileId) {
        state.managerProfileId = response.binding.profileId;
        state.workerId = `FLOW_WORKER_${state.managerProfileId}`;
      }
      if (!response.ok) return;
      if (detectFlowClientErrorPage()) {
        await recoverFlowClientError('manager_heartbeat');
        return;
      }
      if (Array.isArray(response.limitPhrases)) managerLimitPhrases = response.limitPhrases.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40);
      const command = response.command;
      if (command) {
        if (command.type === 'START_BATCH') {
          await startManagerAssignment(command, response.binding);
        } else if (command.type === 'PREPARE_WORKSPACE') {
          const ready = await prepareManagedWorkspace(command.reason || 'manager_preflight');
          if (ready) {
            log('MANAGER PREFLIGHT — PROJECT_READY confirmado; Worker pronto para receber/sincronizar demanda.');
            await persistManagerState('manager_preflight_project_ready');
          }
        } else if (command.type === 'FORCE_START_ASSIGNMENT') {
          if (!command.assignmentId || command.assignmentId === state.batch?.managerAssignmentId) {
            state.managerForceStartCount += 1;
            state.managerStartLastAttemptAt = new Date().toISOString();
            state.paused = false; state.managerHold = false; state.stopRequested = false; managerWorkspaceRetryAt = 0;
            if (state.operationLock && !state.running && state.processingIndex === null) {
              log('MANAGER START WATCHDOG — liberando operationLock órfão antes do FORCE START.');
              state.operationLock = false;
            }
            log(`MANAGER START WATCHDOG — FORCE START ${command.attempt || state.managerForceStartCount} para ${command.assignmentId || 'assignment atual'}.`);
            const started = await maybeStartManagedAssignment(true);
            if (!started && !state.running) {
              log(`MANAGER START WATCHDOG — FORCE START ainda não iniciou: ${state.managerStartLastError || 'sem diagnóstico'}.`);
              await persistManagerState('manager_force_start_failed');
            }
          }
        } else if (command.type === 'RELOAD_WORKSPACE_FOR_ASSIGNMENT') {
          if (!command.assignmentId || command.assignmentId === state.batch?.managerAssignmentId) {
            const alreadySent = state.prompts.some(item => ['sent','generating','result_ready','downloading','done'].includes(item.status));
            if (!alreadySent && !state.running) {
              state.managerStartLastError = 'Workspace recarregado pelo watchdog após assignment não iniciar';
              state.workspaceReady = false; state.workspaceStatus = 'START_WATCHDOG_RELOADING';
              await persistManagerState('manager_start_watchdog_reload');
              log('MANAGER START WATCHDOG — recarregando a mesma página do Flow; assignment será recuperado sem duplicar JOBs.');
              setTimeout(() => location.reload(), 250);
              return;
            }
          }
        } else if (command.type === 'RESET_LOCAL') {
          await resetManagerLocalAssignment(command.assignmentId || '');
        } else if (command.type === 'MANAGER_HARD_STOP') {
          if (!state.managerHold || state.running || state.captureArmed) {
            await hardStopQueue();
            state.managerHold = true;
            log('MANAGER — PARAR TUDO confirmado. Assignment preservado para retomada.');
            await persistManagerState('manager_global_hard_stop');
          }
        } else if (command.type === 'MANAGER_HOLD') {
          if (!state.managerHold) {
            state.managerHold = true;
            log('MANAGER — fila global parada; aguardando INICIAR no painel.');
            await persistManagerState('manager_global_hold');
          }
        } else if (command.type === 'MANAGER_START') {
          if (state.managerHold) {
            state.managerHold = false;
            state.stopRequested = false;
            log('MANAGER — INICIAR recebido; Worker liberado para continuar.');
            await persistManagerState('manager_global_start');
          }
        } else if (command.type === 'PAUSE') {
          if (state.running && !state.paused) { state.paused = true; log('MANAGER — perfil pausado; novos envios suspensos.'); }
        } else if (command.type === 'LIMIT_HOLD') {
          if (state.running && !state.paused) state.paused = true;
        }
      }
      // Se a demanda já foi atribuída mas o Worker estava na home do Flow,
      // O envio pode já ter terminado, mas as gerações continuam em voo.
      // Mantém o observador/download armados até todos os JOBs ativos virarem DONE/erro.
      await ensureManagedResultTracking('heartbeat');

      // continua tentando preparar o projeto nos heartbeats seguintes — porém
      // nunca enquanto o controle global do Manager estiver em PARAR.
      if (!state.running && !state.operationLock && !state.paused && !state.managerHold) {
        await maybeStartManagedAssignment();
      }
    } catch (_) {
      state.managerConnected = false;
    } finally {
      managerTickBusy = false;
    }
  }

  createPanel().style.display = 'none';
  ensureTrackingObserver();
  // Independente do Manager: se a própria página do Flow quebrar logo na abertura,
  // o Worker não espera receber assignment/heartbeat para recuperar a aba.
  setTimeout(() => flowClientErrorHealthCheck().catch(() => {}), 700);
  setInterval(() => flowClientErrorHealthCheck().catch(() => {}), 1800);
  restorePromise = restoreManagerState();
  restorePromise.finally(() => {
    setTimeout(flowManagerTick, 1200);
    managerTickTimer = setInterval(flowManagerTick, 3000);
  });
})();
