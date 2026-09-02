# -*- coding: utf-8 -*-
"""
Empacota o quarto inteiro num JSON de data URIs para a pagina de teste.

O Michel ve a animacao por um ARTIFACT (link privado, tudo embutido), nao pelo
site do Conatus — decisao dele em 27/08. Entao todo asset tem que caber dentro
do HTML: cenario, mascara do piso, pecas que tapam, sprites da Sable e os
quadros das estacoes.

Detalhes que custaram caro e estao resolvidos aqui:
  - reduzir SEMPRE com alfa pre-multiplicado (a cor guardada no pixel invisivel
    vira fio em volta da figura);
  - cenario em JPEG (nao tem alfa e cai de 6 MB pra ~300 KB);
  - mascara do piso em 1 bit.

Uso:
    python scripts/empacotar-artifact.py <template.html> <saida.html>
"""

import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# O QUARTO MORA NA CASA DELA. (02/09/2026)
# Antes isto lia de agent-arena/public/assets/, que e o repo do CONATUS — pra
# editar o quarto dela o Michel tinha que entrar na pasta do outro show. Agora
# le de yuna/quarto/, que tem so o que e usado: 320 arquivos contra os 578 de
# la, dos quais 89% eram versao antiga.
QUARTO = os.path.join(RAIZ, "quarto")
RECORTES = os.path.join(RAIZ, "quarto", "sprites")
# ESCALA DA PAGINA. K=2 e meia-resolucao: o artifact tem que caber em poucos
# MB e a demo roda numa janela pequena. Mas a TELA DA LIVE vai pra 1080p ou
# mais, e ali meia-res vira borrao — o cenario nativo tem 2752x1536 e estava
# sendo jogado fora pela metade. ESCALA=1 empacota em resolucao cheia.
K = int(os.environ.get("ESCALA", "2"))

