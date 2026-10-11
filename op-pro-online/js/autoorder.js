// ── parseOrderKey: v10 由此解析 pos.key → {expiry, strike, type}
function parseOrderKey(key){
  const parts = key.split('|');
  if(parts[0] === 'TX') return { type:'TX', expiry:parts[1]||'', strike:'' };
  return { type:parts[2]||'', expiry:parts[0]||'', strike:parts[1]||'' };
}

// ====== 20 點回測日期初始化（保留空函式以防其他地方引用） ======
function init20BacktestDates(){ /* 已由條件委託單取代 */ }

// ====== 條件委託單主程式（自動下單引擎） ======

// ★ 回測參數快取：啟動時讀取一次，避免每個 tick 重複讀 DOM
let _aoParams = null;

document.addEventListener('DOMContentLoaded', function(){
  var bt20Run = window.bt20Run || document.getElementById('bt20Run');
  var bt20Stop= window.bt20Stop|| document.getElementById('bt20Stop');

bt20Run.addEventListener('click', ()=>{
  if(autoOrderActive) return;
  if(!rawData.length){ alert('尚未載入資料'); return; }
  const expiry = expirySelect.value;
  if(!expiry){ alert('請先選擇到期月份'); return; }

  const entryMin = parseFloat(document.getElementById('s1EntryMin').value || '20');
  const entryMax = parseFloat(document.getElementById('s1EntryMax').value || '25');
  if(entryMin > entryMax){ alert('進場區間：下限不能大於上限'); return; }

  // ★ 啟動時快取所有參數，tickAutoOrders 直接讀 _aoParams
  _aoParams = {
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

  autoOrderActive = true;
  autoOrderPositions = [];
  autoOrderEnteredKeys = new Set();

  s1Status.textContent='監控中...';
  s1Status.className='s1-status running';
  bt20Run.style.display='none';
  bt20Stop.style.display='';
  s1Cards.style.display='';
  s1TblWrap.style.display='';
  renderAutoOrderTable();
  renderAutoOrderStats();
});

bt20Stop.addEventListener('click', ()=>{
  autoOrderActive = false;
  s1Status.textContent='已停止';
  s1Status.className='s1-status stopped';
  bt20Run.style.display='';
  bt20Stop.style.display='none';
  // 強制出場所有 open 的部位
  forceCloseAllAutoOrders('手動停止');
  renderAutoOrderTable();
  renderAutoOrderStats();
});

}); // end DOMContentLoaded

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
    const { expiry:e, strike:s, type:t } = parseOrderKey(pos.key);
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
