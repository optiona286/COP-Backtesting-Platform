    // ====== Black-Scholes Greeks 計算 ======

    // 標準常態分佈 CDF（Abramowitz & Stegun 近似）
    function normCDF(x) {
      const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
      const sign = x < 0 ? -1 : 1;
      x = Math.abs(x) / Math.sqrt(2);
      const t = 1 / (1 + p * x);
      const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
      return 0.5 * (1 + sign * y);
    }

    // 標準常態分佈 PDF
    function normPDF(x) {
      return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI);
    }

    // 用二分法從市價反推 IV（最多50次迭代）
    function calcIV(S, K, T, r, marketPrice, isCall) {
      if(T <= 0 || marketPrice <= 0) return null;
      let lo = 0.001, hi = 10, mid, price;
      for(let i = 0; i < 50; i++) {
        mid = (lo + hi) / 2;
        const bs = bsPrice(S, K, T, r, mid, isCall);
        if(bs > marketPrice) hi = mid;
        else lo = mid;
        if(hi - lo < 0.0001) break;
      }
      return mid;
    }

    // BS 定價
    function bsPrice(S, K, T, r, sigma, isCall) {
      if(T <= 0 || sigma <= 0) return 0;
      const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
      const d2 = d1 - sigma*Math.sqrt(T);
      if(isCall) return S*normCDF(d1) - K*Math.exp(-r*T)*normCDF(d2);
      else       return K*Math.exp(-r*T)*normCDF(-d2) - S*normCDF(-d1);
    }

    // 計算所有 Greeks
    function calcGreeks(S, K, T, r, sigma, isCall) {
      if(T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return null;
      const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
      const d2 = d1 - sigma*Math.sqrt(T);
      const nd1 = normPDF(d1);
      const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;
      const gamma = nd1 / (S * sigma * Math.sqrt(T));
      const theta = isCall
        ? (-S*nd1*sigma/(2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*normCDF(d2)) / 365
        : (-S*nd1*sigma/(2*Math.sqrt(T)) + r*K*Math.exp(-r*T)*normCDF(-d2)) / 365;
      const vega  = S * nd1 * Math.sqrt(T) / 100; // per 1% IV change
      return { delta, gamma, theta, vega };
    }

    // 更新 Greeks 卡片
    function updateGreeksCard(strike, cutoff) {
      const card = document.getElementById('greeksCard');
      console.log('[Greeks] called, strike=', strike, 'card=', !!card);
      if(!card || !strike) { console.log('[Greeks] early exit: no card or no strike'); if(card) card.style.display='none'; return; }

      const expiry  = expirySelect.value;
      console.log('[Greeks] expiry=', expiry);
      if(!expiry) { card.style.display='none'; return; }

      // 取 TX 現價作為 S
      let S = null;
      if(txDataIndex.length) {
        const cutMs = cutoff ? +cutoff : Infinity;
        for(let i = txDataIndex.length-1; i >= 0; i--) {
          const d = txDataIndex[i];
          if(d.dtms <= cutMs && withinSession(d.time)) { S = d.price; break; }
        }
      }
      // ★ 沒有 TX 現價時，用 Call/Put 價差最小的履約價估算 S（ATM 估計）
      if(!S) {
        // 從 T 字表所有行找 |cPrice - pPrice| 最小的履約價
        let minDiff = Infinity;
        dataIndex.forEach((arr, k) => {
          const parts = k.split('|');
          if(parts[0] !== expiry) return;
          const sk = parts[1], ty = parts[2];
          const cutMs2 = cutoff ? +cutoff : Infinity;
          let last = null;
          for(const r of arr) { if(r.dtms <= cutMs2) last = r.price; else break; }
          if(last == null) return;
          if(!window._greeksTmp) window._greeksTmp = {};
          if(!window._greeksTmp[sk]) window._greeksTmp[sk] = {};
          if(ty === typeAliases.call) window._greeksTmp[sk].c = last;
          else window._greeksTmp[sk].p = last;
        });
        if(window._greeksTmp) {
          Object.entries(window._greeksTmp).forEach(([sk, v]) => {
            if(v.c != null && v.p != null) {
              const diff = Math.abs(v.c - v.p);
              if(diff < minDiff) { minDiff = diff; S = parseFloat(sk); }
            }
          });
          window._greeksTmp = null;
        }
      }
      if(!S) { card.style.display='none'; return; }

      const K  = parseFloat(strike);
      const r  = 0.015; // 無風險利率 1.5%

      // 計算剩餘天數 T（年）
      let T = 0;
      const seq = window._contractSeq || [];
      const nowMs = cutoff ? +cutoff : Date.now();
      // 從 _contractSeq 找對應契約的結算日
      // 用 expirySelect 值去 _contractSeq 找結算日
      const contractKey = (expirySelect.value || '').trim().toUpperCase();
      let settleMs = null;
      for(const s of seq) {
        const sk = (s.key||s.contractMonth||'').trim().toUpperCase();
        if((sk === contractKey || sk.replace(/\s/g,'') === contractKey.replace(/\s/g,'')) && s.endDate) {
          settleMs = +s.endDate; break;
        }
      }
      if(!settleMs) {
        // fallback：從 expiry 字串解析 YYYYMM → 當月第三個週三
        const ym = expiry.replace(/W\d$/,'').slice(0,6);
        if(ym.length === 6) {
          const yr = parseInt(ym.slice(0,4)), mo = parseInt(ym.slice(4,6))-1;
          const d = new Date(yr, mo, 1);
          let wed = 0;
          for(let dd=1; dd<=31; dd++) {
            const dt = new Date(yr, mo, dd);
            if(dt.getMonth() !== mo) break;
            if(dt.getDay() === 3) { wed++; if(wed===3){ settleMs=+dt; break; } }
          }
        }
      }
      if(settleMs) {
        T = Math.max(0, (settleMs - nowMs) / (1000*60*60*24*365));
      }
      if(T <= 0) T = 7/365; // ★ fallback：至少用 7 天避免除以零

      const callPrice = getLastPrice(expiry, strike, typeAliases.call, cutoff);
      const putPrice  = getLastPrice(expiry, strike, typeAliases.put,  cutoff);

      function fmt(v, dec=4) { return v==null ? '—' : v.toFixed(dec); }
      function fmtPct(v) { return v==null ? '—' : (v*100).toFixed(1)+'%'; }

      // CALL
      if(callPrice != null) {
        const iv = calcIV(S, K, T, r, callPrice, true);
        const g  = iv ? calcGreeks(S, K, T, r, iv, true) : null;
        document.getElementById('gCallDelta').textContent = g ? fmt(g.delta,3) : '—';
        document.getElementById('gCallGamma').textContent = g ? fmt(g.gamma,4) : '—';
        document.getElementById('gCallTheta').textContent = g ? fmt(g.theta,2) : '—';
        document.getElementById('gCallVega').textContent  = g ? fmt(g.vega,2)  : '—';
        document.getElementById('gCallIV').textContent    = iv ? fmtPct(iv)    : '—';
      } else {
        ['gCallDelta','gCallGamma','gCallTheta','gCallVega','gCallIV'].forEach(id=>{ document.getElementById(id).textContent='—'; });
      }

      // PUT
      if(putPrice != null) {
        const iv = calcIV(S, K, T, r, putPrice, false);
        const g  = iv ? calcGreeks(S, K, T, r, iv, false) : null;
        document.getElementById('gPutDelta').textContent = g ? fmt(g.delta,3) : '—';
        document.getElementById('gPutGamma').textContent = g ? fmt(g.gamma,4) : '—';
        document.getElementById('gPutTheta').textContent = g ? fmt(g.theta,2) : '—';
        document.getElementById('gPutVega').textContent  = g ? fmt(g.vega,2)  : '—';
        document.getElementById('gPutIV').textContent    = iv ? fmtPct(iv)    : '—';
      } else {
        ['gPutDelta','gPutGamma','gPutTheta','gPutVega','gPutIV'].forEach(id=>{ document.getElementById(id).textContent='—'; });
      }

      document.getElementById('greeksStrikeLabel').textContent = `履約價 ${strike}　S=${S.toFixed(0)}　T=${(T*365).toFixed(1)}天`;
      card.style.display = '';
    }
