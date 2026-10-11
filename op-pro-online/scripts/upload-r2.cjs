'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),data=path.join(root,'data');
const endpoint=new URL((process.env.R2_ENDPOINT||'https://552eb52d78aad7804e9915f37a567f0c.r2.cloudflarestorage.com').trim());
const access=(process.env.R2_ACCESS_KEY_ID||'').trim(),secret=(process.env.R2_SECRET_ACCESS_KEY||'').trim(),bucket='op-pro-data';
if(!access||!secret)throw Error('Please use Upload-R2.cmd to enter credentials locally.');
if(!/^[a-f0-9]{32}$/i.test(access))throw Error('Access Key ID must be 32 hexadecimal characters. Copy Access Key ID, not API Token.');
if(!/^[a-f0-9]{64}$/i.test(secret))throw Error('Secret Access Key must be 64 hexadecimal characters. The paste was incomplete or this is not the Secret Access Key.');
if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.r2.cloudflarestorage.com'))throw Error('Invalid R2 S3 endpoint');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hmac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest();
async function put(key,body){
 const stamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=`${day}/auto/s3/aws4_request`;
 const uri='/'+[bucket,...key.split('/')].map(encodeURIComponent).join('/'),digest=hash(body);
 const headers={'host':endpoint.host,'x-amz-content-sha256':digest,'x-amz-date':stamp};
 const names=Object.keys(headers).sort(),canonical=names.map(n=>`${n}:${headers[n]}\n`).join('');
 const request=['PUT',uri,'',canonical,names.join(';'),digest].join('\n');
 const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'auto'),'s3'),'aws4_request');
 const signature=crypto.createHmac('sha256',signing).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${hash(request)}`).digest('hex');
 headers.Authorization=`AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
 headers['Content-Type']=key.endsWith('.gz')?'application/gzip':'application/json';
 headers['Cache-Control']=key.endsWith('.gz')?'public, max-age=3600':'no-cache';
 const response=await fetch(new URL(uri,endpoint),{method:'PUT',headers,body,signal:AbortSignal.timeout(60000),redirect:'error'});
 if(!response.ok){
  const xml=await response.text();
  const read=tag=>xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]||'';
  const code=read('Code')||'UnknownError';
  const message=read('Message').split(access).join('[redacted]').split(secret).join('[redacted]').replace(/[\r\n]/g,' ').slice(0,400);
  const error=new Error(`R2 HTTP ${response.status} / ${code}: ${message || 'No error message'} (file: ${key})`);
  error.status=response.status;
  const tips={SignatureDoesNotMatch:'Check that Access Key ID and Secret Access Key came from the same token.',InvalidAccessKeyId:'The Access Key ID was not recognized.',AccessDenied:'Check bucket scope, token expiration and IP restrictions.',RequestTimeTooSkewed:'Synchronize Windows date and time.',RequestExpired:'Synchronize Windows date and time.'};
  if(tips[code])error.message+='\n'+tips[code];
  throw error;
 }
}
async function main(){
 const keys=[];
 for(const market of ['options','tx','taiex'])for(const n of fs.readdirSync(path.join(data,market)).sort())if(/^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)||n==='manifest.json')keys.push(`${market}/${n}`);
 // Publish the catalog only after every referenced object is uploaded.
 keys.push('manifest.json','online-index.json');
 const stateFile=path.join(__dirname,'.state','r2-upload.json');fs.mkdirSync(path.dirname(stateFile),{recursive:true});
 const target=`${endpoint.origin}/${bucket}`;
 let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{target,files:{}};
 if(state.target!==target)state={target,files:{}};
 let done=0,skipped=0;
 console.log(`Uploading to ${bucket}: ${keys.length} files. Credentials stay in process memory.`);
 for(const key of keys){
  const body=fs.readFileSync(path.join(data,key)),digest=hash(body);
  if(key.endsWith('.gz')&&state.files[key]===digest){skipped++;continue;}
  for(let attempt=0;;attempt++){try{await put(key,body);break;}catch(e){if(attempt>=2||(e.status>=400&&e.status<500&&![408,429].includes(e.status)))throw e;await new Promise(r=>setTimeout(r,2000));}}
  state.files[key]=digest;fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state));fs.renameSync(stateFile+'.tmp',stateFile);
  done++;if(done%100===0)console.log(`Uploaded ${done}; resumed ${skipped}`);
 }
 const configPath=path.join(root,'js','config.js');
 const config=fs.readFileSync(configPath,'utf8').replace("dataBaseUrl:''","dataBaseUrl:'https://pub-f3c396bf9e7d49f3b0f9ff8815170fcd.r2.dev/'");
 fs.writeFileSync(configPath,config);
 console.log(`Completed: ${done} uploaded, ${skipped} resumed. Online edition now uses R2. Refresh the page.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
