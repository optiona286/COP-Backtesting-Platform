    // ====== Selectors ======
    function updateSelectors(){
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
      taChartInited = false; taChartKey = '';
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
        taChartInited = false; taChartKey = ''; // MA 變更 → 強制全面重繪
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
      taChartInited = false; taChartKey = ''; // MA 變更 → 強制全面重繪
      renderChart();
    });
    maResetBtn.addEventListener('click', ()=>{
      const def = [5,10,20,60];
      rebuildMABox(def, new Set([5,10,20]));
      maCustomInput.value = def.join(',');
      taChartInited = false; taChartKey = ''; // MA 變更 → 強制全面重繪
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

    // Theme 監聽已移至 main.js 最前方，此處不重複
