    // ====== Backtest 核心（K 線時間軸） ======
    function rebuildPlayTimes(){
      const expiry=expirySelect.value;
      const tickSet = new Set();
      dataIndex.forEach((arr, k) => {
        if(!k.startsWith(expiry + '|')) return;
        for(const d of arr){
          if(withinSession(d.time)) tickSet.add(d.dtms);
        }
      });
      // TX 期貨 tick 不加入 playTimes（TX 有 ~48,000 筆/天，加入會使步數爆炸）
      // TX 資料改由 cutoffTime 即時查詢，不影響正確性
      const uniq = Array.from(tickSet).sort((a,b)=>a-b).map(x=>new Date(x));
      playTimes=uniq;
      playIndex=0; simTime=null;
      btProgress.min=0; btProgress.max=Math.max(0, playTimes.length-1); btProgress.value=0;
      updateBtUI();
    }
    function updateBtUI(){
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
      const _cc=document.getElementById('chartBtClock');
      if(_cc){ if(cutoffTime){_cc.textContent=fmtTime(cutoffTime);_cc.style.display='';} else{_cc.style.display='none';} }
      btProgress.value=playIndex;

      updateBtUI();
      renderChart(cutoffTime);
      rebuildTTable(cutoffTime);
      checkLimitOrders(cutoffTime);
      tickAutoOrders(cutoffTime);
      updateGreeksCard(strikeSelect.value, cutoffTime);
      window._lastCutoff = cutoffTime;
      if(typeof window.updateVolatilityChart==='function') window.updateVolatilityChart(cutoffTime);
      updateAccountUI();
      updateTXBar(cutoffTime);
    }
    function startPlayback(){
      if(!playTimes.length) return;
      playing=true; window._btPlaying=true; updateBtUI();
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
    function pausePlayback(){ if(playTimer) clearInterval(playTimer); playTimer=null; playing=false; window._btPlaying=false; updateBtUI(); }
    function resumePlayback(){ if(!playing) startPlayback(); }
    function stopPlayback(){
      if(playTimer) clearInterval(playTimer); playTimer=null; playing=false; window._btPlaying=false;
      cutoffTime=null; simTime=null;
      const _sc=document.getElementById('chartBtClock'); if(_sc) _sc.style.display='none';
      userManualMode=false; // 停止回測後重置手動模式
      trendChartInited=false; trendChartKey=''; // 重置走勢圖狀態
      taChartInited = false; taChartKey = ''; // 重置 K 線圖狀態
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
      if(typeof window._gaugeResetCache === 'function') window._gaugeResetCache(); // 停止時清除儀表板增量快取
      if(typeof window.updateVolatilityChart === 'function') window.updateVolatilityChart(null, true); // 停止時強制刷新儀表板
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
    function resetAccount(){ account.cash=account.initCash; account.realized=0; account.positions.clear(); account.orders=[]; }
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

    function checkLimitOrders(cutoff){
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
