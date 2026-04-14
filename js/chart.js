    // ====== 均線（MA） ======
    function calcMA(period, values){
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
    function getMAPeriods(){
      return getMAAllChecks()
        .filter(c=>c && c.checked)
        .map(c=>parseInt(c.value,10))
        .filter(n=>Number.isFinite(n) && n>0);
    }





// ====== TX 期貨 K 線圖 ======
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

  // ---- 最高 / 次高 / 次低 / 最低 ----
  const _ppts = prices.map((p,i)=>({p,i}));
  const _desc = [..._ppts].sort((a,b)=>b.p-a.p);
  const _asc  = [..._ppts].sort((a,b)=>a.p-b.p);

  const _h1 = _desc[0];
  const _h2 = _desc.find(x => x.p < _h1.p);
  const _l1 = _asc[0];
  const _l2 = _asc.find(x => x.p > _l1.p);

  const trendHighPx    = _h1.p;
  const trendHighTime  = times[_h1.i];
  const trendLowPx     = _l1.p;
  const trendLowTime   = times[_l1.i];
  const trend2HighPx   = _h2 ? _h2.p : null;
  const trend2HighTime = _h2 ? times[_h2.i] : null;
  const trend2LowPx    = _l2 ? _l2.p  : null;
  const trend2LowTime  = _l2 ? times[_l2.i]  : null;

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
      base:{ color:'#facc15', fontWeight:900, fontSize:13 }
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
  lineStyle:{ width:3, color:'#facc15' },
  label:{
    show:true,
    position:'end',
    formatter: ()=> (Math.round(openPx*10)/10).toFixed(1),
    color:'#facc15',
    fontWeight:900,
    fontSize:14,
    backgroundColor:'rgba(0,0,0,.55)',
    borderColor:'rgba(250,204,21,.9)',
    borderWidth:1,
    borderRadius:8,
    padding:[4,8,4,8]
  },
  z:1
},
{
  // 最高 / 次高 / 次低 / 最低 標記點與水平線
  name:'HL-markers',
  type:'line',
  data: [],
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
      ...(trend2HighPx != null ? [{
        name:'次高',
        coord: [trend2HighTime, trend2HighPx],
        value: trend2HighPx,
        itemStyle:{ color:'#fb923c' },
        label:{ color:'#fff', fontWeight:900, fontSize:11, formatter:'{c}' }
      }] : []),
      ...(trend2LowPx != null ? [{
        name:'次低',
        coord: [trend2LowTime, trend2LowPx],
        value: trend2LowPx,
        symbolRotate: 180,
        itemStyle:{ color:'#22d3ee' },
        label:{ color:'#fff', fontWeight:900, fontSize:11, formatter:'{c}', offset:[0, -4] }
      }] : []),
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
        lineStyle:{ color:'rgba(255,45,45,.6)', type:'dashed', width:1.5 },
        label:{ show:true, position:'insideEndTop', color:'#ff2d2d', fontWeight:800, fontSize:11,
          formatter: `H ${trendHighPx}`,
          backgroundColor:'rgba(0,0,0,.6)', borderRadius:4, padding:[2,6] }
      },
      ...(trend2HighPx != null ? [{
        yAxis: trend2HighPx,
        lineStyle:{ color:'rgba(251,146,60,.6)', type:'dashed', width:1 },
        label:{ show:true, position:'insideEndTop', color:'#fb923c', fontWeight:800, fontSize:11,
          formatter: `2H ${trend2HighPx}`,
          backgroundColor:'rgba(0,0,0,.6)', borderRadius:4, padding:[2,6] }
      }] : []),
      ...(trend2LowPx != null ? [{
        yAxis: trend2LowPx,
        lineStyle:{ color:'rgba(34,211,238,.6)', type:'dashed', width:1 },
        label:{ show:true, position:'insideEndBottom', color:'#22d3ee', fontWeight:800, fontSize:11,
          formatter: `2L ${trend2LowPx}`,
          backgroundColor:'rgba(0,0,0,.6)', borderRadius:4, padding:[2,6] }
      }] : []),
      {
        yAxis: trendLowPx,
        lineStyle:{ color:'rgba(0,204,85,.6)', type:'dashed', width:1.5 },
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
