const BACKEND_API = 'http://localhost:5000';
    
    document.addEventListener('DOMContentLoaded', async function() {
      console.log('🔌 初始化後端整合（後端解壓版本）...');
      await loadContractsFromBackend();
      setupBackendContractListener();
    });
    
    async function loadContractsFromBackend() {
      try {
        console.log('📡 正在從後端載入契約列表...');
        const response = await fetch(`${BACKEND_API}/api/contracts`);
        const result = await response.json();
        
        if (result.status === 'success' && result.contracts) {
          console.log(`✓ 成功取得 ${result.contracts.length} 個契約`);
          populateContractSelect(result.contracts);
          showNotification(`✓ 已載入 ${result.contracts.length} 個契約`, 'success');
        }
      } catch (error) {
        console.error('❌ 後端連接失敗:', error);
        showNotification(`❌ 無法連接後端: ${error.message}`, 'error');
      }
    }
    
    function populateContractSelect(contracts) {
      const selectElement = document.getElementById('contractSelect');
      if (!selectElement) return;
      
      while (selectElement.options.length > 1) {
        selectElement.remove(1);
      }
      
      const byType = { 'M': [], 'W': [], 'F': [] };
      contracts.forEach(c => {
        if (byType[c.typeLabel]) byType[c.typeLabel].push(c);
      });
      
      if (byType['M'].length > 0) {
        const group = document.createElement('optgroup');
        group.label = '月選 (M)';
        byType['M'].forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.className = 'opt-monthly';
          opt.textContent = `${c.key} (${c.settleDate}) - FSP: ${c.txoFSP}`;
          group.appendChild(opt);
        });
        selectElement.appendChild(group);
      }
      
      if (byType['W'].length > 0) {
        const group = document.createElement('optgroup');
        group.label = '週選 (W)';
        byType['W'].forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.className = 'opt-weekly';
          opt.textContent = `${c.key} (${c.settleDate}) - FSP: ${c.txoFSP}`;
          group.appendChild(opt);
        });
        selectElement.appendChild(group);
      }
      
      if (byType['F'].length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'F契約 (F)';
        byType['F'].forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.key;
          opt.textContent = `${c.key} (${c.settleDate}) - FSP: ${c.txoFSP}`;
          group.appendChild(opt);
        });
        selectElement.appendChild(group);
      }
      
      selectElement.disabled = false;
      console.log('✓ 契約選單已更新');
    }
    
    function setupBackendContractListener() {
      const selectElement = document.getElementById('contractSelect');
      if (!selectElement) return;
      
      selectElement.addEventListener('change', async (event) => {
        const contractKey = event.target.value;
        if (!contractKey) return;
        
        console.log(`📊 選中契約: ${contractKey}`);
        await loadContractDataFromBackend(contractKey);
      });
    }
    
    async function loadContractDataFromBackend(contractKey) {
      try {
        console.log(`📡 正在從後端載入 ${contractKey} 的 6 日資料...`);
        loadStatus.textContent = `載入 ${contractKey} 中...`;

        const response = await fetch(`${BACKEND_API}/api/contract-data/${contractKey}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        console.log(`  回應大小: ${(text.length/1024).toFixed(1)} KB`);
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseErr) {
          console.error('❌ JSON 末尾 300 字元:', text.slice(-300));
          throw new Error(`JSON 解析失敗（回應 ${(text.length/1024).toFixed(0)} KB，可能被截斷）`);
        }

        if (result.status === 'success') {
          const { totalOp = 0, totalFu = 0, filesFound = 0 } = result.summary || {};
          console.log(`✓ 成功取得資料`);
          console.log(`  - 日期範圍: ${result.dateRange.join(' → ')}`);
          console.log(`  - 檔案數: ${filesFound}`);
          console.log(`  - OP tick: ${totalOp}, FU tick: ${totalFu}`);

          // 動態更新「顯示N日」選項上限
          const dvsEl = document.getElementById('daysViewSelect');
          if (dvsEl && result.totalDays) {
            const cur = dvsEl.value;
            let opts = '<option value="0">全週期</option>';
            for (let i = 1; i <= result.totalDays; i++) {
              opts += `<option value="${i}">近${i}日</option>`;
            }
            dvsEl.innerHTML = opts;
            dvsEl.value = (parseInt(cur) <= result.totalDays) ? cur : '0';
          }

          processBackendData(result);

          showNotification(
            `✓ ${contractKey}：OP ${totalOp.toLocaleString()} 筆 / FU ${totalFu.toLocaleString()} 筆`,
            'success'
          );
        } else {
          throw new Error(result.message || '未知錯誤');
        }
      } catch (error) {
        console.error('❌ 載入失敗:', error);
        loadStatus.textContent = `載入失敗：${error.message}`;
        showNotification(`❌ ${error.message}`, 'error');
      }
    }

    /**
     * 處理後端 v2 API 的結構化回應
     *
     * 後端已過濾並解析，直接返回：
     *   result.opData = [{ date, product, strike, expiry, type, time, price, volume, openFlag }, ...]
     *   result.fuData = [{ date, product, expiry, time, price, volume }, ...]
     *
     * 只需補上 dtms 欄位（前端圖表需要），其餘欄位與 parseRows() 輸出完全相同。
     */
    // 全域：目前後端資料的完整交易日清單（YYYYMMDD 字串陣列）
    window._backendDateRange = [];

    function processBackendData(result) {
      console.log('\n📦 處理後端結構化資料...');

      const opRaw = result.opData || [];
      const fuRaw = result.fuData || [];

      // 補上 dtms
      const opData = opRaw.map(d => {
        return { ...d, dtms: +makeDateObj(d.date, d.time) };
      }).filter(d => !isNaN(d.price) && !isNaN(d.volume));

      const fuData = fuRaw.map(d => {
        return { ...d, dtms: +makeDateObj(d.date, d.time) };
      }).filter(d => !isNaN(d.price) && d.price > 0);

      console.log(`✓ OP ${opData.length} 筆，FU ${fuData.length} 筆`);
      if (result.prevContract) {
        console.log(`✓ 起點契約: ${result.prevContract.key} (${result.prevContract.settleDate})`);
      }

      if (!opData.length && !fuData.length) {
        showNotification('⚠ 無有效資料', 'error');
        return;
      }

      // 記住完整交易日清單，供「近N日」過濾使用
      window._backendDateRange = result.dateRange || [];
      // 存完整資料供切換日數使用
      window._fullBackendOp = opData;
      window._fullBackendFu = fuData;

      // 套用目前「顯示N日」設定
      applyDaysViewFilter(opData, fuData, result);
    }

    /**
     * 根據 daysViewSelect 的設定，從完整資料切出最後 N 個交易日
     * 然後刷新圖表。可單獨呼叫（切換下拉時不重新請求後端）。
     *
     * 夜盤歸屬規則：
     *   1. prevDate 當天 15:00 之後（夜盤前半，date = prevDate）
     *   2. prevDate 之後、firstDate 之前的非交易日（週六、連假）的所有資料
     *      → 這段時間全部歸屬於 firstDate 的夜盤
     */
    function applyDaysViewFilter(opData, fuData, resultMeta) {
      opData     = opData  || window._fullBackendOp || [];
      fuData     = fuData  || window._fullBackendFu || [];
      resultMeta = resultMeta || {};

      const daysViewEl = document.getElementById('daysViewSelect');
      const n = daysViewEl ? parseInt(daysViewEl.value) : 0;

      let filteredOp = opData;
      let filteredFu = fuData;

      if (n > 0 && window._backendDateRange.length > 0) {
        const allDates  = window._backendDateRange;
        const keepDates = new Set(allDates.slice(-n));

        const firstDate    = allDates[allDates.length - n];
        const firstDateIdx = allDates.indexOf(firstDate);
        const prevDate     = firstDateIdx > 0 ? allDates[firstDateIdx - 1] : null;

        // 判斷是否屬於夜盤或交易日範圍內
        const isNightSession = (d) => {
          // 正常交易日內的資料
          if (keepDates.has(d.date)) return true;

          if (prevDate) {
            // prevDate 當天 15:00 之後（夜盤前半段）
            if (d.date === prevDate) {
              const t = (d.time || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6);
              return t >= '150000';
            }
            // prevDate 之後、firstDate 之前的非交易日（週六、連假凌晨）
            // 這段時間的所有資料都屬於 firstDate 的夜盤
            if (d.date > prevDate && d.date < firstDate) return true;
          }

          return false;
        };

        filteredOp = opData.filter(isNightSession);
        filteredFu = fuData.filter(isNightSession);

        console.log(
          `  近${n}日過濾：OP ${filteredOp.length} 筆` +
          `（${[...keepDates].join(', ')}）` +
          `+ 前一日 ${prevDate} 15:00後夜盤` +
          `+ 非交易日區間（${prevDate} ~ ${firstDate} 之間）`
        );
      }

      rawData   = filteredOp;
      txRawData = filteredFu;

      resetAccount();
      prevTTablePrices.clear(); _ttLastExpiry=null; _ttLastCutMs=-1; _ttLastSess=null;
      trendChartInited = false; trendChartKey = '';
      taChartInited = false; taChartKey = '';
      cutoffTime = null; simTime = null;
      autoOrderActive        = false;
      autoOrderPositions     = [];
      autoOrderEnteredKeys   = new Set();

      if (typeof buildDataIndex  === 'function') buildDataIndex();
      if (typeof updateSelectors === 'function') updateSelectors();
      if (typeof rebuildPlayTimes=== 'function') rebuildPlayTimes();
      if (typeof renderChart     === 'function') renderChart();
      if (typeof rebuildTTable   === 'function') rebuildTTable();
      if (typeof updateTXBar     === 'function') updateTXBar();
      if (typeof updateBtUI      === 'function') updateBtUI();
      if (typeof updateAccountUI === 'function') updateAccountUI();

      const label = resultMeta.contract ? resultMeta.contract.key : '';
      const totalDays = window._backendDateRange.length;
      const showDays  = n > 0 ? n : totalDays;
      loadStatus.textContent =
        `${label}：顯示 ${showDays}/${totalDays} 日，OP ${filteredOp.length.toLocaleString()} 筆`;

      if (window._contractSeq && window._contractSeq.length) buildContractSequence();
      window._fullRawData   = null;
      window._fullTxRawData = null;
    }

    // daysViewSelect 切換時直接重新過濾，不重新請求後端
    document.addEventListener('DOMContentLoaded', () => {
      const dvsEl = document.getElementById('daysViewSelect');
      if (dvsEl) {
        dvsEl.addEventListener('change', () => {
          if (window._fullBackendOp && window._fullBackendOp.length) {
            applyDaysViewFilter();
          }
        });
      }
    });
    
    function showNotification(message, type = 'info') {
      console.log(`[${type.toUpperCase()}] ${message}`);
      const notificationEl = document.getElementById('notification');
      if (notificationEl) {
        notificationEl.className = `notification ${type}`;
        notificationEl.textContent = message;
        notificationEl.style.display = 'block';
        setTimeout(() => { notificationEl.style.display = 'none'; }, 3000);
      }
    }