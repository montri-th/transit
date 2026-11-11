/* citymeter-shell · launch card. This classic script runs before the modules and the CDN dependencies. Every demo
 * on the shell loads the same bytes and gives its own words on the script element:
 *   <script src="js/shell/launch.js?v=…" data-public="https://montri-th.github.io/hotel/" data-name="Hotel"
 *     data-reading="ที่พัก"></script>
 * data-boundary names the areas the page reads (default เขต/อำเภอ; e.g. แขวง/ตำบล, shell 0.4.0).
 * English (shell 0.5.0): on a page that declares English (<meta name="citymeter:languages" content="th en">, placed
 * before this script) and is opened with ?lang=en, the card speaks English — data-reading-en and data-boundary-en give
 * the demo's words — the page is marked lang="en", and it stays hidden (html[data-i18n="pending"], navigation.css)
 * until js/shell/i18n.js has translated it, or 4 seconds have passed, or the card shows an error.
 * The file bridge always targets that one public origin and preserves only query/hash state.
 * It does not read local data or change browser security settings.
 * App contract: window events citymeter:ready, citymeter:load-error and citymeter:progress (a longer load, e.g. a
 * group of places a link asks for).
 * One automatic retry (shell 0.3.0): when a module fails to load or a server answers 5xx or not at all, the page
 * reloads once by itself. GitHub Pages answered 503 for some minutes after a deploy, and one failed module stops
 * the whole page (live 2026-11-08 on Hotel: js/model.js). A second failure within RETRY_WINDOW_MS shows the card.
 * The mark lives in sessionStorage for this page and is cleared once the page is ready; without sessionStorage
 * there is no automatic retry, so the page never reloads in a loop.
 * Part of a result (shell 0.6.0): a demo that could not load one of its optional files says so with
 *   window.dispatchEvent(new CustomEvent('citymeter:partial',{detail:{id,label,effect,labelEn,effectEn}}))
 * and the page shows it — what is missing and what that does to the numbers on screen — with one button that reloads
 * the page (the address keeps the place and the filters). The notice folds to a small mark that stays until the page
 * is reloaded, so a result that lacks a part never reads as a whole one. {id, resolved:true} takes an entry back.
 * The map (0.6.0): the pinned MapLibre script and stylesheet start loading here, while the data loads, with the same
 * integrity values as js/shell/vendors.js (which adopts these two elements); after citymeter:ready a small line says
 * the map is still loading until window.__citymeter.map reports loaded (or the demo shows #map-failure).
 * Marks for measuring (0.6.0): performance marks citymeter:ready, citymeter:map-ready and citymeter:partial; the
 * event citymeter:map-ready follows the mark.
 * The theme before the first paint (0.6.0, owner 2026-11-11 20:38: “หน้ารอโหลดเป็นสีขาวสว่างแม้ใน dark theme”): this
 * script sets html[data-theme] at once — the reader's choice for this demo (data-theme-key names the localStorage key
 * js/app.js writes), else the device's — with the matching color-scheme and theme-color, so the page and this card
 * are dark from the first frame. js/app.js sets the same value again when it starts.
 * A page that was stopped (0.6.0, same message: “เวบโหลดไม่สำเร็จดับบ่อยมาก”): a phone ends a page that asks for too
 * much memory, and a map can lose its WebGL context. The page keeps a mark in sessionStorage while it is on screen;
 * when the mark is still there at the next start (no pagehide, so the browser ended it), or the demo reports
 *   window.dispatchEvent(new CustomEvent('citymeter:map-trouble',{detail:{kind:'context-lost'}}))
 * the page turns lean for this tab — html[data-lean="recovered"], read by js/shell/maplibre-guard.js#mapBudget — and
 * the notice says so with a button back to the full map. ?lean=1 asks for it, ?lean=phone for a phone's budget on
 * any device, ?lean=0 for the full map. The last few of these events are kept for the notice's details.
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
 const EN=new URLSearchParams(window.location.search).get('lang')==='en'&&/(^|[\s,])en([\s,]|$)/.test(document.querySelector('meta[name="citymeter:languages"]')?.getAttribute('content')||'');
 const L=(th,en)=>EN?en:th;
 const READING_EN=cfg.readingEn||'data';
 const BOUNDARY_EN=cfg.boundaryEn||'district boundaries';
 if(EN){
  document.documentElement.lang='en';
  document.documentElement.dataset.i18n='pending';
  window.setTimeout(()=>{delete document.documentElement.dataset.i18n;},4000);
 }
 const RETRY_KEY='citymeter-launch-retry:'+window.location.pathname;
 const RETRY_WINDOW_MS=120000;
 const publicTarget=new URL(PUBLIC_URL);
 publicTarget.search=window.location.search;
 publicTarget.hash=window.location.hash;
 const isFile=window.location.protocol==='file:';
 // ---- the theme before the first paint (0.6.0) ----
 const root=document.documentElement;
 const THEME_KEY=cfg.themeKey||'';
 const tint={};
 const tintMetas=()=>document.querySelectorAll('meta[name="theme-color"]');
 for(const meta of tintMetas())tint[/dark/.test(meta.getAttribute('media')||'')?'dark':'light']=meta.getAttribute('content');
 // The browser's own surfaces (canvas before the stylesheets, form controls, the address bar) follow the page's theme.
 function themeChrome(){
  const theme=root.dataset.theme==='dark'?'dark':'light';
  root.style.colorScheme=theme;
  if(tint[theme])for(const meta of tintMetas())meta.setAttribute('content',tint[theme]);
 }
 (function earlyTheme(){
  let stored='';try{stored=THEME_KEY?window.localStorage.getItem(THEME_KEY)||'':'';}catch{}
  let dark=stored==='dark';
  if(stored!=='dark'&&stored!=='light'){try{dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch{}}
  root.dataset.theme=dark?'dark':'light';themeChrome();
  try{new MutationObserver(themeChrome).observe(root,{attributes:true,attributeFilter:['data-theme']});}catch{}
 })();
 // ---- a page that was stopped starts lean (0.6.0) ----
 const LIFE_KEY='citymeter-life:'+window.location.pathname;
 const LIFE_WINDOW_MS=6*3600*1000;
 let life={state:'',at:0,ended:0,lean:'',noted:false,log:[]};
 function keepLife(){try{window.sessionStorage.setItem(LIFE_KEY,JSON.stringify(life));}catch{}}
 function logLife(what){life.log=life.log.concat([[Date.now(),String(what).slice(0,80)]]).slice(-12);}
 function setLean(value){
  life.lean=value;
  if(value==='recovered'||value==='phone')root.dataset.lean=value;else delete root.dataset.lean;
 }
 (function startLife(){
  if(isFile)return;
  try{
   const before=JSON.parse(window.sessionStorage.getItem(LIFE_KEY)||'null');
   if(before&&typeof before==='object')life={state:String(before.state||''),at:Number(before.at)||0,ended:Number(before.ended)||0,lean:String(before.lean||''),noted:Boolean(before.noted),log:Array.isArray(before.log)?before.log.filter(e=>Array.isArray(e)&&e.length===2).slice(-12):[]};
  }catch{}
  // On screen at its last sign of life and never said goodbye: the browser ended it.
  const endedOnScreen=life.state==='visible'&&Date.now()-life.at<LIFE_WINDOW_MS;
  if(endedOnScreen){life.ended+=1;life.lean='recovered';life.noted=false;logLife('ended on screen');}
  const asked=new URLSearchParams(window.location.search).get('lean');
  if(asked==='1')life.lean='recovered';else if(asked==='phone')life.lean='phone';else if(asked==='0')life.lean='off';
  setLean(life.lean);
  const seen=()=>{life.state=document.visibilityState==='hidden'?'hidden':'visible';life.at=Date.now();keepLife();};
  seen();
  window.setInterval(()=>{if(life.state==='visible')seen();},15000);
  document.addEventListener('visibilitychange',seen);
  window.addEventListener('pageshow',event=>{if(event.persisted)seen();});
  window.addEventListener('pagehide',()=>{life.state='closed';life.at=Date.now();keepLife();});
 })();
 let phase=isFile?'file':'loading',failure=null,warning='',progress='',elements=null,slowTimer,failTimer,redirectTimer;
 // The pinned map library (same version and integrity as js/shell/vendors.js; tests/shell.test.js keeps them equal).
 const MAP_LIBRARY={version:'5.6.2',script:'sha384-1qC0PnXk2fgMDybOtZF1ui4LM5Sxm7o0TbEkwfxTTVdlZvuNENNGCKUub7d644HP',style:'sha384-gNYNsUmuZqDYiT3gbirWTV5K7rt71RoveS/yXAaU09d4ZUmeDVTD3XoqB6uJAIFR'};
 function mark(name){try{window.performance.mark(name);}catch{}}
 function startMapLibrary(){
  if(isFile||!document.head)return;
  const base='https://unpkg.com/maplibre-gl@'+MAP_LIBRARY.version+'/dist/maplibre-gl';
  try{
   for(const origin of ['https://unpkg.com','https://tiles.openfreemap.org']){const hint=document.createElement('link');hint.rel='preconnect';hint.href=origin;hint.crossOrigin='anonymous';document.head.appendChild(hint);}
   // A failed early element is removed, so the loader in js/shell/vendors.js starts from nothing and reports the error.
   const style=document.createElement('link');style.rel='stylesheet';style.href=base+'.css';style.crossOrigin='anonymous';style.integrity=MAP_LIBRARY.style;style.dataset.citymeterLibrary='early';style.onerror=()=>style.remove();document.head.appendChild(style);
   const script=document.createElement('script');script.async=true;script.src=base+'.js';script.crossOrigin='anonymous';script.integrity=MAP_LIBRARY.script;script.dataset.citymeterLibrary='early';script.onerror=()=>script.remove();document.head.appendChild(script);
  }catch{}
 }
 startMapLibrary();
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
   e.title.textContent=L('กำลังเปิดเว็บ ','Opening ')+NAME;
   e.message.textContent=L('หน้านี้เปิดจากไฟล์ในเครื่อง กำลังพาไปเว็บสาธารณะเพื่อโหลดข้อมูลและแผนที่ หากหน้าไม่เปลี่ยน ให้กดลิงก์ด้านล่าง','This page was opened from a file on this computer. Taking you to the public site to load the data and the map; if nothing changes, use the link below.');
  }else if(phase==='error'){
   delete document.documentElement.dataset.i18n;
   e.title.textContent=L('ยังโหลดข้อมูลไม่สำเร็จ','The data has not loaded');
   e.message.textContent=text(failure?.message)||L('ไม่สามารถเริ่มหน้าจอได้ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะจากลิงก์ด้านล่าง','The page could not start. Reload, or open the public site from the link below.');
  }else if(phase==='retry'){
   e.title.textContent=L('กำลังลองโหลดอีกครั้ง','Trying again');
   e.message.textContent=L('มีไฟล์โหลดไม่สำเร็จ กำลังโหลดหน้านี้ใหม่ให้อัตโนมัติ','A file did not load. Reloading this page automatically.');
  }else if(phase==='slow'){
   e.title.textContent=L('กำลังรอข้อมูล','Waiting for the data');
   e.message.textContent=L('การโหลดใช้เวลานานกว่าปกติ คุณสามารถรอต่อ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะจากลิงก์ด้านล่าง','Loading is taking longer than usual. You can keep waiting, reload, or open the public site from the link below.');
  }else if(phase==='loading'){
   e.title.textContent=L('กำลังโหลดข้อมูล','Loading the data');
   e.message.textContent=EN
    ?(warning?'Reading the '+READING_EN+'. Part of the map or charts has not loaded.':progress?progress+' If this takes long, the public site opens from this link.':'Reading the '+READING_EN+' and '+BOUNDARY_EN+'. If this takes long, the public site opens from this link.')
    :(warning?'กำลังอ่านข้อมูล'+READING+' บางส่วนของแผนที่หรือกราฟยังโหลดไม่ครบ':progress?progress+' หากรอนาน สามารถเปิดเว็บสาธารณะได้จากลิงก์นี้':'กำลังอ่านข้อมูล'+READING+'และขอบเขต'+BOUNDARY+' หากรอนาน สามารถเปิดเว็บสาธารณะได้จากลิงก์นี้');
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
  warning=L('โหลดส่วนประกอบไม่สำเร็จ: ','A component did not load: ')+text(resource);render();
 }
 function bind(){
  if(elements)return true;
  const ids={panel:'launch-status',title:'launch-title',message:'launch-message',public:'launch-public',retry:'launch-retry',debug:'launch-debug',diagnostics:'launch-diagnostics'};
  const found={};for(const [key,id]of Object.entries(ids)){found[key]=document.getElementById(id);if(!found[key])return false;}
  elements=found;elements.retry.addEventListener('click',()=>window.location.reload());render();
  if(isFile){
   redirectTimer=window.setTimeout(()=>{
    try{window.location.replace(publicTarget.href);}catch{
     elements.title.textContent=L('เปิดเว็บ ','Open ')+NAME;
     elements.message.textContent=L('ไม่สามารถเปลี่ยนหน้าอัตโนมัติได้ กรุณากดลิงก์เว็บสาธารณะด้านล่าง','The page could not move by itself. Please use the public site link below.');
    }
   },800);
  }else if(phase==='loading'){
   slowTimer=window.setTimeout(()=>{if(phase==='loading'){phase='slow';render();}},15000);
   failTimer=window.setTimeout(()=>fail({message:L('ยังเริ่มหน้าจอไม่สำเร็จ อาจมีไฟล์ข้อมูลหรือส่วนประกอบโหลดไม่ครบ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง','The page has not started; a data file or a component may not have loaded. Reload, or open the public site below.'),phase:'startup-timeout',diagnostic:warning||'No citymeter:ready event received within 60 seconds.'}),60000);
  }
  return true;
 }
 // ---- a result that lacks a part, and the lean map (0.6.0) ----
 const partial=new Map();let notice=null,noticeOpen=null;
 const LEAN_NOTE={id:'lean-map',mode:true,label:'แผนที่แบบเบา',labelEn:'Light map',
  effect:'แผนที่หยุดกลางคัน จึงเปิดใหม่แบบเบา: วาดอาคารเฉพาะรอบจุดที่ดู และไม่ยกภูมิประเทศเป็น 3 มิติ ข้อมูลครบตามเดิม',
  effectEn:'The map stopped, so it started again in a lighter form: buildings round the place in view only, and flat ground. The data is complete.'};
 function el(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!=null)node.textContent=content;return node;}
 function sign(d){
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const path=document.createElementNS(NS,'path');path.setAttribute('d',d);path.setAttribute('fill','currentColor');svg.appendChild(path);return svg;
 }
 const warningSign=()=>sign('M12 3 2 20h20L12 3Zm-1 6h2v6h-2V9Zm0 8h2v2h-2v-2Z');
 const noteSign=()=>sign('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v2h-2V7Zm0 4h2v6h-2v-6Z');
 // What the page went through, for a report: the last events of this tab and the screen. Nothing is sent anywhere.
 function lifeDetails(){
  if(!life.log.length)return '';
  const clock=t=>{const d=new Date(t);return [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');};
  const lines=life.log.map(([t,what])=>clock(t)+' '+what);
  lines.push(window.innerWidth+'×'+window.innerHeight+' @'+(Math.round((window.devicePixelRatio||1)*100)/100)+' · '+text(window.navigator.userAgent).replace(/^Mozilla\/5\.0 /,'').slice(0,140));
  return lines.join('\n');
 }
 function fullMap(){
  life.lean='off';keepLife();
  const next=new URL(window.location.href);next.searchParams.delete('lean');
  window.location.replace(next.href);
 }
 function renderNotice(){
  if(isFile||phase!=='ready'||!document.body)return;
  const missing=[...partial.values()].filter(item=>!item.mode),modes=[...partial.values()].filter(item=>item.mode);
  if(missing.length)root.dataset.partial=String(missing.length);else delete root.dataset.partial;
  if(!partial.size){if(notice){notice.remove();notice=null;}return;}
  // Missing data opens by itself; the lean note opens once per tab, then stays folded to its mark.
  if(noticeOpen===null)noticeOpen=missing.length?true:!life.noted;
  if(noticeOpen&&modes.length&&!life.noted){life.noted=true;keepLife();}
  if(!notice){notice=el('aside','data-notice');notice.id='data-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.appendChild(notice);}
  notice.textContent='';notice.dataset.open=String(noticeOpen);notice.dataset.kind=missing.length?'missing':'mode';
  const title=missing.length?L('ข้อมูลไม่ครบ','Data incomplete'):(EN&&modes[0].labelEn?modes[0].labelEn:modes[0].label);
  const toggle=el('button','data-notice-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(noticeOpen));toggle.setAttribute('aria-controls','data-notice-body');
  toggle.append(missing.length?warningSign():noteSign(),el('span','data-notice-label',title));
  toggle.setAttribute('aria-label',missing.length?L('ข้อมูลไม่ครบ '+missing.length+' ส่วน','Data incomplete: '+missing.length+(missing.length===1?' part':' parts')):title);
  toggle.addEventListener('click',()=>{noticeOpen=!noticeOpen;renderNotice();notice.querySelector('.data-notice-toggle').focus();});
  const body=el('div','data-notice-body');body.id='data-notice-body';body.hidden=!noticeOpen;
  const actions=el('div','data-notice-actions'),fold=el('button','data-notice-fold',L('ย่อ','Fold'));
  fold.type='button';
  fold.addEventListener('click',()=>{noticeOpen=false;renderNotice();notice.querySelector('.data-notice-toggle').focus();});
  const say=item=>{const name=el('strong',null,EN&&item.labelEn?item.labelEn:item.label),effect=EN&&item.effectEn?item.effectEn:item.effect;return [name,effect?' — '+effect:''];};
  if(missing.length){
   body.append(el('p','data-notice-lead',L('โหลดข้อมูลบางส่วนไม่สำเร็จ ผลที่แสดงอยู่จึงยังไม่ครบ','Part of the data did not load, so what is shown is incomplete')));
   const list=el('ul','data-notice-list');
   for(const item of missing){const row=el('li');row.append(...say(item));list.append(row);}
   const again=el('button','data-notice-retry',L('ลองโหลดใหม่','Reload'));again.type='button';
   again.addEventListener('click',()=>window.location.reload());
   body.append(list,el('p','data-notice-hint',L('การโหลดใหม่ยังอยู่ที่พื้นที่และตัวกรองเดิม','Reloading keeps the place and the filters')));
   actions.append(again);
  }
  for(const item of modes){
   const line=el('p','data-notice-mode');line.append(...say(item));body.append(line);
   if(item.id===LEAN_NOTE.id){
    const full=el('button','data-notice-full',L('แสดงแบบเต็ม','Full map'));full.type='button';
    full.addEventListener('click',fullMap);actions.append(full);
   }
  }
  actions.append(fold);body.append(actions);
  const details=lifeDetails();
  if(details){
   const more=el('details','data-notice-detail'),summary=el('summary',null,L('รายละเอียดเพื่อแจ้งปัญหา','Details for a report'));
   more.append(summary,el('pre',null,details));body.append(more);
  }
  notice.append(toggle,body);
 }
 function notePartial(detail){
  if(!detail||typeof detail!=='object')return;
  const id=text(detail.id||detail.label);if(!id)return;
  if(detail.resolved){if(partial.delete(id))renderNotice();return;}
  if(partial.has(id))return;
  partial.set(id,{id,mode:Boolean(detail.mode),label:text(detail.label||id),effect:text(detail.effect||''),labelEn:text(detail.labelEn||''),effectEn:text(detail.effectEn||'')});
  if(!detail.mode)mark('citymeter:partial');
  if(!detail.mode)noticeOpen=true;
  renderNotice();
 }
 // The map told us it was in trouble: remember it, and after a lost context the tab stays lean.
 function mapTrouble(detail){
  const kind=text(detail&&detail.kind);if(!kind||isFile)return;
  logLife(kind+(detail.note?' '+text(detail.note).slice(0,48):''));
  if(kind==='context-lost'&&life.lean!=='recovered'){setLean('recovered');life.noted=false;noticeOpen=null;}
  keepLife();
  if(root.dataset.lean==='recovered')notePartial(LEAN_NOTE);else renderNotice();
 }
 // ---- the map after the data (0.6.0) ----
 let mapPoll,mapLine=null,mapSince=0,mapDone=false;
 function mapFinished(loaded,told){
  if(mapDone)return;mapDone=true;window.clearInterval(mapPoll);
  if(mapLine){mapLine.remove();mapLine=null;}
  if(loaded){mark('citymeter:map-ready');if(!told){try{window.dispatchEvent(new CustomEvent('citymeter:map-ready'));}catch{}}}
 }
 function watchMap(){
  if(isFile||mapPoll||mapDone)return;
  mapSince=Date.now();
  mapPoll=window.setInterval(()=>{
   const holder=document.getElementById('map'),failed=document.getElementById('map-failure');
   let map=null;try{map=window.__citymeter&&window.__citymeter.map;}catch{}
   let loaded=false;try{loaded=Boolean(map&&typeof map.loaded==='function'&&map.loaded());}catch{}
   if(loaded){mapFinished(true);return;}
   if(!holder||(failed&&!failed.hidden)||Date.now()-mapSince>30000){mapFinished(false);return;}
   if(!mapLine&&Date.now()-mapSince>700){mapLine=el('p','map-loading',L('กำลังโหลดแผนที่…','Loading the map…'));mapLine.id='map-loading';mapLine.setAttribute('role','status');(holder.parentElement||holder).appendChild(mapLine);}
  },200);
 }
 window.addEventListener('citymeter:ready',()=>{mark('citymeter:ready');});
 window.addEventListener('citymeter:ready',ready);
 window.addEventListener('citymeter:ready',()=>{if(root.dataset.lean==='recovered')notePartial(LEAN_NOTE);renderNotice();watchMap();});
 window.addEventListener('citymeter:partial',event=>notePartial(event.detail));
 window.addEventListener('citymeter:map-trouble',event=>mapTrouble(event.detail));
 window.addEventListener('citymeter:map-ready',()=>mapFinished(true,true));
 window.addEventListener('citymeter:progress',event=>{if(isFile||phase==='ready')return;progress=text(event.detail?.message);window.clearTimeout(failTimer);failTimer=window.setTimeout(()=>fail({message:L('ยังเริ่มหน้าจอไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง','The page has not started. Reload, or open the public site below.'),phase:'startup-timeout',diagnostic:'No citymeter:ready event received within 180 seconds of '+progress}),180000);render();});
 window.addEventListener('citymeter:load-error',event=>fail(event.detail));
 window.addEventListener('error',event=>{
  const target=event.target;
  if(target?.tagName==='SCRIPT'){
   const resource=target.src||target.getAttribute('src')||'';
   if(/\/js\/app\.js(?:[?#]|$)/.test(resource))fail({message:L('โหลดส่วนแสดงข้อมูลไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง','The data view did not load. Reload, or open the public site below.'),resource,phase:'module-load'});
   else dependencyWarning(resource);
  }else if(event.message){
   fail({message:L('เริ่มหน้าจอไม่สำเร็จ ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง','The page failed to start. Reload, or open the public site below.'),resource:event.filename,phase:'script-error',diagnostic:event.message});
  }
 },true);
 window.addEventListener('unhandledrejection',event=>{
  const reason=event.reason;
  fail({message:L('การโหลดหน้าจอหยุดก่อนข้อมูลพร้อม ลองโหลดใหม่ หรือเปิดเว็บสาธารณะด้านล่าง','Loading stopped before the data was ready. Reload, or open the public site below.'),phase:'unhandled-rejection',diagnostic:reason?.message||text(reason)});
 });
 window.addEventListener('pagehide',()=>{clearTimers();window.clearTimeout(redirectTimer);window.clearInterval(mapPoll);});
 if(!bind()){
  const observer=new MutationObserver(()=>{if(bind())observer.disconnect();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{bind();observer.disconnect();},{once:true});
 }
})();
