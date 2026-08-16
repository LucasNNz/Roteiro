function nice(s){return({IDLE:"Aguardando trabalho",CONFIG_REQUIRED:"Configuração necessária",OPENING_GPT:"Abrindo GPT",SENDING_TO_GPT:"Enviando solicitação",WAITING_ACTION:"Aguardando retorno pela Action",CAPTURING_FILE:"Capturando arquivo",UPLOADING_FILE:"Enviando arquivo",FILE_DELIVERED:"Arquivo entregue",COMPLETED:"Trabalho concluído",ERROR:"Erro"})[s.state]||s.state||"Aguardando";}
let refreshing=false;
let mappedPending=0;
let currentStatus=null;
async function refresh(){
  if(refreshing)return;
  refreshing=true;
  try{
    const s=await chrome.runtime.sendMessage({type:"CORVO_GET_STATUS"});
    currentStatus=s||null;
    document.querySelector("#state").textContent=nice(s||{});
    document.querySelector("#job").textContent=[s?.jobId?`JOB: ${s.jobId}`:"",s?.message||""].filter(Boolean).join("\n");
    const retry=document.querySelector("#retryCapture");
    retry.hidden=!s?.canRetryCapture;
    const diagButton=document.querySelector("#copyDiagnostic");
    const diagSummary=document.querySelector("#diagSummary");
    if(s?.jobId){
      const d=await chrome.runtime.sendMessage({type:"CORVO_GET_DIAGNOSTIC",payload:{jobId:s.jobId}}).catch(()=>null);
      diagButton.disabled=!d?.ok;
      if(d?.ok){
        const last=d.last||{};
        diagSummary.textContent=`🧪 Diagnóstico: ${d.events||0} eventos${last.event?` · último: ${last.event}`:""}`;
      }else{
        diagSummary.textContent="🧪 Diagnóstico aguardando eventos deste job.";
      }
    }else{
      diagButton.disabled=true;
      diagSummary.textContent="";
    }
    const c=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_GET_STATE"});
    if(c?.ok){
      const eligible=(c.records||[]).filter(r=>r.eligible===true);
      const now=Date.now(), staleMs=15*60*1000;
      const candidateRecords=eligible.filter(r=>{
        if(r.deleted||!r.conversationUrl||!r.conversationId)return false;
        if(r.done)return true;
        const state=String(r.lastBridgeState||r.cleanerState||"").toUpperCase();
        const errorAt=Number(r.lastBridgeErrorAt||r.lastBridgeStateAt||r.updatedAt||0);
        return state==="ERROR"&&errorAt>0&&(now-errorAt)>=staleMs;
      });
      const uniquePending=new Set(candidateRecords.map(r=>r.conversationId));
      mappedPending=uniquePending.size;
      const failedReady=new Set(candidateRecords.filter(r=>String(r.lastBridgeState||r.cleanerState||"").toUpperCase()==="ERROR"&&!r.done).map(r=>r.conversationId)).size;
      const today=new Set(eligible.filter(r=>r.day===new Date().toLocaleDateString("en-CA")&&r.conversationId).map(r=>r.conversationId)).size;
      document.querySelector("#cleaner").textContent=`🧹 Cleaner: ${c.config.cleanerEnabled?"ATIVO":"DESATIVADO"} • ${c.config.cleanerHour||"22:00"}\nHoje: ${today} conversas próprias • Pendentes: ${mappedPending}${failedReady?` • Falhas liberadas: ${failedReady}`:""}${c.config.cleanerDryRun!==false?" • MODO TESTE":""}`;
      const deleteButton=document.querySelector("#deleteMapped");
      const refreshButton=document.querySelector("#refreshCleaner");
      const stopButton=document.querySelector("#stopCleaner");
      const cleanerStatus=c.status||null;
      const refreshStatus=c.refreshStatus||null;
      const busy=Boolean(cleanerStatus?.running||refreshStatus?.running||c.runtimeBusy);
      deleteButton.disabled=mappedPending===0||busy;
      refreshButton.disabled=busy;
      refreshButton.textContent=refreshStatus?.running?`Atualizando ${refreshStatus.current||refreshStatus.checked||0}/${refreshStatus.candidates||mappedPending}...`:"Atualizar lista";
      stopButton.disabled=!busy;
      stopButton.textContent=(cleanerStatus?.stopping||refreshStatus?.stopping)?"Parando...":"Parar limpeza";
      deleteButton.textContent=cleanerStatus?.running
        ?`Limpando ${cleanerStatus.current||0}/${cleanerStatus.candidates||mappedPending}...`
        :(mappedPending>0?`Apagar/tentar ${mappedPending} conversa${mappedPending===1?"":"s"} agora`:"Nenhuma conversa para apagar");
      const output=document.querySelector("#cleanerAction");
      if(refreshStatus?.running){
        output.textContent=`Atualizando lista ${refreshStatus.current||refreshStatus.checked||0}/${refreshStatus.candidates||0} • Encontradas: ${refreshStatus.available||0} • Já removidas: ${refreshStatus.removed||0}`;
      }else if(cleanerStatus?.running){
        const firstError=cleanerStatus?.errors?.[0]?.error;
        output.textContent=`${cleanerStatus.stopping?"Parando":"Limpando"} ${cleanerStatus.current||0}/${cleanerStatus.candidates||0} • Excluídas: ${cleanerStatus.deleted||0} • Já removidas: ${cleanerStatus.alreadyMissing||0} • Falhas: ${cleanerStatus.failed||0}${firstError?` • ${firstError}`:""}`;
      }else if(cleanerStatus?.stopped){
        output.textContent=`Limpeza parada • Excluídas: ${cleanerStatus.deleted||0} • Já removidas: ${cleanerStatus.alreadyMissing||0} • Falhas: ${cleanerStatus.failed||0}`;
      }else if(refreshStatus?.at&&refreshStatus.removed>0){
        output.textContent=`Lista atualizada • Disponíveis: ${refreshStatus.available||0} • Removidas manualmente: ${refreshStatus.removed||0} • Indeterminadas: ${refreshStatus.unknown||0}`;
      }else if(cleanerStatus?.at){
        const firstError=cleanerStatus?.fatalError||cleanerStatus?.errors?.[0]?.error;
        output.textContent=`Última limpeza: Excluídas: ${cleanerStatus.deleted||0} • Já removidas: ${cleanerStatus.alreadyMissing||0} • Falhas: ${cleanerStatus.failed||0}${firstError?` • ${firstError}`:""}`;
      }
    }
  }finally{refreshing=false;}
}
document.querySelector("#options").addEventListener("click",()=>chrome.runtime.openOptionsPage());
document.querySelector("#retryCapture").addEventListener("click",async(e)=>{const b=e.currentTarget;b.disabled=true;b.textContent="Tentando...";try{const r=await chrome.runtime.sendMessage({type:"CORVO_RETRY_LAST_CAPTURE"});if(!r?.ok)throw new Error(r?.error||"Falha na captura");}catch(err){console.error(err);}finally{b.disabled=false;b.textContent="Tentar captura novamente";await refresh().catch(()=>{});}});
document.querySelector("#deleteMapped").addEventListener("click",async(e)=>{
  const b=e.currentTarget;
  if(mappedPending<1)return;
  const count=mappedPending;
  if(!confirm(`Apagar agora ${count} conversa${count===1?"":"s"} já liberada${count===1?"":"s"} pelo Corvo Bridge?\n\nA exclusão é permanente. Entram apenas conversas próprias já concluídas ou jobs em erro há tempo suficiente para não interferir em retries ativos.`))return;
  const output=document.querySelector("#cleanerAction");
  b.disabled=true;
  b.textContent="Apagando...";
  output.textContent="Abrindo e excluindo as conversas mapeadas...";
  try{
    const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_DELETE_MAPPED_NOW"});
    if(!r?.ok&&r?.error)throw new Error(r.error);
    const firstError=r?.errors?.[0]?.error;
    output.textContent=`Excluídas: ${r?.deleted||0} • Falhas: ${r?.failed||0}${firstError?` • ${firstError}`:""}`;
  }catch(err){
    output.textContent=`Erro: ${err?.message||"Falha na limpeza"}`;
  }finally{
    await refresh().catch(()=>{});
  }
});

