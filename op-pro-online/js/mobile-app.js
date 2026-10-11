// Mobile app presentation. Original controls and order handlers are reused.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const make = (tag, cls, html='') => {const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n;};
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const sections=['quotes','charts','trade','account','settings'];
  const titles={charts:['市場圖表','觀察走勢，掌握每個時間點'],quotes:['選擇權報價','CALL 與 PUT · 點選價格切換商品'],trade:['模擬交易','市價、限價委託與風控'],account:['我的帳戶','部位、紀錄與條件策略'],settings:['偏好設定','商品、時間範圍與圖表工具']};
  const heading=make('header','app-screen-heading','<div><h1></h1><p></p></div><span class="app-swipe-hint" aria-hidden="true">‹ 滑動切頁 ›</span>');
  heading.setAttribute('aria-label','頁面標題，左右滑動可切換主要頁面');
  $('.ws-header').after(heading);
  const quickOrder=make('button','app-quick-order','下單');quickOrder.type='button';quickOrder.setAttribute('aria-label','開啟目前商品的下單面板');$('.terminal-header-tools').append(quickOrder);
  const title=heading.querySelector('h1'),subtitle=heading.querySelector('p');
  let active=document.body.dataset.terminalView||'quotes';
  const scrollPositions=new Map();
  let animation=null;
  function updateHeading(key){title.textContent=titles[key][0];subtitle.textContent=titles[key][1];}
  updateHeading(active);

  const tradeHome=make('section','app-trade-home',
    '<div class="app-instrument"><span>目前選擇商品</span><strong id="appTradeSymbol">—</strong><div><span>最新價</span><b id="appTradePrice">—</b></div></div>'+ 
    '<button type="button" class="app-primary-action" id="appOpenOrder">開啟下單面板 <span aria-hidden="true">↗</span></button>'+ 
    '<p class="app-helper">使用原有回測行情進行模擬下單。切換頁面會保留商品與輸入內容。</p>');
  $('.terminal-stage').append(tradeHome);
  const ticket=$('.orderbar');
  const sheet=make('dialog','app-sheet',
    '<button type="button" class="app-sheet-grab" aria-label="向下拖曳或點擊關閉下單面板"><span></span></button>'+ 
    '<header class="app-sheet-title"><div><small>模擬交易</small><h2 id="appOrderTitle">下單與委託</h2></div><button type="button" class="app-sheet-close" aria-label="關閉下單面板">×</button></header>');
  sheet.setAttribute('aria-labelledby','appOrderTitle');
  const sheetContent=make('div','app-sheet-content');sheetContent.append(ticket);sheet.append(sheetContent);document.body.append(sheet);
  let closingTimer=0;
  function openSheet(){
    clearTimeout(closingTimer);
    if(!sheet.open)sheet.showModal();
    document.body.classList.add('app-modal-open');
    requestAnimationFrame(()=>sheet.classList.add('is-open'));
  }
  function closeSheet(){
    if(!sheet.open)return;
    sheet.classList.remove('is-open');
    sheet.style.removeProperty('--sheet-drag');
    clearTimeout(closingTimer);
    closingTimer=setTimeout(()=>{sheet.close();document.body.classList.remove('app-modal-open');},reduced.matches?0:180);
  }
  $('#appOpenOrder').addEventListener('click',openSheet);
  quickOrder.addEventListener('click',openSheet);
  sheet.querySelector('.app-sheet-close').addEventListener('click',closeSheet);
  sheet.addEventListener('cancel',event=>{event.preventDefault();closeSheet();});
  sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)closeSheet();}});
  sheet.addEventListener('close',()=>document.body.classList.remove('app-modal-open'));
  const grab=sheet.querySelector('.app-sheet-grab');
  let dragStart=0,dragDistance=0;
  grab.addEventListener('click',()=>{if(dragDistance<8)closeSheet();});
  grab.addEventListener('pointerdown',event=>{dragStart=event.clientY;dragDistance=0;grab.setPointerCapture(event.pointerId);sheet.classList.add('is-dragging');});
  grab.addEventListener('pointermove',event=>{if(!grab.hasPointerCapture(event.pointerId))return;dragDistance=Math.max(0,event.clientY-dragStart);sheet.style.setProperty('--sheet-drag',`${dragDistance}px`);});
  function finishDrag(){sheet.classList.remove('is-dragging');if(dragDistance>85)closeSheet();else sheet.style.removeProperty('--sheet-drag');}
  grab.addEventListener('pointerup',finishDrag);
  grab.addEventListener('pointercancel',()=>{dragDistance=0;finishDrag();});

  // Mirrors display text only, never computes balances or prices.
  const mirrors=[['symNow','appTradeSymbol'],['lastPx','appTradePrice']];
  for(const[from,to]of mirrors){const source=document.getElementById(from),target=document.getElementById(to);const sync=()=>{target.textContent=source.textContent;};sync();new MutationObserver(sync).observe(source,{childList:true,subtree:true,characterData:true});}
  document.addEventListener('oppro:section',event=>{
    const {key,previous}=event.detail;
    if(previous)scrollPositions.set(previous,window.scrollY);
    active=key;updateHeading(key);
    closeSheet();
    const target={charts:$('.rpanel'),quotes:$('.tpanel'),trade:tradeHome,account:$('.terminal-ledger'),settings:$('#workspaceControls')}[key];
    animation?.cancel();
    if(!reduced.matches&&key!==previous){const direction=sections.indexOf(key)>=sections.indexOf(previous)?1:-1;animation=target.animate([{opacity:.3,transform:`translateX(${direction*14}px)`},{opacity:1,transform:'translateX(0)'}],{duration:200,easing:'cubic-bezier(.2,.7,.2,1)'});}
    requestAnimationFrame(()=>window.scrollTo({top:scrollPositions.get(key)||0,behavior:'instant'}));
  });
  // Navigation gesture belongs to the title region; chart pinch/pan stays untouched.
  let swipe=null;
  heading.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')return;swipe={id:event.pointerId,x:event.clientX,y:event.clientY};heading.setPointerCapture(event.pointerId);});
  heading.addEventListener('pointerup',event=>{if(!swipe||swipe.id!==event.pointerId)return;const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;swipe=null;if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return;const i=sections.indexOf(active)+(dx<0?1:-1);if(i>=0&&i<sections.length)$(`.terminal-mobile-nav [data-view="${sections[i]}"]`).click();});
  heading.addEventListener('pointercancel',()=>{swipe=null;});
  // Original quote handler selects the instrument first; the app then reveals its chart.
  document.getElementById('tBody').addEventListener('click',event=>{
    const cell=event.target.closest('td');
    if(!cell||!cell.matches('.td-c,.td-p,.td-strike'))return;
    if(cell.matches('.td-c,.td-p')&&(!cell.dataset.strike||!cell.dataset.side))return;
    queueMicrotask(()=>{
      scrollPositions.set('charts',0);
      $('.terminal-mobile-nav [data-view="charts"]').click();
      requestAnimationFrame(()=>{
        if(document.getElementById('compareKPanel')?.classList.contains('open'))document.getElementById('compareKCloseBtn').click();
        document.getElementById('tabTA').click();
      });
    });
  });
  $('.terminal-ledger-tabs').addEventListener('click',event=>{
    if(!event.target.closest('button')||reduced.matches)return;
    const pane=$('.account > .card:not([hidden])');
    pane?.animate([{opacity:.35,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:170,easing:'ease-out'});
  });

  const playback=$('.btbar');
  for(const[groupIndex,group]of [...playback.querySelectorAll(':scope > .group')].entries())group.classList.add(groupIndex===0?'app-replay-main':group.querySelector('#btProgress')?'app-replay-progress':'app-replay-setting');
  const replayTitle=playback.querySelector('.ws-section-heading');
  const replaySheet=make('dialog','app-sheet app-replay-sheet',
    '<button type="button" class="app-sheet-grab" aria-label="向下拖曳或點擊收起回測面板"><span></span></button>'+ 
    '<header class="app-sheet-title"><div><small>行情播放</small><h2 id="appReplayTitle">回測控制</h2></div><button type="button" class="app-sheet-close" aria-label="收起回測面板">×</button></header>');
  replaySheet.setAttribute('aria-labelledby','appReplayTitle');
  const replayContent=make('div','app-sheet-content');playback.classList.add('app-replay-expanded');replayContent.append(playback);replaySheet.append(replayContent);document.body.append(replaySheet);
  const replayButton=make('button','app-quick-replay','回測');replayButton.type='button';replayButton.setAttribute('aria-label','開啟回測控制面板');$('.terminal-header-tools').prepend(replayButton);
  let replayTimer=0,replayDistance=0,replayStart=0;
  const releaseLock=()=>{if(!document.querySelector('.app-sheet[open]'))document.body.classList.remove('app-modal-open');};
  function closeReplay(){if(!replaySheet.open)return;replaySheet.classList.remove('is-open');replaySheet.style.removeProperty('--sheet-drag');clearTimeout(replayTimer);replayTimer=setTimeout(()=>{replaySheet.close();releaseLock();},reduced.matches?0:180);}
  replayButton.addEventListener('click',()=>{clearTimeout(replayTimer);if(!replaySheet.open)replaySheet.showModal();document.body.classList.add('app-modal-open');requestAnimationFrame(()=>replaySheet.classList.add('is-open'));});
  replaySheet.querySelector('.app-sheet-close').addEventListener('click',closeReplay);
  replaySheet.addEventListener('cancel',event=>{event.preventDefault();closeReplay();});
  replaySheet.addEventListener('close',releaseLock);
  replaySheet.addEventListener('click',event=>{if(event.target===replaySheet){const r=replaySheet.getBoundingClientRect();if(event.clientY<r.top||event.clientX<r.left||event.clientX>r.right)closeReplay();}});
  const replayGrab=replaySheet.querySelector('.app-sheet-grab');
  replayGrab.addEventListener('click',()=>{if(replayDistance<8)closeReplay();});
  replayGrab.addEventListener('pointerdown',event=>{replayStart=event.clientY;replayDistance=0;replayGrab.setPointerCapture(event.pointerId);replaySheet.classList.add('is-dragging');});
  replayGrab.addEventListener('pointermove',event=>{if(!replayGrab.hasPointerCapture(event.pointerId))return;replayDistance=Math.max(0,event.clientY-replayStart);replaySheet.style.setProperty('--sheet-drag',`${replayDistance}px`);});
  replayGrab.addEventListener('pointerup',()=>{replaySheet.classList.remove('is-dragging');if(replayDistance>85)closeReplay();else replaySheet.style.removeProperty('--sheet-drag');});
  replayGrab.addEventListener('pointercancel',()=>{replayDistance=0;replaySheet.classList.remove('is-dragging');replaySheet.style.removeProperty('--sheet-drag');});
  document.addEventListener('oppro:section',closeReplay);
})();
