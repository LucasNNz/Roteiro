let lastBlobUrl = null;

const ANALYSIS_BATCH_ITEMS = 36;
const ANALYSIS_PREPARE_WORKERS = 8;

function priority(url='') {
  const lower=String(url).toLowerCase();
  let score=0;
  if(lower.includes('pinimg.com')){
    if(lower.includes('/originals/')) score+=100000;
    else if(lower.includes('/1200x/')) score+=90000;
    else if(lower.includes('/736x/')) score+=80000;
    else if(lower.includes('/564x/')) score+=70000;
    else if(lower.includes('/474x/')) score+=60000;
    else if(lower.includes('/236x/')) score+=10000;
  }
  const m=lower.match(/\/(\d{3,4})x(?:\/|[^0-9])/);
  if(m) score+=Number(m[1]);
  return score;
}

function orderedUrls(urls=[]) {
  return [...new Set(urls.filter(Boolean))].sort((a,b)=>priority(b)-priority(a));
}

async function fetchBest(urls=[]) {
  let fallback=null;
  for(const url of orderedUrls(urls)){
    try{
      const res=await fetch(url,{credentials:'omit',cache:'no-store'});
      if(!res.ok) continue;
      const blob=await res.blob();
      if(!blob || blob.size<512) continue;
      let width=0,height=0;
      try{
        const bitmap=await createImageBitmap(blob);
        width=bitmap.width||0; height=bitmap.height||0;
        bitmap.close?.();
      }catch{}
      const longSide=Math.max(width,height);
      const candidate={url,blob,width,height,longSide,contentType:res.headers.get('content-type')||blob.type||''};
      if(!fallback || longSide>fallback.longSide || (longSide===fallback.longSide && blob.size>fallback.blob.size)) fallback=candidate;
      if(longSide>=700) return candidate;
    }catch{}
  }
  return fallback;
}

async function renderJpeg(blob, quality=0.92, maxDimension=0) {
  const bitmap=await createImageBitmap(blob);
  let width=bitmap.width;
  let height=bitmap.height;
  if(maxDimension>0 && Math.max(width,height)>maxDimension){
    const scale=maxDimension/Math.max(width,height);
    width=Math.max(1,Math.round(width*scale));
    height=Math.max(1,Math.round(height*scale));
  }
  const canvas=document.createElement('canvas');
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap,0,0,width,height);
  bitmap.close?.();
  return await new Promise((resolve,reject)=>{
    canvas.toBlob(b=>b?resolve(b):reject(new Error('Falha convertendo JPEG.')),'image/jpeg',quality);
  });
}

async function convertToJpeg(blob, quality=0.92) {
  return await renderJpeg(blob,quality,0);
}

async function collectorUploadBlob(sourceBlob) {
  // Cópia exclusiva para análise: pequena o suficiente para agrupar dezenas por lote.
  const maxBytes=60*1024;
  for(const [quality,maxDimension] of [[0.72,768],[0.62,720],[0.54,672],[0.46,640],[0.38,576],[0.32,544]]){
    const resized=await renderJpeg(sourceBlob,quality,maxDimension);
    if(resized.size<=maxBytes) return resized;
  }
  const smaller=await renderJpeg(sourceBlob,0.26,512);
  if(smaller.size>maxBytes) throw new Error('COLLECTOR_ANALYSIS_IMAGE_TOO_LARGE');
  return smaller;
}

