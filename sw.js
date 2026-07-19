const CACHE='docbook-nurse-v47';
const ASSETS=['./','./index.html','./app.html','./manifest.json','./icon-192.png','./icon-512.png','./bg-pattern.webp'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  var url=new URL(e.request.url);
  // المصادر الخارجية (فايربيز/خطوط) دائماً من الشبكة
  if(url.origin!==location.origin){ e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))); return; }
  // الشبكة أولاً، والكاش احتياطي عند انقطاع الاتصال
  e.respondWith(
    fetch(e.request).then(r=>{ if(r&&r.status===200){ var c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); } return r; })
    .catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html')))
  );
});
