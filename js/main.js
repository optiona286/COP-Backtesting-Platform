// ====== DOM ======
    // 直接 init：因為 chartPane 改用 visibility（非 display:none），容器永遠有尺寸
    // chartTA 改用 LWC v5（TXO K線）
    const _taContainer = document.getElementById('chartTA');
    let _taChart    = null; // LWC chart instance
    let _taCandle   = null; // CandlestickSeries
    let _taVolume   = null; // HistogramSeries (volume pane)
    let _taMaSeries = {};   // { period: LineSeries }
    let _taMarkers  = null; // createSeriesMarkers handle
    // chartTrend 保留 ECharts
    const chartTrend = echarts.init(document.getElementById('chartTrend'));
    let activeChartTab = 'ta';
const expirySelect = document.getElementById('expirySelect');
    const strikeSelect = document.getElementById('strikeSelect');
    const typeSelect = document.getElementById('typeSelect');
    const sessionSelect = document.getElementById('sessionSelect');
    const periodSelect = document.getElementById('periodSelect');
    const chartTypeSelect = document.getElementById('chartTypeSelect');

    // ====== MA（均線）設定 ======
    const maBox = document.getElementById('maBox');
    const maCfgBtn = document.getElementById('maCfgBtn');
    const maCfgPanel = document.getElementById('maCfgPanel');
    const maCustomInput = document.getElementById('maCustomInput');
    const maApplyBtn = document.getElementById('maApplyBtn');
    const maResetBtn = document.getElementById('maResetBtn');

    // 你可以在這裡調整預設顏色（也會同步到勾選區的色塊）
    const MA_COLOR_PRESET = {
      5:  '#f1c40f',  // 黃
      10: '#00bcd4',  // 青
      20: '#e91e63',  // 粉
      60: '#9c27b0',  // 紫
      120:'#ff9800'   // 橘（如果你有加 MA120）
    };
    const MA_COLOR_PALETTE = ['#f1c40f','#00bcd4','#e91e63','#9c27b0','#ff9800','#4caf50','#2196f3','#ff5722','#607d8b','#cddc39'];

    function getMAAllChecks(){
      return Array.from(document.querySelectorAll('.maChk'));
    }
    function maColor(period, idx){
      return MA_COLOR_PRESET[period] || MA_COLOR_PALETTE[idx % MA_COLOR_PALETTE.length];
    }
    window._getMAColorMap = function getMAColorMap(){
      const checks = getMAAllChecks();
      const map = {};
      checks.forEach((chk, i)=>{
        const p = parseInt(chk.value,10);
        if(!Number.isFinite(p) || p<=0) return;
        const c = maColor(p, i);
        map[p] = c;
        const sw = chk.closest('.maItem')?.querySelector('.maSwatch');
        if(sw) sw.style.background = c;
      });
      return map;
    }
    function rebuildMABox(periods, checkedSet){
      const uniq = [];
      const seen = new Set();
      periods.forEach(p=>{
        const n = parseInt(p,10);
        if(Number.isFinite(n) && n>0 && !seen.has(n)){ seen.add(n); uniq.push(n); }
      });
      if(!uniq.length) return;

      maBox.innerHTML = uniq.map(p=>{
        const checked = checkedSet ? checkedSet.has(p) : true;
        return `<label class="maItem"><span class="maSwatch" data-ma="${p}"></span><input type="checkbox" class="maChk" value="${p}" ${checked?'checked':''}>MA${p}</label>`;
      }).join('');
      getMAColorMap(); // 同步色塊
    }
    function parseMAPeriods(str){
      return (str||'')
        .split(/[,\s]+/)
        .map(s=>s.trim())
        .filter(Boolean)
        .map(s=>parseInt(s,10))
        .filter(n=>Number.isFinite(n) && n>0 && n<=500);
    }

const kinfo = document.getElementById('kinfo');
    const themeBtn = document.getElementById('themeBtn');
    const fixedTooltip = document.getElementById('fixedTooltip');

    // ====== Theme（最早掛上，確保即使後方有錯仍可切換）======
    var isDark = false;
    if(themeBtn){
      themeBtn.addEventListener('click', ()=>{
        isDark = !isDark;
        document.body.classList.toggle('dark-mode', isDark);
        document.body.style.backgroundColor = isDark ? '#1e1e1e' : '#f5f7fa';
        document.body.style.color = isDark ? '#eee' : '#000';
        themeBtn.textContent = isDark ? '☀️ 淺色' : '🌙 深色';
        renderChart();
      });
    }

// ====== 圖表 TAB（技術分析 / 走勢圖） ======
const tabTA = document.getElementById('tabTA');
const tabTrend = document.getElementById('tabTrend');
const paneTA = document.getElementById('chartTA');
const paneTrend = document.getElementById('chartTrend');

const paneInfo = document.getElementById('chartInfo');
const tabInfo  = document.getElementById('tabInfo');

function setChartTab(tab){
  activeChartTab = tab;
  tabTA.classList.toggle('active', tab==='ta');
  tabTrend.classList.toggle('active', tab==='trend');
  tabInfo?.classList.toggle('active', tab==='info');
  paneTA.classList.toggle('active', tab==='ta');
  paneTrend.classList.toggle('active', tab==='trend');
  if(paneInfo) paneInfo.classList.toggle('active', tab==='info');
  // TX 模式時 LWC 容器已由 renderTX 控制顯示
  if(tab !== 'ta' || currentChartMode !== 'tx') _lwcShowHide(false);
  // LWC TA canvas 要明確顯示/隱藏，避免擋住走勢圖（不論 _taChart 是否存在都要設）
  _taContainer.style.visibility = (tab==='ta') ? '' : 'hidden';
  _taContainer.style.pointerEvents = (tab==='ta') ? '' : 'none';
  fixedTooltip.style.display = (tab==='ta' && fixedTooltip.innerHTML) ? 'block' : 'none';
  // 切到走勢圖時強制 resize + 全面重繪
  if(tab === 'trend'){
    try{ chartTrend.resize(); }catch(_){}
    trendChartInited = false; trendChartKey = '';
  }
  renderChart(cutoffTime);
  if(tab === 'info') updateInfoPanel(cutoffTime);
}
tabTA?.addEventListener('click', ()=>setChartTab('ta'));
tabTrend?.addEventListener('click', ()=>setChartTab('trend'));
document.getElementById('tabInfo')?.addEventListener('click', ()=>setChartTab('info'));

