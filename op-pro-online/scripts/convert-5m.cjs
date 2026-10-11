'use strict';
// Read-only sources -> daily, column-oriented OHLC JSON gzip files.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'data'),stateDir=path.join(__dirname,'.state');
const market=process.argv[2];
const sources={options:process.env.OP_PRO_DATA_DIR||'D:/op_pro/data',tx:process.env.OP_PRO_TX_DIR||'F:/加權指數5s/台指期資料庫',taiex:process.env.OP_PRO_TAIEX_DIR||'F:/加權指數5s/加權指數資料庫'};
if(!sources[market])throw Error('Usage: node scripts/convert-5m.cjs options|tx|taiex');
if(!fs.existsSync(sources[market]))throw Error(`Source directory missing: ${sources[market]}`);
fs.mkdirSync(path.join(out,market),{recursive:true});fs.mkdirSync(stateDir,{recursive:true});
const atomic=(file,data)=>{const temp=file+'.tmp';fs.writeFileSync(temp,data);fs.renameSync(temp,file);};
const statePath=path.join(stateDir,`${market}.json`);
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:1,interval:'5m',files:{}};
const lock=path.join(stateDir,`${market}.lock`);
if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));try{process.kill(pid,0);throw Error(`Conversion already running: ${pid}`);}catch(e){if(e.code!=='ESRCH')throw e;}fs.unlinkSync(lock);}
fs.writeFileSync(lock,String(process.pid),{flag:'wx'});process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{}});
function* walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,e.name);if(e.isDirectory())yield*walk(full);else if(e.isFile())yield full;}}
function* lines(text){let at=0,next;while((next=text.indexOf('\n',at))>=0){yield text.slice(at,next).trim();at=next+1;}if(at<text.length)yield text.slice(at).trim();}
function* zipTexts(file){
 const b=fs.readFileSync(file);let end=b.length-22;
 for(;end>=Math.max(0,b.length-65557);end--)if(b.readUInt32LE(end)===0x06054b50)break;
 if(end<Math.max(0,b.length-65557))throw Error('ZIP central directory not found');
 let pos=b.readUInt32LE(end+16);const count=b.readUInt16LE(end+10);
 for(let i=0;i<count;i++){
  if(b.readUInt32LE(pos)!==0x02014b50)throw Error('Invalid ZIP entry');
  const method=b.readUInt16LE(pos+10),size=b.readUInt32LE(pos+20),expected=b.readUInt32LE(pos+24),nl=b.readUInt16LE(pos+28),el=b.readUInt16LE(pos+30),cl=b.readUInt16LE(pos+32),offset=b.readUInt32LE(pos+42),name=b.toString('utf8',pos+46,pos+46+nl);pos+=46+nl+el+cl;
  if(!/\.rpt$/i.test(name))continue;
  if(b.readUInt32LE(offset)!==0x04034b50)throw Error('Invalid local ZIP header');
  const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),compressed=b.subarray(start,start+size);
  const data=method===8?zlib.inflateRawSync(compressed):method===0?compressed:null;
  if(!data)throw Error(`Unsupported ZIP compression: ${method}`);
  if(data.length!==expected)throw Error('ZIP uncompressed size mismatch');
  yield data.toString('latin1');
 }
}
const iso=d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
function instant(date,time){
 const t=String(time).replace(/\D/g,'').padStart(6,'0').slice(0,6);
 if(!/^\d{8}$/.test(date)||!/^\d{6}$/.test(t))return null;
 const h=Number(t.slice(0,2)),m=Number(t.slice(2,4)),s=Number(t.slice(4));if(h>23||m>59||s>59)return null;
 const ms=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8),h-8,m,s);
 return {ms,time:t,session:t>='084500'&&t<='134500'?0:1};
}
const grouped=new Map();
for(const file of walk(sources[market])){
 const name=path.basename(file);let match;
 if(market==='options')match=name.match(/^OptionsDaily[_-]?(\d{4})[_-](\d{2})[_-](\d{2}).*\.zip$/i);
 else if(market==='tx')match=name.match(/^Daily[_-]?(\d{4})[_-](\d{2})[_-](\d{2}).*\.zip$/i);
 else match=name.match(/^(?:TAIEX_)?(\d{4})-(\d{2})-(\d{2})\.csv$/i);
 if(!match)continue;const day=`${match[1]}-${match[2]}-${match[3]}`;if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(file);
}
const jobs=[...grouped].sort(([a],[b])=>a.localeCompare(b));
let completed=0,resumed=0,failed=0;const errors=[];
function checkpoint(){atomic(statePath,JSON.stringify(state));}
console.log(`${market}: ${jobs.length} source dates; output ${path.join(out,market)}`);
for(const[day,files]of jobs){
 files.sort();const signature=files.map(f=>{const s=fs.statSync(f);return `${path.relative(sources[market],f)}:${s.size}:${s.mtimeMs}`;}).join('|');
 const dest=path.join(out,market,`${day}.json.gz`);
 if(state.files[day]?.signature===signature&&fs.existsSync(dest)){resumed++;continue;}
 try{
  const symbols=new Map();let rawRows=0,invalidRows=0,spreadRows=0,previousClose=null;
  const add=(symbol,t,price,volume)=>{
   if(!symbols.has(symbol))symbols.set(symbol,new Map());const bars=symbols.get(symbol),bucket=Math.floor(t.ms/300000)*300000,key=`${bucket}:${t.session}`;
   const old=bars.get(key);
   if(!old){bars.set(key,{t:bucket,o:price,h:price,l:price,c:price,v:volume,n:1,s:t.session,first:t.ms,last:t.ms});return;}
   old.h=Math.max(old.h,price);old.l=Math.min(old.l,price);if(t.ms<old.first){old.o=price;old.first=t.ms;}if(t.ms>=old.last){old.c=price;old.last=t.ms;}if(volume!==null)old.v+=volume;old.n++;
  };
  for(const file of files){
   const texts=market==='taiex'?[fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')]:zipTexts(file);
   for(const text of texts)for(const line of lines(text)){
    if(!line||!/^\d{4}/.test(line))continue;
    const p=line.split(',').map(s=>s.trim());let symbol,date,time,price,volume;
    if(market==='taiex'){
     const match=p[0].match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);if(!match){invalidRows++;continue;}
     date=match[1]+match[2]+match[3];time=match[4]+match[5]+match[6];symbol='TAIEX';price=Number(p[1]);volume=null;
     if(time==='090000'&&Number.isFinite(price)){previousClose=price;continue;}
     if(time<'090000')continue;
    }else if(market==='options'){
     if(p[1]!=='TXO')continue;if(p[3].includes('/')){spreadRows++;continue;}
     if(!/^\d{6}(?:W\d|F\d)?$/i.test(p[3])||!Number.isFinite(Number(p[2]))||!['C','P'].includes(p[4])){invalidRows++;continue;}
     date=p[0];time=p[5];price=Number(p[6]);volume=Number(p[7]);symbol=`TXO-${p[3]}-${Number(p[2])}-${p[4]}`;
    }else{
     if(!['TX','MTX','TXF'].includes(p[1]))continue;
     if(p[2].includes('/')){spreadRows++;continue;}
     if(!/^\d{4,6}$/.test(p[2])){invalidRows++;continue;}
     date=p[0];time=p[3];price=Number(p[4]);volume=Number(p[5]);symbol=`${p[1]}-${p[2]}`;
    }
    const t=instant(date,time);if(!t||!Number.isFinite(price)||(market==='options'?price<0:price<=0)||(volume!==null&&(!Number.isFinite(volume)||volume<0))){invalidRows++;continue;}
    rawRows++;add(symbol,t,price,volume);
   }
  }
  const encoded={};let bars=0,start=null,end=null;
  for(const[symbol,buckets]of [...symbols].sort(([a],[b])=>a.localeCompare(b))){const rows=[...buckets.values()].sort((a,b)=>a.t-b.t||a.s-b.s).map(b=>[b.t,b.t+299999,b.o,b.h,b.l,b.c,b.v,b.n,b.s]);encoded[symbol]=rows;bars+=rows.length;for(const b of rows){start=start===null?b[0]:Math.min(start,b[0]);end=end===null?b[1]:Math.max(end,b[1]);}}
  const payload={version:1,date:day,market,interval:'5m',timezone:'Asia/Taipei',fields:['timeUtcMs','closeTimeUtcMs','open','high','low','close','volume','sourceRows','session'],sessionCodes:{0:'regular',1:'afterHours'},volumeAvailable:market!=='taiex',symbols:encoded};if(previousClose!==null)payload.previousClose=previousClose;
  const plain=Buffer.from(JSON.stringify(payload)),compressed=zlib.gzipSync(plain,{level:9});atomic(dest,compressed);
  state.files[day]={signature,date:day,file:`${day}.json.gz`,symbols:symbols.size,bars,sourceRows:rawRows,invalidRows,spreadRows,sourceBytes:files.reduce((n,f)=>n+fs.statSync(f).size,0),jsonBytes:plain.length,gzipBytes:compressed.length,sha256:crypto.createHash('sha256').update(compressed).digest('hex'),startUtcMs:start,endUtcMs:end};completed++;
 }catch(e){failed++;errors.push({date:day,message:e.message});console.error(`${market} ${day}: ${e.message}`);}
 if((completed+failed)%25===0){checkpoint();console.log(`${market}: converted ${completed}, resumed ${resumed}, failures ${failed}, date ${day}`);}
}
checkpoint();
const entries=jobs.map(([day])=>state.files[day]).filter(Boolean).map(({signature,...entry})=>entry);
const manifest={version:1,market,interval:'5m',timezone:'Asia/Taipei',volumeAvailable:market!=='taiex',files:entries};atomic(path.join(out,market,'manifest.json'),JSON.stringify(manifest));
const report={market,sourceDates:jobs.length,converted:completed,resumed,failed,errors,files:entries.length,bars:entries.reduce((n,e)=>n+e.bars,0),sourceRows:entries.reduce((n,e)=>n+e.sourceRows,0),sourceBytes:entries.reduce((n,e)=>n+e.sourceBytes,0),jsonBytes:entries.reduce((n,e)=>n+e.jsonBytes,0),gzipBytes:entries.reduce((n,e)=>n+e.gzipBytes,0),firstDate:entries[0]?.date,lastDate:entries.at(-1)?.date};atomic(path.join(out,`${market}-conversion-report.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failed)process.exitCode=1;