# Estacoes: lugar onde ela ENTRA no movel em vez de ficar do lado.
# "peca" = qual peca do layout ela ocupa (a posicao sai de la, entao os
# quadros ficam registrados com o cenario de graca).
ESTACOES = {
    "cama": {
        "peca": "cama",
        # MODELO B, escolhido pelo Michel entre tres (comparador 3f91e78a):
        # ela sobe ENGATINHANDO pelo pe da cama, se joga de lado abracando o
        # travesseiro e puxa o cobertor. Dorme de lado, encolhida.
        # A cama do quarto foi regerada SEM AS PELUCIAS (pedido dele) e a
        # folha veio da regua nova, entao nao ha pelucia pra sumir no meio.
        "quadros": ["cama-b-dorme-%d.png" % i for i in range(1, 9)],
        # ela chega pelo PE da cama agora — o ponto sai da propria arte
        # (onde a folha desenhou as botas dela)
        "aproximar": [469, 1109],
        "olhar": [0, -1],           # de costas, como a arte desenha
        "ritmo_ms": 450,
        "dura_ms": 30000,
        "estado": "dormindo",
        "zzz": [329, 288],
        "entrada": [
            {"q": "cama-b-1.png", "ms": 900},   # em pe no pe da cama
            {"q": "cama-b-2.png", "ms": 800},   # engatinha pra dentro
            {"q": "cama-b-3.png", "ms": 800},   # se joga de lado no travesseiro
            {"q": "cama-b-4.png", "ms": 700},   # puxa o cobertor
        ],
        # saida = a entrada de tras pra frente: mesma arte de cama o tempo
        # todo, e as poses ja servem pra levantar
        "saida": [
            {"q": "cama-b-4.png", "ms": 700},
            {"q": "cama-b-2.png", "ms": 800},
            {"q": "cama-b-1.png", "ms": 700},
        ],
    },
    "sofa": {
        "peca": "sofa",
        "margem": 200,
        # Molde do puff: ela vem SOZINHA em cinza, sentada de pernas dobradas
        # com o balde de pipoca; o sofa do cenario fica intocado.
        # A folha desenhou ela virada pra ESQUERDA e a TV do quarto fica a
        # DIREITA do sofa, entao os quadros sao espelhados na montagem.
        # A escala saiu do ROSTO (39 px, o do sprite nativo) — encolhida no
        # sofa, a ALTURA dela nao serve de regua.
        # A pose, a vista, a inclinacao e o tamanho sao os que o MICHEL
        # escolheu no editor (artifact 0a0224d2) — vista 3/4, 83%, inclinada
        # -20 graus, com a borracha dele. Os 4 quadros vieram de uma folha
        # gerada A PARTIR DESSA MESMA VISTA, so com o braco e a boca mudando
        # (sobreposicao 92-97% com o sprite que ele lapidou, entao a borracha
        # dele continua valendo).
        "quadros": ["sofa-tv-%d.png" % i for i in range(1, 5)],
        # o sofa esta na BORDA do piso: nao existe chao na frente dele. O
        # unico chao que o alcanca fica atras/direita, a 150 px de onde ela
        # senta — por isso ela senta no canto direito, pra encurtar o corte.
        "aproximar": [1795, 1057],   # unico chao que alcanca o sofa
        "olhar": [1, 0.2],          # de perfil, olhando pra TV
        "ritmo_ms": 600,            # mao no balde, come, volta
        "dura_ms": 40000,
        "estado": "vendo TV",
        # a luz da TV batendo no rosto dela, por codigo: pintada na arte a luz
        # fica morta; assim ela pisca junto com a imagem da TV
                # O brilho NAO fica no rosto dela: o centro e A TELA DA TV, com raio
        # grande o bastante pra alcancar o sofa. Assim a luz nasce forte na TV
        # e chega fraca nela — pedido do Michel. Coords relativas ao quadro da
        # estacao (origem 1234,736): a TV esta em ~(2030,1150) na cena.
        "brilho": {"pos": [796, 414], "raio": 560, "forca": 0.72,
                   "cor": "150,190,255"},
    },
    # ESTACAO DA GELADEIRA/REFRIGERANTE REMOVIDA (28/08, pedido do Michel).
    # A arte dela existe (coca-1..4.png, ela sozinha em cinza no molde do
    # puff) e a config esta no historico; o que nunca fechou foi a PORTA
    # ABRINDO — 7 tentativas, todas movendo o movel ou invadindo o balcao.
    # Se voltar, o caminho e o EDITOR (como no sofa), nao automatizar.
    "cafe": {
        "peca": "cozinha",
        # a cozinha ja e alta (650 px); com folga de 360 a origem do retalho
        # cairia ACIMA do topo do cenario. 200 basta: ela em pe (340) cabe
        # entre o topo da peca e o chao onde ela para.
        "margem": 200,
        # Molde do puff/pesinhos: a folha traz ELA SOZINHA em cinza, e o
        # balcao do cenario fica INTOCADO. A 1a tentativa desenhou o balcao
        # junto e o modelo repintou tudo de marrom — como o registro usa a
        # silhueta da peca original e a COR da nova, a cozinha do quarto
        # teria escurecido. Gerando so ela, esse risco nao existe.
        "quadros": ["cafe-%d.png" % i for i in range(1, 5)],
        "aproximar": [2430, 950],   # chao livre em frente ao balcao
        "olhar": [0, 1],            # de frente: e onde o rosto dela aparece
        "ritmo_ms": 700,            # goles, sem pressa
        "dura_ms": 25000,
        "estado": "tomando café",
    },
    "pesinhos": {
        "peca": "pesinhos",
        # prop RASTEIRO (79 px): com a folga padrao de 170 ela em pe sairia
        # cortada no topo da tela — e o que fica de fora nao volta depois.
        "margem": 360,
        # Molde do puff, o unico que ele elogiou: a folha traz ELA SOZINHA em
        # fundo cinza, corpo inteiro, sem movel nenhum; a escala e minha e a
        # peca do cenario fica intocada. Aqui ela nem entra num movel — pega
        # os halteres e treina em pe, entao o quadro e SO ELA.
        # a folha voltou em grade 4x2 = 8 quadros (a forma da grade nunca e a
        # que eu peco). Melhor assim: 8 quadros e um ciclo de rosca inteiro
        # subindo e descendo, nao a piscada de 2 quadros que ele ja reprovou
        # na cama ("animacao pobre").
        "quadros": ["pesinhos-treino-%d.png" % i for i in range(1, 9)],
        "aproximar": [1098, 1362],    # onde os pes dela pousam, chao livre
        "olhar": [0, 1],            # a folha desenha ela de frente
        "ritmo_ms": 220,            # 8 quadros = ~1,8 s por repeticao
        "dura_ms": 30000,
        "estado": "treinando",
        # os halteres estao NAS MAOS dela: nao podem continuar no chao
        "esconder": ["pesinhos"],
    },
    "mesa": {
        "peca": "mesa_setup",
        # 2 paineis quase identicos, registrados com MESMA escala e offset
        # (94,9% os dois) — loop sem pulo. Ela ja aparece sentada; o corte
        # unico e o padrao aprovado (pufe). A tela do monitor muda do grafico
        # pra uma pagina colorida quando ela senta: ela parou de olhar o
        # mercado pra navegar.
        # UM quadro so, como o pufe: os 2 paineis da folha saem com CABECAS
        # de tamanhos diferentes (9231 vs 6690 px escuros) e o loop virava
        # "cabeca aumentando e diminuindo" (bronca de 28/08). Fica o painel
        # de cabeca menor; a vida vem do brilho do monitor.
        # DIGITANDO: 2 quadros da MESMA camada (posicionada e lapidada pelo
        # proprio Michel no editor 28/08) onde so as maos alternam 2px.
        "quadros": ["mesa-navegar-1.png", "mesa-navegar-2.png"],
        "aproximar": [1460, 875],   # chao livre em frente a cadeira
        # DE COSTAS ao chegar. Com (-0.6,-0.8) o motor escolhia o sprite
        # dir-4 ESPELHADO (tres-quartos) e o corte pra arte sentada (que e
        # de costas) dava um tranco de pose. [0,-1] = dir-5, a MESMA pose
        # que esta desenhada na entrada e no corpo sentado.
        "olhar": [0, -1],
        "ritmo_ms": 420,            # tec-tec de digitacao
        "dura_ms": 60000,
        "estado": "navegando",
        # brilho do monitor no rosto dela (coord do sprite da estacao)
        # ela agora esta DE COSTAS (encaixe do Michel no editor), entao o
        # brilho tem o centro NA TELA DO MONITOR e a luz cai em cima
        # dela — mesma logica da TV do sofa.
        "brilho": {"pos": [308, 325], "raio": 300, "forca": 0.60,
                   "cor": "180,200,255"},
    },
    "puff": {
        "peca": "puff_pata",
        # o painel 1 da folha (ela em pe pegando o console) tem o pufe
        # desenhado MAIOR que os outros; entraria com outra escala e ela
        # pulsaria de tamanho. Ficaram os 3 coerentes entre si.
        # UM quadro so. Os dois do loop vinham com o PUFE desenhado em
        # alturas diferentes (210 e 196 px, mesma base e mesma largura) — ela
        # esta certa em relacao ao movel nos dois, quem varia e o movel. Como
        # o registro alinha pela base, a diferenca virava sobe-e-desce; e
        # corrigir por deslocamento graduado esticava o pufe junto (o
        # deslocamento so conhece altura, entao pega o movel no caminho).
        # Com um quadro so nao ha o que pular. A vida vem do brilho da tela,
        # que pisca por codigo.
        "quadros": ["puff-jogar-2.png"],
        "aproximar": [1098, 902],   # pe da arte, a frente da base da peca
        "olhar": [0, 1],            # a folha mostra ela de frente
        "ritmo_ms": 900,            # ela se ajeita jogando, sem pressa
        "dura_ms": 45000,
        "estado": "jogando",
        # o quadro 1 da folha ("se acomodando") saiu com a PROPORCAO VELHA —
        # ela aparece grande, sentada alta, e depois encolhe pro loop. Um pulo
        # de 83px. Melhor nao ter beat de sentar do que ter um errado: ela
        # anda ate o pufe e ja aparece sentada, corte unico como na cama.
        "entrada": [],
        "saida": [],
        # o 3DS sai do chao enquanto ela esta com ele na mao
        "esconder": ["n3ds"],
        # brilho da tela batendo no rosto (coord do sprite da estacao)
        "brilho": {"pos": [258, 163], "raio": 120, "cor": "150,210,255"},
    },
}


