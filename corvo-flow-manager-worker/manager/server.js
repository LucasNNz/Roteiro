'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CORVO_FLOW_MANAGER_PORT || 32145);
const ROOT = path.resolve(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const DATA_DIR = process.env.CORVO_FLOW_DATA_DIR || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'CorvoFlowManager')
  : path.join(os.homedir(), '.corvo-flow-manager'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PROFILE_ROOT = path.join(DATA_DIR, 'profiles');
const DEFAULT_FLOW_URL = 'https://labs.google/fx/tools/flow';
const MANIFEST_DIR = path.join(DATA_DIR, 'manifests');
const APP_ASSET_DIR = path.join(DATA_DIR, 'app-assets');
fs.mkdirSync(MANIFEST_DIR, { recursive: true });
fs.mkdirSync(APP_ASSET_DIR, { recursive: true });

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PROFILE_ROOT, { recursive: true });

function nowIso() { return new Date().toISOString(); }
function uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function sanitizeLabel(v) { return String(v || '').replace(/[<>\r\n]/g, ' ').trim().slice(0, 80); }
function asInt(v, fallback, min = 1, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function baseState() {
  return {
    version: '4.2.9',
    createdAt: nowIso(),
    settings: {
      burstSize: 5,
      flowUrl: DEFAULT_FLOW_URL,
      chromePath: '',
      heartbeatOfflineSeconds: 20,
      autoLaunchProfiles: true,
      autoLaunchCooldownSeconds: 35,
      initialBalanceWaitSeconds: 25,
      preflightWaitSeconds: 30,
      limitHoldMinutes: 60,
      autoCloseProfilesAfterApp: true,
      appLaunchMinimized: true,
      limitPhrases: [
        'limite diário atingido', 'limite diario atingido', 'créditos diários esgotados', 'creditos diarios esgotados',
        'quota exceeded', 'rate limit', 'too many requests', 'try again later', 'tente novamente mais tarde'
      ]
    },
    control: {
      running: false,
      changedAt: nowIso(),
      lastAction: 'STOP',
      sessionMode: 'MANUAL',
      sessionId: ''
    },
    profiles: [],
    batches: [],
    assignments: [],
    scheduler: {
      waveId: '', waitStartedAt: '', waitUntil: '', initialBatchId: '', lastPlanAt: '', lastPlanProfiles: [], lastReason: '',
      preflightState: 'IDLE', preflightStartedAt: '', preflightUntil: '', preflightFinishedAt: '', preflightReadyProfiles: [], preflightUnavailableProfiles: [], preflightUnavailableReasons: {}, preflightReason: ''
    },
    events: []
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const fresh = baseState();
    return { ...fresh, ...parsed, version: fresh.version, settings: { ...fresh.settings, ...(parsed.settings || {}) }, control: { ...fresh.control, ...(parsed.control || {}) }, scheduler: { ...fresh.scheduler, ...(parsed.scheduler || {}) } };
  } catch (_) {
    return baseState();
  }
}

let state = loadState();

// V4.2.5 — LIMIT HOLD TEMPORÁRIO + REVALIDAÇÃO
// LIMIT_REACHED não pode ficar gravado para sempre. Limites simulados de TEST_MODE
// são liberados na próxima execução. Limites reais entram em hold temporário e são
// automaticamente revalidados após o tempo configurado.
function profileLimitSource(profile) {
  if (profile?.limitSource) return String(profile.limitSource);
  const currentBatch = profile?.currentBatchId ? state.batches.find(b => b.batchId === profile.currentBatchId) : null;
  if (currentBatch?.testMode) return 'TEST_MODE';
  const assignments = state.assignments.filter(a => a.profileId === profile?.id && a.status === 'LIMIT_REACHED');
  for (const assignment of assignments) {
    const batch = state.batches.find(b => b.batchId === assignment.batchId);
    if (batch?.testMode) return 'TEST_MODE';
    for (const jobId of assignment.jobIds || []) {
      const found = state.batches.flatMap(b => b.jobs || []).find(j => j.jobId === jobId);
      const msg = String(found?.result?.error || found?.result?.motivo || '');
      if (/TEST_MODE/i.test(msg)) return 'TEST_MODE';
    }
  }
  return 'FLOW_REAL';
}

function clearProfileLimit(profile, reason = 'LIMIT_REVALIDATE') {
  if (!profile) return false;
  const wasLimited = profile.status === 'LIMIT_REACHED' || !!profile.limitDetectedAt || !!profile.limitUntil;
  if (!wasLimited) return false;
  profile.status = profile.enabled === false ? 'PAUSED' : 'OFFLINE';
  profile.limitDetectedAt = '';
  profile.limitUntil = '';
  profile.limitSource = '';
  profile.lastError = '';
  profile.currentBatchId = '';
  profile.currentJobs = 0;
  profile.workspaceReady = false;
  profile.workspaceStatus = '';
  profile.workspaceError = '';
  if (reason) addEvent('LIMIT_REVALIDATE', `${profile.id}: hold de limite liberado (${reason}); perfil voltará ao preflight.`, { profileId: profile.id, reason });
  return true;
}

function expireProfileLimits(reason = 'SUPERVISOR') {
  const holdMs = asInt(state.settings?.limitHoldMinutes, 60, 5, 1440) * 60 * 1000;
  const now = Date.now();
  let cleared = 0;
  for (const profile of state.profiles || []) {
    if (profile.status !== 'LIMIT_REACHED') continue;
    const source = profileLimitSource(profile);
    profile.limitSource = source;
    const detectedAt = profile.limitDetectedAt ? Date.parse(profile.limitDetectedAt) : 0;
    const explicitUntil = profile.limitUntil ? Date.parse(profile.limitUntil) : 0;
    const until = explicitUntil || (detectedAt ? detectedAt + holdMs : 0);
    if (source === 'TEST_MODE' || !detectedAt || (until && now >= until)) {
      if (clearProfileLimit(profile, source === 'TEST_MODE' ? 'TEST_MODE_EXPIRED' : `${reason}_TTL_EXPIRED`)) cleared += 1;
    } else if (!profile.limitUntil) {
      profile.limitUntil = new Date(until).toISOString();
    }
  }
  if (cleared) saveSoon();
  return cleared;
}
// V4.2: reiniciar o Manager nunca deve redistribuir automaticamente trabalho que
// estava em voo. O estado e os assignments são preservados, mas o orquestrador
// volta em HOLD até o usuário clicar em INICIAR e os Workers se reconciliarem.
const recoveredRunningState = state.control?.running === true;
state.control = { ...(state.control || {}), running: false, changedAt: nowIso(), lastAction: recoveredRunningState ? 'RECOVERY_HOLD' : (state.control?.lastAction || 'STOP') };
state.recovery = {
  ...(state.recovery || {}),
  startupAt: nowIso(),
  recoveredRunningState,
  pendingAssignments: state.assignments.filter(a => ['ASSIGNED','ACTIVE','REDISPATCH'].includes(a.status)).length
};
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }, 80);
}
function saveNow() {
  clearTimeout(saveTimer);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
function addEvent(type, message, extra = {}) {
  state.events.push({ at: nowIso(), type, message: String(message || ''), ...extra });
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
  saveSoon();
}

if (recoveredRunningState) {
  addEvent('RECOVERY_HOLD', `Manager reiniciado com ${state.recovery.pendingAssignments} assignment(s) preservado(s). Distribuição mantida PARADA até reconciliação manual via INICIAR.`);
  saveNow();
}

function nextProfileId() {
  const nums = state.profiles.map(p => Number(String(p.id || '').match(/FLOW_PROFILE_(\d+)/)?.[1] || 0));
  const next = Math.max(0, ...nums) + 1;
  return `FLOW_PROFILE_${String(next).padStart(2, '0')}`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    state.settings.chromePath,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

function profileDir(profileId) {
  return path.join(PROFILE_ROOT, profileId, 'chrome-data');
}

function launchProfile(profile) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Runtime do Worker não encontrado. Execute START_MANAGER.bat para preparar o Chrome for Testing.');
  const dir = profileDir(profile.id);
  fs.mkdirSync(dir, { recursive: true });
  const bootstrap = `http://${HOST}:${PORT}/worker-bootstrap?profileId=${encodeURIComponent(profile.id)}&token=${encodeURIComponent(profile.token)}`;
  const args = [
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    `--load-extension=${EXTENSION_DIR}`,
    ...(state.control?.sessionMode === 'APP' && state.settings?.appLaunchMinimized !== false ? ['--start-minimized'] : []),
    bootstrap
  ];
  const child = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: state.control?.sessionMode === 'APP' });
  child.unref();
  profile.lastLaunchAt = nowIso();
  profile.lastPid = child.pid || null;
  profile.launchSessionId = state.control?.sessionId || '';
  profile.launchSessionMode = state.control?.sessionMode || 'MANUAL';
  profile.lastError = '';
  profile.status = 'STARTING';
  addEvent('PROFILE_OPEN', `${profile.id} aberto com runtime do Worker`, { profileId: profile.id, runtime: chrome });
  saveSoon();
  return child.pid || null;
}

// V4.2.3 — AUTO LAUNCH / SELF-HEALING PROFILES
// O usuário não precisa clicar em ABRIR perfil por perfil. Quando o Manager entra
// em execução, todo perfil cadastrado, habilitado e elegível é aberto automaticamente.
// Um supervisor continua verificando os perfis para recuperar Chrome/Worker fechado
// ou perdido, com cooldown para não criar loops/abas repetidas.
function canAutoLaunchProfile(profile, now = Date.now()) {
  if (!profile || profile.enabled === false) return false;
  if (['PAUSED','LIMIT_REACHED','REMOVED','AVAILABLE','BUSY','STARTING'].includes(profile.status)) return false;
  const cooldownMs = asInt(state.settings.autoLaunchCooldownSeconds, 35, 10, 300) * 1000;
  const lastLaunch = profile.lastLaunchAt ? Date.parse(profile.lastLaunchAt) : 0;
  if (lastLaunch && now - lastLaunch < cooldownMs) return false;
  return profile.status === 'OFFLINE' || !profile.status;
}

function autoLaunchEnabledProfiles(reason = 'SUPERVISOR') {
  expireProfileLimits(reason);
  if (state.control?.running !== true || state.settings.autoLaunchProfiles === false) {
    return { attempted: 0, launched: 0, failed: 0, profiles: [] };
  }
  refreshOfflineProfiles();
  const now = Date.now();
  const result = { attempted: 0, launched: 0, failed: 0, profiles: [] };
  for (const profile of state.profiles) {
    if (!canAutoLaunchProfile(profile, now)) continue;
    result.attempted += 1;
    try {
      const pid = launchProfile(profile);
      result.launched += 1;
      result.profiles.push(profile.id);
      addEvent('PROFILE_AUTO_OPEN', `${profile.id} aberto automaticamente (${reason}).`, { profileId: profile.id, reason, pid });
    } catch (error) {
      result.failed += 1;
      profile.lastError = `AUTO_OPEN_FAILED: ${String(error?.message || error)}`;
      addEvent('PROFILE_AUTO_OPEN_FAILED', `${profile.id}: ${profile.lastError}`, { profileId: profile.id, reason });
    }
  }
  if (result.attempted) saveSoon();
  return result;
}

function parseKeyValues(section) {
  const out = {};
  let key = null;
  for (const raw of String(section || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) { key = m[1].toUpperCase(); out[key] = m[2].trim(); }
    else if (key && line.trim()) out[key] += `\n${line}`;
  }
  return out;
}

function parseFlowBatch(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!/\[FLOW_BATCH\]/i.test(text)) throw new Error('O Manager V4 requer um TXT estruturado com [FLOW_BATCH].');
  const matches = [...text.matchAll(/\[ID:([^\]]+)\]/gi)];
  if (!matches.length) throw new Error('Nenhum bloco [ID:...] encontrado.');
  const firstId = matches[0].index;
  const header = parseKeyValues(text.slice(0, firstId));
  const projectId = header.PROJECT_ID || header.PROJETO || `PROJECT_${Date.now()}`;
  const batchId = header.BATCH_ID || `${projectId}:FLOW:${Date.now()}`;
  const appDelivery = String(header.DELIVERY_MODE || '').toUpperCase() === 'APP' || /^(1|true|yes|sim)$/i.test(String(header.APP_DELIVERY || ''));
  const jobs = matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const fields = parseKeyValues(text.slice(start, end));
    const id = m[1].trim();
    const prompt = (fields.PROMPT || fields.PROMPT_GERACAO || '').trim();
    if (!prompt) throw new Error(`PROMPT ausente em [ID:${id}]`);
    const arquivoFinal = fields.ARQUIVO_FINAL || fields.PADRAO_ARQUIVO_FINAL || '';
    if (!arquivoFinal) throw new Error(`ARQUIVO_FINAL ausente em [ID:${id}]`);
    return {
      id,
      jobId: fields.JOB_ID || fields.LOGICAL_JOB_ID || `${batchId}:JOB:${id}`,
      projectId: fields.PROJECT_ID || projectId,
      batchId: fields.BATCH_ID || batchId,
      slot: fields.SLOT || id,
      arquivoFinal,
      prompt,
      tentativa: Math.max(1, Number(fields.TENTATIVA || fields.TENTATIVA_ATUAL || 1) || 1),
      metadata: fields.METADATA || '',
      testErrorCode: fields.TEST_ERROR_CODE || '',
      testErrorProfile: fields.TEST_ERROR_PROFILE || '',
      managerStatus: 'PENDING',
      workerStatus: 'pending',
      assignedProfileId: '',
      assignmentId: '',
      attempts: 0,
      assignedAt: '',
      startedAt: '',
      completedAt: '',
      lastProfileId: '',
      workerHistory: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      result: null
    };
  });
  const seen = new Set();
  for (const job of jobs) {
    if (seen.has(job.jobId)) throw new Error(`JOB_ID duplicado: ${job.jobId}`);
    seen.add(job.jobId);
  }
  return { projectId, batchId, header, jobs, appDelivery };
}

