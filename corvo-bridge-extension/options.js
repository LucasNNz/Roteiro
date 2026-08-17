const DEFAULTS={gptUrl:"",gptIdeasUrl:"",gptScriptUrl:"",gptPromptsUrl:"",gptAnalystUrl:"",gptRefinerUrl:"",gptGeneratorUrl:"",gptFallbackUrl:"",gptThumbUrl:"",gptYoutubeUrl:"",appOrigin:"https://roteiro-mu.vercel.app",openMode:"reuse",cleanerEnabled:false,cleanerHour:"22:00",cleanerDryRun:true};
const GPT_FIELDS=["gptIdeasUrl","gptScriptUrl","gptPromptsUrl","gptAnalystUrl","gptRefinerUrl","gptGeneratorUrl","gptFallbackUrl","gptThumbUrl","gptYoutubeUrl"];
const GPT_LINKS_SCHEMA="corvo-bridge-gpt-links";
const GPT_LINKS_VERSION=1;
const GPT_LABELS={gptIdeasUrl:"Corvo Scout / Ideias",gptScriptUrl:"Corvo Roteiro",gptPromptsUrl:"Corvo Prompts",gptAnalystUrl:"Corvo Analista",gptRefinerUrl:"Corvo Refinador",gptGeneratorUrl:"Corvo Gerador",gptFallbackUrl:"Corvo Fallback",gptThumbUrl:"Corvo Thumb",gptYoutubeUrl:"Corvo YouTube / Metadados"};
function currentGptLinks(){return Object.fromEntries(GPT_FIELDS.map(id=>[id,String(document.getElementById(id)?.value||"").trim()]));}
function validGptUrl(url){return !url||/^https:\/\/chatgpt\.com\//i.test(String(url).trim());}
function setGptLinksResult(text,type=""){const el=document.getElementById("gptLinksResult");if(!el)return;el.textContent=text||"";el.className=`backup-result${type?` ${type}`:""}`;}
function normalizeImportedLinks(parsed){
  const source=(parsed&&typeof parsed==="object"&&parsed.links&&typeof parsed.links==="object")?parsed.links:parsed;
  if(!source||typeof source!=="object"||Array.isArray(source))throw new Error("Arquivo de links inválido.");
  const links={};
  for(const id of GPT_FIELDS){if(Object.prototype.hasOwnProperty.call(source,id))links[id]=String(source[id]??"").trim();}
  // Compatibilidade com backup muito antigo que tinha somente gptUrl para Ideias.
  if(!Object.prototype.hasOwnProperty.call(links,"gptIdeasUrl")&&source.gptUrl!=null)links.gptIdeasUrl=String(source.gptUrl||"").trim();
  if(!Object.keys(links).length)throw new Error("Nenhum link de GPT reconhecido no arquivo.");
  for(const [id,url] of Object.entries(links)){if(!validGptUrl(url))throw new Error(`${GPT_LABELS[id]||id}: URL inválida. Use https://chatgpt.com/...`);}
  return links;
}
function dateStamp(){const d=new Date(),pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
async function exportGptLinks(){
  try{
    const links=currentGptLinks();
    for(const [id,url] of Object.entries(links)){if(!validGptUrl(url))throw new Error(`${GPT_LABELS[id]||id}: URL inválida. Use https://chatgpt.com/...`);}
    const payload={schema:GPT_LINKS_SCHEMA,version:GPT_LINKS_VERSION,exportedAt:new Date().toISOString(),links};
    const blob=new Blob([JSON.stringify(payload,null,2)+"\n"],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`corvo-bridge-links-gpts-${dateStamp()}.json`;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    const count=Object.values(links).filter(Boolean).length;
    setGptLinksResult(`${count} link(s) exportado(s) ✓`,"ok");
  }catch(error){setGptLinksResult(`Erro ao exportar: ${error?.message||error}`,"error");}
}
async function importGptLinksFile(file){
  try{
    if(!file) return;
    if(file.size>1024*1024)throw new Error("Arquivo muito grande para um backup de links.");
    const parsed=JSON.parse(await file.text());
    const imported=normalizeImportedLinks(parsed);
    const current=await chrome.storage.sync.get(DEFAULTS);
    // Merge: campos ausentes no arquivo permanecem como estão. Campos presentes (inclusive vazios) são restaurados.
    const merged={};
    for(const id of GPT_FIELDS)merged[id]=Object.prototype.hasOwnProperty.call(imported,id)?imported[id]:String(current[id]||"");
    await chrome.storage.sync.set({...merged,gptUrl:merged.gptIdeasUrl||""});
    for(const id of GPT_FIELDS){const el=document.getElementById(id);if(el)el.value=merged[id]||"";}
    const count=Object.keys(imported).length;
    setGptLinksResult(`${count} campo(s) importado(s) e salvo(s) ✓`,"ok");
  }catch(error){setGptLinksResult(`Erro ao importar: ${error?.message||error}`,"error");}
  finally{const input=document.getElementById("importGptLinksFile");if(input)input.value="";}
}

async function load(){const c=await chrome.storage.sync.get(DEFAULTS);for(const id of GPT_FIELDS)document.getElementById(id).value=c[id]||"";gptIdeasUrl.value=c.gptIdeasUrl||c.gptUrl||"";appOrigin.value=c.appOrigin||DEFAULTS.appOrigin;openMode.value=c.openMode||"reuse";cleanerEnabled.checked=!!c.cleanerEnabled;cleanerHour.value=c.cleanerHour||"22:00";cleanerDryRun.checked=c.cleanerDryRun!==false;}
async function save(showStatus=true){const urls=Object.fromEntries(GPT_FIELDS.map(id=>[id,document.getElementById(id).value.trim()]));const a=appOrigin.value.trim().replace(/\/+$/,""),m=openMode.value;for(const u of Object.values(urls)){if(u&&!u.startsWith("https://chatgpt.com/")){alert("Todas as URLs dos GPTs devem começar com https://chatgpt.com/");return false;}}await chrome.storage.sync.set({...urls,gptUrl:urls.gptIdeasUrl,appOrigin:a,openMode:m,cleanerEnabled:cleanerEnabled.checked,cleanerHour:cleanerHour.value||"22:00",cleanerDryRun:cleanerDryRun.checked});await chrome.runtime.sendMessage({type:"CORVO_CLEANER_RESCHEDULE"}).catch(()=>{});if(showStatus){saved.textContent="Salvo ✓";setTimeout(()=>saved.textContent="",1800);}return true;}
async function runNow(){if(!cleanerDryRun.checked&&!confirm("A exclusão real é permanente. Excluir agora somente as conversas concluídas registradas como criadas pelo Corvo Bridge?"))return;if(!await save(false))return;cleanerResult.textContent="Executando...";const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_RUN_NOW"});if(!r?.ok&&r?.error){cleanerResult.textContent=`Erro: ${r.error}`;return;}cleanerResult.textContent=r.stopped?"Limpeza parada.":(r.dryRun?`Teste: ${r.candidates||0} candidatas próprias`:`Excluídas: ${r.deleted||0} • Já removidas: ${r.alreadyMissing||0} • Falhas: ${r.failed||0}`);await syncCleanerButtons();}
async function refreshList(){cleanerResult.textContent="Atualizando lista...";refreshCleaner.disabled=true;const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_REFRESH_LIST"});if(!r?.ok&&!r?.stopped){cleanerResult.textContent=`Erro: ${r?.error||"falha"}`;}else cleanerResult.textContent=r?.stopped?"Atualização parada.":`Disponíveis: ${r.available||0} • Removidas manualmente: ${r.removed||0} • Indeterminadas: ${r.unknown||0}`;await syncCleanerButtons();}
async function stopNow(){stopCleaner.disabled=true;cleanerResult.textContent="Parando limpeza...";const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_STOP"});cleanerResult.textContent=r?.ok?"Parada solicitada.":`Erro: ${r?.error||"falha"}`;setTimeout(syncCleanerButtons,300);}
async function syncCleanerButtons(){const c=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_GET_STATE"}).catch(()=>null);const busy=Boolean(c?.status?.running||c?.refreshStatus?.running||c?.runtimeBusy);runCleaner.disabled=busy;refreshCleaner.disabled=busy;stopCleaner.disabled=!busy;stopCleaner.textContent=(c?.status?.stopping||c?.refreshStatus?.stopping)?"Parando...":"Parar limpeza";}
document.querySelector("#save").addEventListener("click",save);document.querySelector("#runCleaner").addEventListener("click",runNow);document.querySelector("#refreshCleaner").addEventListener("click",refreshList);document.querySelector("#stopCleaner").addEventListener("click",stopNow);document.querySelector("#exportGptLinks").addEventListener("click",exportGptLinks);document.querySelector("#importGptLinks").addEventListener("click",()=>document.querySelector("#importGptLinksFile").click());document.querySelector("#importGptLinksFile").addEventListener("change",e=>importGptLinksFile(e.target.files?.[0]));load();syncCleanerButtons();setInterval(syncCleanerButtons,1000);
