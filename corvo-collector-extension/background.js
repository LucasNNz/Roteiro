const BRIDGE_PROTOCOL = 'corvo-collector/1';
const SEARCH_CANDIDATE_LIMIT = 20;

function normalizeSearchCandidateLimit(value) {
  const parsed = Number(value);
  return Math.max(1, Math.min(SEARCH_CANDIDATE_LIMIT, Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : SEARCH_CANDIDATE_LIMIT));
}
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const JOB_KEY = 'bridgeCurrentJob';
const PACKAGE_KEY = 'bridgePackageStatus';
const OFFSCREEN_URL = 'offscreen.html';

function nowIso() { return new Date().toISOString(); }
function makeJobId() { return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function safeOrigin(url) { try { return new URL(url).origin; } catch { return ''; } }

function sanitizePackageCode(raw='') {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function makePackageCode() {
  const d = new Date();
  const stamp = [
    d.getUTCFullYear(),
    String(d.getUTCMonth()+1).padStart(2,'0'),
    String(d.getUTCDate()).padStart(2,'0')
  ].join('') + '-' + [
    String(d.getUTCHours()).padStart(2,'0'),
    String(d.getUTCMinutes()).padStart(2,'0'),
    String(d.getUTCSeconds()).padStart(2,'0')
  ].join('');
  const rnd = Math.random().toString(36).slice(2,6).toUpperCase().padEnd(4,'X');
  return `CQ-${stamp}-${rnd}`;
}

async function getAllowedOrigins() {
  const data = await chrome.storage.local.get(['bridgeAllowedOrigins']);
  const saved = Array.isArray(data.bridgeAllowedOrigins) ? data.bridgeAllowedOrigins : [];
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...saved])];
}

async function senderAuthorization(sender) {
  const origin = safeOrigin(sender?.url || '');
  const allowedOrigins = await getAllowedOrigins();
  return { origin, allowed: !!origin && allowedOrigins.includes(origin), allowedOrigins };
}

async function saveJob(job) {
  job.updatedAt = nowIso();
  await chrome.storage.local.set({ [JOB_KEY]: job });
}

async function getJob() {
  const data = await chrome.storage.local.get([JOB_KEY]);
  return data[JOB_KEY] || null;
}


async function savePackageStatus(status) {
  const next = { ...(status || {}), updatedAt: nowIso() };
  await chrome.storage.local.set({ [PACKAGE_KEY]: next });
  return next;
}

async function getPackageStatus() {
  const data = await chrome.storage.local.get([PACKAGE_KEY]);
  return data[PACKAGE_KEY] || null;
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return true;
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  }).catch(() => []);
  return Boolean(contexts && contexts.length);
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (contexts && contexts.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: 'Montar ZIP com imagens selecionadas e criar URL temporária para download.'
    });
  } catch (error) {
    const msg = String(error?.message || error || '');
    if (!/single offscreen|already exists/i.test(msg)) throw error;
  }
}

function normalizePackageSelections(payload = {}) {
  const selections = Array.isArray(payload.selections) ? payload.selections : [];
  const prefix = String(payload.prefix || 'video1_').trim() || 'video1_';
  const startIndex = Math.max(1, Number(payload.startIndex || 1));
  return selections.map((item, i) => {
    const order = startIndex + i;
    const urls = Array.isArray(item.urls) ? item.urls : [item.url].filter(Boolean);
    return {
      id: String(item.id ?? String(order).padStart(2, '0')),
      query: String(item.query || '').trim(),
      outputName: String(item.outputName || `${prefix}${String(order).padStart(2, '0')}.jpg`),
      urls: [...new Set(urls.map(x => String(x || '').trim()).filter(Boolean))]
    };
  }).filter(x => x.urls.length);
}

