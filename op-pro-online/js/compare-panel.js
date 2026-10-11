// OP PRO：台指／加權 vs 台指選擇權，上下 K 線對比浮動面板
// 本模組只讀取 main.js 公開的資料介面，不接管原本的技術分析圖。
(function initCompareKPanel(){
  'use strict';

  const panel = document.getElementById('compareKPanel');
  const openBtn = document.getElementById('btnOpenComparePanel');
  const closeBtn = document.getElementById('compareKCloseBtn');
  const maxBtn = document.getElementById('compareKMaxBtn');
  const header = document.getElementById('compareKPanelHeader');
  const body = document.getElementById('compareKPanelBody');
  const divider = document.getElementById('compareKDivider');
  const topHost = document.getElementById('compareKTopChart');
  const bottomHost = document.getElementById('compareKBottomChart');
  const topTitle = document.getElementById('compareKTopTitle');
  const bottomTitle = document.getElementById('compareKBottomTitle');
  const topInfo = document.getElementById('compareKTopInfo');
  const bottomInfo = document.getElementById('compareKBottomInfo');
  const status = document.getElementById('compareKPanelStatus');
  const marketBtns = Array.from(document.querySelectorAll('[data-compare-market]'));

  if(!panel || !openBtn || !topHost || !bottomHost) return;

  let top = null;
  let bottom = null;
  let syncingCrosshair = false;
  let syncingRange = false;
  let rangeSyncFrame = 0;
  let dataKey = '';
  let lastCutoff = undefined;

  // 固定嵌入原本右側技術分析圖區，不改變頁面高度，也不遮住左側 T 字表。
  const dockHost = document.querySelector('.chartWrap');
  if(dockHost && panel.parentElement !== dockHost) dockHost.appendChild(panel);

  function api(){ return window.OPProCompareDataAPI || null; }
  function isOpen(){ return panel.classList.contains('open'); }
  function isDark(){ return document.body.classList.contains('dark-mode'); }

  function timeNumber(t){
    if(typeof t === 'number') return t;
    if(t && typeof t === 'object' && Number.isFinite(t.year)){
      return Date.UTC(t.year, (t.month || 1) - 1, t.day || 1) / 1000;
    }
    return NaN;
  }

  function formatChartTime(t, withDate=true){
    const sec = timeNumber(t);
    if(!Number.isFinite(sec)) return '—';
    const d = new Date(sec * 1000);
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return withDate ? `${mo}/${day} ${hh}:${mm}` : `${hh}:${mm}`;
  }

  function chartOptions(){
    const dark = isDark();
    return {
      autoSize:true,
      layout:{
        background:{ type:'solid', color:dark ? '#05070c' : '#ffffff' },
        textColor:dark ? '#94a3b8' : '#475569',
        fontFamily:'Arial, sans-serif',
      },
      grid:{
        vertLines:{ color:dark ? 'rgba(148,163,184,.08)' : 'rgba(100,116,139,.12)' },
        horzLines:{ color:dark ? 'rgba(148,163,184,.08)' : 'rgba(100,116,139,.12)' },
      },
      crosshair:{ mode:LightweightCharts.CrosshairMode.Normal },
      rightPriceScale:{ borderColor:dark ? 'rgba(148,163,184,.25)' : '#cbd5e1' },
      timeScale:{
        borderColor:dark ? 'rgba(148,163,184,.25)' : '#cbd5e1',
        timeVisible:true,
        secondsVisible:false,
        rightOffset:5,
        barSpacing:8,
        tickMarkFormatter:(t)=>formatChartTime(t, false),
      },
      localization:{ timeFormatter:(t)=>formatChartTime(t, true) },
      handleScroll:true,
      handleScale:true,
      attributionLogo:false,
    };
  }

  function createPane(host){
    const chart = LightweightCharts.createChart(host, chartOptions());
    const candle = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor:isDark() ? '#ef5350' : '#d00000',
      downColor:isDark() ? '#26a69a' : '#2ca02c',
      borderUpColor:isDark() ? '#ef5350' : '#d00000',
      borderDownColor:isDark() ? '#26a69a' : '#2ca02c',
      wickUpColor:isDark() ? '#ef5350' : '#d00000',
      wickDownColor:isDark() ? '#26a69a' : '#2ca02c',
      priceLineVisible:false,
    });
    candle.priceScale().applyOptions({ scaleMargins:{ top:.08, bottom:.12 } });
    return {
      host,
      chart,
      candle,
      maSeries:{},
      priceLines:[],
      candles:[],
      candleMap:new Map(),
      infoEl:null,
      syncLine:host.querySelector('.compare-k-sync-line'),
    };
  }

  function ensureCharts(){
    if(top && bottom) return;
    top = createPane(topHost);
    bottom = createPane(bottomHost);
    top.infoEl = topInfo;
    bottom.infoEl = bottomInfo;
    bindCrosshair(top, bottom);
    bindCrosshair(bottom, top);
    bindVisibleRange(top);
    bindVisibleRange(bottom);
  }

  function sanitizeTime(value){
    return String(value || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6);
  }

  function aggregate(ticks, period, cutoff, kind){
    const a = api();
    if(!a) return [];
    const cutMs = cutoff ? +cutoff : Infinity;
    const grouped = new Map();
    const tzOffsetSec = new Date().getTimezoneOffset() * -60;

    for(const d of (ticks || [])){
      if(d.dtms > cutMs) break;
      if(!a.withinSession(d.time)) continue;
      if(a.withinSettlementAxis && !a.withinSettlementAxis(d)) continue;
      if(kind === 'taiex' && sanitizeTime(d.time) === '090000') continue;
      const bucket = a.bucketMsForPeriod(d, period);
      if(!Number.isFinite(bucket)) continue;
      let g = grouped.get(bucket);
      if(!g){
        g = { time:Math.floor(bucket / 1000) + tzOffsetSec, open:d.open??d.price, high:d.high??d.price, low:d.low??d.price, close:d.price };
        grouped.set(bucket, g);
      }else{
        g.high = Math.max(g.high, d.high??d.price);
        g.low = Math.min(g.low, d.low??d.price);
        g.close = d.price;
      }
    }
    return Array.from(grouped.entries()).sort((x,y)=>x[0]-y[0]).map(([,g])=>g);
  }

  function getUnderlying(period, cutoff){
    const a = api();
    const market = a.getMarket();
    if(market === 'taiex'){
      return { market, expiry:'', ticks:a.getTaiexTicks(), label:'加權指數' };
    }

    const all = a.getTxTicks();
    const volByExpiry = new Map();
    for(const d of all){
      if((d.product || '').toUpperCase() !== 'TX') continue;
      if(!a.withinSession(d.time)) continue;
      const ex = String(d.expiry || '').replace(/\s/g, '');
      volByExpiry.set(ex, (volByExpiry.get(ex) || 0) + (Number(d.volume) || 0));
    }
    const mainExpiry = Array.from(volByExpiry.entries()).sort((x,y)=>y[1]-x[1])[0]?.[0] || '';
    const ticks = mainExpiry
      ? all.filter(d => (d.product || '').toUpperCase() === 'TX' && String(d.expiry || '').replace(/\s/g, '') === mainExpiry)
      : [];
    return { market, expiry:mainExpiry, ticks, label:`TX 台指期${mainExpiry ? ` ${mainExpiry}` : ''}` };
  }

  function formatChange(c){
    const change = c.close - c.open;
    const pct = c.open ? change / c.open * 100 : 0;
    const sign = change >= 0 ? '+' : '';
    const pctSign = pct >= 0 ? '+' : '';
    return `${sign}${Number(change.toFixed(2))}（${pctSign}${pct.toFixed(2)}%）`;
  }

  function setInfo(pane, candle, time, missing=false){
    if(!pane.infoEl) return;
    if(missing || !candle){
      pane.infoEl.textContent = '此時間無 K 線資料';
      pane.infoEl.style.color = '#64748b';
      return;
    }
    const up = candle.close >= candle.open;
    pane.infoEl.textContent = `開 ${candle.open}　高 ${candle.high}　低 ${candle.low}　收 ${candle.close}　漲跌 ${formatChange(candle)}`;
    pane.infoEl.style.color = up ? '#f87171' : '#4ade80';
  }

  function updateLatestInfo(pane){
    const c = pane.candles[pane.candles.length - 1];
    if(c) setInfo(pane, c, c.time);
    else {
      pane.infoEl.textContent = '目前條件沒有 K 線資料';
      pane.infoEl.style.color = '#64748b';
    }
  }

  function updateSyncLine(pane, time){
    if(!pane.syncLine) return;
    const x = pane.chart.timeScale().timeToCoordinate(time);
    if(x == null || !Number.isFinite(x)){
      pane.syncLine.style.display = 'none';
      return;
    }
    pane.syncLine.style.left = `${Math.round(x)}px`;
    pane.syncLine.style.display = 'block';
  }

  function hideSyncLines(){
    [top, bottom].forEach(p=>{ if(p?.syncLine) p.syncLine.style.display = 'none'; });
  }

  function bindCrosshair(source, target){
    source.chart.subscribeCrosshairMove(param => {
      if(syncingCrosshair) return;
      if(!param.time){
        syncingCrosshair = true;
        try{ target.chart.clearCrosshairPosition(); }catch(_){ }
        syncingCrosshair = false;
        hideSyncLines();
        updateLatestInfo(source);
        updateLatestInfo(target);
        return;
      }

      const t = timeNumber(param.time);
      if(!Number.isFinite(t)) return;
      const sourceCandle = source.candleMap.get(t) || null;
      const targetCandle = target.candleMap.get(t) || null;
      setInfo(source, sourceCandle, t, !sourceCandle);
      setInfo(target, targetCandle, t, !targetCandle);
      updateSyncLine(source, t);
      updateSyncLine(target, t);

      syncingCrosshair = true;
      try{
        if(targetCandle) target.chart.setCrosshairPosition(targetCandle.close, t, target.candle);
        else target.chart.clearCrosshairPosition();
      }catch(_){ }
      syncingCrosshair = false;
    });
  }

  function bindVisibleRange(source){
    source.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if(syncingRange || !range) return;
      syncingRange = true;
      try{
        top.chart.timeScale().setVisibleLogicalRange(range);
        bottom.chart.timeScale().setVisibleLogicalRange(range);
      }catch(_){ }
      if(rangeSyncFrame) cancelAnimationFrame(rangeSyncFrame);
      // LWC 的 range 事件可能延後送出；保留鎖到下一個畫面週期，避免上下圖互相回彈。
      rangeSyncFrame = requestAnimationFrame(()=>{ syncingRange = false; rangeSyncFrame = 0; });
    });
  }

  function setMAData(pane, candles){
    const a = api();
    const periods = a.getMAPeriods();
    const colors = a.getMAColorMap();
    const active = new Set(periods.map(Number));
    Object.keys(pane.maSeries).forEach(key => {
      if(active.has(Number(key))) return;
      try{ pane.chart.removeSeries(pane.maSeries[key]); }catch(_){ }
      delete pane.maSeries[key];
    });

    const closes = candles.map(c=>c.close);
    periods.forEach(period => {
      if(!pane.maSeries[period]){
        pane.maSeries[period] = pane.chart.addSeries(LightweightCharts.LineSeries, {
          color:colors[period] || '#f1c40f', lineWidth:1,
          priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
        });
      }
      const ma = a.calcMA(period, closes);
      pane.maSeries[period].setData(candles.map((c,i)=> Number.isFinite(ma[i]) ? {time:c.time,value:ma[i]} : {time:c.time}));
    });
  }

  function updateExtremePriceLines(pane, candles){
    for(const line of pane.priceLines){
      try{ pane.candle.removePriceLine(line); }catch(_){ }
    }
    pane.priceLines = [];
    if(!candles.length) return;

    let highest = -Infinity;
    let lowest = Infinity;
    const opening = Number(candles[0]?.open);
    for(const candle of candles){
      if(Number.isFinite(candle.high) && candle.high > highest) highest = candle.high;
      if(Number.isFinite(candle.low) && candle.low < lowest) lowest = candle.low;
    }
    if(Number.isFinite(opening)){
      pane.priceLines.push(pane.candle.createPriceLine({
        price:opening,
        color:'#facc15',
        lineWidth:2,
        lineStyle:LightweightCharts.LineStyle.Solid,
        axisLabelVisible:true,
        title:'開盤',
      }));
    }
    if(Number.isFinite(highest)){
      pane.priceLines.push(pane.candle.createPriceLine({
        price:highest,
        color:'#ef5350',
        lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true,
        title:'最高',
      }));
    }
    if(Number.isFinite(lowest)){
      pane.priceLines.push(pane.candle.createPriceLine({
        price:lowest,
        color:'#26a69a',
        lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true,
        title:'最低',
      }));
    }
  }

  function setPaneData(pane, candles, alignedCandles){
    pane.candles = candles;
    pane.candleMap = new Map(candles.map(c=>[timeNumber(c.time), c]));
    pane.candle.setData(alignedCandles || candles);
    setMAData(pane, candles);
    updateExtremePriceLines(pane, candles);
    updateLatestInfo(pane);
  }

  function alignToSharedTimeline(candles, sharedTimes){
    const map = new Map(candles.map(c=>[timeNumber(c.time), c]));
    return sharedTimes.map(time=>map.get(time) || { time });
  }

  function syncMarketButtons(market){
    marketBtns.forEach(btn=>btn.classList.toggle('active', btn.dataset.compareMarket === market));
  }

  function refresh(cutoff){
    if(!isOpen()) return;
    const a = api();
    if(!a){
      status.textContent = '對比資料介面尚未就緒';
      return;
    }
    ensureCharts();
    lastCutoff = cutoff === undefined ? a.getCutoff() : cutoff;
    const period = a.getPeriod();
    const session = a.getSession();
    const selection = a.getOptionSelection();
    const underlying = getUnderlying(period, lastCutoff);
    const optionTicks = a.getOptionTicks(selection.expiry, selection.strike, selection.type);
    const topCandles = aggregate(underlying.ticks, period, lastCutoff, underlying.market);
    const bottomCandles = aggregate(optionTicks, period, lastCutoff, 'txo');
    const axis = a.getSettlementAxisConfig?.() || {};

    const nextKey = [underlying.market, underlying.expiry, selection.expiry, selection.strike, selection.type, period.value, session, isDark(), axis.enabled, axis.mode, axis.settlementDate, axis.start, axis.end].join('|');
    const keyChanged = nextKey !== dataKey;
    dataKey = nextKey;

    // 兩圖補上相同的 whitespace 時間點，讓每個 logical index 都代表同一根 K 棒時間。
    // 因此縮放比例、左右拖動與十字線位置不會再各自計算。
    const sharedTimes = Array.from(new Set(
      topCandles.concat(bottomCandles).map(c=>timeNumber(c.time)).filter(Number.isFinite)
    )).sort((x,y)=>x-y);
    setPaneData(top, topCandles, alignToSharedTimeline(topCandles, sharedTimes));
    setPaneData(bottom, bottomCandles, alignToSharedTimeline(bottomCandles, sharedTimes));
    topTitle.textContent = `${underlying.label} · ${period.label}`;
    bottomTitle.textContent = `${selection.expiry || '—'} ${selection.strike || '—'}${selection.type || ''} · ${period.label}`;
    status.textContent = `${session}｜十字線與時間範圍同步｜不含成交量`;
    syncMarketButtons(underlying.market);

    if(keyChanged){
      if(sharedTimes.length){
        syncingRange = true;
        try{
          top.chart.timeScale().fitContent();
          bottom.chart.timeScale().fitContent();
        }catch(_){
          top.chart.timeScale().fitContent();
          bottom.chart.timeScale().fitContent();
        }
        requestAnimationFrame(()=>{ syncingRange = false; });
      }
    }
  }

  function open(){
    const technicalTab = document.getElementById('tabTA');
    if(technicalTab && !technicalTab.classList.contains('active')) technicalTab.click();
    panel.classList.add('open');
    openBtn.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    const fixedTooltip = document.getElementById('fixedTooltip');
    if(fixedTooltip) fixedTooltip.style.display = 'none';
    ensureCharts();
    requestAnimationFrame(()=>refresh());
  }

  function close(){
    panel.classList.remove('open', 'maximized');
    openBtn.classList.remove('active');
    if(maxBtn) maxBtn.textContent = '□';
    panel.setAttribute('aria-hidden', 'true');
    hideSyncLines();
    if(typeof window.renderChart_impl === 'function') window.renderChart_impl(api()?.getCutoff?.() || null);
  }

  openBtn.addEventListener('click', ()=>{ if(isOpen()) close(); else open(); });
  closeBtn?.addEventListener('click', close);
  ['tabTrend','tabCompare','tabTimeline'].forEach(id=>{
    document.getElementById(id)?.addEventListener('click', ()=>{ if(isOpen()) close(); });
  });
  marketBtns.forEach(btn=>btn.addEventListener('click', ()=>{
    const market = btn.dataset.compareMarket;
    const original = document.querySelector(`#marketSwitch .market-btn[data-market="${market}"]`);
    if(original && api()?.getMarket() !== market) original.click();
    else refresh(lastCutoff);
  }));

  // 不依賴原單圖目前顯示 TX／TXO：商品欄位或 T 字表一改變，下圖就直接更新。
  let refreshFrame = 0;
  const scheduleSelectionRefresh = ()=>{
    if(!isOpen()) return;
    if(refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(()=>{ refreshFrame = 0; refresh(); });
  };
  ['expirySelect','strikeSelect','typeSelect','sessionSelect','periodSelect'].forEach(id=>{
    document.getElementById(id)?.addEventListener('change', scheduleSelectionRefresh);
  });
  document.getElementById('maBox')?.addEventListener('change', scheduleSelectionRefresh);
  document.getElementById('tBody')?.addEventListener('click', scheduleSelectionRefresh);
  document.getElementById('prevStrikeBtn')?.addEventListener('click', scheduleSelectionRefresh);
  document.getElementById('nextStrikeBtn')?.addEventListener('click', scheduleSelectionRefresh);

  maxBtn?.addEventListener('click', ()=>{
    panel.classList.toggle('maximized');
    maxBtn.textContent = panel.classList.contains('maximized') ? '❐' : '□';
    requestAnimationFrame(()=>refresh(lastCutoff));
  });

  // 拖曳中線，調整上下 K 線高度。
  divider?.addEventListener('pointerdown', e=>{
    const panes = body.querySelectorAll('.compare-k-pane');
    if(panes.length !== 2) return;
    const rect = body.getBoundingClientRect();
    divider.setPointerCapture(e.pointerId);
    const move = ev=>{
      const available = rect.height - divider.offsetHeight;
      const topHeight = Math.max(120, Math.min(available - 120, ev.clientY - rect.top));
      panes[0].style.flex = `0 0 ${topHeight}px`;
      panes[1].style.flex = '1 1 0';
    };
    const up = ev=>{
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      try{ divider.releasePointerCapture(ev.pointerId); }catch(_){ }
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });

  window.addEventListener('keydown', e=>{ if(e.key === 'Escape' && isOpen()) close(); });
  window.opComparePanel = { open, close, refresh, isOpen };
})();