window.addEventListener('resize', ()=>{
  try{ chartTrend.resize(); }catch(_){}
  // TX LWC: autoSize:true，不需要手動 resize
});

    const tBody = document.getElementById('tBody');

    // ====== T 表滾動偵測：使用者手動滾動時進入手動模式，停止自動跳到 ATM ======
    {
      const tContainer = tBody.closest('.tbody');
      if(tContainer){
        // 滑鼠滾輪
        tContainer.addEventListener('wheel', ()=>{ if(cutoffTime) userManualMode = true; }, {passive:true});
        // 觸控拖曳
        tContainer.addEventListener('touchstart', ()=>{ if(cutoffTime) userManualMode = true; }, {passive:true});
        // 滑鼠拖曳 scrollbar
        tContainer.addEventListener('mousedown', ()=>{ if(cutoffTime) userManualMode = true; }, {passive:true});
      }
    }

    // ====== T 表事件委派（只綁一次，取代每次 rebuildTTable 的 querySelectorAll + addEventListener）======
    tBody.addEventListener('click', (e)=>{
      const td = e.target.closest('td');
      if(!td) return;
      // C / P 價格欄
      if(td.classList.contains('td-c') || td.classList.contains('td-p')){
        const strike = td.getAttribute('data-strike');
        const side = td.getAttribute('data-side');
        if(!strike || !side) return;
        selectedSide = side;
        strikeSelect.value = strike;
        updateGreeksCard(strike, cutoffTime); // ★ 更新 Greeks 卡片
        if(cutoffTime) userManualMode = true; // 回測中手動點選 → 不再自動捲動
        const wantType = (side==='C') ? typeAliases.call : typeAliases.put;
        // 用索引快速查詢可用 types
        const expiry = expirySelect.value;
        const types = [];
        const seenTypes = new Set();
        const arrC = dataIndex.get(keyOf(expiry, strike, typeAliases.call));
        const arrP = dataIndex.get(keyOf(expiry, strike, typeAliases.put));
        if(arrC && arrC.length) seenTypes.add(typeAliases.call);
        if(arrP && arrP.length) seenTypes.add(typeAliases.put);
        if(seenTypes.has(wantType)) typeSelect.value = wantType;
        else if(seenTypes.size) typeSelect.value = seenTypes.values().next().value;
        const key = `${expiry}_${strike}`; lastTypeSelectionMap[key] = typeSelect.value;
        currentChartMode = 'txo';
        _lwcShowHide(false); // 切回 TXO 時隱藏 LWC
        if(activeChartTab === 'ta') setChartTab('ta'); else renderChart(cutoffTime);
        highlightTSelected();
        updateAccountUI();
        return;
      }
      // 履約價中間欄
      if(td.classList.contains('td-strike')){
        const strike = td.getAttribute('data-strike') || strikeSelect.value;
        updateGreeksCard(strike, cutoffTime); // ★ 更新 Greeks 卡片
        if(cutoffTime) userManualMode = true; // 回測中手動點選履約價 → 不再自動捲動
        currentChartMode = 'tx';
        // ★ 強制重置 TX dirty flag，確保切換時一定重繪
        taChartInited = false;
        taChartKey = '';
        if(activeChartTab === 'ta') setChartTab('ta'); else renderChart(cutoffTime);
        highlightTSelected();
        return;
      }
    });

    // ── 右鍵（PC）→ 跳下單頁 ──
    tBody.addEventListener('contextmenu',(e)=>{
      const td = e.target.closest('td'); if(!td) return;
      const isPrice = td.classList.contains('td-c') || td.classList.contains('td-p') ||
                      td.classList.contains('td-call') || td.classList.contains('td-put') ||
                      td.classList.contains('td-strike');
      if(isPrice){
        e.preventDefault();
        const strike = td.dataset.strike || strikeSelect.value;
        const side = td.dataset.side;
        if(strike) strikeSelect.value = strike;
        if(side){
          const wantType = side==='C' ? typeAliases.call : typeAliases.put;
          if(wantType) typeSelect.value = wantType;
        }
        updateAccountUI();
        document.querySelector('.nav-item[data-page="pageOrder"]')?.click();
      }
    });

    // ── 長按（手機）→ 跳下單頁 ──
    {
      let _ltTimer=null, _ltTd=null;
      tBody.addEventListener('touchstart',(e)=>{
        const td = e.target.closest('td'); if(!td) return;
        const isPrice = td.classList.contains('td-c') || td.classList.contains('td-p') ||
                        td.classList.contains('td-call') || td.classList.contains('td-put') ||
                        td.classList.contains('td-strike');
        if(isPrice){
          _ltTd = td;
          _ltTimer = setTimeout(()=>{
            if(!_ltTd) return;
            const strike = _ltTd.dataset.strike || strikeSelect.value;
            const side = _ltTd.dataset.side;
            if(strike) strikeSelect.value = strike;
            if(side){
              const wantType = side==='C' ? typeAliases.call : typeAliases.put;
              if(wantType) typeSelect.value = wantType;
            }
            updateAccountUI();
            document.querySelector('.nav-item[data-page="pageOrder"]')?.click();
            _ltTd = null;
          }, 550);
        }
      },{passive:true});
      tBody.addEventListener('touchend',   ()=>{ clearTimeout(_ltTimer); _ltTimer=null; _ltTd=null; });
      tBody.addEventListener('touchmove',  ()=>{ clearTimeout(_ltTimer); _ltTimer=null; _ltTd=null; });
      tBody.addEventListener('touchcancel',()=>{ clearTimeout(_ltTimer); _ltTimer=null; _ltTd=null; });
    }

    // Backtest bar
    const btStart = document.getElementById('btStart');
    const btPause = document.getElementById('btPause');
    const btResume = document.getElementById('btResume');
    const btStop = document.getElementById('btStop');
    const btStep = document.getElementById('btStep');
    const btStepBack = document.getElementById('btStepBack');
    const btStepSec = document.getElementById('btStepSec');
    const btCalcSpeed = document.getElementById('btCalcSpeed');
    const btProgress = document.getElementById('btProgress');
    const btInfo = document.getElementById('btInfo');
    const btClock = document.getElementById('btClock');
    const btSetTime = document.getElementById('btSetTime');
    const btJump = document.getElementById('btJump');

    // Order & account
    const qtyInput = document.getElementById('qtyInput');
    const multInput = document.getElementById('multInput');
    const feeInput = document.getElementById('feeInput');
    const allowShort = document.getElementById('allowShort');
    const btnBuy = document.getElementById('btnBuy');
    const btnSell = document.getElementById('btnSell');
    const symNow = document.getElementById('symNow');
    const lastPx = document.getElementById('lastPx');
    const uPnL = document.getElementById('uPnL');
    const rPnL = document.getElementById('rPnL');
    const equity = document.getElementById('equity');

    const cash0 = document.getElementById('cash0');
    const cash = document.getElementById('cash');
    const rPnL2 = document.getElementById('rPnL2');
    const uPnL2 = document.getElementById('uPnL2');
    const equity2 = document.getElementById('equity2');
    const usedCost = document.getElementById('usedCost');
    const posTable = document.getElementById('posTable').querySelector('tbody');
    const ordTable = document.getElementById('ordTable').querySelector('tbody');
    const riskMaxQty = document.getElementById('riskMaxQty');
    const riskEquityStop = document.getElementById('riskEquityStop');

    // Limit orders
    const ltSide = document.getElementById('ltSide');
    const ltPrice = document.getElementById('ltPrice');
    const ltQty = document.getElementById('ltQty');
    const btnPlaceLimit = document.getElementById('btnPlaceLimit');
    const ltTable = document.getElementById('ltTable').querySelector('tbody');
    const ltWorkingCnt = document.getElementById('ltWorkingCnt');

    // BT20 → 條件委託單 DOM（改為 window.* 全域，讓 autoorder.js 可存取）
    window.bt20Run   = document.getElementById('bt20Run');
    window.bt20Stop  = document.getElementById('bt20Stop');
    window.s1Body    = document.getElementById('s1Body');
    window.s1Cards   = document.getElementById('s1Cards');
    window.s1TblWrap = document.getElementById('s1TblWrap');
    window.s1Status  = document.getElementById('s1Status');
    window.s1FilledCount = document.getElementById('s1FilledCount');
    window.s1CallPnl = document.getElementById('s1CallPnl');
    window.s1PutPnl  = document.getElementById('s1PutPnl');
    window.s1TotalPnl= document.getElementById('s1TotalPnl');
    window.s1CallCount=document.getElementById('s1CallCount');
    window.s1PutCount =document.getElementById('s1PutCount');
    // 本地別名，保持 main.js 內部程式碼不變
    const bt20Run=window.bt20Run, bt20Stop=window.bt20Stop,
          s1Body=window.s1Body, s1Cards=window.s1Cards, s1TblWrap=window.s1TblWrap,
          s1Status=window.s1Status, s1FilledCount=window.s1FilledCount,
          s1CallPnl=window.s1CallPnl, s1PutPnl=window.s1PutPnl, s1TotalPnl=window.s1TotalPnl,
          s1CallCount=window.s1CallCount, s1PutCount=window.s1PutCount;

    // === 條件委託單引擎狀態 ===
    window.autoOrderActive = false;
    window.autoOrderPositions = [];
    window.autoOrderEnteredKeys = new Set();

    // ====== State ======
    window.rawData = []; let rawData = window.rawData;
    window.txRawData = []; let txRawData = window.txRawData; // TX 台指期貨資料（獨立儲存）
    // isDark 已在頂部以 var 宣告
    const lastTypeSelectionMap = {};

    // 回測
    let playTimes = []; // Date[]
    let playIndex = 0;
    let playTimer = null;
    window.playing = false; let playing = window.playing;
    window.cutoffTime = null; let cutoffTime = window.cutoffTime;
    let userManualMode = false; // 使用者手動操作後，停止自動捲動到 ATM 中心
    let simTime = null;

    window.typeAliases = { call: null, put: null };
    let selectedSide = null;
    let currentChartMode = 'txo'; // 'txo' | 'tx'
    let prevTTablePrices = new Map(); // 追蹤上一次T表價格，用於計算漲跌
    let trendChartInited = false; // 走勢圖是否已初始化（用於增量更新）
    let trendChartKey = ''; // 走勢圖當前商品 key（商品變了才全面重繪）
    let taChartInited = false;  // K 線圖是否已初始化
    let taChartKey = '';        // K 線圖當前商品 key
    let txChartInited = false;  // TX K 線圖是否已初始化（與 taChart 分開）
    let txChartKey = '';        // TX K 線圖快取 key

    // 交易帳戶
    window.account = {
      initCash: 1_000_000,
      cash: 1_000_000,
      realized: 0,
      positions: new Map(),
      orders: []
    };

    // 委託單（限價）
    window.limits = []; const limits = window.limits; 

    // ====== Utils ======

    // ====== Black-Scholes Greeks 計算 ======

    // 標準常態分佈 CDF（Abramowitz & Stegun 近似）
    function normCDF(x) {
      const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
      const sign = x < 0 ? -1 : 1;
      x = Math.abs(x) / Math.sqrt(2);
      const t = 1 / (1 + p * x);
      const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
      return 0.5 * (1 + sign * y);
    }

    // 標準常態分佈 PDF
    function normPDF(x) {
      return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
    }

    // 用二分法從市價反推 IV（最多50次迭代）
    function calcIV(S, K, T, r, marketPrice, isCall) {
      if(T <= 0 || marketPrice <= 0) return null;
      let lo = 0.001, hi = 10, mid, price;
      for(let i = 0; i < 50; i++) {
        mid = (lo + hi) / 2;
        const bs = bsPrice(S, K, T, r, mid, isCall);
        if(bs > marketPrice) hi = mid;
        else lo = mid;
        if(hi - lo < 0.0001) break;
      }
      return mid;
    }

    // BS 定價
    function bsPrice(S, K, T, r, sigma, isCall) {
      if(T <= 0 || sigma <= 0) return 0;
      const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
      const d2 = d1 - sigma*Math.sqrt(T);
      if(isCall) return S*normCDF(d1) - K*Math.exp(-r*T)*normCDF(d2);
      else       return K*Math.exp(-r*T)*normCDF(-d2) - S*normCDF(-d1);
    }

    // 計算所有 Greeks
    function calcGreeks(S, K, T, r, sigma, isCall) {
      if(T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return null;
      const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
      const d2 = d1 - sigma*Math.sqrt(T);
      const nd1 = normPDF(d1);
      const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;
      const gamma = nd1 / (S * sigma * Math.sqrt(T));
      const theta = isCall
        ? (-S*nd1*sigma/(2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*normCDF(d2)) / 365
        : (-S*nd1*sigma/(2*Math.sqrt(T)) + r*K*Math.exp(-r*T)*normCDF(-d2)) / 365;
      const vega  = S * nd1 * Math.sqrt(T) / 100; // per 1% IV change
      return { delta, gamma, theta, vega };
    }

    // 更新 Greeks 卡片
    window.updateGreeksCard = function updateGreeksCard(strike, cutoff) {
      const card = document.getElementById('greeksCard');
      console.log('[Greeks] called, strike=', strike, 'card=', !!card);
      if(!card || !strike) { console.log('[Greeks] early exit: no card or no strike'); if(card) card.style.display='none'; return; }

      const expiry  = expirySelect.value;
      console.log('[Greeks] expiry=', expiry);
      if(!expiry) { card.style.display='none'; return; }

      // 取 TX 現價作為 S
      let S = null;
      if(txDataIndex.length) {
        const cutMs = cutoff ? +cutoff : Infinity;
        for(let i = txDataIndex.length-1; i >= 0; i--) {
          const d = txDataIndex[i];
          if(d.dtms <= cutMs && withinSession(d.time)) { S = d.price; break; }
        }
      }
      // ★ 沒有 TX 現價時，用 Call/Put 價差最小的履約價估算 S（ATM 估計）
      if(!S) {
        // 從 T 字表所有行找 |cPrice - pPrice| 最小的履約價
        let minDiff = Infinity;
        dataIndex.forEach((arr, k) => {
          const parts = k.split('|');
          if(parts[0] !== expiry) return;
          const sk = parts[1], ty = parts[2];
          const cutMs2 = cutoff ? +cutoff : Infinity;
          let last = null;
          for(const r of arr) { if(r.dtms <= cutMs2) last = r.price; else break; }
          if(last == null) return;
          if(!window._greeksTmp) window._greeksTmp = {};
          if(!window._greeksTmp[sk]) window._greeksTmp[sk] = {};
          if(ty === typeAliases.call) window._greeksTmp[sk].c = last;
          else window._greeksTmp[sk].p = last;
        });
        if(window._greeksTmp) {
          Object.entries(window._greeksTmp).forEach(([sk, v]) => {
            if(v.c != null && v.p != null) {
              const diff = Math.abs(v.c - v.p);
              if(diff < minDiff) { minDiff = diff; S = parseFloat(sk); }
            }
          });
          window._greeksTmp = null;
        }
      }
      if(!S) { card.style.display='none'; return; }

      const K  = parseFloat(strike);
      const r  = 0.015; // 無風險利率 1.5%

      // 計算剩餘天數 T（年）
      let T = 0;
      const seq = window._contractSeq || [];
      const nowMs = cutoff ? +cutoff : Date.now();
      // 從 _contractSeq 找對應契約的結算日
      // 用 expirySelect 值去 _contractSeq 找結算日
      const contractKey = (expirySelect.value || '').trim().toUpperCase();
      let settleMs = null;
      for(const s of seq) {
        const sk = (s.key||s.contractMonth||'').trim().toUpperCase();
        if((sk === contractKey || sk.replace(/\s/g,'') === contractKey.replace(/\s/g,'')) && s.endDate) {
          settleMs = +s.endDate; break;
        }
      }
      if(!settleMs) {
        // fallback：從 expiry 字串解析 YYYYMM → 當月第三個週三
        const ym = expiry.replace(/W\d$/,'').slice(0,6);
        if(ym.length === 6) {
          const yr = parseInt(ym.slice(0,4)), mo = parseInt(ym.slice(4,6))-1;
          const d = new Date(yr, mo, 1);
          let wed = 0;
          for(let dd=1; dd<=31; dd++) {
            const dt = new Date(yr, mo, dd);
            if(dt.getMonth() !== mo) break;
            if(dt.getDay() === 3) { wed++; if(wed===3){ settleMs=+dt; break; } }
          }
        }
      }
      if(settleMs) {
        T = Math.max(0, (settleMs - nowMs) / (1000*60*60*24*365));
      }
      if(T <= 0) T = 7/365; // ★ fallback：至少用 7 天避免除以零

      const callPrice = getLastPrice(expiry, strike, typeAliases.call, cutoff);
      const putPrice  = getLastPrice(expiry, strike, typeAliases.put,  cutoff);

      function fmt(v, dec=4) { return v==null ? '—' : v.toFixed(dec); }
      function fmtPct(v) { return v==null ? '—' : (v*100).toFixed(1)+'%'; }

      // CALL
      if(callPrice != null) {
        const iv = calcIV(S, K, T, r, callPrice, true);
        const g  = iv ? calcGreeks(S, K, T, r, iv, true) : null;
        document.getElementById('gCallDelta').textContent = g ? fmt(g.delta,3) : '—';
        document.getElementById('gCallGamma').textContent = g ? fmt(g.gamma,4) : '—';
        document.getElementById('gCallTheta').textContent = g ? fmt(g.theta,2) : '—';
        document.getElementById('gCallVega').textContent  = g ? fmt(g.vega,2)  : '—';
        document.getElementById('gCallIV').textContent    = iv ? fmtPct(iv)    : '—';
      } else {
        ['gCallDelta','gCallGamma','gCallTheta','gCallVega','gCallIV'].forEach(id=>{ document.getElementById(id).textContent='—'; });
      }

      // PUT
      if(putPrice != null) {
        const iv = calcIV(S, K, T, r, putPrice, false);
        const g  = iv ? calcGreeks(S, K, T, r, iv, false) : null;
        document.getElementById('gPutDelta').textContent = g ? fmt(g.delta,3) : '—';
        document.getElementById('gPutGamma').textContent = g ? fmt(g.gamma,4) : '—';
        document.getElementById('gPutTheta').textContent = g ? fmt(g.theta,2) : '—';
        document.getElementById('gPutVega').textContent  = g ? fmt(g.vega,2)  : '—';
        document.getElementById('gPutIV').textContent    = iv ? fmtPct(iv)    : '—';
      } else {
        ['gPutDelta','gPutGamma','gPutTheta','gPutVega','gPutIV'].forEach(id=>{ document.getElementById(id).textContent='—'; });
      }

      document.getElementById('greeksStrikeLabel').textContent = `履約價 ${strike}　S=${S.toFixed(0)}　T=${(T*365).toFixed(1)}天`;
      card.style.display = '';
    }

    // ====== 資料索引（效能核心）======
    // 將 rawData 按 expiry|strike|type 分組，組內按 dtms 排序
    // 這樣 getLastPrice 可用二分搜尋 O(log n) 取代 O(n) 全掃描
    window.dataIndex = new Map(); let dataIndex = window.dataIndex; // key => sorted array of {dtms, price, volume, time}
    let txDataIndex = []; // TX sorted by dtms for binary search
    window.txDataIndex = txDataIndex; // ★ 讓浮動視窗可存取

    window.buildDataIndex = function buildDataIndex(){
      dataIndex.clear();
      for(const d of rawData){
        const k = keyOf(d.expiry, d.strike, d.type);
        let arr = dataIndex.get(k);
        if(!arr){ arr = []; dataIndex.set(k, arr); }
        arr.push(d);
      }
      // 每組按 dtms 排序
      dataIndex.forEach(arr => arr.sort((a,b) => a.dtms - b.dtms));
      // TX 索引
      txDataIndex = txRawData.slice().sort((a,b) => a.dtms - b.dtms);
      window.txDataIndex = txDataIndex; // ★ 同步
    }

    function sanitizeTimeStr(s){ return (s||'').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6) }
    function makeDateObj(dateStr,timeStr){
      const t=sanitizeTimeStr(timeStr);
      const y=dateStr.slice(0,4),m=dateStr.slice(4,6),d=dateStr.slice(6,8);
      const hh=t.slice(0,2),mm=t.slice(2,4),ss=t.slice(4,6)||'00';
      const dt=new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
      // OptionsDaily 的成交日期為「日曆日」：夜盤(15:00~23:59)用前一日日期、凌晨(00:00~05:00)用當日日期
      // 因此不再做跨日 +1 補正，避免日期被推到隔天造成 X 軸錯亂
      return dt;
    }
    function withinSession(tstr){
      const t=sanitizeTimeStr(tstr), sess=sessionSelect.value;
      if (sess==='全部') return true;
      if (sess==='一般') return t>='084500' && t<='134500';
      if (sess==='盤後') return (t>='150000' || t<='050000');
      return true;
    }
    function fmtTime(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}` }
    function hhmmss(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}${p(dt.getMinutes())}${p(dt.getSeconds())}` }
    function findIndexByTimeStr(hms){
      const t=(hms||'').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6);
      if (!playTimes.length) return -1;
      let idx=playTimes.findIndex(dt=>hhmmss(dt)>=t);
      if (idx===-1) idx=playTimes.length-1;
      return idx;
    }
    function detectTypeAliasesForExpiry(expiry){
      const types = new Set();
      dataIndex.forEach((arr, k) => {
        if(k.startsWith(expiry + '|') && arr.length) types.add(k.split('|')[2]);
      });
      const typesArr = Array.from(types);
      let call=null, put=null;
      for(const t of typesArr){
        const u=t.toUpperCase();
        if(!call && (u==='C'||u.includes('CALL')||u.includes('買'))) call=t;
        if(!put && (u==='P'||u.includes('PUT') ||u.includes('賣'))) put=t;
      }
      if(!call && typesArr.length) call=typesArr[0];
      if(!put && typesArr.length) put=typesArr.find(x=>x!==call)||typesArr[0];
      return {call,put};
    }
    function numberOrDash(x){ return (x==null || isNaN(x)) ? '-' : x }

    window._getLastPrice = function getLastPrice(expiry,strike,type,cutoff){
      const k = keyOf(expiry, strike, type);
      const arr = dataIndex.get(k);
      if(!arr || !arr.length) return null;
      const sess = sessionSelect.value;
      const cutMs = cutoff ? +cutoff : Infinity;
      // 逆序找最後一筆符合 session + cutoff 的（大部分情況下接近尾端，速度極快）
      for(let i = arr.length - 1; i >= 0; i--){
        const d = arr[i];
        if(d.dtms > cutMs) continue;
        if(sess !== '全部' && !withinSession(d.time)) continue;
        return d.price;
      }
      return null;
    }

    function ymdToISO(ymd){
      if(!ymd || ymd.length!==8) return '';
      return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
    }

    // ====== File Load（資料夾模式 + 合併模式） ======
    let folderFiles = []; // 儲存資料夾中所有檔案
    let dateFileMap = new Map(); // date -> { op: File[], fu: File[] }
    const dateSelect = document.getElementById('dateSelect');
    const loadStatus = document.getElementById('loadStatus');
    const btnRefresh  = document.getElementById('btnRefresh');
    const btnModeSingle = document.getElementById('btnModeSingle');
    const btnModeMerge  = document.getElementById('btnModeMerge');
    const mergeProgressEl    = document.getElementById('mergeProgress');
    const mergeProgressFill  = document.getElementById('mergeProgressFill');
    const mergeProgressPct   = document.getElementById('mergeProgressPct');
    const mergeProgressLabel = document.getElementById('mergeProgressLabel');

    let viewMode = 'single'; // 'single' | 'merge'

    // 模式切換
    btnModeSingle.addEventListener('click', ()=>{
      viewMode = 'single';
      btnModeSingle.classList.add('mode-active');
      btnModeMerge.classList.remove('mode-active');
      document.getElementById('lblDate').textContent = '交易日：';
      // 重建選單（顯示個別日期）
      rebuildDateSelect();
      btnRefresh.style.display = dateSelect.value ? '' : 'none';
    });
    btnModeMerge.addEventListener('click', ()=>{
      viewMode = 'merge';
      btnModeMerge.classList.add('mode-active');
      btnModeSingle.classList.remove('mode-active');
      document.getElementById('lblDate').textContent = '資料範圍：';
      rebuildDateSelect();
      btnRefresh.style.display = dateFileMap.size ? '' : 'none';
    });

    // 更新按鈕
    btnRefresh.addEventListener('click', async ()=>{
      if(viewMode === 'merge'){
        await loadMergedData();
      } else {
        const dateKey = dateSelect.value;
        if(dateKey) await loadSingleDate(dateKey);
      }
    });

    // 通用工具函式
    const decodeGuess = (buf)=>{
      const stripBom = (s)=> (s||'').replace(/^\uFEFF/, '');
      const hasKey = (s)=> s && (s.includes('成交日期') || s.includes('交易日期') || s.includes('商品代號'));
      const tryDec = (enc)=>{ try { return new TextDecoder(enc, { fatal:false }).decode(buf); } catch(_){ return null; } };
      let t = stripBom(tryDec('utf-8'));
      if (hasKey(t)) return t;
      t = stripBom(tryDec('big5')) || stripBom(tryDec('cp950')) || t || '';
      return t;
    };
    const readRPTEntry = async (zip, name)=>{
      const buf = await zip.files[name].async('arraybuffer');
      return decodeGuess(buf);
    };

    // 從一組 Files 讀取所有行
    // ── 讀取單一 File → 回傳行陣列（用於並行）
    async function readOneFile(file){
      const name = (file.name||'').toLowerCase();
      const rows = [];
      if(name.endsWith('.zip')){
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.keys(zip.files)
            .filter(n => n.toLowerCase().endsWith('.rpt') && !zip.files[n].dir);
          // zip 內的 rpt 也並行解壓
          const texts = await Promise.all(entries.map(rptName => readRPTEntry(zip, rptName)));
          for(const text of texts){
            if(text) text.split(/\r?\n/).forEach(l=>rows.push(l));
          }
        } catch(err){ console.warn('ZIP 讀取失敗:', file.name, err); }
      } else if(name.endsWith('.rpt')){
        try {
          const buf = await file.arrayBuffer();
          const text = decodeGuess(buf);
          if(text) text.split(/\r?\n/).forEach(l=>rows.push(l));
        } catch(err){ console.warn('RPT 讀取失敗:', file.name, err); }
      }
      return rows;
    }

    // ── 並行讀取多個 File（舊介面相容）
    async function readFilesRows(files){
      const results = await Promise.all(files.map(f => readOneFile(f)));
      return results.flat();
    }

    // 解析 rows → rawData, txRawData
    function parseRows(rows){
      const opData = rows
        .map(line=>line.trim().split(',').map(s=>s.trim()))
        .filter(d=>d.length>=8 && d[1]==='TXO')
        .map(d=>{
          const dtObj = makeDateObj(d[0], d[5]);
          return { date:d[0], product:d[1], strike:d[2], expiry:d[3], type:d[4],
            time:d[5], dtms: +dtObj, price:parseFloat(d[6]), volume:parseInt(d[7]), openFlag:d[8]||'' };
        })
        .filter(d=>!isNaN(d.price) && !isNaN(d.volume));

      const fuData = rows
        .map(line => line.trim().split(',').map(s => s.trim()))
        .filter(d => {
          if(d.length < 5) return false;
          const p = (d[1]||'').toUpperCase();
          return p === 'TX';
        })
        .map(d => {
          let time, price, volume, expiry;
          const d2 = d[2]||'';
          const isFutFormat = /^\d{6}$/.test(d2) || /^\d{4,6}\s*$/.test(d2);
          if(isFutFormat){
            expiry = d[2]; time = d[3]||''; price = parseFloat(d[4]); volume = parseInt(d[5])||0;
          } else {
            expiry = d[3]||''; time = d[5]||''; price = parseFloat(d[6]); volume = parseInt(d[7])||0;
          }
          const dtObj = makeDateObj(d[0], time);
          return { date:d[0], product:d[1], expiry:expiry.replace(/\s/g,''), time, dtms:+dtObj, price, volume };
        })
        .filter(d => !isNaN(d.price) && d.price > 0);

      return { opData, fuData };
    }

    // 重建下拉選單（獨立/合併 共用）
    function rebuildDateSelect(){
      if(!dateFileMap.size){
        dateSelect.innerHTML = '<option value="">（請先選擇資料夾）</option>';
        dateSelect.disabled = true;
        btnRefresh.style.display = 'none';
        return;
      }
      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>b.localeCompare(a));
      if(viewMode === 'merge'){
        // 合併模式：只顯示一個「全部 N 天」選項
        const y1 = dates[dates.length-1].replace(/_/g,'/');
        const y2 = dates[0].replace(/_/g,'/');
        dateSelect.innerHTML = `<option value="__merge__">全部 ${dates.length} 個交易日（${y1} ～ ${y2}）</option>`;
        dateSelect.disabled = false;
        btnRefresh.style.display = '';
      } else {
        dateSelect.innerHTML = '<option value="">— 請選擇交易日 —</option>' +
          dates.map(d=>{
            const info = dateFileMap.get(d);
            const opCount = info.op.length;
            const fuCount = info.fu.length;
            const label = d.replace(/_/g, '/');
            const tag = opCount && fuCount ? '✓OP+FU' : opCount ? 'OP only' : 'FU only';
            return `<option value="${d}">${label}（${tag}）</option>`;
          }).join('');
        dateSelect.disabled = false;
        btnRefresh.style.display = 'none';
      }
    }

    // 步驟 1：使用者選資料夾 → 掃描所有 zip，解析日期，建立下拉選單
    document.getElementById('folderInput').addEventListener('change', async (e)=>{
      folderFiles = Array.from(e.target.files || []);
      if(!folderFiles.length) return;

      dateFileMap.clear();
      dateSelect.innerHTML = '<option value="">解析中...</option>';
      dateSelect.disabled = true;
      loadStatus.textContent = `掃描 ${folderFiles.length} 個檔案...`;

      const dateRe_opt = /^OptionsDaily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})/i;
      const dateRe_fut = /^Daily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})/i;

      for(const file of folderFiles){
        const name = (file.name||'');
        let m, dateKey, kind;
        m = name.match(dateRe_opt);
        if(m){ dateKey = `${m[1]}_${m[2]}_${m[3]}`; kind = 'op'; }
        else {
          m = name.match(dateRe_fut);
          if(m){ dateKey = `${m[1]}_${m[2]}_${m[3]}`; kind = 'fu'; }
        }
        if(!dateKey) continue;
        if(!dateFileMap.has(dateKey)) dateFileMap.set(dateKey, { op:[], fu:[] });
        dateFileMap.get(dateKey)[kind].push(file);
      }

      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>b.localeCompare(a));

      if(!dates.length){
        dateSelect.innerHTML = '<option value="">未找到符合的資料</option>';
        loadStatus.textContent = '未偵測到 OptionsDaily / Daily 命名的檔案';
        btnRefresh.style.display = 'none';
        return;
      }

      rebuildDateSelect();
      loadStatus.textContent = `找到 ${dates.length} 個交易日`;
      btnRefresh.style.display = (viewMode === 'merge') ? '' : 'none';

      // 合併模式：自動開始合併
      if(viewMode === 'merge') await loadMergedData();
    });

    // ===== 合併模式：全部並行載入 =====
    async function loadMergedData(){
      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>a.localeCompare(b));
      if(!dates.length){ alert('沒有可合併的資料'); return; }

      const total = dates.length;
      mergeProgressEl.style.display = 'flex';
      btnRefresh.disabled = true;
      dateSelect.disabled = true;
      loadStatus.textContent = `並行合併 ${total} 個交易日...`;

      // 計數器：即時更新進度
      let done = 0;
      const updateProgress = (label) => {
        const pct = Math.round((done / total) * 100);
        mergeProgressFill.style.width = pct + '%';
        mergeProgressPct.textContent = pct + '%';
        mergeProgressLabel.textContent = label || `已完成 ${done} / ${total}`;
      };
      updateProgress('啟動並行讀取...');

      // 蒐集所有 File 物件（OP + FU），帶日期標記
      const allFileTasks = dates.flatMap(d => {
        const info = dateFileMap.get(d);
        return [...info.op, ...info.fu];
      });

      // ★ 全部並行！同時解壓所有 zip
      const rowArrays = await Promise.all(
        allFileTasks.map(file =>
          readOneFile(file).then(rows => {
            done++;
            updateProgress();
            return rows;
          })
        )
      );

      mergeProgressFill.style.width = '100%';
      mergeProgressPct.textContent = '100%';
      mergeProgressLabel.textContent = '解析資料中...';
      // 讓 UI 喘口氣再做 parseRows（可能幾十萬行）
      await new Promise(r => setTimeout(r, 0));

      const allRows = rowArrays.flat();
      const { opData, fuData } = parseRows(allRows);
      rawData = opData; window.rawData = rawData;
      txRawData = fuData; window.txRawData = txRawData;

      mergeProgressEl.style.display = 'none';
      btnRefresh.disabled = false;
      dateSelect.disabled = false;

      afterDataLoaded(`合併 ${total} 天`);
    }

    // ===== 載入單一日期 =====
    async function loadSingleDate(dateKey){
      const info = dateFileMap.get(dateKey);
      if(!info){ alert('找不到該日資料'); return; }

      loadStatus.textContent = '載入中...';
      dateSelect.disabled = true;
      btnRefresh.disabled = true;

      const rows = await readFilesRows([...info.op, ...info.fu]);

      if(!rows.length){
        alert('該日資料讀取為空，請確認檔案內容');
        loadStatus.textContent = '載入失敗';
        dateSelect.disabled = false;
        btnRefresh.disabled = false;
        return;
      }

      const { opData, fuData } = parseRows(rows);
      rawData = opData; window.rawData = rawData;
      txRawData = fuData; window.txRawData = txRawData;

      const dateLabel = dateKey.replace(/_/g, '/');
      btnRefresh.style.display = '';
      btnRefresh.disabled = false;
      dateSelect.disabled = false;
      afterDataLoaded(dateLabel);
    }

    // ===== 資料載入後的共用初始化 =====
    function afterDataLoaded(label){
      buildDataIndex();
      if(!rawData.length && !txRawData.length){
        alert(`${label} 未找到 TXO 或 TX 資料`);
        loadStatus.textContent = `${label}：無資料`;
        return;
      }

      resetAccount();
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null;
      trendChartInited = false; trendChartKey = '';
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache();
      cutoffTime = null; simTime = null;
      autoOrderActive = false;
      autoOrderPositions = [];
      autoOrderEnteredKeys = new Set();
      s1Status.textContent='未啟動'; s1Status.className='s1-status stopped';
      bt20Run.style.display=''; bt20Stop.style.display='none';
      s1Cards.style.display='none'; s1TblWrap.style.display='none';
      s1Body.innerHTML='<tr><td colspan="9" style="text-align:center;color:#aaa;padding:14px">請設定條件後按「啟動自動下單」，再開始回測播放</td></tr>';
      document.getElementById('statWinner').style.display='none';
      document.getElementById('statPattern').style.display='none';
      document.getElementById('statSub20').style.display='none';

      if(rawData.length){
        updateSelectors();
        rebuildPlayTimes();
        renderChart();
        rebuildTTable();
      }
      updateTXBar();
      updateBtUI();
      updateAccountUI();

      const opCount = rawData.length;
      const fuCount = txRawData.length;
      loadStatus.textContent = `${label}：OP ${opCount.toLocaleString()} 筆 / FU ${fuCount.toLocaleString()} 筆`;

      // 如果已有結算資料，重新篩契約選單年份
      if(window._contractSeq && window._contractSeq.length) buildContractSequence();

      // 清空之前的契約篩選備份
      window._fullRawData   = null;
      window._fullTxRawData = null;
    }

    // 步驟 2：選日期 → 載入該日的 op + fu 資料
    dateSelect.addEventListener('change', async ()=>{
      const dateKey = dateSelect.value;
      if(!dateKey) return;
      if(dateKey === '__merge__'){
        await loadMergedData();
      } else {
        await loadSingleDate(dateKey);
      }
    });

    // ====== Selectors ======
    window.updateSelectors = function updateSelectors(){
      expirySelect.removeEventListener('change', onExpiryChange);
      const expiries=[...new Set(rawData.map(d=>d.expiry))].sort();
      expirySelect.innerHTML=expiries.map(e=>`<option value="${e}">${e}</option>`).join('');
      let bestExpiry = expiries[0] || '';
      if(expiries.length > 1){
        // 用索引快速計算各月份成交量
        const volMap = new Map();
        dataIndex.forEach((arr, k) => {
          const exp = k.split('|')[0];
          let vol = 0;
          for(const d of arr) vol += (d.volume || 0);
          volMap.set(exp, (volMap.get(exp) || 0) + vol);
        });
        let maxVol = -1;
        for(const exp of expiries){
          const totalVol = volMap.get(exp) || 0;
          if(totalVol > maxVol){ maxVol = totalVol; bestExpiry = exp; }
        }
      }
      expirySelect.value = bestExpiry;
      typeAliases=detectTypeAliasesForExpiry(expirySelect.value);
      updateStrikes();
      expirySelect.addEventListener('change', onExpiryChange);
    }
    function onExpiryChange(){
      typeAliases=detectTypeAliasesForExpiry(expirySelect.value);
      updateStrikes();
      rebuildPlayTimes();
      stopPlayback();
      cutoffTime=null; simTime=null;
      trendChartInited=false; trendChartKey='';
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache();
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null;
      renderChart(); rebuildTTable(); updateAccountUI();
    }
    function updateStrikes(){
      strikeSelect.removeEventListener('change', updateTypes);
      const expiry=expirySelect.value;

      // 從索引快速取得所有履約價
      const strikeSet = new Set();
      dataIndex.forEach((arr, k) => {
        if(k.startsWith(expiry + '|') && arr.length) strikeSet.add(k.split('|')[1]);
      });
      const strikes = Array.from(strikeSet).sort((a,b)=>parseFloat(a)-parseFloat(b));

      // 記住目前選的履約價，回測手動模式時保留
      const prevStrike = strikeSelect.value;

      strikeSelect.innerHTML=strikes.map(s=>`<option value="${s}">${s}</option>`).join('');

      // 回測中且已手動操作：若舊的履約價還存在就保留，不自動重選中間值
      let picked = '';
      if(cutoffTime && userManualMode && prevStrike && strikeSet.has(prevStrike)){
        picked = prevStrike; // 保留手動選的
      } else {
        // ✅ 修正：預設先挑「同時有 C / P」成交資料的履約價（避免你一打開只看到單邊）
        const callT = (typeAliases?.call ?? 'C');
        const putT  = (typeAliases?.put  ?? 'P');

        const strikesBoth = [];
        for(const s of strikes){
          const hasCall = dataIndex.has(keyOf(expiry, s, callT)) || dataIndex.has(keyOf(expiry, s, 'C'));
          const hasPut  = dataIndex.has(keyOf(expiry, s, putT)) || dataIndex.has(keyOf(expiry, s, 'P'));
          if(hasCall && hasPut) strikesBoth.push(s);
        }
        if(strikesBoth.length){
          picked = strikesBoth[Math.floor(strikesBoth.length/2)];
        }else{
          picked = strikes[Math.floor(strikes.length/2)] || strikes[0] || '';
        }
      }

      strikeSelect.value = picked;
      strikeSelect.addEventListener('change', ()=>{
        if(cutoffTime) userManualMode = true;
        updateTypes();
      });
      updateTypes();
    }
    function updateTypes(){
      const expiry=expirySelect.value, strike=strikeSelect.value;
      // 用索引快速判斷有哪些 type
      const set = new Set();
      const callT = (typeAliases?.call ?? 'C');
      const putT  = (typeAliases?.put  ?? 'P');
      if(dataIndex.has(keyOf(expiry, strike, callT))) set.add(callT);
      if(dataIndex.has(keyOf(expiry, strike, putT))) set.add(putT);
      // 也檢查 C/P 別名
      if(callT !== 'C' && dataIndex.has(keyOf(expiry, strike, 'C'))) set.add('C');
      if(putT !== 'P' && dataIndex.has(keyOf(expiry, strike, 'P'))) set.add('P');

      // ✅ 固定顯示 C / P（若該履約價缺一邊，就 disabled）
      const choices = [];
      if(callT) choices.push(callT);
      if(putT && putT!==callT) choices.push(putT);

      typeSelect.innerHTML = choices.map(t=>{
        const disabled = !set.has(t);
        const label = t; // 你要看到的就是 C / P（或資料原本的型態字）
        return `<option value="${t}" ${disabled?'disabled':''}>${label}${disabled?'（無成交）':''}</option>`;
      }).join('');

      const key=`${expiry}_${strike}`, remembered=lastTypeSelectionMap[key];
      // 先用記憶值；不行就選第一個「沒 disabled」的
      const canUseRemembered = choices.includes(remembered) && set.has(remembered);
      if(canUseRemembered){
        typeSelect.value = remembered;
      }else{
        const firstOk = choices.find(t=>set.has(t)) || choices[0] || '';
        typeSelect.value = firstOk;
      }

      renderChart(); highlightTSelected(); updateAccountUI();
    }
    expirySelect.addEventListener('change', onExpiryChange);
    strikeSelect.addEventListener('change', ()=>{
      if(cutoffTime) userManualMode = true; // 回測中手動改履約價 → 不再自動捲動
      updateTypes();
    });
    typeSelect.addEventListener('change', ()=>{
      const key=`${expirySelect.value}_${strikeSelect.value}`;
      lastTypeSelectionMap[key]=typeSelect.value;
      renderChart(); highlightTSelected(); updateAccountUI();
    });
    sessionSelect.addEventListener('change', ()=>{
      rebuildPlayTimes(); 
      stopPlayback(); 
      cutoffTime=null; simTime=null; 
      renderChart(); rebuildTTable(); updateAccountUI();
    });
    periodSelect.addEventListener('change', renderChart);
    chartTypeSelect.addEventListener('change', renderChart);
    // MA 勾選：事件委派（支援動態新增 / 套用）
    maBox.addEventListener('change', (e)=>{
      if(e.target && e.target.classList && e.target.classList.contains('maChk')){
        getMAColorMap(); // 同步色塊顏色
        taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache(); // MA 變更 → 強制全面重繪
        renderChart();
      }
    });

    // MA 自訂面板
    maCfgBtn.addEventListener('click', ()=>{
      maCfgPanel.style.display = (maCfgPanel.style.display==='none' || !maCfgPanel.style.display) ? 'inline-flex' : 'none';
    });
    maApplyBtn.addEventListener('click', ()=>{
      const periods = parseMAPeriods(maCustomInput.value);
      if(!periods.length) return alert('請輸入均線週期，例如：5,10,20,60');
      rebuildMABox(periods, new Set(periods)); // 預設全勾選（可再自行取消）
      maCfgPanel.style.display = 'inline-flex';
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache(); // MA 變更 → 強制全面重繪
      renderChart();
    });
    maResetBtn.addEventListener('click', ()=>{
      const def = [5,10,20,60];
      rebuildMABox(def, new Set([5,10,20]));
      maCustomInput.value = def.join(',');
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache(); // MA 變更 → 強制全面重繪
      renderChart();
    });

    // 初次同步色塊
    getMAColorMap();
