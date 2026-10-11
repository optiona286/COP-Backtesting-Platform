// ====== 資訊圖 ======

let _infoGaugeChart = null;

// ---- 儀表板初始化 ----
function _initInfoGauge(){
  const el = document.getElementById('infoGaugeChart');
  if(!el || _infoGaugeChart) return;
  _infoGaugeChart = echarts.init(el);
  _infoGaugeChart.setOption({
    backgroundColor:'transparent',
    animation: false,
    series:[{
      type:'gauge',
      startAngle:180, endAngle:0,
      min:-100, max:100,
      splitNumber:4,
      radius:'92%', center:['50%','80%'],
      axisLine:{ lineStyle:{ width:22, color:[
        [0.15,'#14532d'],[0.35,'#16a34a'],[0.5,'#facc15'],
        [0.65,'#ef4444'],[1,'#7f1d1d']
      ]}},
      pointer:{ length:'65%', width:5, itemStyle:{color:'#fff'} },
      axisTick:{ show:false }, splitLine:{ show:false },
      axisLabel:{ show:false },
      detail:{ show:false },
      data:[{ value:0 }]
    }]
  });
}

// ---- 計算走勢力道 ----
function _calcMomentum(expiry, strike, type, cutoff){
  const k = keyOf(expiry, strike, type);
  const arr = dataIndex.get(k) || [];
  const cutMs = cutoff ? +cutoff : Infinity;
  const recent = [];
  for(const d of arr){
    if(d.dtms > cutMs) break;
    if(withinSession(d.time)) recent.push(d);
  }
  if(recent.length < 3) return 0;
  const n = Math.min(10, recent.length);
  const slice = recent.slice(-n);
  const first = slice[0].price, last = slice[slice.length-1].price;
  if(!first) return 0;
  const pctChg = (last - first) / first * 100;
  return Math.max(-100, Math.min(100, pctChg * 10));
}

// ---- 翻倍追蹤：找下跌到 20-25 的時間點為起點 ----
function _getDoubleTrack(expiry, strike, type, cutoff){
  const k = keyOf(expiry, strike, type);
  const arr = dataIndex.get(k) || [];
  const cutMs = cutoff ? +cutoff : Infinity;

  let base = null; // { px, dtms }
  const levels = []; // [{ target, reachedTime }]

  for(const d of arr){
    if(d.dtms > cutMs) break;
    if(!withinSession(d.time)) continue;

    if(!base){
      // 尚未找到起點，等待下跌到 20-25
      if(d.price >= 20 && d.price <= 25){
        base = { px: d.price, dtms: d.dtms };
        // 產生翻倍目標
        let v = base.px;
        while(v < 10000){
          v = Math.round(v * 2);
          levels.push({ target: v, reachedTime: null });
        }
      }
    } else {
      // 已有起點，追蹤是否到達各翻倍目標
      for(const lv of levels){
        if(lv.reachedTime === null && d.price >= lv.target){
          lv.reachedTime = d.dtms;
        }
      }
    }
  }

  return { base, levels };
}

// ---- 渲染翻倍表 ----
function _renderDoubleTable(tbId, base, levels){
  const tb = document.getElementById(tbId);
  if(!tb) return;
  if(!base){
    tb.innerHTML = '<tr><td colspan="3" style="color:#555;font-size:11px;padding:4px;">尚未下跌至 20–25</td></tr>';
    return;
  }
  tb.innerHTML = levels.slice(0, 10).map(lv => {
    const hit = lv.reachedTime !== null;
    const timeStr = hit ? (() => {
      const d = new Date(lv.reachedTime);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    })() : '--';
    return `<tr>
      <td style="padding:2px 6px;color:#aaa;">${lv.target}</td>
      <td style="padding:2px 6px;text-align:center;color:${hit?'#4ade80':'#555'};font-weight:${hit?700:400};">${hit?'✅':'—'}</td>
      <td style="padding:2px 6px;color:#888;font-size:11px;">${timeStr}</td>
    </tr>`;
  }).join('');
}

// ---- 價差警示：掃描所有履約價，找 |C-P| <=10 ----
function _getSpreadAlerts(expiry, cutoff){
  const callT = typeAliases?.call ?? 'C';
  const putT  = typeAliases?.put  ?? 'P';
  const strikes = [];
  dataIndex.forEach((arr, k) => {
    if(k.startsWith(expiry + '|')) strikes.push(k.split('|')[1]);
  });
  const uniq = [...new Set(strikes)].sort((a,b)=>+a-+b);
  const result = [];
  for(const s of uniq){
    const cp = getLastPrice(expiry, s, callT, cutoff);
    const pp = getLastPrice(expiry, s, putT,  cutoff);
    if(cp == null || pp == null) continue;
    const diff = cp - pp;
    if(Math.abs(diff) <= 10){
      result.push({ strike: s, callPx: cp, putPx: pp, diff });
    }
  }
  return result;
}

// ---- 主更新函數 ----
function updateInfoPanel(cutoff){
  if(activeChartTab !== 'info') return;
  _initInfoGauge();

  const expiry = expirySelect.value;
  const strike = strikeSelect.value;
  const callT  = typeAliases?.call ?? 'C';
  const putT   = typeAliases?.put  ?? 'P';
  const type   = typeSelect.value;

  // ── 1. 翻倍追蹤 ──
  const callTrack = _getDoubleTrack(expiry, strike, callT, cutoff);
  const putTrack  = _getDoubleTrack(expiry, strike, putT,  cutoff);

  document.getElementById('infoDoubleCallBase').textContent =
    callTrack.base ? `起點 ${callTrack.base.px}` : '尚未觸發';
  document.getElementById('infoDoublePutBase').textContent =
    putTrack.base  ? `起點 ${putTrack.base.px}`  : '尚未觸發';

  _renderDoubleTable('infoDoubleCallTable', callTrack.base, callTrack.levels);
  _renderDoubleTable('infoDoublePutTable',  putTrack.base,  putTrack.levels);

  // ── 2. 價差警示 ──
  const alerts = _getSpreadAlerts(expiry, cutoff);
  const spreadTb = document.getElementById('infoSpreadTable');
  if(spreadTb){
    if(!alerts.length){
      spreadTb.innerHTML = '<tr><td colspan="4" style="color:#555;font-size:11px;padding:4px;">目前無履約價 C/P 差距在 ±10 以內</td></tr>';
    } else {
      spreadTb.innerHTML = alerts.map(a => `
        <tr>
          <td style="padding:2px 8px;color:#fff;">${a.strike}</td>
          <td style="padding:2px 8px;color:#ff6b6b;">C ${a.callPx}</td>
          <td style="padding:2px 8px;color:#4ade80;">P ${a.putPx}</td>
          <td style="padding:2px 8px;color:#fbbf24;font-weight:700;">${a.diff>=0?'+':''}${a.diff.toFixed(1)}</td>
        </tr>`).join('');
    }
  }

  // ── 3. 走勢儀表板 ──
  const momentum = _calcMomentum(expiry, strike, type, cutoff);
  if(_infoGaugeChart){
    _infoGaugeChart.setOption({ series:[{ data:[{ value: +momentum.toFixed(1) }] }] });
    const lbl = momentum > 30 ? '強勢上漲' : momentum > 10 ? '溫和上漲' :
                momentum < -30 ? '強勢下跌' : momentum < -10 ? '溫和下跌' : '盤整';
    document.getElementById('infoGaugeLabel').textContent = `力道：${momentum.toFixed(1)}　${lbl}`;
  }
}

window.updateInfoPanel = updateInfoPanel;
