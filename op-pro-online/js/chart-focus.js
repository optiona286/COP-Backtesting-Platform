// Reuse the existing chart and strike actions; never reload market data on entry/exit.
(()=>{
 const panel=document.querySelector('.rpanel'),wrap=panel?.querySelector('.chartWrap');if(!panel||!wrap)return;
 const expand='<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',shrink='<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>';
 const svg=p=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>';
 const toggle=document.createElement('button');toggle.type='button';toggle.className='chart-focus-toggle';wrap.append(toggle);
 const header=document.createElement('div');header.className='chart-focus-header';
 header.innerHTML='<button type="button" class="chart-focus-nav" aria-label="上一個履約價">'+svg('<path d="m14 5-7 7 7 7"/>')+'</button><div class="chart-focus-symbol"></div><button type="button" class="chart-focus-nav" aria-label="下一個履約價">'+svg('<path d="m10 5 7 7-7 7"/>')+'</button>';
 const [prev,next]=header.querySelectorAll('button'),symbol=header.querySelector('.chart-focus-symbol');
 const home=document.createComment('chart-focus-home');panel.before(home);let active=false,scrollY=0;
 const readouts=document.createElement('div');readouts.className='chart-focus-readouts';
 const quote=panel.querySelector('.app-chart-info'),ma=wrap.querySelector('.app-chart-info-ma');
 const quoteHome=document.createComment('quote-home'),maHome=document.createComment('ma-home');
 quote?.before(quoteHome);ma?.before(maHome);
 function title(){const text=id=>{const el=document.getElementById(id);return el?.selectedOptions?.[0]?.textContent?.trim()||el?.value||'';};
  const isTX=typeof currentChartMode!=='undefined'&&currentChartMode==='tx';
  symbol.textContent=isTX?(document.getElementById('kinfo')?.textContent||'台指／加權'):[text('expirySelect'),text('strikeSelect'),text('typeSelect'),text('periodSelect')].filter(Boolean).join(' · ');
  const select=document.getElementById('strikeSelect');prev.disabled=isTX||!select||select.selectedIndex<=0;next.disabled=isTX||!select||select.selectedIndex>=select.options.length-1;
 }
 function resize(){requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));document.getElementById('kinfo')?.dispatchEvent(new Event('click'));});}
 function paint(){toggle.innerHTML=svg(active?shrink:expand);toggle.title=active?'退出全螢幕':'圖表全螢幕';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-pressed',String(active));}
 function restore(){if(!active)return;active=false;document.body.classList.remove('chart-focus-open');panel.classList.remove('chart-focus-panel');if(quote)quoteHome.after(quote);if(ma)maHome.after(ma);readouts.remove();header.remove();home.after(panel);paint();window.scrollTo(0,scrollY);resize();toggle.focus({preventScroll:true});}
 async function close(){if(document.fullscreenElement===panel){try{await document.exitFullscreen();}catch{}}restore();}
 toggle.addEventListener('click',async()=>{if(active){await close();return;}document.getElementById('tabTA')?.click();scrollY=window.scrollY;active=true;document.body.append(panel);panel.prepend(header);header.after(readouts);if(quote)readouts.append(quote);if(ma)readouts.append(ma);panel.classList.add('chart-focus-panel');document.body.classList.add('chart-focus-open');title();paint();resize();try{if(panel.requestFullscreen)await panel.requestFullscreen();}catch{/* Fixed viewport remains available on mobile browsers. */}resize();});
 prev.onclick=()=>{document.getElementById('prevStrikeBtn')?.click();title();};next.onclick=()=>{document.getElementById('nextStrikeBtn')?.click();title();};
 header.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});header.addEventListener('touchend',e=>e.stopPropagation(),{passive:true});
 document.addEventListener('fullscreenchange',()=>{if(active&&!document.fullscreenElement)restore();});
 document.addEventListener('keydown',e=>{if(active&&e.key==='Escape')close();});
 document.addEventListener('oppro:section',()=>{if(active)close();});
 for(const id of ['strikeSelect','expirySelect','typeSelect','periodSelect'])document.getElementById(id)?.addEventListener('change',title);
 new MutationObserver(()=>{if(active)title();}).observe(document.getElementById('kinfo'),{childList:true,subtree:true,characterData:true});
 paint();
})();