function simplePackageRequestKey(productionId, fileName, packageMode, selections) {
  const seed = [
    String(productionId || ''),
    String(fileName || ''),
    String(packageMode || ''),
    String(selections.length),
    ...selections.map((item) => `${item.id}:${item.outputName}:${item.urls.length}`)
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pkgreq_${(hash >>> 0).toString(16)}`;
}

function packageStatusAgeMs(status) {
  const stamp = Date.parse(String(status?.updatedAt || status?.createdAt || ''));
  return Number.isFinite(stamp) ? Math.max(0, Date.now() - stamp) : Number.POSITIVE_INFINITY;
}

async function startPackageBuild(payload = {}) {
  const selections = normalizePackageSelections(payload);
  if (!selections.length) return { ok:false, error:'EMPTY_SELECTIONS' };

  const productionId = String(payload.productionId || '').trim();
  const packageMode = String(payload.packageMode || 'FORMA');
  const packageCode = sanitizePackageCode(payload.packageCode || productionId) || makePackageCode();
  const fileName = String(payload.fileName || `corvo_forma_${packageCode}.zip`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const requestKey = simplePackageRequestKey(productionId, fileName, packageMode, selections);
  const existing = await getPackageStatus();

  if (existing && ['QUEUED','RUNNING'].includes(existing.status)) {
    const sameRequest = existing.requestKey === requestKey
      || (!existing.requestKey
        && String(existing.fileName || '') === fileName
        && Number(existing.total || 0) === selections.length);
    const fresh = packageStatusAgeMs(existing) <= 180000;
    const workerAlive = await hasOffscreenDocument();

    // BUILD_FORMA_PACKAGE is idempotent for the same production/package request.
    // Resume only while there is recent progress AND the offscreen worker still exists.
    if (sameRequest && fresh && workerAlive) {
      return {
        ok:true,
        accepted:false,
        resumed:true,
        packageId:existing.id,
        packageCode:existing.packageCode || packageCode,
        total:Number(existing.total || selections.length),
        fileName:existing.fileName || fileName,
        status:existing.status
      };
    }

    // A service-worker/offscreen interruption can leave RUNNING persisted forever.
    // Release stale/orphaned locks automatically; only a real different active package blocks.
    if (!sameRequest && fresh && workerAlive) {
      return { ok:false, error:'PACKAGE_ALREADY_RUNNING', package: existing };
    }
    await savePackageStatus({
      ...existing,
      status:'ERROR',
      error:workerAlive ? 'STALE_PACKAGE_RECOVERED' : 'ORPHAN_PACKAGE_RECOVERED',
      finishedAt:nowIso()
    });
  }

  const packageId = `pkg_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const status = {
    id: packageId,
    packageCode,
    productionId,
    requestKey,
    packageMode,
    status: 'QUEUED',
    createdAt: nowIso(),
    total: selections.length,
    current: 0,
    success: 0,
    failed: 0,
    currentName: '',
    fileName,
    autoDownload: payload.autoDownload !== false,
    pipelineUploaded: 0,
    pipelineUploadFailed: 0,
    pipelineErrors: [],
    error: ''
  };
  await savePackageStatus(status);
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_BUILD_PACKAGE',
    payload: {
      packageId,
      packageCode,
      fileName,
      selections,
      jpegQuality: Math.max(0.65, Math.min(1, Number(payload.jpegQuality || 0.92))),
      includeManifest: payload.includeManifest !== false,
      pipelineUpload: payload.pipelineUpload && typeof payload.pipelineUpload === 'object' ? payload.pipelineUpload : null,
      pipelineOnly: payload.pipelineOnly === true,
      packageMode: String(payload.packageMode || 'FORMA')
    }
  }).catch(async error => {
    await savePackageStatus({ ...status, status:'ERROR', error:String(error?.message || error), finishedAt:nowIso() });
  });
  return { ok:true, accepted:true, packageId, packageCode, total: selections.length, fileName };
}


async function waitForDownloadComplete(downloadId, timeoutMs = 60000) {
  const current = await chrome.downloads.search({ id: downloadId }).catch(() => []);
  if (current?.[0]?.state === 'complete') return current[0];
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      chrome.downloads.onChanged.removeListener(listener);
      const found = await chrome.downloads.search({ id: downloadId }).catch(() => []);
      if (found?.[0]?.state === 'complete') resolve(found[0]);
      else reject(new Error('Tempo esgotado aguardando o download finalizar.'));
    }, timeoutMs);
    const listener = async (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        const found = await chrome.downloads.search({ id: downloadId }).catch(() => []);
        resolve(found?.[0] || { id: downloadId, state: 'complete' });
      } else if (delta.state?.current === 'interrupted') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('O download foi interrompido.'));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

function normalizeItems(payload = {}) {
  if (Array.isArray(payload.items) && payload.items.length) {
    return payload.items
      .map((it, i) => ({ id: String(it.id ?? i + 1), query: String(it.query || '').trim() }))
      .filter(it => it.query);
  }
  const q = String(payload.query || '').trim();
  return q ? [{ id: '01', query: q }] : [];
}

function pinterestSearchUrl(query) {
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
}

function googleImagesSearchUrl(query) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

function normalizeSourceMode(raw='PINTEREST') {
  const mode = String(raw || 'PINTEREST').trim().toUpperCase();
  return ['PINTEREST','GOOGLE','MIXED'].includes(mode) ? mode : 'PINTEREST';
}

function sourceLabel(mode) {
  return mode === 'GOOGLE' ? 'Google Imagens' : mode === 'MIXED' ? 'Mesclado' : 'Pinterest';
}

function sourceSiteName(mode) {
  return mode === 'GOOGLE' ? 'GOOGLE' : 'PINTEREST';
}

