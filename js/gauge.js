// ====== 入口：兩個圖表都保持更新，切換時不中斷任何一方的資料流 ======
function renderChart(cutoff=null){
  renderTA(cutoff);
  renderTX(cutoff);
  renderTrend(cutoff);
  // 走勢圖 tab 時，TA / TX 都隱藏；否則依 currentChartMode 決定
  if(activeChartTab === 'trend' || activeChartTab === 'info'){
    const _tx = document.getElementById('chartTX');
    const _ta = document.getElementById('chartTA');
    if(_tx){ _tx.style.visibility='hidden'; _tx.style.pointerEvents='none'; }
    if(_ta){ _ta.style.visibility='hidden'; _ta.style.pointerEvents='none'; }
  } else {
    _lwcShowHide(currentChartMode === 'tx');
  }
  fixedTooltip.style.display = (activeChartTab==='ta' && fixedTooltip.innerHTML) ? 'block' : 'none';
  if(typeof updateInfoPanel === 'function') updateInfoPanel(cutoff);
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

  // 更新儀錶資料（節流：回測播放中每 200ms 最多更新一次）
  let _lastVolUpdate = 0;
  window._gaugeDbgStats = { calls:0, skipped:0 };

  // ════════════════════════════════════════════════════════
  // 全新儀表板邏輯：預建索引 + 二分搜尋，O(log N) per update
  // ════════════════════════════════════════════════════════
  let _gIdx = null;   // 預建索引（session 變更才重建）
  let _gRange = null; // 上次 ECharts range

  // ── 二分搜尋：找最後一個 key(d) <= cutMs ──────────────
  function _bsFloor(arr, cutMs, key){
    let lo=0, hi=arr.length-1, res=-1;
    while(lo<=hi){ const mid=(lo+hi)>>1; if(key(arr[mid])<=cutMs){res=mid;lo=mid+1;}else hi=mid-1; }
    return res;
  }

  // ── 預建索引（一次性 O(N) 掃描，之後每次 O(log N)）──────
  function _buildGaugeIndex(session){
    const t0 = performance.now();
    const txArr = window.txDataIndex;

    // 第1遍：統計各 date|expiry 成交量 → 找主力契約
    const volMap = {};
    for(const d of txArr){
      const ex=(d.expiry||'').replace(/\s/g,'');
      if(!/^20\d{4}/.test(ex)) continue;
      if(session!=='全部' && !window.withinSession(d.time)) continue;
      const k=`${d.date}|${ex}`;
      volMap[k]=(volMap[k]||0)+(d.volume||0);
    }
    const mainExByDate={};
    for(const [k,v] of Object.entries(volMap)){
      const sep=k.indexOf('|'); const date=k.slice(0,sep), ex=k.slice(sep+1);
      if(!mainExByDate[date]||v>mainExByDate[date].vol) mainExByDate[date]={ex,vol:v};
    }

    // 第2遍：只保留主力契約的 tick，建 prefix max/min
    const byDate={};
    for(const d of txArr){
      const ex=(d.expiry||'').replace(/\s/g,'');
      const mex=(mainExByDate[d.date]||{}).ex;
      if(ex!==mex) continue;
      if(session!=='全部' && !window.withinSession(d.time)) continue;
      if(!byDate[d.date]) byDate[d.date]={mainEx:ex, open:d.price, ticks:[]};
      byDate[d.date].ticks.push(d);
    }
    for(const day of Object.values(byDate)){
      const n=day.ticks.length;
      day.pH=new Array(n); day.pL=new Array(n);
      day.pH[0]=day.pL[0]=day.ticks[0].price;
      for(let i=1;i<n;i++){
        day.pH[i]=Math.max(day.pH[i-1],day.ticks[i].price);
        day.pL[i]=Math.min(day.pL[i-1],day.ticks[i].price);
      }
    }
    console.log(`[Gauge] buildIndex ${+(performance.now()-t0).toFixed(1)}ms, dates=${Object.keys(byDate).length}`);
    return {session, byDate};
  }

  // ── 核心更新函式 ────────────────────────────────────────
  function _doUpdateVolatilityChart(cutoff){
    if(!floatEl||floatEl.style.display==='none') return;
    const txArr=window.txDataIndex;
    if(!txArr||!txArr.length) return;
    if(!volChart) initVolChart();

    const session=document.getElementById('sessionSelect').value;
    const cutMs=cutoff?+cutoff:Infinity;

    // 預建索引（首次或 session 變更）
    if(!_gIdx||_gIdx.session!==session) _gIdx=_buildGaugeIndex(session);

    // 二分搜尋：全域找最後一筆 TX tick <= cutMs
    const gi=_bsFloor(txArr,cutMs,d=>d.dtms);
    if(gi<0){valLabel.textContent='—';return;}

    // 取當天 per-date 索引
    const today=txArr[gi].date;
    const day=_gIdx.byDate[today];
    if(!day){valLabel.textContent='—';return;}

    // 二分搜尋：在當天 ticks 找位置
    const di=_bsFloor(day.ticks,cutMs,d=>d.dtms);
    if(di<0){valLabel.textContent='—';return;}

    // O(1) 取值
    const curPrice=day.ticks[di].price;
    const rawTime =day.ticks[di].time||'';
    const openPrice=day.open;
    const dayHigh=day.pH[di];
    const dayLow =day.pL[di];

    const chg    =curPrice-openPrice;
    const pct    =(chg/openPrice)*100;
    const highChg=dayHigh-openPrice;
    const lowChg =dayLow -openPrice;
    const timeStr=rawTime.slice(0,2)+':'+rawTime.slice(2,4);

    // 動態 range：以當日最大波動為基準（不縮小）
    const maxSwingPct=Math.max(Math.abs(highChg),Math.abs(lowChg))/openPrice*100;
    const range=Math.max(1,Math.ceil(maxSwingPct*1.2*10)/10);

    // DOM 更新
    valLabel.textContent=(chg>=0?'+':'')+chg.toFixed(0)+' pt';
    valLabel.style.color=chg>0?'#f87171':chg<0?'#4ade80':'#fbbf24';
    valLabel.style.textShadow=chg>0?'0 0 12px rgba(248,113,113,.5)':chg<0?'0 0 12px rgba(74,222,128,.5)':'0 0 12px rgba(251,191,36,.4)';
    const eH=document.getElementById('gaugeHigh');
    const eL=document.getElementById('gaugeLow');
    if(eH) eH.textContent=(highChg>=0?'+':'')+highChg.toFixed(0)+' pt';
    if(eL){eL.textContent=(lowChg>=0?'+':'')+lowChg.toFixed(0)+' pt'; eL.style.color=lowChg<0?'#4ade80':'#94a3b8';}
    const eP=document.getElementById('gaugePct');
    if(eP){eP.textContent=(pct>=0?'+':'')+pct.toFixed(2)+'%'; eP.style.color=pct>0?'#f87171':pct<0?'#4ade80':'#94a3b8';}
    const eC=document.getElementById('gaugeChg');
    if(eC){eC.textContent=(chg>0?'▲ +':chg<0?'▼ ':'— ')+chg.toFixed(0)+' pt'; eC.style.color=chg>0?'#f87171':chg<0?'#4ade80':'#64748b';}
    const eT=document.getElementById('gaugeTime');
    if(eT) eT.textContent=timeStr;

    // ECharts setOption
    const pctVal=+pct.toFixed(2);
    if(_gRange!==range){
      _gRange=range;
      const gc=[[0.000,'#14532d'],[0.167,'#16a34a'],[0.333,'#4ade80'],[0.500,'#86efac'],
                [0.500,'#fca5a5'],[0.667,'#fca5a5'],[0.833,'#ef4444'],[1.000,'#7f1d1d']];
      volChart.setOption({series:[{min:-range,max:range,
        axisLine:{lineStyle:{color:gc}},
        axisLabel:{formatter:v=>{if(Math.abs(v)<0.001)return'0';const s=range/2;return(Math.abs(Math.abs(v)-s)<0.001||Math.abs(Math.abs(v)-range)<0.001)?(v>0?'+':'')+v.toFixed(1)+'%':'';}},
        detail:{formatter:v=>(v>=0?'+':'')+v.toFixed(2)+'%'},
        data:[{value:pctVal}]}]});
    } else {
      volChart.setOption({series:[{data:[{value:pctVal}]}]});
    }
  }

  window._gaugeResetCache = function(){ _gIdx=null; _gRange=null; };

  window.updateVolatilityChart = function(cutoff, force){
    const now = Date.now();
    const playing = typeof window._btPlaying !== 'undefined' ? window._btPlaying : false;
    // 回測播放中：200ms 內的重複呼叫直接略過（不用 setTimeout，避免計時器被不斷重置）
    if(!force && playing && (now - _lastVolUpdate) < 200){
      window._gaugeDbgStats.skipped++;
      return;
    }
    _lastVolUpdate = now;
    _doUpdateVolatilityChart(cutoff);
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
function updateTXBar(cutoff){
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