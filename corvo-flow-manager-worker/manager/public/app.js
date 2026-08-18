const $ = s => document.querySelector(s);
let current = null;

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function when(v) { if (!v) return '—'; try { return new Date(v).toLocaleTimeString(); } catch { return v; } }
function statusClass(s) { return s === 'DONE' ? 'ok' : (['FAILED','MANUAL_REVIEW'].includes(s) ? 'bad' : 'wait'); }
function downloadTextFile(name, text) {
  const blob = new Blob([text], { type:'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadJsonFile(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderOverview() {
  const o = current.orchestration || {};
  const items = [
    ['Perfis', o.profiles || 0, `${o.available || 0} disponíveis`],
    ['BUSY', o.busy || 0, `${o.limitReached || 0} em limite`],
    ['Fila', o.pending || 0, `${o.assigned || 0} assigned`],
    ['RUNNING', o.running || 0, `${o.resultReady || 0} prontos · ${o.downloading || 0} baixando`],
    ['DONE', o.done || 0, `${o.jobs || 0} JOBs totais`],
    ['Falhas', o.failed || 0, `${o.completeBatches || 0} lote(s) completos`]
  ];
  $('#overview').innerHTML = items.map(([label, value, note]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
}

function renderProfiles() {
  const box = $('#profiles'); box.innerHTML = '';
  for (const p of current.profiles) {
    const d = document.createElement('div'); d.className = 'profile';
    d.innerHTML = `<div class="profiletop"><div><h3>${esc(p.label)}</h3><div class="muted">${esc(p.id)}</div></div><span class="status ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="meta">Worker: ${esc(p.workerId || '—')}<br>Último heartbeat: ${esc(when(p.lastSeenAt))}<br>Flow: ${esc(p.workspaceStatus || '—')}${p.workspaceReady ? ' · pronto' : ''}<br>Batch: ${esc(p.currentBatchId || '—')} · JOBs ativos: ${p.currentJobs || 0}${p.preflightStatus ? `<br>Preflight: ${esc(p.preflightStatus)}${p.preflightReason ? ` · ${esc(p.preflightReason)}` : ''}` : ''}${p.limitSource ? `<br>Limite: ${esc(p.limitSource)}${p.limitUntil ? ` · revalidar ${esc(when(p.limitUntil))}` : ''}` : ''}${p.workspaceError ? `<br>Workspace: ${esc(p.workspaceError)}` : ''}${p.startHealth?.lastError ? `<br>Start: ${esc(p.startHealth.lastError)} · falhas ${p.startHealth.failureCount || 0} · force ${p.startHealth.forceStartCount || 0}` : ''}${p.lastError ? `<br>Erro: ${esc(p.lastError)}` : ''}</div>
      <div class="buttons"><button data-a="open">Abrir</button>${p.status === 'PAUSED' || p.status === 'LIMIT_REACHED' ? '<button data-a="reactivate">Reativar</button>' : '<button data-a="pause">Pausar</button>'}<button data-a="remove">Remover</button></div>`;
    d.querySelectorAll('button').forEach(b => b.onclick = async () => { try { await api('/api/profile/action', { profileId:p.id, action:b.dataset.a }); await refresh(); } catch (e) { alert(e.message); } });
    box.appendChild(d);
  }
  if (!current.profiles.length) box.innerHTML = '<div class="muted">Nenhum perfil cadastrado ainda.</div>';
}

async function downloadManifest(batchId) {
  const r = await api(`/api/batch/manifest?batchId=${encodeURIComponent(batchId)}`);
  downloadTextFile(r.filename, r.manifest);
}

function renderBatches() {
  const box = $('#batches'); box.innerHTML = '';
  for (const b of current.batches.slice().reverse()) {
    const d = document.createElement('div'); d.className = 'batch';
    const result = b.result ? ` · ${b.result}` : '';
    const balanceNote = !b.initialWavePlannedAt && b.balanceWaitUntil ? ` · BALANCEANDO até ${when(b.balanceWaitUntil)}` : (b.initialWaveProfiles?.length ? ` · onda inicial: ${b.initialWaveProfiles.join(', ')}` : '');
    const progress = b.total ? Math.round((b.done / b.total) * 100) : 0;
    const buttons = `<div class="batchactions">
      <button class="manifest">Baixar manifesto</button>
      ${b.failed ? '<button class="requeue">Reenviar falhas</button>' : ''}
      <button class="resetbatch">Gerar novamente</button>
      <button class="removebatch danger ghost">Remover lote</button>
    </div>`;
    d.innerHTML = `<div class="batchtop"><div><h3>${esc(b.batchId)}</h3><div class="batchsummary">${b.total} JOBs · ${b.done} DONE · ${b.running || 0} RUNNING · ${b.resultReady || 0} READY · ${b.downloading || 0} DOWNLOADING · ${b.assigned || 0} ASSIGNED · ${b.queued || 0} PENDING · ${b.failed} falhas · ${esc(b.status)}${esc(result)}${esc(balanceNote)}</div></div>${buttons}</div>
      <div class="progress"><i style="width:${progress}%"></i></div>
      <div class="jobs">${b.jobs.map(j => `<div class="job"><span>${esc(j.slot)}</span><span>${esc(j.file || j.arquivoFinal)}</span><span class="${statusClass(j.managerStatus)}">${esc(j.managerStatus)}</span><span>${esc(j.assignedProfileId || j.lastProfileId || 'fila')}</span><span class="map">${j.mappingConfidence != null ? `${esc(j.mappingConfidence)}%` : ''}</span></div>`).join('')}</div>`;
    d.querySelector('.manifest').onclick = async () => { try { await downloadManifest(b.batchId); } catch (e) { alert(e.message); } };
    const rq = d.querySelector('.requeue'); if (rq) rq.onclick = async () => { try { await api('/api/batch/requeue-failed', { batchId:b.batchId }); await refresh(); } catch (e) { alert(e.message); } };
    d.querySelector('.resetbatch').onclick = async () => { if (!confirm(`Gerar novamente TODOS os ${b.total} JOBs de ${b.batchId}?\n\nO lote precisa estar PARADO. Os arquivos já gerados não são apagados do disco; os JOBs voltam a PENDING.`)) return; try { const r = await api('/api/queue/action', { action:'reset_batch', batchId:b.batchId }); $('#controlMsg').textContent = `${r.jobsReset} JOB(s) resetados para PENDING.`; await refresh(); } catch (e) { alert(e.message); } };
    d.querySelector('.removebatch').onclick = async () => { if (!confirm(`Remover ${b.batchId} da fila?\n\nPerfis e logins serão preservados.`)) return; try { await api('/api/queue/action', { action:'remove_batch', batchId:b.batchId }); await refresh(); } catch (e) { alert(e.message); } };
    box.appendChild(d);
  }
  if (!current.batches.length) box.innerHTML = '<div class="muted">Nenhum lote na fila central.</div>';
}

function renderEvents() { $('#events').textContent = current.events.slice().reverse().map(e => `[${when(e.at)}] ${e.type} — ${e.message}`).join('\n') || 'Sem eventos.'; }
function renderControl() {
  const running = current?.control?.running === true;
  const warming = running && current?.scheduler?.preflightState === 'WARMING';
  const badge = $('#runState'); badge.textContent = warming ? 'AQUECENDO PERFIS' : (running ? 'EM EXECUÇÃO' : 'PARADO'); badge.className = `runstate ${running ? 'RUNNING' : 'STOPPED'}`;
  $('#startProduction').disabled = running; $('#stopProduction').disabled = !running;
}

async function refresh() {
  try {
    const j = await api('/api/state'); current = j.state;
    $('#dot').style.background = '#4ade80'; $('#health').textContent = `Manager ${current.version} conectado`;
    $('#burstSize').value = current.settings.burstSize;
    $('#preflightWaitSeconds').value = current.settings.preflightWaitSeconds || 30;
    $('#initialBalanceWaitSeconds').value = current.settings.initialBalanceWaitSeconds || 25;
    $('#limitHoldMinutes').value = current.settings.limitHoldMinutes || 60;
    $('#flowUrl').value = current.settings.flowUrl;
    $('#chromePath').value = current.settings.chromePath || '';
    $('#limitPhrases').value = (current.settings.limitPhrases || []).join('\n');
    renderOverview(); renderControl(); renderProfiles(); renderBatches(); renderEvents();
  } catch (e) { $('#dot').style.background = '#fb7185'; $('#health').textContent = e.message; }
}

$('#addProfile').onclick = async () => { const label = prompt('Nome do perfil (opcional):', ''); if (label === null) return; try { const r = await api('/api/profile/add', { label, open:true }); if (r.launchError) alert(`Perfil criado, mas não foi possível abrir automaticamente:\n${r.launchError}`); await refresh(); } catch (e) { alert(e.message); } };
$('#batchFile').onchange = async e => { const f = e.target.files?.[0]; if (f) $('#batchText').value = await f.text(); };
$('#sendBatch').onclick = async () => { const text = $('#batchText').value.trim(); if (!text) return; try { const r = await api('/api/batch/add', { text, name:$('#batchFile').files?.[0]?.name || 'prompts.txt' }); $('#batchMsg').textContent = `${r.jobs} JOBs adicionados${current?.control?.running ? '' : ' · clique em Iniciar'}`; $('#batchText').value = ''; await refresh(); } catch (e) { $('#batchMsg').textContent = e.message; } };
$('#saveSettings').onclick = async () => { try { await api('/api/settings', { burstSize:$('#burstSize').value, preflightWaitSeconds:$('#preflightWaitSeconds').value, initialBalanceWaitSeconds:$('#initialBalanceWaitSeconds').value, limitHoldMinutes:$('#limitHoldMinutes').value, flowUrl:$('#flowUrl').value, chromePath:$('#chromePath').value, limitPhrases:$('#limitPhrases').value }); $('#settingsMsg').textContent = 'Salvo'; await refresh(); } catch (e) { $('#settingsMsg').textContent = e.message; } };
$('#startProduction').onclick = async () => { try { const r = await api('/api/control', { action:'start' }); const opened = r.autoLaunch?.launched || 0; $('#controlMsg').textContent = `Aquecimento iniciado. ${opened} perfil(is) aberto(s) automaticamente; ${r.preflight?.profiles?.length || 0} conta(s) serão verificadas antes de liberar a fila. ${r.expiredLimits || 0} limite(s) antigo(s) foram revalidados.`; await refresh(); } catch (e) { $('#controlMsg').textContent = e.message; } };
$('#stopProduction').onclick = async () => { try { await api('/api/control', { action:'stop' }); $('#controlMsg').textContent = 'PARAR TUDO solicitado. HARD STOP no próximo heartbeat.'; await refresh(); } catch (e) { $('#controlMsg').textContent = e.message; } };
$('#clearQueue').onclick = async () => { if (!current?.batches?.length) return; if (!confirm(`Limpar TODA a fila (${current.batches.length} lote(s))?\n\nPerfis, logins e configurações serão preservados. Pare a produção antes.`)) return; try { const r = await api('/api/queue/action', { action:'clear_all' }); $('#controlMsg').textContent = `Fila limpa: ${r.batchesRemoved} lote(s), ${r.jobsRemoved} JOB(s).`; await refresh(); } catch (e) { alert(e.message); } };
$('#refresh').onclick = refresh;

function configBackupName() { const d = new Date(); const pad = n => String(n).padStart(2, '0'); return `corvo-flow-manager-config-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.json`; }
$('#exportConfig').onclick = async () => { try { const r = await api('/api/config/export'); downloadJsonFile(configBackupName(), r.config); $('#configMsg').textContent = `Backup exportado: ${r.config.profiles?.length || 0} perfil(is).`; } catch (e) { $('#configMsg').textContent = e.message; } };
$('#importConfig').onclick = () => $('#configFile').click();
$('#configFile').onchange = async e => { const f = e.target.files?.[0]; if (!f) return; try { const cfg = JSON.parse(await f.text()); if (!confirm('Importar este backup?\n\nPerfis serão mesclados pelo ID. Senhas/sessões Google não fazem parte do JSON.')) { e.target.value = ''; return; } const r = await api('/api/config/import', { config:cfg }); $('#configMsg').textContent = `Importado: ${r.result.profiles} perfil(is) · ${r.result.localDataReused} com dados locais reutilizados.`; e.target.value = ''; await refresh(); } catch (err) { $('#configMsg').textContent = err.message; e.target.value = ''; } };

refresh(); setInterval(refresh, 3000);
