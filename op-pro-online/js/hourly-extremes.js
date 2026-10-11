// Hourly TAIEX annotations use the displayed (and replay-truncated) candles.
(() => {
  const controls = document.getElementById('hourlyExtremeControls');
  const marksToggle = document.getElementById('hourlyExtremeMarks');
  const panelToggle = document.getElementById('hourlyExtremePanelToggle');
  const panel = document.getElementById('hourlyExtremePanel');
  const body = document.getElementById('hourlyExtremeBody');
  let enabled = false, groups = [], markerPlugin = null, boundSeries = null;
  const kinds = [
    { key:'high', rank:0, name:'最高', text:'高1', position:'aboveBar', color:'#ca9c85' },
    { key:'high', rank:1, name:'次高', text:'高2', position:'aboveBar', color:'#bba687' },
    { key:'low', rank:0, name:'最低', text:'低1', position:'belowBar', color:'#83b7ac' },
    { key:'low', rank:1, name:'次低', text:'低2', position:'belowBar', color:'#8faac8' }
  ];
  const clock = time => new Date(time * 1000).toISOString().slice(11,16);
  const price = value => value.toLocaleString('zh-TW', { minimumFractionDigits:2, maximumFractionDigits:2 });

  function calculate(candles){
    const hours = new Map();
    for(const candle of candles){
      if(!Number.isFinite(candle.time)) continue;
      const stamp = new Date(candle.time * 1000).toISOString();
      const hour = Number(stamp.slice(11,13));
      if(hour < 9 || hour > 13 || (hour === 13 && stamp.slice(14,19) > '30:00')) continue;
      const key = stamp.slice(0,13);
      if(!hours.has(key)) hours.set(key, { key, hour, high:new Map(), low:new Map() });
      const group = hours.get(key);
      for(const side of ['high','low']){
        const value = candle[side];
        if(!Number.isFinite(value)) continue;
        const existing = group[side].get(value);
        if(!existing || candle.time < existing.time) group[side].set(value, { value, time:candle.time });
      }
    }
    return [...hours.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(group => ({
      key:group.key,
      label:`${String(group.hour).padStart(2,'0')}:00–${group.hour === 13 ? '13:30' : `${String(group.hour).padStart(2,'0')}:59`}`,
      high:[...group.high.values()].sort((a,b)=>b.value-a.value).slice(0,2),
      low:[...group.low.values()].sort((a,b)=>a.value-b.value).slice(0,2)
    }));
  }

  function paint(){
    controls.hidden = !enabled;
    panel.hidden = !enabled || !panelToggle.checked;
    if(markerPlugin){
      const markers = [];
      if(enabled && marksToggle.checked){
        for(const group of groups) for(const kind of kinds){
          const hit = group[kind.key][kind.rank];
          if(hit) markers.push({ time:hit.time, position:kind.position, color:kind.color,
            shape:'circle', text:kind.text, size:0.4 });
        }
      }
      markers.sort((a,b)=>a.time-b.time);
      markerPlugin.setMarkers(markers);
    }
    if(panel.hidden) return;
    body.replaceChildren();
    for(const group of groups){
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = group.label;
      row.appendChild(label);
      for(const kind of kinds){
        const cell = document.createElement('td');
        const hit = group[kind.key][kind.rank];
        if(hit){
          cell.appendChild(document.createTextNode(price(hit.value)));
          const time = document.createElement('small');
          time.textContent = clock(hit.time);
          cell.appendChild(time);
        } else cell.textContent = '—';
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    if(!groups.length){
      const row = document.createElement('tr'), cell = document.createElement('td');
      cell.colSpan = 5; cell.textContent = '目前尚無已顯示的 K 棒資料';
      row.appendChild(cell); body.appendChild(row);
    }
  }

  function reset(){
    if(markerPlugin) markerPlugin.detach();
    markerPlugin = null; boundSeries = null; groups = [];
    paint();
  }
  window.opHourlyExtremes = {
    setActive(active){
      if(enabled === active) return;
      enabled = active;
      if(!active) reset(); else paint();
    },
    update(series, candles){
      if(!enabled) return;
      if(boundSeries !== series){
        reset();
        boundSeries = series;
        markerPlugin = LightweightCharts.createSeriesMarkers(series, [], { autoScale:false });
      }
      groups = calculate(candles);
      paint();
    },
    reset
  };
  marksToggle.addEventListener('change', paint);
  panelToggle.addEventListener('change', paint);
  document.getElementById('hourlyExtremeClose').addEventListener('click', () => {
    panelToggle.checked = false; paint();
  });
  window.addEventListener('op-backend-view-change', () => {
    if(window._backendViewMode !== 'settlement') window.opHourlyExtremes.setActive(false);
    else reset();
  });
})();
