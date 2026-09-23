#!/usr/bin/env python3
"""
Verifica se o deploy publicado bate com o build local, ANTES de considerar a publicação concluída.

Por que existe (Rodada 17): a Cloudflare pode levar alguns segundos para propagar um build novo
para todas as suas bordas. Sem essa checagem, é possível "publicar" e o site continuar servindo
a versão antiga por um tempo em algumas regiões — o que, do lado do app, aparecia como o aviso de
"nova versão" voltando pouco depois de clicar em Atualizar. Rodar este script depois de cada deploy
fecha esse ciclo: ele só sai com sucesso (exit code 0) quando o ar bate com o que foi construído.

Reforçado na Rodada 18: um deploy anterior tinha a marca de versão (window.GRANA_BUILD e versao.json)
batendo com o esperado, mas o HTML publicado de verdade estava desatualizado mesmo assim — porque foi
publicado por um patch manual que corrigiu só a marca, sem corrigir o resto do corpo do HTML. A marca
sozinha nunca mais garante nada: por isso, além de conferir a marca, este script agora compara o
HTML publicado byte a byte com dist/index.html local. Só os dois juntos (marca certa E corpo idêntico)
provam que o deploy está realmente correto.

Uso:
  python3 verificar_deploy.py [URL_BASE]

  URL_BASE padrão: https://g-a-d.grana-a-dois.workers.dev
  Lê a versão esperada de dist/versao.json e o HTML esperado de dist/index.html (o build mais
  recente feito por build.py).

O que confere:
  1. GET {URL_BASE}/versao.json?ts=<cache-bust>  -> campo "v" deve bater com o local
  2. GET {URL_BASE}/?ts=<cache-bust>              -> window.GRANA_BUILD.v embutido no HTML deve bater
  3. GET {URL_BASE}/?ts=<cache-bust>              -> o HTML inteiro deve ser BYTE A BYTE igual ao
     dist/index.html local (não só a marca de versão) — é essa checagem que pega um deploy com a
     marca certa mas o corpo desatualizado, como aconteceu uma vez.
  Tenta de novo com espera crescente (propagação de borda) antes de desistir.
"""
import json, re, sys, time, hashlib, urllib.request, pathlib

TENTATIVAS = 8
ESPERAS = [2, 3, 5, 8, 10, 15, 15, 15]  # segundos entre tentativas (soma ~73s no pior caso)

def buscar(url):
    req = urllib.request.Request(url, headers={"Cache-Control": "no-store", "User-Agent": "grana-verificar-deploy/1"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read().decode("utf-8", errors="replace")

def main():
    base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://g-a-d.grana-a-dois.workers.dev"
    aqui = pathlib.Path(__file__).parent
    local = json.loads((aqui / "dist" / "versao.json").read_text())
    esperado = local["v"]
    html_local = (aqui / "dist" / "index.html").read_text()
    hash_local = hashlib.sha256(html_local.encode()).hexdigest()
    print(f"Build local esperado: {esperado} (dist/index.html sha256 {hash_local[:12]}…)")
    print(f"Conferindo em: {base}")

    for tentativa in range(1, TENTATIVAS + 1):
        ts = int(time.time() * 1000)
        ok_versao = ok_html = ok_corpo = False
        v_remoto = v_html = None
        try:
            status, corpo = buscar(f"{base}/versao.json?ts={ts}")
            if status == 200:
                v_remoto = json.loads(corpo).get("v")
                ok_versao = v_remoto == esperado
        except Exception as e:
            print(f"  tentativa {tentativa}: erro ao buscar versao.json ({e})")
        try:
            status, corpo = buscar(f"{base}/?ts={ts}")
            if status == 200:
                m = re.search(r"window\.GRANA_BUILD\s*=\s*(\{.*?\});", corpo)
                if m:
                    v_html = json.loads(m.group(1)).get("v")
                    ok_html = v_html == esperado
                ok_corpo = corpo == html_local
        except Exception as e:
            print(f"  tentativa {tentativa}: erro ao buscar /: ({e})")

        if ok_versao and ok_html and ok_corpo:
            print(f"OK — versao.json, a marca no index.html E o corpo do HTML no ar batem com {esperado} (tentativa {tentativa}/{TENTATIVAS})")
            return 0

        print(f"  tentativa {tentativa}/{TENTATIVAS}: versao.json={v_remoto!r} marca={v_html!r} corpo_identico={ok_corpo} (esperado {esperado!r}) — ainda não propagou")
        if tentativa < TENTATIVAS:
            time.sleep(ESPERAS[min(tentativa - 1, len(ESPERAS) - 1)])

    print(f"FALHA — depois de {TENTATIVAS} tentativas, o ar ainda não bate com {esperado}.")
    if ok_versao and ok_html and not ok_corpo:
        print("ATENÇÃO: a marca de versão bate, mas o corpo do HTML publicado é DIFERENTE do dist/index.html local!")
        print("Isso é exatamente o tipo de defeito que já aconteceu uma vez (marca certa, conteúdo desatualizado). Não confie só na marca.")
    print("Não considere o deploy concluído. Confira o painel da Cloudflare (build/deploy) antes de avisar o usuário.")
    return 1

if __name__ == "__main__":
    sys.exit(main())