document.getElementById('prevStrikeBtn').addEventListener('click', ()=>moveStrike(-1));
    document.getElementById('nextStrikeBtn').addEventListener('click', ()=>moveStrike(1));
    function moveStrike(offset){
      const options=Array.from(strikeSelect.options);
      const idx=options.findIndex(o=>o.value===strikeSelect.value);
      if(idx+offset>=0 && idx+offset<options.length){
        strikeSelect.value=options[idx+offset].value;
        if(cutoffTime) userManualMode = true; // 回測中按上下鍵移動 → 手動模式
        updateTypes(); highlightTSelected();
      }
    }

    // ====== Backtest 核心（K 線時間軸） ======
    window.rebuildPlayTimes = function rebuildPlayTimes(){
      const expiry=expirySelect.value;
      const tickSet = new Set();
      dataIndex.forEach((arr, k) => {
        if(!k.startsWith(expiry + '|')) return;
        for(const d of arr){
          if(withinSession(d.time)) tickSet.add(d.dtms);
        }
      });
      // 加入 TX 期貨時間點，確保回測軸涵蓋全天
      for(const d of txDataIndex){
        if(withinSession(d.time)) tickSet.add(d.dtms);
      }
      const uniq = Array.from(tickSet).sort((a,b)=>a-b).map(x=>new Date(x));
      playTimes=uniq;
      playIndex=0; simTime=null;
      btProgress.min=0; btProgress.max=Math.max(0, playTimes.length-1); btProgress.value=0;
      updateBtUI();
    }
    window.updateBtUI = function updateBtUI(){
      btInfo.textContent=`${playTimes.length?(playIndex+1):0} / ${playTimes.length}`;
      btClock.textContent=playTimes.length?fmtTime(playTimes[Math.min(playIndex,playTimes.length-1)]):'--:--:--';
      btStart.disabled=!playTimes.length||playing;
      btPause.disabled=!playing;
      btResume.disabled=playing||!playTimes.length||playIndex>=playTimes.length-1;
      btStop.disabled=!playTimes.length||(!playing && cutoffTime===null);
      btStep.disabled=playing||playIndex>=playTimes.length-1||!playTimes.length;
      btStepBack.disabled=playing||playIndex<=0||!playTimes.length;
      btProgress.disabled=playing||!playTimes.length;
      if(Number(riskEquityStop.value)>-999999){
        const eq=calcEquity();
        if(eq<=Number(riskEquityStop.value)){ btnBuy.disabled=true; btnSell.disabled=true; }
      }
      ltWorkingCnt.textContent = limits.filter(l=>l.status==='Working').length;
    }
    function setCutoffByIndex(i){
      playIndex=Math.max(0, Math.min(i, playTimes.length-1));
      cutoffTime=playTimes[playIndex]||null;
      simTime=cutoffTime?new Date(cutoffTime):null;
      // 同步圖表頁回測時間
      const _cc=document.getElementById('chartBtClock');
      if(_cc){ if(cutoffTime){_cc.textContent=fmtTime(cutoffTime);_cc.style.display='';} else{_cc.style.display='none';} }
      btProgress.value=playIndex;
      updateBtUI();
      renderChart(cutoffTime);
      rebuildTTable(cutoffTime);
      checkLimitOrders(cutoffTime);
      tickAutoOrders(cutoffTime); // 條件委託單自動下單
      updateGreeksCard(strikeSelect.value, cutoffTime); // ★ 回測步進同步 Greeks
      window._lastCutoff = cutoffTime;
      if(typeof window.updateVolatilityChart === 'function') window.updateVolatilityChart(cutoffTime); // ★ 同步振幅
      updateAccountUI();
      updateTXBar(cutoffTime);
    }
    function startPlayback(){
      if(!playTimes.length) return;
      playing=true; updateBtUI();
      userManualMode=false; // 每次開始回測時重置，讓 ATM 自動捲動先生效
      if(cutoffTime===null) setCutoffByIndex(0);
      const stepSec = Math.max(1, +btStepSec.value||1);
      const cps     = Math.max(1, +btCalcSpeed.value||1);
      const intervalMs = Math.round(1000 / cps);
      if(playTimer) clearInterval(playTimer);
      playTimer=setInterval(()=>{
        if(playIndex>=playTimes.length-1){ stopPlayback(); return; }
        const nextTarget = new Date(simTime.getTime() + stepSec*1000);
        let idx = playTimes.findIndex(dt => dt >= nextTarget);
        if (idx === -1) idx = playTimes.length-1;
        if (idx === playIndex) idx = Math.min(playIndex+1, playTimes.length-1);
        setCutoffByIndex(idx);
      }, intervalMs);
    }
    function pausePlayback(){ if(playTimer) clearInterval(playTimer); playTimer=null; playing=false; updateBtUI(); }
    function resumePlayback(){ if(!playing) startPlayback(); }
    function stopPlayback(){
      if(playTimer) clearInterval(playTimer); playTimer=null; playing=false;
      cutoffTime=null; simTime=null;
      const _sc=document.getElementById('chartBtClock'); if(_sc) _sc.style.display='none';
      userManualMode=false; // 停止回測後重置手動模式
      trendChartInited=false; trendChartKey=''; // 重置走勢圖狀態
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache(); // 重置 K 線圖狀態
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null; // 重置漲跌追蹤
      // 條件委託單：停止時自動平倉
      if(autoOrderActive){
        autoOrderActive = false;
        forceCloseAllAutoOrders('回測停止');
        s1Status.textContent='已停止（回測結束）';
        s1Status.className='s1-status stopped';
        bt20Run.style.display='';
        bt20Stop.style.display='none';
        renderAutoOrderTable();
        renderAutoOrderStats();
      }
      renderChart(); rebuildTTable(); updateBtUI(); updateAccountUI(); updateTXBar();
    }
    btStart.onclick=startPlayback;
    btPause.onclick=pausePlayback;
    btResume.onclick=resumePlayback;
    btStop.onclick=stopPlayback;
    btStep.onclick=()=> setCutoffByIndex(playIndex+1);
    btStepBack.onclick=()=> setCutoffByIndex(playIndex-1);
    btProgress.oninput=(e)=> setCutoffByIndex(+e.target.value);
    btJump.addEventListener('click', ()=>{
      if(!playTimes.length) return;
      const idx=findIndexByTimeStr(btSetTime.value);
      if(idx>=0){ pausePlayback(); setCutoffByIndex(idx); }
    });

    // ====== 市價下單 ======
    window.resetAccount = function resetAccount(){ account.cash=account.initCash; account.realized=0; account.positions.clear(); account.orders=[]; }
    function placeOrder(side){
      const qty=Math.max(1, Math.floor(Number(qtyInput.value)||1));
      const mult=Math.max(1, Number(multInput.value)||50);
      const fee =Math.max(0, Number(feeInput.value)||0);
      const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
      const key=keyOf(expiry,strike,type);
      const px=getLastPrice(expiry,strike,type,cutoffTime);
      if(px==null){ alert('尚無可成交價格'); return; }
      if(qty>Number(riskMaxQty.value)){ alert('超過單筆最大口數'); return; }
      if(Number(riskEquityStop.value)>-999999 && calcEquity()<=Number(riskEquityStop.value)){ alert('已觸發停損，禁止下單'); return; }

      const pos=account.positions.get(key)||{qty:0,avg:0,last:px,upnl:0};
      if(side==='SELL' && pos.qty-qty<0 && !allowShort.checked){
        if(pos.qty>0){
          const canSell=pos.qty; execute(key,'SELL',canSell,px,mult,fee);
          playSound('SellOK.WAV');
          alert('已全數平倉；未勾選允許放空，超出部分未成交');
        }else{ alert('目前無多單可平，且未勾選允許放空'); }
        updateAccountUI(); return;
      }
      execute(key,side,qty,px,mult,fee);
      playSound(side==='BUY'?'BuyOK.WAV':'SellOK.WAV');
      updateAccountUI();
    }
    btnBuy.addEventListener('click', ()=>placeOrder('BUY'));
    btnSell.addEventListener('click', ()=>placeOrder('SELL'));

    function execute(key,side,qty,px,mult,feePerLot){
      let pos=account.positions.get(key)||{qty:0,avg:0,last:px,upnl:0};
      let realizedNow=0;
      const gross=px*mult*qty;
      const fee=feePerLot*qty;

      if(side==='BUY'){
        account.cash-=(gross+fee);
        if(pos.qty<0){
          const cover=Math.min(qty,-pos.qty);
          realizedNow+=(pos.avg-px)*mult*cover;
          pos.qty+=cover;
          qty-=cover;
        }
        if(qty>0){
          const newQty=pos.qty+qty;
          pos.avg=(pos.avg*pos.qty + px*qty)/(newQty===0?1:newQty);
          pos.qty=newQty;
        }
      }else{
        if(pos.qty>0){
          const close=Math.min(qty,pos.qty);
          realizedNow+=(px-pos.avg)*mult*close;
          account.cash+=px*mult*close;
          qty-=close; pos.qty-=close;
          if(pos.qty===0) pos.avg=0;
        }
        if(qty>0){
          account.cash+=px*mult*qty;
          const newQty=pos.qty-qty;
          pos.avg=(Math.abs(pos.qty)*pos.avg + px*qty)/(Math.abs(newQty)===0?1:Math.abs(newQty));
          pos.qty=newQty;
        }
        account.cash-=fee;
      }
      account.realized+=realizedNow;
      pos.last=px;
      account.positions.set(key,pos);
      account.orders.push({ time: cutoffTime?new Date(cutoffTime):(playTimes[playIndex]||new Date()), key, side, qty, price:px, fee, realized:realizedNow });
    }

    // ====== 委託（限價單） ======
    window.ltSeq = 1;
    btnPlaceLimit.addEventListener('click', ()=>{
      const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
      if(!expiry||!strike||!type){ alert('請先選商品'); return; }
      const key=keyOf(expiry,strike,type);
      const side=ltSide.value;
      const price=Number(ltPrice.value);
      const qty=Math.max(1, Math.floor(Number(ltQty.value)||1));
      if(!isFinite(price)||price<=0){ alert('請輸入有效的權利點（限價）'); return; }
      if(qty>Number(riskMaxQty.value)){ alert('超過單筆最大口數'); return; }
      const now=cutoffTime?new Date(cutoffTime):new Date();
      limits.push({ id: ltSeq++, key, side, price, qty, status:'Working', created: now, filledTime:null, fillPrice:null });
      playSound('OrderBuyOK.WAV');
      renderLimitTable(); updateBtUI();
    });

    function renderLimitTable(){
      ltTable.innerHTML='';
      limits.slice(-400).reverse().forEach(l=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`
          <td class="center">${(l.filledTime||l.created).toLocaleString()}</td>
          <td class="center">${l.key}</td>
          <td>${l.side}</td>
          <td>${fmtNum(l.price,1)}</td>
          <td>${l.qty}</td>
          <td>${l.status}${l.fillPrice!=null?` @${fmtNum(l.fillPrice,1)}`:''}</td>
          <td>${l.status==='Working'?`<button data-id="${l.id}" class="lt-cancel">取消</button>`:''}</td>
        `;
        ltTable.appendChild(tr);
      });
      ltTable.querySelectorAll('.lt-cancel').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const id=Number(btn.getAttribute('data-id'));
          const o=limits.find(x=>x.id===id);
          if(o && o.status==='Working'){ o.status='Canceled'; renderLimitTable(); updateBtUI(); }
        });
      });
      ltWorkingCnt.textContent = limits.filter(l=>l.status==='Working').length;
    }

    window.checkLimitOrders = function checkLimitOrders(cutoff){
      if(!cutoff) return;
      limits.forEach(l=>{
        if(l.status!=='Working') return;
        const [e,s,t]=l.key.split('|');
        const px=getLastPrice(e,s,t,cutoff);
        if(px==null) return;
        const buyHit  = (l.side==='BUY'  && px <= l.price);
        const sellHit = (l.side==='SELL' && px >= l.price);
        if(buyHit || sellHit){
          if(l.side==='SELL'){
            const pos=account.positions.get(l.key)||{qty:0};
            if(pos.qty - l.qty < 0 && !allowShort.checked){
              return;
            }
          }
          if(Number(riskEquityStop.value)>-999999 && calcEquity()<=Number(riskEquityStop.value)){
            return;
          }
          const mult=Math.max(1, Number(multInput.value)||50);
          const fee =Math.max(0, Number(feeInput.value)||0);
          execute(l.key, l.side, l.qty, px, mult, fee);
          l.status='Filled'; l.filledTime=new Date(cutoff); l.fillPrice=px;
        }
      });
      renderLimitTable();
    }

    // ====== 帳務 UI ======
    window.updateAccountUI = function updateAccountUI(){
      const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
      const key=keyOf(expiry,strike,type);
      symNow.textContent=key||'-';
      const px=getLastPrice(expiry,strike,type,cutoffTime);
      lastPx.textContent=px==null?'-':px;

      let totalUPnL=0;
      account.positions.forEach((p,k)=>{
        const [e,s,t]=k.split('|');
        const last=getLastPrice(e,s,t,cutoffTime);
        if(last!=null){
          p.last=last;
          const mult=Math.max(1, Number(multInput.value)||50);
          const sign=Math.sign(p.qty);
          const diff=(sign>=0)?(last-p.avg):(p.avg-last);
          p.upnl=diff*mult*Math.abs(p.qty);
        }else{ p.upnl=0; }
        totalUPnL+=p.upnl;
      });

      const eq=calcEquity(totalUPnL);
      uPnL.textContent=fmtNum(totalUPnL);
      rPnL.textContent=fmtNum(account.realized);
      equity.textContent=fmtNum(eq);

      cash0.textContent=fmtNum(account.initCash);
      cash.textContent=fmtNum(account.cash);
      rPnL2.textContent=fmtNum(account.realized);
      uPnL2.textContent=fmtNum(totalUPnL);
      equity2.textContent=fmtNum(eq);

      // ★ 計算已使用成本（所有多單的成本 = 均價 × 口數 × 乘數）
        let usedCostVal = 0;
        const multVal = Math.max(1, Number(multInput.value) || 50);

        account.positions.forEach((p) => {
          if (p.qty > 0) { // 只算多單
            usedCostVal += p.avg * p.qty * multVal;
          }
        });

usedCost.textContent = fmtNum(usedCostVal);


      posTable.innerHTML='';
      // 使用 innerHTML 批次寫入，避免逐行 createElement
      const posHtml = [];
      account.positions.forEach((p,k)=>{
        if(p.qty===0) return;
        const cls=p.upnl>=0?'red':'green';
        posHtml.push(`<tr>
          <td class="center">${k}</td>
          <td>${p.qty}</td>
          <td>${fmtNum(p.avg)}</td>
          <td>${p.last==null?'-':fmtNum(p.last)}</td>
          <td class="${cls}">${fmtNum(p.upnl)}</td></tr>`);
      });
      posTable.innerHTML = posHtml.join('');

      // 成交紀錄也用批次 innerHTML
      const ordHtml = [];
      account.orders.slice(-200).forEach(o=>{
        const cls=(o.realized||0)>=0?'red':'green';
        ordHtml.push(`<tr>
          <td class="center">${o.time.toLocaleString()}</td>
          <td class="center">${o.key}</td>
          <td>${o.side}</td>
          <td>${o.qty}</td>
          <td>${fmtNum(o.price)}</td>
          <td>${fmtNum(o.fee)}</td>
          <td class="${cls}">${fmtNum(o.realized)}</td></tr>`);
      });
      ordTable.innerHTML = ordHtml.join('');

      if(Number(riskEquityStop.value)>-999999 && eq<=Number(riskEquityStop.value)){
        btnBuy.disabled=true; btnSell.disabled=true;
      }else{ btnBuy.disabled=false; btnSell.disabled=false; }
    }
    window._calcEquity = function calcEquity(preUPnL){
      let u=(typeof preUPnL==='number')?preUPnL:0;
      if(preUPnL==null){ account.positions.forEach(p=>{ u+=(p.upnl||0); }); }
      return account.cash + u;
    }

    // ====== T 表 ======
    // ★ dirty flag：記住上次參數，沒變就跳過重建
    window._ttLastExpiry = null; window._ttLastCutMs = -1; window._ttLastSess = null;

    window.rebuildTTable = function rebuildTTable(cutoff=null){
      const expiry=expirySelect.value;
      if(!expiry){ tBody.innerHTML=''; _ttLastExpiry=null; return; }
      const callStr=typeAliases.call, putStr=typeAliases.put;
      const cutMs = cutoff ? +cutoff : Infinity;
      const sess = sessionSelect.value;

      // ★ 若 expiry / cutMs / session 都沒變，直接跳過（最常見的情況）
      if(expiry === _ttLastExpiry && cutMs === _ttLastCutMs && sess === _ttLastSess) return;
      _ttLastExpiry = expiry; _ttLastCutMs = cutMs; _ttLastSess = sess;

      // 用索引快速聚合：只遍歷當月的 key
      const map=new Map();
      const strikesSet = new Set();
      dataIndex.forEach((arr, k) => {
        const parts = k.split('|');
        if(parts[0] !== expiry) return;
        const strike = parts[1];
        const type = parts[2];
        const mapKey = `${strike}|${type}`;
        let o = null;
        for(const r of arr){
          if(r.dtms > cutMs) break; // arr 已按 dtms 排序，超過就停
          if(sess !== '全部' && !withinSession(r.time)) continue;
          strikesSet.add(strike);
          const vol = r.volume || 0;
          if(!o){
            o = {last:r.price, lastDtms:r.dtms, vol:vol, vwap_num:r.price*vol};
          } else {
            o.vol += vol;
            o.vwap_num += r.price * vol;
            if(r.dtms >= o.lastDtms){
              o.last = r.price;
              o.lastDtms = r.dtms;
            }
          }
        }
        if(o) map.set(mapKey, o);
      });

      const strikes=Array.from(strikesSet).sort((a,b)=>parseFloat(a)-parseFloat(b));
      const rows=[];
      for(const s of strikes){
        const c=map.get(`${s}|${callStr}`);
        const p=map.get(`${s}|${putStr}`);
        const cAvg=c&&c.vol?(c.vwap_num/c.vol):null;
        const pAvg=p&&p.vol?(p.vwap_num/p.vol):null;
        rows.push({ strike:s, cPrice:c?.last, cAvg, cVol:c?.vol, pPrice:p?.last, pAvg, pVol:p?.vol });
      }

      // === ATM 判斷 ===
      // 優先：txRawData 有資料時，用 TX 期貨現價找最近履約價（邏輯與 updateTXBar 一致）
      // 備用：從 TXO 資料以 put-call parity 推算（|cPrice - pPrice| 最小的履約價）
      let atmStrike = null;
      {
        let txLastPx = null;
        if(txDataIndex.length){
          const currentExpiry = (expirySelect.value||'').replace(/\s/g,'');
          const cutMs = cutoff ? +cutoff : Infinity;

          // 篩出 cutoff 以前且在交易時段的資料（同 updateTXBar 邏輯）
          let pool = [];
          for(const d of txDataIndex){
            if(d.dtms > cutMs) break;
            if(withinSession(d.time)) pool.push(d);
          }

          // 優先篩當月合約，無則同年月，再無則下一個到期月，最後用全部
          if(currentExpiry && pool.length){
            const same = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === currentExpiry);
            if(same.length){
              pool = same;
            } else {
              const ym = currentExpiry.slice(0,6);
              const sameYM = pool.filter(d => (d.expiry||'').slice(0,6) === ym);
              if(sameYM.length){
                pool = sameYM;
              } else {
                const allExpiries = [...new Set(pool.map(d => (d.expiry||'').replace(/\s/g,'')))].sort();
                const nextExpiry = allExpiries.find(e => e > currentExpiry);
                if(nextExpiry) pool = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === nextExpiry);
              }
            }
          }

          if(pool.length) txLastPx = pool[pool.length - 1].price;
        }

        if(txLastPx != null){
          // 用 TX 現價找最近履約價
          let minDiff = Infinity;
          for(const r of rows){
            const diff = Math.abs(parseFloat(r.strike) - txLastPx);
            if(diff < minDiff){ minDiff = diff; atmStrike = r.strike; }
          }
        } else {
          // fallback：put-call parity — C 和 P 價差最小的履約價
          let minDiff = Infinity;
          for(const r of rows){
            if(r.cPrice != null && r.pPrice != null){
              const diff = Math.abs(r.cPrice - r.pPrice);
              if(diff < minDiff){ minDiff = diff; atmStrike = r.strike; }
            }
          }
        }
      }

      // === 20 點標示（保留）：C/P 各自權利金最接近 20 的履約價 ===
      const NEAR20_TARGET = 20;
      const NEAR20_MAX_ABS = 5;
      let near20C = null, near20P = null;
      for(const r of rows){
        if(r.cPrice != null && isFinite(r.cPrice)){
          const d = Math.abs(r.cPrice - NEAR20_TARGET);
          if(d <= NEAR20_MAX_ABS && (!near20C || d < near20C.d)) near20C = {strike:r.strike, d};
        }
        if(r.pPrice != null && isFinite(r.pPrice)){
          const d = Math.abs(r.pPrice - NEAR20_TARGET);
          if(d <= NEAR20_MAX_ABS && (!near20P || d < near20P.d)) near20P = {strike:r.strike, d};
        }
      }

      // === 計算漲跌（與上一次 T 表價格比較） ===
      const newPrices = new Map();
      for(const r of rows){
        if(r.cPrice != null) newPrices.set(`${r.strike}|C`, r.cPrice);
        if(r.pPrice != null) newPrices.set(`${r.strike}|P`, r.pPrice);
      }

      for(const r of rows){
        r._atm   = (atmStrike != null && r.strike == atmStrike);
        r._n20c  = !!(near20C && r.strike == near20C.strike);
        r._n20p  = !!(near20P && r.strike == near20P.strike);
        r._spread = (r.cPrice != null && r.pPrice != null && Math.abs(r.cPrice - r.pPrice) <= 10);
        // 漲跌 = 現價 - 上次價
        const prevC = prevTTablePrices.get(`${r.strike}|C`);
        const prevP = prevTTablePrices.get(`${r.strike}|P`);
        r.cChg = (r.cPrice != null && prevC != null) ? +(r.cPrice - prevC).toFixed(1) : null;
        r.pChg = (r.pPrice != null && prevP != null) ? +(r.pPrice - prevP).toFixed(1) : null;
      }
      // 儲存本次價格供下次比較
      prevTTablePrices = newPrices;

      function chgHtml(v){
        if(v == null || !isFinite(v)) return '<span style="color:#999">—</span>';
        if(v > 0) return `<span class="red">+${v}</span>`;
        if(v < 0) return `<span class="green">${v}</span>`;
        return '<span style="color:#999">0</span>';
      }

      tBody.innerHTML=rows.map(r=>{
        const rowCls = [r._atm?'n20-row-both':'', r._n20c&&r._n20p&&!r._atm?'n20-row-both':'', r._spread?'spread-alert':''].filter(Boolean).join(' ');
        const tags = [
          r._atm  ? '<span class="tag tag-atm">ATM</span>' : '',
          r._n20c ? '<span class="tag tag-n20c">C≈20</span>' : '',
          r._n20p ? '<span class="tag tag-n20p">P≈20</span>' : ''
        ].join('');
        const c01 = (r.cPrice != null && Math.abs(r.cPrice - 0.1) < 0.0001) ? ' price-01' : '';
        const p01 = (r.pPrice != null && Math.abs(r.pPrice - 0.1) < 0.0001) ? ' price-01' : '';
        return `
        <tr data-strike="${r.strike}" class="${rowCls}">
          <td>${numberOrDash(r.cVol)}</td>
          <td>${chgHtml(r.cChg)}</td>
          <td class="td-c side-call ${r._n20c?'n20c':''}${c01}" data-side="C" data-strike="${r.strike}">${numberOrDash(r.cPrice)}</td>
          <td class="center strike td-strike" data-strike="${r.strike}">${r.strike}${tags}</td>
          <td class="td-p side-put ${r._n20p?'n20p':''}${p01}" data-side="P" data-strike="${r.strike}">${numberOrDash(r.pPrice)}</td>
          <td>${chgHtml(r.pChg)}</td>
          <td>${numberOrDash(r.pVol)}</td>
        </tr>`;
      }).join('');

      // 事件委派已移至 tBody 上層（只綁一次），不再每次 rebuild 重綁
      highlightTSelected();

      // === 回測時自動捲到 ATM 為中心（使用者手動操作後不再自動移動）===
      if(cutoff && atmStrike != null && !userManualMode){
        const atmRow = tBody.querySelector(`tr[data-strike="${atmStrike}"]`);
        if(atmRow){
          const container = tBody.closest('.tbody');
          if(container){
            const rowTop = atmRow.offsetTop;
            const containerH = container.clientHeight;
            const rowH = atmRow.offsetHeight;
            container.scrollTop = rowTop - (containerH / 2) + (rowH / 2);
          }
        }
      }
    }
    let _prevSelTR = null; // 快取上次選取的 TR
    function highlightTSelected(){
      const strike=strikeSelect.value;
      if(_prevSelTR) _prevSelTR.classList.remove('sel');
      const tr=tBody.querySelector(`tr[data-strike="${strike}"]`);
      if(tr) tr.classList.add('sel');
      _prevSelTR = tr;
    }
    // ====== 均線（MA） ======
    window._calcMA = function calcMA(period, values){
      const out = new Array(values.length).fill(null);
      let sum = 0;
      for(let i=0;i<values.length;i++){
        const v = Number(values[i]);
        if(!Number.isFinite(v)){ out[i]=null; continue; }
        sum += v;
        if(i>=period){
          const drop = Number(values[i-period]);
          if(Number.isFinite(drop)) sum -= drop;
        }
        if(i>=period-1) out[i] = +(sum/period).toFixed(3);
      }
      return out;
    }
    window._getMAPeriods = function getMAPeriods(){
      return getMAAllChecks()
        .filter(c=>c && c.checked)
        .map(c=>parseInt(c.value,10))
        .filter(n=>Number.isFinite(n) && n>0);
    }



    // ====== 圖表（TXO K線 — LWC v5）======

    // ── LWC TA 圖初始化（全面重繪時呼叫）
    let _taPriceLines = [];
    function _taInit(){
      if(_taChart){ _taChart.remove(); _taChart=null; _taCandle=null; _taVolume=null; _taMaSeries={}; _taMarkers=null; _taPriceLines=[]; }
      const dark = isDark;
      _taChart = LightweightCharts.createChart(_taContainer, {
        autoSize: true,
        layout: {
          background: { color: dark ? '#111' : '#fff' },
          textColor:  dark ? '#ccc' : '#333',
        },
        grid: {
          vertLines: { color: dark ? '#2a2a2a' : '#f0f0f0' },
          horzLines: { color: dark ? '#2a2a2a' : '#f0f0f0' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        leftPriceScale:  { visible: false, borderColor: dark ? '#444' : '#ccc' },
        rightPriceScale: { visible: true,  borderColor: dark ? '#444' : '#ccc' },
        timeScale: {
          borderColor:    dark ? '#444' : '#ccc',
          timeVisible:    true,
          secondsVisible: false,
          rightOffset:    5,
          fixLeftEdge:    true,
          fixRightEdge:   false,
          tickMarkFormatter: (t) => {
            const d = new Date((t + 28800) * 1000);
            const hh = String(d.getUTCHours()).padStart(2,'0');
            const mm = String(d.getUTCMinutes()).padStart(2,'0');
            return `${hh}:${mm}`;
          },
        },
        localization: {
          timeFormatter: (t) => {
            const d = new Date((t + 28800) * 1000);
            const mo = d.getUTCMonth()+1, day = d.getUTCDate();
            const hh = String(d.getUTCHours()).padStart(2,'0');
            const mm = String(d.getUTCMinutes()).padStart(2,'0');
            return mo+'/'+day+' '+hh+':'+mm;
          },
        },
        attributionLogo: false,
      });

      // ── K線 series（主 price scale，佔上方 70%）
      _taCandle = _taChart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor:         dark ? '#ef5350' : '#d00000',
        downColor:       dark ? '#26a69a' : '#2ca02c',
        borderUpColor:   dark ? '#ef5350' : '#d00000',
        borderDownColor: dark ? '#26a69a' : '#2ca02c',
        wickUpColor:     dark ? '#ef5350' : '#d00000',
        wickDownColor:   dark ? '#26a69a' : '#2ca02c',
      });
      _taCandle.applyOptions({ priceScaleId: 'right' });
      _taCandle.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });

      // ── 成交量 series（獨立 price scale，佔下方 20%）
      _taVolume = _taChart.addSeries(LightweightCharts.HistogramSeries, {
        color:        dark ? '#8884d8' : '#4682b4',
        priceFormat:  { type: 'volume' },
        priceScaleId: 'vol',
      });
      _taVolume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      // autoSize:true 時 LWC 自動處理 resize，不需要額外 ResizeObserver
    }

    function renderTA(cutoff=null){
      const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
      const session=sessionSelect.value, period=parseInt(periodSelect.value);
      const chartType=chartTypeSelect.value;

      const newTAKey = `${expiry}|${strike}|${type}|${session}|${period}|${chartType}|${isDark}`;
      const needFullRedraw = (newTAKey !== taChartKey) || !taChartInited;
      if(needFullRedraw){
        _taInit();
        taChartKey = newTAKey;
        taChartInited = false;
      }

      if(!expiry||!strike||!type){ kinfo.innerText='請選擇檔案與條件'; return; }

      // ── 資料聚合
      const k = keyOf(expiry, strike, type);
      const indexArr = dataIndex.get(k) || [];
      const cutMs = cutoff ? +cutoff : Infinity;
      const data = [];
      for(const d of indexArr){
        if(d.dtms > cutMs) break;
        if(withinSession(d.time)) data.push(d);
      }

      const grouped={};
      for(const d of data){
        const bucket = Math.floor(d.dtms / (60000*period)) * (60000*period);
        const key = String(bucket);
        if(!grouped[key]) grouped[key]={open:d.price,high:d.price,low:d.price,close:d.price,volume:d.volume};
        else{
          const g=grouped[key];
          g.high=Math.max(g.high,d.price);
          g.low=Math.min(g.low,d.price);
          g.close=d.price;
          g.volume+=d.volume;
        }
      }

      // 數字排序（Object.keys 預設字典序，毫秒 timestamp 長度不一致時會出錯）
      const timeKeys = Object.keys(grouped).sort((a,b) => +a - +b);
      // LWC 需要 unix timestamp（秒），去除重複（同秒合併取最後一筆）
      const seenSec = new Set();
      const lwcCandles = [];
      const lwcVolumes = [];
      for(const k of timeKeys){
        const sec = Math.floor(+k / 1000); // floor 避免相鄰 bucket 四捨五入到同一秒
        if(seenSec.has(sec)) continue;
        seenSec.add(sec);
        const g = grouped[k];
        const isUp = g.close >= g.open;
        lwcCandles.push({ time: sec, open:g.open, high:g.high, low:g.low, close:g.close });
        lwcVolumes.push({ time: sec, value: g.volume,
          color: isUp ? (isDark?'rgba(239,83,80,.5)':'rgba(208,0,0,.4)')
                      : (isDark?'rgba(38,166,154,.5)':'rgba(44,160,44,.4)') });
      }

      // ── MA 計算
      const closeArr = lwcCandles.map(c=>c.close);
      const maPeriods = getMAPeriods();
      const maMap = {};
      maPeriods.forEach(p=>{ maMap[p] = calcMA(p, closeArr); });
      const maColorMap = getMAColorMap();

      // ── 更新 fixedTooltip（最後一根 K 棒）
      const buildMAHtml = (idx) => {
        if(!maPeriods.length) return '';
        return maPeriods.map(p=>{
          const v = maMap[p]?.[idx];
          const s = (v==null||!Number.isFinite(v)) ? '-' : v;
          const c = maColorMap?.[p] || '';
          return `<span style="color:${c}">MA${p}：${s}</span>`;
        }).join('');
      };
      if(lwcCandles.length){
        const last = lwcCandles[lwcCandles.length-1];
        const lastVol = lwcVolumes[lwcVolumes.length-1].value;
        const colorClass = last.close >= last.open ? 'red' : 'green';
        const ts = new Date(last.time*1000);
        fixedTooltip.innerHTML = `<span>🕒 ${ts.toLocaleString()}</span>
          <span class="${colorClass}">開：${last.open}</span><span>高：${last.high}</span>
          <span>低：${last.low}</span><span class="${colorClass}">收：${last.close}</span>
          <span>量：${lastVol}</span>${buildMAHtml(lwcCandles.length-1)}`;
        fixedTooltip.style.display='block';
      } else {
        fixedTooltip.style.display='none';
      }

      if(!_taChart || !_taCandle) return;

      // ── 設定資料
      if(chartType === 'candlestick'){
        _taCandle.setData(lwcCandles);
      } else {
        // 折線圖模式：用 LineSeries 覆蓋（簡化：直接重設為 close line）
        _taCandle.setData(lwcCandles); // 仍用 candlestick data，外觀由 series type 決定
      }
      _taVolume.setData(lwcVolumes);

      // 時間軸定位：
      // - 無回測（cutoff=null）→ fitContent 讓所有K棒填滿
      // - 有回測 → 保持最新K棒在畫面右側（scrollToPosition）
      if(!cutoff){
        // 非回測：全部填滿
        _taChart.timeScale().fitContent();
      } else {
        if(needFullRedraw){
          // 全面重繪：先 fitContent，再把最後一根捲到右側留 5 根空間
          _taChart.timeScale().fitContent();
        }
        // 回測模式：確保最新那根 K 棒在右側
        if(lwcCandles.length){
          const lastTime = lwcCandles[lwcCandles.length - 1].time;
          _taChart.timeScale().setVisibleRange({
            from: lwcCandles[Math.max(0, lwcCandles.length - 60)].time,
            to:   lastTime + (parseInt(periodSelect.value)||5) * 60 * 6,
          });
        }
      }

      // ── MA series（同步增刪）
      const activeMA = new Set(maPeriods);
      // 移除不再需要的
      Object.keys(_taMaSeries).forEach(p=>{
        if(!activeMA.has(+p)){
          _taChart.removeSeries(_taMaSeries[p]);
          delete _taMaSeries[p];
        }
      });
      // 新增或更新
      maPeriods.forEach(p=>{
        // LWC 要求所有 series 時間點相同：null 值用 whitespace point { time } 佔位
        const maData = (maMap[p]||[]).map((v,i)=>{
          const t = lwcCandles[i].time;
          if(v==null || !Number.isFinite(v)) return { time: t }; // whitespace
          return { time: t, value: v };
        });

        if(!_taMaSeries[p]){
          _taMaSeries[p] = _taChart.addSeries(LightweightCharts.LineSeries, {
            color:       maColorMap?.[p] || '#f1c40f',
            lineWidth:   1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
        }
        _taMaSeries[p].setData(maData);
      });

      // ── 價格標記線（開盤/最高/次高/次低/最低）— 先清除舊的再建新的
      _taPriceLines.forEach(pl => { try{ _taCandle.removePriceLine(pl); }catch(_){} });
      _taPriceLines = [];
      if(lwcCandles.length && _taCandle){
        const openPriceLine = lwcCandles[0].open;
        const allHighSorted = lwcCandles.map(c=>c.high).sort((a,b)=>b-a);
        const allLowSorted  = lwcCandles.map(c=>c.low).sort((a,b)=>a-b);
        const high1 = allHighSorted[0];
        const high2 = allHighSorted.find(v => v < high1) ?? null;
        const low1  = allLowSorted[0];
        const low2  = allLowSorted.find(v => v > low1) ?? null;
        const plDefs = [
          { price: openPriceLine, color:'#facc15', lineWidth:3, lineStyle:LightweightCharts.LineStyle.Solid,  axisLabelVisible:true, title:'開盤' },
          { price: high1,         color:'#ff5722', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Solid,  axisLabelVisible:true, title:'最高' },
          ...(high2 != null ? [{ price: high2, color:'#ffa726', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, axisLabelVisible:true, title:'次高' }] : []),
          ...(low2  != null ? [{ price: low2,  color:'#22d3ee', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Dashed, axisLabelVisible:true, title:'次低' }] : []),
          { price: low1,          color:'#00cc55', lineWidth:1, lineStyle:LightweightCharts.LineStyle.Solid,  axisLabelVisible:true, title:'最低' },
        ];
        plDefs.forEach(pl => _taPriceLines.push(_taCandle.createPriceLine(pl)));
      }

      // ── 全盤：日夜盤分隔標記（08:45 / 15:00 轉換點）
      if(_taMarkers){ try{ _taMarkers.setMarkers([]); }catch(_){} }
      if(session==='全部' && lwcCandles.length>1 && LightweightCharts.createSeriesMarkers){
        const _sm=[];
        for(let i=1;i<lwcCandles.length;i++){
          const ph=new Date(lwcCandles[i-1].time*1000).getHours()*100+new Date(lwcCandles[i-1].time*1000).getMinutes();
          const ch=new Date(lwcCandles[i].time*1000).getHours()*100+new Date(lwcCandles[i].time*1000).getMinutes();
          if(ph<845&&ch>=845)   _sm.push({time:lwcCandles[i].time,position:'belowBar',color:'rgba(250,215,80,.4)',shape:'circle',text:'日',size:0.5});
          if(ph<1500&&ch>=1500) _sm.push({time:lwcCandles[i].time,position:'belowBar',color:'rgba(140,155,255,.4)',shape:'circle',text:'夜',size:0.5});
        }
        if(!_taMarkers) _taMarkers=LightweightCharts.createSeriesMarkers(_taCandle,[]);
        _taMarkers.setMarkers(_sm);
      }

      // ── Crosshair tooltip（LWC 事件驅動）
      if(needFullRedraw){
        _taChart.subscribeCrosshairMove(param => {
          if(!param.time || !_taCandle) { return; }
          let c, v;
          try {
            c = param.seriesData.get(_taCandle);
            v = param.seriesData.get(_taVolume);
          } catch(e){ return; }
          if(!c) return;
          const colorClass = c.close >= c.open ? 'red' : 'green';
          const ts = new Date(param.time * 1000);
          // MA 值
          let maHtml = '';
          maPeriods.forEach(p=>{
            const series = _taMaSeries[p];
            if(!series) return;
            try {
              const mv = param.seriesData.get(series);
              const s = mv ? mv.value.toFixed(1) : '-';
              const col = maColorMap?.[p] || '';
              maHtml += `<span style="color:${col}">MA${p}：${s}</span>`;
            } catch(e){}
          });
          fixedTooltip.innerHTML = `<span>🕒 ${ts.toLocaleString()}</span>
            <span class="${colorClass}">開：${c.open}</span><span>高：${c.high}</span>
            <span>低：${c.low}</span><span class="${colorClass}">收：${c.close}</span>
            <span>量：${v ? v.value : '-'}</span>${maHtml}`;
          fixedTooltip.style.display = 'block';
        });
      }

      taChartInited = true;
      kinfo.innerText = `${period}分｜${expiry}｜${strike}｜${session}${cutoff?`｜回測到 ${cutoff.toLocaleString()}`:''}`;
    }



// ====== TX 期貨 K 線圖（Lightweight Charts 增量版）======

// LWC 實例
let _lwcChart    = null;  // Lightweight Charts 主圖
let _lwcCandle   = null;  // 蠟燭 series
let _lwcVolume   = null;  // 成交量 series
let _lwcMaSeries = {};    // MA series map { period: series }

// 增量快取
const _txC = {
  key:        '',
  mainExpiry: null,
  grouped:    {},    // { bucketSec(秒): {open,high,low,close,volume,time} }
  nextIdx:    0,
  lastCutMs:  -1,
  priceLines: [],
};

function _txBinSearch(target){
  let lo=0, hi=txDataIndex.length-1, ans=txDataIndex.length;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(txDataIndex[mid].dtms>=target){ans=mid;hi=mid-1;}else lo=mid+1; }
  return ans;
}

function _txClearCache(){
  if(_txC.priceLines) _txC.priceLines.forEach(pl=>{ try{ _lwcCandle && _lwcCandle.removePriceLine(pl); }catch(_){} });
  _txC.key=''; _txC.mainExpiry=null; _txC.grouped={};
  _txC.nextIdx=0; _txC.lastCutMs=-1; _txC.priceLines=[];
}

function _txAppendTick(d, periodMs){
  if((d.product||'').toUpperCase()!=='TX') return;
  if(!withinSession(d.time)) return;
  if((d.expiry||'').replace(/\s/g,'')!==_txC.mainExpiry) return;
  // 時區修正：本地時間對齊到整週期邊界，避免 LWC 顯示時差 8 小時
  const tzOffsetSec = new Date().getTimezoneOffset() * -60; // 台灣 UTC+8 = +28800
  const bucketSec = Math.floor(d.dtms / periodMs) * (periodMs / 1000);
  const timeSec   = bucketSec + tzOffsetSec; // LWC 把 time 當 UTC 顯示，加上偏移讓 X 軸顯示台灣時間
  const g = _txC.grouped;
  if(!g[bucketSec]){
    g[bucketSec]={time:timeSec, open:d.price, high:d.price, low:d.price, close:d.price, volume:d.volume||0};
  } else {
    g[bucketSec].high  = Math.max(g[bucketSec].high, d.price);
    g[bucketSec].low   = Math.min(g[bucketSec].low,  d.price);
    g[bucketSec].close = d.price;
    g[bucketSec].volume += (d.volume||0);
  }
}

function _lwcInit(){
  const container = document.getElementById('chartTX');
  if(!container) return;
  const dark = isDark;
  _lwcChart = LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background:{ color: dark?'#111':'#fff' }, textColor: dark?'#ccc':'#333' },
    grid:   { vertLines:{ color: dark?'#2a2a2a':'#f0f0f0' }, horzLines:{ color: dark?'#2a2a2a':'#f0f0f0' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: dark?'#444':'#ccc' },
    timeScale: {
      borderColor: dark?'#444':'#ccc', timeVisible:true, secondsVisible:false,
      tickMarkFormatter: (t) => {
        const d = new Date(t * 1000);
        const hh = String(d.getUTCHours()).padStart(2,'0');
        const mm = String(d.getUTCMinutes()).padStart(2,'0');
        return `${hh}:${mm}`;
      },
    },
    localization: {
      timeFormatter: (t) => {
        const d = new Date(t * 1000);
        const mo = d.getUTCMonth()+1, day = d.getUTCDate();
        const hh = String(d.getUTCHours()).padStart(2,'0');
        const mm = String(d.getUTCMinutes()).padStart(2,'0');
        return mo+'/'+day+' '+hh+':'+mm;
      },
    },
    attributionLogo: false,
  });

  _lwcCandle = _lwcChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor:         dark ? '#ef5350' : '#d00000',
    downColor:       dark ? '#26a69a' : '#2ca02c',
    borderUpColor:   dark ? '#ef5350' : '#d00000',
    borderDownColor: dark ? '#26a69a' : '#2ca02c',
    wickUpColor:     dark ? '#ef5350' : '#d00000',
    wickDownColor:   dark ? '#26a69a' : '#2ca02c',
  });
  _lwcCandle.priceScale().applyOptions({ scaleMargins:{ top:0.05, bottom:0.25 } });

  _lwcVolume = _lwcChart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type:'volume' },
    priceScaleId: 'txvol',
    color: dark ? '#8884d8' : '#4682b4',
  });
  _lwcVolume.priceScale().applyOptions({ scaleMargins:{ top:0.8, bottom:0 } });

  // 十字線移動時更新 TX 專屬提示框
  _lwcChart.subscribeCrosshairMove(param => {
    const tip = document.getElementById('txTooltip');
    if(!tip) return;
    if(!param.time || !_lwcCandle) { tip.style.display='none'; return; }
    let c, v;
    try { c = param.seriesData.get(_lwcCandle); v = param.seriesData.get(_lwcVolume); } catch(e) { return; }
    if(!c) { tip.style.display='none'; return; }
    const cc = c.close >= c.open ? '#f87171' : '#4ade80';
    const t = new Date(param.time * 1000);
    const tStr = (t.getUTCMonth()+1) + '/' + t.getUTCDate() + ' ' + String(t.getUTCHours()).padStart(2,'0') + ':' + String(t.getUTCMinutes()).padStart(2,'0');
    tip.style.display = 'inline-block';
    tip.innerHTML = '🕒 ' + tStr +
      ' &nbsp;開：<span style="color:' + cc + '">' + c.open + '</span>' +
      ' &nbsp;高：' + c.high +
      ' &nbsp;低：' + c.low +
      ' &nbsp;收：<span style="color:' + cc + '">' + c.close + '</span>' +
      ' &nbsp;量：' + (v ? v.value : '-');
  });

  // resize
  // autoSize:true，不需要 ResizeObserver
}