def reduzir(im, larg, alt):
    a = np.array(im.convert("RGBA")).astype(float)
    al = a[:, :, 3:4] / 255.0
    pm = Image.fromarray((a[:, :, :3] * al).astype(np.uint8)) \
              .resize((larg, alt), Image.LANCZOS)
    ar = Image.fromarray(a[:, :, 3].astype(np.uint8)) \
              .resize((larg, alt), Image.LANCZOS)
    pm = np.array(pm).astype(float)
    ar = np.array(ar).astype(float)
    rgb = np.where(ar[:, :, None] > 0, pm * 255.0 / np.maximum(ar[:, :, None], 1), 0)
    out = np.zeros((alt, larg, 4), np.uint8)
    out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[:, :, 3] = ar.astype(np.uint8)
    return Image.fromarray(out)


def b64(im, fmt="PNG", **kw):
    b = io.BytesIO()
    im.save(b, fmt, **kw)
    return "data:image/%s;base64,%s" % (fmt.lower(),
                                        base64.b64encode(b.getvalue()).decode())


def main():
    template, saida = sys.argv[1], sys.argv[2]
    mapa = json.load(open(os.path.join(QUARTO, "mapa-solo.json"), encoding="utf-8"))
    W, H = 2752 // K, 1536 // K
    d = {"W": W, "H": H, "K": K}

    d["cenario"] = b64(Image.open(os.path.join(QUARTO, mapa["cenario"]))
                       .convert("RGB").resize((W, H), Image.LANCZOS),
                       "JPEG", quality=88, optimize=True)
    piso = np.array(Image.open(os.path.join(QUARTO, mapa["piso_mascara"]))) > 0
    d["piso"] = b64(Image.fromarray((piso[::K, ::K] * 255).astype(np.uint8)).convert("1"))

    d["pecas"] = []
    for nome, p in mapa["pecas"].items():
        if p["camada"] == "chao":
            continue
        im = Image.open(os.path.join(QUARTO, p["sprite"])).convert("RGBA")
        if p["flip"]:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = reduzir(im, max(1, im.width // K), max(1, im.height // K))
        d["pecas"].append({"n": nome, "x": p["pos"][0] // K, "y": p["pos"][1] // K,
                           "b": p["base"] // K, "d": b64(im)})

    ALT = mapa["altura_corpo"] // K
    d["ALT"] = ALT

    def sprite(caminho):
        im = Image.open(caminho).convert("RGBA")
        return reduzir(im, round(im.width * ALT / im.height), ALT)

    # O PREFIXO DOS SPRITES DELA. A Yuna e um projeto NOVO — nada dela devia
    # se chamar "sable". Os arquivos foram copiados para `yuna-*`; o Conatus
    # continua lendo os `sable-*`, que ficaram onde estavam. SPRITE_PREFIXO
    # decide qual conjunto entra, e o padrao segue o do show antigo pra nao
    # mexer no que esta no ar.
    pre = os.environ.get("SPRITE_PREFIXO", "sable")
    for grupo, prefixo, n in [("andar", pre + "-andar-", 6),
                              ("dir", pre + "-dir-", 5),
                              ("tras", pre + "-tras-", 6)]:
        d[grupo] = [b64(sprite(os.path.join(RECORTES, "%s%d.png" % (prefixo, i))))
                    for i in range(1, n + 1)]

    # GESTOS DELA: animacoes sem movel nenhum (espreguicar, agachar pro gato).
    # ATENCAO A ESCALA: aqui NAO da pra normalizar por altura como nas poses
    # de andar, porque o gesto muda a altura de proposito — braco pro alto
    # aumenta, agachar diminui. Entao a folha inteira leva UMA escala so,
    # tirada do primeiro quadro, que e a pose parada. Foi assim que o gato
    # parou de mudar de tamanho entre um ciclo e outro.
    # ALTURA RELATIVA DO GESTO (01/09/2026). Os gestos ate aqui eram todos DE
    # PE, entao a escala saia de `ALT / altura_do_quadro_1` e dava certo por
    # acidente: o quadro 1 media a mesma coisa que ela em pe.
    # `desenhar` e a primeira pose SENTADA — de pernas dobradas ela tem pouco
    # mais da metade da propria altura. Normalizar isso pra ALT esticaria a
    # figura ate ela ficar do tamanho de uma pessoa em pe, sentada: uma giganta
    # no meio do tapete. O fator abaixo diz que altura a pose OCUPA na cena.
    ALTURA_GESTO = {"acenar": 1.0, "carinho": 1.0, "desenhar": 0.62}
    gestos = {}
    for nome in ("acenar", "carinho", "desenhar"):
        caminhos = [os.path.join(RECORTES, "%s-%s-%d.png" % (pre, nome, i))
                    for i in range(1, 5)]
        if not all(os.path.exists(c) for c in caminhos):
            continue
        ims = [Image.open(c).convert("RGBA") for c in caminhos]
        esc = (ALT * ALTURA_GESTO.get(nome, 1.0)) / ims[0].height
        gestos[nome] = [b64(reduzir(im, max(1, round(im.width * esc)),
                                        max(1, round(im.height * esc))))
                        for im in ims]
        print("gesto %s: 4 quadros, escala %.4f (altura relativa %.2f)"
              % (nome, esc, ALTURA_GESTO.get(nome, 1.0)))
    if gestos:
        d["gestos"] = gestos

    # JIJI, o gato: sprites proprios e o ponto onde fica a casinha dele.
    # Ele vive em paralelo a ela — anda sozinho, senta, se espreguica e vai
    # dormir na casinha. Os sprites ja vem na escala da cena (o gato andando
    # tem ~1/5 da altura dela); aqui so cai pra meia-res como todo o resto.
    jiji = {}
    for nome in ("sentado", "andar1", "andar2", "andar3", "andar4",
                 "dormindo", "espreguica", "deitado"):
        caminho = os.path.join(RECORTES, "jiji-%s.png" % nome)
        if not os.path.exists(caminho):
            jiji = None
            print("jiji PULADO — falta jiji-%s.png" % nome)
            break
        im = Image.open(caminho).convert("RGBA")
        jiji[nome] = b64(reduzir(im, max(1, im.width // K), max(1, im.height // K)))
    # ciclos opcionais: se a arte existir, entram; se nao, o motor so nao usa.
    if jiji:
        for nome in ("limpar1", "limpar2", "limpar3", "limpar4",
                     "brincar1", "brincar2", "brincar3", "brincar4"):
            caminho = os.path.join(RECORTES, "jiji-%s.png" % nome)
            if not os.path.exists(caminho):
                continue
            im = Image.open(caminho).convert("RGBA")
            jiji[nome] = b64(reduzir(im, max(1, im.width // K), max(1, im.height // K)))
    if jiji:
        casa = mapa["pecas"].get("torre_gato_2")
        jiji["casa"] = [casa["pe"][0] // K, (casa["pe"][1] + 10) // K] if casa else None
        d["jiji"] = jiji
        print("jiji: %d poses + casinha em %s" % (len(jiji) - 1, jiji["casa"]))

    # FONTES DE LUZ do quarto (luzes.json). Vao como DADO, nao como pintura:
    # o motor desenha a camada a cada mudanca de hora e faz o ciclo de dia e
    # noite so com elas. Coordenadas caem pra meia-res como todo o resto.
    caminho_luz = os.path.join(QUARTO, "luzes.json")
    if os.path.exists(caminho_luz):
        with open(caminho_luz, encoding="utf-8") as fh:
            fontes = json.load(fh)["fontes"]
        d["luzes"] = []
        for nome, f in fontes.items():
            luz = {"n": nome,
                   "pos": [f["pos"][0] // K, f["pos"][1] // K],
                   "raio": [f["raio"][0] // K, f["raio"][1] // K],
                   "cor": f["cor"], "forca": f["forca"]}
            pc = f.get("poca_chao")
            if pc:
                luz["poca"] = {"pos": [pc["pos"][0] // K, pc["pos"][1] // K],
                               "raio": [pc["raio"][0] // K, pc["raio"][1] // K],
                               "forca": pc["forca"]}
            d["luzes"].append(luz)
        print("luzes: %d fontes" % len(d["luzes"]))

    # A COZINHA E PROIBIDA PRO GATO (pedido do Michel, 29/08). O poligono esta
    # em coordenadas de MEIA-RES, ja no sistema que o motor usa, e foi tirado
    # olhando a divisa do ladrilho no zoom — detectar por cor nao funciona
    # aqui: a luz neon rosa e a luz azul da janela estao pintadas no piso,
    # entao nem matiz nem saturacao separam ladrilho de assoalho.
    d["proibido_gato"] = [[963, 432], [1050, 368], [1376, 430],
                          [1376, 560], [1160, 632]]

    d["estacoes"] = {}
    for nome, e in ESTACOES.items():
        caminhos = [os.path.join(QUARTO, "pecas", q) for q in e["quadros"]]
        faltando = [c for c in caminhos if not os.path.exists(c)]
        if faltando:
            print("estacao '%s' PULADA — falta %s"
                  % (nome, ", ".join(os.path.basename(f) for f in faltando)))
            continue
        p = mapa["pecas"][e["peca"]]

        # QUADRO = REMENDO OPACO JA COMPOSTO SOBRE O CENARIO (28/08).
        # Antes o quadro (com alfa) era desenhado por cima do cenario ja
        # reduzido, e o meio-pixel de desalinhamento na reducao K=2 dobrava
        # todos os tracos ("duas mesas/duas camas", bronca do Michel). Agora
        # cada quadro vira um retalho do cenario em resolucao CHEIA com a
        # arte da estacao colada em cima, origem PAR (a grade da reducao K=2
        # casa com a do cenario => pixels identicos fora da arte).
        # A folga em volta da peca. 170 serve pra movel grande (cama, mesa),
        # onde ela cabe dentro da tela; num prop RASTEIRO (os pesinhos tem
        # 79 px de altura) ela em pe estoura pra cima e sai cortada — e o
        # que fica de fora nao tem como voltar depois. Por isso e por
        # estacao.
        MARGEM_EST = e.get("margem", 170)
        ox, oy = p["pos"][0] - MARGEM_EST, p["pos"][1] - MARGEM_EST
        ex, ey = ox - (ox % 2), oy - (oy % 2)
        dx_, dy_ = ox - ex, oy - ey
        cen_cheio = Image.open(os.path.join(QUARTO, mapa["cenario"])).convert("RGBA")

        # REMENDO DENTRO DO RETALHO (28/08). O motor desenha o remendo e
        # DEPOIS o quadro da estacao — mas o quadro e OPACO e traz o cenario
        # inteiro daquela area, entao ele redesenhava por cima a peca que o
        # remendo tinha acabado de apagar. Isso nunca apareceu no 3DS porque
        # o 3DS fica FORA do retalho do pufe; nos pesinhos o remendo cai
        # bem no meio do proprio retalho. Cura: o retalho ja nasce sem a
        # peca — o remendo entra aqui, antes da arte dela.
        rem_json = os.path.join(QUARTO, "pecas", "remendos.json")
        rem_todos = json.load(open(rem_json, encoding="utf-8")) if os.path.exists(rem_json) else {}
        remendos_locais = []
        for alvo in e.get("esconder", []):
            arq = os.path.join(QUARTO, "pecas", "remendo-sem-%s.png" % alvo)
            if os.path.exists(arq) and alvo in rem_todos:
                remendos_locais.append((Image.open(arq).convert("RGBA"),
                                        rem_todos[alvo][0] - ex, rem_todos[alvo][1] - ey))

        def peca_estacao(nome_arq):
            im = Image.open(os.path.join(QUARTO, "pecas", nome_arq)).convert("RGBA")
            base = cen_cheio.crop((ex, ey, ex + dx_ + im.width, ey + dy_ + im.height)).copy()
            for rim, rx, ry in remendos_locais:
                base.paste(rim, (rx, ry), rim)
            base.paste(im, (dx_, dy_), im)
            # retalho opaco: JPEG corta o peso em ~4x sem alfa a perder
            return b64(reduzir(base, max(1, base.width // K), max(1, base.height // K))
                       .convert("RGB"), "JPEG", quality=90, optimize=True)

        def fases(lista):
            saida = []
            for f in lista or []:
                caminho = os.path.join(QUARTO, "pecas", f["q"])
                if not os.path.exists(caminho):
                    print("   fase '%s' PULADA — arte ainda nao existe" % f["q"])
                    continue
                saida.append({"ms": f["ms"], "corpo": f.get("corpo"),
                              "d": peca_estacao(f["q"])})
            return saida

        # REMENDOS: peca que sai de cena enquanto ela usa a estacao (o 3DS
        # esta na mao dela, nao pode continuar no chao). O remendo e o pedaco
        # do cenario composto SEM aquela peca, desenhado por cima.
        esconder = []
        rem_pos = {}
        cam_rem = os.path.join(QUARTO, "pecas", "remendos.json")
        if os.path.exists(cam_rem):
            rem_pos = json.load(open(cam_rem, encoding="utf-8"))
        for alvo in e.get("esconder", []):
            arq = os.path.join(QUARTO, "pecas", "remendo-sem-%s.png" % alvo)
            if not os.path.exists(arq) or alvo not in rem_pos:
                print("   remendo de '%s' ausente — a peca vai continuar visivel" % alvo)
                continue
            im = Image.open(arq).convert("RGBA")
            esconder.append({"n": alvo,
                             "x": rem_pos[alvo][0] // K, "y": rem_pos[alvo][1] // K,
                             "d": b64(reduzir(im, max(1, im.width // K),
                                              max(1, im.height // K)))})

        quadros = []
        for c in caminhos:
            quadros.append(peca_estacao(os.path.basename(c)))
        d["estacoes"][nome] = {
            "pos": [ex // K, ey // K],
            "base": p["base"] // K,
            # nome da peca do movel: o motor precisa dela pra redesenhar SO
            # esse movel por cima do gato quando ele passa atras
            "peca": e["peca"],
            "aproximar": [e["aproximar"][0] // K, e["aproximar"][1] // K],
            "ritmo_ms": e["ritmo_ms"],
            "dura_ms": e.get("dura_ms"),
            "estado": e.get("estado", "na estação"),
            "olhar": e.get("olhar"),
            "zzz": [(e["zzz"][0] + MARGEM_EST + dx_) // K, (e["zzz"][1] + MARGEM_EST + dy_) // K] if e.get("zzz") else None,
            "brilho": ({"pos": [(e["brilho"]["pos"][0] + dx_) // K,
                                (e["brilho"]["pos"][1] + dy_) // K],
                        "raio": e["brilho"]["raio"] // K,
                        "forca": e["brilho"].get("forca", 0.5),
                        "cor": e["brilho"]["cor"]} if e.get("brilho") else None),
            "esconder": esconder,
            "quadros": quadros,
            "entrada": fases(e.get("entrada")),
            "saida": fases(e.get("saida")),
        }
        print("estacao '%s': %d quadros de sono, %d fase(s) de entrada, "
              "%d de saida" % (nome, len(quadros),
                               len(d["estacoes"][nome]["entrada"]),
                               len(d["estacoes"][nome]["saida"])))

    js = json.dumps(d, separators=(",", ":"))
    html = open(template, encoding="utf-8").read()
    if "__DADOS__" not in html:
        raise SystemExit("o template nao tem o marcador __DADOS__")
    open(saida, "w", encoding="utf-8").write(html.replace("__DADOS__", js))
    print("-> %s  (%.2f MB)" % (saida, len(js) / 1048576))


if __name__ == "__main__":
    main()