async function uploadCollectorImage(pipelineUpload, item, jpeg) {
  if(!pipelineUpload?.jobId || !pipelineUpload?.uploadToken || !pipelineUpload?.appOrigin) return {ok:false,skipped:true};
  const uploadBlob=await collectorUploadBlob(jpeg);
  const form=new FormData();
  form.append('jobId',String(pipelineUpload.jobId));
  form.append('id',String(item.id||''));
  form.append('tipo','COLLECTOR_IMAGE');
  form.append('nomeArquivo',String(item.outputName));
  form.append('arquivo',uploadBlob,String(item.outputName));
  const response=await fetch(`${String(pipelineUpload.appOrigin).replace(/\/$/,'')}/api/corvo/arquivo`,{
    method:'POST',
    headers:{'x-corvo-upload-token':String(pipelineUpload.uploadToken)},
    body:form
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result?.ok){
    const error=new Error(result?.message || `COLLECTOR_UPLOAD_${response.status}`);
    error.httpStatus=response.status;
    throw error;
  }
  return result;
}

async function uploadCollectorBatch(pipelineUpload, packageId, batchNumber, prepared) {
  if(!pipelineUpload?.jobId || !pipelineUpload?.uploadToken || !pipelineUpload?.appOrigin) return {ok:false,skipped:true};
  const batchZip=new JSZip();
  const index=[];
  for(const item of prepared){
    batchZip.file(item.item.outputName,item.analysisBlob);
    index.push({ id:String(item.item.id||''), name:String(item.item.outputName), contentType:'image/jpeg', size:item.analysisBlob.size });
  }
  const zipBlob=await batchZip.generateAsync({type:'blob',compression:'STORE'});
  const batchName=`collector_${String(packageId).replace(/[^a-zA-Z0-9_-]/g,'_')}_b${String(batchNumber).padStart(3,'0')}.zip`;
  const endpoint=`${String(pipelineUpload.appOrigin).replace(/\/$/,'')}/api/corvo/candidatos-lote`;
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const form=new FormData();
      form.append('jobId',String(pipelineUpload.jobId));
      form.append('nomeArquivo',batchName);
      form.append('indice',JSON.stringify(index));
      form.append('arquivo',zipBlob,batchName);
      const response=await fetch(endpoint,{method:'POST',headers:{'x-corvo-upload-token':String(pipelineUpload.uploadToken)},body:form});
      const result=await response.json().catch(()=>({}));
      if(response.ok && result?.ok){
        const accepted=Number(result.accepted||0);
        if(accepted!==prepared.length){
          const partial=new Error(`COLLECTOR_BATCH_PARTIAL_${accepted}_OF_${prepared.length}`);
          partial.httpStatus=409;
          throw partial;
        }
        return {...result,batchName,accepted};
      }
      const error=new Error(result?.message || `COLLECTOR_BATCH_UPLOAD_${response.status}`);
      error.httpStatus=response.status;
      const retryable=response.status===408 || response.status===425 || response.status===429 || response.status>=500;
      if(!retryable) throw error;
      lastError=error;
    }catch(error){
      lastError=error;
      const status=Number(error?.httpStatus||0);
      if(status && status<500 && ![408,425,429].includes(status)) throw error;
    }
    if(attempt<3) await new Promise(resolve=>setTimeout(resolve,600*attempt));
  }
  throw lastError || new Error('COLLECTOR_BATCH_UPLOAD_FAILED');
}