function _lwcDestroy(){
  if(_lwcChart){ _lwcChart.remove(); _lwcChart=null; _lwcCandle=null; _lwcVolume=null; _lwcMaSeries={}; }
}

function _lwcShowHide(show){
  const txEl = document.getElementById('chartTX');
  const taEl = document.getElementById('chartTA');
  if(!txEl || !taEl) return;
  if(show){
    txEl.style.visibility='visible'; txEl.style.pointerEvents='auto';
    taEl.style.visibility='hidden';  taEl.style.pointerEvents='none';
  } else {
    txEl.style.visibility='hidden';  txEl.style.pointerEvents='none';
    taEl.style.visibility='visible'; taEl.style.pointerEvents='auto';
  }
}

// ====== TX DEBUG（Console 版）======
const _dbgStats = {
  calls:0, fullRedraws:0, incremental:0, rebuilds:0,
  lastMs:0, avgMs:0, maxMs:0, lastTicks:0, lwcUpdates:0,
  lastCutoff:'—', cacheKey:'—',
  barCount:0, lastBarTime:'—', lastBarClose:0,
  lwcInited:false, lwcHasData:false,
  renderStatus:'未開始', renderOk:0, renderFail:0,
  lastRenderOk:false, prevCutMs:-1, cutoffChanged:false,
  errors:[],
};

