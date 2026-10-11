'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=path.join(root,'data');
const markets=['options','tx','taiex'];
function finish(){
 require('./build-online-index.cjs')();
 const reports=markets.map(m=>JSON.parse(fs.readFileSync(path.join(data,`${m}-conversion-report.json`),'utf8')));
 const manifest={version:1,interval:'5m',timezone:'Asia/Taipei',markets:reports.map(r=>({market:r.market,manifest:`${r.market}/manifest.json`,files:r.files,firstDate:r.firstDate,lastDate:r.lastDate,gzipBytes:r.gzipBytes,failed:r.failed})),complete:reports.every(r=>r.failed===0&&r.files===r.sourceDates)};
 fs.writeFileSync(path.join(data,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify(manifest));
 if(!manifest.complete)process.exitCode=1;
}
async function main(){
 if(process.argv.includes('--wait')){
  while(markets.some(m=>fs.existsSync(path.join(__dirname,'.state',`${m}.lock`))))await new Promise(r=>setTimeout(r,10000));
 }
 finish();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
