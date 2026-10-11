// OP PRO：動態盤中事件時間軸
(function initDynamicTimeline(){
  'use strict';

  const pane = document.getElementById('chartTimeline');
  const scaleEl = document.getElementById('tlScale');
  const rowsEl = document.getElementById('tlRows');
  const cursorEl = document.getElementById('tlCursor');
  const cursorLabel = document.getElementById('tlCursorLabel');
  const dateEl = document.getElementById('tlDate');
  const sessionEl = document.getElementById('tlSession');
  const contractEl = document.getElementById('tlContract');
  const marketLastEl = document.getElementById('tlMarketLast');
  const marketMetaEl = document.getElementById('tlMarketMeta');
  const callLastEl = document.getElementById('tlCallLast');
  const callMetaEl = document.getElementById('tlCallMeta');
  const putLastEl = document.getElementById('tlPutLast');
  const putMetaEl = document.getElementById('tlPutMeta');
  const clockEl = document.getElementById('tlClock');
  const clockMetaEl = document.getElementById('tlClockMeta');
  const statusEl = document.getElementById('tlStatus');

  if(!pane || !scaleEl || !rowsEl) return;

  let lastCutoff;
  let refreshFrame = 0;

  function api(){ return window.OPProCompareDataAPI || null; }
  function isActive(){ return pane.classList.contains('active'); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function cleanDate(v){ return String(v || '').replace(/[^0-9]/g, '').slice(0, 8); }
  function cleanTime(v){ return String(v || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6); }
  function timeText(v, seconds=false){
    const t = cleanTime(v);
    return seconds ? `${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}` : `${t.slice(0,2)}:${t.slice(2,4)}`;
  }
  function dateText(v){
    const d = cleanDate(v);
    return d.length === 8 ? `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}` : '—';
  }
  function fmtPrice(v){
    if(!Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  }
  function fmtSigned(v, digits=2){
    if(!Number.isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
  }

  function sessionConfig(name){
    if(name === '盤後') return { start:15*60, end:29*60, label:'盤後 15:00–05:00' };
    if(name === '全部') return { start:8*60+45, end:29*60, label:'全盤 08:45–05:00' };
    return { start:8*60+45, end:13*60+45, label:'一般盤 08:45–13:45' };
  }
  function minuteOf(time, cfg){
    const t = cleanTime(time);
    let minute = Number(t.slice(0,2)) * 60 + Number(t.slice(2,4)) + Number(t.slice(4,6)) / 60;
    if(cfg.end > 1440 && minute < cfg.start) minute += 1440;
    return minute;
  }
  function percentAt(time, cfg){
    const p = (minuteOf(time, cfg) - cfg.start) / (cfg.end - cfg.start) * 100;
    return Math.max(0, Math.min(100, p));
  }
  function minuteLabel(value){
    const total = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  }

  function optionTypes(){
    const values = Array.from(document.getElementById('typeSelect')?.options || []).map(o=>o.value).filter(Boolean);
    const aliases = window.typeAliases || {};
    return {
      call:aliases.call || values.find(v=>/^(c|call)$/i.test(v) || /買/.test(v)) || 'C',
      put:aliases.put || values.find(v=>/^(p|put)$/i.test(v) || /賣/.test(v)) || 'P',
    };
  }

  function underlyingTicks(a){
    const market = a.getMarket();
    if(market === 'taiex') return { label:'加權指數', ticks:a.getTaiexTicks() };
    const all = a.getTxTicks();
    const volumes = new Map();
    for(const d of all){
      if((d.product || '').toUpperCase() !== 'TX' || !a.withinSession(d.time)) continue;
      const ex = String(d.expiry || '').replace(/\s/g,'');
      volumes.set(ex, (volumes.get(ex) || 0) + (Number(d.volume) || 0));
    }
    const expiry = Array.from(volumes.entries()).sort((x,y)=>y[1]-x[1])[0]?.[0] || '';
    return {
      label:`台指期${expiry ? ` ${expiry}` : ''}`,
      ticks:expiry ? all.filter(d=>(d.product || '').toUpperCase()==='TX' && String(d.expiry || '').replace(/\s/g,'')===expiry) : [],
    };
  }

  function filteredBeforeCutoff(a, ticks, cutoff){
    const cutMs = cutoff ? +cutoff : Infinity;
    const out = [];
    for(const d of ticks || []){
      if(d.dtms > cutMs) break;
      if(a.withinSession(d.time)) out.push(d);
    }
    return out;
  }

  function targetTradeDate(a, arrays){
    const requested = cleanDate(window.currentTradeDateIso || window.taiexRequestedDateIso || '');
    if(requested && arrays.some(arr=>arr.some(d=>cleanDate(a.tradeDateKey(d)) === requested))) return requested;
    let latest = null;
    for(const arr of arrays){
      const d = arr[arr.length - 1];
      if(d && (!latest || d.dtms > latest.dtms)) latest = d;
    }
    return latest ? cleanDate(a.tradeDateKey(latest)) : '';
  }

  function forTradeDate(a, arr, date){
    return arr.filter(d=>cleanDate(a.tradeDateKey(d)) === date);
  }

  function stats(arr){
    if(!arr.length) return null;
    let highTick = arr[0], lowTick = arr[0];
    for(const d of arr){
      if(d.price > highTick.price) highTick = d;
      if(d.price < lowTick.price) lowTick = d;
    }
    const open = arr[0], last = arr[arr.length-1];
    const change = last.price - open.price;
    const pct = open.price ? change / open.price * 100 : 0;
    return { open, last, highTick, lowTick, change, pct };
  }

  function makeEvents(arr, kind){
    const s = stats(arr);
    if(!s) return [];
    const events = [];
    const add = (tick, label, priority=0)=>{
      if(!tick) return;
      if(events.some(e=>e.tick.dtms===tick.dtms && e.label===label)) return;
      events.push({ tick, label, priority });
    };
    add(s.open, `開 ${fmtPrice(s.open.price)}`, 10);
    add(s.highTick, `高 ${fmtPrice(s.highTick.price)}`, 8);
    add(s.lowTick, `低 ${fmtPrice(s.lowTick.price)}`, 8);
    if(kind !== 'market'){
      const rangeTick = arr.find(d=>d.price >= 20 && d.price <= 25);
      add(rangeTick, '首次 20–25', 7);
      const up20 = arr.find(d=>s.open.price && d.price >= s.open.price * 1.2);
      const down20 = arr.find(d=>s.open.price && d.price <= s.open.price * .8);
      if(up20 && (!down20 || up20.dtms <= down20.dtms)) add(up20, '首次 +20%', 6);
      else if(down20) add(down20, '首次 −20%', 6);
    }
    return events.sort((x,y)=>x.tick.dtms-y.tick.dtms || y.priority-x.priority).slice(0,5);
  }

  function renderScale(cfg){
    const marks = 8;
    const html = [];
    for(let i=0;i<marks;i++){
      const ratio = i/(marks-1);
      const value = cfg.start + (cfg.end-cfg.start)*ratio;
      const cls = i===0 ? ' first' : i===marks-1 ? ' last' : '';
      html.push(`<span class="tl-scale-mark${cls}" style="left:${(ratio*100).toFixed(3)}%">${minuteLabel(value)}</span>`);
    }
    scaleEl.innerHTML = html.join('');
  }

  function renderRow(kind, label, sublabel, arr, cfg){
    const events = makeEvents(arr, kind);
    const eventHtml = events.map((event,index)=>{
      const left = percentAt(event.tick.time, cfg);
      const side = index % 2 ? 'below' : 'above';
      const title = `${timeText(event.tick.time,true)} ${event.label}，價格 ${fmtPrice(event.tick.price)}`;
      return `<span class="tl-event ${side}" style="left:${left.toFixed(3)}%" title="${esc(title)}"><i class="tl-event-dot"></i><b class="tl-event-label">${esc(timeText(event.tick.time))} ${esc(event.label)}</b></span>`;
    }).join('');
    return `<div class="tl-row ${kind}"><div class="tl-row-label"><strong>${esc(label)}</strong><span>${esc(sublabel)}</span></div><div class="tl-rail">${eventHtml || '<div class="tl-row-empty">此交易日無資料</div>'}</div></div>`;
  }

  function setSummary(lastEl, metaEl, s){
    if(!s){ lastEl.textContent='—'; metaEl.textContent='尚無資料'; return; }
    lastEl.textContent = fmtPrice(s.last.price);
    lastEl.style.color = s.change >= 0 ? '#f87171' : '#4ade80';
    metaEl.textContent = `${fmtSigned(s.change)}（${fmtSigned(s.pct)}%）｜高 ${fmtPrice(s.highTick.price)} 低 ${fmtPrice(s.lowTick.price)}`;
  }

  function updateCursor(cfg, time, label){
    if(!time){ cursorEl.style.display='none'; return; }
    const pct = percentAt(time, cfg);
    cursorEl.style.display = 'block';
    cursorLabel.textContent = label || timeText(time,true);
    requestAnimationFrame(()=>{
      const board = cursorEl.parentElement?.getBoundingClientRect();
      const scale = scaleEl.getBoundingClientRect();
      if(!board || !scale.width) return;
      cursorEl.style.left = `${scale.left - board.left + scale.width * pct / 100}px`;
    });
  }

  function refresh(cutoff){
    if(!isActive()) return;
    const a = api();
    if(!a) return;
    lastCutoff = cutoff === undefined ? a.getCutoff() : cutoff;
    const session = a.getSession();
    const cfg = sessionConfig(session);
    const selection = a.getOptionSelection();
    const types = optionTypes();
    const market = underlyingTicks(a);

    const marketBefore = filteredBeforeCutoff(a, market.ticks, lastCutoff);
    const callBefore = filteredBeforeCutoff(a, a.getOptionTicks(selection.expiry, selection.strike, types.call), lastCutoff);
    const putBefore = filteredBeforeCutoff(a, a.getOptionTicks(selection.expiry, selection.strike, types.put), lastCutoff);
    const date = targetTradeDate(a, [marketBefore, callBefore, putBefore]);
    const marketDay = forTradeDate(a, marketBefore, date);
    const callDay = forTradeDate(a, callBefore, date);
    const putDay = forTradeDate(a, putBefore, date);

    const marketStats = stats(marketDay), callStats = stats(callDay), putStats = stats(putDay);
    dateEl.textContent = `交易日 ${dateText(date)}`;
    sessionEl.textContent = cfg.label;
    contractEl.textContent = `${selection.expiry || '—'} · ${selection.strike || '—'} C/P`;
    setSummary(marketLastEl, marketMetaEl, marketStats);
    setSummary(callLastEl, callMetaEl, callStats);
    setSummary(putLastEl, putMetaEl, putStats);

    renderScale(cfg);
    rowsEl.innerHTML = [
      renderRow('market','市場',market.label,marketDay,cfg),
      renderRow('call','CALL',`${selection.strike || '—'}${types.call}`,callDay,cfg),
      renderRow('put','PUT',`${selection.strike || '—'}${types.put}`,putDay,cfg),
    ].join('');

    const all = marketDay.concat(callDay,putDay).sort((x,y)=>x.dtms-y.dtms);
    const latest = all[all.length-1] || null;
    const cursorTime = lastCutoff ? cleanTime(`${String(new Date(lastCutoff).getHours()).padStart(2,'0')}${String(new Date(lastCutoff).getMinutes()).padStart(2,'0')}${String(new Date(lastCutoff).getSeconds()).padStart(2,'0')}`) : latest?.time;
    clockEl.textContent = cursorTime ? timeText(cursorTime,true) : '—';
    clockMetaEl.textContent = lastCutoff ? '回測進度' : '目前資料最後時間';
    updateCursor(cfg, cursorTime, lastCutoff ? timeText(cursorTime,true) : `最新 ${timeText(cursorTime,true)}`);

    const count = makeEvents(marketDay,'market').length + makeEvents(callDay,'call').length + makeEvents(putDay,'put').length;
    statusEl.textContent = date ? `已產生 ${count} 個重要事件｜依實際成交資料計算` : '目前條件沒有可建立時間軸的資料';
  }

  function schedule(){
    if(refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(()=>{ refreshFrame=0; refresh(); });
  }

  document.getElementById('tabTimeline')?.addEventListener('click', schedule);
  ['expirySelect','strikeSelect','typeSelect','sessionSelect','periodSelect','dateSelect','contractSelect'].forEach(id=>document.getElementById(id)?.addEventListener('change',schedule));
  document.getElementById('tBody')?.addEventListener('click',schedule);
  window.addEventListener('resize',()=>{ if(isActive()) refresh(lastCutoff); });

  window.opTimeline = { refresh, isActive };
})();