function _dbgInit(){}  // 空函式，相容舊呼叫

function _dbgLog(type, msg){
  const ts = new Date().toLocaleTimeString();
  const entry = `[${ts}][${type}] ${msg}`;
  _dbgStats.errors.unshift(entry);
  if(_dbgStats.errors.length > 10) _dbgStats.errors.pop();
  if(type==='ERROR') console.error(`🔴 TX DEBUG ${entry}`);
  else if(type==='WARN') console.warn(`🟡 TX DEBUG ${entry}`);
  else if(type==='PERF') console.warn(`🟠 TX DEBUG ${entry}`);
  else console.log(`🟢 TX DEBUG ${entry}`);
}

function _dbgRender(){
  const s = _dbgStats;
  const statusIcon = s.renderStatus==='OK'?'✅': s.renderStatus==='無資料'?'⚠️':'❌';
  console.log(
    `%c📊 TX K線渲染`,
    'color:#0f0;font-weight:bold;font-size:13px',
    `
狀態: ${statusIcon} ${s.renderStatus}`,
    `| 時間更新: ${s.cutoffChanged?'✓':'✗ 沒變化'}`,
    `| K棒數: ${s.barCount}根`,
    `| 最後棒: ${s.lastBarTime} 收${s.lastBarClose}`,
    `
LWC: ${s.lwcInited?'✓存在':'✗未初始化'}`,
    `| 有資料: ${s.lwcHasData?'✓':'✗'}`,
    `| LWC更新: ${s.lwcUpdates}次`,
    `
耗時: ${s.lastMs}ms`,
    `| 均值: ${s.avgMs}ms`,
    `| 最大: ${s.maxMs}ms`,
    `| 新增ticks: ${s.lastTicks}`,
    `
呼叫: ${s.calls}`,
    `| 全面重繪: ${s.fullRedraws}`,
    `| 快取重建: ${s.rebuilds}`,
  );
}

window._dbgStatus = ()=> _dbgStats;
window._dbgShowStatus = ()=> console.log('DEBUG status', _dbgStats);