async function buildPackage(payload) {
  const { packageId, packageCode, fileName, selections, jpegQuality=0.92, includeManifest=true, pipelineUpload=null, pipelineOnly=false, packageMode='FORMA' } = payload;
  const zip=new JSZip();
  const manifestHeader=['CORVO FORMA PACKAGE','',`PACKAGE_CODE=${packageCode || ''}`,`PACKAGE_ID=${packageId}`,`TOTAL=${selections.length}`,''];
  const manifestRecords=new Array(selections.length);
  let success=0,failed=0,pipelineUploaded=0,pipelineUploadFailed=0,completed=0,batchesUploaded=0;
  const pipelineErrors=[];
  let pipelineFatalError='';
  const packageFiles=new Array(selections.length);

  async function reportProgress(currentName=''){
    await chrome.runtime.sendMessage({
      type:'PACKAGE_PROGRESS',packageId,current:completed,total:selections.length,success,failed,currentName,
      pipelineUploaded,pipelineUploadFailed,batchesUploaded,batchTotal:Math.ceil(selections.length/ANALYSIS_BATCH_ITEMS)
    });
  }

  async function processItem(item,index){
    try{
      const best=await fetchBest(item.urls||[]);
      if(!best) throw new Error('Nenhuma URL utilizável.');
      const jpeg=await convertToJpeg(best.blob,jpegQuality);
      if(!pipelineOnly) zip.file(item.outputName,jpeg);
      let pipelineStatus='SKIPPED';
      if(pipelineUpload){
        if(pipelineFatalError){
          pipelineUploadFailed++;
          pipelineStatus=`SKIPPED:${pipelineFatalError}`;
        }else{
          try{
            await uploadCollectorImage(pipelineUpload,item,jpeg);
            pipelineUploaded++;
            pipelineStatus='UPLOADED';
          }catch(error){
            pipelineUploadFailed++;
            const message=String(error?.message||error);
            if(!pipelineErrors.includes(message) && pipelineErrors.length<8) pipelineErrors.push(message);
            if(Number(error?.httpStatus||0)===503 || /Vercel Blob não configurado/i.test(message)) pipelineFatalError=message;
            pipelineStatus=`FAILED:${message}`;
          }
        }
      }
      manifestRecords[index]=`${item.outputName}|${item.id}|${item.query}|${best.width}x${best.height}|${best.url}`;
      packageFiles[index]={fileName:item.outputName,itemId:item.id,query:item.query,width:best.width,height:best.height,sourceUrl:best.url,status:'OK',pipelineStatus};
      success++;
    }catch(error){
      failed++;
      manifestRecords[index]=`FALHOU|${item.id}|${item.query}|${String(error?.message||error)}`;
      packageFiles[index]={fileName:item.outputName,itemId:item.id,query:item.query,status:'FAILED',error:String(error?.message||error)};
    }finally{
      completed++;
      await reportProgress(item.outputName);
    }
  }

  if(pipelineOnly){
    // Automático otimizado: prepara até 36 imagens por lote com 8 workers e envia
    // um único ZIP por lote. A decisão visual continua 100% com o Analista.
    for(let batchStart=0,batchNumber=1;batchStart<selections.length;batchStart+=ANALYSIS_BATCH_ITEMS,batchNumber++){
      if(pipelineFatalError){
        const left=selections.length-completed;
        pipelineUploadFailed+=left;
        failed+=left;
        completed=selections.length;
        await reportProgress('Falha fatal no armazenamento');
        break;
      }
      const chunk=selections.slice(batchStart,batchStart+ANALYSIS_BATCH_ITEMS);
      const prepared=new Array(chunk.length);
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(ANALYSIS_PREPARE_WORKERS,chunk.length)},async()=>{
        while(true){
          const localIndex=cursor++;
          if(localIndex>=chunk.length) return;
          const item=chunk[localIndex];
          const globalIndex=batchStart+localIndex;
          try{
            const best=await fetchBest(item.urls||[]);
            if(!best) throw new Error('Nenhuma URL utilizável.');
            const analysisBlob=await collectorUploadBlob(best.blob);
            prepared[localIndex]={item,best,analysisBlob,globalIndex};
            manifestRecords[globalIndex]=`${item.outputName}|${item.id}|${item.query}|${best.width}x${best.height}|${best.url}`;
            packageFiles[globalIndex]={fileName:item.outputName,itemId:item.id,query:item.query,width:best.width,height:best.height,sourceUrl:best.url,status:'OK',pipelineStatus:'PREPARED'};
            success++;
          }catch(error){
            failed++;
            manifestRecords[globalIndex]=`FALHOU|${item.id}|${item.query}|${String(error?.message||error)}`;
            packageFiles[globalIndex]={fileName:item.outputName,itemId:item.id,query:item.query,status:'FAILED',error:String(error?.message||error)};
          }finally{
            completed++;
            await reportProgress(item.outputName);
          }
        }
      }));
      const ready=prepared.filter(Boolean);
      if(!ready.length) continue;
      try{
        const result=await uploadCollectorBatch(pipelineUpload,packageId,batchNumber,ready);
        const accepted=Math.min(ready.length,Number(result?.accepted||ready.length));
        pipelineUploaded+=accepted;
        batchesUploaded++;
        for(const record of ready) if(packageFiles[record.globalIndex]) packageFiles[record.globalIndex].pipelineStatus='BATCH_UPLOADED';
        await reportProgress(`Lote ${batchNumber} enviado (${accepted} candidatas)`);
      }catch(error){
        pipelineUploadFailed+=ready.length;
        const message=String(error?.message||error);
        if(!pipelineErrors.includes(message) && pipelineErrors.length<8) pipelineErrors.push(message);
        for(const record of ready) if(packageFiles[record.globalIndex]) packageFiles[record.globalIndex].pipelineStatus=`FAILED:${message}`;
        if(Number(error?.httpStatus||0)===503 || /Vercel Blob não configurado/i.test(message)) pipelineFatalError=message;
        await reportProgress(`Falha no lote ${batchNumber}`);
      }
    }
  }else{
    for(let i=0;i<selections.length;i++) await processItem(selections[i],i);
  }

  if(includeManifest && !pipelineOnly){
    zip.file('CORVO_FORMA_MANIFEST.txt',[...manifestHeader,...manifestRecords.filter(Boolean)].join('\n'));
    zip.file('CORVO_PACKAGE.json',JSON.stringify({protocol:'corvo-package/1',packageMode,packageCode:packageCode||'',packageId,fileName,generatedAt:new Date().toISOString(),total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,pipelineErrors,files:packageFiles.filter(Boolean)},null,2));
  }
  if(!pipelineOnly) zip.file('README.txt',[
    'CORVO COLLECTOR V0.7.9 — PACOTE FORMA / PIPELINE',
    '',
    `Código do pacote: ${packageCode || ''}`,
    `ID técnico: ${packageId}`,
    `Imagens previstas: ${selections.length}`,
    `Sucesso: ${success}`,
    `Falhas: ${failed}`,
    `Enviadas ao app para análise: ${pipelineUploaded}`,
    `Falhas de envio ao app: ${pipelineUploadFailed}`,
    ...(pipelineErrors.length ? [`Primeiro erro do pipeline: ${pipelineErrors[0]}`] : []),
    '',
    'As imagens foram convertidas para JPEG e nomeadas na ordem enviada pela interface.'
  ].join('\n'));

  let blobUrl='';
  if(!pipelineOnly){
    const zipBlob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
    if(lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl=URL.createObjectURL(zipBlob);
    blobUrl=lastBlobUrl;
  }
  await chrome.runtime.sendMessage({
    type:'PACKAGE_DONE',packageId,packageCode,total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,pipelineErrors,
    batchesUploaded,batchTotal:Math.ceil(selections.length/ANALYSIS_BATCH_ITEMS),blobUrl,fileName
  });
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(String(message?.type||'').toUpperCase()!=='OFFSCREEN_BUILD_PACKAGE') return;
  buildPackage(message.payload||{}).then(()=>sendResponse({ok:true})).catch(async error=>{
    await chrome.runtime.sendMessage({type:'PACKAGE_ERROR',packageId:message?.payload?.packageId,error:String(error?.message||error)});
    sendResponse({ok:false,error:String(error?.message||error)});
  });
  return true;
});
