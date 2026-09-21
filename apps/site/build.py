"""Monta dist/ (site estático instalável) a partir de app.body.html. Uso: python3 build.py"""
import pathlib, re, json, hashlib
here = pathlib.Path(__file__).parent
dist = here/'dist'
body = (here/'app.body.html').read_text()
body = re.sub(r'<title>.*?</title>\s*', '', body, count=1)
body = body.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', 'vendor/supabase.js')
head = '''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Grana a Dois</title>
<meta name="description" content="Vida financeira do casal, organizada e inteligente">
<meta name="theme-color" content="#ef6a10">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Grana a Dois">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>html,body{margin:0;padding:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
'''
tail = '''
<script>
if('serviceWorker' in navigator){ window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); }); }
</script>
</body>
</html>
'''
html_base = head + body + tail
version = hashlib.sha256(html_base.encode()).hexdigest()[:10]
notas = [l.strip() for l in (here/'NOVIDADES.txt').read_text().splitlines() if l.strip() and not l.startswith('#')]
build_tag = '<script>window.GRANA_BUILD=' + json.dumps({"v":version,"notas":notas}, ensure_ascii=False) + ';</script>\n'
html = html_base.replace('<style>html,body{margin:0;padding:0}', build_tag + '<style>html,body{margin:0;padding:0}', 1)
(dist/'index.html').write_text(html)
(dist/'versao.json').write_text(json.dumps({"v":version,"notas":notas}, ensure_ascii=False))
(dist/'manifest.webmanifest').write_text(json.dumps({
  "name":"Grana a Dois","short_name":"Grana a Dois",
  "description":"Vida financeira do casal, organizada e inteligente",
  "lang":"pt-BR","start_url":"./","scope":"./","id":"./","display":"standalone",
  "orientation":"any","background_color":"#f7f6f3","theme_color":"#ef6a10","categories":["finance"],
  "share_target":{"action":"./","method":"GET","params":{"title":"titulo","text":"notif"}},
  "icons":[
    {"src":"icons/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},
    {"src":"icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},
    {"src":"icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]
}, ensure_ascii=False, indent=2))
(dist/'sw.js').write_text('''/* Service worker do Grana a Dois — só guarda o "casco" do app. Dados financeiros NUNCA passam por cache. */
const VERSAO = 'grana-%s';
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
  e.waitUntil(self.registration.showNotification(d.titulo || 'Grana a Dois', {body:d.corpo||'', tag:d.tag||undefined, icon:'icons/icon-192.png', badge:'icons/icon-192.png', lang:'pt-BR', data:{view:d.view||'dashboard'}}));
});
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const view = (e.notification.data && e.notification.data.view) || 'dashboard';
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(cs=>{
    for(const c of cs){ if('focus' in c){ c.postMessage({tipo:'goto', view, nb: e.notification.data && e.notification.data.nb}); return c.focus(); } }
    return self.clients.openWindow('./' + ((e.notification.data && e.notification.data.nb) ? '?nb='+encodeURIComponent(e.notification.data.nb) : '') + '#/'+view);
  }));
});
''' % version)
import shutil; shutil.copy(here/'LEIA-ME.txt', dist/'LEIA-ME.txt')
(dist/'_headers').write_text('/versao.json\n  Cache-Control: no-store\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Content-Type: application/manifest+json\n')
(dist/'vercel.json').write_text(json.dumps({"headers":[{"source":"/sw.js","headers":[{"key":"Cache-Control","value":"no-cache"}]},{"source":"/(.*)","headers":[{"key":"X-Content-Type-Options","value":"nosniff"}]}]},indent=2))
print('ok', version, len(html))
