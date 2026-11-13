// On every release, raise this number and BUILD in index.html together: the page compares them to offer "Update ready".
const CACHE="money-tracker-v62";
const WAIT=800;
const FILES=["./","./index.html","./manifest.webmanifest","./icon-180.png","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:"reload"})))));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const u=new URL(req.url);
  if(u.origin===self.location.origin){
    // Everything is on this site: network first so updates arrive, cached copy when offline (the PDF reader is cached after its first use).
    // On a slow connection the saved copy opens after WAIT ms; the download carries on, so the next open has the update.
    // net waits for the whole file on purpose: fetch() resolves at the headers, so a streaming response would beat the timer and the page would crawl in.
    const cached=()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match("./index.html"));
    const net=fetch(req).then(async r=>{if(r.ok){try{const c=await caches.open(CACHE);await c.put(req,r.clone())}catch(x){}}return r});
    e.waitUntil(net.catch(()=>{}));
    const late=new Promise(res=>setTimeout(res,WAIT)).then(()=>caches.match(req,{ignoreSearch:true})).then(r=>r||net);
    e.respondWith(Promise.race([net,late]).catch(cached));
  }
});
