'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),data=path.join(root,'data');
function build(){
 const dates={},expiryDates={};
 for(const market of ['options','tx','taiex']){
  dates[market]=fs.readdirSync(path.join(data,market)).filter(n=>/^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).map(n=>n.slice(0,10)).sort();
  if(market==='options')for(const day of dates[market]){
   const payload=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(data,market,`${day}.json.gz`))));
   for(const expiry of new Set(Object.keys(payload.symbols).map(s=>s.split('-')[1])))(expiryDates[expiry]||=[]).push(day);
  }
 }
 const lines=fs.readFileSync(path.join(root,'fsp_data.csv'),'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1);
 const contracts=lines.map(line=>{
  const [key,settleDate,fsp]=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
  return {key,label:`${key} (${settleDate})`,settleDate,typeLabel:key.includes('W')?'W':key.includes('F')?'F':'M',txoFSP:Number.isFinite(Number(fsp))&&fsp!==''?Number(fsp):null};
 }).filter(c=>expiryDates[c.key]?.length).sort((a,b)=>b.settleDate.localeCompare(a.settleDate));
 const catalog={version:1,interval:'5m',timezone:'Asia/Taipei',generatedAt:new Date().toISOString(),dates,expiryDates,contracts};
 const dest=path.join(data,'online-index.json');fs.writeFileSync(dest+'.tmp',JSON.stringify(catalog));fs.renameSync(dest+'.tmp',dest);
 console.log(`Online index: ${contracts.length} contracts; dates ${JSON.stringify(Object.fromEntries(Object.entries(dates).map(([k,v])=>[k,v.length])))}`);
 return catalog;
}
module.exports=build;if(require.main===module)build();