function renderTX(cutoff=null){
  const _t0 = performance.now();
  const period  = parseInt(periodSelect.value)||5;
  const periodMs = period * 60000;
  const expiry  = (expirySelect.value||'').replace(/\s/g,'');
  const session = sessionSelect.value;
  const newTXKey= `tx|${expiry}|${session}|${period}|${isDark}`;
  const txCutMs = cutoff ? +cutoff : Infinity;

  _dbgStats.calls++;
  _dbgStats.cutoffChanged = (txCutMs !== _dbgStats.prevCutMs);
  _dbgStats.prevCutMs  = txCutMs;
  _dbgStats.lastCutoff = cutoff ? new Date(cutoff).toLocaleTimeString() : '—';
  _dbgStats.cacheKey   = newTXKey.slice(0,40);
  _dbgStats.renderStatus = '執行中...';
  if(!_dbgStats.cutoffChanged) _dbgLog('WARN','cutoff 沒有變化，可能回測時間沒推進');

  // 圖表實例：設定改變時重建（使用獨立的 txChartKey，不干擾 taChartKey）
  if(!_lwcChart || newTXKey !== txChartKey){
    _lwcDestroy();
    _lwcInit();
    txChartKey = newTXKey;
    txChartInited = false;
    _txClearCache();
    _dbgStats.fullRedraws++;
  }
  if(!_lwcChart){
    _dbgStats.renderStatus = '錯誤：LWC未初始化';
    _dbgStats.renderFail++;
    _dbgLog('ERROR','_lwcChart 為 null，LWC 初始化失敗');
    _dbgRender();
    return;
  }
  _dbgStats.lwcInited = true;

  // 主力合約：只在快取失效時掃描
  if(!_txC.mainExpiry || _txC.key !== newTXKey){
    const volByExpiry = {};
    for(const d of txDataIndex){
      if((d.product||'').toUpperCase()!=='TX') continue;
      if(!withinSession(d.time)) continue;
      const ex=(d.expiry||'').replace(/\s/g,'');
      volByExpiry[ex]=(volByExpiry[ex]||0)+(d.volume||0);
    }
    const entries=Object.entries(volByExpiry);
    if(!entries.length){ kinfo.innerText=`TX 台指期：無資料`; return; }
    _txC.mainExpiry=entries.sort((a,b)=>b[1]-a[1])[0][0];
    _txC.key=newTXKey;
    _txC.grouped={}; _txC.nextIdx=0; _txC.lastCutMs=-1;
  }

  // 時間回退 → 重建快取
  if(txCutMs < _txC.lastCutMs){
    _txC.grouped={}; _txC.nextIdx=0; _txC.lastCutMs=-1;
    txChartInited=false;
    _dbgStats.rebuilds++;
  }

  // 增量：只處理新增 tick
  const endIdx = txCutMs<Infinity ? _txBinSearch(txCutMs+1) : txDataIndex.length;
  const prevNextIdx = _txC.nextIdx;
  for(let i=_txC.nextIdx; i<endIdx; i++) _txAppendTick(txDataIndex[i], periodMs);
  _txC.nextIdx=endIdx;
  _txC.lastCutMs=txCutMs;
  _dbgStats.lastTicks = endIdx - prevNextIdx;

  // 有新資料才更新圖表
  const bucketKeys = Object.keys(_txC.grouped).map(Number).sort((a,b)=>a-b);
  if(!bucketKeys.length){
    kinfo.innerText=`TX 台指期：無資料`;
    _dbgStats.renderStatus = '無資料';
    _dbgStats.renderFail++;
    _dbgStats.barCount = 0;
    _dbgStats.lwcHasData = false;
    _dbgLog('WARN',`grouped 為空，mainExpiry=${_txC.mainExpiry}, nextIdx=${_txC.nextIdx}`);
    _dbgRender();
    return;
  }

  const g = _txC.grouped;

  if(!txChartInited){
    // 第一次：全量設定
    const allCandles = bucketKeys.map(k=>g[k]);
    const allVols    = bucketKeys.map(k=>({ time:g[k].time, value:g[k].volume, color: g[k].close>=g[k].open?'rgba(239,68,68,.5)':'rgba(34,197,94,.5)' }));
    _lwcCandle.setData(allCandles);
    _lwcVolume.setData(allVols);

    // 全盤：日夜盤分隔標記
    if(session==='全部' && allCandles.length>1 && LightweightCharts.createSeriesMarkers){
      const _sm=[];
      for(let i=1;i<allCandles.length;i++){
        const ph=new Date(allCandles[i-1].time*1000).getHours()*100+new Date(allCandles[i-1].time*1000).getMinutes();
        const ch=new Date(allCandles[i].time*1000).getHours()*100+new Date(allCandles[i].time*1000).getMinutes();
        if(ph<845&&ch>=845)   _sm.push({time:allCandles[i].time,position:'belowBar',color:'rgba(250,215,80,.4)',shape:'circle',text:'日',size:0.5});
        if(ph<1500&&ch>=1500) _sm.push({time:allCandles[i].time,position:'belowBar',color:'rgba(140,155,255,.4)',shape:'circle',text:'夜',size:0.5});
      }
      if(_txC._markers){ try{ _txC._markers.setMarkers([]); }catch(_){} }
      _txC._markers = LightweightCharts.createSeriesMarkers(_lwcCandle, _sm);
    }

    // MA
    const maPeriods  = getMAPeriods();
    const maColorMap = getMAColorMap();
    const closeArr   = bucketKeys.map(k=>g[k].close);
    // 清舊 MA series
    Object.values(_lwcMaSeries).forEach(s=>{ try{_lwcChart.removeSeries(s);}catch(_){} });
    _lwcMaSeries={};
    maPeriods.forEach(p=>{
      const maVals = calcMA(p, closeArr);
      const maSeries = _lwcChart.addSeries(LightweightCharts.LineSeries, { color: maColorMap[p]||'#888', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
      const maData = bucketKeys.map((k,i)=> maVals[i]!=null && isFinite(maVals[i]) ? {time:g[k].time, value:maVals[i]} : {time:g[k].time}); // whitespace for null MA
      maSeries.setData(maData);
      _lwcMaSeries[p]=maSeries;
    });

    _lwcChart.timeScale().fitContent();
    txChartInited=true;
    _dbgStats.lwcHasData = true;
    _dbgLog('INFO',`全量設定完成，共 ${bucketKeys.length} 根K棒`);
  } else {
    // 增量：只更新最後一根（或新增一根）
    const lastKey = bucketKeys[bucketKeys.length-1];
    const bar = g[lastKey];
    _lwcCandle.update({ time:bar.time, open:bar.open, high:bar.high, low:bar.low, close:bar.close });
    _lwcVolume.update({ time:bar.time, value:bar.volume, color: bar.close>=bar.open?'rgba(239,68,68,.5)':'rgba(34,197,94,.5)' });

    // MA 增量更新最後一根
    const maPeriods  = getMAPeriods();
    const closeArr   = bucketKeys.map(k=>g[k].close);
    maPeriods.forEach(p=>{
      if(!_lwcMaSeries[p]) return;
      const maVals = calcMA(p, closeArr);
      const lastMA = maVals[maVals.length-1];
      if(lastMA!=null && isFinite(lastMA)) _lwcMaSeries[p].update({time:bar.time, value:lastMA});
    });
  }

  // ── 開盤/最高/次高/次低/最低 price line（每步都更新，確保回測即時同步）
  if(_txC.priceLines) _txC.priceLines.forEach(pl=>{ try{ _lwcCandle.removePriceLine(pl); }catch(_){} });
  _txC.priceLines = [];
  const _txOpenPx  = g[bucketKeys[0]].open;
  const _txHighArr = bucketKeys.map(k=>g[k].high).sort((a,b)=>b-a);
  const _txLowArr  = bucketKeys.map(k=>g[k].low).sort((a,b)=>a-b);
  const _txH1 = _txHighArr[0];
  const _txH2 = _txHighArr.find(v => v < _txH1) ?? null;
  const _txL1 = _txLowArr[0];
  const _txL2 = _txLowArr.find(v => v > _txL1) ?? null;
  [
    { price: _txOpenPx, title:'開盤', color:'#facc15', style:0, width:3 },
    { price: _txH1,     title:'最高', color:'#ff5722', style:0, width:1 },
    ...(_txH2 != null ? [{ price:_txH2, title:'次高', color:'#ffa726', style:1, width:1 }] : []),
    ...(_txL2 != null ? [{ price:_txL2, title:'次低', color:'#22d3ee', style:1, width:1 }] : []),
    { price: _txL1,     title:'最低', color:'#00cc55', style:0, width:1 },
  ].forEach(({price,title,color,style,width})=>{
    if(!Number.isFinite(price)) return;
    _txC.priceLines.push(_lwcCandle.createPriceLine({ price, color, lineWidth:width, lineStyle:style, axisLabelVisible:true, title }));
  });

  const highPrice = _txH1;
  const lowPrice  = _txL1;
  kinfo.innerText = `TX 台指期 ${period}分線｜高：${highPrice}｜低：${lowPrice}${cutoff?`｜回測到 ${cutoff.toLocaleString()}`:''}`;

  // DEBUG 統計
  const _elapsed = +(performance.now() - _t0).toFixed(2);
  _dbgStats.lastMs = _elapsed;
  _dbgStats.avgMs  = +((_dbgStats.avgMs * (_dbgStats.calls-1) + _elapsed) / _dbgStats.calls).toFixed(2);
  if(_elapsed > _dbgStats.maxMs) _dbgStats.maxMs = _elapsed;
  if(_dbgStats.lastTicks===0) _dbgStats.incremental++;
  else _dbgStats.lwcUpdates++;

  // K線棒狀態
  const _lastKey = bucketKeys[bucketKeys.length-1];
  const _lastBar = _txC.grouped[_lastKey];
  _dbgStats.barCount    = bucketKeys.length;
  _dbgStats.lwcHasData  = bucketKeys.length > 0;
  _dbgStats.lastBarTime = _lastBar ? new Date(_lastBar.time*1000).toLocaleTimeString() : '—';
  _dbgStats.lastBarClose= _lastBar ? _lastBar.close : 0;

  // 渲染是否有效：時間有推進 且 K線棒數 > 0
  if(_dbgStats.cutoffChanged && _dbgStats.barCount > 0){
    _dbgStats.renderStatus = 'OK';
    _dbgStats.renderOk++;
    _dbgStats.lastRenderOk = true;
  } else if(!_dbgStats.cutoffChanged){
    _dbgStats.renderStatus = '時間未更新';
  } else if(_dbgStats.barCount === 0){
    _dbgStats.renderStatus = '無K線棒';
    _dbgStats.renderFail++;
    _dbgLog('ERROR','barCount=0，K線棒沒有產生');
  }

  // 耗時警告
  if(_elapsed > 16) _dbgLog('PERF',`耗時 ${_elapsed}ms 超過16ms，主執行緒可能被佔滿`);
  else if(_elapsed > 8) _dbgLog('PERF',`耗時 ${_elapsed}ms 偏高`);

  _dbgRender();
}

function renderTrend(cutoff=null){
  const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
  const session=sessionSelect.value;
  const newKey = `${expiry}|${strike}|${type}|${session}`;

  // 只有在商品/時段變更時才完全重繪；否則增量更新數據
  const needFullRedraw = (newKey !== trendChartKey) || !trendChartInited;
  if(needFullRedraw){
    chartTrend.clear();
    trendChartKey = newKey;
    trendChartInited = false;
  }

  if(!expiry||!strike||!type){ return; }

  // 取 tick，做 1 分鐘聚合（不受 periodSelect 影響）— 使用索引
  const trendK = keyOf(expiry, strike, type);
  const trendArr = dataIndex.get(trendK) || [];
  const trendCutMs = cutoff ? +cutoff : Infinity;
  const data = [];
  for(const d of trendArr){
    if(d.dtms > trendCutMs) break;
    if(withinSession(d.time)) data.push(d);
  }

  if(!data.length){ return; }

  const grouped={};
  for(const d of data){
    const bucket=Math.floor(d.dtms/60000)*60000;
    const key=String(bucket);
    if(!grouped[key]) grouped[key]={t:bucket, open:d.price, high:d.price, low:d.price, close:d.price, volume:d.volume};
    else{
      const g=grouped[key];
      g.high=Math.max(g.high,d.price);
      g.low=Math.min(g.low,d.price);
      g.close=d.price;
      g.volume += d.volume;
    }
  }

  const keys=Object.keys(grouped).sort((a,b)=>+a-+b);
  const bars = keys.map(k=>grouped[k]);
  const times = bars.map(b=>b.t);
  const prices = bars.map(b=>b.close);
  const vols = bars.map(b=>b.volume);

  const openPx = bars[0].open; // 開盤價基準（開盤時間的開盤價）

  // ---- 最高 / 最低價 ----
  let trendHighIdx = 0, trendLowIdx = 0;
  for(let i = 1; i < prices.length; i++){
    if(prices[i] > prices[trendHighIdx]) trendHighIdx = i;
    if(prices[i] < prices[trendLowIdx]) trendLowIdx = i;
  }
  const trendHighPx = prices[trendHighIdx];
  const trendLowPx  = prices[trendLowIdx];
  const trendHighTime = times[trendHighIdx];
  const trendLowTime  = times[trendLowIdx];

  // ---- 基準線置中：y 軸 min/max 以開盤價為中心對稱 ----
  let maxDev = 0;
  for(const p of prices){
    maxDev = Math.max(maxDev, Math.abs(p - openPx));
  }
  const pad = Math.max(1, maxDev * 0.08); // 讓上下有點空間
  const yMin = openPx - maxDev - pad;
  const yMax = openPx + maxDev + pad;

  // ---- 上紅下綠且「跨越不斷線」：改用 time 軸並在跨越處插入交點 ----
  const upData = [];
  const dnData = [];

  function ensureBreak(arr){
    if(arr.length && arr[arr.length-1]!==null) arr.push(null);
  }

  let prevP = prices[0];
  let prevT = times[0];
  let prevSide = (prevP >= openPx) ? 'up' : 'dn';

  // 起點
  if(prevSide==='up') upData.push([prevT, prevP]);
  else dnData.push([prevT, prevP]);

  for(let i=1;i<prices.length;i++){
    const t = times[i];
    const p = prices[i];
    const side = (p >= openPx) ? 'up' : 'dn';

    if(side === prevSide){
      if(side==='up') upData.push([t,p]);
      else dnData.push([t,p]);
    }else{
      // 計算交點（線性插值）
      let tCross = prevT;
      if(p !== prevP){
        const ratio = (openPx - prevP) / (p - prevP);
        tCross = Math.round(prevT + ratio * (t - prevT));
      }
      // 把交點加到兩邊（視覺連續）
      if(prevSide==='up'){
        upData.push([tCross, openPx]);
        upData.push(null);            // 結束上一段紅線
        ensureBreak(dnData);          // 開新一段綠線前，先斷掉舊綠線（如果有）
        dnData.push([tCross, openPx]);
        dnData.push([t,p]);
      }else{
        dnData.push([tCross, openPx]);
        dnData.push(null);            // 結束上一段綠線
        ensureBreak(upData);          // 開新一段紅線前，先斷掉舊紅線（如果有）
        upData.push([tCross, openPx]);
        upData.push([t,p]);
      }
    }

    prevP = p; prevT = t; prevSide = side;
  }

  // tooltip 用：原始 1 分 K 的索引查找（避免交點造成 dataIndex 對不上）
  function fmtHM(ts){
    const d=new Date(ts);
    const hh=String(d.getHours()).padStart(2,'0');
    const mm=String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  function nearestIndex(ts){
    // times 已排序，二分找最近
    let lo=0, hi=times.length-1;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      if(times[mid]===ts) return mid;
      if(times[mid]<ts) lo=mid+1;
      else hi=mid-1;
    }
    const i1=Math.max(0, Math.min(times.length-1, lo));
    const i0=Math.max(0, i1-1);
    return (Math.abs(times[i0]-ts) <= Math.abs(times[i1]-ts)) ? i0 : i1;
  }

  const tipBoxCss = isDark
    ? "background:rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.10);"
    : "background:rgba(10,12,16,.88);border:1px solid rgba(255,255,255,.12);";

  const trendOption = {
    backgroundColor: '#000',
    animation: needFullRedraw, // 首次全繪時有動畫，增量更新時無動畫
    animationDuration: needFullRedraw ? 500 : 0,
    grid:{ left:56, right:18, top:18, bottom:52 },
    xAxis:{
      type:'time',
      axisLabel:{
        color:'#cfd8dc',
        formatter:(val)=>fmtHM(val)
      },
      axisLine:{ lineStyle:{ color:'rgba(255,255,255,.18)'} },
      axisTick:{ show:false },
      splitLine:{ show:true, lineStyle:{ color:'rgba(255,255,255,.08)'} }
    },
    yAxis:{
  type:'value',
  scale:false,
  min: yMin,
  max: yMax,
  axisLabel:{
    formatter:(v)=>{
      const eps = Math.max(1e-6, Math.abs(openPx)*1e-6);
      const s = (Math.round(v*10)/10).toFixed(1);
      if(Math.abs(v-openPx) <= eps) return `{base|${s}}`;
      return (v>openPx) ? `{up|${s}}` : `{dn|${s}}`;
    },
    rich:{
      up:{ color:'#ff2d2d', fontWeight:800, fontSize:13 },
      dn:{ color:'#00ff6a', fontWeight:800, fontSize:13 },
      base:{ color:'#3b82f6', fontWeight:900, fontSize:13 }
    }
  },
      axisLine:{ lineStyle:{ color:'rgba(255,255,255,.18)'} },
      splitLine:{ show:true, lineStyle:{ color:'rgba(255,255,255,.10)'} }
    },
    tooltip:{
      trigger:'axis',
      confine:true,
      axisPointer:{ type:'cross' },
      backgroundColor:'transparent',
      borderWidth:0,
      extraCssText:"padding:0;box-shadow:none;",
      formatter:(params)=>{
        const ts = params?.[0]?.axisValue;
        if(!ts) return '';
        const idx = nearestIndex(ts);
        const px = prices[idx];
        const vol = vols[idx];
        const diff = px - openPx;
        const pct = openPx ? (diff/openPx*100) : 0;

        const diffColor = diff>=0 ? '#ff2d2d' : '#00ff6a';
        const pctText = (isFinite(pct) ? pct.toFixed(2) : '0.00') + '%';
        const diffText = (diff>=0?'+':'') + (isFinite(diff)?diff.toFixed(1):diff);

        return `
          <div style="${tipBoxCss} border-radius:14px; padding:14px 16px; min-width:240px; color:#fff; font-size:15px; line-height:1.45">
            <div style="font-weight:900; font-size:16px; margin-bottom:8px">● ${expiry}_${strike}${type}</div>
            <div>時間：<span style="font-weight:900; font-size:15px">${fmtHM(times[idx])}</span></div>
            <div>價格：<span style="font-weight:800; color:${diffColor}">${px}</span></div>
            <div>漲跌：<span style="font-weight:800; color:${diffColor}">${diffText}</span></div>
            <div>幅度：<span style="font-weight:800; color:${diffColor}">${pctText}</span></div>
            <div>單量：<span style="font-weight:900; font-size:15px">${vol}</span></div>
          </div>
        `;
      }
    },
    series:[
  {
    name:'Above',
    type:'line',
    data: upData,
    symbol:'none',
    lineStyle:{ width:2, color:'#ff2d2d' },
    areaStyle:{
      origin: openPx,
      color: new echarts.graphic.LinearGradient(0,0,0,1,[
        {offset:0, color:'rgba(255,82,82,0.28)'},
        {offset:1, color:'rgba(255,82,82,0.00)'}
      ])
    },
    z:3
  },
  {
    name:'Below',
    type:'line',
    data: dnData,
    symbol:'none',
    lineStyle:{ width:2, color:'#00ff6a' },
    areaStyle:{
      origin: openPx,
      color: new echarts.graphic.LinearGradient(0,1,0,0,[
        {offset:0, color:'rgba(0,255,106,0.26)'},
        {offset:1, color:'rgba(0,230,118,0.00)'}
      ])
    },
    z:2
  },
  {
  name:'Open',
  type:'line',
  data: [[times[0],openPx],[times[times.length-1],openPx]],
  symbol:'none',
  lineStyle:{ width:1.2, color:'#3b82f6' },
  label:{
    show:true,
    position:'end',
    formatter: ()=> (Math.round(openPx*10)/10).toFixed(1),
    color:'#3b82f6',
    fontWeight:900,
    fontSize:14,
    backgroundColor:'rgba(0,0,0,.55)',
    borderColor:'rgba(59,130,246,.9)',
    borderWidth:1,
    borderRadius:8,
    padding:[4,8,4,8]
  },
  z:1
},
{
  // 最高價 / 最低價 標記點
  name:'HL-markers',
  type:'line',
  data: [], // 空數據，只用 markPoint + markLine
  symbol:'none',
  lineStyle:{ width:0 },
  markPoint:{
    symbol:'pin',
    symbolSize: 42,
    animation: false,
    data:[
      {
        name:'最高',
        coord: [trendHighTime, trendHighPx],
        value: trendHighPx,
        itemStyle:{ color:'#ff2d2d' },
        label:{ color:'#fff', fontWeight:900, fontSize:11, formatter:'{c}' }
      },
      {
        name:'最低',
        coord: [trendLowTime, trendLowPx],
        value: trendLowPx,
        symbolRotate: 180,
        itemStyle:{ color:'#00cc55' },
        label:{ color:'#fff', fontWeight:900, fontSize:11, formatter:'{c}', offset:[0, -4] }
      }
    ]
  },
  markLine:{
    silent: true,
    animation: false,
    symbol:'none',
    data:[
      {
        yAxis: trendHighPx,
        lineStyle:{ color:'rgba(255,45,45,.5)', type:'dashed', width:1 },
        label:{ show:true, position:'insideEndTop', color:'#ff2d2d', fontWeight:800, fontSize:11,
          formatter: `H ${trendHighPx}`,
          backgroundColor:'rgba(0,0,0,.6)', borderRadius:4, padding:[2,6] }
      },
      {
        yAxis: trendLowPx,
        lineStyle:{ color:'rgba(0,204,85,.5)', type:'dashed', width:1 },
        label:{ show:true, position:'insideEndBottom', color:'#00ff6a', fontWeight:800, fontSize:11,
          formatter: `L ${trendLowPx}`,
          backgroundColor:'rgba(0,0,0,.6)', borderRadius:4, padding:[2,6] }
      }
    ]
  },
  z:10
}
]
      };
      // 增量更新：不用 notMerge，只替換 series data + yAxis range
      chartTrend.setOption(trendOption, needFullRedraw);
      trendChartInited = true;
    }

// ====== 入口：只渲染當前顯示的 tab，避免對 display:none 容器做無效渲染 ======
window.renderChart_impl = function renderChart(cutoff=null){
  // 兩個圖表都保持更新，切換時不中斷任何一方的資料流
  renderTA(cutoff);
  renderTX(cutoff);
  renderTrend(cutoff);
  // 顯示/隱藏由 currentChartMode 決定（不在各 render 函數內部控制）
  _lwcShowHide(currentChartMode === 'tx');
  fixedTooltip.style.display = (activeChartTab==='ta' && fixedTooltip.innerHTML) ? 'block' : 'none';
}


// ====== 浮動多空儀錶視窗 ======
(function(){
  const floatEl   = document.getElementById('volatilityFloat');
  const header    = document.getElementById('volatilityHeader');
  const body      = document.getElementById('volatilityBody');
  const minBtn    = document.getElementById('volatilityMinBtn');
  const closeBtn  = document.getElementById('volatilityCloseBtn');
  const showBtn   = document.getElementById('showVolatilityBtn');
  const chartDiv  = document.getElementById('volatilityChart');
  const valLabel  = document.getElementById('volatilityValue');
  const gaugeChg  = document.getElementById('gaugeChg');
  const gaugePct  = document.getElementById('gaugePct');
  const gaugeTime = document.getElementById('gaugeTime');

  let volChart = null;
  let minimized = false;

  // 初始化 ECharts Gauge
  function initVolChart(){
    if(volChart) return;
    volChart = echarts.init(chartDiv);
    volChart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: -2,
        max: 2,
        splitNumber: 4,
        radius: '92%',
        center: ['50%', '82%'],
        axisLine: {
          lineStyle: {
            width: 28,
            color: [
              [0.000, '#14532d'],  // 深綠（重空）
              [0.167, '#16a34a'],  // 綠
              [0.333, '#4ade80'],  // 淺綠
              [0.500, '#86efac'],  // 極淺綠（中間）
              [0.500, '#fca5a5'],  // 極淺紅（中間）
              [0.667, '#fca5a5'],  // 淺紅
              [0.833, '#ef4444'],  // 紅
              [1.000, '#7f1d1d'],  // 深紅（重多）
            ]
          }
        },
        progress: { show: false },
        pointer: {
          length: '58%',
          width: 4,
          offsetCenter: [0, '-8%'],
          itemStyle: {
            color: '#facc15',
            shadowColor: 'rgba(251,191,36,.8)',
            shadowBlur: 8,
          }
        },
        anchor: {
          show: true,
          showAbove: true,
          size: 36,
          icon: 'path://M 0 0 m -1 0 a 1 1 0 0 1 2 0 Z',
          itemStyle: {
            color: '#0d1117',
            borderColor: 'rgba(255,255,255,.12)',
            borderWidth: 1,
            shadowColor: 'rgba(0,0,0,.6)',
            shadowBlur: 8,
          }
        },
        axisTick: { show: true, distance: 4, length: 5, lineStyle: { color: 'rgba(255,255,255,.3)', width: 1 } },
        splitLine: { distance: 4, length: 12, lineStyle: { color: 'rgba(255,255,255,.6)', width: 2 } },
        axisLabel: {
          color: '#cbd5e1',
          fontSize: 13,
          fontWeight: 700,
          distance: 22,
          formatter: v => {
            if(Math.abs(v) < 0.001) return '0';
            if(Math.abs(Math.round(v*100)) % 50 === 0) return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
            return '';
          }
        },
        title: { show: false },
        detail: {
          show: true,
          offsetCenter: [0, '55%'],
          fontSize: 24,
          fontWeight: 900,
          fontFamily: "'Courier New', monospace",
          color: '#e2e8f0',
          formatter: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
        },
        data: [{ value: 0 }]
      }]
    });
  }

  // 更新儀錶資料
  window.updateVolatilityChart = function(cutoff){
    if(!floatEl || floatEl.style.display === 'none') return;
    if(!window.txDataIndex || !window.txDataIndex.length) return;
    if(!volChart) initVolChart();

    const period  = parseInt(document.getElementById('periodSelect').value) || 5;
    const cutMs   = cutoff ? +cutoff : Infinity;
    const session = document.getElementById('sessionSelect').value;

    // 取主力 TX 契約（成交量最大）
    let pool = [];
    for(const d of window.txDataIndex){
      if(d.dtms > cutMs) break;
      if((d.product||'').toUpperCase() !== 'TX') continue;
      if(session !== '全部' && !withinSession(d.time)) continue;
      pool.push(d);
    }
    if(!pool.length){ valLabel.textContent = '—'; return; }

    // 找主力契約
    const volByEx = {};
    pool.forEach(d => { const ex=(d.expiry||'').replace(/\s/g,''); volByEx[ex]=(volByEx[ex]||0)+(d.volume||0); });
    const mainEx = Object.entries(volByEx).sort((a,b)=>b[1]-a[1])[0][0];
    pool = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === mainEx);

    // 找當日開盤價（每日第一筆）
    const dayOpenMap = {};
    for(const d of pool){
      if(!dayOpenMap[d.date]) dayOpenMap[d.date] = d.price;
    }

    // 按週期分組取 close，同時追蹤今日最高最低（tick 級）
    const grouped = {};
    const dayHighMap = {}, dayLowMap = {};
    for(const d of pool){
      const bucket = Math.floor(d.dtms / (60000*period)) * (60000*period);
      const k = String(bucket);
      if(!grouped[k]) grouped[k] = { close: d.price, t: new Date(bucket), date: d.date };
      else { grouped[k].close = d.price; }
      // 今日高低（tick 級最精準）
      if(dayHighMap[d.date] == null || d.price > dayHighMap[d.date]) dayHighMap[d.date] = d.price;
      if(dayLowMap[d.date]  == null || d.price < dayLowMap[d.date])  dayLowMap[d.date]  = d.price;
    }

    const keys = Object.keys(grouped).sort();
    if(!keys.length){ valLabel.textContent = '—'; return; }

    const lastKey = keys[keys.length - 1];
    const lastBar = grouped[lastKey];
    const dayOpen = dayOpenMap[lastBar.date];
    if(!dayOpen){ valLabel.textContent = '—'; return; }

    const chg = lastBar.close - dayOpen;
    const pct = (chg / dayOpen) * 100;

    // 今日高低（轉為相對開盤的點數）
    const dayHigh = dayHighMap[lastBar.date];
    const dayLow  = dayLowMap[lastBar.date];
    const highChg = dayHigh != null ? dayHigh - dayOpen : null;
    const lowChg  = dayLow  != null ? dayLow  - dayOpen : null;

    // 動態範圍：取當日最大絕對趴數 × 1.2，至少 ±1%
    let maxAbsPct = 1;
    for(const k of keys){
      const bar = grouped[k];
      const op  = dayOpenMap[bar.date];
      if(!op) continue;
      const p = Math.abs((bar.close - op) / op * 100);
      if(p > maxAbsPct) maxAbsPct = p;
    }
    const range = Math.max(1, Math.ceil(maxAbsPct * 1.2 * 10) / 10);

    // 時間標籤
    const t = lastBar.t;
    const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;

    // 標題列：漲跌點數（黃色 → 到達時改紅/綠）
    valLabel.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(0) + ' pt';
    valLabel.style.color = chg > 0 ? '#f87171' : chg < 0 ? '#4ade80' : '#fbbf24';
    valLabel.style.textShadow = chg > 0
      ? '0 0 12px rgba(248,113,113,.5)'
      : chg < 0 ? '0 0 12px rgba(74,222,128,.5)'
      : '0 0 12px rgba(251,191,36,.4)';

    // 數據列
    const gaugeHighEl = document.getElementById('gaugeHigh');
    const gaugeLowEl  = document.getElementById('gaugeLow');
    if(gaugeHighEl && highChg != null){
      gaugeHighEl.textContent = (highChg >= 0 ? '+' : '') + highChg.toFixed(0) + ' pt';
    }
    if(gaugeLowEl && lowChg != null){
      gaugeLowEl.textContent = (lowChg >= 0 ? '+' : '') + lowChg.toFixed(0) + ' pt';
      gaugeLowEl.style.color = lowChg < 0 ? '#4ade80' : '#94a3b8';
    }

    const gaugePctEl = document.getElementById('gaugePct');
    if(gaugePctEl){
      gaugePctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      gaugePctEl.style.color = pct > 0 ? '#f87171' : pct < 0 ? '#4ade80' : '#94a3b8';
    }

    const gaugeChgEl = document.getElementById('gaugeChg');
    if(gaugeChgEl){
      gaugeChgEl.textContent = (chg > 0 ? '▲ +' : chg < 0 ? '▼ ' : '— ') + chg.toFixed(0) + ' pt';
      gaugeChgEl.style.color = chg > 0 ? '#f87171' : chg < 0 ? '#4ade80' : '#64748b';
    }

    const gaugeTimeEl = document.getElementById('gaugeTime');
    if(gaugeTimeEl) gaugeTimeEl.textContent = timeStr;

    // 漸層色弧：依動態範圍重新算比例
    const half = range;
    const gradColors = [
      [0.000, '#14532d'],
      [0.167, '#16a34a'],
      [0.333, '#4ade80'],
      [0.500, '#86efac'],
      [0.500, '#fca5a5'],
      [0.667, '#fca5a5'],
      [0.833, '#ef4444'],
      [1.000, '#7f1d1d'],
    ];

    volChart.setOption({
      series:[{
        min: -range,
        max:  range,
        axisLine: { lineStyle: { color: gradColors } },
        axisLabel: {
          formatter: v => {
            if(Math.abs(v) < 0.001) return '0';
            const step = range / 2;
            if(Math.abs(Math.abs(v) - step) < 0.001 || Math.abs(Math.abs(v) - range) < 0.001)
              return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
            return '';
          }
        },
        detail: {
          formatter: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
        },
        data: [{ value: +pct.toFixed(2) }]
      }]
    });
  };

  // 開啟視窗
  showBtn?.addEventListener('click', ()=>{
    floatEl.style.display = '';
    if(!volChart) initVolChart();
    window.updateVolatilityChart(window._lastCutoff || null);
  });

  // 最小化
  minBtn?.addEventListener('click', ()=>{
    minimized = !minimized;
    body.style.display = minimized ? 'none' : '';
    minBtn.textContent = minimized ? '+' : '−';
  });

  // 關閉
  closeBtn?.addEventListener('click', ()=>{ floatEl.style.display='none'; });

  // 拖曳
  let dragging=false, ox=0, oy=0, fx=0, fy=0;
  header?.addEventListener('mousedown', e=>{
    dragging=true;
    const rect = floatEl.getBoundingClientRect();
    ox=e.clientX-rect.left; oy=e.clientY-rect.top;
    header.style.cursor='grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    let nx = e.clientX-ox, ny = e.clientY-oy;
    nx = Math.max(0, Math.min(window.innerWidth-floatEl.offsetWidth, nx));
    ny = Math.max(0, Math.min(window.innerHeight-floatEl.offsetHeight, ny));
    floatEl.style.left = nx+'px'; floatEl.style.top = ny+'px';
    floatEl.style.right='auto'; floatEl.style.bottom='auto';
  });
  document.addEventListener('mouseup', ()=>{ dragging=false; header.style.cursor='grab'; });
})();

