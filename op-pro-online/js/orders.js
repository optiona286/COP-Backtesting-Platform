    function updateAccountUI(){
      const expiry=expirySelect.value, strike=strikeSelect.value, type=typeSelect.value;
      const key=keyOf(expiry,strike,type);
      symNow.textContent=key||'-';
      const px=getLastPrice(expiry,strike,type,cutoffTime);
      lastPx.textContent=px==null?'-':px;

      let totalUPnL=0;
      account.positions.forEach((p,k)=>{
        const [e,s,t]=k.split('|');
        const last=getLastPrice(e,s,t,cutoffTime);
        if(last!=null){
          p.last=last;
          const mult=Math.max(1, Number(multInput.value)||50);
          const sign=Math.sign(p.qty);
          const diff=(sign>=0)?(last-p.avg):(p.avg-last);
          p.upnl=diff*mult*Math.abs(p.qty);
        }else{ p.upnl=0; }
        totalUPnL+=p.upnl;
      });

      const eq=calcEquity(totalUPnL);
      uPnL.textContent=fmtNum(totalUPnL);
      rPnL.textContent=fmtNum(account.realized);
      equity.textContent=fmtNum(eq);

      cash0.textContent=fmtNum(account.initCash);
      cash.textContent=fmtNum(account.cash);
      rPnL2.textContent=fmtNum(account.realized);
      uPnL2.textContent=fmtNum(totalUPnL);
      equity2.textContent=fmtNum(eq);

      // ★ 計算已使用成本（所有多單的成本 = 均價 × 口數 × 乘數）
        let usedCostVal = 0;
        const multVal = Math.max(1, Number(multInput.value) || 50);

        account.positions.forEach((p) => {
          if (p.qty > 0) { // 只算多單
            usedCostVal += p.avg * p.qty * multVal;
          }
        });

usedCost.textContent = fmtNum(usedCostVal);


      posTable.innerHTML='';
      // 使用 innerHTML 批次寫入，避免逐行 createElement
      const posHtml = [];
      account.positions.forEach((p,k)=>{
        if(p.qty===0) return;
        const cls=p.upnl>=0?'red':'green';
        posHtml.push(`<tr>
          <td class="center">${k}</td>
          <td>${p.qty}</td>
          <td>${fmtNum(p.avg)}</td>
          <td>${p.last==null?'-':fmtNum(p.last)}</td>
          <td class="${cls}">${fmtNum(p.upnl)}</td></tr>`);
      });
      posTable.innerHTML = posHtml.join('');

      // 成交紀錄也用批次 innerHTML
      const ordHtml = [];
      account.orders.slice(-200).forEach(o=>{
        const cls=(o.realized||0)>=0?'red':'green';
        ordHtml.push(`<tr>
          <td class="center">${o.time.toLocaleString()}</td>
          <td class="center">${o.key}</td>
          <td>${o.side}</td>
          <td>${o.qty}</td>
          <td>${fmtNum(o.price)}</td>
          <td>${fmtNum(o.fee)}</td>
          <td class="${cls}">${fmtNum(o.realized)}</td></tr>`);
      });
      ordTable.innerHTML = ordHtml.join('');

      if(Number(riskEquityStop.value)>-999999 && eq<=Number(riskEquityStop.value)){
        btnBuy.disabled=true; btnSell.disabled=true;
      }else{ btnBuy.disabled=false; btnSell.disabled=false; }
    }
    function calcEquity(preUPnL){
      let u=(typeof preUPnL==='number')?preUPnL:0;
      if(preUPnL==null){ account.positions.forEach(p=>{ u+=(p.upnl||0); }); }
      return account.cash + u;
    }

    // ====== T 表 ======
    // ★ dirty flag：記住上次參數，沒變就跳過重建
    
    function rebuildTTable(cutoff=null){
      const expiry=expirySelect.value;
      if(!expiry){ tBody.innerHTML=''; _ttLastExpiry=null; return; }
      const callStr=typeAliases.call, putStr=typeAliases.put;
      const cutMs = cutoff ? +cutoff : Infinity;
      const sess = sessionSelect.value;

      // ★ 若 expiry / cutMs / session 都沒變，直接跳過（最常見的情況）
      if(expiry === _ttLastExpiry && cutMs === _ttLastCutMs && sess === _ttLastSess) return;
      _ttLastExpiry = expiry; _ttLastCutMs = cutMs; _ttLastSess = sess;

      // 用索引快速聚合：只遍歷當月的 key
      const map=new Map();
      const strikesSet = new Set();
      dataIndex.forEach((arr, k) => {
        const parts = k.split('|');
        if(parts[0] !== expiry) return;
        const strike = parts[1];
        const type = parts[2];
        const mapKey = `${strike}|${type}`;
        let o = null;
        for(const r of arr){
          if(r.dtms > cutMs) break; // arr 已按 dtms 排序，超過就停
          if(sess !== '全部' && !withinSession(r.time)) continue;
          strikesSet.add(strike);
          const vol = r.volume || 0;
          if(!o){
            o = {last:r.price, lastDtms:r.dtms, vol:vol, vwap_num:r.price*vol};
          } else {
            o.vol += vol;
            o.vwap_num += r.price * vol;
            if(r.dtms >= o.lastDtms){
              o.last = r.price;
              o.lastDtms = r.dtms;
            }
          }
        }
        if(o) map.set(mapKey, o);
      });

      const strikes=Array.from(strikesSet).sort((a,b)=>parseFloat(a)-parseFloat(b));
      const rows=[];
      for(const s of strikes){
        const c=map.get(`${s}|${callStr}`);
        const p=map.get(`${s}|${putStr}`);
        const cAvg=c&&c.vol?(c.vwap_num/c.vol):null;
        const pAvg=p&&p.vol?(p.vwap_num/p.vol):null;
        rows.push({ strike:s, cPrice:c?.last, cAvg, cVol:c?.vol, pPrice:p?.last, pAvg, pVol:p?.vol });
      }

      // === ATM 判斷 ===
      // 優先：txRawData 有資料時，用 TX 期貨現價找最近履約價（邏輯與 updateTXBar 一致）
      // 備用：從 TXO 資料以 put-call parity 推算（|cPrice - pPrice| 最小的履約價）
      let atmStrike = null;
      {
        let txLastPx = null;
        if(txDataIndex.length){
          const currentExpiry = (expirySelect.value||'').replace(/\s/g,'');
          const cutMs = cutoff ? +cutoff : Infinity;

          // 篩出 cutoff 以前且在交易時段的資料（同 updateTXBar 邏輯）
          let pool = [];
          for(const d of txDataIndex){
            if(d.dtms > cutMs) break;
            if(withinSession(d.time)) pool.push(d);
          }

          // 優先篩當月合約，無則同年月，再無則下一個到期月，最後用全部
          if(currentExpiry && pool.length){
            const same = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === currentExpiry);
            if(same.length){
              pool = same;
            } else {
              const ym = currentExpiry.slice(0,6);
              const sameYM = pool.filter(d => (d.expiry||'').slice(0,6) === ym);
              if(sameYM.length){
                pool = sameYM;
              } else {
                const allExpiries = [...new Set(pool.map(d => (d.expiry||'').replace(/\s/g,'')))].sort();
                const nextExpiry = allExpiries.find(e => e > currentExpiry);
                if(nextExpiry) pool = pool.filter(d => (d.expiry||'').replace(/\s/g,'') === nextExpiry);
              }
            }
          }

          if(pool.length) txLastPx = pool[pool.length - 1].price;
        }

        if(txLastPx != null){
          // 用 TX 現價找最近履約價
          let minDiff = Infinity;
          for(const r of rows){
            const diff = Math.abs(parseFloat(r.strike) - txLastPx);
            if(diff < minDiff){ minDiff = diff; atmStrike = r.strike; }
          }
        } else {
          // fallback：put-call parity — C 和 P 價差最小的履約價
          let minDiff = Infinity;
          for(const r of rows){
            if(r.cPrice != null && r.pPrice != null){
              const diff = Math.abs(r.cPrice - r.pPrice);
              if(diff < minDiff){ minDiff = diff; atmStrike = r.strike; }
            }
          }
        }
      }

      // === 20 點標示（保留）：C/P 各自權利金最接近 20 的履約價 ===
      const NEAR20_TARGET = 20;
      const NEAR20_MAX_ABS = 5;
      let near20C = null, near20P = null;
      for(const r of rows){
        if(r.cPrice != null && isFinite(r.cPrice)){
          const d = Math.abs(r.cPrice - NEAR20_TARGET);
          if(d <= NEAR20_MAX_ABS && (!near20C || d < near20C.d)) near20C = {strike:r.strike, d};
        }
        if(r.pPrice != null && isFinite(r.pPrice)){
          const d = Math.abs(r.pPrice - NEAR20_TARGET);
          if(d <= NEAR20_MAX_ABS && (!near20P || d < near20P.d)) near20P = {strike:r.strike, d};
        }
      }

      // === 計算漲跌（與上一次 T 表價格比較） ===
      const newPrices = new Map();
      for(const r of rows){
        if(r.cPrice != null) newPrices.set(`${r.strike}|C`, r.cPrice);
        if(r.pPrice != null) newPrices.set(`${r.strike}|P`, r.pPrice);
      }

      for(const r of rows){
        r._atm   = (atmStrike != null && r.strike == atmStrike);
        r._n20c  = !!(near20C && r.strike == near20C.strike);
        r._n20p  = !!(near20P && r.strike == near20P.strike);
        // 漲跌 = 現價 - 上次價
        const prevC = prevTTablePrices.get(`${r.strike}|C`);
        const prevP = prevTTablePrices.get(`${r.strike}|P`);
        r.cChg = (r.cPrice != null && prevC != null) ? +(r.cPrice - prevC).toFixed(1) : null;
        r.pChg = (r.pPrice != null && prevP != null) ? +(r.pPrice - prevP).toFixed(1) : null;
      }
      // 儲存本次價格供下次比較
      prevTTablePrices = newPrices;

      function chgHtml(v){
        if(v == null || !isFinite(v)) return '<span style="color:#999">—</span>';
        if(v > 0) return `<span class="red">+${v}</span>`;
        if(v < 0) return `<span class="green">${v}</span>`;
        return '<span style="color:#999">0</span>';
      }

      tBody.innerHTML=rows.map(r=>{
        const rowCls = [r._atm?'n20-row-both':'', r._n20c&&r._n20p&&!r._atm?'n20-row-both':''].filter(Boolean).join(' ');
        const tags = [
          r._atm  ? '<span class="tag tag-atm">ATM</span>' : '',
          r._n20c ? '<span class="tag tag-n20c">C≈20</span>' : '',
          r._n20p ? '<span class="tag tag-n20p">P≈20</span>' : ''
        ].join('');
        const c01 = (r.cPrice != null && Math.abs(r.cPrice - 0.1) < 0.0001) ? ' price-01' : '';
        const p01 = (r.pPrice != null && Math.abs(r.pPrice - 0.1) < 0.0001) ? ' price-01' : '';
        return `
        <tr data-strike="${r.strike}" class="${rowCls}">
          <td>${numberOrDash(r.cVol)}</td>
          <td>${chgHtml(r.cChg)}</td>
          <td class="td-c side-call ${r._n20c?'n20c':''}${c01}" data-side="C" data-strike="${r.strike}">${numberOrDash(r.cPrice)}</td>
          <td class="center strike td-strike" data-strike="${r.strike}">${r.strike}${tags}</td>
          <td class="td-p side-put ${r._n20p?'n20p':''}${p01}" data-side="P" data-strike="${r.strike}">${numberOrDash(r.pPrice)}</td>
          <td>${chgHtml(r.pChg)}</td>
          <td>${numberOrDash(r.pVol)}</td>
        </tr>`;
      }).join('');

      // 事件委派已移至 tBody 上層（只綁一次），不再每次 rebuild 重綁
      highlightTSelected();

      // === 回測時自動捲到 ATM 為中心（使用者手動操作後不再自動移動）===
      if(cutoff && atmStrike != null && !userManualMode){
        const atmRow = tBody.querySelector(`tr[data-strike="${atmStrike}"]`);
        if(atmRow){
          const container = tBody.closest('.tbody');
          if(container){
            const rowTop = atmRow.offsetTop;
            const containerH = container.clientHeight;
            const rowH = atmRow.offsetHeight;
            container.scrollTop = rowTop - (containerH / 2) + (rowH / 2);
          }
        }
      }
    }
    let _prevSelTR = null; // 快取上次選取的 TR
    function highlightTSelected(){
      const strike=strikeSelect.value;
      if(_prevSelTR) _prevSelTR.classList.remove('sel');
      const tr=tBody.querySelector(`tr[data-strike="${strike}"]`);
      if(tr) tr.classList.add('sel');
      _prevSelTR = tr;
    }