function searchUrlForProvider(query, mode) {
  return mode === 'GOOGLE' ? googleImagesSearchUrl(query) : pinterestSearchUrl(query);
}

function mergeCollectedItems(groups = [], maxCandidates = SEARCH_CANDIDATE_LIMIT) {
  const map = new Map();
  for (const group of groups) {
    for (const item of (group?.items || [])) {
      const key = String(item.bestUrl || item.url || item.previewUrl || '');
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.width = Math.max(Number(existing.width || 0), Number(item.width || 0));
        existing.height = Math.max(Number(existing.height || 0), Number(item.height || 0));
        existing.candidateCount = Math.max(Number(existing.candidateCount || 0), Number(item.candidateCount || 0));
        const urls = [...new Set([...(existing.urlCandidates || []), ...(item.urlCandidates || [])])];
        existing.urlCandidates = urls;
        existing.provider = existing.provider || item.provider || '';
        existing.sourceSite = existing.sourceSite || item.sourceSite || '';
      } else {
        map.set(key, {
          ...item,
          provider: item.provider || '',
          sourceSite: item.sourceSite || ''
        });
      }
    }
  }
  return Array.from(map.values()).slice(0, maxCandidates);
}

function buildItemSummaries(items = []) {
  return items.map(it => ({ id: it.id, query: it.query, status: 'QUEUED', found: 0 }));
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (existing?.status === 'complete') return existing;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tempo esgotado aguardando a página carregar.'));
    }, timeoutMs);
    const listener = (id, info, tab) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectDeepFromPage(settings) {
  const provider = String(settings?.provider || 'pinterest').toLowerCase();
  const sourceSite = String(settings?.sourceSite || provider || 'PINTEREST').toUpperCase();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: settings.tabId },
    func: async (settings) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const provider = String(settings?.provider || 'pinterest').toLowerCase();
      const sourceSite = String(settings?.sourceSite || provider || 'PINTEREST').toUpperCase();
      const toAbsolute = raw => { try { return new URL(raw, location.href).href; } catch { return null; } };
      const excludeSet = new Set((Array.isArray(settings?.excludeUrls) ? settings.excludeUrls : []).map(toAbsolute).filter(Boolean));
      const map = new Map();
      const startY = window.scrollY;

      const pinterestVariants = raw => {
        const out = [];
        try {
          const u = new URL(raw, location.href);
          if (!/(^|\\.)pinimg\\.com$/i.test(u.hostname)) return out;
          const parts = u.pathname.split('/').filter(Boolean);
          if (!parts.length) return [u.href];
          const first = parts[0];
          const sizeLike = /^(originals|\\d+x|\\d+x\\d+|\\d+x\\w*)$/i.test(first);
          const rest = sizeLike ? parts.slice(1).join('/') : parts.join('/');
          if (!rest) return [u.href];
          const ordered = [
            `${u.origin}/originals/${rest}`,
            `${u.origin}/1200x/${rest}`,
            `${u.origin}/736x/${rest}`,
            `${u.origin}/564x/${rest}`,
            `${u.origin}/474x/${rest}`,
            `${u.origin}/236x/${rest}`,
            u.href
          ];
          return [...new Set(ordered)];
        } catch { return out; }
      };

      const parseSrcset = srcset => {
        if (!srcset) return [];
        return srcset.split(',').map(part => {
          const bits = part.trim().split(/\\s+/);
          const url = bits[0];
          const descriptor = bits[1] || '';
          let score = 0;
          if (/\\d+w/.test(descriptor)) score = parseInt(descriptor, 10);
          else if (/\\d+(\\.\\d+)?x/.test(descriptor)) score = parseFloat(descriptor) * 1000;
          return { url, score };
        }).filter(x => x.url).sort((a,b) => b.score-a.score).map(x => x.url);
      };

      const add = ({ previewUrl, urls, width, height, title, source }) => {
        const preview = toAbsolute(previewUrl || (urls && urls[0]));
        if (!preview || preview.startsWith('data:')) return;
        width = Number(width || 0); height = Number(height || 0);
        if (width && height && (width < settings.minWidth || height < settings.minHeight)) return;

        const candidates=[]; const seen=new Set();
        const push = raw => {
          const abs=toAbsolute(raw); if(!abs || abs.startsWith('data:')) return;
          const variants=pinterestVariants(abs);
          const list=variants.length?variants:[abs];
          for(const v of list){ if(!seen.has(v)){seen.add(v);candidates.push(v);} }
        };
        (urls||[]).forEach(push); push(preview);
        const blocked = excludeSet.has(preview) || candidates.some(c => excludeSet.has(c));
        if (blocked) return;

        const existing=map.get(preview);
        if(existing){
          for(const c of candidates) if(!existing.urlCandidates.includes(c)) existing.urlCandidates.push(c);
          existing.width=Math.max(existing.width||0,width||0);
          existing.height=Math.max(existing.height||0,height||0);
          existing.candidateCount=existing.urlCandidates.length;
          return;
        }
        map.set(preview,{
          previewUrl:preview,
          url:preview,
          bestUrl:candidates[0]||preview,
          urlCandidates:candidates,
          candidateCount:candidates.length,
          width,height,source,
          title:String(title||'imagem').trim().slice(0,120),
          provider,
          sourceSite
        });
      };

      const collect=()=>{
        for(const img of Array.from(document.images)){
          if(map.size>=settings.maxCandidates) break;
          const datasetValues=Object.values(img.dataset||{}).filter(v=>typeof v==='string' && /^https?:/i.test(v));
          const candidates=[img.currentSrc,img.src,...parseSrcset(img.srcset),...parseSrcset(img.getAttribute('data-srcset')||''),img.getAttribute('data-src'),img.getAttribute('data-lazy-src'),img.getAttribute('data-pin-media'),img.getAttribute('data-media'),...datasetValues].filter(Boolean);
          add({previewUrl:img.currentSrc||img.src,urls:candidates,width:img.naturalWidth||img.width,height:img.naturalHeight||img.height,source:'IMG',title:img.alt||img.getAttribute('aria-label')||'imagem'});
        }
        if(map.size>=settings.maxCandidates) return;
        for(const el of Array.from(document.querySelectorAll('[style*="background-image"]'))){
          if(map.size>=settings.maxCandidates) break;
          try{
            const bg=getComputedStyle(el).backgroundImage||'';
            const urls=[...bg.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].map(m=>m[1]);
            if(!urls.length) continue;
            const rect=el.getBoundingClientRect();
            add({previewUrl:urls[0],urls,width:rect.width,height:rect.height,source:'BACKGROUND',title:el.getAttribute('aria-label')||el.title||'background'});
          }catch{}
        }
      };

      window.scrollTo({top:0,behavior:'instant'}); await sleep(450); collect();
      let stable=0; let lastSize=map.size;
      for(let i=0;i<settings.scrollSteps && map.size<settings.maxCandidates;i++){
        window.scrollBy({top:Math.max(520,window.innerHeight*0.9),behavior:'instant'});
        await sleep(settings.stepDelay);
        collect();
        if(map.size===lastSize) stable++; else stable=0;
        lastSize=map.size;
        if(stable>=6) break;
      }
      collect();
      window.scrollTo({top:startY,behavior:'instant'});
      return { pageTitle:document.title, pageUrl:location.href, items:Array.from(map.values()).slice(0,settings.maxCandidates) };
    },
    args: [{
      provider,
      sourceSite,
      minWidth: settings.minWidth,
      minHeight: settings.minHeight,
      maxCandidates: settings.maxCandidates,
      scrollSteps: settings.scrollSteps,
      stepDelay: settings.stepDelay,
      excludeUrls: settings.excludeUrls || []
    }]
  });
  return result || { items: [] };
}



