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
      mappedPending=eligible.filter(r=>r.done&&!r.deleted&&r.conversationUrl&&r.conversationId).length;
      const today=eligible.filter(r=>r.day===new Date().toLocaleDateString("en-CA")).length;
      document.querySelector("#cleaner").textContent=`🧹 Cleaner: ${c.config.cleanerEnabled?"ATIVO":"DESATIVADO"} • ${c.config.cleanerHour||"22:00"}\nHoje: ${today} próprias • Pendentes: ${mappedPending}${c.config.cleanerDryRun!==false?" • MODO TESTE":""}`;
      const deleteButton=document.querySelector("#deleteMapped");
      const cleanerStatus=c.status||null;
      deleteButton.disabled=mappedPending===0||Boolean(cleanerStatus?.running);
      deleteButton.textContent=cleanerStatus?.running
        ?`Limpando ${cleanerStatus.current||0}/${cleanerStatus.candidates||mappedPending}...`
        :(mappedPending>0?`Apagar ${mappedPending} mapeada${mappedPending===1?"":"s"} agora`:"Nenhuma conversa para apagar");
      const output=document.querySelector("#cleanerAction");
      if(cleanerStatus?.running){
        const firstError=cleanerStatus?.errors?.[0]?.error;
        output.textContent=`Limpando ${cleanerStatus.current||0}/${cleanerStatus.candidates||0} • Excluídas: ${cleanerStatus.deleted||0} • Falhas: ${cleanerStatus.failed||0}${firstError?` • ${firstError}`:""}`;
      }else if(cleanerStatus?.at){
        const firstError=cleanerStatus?.fatalError||cleanerStatus?.errors?.[0]?.error;
        output.textContent=`Última limpeza: Excluídas: ${cleanerStatus.deleted||0} • Falhas: ${cleanerStatus.failed||0}${firstError?` • ${firstError}`:""}`;
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
  if(!confirm(`Apagar agora ${count} conversa${count===1?"":"s"} concluída${count===1?"":"s"} já mapeada${count===1?"":"s"} pelo Corvo Bridge?\n\nA exclusão é permanente. Somente conversas próprias, concluídas e já registradas pelo Cleaner serão usadas.`))return;
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
