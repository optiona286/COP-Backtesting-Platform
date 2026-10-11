// One presentation for option, TAIEX and TX charts. Read existing series only.
(() => {
  const panel=document.createElement('section');panel.className='app-chart-info';
  panel.setAttribute('aria-label','目前 K 棒行情資訊');
  const header=document.createElement('div');header.className='app-chart-info-header';
  const market=document.createElement('strong'),clock=document.createElement('time'),timeLabel=document.createElement('span');header.append(timeLabel,clock,market);
  const values=document.createElement('div');values.className='app-chart-info-values';
  const averages=document.createElement('div');averages.className='app-chart-info-ma';
  panel.append(header,values);
  panel.hidden=true;
  averages.hidden=true;
  const heading=document.querySelector('.rpanel > .ws-panel-heading');
  heading.classList.add('app-market-heading');heading.append(panel);
  document.querySelector('.chartWrap').prepend(averages);
  const subscribed=new WeakSet();let hover=null,frame=0,lastChart=null;
  const number=value=>Number.isFinite(Number(value))?String(Number(Number(value).toFixed(2))):'—';
  const cell=(label,value,tone='')=>{const n=document.createElement('div');n.className='app-chart-info-cell';const l=document.createElement('span'),v=document.createElement('b');l.textContent=label;v.textContent=value;if(tone)v.dataset.tone=tone;n.append(l,v);return n;};
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(render);}
  function render(){
    const isTX=typeof currentChartMode!=='undefined'&&currentChartMode==='tx';
    const chart=isTX?(typeof _lwcChart==='undefined'?null:_lwcChart):(typeof _taChart==='undefined'?null:_taChart);
    const candle=isTX?(typeof _lwcCandle==='undefined'?null:_lwcCandle):(typeof _taCandle==='undefined'?null:_taCandle);
    const volume=isTX?(typeof _lwcVolume==='undefined'?null:_lwcVolume):(typeof _taVolume==='undefined'?null:_taVolume);
    const ma=isTX?(typeof _lwcMaSeries==='undefined'?{}:_lwcMaSeries):(typeof _taMaSeries==='undefined'?{}:_taMaSeries);
    if(chart!==lastChart){hover=null;lastChart=chart;}
    if(chart&&!subscribed.has(chart)){subscribed.add(chart);chart.subscribeCrosshairMove(param=>{if(chart!==lastChart)return;hover=param.time&&param.point&&param.seriesData.has(candle)?param:null;schedule();});}
    const c=hover?.seriesData.get(candle);
    panel.hidden=!c||!document.getElementById('tabTA').classList.contains('active')||document.getElementById('compareKPanel')?.classList.contains('open');
    averages.hidden=panel.hidden;
    if(panel.hidden)return;
    market.textContent=isTX?(window.currentMarket==='taiex'?'加權指數':'台指期貨'):'台指選擇權';
    values.replaceChildren();averages.replaceChildren();
    if(!c||!Number.isFinite(c.close)){clock.textContent='尚未載入行情';for(const label of ['開','高','低','收','漲跌','成交量'])values.append(cell(label,'—'));return;}
    const date=new Date((hover?.time||c.time)*1000);
    // Keep each original series' time convention; standardize the displayed format.
    const prefix=isTX?'getUTC':'get';
    const read=part=>date[`${prefix}${part}`]();const pad=n=>String(n).padStart(2,'0');
    timeLabel.textContent='時';
    clock.textContent=`${pad(read('Hours'))}:${pad(read('Minutes'))}`;
    clock.title=`${read('FullYear')}/${pad(read('Month')+1)}/${pad(read('Date'))} ${clock.textContent}:${pad(read('Seconds'))}`;
    const diff=c.close-c.open,pct=c.open?diff/c.open*100:0,tone=diff>0?'up':diff<0?'down':'flat';
    const volumes=hover?null:volume?.data();const v=hover?.seriesData.get(volume)||(volumes&&volumes[volumes.length-1]);
    for(const[label,value,color]of [['開',number(c.open),tone],['高',number(c.high),'up'],['低',number(c.low),'down'],['收',number(c.close),tone],['量',v?number(v.value):'—','volume']])values.append(cell(label,value,color));
    averages.append(cell('漲跌',`${diff>=0?'+':''}${number(diff)} (${pct>=0?'+':''}${pct.toFixed(2)}%)`,tone));
    for(const[period,series]of Object.entries(ma)){const points=hover?null:series.data(),last=hover?.seriesData.get(series)||(points&&points[points.length-1]);const item=cell(`MA${period}`,last&&last.time===c.time?number(last.value):'—');const color=series.options().color;if(color)item.querySelector('b').style.color=color;averages.append(item);}
  }
  const observer=new MutationObserver(schedule);
  for(const id of ['fixedTooltip','txTooltip','kinfo','tabTA','compareKPanel']){const n=document.getElementById(id);if(n)observer.observe(n,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});}
  document.getElementById('kinfo').addEventListener('click',schedule);
  document.addEventListener('oppro:section',()=>{hover=null;schedule();});
  document.querySelector('.chartWrap').addEventListener('pointerleave',()=>{hover=null;schedule();});
  schedule();
})();
