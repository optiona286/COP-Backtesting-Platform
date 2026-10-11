// Group the original settings nodes; keep IDs, values and listeners intact.
(() => {
  const host=document.getElementById('workspaceControls');
  const root=document.createElement('div');root.className='app-settings-list';
  const makeGroup=(title,hint)=>{
    const section=document.createElement('section');section.className='app-settings-group';
    const heading=document.createElement('h2');heading.textContent=title;
    const content=document.createElement('div');content.className='app-settings-options';
    const note=document.createElement('p');note.className='app-settings-note';note.textContent=hint;
    section.append(heading,content,note);root.append(section);return content;
  };
  function row(group,id,title,{wide=false,dynamic=false,selector=null}={}){
    const node=selector?document.querySelector(selector):document.getElementById(id);
    if(!node)return;
    let label=node.previousElementSibling;
    if(label?.tagName!=='LABEL')label=null;
    if(!label&&id==='dateSelect')label=document.getElementById('lblDate');
    if(!label&&selector)label=node.querySelector(':scope > label');
    if(!label){label=document.createElement('label');label.textContent=title;}
    if(node.tagName==='SELECT'||node.tagName==='INPUT')label.htmlFor=node.id;
    const entry=document.createElement('div');entry.className=`app-setting-row${wide?' app-setting-row-wide':''}`;
    const value=document.createElement('div');value.className='app-setting-value';
    entry.append(label,value);value.append(node);group.append(entry);
    if(dynamic){const sync=()=>{entry.hidden=node.hidden||node.style.display==='none';};sync();new MutationObserver(sync).observe(node,{attributes:true,attributeFilter:['hidden','style']});}
    return entry;
  }
  const product=makeGroup('商品與契約','先選擇結算日與契約，再調整想觀察的商品。');
  row(product,'dateSelect','結算日');row(product,'contractSelect','契約',{wide:true});
  row(product,'expirySelect','到期月份');row(product,'typeSelect','買賣權');
  row(product,null,'履約價',{selector:'.strike-group',wide:true});
  const data=makeGroup('資料與時段','檢視方式與時間範圍會沿用原有資料篩選規則。');
  row(data,'sessionSelect','交易時段');row(data,'daysViewSelect','顯示範圍');
  row(data,'backendViewControls','契約檢視',{wide:true,dynamic:true});
  row(data,'settlementAxisControls','特殊時段',{wide:true});
  const chart=makeGroup('圖表顯示','調整 K 線週期、圖表種類與顯示的輔助資訊。');
  row(chart,'periodSelect','週期');row(chart,'chartTypeSelect','圖表類型');
  row(chart,'hourlyExtremeControls','區間紀錄',{wide:true,dynamic:true});
  const indicators=makeGroup('均線設定','可保留預設均線，或展開自訂週期。');
  row(indicators,'maBox','均線',{wide:true});row(indicators,'maCfgBtn','自訂均線');
  row(indicators,'maCfgPanel','自訂週期',{wide:true,dynamic:true});
  const system=makeGroup('外觀與資料更新','切換主題或查看最後結算價資料。');
  row(system,'themeBtn','外觀主題');row(system,'btnFetchFSP','結算價資料');
  const status=document.getElementById('loadStatus');status.classList.add('app-settings-status');root.append(status);
  host.append(root);
})();