async function collectForQuery(query, options = {}) {
  const mode = normalizeSourceMode(options.sourceMode || 'PINTEREST');
  const providers = mode === 'MIXED' ? ['PINTEREST', 'GOOGLE'] : [mode];
  const maxCandidates = normalizeSearchCandidateLimit(options.maxCandidates);
  const scrollSteps = Math.max(1, Math.min(60, Number(options.scrollSteps || 24)));
  const stepDelay = Math.max(150, Number(options.stepDelay || 350));
  const initialWaitMs = Math.max(500, Number(options.initialWaitMs || 1800));
  const loadTimeoutMs = Math.max(5000, Number(options.loadTimeoutMs || 30000));
  const minWidth = Number(options.minWidth || 120);
  const minHeight = Number(options.minHeight || 120);
  const excludeUrls = Array.isArray(options.excludeUrls) ? options.excludeUrls : [];
  const backgroundTab = options.backgroundTab !== false;
  const closeTabOnFinish = options.closeTabOnFinish !== false;

  let tab = null;
  const collectedGroups = [];
  const pageUrls = [];
  const pageTitles = [];
  try {
    const perProviderBase = Math.max(1, Math.floor(maxCandidates / providers.length));
    for (let pi = 0; pi < providers.length; pi++) {
      const providerMode = providers[pi];
      const providerMax = pi === providers.length - 1
        ? Math.max(1, maxCandidates - (perProviderBase * pi))
        : perProviderBase;
      const providerUrl = searchUrlForProvider(query, providerMode);
      const activateSearchTab = backgroundTab === false;

      if (!tab) tab = await chrome.tabs.create({ url: providerUrl, active: activateSearchTab });
      else tab = await chrome.tabs.update(tab.id, { url: providerUrl, active: activateSearchTab });

      await waitForTabComplete(tab.id, loadTimeoutMs);
      await new Promise(r => setTimeout(r, initialWaitMs));

      const collected = await collectDeepFromPage({
        tabId: tab.id,
        provider: providerMode.toLowerCase(),
        sourceSite: sourceSiteName(providerMode),
        minWidth,
        minHeight,
        maxCandidates: providerMax,
        scrollSteps,
        stepDelay,
        excludeUrls
      });

      collectedGroups.push({ providerMode, items: collected.items || [] });
      pageUrls.push(`${providerMode}: ${collected.pageUrl || providerUrl}`);
      pageTitles.push(`${providerMode}: ${collected.pageTitle || ''}`);
    }
    const mergedItems = mergeCollectedItems(collectedGroups, maxCandidates);
    return {
      ok: true,
      providerMode: mode,
      pageTitle: pageTitles.join(' | '),
      pageUrl: pageUrls.join(' | '),
      count: mergedItems.length,
      candidates: mergedItems
    };
  } finally {
    try {
      if (closeTabOnFinish && tab?.id) await chrome.tabs.remove(tab.id).catch(()=>{});
    } catch {}
  }
}