// ====== TX 期貨報價列 ======
window.updateTXBar = function updateTXBar(cutoff){
  const hint = document.getElementById('txHint');
  const expiry = (expirySelect.value||'').replace(/\s/g,'');

  const txBarCutMs = cutoff ? +cutoff : Infinity;
  let pool = [];
  for(const d of txDataIndex){
    if(d.dtms > txBarCutMs) break;
    if(withinSession(d.time)) pool.push(d);
  }

  // 優先篩選當月合約，無則取下一個月合約
  if(expiry && pool.length){
    const same = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === expiry);
    if(same.length){
      pool = same;
    } else {
      const ym = expiry.slice(0,6);
      const sameYM = pool.filter(d => (d.expiry||'').slice(0,6) === ym);
      if(sameYM.length){
        pool = sameYM;
      } else {
        // 當月無資料 → 取下一個月的期貨合約
        const allExpiries = [...new Set(pool.map(d => (d.expiry||'').replace(/\s/g,'')))].sort();
        const nextExpiry = allExpiries.find(e => e > expiry);
        if(nextExpiry){
          pool = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === nextExpiry);
        }
        // 若連下一個月都沒有，就用全部資料
      }
    }
  }

  if(!pool.length){
    hint.style.display = 'inline';
    document.getElementById('txPrice').textContent='—';
    document.getElementById('txChg').textContent='—';
    document.getElementById('txChg').className='tx-chg flat';
    document.getElementById('txOpen').textContent='—';
    document.getElementById('txHigh').textContent='—';
    document.getElementById('txLow').textContent='—';
    document.getElementById('txVol').textContent='—';
    return;
  }
  hint.style.display = 'none';

  const last = pool[pool.length - 1];
  const dateStr = last.date;
  const dayPool = pool.filter(d => d.date === dateStr);
  const openPx  = dayPool[0].price;
  const lastPx  = last.price;
  const highPx  = dayPool.reduce((m,d) => d.price > m ? d.price : m, dayPool[0].price);
  const lowPx   = dayPool.reduce((m,d) => d.price < m ? d.price : m, dayPool[0].price);
  const totalVol = dayPool.reduce((s,d) => s + (d.volume||0), 0);
  const chg = lastPx - openPx;
  const pct = openPx ? (chg / openPx * 100) : 0;
  const sign = chg >= 0 ? '+' : '';

  document.getElementById('txPrice').textContent = lastPx;
  const chgEl = document.getElementById('txChg');
  chgEl.textContent = `${sign}${chg.toFixed(0)} (${sign}${pct.toFixed(2)}%)`;
  chgEl.className = `tx-chg ${chg > 0 ? 'up' : chg < 0 ? 'dn' : 'flat'}`;
  document.getElementById('txOpen').textContent = openPx;
  document.getElementById('txHigh').textContent = highPx;
  document.getElementById('txLow').textContent  = lowPx;
  document.getElementById('txVol').textContent  = fmtNum(totalVol);
}

// ====== 20 點回測日期初始化（保留空函式以防其他地方引用） ======
function init20BacktestDates(){ /* 已由條件委託單取代 */ }

// ====== 條件委託單主程式（自動下單引擎） ======

// ★ 回測參數快取：啟動時讀取一次，避免每個 tick 重複讀 DOM
window._aoParams = null;

window._startAutoOrder = function(){
  if(window.autoOrderActive) return;
  if(!(window.rawData||[]).length){ alert('尚未載入資料'); return; }
  const expiry = document.getElementById('expirySelect').value;
  if(!expiry){ alert('請先選擇到期月份'); return; }

  const entryMin = parseFloat(document.getElementById('s1EntryMin').value || '20');
  const entryMax = parseFloat(document.getElementById('s1EntryMax').value || '25');
  if(entryMin > entryMax){ alert('進場區間：下限不能大於上限'); return; }

  // ★ 啟動時快取所有參數，tickAutoOrders 直接讀 _aoParams
  window._aoParams = {
    scanSide:      document.getElementById('s1ScanSide').value,
    entryMin,
    entryMax,
    qty:           Math.max(1, parseInt(document.getElementById('s1Qty').value || '1')),
    mult:          Math.max(1, parseInt(document.getElementById('s1Mult').value || '50')),
    tp:            parseFloat(document.getElementById('s1TP').value || '10'),
    sl:            parseFloat(document.getElementById('s1SL').value || '5'),
    exitMode:      document.getElementById('s1ExitMode').value,
    maxPos:        Math.max(1, parseInt(document.getElementById('s1MaxPos').value || '10')),
    oncePerStrike: document.getElementById('s1OncePerStrike').checked,
    timeStart:     (document.getElementById('s1TimeStart').value || '08:45:00').replace(/:/g,''),
    timeEnd:       (document.getElementById('s1TimeEnd').value || '13:44:00').replace(/:/g,''),
  };

  window.autoOrderActive = true;
  window.autoOrderPositions = [];
  window.autoOrderEnteredKeys = new Set();

  document.getElementById('s1Status').textContent='監控中...';
  document.getElementById('s1Status').className='s1-status running';
  bt20Run.style.display='none';
  bt20Stop.style.display='';
  document.getElementById('s1Cards').style.display='';
  document.getElementById('s1TblWrap').style.display='';
  if(typeof renderAutoOrderTable==='function') renderAutoOrderTable();
  if(typeof renderAutoOrderStats==='function') renderAutoOrderStats();
};

window._stopAutoOrder = function(){
  window.autoOrderActive = false;
  document.getElementById('s1Status').textContent='已停止';
  document.getElementById('s1Status').className='s1-status stopped';
  document.getElementById('bt20Run').style.display='';
  document.getElementById('bt20Stop').style.display='none';
  // 強制出場所有 open 的部位
  if(typeof forceCloseAllAutoOrders==='function') forceCloseAllAutoOrders('手動停止');
  if(typeof renderAutoOrderTable==='function') renderAutoOrderTable();
  if(typeof renderAutoOrderStats==='function') renderAutoOrderStats();
};

// 每次回測步進時呼叫此函式
function tickAutoOrders(cutoff){
  if(!autoOrderActive || !cutoff || !_aoParams) return;

  const expiry = expirySelect.value;
  const callType = typeAliases.call;
  const putType  = typeAliases.put;

  // ★ 直接讀快取，不再每 tick 讀 DOM
  const { scanSide, entryMin, entryMax, qty, mult, tp, sl,
          exitMode, maxPos, oncePerStrike, timeStart, timeEnd } = _aoParams;

  const cutoffMs = +cutoff;

  // === 1. 先處理已開倉部位的停利/停損/出場 ===
  autoOrderPositions.forEach(pos =>{
    if(pos.status !== 'open') return;

    // 取得當前價格
    const [e,s,t] = pos.key.split('|');
    const currentPx = getLastPrice(e, s, t, cutoff);
    if(currentPx == null) return;

    pos.currentPrice = currentPx;
    pos.peakPrice = Math.max(pos.peakPrice || pos.entryPrice, currentPx);

    if(exitMode === 'tpsl'){
      // 停利
      if(currentPx >= pos.entryPrice + tp){
        pos.status = 'closed';
        pos.exitPrice = currentPx;
        pos.exitTime = new Date(cutoff);
        pos.exitReason = '停利';
        pos.pnl = Math.round((currentPx - pos.entryPrice) * qty * mult);
        return;
      }
      // 停損
      if(currentPx <= pos.entryPrice - sl){
        pos.status = 'closed';
        pos.exitPrice = currentPx;
        pos.exitTime = new Date(cutoff);
        pos.exitReason = '停損';
        pos.pnl = Math.round((currentPx - pos.entryPrice) * qty * mult);
        return;
      }
    }

    // 計算即時損益
    pos.pnl = Math.round((currentPx - pos.entryPrice) * qty * mult);
  });

  // === 2. 掃描新進場機會 ===
  let openCount = autoOrderPositions.filter(p=>p.status==='open').length;
  if(openCount >= maxPos) {
    renderAutoOrderTable();
    renderAutoOrderStats();
    return;
  }

  // 取得當前時間的 HHMMSS
  const cutDT = new Date(cutoff);
  const curHMS = hhmmss(cutDT);

  // 檢查是否在掃描時段內
  if(curHMS < timeStart || curHMS > timeEnd) {
    renderAutoOrderTable();
    renderAutoOrderStats();
    return;
  }

  // 掃描所有履約價 — 使用索引快速取最新價
  const latestMap = new Map();
  dataIndex.forEach((arr, k) => {
    const parts = k.split('|');
    if(parts[0] !== expiry) return;
    // 逆序找最後一筆符合條件的
    for(let i = arr.length - 1; i >= 0; i--){
      const r = arr[i];
      if(r.dtms > cutoffMs) continue;
      if(!withinSession(r.time)) continue;
      latestMap.set(`${r.strike}|${r.type}`, r);
      break;
    }
  });

  latestMap.forEach((r, k)=>{
    if(openCount >= maxPos) return;

    const isCall = (r.type === callType);
    const isPut  = (r.type === putType);
    if(!isCall && !isPut) return;
    if(scanSide === 'call' && !isCall) return;
    if(scanSide === 'put' && !isPut) return;

    const fullKey = keyOf(r.expiry, r.strike, r.type);

    // 每檔僅進場一次
    if(oncePerStrike && autoOrderEnteredKeys.has(fullKey)) return;

    // 檢查價格是否在進場區間
    if(r.price >= entryMin && r.price <= entryMax){
      // 進場！
      autoOrderEnteredKeys.add(fullKey);
      openCount++; // 更新快取計數
      autoOrderPositions.push({
        key: fullKey,
        isCall,
        sideLabel: isCall ? 'CALL' : 'PUT',
        strike: r.strike,
        status: 'open',
        entryTime: new Date(cutoff),
        entryPrice: r.price,
        currentPrice: r.price,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        pnl: 0,
        peakPrice: r.price,
        qty, mult,
        tpPrice: r.price + tp,
        slPrice: Math.max(0, r.price - sl)
      });
    }
  });

  renderAutoOrderTable();
  renderAutoOrderStats();
}

// 強制平倉所有 open 部位
function forceCloseAllAutoOrders(reason){
  const expiry = expirySelect.value;
  autoOrderPositions.forEach(pos =>{
    if(pos.status !== 'open') return;
    pos.status = 'closed';
    pos.exitPrice = pos.currentPrice || pos.entryPrice;
    pos.exitTime = cutoffTime ? new Date(cutoffTime) : new Date();
    pos.exitReason = reason || '手動停止';
    const qty = pos.qty || 1;
    const mult = pos.mult || 50;
    pos.pnl = Math.round(((pos.exitPrice||0) - pos.entryPrice) * qty * mult);
  });
}

// 渲染自動委託表格
function renderAutoOrderTable(){
  const pnlColor = (v) => v > 0 ? 'color:#d32f2f;font-weight:800' : v < 0 ? 'color:#1b5e20;font-weight:800' : '';

  if(!autoOrderPositions.length){
    s1Body.innerHTML=`<tr><td colspan="9" style="text-align:center;color:#aaa;padding:14px">${autoOrderActive?'監控中，等待進場條件...':'尚無委託紀錄'}</td></tr>`;
    return;
  }

  // 按進場時間排序（新的在前）
  const sorted = [...autoOrderPositions].reverse();
  s1Body.innerHTML = sorted.map(r=>{
    const stCls  = r.status==='open'?'filled':'pending';
    const stText = r.status==='open'?'持倉中':'已平倉';
    const sideCls= r.isCall?'side-call':'side-put';
    const pnlStyle = r.pnl!=null ? pnlColor(r.pnl) : '';
    const tpslText = `${r.tpPrice?.toFixed?.(1) ?? '—'} / ${r.slPrice?.toFixed?.(1) ?? '—'}`;
    const exitText = r.status==='open'
      ? `${r.currentPrice!=null?r.currentPrice:'—'}`
      : `${r.exitPrice!=null?r.exitPrice:'—'}<br><span style="font-size:10px;color:#aaa">${r.exitTime?r.exitTime.toLocaleTimeString():''}</span>`;
    const reasonText = r.exitReason || (r.status==='open'?'—':'—');
    const reasonStyle = r.exitReason==='停利' ? 'color:#d32f2f;font-weight:700' 
                      : r.exitReason==='停損' ? 'color:#1b5e20;font-weight:700' : '';

    return `<tr>
      <td><span class="s1-order-status ${stCls}">${stText}</span></td>
      <td class="${sideCls}">${r.sideLabel}</td>
      <td>${r.strike}</td>
      <td style="font-size:11px">${r.entryTime?r.entryTime.toLocaleTimeString():'—'}</td>
      <td>${r.entryPrice!=null?r.entryPrice:'—'}</td>
      <td style="font-size:11px">${tpslText}</td>
      <td>${exitText}</td>
      <td style="${pnlStyle}">${r.pnl!=null?fmtNum(r.pnl):'—'}</td>
      <td style="${reasonStyle}">${reasonText}</td>
    </tr>`;
  }).join('');
}