function batchSummary(batch) {
  const counts = {};
  for (const job of batch.jobs) counts[job.managerStatus] = (counts[job.managerStatus] || 0) + 1;
  const done = counts.DONE || 0;
  const failed = (counts.FAILED || 0) + (counts.MANUAL_REVIEW || 0);
  const queued = counts.PENDING || 0;
  const assigned = counts.ASSIGNED || 0;
  const running = counts.RUNNING || 0;
  const resultReady = counts.RESULT_READY || 0;
  const downloading = counts.DOWNLOADING || 0;
  const unresolved = queued + assigned + running + resultReady + downloading;
  const terminal = done + failed;
  let status = 'PENDING';
  if (terminal === batch.jobs.length && batch.jobs.length > 0) status = 'COMPLETE';
  else if (assigned || running || resultReady || downloading || done || failed) status = 'ACTIVE';
  let result = '';
  if (status === 'COMPLETE') result = done === batch.jobs.length ? 'SUCCESS' : (done > 0 ? 'PARTIAL' : 'FAILED');
  return {
    total: batch.jobs.length, done, failed, pending: unresolved, queued, assigned, running, resultReady, downloading, terminal,
    status, result, counts,
    completedAt: batch.completedAt || '', manifestReady: !!batch.manifest
  };
}

function safeManifestFileName(value) {
  return String(value || 'batch').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 140) || 'batch';
}

function appAssetPath(batchId, jobId, filename) {
  const batchDir = path.join(APP_ASSET_DIR, safeManifestFileName(batchId));
  fs.mkdirSync(batchDir, { recursive: true });
  const ext = path.extname(String(filename || '')).slice(0, 12).replace(/[^a-z0-9.]/gi, '') || '.img';
  const key = safeManifestFileName(jobId || 'job');
  return path.join(batchDir, `${key}${ext}`);
}

function appAssetMeta(job) {
  const p = String(job?.result?.appAssetPath || '');
  if (!p || !fs.existsSync(p)) return { ready:false, size:0, contentType:'', filename:'' };
  let size = 0; try { size = fs.statSync(p).size; } catch (_) {}
  return { ready:size > 0, size, contentType:String(job?.result?.appAssetContentType || 'application/octet-stream'), filename:String(job?.result?.appAssetFile || job?.result?.file || job?.arquivoFinal || '') };
}

