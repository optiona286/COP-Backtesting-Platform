// ====== 全域共用工具函式（最先載入）======

// ====== 聲音播放 ======
const _soundCache = {};
function playSound(name){
  try{
    if(!_soundCache[name]) _soundCache[name] = new Audio(`sound/${name}`);
    const a = _soundCache[name];
    a.currentTime = 0;
    a.play().catch(()=>{});
  }catch(e){}
}

function keyOf(expiry, strike, type){ return `${expiry}|${strike}|${type}`; }
function fmtNum(n, p=0){ return (isFinite(n) ? Number(n).toLocaleString(undefined,{maximumFractionDigits:p}) : '-'); }
function fmtTime(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`; }
function hhmmss(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}${p(dt.getMinutes())}${p(dt.getSeconds())}`; }
function sanitizeTimeStr(s){ return (s||'').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6); }
function makeDateObj(dateStr, timeStr){
  const t=sanitizeTimeStr(timeStr);
  const y=dateStr.slice(0,4), m=dateStr.slice(4,6), d=dateStr.slice(6,8);
  const hh=t.slice(0,2), mm=t.slice(2,4), ss=t.slice(4,6)||'00';
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
}
function withinSession(tstr){
  const t=sanitizeTimeStr(tstr);
  const sess = document.getElementById('sessionSelect')?.value || '全部';
  if(sess==='全部') return true;
  if(sess==='一般') return t>='084500' && t<='134500';
  if(sess==='盤後') return (t>='150000' || t<='050000');
  return true;
}

// ====== 全域橋接函式（呼叫 window 上的實作，避免無限遞迴）======
function renderChart(c){ window.renderChart_impl && window.renderChart_impl(c); }
function rebuildTTable(c){ window.rebuildTTable && window.rebuildTTable(c); }
function updateAccountUI(){ window.updateAccountUI && window.updateAccountUI(); }
function updateBtUI(){ window.updateBtUI && window.updateBtUI(); }
function rebuildPlayTimes(){ window.rebuildPlayTimes && window.rebuildPlayTimes(); }
function updateTXBar(c){ window.updateTXBar && window.updateTXBar(c); }
function resetAccount(){ window.resetAccount && window.resetAccount(); }
function buildDataIndex(){ window.buildDataIndex && window.buildDataIndex(); }
function updateSelectors(){ window.updateSelectors && window.updateSelectors(); }
function getMAColorMap(){ return window._getMAColorMap ? window._getMAColorMap() : {}; }
function getMAPeriods(){ return window._getMAPeriods ? window._getMAPeriods() : []; }
function calcMA(p,v){ return window._calcMA ? window._calcMA(p,v) : []; }
function getLastPrice(e,s,t,c){ return window._getLastPrice ? window._getLastPrice(e,s,t,c) : null; }
function calcEquity(p){ return window._calcEquity ? window._calcEquity(p) : 0; }
function checkLimitOrders(c){ window.checkLimitOrders && window.checkLimitOrders(c); }
function updateGreeksCard(s,c){ window.updateGreeksCard && window.updateGreeksCard(s,c); }