// 更新統計摘要
function renderAutoOrderStats(){
  const filled = autoOrderPositions.filter(r=>r.status==='closed');
  const openPos = autoOrderPositions.filter(r=>r.status==='open');
  const allPos = autoOrderPositions;

  const callAll = allPos.filter(r=>r.isCall);
  const putAll  = allPos.filter(r=>!r.isCall);
  const callPnl = callAll.reduce((s,r)=>s+(r.pnl||0), 0);
  const putPnl  = putAll.reduce((s,r)=>s+(r.pnl||0), 0);
  const totalPnl = callPnl + putPnl;
  const pnlColor = (v) => v > 0 ? 'color:#d32f2f;font-weight:800' : v < 0 ? 'color:#1b5e20;font-weight:800' : '';

  s1CallCount.textContent = callAll.length;
  s1PutCount.textContent  = putAll.length;
  s1CallPnl.textContent   = fmtNum(callPnl);
  s1CallPnl.style = pnlColor(callPnl);
  s1PutPnl.textContent    = fmtNum(putPnl);
  s1PutPnl.style = pnlColor(putPnl);
  s1TotalPnl.textContent  = fmtNum(totalPnl);
  s1TotalPnl.style = pnlColor(totalPnl);
  s1FilledCount.textContent = `持倉 ${openPos.length} / 已平倉 ${filled.length} / 合計 ${allPos.length}`;

  // === 統計分析 ===
  // 🏆 最大贏家
  const closedOrOpen = allPos.filter(r=>r.pnl!=null);
  if(closedOrOpen.length){
    const sorted = [...closedOrOpen].sort((a,b)=>(b.pnl||0)-(a.pnl||0));
    const winner = sorted[0];
    const winnerEl = document.getElementById('statWinnerRow');
    const wCls = winner.isCall?'call':'put';
    winnerEl.innerHTML = `
      <span class="bt20-winner-badge ${wCls}">${winner.sideLabel}</span>
      <span>履約價 <b>${winner.strike}</b></span>
      <span>進場 <b>${winner.entryPrice}</b></span>
      <span>現價 <b>${winner.currentPrice||winner.exitPrice||'—'}</b></span>
      <span style="${pnlColor(winner.pnl)}">損益 <b>${fmtNum(winner.pnl)}</b></span>
    `;
    const rankTbl = document.getElementById('statRankTbl');
    const medals = ['🥇','🥈','🥉'];
    rankTbl.innerHTML = sorted.slice(0,5).map((r,i)=>{
      const medal = medals[i]||`${i+1}.`;
      const sideCls = r.isCall?'side-call':'side-put';
      return `<tr>
        <td><span style="font-size:14px;margin-right:6px">${medal}</span><span class="${sideCls}">${r.sideLabel}</span> ${r.strike}</td>
        <td style="text-align:right;${pnlColor(r.pnl)}">${fmtNum(r.pnl)}</td>
      </tr>`;
    }).join('');
    document.getElementById('statWinner').style.display='';
  } else {
    document.getElementById('statWinner').style.display='none';
  }

  // 📊 盤型分析
  {
    const callFilled = callAll;
    const putFilled  = putAll;
    const callAvg = callFilled.length ? callPnl/callFilled.length : null;
    const putAvg  = putFilled.length  ? putPnl /putFilled.length  : null;
    let pattern='混合盤', detail='CALL 與 PUT 損益接近，盤勢不明顯。';
    if(callAvg!=null && putAvg!=null){
      if(callPnl>0 && putPnl>0){ pattern='雙邊獲利'; detail='CALL 與 PUT 均有獲利，市場波動大、進場時機佳。'; }
      else if(callPnl<0 && putPnl<0){ pattern='雙邊虧損'; detail='CALL 與 PUT 均虧損，當日走勢平穩或逆向反彈，進場時機欠佳。'; }
      else if(callPnl>putPnl){ pattern='CALL 占優'; detail=`CALL 平均損益 ${fmtNum(callAvg)}，優於 PUT 的 ${fmtNum(putAvg)}，偏多走勢。`; }
      else { pattern='PUT 占優'; detail=`PUT 平均損益 ${fmtNum(putAvg)}，優於 CALL 的 ${fmtNum(callAvg)}，偏空走勢。`; }
    } else if(callAvg!=null && putAvg==null){
      pattern = callPnl>=0?'CALL 獲利':'CALL 虧損';
      detail = `僅掃描到 CALL，平均損益 ${fmtNum(callAvg)}。`;
    } else if(putAvg!=null && callAvg==null){
      pattern = putPnl>=0?'PUT 獲利':'PUT 虧損';
      detail = `僅掃描到 PUT，平均損益 ${fmtNum(putAvg)}。`;
    }
    document.getElementById('statPatternBadge').innerHTML=`<span class="bt20-pattern-badge">${pattern}</span>`;
    document.getElementById('statPatternDetail').textContent=detail;
    document.getElementById('statPattern').style.display= allPos.length ? '' : 'none';
  }

  // 📉 曾觸及停損
  {
    const sub20Body = document.getElementById('statSub20Body');
    const subRows = allPos.filter(r=>r.exitReason==='停損').map(r=>({
      sideLabel: r.sideLabel,
      isCall: r.isCall,
      strike: r.strike,
      minPx: r.exitPrice,
      hitTime: r.exitTime ? r.exitTime.toLocaleTimeString() : '—'
    }));
    if(subRows.length){
      sub20Body.innerHTML = subRows.map(r=>`<tr>
        <td class="${r.isCall?'side-call':'side-put'}">${r.sideLabel}</td>
        <td>${r.strike}</td>
        <td style="color:#d32f2f">${r.minPx}</td>
        <td>${r.hitTime}</td>
      </tr>`).join('');
      document.getElementById('statSub20').style.display='';
    } else {
      document.getElementById('statSub20').style.display='none';
    }
  }
}

    // ==== 舊 15→20 排序（移除，不再需要） ====
    let bt20SortInited = false;
    function enableBacktestSorting20(){ /* 已廢棄 */ }

    // 再補一次左右履約價切換（保險）
    document.getElementById('prevStrikeBtn').addEventListener('click', ()=>moveStrike(-1));
    document.getElementById('nextStrikeBtn').addEventListener('click', ()=>moveStrike(1));

    // =====================================================================
    // ===== 📡 TAIFEX 指數選擇權最後結算價 爬蟲模組 =====
    // =====================================================================
    (function(){
      const TAIFEX_URL = 'https://www.taifex.com.tw/cht/5/optIndxFSP';
      const PROXIES = [
        u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      ];

      let fspData = [];
      let fspFiltered = [];

      const panel        = document.getElementById('fspPanel');
      const fspBody      = document.getElementById('fspBody');
      const fspStatus    = document.getElementById('fspStatus');
      const fspUpdatedAt = document.getElementById('fspUpdatedAt');
      const fspRowCount  = document.getElementById('fspRowCount');
      const fspProdFilter= document.getElementById('fspProdFilter');
      const fspTypeFilter= document.getElementById('fspTypeFilter');
      const fspSearch    = document.getElementById('fspSearch');
      const fspPasteArea = document.getElementById('fspPasteArea');
      const fspPasteInput= document.getElementById('fspPasteInput');
      const fspPasteHint = document.getElementById('fspPasteHint');
      const btnFetchFSP  = document.getElementById('btnFetchFSP');
      const btnFspRefresh= document.getElementById('btnFspRefresh');
      const btnFspClose  = document.getElementById('btnFspClose');
      const btnFspParse  = document.getElementById('btnFspParse');

      btnFspClose?.addEventListener('click', ()=>{ panel.style.display='none'; });
      btnFspRefresh?.addEventListener('click', ()=> fetchFSP());
      btnFetchFSP?.addEventListener('click', ()=>{
        panel.style.display = '';
        panel.scrollIntoView({behavior:'smooth', block:'start'});
        if(fspData.length){
          renderFSP();
        } else {
          // 立刻顯示貼上框，同時背景嘗試 proxy
          fspStatus.style.display = '';
          fspStatus.textContent = '⏳ 嘗試自動抓取中（通常會失敗，請直接用貼上法）...';
          fspPasteArea.style.display = '';
          fspPasteInput.value = '';
          fspPasteHint.textContent = '';
          fetchFSP(); // 背景跑，成功就自動填入
        }
      });
      btnFspParse?.addEventListener('click', ()=>{
        const raw = fspPasteInput.value.trim();
        if(!raw){ fspPasteHint.textContent = '請先貼上內容'; return; }
        fspPasteHint.textContent = '解析中...';
        const ok = parseAndApplyHTML(raw);
        if(ok){
          fspPasteHint.textContent = `✅ 解析成功，共 ${fspData.length} 筆`;
          fspPasteArea.style.display = 'none';
        } else {
          fspPasteHint.textContent = '⚠️ 找不到結算日資料，請確認貼上的是完整頁面內容';
        }
      });

      [fspProdFilter, fspTypeFilter].forEach(el => el?.addEventListener('change', renderFSP));
      fspSearch?.addEventListener('input', renderFSP);

      function isMonthly(cm){
        return /^\d{6}$/.test((cm||'').trim());
      }

      // ── 解析 HTML 或純文字（proxy 回傳 or 使用者貼上均適用）
      function parseAndApplyHTML(html){
        let rows = tryParseTable(html);
        if(!rows.length) rows = tryParseText(html);
        if(!rows.length) return false;
        fspData = rows;
        window._fspDataRef = fspData;
        const now = new Date();
        fspUpdatedAt.textContent = `更新於 ${now.toLocaleString('zh-TW')}`;
        fspStatus.style.display = 'none';
        renderFSP();
        buildContractSequence();
        return true;
      }

      // ── DOM 表格解析（proxy 回傳完整 HTML）
      function tryParseTable(html){
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          let dataTable = null;
          for(const t of doc.querySelectorAll('table')){
            const tx = t.textContent || '';
            if(tx.includes('結算日') && tx.includes('契約')){ dataTable = t; break; }
          }
          if(!dataTable) return [];
          const out = [];
          for(const tr of dataTable.querySelectorAll('tr')){
            const cells = Array.from(tr.querySelectorAll('td'));
            if(cells.length < 3) continue;
            const t = cells.map(c => c.textContent.replace(/\s+/g,' ').trim());
            if(!/\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(t[0])) continue;
            out.push({ settleDate: t[0].replace(/-/g,'/'), contractMonth: t[1]||'',
              txo: t[2]||'-', teo: t[3]||'-', tfo: t[4]||'-', isMonthly: isMonthly(t[1]) });
          }
          return out;
        } catch(_){ return []; }
      }

      // ── 純文字逐行解析（使用者 Ctrl+A Ctrl+C 貼上時）
      function tryParseText(text){
        const out = [];
        const lines = text.split(/\r?\n/);
        for(const line of lines){
          if(!/\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(line)) continue;
          const parts = line.trim().split(/[\t　\s]{2,}/).map(s=>s.trim()).filter(Boolean);
          if(parts.length < 2) continue;
          const dateStr = parts[0].replace(/-/g,'/');
          if(!/\d{4}\/\d{2}\/\d{2}/.test(dateStr)) continue;
          out.push({ settleDate: dateStr, contractMonth: parts[1]||'',
            txo: parts[2]||'-', teo: parts[3]||'-', tfo: parts[4]||'-',
            isMonthly: isMonthly(parts[1]) });
        }
        return out;
      }

      // ── 從本地後端 /api/fsp-data 載入（優先）
      async function loadFspFromBackend(){
        try {
          const ctrl = new AbortController();
          const tid  = setTimeout(() => ctrl.abort(), 5000);
          let res;
          try { res = await fetch('/api/fsp-data', { signal: ctrl.signal }); }
          finally { clearTimeout(tid); }
          if(!res || !res.ok) return false;
          const json = await res.json();
          if(!json || json.status !== 'success' || !json.data || !json.data.length) return false;
          fspData = json.data.map(r => ({
            settleDate:    r.settleDate,
            contractMonth: r.contractMonth,
            txo:           r.txo || '-',
            teo:           r.teo || '-',
            tfo:           r.tfo || '-',
            isMonthly:     isMonthly(r.contractMonth),
          }));
          window._fspDataRef = fspData;
          const now = new Date();
          fspUpdatedAt.textContent = `更新於 ${now.toLocaleString('zh-TW')}（後端資料）`;
          fspStatus.style.display = 'none';
          renderFSP();
          buildContractSequence();
          return true;
        } catch(_){ return false; }
      }

      // ── 自動嘗試後端，再嘗試 proxy（靜默失敗，全敗則顯示貼上法）
      async function fetchFSP(){
        fspStatus.style.display = '';
        fspStatus.textContent = '⏳ 嘗試自動抓取中...';
        fspBody.innerHTML = '';
        btnFetchFSP.disabled = true;
        btnFspRefresh && (btnFspRefresh.disabled = true);

        // 優先嘗試後端
        const backendOk = await loadFspFromBackend();
        if(backendOk){
          btnFetchFSP.disabled = false;
          btnFspRefresh && (btnFspRefresh.disabled = false);
          fspPasteArea.style.display = 'none';
          return;
        }

        // 貼上框顯示，等待 proxy 或使用者貼上
        fspPasteArea.style.display = '';
        fspPasteInput.value = '';
        fspPasteHint.textContent = '';

        let html = null;
        for(const makeProxy of PROXIES){
          try {
            const url = makeProxy(TAIFEX_URL);
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 12000);
            let res;
            try { res = await fetch(url, { signal: ctrl.signal }); }
            finally { clearTimeout(tid); }
            if(!res || !res.ok) continue;
            const text = await res.text();
            if(text && text.length > 500){ html = text; break; }
          } catch(_){ /* 靜默，繼續下一個 */ }
        }

        btnFetchFSP.disabled = false;
        btnFspRefresh && (btnFspRefresh.disabled = false);

        if(html && parseAndApplyHTML(html)){
          fspPasteArea.style.display = 'none'; // proxy 成功，隱藏貼上框
          return;
        }
        // 全部失敗 → 貼上框已顯示，更新提示文字
        fspStatus.textContent = '⚠️ 自動抓取失敗。請用下方手動貼上法（3步驟）：';
      }

      // ── 頁面啟動時自動從後端靜默載入 FSP 資料
      (async () => { await loadFspFromBackend(); })();

      // ── 篩選 + 渲染
      function renderFSP(){
        const prod = fspProdFilter.value;
        const type = fspTypeFilter.value;
        const kw   = (fspSearch.value||'').trim().toLowerCase();

        fspFiltered = fspData.filter(r => {
          // 商品篩選
          if(prod !== 'all'){
            if(prod==='TXO' && (r.txo==='-' || r.txo==='')) return false;
            if(prod==='TEO' && (r.teo==='-' || r.teo==='')) return false;
            if(prod==='TFO' && (r.tfo==='-' || r.tfo==='')) return false;
          }
          // 類型篩選
          if(type==='monthly' && !r.isMonthly) return false;
          if(type==='weekly'  &&  r.isMonthly) return false;
          // 關鍵字
          if(kw){
            const haystack = (r.settleDate+' '+r.contractMonth+' '+r.txo+' '+r.teo+' '+r.tfo).toLowerCase();
            if(!haystack.includes(kw)) return false;
          }
          return true;
        });

        fspRowCount.textContent = `共 ${fspFiltered.length} 筆`;

        if(!fspFiltered.length){
          fspBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:14px">無符合條件的資料</td></tr>';
          return;
        }

        const pnlColor = v => {
          if(!v || v==='-') return '';
          const n = parseFloat(v.replace(/,/g,''));
          return '';
        };

        fspBody.innerHTML = fspFiltered.map((r, i) => {
          const rowCls = r.isMonthly ? 'fsp-monthly' : 'fsp-weekly';
          const typeTag = r.isMonthly
            ? '<span style="background:#0052cc;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700">月</span>'
            : '<span style="background:#888;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;">週</span>';
          const tPrice = (v) => v && v!=='-'
            ? `<span class="fsp-price">${v}</span>`
            : `<span style="color:#bbb">-</span>`;

          return `<tr class="${rowCls}">
            <td style="color:#aaa;font-size:11px">${i+1}</td>
            <td>${r.settleDate}</td>
            <td style="font-weight:700">${r.contractMonth}</td>
            <td>${typeTag}</td>
            <td>${tPrice(r.txo)}</td>
            <td>${tPrice(r.teo)}</td>
            <td>${tPrice(r.tfo)}</td>
          </tr>`;
        }).join('');
      }

    // =====================================================================
    // ===== 契約序列模組（依 fspData 建立完整序列，篩選對應年份）=====
    // =====================================================================

    // 全域：已解析的完整契約序列（含每個契約的日期範圍）
    window._contractSeq = [];   // [{ key, label, contractMonth, settleDate, startDate, endDate, isMonthly }]

    const contractSelect = document.getElementById('contractSelect');

    // ── 判斷契約類型標籤（月選/W1~W5/F1~F5）
    function getContractTypeLabel(contractMonth){
      const m = (contractMonth||'').trim();
      // 月選：純 6 位數字 YYYYMM
      if(/^\d{6}$/.test(m)) return 'M';
      // 週契約：YYYYMMW1~W5
      const wm = m.match(/\d{6}W(\d)/i);
      if(wm) return `W${wm[1]}`;
      // F契約：YYYYMMF1~F5
      const fm = m.match(/\d{6}F(\d)/i);
      if(fm) return `F${fm[1]}`;
      return '?';
    }

    // ── 將 "YYYY/MM/DD" 字串轉成 Date（不含時間）
    function fspDateToObj(str){
      if(!str) return null;
      const parts = str.replace(/-/g,'/').split('/');
      if(parts.length < 3) return null;
      return new Date(+parts[0], +parts[1]-1, +parts[2]);
    }

    // ── 取得資料中包含的所有年份
    function getDataYears(){
      const years = new Set();
      for(const d of rawData){
        if(d.date && d.date.length >= 4) years.add(d.date.slice(0,4));
      }
      // 如果 rawData 是空的（還沒載入），就不篩年份
      return years;
    }

    // ── 從 fspData 建立完整契約序列 ──────────────────────────────────────
    function buildContractSequence(){
      const FSP = window._fspDataRef || [];
      if(!FSP.length){ contractSelect.innerHTML='<option value="">(無結算資料)</option>'; return; }

      // 依結算日升序排列
      const sorted = [...FSP].sort((a,b)=>{
        const da = fspDateToObj(a.settleDate), db = fspDateToObj(b.settleDate);
        return (da||0) - (db||0);
      });

      // 建立序列，計算每個契約的開始日（上一個契約結算日 +1 天）
      const seq = [];
      for(let i=0; i<sorted.length; i++){
        const r = sorted[i];
        const endDate   = fspDateToObj(r.settleDate);
        let   startDate = null;
        if(i === 0){
          // 第一筆：往前推一個月當作起點
          startDate = new Date(endDate);
          startDate.setMonth(startDate.getMonth() - 1);
        } else {
          const prevEnd = fspDateToObj(sorted[i-1].settleDate);
          startDate = new Date(prevEnd);
          startDate.setDate(startDate.getDate() + 1); // 前一個結算日 +1
        }
        const typeLabel = getContractTypeLabel(r.contractMonth);
        seq.push({
          key:           r.contractMonth,
          label:         `${r.contractMonth}（${r.settleDate}）`,
          contractMonth: r.contractMonth,
          settleDate:    r.settleDate,
          startDate,
          endDate,
          isMonthly:     r.isMonthly,
          typeLabel,
          txoFSP:        r.txo
        });
      }
      window._contractSeq = seq;

      // ── 依上傳資料的年份篩選（若 rawData 有資料才篩，否則顯示全部）
      const dataYears = getDataYears();
      const filtered = dataYears.size > 0
        ? seq.filter(s => {
            const y = (s.contractMonth||'').slice(0,4);
            return dataYears.has(y);
          })
        : seq;

      // 最新的在最上面
      const display = [...filtered].reverse();

      if(!display.length){
        contractSelect.innerHTML='<option value="">(無符合年份的契約)</option>';
        return;
      }

      contractSelect.innerHTML =
        '<option value="">— 選擇契約 —</option>' +
        display.map(s => {
          const cls = s.isMonthly ? 'opt-monthly' : 'opt-weekly';
          const icon = s.isMonthly ? '🔵' : (s.typeLabel.startsWith('W') ? '⚪' : '🟡');
          return `<option class="${cls}" value="${s.key}">${icon} ${s.contractMonth}　結算:${s.settleDate}　FSP:${s.txoFSP}</option>`;
        }).join('');

      contractSelect.disabled = false;
    }

    // ── 當 rawData 更新時（載入/合併），重新篩年份
    const _origAfterDataLoaded = window._afterDataLoadedHook;
    function refreshContractSelectByYear(){
      if(window._contractSeq && window._contractSeq.length) buildContractSequence();
    }


    // ── 選契約 → 篩選 rawData 日期範圍 → 重建圖表；選空時還原全部資料
    contractSelect.addEventListener('change', ()=>{
      const key = contractSelect.value;

      // ── 選空：還原全部資料
      if(!key){
        if(window._fullRawData){
          rawData   = window._fullRawData;
          txRawData = window._fullTxRawData;
          window._fullRawData   = null;
          window._fullTxRawData = null;
          buildDataIndex();
          updateSelectors(); rebuildPlayTimes(); renderChart(); rebuildTTable();
          updateTXBar(); updateBtUI(); updateAccountUI();
          loadStatus.textContent = '已還原全部合併資料';
        }
        return;
      }

      const contract = window._contractSeq.find(s => s.key === key);
      if(!contract) return;

      const fmt = d => {
        if(!d) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return `${y}${m}${dd}`;
      };
      const startKey = fmt(contract.startDate);
      const endKey   = fmt(contract.endDate);

      // 從原始完整資料篩（每次換契約都從完整資料切，不會越篩越小）
      const baseOp = window._fullRawData   || rawData;
      const baseFu = window._fullTxRawData || txRawData;
      if(!window._fullRawData){
        window._fullRawData   = rawData;
        window._fullTxRawData = txRawData;
      }

      const inRange = d => d.date >= startKey && d.date <= endKey;
      const filteredOp = baseOp.filter(inRange);
      const filteredFu = baseFu.filter(inRange);

      if(!filteredOp.length && !filteredFu.length){
        alert(`契約 ${key} 範圍 ${startKey}～${endKey} 內沒有資料（可能該日期段尚未上傳）`);
        return;
      }

      rawData   = filteredOp; window.rawData = rawData;
      txRawData = filteredFu; window.txRawData = txRawData;

      buildDataIndex();
      resetAccount();
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null;
      trendChartInited=false; trendChartKey='';
      taChartInited = false; taChartKey = ''; txChartInited = false; txChartKey = ''; if(typeof _txClearCache==='function') _txClearCache();
      cutoffTime=null; simTime=null;
      autoOrderActive=false; autoOrderPositions=[]; autoOrderEnteredKeys=new Set();
      s1Status.textContent='未啟動'; s1Status.className='s1-status stopped';
      bt20Run.style.display=''; bt20Stop.style.display='none';
      s1Cards.style.display='none'; s1TblWrap.style.display='none';
      s1Body.innerHTML='<tr><td colspan="9" style="text-align:center;color:#aaa;padding:14px">請設定條件後按「啟動自動下單」，再開始回測播放</td></tr>';
      ['statWinner','statPattern','statSub20'].forEach(id=>document.getElementById(id).style.display='none');

      if(rawData.length){
        updateSelectors();
        rebuildPlayTimes();
        renderChart();
        rebuildTTable();
      }
      updateTXBar(); updateBtUI(); updateAccountUI();

      const label = `${contract.contractMonth}（${startKey}～${endKey}）`;
      loadStatus.textContent = `契約 ${label}：OP ${filteredOp.length.toLocaleString()} 筆 / FU ${filteredFu.length.toLocaleString()} 筆`;
    });


    })(); // end FSP module