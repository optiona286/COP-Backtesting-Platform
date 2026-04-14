// ====== 資料索引（效能核心）======
    // 將 rawData 按 expiry|strike|type 分組，組內按 dtms 排序
    // 這樣 getLastPrice 可用二分搜尋 O(log n) 取代 O(n) 全掃描
    let txDataIndex = []; // TX sorted by dtms for binary search
    window.txDataIndex = txDataIndex; // ★ 讓浮動視窗可存取

    function buildDataIndex(){
      dataIndex.clear();
      for(const d of rawData){
        const k = keyOf(d.expiry, d.strike, d.type);
        let arr = dataIndex.get(k);
        if(!arr){ arr = []; dataIndex.set(k, arr); }
        arr.push(d);
      }
      // 每組按 dtms 排序
      dataIndex.forEach(arr => arr.sort((a,b) => a.dtms - b.dtms));
      // TX 索引
      txDataIndex = txRawData.slice().sort((a,b) => a.dtms - b.dtms);
      window.txDataIndex = txDataIndex; // ★ 同步
    }

    function sanitizeTimeStr(s){ return (s||'').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6) }
    function makeDateObj(dateStr,timeStr){
      const t=sanitizeTimeStr(timeStr);
      const y=dateStr.slice(0,4),m=dateStr.slice(4,6),d=dateStr.slice(6,8);
      const hh=t.slice(0,2),mm=t.slice(2,4),ss=t.slice(4,6)||'00';
      const dt=new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
      // OptionsDaily 的成交日期為「日曆日」：夜盤(15:00~23:59)用前一日日期、凌晨(00:00~05:00)用當日日期
      // 因此不再做跨日 +1 補正，避免日期被推到隔天造成 X 軸錯亂
      return dt;
    }
    function withinSession(tstr){
      const t=sanitizeTimeStr(tstr), sess=sessionSelect.value;
      if (sess==='全部') return true;
      if (sess==='一般') return t>='084500' && t<='134500';
      if (sess==='盤後') return (t>='150000' || t<='050000');
      return true;
    }
    window.withinSession = withinSession; // ★ 暴露給 gauge.js 等外部腳本使用
    function fmtTime(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}` }
    function hhmmss(dt){ const p=n=>String(n).padStart(2,'0'); return `${p(dt.getHours())}${p(dt.getMinutes())}${p(dt.getSeconds())}` }
    function findIndexByTimeStr(hms){
      const t=(hms||'').replace(/[^0-9]/g,'').padEnd(6,'0').slice(0,6);
      if (!playTimes.length) return -1;
      let idx=playTimes.findIndex(dt=>hhmmss(dt)>=t);
      if (idx===-1) idx=playTimes.length-1;
      return idx;
    }
    function detectTypeAliasesForExpiry(expiry){
      const types = new Set();
      dataIndex.forEach((arr, k) => {
        if(k.startsWith(expiry + '|') && arr.length) types.add(k.split('|')[2]);
      });
      const typesArr = Array.from(types);
      let call=null, put=null;
      for(const t of typesArr){
        const u=t.toUpperCase();
        if(!call && (u==='C'||u.includes('CALL')||u.includes('買'))) call=t;
        if(!put && (u==='P'||u.includes('PUT') ||u.includes('賣'))) put=t;
      }
      if(!call && typesArr.length) call=typesArr[0];
      if(!put && typesArr.length) put=typesArr.find(x=>x!==call)||typesArr[0];
      return {call,put};
    }
    function numberOrDash(x){ return (x==null || isNaN(x)) ? '-' : x }

    function getLastPrice(expiry,strike,type,cutoff){
      const k = keyOf(expiry, strike, type);
      const arr = dataIndex.get(k);
      if(!arr || !arr.length) return null;
      const sess = sessionSelect.value;
      const cutMs = cutoff ? +cutoff : Infinity;
      // 逆序找最後一筆符合 session + cutoff 的（大部分情況下接近尾端，速度極快）
      for(let i = arr.length - 1; i >= 0; i--){
        const d = arr[i];
        if(d.dtms > cutMs) continue;
        if(sess !== '全部' && !withinSession(d.time)) continue;
        return d.price;
      }
      return null;
    }

    function ymdToISO(ymd){
      if(!ymd || ymd.length!==8) return '';
      return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
    }

    // ====== File Load（資料夾模式 + 合併模式） ======
    let folderFiles = []; // 儲存資料夾中所有檔案
    let dateFileMap = new Map(); // date -> { op: File[], fu: File[] }
    const dateSelect = document.getElementById('dateSelect');
    const loadStatus = document.getElementById('loadStatus');
    const btnRefresh  = document.getElementById('btnRefresh');
    const btnModeSingle = document.getElementById('btnModeSingle');
    const btnModeMerge  = document.getElementById('btnModeMerge');
    const mergeProgressEl    = document.getElementById('mergeProgress');
    const mergeProgressFill  = document.getElementById('mergeProgressFill');
    const mergeProgressPct   = document.getElementById('mergeProgressPct');
    const mergeProgressLabel = document.getElementById('mergeProgressLabel');

    let viewMode = 'single'; // 'single' | 'merge'

    // 模式切換
    btnModeSingle.addEventListener('click', ()=>{
      viewMode = 'single';
      btnModeSingle.classList.add('mode-active');
      btnModeMerge.classList.remove('mode-active');
      document.getElementById('lblDate').textContent = '交易日：';
      // 重建選單（顯示個別日期）
      rebuildDateSelect();
      btnRefresh.style.display = dateSelect.value ? '' : 'none';
    });
    btnModeMerge.addEventListener('click', ()=>{
      viewMode = 'merge';
      btnModeMerge.classList.add('mode-active');
      btnModeSingle.classList.remove('mode-active');
      document.getElementById('lblDate').textContent = '資料範圍：';
      rebuildDateSelect();
      btnRefresh.style.display = dateFileMap.size ? '' : 'none';
    });

    // 更新按鈕
    btnRefresh.addEventListener('click', async ()=>{
      if(viewMode === 'merge'){
        await loadMergedData();
      } else {
        const dateKey = dateSelect.value;
        if(dateKey) await loadSingleDate(dateKey);
      }
    });

    // 通用工具函式
    const decodeGuess = (buf)=>{
      const stripBom = (s)=> (s||'').replace(/^\uFEFF/, '');
      const hasKey = (s)=> s && (s.includes('成交日期') || s.includes('交易日期') || s.includes('商品代號'));
      const tryDec = (enc)=>{ try { return new TextDecoder(enc, { fatal:false }).decode(buf); } catch(_){ return null; } };
      let t = stripBom(tryDec('utf-8'));
      if (hasKey(t)) return t;
      t = stripBom(tryDec('big5')) || stripBom(tryDec('cp950')) || t || '';
      return t;
    };
    const readRPTEntry = async (zip, name)=>{
      const buf = await zip.files[name].async('arraybuffer');
      return decodeGuess(buf);
    };

    // 從一組 Files 讀取所有行
    // ── 讀取單一 File → 回傳行陣列（用於並行）
    async function readOneFile(file){
      const name = (file.name||'').toLowerCase();
      const rows = [];
      if(name.endsWith('.zip')){
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.keys(zip.files)
            .filter(n => n.toLowerCase().endsWith('.rpt') && !zip.files[n].dir);
          // zip 內的 rpt 也並行解壓
          const texts = await Promise.all(entries.map(rptName => readRPTEntry(zip, rptName)));
          for(const text of texts){
            if(text) text.split(/\r?\n/).forEach(l=>rows.push(l));
          }
        } catch(err){ console.warn('ZIP 讀取失敗:', file.name, err); }
      } else if(name.endsWith('.rpt')){
        try {
          const buf = await file.arrayBuffer();
          const text = decodeGuess(buf);
          if(text) text.split(/\r?\n/).forEach(l=>rows.push(l));
        } catch(err){ console.warn('RPT 讀取失敗:', file.name, err); }
      }
      return rows;
    }

    // ── 並行讀取多個 File（舊介面相容）
    async function readFilesRows(files){
      const results = await Promise.all(files.map(f => readOneFile(f)));
      return results.flat();
    }

    // 解析 rows → rawData, txRawData
    function parseRows(rows){
      const opData = rows
        .map(line=>line.trim().split(',').map(s=>s.trim()))
        .filter(d=>d.length>=8 && d[1]==='TXO')
        .map(d=>{
          const dtObj = makeDateObj(d[0], d[5]);
          return { date:d[0], product:d[1], strike:d[2], expiry:d[3], type:d[4],
            time:d[5], dtms: +dtObj, price:parseFloat(d[6]), volume:parseInt(d[7]), openFlag:d[8]||'' };
        })
        .filter(d=>!isNaN(d.price) && !isNaN(d.volume));

      const fuData = rows
        .map(line => line.trim().split(',').map(s => s.trim()))
        .filter(d => {
          if(d.length < 5) return false;
          const p = (d[1]||'').toUpperCase();
          return p === 'TX';
        })
        .map(d => {
          let time, price, volume, expiry;
          const d2 = d[2]||'';
          const isFutFormat = (/^\d{6}$/.test(d2) || /^\d{4,6}\s*$/.test(d2)) && /^20\d{4}/.test(d2.trim());
          if(isFutFormat){
            expiry = d[2]; time = d[3]||''; price = parseFloat(d[4]); volume = parseInt(d[5])||0;
          } else {
            expiry = d[3]||''; time = d[5]||''; price = parseFloat(d[6]); volume = parseInt(d[7])||0;
          }
          const dtObj = makeDateObj(d[0], time);
          return { date:d[0], product:d[1], expiry:expiry.replace(/\s/g,''), time, dtms:+dtObj, price, volume };
        })
        .filter(d => !isNaN(d.price) && d.price > 0);

      return { opData, fuData };
    }

    // 重建下拉選單（獨立/合併 共用）
    function rebuildDateSelect(){
      if(!dateFileMap.size){
        dateSelect.innerHTML = '<option value="">（請先選擇資料夾）</option>';
        dateSelect.disabled = true;
        btnRefresh.style.display = 'none';
        return;
      }
      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>b.localeCompare(a));
      if(viewMode === 'merge'){
        // 合併模式：只顯示一個「全部 N 天」選項
        const y1 = dates[dates.length-1].replace(/_/g,'/');
        const y2 = dates[0].replace(/_/g,'/');
        dateSelect.innerHTML = `<option value="__merge__">全部 ${dates.length} 個交易日（${y1} ～ ${y2}）</option>`;
        dateSelect.disabled = false;
        btnRefresh.style.display = '';
      } else {
        dateSelect.innerHTML = '<option value="">— 請選擇交易日 —</option>' +
          dates.map(d=>{
            const info = dateFileMap.get(d);
            const opCount = info.op.length;
            const fuCount = info.fu.length;
            const label = d.replace(/_/g, '/');
            const tag = opCount && fuCount ? '✓OP+FU' : opCount ? 'OP only' : 'FU only';
            return `<option value="${d}">${label}（${tag}）</option>`;
          }).join('');
        dateSelect.disabled = false;
        btnRefresh.style.display = 'none';
      }
    }

    // 步驟 1：使用者選資料夾 → 掃描所有 zip，解析日期，建立下拉選單
    document.getElementById('folderInput').addEventListener('change', async (e)=>{
      folderFiles = Array.from(e.target.files || []);
      if(!folderFiles.length) return;

      dateFileMap.clear();
      dateSelect.innerHTML = '<option value="">解析中...</option>';
      dateSelect.disabled = true;
      loadStatus.textContent = `掃描 ${folderFiles.length} 個檔案...`;

      const dateRe_opt = /^OptionsDaily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})/i;
      const dateRe_fut = /^Daily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})/i;

      for(const file of folderFiles){
        const name = (file.name||'');
        let m, dateKey, kind;
        m = name.match(dateRe_opt);
        if(m){ dateKey = `${m[1]}_${m[2]}_${m[3]}`; kind = 'op'; }
        else {
          m = name.match(dateRe_fut);
          if(m){ dateKey = `${m[1]}_${m[2]}_${m[3]}`; kind = 'fu'; }
        }
        if(!dateKey) continue;
        if(!dateFileMap.has(dateKey)) dateFileMap.set(dateKey, { op:[], fu:[] });
        dateFileMap.get(dateKey)[kind].push(file);
      }

      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>b.localeCompare(a));

      if(!dates.length){
        dateSelect.innerHTML = '<option value="">未找到符合的資料</option>';
        loadStatus.textContent = '未偵測到 OptionsDaily / Daily 命名的檔案';
        btnRefresh.style.display = 'none';
        return;
      }

      rebuildDateSelect();
      loadStatus.textContent = `找到 ${dates.length} 個交易日`;
      btnRefresh.style.display = (viewMode === 'merge') ? '' : 'none';

      // 合併模式：自動開始合併
      if(viewMode === 'merge') await loadMergedData();
    });

    // ===== 合併模式：全部並行載入 =====
    async function loadMergedData(){
      const dates = Array.from(dateFileMap.keys()).sort((a,b)=>a.localeCompare(b));
      if(!dates.length){ alert('沒有可合併的資料'); return; }

      const total = dates.length;
      mergeProgressEl.style.display = 'flex';
      btnRefresh.disabled = true;
      dateSelect.disabled = true;
      loadStatus.textContent = `並行合併 ${total} 個交易日...`;

      // 計數器：即時更新進度
      let done = 0;
      const updateProgress = (label) => {
        const pct = Math.round((done / total) * 100);
        mergeProgressFill.style.width = pct + '%';
        mergeProgressPct.textContent = pct + '%';
        mergeProgressLabel.textContent = label || `已完成 ${done} / ${total}`;
      };
      updateProgress('啟動並行讀取...');

      // 蒐集所有 File 物件（OP + FU），帶日期標記
      const allFileTasks = dates.flatMap(d => {
        const info = dateFileMap.get(d);
        return [...info.op, ...info.fu];
      });

      // ★ 全部並行！同時解壓所有 zip
      const rowArrays = await Promise.all(
        allFileTasks.map(file =>
          readOneFile(file).then(rows => {
            done++;
            updateProgress();
            return rows;
          })
        )
      );

      mergeProgressFill.style.width = '100%';
      mergeProgressPct.textContent = '100%';
      mergeProgressLabel.textContent = '解析資料中...';
      // 讓 UI 喘口氣再做 parseRows（可能幾十萬行）
      await new Promise(r => setTimeout(r, 0));

      const allRows = rowArrays.flat();
      const { opData, fuData } = parseRows(allRows);
      rawData = opData;
      txRawData = fuData;

      mergeProgressEl.style.display = 'none';
      btnRefresh.disabled = false;
      dateSelect.disabled = false;

      afterDataLoaded(`合併 ${total} 天`);
    }

    // ===== 載入單一日期 =====
    async function loadSingleDate(dateKey){
      const info = dateFileMap.get(dateKey);
      if(!info){ alert('找不到該日資料'); return; }

      loadStatus.textContent = '載入中...';
      dateSelect.disabled = true;
      btnRefresh.disabled = true;

      const rows = await readFilesRows([...info.op, ...info.fu]);

      if(!rows.length){
        alert('該日資料讀取為空，請確認檔案內容');
        loadStatus.textContent = '載入失敗';
        dateSelect.disabled = false;
        btnRefresh.disabled = false;
        return;
      }

      const { opData, fuData } = parseRows(rows);
      rawData = opData;
      txRawData = fuData;

      const dateLabel = dateKey.replace(/_/g, '/');
      btnRefresh.style.display = '';
      btnRefresh.disabled = false;
      dateSelect.disabled = false;
      afterDataLoaded(dateLabel);
    }

    // ===== 資料載入後的共用初始化 =====
    function afterDataLoaded(label){
      buildDataIndex();
      if(!rawData.length && !txRawData.length){
        alert(`${label} 未找到 TXO 或 TX 資料`);
        loadStatus.textContent = `${label}：無資料`;
        return;
      }

      resetAccount();
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null;
      trendChartInited = false; trendChartKey = '';
      taChartInited = false; taChartKey = '';
      cutoffTime = null; simTime = null;
      autoOrderActive = false;
      autoOrderPositions = [];
      autoOrderEnteredKeys = new Set();
      s1Status.textContent='未啟動'; s1Status.className='s1-status stopped';
      bt20Run.style.display=''; bt20Stop.style.display='none';
      s1Cards.style.display='none'; s1TblWrap.style.display='none';
      s1Body.innerHTML='<tr><td colspan="9" style="text-align:center;color:#aaa;padding:14px">請設定條件後按「啟動自動下單」，再開始回測播放</td></tr>';
      document.getElementById('statWinner').style.display='none';
      document.getElementById('statPattern').style.display='none';
      document.getElementById('statSub20').style.display='none';

      if(rawData.length){
        updateSelectors();
        rebuildPlayTimes();
        renderChart();
        rebuildTTable();
      }
      updateTXBar();
      updateBtUI();
      updateAccountUI();

      const opCount = rawData.length;
      const fuCount = txRawData.length;
      loadStatus.textContent = `${label}：OP ${opCount.toLocaleString()} 筆 / FU ${fuCount.toLocaleString()} 筆`;

      // 如果已有結算資料，重新篩契約選單年份
      if(window._contractSeq && window._contractSeq.length) buildContractSequence();

      // 清空之前的契約篩選備份
      window._fullRawData   = null;
      window._fullTxRawData = null;
    }

    // 步驟 2：選日期 → 載入該日的 op + fu 資料
    dateSelect.addEventListener('change', async ()=>{
      const dateKey = dateSelect.value;
      if(!dateKey) return;
      if(dateKey === '__merge__'){
        await loadMergedData();
      } else {
        await loadSingleDate(dateKey);
      }
    });