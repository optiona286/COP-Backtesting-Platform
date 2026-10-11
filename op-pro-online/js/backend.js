const BACKEND_API = window.OP_PRO_CONFIG.apiBase.replace(/\/$/, '');

let backendContractsByKey = new Map();
let backendContractSeq = 0;
let backendInfoController = null;
let backendDataController = null;
let backendTaiexController = null;
let backendTaiexSeq = 0;
const taiexLoadCache = new Map(); // settleDateIso -> Promise<Array>
let taiexPublishedKey = ''; // 目前已發布到前端索引的日期／區間，避免快取命中仍重建
let backendViewMode = 'settlement'; // settlement | merge | single
let backendSelectedTradeDate = '';
let backendContractDefaultsApplied = false;
let settlementViewInitialized = false;
let beforeSettlementView = null;
let backendDaysManuallySelected = false;
// Manual session choices are kept independently for each market during this page session.
const mergedMarketSessions = new Map();
window.rememberMergedMarketSession = function(session){
  if(backendViewMode === 'merge') mergedMarketSessions.set(window.currentMarket || 'taiex', session);
};
window.applyMergedMarketSession = function(){
  if(backendViewMode !== 'merge') return;
  const market = window.currentMarket || 'taiex';
  const select = document.getElementById('sessionSelect');
  if(select) select.value = mergedMarketSessions.get(market) || (market === 'tx' ? '全部' : '一般');
};
window.taiexPrevCloseByDate = window.taiexPrevCloseByDate || {};

function rememberTaiexPreviousClose(dateIso, previousClose){
  if(!dateIso || !previousClose) return;
  const price = Number(previousClose.price);
  if(!Number.isFinite(price)) return;
  window.taiexPrevCloseByDate[dateIso] = price;
  window.taiexPrevCloseByDate[String(dateIso).replace(/-/g,'')] = price;
}

function rememberTaiexPreviousCloseMap(map){
  for(const [dateIso, previousClose] of Object.entries(map || {})){
    rememberTaiexPreviousClose(dateIso, previousClose);
  }
}

function settleDateToIso(settleDate){
  const s = String(settleDate||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g,'-');
  if(/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  if(/^\d{4}_\d{2}_\d{2}$/.test(s)) return s.replace(/_/g,'-');
  return null;
}

function setCurrentTradeDateKey(dateKey){
  const iso = settleDateToIso(dateKey);
  window.currentTradeDateKey = dateKey || '';
  window.currentTradeDateIso = iso;
  return iso;
}
window.setCurrentTradeDateKey = setCurrentTradeDateKey;

function getSelectedTradeDateIso(){
  if(window._backendModeActive && backendViewMode !== 'merge' && backendSelectedTradeDate){
    return settleDateToIso(backendSelectedTradeDate);
  }
  const dateSelectEl = document.getElementById('dateSelect');
  const raw = dateSelectEl && dateSelectEl.value && dateSelectEl.value !== '__merge__'
    ? dateSelectEl.value
    : window.currentTradeDateKey;
  let iso = settleDateToIso(raw);
  if(iso) return iso;

  const loaded = (window.rawData && window.rawData[0]) || (window.txRawData && window.txRawData[0]);
  if(loaded && loaded.date) iso = settleDateToIso(loaded.date);
  return iso;
}
window.getSelectedTradeDateIso = getSelectedTradeDateIso;

function isTaiexDisplayTick(d){
  const time = String(d && d.time || '').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6);
  // 原始索引保留 09:00:00，K 線聚合會在所有週期排除這筆開盤前置值。
  return time >= '090000';
}
window.isTaiexDisplayTick = isTaiexDisplayTick;

function publishTaiexData(arr, dateIso, error = ''){
  const raw = Array.isArray(arr) ? arr.slice() : [];
  const index = raw.filter(isTaiexDisplayTick).sort((a, b) => a.dtms - b.dtms);
  window.taiexRawData = raw;
  window.taiexDataIndex = index;
  window.taiexDateIso = dateIso || null;
  window.taiexLastError = error || '';
  taiexPublishedKey = dateIso || '';

  if(typeof window.buildTaiexIndex === 'function'){
    try { window.buildTaiexIndex(); } catch(err){ console.warn('[TAIEX] buildTaiexIndex failed:', err); }
    window.taiexRawData = raw;
    window.taiexDataIndex = index;
  }
}
window.publishTaiexData = publishTaiexData;