async function runJob(jobId) {
  let job = await getJob();
  if (!job || job.id !== jobId) return;
  job.status = 'RUNNING'; job.startedAt = nowIso();
  await saveJob(job);
  let tab = null;
  try {
    for (let index = 0; index < job.items.length; index++) {
      job = await getJob();
      if (!job || job.id !== jobId || job.cancelRequested) throw new Error('JOB_CANCELLED');
      const item = job.items[index];
      const mode = normalizeSourceMode(job.settings.sourceMode || job.provider || 'PINTEREST');
      job.progress = { current: index + 1, total: job.items.length, query: item.query, phase: 'OPENING_SEARCH', sourceMode: mode };
      if (Array.isArray(job.itemSummaries) && job.itemSummaries[index]) {
        job.itemSummaries[index].status = 'OPENING_SEARCH';
        job.itemSummaries[index].found = 0;
      }
      await saveJob(job);

      const providers = mode === 'MIXED' ? ['PINTEREST','GOOGLE'] : [mode];
      const perProviderBase = Math.max(1, Math.floor(job.settings.maxCandidates / providers.length));
      const collectedGroups = [];
      const pageUrls = [];
      const pageTitles = [];

      for (let pi = 0; pi < providers.length; pi++) {
        const providerMode = providers[pi];
        const providerMax = pi === providers.length - 1
          ? Math.max(1, job.settings.maxCandidates - (perProviderBase * pi))
          : perProviderBase;
        const providerUrl = searchUrlForProvider(item.query, providerMode);
        const activateSearchTab = job.settings.backgroundTab === false;

        job = await getJob();
        if (!job || job.id !== jobId || job.cancelRequested) throw new Error('JOB_CANCELLED');
        job.progress = {
          current: index + 1,
          total: job.items.length,
          query: item.query,
          phase: `OPENING_${providerMode}`,
          sourceMode: mode,
          providerNow: providerMode
        };
        await saveJob(job);

        if (!tab) tab = await chrome.tabs.create({ url: providerUrl, active: activateSearchTab });
        else tab = await chrome.tabs.update(tab.id, { url: providerUrl, active: activateSearchTab });

        job.browserTabId = tab.id;
        await saveJob(job);
        await waitForTabComplete(tab.id, job.settings.loadTimeoutMs);
        await new Promise(r => setTimeout(r, job.settings.initialWaitMs));

        job = await getJob();
        if (!job || job.id !== jobId || job.cancelRequested) throw new Error('JOB_CANCELLED');
        job.progress.phase = `COLLECTING_${providerMode}`;
        job.progress.providerNow = providerMode;
        if (Array.isArray(job.itemSummaries) && job.itemSummaries[index]) {
          job.itemSummaries[index].status = 'COLLECTING';
        }
        await saveJob(job);

        const collected = await collectDeepFromPage({
          tabId: tab.id,
          provider: providerMode.toLowerCase(),
          sourceSite: sourceSiteName(providerMode),
          minWidth: job.settings.minWidth,
          minHeight: job.settings.minHeight,
          maxCandidates: providerMax,
          scrollSteps: job.settings.scrollSteps,
          stepDelay: job.settings.stepDelay
        });

        collectedGroups.push({ providerMode, items: collected.items || [] });
        pageUrls.push(`${providerMode}: ${collected.pageUrl || providerUrl}`);
        pageTitles.push(`${providerMode}: ${collected.pageTitle || ''}`);
      }

      const latest = await getJob();
      if (!latest || latest.id !== jobId) return;
      const mergedItems = mergeCollectedItems(collectedGroups, latest.settings.maxCandidates);
      latest.results[index] = {
        id: item.id,
        query: item.query,
        providerMode: mode,
        pageTitle: pageTitles.join(' | '),
        pageUrl: pageUrls.join(' | '),
        count: mergedItems.length,
        candidates: mergedItems
      };
      latest.progress = {
        current: index + 1,
        total: latest.items.length,
        query: item.query,
        phase: 'ITEM_DONE',
        found: latest.results[index].count,
        sourceMode: mode
      };
      if (Array.isArray(latest.itemSummaries) && latest.itemSummaries[index]) {
        latest.itemSummaries[index].status = 'DONE';
        latest.itemSummaries[index].found = latest.results[index].count;
      }
      latest.summary = {
        terms: latest.items.length,
        completed: latest.itemSummaries.filter(x => x.status === 'DONE').length,
        candidates: latest.results.reduce((n,r)=>n+(r?.count||0),0)
      };
      await saveJob(latest);
    }
    job = await getJob();
    if (!job || job.id !== jobId) return;
    job.status = 'DONE'; job.finishedAt = nowIso(); job.progress.phase = 'DONE';
    job.summary = {
      terms: job.items.length,
      completed: job.itemSummaries.filter(x => x.status === 'DONE').length,
      candidates: job.results.reduce((n,r)=>n+(r?.count||0),0)
    };
    await saveJob(job);
  } catch (error) {
    job = await getJob();
    if (!job || job.id !== jobId) return;
    const currentIndex = Math.max(0, Number((job.progress && job.progress.current) || 1) - 1);
    if (String(error?.message || error) === 'JOB_CANCELLED') {
      job.status = 'CANCELLED'; job.progress.phase = 'CANCELLED';
      if (Array.isArray(job.itemSummaries) && job.itemSummaries[currentIndex] && job.itemSummaries[currentIndex].status !== 'DONE') {
        job.itemSummaries[currentIndex].status = 'CANCELLED';
      }
    } else {
      job.status = 'ERROR'; job.error = String(error?.message || error); job.progress.phase = 'ERROR';
      if (Array.isArray(job.itemSummaries) && job.itemSummaries[currentIndex] && job.itemSummaries[currentIndex].status !== 'DONE') {
        job.itemSummaries[currentIndex].status = 'ERROR';
      }
    }
    job.summary = {
      terms: job.items.length,
      completed: Array.isArray(job.itemSummaries) ? job.itemSummaries.filter(x => x.status === 'DONE').length : 0,
      candidates: job.results.reduce((n,r)=>n+(r?.count||0),0)
    };
    job.finishedAt = nowIso(); await saveJob(job);
  } finally {
    try {
      const latest = await getJob();
      const shouldClose = latest?.settings?.closeTabOnFinish !== false;
      const tabId = tab?.id || latest?.browserTabId;
      if (shouldClose && tabId) {
        await chrome.tabs.remove(tabId).catch(()=>{});
      }
      if (latest && latest.id === jobId) {
        latest.browserTabId = null;
        await saveJob(latest);
      }
    } catch {}
  }
}

