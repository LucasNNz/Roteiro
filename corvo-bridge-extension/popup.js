function nice(s){return({IDLE:"Aguardando trabalho",CONFIG_REQUIRED:"Configuração necessária",OPENING_GPT:"Abrindo GPT",SENDING_TO_GPT:"Enviando solicitação",WAITING_ACTION:"Aguardando retorno pela Action",CAPTURING_FILE:"Capturando arquivo",UPLOADING_FILE:"Enviando arquivo",FILE_DELIVERED:"Arquivo entregue",COMPLETED:"Trabalho concluído",ERROR:"Erro"})[s.state]||s.state||"Aguardando";}
let refreshing=false;
let mappedPending=0;
async function refresh(){
  if(refreshing)return;
  refreshing=true;
  try{
    const s=await chrome.runtime.sendMessage({type:"CORVO_GET_STATUS"});
    document.querySelector("#state").textContent=nice(s||{});
    document.querySelector("#job").textContent=[s?.jobId?`JOB: ${s.jobId}`:"",s?.message||""].filter(Boolean).join("\n");
    const retry=document.querySelector("#retryCapture");
    retry.hidden=!s?.canRetryCapture;
    const c=await chrome.runtime.sendMessage({type:"CORVO_CLEANER_GET_STATE"});
    if(c?.ok){
      const eligible=(c.records||[]).filter(r=>r.eligible===true);
      mappedPending=eligible.filter(r=>r.done&&!r.deleted&&r.conversationUrl&&r.conversationId).length;
      const today=eligible.filter(r=>r.day===new Date().toLocaleDateString("en-CA")).length;
      document.querySelector("#cleaner").textContent=`🧹 Cleaner: ${c.config.cleanerEnabled?"ATIVO":"DESATIVADO"} • ${c.config.cleanerHour||"22:00"}\nHoje: ${today} próprias • Pendentes: ${mappedPending}${c.config.cleanerDryRun!==false?" • MODO TESTE":""}`;
      const deleteButton=document.querySelector("#deleteMapped");
      deleteButton.disabled=mappedPending===0;
      deleteButton.textContent=mappedPending>0?`Apagar ${mappedPending} mapeada${mappedPending===1?"":"s"} agora`:"Nenhuma conversa para apagar";
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
    output.textContent=`Excluídas: ${r?.deleted||0} • Falhas: ${r?.failed||0}`;
  }catch(err){
    output.textContent=`Erro: ${err?.message||"Falha na limpeza"}`;
  }finally{
    await refresh().catch(()=>{});
    setTimeout(()=>{output.textContent="";},7000);
  }
});
refresh().catch(()=>{});setInterval(()=>refresh().catch(()=>{}),1000);
