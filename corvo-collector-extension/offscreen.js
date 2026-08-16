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
  // Cópia exclusiva para análise: o ZIP do Forma mantém o JPEG original.
  // Mantemos cada entrada pequena para que lotes grandes continuem anexáveis ao GPT Analista.
  const maxBytes=450*1024;
  for(const [quality,maxDimension] of [[0.78,1280],[0.72,1280],[0.66,1152],[0.60,1024],[0.54,960]]){
    const resized=await renderJpeg(jpeg,quality,maxDimension);
    if(resized.size<=maxBytes) return resized;
  }
  const smaller=await renderJpeg(jpeg,0.48,896);
  if(smaller.size>maxBytes) throw new Error('COLLECTOR_ANALYSIS_IMAGE_TOO_LARGE');
  return smaller;
}

async function uploadCollectorImage(pipelineUpload, name, jpeg) {
  if(!pipelineUpload?.jobId || !pipelineUpload?.uploadToken || !pipelineUpload?.appOrigin) return {ok:false,skipped:true};
  const uploadBlob=await collectorUploadBlob(jpeg);
  const form=new FormData();
  form.append('jobId',String(pipelineUpload.jobId));
  form.append('tipo','COLLECTOR_IMAGE');
  form.append('nomeArquivo',String(name));
  form.append('arquivo',uploadBlob,String(name));
  const response=await fetch(`${String(pipelineUpload.appOrigin).replace(/\/$/,'')}/api/corvo/arquivo`,{
    method:'POST',
    headers:{'x-corvo-upload-token':String(pipelineUpload.uploadToken)},
    body:form
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result?.ok) throw new Error(result?.message || `COLLECTOR_UPLOAD_${response.status}`);
  return result;
}

async function buildPackage(payload) {
  const { packageId, packageCode, fileName, selections, jpegQuality=0.92, includeManifest=true, pipelineUpload=null } = payload;
  const zip=new JSZip();
  const manifestLines=['CORVO FORMA PACKAGE','',`PACKAGE_CODE=${packageCode || ''}`,`PACKAGE_ID=${packageId}`,`TOTAL=${selections.length}`,''];
  let success=0,failed=0,pipelineUploaded=0,pipelineUploadFailed=0;
  const packageFiles=[];

  for(let i=0;i<selections.length;i++){
    const item=selections[i];
    await chrome.runtime.sendMessage({type:'PACKAGE_PROGRESS',packageId,current:i+1,total:selections.length,success,failed,currentName:item.outputName});
    try{
      const best=await fetchBest(item.urls||[]);
      if(!best) throw new Error('Nenhuma URL utilizável.');
      const jpeg=await convertToJpeg(best.blob,jpegQuality);
      zip.file(item.outputName,jpeg);
      let pipelineStatus='SKIPPED';
      if(pipelineUpload){
        try{
          await uploadCollectorImage(pipelineUpload,item.outputName,jpeg);
          pipelineUploaded++;
          pipelineStatus='UPLOADED';
        }catch(error){
          pipelineUploadFailed++;
          pipelineStatus=`FAILED:${String(error?.message||error)}`;
        }
      }
      manifestLines.push(`${item.outputName}|${item.id}|${item.query}|${best.width}x${best.height}|${best.url}`);
      packageFiles.push({fileName:item.outputName,itemId:item.id,query:item.query,width:best.width,height:best.height,sourceUrl:best.url,status:'OK',pipelineStatus});
      success++;
    }catch(error){
      failed++;
      manifestLines.push(`FALHOU|${item.id}|${item.query}|${String(error?.message||error)}`);
      packageFiles.push({fileName:item.outputName,itemId:item.id,query:item.query,status:'FAILED',error:String(error?.message||error)});
    }
  }

  if(includeManifest){
    zip.file('CORVO_FORMA_MANIFEST.txt',manifestLines.join('\n'));
    zip.file('CORVO_PACKAGE.json',JSON.stringify({protocol:'corvo-package/1',packageCode:packageCode||'',packageId,fileName,generatedAt:new Date().toISOString(),total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,files:packageFiles},null,2));
  }
  zip.file('README.txt',[
    'CORVO COLLECTOR V0.7.5 — PACOTE FORMA / PIPELINE',
    '',
    `Código do pacote: ${packageCode || ''}`,
    `ID técnico: ${packageId}`,
    `Imagens previstas: ${selections.length}`,
    `Sucesso: ${success}`,
    `Falhas: ${failed}`,
    `Enviadas ao app para análise: ${pipelineUploaded}`,
    `Falhas de envio ao app: ${pipelineUploadFailed}`,
    '',
    'As imagens foram convertidas para JPEG e nomeadas na ordem enviada pela interface.'
  ].join('\n'));

  const zipBlob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  if(lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
  lastBlobUrl=URL.createObjectURL(zipBlob);
  await chrome.runtime.sendMessage({type:'PACKAGE_DONE',packageId,packageCode,total:selections.length,success,failed,pipelineUploaded,pipelineUploadFailed,blobUrl:lastBlobUrl,fileName});
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(String(message?.type||'').toUpperCase()!=='OFFSCREEN_BUILD_PACKAGE') return;
  buildPackage(message.payload||{}).then(()=>sendResponse({ok:true})).catch(async error=>{
    await chrome.runtime.sendMessage({type:'PACKAGE_ERROR',packageId:message?.payload?.packageId,error:String(error?.message||error)});
    sendResponse({ok:false,error:String(error?.message||error)});
  });
  return true;
});
