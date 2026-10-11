/* Static-host adapter: retain existing API contracts, read only this site's data. */
(() => {
  'use strict';
  if(window.OP_PRO_CONFIG.dataSource!=='compressed')return;
  const nativeFetch=window.fetch.bind(window);
  const base=new URL('./',document.baseURI),cache=new Map();
  const configuredDataUrl=String(window.OP_PRO_CONFIG.dataBaseUrl||'').trim();
  const dataBase=configuredDataUrl?new URL(configuredDataUrl.replace(/\/+$/,'')+'/',base):new URL('data/',base);
  let catalogPromise;
  const compact=d=>d.replace(/-/g,''),iso=d=>/^\d{8}$/.test(d)?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`:d.replace(/\//g,'-');
  async function catalog(){
    if(!catalogPromise)catalogPromise=nativeFetch(new URL('online-index.json',dataBase),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('壓縮資料索引尚未產生');return r.json();}).catch(e=>{catalogPromise=null;throw e;});
    return catalogPromise;
  }
  async function daily(market,day,signal){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const key=`${market}/${day}`;
    if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}
    const r=await nativeFetch(new URL(`${key}.json.gz`,dataBase),{signal});
    if(!r.ok)throw Error(`${day} ${market} 壓縮資料未完成或不存在`);
    const bytes=new Uint8Array(await r.arrayBuffer());
    let text;
    // Some hosts transparently decode gzip; others serve it as a binary file.
    if(bytes[0]===31&&bytes[1]===139){
      if(typeof DecompressionStream==='undefined')throw Error('此瀏覽器不支援 gzip 解壓，請使用新版瀏覽器');
      text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }else text=new TextDecoder().decode(bytes);
    const result=JSON.parse(text);cache.set(key,result);while(cache.size>16)cache.delete(cache.keys().next().value);return result;
  }
  function rows(payload,expiry){
    const out=[];
    for(const [symbol,bars] of Object.entries(payload.symbols)){
      const parts=symbol.split('-');if(payload.market==='options'&&expiry&&parts[1]!==expiry)continue;
      for(const b of bars){
        // Publish the completed bar at its ending second; never expose future OHLC during replay.
        const dtms=Math.floor(b[1]/1000)*1000;
        const local=new Date(dtms+8*3600000).toISOString();
        out.push({date:local.slice(0,10).replace(/-/g,''),time:local.slice(11,19).replace(/:/g,''),dtms,
          price:b[5],open:b[2],high:b[3],low:b[4],close:b[5],volume:b[6],barStartUtcMs:b[0],sourceRows:b[7],session:b[8],isBar:true,
          product:payload.market==='options'?'TXO':payload.market==='taiex'?'TAIEX':parts[0],
          expiry:parts[1]||'',strike:payload.market==='options'?parts[2]:undefined,type:parts[3],openFlag:''});
      }
    }
    return out.sort((a,b)=>a.dtms-b.dtms);
  }
  function info(index,key){
    const contract=index.contracts.find(c=>c.key===key);if(!contract)throw Error('這個契約的壓縮資料尚未完成');
    const end=iso(contract.settleDate),prev=index.contracts.filter(c=>iso(c.settleDate)<end&&((contract.typeLabel==='F')===(c.typeLabel==='F'))).sort((a,b)=>b.settleDate.localeCompare(a.settleDate))[0]||null;
    const start=prev?iso(prev.settleDate):new Date(Date.parse(end)-10*86400000).toISOString().slice(0,10);
    const available=(index.expiryDates[key]||[]).filter(d=>d>=start&&d<=end);
    return {status:'success',contract,prevContract:prev,startDate:compact(start),endDate:compact(end),totalDays:available.length,dateRange:available.map(compact),availableDates:available.map(compact),contractAvailableDates:available.map(compact),missingDates:[],files:{total:available.length,availableDays:available.length},source:'compressed',interval:'5m'};
  }
  async function handle(url,signal){
    const index=await catalog(),name=url.pathname.split('/api/')[1];
    if(name==='contracts')return {status:'success',contracts:index.contracts,count:index.contracts.length};
    if(name.startsWith('contract-info/'))return info(index,decodeURIComponent(name.slice(14)));
    if(name.startsWith('contract-data/')){
      const key=decodeURIComponent(name.slice(14)),meta=info(index,key),requestedDate=url.searchParams.get('date'),days=Number(url.searchParams.get('days'))||0;
      const all=(index.expiryDates[key]||[]).filter(d=>compact(d)<=meta.endDate);
      let selected;
      if(requestedDate){const d=iso(requestedDate),pos=all.indexOf(d);selected=pos<0?[]:all.slice(Math.max(0,pos-1),pos+1);}
      else selected=days>0?all.slice(-days):meta.availableDates.map(iso);
      if(!selected.length)throw Error('所選日期的壓縮資料尚未完成');
      const opData=[],fuData=[];
      for(const day of selected){
        opData.push(...rows(await daily('options',day,signal),key));
        if(index.dates.tx.includes(day))fuData.push(...rows(await daily('tx',day,signal)));
      }
      // Keep the original main-contract rule: largest total source volume.
      const volumes=new Map();for(const d of fuData)volumes.set(d.expiry,(volumes.get(d.expiry)||0)+(d.volume||0));
      const main=[...volumes].sort((a,b)=>b[1]-a[1])[0]?.[0];
      const futures=fuData.filter(d=>d.expiry===main);
      return {...meta,opData:opData.sort((a,b)=>a.dtms-b.dtms),fuData:futures.sort((a,b)=>a.dtms-b.dtms),dateRange:selected.map(compact),availableDates:selected.map(compact),contractAvailableDates:all.map(compact),totalDays:all.length,requestedDays:days,requestedDate:requestedDate||'',loadedDays:selected.length,summary:{totalOp:opData.length,totalFu:futures.length,filesFound:selected.length}};
    }
    if(name==='taiex-list'||name==='tx-list'){const dates=index.dates[name==='tx-list'?'tx':'taiex'];return {status:'success',dates,count:dates.length};}
    if(name.startsWith('taiex/')||name==='taiex-range'){
      const range=name==='taiex-range',end=iso(range?url.searchParams.get('end'):name.slice(6));
      let start=end;
      if(range){const date=new Date(`${end}T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()-6);start=iso(url.searchParams.get('start')||date.toISOString().slice(0,10));}
      const dates=index.dates.taiex.filter(d=>d>=start&&d<=end),data=[],previousCloses={};
      for(const day of dates){const payload=await daily('taiex',day,signal);data.push(...rows(payload));if(payload.previousClose!=null)previousCloses[day]={price:payload.previousClose};}
      return {status:'success',dateIso:end,dates,dateCount:dates.length,data:data.sort((a,b)=>a.dtms-b.dtms),count:data.length,previousClose:previousCloses[end]||null,previousCloses,source:'compressed',interval:'5m'};
    }
    if(name==='fsp-data')return {status:'success',data:index.contracts.map(c=>({contractMonth:c.key,settleDate:c.settleDate,txo:c.txoFSP??'-',teo:'-',tfo:'-'}))};
    if(name==='scan'){catalogPromise=null;cache.clear();await catalog();return {status:'success'};}
    if(name==='cache/clear'){const cleared=cache.size;cache.clear();return {status:'success',cleared};}
    throw Error(`壓縮資料模式不支援 ${name}`);
  }
  window.fetch=async function(input,options={}){
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,document.baseURI);
    if(url.origin!==location.origin||!url.pathname.includes('/api/'))return nativeFetch(input,options);
    try{return new Response(JSON.stringify(await handle(url,options.signal)),{headers:{'Content-Type':'application/json'}});}
    catch(e){if(e.name==='AbortError')throw e;return new Response(JSON.stringify({status:'error',message:e.message}),{status:404,headers:{'Content-Type':'application/json'}});}
  };
})();
