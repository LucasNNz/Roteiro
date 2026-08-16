let lastBlobUrl = null;

function extFromContentType(type='') {
  const t=String(type).toLowerCase();
  if(t.includes('png')) return 'png';
  if(t.includes('webp')) return 'webp';
  if(t.includes('gif')) return 'gif';
  return 'jpg';
}

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

async function collectorUploadBlob(jpeg) {
  // No automático podem existir milhares de candidatas. Todas são preservadas,
  // mas a cópia exclusiva de análise é compactada para manter o ZIP anexável.
  const maxBytes=60*1024;
  for(const [quality,maxDimension] of [[0.72,768],[0.62,720],[0.54,672],[0.46,640],[0.38,576],[0.32,544]]){
    const resized=await renderJpeg(jpeg,quality,maxDimension);
    if(resized.size<=maxBytes) return resized;
  }
  const smaller=await renderJpeg(jpeg,0.26,512);
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

async function buildPackage(payload) {
  const { packageId, packageCode, fileName, selections, jpegQuality=0.92, includeManifest=true, pipelineUpload=null, pipelineOnly=false, packageMode='FORMA' } = payload;
  const zip=new JSZip();
  const manifestHeader=['CORVO FORMA PACKAGE','',`PACKAGE_CODE=${packageCode || ''}`,`PACKAGE_ID=${packageId}`,`TOTAL=${selections.length}`,''];
  const manifestRecords=new Array(selections.length);
  let success=0,failed=0,pipelineUploaded=0,pipelineUploadFailed=0,completed=0;
  const pipelineErrors=[];
  let pipelineFatalError='';
  const packageFiles=new Array(selections.length);

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
      await chrome.runtime.sendMessage({type:'PACKAGE_PROGRESS',packageId,current:completed,total:selections.length,success,failed,currentName:item.outputName});
    }
  }

  if(pipelineOnly){
    // O modo automático pode conter centenas/milhares de candidatas. Quatro workers
    // reduzem o tempo sem transformar a extensão em uma rajada agressiva de requisições.
    let cursor=0;
    const workerCount=Math.min(4,selections.length);
    await Promise.all(Array.from({length:workerCount},async()=>{
      while(true){
        const index=cursor++;
        if(index>=selections.length) return;
        await processItem(selections[index],index);
      }
    }));
  }else{
    for(let i=0;i<selections.length;i++) await processItem(selections[i],i);
  }

  if(includeManifest && !pipelineOnly){
    zip.file('CORVO_FORMA_MANIFEST.txt',[...manifestHeader,...manifestRecords.filter(Boolean)].join('\n'));
    zip.file('CORVO_PACKAGE.json',JSON.stringify({protocol:'corvo-package/1',packageMode,packageCode:packageCode||'',packageId,fileName,generatedAt:new Date().toISOString(),total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,pipelineErrors,files:packageFiles.filter(Boolean)},null,2));
  }
  if(!pipelineOnly) zip.file('README.txt',[
    'CORVO COLLECTOR V0.7.7 — PACOTE FORMA / PIPELINE',
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
  await chrome.runtime.sendMessage({type:'PACKAGE_DONE',packageId,packageCode,total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,pipelineErrors,blobUrl,fileName});
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(String(message?.type||'').toUpperCase()!=='OFFSCREEN_BUILD_PACKAGE') return;
  buildPackage(message.payload||{}).then(()=>sendResponse({ok:true})).catch(async error=>{
    await chrome.runtime.sendMessage({type:'PACKAGE_ERROR',packageId:message?.payload?.packageId,error:String(error?.message||error)});
    sendResponse({ok:false,error:String(error?.message||error)});
  });
  return true;
});
