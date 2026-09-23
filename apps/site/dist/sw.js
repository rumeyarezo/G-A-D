/* Service worker do Grana a Dois — só guarda o "casco" do app. Dados financeiros NUNCA passam por cache. */
const VERSAO = 'grana-6180f84f2b';
const CASCO = ['./','index.html','manifest.webmanifest','vendor/supabase.js','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/favicon-32.png'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(VERSAO).then(c=>c.addAll(CASCO)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSAO).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const req = e.request, url = new URL(req.url);
  if(req.method!=='GET' || url.origin!==location.origin) return;   /* Supabase, fontes etc.: direto na rede */
  if(req.mode==='navigate'){                                        /* página: rede primeiro (sempre a versão nova), cache se offline */
    e.respondWith(fetch(req).then(r=>{ const cp=r.clone(); caches.open(VERSAO).then(c=>c.put('index.html',cp)); return r; }).catch(()=>caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
self.addEventListener('push', e=>{
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){ d = {titulo:'Grana a Dois', corpo: e.data ? e.data.text() : ''}; }
  const opts = {body:d.corpo||'', tag:d.tag||undefined, icon:'icons/icon-192.png', badge:'icons/icon-192.png', lang:'pt-BR', data:{view:d.view||'dashboard'}};
  /* lembretes de lançar (Rodada 23): notificação persistente com atalhos Despesa/Receita direto nela */
  if(d.lembrete){ opts.requireInteraction = true; opts.actions = [{action:'despesa', title:'+ Despesa'}, {action:'receita', title:'+ Receita'}]; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Grana a Dois', opts));
});
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const view = (e.notification.data && e.notification.data.view) || 'dashboard';
  const nb = e.notification.data && e.notification.data.nb;
  const lancar = (e.action==='despesa'||e.action==='receita') ? e.action : null;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(cs=>{
    for(const c of cs){ if('focus' in c){ c.postMessage(lancar ? {tipo:'lancar', tipoLancamento:lancar} : {tipo:'goto', view, nb}); return c.focus(); } }
    const q = lancar ? '?lancar='+lancar : (nb ? '?nb='+encodeURIComponent(nb) : '');
    return self.clients.openWindow('./' + q + '#/'+view);
  }));
});
