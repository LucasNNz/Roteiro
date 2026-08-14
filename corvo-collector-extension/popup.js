const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const countLabel = document.getElementById('countLabel');
const selectedLabel = document.getElementById('selectedLabel');
const downloadBtn = document.getElementById('downloadBtn');

const state = { images: [] };

function setStatus(message, type = 'ok') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}
function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = 'status hidden';
}
function extFromUrl(url, contentType = '') {
  const clean = url.split('#')[0].split('?')[0].toLowerCase();
  const m = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('svg')) return 'svg';
  return 'jpg';
}
function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'imagem';
    return last.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 70) || 'imagem';
  } catch { return 'imagem'; }
}
function updateSummary() {
  countLabel.textContent = `${state.images.length} imagens encontradas`;
  const selected = state.images.filter(i => i.selected).length;
  selectedLabel.textContent = `${selected} selecionadas`;
  downloadBtn.disabled = selected === 0;
}
function render() {
  resultsEl.innerHTML = '';
  if (!state.images.length) {
    resultsEl.innerHTML = '<div class="empty">Nenhuma imagem carregada ainda.</div>';
    updateSummary();
    return;
  }
  for (const item of state.images) {
    const card = document.createElement('div');
    card.className = 'card';
    const hiRes = item.bestUrl && item.bestUrl !== item.previewUrl;
    card.innerHTML = `
      <img class="thumb" src="${item.previewUrl}" referrerpolicy="no-referrer">
      <div class="meta">
        <div class="top">
          <input type="checkbox" ${item.selected ? 'checked' : ''}>
          <div>
            <div><strong>${item.title}</strong></div>
            <div class="dim">${item.width || '?'} × ${item.height || '?'} · ${item.candidateCount || 1} URL(s)</div>
          </div>
        </div>
        <div class="tags">
          <span class="tag">${item.source}</span>
          ${hiRes ? '<span class="tag alt">alta detectada</span>' : ''}
        </div>
        <div class="url">${hiRes ? item.bestUrl : item.url}</div>
      </div>`;
    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', e => { item.selected = e.target.checked; updateSummary(); });
    resultsEl.appendChild(card);
  }
  updateSummary();
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Nenhuma aba ativa encontrada.');
  return tab;
}
async function scanCurrentTab() {
  clearStatus();
  setStatus('Executando varredura profunda...', 'ok');
  const tab = await getActiveTab();
  const settings = {
    minWidth: Number(document.getElementById('minWidth').value || 0),
    minHeight: Number(document.getElementById('minHeight').value || 0),
    maxCandidates: Number(document.getElementById('maxCandidates').value || 250),
    scrollSteps: Number(document.getElementById('scrollSteps').value || 24),
    preferredMinSide: Number(document.getElementById('preferredMinSide').value || 700),
    includeLinks: document.getElementById('includeLinks').checked,
    preferHiRes: document.getElementById('preferHiRes').checked,
    stepDelay: 350
  };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (settings) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const toAbsolute = (raw) => { try { return new URL(raw, location.href).href; } catch { return null; } };
      const map = new Map();
      const originalScrollY = window.scrollY;

      const pinterestVariants = (raw) => {
        const out = [];
        try {
          const u = new URL(raw, location.href);
          if (!/(^|\.)pinimg\.com$/i.test(u.hostname)) return out;
          const parts = u.pathname.split('/').filter(Boolean);
          if (!parts.length) return [u.href];

          const first = parts[0];
          const sizeLike = /^(originals|\d+x|\d+x\d+|\d+x\w*)$/i.test(first);
          const rest = sizeLike ? parts.slice(1).join('/') : parts.join('/');
          if (!rest) return [u.href];

          // Ordem proposital: maior primeiro; 236x fica apenas como último fallback.
          const ordered = [
            `${u.origin}/originals/${rest}`,
            `${u.origin}/1200x/${rest}`,
            `${u.origin}/736x/${rest}`,
            `${u.origin}/564x/${rest}`,
            `${u.origin}/474x/${rest}`,
            `${u.origin}/236x/${rest}`,
            u.href
          ];
          const seen = new Set();
          for (const candidate of ordered) {
            if (!seen.has(candidate)) {
              seen.add(candidate);
              out.push(candidate);
            }
          }
        } catch {}
        return out;
      };

      const parseSrcset = (srcset) => {
        if (!srcset) return [];
        return srcset.split(',').map(part => {
          const bits = part.trim().split(/\s+/);
          const url = bits[0];
          const descriptor = bits[1] || '';
          let score = 0;
          if (/\d+w/.test(descriptor)) score = parseInt(descriptor, 10);
          else if (/\d+(\.\d+)?x/.test(descriptor)) score = parseFloat(descriptor) * 1000;
          return { url, score };
        }).filter(x => x.url).sort((a,b) => b.score - a.score).map(x => x.url);
      };

      const readBackgroundImage = (el) => {
        try {
          const bg = getComputedStyle(el).backgroundImage || '';
          const matches = [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]);
          return matches;
        } catch { return []; }
      };

      const maybeAdd = ({ previewUrl, urlCandidates, width, height, source, title }) => {
        if (!previewUrl && (!urlCandidates || !urlCandidates.length)) return;
        previewUrl = toAbsolute(previewUrl || (urlCandidates && urlCandidates[0]));
        if (!previewUrl || previewUrl.startsWith('data:')) return;
        width = Number(width || 0);
        height = Number(height || 0);
        if (width && height && (width < settings.minWidth || height < settings.minHeight)) return;

        const candidateUrls = [];
        const seen = new Set();
        const pushCandidate = (u) => {
          const abs = toAbsolute(u);
          if (!abs || abs.startsWith('data:')) return;

          const variants = pinterestVariants(abs);
          if (variants.length) {
            for (const variant of variants) {
              const abs2 = toAbsolute(variant);
              if (abs2 && !seen.has(abs2)) {
                seen.add(abs2);
                candidateUrls.push(abs2);
              }
            }
            return;
          }

          if (!seen.has(abs)) {
            seen.add(abs);
            candidateUrls.push(abs);
          }
        };
        (urlCandidates || []).forEach(pushCandidate);
        pushCandidate(previewUrl);

        const key = previewUrl;
        const existing = map.get(key);
        if (existing) {
          for (const c of candidateUrls) if (!existing.urlCandidates.includes(c)) existing.urlCandidates.push(c);
          existing.width = Math.max(existing.width || 0, width || 0);
          existing.height = Math.max(existing.height || 0, height || 0);
          return;
        }
        map.set(key, {
          previewUrl,
          url: previewUrl,
          bestUrl: settings.preferHiRes ? (candidateUrls[0] || previewUrl) : previewUrl,
          urlCandidates: candidateUrls,
          candidateCount: candidateUrls.length,
          width,
          height,
          source,
          title: (title || 'imagem').trim().slice(0, 100)
        });
      };

      const collect = () => {
        for (const img of Array.from(document.images)) {
          const datasetValues = Object.values(img.dataset || {}).filter(Boolean);
          const candidates = [
            img.currentSrc,
            img.src,
            ...parseSrcset(img.srcset),
            ...parseSrcset(img.getAttribute('data-srcset') || ''),
            img.getAttribute('data-src'),
            img.getAttribute('data-lazy-src'),
            img.getAttribute('data-pin-media'),
            img.getAttribute('data-media'),
            ...datasetValues,
          ].filter(Boolean);
          maybeAdd({
            previewUrl: img.currentSrc || img.src,
            urlCandidates: candidates,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            source: 'IMG',
            title: img.alt || img.getAttribute('aria-label') || 'imagem'
          });
        }

        for (const el of Array.from(document.querySelectorAll('[style*="background-image"]'))) {
          const urls = readBackgroundImage(el);
          if (!urls.length) continue;
          const rect = el.getBoundingClientRect();
          maybeAdd({
            previewUrl: urls[0],
            urlCandidates: urls,
            width: rect.width,
            height: rect.height,
            source: 'BACKGROUND',
            title: el.getAttribute('aria-label') || el.getAttribute('title') || 'background'
          });
        }

        if (settings.includeLinks) {
          const imageHrefRegex = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i;
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const href = a.getAttribute('href');
            if (!href) continue;
            const dataPinMedia = a.getAttribute('data-pin-media');
            if (imageHrefRegex.test(href) || dataPinMedia) {
              maybeAdd({
                previewUrl: dataPinMedia || href,
                urlCandidates: [dataPinMedia, href].filter(Boolean),
                width: 0,
                height: 0,
                source: 'LINK',
                title: a.textContent || a.title || 'link'
              });
            }
          }
        }
      };

      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(300);
      collect();
      for (let i = 0; i < settings.scrollSteps && map.size < settings.maxCandidates; i++) {
        window.scrollBy({ top: Math.max(500, window.innerHeight * 0.9), behavior: 'instant' });
        await sleep(settings.stepDelay);
        collect();
      }
      await sleep(200);
      collect();
      window.scrollTo({ top: originalScrollY, behavior: 'instant' });
      return Array.from(map.values()).slice(0, settings.maxCandidates);
    },
    args: [settings]
  });

  state.images = (result || []).map((item, index) => ({ ...item, id: `${Date.now()}_${index}`, selected: true }));
  render();
  setStatus(`Varredura concluída: ${state.images.length} imagens encontradas.`, 'ok');
}
async function fetchAsBlob(url) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Falha ${response.status}`);
  const blob = await response.blob();
  return { blob, contentType: response.headers.get('content-type') || blob.type || '' };
}

async function getBlobDimensions(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width || 0, height: bitmap.height || 0 };
    if (bitmap.close) bitmap.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
}

function candidatePriority(url) {
  const lower = String(url || '').toLowerCase();
  let score = 0;

  if (lower.includes('pinimg.com')) {
    if (lower.includes('/originals/')) score += 100000;
    else if (lower.includes('/1200x/')) score += 90000;
    else if (lower.includes('/736x/')) score += 80000;
    else if (lower.includes('/564x/')) score += 70000;
    else if (lower.includes('/474x/')) score += 60000;
    else if (lower.includes('/236x/')) score += 10000;
  }

  const m = lower.match(/\/(\d{3,4})x(?:\/|[^0-9])/);
  if (m) score += Number(m[1]);
  if (lower.includes('/original')) score += 5000;
  return score;
}

function orderCandidates(urls) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  return unique.sort((a, b) => candidatePriority(b) - candidatePriority(a));
}

async function chooseBestDownload(item, preferredMinSide) {
  const rawCandidates = item.urlCandidates && item.urlCandidates.length
    ? item.urlCandidates
    : [item.bestUrl || item.url];

  const candidates = orderCandidates(rawCandidates);
  let best = null;

  for (const candidate of candidates) {
    try {
      const { blob, contentType } = await fetchAsBlob(candidate);
      const { width, height } = await getBlobDimensions(blob);
      const longSide = Math.max(width || 0, height || 0);
      const area = (width || 0) * (height || 0);

      if (!best || longSide > best.longSide || (longSide === best.longSide && area > best.area)) {
        best = { candidate, blob, contentType, width, height, longSide, area };
      }

      // Só encerra cedo quando a própria resposta já é realmente grande.
      if (longSide >= preferredMinSide) {
        return best;
      }
    } catch {
      // tenta próxima URL da mesma imagem
    }
  }

  return best;
}

async function downloadZip() {
  const selected = state.images.filter(i => i.selected);
  if (!selected.length) return;

  const preferredMinSide = Number(document.getElementById('preferredMinSide').value || 700);
  downloadBtn.disabled = true;
  setStatus(`Preparando ZIP com ${selected.length} imagens. Alvo: ≥ ${preferredMinSide}px...`, 'ok');

  const zip = new JSZip();
  const folder = zip.folder('corvo-collector');
  let okCount = 0;
  let failCount = 0;
  let reachedTarget = 0;
  let smallFallback = 0;
  const report = [];

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    setStatus(`Baixando ${i + 1}/${selected.length} · procurando melhor resolução...`, 'ok');

    const best = await chooseBestDownload(item, preferredMinSide);

    if (!best) {
      failCount++;
      report.push(`${String(i + 1).padStart(3, '0')} | FALHOU | ${item.url}`);
      continue;
    }

    const ext = extFromUrl(best.candidate, best.contentType);
    const base = basenameFromUrl(best.candidate).replace(/\.[a-z0-9]{2,5}$/i, '');
    const resolution = best.width && best.height ? `${best.width}x${best.height}` : 'dimensao-desconhecida';
    const name = `${String(i + 1).padStart(3, '0')}_${resolution}_${base}.${ext}`;
    folder.file(name, best.blob);
    okCount++;

    if (best.longSide >= preferredMinSide) reachedTarget++;
    else smallFallback++;

    report.push(
      `${name} | OK | ${resolution} | ${best.longSide >= preferredMinSide ? 'ALVO_ATINGIDO' : 'FALLBACK_PEQUENO'} | ${best.candidate}`
    );
  }

  folder.file('README.txt', [
    'Corvo Collector V0.3.1',
    '',
    `Total selecionadas: ${selected.length}`,
    `Baixadas com sucesso: ${okCount}`,
    `Falhas: ${failCount}`,
    `Atingiram lado preferido (>= ${preferredMinSide}px): ${reachedTarget}`,
    `Fallback abaixo do alvo: ${smallFallback}`,
    '',
    'Mudança principal da V0.3.1:',
    '- Pinterest tenta originals -> 1200x -> 736x -> 564x -> 474x -> 236x.',
    '- Uma URL só é considerada boa depois de medir a resolução REAL do arquivo retornado.',
    '- Se a primeira resposta for pequena, o Collector continua tentando outras versões.',
    '- Se nenhuma versão atingir o alvo, salva a maior que conseguiu como fallback.',
    '',
    'RELATÓRIO',
    ...report
  ].join('\n'));

  setStatus('Compactando ZIP...', 'ok');
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const filename = `corvo_collector_v031_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
  await chrome.downloads.download({ url, filename, saveAs: true });

  setStatus(
    `ZIP pronto. Sucesso: ${okCount}. ≥${preferredMinSide}px: ${reachedTarget}. Fallback pequeno: ${smallFallback}. Falhas: ${failCount}.`,
    failCount ? 'error' : 'ok'
  );
  downloadBtn.disabled = false;
}