document.querySelector("#refreshCleaner").addEventListener("click",async(e)=>{
  const b=e.currentTarget,output=document.querySelector("#cleanerAction");
  b.disabled=true;b.textContent="Atualizando...";output.textContent="Conferindo quais conversas mapeadas ainda existem no ChatGPT...";
  try{
    const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_REFRESH_LIST"});
    if(!r?.ok&&!r?.stopped)throw new Error(r?.error||"Falha ao atualizar");
    output.textContent=r?.stopped?"Atualização interrompida.":`Lista atualizada • Disponíveis: ${r?.available||0} • Removidas manualmente: ${r?.removed||0} • Indeterminadas: ${r?.unknown||0}`;
  }catch(err){output.textContent=`Erro ao atualizar: ${err?.message||"falha"}`;}finally{await refresh().catch(()=>{});}
});

document.querySelector("#stopCleaner").addEventListener("click",async(e)=>{
  const b=e.currentTarget,output=document.querySelector("#cleanerAction");
  b.disabled=true;b.textContent="Parando...";output.textContent="Interrompendo a limpeza e fechando a aba de manutenção...";
  try{const r=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_STOP"});if(!r?.ok)throw new Error(r?.error||"Falha ao parar");output.textContent="Limpeza parada. Nenhuma próxima conversa será processada.";}catch(err){output.textContent=`Erro ao parar: ${err?.message||"falha"}`;}finally{setTimeout(()=>refresh().catch(()=>{}),300);}
});

document.querySelector("#copyDiagnostic").addEventListener("click",async(e)=>{
  const b=e.currentTarget;
  const jobId=currentStatus?.jobId||"";
  if(!jobId)return;
  const old=b.textContent;
  b.disabled=true;
  b.classList.remove("ready","error");
  b.textContent="Preparando diagnóstico...";
  try{
    const d=await chrome.runtime.sendMessage({type:"CORVO_GET_DIAGNOSTIC",payload:{jobId}});
    if(!d?.ok||!d?.text)throw new Error(d?.error||"DIAGNOSTIC_NOT_FOUND");
    try{
      await navigator.clipboard.writeText(d.text);
    }catch{
      const ta=document.createElement("textarea");
      ta.value=d.text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.focus();ta.select();
      if(!document.execCommand("copy"))throw new Error("CLIPBOARD_COPY_FAILED");
      ta.remove();
    }
    b.textContent=`Diagnóstico copiado (${d.events||0} eventos)`;
    b.classList.add("ready");
  }catch(err){
    b.textContent=`Falhou ao copiar: ${err?.message||"erro"}`;
    b.classList.add("error");
  }finally{
    setTimeout(()=>{b.textContent=old;b.classList.remove("ready","error");refresh().catch(()=>{});},2200);
  }
});

refresh().catch(()=>{});setInterval(()=>refresh().catch(()=>{}),1000);
