'use strict';
const BASE=new URL('./',self.location.href),PREFIX=`op-pro-shell:${BASE.pathname}:`,CACHE=PREFIX+'v3-ohlc-large';
const urls=['./','manifest.webmanifest','css/style.css','css/workspace.css','css/mobile-app.css','css/app-visual.css','css/pwa.css','css/chart-focus.css','js/chart-focus.js','js/config.js','js/compressed-data.js','js/utils.js','js/pwa.js','js/main.js','js/backend.js','js/workspace.js','js/mobile-app.js','js/app-settings.js','js/chart-info.js','js/gauge.js','js/protractor.js','js/hourly-extremes.js','js/compare-panel.js','js/timeline.js','favicon/app-icon-192.png','favicon/app-icon-512.png','favicon/app-icon-180.png','favicon/Favicon.png'].map(p=>new URL(p,BASE).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(urls)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 const local=url.origin===BASE.origin&&url.pathname.startsWith(BASE.pathname)&&!url.pathname.includes('/api/')&&!url.pathname.includes('/data/');
 const library=url.hostname==='cdn.jsdelivr.net'&&(/\/npm\/echarts@5(?:\/|$)/.test(url.pathname)||url.pathname.includes('/npm/lightweight-charts@5.1.0/'));
 if(event.request.method!=='GET'||(!local&&!library))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;}
  catch(error){const saved=await cache.match(event.request);if(saved)return saved;if(event.request.mode==='navigate'){const home=await cache.match(BASE.href);if(home)return home;}throw error;}
 })());
});