function managerManifestForBatch(batch) {
  const summary = batchSummary(batch);
  const workerCounts = new Map();
  for (const job of batch.jobs) {
    const profileId = job.lastProfileId || job.assignedProfileId || job.result?.profileId || '';
    if (profileId) workerCounts.set(profileId, (workerCounts.get(profileId) || 0) + 1);
  }
  const lines = [
    '[CORVO_FLOW_BATCH_RESULT]', 'VERSION=2.0', '',
    `PROJECT_ID=${batch.projectId}`, `BATCH_ID=${batch.batchId}`,
    `BATCH_STATUS=${summary.status}`, `BATCH_RESULT=${summary.result || 'IN_PROGRESS'}`,
    `CREATED_AT=${batch.createdAt || ''}`, `COMPLETED_AT=${batch.completedAt || ''}`, '',
    '[TOTAL]', `JOBS=${summary.total}`, `DONE=${summary.done}`, `FAILED=${summary.failed}`,
    `PENDING=${summary.queued}`, `ASSIGNED=${summary.assigned}`, `RUNNING=${summary.running}`, `RESULT_READY=${summary.resultReady}`, `DOWNLOADING=${summary.downloading}`, '',
    '[WORKERS]', `USED=${workerCounts.size}`
  ];
  for (const [profileId, count] of [...workerCounts.entries()].sort()) lines.push(`${profileId}=${count}`);
  lines.push('');
  for (const job of batch.jobs) {
    const r = job.result || {};
    const history = (job.workerHistory || []).map(x => x.profileId).filter(Boolean).join(',');
    lines.push(`[ID:${job.id}]`);
    lines.push(`JOB_ID=${job.jobId}`);
    lines.push(`SLOT=${job.slot}`);
    lines.push(`STATUS=${job.managerStatus}`);
    lines.push(`WORKER=${job.lastProfileId || job.assignedProfileId || r.profileId || ''}`);
    lines.push(`WORKER_HISTORY=${history}`);
    lines.push(`ARQUIVO_FINAL=${job.arquivoFinal}`);
    lines.push(`ARQUIVO=${r.file || ''}`);
    lines.push(`TENTATIVA=${Math.max(1, Number(job.tentativa || 1) + Number(job.attempts || 0))}`);
    lines.push(`SEND_SEQUENCE=${r.sendSequence || 0}`);
    lines.push(`GENERATION_SEQUENCE=${r.generationSequence || 0}`);
    lines.push(`MAPPING_METHOD=${r.mappingMethod || ''}`);
    lines.push(`MAPPING_CONFIDENCE=${r.mappingConfidence ?? ''}`);
    lines.push(`ASSIGNED_AT=${job.assignedAt || ''}`);
    lines.push(`SENT_AT=${r.sentAt || job.startedAt || ''}`);
    lines.push(`GENERATION_DETECTED_AT=${r.generationDetectedAt || ''}`);
    lines.push(`RESULT_DETECTED_AT=${r.resultDetectedAt || ''}`);
    lines.push(`DOWNLOAD_REQUESTED_AT=${r.downloadRequestIssuedAt || ''}`);
    lines.push(`DONE_AT=${r.doneAt || job.completedAt || ''}`);
    lines.push(`ERROR_CODE=${r.errorCode || ''}`);
    lines.push(`ERROR_CLASS=${r.errorClass || ''}`);
    lines.push(`NEXT_ACTION=${r.nextAction || ''}`);
    lines.push(`MOTIVO=${String(r.error || '').replace(/[\r\n]+/g, ' ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

function preflightReasonForProfile(profile) {
  if (!profile) return 'UNKNOWN';
  if (profile.enabled === false || profile.status === 'PAUSED') return 'PAUSED';
  if (profile.status === 'LIMIT_REACHED') return 'LIMIT_REACHED';
  if (profile.status === 'OFFLINE') return 'OFFLINE';
  if (profile.status === 'STARTING') return 'STARTING_TIMEOUT';
  const maxAge = asInt(state.settings.heartbeatOfflineSeconds, 20, 5, 300) * 1000;
  const seen = profile.lastSeenAt ? Date.parse(profile.lastSeenAt) : 0;
  if (!seen || Date.now() - seen > maxAge) return 'HEARTBEAT_STALE';
  if (profile.workspaceError) return `WORKSPACE_ERROR: ${String(profile.workspaceError).slice(0, 120)}`;
  if (!profile.workspaceReady) return `NOT_PROJECT_READY${profile.workspaceStatus ? ` (${profile.workspaceStatus})` : ''}`;
  if (!['AVAILABLE','BUSY'].includes(profile.status)) return `STATUS_${profile.status || 'UNKNOWN'}`;
  return 'NOT_READY';
}

// APP SESSION — fecha somente os Chromes que o próprio Manager abriu nesta sessão.
// O agente/servidor local permanece vivo para o próximo lote.
let appProfileCloseTimer = null;
function closeManagedProfileProcess(profile, reason = 'APP_SESSION_COMPLETE') {
  if (!profile) return false;
  const pid = Number(profile.lastPid || 0);
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { detached:false, stdio:'ignore', windowsHide:true });
      killer.on('error', () => {});
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    }
    addEvent('PROFILE_AUTO_CLOSE', `${profile.id} encerrado após sessão do app.`, { profileId:profile.id, pid, reason });
    profile.lastPid = null;
    profile.status = profile.enabled === false ? 'PAUSED' : 'OFFLINE';
    profile.workspaceReady = false;
    profile.workspaceStatus = '';
    profile.workspaceUrl = '';
    profile.currentBatchId = '';
    profile.currentJobs = 0;
    profile.launchSessionId = '';
    profile.launchSessionMode = '';
    return true;
  } catch (error) {
    profile.lastError = `AUTO_CLOSE_FAILED: ${String(error?.message || error)}`;
    addEvent('PROFILE_AUTO_CLOSE_FAILED', `${profile.id}: ${profile.lastError}`, { profileId:profile.id, pid, reason });
    return false;
  }
}

function scheduleAppSessionProfileClose(reason = 'APP_QUEUE_COMPLETE') {
  if (state.control?.sessionMode !== 'APP') return false;
  if (state.settings?.autoCloseProfilesAfterApp === false) return false;
  const sessionId = String(state.control?.sessionId || '');
  if (!sessionId) return false;
  clearTimeout(appProfileCloseTimer);
  appProfileCloseTimer = setTimeout(() => {
    let closed = 0;
    for (const profile of state.profiles || []) {
      if (profile.launchSessionId !== sessionId || profile.launchSessionMode !== 'APP') continue;
      if (closeManagedProfileProcess(profile, reason)) closed += 1;
    }
    addEvent('APP_SESSION_CLEANUP', `Sessão ${sessionId}: ${closed} janela(s) de perfil encerrada(s); agente permanece ativo.`, { sessionId, closed, reason });
    saveNow();
  }, 1800);
  return true;
}

// V4.2.6 — AUTO STOP DE FILA
// Quando todos os lotes existentes chegaram a estado terminal, o Manager encerra
// automaticamente a execução global. Isso impede PROFILE_PREWARM, novos cliques,
// abertura de projetos ou qualquer outro movimento após o último JOB terminar.
function autoStopWhenQueueComplete(reason = 'QUEUE_DRAINED') {
  if (state.control?.running !== true) return false;
  if (!Array.isArray(state.batches) || state.batches.length === 0) return false;
  const incomplete = state.batches.some(batch => batchSummary(batch).status !== 'COMPLETE');
  if (incomplete) return false;
  state.control.running = false;
  state.control.changedAt = nowIso();
  state.control.lastAction = 'AUTO_STOP_COMPLETE';
  state.scheduler = {
    ...(state.scheduler || {}),
    preflightState: 'IDLE',
    preflightFinishedAt: state.scheduler?.preflightFinishedAt || nowIso(),
    waitStartedAt: '', waitUntil: '', initialBatchId: '',
    lastReason: 'AUTO_STOP_COMPLETE'
  };
  addEvent('AUTO_STOP_COMPLETE', 'Fila concluída. Manager mudou automaticamente para PARADO; Workers receberão HARD STOP/IDLE no próximo heartbeat.', { reason });
  if (state.control?.sessionMode === 'APP') scheduleAppSessionProfileClose(reason);
  return true;
}

function finalizeBatches() {
  let changed = false;
  for (const batch of state.batches) {
    const summary = batchSummary(batch);
    if (summary.status === 'COMPLETE') {
      if (!batch.completedAt) {
        batch.completedAt = nowIso();
        changed = true;
      }
      const manifest = managerManifestForBatch(batch);
      if (batch.manifest !== manifest) {
        batch.manifest = manifest;
        const filename = `${safeManifestFileName(batch.batchId)}_result.txt`;
        batch.manifestFile = path.join(MANIFEST_DIR, filename);
        try { fs.writeFileSync(batch.manifestFile, manifest, 'utf8'); } catch (_) {}
        changed = true;
      }
      if (!batch.completionEventAt) {
        batch.completionEventAt = nowIso();
        addEvent('BATCH_COMPLETE', `${batch.batchId}: ${summary.done}/${summary.total} DONE · ${summary.failed} falha(s) · resultado ${summary.result}.`, { batchId: batch.batchId });
        changed = true;
      }
    } else if (batch.completedAt || batch.manifest || batch.completionEventAt) {
      batch.completedAt = '';
      batch.manifest = '';
      batch.manifestFile = '';
      batch.completionEventAt = '';
      changed = true;
    }
  }
  if (autoStopWhenQueueComplete('FINALIZE_BATCHES')) changed = true;
  if (changed) saveSoon();
}



function buildConfigBackup() {
  return {
    schema: 'CORVO_FLOW_MANAGER_CONFIG',
    version: '1.0',
    exportedAt: nowIso(),
    managerVersion: state.version,
    note: 'Este backup nao contem senhas, cookies ou tokens de sessao do Google. No mesmo PC, os diretórios locais de perfil existentes sao reutilizados; em outro PC, sera necessario fazer login novamente.',
    settings: {
      burstSize: asInt(state.settings.burstSize, 5, 1, 20),
      flowUrl: state.settings.flowUrl || DEFAULT_FLOW_URL,
      heartbeatOfflineSeconds: asInt(state.settings.heartbeatOfflineSeconds, 20, 5, 300),
      autoLaunchProfiles: state.settings.autoLaunchProfiles !== false,
      autoLaunchCooldownSeconds: asInt(state.settings.autoLaunchCooldownSeconds, 35, 10, 300),
      initialBalanceWaitSeconds: asInt(state.settings.initialBalanceWaitSeconds, 25, 3, 120),
      preflightWaitSeconds: asInt(state.settings.preflightWaitSeconds, 30, 5, 180),
      limitHoldMinutes: asInt(state.settings.limitHoldMinutes, 60, 5, 1440),
      limitPhrases: Array.isArray(state.settings.limitPhrases) ? state.settings.limitPhrases.slice(0, 40) : []
    },
    profiles: state.profiles
      .filter(p => p.status !== 'REMOVED')
      .map(p => ({
        id: p.id,
        label: p.label,
        enabled: p.enabled !== false,
        createdAt: p.createdAt || ''
      }))
  };
}

function importConfigBackup(config) {
  if (!config || config.schema !== 'CORVO_FLOW_MANAGER_CONFIG') throw new Error('Arquivo de configuracao nao reconhecido.');
  if (String(config.version || '') !== '1.0') throw new Error(`Versao de backup nao suportada: ${config.version || 'ausente'}`);
  if (state.control?.running === true) throw new Error('Pare a producao antes de importar configuracoes.');

  const incomingSettings = config.settings || {};
  if (incomingSettings.burstSize != null) state.settings.burstSize = asInt(incomingSettings.burstSize, state.settings.burstSize, 1, 20);
  if (incomingSettings.flowUrl && /^https:\/\//i.test(String(incomingSettings.flowUrl))) state.settings.flowUrl = String(incomingSettings.flowUrl).trim();
  if (incomingSettings.heartbeatOfflineSeconds != null) state.settings.heartbeatOfflineSeconds = asInt(incomingSettings.heartbeatOfflineSeconds, state.settings.heartbeatOfflineSeconds, 5, 300);
  if (incomingSettings.autoLaunchProfiles != null) state.settings.autoLaunchProfiles = incomingSettings.autoLaunchProfiles !== false;
  if (incomingSettings.autoLaunchCooldownSeconds != null) state.settings.autoLaunchCooldownSeconds = asInt(incomingSettings.autoLaunchCooldownSeconds, state.settings.autoLaunchCooldownSeconds, 10, 300);
  if (incomingSettings.initialBalanceWaitSeconds != null) state.settings.initialBalanceWaitSeconds = asInt(incomingSettings.initialBalanceWaitSeconds, state.settings.initialBalanceWaitSeconds, 3, 120);
  if (incomingSettings.preflightWaitSeconds != null) state.settings.preflightWaitSeconds = asInt(incomingSettings.preflightWaitSeconds, state.settings.preflightWaitSeconds, 5, 180);
  if (incomingSettings.limitHoldMinutes != null) state.settings.limitHoldMinutes = asInt(incomingSettings.limitHoldMinutes, state.settings.limitHoldMinutes, 5, 1440);
  if (Array.isArray(incomingSettings.limitPhrases)) state.settings.limitPhrases = incomingSettings.limitPhrases.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40);

  let created = 0, updated = 0, localDataReused = 0;
  const importedIds = [];
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  for (const raw of profiles) {
    const id = String(raw?.id || '').trim();
    if (!/^FLOW_PROFILE_\d+$/i.test(id)) continue;
    const label = sanitizeLabel(raw.label) || id;
    const enabled = raw.enabled !== false;
    const dir = profileDir(id);
    const chromeDataDir = path.join(dir);
    const hasLocalData = fs.existsSync(chromeDataDir) && (() => { try { return fs.readdirSync(chromeDataDir).length > 0; } catch (_) { return false; } })();
    let profile = state.profiles.find(p => p.id === id);
    if (profile) {
      profile.label = label;
      profile.enabled = enabled;
      profile.status = enabled ? 'OFFLINE' : 'PAUSED';
      profile.lastError = '';
      profile.limitDetectedAt = '';
      profile.currentBatchId = '';
      profile.currentJobs = 0;
      updated += 1;
    } else {
      profile = {
        id,
        label,
        token: crypto.randomBytes(18).toString('hex'),
        status: enabled ? 'OFFLINE' : 'PAUSED',
        enabled,
        createdAt: raw.createdAt || nowIso(),
        lastSeenAt: '',
        limitDetectedAt: '',
        lastError: ''
      };
      state.profiles.push(profile);
      created += 1;
    }
    fs.mkdirSync(profileDir(id), { recursive: true });
    if (hasLocalData) localDataReused += 1;
    importedIds.push(id);
  }

  state.control.running = false;
  state.control.changedAt = nowIso();
  state.control.lastAction = 'IMPORT_CONFIG';
  addEvent('CONFIG_IMPORT', `${importedIds.length} perfil(is) importados: ${created} criado(s), ${updated} atualizado(s), ${localDataReused} com dados locais reutilizados.`);
  saveNow();
  return { profiles: importedIds.length, created, updated, localDataReused, requiresLoginOnNewMachine: true };
}

function publicState() {
  expireProfileLimits('PUBLIC_STATE');
  refreshOfflineProfiles();
  finalizeBatches();
  const visibleProfiles = state.profiles.filter(p => p.status !== 'REMOVED');
  const allJobs = state.batches.flatMap(b => b.jobs);
  const orchestration = {
    profiles: visibleProfiles.length,
    available: visibleProfiles.filter(p => p.status === 'AVAILABLE').length,
    busy: visibleProfiles.filter(p => p.status === 'BUSY').length,
    limitReached: visibleProfiles.filter(p => p.status === 'LIMIT_REACHED').length,
    offline: visibleProfiles.filter(p => p.status === 'OFFLINE').length,
    paused: visibleProfiles.filter(p => p.status === 'PAUSED').length,
    jobs: allJobs.length,
    done: allJobs.filter(j => j.managerStatus === 'DONE').length,
    failed: allJobs.filter(j => ['FAILED','MANUAL_REVIEW'].includes(j.managerStatus)).length,
    running: allJobs.filter(j => j.managerStatus === 'RUNNING').length,
    resultReady: allJobs.filter(j => j.managerStatus === 'RESULT_READY').length,
    downloading: allJobs.filter(j => j.managerStatus === 'DOWNLOADING').length,
    assigned: allJobs.filter(j => j.managerStatus === 'ASSIGNED').length,
    pending: allJobs.filter(j => j.managerStatus === 'PENDING').length,
    activeBatches: state.batches.filter(b => batchSummary(b).status !== 'COMPLETE').length,
    completeBatches: state.batches.filter(b => batchSummary(b).status === 'COMPLETE').length
  };
  return {
    version: state.version,
    settings: state.settings,
    control: state.control,
    recovery: state.recovery || {},
    orchestration,
    profiles: visibleProfiles.map(p => ({
      id: p.id, label: p.label, status: p.status, enabled: p.enabled !== false,
      createdAt: p.createdAt, lastSeenAt: p.lastSeenAt || '', lastLaunchAt: p.lastLaunchAt || '',
      limitDetectedAt: p.limitDetectedAt || '', limitUntil: p.limitUntil || '', limitSource: p.limitSource || '', lastError: p.lastError || '', workerId: p.workerId || '',
      currentBatchId: p.currentBatchId || '', currentJobs: p.currentJobs || 0,
      workspaceStatus: p.workspaceStatus || '', workspaceReady: !!p.workspaceReady, workspaceUrl: p.workspaceUrl || '', workspaceError: p.workspaceError || '',
      startHealth: p.startHealth || {},
      preflightStatus: (state.scheduler?.preflightReadyProfiles || []).includes(p.id) ? 'READY' : ((state.scheduler?.preflightUnavailableProfiles || []).includes(p.id) ? 'OUT' : ''),
      preflightReason: state.scheduler?.preflightUnavailableReasons?.[p.id] || ''
    })),
    batches: state.batches.map(b => ({ batchId: b.batchId, projectId: b.projectId, createdAt: b.createdAt, completedAt: b.completedAt || '', manifestReady: !!b.manifest, balanceWaitStartedAt:b.balanceWaitStartedAt||'', balanceWaitUntil:b.balanceWaitUntil||'', initialWavePlannedAt:b.initialWavePlannedAt||'', initialWaveProfiles:Array.isArray(b.initialWaveProfiles)?b.initialWaveProfiles:[], ...batchSummary(b), jobs: b.jobs.map(j => ({
      id: j.id, jobId: j.jobId, slot: j.slot, arquivoFinal: j.arquivoFinal,
      managerStatus: j.managerStatus, workerStatus: j.workerStatus, assignedProfileId: j.assignedProfileId,
      lastProfileId: j.lastProfileId || '', attempts: j.attempts, assignedAt: j.assignedAt || '', startedAt: j.startedAt || '', completedAt: j.completedAt || '',
      nextAction: j.result?.nextAction || '', errorCode: j.result?.errorCode || '', errorClass: j.result?.errorClass || '', file: j.result?.file || '',
      mappingMethod: j.result?.mappingMethod || '', mappingConfidence: j.result?.mappingConfidence ?? null,
      generationDetectedAt: j.result?.generationDetectedAt || '', resultDetectedAt: j.result?.resultDetectedAt || '', downloadRequestIssuedAt: j.result?.downloadRequestIssuedAt || '',
      appDelivery: b.appDelivery === true, appAssetReady:appAssetMeta(j).ready, appAssetSize:appAssetMeta(j).size, appAssetContentType:appAssetMeta(j).contentType, appAssetFile:appAssetMeta(j).filename,
      workerHistory: Array.isArray(j.workerHistory) ? j.workerHistory : []
    })) })),
    assignments: state.assignments.slice(-60).map(a => ({ ...a, text: undefined })),
    scheduler: { ...(state.scheduler || {}) },
    events: state.events.slice(-180)
  };
}

function refreshOfflineProfiles() {
  const maxAge = (state.settings.heartbeatOfflineSeconds || 20) * 1000;
  const startupGrace = Math.max(maxAge, 25000);
  const now = Date.now();
  for (const p of state.profiles) {
    if (['PAUSED', 'LIMIT_REACHED', 'REMOVED'].includes(p.status)) continue;
    const seenAt = p.lastSeenAt ? Date.parse(p.lastSeenAt) : 0;
    const launchAt = p.lastLaunchAt ? Date.parse(p.lastLaunchAt) : 0;
    if (seenAt && now - seenAt <= maxAge) continue;
    if (p.status === 'STARTING' && launchAt && now - launchAt <= startupGrace) continue;
    if (p.status !== 'OFFLINE') p.status = 'OFFLINE';
    if (launchAt && (!seenAt || seenAt < launchAt) && now - launchAt > startupGrace) {
      p.lastError = 'WORKER_HEARTBEAT_MISSING';
    }
  }
}

function findJob(jobId) {
  for (const batch of state.batches) {
    const job = batch.jobs.find(j => j.jobId === jobId);
    if (job) return { batch, job };
  }
  return null;
}

function updateFromWorker(profile, payload) {
  const workerState = payload.workerState || {};
  profile.lastSeenAt = nowIso();
  profile.workerId = payload.workerId || workerState.workerId || profile.workerId || '';
  if (profile.lastError !== 'FLOW_LIMIT_REACHED') profile.lastError = '';
  profile.currentBatchId = workerState.batch?.batchId || workerState.batchId || '';
  profile.currentJobs = Array.isArray(workerState.prompts) ? workerState.prompts.filter(j => !['done','failed','retry','limit_reached'].includes(j.status)).length : 0;
  const workspace = workerState.workspace || {};
  profile.workspaceStatus = String(workspace.status || '');
  profile.workspaceReady = !!workspace.ready;
  profile.workspaceUrl = String(workspace.url || '');
  profile.workspaceError = String(workspace.lastError || '');
  const startHealth = workerState.startHealth || {};
  profile.startHealth = {
    assignmentId: String(startHealth.assignmentId || ''),
    lastAttemptAt: String(startHealth.lastAttemptAt || ''),
    lastError: String(startHealth.lastError || ''),
    failureCount: Number(startHealth.failureCount || 0),
    forceStartCount: Number(startHealth.forceStartCount || 0),
    promptDetected: startHealth.promptDetected === true,
    operationLock: startHealth.operationLock === true,
    paused: startHealth.paused === true,
    managerHold: startHealth.managerHold === true
  };

  const assignmentId = workerState.managerAssignmentId || workerState.batch?.managerAssignmentId || '';
  if (assignmentId) {
    const ackAssignment = state.assignments.find(a => a.id === assignmentId && a.profileId === profile.id);
    if (ackAssignment) {
      if (!ackAssignment.workerAckAt) {
        ackAssignment.workerAckAt = nowIso();
        addEvent('ASSIGN_ACK', `${assignmentId} confirmado localmente por ${profile.id}.`, { profileId:profile.id, assignmentId });
      }
      const remoteStarted = Array.isArray(workerState.prompts) && workerState.prompts.some(j => ['sent','generating','result_ready','downloading','done'].includes(String(j?.status || '').toLowerCase()));
      if (remoteStarted && !ackAssignment.firstSentAt) ackAssignment.firstSentAt = nowIso();
      if (remoteStarted && ackAssignment.status === 'ASSIGNED') ackAssignment.status = 'ACTIVE';
    }
  }
  const profileLimitMessage = String(workerState.flowLimitMessage || '').trim();
  let limitHit = !!profileLimitMessage;
  const limitReturnedJobs = new Set();
  if (Array.isArray(workerState.prompts)) {
    for (const remote of workerState.prompts) {
      const found = findJob(remote.jobId);
      if (!found) continue;
      const job = found.job;
      if (!assignmentId || job.assignmentId !== assignmentId || job.assignedProfileId !== profile.id) continue;
      const oldStatus = job.managerStatus;
      job.workerStatus = remote.status || job.workerStatus;
      job.updatedAt = nowIso();
      job.lastProfileId = profile.id;
      if (!Array.isArray(job.workerHistory)) job.workerHistory = [];
      if (!job.workerHistory.some(x => x.assignmentId === assignmentId && x.profileId === profile.id)) {
        job.workerHistory.push({ profileId: profile.id, assignmentId, assignedAt: job.assignedAt || nowIso() });
      }
      job.result = {
        ...(job.result || {}),
        status: remote.status || '', errorCode: remote.errorCode || '', error: remote.error || '',
        errorClass: remote.errorClass || '', nextAction: remote.nextAction || '', file: remote.file || job.result?.file || '',
        generationSequence: remote.generationSequence || job.result?.generationSequence || 0, sendSequence: remote.sendSequence || job.result?.sendSequence || 0,
        mappingMethod: remote.mappingMethod || job.result?.mappingMethod || '', mappingConfidence: remote.mappingConfidence ?? job.result?.mappingConfidence ?? null,
        sentAt: remote.sentAt || job.result?.sentAt || '',
        generationDetectedAt: remote.generationDetectedAt || job.result?.generationDetectedAt || '',
        resultDetectedAt: remote.resultDetectedAt || job.result?.resultDetectedAt || '',
        downloadRequestIssuedAt: remote.downloadRequestIssuedAt || job.result?.downloadRequestIssuedAt || '',
        doneAt: remote.doneAt || job.result?.doneAt || '',
        failureAt: remote.failureAt || job.result?.failureAt || '',
        assetWidth: remote.assetWidth || job.result?.assetWidth || 0,
        assetHeight: remote.assetHeight || job.result?.assetHeight || 0,
        profileId: profile.id
      };
      if (remote.status === 'done') {
        job.managerStatus = 'DONE';
        job.completedAt = remote.doneAt || job.completedAt || nowIso();
      } else if (remote.status === 'limit_reached' || remote.errorCode === 'FLOW_LIMIT_REACHED') {
        limitHit = true;
        job.managerStatus = 'PENDING';
        job.assignedProfileId = '';
        job.assignmentId = '';
        job.attempts += 1;
        limitReturnedJobs.add(job.jobId);
      } else if (['failed','retry'].includes(remote.status)) {
        if (remote.nextAction === 'OTHER_WORKER') {
          if (!['DONE','FAILED','MANUAL_REVIEW'].includes(job.managerStatus)) {
            job.managerStatus = 'PENDING'; job.assignedProfileId = ''; job.assignmentId = ''; job.attempts += 1;
          }
        } else {
          const failedStatus = remote.nextAction === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'FAILED';
          if (canAdvanceManagerStatus(job.managerStatus, failedStatus)) job.managerStatus = failedStatus;
          job.completedAt = remote.failureAt || job.completedAt || nowIso();
        }
      } else if (remote.status === 'result_ready') {
        if (canAdvanceManagerStatus(job.managerStatus, 'RESULT_READY')) job.managerStatus = 'RESULT_READY';
        job.startedAt = remote.sentAt || job.startedAt || nowIso();
      } else if (remote.status === 'downloading') {
        if (canAdvanceManagerStatus(job.managerStatus, 'DOWNLOADING')) job.managerStatus = 'DOWNLOADING';
        job.startedAt = remote.sentAt || job.startedAt || nowIso();
      } else if (['sent','generating'].includes(remote.status)) {
        if (canAdvanceManagerStatus(job.managerStatus, 'RUNNING')) job.managerStatus = 'RUNNING';
        job.startedAt = remote.sentAt || job.startedAt || nowIso();
      } else if (['pending','assigned','sending'].includes(remote.status)) {
        if (canAdvanceManagerStatus(job.managerStatus, 'ASSIGNED')) job.managerStatus = 'ASSIGNED';
      }

      if (oldStatus !== job.managerStatus) {
        if (job.managerStatus === 'DONE') addEvent('JOB_DONE', `${job.slot} concluído por ${profile.id} → ${job.result.file || job.arquivoFinal}`, { profileId: profile.id, batchId: job.batchId, jobId: job.jobId });
        else if (['FAILED','MANUAL_REVIEW'].includes(job.managerStatus)) addEvent('JOB_FAILED', `${job.slot} falhou em ${profile.id}: ${job.result.errorCode || 'UNKNOWN_ERROR'}`, { profileId: profile.id, batchId: job.batchId, jobId: job.jobId });
        else if (job.managerStatus === 'RESULT_READY') addEvent('RESULT_READY', `${job.slot} pronto em ${profile.id}; aguardando download.`, { profileId: profile.id, batchId: job.batchId, jobId: job.jobId });
        else if (job.managerStatus === 'DOWNLOADING') addEvent('JOB_DOWNLOADING', `${job.slot} baixando em ${profile.id}.`, { profileId: profile.id, batchId: job.batchId, jobId: job.jobId });
        else if (job.managerStatus === 'RUNNING' && oldStatus === 'ASSIGNED') addEvent('JOB_RUNNING', `${job.slot} iniciou em ${profile.id}`, { profileId: profile.id, batchId: job.batchId, jobId: job.jobId });
      }
    }
  }

  if (limitHit) {
    const assignment = state.assignments.find(a => a.id === assignmentId);
    const limitBatch = assignment ? state.batches.find(b => b.batchId === assignment.batchId) : null;
    const simulatedLimit = !!limitBatch?.testMode || (Array.isArray(workerState.prompts) && workerState.prompts.some(r => r?.errorCode === 'FLOW_LIMIT_REACHED' && /TEST_MODE/i.test(String(r?.error || ''))));
    const detectedAt = nowIso();
    profile.status = 'LIMIT_REACHED';
    profile.limitDetectedAt = detectedAt;
    profile.limitSource = simulatedLimit ? 'TEST_MODE' : 'FLOW_REAL';
    profile.limitUntil = simulatedLimit ? detectedAt : new Date(Date.now() + asInt(state.settings.limitHoldMinutes, 60, 5, 1440) * 60 * 1000).toISOString();
    profile.lastError = profileLimitMessage ? `FLOW_LIMIT_REACHED: ${profileLimitMessage}` : (simulatedLimit ? 'FLOW_LIMIT_REACHED: TEST_MODE' : 'FLOW_LIMIT_REACHED');
    let returned = limitReturnedJobs.size;
    if (assignment) {
      assignment.status = 'LIMIT_REACHED';
      assignment.updatedAt = nowIso();
      for (const jobId of assignment.jobIds) {
        const found = findJob(jobId);
        if (!found) continue;
        const job = found.job;
        if (job.assignedProfileId !== profile.id || job.assignmentId !== assignmentId) continue;
        // Apenas itens ainda não enviados retornam imediatamente à fila. Itens em voo
        // permanecem neste Worker para evitar duplicação e podem concluir mesmo com o perfil limitado.
        if (['PENDING','ASSIGNED'].includes(job.managerStatus) || ['pending','assigned','sending','limit_reached'].includes(job.workerStatus)) {
          job.lastProfileId = profile.id;
          job.managerStatus = 'PENDING';
          job.assignedProfileId = '';
          job.assignmentId = '';
          job.updatedAt = nowIso();
          if (!limitReturnedJobs.has(job.jobId)) { limitReturnedJobs.add(job.jobId); returned += 1; }
        }
      }
    }
    addEvent('LIMIT_REACHED', `${profile.id} atingiu limite${profileLimitMessage ? ` (${profileLimitMessage})` : ''}; ${returned} JOB(s) não enviados voltaram à fila.`, { profileId: profile.id, assignmentId, returned, limitMessage: profileLimitMessage });
    finalizeBatches();
    saveSoon();
    return;
  }

  if (profile.status === 'PAUSED' || profile.status === 'LIMIT_REACHED') {
    finalizeBatches();
    return;
  }
  const localBusy = !!workerState.running || (Array.isArray(workerState.prompts) && workerState.prompts.some(j => ['sending','sent','generating','result_ready','downloading'].includes(j.status)));
  const workspacePreparing = !!assignmentId && !profile.workspaceReady && Array.isArray(workerState.prompts) && workerState.prompts.some(j => ['pending','assigned'].includes(j.status || 'pending'));
  profile.status = (localBusy || workspacePreparing) ? 'BUSY' : 'AVAILABLE';

  if (assignmentId) {
    const assignment = state.assignments.find(a => a.id === assignmentId);
    if (assignment) {
      assignment.updatedAt = nowIso();
      const owned = assignment.jobIds.map(id => findJob(id)?.job).filter(Boolean);
      const stillOwned = owned.some(j => j.assignmentId === assignmentId && j.assignedProfileId === profile.id && ['ASSIGNED','RUNNING','RESULT_READY','DOWNLOADING'].includes(j.managerStatus));
      if (!stillOwned && assignment.status !== 'COMPLETE') {
        assignment.status = 'COMPLETE';
        assignment.completedAt = nowIso();
        addEvent('ASSIGN_COMPLETE', `${assignment.id} concluído em ${profile.id}`, { profileId: profile.id, batchId: assignment.batchId, assignmentId: assignment.id });
      }
    }
  }
  finalizeBatches();
}

function activeAssignmentForProfile(profileId) {
  return state.assignments.slice().reverse().find(a => a.profileId === profileId && ['ASSIGNED','ACTIVE','REDISPATCH'].includes(a.status));
}

function assignmentCommand(assignment, profile, reason = 'DISPATCH') {
  if (!assignment || !profile) return null;
  const batch = state.batches.find(b => b.batchId === assignment.batchId);
  if (!batch) return null;
  // Só reidrata JOBs que ainda pertencem a este assignment/perfil e que não terminaram.
  const jobs = assignment.jobIds
    .map(id => findJob(id)?.job)
    .filter(j => j && j.assignmentId === assignment.id && j.assignedProfileId === profile.id && ['ASSIGNED','RUNNING','RESULT_READY','DOWNLOADING'].includes(j.managerStatus));
  if (!jobs.length) return null;
  assignment.status = 'ASSIGNED';
  assignment.updatedAt = nowIso();
  assignment.lastStartCommandAt = nowIso();
  assignment.redispatchCount = Number(assignment.redispatchCount || 0) + (reason === 'RECOVERY' ? 1 : 0);
  const text = buildAssignmentText(batch, jobs, assignment, profile);
  if (reason === 'RECOVERY') {
    addEvent('ASSIGN_RECOVERY', `${jobs.length} JOB(s) do assignment ${assignment.id} reenviados para ${profile.id} após detectar estado local ausente.`, {
      profileId: profile.id, batchId: batch.batchId, assignmentId: assignment.id
    });
  }
  saveSoon();
  return {
    type: 'START_BATCH',
    recovery: reason === 'RECOVERY',
    assignmentId: assignment.id,
    batchId: batch.batchId,
    text,
    name: `manager_${batch.batchId.replace(/[^a-z0-9_-]+/gi, '_')}_${assignment.id}.txt`
  };
}

function buildAssignmentText(batch, jobs, assignment, profile) {
  const lines = [
    '[FLOW_BATCH]', 'VERSION=1.1', '',
    `PROJECT_ID=${batch.projectId}`, `BATCH_ID=${batch.batchId}`, `QUANTIDADE=${jobs.length}`,
    ...(batch.testMode ? ['TEST_MODE=TRUE'] : []),
    ...(batch.appDelivery ? ['DELIVERY_MODE=APP'] : []),
    'MANAGER_CONTROLLED=1', `MANAGER_ASSIGNMENT_ID=${assignment.id}`, `MANAGER_PROFILE_ID=${profile.id}`, ''
  ];
  for (const job of jobs) {
    lines.push(`[ID:${job.id}]`);
    lines.push(`JOB_ID=${job.jobId}`);
    lines.push(`SLOT=${job.slot}`);
    lines.push(`ARQUIVO_FINAL=${job.arquivoFinal}`);
    // V4.2.0: ao recuperar um assignment, RUNNING significa que o prompt já foi
    // enviado. O Worker deve reconstruir o tracking/asset, nunca gerar de novo.
    lines.push(`MANAGER_STATUS=${job.managerStatus || 'ASSIGNED'}`);
    lines.push(`WORKER_STATUS=${job.workerStatus || ''}`);
    lines.push(`SEND_SEQUENCE=${job.result?.sendSequence || 0}`);
    lines.push(`GENERATION_SEQUENCE=${job.result?.generationSequence || 0}`);
    lines.push(`TENTATIVA=${Math.max(1, job.tentativa + job.attempts)}`);
    if (job.testErrorCode) lines.push(`TEST_ERROR_CODE=${job.testErrorCode}`);
    if (job.testErrorProfile) lines.push(`TEST_ERROR_PROFILE=${job.testErrorProfile}`);
    if (job.metadata) lines.push(`METADATA=${job.metadata}`);
    lines.push(`PROMPT=${job.prompt}`);
    lines.push('');
  }
  return lines.join('\n');
}


// V4.2.5 — GLOBAL PROFILE PREFLIGHT
// Ao iniciar, o Manager primeiro aquece/revalida todos os perfis habilitados.
// A fila só é liberada depois que os Workers saudáveis chegaram em PROJECT_READY
// ou quando a janela de preflight expira. Assim o scheduler conhece quais contas
// realmente estão online antes de montar a primeira onda.
function preflightEligibleProfiles() {
  expireProfileLimits('PREFLIGHT');
  return state.profiles
    .filter(p => p && p.enabled !== false && !['PAUSED','LIMIT_REACHED','REMOVED'].includes(p.status))
    .sort((a,b) => String(a.id).localeCompare(String(b.id)));
}

function isProfileHealthyReady(profile) {
  if (!profile || profile.enabled === false) return false;
  if (['PAUSED','LIMIT_REACHED','REMOVED','OFFLINE','STARTING'].includes(profile.status)) return false;
  const maxAge = asInt(state.settings.heartbeatOfflineSeconds, 20, 5, 300) * 1000;
  const seen = profile.lastSeenAt ? Date.parse(profile.lastSeenAt) : 0;
  const recent = seen && (Date.now() - seen <= maxAge);
  return !!recent && profile.workspaceReady === true && ['AVAILABLE','BUSY'].includes(profile.status);
}

function beginGlobalPreflight(reason = 'MANAGER_START') {
  expireProfileLimits(reason);
  const waitMs = asInt(state.settings.preflightWaitSeconds, 30, 5, 180) * 1000;
  const startedAt = nowIso();
  state.scheduler = {
    ...(state.scheduler || {}),
    preflightState: 'WARMING',
    preflightStartedAt: startedAt,
    preflightUntil: new Date(Date.now() + waitMs).toISOString(),
    preflightFinishedAt: '',
    preflightReadyProfiles: [],
    preflightUnavailableProfiles: [],
    preflightUnavailableReasons: {},
    preflightLateReadyProfiles: [],
    preflightReason: reason
  };
  const eligible = preflightEligibleProfiles();
  addEvent('PREFLIGHT_START', `Aquecimento iniciado: ${eligible.length} perfil(is) habilitado(s). A fila aguardará PROJECT_READY por até ${Math.round(waitMs/1000)}s.`, { profiles:eligible.map(p=>p.id), reason });
  return eligible;
}

function globalPreflightGate() {
  if (state.control?.running !== true) return { open:false, state:'STOPPED', ready:[], eligible:[], unavailable:[], remainingMs:0 };
  if (state.scheduler?.preflightState !== 'WARMING') {
    const eligibleNow = preflightEligibleProfiles();
    let ids = Array.isArray(state.scheduler?.preflightReadyProfiles) ? state.scheduler.preflightReadyProfiles.slice() : [];

    // V4.2.7 — LATE READY PROMOTION
    // O snapshot do preflight é diagnóstico, não uma lista de exclusão permanente.
    // Se um perfil termina o login/New Project poucos segundos depois do timeout,
    // ele é promovido para READY enquanto a primeira onda ainda não foi distribuída.
    const currentlyReady = eligibleNow.filter(isProfileHealthyReady).map(p => p.id);
    const lateReady = currentlyReady.filter(id => !ids.includes(id));
    if (lateReady.length) {
      ids = Array.from(new Set([...ids, ...lateReady])).sort();
      state.scheduler.preflightState = 'READY';
      state.scheduler.preflightReadyProfiles = ids;
      state.scheduler.preflightUnavailableProfiles = eligibleNow.filter(p=>!ids.includes(p.id)).map(p=>p.id);
      state.scheduler.preflightUnavailableReasons = Object.fromEntries(
        eligibleNow.filter(p=>!ids.includes(p.id)).map(p => [p.id, preflightReasonForProfile(p)])
      );
      state.scheduler.preflightLateReadyProfiles = Array.from(new Set([
        ...(state.scheduler.preflightLateReadyProfiles || []),
        ...lateReady
      ])).sort();
      addEvent('PREFLIGHT_LATE_READY', `Worker(s) ficaram PROJECT_READY após o snapshot e foram reintegrados antes da distribuição: ${lateReady.join(', ')}.`, {
        ready: ids,
        lateReady,
        unavailableReasons: state.scheduler.preflightUnavailableReasons
      });
      saveSoon();
    }

    return { open:true, state:state.scheduler?.preflightState || 'READY', ready:ids.map(id=>state.profiles.find(p=>p.id===id)).filter(Boolean), eligible:eligibleNow, unavailable:eligibleNow.filter(p=>!ids.includes(p.id)), remainingMs:0 };
  }

  refreshOfflineProfiles();
  const eligible = preflightEligibleProfiles();
  const ready = eligible.filter(isProfileHealthyReady);
  const started = Date.parse(state.scheduler.preflightStartedAt || '') || Date.now();
  const waitMs = asInt(state.settings.preflightWaitSeconds, 30, 5, 180) * 1000;
  const elapsed = Date.now() - started;
  const timedOut = elapsed >= waitMs;
  const allReady = eligible.length > 0 && ready.length === eligible.length;
  const noEligible = eligible.length === 0;
  const open = allReady || timedOut || noEligible;

  if (open) {
    const readyIds = ready.map(p=>p.id);
    const unavailable = eligible.filter(p=>!readyIds.includes(p.id)).map(p=>p.id);
    state.scheduler.preflightState = readyIds.length ? 'READY' : 'NO_WORKERS_READY';
    state.scheduler.preflightFinishedAt = nowIso();
    state.scheduler.preflightReadyProfiles = readyIds;
    state.scheduler.preflightUnavailableProfiles = unavailable;
    const unavailableReasons = {};
    for (const profileId of unavailable) {
      const p = eligible.find(x => x.id === profileId) || state.profiles.find(x => x.id === profileId);
      unavailableReasons[profileId] = preflightReasonForProfile(p);
    }
    state.scheduler.preflightUnavailableReasons = unavailableReasons;
    state.scheduler.preflightLateReadyProfiles = state.scheduler.preflightLateReadyProfiles || [];
    state.scheduler.lastReason = allReady ? 'PREFLIGHT_ALL_READY' : (timedOut ? 'PREFLIGHT_TIMEOUT' : 'PREFLIGHT_NO_ELIGIBLE');
    const outText = unavailable.length ? ` · fora: ${unavailable.map(id => `${id}=${unavailableReasons[id]}`).join(' · ')}` : '';
    addEvent('PREFLIGHT_COMPLETE', `Aquecimento concluído: ${readyIds.length} pronto(s)${unavailable.length ? ` · ${unavailable.length} indisponível(is)` : ''}${outText}.`, { ready:readyIds, unavailable, unavailableReasons, timedOut, allReady });
    saveSoon();
  }

  return { open, state:state.scheduler.preflightState, ready, eligible, unavailable:eligible.filter(p=>!ready.includes(p)), remainingMs:Math.max(0, waitMs-elapsed), timedOut, allReady };
}

function preflightReadyProfileIds() {
  const ids = Array.isArray(state.scheduler?.preflightReadyProfiles) ? state.scheduler.preflightReadyProfiles : [];
  return new Set(ids);
}

// V4.2.4 — BALANCED INITIAL WAVE
// A primeira onda de um lote não pode ser capturada pelo primeiro heartbeat que
// chega. O Manager espera todos os perfis elegíveis ficarem PROJECT_READY ou um
// timeout curto. Ao liberar a onda, cria os assignments de TODOS os Workers de
// uma vez e divide os JOBs de forma equilibrada. Depois disso, o scheduler volta
// a ser dinâmico conforme cada Worker libera capacidade.
function eligibleProfilesForInitialWave() {
  // V4.2.7 — não congelar a elegibilidade no snapshot do preflight.
  // Todos os perfis habilitados continuam candidatos durante a janela de balanceamento.
  // Isso permite que um Worker que ficou PROJECT_READY alguns segundos atrasado participe
  // da primeira onda, em vez de ficar excluído por toda a produção.
  return state.profiles
    .filter(p => p && p.enabled !== false && !['PAUSED','LIMIT_REACHED','REMOVED'].includes(p.status))
    .sort((a,b) => String(a.id).localeCompare(String(b.id)));
}

function readyProfilesForInitialWave() {
  return eligibleProfilesForInitialWave()
    .filter(p => isProfileHealthyReady(p) && p.status === 'AVAILABLE' && !activeAssignmentForProfile(p.id));
}

function resetSchedulerWave(reason = '') {
  state.scheduler = {
    ...(state.scheduler || {}),
    waveId: uid('WAVE'),
    waitStartedAt: '',
    waitUntil: '',
    initialBatchId: '',
    lastPlanAt: '',
    lastPlanProfiles: [],
    lastReason: reason || ''
  };
}

function ensureBatchBalanceGate(batch) {
  if (!batch || batch.initialWavePlannedAt) return { open:true, ready:[], eligible:[], remainingMs:0 };
  const activeAlready = batch.jobs.some(j => ['ASSIGNED','RUNNING','RESULT_READY','DOWNLOADING','DONE'].includes(j.managerStatus));
  if (activeAlready) {
    batch.initialWavePlannedAt = batch.initialWavePlannedAt || nowIso();
    batch.initialWaveProfiles = batch.initialWaveProfiles || [];
    return { open:true, ready:readyProfilesForInitialWave(), eligible:eligibleProfilesForInitialWave(), remainingMs:0 };
  }

  const eligible = eligibleProfilesForInitialWave();
  const ready = readyProfilesForInitialWave();
  const waitMs = asInt(state.settings.initialBalanceWaitSeconds, 25, 3, 120) * 1000;
  if (!batch.balanceWaitStartedAt) {
    batch.balanceWaitStartedAt = nowIso();
    batch.balanceWaitUntil = new Date(Date.now() + waitMs).toISOString();
    state.scheduler = {
      ...(state.scheduler || {}),
      waveId: state.scheduler?.waveId || uid('WAVE'),
      waitStartedAt: batch.balanceWaitStartedAt,
      waitUntil: batch.balanceWaitUntil,
      initialBatchId: batch.batchId,
      lastReason: 'WAITING_PROJECT_READY'
    };
    addEvent('BALANCE_WAIT', `${batch.batchId}: aguardando todos os perfis habilitados ficarem PROJECT_READY; perfis que chegarem atrasados ainda entram na primeira onda. Elegíveis: ${eligible.length || 0}. Timeout ${Math.round(waitMs/1000)}s.`, { batchId:batch.batchId, eligible:eligible.map(p=>p.id) });
  }

  const started = Date.parse(batch.balanceWaitStartedAt) || Date.now();
  const elapsed = Date.now() - started;
  const allReady = eligible.length > 0 && ready.length >= eligible.length;
  const timedOut = elapsed >= waitMs;
  const open = ready.length > 0 && (allReady || timedOut);
  return { open, ready, eligible, remainingMs:Math.max(0, waitMs-elapsed), allReady, timedOut };
}

function createAssignmentForProfile(profile, batch, selected, meta = {}) {
  if (!profile || !batch || !Array.isArray(selected) || !selected.length) return null;
  const burst = asInt(state.settings.burstSize, 5, 1, 20);
  const assignment = {
    id: uid('ASSIGN'), profileId: profile.id, workerId: profile.workerId || '', batchId: batch.batchId,
    jobIds: selected.map(j => j.jobId), status: 'ASSIGNED', createdAt: nowIso(), updatedAt: nowIso(),
    burstLimit: burst,
    fairShare: Number(meta.fairShare || selected.length),
    readyWorkersAtDispatch: Number(meta.readyCount || 1),
    dispatchReason: String(meta.reason || 'DYNAMIC'),
    workerAckAt: '',
    firstSentAt: '',
    lastStartCommandAt: '',
    forceStartCount: 0,
    lastForceStartAt: '',
    workspaceReloadCount: 0,
    lastWorkspaceReloadAt: ''
  };
  for (const job of selected) {
    job.managerStatus = 'ASSIGNED';
    job.workerStatus = 'pending';
    job.assignedProfileId = profile.id;
    job.lastProfileId = profile.id;
    job.assignmentId = assignment.id;
    job.assignedAt = nowIso();
    job.updatedAt = nowIso();
    if (!Array.isArray(job.workerHistory)) job.workerHistory = [];
    job.workerHistory.push({ profileId: profile.id, assignmentId: assignment.id, assignedAt: job.assignedAt });
  }
  state.assignments.push(assignment);
  if (state.assignments.length > 500) state.assignments.splice(0, state.assignments.length - 500);
  profile.status = 'BUSY';
  profile.currentBatchId = batch.batchId;
  profile.currentJobs = selected.length;
  addEvent('ASSIGN', `${selected.length} JOB(s) → ${profile.id} · ${assignment.dispatchReason} · burst ${burst}`, {
    profileId: profile.id, batchId: batch.batchId, assignmentId: assignment.id, dispatchReason: assignment.dispatchReason
  });
  return assignment;
}

function planBalancedInitialWave(batch) {
  const gate = ensureBatchBalanceGate(batch);
  if (!gate.open || batch.initialWavePlannedAt) return { planned:false, ...gate };

  const workers = gate.ready.slice().sort((a,b) => String(a.id).localeCompare(String(b.id)));
  const pending = batch.jobs.filter(j => j.managerStatus === 'PENDING');
  if (!workers.length || !pending.length) return { planned:false, ...gate };

  const burst = asInt(state.settings.burstSize, 5, 1, 20);
  const assignableCount = Math.min(pending.length, workers.length * burst);
  const base = Math.floor(assignableCount / workers.length);
  let remainder = assignableCount % workers.length;
  let cursor = 0;
  const created = [];

  for (const profile of workers) {
    const count = Math.min(burst, base + (remainder-- > 0 ? 1 : 0));
    if (count <= 0) continue;
    const selected = pending.slice(cursor, cursor + count);
    cursor += selected.length;
    if (!selected.length) continue;
    const assignment = createAssignmentForProfile(profile, batch, selected, {
      fairShare: count,
      readyCount: workers.length,
      reason: 'BALANCED_INITIAL_WAVE'
    });
    if (assignment) created.push(assignment);
  }

  batch.initialWavePlannedAt = nowIso();
  batch.initialWaveProfiles = created.map(a => a.profileId);
  batch.initialWaveAssignments = created.map(a => a.id);
  state.scheduler = {
    ...(state.scheduler || {}),
    lastPlanAt: batch.initialWavePlannedAt,
    lastPlanProfiles: batch.initialWaveProfiles.slice(),
    initialBatchId: batch.batchId,
    lastReason: gate.allReady ? 'ALL_ELIGIBLE_READY' : 'BALANCE_TIMEOUT'
  };
  addEvent('BALANCE_PLAN', `${batch.batchId}: primeira onda distribuída entre ${created.length} Worker(s) — ${created.map(a => `${a.profileId}:${a.jobIds.length}`).join(' · ')}`, {
    batchId:batch.batchId, profiles:batch.initialWaveProfiles, assignments:batch.initialWaveAssignments, reason:state.scheduler.lastReason
  });
  saveSoon();
  return { planned:true, created, ...gate };
}

function readyProfilesForDispatch() {
  return state.profiles.filter(p => p.status === 'AVAILABLE' && p.enabled !== false && !activeAssignmentForProfile(p.id));
}

function claimForProfile(profile) {
  if (state.control?.running !== true) return null;
  if (profile.status !== 'AVAILABLE' || profile.enabled === false) return null;
  if (activeAssignmentForProfile(profile.id)) return null;

  // A fila não começa enquanto o aquecimento global ainda está verificando os perfis.
  const preflight = globalPreflightGate();
  if (!preflight.open) return null;

  for (const batch of state.batches) {
    const pending = batch.jobs.filter(j => j.managerStatus === 'PENDING');
    if (!pending.length) continue;

    if (!batch.initialWavePlannedAt) {
      const plan = planBalancedInitialWave(batch);
      if (!plan.planned && !batch.initialWavePlannedAt) return null;
      const reserved = activeAssignmentForProfile(profile.id);
      if (reserved) return assignmentCommand(reserved, profile, 'DISPATCH');
      if (profile.status !== 'AVAILABLE') return null;
    }

    const burst = asInt(state.settings.burstSize, 5, 1, 20);
    const ready = readyProfilesForDispatch();
    const readyCount = Math.max(1, ready.length);
    const fairShare = Math.max(1, Math.ceil(pending.length / readyCount));
    const take = Math.min(burst, fairShare, pending.length);
    const selected = pending.slice(0, take);
    const assignment = createAssignmentForProfile(profile, batch, selected, {
      fairShare,
      readyCount,
      reason: 'DYNAMIC_CAPACITY'
    });
    saveSoon();
    return assignmentCommand(assignment, profile, 'DISPATCH');
  }
  return null;
}

function hasPendingJobsForDispatch() {
  return state.batches.some(batch => batch.jobs.some(job => job.managerStatus === 'PENDING'));
}

function detachBatchAssignments(batchId, status = 'CANCELLED') {
  const affectedProfiles = new Set();
  for (const assignment of state.assignments) {
    if (assignment.batchId !== batchId) continue;
    if (['ASSIGNED','ACTIVE','REDISPATCH'].includes(assignment.status)) {
      assignment.status = status;
      assignment.updatedAt = nowIso();
      affectedProfiles.add(assignment.profileId);
    }
  }
  return affectedProfiles;
}

function resetJobForRegeneration(job) {
  job.managerStatus = 'PENDING';
  job.workerStatus = 'pending';
  job.assignedProfileId = '';
  job.assignmentId = '';
  job.attempts = 0;
  job.assignedAt = '';
  job.startedAt = '';
  job.completedAt = '';
  job.lastProfileId = '';
  job.workerHistory = [];
  job.updatedAt = nowIso();
  job.result = null;
}

function releaseProfilesAfterQueueMutation(profileIds = new Set()) {
  for (const profileId of profileIds) {
    const profile = state.profiles.find(p => p.id === profileId && p.status !== 'REMOVED');
    if (!profile) continue;
    profile.currentBatchId = '';
    profile.currentJobs = 0;
    if (!['PAUSED','LIMIT_REACHED','OFFLINE','STARTING'].includes(profile.status)) profile.status = 'AVAILABLE';
  }
}

function commandForWorker(profile, workerState) {
  const localAssignmentId = workerState?.managerAssignmentId || workerState?.batch?.managerAssignmentId || '';
  const workspaceReady = workerState?.workspace?.ready === true;
  const localAssignment = localAssignmentId ? state.assignments.find(a => a.id === localAssignmentId) : null;
  const managerAssignment = activeAssignmentForProfile(profile.id);

  // Controle global do Manager. PARAR precisa cortar o atuador de verdade (HARD STOP),
  // não apenas deixar de distribuir novos JOBs. O assignment permanece preservado
  // para que INICIAR possa continuar exatamente de onde parou.
  if (state.control?.running !== true) {
    const needsHardStop = !!workerState?.running || !!workerState?.captureArmed || !!localAssignmentId;
    if (needsHardStop && workerState?.managerHold !== true) return { type: 'MANAGER_HARD_STOP' };
    return { type: 'MANAGER_HOLD' };
  }

  if (profile.status === 'PAUSED') return { type: 'PAUSE' };
  if (profile.status === 'LIMIT_REACHED') return { type: 'LIMIT_HOLD' };
  if (workerState?.managerHold === true) return { type: 'MANAGER_START' };

  // V4.2.0 — WORKSPACE PREFLIGHT / PROFILE PREWARM
  // Todo perfil habilitado e online é colocado em PROJECT_READY assim que o Manager
  // entra em execução. Isso evita que um terceiro/quarto perfil permaneça na home
  // apenas porque os primeiros Workers já consumiram a fila. Assignments continuam
  // sendo entregues somente depois que o compositor do Flow estiver pronto.
  if (!workspaceReady && !workerState?.running) {
    return {
      type: 'PREPARE_WORKSPACE',
      assignmentId: localAssignmentId || managerAssignment?.id || '',
      reason: localAssignmentId ? 'LOCAL_ASSIGNMENT_NOT_READY' : (managerAssignment ? 'MANAGER_ASSIGNMENT_NOT_READY' : (hasPendingJobsForDispatch() ? 'PENDING_QUEUE' : 'PROFILE_PREWARM'))
    };
  }

  if (localAssignmentId) {
    const assignment = localAssignment;
    const owned = assignment?.jobIds.map(id => findJob(id)?.job).filter(j => j && j.assignmentId === localAssignmentId && j.assignedProfileId === profile.id) || [];
    const hasActiveOwned = owned.some(j => ['ASSIGNED','RUNNING','RESULT_READY','DOWNLOADING'].includes(j.managerStatus));
    if (!hasActiveOwned && !workerState.running) return { type: 'RESET_LOCAL', assignmentId: localAssignmentId };

    // V4.2.9 — ASSIGNMENT START WATCHDOG
    // PROJECT_READY + assignment local não é suficiente: exigimos que o primeiro
    // prompt realmente saia. Se o Worker ficar parado em ASSIGNED, forçamos o start
    // e, persistindo o travamento, recarregamos o mesmo workspace sem gerar duplicata.
    if (assignment && hasActiveOwned) {
      const remotePrompts = Array.isArray(workerState.prompts) ? workerState.prompts : [];
      const hasStartedRemote = remotePrompts.some(j => ['sent','generating','result_ready','downloading','done'].includes(String(j?.status || '').toLowerCase()));
      if (hasStartedRemote && !assignment.firstSentAt) assignment.firstSentAt = nowIso();

      if (!hasStartedRemote && !workerState.running && workspaceReady) {
        const baseTs = Date.parse(assignment.workerAckAt || assignment.createdAt || assignment.updatedAt || '') || Date.now();
        const idleMs = Date.now() - baseTs;
        const lastForce = Date.parse(assignment.lastForceStartAt || '') || 0;
        const lastReload = Date.parse(assignment.lastWorkspaceReloadAt || '') || 0;
        const forceCount = Number(assignment.forceStartCount || 0);
        const reloadCount = Number(assignment.workspaceReloadCount || 0);

        if (idleMs >= 7000 && forceCount < 2 && (!lastForce || Date.now() - lastForce >= 6500)) {
          assignment.forceStartCount = forceCount + 1;
          assignment.lastForceStartAt = nowIso();
          assignment.updatedAt = nowIso();
          addEvent('ASSIGN_FORCE_START', `${profile.id}: assignment ${assignment.id} está PROJECT_READY mas sem primeiro SENT; FORCE START ${assignment.forceStartCount}/2.`, { profileId:profile.id, assignmentId:assignment.id, startHealth:workerState.startHealth || {} });
          saveSoon();
          return { type:'FORCE_START_ASSIGNMENT', assignmentId:assignment.id, attempt:assignment.forceStartCount, reason:'ASSIGNED_WITHOUT_FIRST_SENT' };
        }

        if (idleMs >= 22000 && forceCount >= 2 && reloadCount < 1 && (!lastReload || Date.now() - lastReload >= 10000)) {
          assignment.workspaceReloadCount = reloadCount + 1;
          assignment.lastWorkspaceReloadAt = nowIso();
          assignment.updatedAt = nowIso();
          addEvent('ASSIGN_START_RELOAD', `${profile.id}: assignment ${assignment.id} não iniciou após FORCE START; recarregando workspace e preservando os JOBs.`, { profileId:profile.id, assignmentId:assignment.id, startHealth:workerState.startHealth || {} });
          saveSoon();
          return { type:'RELOAD_WORKSPACE_FOR_ASSIGNMENT', assignmentId:assignment.id, reason:'START_WATCHDOG_RELOAD' };
        }
      }
    }
    return null;
  }

  // V4.2.0: recuperação de assignment órfão/localmente perdido.
  // Isto ocorre, por exemplo, quando a versão anterior marcou JOBs ASSIGNED no Manager,
  // mas o Worker foi reiniciado/limpo antes de persistir o START_BATCH. Antes desta correção,
  // activeAssignmentForProfile() bloqueava um novo claim e o botão INICIAR parecia não fazer nada.
  const orphan = managerAssignment;
  if (orphan) {
    const recovery = assignmentCommand(orphan, profile, 'RECOVERY');
    if (recovery) return recovery;
    // Assignment sem JOBs ativos: encerra o registro obsoleto e libera novos claims.
    orphan.status = 'COMPLETE';
    orphan.updatedAt = nowIso();
    addEvent('ASSIGN_STALE_CLEARED', `Assignment ${orphan.id} não possuía JOBs ativos e foi liberado.`, { profileId: profile.id, assignmentId: orphan.id });
    saveSoon();
  }
  return claimForProfile(profile);
}

function managerStatusRank(value) {
  return ({ PENDING:0, ASSIGNED:1, RUNNING:2, RESULT_READY:3, DOWNLOADING:4, DONE:5, FAILED:5, MANUAL_REVIEW:5 })[String(value || '').toUpperCase()] ?? -1;
}
function canAdvanceManagerStatus(current, next) {
  if (!next) return false;
  if (['DONE','FAILED','MANUAL_REVIEW'].includes(current)) return current === next;
  return managerStatusRank(next) >= managerStatusRank(current);
}

function applyWorkerLifecycleEvent(profile, body) {
  const event = body?.event || {};
  const assignmentId = String(event.assignmentId || '');
  const jobId = String(event.jobId || '');
  const lifecycle = String(event.lifecycle || '').toUpperCase();
  const at = String(event.at || nowIso());
  const data = event.data || {};
  if (!assignmentId || !jobId || !lifecycle) throw new Error('Evento lifecycle incompleto');

  const found = findJob(jobId);
  if (!found) throw new Error(`JOB não encontrado: ${jobId}`);
  const { batch, job } = found;
  if (job.assignmentId !== assignmentId || job.assignedProfileId !== profile.id) {
    return { ignored:true, reason:'ASSIGNMENT_MISMATCH', managerStatus:job.managerStatus };
  }

  const r = job.result = { ...(job.result || {}), profileId:profile.id };
  job.workerStatus = String(data.workerStatus || job.workerStatus || '').toLowerCase();
  job.lastProfileId = profile.id;
  job.updatedAt = nowIso();

  let nextStatus = '';
  if (lifecycle === 'SENT') {
    r.sentAt = r.sentAt || data.sentAt || at;
    r.sendSequence = Number(data.sendSequence || r.sendSequence || 0);
    nextStatus = 'RUNNING';
  } else if (lifecycle === 'GENERATION_STARTED') {
    r.sentAt = r.sentAt || data.sentAt || '';
    r.generationDetectedAt = r.generationDetectedAt || data.generationDetectedAt || at;
    r.generationSequence = Number(data.generationSequence || r.generationSequence || 0);
    r.mappingMethod = data.mappingMethod || r.mappingMethod || '';
    if (data.mappingConfidence != null) r.mappingConfidence = data.mappingConfidence;
    nextStatus = 'RUNNING';
  } else if (lifecycle === 'RESULT_READY') {
    r.resultDetectedAt = r.resultDetectedAt || data.resultDetectedAt || at;
    if (data.generationDetectedAt) r.generationDetectedAt = r.generationDetectedAt || data.generationDetectedAt;
    nextStatus = 'RESULT_READY';
  } else if (lifecycle === 'DOWNLOAD_REQUESTED') {
    r.resultDetectedAt = r.resultDetectedAt || data.resultDetectedAt || at;
    r.downloadRequestIssuedAt = r.downloadRequestIssuedAt || data.downloadRequestIssuedAt || at;
    nextStatus = 'DOWNLOADING';
  } else if (lifecycle === 'DONE') {
    r.doneAt = r.doneAt || data.doneAt || at;
    r.file = data.file || r.file || '';
    if (data.downloadRequestIssuedAt) r.downloadRequestIssuedAt = r.downloadRequestIssuedAt || data.downloadRequestIssuedAt;
    if (data.resultDetectedAt) r.resultDetectedAt = r.resultDetectedAt || data.resultDetectedAt;
    if (data.generationDetectedAt) r.generationDetectedAt = r.generationDetectedAt || data.generationDetectedAt;
    nextStatus = 'DONE';
    job.completedAt = r.doneAt;
  } else if (lifecycle === 'FAILED') {
    r.failureAt = r.failureAt || data.failureAt || at;
    r.errorCode = data.errorCode || r.errorCode || 'UNKNOWN_ERROR';
    r.errorClass = data.errorClass || r.errorClass || '';
    r.nextAction = data.nextAction || r.nextAction || '';
    r.error = data.error || r.error || '';
    nextStatus = data.nextAction === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'FAILED';
    job.completedAt = r.failureAt;
  }

  if (nextStatus && canAdvanceManagerStatus(job.managerStatus, nextStatus)) {
    const oldStatus = job.managerStatus;
    job.managerStatus = nextStatus;
    if (nextStatus === 'RUNNING') job.startedAt = r.sentAt || job.startedAt || at;
    if (oldStatus !== nextStatus) {
      const names = { RUNNING:'JOB_RUNNING_PUSH', RESULT_READY:'RESULT_READY_PUSH', DOWNLOADING:'JOB_DOWNLOADING_PUSH', DONE:'JOB_DONE_PUSH', FAILED:'JOB_FAILED_PUSH', MANUAL_REVIEW:'JOB_FAILED_PUSH' };
      addEvent(names[nextStatus] || 'JOB_TELEMETRY', `${job.slot} → ${nextStatus} em ${profile.id}`, { profileId:profile.id, batchId:batch.batchId, jobId:job.jobId, lifecycle });
    }
  }

  finalizeBatches();
  saveSoon();
  return { ignored:false, managerStatus:job.managerStatus };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'access-control-allow-origin': '*', 'access-control-allow-private-network':'true', 'cache-control': 'no-store, no-cache, must-revalidate' });
  res.end(body);
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-private-network':'true', 'cache-control': 'no-store, no-cache, must-revalidate' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5_000_000) { reject(new Error('Body muito grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function serveStatic(res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, target));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8' };
  text(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin':'*', 'access-control-allow-private-network':'true', 'access-control-allow-methods':'GET,POST,OPTIONS', 'access-control-allow-headers':'content-type' }); return res.end(); }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok:true, version:state.version, appIntegration:'1.1', time:nowIso() });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ok:true, state:publicState() });

    if (req.method === 'GET' && url.pathname === '/api/batch/manifest') {
      const batchId = url.searchParams.get('batchId') || '';
      const batch = state.batches.find(b => b.batchId === batchId);
      if (!batch) return json(res, 404, { ok:false, error:'Batch não encontrado' });
      finalizeBatches();
      const manifest = batch.manifest || managerManifestForBatch(batch);
      const filename = `${safeManifestFileName(batch.batchId)}_result.txt`;
      return json(res, 200, { ok:true, batchId:batch.batchId, filename, complete:batchSummary(batch).status === 'COMPLETE', manifest });
    }

    if (req.method === 'GET' && url.pathname === '/api/batch/asset') {
      const batchId = String(url.searchParams.get('batchId') || '');
      const jobId = String(url.searchParams.get('jobId') || '');
      const batch = state.batches.find(b => b.batchId === batchId);
      const job = batch?.jobs?.find(j => j.jobId === jobId);
      if (!batch || !job) return json(res, 404, { ok:false, error:'Asset/JOB não encontrado' });
      const meta = appAssetMeta(job);
      const file = String(job.result?.appAssetPath || '');
      if (!meta.ready || !file) return json(res, 404, { ok:false, error:'Asset APP ainda não está disponível' });
      const bytes = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type':meta.contentType || 'application/octet-stream',
        'content-length':bytes.length,
        'content-disposition':`inline; filename="${String(meta.filename || job.arquivoFinal || 'asset').replace(/["\r\n]/g, '_')}"`,
        'access-control-allow-origin':'*', 'access-control-allow-private-network':'true', 'cache-control':'no-store, no-cache, must-revalidate'
      });
      return res.end(bytes);
    }


    if (req.method === 'GET' && url.pathname === '/api/config/export') {
      const config = buildConfigBackup();
      addEvent('CONFIG_EXPORT', `${config.profiles.length} perfil(is) exportados para backup de configuracao.`);
      return json(res, 200, { ok:true, config });
    }

    if (req.method === 'POST' && url.pathname === '/api/config/import') {
      const body = await readBody(req);
      const result = importConfigBackup(body.config || body);
      return json(res, 200, { ok:true, result, settings:state.settings });
    }

    if (req.method === 'GET' && url.pathname === '/worker-bootstrap') {
      const profileId = url.searchParams.get('profileId') || '';
      return text(res, 200, `<!doctype html><meta charset="utf-8"><title>Corvo Flow Worker</title><style>body{font-family:Arial;background:#11131a;color:#eee;padding:28px}code{color:#67e8f9}</style><h2>Corvo Flow Worker</h2><p>Vinculando este navegador ao perfil <code>${profileId.replace(/[<>&]/g,'')}</code>...</p><p id="corvo-bootstrap-status">Aguardando a extensão vincular este perfil...</p><p>O Flow abrirá em outra aba. Havendo demanda pendente, o Manager mandará o Worker preparar New project e só depois sincronizará os JOBs.</p>`, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/add') {
      const body = await readBody(req);
      const id = nextProfileId();
      const profile = { id, label: sanitizeLabel(body.label) || id, token: crypto.randomBytes(18).toString('hex'), status:'OFFLINE', enabled:true, createdAt:nowIso(), lastSeenAt:'', limitDetectedAt:'', lastError:'' };
      state.profiles.push(profile);
      fs.mkdirSync(profileDir(id), { recursive: true });
      addEvent('PROFILE_ADD', `${id} cadastrado`, { profileId:id });
      saveNow();
      let pid = null, launchError = '';
      if (body.open !== false) { try { pid = launchProfile(profile); } catch (e) { launchError = e.message; profile.lastError = launchError; saveSoon(); } }
      return json(res, 200, { ok:true, profile:{ id:profile.id, label:profile.label, status:profile.status }, pid, launchError });
    }

    if (req.method === 'POST' && url.pathname === '/api/profile/action') {
      const body = await readBody(req);
      const profile = state.profiles.find(p => p.id === body.profileId && p.status !== 'REMOVED');
      if (!profile) return json(res, 404, { ok:false, error:'Perfil não encontrado' });
      const action = String(body.action || '').toLowerCase();
      if (action === 'open' || action === 'test') {
        const pid = launchProfile(profile);
        return json(res, 200, { ok:true, pid });
      }
      if (action === 'pause') {
        profile.status = 'PAUSED'; profile.enabled = false; addEvent('PROFILE_PAUSE', `${profile.id} pausado`, {profileId:profile.id}); saveSoon();
        return json(res, 200, { ok:true });
      }
      if (action === 'reactivate') {
        profile.status = 'OFFLINE'; profile.enabled = true; profile.limitDetectedAt = ''; profile.limitUntil = ''; profile.limitSource = ''; profile.lastError = ''; addEvent('PROFILE_REACTIVATE', `${profile.id} reativado`, {profileId:profile.id}); saveSoon();
        return json(res, 200, { ok:true });
      }
      if (action === 'remove') {
        if (activeAssignmentForProfile(profile.id)) return json(res, 409, { ok:false, error:'Perfil possui assignment ativo. Pause/aguarde antes de remover.' });
        profile.status = 'REMOVED'; profile.enabled = false; addEvent('PROFILE_REMOVE', `${profile.id} removido do Manager (dados de navegador preservados)`, {profileId:profile.id}); saveSoon();
        return json(res, 200, { ok:true, dataPreserved:true });
      }
      return json(res, 400, { ok:false, error:'Ação inválida' });
    }

    if (req.method === 'POST' && url.pathname === '/api/control') {
      const body = await readBody(req);
      const action = String(body.action || '').toLowerCase();
      if (action === 'start') {
        const requestedMode = String(body.mode || body.source || '').toUpperCase() === 'APP' ? 'APP' : 'MANUAL';
        state.control.running = true;
        state.control.changedAt = nowIso();
        state.control.lastAction = 'START';
        state.control.sessionMode = requestedMode;
        state.control.sessionId = uid(requestedMode === 'APP' ? 'app_session' : 'manual_session');
        resetSchedulerWave('MANAGER_START');
        const expiredLimits = expireProfileLimits('MANAGER_START');
        const preflightEligible = beginGlobalPreflight('MANAGER_START');
        // Marca assignments ainda ativos para reconciliação. Não reatribui nem duplica JOBs:
        // o Worker dono será quem confirma/recebe o mesmo assignment no próximo heartbeat.
        let recoverableAssignments = 0;
        for (const assignment of state.assignments) {
          if (!['ASSIGNED','ACTIVE','REDISPATCH'].includes(assignment.status)) continue;
          const active = assignment.jobIds.some(id => {
            const j = findJob(id)?.job;
            return j && j.assignmentId === assignment.id && j.assignedProfileId === assignment.profileId && ['ASSIGNED','RUNNING','RESULT_READY','DOWNLOADING'].includes(j.managerStatus);
          });
          if (active) { assignment.status = 'REDISPATCH'; assignment.updatedAt = nowIso(); recoverableAssignments += 1; }
        }
        addEvent('MANAGER_START', `Produção iniciada em PREFLIGHT; ${preflightEligible.length} perfil(is) serão aquecidos antes da fila. Limites antigos liberados: ${expiredLimits}. Assignments recuperáveis: ${recoverableAssignments}.`);
        saveNow();
        const autoLaunch = autoLaunchEnabledProfiles('MANAGER_START');
        return json(res, 200, { ok:true, control:state.control, recoverableAssignments, autoLaunch, expiredLimits, preflight:{ state:state.scheduler.preflightState, profiles:preflightEligible.map(p=>p.id), until:state.scheduler.preflightUntil } });
      }
      if (action === 'stop') {
        state.control.running = false;
        state.control.changedAt = nowIso();
        state.control.lastAction = 'STOP';
        addEvent('MANAGER_STOP', 'PARAR TUDO solicitado; Workers receberão HARD STOP no próximo heartbeat.');
        if (state.control?.sessionMode === 'APP') scheduleAppSessionProfileClose('APP_STOP');
        saveNow();
        return json(res, 200, { ok:true, control:state.control });
      }
      return json(res, 400, { ok:false, error:'Ação de controle inválida' });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(req);
      if (body.burstSize != null) state.settings.burstSize = asInt(body.burstSize, state.settings.burstSize, 1, 20);
      if (body.chromePath != null) state.settings.chromePath = String(body.chromePath || '').trim();
      if (body.flowUrl != null && /^https:\/\//i.test(String(body.flowUrl))) state.settings.flowUrl = String(body.flowUrl).trim();
      if (body.autoLaunchProfiles != null) state.settings.autoLaunchProfiles = body.autoLaunchProfiles !== false && String(body.autoLaunchProfiles).toLowerCase() !== 'false';
      if (body.autoLaunchCooldownSeconds != null) state.settings.autoLaunchCooldownSeconds = asInt(body.autoLaunchCooldownSeconds, state.settings.autoLaunchCooldownSeconds, 10, 300);
      if (body.initialBalanceWaitSeconds != null) state.settings.initialBalanceWaitSeconds = asInt(body.initialBalanceWaitSeconds, state.settings.initialBalanceWaitSeconds, 3, 120);
      if (body.preflightWaitSeconds != null) state.settings.preflightWaitSeconds = asInt(body.preflightWaitSeconds, state.settings.preflightWaitSeconds, 5, 180);
      if (body.limitHoldMinutes != null) state.settings.limitHoldMinutes = asInt(body.limitHoldMinutes, state.settings.limitHoldMinutes, 5, 1440);
      if (body.autoCloseProfilesAfterApp != null) state.settings.autoCloseProfilesAfterApp = body.autoCloseProfilesAfterApp !== false && String(body.autoCloseProfilesAfterApp).toLowerCase() !== 'false';
      if (body.appLaunchMinimized != null) state.settings.appLaunchMinimized = body.appLaunchMinimized !== false && String(body.appLaunchMinimized).toLowerCase() !== 'false';
      if (body.limitPhrases != null) {
        const raw = Array.isArray(body.limitPhrases) ? body.limitPhrases : String(body.limitPhrases || '').split(/\r?\n/);
        state.settings.limitPhrases = raw.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40);
      }
      saveNow();
      return json(res, 200, { ok:true, settings:state.settings });
    }

    if (req.method === 'POST' && url.pathname === '/api/batch/add') {
      const body = await readBody(req);
      const parsed = parseFlowBatch(body.text || '');
      if (state.batches.some(b => b.batchId === parsed.batchId && batchSummary(b).status !== 'COMPLETE')) return json(res, 409, { ok:false, error:`BATCH_ID já existe e ainda não foi concluído: ${parsed.batchId}` });
      const batch = { batchId:parsed.batchId, projectId:parsed.projectId, sourceName:sanitizeLabel(body.name)||'prompts.txt', testMode:/^(1|true|yes|sim)$/i.test(String(parsed.header.TEST_MODE || '')), appDelivery:parsed.appDelivery === true, createdAt:nowIso(), completedAt:'', completionEventAt:'', manifest:'', manifestFile:'', balanceWaitStartedAt:'', balanceWaitUntil:'', initialWavePlannedAt:'', initialWaveProfiles:[], initialWaveAssignments:[], jobs:parsed.jobs };
      state.batches.push(batch);
      if (state.control?.running === true) resetSchedulerWave('BATCH_ADD');
      addEvent('BATCH_ADD', `${batch.batchId}: ${batch.jobs.length} JOBs adicionados`, {batchId:batch.batchId});
      saveNow();
      const autoLaunch = state.control?.running === true ? autoLaunchEnabledProfiles('BATCH_ADD') : { attempted:0, launched:0, failed:0, profiles:[] };
      return json(res, 200, { ok:true, batchId:batch.batchId, jobs:batch.jobs.length, autoLaunch });
    }

    if (req.method === 'POST' && url.pathname === '/api/queue/action') {
      const body = await readBody(req);
      const action = String(body.action || '').toLowerCase();
      if (state.control?.running === true) {
        return json(res, 409, { ok:false, error:'Pare a produção antes de limpar/resetar a fila. Isso evita gerar ou baixar itens enquanto o estado é alterado.' });
      }

      if (action === 'clear_all') {
        const batchCount = state.batches.length;
        const jobCount = state.batches.reduce((n, b) => n + b.jobs.length, 0);
        const affectedProfiles = new Set(state.assignments.filter(a => ['ASSIGNED','ACTIVE','REDISPATCH'].includes(a.status)).map(a => a.profileId));
        for (const assignment of state.assignments) {
          if (['ASSIGNED','ACTIVE','REDISPATCH'].includes(assignment.status)) {
            assignment.status = 'CANCELLED'; assignment.updatedAt = nowIso();
          }
        }
        state.batches = [];
        // Mantemos somente um histórico curto de assignments encerrados para diagnóstico.
        state.assignments = state.assignments.filter(a => !['ASSIGNED','ACTIVE','REDISPATCH'].includes(a.status)).slice(-120);
        releaseProfilesAfterQueueMutation(affectedProfiles);
        addEvent('QUEUE_CLEAR', `Fila limpa: ${batchCount} lote(s), ${jobCount} JOB(s) removidos. Perfis e logins preservados.`);
        saveNow();
        return json(res, 200, { ok:true, batchesRemoved:batchCount, jobsRemoved:jobCount });
      }

      if (action === 'remove_batch') {
        const batch = state.batches.find(b => b.batchId === body.batchId);
        if (!batch) return json(res, 404, { ok:false, error:'Batch não encontrado' });
        const affectedProfiles = detachBatchAssignments(batch.batchId, 'CANCELLED');
        state.batches = state.batches.filter(b => b.batchId !== batch.batchId);
        releaseProfilesAfterQueueMutation(affectedProfiles);
        addEvent('BATCH_REMOVE', `${batch.batchId} removido da fila (${batch.jobs.length} JOBs).`, { batchId:batch.batchId });
        saveNow();
        return json(res, 200, { ok:true, jobsRemoved:batch.jobs.length });
      }

      if (action === 'reset_batch') {
        const batch = state.batches.find(b => b.batchId === body.batchId);
        if (!batch) return json(res, 404, { ok:false, error:'Batch não encontrado' });
        const affectedProfiles = detachBatchAssignments(batch.batchId, 'RESET');
        for (const job of batch.jobs) resetJobForRegeneration(job);
        batch.balanceWaitStartedAt=''; batch.balanceWaitUntil=''; batch.initialWavePlannedAt=''; batch.initialWaveProfiles=[]; batch.initialWaveAssignments=[];
        resetSchedulerWave('BATCH_RESET');
        releaseProfilesAfterQueueMutation(affectedProfiles);
        addEvent('BATCH_RESET', `${batch.batchId}: ${batch.jobs.length} JOB(s) voltaram a PENDING para gerar novamente.`, { batchId:batch.batchId });
        saveNow();
        return json(res, 200, { ok:true, jobsReset:batch.jobs.length });
      }

      return json(res, 400, { ok:false, error:'Ação de fila inválida' });
    }

    if (req.method === 'POST' && url.pathname === '/api/worker/bootstrap') {
      const body = await readBody(req);
      const profile = state.profiles.find(p => p.id === body.profileId && p.status !== 'REMOVED');
      if (!profile || !body.token || body.token !== profile.token) return json(res, 403, { ok:false, error:'Binding de perfil inválido' });
      profile.lastSeenAt = nowIso();
      profile.workerId = body.workerId || `FLOW_WORKER_${profile.id}`;
      profile.lastError = '';
      if (!['PAUSED','LIMIT_REACHED'].includes(profile.status)) profile.status = 'STARTING';
      addEvent('WORKER_BOUND', `${profile.id} vinculado à extensão; aguardando heartbeat do Flow.`, { profileId:profile.id });
      saveSoon();
      return json(res, 200, { ok:true, profileId:profile.id, status:profile.status, managerVersion:state.version, flowUrl:state.settings.flowUrl || DEFAULT_FLOW_URL });
    }

    if (req.method === 'POST' && url.pathname === '/api/worker/asset') {
      let raw = '';
      await new Promise((resolve, reject) => {
        req.on('data', chunk => { raw += chunk; if (raw.length > 28_000_000) { reject(new Error('Asset APP muito grande')); req.destroy(); } });
        req.on('end', resolve); req.on('error', reject);
      });
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) { return json(res, 400, { ok:false, error:'JSON inválido' }); }
      const profile = state.profiles.find(p => p.id === body.profileId && p.token === body.token && p.status !== 'REMOVED');
      if (!profile) return json(res, 403, { ok:false, error:'Worker não autorizado' });
      const found = findJob(String(body.jobId || ''));
      if (!found) return json(res, 404, { ok:false, error:'JOB não encontrado' });
      const { batch, job } = found;
      if (!batch.appDelivery) return json(res, 409, { ok:false, error:'Este lote não usa DELIVERY_MODE=APP' });
      if (job.assignedProfileId && job.assignedProfileId !== profile.id) return json(res, 409, { ok:false, error:'JOB pertence a outro Worker' });
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) return json(res, 400, { ok:false, error:'Asset APP precisa ser data URL base64' });
      let bytes; try { bytes = Buffer.from(match[2], 'base64'); } catch (_) { return json(res, 400, { ok:false, error:'Base64 inválido' }); }
      if (!bytes.length || bytes.length > 18 * 1024 * 1024) return json(res, 413, { ok:false, error:'Asset APP vazio ou acima de 18 MB' });
      const filename = sanitizeLabel(body.filename || job.arquivoFinal || `${job.id}.png`).replace(/[^a-z0-9._-]+/gi, '_');
      const file = appAssetPath(batch.batchId, job.jobId, filename);
      fs.writeFileSync(file, bytes);
      job.result = { ...(job.result || {}), appAssetPath:file, appAssetFile:filename, appAssetContentType:String(body.contentType || match[1] || 'application/octet-stream'), appAssetSize:bytes.length, deliveryMode:'APP' };
      job.updatedAt = nowIso();
      addEvent('APP_ASSET_READY', `${job.slot}: asset entregue ao app (${Math.round(bytes.length/1024)} KB).`, { profileId:profile.id, batchId:batch.batchId, jobId:job.jobId });
      saveNow();
      return json(res, 200, { ok:true, batchId:batch.batchId, jobId:job.jobId, filename, size:bytes.length });
    }

    if (req.method === 'POST' && url.pathname === '/api/worker/event') {
      const body = await readBody(req);
      const profile = state.profiles.find(p => p.id === body.profileId && p.status !== 'REMOVED');
      if (!profile || !body.token || body.token !== profile.token) return json(res, 403, { ok:false, error:'Binding de perfil inválido' });
      profile.lastSeenAt = nowIso();
      profile.workerId = body.workerId || profile.workerId || `FLOW_WORKER_${profile.id}`;
      const result = applyWorkerLifecycleEvent(profile, body);
      return json(res, 200, { ok:true, profileId:profile.id, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/worker/tick') {
      const body = await readBody(req);
      const profile = state.profiles.find(p => p.id === body.profileId && p.status !== 'REMOVED');
      if (!profile || !body.token || body.token !== profile.token) return json(res, 403, { ok:false, error:'Binding de perfil inválido' });
      updateFromWorker(profile, body);
      const command = commandForWorker(profile, body.workerState || {});
      saveSoon();
      return json(res, 200, { ok:true, profileId:profile.id, profileStatus:profile.status, command, managerVersion:state.version, limitPhrases:Array.isArray(state.settings.limitPhrases)?state.settings.limitPhrases:[] });
    }

    if (req.method === 'POST' && url.pathname === '/api/batch/requeue-failed') {
      const body = await readBody(req);
      const batch = state.batches.find(b => b.batchId === body.batchId);
      if (!batch) return json(res, 404, {ok:false,error:'Batch não encontrado'});
      let count = 0;
      for (const job of batch.jobs) {
        if (['FAILED','MANUAL_REVIEW'].includes(job.managerStatus)) {
          job.managerStatus = 'PENDING'; job.workerStatus = 'pending'; job.assignedProfileId=''; job.assignmentId=''; job.result=null; count += 1;
        }
      }
      addEvent('BATCH_REQUEUE', `${count} JOB(s) reencaminhados em ${batch.batchId}`, {batchId:batch.batchId}); saveSoon();
      return json(res, 200, {ok:true,count});
    }

    if (serveStatic(res, url.pathname)) return;
    json(res, 404, { ok:false, error:'Rota não encontrada' });
  } catch (error) {
    console.error(error);
    json(res, 500, { ok:false, error:String(error?.message || error) });
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n[ERRO] A porta ${HOST}:${PORT} ja esta em uso.`);
    console.error('[ERRO] Execute START_MANAGER.bat para reutilizar/encerrar automaticamente uma instancia antiga do Corvo Manager.');
    process.exitCode = 12;
    return;
  }
  console.error(err);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`\nCORVO FLOW MANAGER V4.2.9`);
  console.log(`Dashboard: http://${HOST}:${PORT}`);
  console.log(`Extensão: ${EXTENSION_DIR}`);
  console.log(`Perfis persistentes: ${PROFILE_ROOT}\n`);
  // V4.2.9 APP AGENT — em modo silencioso o motor sobe em segundo plano sem abrir o dashboard.
  // A lógica do Manager/Worker permanece a mesma; isto altera somente a apresentação na inicialização.
  if (process.env.CORVO_FLOW_SILENT !== '1') {
    try {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', `http://${HOST}:${PORT}`], { detached:true, stdio:'ignore' }).unref();
      else if (process.platform === 'darwin') spawn('open', [`http://${HOST}:${PORT}`], { detached:true, stdio:'ignore' }).unref();
      else spawn('xdg-open', [`http://${HOST}:${PORT}`], { detached:true, stdio:'ignore' }).unref();
    } catch (_) {}
  }
});

// Supervisor independente do dashboard. Mesmo que a página do Manager esteja fechada,
// perfis habilitados são recuperados automaticamente enquanto a produção estiver ativa.
const profileSupervisor = setInterval(() => {
  try {
    expireProfileLimits('SUPERVISOR');
    refreshOfflineProfiles();
    if (state.control?.running === true && state.settings.autoLaunchProfiles !== false) {
      autoLaunchEnabledProfiles('SUPERVISOR');
      globalPreflightGate();
    }
  } catch (error) {
    console.error('[AUTO-LAUNCH]', error?.message || error);
  }
}, 4000);
if (typeof profileSupervisor.unref === 'function') profileSupervisor.unref();

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