document.getElementById('scanBtn').addEventListener('click', () => scanCurrentTab().catch(err => setStatus(err.message || String(err), 'error')));
document.getElementById('selectAllBtn').addEventListener('click', () => { state.images.forEach(i => i.selected = true); render(); });
document.getElementById('unselectAllBtn').addEventListener('click', () => { state.images.forEach(i => i.selected = false); render(); });
document.getElementById('downloadBtn').addEventListener('click', () => downloadZip().catch(err => { console.error(err); setStatus(err.message || String(err), 'error'); downloadBtn.disabled = false; }));
render();


async function bridgeMessage(message){
  return await chrome.runtime.sendMessage(message);
}

async function refreshBridgeUi(){
  try{
    const info=await bridgeMessage({type:'BRIDGE_INFO'});
    if(!info?.ok) throw new Error(info?.error||'Falha no Bridge');
    document.getElementById('bridgeExtensionId').textContent=info.extensionId||'—';
    document.getElementById('bridgeVersion').textContent=info.version||'—';
    const saved=(info.allowedOrigins||[]).filter(x=>!['http://localhost:3000','http://127.0.0.1:3000'].includes(x));
    document.getElementById('bridgeOrigins').value=saved.join('\n');
    const badge=document.getElementById('bridgeBadge');
    badge.textContent='READY';
    const job=info.job;
    document.getElementById('bridgeJob').textContent=job
      ? `${job.status} · ${job.progress?.current||0}/${job.progress?.total||0} · ${job.progress?.query||''} ${job.summary?`· ${job.summary.candidates} candidatos`:''}`
      : 'Nenhum job remoto.';
  }catch(err){
    document.getElementById('bridgeBadge').textContent='ERRO';
    document.getElementById('bridgeJob').textContent=String(err?.message||err);
  }
}

document.getElementById('saveBridgeBtn').addEventListener('click', async()=>{
  const origins=document.getElementById('bridgeOrigins').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const resp=await bridgeMessage({type:'BRIDGE_SAVE_ORIGINS',origins});
  if(resp?.ok){ setStatus('Acesso remoto salvo.', 'ok'); await refreshBridgeUi(); }
  else setStatus(resp?.error||'Falha ao salvar acesso.', 'error');
});
document.getElementById('refreshBridgeBtn').addEventListener('click', refreshBridgeUi);
refreshBridgeUi();