async function loadTaiexData(settleDate, { refreshUi = true } = {}){
  const dateIso = settleDateToIso(settleDate);
  window.taiexRequestedDateIso = dateIso;
  if(!dateIso){
    publishTaiexData([], null);
    return [];
  }

  // 同合約期間如果已載過，直接重用 cache
  if(taiexLoadCache.has(dateIso)){
    try {
      const arr = await taiexLoadCache.get(dateIso);
      if(taiexPublishedKey !== dateIso) publishTaiexData(arr, dateIso);
      return arr;
    } catch(_){ taiexLoadCache.delete(dateIso); }
  }

  const seq = ++backendTaiexSeq;
  if(backendTaiexController) backendTaiexController.abort();
  backendTaiexController = new AbortController();

  const promise = (async () => {
    const response = await fetch(`${BACKEND_API}/api/taiex/${dateIso}`, {
      signal: backendTaiexController.signal
    });
    if(!response.ok){
      let message = `TAIEX HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if(errJson && errJson.message) message = errJson.message;
      } catch(_){}
      window.taiexLastError = message;
      if(response.status === 404){
        console.log(`[TAIEX] no data for ${dateIso}: ${message}`);
        return [];
      }
      throw new Error(message);
    }
    const json = await response.json();
    if(json.status !== 'success') return [];
    rememberTaiexPreviousClose(json.dateIso || dateIso, json.previousClose);
    return (json.data||[]).map(d => ({
      ...d,
      date: d.date,
      time: d.time,
      dtms: d.dtms,
      price: d.price,
      volume: d.volume,
      product: 'TAIEX',
    }));
  })();

  taiexLoadCache.set(dateIso, promise);

  try {
    const arr = await promise;
    if(seq !== backendTaiexSeq) return arr; // 已被新請求蓋掉
    publishTaiexData(arr, dateIso);
    // 通知 UI 更新
    if(typeof window.onTaiexLoaded === 'function') window.onTaiexLoaded(dateIso, arr.length);
    if(refreshUi){
      const _ct = (typeof cutoffTime !== 'undefined') ? cutoffTime : (window.cutoffTime || null);
      if(typeof updateTXBar === 'function') updateTXBar(_ct);
      if(typeof updateCompareTab === 'function') updateCompareTab(_ct);
      if(typeof renderChart === 'function') renderChart(_ct);
      if(window.currentMarket === 'taiex' && !window._btPlaying && typeof rebuildPlayTimes === 'function') rebuildPlayTimes();
    }
    if(arr.length){
      console.log(`[TAIEX] loaded ${dateIso}: ${arr.length} ticks`);
    } else {
      console.log(`[TAIEX] no data for ${dateIso}`);
    }
    return arr;
  } catch(error){
    if(error.name === 'AbortError') return [];
    console.error('[TAIEX] load failed:', error);
    taiexLoadCache.delete(dateIso);
    publishTaiexData([], null, error.message || String(error));
    return [];
  }
}
window.loadTaiexData = loadTaiexData;

async function loadTaiexDisplayedRange(startDate, endDate, { refreshUi = true } = {}){
  const startIso = settleDateToIso(startDate);
  const endIso = settleDateToIso(endDate);
  window.taiexRequestedDateIso = endIso;
  if(!startIso || !endIso) return [];

  const cacheKey = `range:${startIso}:${endIso}`;
  if(taiexLoadCache.has(cacheKey)){
    const arr = await taiexLoadCache.get(cacheKey);
    const publishedKey = `${startIso}～${endIso}`;
    if(taiexPublishedKey !== publishedKey) publishTaiexData(arr, publishedKey);
    return arr;
  }

  const seq = ++backendTaiexSeq;
  if(backendTaiexController) backendTaiexController.abort();
  backendTaiexController = new AbortController();
  const promise = (async () => {
    const response = await fetch(`${BACKEND_API}/api/taiex-range?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`, {
      signal: backendTaiexController.signal
    });
    if(!response.ok) throw new Error(`TAIEX range HTTP ${response.status}`);
    const json = await response.json();
    if(json.status !== 'success') return [];
    rememberTaiexPreviousCloseMap(json.previousCloses);
    window.taiexRangeMeta = { startIso:json.startIso, endIso:json.endIso, dateCount:json.dateCount };
    return (json.data||[]).map(d => ({
      ...d,
      date:d.date, time:d.time, dtms:d.dtms, price:d.price,
      volume:d.volume, product:'TAIEX'
    }));
  })();
  taiexLoadCache.set(cacheKey, promise);

  try{
    const arr = await promise;
    if(seq !== backendTaiexSeq) return arr;
    const meta = window.taiexRangeMeta || {};
    publishTaiexData(arr, `${meta.startIso || ''}～${meta.endIso || endIso}`);
    if(typeof window.onTaiexLoaded === 'function') window.onTaiexLoaded(endIso, arr.length);
    if(refreshUi){
      const _ct = (typeof cutoffTime !== 'undefined') ? cutoffTime : (window.cutoffTime || null);
      if(typeof updateTXBar === 'function') updateTXBar(_ct);
      if(typeof updateCompareTab === 'function') updateCompareTab(_ct);
      if(typeof renderChart === 'function') renderChart(_ct);
      if(window.currentMarket === 'taiex' && !window._btPlaying && typeof rebuildPlayTimes === 'function') rebuildPlayTimes();
    }
    return arr;
  } catch(error){
    if(error.name === 'AbortError') return [];
    taiexLoadCache.delete(cacheKey);
    publishTaiexData([], null, error.message || String(error));
    return [];
  }
}
window.loadTaiexDisplayedRange = loadTaiexDisplayedRange;

async function loadTaiexForSelectedTradeDate({ silent = false, refreshUi = true } = {}){
  if(window._backendModeActive && backendViewMode === 'merge'){
    const displayedDates = window._backendDisplayedDates || [];
    const startIso = settleDateToIso(displayedDates[0]);
    const endIso = settleDateToIso(displayedDates[displayedDates.length - 1]);
    const hint = document.getElementById('txHint');
    if(window.currentMarket === 'taiex' && hint) hint.textContent = `（載入 ${startIso || '--'}～${endIso || '--'} 加權資料中）`;
    const arr = await loadTaiexDisplayedRange(startIso, endIso, { refreshUi });
    if(!arr.length && !silent && window.currentMarket === 'taiex') showNotification('目前顯示區間無加權資料', 'error');
    return arr;
  }
  const dateIso = getSelectedTradeDateIso();
  const hint = document.getElementById('txHint');

  if(!dateIso){
    await loadTaiexData(null);
    if(window.currentMarket === 'taiex'){
      const _ct = (typeof cutoffTime !== 'undefined') ? cutoffTime : (window.cutoffTime || null);
      if(hint){
        hint.style.display = 'inline';
        hint.textContent = '（請先選擇單一交易日）';
      }
      if(!silent) showNotification('請先選擇單一交易日，才能載入加權資料', 'error');
      if(typeof updateTXBar === 'function') updateTXBar(_ct);
      if(typeof updateCompareTab === 'function') updateCompareTab(_ct);
      if(typeof renderChart === 'function') renderChart(_ct);
    }
    return [];
  }

  if(window.currentMarket === 'taiex' && hint){
    hint.style.display = 'inline';
    hint.textContent = `（載入 ${dateIso} 加權資料中）`;
  }

  const arr = await loadTaiexData(dateIso, { refreshUi });
  if(!arr.length && !silent && window.currentMarket === 'taiex'){
    const reason = window.taiexLastError ? `：${window.taiexLastError}` : '';
    showNotification(`${dateIso} 無加權資料${reason}`, 'error');
  }
  return arr;
}
window.loadTaiexForSelectedTradeDate = loadTaiexForSelectedTradeDate;

document.addEventListener('DOMContentLoaded', async function() {
  console.log('Initializing backend contract loader...');
  await loadContractsFromBackend();
  setupBackendContractListener();
});

async function loadContractsFromBackend() {
  try {
    const response = await fetch(`${BACKEND_API}/api/contracts`);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    if (result.status === 'success' && Array.isArray(result.contracts)) {
      backendContractsByKey = new Map(result.contracts.map(c => [c.key, c]));
      window._backendModeActive = true;
      populateContractSelect(result.contracts);
      populateSettlementSelect(result.contracts);
      showNotification(`已載入 ${result.contracts.length} 個契約`, 'success');
    } else throw new Error(result.message || '後端契約清單格式錯誤');
  } catch (error) {
    console.error('Backend connection failed:', error);
    const dates = document.getElementById('dateSelect');
    dates.innerHTML = '<option value="">（後端結算日載入失敗，請重新整理）</option>';
    dates.disabled = true;
    showNotification(`無法連接後端: ${error.message}`, 'error');
  }
}

function populateSettlementSelect(contracts) {
  const select = document.getElementById('dateSelect');
  const selected = select.value;
  select.innerHTML = '<option value="">— 選擇單一結算日 —</option>';
  contracts.filter(c => settleDateToIso(c.settleDate))
    .sort((a, b) => settleDateToIso(b.settleDate).localeCompare(settleDateToIso(a.settleDate)))
    .forEach(c => {
      const option = makeContractOption(c, true);
      select.appendChild(option);
    });
  select.value = backendContractsByKey.has(selected) ? selected : '';
  select.disabled = contracts.length === 0;
}

function makeContractOption(c, settlementOnly = false) {
  const opt = document.createElement('option');
  const type = String(c.typeLabel || '').toUpperCase();
  const marker = type === 'M' ? '🔵' : (type === 'F' ? '🟡' : '⚪');
  const settleDate = String(c.settleDate || '-').replace(/-/g, '/');
  const fsp = c.txoFSP ?? '-';

  opt.value = c.key;
  opt.className = `contract-option contract-${type.toLowerCase()}`;
  opt.dataset.settleDate = c.settleDate || '';
  opt.dataset.txoFSP = fsp;
  opt.dataset.typeLabel = type;
  opt.textContent = settlementOnly
    ? `${marker}  ${settleDateToIso(c.settleDate).replace(/-/g, '/')} · ${c.key}`
    : `${marker}  ${c.key}    結算:${settleDate}    FSP:${fsp}`;
  return opt;
}

function populateContractSelect(contracts) {
  const selectElement = document.getElementById('contractSelect');
  if (!selectElement) return;

  selectElement.innerHTML = '<option value="">— 選擇契約 —</option>';

  // Keep the backend's settlement-date order so monthly, weekly and Friday
  // contracts appear as one chronological list, with a light month divider.
  let previousYearMonth = '';
  contracts.forEach(c => {
    const keyMonth = String(c.key || '').match(/^(\d{4})(\d{2})/);
    const dateMonth = String(c.settleDate || '').match(/^(\d{4})[-/](\d{2})/);
    const parts = keyMonth || dateMonth;
    const yearMonth = parts ? `${parts[1]} / ${parts[2]}` : '';

    if(yearMonth && yearMonth !== previousYearMonth){
      const divider = document.createElement('option');
      divider.disabled = true;
      divider.className = 'contract-divider';
      divider.textContent = `────  ${yearMonth}  ────`;
      selectElement.appendChild(divider);
      previousYearMonth = yearMonth;
    }

    selectElement.appendChild(makeContractOption(c));
  });

  selectElement.disabled = false;
  const controls = document.getElementById('backendViewControls');
  if(controls) controls.style.display = 'inline-flex';
}

function populateBackendTradeDateSelect(resultMeta) {
  const selectEl = document.getElementById('backendTradeDateSelect');
  if(!selectEl) return;
  const dates = (resultMeta.contractAvailableDates && resultMeta.contractAvailableDates.length)
    ? resultMeta.contractAvailableDates
    : (resultMeta.availableDates && resultMeta.availableDates.length)
      ? resultMeta.availableDates
    : (resultMeta.dateRange || []);
  window._backendAvailableDates = dates.slice();
  if(backendViewMode !== 'settlement' && !dates.includes(backendSelectedTradeDate)) backendSelectedTradeDate = dates[dates.length - 1] || '';
  selectEl.innerHTML = dates.map(date => {
    const iso = settleDateToIso(date) || date;
    return `<option value="${date}">${iso.replace(/-/g, '/')}</option>`;
  }).join('');
  selectEl.value = backendSelectedTradeDate;
}

function syncBackendViewControls() {
  const settlementBtn = document.getElementById('backendModeSettlement');
  const mergeBtn = document.getElementById('backendModeMerge');
  const singleBtn = document.getElementById('backendModeSingle');
  const dateEl = document.getElementById('backendTradeDateSelect');
  const daysEl = document.getElementById('daysViewSelect');
  if(mergeBtn) mergeBtn.classList.toggle('active', backendViewMode === 'merge');
  if(singleBtn) singleBtn.classList.toggle('active', backendViewMode === 'single');
  if(dateEl) dateEl.style.display = backendViewMode === 'single' ? '' : 'none';
  if(daysEl) daysEl.disabled = backendViewMode !== 'merge';
  if(settlementBtn) settlementBtn.classList.toggle('active', backendViewMode === 'settlement');
  const settlementSelect = document.getElementById('dateSelect');
  if(settlementSelect) settlementSelect.value = backendViewMode === 'settlement'
    ? document.getElementById('contractSelect').value : '';
  window._backendViewMode = backendViewMode;
  window.dispatchEvent(new Event('op-backend-view-change'));
}

function filterBackendSingleTradeDate(rows, tradeDate) {
  const dates = window._backendAvailableDates || [];
  const index = dates.indexOf(tradeDate);
  const prevDate = index > 0 ? dates[index - 1] : null;
  return rows.filter(d => {
    const date = String(d.date || '');
    const time = String(d.time || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6);
    if(date === tradeDate) return time <= '134500';
    if(prevDate && date === prevDate) return time >= '150000';
    return !!prevDate && date > prevDate && date < tradeDate;
  });
}

function setupBackendContractListener() {
  const selectElement = document.getElementById('contractSelect');
  if (!selectElement) return;

  selectElement.addEventListener('change', async (event) => {
    const contractKey = event.target.value;
    if (!contractKey) return;

    showContractQuickInfo(contractKey);
    await loadContractDataFromBackend(contractKey);
  });
}

function setDaysViewOptions(totalDays) {
  const dvsEl = document.getElementById('daysViewSelect');
  if (!dvsEl) return;

  const cur = dvsEl.value;
  let opts = '<option value="0">全部</option>';
  const optionDays = Math.max(Number(totalDays) || 0, 3, parseInt(cur, 10) || 0);
  for (let i = 1; i <= optionDays; i++) {
    opts += `<option value="${i}">最後 ${i} 日</option>`;
  }
  dvsEl.innerHTML = opts;
  dvsEl.value = cur || '0';
}

function setBackendViewMode(mode) {
  if(mode === backendViewMode) return;
  if(backendViewMode === 'settlement' && beforeSettlementView){
    document.getElementById('sessionSelect').value = beforeSettlementView.session;
    document.getElementById('periodSelect').value = beforeSettlementView.period;
  }
  beforeSettlementView = null;
  settlementViewInitialized = false;
  backendViewMode = mode;
  // Apply immediately on entry, even before a contract request finishes.
  initializeSettlementView();
}

function initializeSettlementView(){
  if(backendViewMode !== 'settlement' || settlementViewInitialized) return;
  const sessionEl = document.getElementById('sessionSelect');
  const periodEl = document.getElementById('periodSelect');
  beforeSettlementView = { session:sessionEl?.value, period:periodEl?.value };
  if(sessionEl) sessionEl.value = '一般';
  if(periodEl) periodEl.value = '5';
  settlementViewInitialized = true;
}

function applyBackendContractDefaults(contract) {
  // Backend defaults are startup defaults only. Once the first contract has
  // been loaded, preserve the user's current view settings across contracts.
  const year = Number(String(contract?.settleDate || contract?.key || '').slice(0, 4));
  const daysEl = document.getElementById('daysViewSelect');
  const sessionEl = document.getElementById('sessionSelect');
  const periodEl = document.getElementById('periodSelect');

  if(!backendContractDefaultsApplied){
    if(!settlementViewInitialized){
      if(sessionEl) sessionEl.value = '一般';
      if(periodEl) periodEl.value = '15';
    }
    backendContractDefaultsApplied = true;
  }
  window.applyMergedMarketSession();
  if(backendViewMode === 'merge' && !backendDaysManuallySelected && daysEl){
    daysEl.value = year >= 2020 && year <= new Date().getFullYear() ? '3' : '0';
  }
  // Only initialize on entry; changing settlement dates preserves user choices.
  initializeSettlementView();
}

function showContractQuickInfo(contractKey) {
  const c = backendContractsByKey.get(contractKey);
  if (!c || !loadStatus) return;

  const fsp = (c.txoFSP == null || c.txoFSP === '') ? '-' : Number(c.txoFSP).toLocaleString();
  loadStatus.textContent = `${contractKey} | 結算 ${c.settleDate || '-'} | FSP ${fsp} | 讀取區間中...`;
}

async function loadContractInfoFromBackend(contractKey, seq) {
  if (backendInfoController) backendInfoController.abort();
  backendInfoController = new AbortController();

  const response = await fetch(`${BACKEND_API}/api/contract-info/${contractKey}`, {
    signal: backendInfoController.signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const info = await response.json();
  if (seq !== backendContractSeq || info.status !== 'success') return null;

  setDaysViewOptions(info.totalDays);

  const files = info.files || {};
  const prev = info.prevContract ? info.prevContract.key : '-';
  const missing = info.missingDates && info.missingDates.length ? ` | 缺 ${info.missingDates.length} 日` : '';
  loadStatus.textContent =
    `${contractKey} | ${info.startDate}~${info.endDate} | 前約 ${prev} | 檔案 ${files.total || 0} | 日期 ${files.availableDays || 0}/${info.totalDays}${missing} | 載入 tick 中...`;

  return info;
}

async function loadContractDataFromBackend(contractKey, { tradeDate = '' } = {}) {
  const seq = ++backendContractSeq;
  const loadingToken = window.showOPProLoading?.('正在切換契約', contractKey);

  try {
    loadStatus.textContent = `載入 ${contractKey} 中...`;

    const info = await loadContractInfoFromBackend(contractKey, seq);
    if (seq !== backendContractSeq || !info) return;
    applyBackendContractDefaults(info.contract);
    populateBackendTradeDateSelect(info);
    if(backendViewMode === 'settlement') {
      tradeDate = String(info.contract.settleDate).replace(/[^0-9]/g, '');
    } else if(backendViewMode === 'single' && !tradeDate) {
      tradeDate = backendSelectedTradeDate;
    }
    backendSelectedTradeDate = tradeDate || '';
    syncBackendViewControls();

    if (backendDataController) backendDataController.abort();
    backendDataController = new AbortController();

    const query = new URLSearchParams();
    if(tradeDate){
      query.set('date', String(tradeDate).replace(/[^0-9]/g, ''));
    } else {
      const daysEl = document.getElementById('daysViewSelect');
      query.set('days', daysEl ? String(parseInt(daysEl.value, 10) || 0) : '0');
    }
    const response = await fetch(`${BACKEND_API}/api/contract-data/${contractKey}?${query}`, {
      signal: backendDataController.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('JSON parse failed, tail:', text.slice(-300));
      throw new Error(`JSON 解析失敗，回應約 ${(text.length / 1024).toFixed(0)} KB`);
    }

    if (seq !== backendContractSeq) return;

    if (result.status === 'success') {
      const { totalOp = 0, totalFu = 0, filesFound = 0 } = result.summary || {};

      console.log(`Loaded ${contractKey}: OP ${totalOp}, FU ${totalFu}, files ${filesFound}`);
      setDaysViewOptions(result.totalDays);
      processBackendData(result);

      // 加權資料只依目前前端選取的交易日載入，不再跟契約結算日綁定。
      if(window.currentMarket === 'taiex'){
        loadTaiexForSelectedTradeDate({ silent: true }).catch(err => console.warn('[TAIEX] load error', err));
      }

      showNotification(
        `${contractKey}: OP ${totalOp.toLocaleString()} 筆 / FU ${totalFu.toLocaleString()} 筆`,
        'success'
      );
    } else {
      throw new Error(result.message || '後端回傳失敗');
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Load contract failed:', error);
    loadStatus.textContent = `載入失敗：${error.message}`;
    showNotification(`${error.message}`, 'error');
  } finally {
    window.hideOPProLoading?.(loadingToken);
  }
}

window._backendDateRange = [];

function processBackendData(result) {
  const opRaw = result.opData || [];
  const fuRaw = result.fuData || [];

  const opData = opRaw.map(d => {
    return { ...d, dtms: d.isBar ? d.dtms : +makeDateObj(d.date, d.time) };
  }).filter(d => !isNaN(d.price) && !isNaN(d.volume));

  const fuData = fuRaw.map(d => {
    return { ...d, dtms: d.isBar ? d.dtms : +makeDateObj(d.date, d.time) };
  }).filter(d => !isNaN(d.price) && d.price > 0);

  if (!opData.length && !fuData.length) showNotification('所選日期無有效資料', 'error');

  window._backendDateRange = result.dateRange || [];
  window._backendResultMeta = result;
  window._fullBackendOp = opData;
  window._fullBackendFu = fuData;
  applyBackendContractDefaults(result.contract);
  populateBackendTradeDateSelect(result);
  syncBackendViewControls();

  applyDaysViewFilter(opData, fuData, result);
}

function applyDaysViewFilter(opData, fuData, resultMeta) {
  opData = opData || window._fullBackendOp || [];
  fuData = fuData || window._fullBackendFu || [];
  resultMeta = resultMeta || window._backendResultMeta || {};

  const daysViewEl = document.getElementById('daysViewSelect');
  const n = daysViewEl ? parseInt(daysViewEl.value, 10) : 0;

  let filteredOp = opData;
  let filteredFu = fuData;

  if(backendViewMode !== 'merge' && backendSelectedTradeDate){
    filteredOp = filterBackendSingleTradeDate(opData, backendSelectedTradeDate);
    filteredFu = filterBackendSingleTradeDate(fuData, backendSelectedTradeDate);
    setCurrentTradeDateKey(backendSelectedTradeDate);
    window._backendDisplayedDates = [backendSelectedTradeDate];
  } else if (resultMeta.requestedDays > 0) {
    setCurrentTradeDateKey('');
    window._backendDisplayedDates = window._backendDateRange.slice();
  } else if (n > 0 && window._backendDateRange.length > 0) {
    setCurrentTradeDateKey('');
    const allDates = window._backendDateRange;
    const keepDates = new Set(allDates.slice(-n));
    window._backendDisplayedDates = Array.from(keepDates);
    const firstDate = allDates[allDates.length - n];
    const firstDateIdx = allDates.indexOf(firstDate);
    const prevDate = firstDateIdx > 0 ? allDates[firstDateIdx - 1] : null;

    const isNightSession = (d) => {
      if (keepDates.has(d.date)) return true;

      if (prevDate) {
        if (d.date === prevDate) {
          const t = (d.time || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6);
          return t >= '150000';
        }
        if (d.date > prevDate && d.date < firstDate) return true;
      }

      return false;
    };

    filteredOp = opData.filter(isNightSession);
    filteredFu = fuData.filter(isNightSession);
  } else {
    setCurrentTradeDateKey('');
    window._backendDisplayedDates = window._backendDateRange.slice();
  }

  if (typeof window.stopPlayback === 'function' && (window._btPlaying || cutoffTime !== null)) {
    window.stopPlayback();
  }

  rawData = filteredOp;
  txRawData = filteredFu;
  window.rawData = rawData;
  window.txRawData = txRawData;

  resetAccount();
  prevTTablePrices.clear(); _ttLastExpiry = null; _ttLastCutMs = -1; _ttLastSess = null;
  trendChartInited = false; trendChartKey = '';
  taChartInited = false; taChartKey = '';
  cutoffTime = null; simTime = null;
  window.cutoffTime = null; window._lastCutoff = null; window._btPlaying = false; window.playing = false;
  autoOrderActive = false;
  autoOrderPositions = [];
  autoOrderEnteredKeys = new Set();

  if (typeof buildDataIndex === 'function') buildDataIndex();
  window._activeContractInfo = resultMeta.contract || null;
  if (typeof updateSelectors === 'function') updateSelectors();
  if (typeof updateTQuoteExpiryHeader === 'function') updateTQuoteExpiryHeader();
  if (typeof rebuildPlayTimes === 'function') rebuildPlayTimes();
  if (typeof renderChart === 'function') renderChart();
  if (typeof rebuildTTable === 'function') rebuildTTable();
  if (typeof updateTXBar === 'function') updateTXBar();
  if (typeof updateBtUI === 'function') updateBtUI();
  if (typeof updateAccountUI === 'function') updateAccountUI();

  const label = resultMeta.contract ? resultMeta.contract.key : '';
  const totalDays = resultMeta.totalDays || window._backendDateRange.length;
  const showDays = backendViewMode !== 'merge' ? 1 : window._backendDateRange.length;
  loadStatus.textContent =
    `${label} | ${backendViewMode === 'settlement' ? `結算日 ${settleDateToIso(backendSelectedTradeDate)} | ` : ''}顯示 ${showDays}/${totalDays} 日 | OP ${filteredOp.length.toLocaleString()} 筆 / FU ${filteredFu.length.toLocaleString()} 筆${resultMeta.shortfallDays > 0 ? ` | 該契約可用資料不足，尚缺 ${resultMeta.shortfallDays} 個交易日` : ''}`;

  // 後端模式的契約選單由 populateContractSelect 建立，包含月份分隔與 M/W/F 樣式；
  // 契約資料載入後不可再用一般模式的 buildContractSequence 覆蓋。
  if (!window._backendModeActive && window._contractSeq && window._contractSeq.length) buildContractSequence();
  window._fullRawData = null;
  window._fullTxRawData = null;
}

async function refreshBackendView(title, detail) {
  const loadingToken = window.showOPProLoading?.(title, detail);
  try {
    applyDaysViewFilter();
    if(window.currentMarket === 'taiex'){
      await loadTaiexForSelectedTradeDate({ silent:true });
    }
  } finally {
    window.hideOPProLoading?.(loadingToken);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const settlementSelect = document.getElementById('dateSelect');
  settlementSelect.addEventListener('change', async () => {
    if(!settlementSelect.value) return;
    setBackendViewMode('settlement');
    document.getElementById('contractSelect').value = settlementSelect.value;
    syncBackendViewControls();
    await loadContractDataFromBackend(settlementSelect.value);
  });
  document.getElementById('backendModeSettlement').addEventListener('click', async () => {
    setBackendViewMode('settlement');
    syncBackendViewControls();
    const key = document.getElementById('contractSelect').value;
    if(key) await loadContractDataFromBackend(key);
  });
  const dvsEl = document.getElementById('daysViewSelect');
  if (dvsEl) {
    dvsEl.addEventListener('change', async () => {
      backendDaysManuallySelected = true;
      const contractKey = document.getElementById('contractSelect')?.value || '';
      if(window._backendModeActive && contractKey){
        await loadContractDataFromBackend(contractKey);
      } else if (window._fullBackendOp && window._fullBackendOp.length) {
        applyDaysViewFilter();
      }
    });
  }
  const mergeBtn = document.getElementById('backendModeMerge');
  const singleBtn = document.getElementById('backendModeSingle');
  const dateEl = document.getElementById('backendTradeDateSelect');
  if(mergeBtn) mergeBtn.addEventListener('click', async () => {
    setBackendViewMode('merge');
    syncBackendViewControls();
    const contractKey = document.getElementById('contractSelect')?.value || '';
    if(contractKey){
      await loadContractDataFromBackend(contractKey);
    }
  });
  if(singleBtn) singleBtn.addEventListener('click', async () => {
    setBackendViewMode('single');
    syncBackendViewControls();
    const contractKey = document.getElementById('contractSelect')?.value || '';
    if(contractKey){
      await loadContractDataFromBackend(contractKey);
    }
  });
  if(dateEl) dateEl.addEventListener('change', async () => {
    backendSelectedTradeDate = dateEl.value || '';
    const contractKey = document.getElementById('contractSelect')?.value || '';
    if(contractKey && backendSelectedTradeDate){
      await loadContractDataFromBackend(contractKey, { tradeDate: backendSelectedTradeDate });
    }
  });
  syncBackendViewControls();
});

function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  const notificationEl = document.getElementById('notification');
  if (notificationEl) {
    notificationEl.className = `notification ${type}`;
    notificationEl.textContent = message;
    notificationEl.style.display = 'block';
    setTimeout(() => { notificationEl.style.display = 'none'; }, 3000);
  }
}