async function handleExternal(message, sender) {
  const auth = await senderAuthorization(sender);
  const manifest = chrome.runtime.getManifest();
  const type = String(message?.type || '').toUpperCase();

  if (type === 'PING') {
    return {
      ok: true, protocol: BRIDGE_PROTOCOL, name: manifest.name, version: manifest.version,
      extensionId: chrome.runtime.id, authorized: auth.allowed, origin: auth.origin,
      capabilities: ['PING','START_JOB','GET_STATUS','GET_RESULT','CANCEL_JOB','BUILD_FORMA_PACKAGE','GET_PACKAGE_STATUS','OPEN_LAST_PACKAGE','SHOW_LAST_PACKAGE','SAVE_PACKAGE_AS','SEARCH_MORE_GROUP'],
      executionMode: 'BACKGROUND_TAB', closesSearchTabOnFinish: true, supportsMultiItemQueue: true, supportsAutoSelection: false, supportsManualSelectionUi: true, supportsFormaPackage: true, supportsPostDownloadActions: true, supportsPackageCode: true, supportsSourceSelector: true, supportsSearchMoreGroup: true, maxSearchCandidatesPerId: SEARCH_CANDIDATE_LIMIT, sourceModes: ['PINTEREST','GOOGLE','MIXED']
    };
  }
  if (!auth.allowed) return { ok:false, error:'ORIGIN_NOT_AUTHORIZED', origin:auth.origin };

  if (type === 'START_JOB') {
    const payload = message?.payload || {};
    const items = normalizeItems(payload);
    if (!items.length) return { ok:false, error:'EMPTY_JOB' };
    const current = await getJob();
    if (current && ['RUNNING','QUEUED'].includes(current.status)) return { ok:false, error:'JOB_ALREADY_RUNNING', job:current };
    const job = {
      id: makeJobId(), protocol: BRIDGE_PROTOCOL, provider: normalizeSourceMode(payload.sourceMode || payload.provider || 'PINTEREST'), status:'QUEUED', createdAt:nowIso(), updatedAt:nowIso(),
      sourceOrigin:auth.origin, items, results:Array(items.length).fill(null), itemSummaries: buildItemSummaries(items), cancelRequested:false,
      progress:{current:0,total:items.length,query:'',phase:'QUEUED'},
      settings:{
        minWidth:Number(payload.minWidth||120), minHeight:Number(payload.minHeight||120),
        maxCandidates:normalizeSearchCandidateLimit(payload.maxCandidates),
        scrollSteps:Math.max(1,Math.min(60,Number(payload.scrollSteps||24))),
        stepDelay:Math.max(150,Number(payload.stepDelay||350)),
        initialWaitMs:Math.max(500,Number(payload.initialWaitMs||1800)),
        loadTimeoutMs:Math.max(5000,Number(payload.loadTimeoutMs||30000)),
        sourceMode: normalizeSourceMode(payload.sourceMode || payload.provider || 'PINTEREST'),
        backgroundTab: payload.backgroundTab !== false,
        closeTabOnFinish: payload.closeTabOnFinish !== false
      }
    };
    await saveJob(job);
    runJob(job.id);
    return { ok:true, accepted:true, jobId:job.id, status:job.status, items:job.items.length, sourceMode: job.settings.sourceMode };
  }
  if (type === 'GET_STATUS') {
    const job = await getJob();
    if (!job) return { ok:true, job:null };
    const { results, ...light } = job;
    return { ok:true, job:light };
  }
  if (type === 'GET_RESULT') {
    const job = await getJob();
    if (!job) return { ok:true, job:null };
    return { ok:true, job };
  }
  if (type === 'CANCEL_JOB') {
    const job = await getJob();
    if (!job) return { ok:true, cancelled:false };
    job.cancelRequested = true; await saveJob(job);
    if (job.browserTabId) chrome.tabs.remove(job.browserTabId).catch(()=>{});
    return { ok:true, cancelled:true, jobId:job.id };
  }

  if (type === 'SEARCH_MORE_GROUP') {
    const payload = message?.payload || {};
    const query = String(payload.query || '').trim();
    if (!query) return { ok:false, error:'EMPTY_QUERY' };
    try {
      const result = await collectForQuery(query, {
        sourceMode: payload.sourceMode || payload.provider || 'PINTEREST',
        maxCandidates: payload.maxCandidates,
        scrollSteps: payload.scrollSteps,
        stepDelay: payload.stepDelay,
        initialWaitMs: payload.initialWaitMs,
        loadTimeoutMs: payload.loadTimeoutMs,
        minWidth: payload.minWidth,
        minHeight: payload.minHeight,
        backgroundTab: payload.backgroundTab,
        closeTabOnFinish: payload.closeTabOnFinish,
        excludeUrls: payload.excludeUrls || []
      });
      return { ok:true, group: {
        id: String(payload.id || ''),
        query,
        providerMode: result.providerMode,
        pageTitle: result.pageTitle || '',
        pageUrl: result.pageUrl || '',
        count: result.count || 0,
        candidates: result.candidates || []
      }};
    } catch (error) {
      return { ok:false, error:String(error?.message || error) };
    }
  }

  if (type === 'BUILD_FORMA_PACKAGE') {
    return await startPackageBuild(message?.payload || {});
  }
  if (type === 'GET_PACKAGE_STATUS') {
    return { ok:true, package: await getPackageStatus() };
  }
  if (type === 'SHOW_LAST_PACKAGE') {
    const pkg = await getPackageStatus();
    if (!pkg?.downloadId) return { ok:false, error:'NO_DOWNLOADED_PACKAGE' };
    try {
      chrome.downloads.show(pkg.downloadId);
      return { ok:true, downloadId:pkg.downloadId };
    } catch (error) {
      return { ok:false, error:String(error?.message || error) };
    }
  }
  if (type === 'OPEN_LAST_PACKAGE') {
    const pkg = await getPackageStatus();
    if (!pkg?.downloadId) return { ok:false, error:'NO_DOWNLOADED_PACKAGE' };
    try {
      await chrome.downloads.open(pkg.downloadId);
      return { ok:true, downloadId:pkg.downloadId };
    } catch (error) {
      return { ok:false, error:String(error?.message || error) };
    }
  }
  if (type === 'SAVE_PACKAGE_AS') {
    const pkg = await getPackageStatus();
    if (!pkg?.blobUrl) return { ok:false, error:'PACKAGE_BLOB_UNAVAILABLE' };
    try {
      const downloadId = await chrome.downloads.download({
        url: pkg.blobUrl,
        filename: pkg.fileName || 'corvo_forma.zip',
        saveAs: true
      });
      return { ok:true, downloadId };
    } catch (error) {
      return { ok:false, error:String(error?.message || error) };
    }
  }
  return { ok:false, error:'UNKNOWN_COMMAND' };
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleExternal(message, sender).then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message||err)}));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async()=>{
    const type=String(message?.type||'').toUpperCase();
    if(type==='PACKAGE_PROGRESS'){
      const current = await getPackageStatus();
      if (!current || current.id !== message.packageId) return {ok:false,error:'PACKAGE_ID_MISMATCH'};
      await savePackageStatus({
        ...current,
        status:'RUNNING',
        current:Number(message.current||0),
        total:Number(message.total||current.total||0),
        success:Number(message.success||0),
        failed:Number(message.failed||0),
        pipelineUploaded:Number(message.pipelineUploaded||current.pipelineUploaded||0),
        pipelineUploadFailed:Number(message.pipelineUploadFailed||current.pipelineUploadFailed||0),
        batchesUploaded:Number(message.batchesUploaded||current.batchesUploaded||0),
        batchTotal:Number(message.batchTotal||current.batchTotal||0),
        currentName:String(message.currentName||'')
      });
      return {ok:true};
    }
    if(type==='PACKAGE_DONE'){
      const current = await getPackageStatus();
      if (!current || current.id !== message.packageId) return {ok:false,error:'PACKAGE_ID_MISMATCH'};
      let finalStatus = await savePackageStatus({
        ...current,
        status: current.autoDownload === false ? 'DONE' : 'DOWNLOADING',
        current:Number(message.total||current.total||0),
        total:Number(message.total||current.total||0),
        success:Number(message.success||0),
        failed:Number(message.failed||0),
        pipelineUploaded:Number(message.pipelineUploaded||0),
        pipelineUploadFailed:Number(message.pipelineUploadFailed||0),
        pipelineErrors:Array.isArray(message.pipelineErrors)?message.pipelineErrors.slice(0,8):[],
        batchesUploaded:Number(message.batchesUploaded||current.batchesUploaded||0),
        batchTotal:Number(message.batchTotal||current.batchTotal||0),
        currentName:'',
        blobUrl:String(message.blobUrl||''),
        packageCode:String(message.packageCode||current.packageCode||''),
        packageReadyAt:nowIso()
      });
      if (finalStatus.autoDownload !== false && finalStatus.blobUrl) {
        try {
          const downloadId = await chrome.downloads.download({
            url: finalStatus.blobUrl,
            filename: finalStatus.fileName,
            saveAs: false,
            conflictAction: 'uniquify'
          });
          finalStatus = await savePackageStatus({ ...finalStatus, status:'DOWNLOADING', downloadId });
          const downloadItem = await waitForDownloadComplete(downloadId, 60000);
          await savePackageStatus({
            ...finalStatus,
            status:'DONE',
            finishedAt:nowIso(),
            downloadFilename:String(downloadItem?.filename || '')
          });
        } catch (error) {
          await savePackageStatus({
            ...finalStatus,
            status:'DONE',
            finishedAt:nowIso(),
            downloadError:String(error?.message || error)
          });
        }
      } else {
        await savePackageStatus({ ...finalStatus, status:'DONE', finishedAt:nowIso() });
      }
      return {ok:true};
    }
    if(type==='PACKAGE_ERROR'){
      const current = await getPackageStatus();
      if (!current || current.id !== message.packageId) return {ok:false,error:'PACKAGE_ID_MISMATCH'};
      await savePackageStatus({ ...current, status:'ERROR', error:String(message.error||'Erro ao gerar pacote.'), finishedAt:nowIso() });
      return {ok:true};
    }
    if(type==='BRIDGE_INFO'){
      const job=await getJob();
      const allowedOrigins=await getAllowedOrigins();
      return {ok:true,extensionId:chrome.runtime.id,version:chrome.runtime.getManifest().version,allowedOrigins,job};
    }
    if(type==='BRIDGE_SAVE_ORIGINS'){
      const origins=Array.isArray(message.origins)?message.origins.map(x=>String(x).trim()).filter(Boolean):[];
      const normalized=[];
      for(const raw of origins){try{normalized.push(new URL(raw).origin)}catch{}}
      await chrome.storage.local.set({bridgeAllowedOrigins:[...new Set(normalized)]});
      return {ok:true,allowedOrigins:await getAllowedOrigins()};
    }
    return {ok:false,error:'UNKNOWN_INTERNAL_COMMAND'};
  })().then(sendResponse).catch(err=>sendResponse({ok:false,error:String(err?.message||err)}));
  return true;
});
