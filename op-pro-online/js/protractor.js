// ====== 走勢圖斜率量角器 ======
(function(){
  const openBtn = document.getElementById('showProtractorBtn');
  const panel = document.getElementById('protractorFloat');
  const header = document.getElementById('protractorHeader');
  const body = document.getElementById('protractorBody');
  const minBtn = document.getElementById('protractorMinBtn');
  const closeBtn = document.getElementById('protractorCloseBtn');
  const windowSelect = document.getElementById('protractorWindow');
  const chartHost = document.getElementById('protractorChart');
  const sourceEl = document.getElementById('protractorSource');
  const angleEl = document.getElementById('protractorAngle');
  const directionEl = document.getElementById('protractorDirection');
  const slopeEl = document.getElementById('protractorSlope');
  const rangeEl = document.getElementById('protractorRange');
  if(!openBtn || !panel || !chartHost) return;

  let chart = null;
  let minimized = false;
  let updateFrame = 0;

  function initChart(){
    if(chart) return;
    chart = echarts.init(chartHost);
    chart.setOption({
      backgroundColor:'transparent',
      animation:false,
      series:[{
        type:'gauge',
        min:-90,
        max:90,
        startAngle:180,
        endAngle:0,
        splitNumber:6,
        radius:'94%',
        center:['50%','78%'],
        axisLine:{ lineStyle:{ width:24, color:[[.39,'#16a34a'],[.47,'#4ade80'],[.53,'#94a3b8'],[.61,'#f87171'],[1,'#b91c1c']] } },
        axisTick:{ distance:3, length:5, lineStyle:{ color:'rgba(255,255,255,.34)', width:1 } },
        splitLine:{ distance:3, length:12, lineStyle:{ color:'rgba(255,255,255,.65)', width:2 } },
        axisLabel:{ distance:25, color:'#cbd5e1', fontSize:11, formatter:v=>`${v}°` },
        pointer:{ length:'61%', width:4, offsetCenter:[0,'-5%'], itemStyle:{ color:'#fbbf24', shadowColor:'rgba(251,191,36,.75)', shadowBlur:8 } },
        anchor:{ show:true, showAbove:true, size:15, itemStyle:{ color:'#fbbf24', borderColor:'#111827', borderWidth:3 } },
        title:{ show:false },
        detail:{ offsetCenter:[0,'43%'], color:'#f8fafc', fontSize:24, fontWeight:900, fontFamily:'Courier New', formatter:v=>`${v>=0?'+':''}${v.toFixed(1)}°` },
        data:[{value:0}],
      }],
    });
  }

  function fmtTime(ms){
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function regression(points){
    if(points.length < 2) return null;
    const start = points[0].time;
    let sx=0, sy=0;
    for(const p of points){ sx += (p.time-start)/60000; sy += p.price; }
    const mx=sx/points.length, my=sy/points.length;
    let cov=0, variance=0;
    for(const p of points){
      const x=(p.time-start)/60000;
      cov += (x-mx)*(p.price-my);
      variance += (x-mx)*(x-mx);
    }
    if(variance <= 0) return null;
    const slope=cov/variance;
    return { slope, meanX:mx, meanY:my, start };
  }

  // 量角器固定使用目前市場切換所選的「台指／加權」，不跟隨 TXO 履約價與 CP。
  function buildUnderlyingSnapshot(){
    const market=window.currentMarket || 'taiex';
    const cutMs=window.cutoffTime ? +window.cutoffTime : Infinity;
    const withinSession=typeof window.withinSession==='function' ? window.withinSession : (()=>true);
    let source=[];
    let title='';

    if(market==='taiex'){
      source=(window.taiexDataIndex || []).filter(d=>d.dtms<=cutMs && withinSession(d.time));
      title='加權指數';
    }else{
      const all=(window.txDataIndex || []).filter(d=>d.dtms<=cutMs && (d.product||'').toUpperCase()==='TX' && withinSession(d.time));
      const volumeByExpiry=new Map();
      for(const d of all){
        const expiry=String(d.expiry||'').replace(/\s/g,'');
        volumeByExpiry.set(expiry,(volumeByExpiry.get(expiry)||0)+(Number(d.volume)||0));
      }
      const mainExpiry=Array.from(volumeByExpiry.entries()).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
      source=mainExpiry ? all.filter(d=>String(d.expiry||'').replace(/\s/g,'')===mainExpiry) : [];
      title=`TX 台指期${mainExpiry?` ${mainExpiry}`:''}`;
    }

    if(source.length<2) return null;
    const grouped=new Map();
    for(const d of source){
      const bucket=Math.floor(Number(d.dtms)/60000)*60000;
      if(!Number.isFinite(bucket)) continue;
      const price=Number(d.price);
      if(!Number.isFinite(price)) continue;
      grouped.set(bucket,price);
    }
    const rows=Array.from(grouped.entries()).sort((a,b)=>a[0]-b[0]);
    if(rows.length<2) return null;
    const times=rows.map(row=>row[0]);
    const prices=rows.map(row=>row[1]);
    const open=prices[0];
    let maxDeviation=1;
    for(const price of prices) maxDeviation=Math.max(maxDeviation,Math.abs(price-open));
    const padding=Math.max(1,maxDeviation*.08);
    return {
      source:market,
      title,
      times,
      prices,
      yMin:open-maxDeviation-padding,
      yMax:open+maxDeviation+padding,
      cutoff:Number.isFinite(cutMs)?cutMs:null,
      useTrendPixels:false,
    };
  }

  function directionFor(angle){
    if(angle >= 30) return '強勢上升';
    if(angle >= 10) return '上升';
    if(angle > -10) return '橫盤';
    if(angle > -30) return '下降';
    return '強勢下降';
  }

  function colorFor(angle){
    return angle > 5 ? '#f87171' : angle < -5 ? '#4ade80' : '#fbbf24';
  }

  function setEmpty(message){
    sourceEl.textContent = message || '等待走勢資料';
    angleEl.textContent = directionEl.textContent = slopeEl.textContent = '—';
    rangeEl.textContent = '請先載入資料並顯示走勢圖';
    if(chart) chart.setOption({series:[{data:[{value:0}]}]});
  }

  function calculateAngle(snapshot, points, fit){
    const first=points[0], last=points[points.length-1];
    const firstX=(first.time-fit.start)/60000;
    const lastX=(last.time-fit.start)/60000;
    const firstY=fit.meanY + fit.slope*(firstX-fit.meanX);
    const lastY=fit.meanY + fit.slope*(lastX-fit.meanX);
    if(snapshot.useTrendPixels!==false){
      const trendChart=window.OPProTrendChart;
      try{
        const p1=trendChart?.convertToPixel({xAxisIndex:0,yAxisIndex:0},[first.time,firstY]);
        const p2=trendChart?.convertToPixel({xAxisIndex:0,yAxisIndex:0},[last.time,lastY]);
        if(Array.isArray(p1)&&Array.isArray(p2)&&p1.every(Number.isFinite)&&p2.every(Number.isFinite)&&Math.abs(p2[0]-p1[0])>.01){
          return Math.atan2(p1[1]-p2[1],p2[0]-p1[0])*180/Math.PI;
        }
      }catch(_){ }
    }
    const allSpan=Math.max(1,snapshot.times[snapshot.times.length-1]-snapshot.times[0]);
    const xPixels=Math.max(1,(last.time-first.time)/allSpan*760);
    const ySpan=Math.max(1e-9,snapshot.yMax-snapshot.yMin);
    const yPixels=(lastY-firstY)/ySpan*360;
    return Math.atan2(yPixels,xPixels)*180/Math.PI;
  }

  function update(){
    if(panel.getAttribute('aria-hidden')==='true') return;
    initChart();
    const snapshot=buildUnderlyingSnapshot();
    if(!snapshot || !Array.isArray(snapshot.times) || snapshot.times.length<2){ setEmpty('目前沒有走勢資料'); return; }
    const all=snapshot.times.map((time,i)=>({time:Number(time),price:Number(snapshot.prices[i])})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.price));
    if(all.length<2){ setEmpty('走勢資料不足'); return; }
    const latest=all[all.length-1].time;
    const selected=windowSelect.value;
    let points=selected==='all' ? all : all.filter(p=>p.time>=latest-Number(selected)*60000);
    if(points.length<2) points=all.slice(-2);
    const fit=regression(points);
    if(!fit){ setEmpty('區間內資料不足'); return; }
    const rawAngle=calculateAngle(snapshot,points,fit);
    const angle=Math.max(-89.9,Math.min(89.9,rawAngle));
    const rounded=Number(angle.toFixed(1));
    const color=colorFor(angle);
    const direction=directionFor(angle);
    chart.setOption({series:[{detail:{color},pointer:{itemStyle:{color}},data:[{value:rounded}]}]});
    sourceEl.textContent=snapshot.title || snapshot.source || '走勢圖';
    angleEl.textContent=`${rounded>=0?'+':''}${rounded.toFixed(1)}°`;
    directionEl.textContent=direction;
    slopeEl.textContent=`${fit.slope>=0?'+':''}${fit.slope.toFixed(2)} 點/分`;
    angleEl.style.color=directionEl.style.color=slopeEl.style.color=color;
    rangeEl.textContent=`${fmtTime(points[0].time)} ～ ${fmtTime(points[points.length-1].time)}｜${points.length} 根 1 分資料・線性回歸`;
  }

  function scheduleUpdate(){
    if(updateFrame) cancelAnimationFrame(updateFrame);
    updateFrame=requestAnimationFrame(()=>{ updateFrame=0; update(); });
  }

  openBtn.addEventListener('click',()=>{
    panel.style.display='block';
    panel.setAttribute('aria-hidden','false');
    initChart();
    requestAnimationFrame(()=>{ chart.resize(); update(); });
  });
  closeBtn?.addEventListener('click',()=>{ panel.style.display='none'; panel.setAttribute('aria-hidden','true'); });
  minBtn?.addEventListener('click',()=>{
    minimized=!minimized;
    body.style.display=minimized?'none':'';
    minBtn.textContent=minimized?'+':'−';
    if(!minimized) requestAnimationFrame(()=>{ chart?.resize(); update(); });
  });
  windowSelect?.addEventListener('change',scheduleUpdate);
  window.addEventListener('oppro:trend-updated',scheduleUpdate);
  window.addEventListener('resize',()=>{ if(panel.style.display!=='none') chart?.resize(); });
  window.updateProtractorChart=scheduleUpdate;

  let dragging=false, ox=0, oy=0;
  header?.addEventListener('mousedown',e=>{
    if(e.target.closest('button,select')) return;
    const rect=panel.getBoundingClientRect();
    dragging=true; ox=e.clientX-rect.left; oy=e.clientY-rect.top;
    header.style.cursor='grabbing'; e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const left=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,e.clientX-ox));
    const top=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,e.clientY-oy));
    panel.style.left=`${left}px`; panel.style.top=`${top}px`; panel.style.right='auto'; panel.style.bottom='auto';
  });
  document.addEventListener('mouseup',()=>{ dragging=false; if(header) header.style.cursor='grab'; });
})();
