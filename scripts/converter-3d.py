# -*- coding: utf-8 -*-
"""CONVERTE UM RECORTE 2D EM MALHA 3D, PELO MESHY.

Os 265 arquivos de peca sao, na verdade, ~25 objetos distintos: o resto e
rotacao (em 3D uma malha serve pros quatro lados), quadro de animacao (vira
animacao) e backup. Entao converter e barato — 3.100 creditos dao 103 pecas.

    python scripts/converter-3d.py sofa-r0.png
    python scripts/converter-3d.py --lista          (o que da pra converter)

CUIDADO COM A ENTRADA: os recortes sao VISTA ISOMETRICA UNICA. O modelo tem que
inventar o lado que nao aparece. Se sair torto, e por isso — e o teto de
tentativa e generoso justamente pra ajustar e repetir.
"""
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PECAS = os.path.join(AQUI, "quarto", "pecas")
SAIDA = os.path.join(AQUI, "quarto", "3d")
API = "https://api.meshy.ai/openapi/v1/image-to-3d"
# Alvo de poligonos. Movel de jogo vive entre 1.000 e 5.000.
ALVO = int(os.environ.get("ALVO_POLI", "4000"))


def chave():
    for linha in io.open(os.path.join(AQUI, ".env"), encoding="utf-8"):
        if linha.startswith("MESHY_API_KEY="):
            return linha.split("=", 1)[1].strip()
    sys.exit("  falta MESHY_API_KEY no .env")


def pedir(url, dados=None, metodo=None):
    req = urllib.request.Request(url, method=metodo or ("POST" if dados else "GET"))
    req.add_header("Authorization", "Bearer " + chave())
    corpo = None
    if dados is not None:
        corpo = json.dumps(dados).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, corpo, timeout=90) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("  a API recusou (%s): %s" % (e.code, e.read().decode()[:300]))


def converter(arquivo):
    caminho = os.path.join(PECAS, arquivo)
    if not os.path.exists(caminho):
        sys.exit("  nao achei: " + caminho)
    with open(caminho, "rb") as f:
        uri = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    print("  mandando %s (%.1f KB)…" % (arquivo, os.path.getsize(caminho) / 1024))

    # MALHA DE JOGO, NAO DE RENDER. Sem isto vem 1,9 milhao de triangulos e
    # 71 MB por movel — 25 desses passariam de 1,7 GB e nao carregam em lugar
    # nenhum. Ver o cabecalho do patch de 02/09.
    r = pedir(API, {
        "image_url": uri,
        "should_texture": True,
        "enable_pbr": False,
        "model_type": "smart-topology",   # topologia limpa, pensada pra tempo real
        "should_remesh": True,
        "target_polycount": ALVO,         # 4.000 e o padrao do smart-topology
        # SEM `topology`: o smart-topology so sai em triangulo e a API recusa
        # "quad" com 400. Triangulo serve — quem for editar no Blender converte la.
    })
    tid = r.get("result") or r.get("id")
    if not tid:
        sys.exit("  a API nao devolveu id: " + json.dumps(r)[:200])
    print("  tarefa %s — esperando (costuma levar 1 a 3 min)" % tid)

    inicio = time.time()
    while True:
        time.sleep(8)
        t = pedir("%s/%s" % (API, tid))
        st = t.get("status")
        print("   %4.0fs  %s  %s%%" % (time.time() - inicio, st, t.get("progress", 0)))
        if st == "SUCCEEDED":
            break
        if st in ("FAILED", "CANCELED"):
            sys.exit("  falhou: " + json.dumps(t.get("task_error") or {})[:200])
        if time.time() - inicio > 600:
            sys.exit("  passou de 10 min, desisti")

    os.makedirs(SAIDA, exist_ok=True)
    nome = os.path.splitext(arquivo)[0]
    for fmt in ("glb", "fbx"):
        u = (t.get("model_urls") or {}).get(fmt)
        if not u:
            continue
        dest = os.path.join(SAIDA, "%s.%s" % (nome, fmt))
        urllib.request.urlretrieve(u, dest)
        print("  baixado: quarto/3d/%s.%s  (%.1f MB)" % (nome, fmt, os.path.getsize(dest) / 1e6))
    # a previa serve pra olhar sem abrir o Blender
    u = (t.get("thumbnail_url") or "")
    if u:
        urllib.request.urlretrieve(u, os.path.join(SAIDA, nome + "-previa.png"))
        print("  previa: quarto/3d/%s-previa.png" % nome)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] == "--lista":
        import re
        anim = re.compile(r'-(dorme|dormindo|deitar|acordar|levantar|espreguica|treino|navegar|jogar|tv|estado|plate|entrada|b)-?\d*\.png$')
        vis = set()
        for f in sorted(os.listdir(PECAS)):
            if not f.endswith(".png") or ".bak-" in f or anim.search(f):
                continue
            b = f.replace("-r0.png", "").replace(".png", "")
            if b in vis or f.endswith(("-r1.png", "-r2.png", "-r3.png")):
                continue
            vis.add(b)
            print("  " + f)
        print("\n  %d candidatos" % len(vis))
    else:
        converter(sys.argv[1])
