// Interface only: move original nodes without cloning IDs, listeners or trading state.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const make = (tag, cls, html='') => {const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n;};
  const controls=$('#workspaceControls'), primary=make('div','terminal-primary');
  primary.setAttribute('aria-label','目前商品與圖表週期');
  for(const id of ['dateSelect','contractSelect','periodSelect','sessionSelect','themeBtn']){
    const node=document.getElementById(id), label=node.previousElementSibling;
    if(label?.tagName==='LABEL'){label.dataset.coreControl=id;primary.append(label);}
    primary.append(node);
  }
  controls.before(primary);controls.open=false;
  controls.querySelector('summary').innerHTML='<span>進階商品與圖表設定</span><span class="terminal-settings-hint">履約價 · 均線 · 顯示區間</span>';
  const layout=$('.layout'),quotes=$('.tpanel'),charts=$('.rpanel'),ticket=$('.orderbar'),account=$('.account'),playback=$('.btbar');
  layout.classList.add('terminal-stage');layout.setAttribute('aria-label','交易終端');
  const cards=[...account.children].filter(n=>n.classList.contains('card'));
  const risk=cards.find(n=>n.querySelector('#riskMaxQty'));
  if(risk){risk.classList.add('terminal-risk');ticket.append(risk);}
  ticket.querySelector('.ws-section-heading').after(ticket.querySelector('.stat'));
  let resizeFrame=0;
  const candleSizes=new WeakMap();
  function resizeCandles(){
    // The original charts can fit data while a mobile section has zero width.
    // Reframe only after a visible container acquires a new, usable size.
    const instances=[
      ['chartTA',typeof _taChart==='undefined'?null:_taChart,typeof _taCandle==='undefined'?null:_taCandle],
      ['chartTX',typeof _lwcChart==='undefined'?null:_lwcChart,typeof _lwcCandle==='undefined'?null:_lwcCandle]
    ];
    for(const[id,chart,series]of instances){
      const host=document.getElementById(id);
      if(!chart||!host?.clientWidth||!host.clientHeight)continue;
      const size=`${host.clientWidth}:${host.clientHeight}`;
      if(candleSizes.get(chart)===size)continue;
      const count=series?.data().length||0;
      if(!count)continue;
      candleSizes.set(chart,size);
      requestAnimationFrame(()=>{
        if(!host.clientWidth||!host.clientHeight)return;
        chart.priceScale('right').applyOptions({autoScale:true});
        if(typeof cutoffTime!=='undefined'&&cutoffTime){
          chart.timeScale().setVisibleLogicalRange({from:Math.max(0,count-60),to:count-1+2});
        }else chart.timeScale().fitContent();
      });
    }
  }
  const resizeCharts=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
    for(const id of ['chartTrend','chartCompareLine','volatilityChart','protractorChart']){const host=document.getElementById(id);if(host?.clientWidth)window.echarts?.getInstanceByDom(host)?.resize();}
    window.dispatchEvent(new Event('resize'));
    resizeCandles();
  });};
  function splitter(label,variable,min,max){
    const n=make('div','terminal-splitter');n.tabIndex=0;
    n.setAttribute('role','separator');n.setAttribute('aria-orientation','vertical');n.setAttribute('aria-label',label);n.setAttribute('aria-valuemin',min);n.setAttribute('aria-valuemax',max);
    let width=variable==='--quote-width'?360:280;n.setAttribute('aria-valuenow',width);
    const set=v=>{width=Math.min(max,Math.max(min,v));layout.style.setProperty(variable,`${width}px`);n.setAttribute('aria-valuenow',Math.round(width));resizeCharts();};
    n.addEventListener('pointerdown',e=>{
      const start=e.clientX,initial=width;n.setPointerCapture(e.pointerId);n.classList.add('dragging');
      const move=e=>set(initial+(variable==='--quote-width'?1:-1)*(e.clientX-start));
      const end=()=>{n.classList.remove('dragging');n.removeEventListener('pointermove',move);};
      n.addEventListener('pointermove',move);n.addEventListener('pointerup',end,{once:true});n.addEventListener('lostpointercapture',end,{once:true});
    });
    n.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();set(width+(e.key==='ArrowRight'?16:-16));});
    return n;
  }
  layout.append(quotes,splitter('調整報價區寬度','--quote-width',300,480),charts,splitter('調整下單區寬度','--ticket-width',250,360),ticket);
  layout.after(playback);
  const ledger=make('section','terminal-ledger');ledger.id='terminalLedger';ledger.setAttribute('aria-label','交易紀錄與策略');
  const tabs=make('div','terminal-ledger-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','帳戶與策略分頁');
  const defs=[['positions','部位',cards.find(n=>n.classList.contains('positions'))],['limits','委託',cards.find(n=>n.classList.contains('limits'))],['orders','成交',cards.find(n=>n.classList.contains('orders'))],['summary','帳戶',cards.find(n=>n.querySelector('#cash0'))],['strategy','條件策略',document.getElementById('bt20Card')]];
  function selectLedger(key,focus=false){for(const [id,,panel]of defs){const b=document.getElementById(`terminal-tab-${id}`),active=id===key;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;panel.hidden=!active;if(active&&focus)b.focus();}}
  for(const[key,label,panel]of defs){
    panel.id||=`terminal-pane-${key}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`terminal-tab-${key}`);panel.tabIndex=0;
    const b=make('button','',label);b.type='button';b.id=`terminal-tab-${key}`;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);
    b.addEventListener('click',()=>selectLedger(key));
    b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=defs.findIndex(([id])=>id===key),next=e.key==='Home'?0:e.key==='End'?defs.length-1:(i+(e.key==='ArrowRight'?1:-1)+defs.length)%defs.length;selectLedger(defs[next][0],true);});
    tabs.append(b);
  }
  ledger.append(tabs,account);playback.after(ledger);selectLedger('positions');
  const mobileNav=make('nav','terminal-mobile-nav');mobileNav.setAttribute('aria-label','主要工作區');
  // This edition now uses the phone navigation model on every screen size.
  const mobileLayout=matchMedia('(min-width:0px)');
  let desktopSettingsOpen=false;
  function syncSettingsLayout(){
    if(mobileLayout.matches){
      controls.querySelector('summary').after(primary);
      controls.open=true;
    }else{
      controls.before(primary);
      controls.open=desktopSettingsOpen;
    }
    resizeCharts();
  }
  function selectSection(key){const previous=document.body.dataset.terminalView;document.body.dataset.terminalView=key;for(const b of mobileNav.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.view===key));if(mobileLayout.matches)controls.open=true;resizeCharts();document.dispatchEvent(new CustomEvent('oppro:section',{detail:{key,previous}}));}
  const icons={charts:'M3 3v18h18M7 15l4-5 4 3 5-8',quotes:'M4 5h16M4 12h16M4 19h16',trade:'M4 7h16m-5-4 5 4-5 4M20 17H4m5-4-5 4 5 4',account:'M3 5h18v15H3zM3 9h18m-6 5h3',settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6'};
  for(const[key,label]of [['quotes','報價'],['charts','圖表'],['trade','交易'],['account','帳戶'],['settings','設定']]){
    const b=make('button','',`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[key]}"/></svg><span>${label}</span>`);b.type='button';b.dataset.view=key;
    b.addEventListener('click',()=>{selectSection(key);window.scrollTo({top:0,behavior:'instant'});});mobileNav.append(b);
  }
  document.body.append(mobileNav);syncSettingsLayout();selectSection('quotes');
  const settings=$('#terminalSettings');settings.addEventListener('click',()=>{if(mobileLayout.matches){selectSection('settings');return;}controls.open=!controls.open;desktopSettingsOpen=controls.open;settings.setAttribute('aria-expanded',String(controls.open));if(controls.open)controls.scrollIntoView({block:'nearest'});});
  controls.addEventListener('toggle',()=>{if(!mobileLayout.matches)desktopSettingsOpen=controls.open;settings.setAttribute('aria-expanded',String(controls.open));resizeCharts();});
  mobileLayout.addEventListener('change',syncSettingsLayout);
  const sizes=new WeakMap();
  const observer=new ResizeObserver(entries=>{for(const{target}of entries){const size=`${target.clientWidth}:${target.clientHeight}`;if(target.clientWidth&&target.clientHeight&&sizes.get(target)!==size){sizes.set(target,size);requestAnimationFrame(()=>{window.echarts?.getInstanceByDom(target)?.resize();resizeCandles();});}else if(!target.clientWidth||!target.clientHeight){sizes.delete(target);if(typeof _taChart!=='undefined'&&_taChart)candleSizes.delete(_taChart);if(typeof _lwcChart!=='undefined'&&_lwcChart)candleSizes.delete(_lwcChart);}}});
  for(const id of ['chartTA','chartTX','chartTrend','chartCompareLine','volatilityChart','protractorChart']){const n=document.getElementById(id);if(n)observer.observe(n);}
  const status=$('#workspaceStatus');async function checkBackend(){try{const r=await fetch(`${window.OP_PRO_CONFIG.apiBase}/ping`,{signal:AbortSignal.timeout(6000)}),j=await r.json();if(!r.ok||!j.ok)throw Error('Unavailable');status.dataset.state='ready';status.textContent='已連線';}catch{status.dataset.state='error';status.textContent='未連線';}}
  checkBackend();window.addEventListener('online',checkBackend);
})();
