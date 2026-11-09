/* citymeter-shell · launch card. This classic script runs before the modules and the CDN dependencies. Every demo
 * on the shell loads the same bytes and gives its own words on the script element:
 *   <script src="js/shell/launch.js?v=…" data-public="https://montri-th.github.io/hotel/" data-name="Hotel"
 *     data-reading="ที่พัก"></script>
 * data-boundary names the areas the page reads (default เขต/อำเภอ; e.g. แขวง/ตำบล, shell 0.4.0).
 * The file bridge always targets that one public origin and preserves only query/hash state.
 * It does not read local data or change browser security settings.
 * App contract: window events citymeter:ready, citymeter:load-error and citymeter:progress (a longer load, e.g. a
 * group of places a link asks for).
 * One automatic retry (shell 0.3.0): when a module fails to load or a server answers 5xx or not at all, the page
 * reloads once by itself. GitHub Pages answered 503 for some minutes after a deploy, and one failed module stops
 * the whole page (live 2026-11-08 on Hotel: js/model.js). A second failure within RETRY_WINDOW_MS shows the card.
 * The mark lives in sessionStorage for this page and is cleared once the page is ready; without sessionStorage
 * there is no automatic retry, so the page never reloads in a loop.
 *
 * Part of the shared CityMETER demo shell: edit it in every repository at once (js/shell/manifest.json).
 */
