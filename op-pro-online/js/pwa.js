(() => {
  'use strict';
  let promptEvent=null,button,note;
  const standalone=matchMedia('(display-mode: standalone)');
  const installed=()=>standalone.matches||navigator.standalone===true;
  function sync(){if(!button)return;button.disabled=installed();button.textContent=installed()?'已安裝到手機':'安裝 OP PRO';}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;sync();});
  window.addEventListener('appinstalled',()=>{promptEvent=null;sync();});
  standalone.addEventListener('change',sync);
  window.addEventListener('DOMContentLoaded',()=>{
    const group=document.createElement('section');group.className='app-install-group';
    const heading=document.createElement('h2');heading.textContent='安裝應用程式';
    button=document.createElement('button');button.type='button';
    note=document.createElement('p');note.className='app-install-help';note.hidden=true;
    const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    note.textContent=isIOS?'在 Safari 開啟此頁，點「分享」→「加入主畫面」，再按「加入」。':'在瀏覽器選單中選擇「安裝應用程式」或「新增至主畫面」。如果尚未出現，請使用 Chrome 或 Edge 開啟本頁。';
    button.addEventListener('click',async()=>{
      if(promptEvent){const event=promptEvent;promptEvent=null;await event.prompt();await event.userChoice;sync();}
      else note.hidden=!note.hidden;
    });
    group.append(heading,button,note);document.getElementById('workspaceControls').append(group);sync();
    if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('../sw.js',document.currentScript?.src||new URL('js/pwa.js',document.baseURI)),{scope:'./'}).catch(()=>{note.hidden=false;});
  });
})();
