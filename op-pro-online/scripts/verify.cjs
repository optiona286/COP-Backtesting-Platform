const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root,'docs/original-baseline.json'),'utf8').replace(/^\uFEFF/,''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = path.resolve(root,'..');
if (process.argv.includes('--original')) {
  for (const file of baseline) assert.equal(sha(path.join(original,file.path)),file.sha256,`Original changed: ${file.path}`);
  console.log(`PASS: ${baseline.length} original files remain unchanged.`);
}
const allowed = new Set(['index.html','server.js','js/backend.js','js/main.js']);
for (const file of baseline) if (!allowed.has(file.path)) assert.equal(sha(path.join(root,file.path)),file.sha256,`Copied logic or asset changed: ${file.path}`);
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate DOM IDs');
const contract = JSON.parse(fs.readFileSync(path.join(root,'docs/interface-contract.json'),'utf8'));
for (const id of contract.ids) assert(ids.includes(id),`Missing original control: ${id}`);
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g),m=>m[1]);
assert.deepEqual(scripts.filter(src=>contract.scripts.includes(src)),contract.scripts,'Original script order changed');
for (const match of html.matchAll(/(?:src|href)="((?:css|js|favicon|sound)\/[^"#]+)"/g)) assert(fs.existsSync(path.join(root,match[1])),`Missing asset: ${match[1]}`);
for (const name of fs.readdirSync(path.join(root,'js')).filter(n=>n.endsWith('.js'))) execFileSync(process.execPath,['--check',path.join(root,'js',name)],{stdio:'pipe'});
execFileSync(process.execPath,['--check',path.join(root,'server.js')],{stdio:'pipe'});
// Only URL wiring changes are allowed in these two original modules.
assert.equal(sha(path.join(root,'js/backend.js')),contract.adaptedBackendSha256,'Backend adapter changed after baseline');
assert.equal(sha(path.join(root,'js/main.js')),contract.adaptedMainSha256,'Trading module changed after URL adaptation');
console.log(`PASS: ${contract.ids.length} original DOM IDs; original script order; all copied logic/assets; JS syntax.`);