(function(){
 'use strict';
 const cfg=(document.currentScript&&document.currentScript.dataset)||{};
 const PUBLIC_URL=cfg.public||window.location.origin+window.location.pathname;
 const NAME=cfg.name||'CityMETER';
 const READING=cfg.reading||'';
 const BOUNDARY=cfg.boundary||'เขต/อำเภอ';
 const RETRY_KEY='citymeter-launch-retry:'+window.location.pathname;
 const RETRY_WINDOW_MS=120000;
 const publicTarget=new URL(PUBLIC_URL);
 publicTarget.search=window.location.search;
 publicTarget.hash=window.location.hash;
 const isFile=window.location.protocol==='file:';
 let phase=isFile?'file':'loading',failure=null,warning='',progress='',elements=null,slowTimer,failTimer,redirectTimer;
 function text(value){return typeof value==='string'?value:String(value??'');}
 function clearTimers(){window.clearTimeout(slowTimer);window.clearTimeout(failTimer);}
 function diagnostics(){
  if(!failure)return warning;
  return [failure.resource&&'Resource: '+text(failure.resource),failure.status!=null&&'Status: '+text(failure.status),failure.phase&&'Phase: '+text(failure.phase),failure.diagnostic&&text(failure.diagnostic)].filter(Boolean).join('\n');
 }
 function render(){
  document.documentElement.dataset.launchState=phase;
  if(!elements)return;
  const e=elements;
  e.panel.hidden=phase==='ready';
  e.panel.setAttribute('aria-busy',String(phase==='loading'||phase==='slow'||phase==='retry'));
  e.panel.setAttribute('role',phase==='error'?'alert':'status');
  e.retry.hidden=!['error','slow'].includes(phase);
  e.public.href=publicTarget.href;
  e.public.textContent=publicTarget.href;
  if(phase==='file'){
   e.title.textContent='กำลังเปิดเว็บ '+NAME;
   e.message.textContent='หน้านี้เปิดจากไฟล์ในเครื่อง กำลังพาไปเว็บสาธารณะเพื่อโหลดข้อมูลและแผนที่ หากหน้าไม่เปลี่ยน ให้กดลิงก์ด้านล่าง';
  }else if(phase==='error'){
   e.title.textContent='ยังโหลดข้อมูลไม่สำเร็จ';
   e.message.textContent=text(failure?.message)||'ไม่สามารถเริ่มหน้าจอได้ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะจากลิงก์ด้านล่าง';
  }else if(phase==='retry'){
   e.title.textContent='กำลังลองโหลดอีกครั้ง';
   e.message.textContent='มีไฟล์โหลดไม่สำเร็จ กำลังโหลดหน้านี้ใหม่ให้อัตโนมัติ';
  }else if(phase==='slow'){
   e.title.textContent='กำลังรอข้อมูล';
   e.message.textContent='การโหลดใช้เวลานานกว่าปกติ คุณสามารถรอต่อ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะจากลิงก์ด้านล่าง';
  }else if(phase==='loading'){
   e.title.textContent='กำลังโหลดข้อมูล';
   e.message.textContent=warning?'กำลังอ่านข้อมูล'+READING+' บางส่วนของแผนที่หรือกราฟยังโหลดไม่ครบ':progress?progress+' หากรอนาน สามารถเปิดเว็บสาธารณะได้จากลิงก์นี้':'กำลังอ่านข้อมูล'+READING+'และขอบเขต'+BOUNDARY+' หากรอนาน สามารถเปิดเว็บสาธารณะได้จากลิงก์นี้';
  }
  const detail=diagnostics();e.debug.hidden=!detail;e.diagnostics.textContent=detail;
 }
 // A failed module or a server that answered 5xx (or nothing) may pass in a moment; a 404 or a script error will not.
 function retryable(detail){
  if(!detail||typeof detail!=='object')return false;
  const status=detail.status==null||detail.status===''?NaN:Number(detail.status);
  return detail.phase==='module-load'||status>=500||status===0;
 }
 function reloadOnce(){
  try{
   const last=Number(window.sessionStorage.getItem(RETRY_KEY));
   if(last&&Date.now()-last<RETRY_WINDOW_MS)return false;
   window.sessionStorage.setItem(RETRY_KEY,String(Date.now()));
  }catch{return false;}
  phase='retry';render();
  window.location.reload();
  return true;
 }
 function fail(detail){
  if(isFile||phase==='ready'||phase==='retry')return;
  clearTimers();failure=detail&&typeof detail==='object'?detail:{message:text(detail)};
  if(retryable(failure)&&reloadOnce())return;
  phase='error';render();
 }
 function ready(){
  if(isFile)return;clearTimers();failure=null;phase='ready';render();
  try{window.sessionStorage.removeItem(RETRY_KEY);}catch{}
 }
 function dependencyWarning(resource){
  if(isFile||phase==='ready')return;
  warning='โหลดส่วนประกอบไม่สำเร็จ: '+text(resource);render();
 }
 function bind(){
  if(elements)return true;
  const ids={panel:'launch-status',title:'launch-title',message:'launch-message',public:'launch-public',retry:'launch-retry',debug:'launch-debug',diagnostics:'launch-diagnostics'};
  const found={};for(const [key,id]of Object.entries(ids)){found[key]=document.getElementById(id);if(!found[key])return false;}
  elements=found;elements.retry.addEventListener('click',()=>window.location.reload());render();
  if(isFile){
   redirectTimer=window.setTimeout(()=>{
    try{window.location.replace(publicTarget.href);}catch{
     elements.title.textContent='เปิดเว็บ '+NAME;
     elements.message.textContent='ไม่สามารถเปลี่ยนหน้าอัตโนมัติได้ กรุณากดลิงก์เว็บสาธารณะด้านล่าง';
    }
   },800);
  }else if(phase==='loading'){
   slowTimer=window.setTimeout(()=>{if(phase==='loading'){phase='slow';render();}},15000);
   failTimer=window.setTimeout(()=>fail({message:'ยังเริ่มหน้าจอไม่สำเร็จ อาจมีไฟล์ข้อมูลหรือส่วนประกอบโหลดไม่ครบ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง',phase:'startup-timeout',diagnostic:warning||'No citymeter:ready event received within 60 seconds.'}),60000);
  }
  return true;
 }
 window.addEventListener('citymeter:ready',ready);
 window.addEventListener('citymeter:progress',event=>{if(isFile||phase==='ready')return;progress=text(event.detail?.message);window.clearTimeout(failTimer);failTimer=window.setTimeout(()=>fail({message:'ยังเริ่มหน้าจอไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง',phase:'startup-timeout',diagnostic:'No citymeter:ready event received within 180 seconds of '+progress}),180000);render();});
 window.addEventListener('citymeter:load-error',event=>fail(event.detail));
 window.addEventListener('error',event=>{
  const target=event.target;
  if(target?.tagName==='SCRIPT'){
   const resource=target.src||target.getAttribute('src')||'';
   if(/\/js\/app\.js(?:[?#]|$)/.test(resource))fail({message:'โหลดส่วนแสดงข้อมูลไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง',resource,phase:'module-load'});
   else dependencyWarning(resource);
  }else if(event.message){
   fail({message:'เริ่มหน้าจอไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง',resource:event.filename,phase:'script-error',diagnostic:event.message});
  }
 },true);
 window.addEventListener('unhandledrejection',event=>{
  const reason=event.reason;
  fail({message:'การโหลดหน้าจอหยุดก่อนข้อมูลพร้อม ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง',phase:'unhandled-rejection',diagnostic:reason?.message||text(reason)});
 });
 window.addEventListener('pagehide',()=>{clearTimers();window.clearTimeout(redirectTimer);});
 if(!bind()){
  const observer=new MutationObserver(()=>{if(bind())observer.disconnect();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{bind();observer.disconnect();},{once:true});
 }
})();
