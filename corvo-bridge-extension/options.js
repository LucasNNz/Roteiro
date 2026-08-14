const DEFAULTS={gptUrl:"",appOrigin:"https://roteiro-mu.vercel.app",openMode:"reuse"};
async function load(){const c=await chrome.storage.sync.get(DEFAULTS);gptUrl.value=c.gptUrl||"";appOrigin.value=c.appOrigin||DEFAULTS.appOrigin;openMode.value=c.openMode||"reuse";}
async function save(){const u=gptUrl.value.trim(),a=appOrigin.value.trim().replace(/\/+$/,""),m=openMode.value;if(u&&!u.startsWith("https://chatgpt.com/")){alert("A URL do GPT deve começar com https://chatgpt.com/");return;}await chrome.storage.sync.set({gptUrl:u,appOrigin:a,openMode:m});saved.textContent="Salvo ✓";setTimeout(()=>saved.textContent="",1800);}
document.querySelector("#save").addEventListener("click",save);load();
