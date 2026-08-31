# -*- coding: utf-8 -*-
"""Prepara o HTML da LIVE: so o quarto na tela, preenchendo, com traco suave.

TAMANHO E TRACO FORAM ESCOLHIDOS PELO MICHEL, no /editor, em 30/08/2026, olhando
o resultado — nao no meu chute. A marcacao dele esta em src/data/tela-live.json:
palco 1920x1080, quarto 1923x1073, escala 1.3975, traco suave. Ou seja: PREENCHE
A TELA. Nao mudar por conta propria.

REGRA QUE CUSTOU CARO (nao apagar):
  `image-rendering:pixelated` em escala QUEBRADA destroi o desenho — o navegador
  descarta ou duplica linhas de pixel de forma irregular e o traco engrossa. Foi
  isso que deixou a live feia por horas enquanto o artifact estava perfeito (o
  artifact nao tem CSS meu: renderiza suave). Entao `pixelated` so quando a
  escala e um INTEIRO exato; em qualquer outra, renderizacao SUAVE.

O que some na live: titulo, texto de ajuda, barra de botoes e nota. O que fica:
a cena (canvas + o painel do navegador dela, posicionado em % da cena, que por
isso acompanha qualquer tamanho).

    python scripts/finalizar-live.py public/yuna-live.html
"""
import io
import re
import sys

MARCA = "yuna-live-tela"

BLOCO = """<style data-marca="%s">
  /* CINEMA: fundo preto, nada alem do quarto, sem rolagem. */
  html,body{margin:0!important;padding:0!important;background:#000!important;
    width:100%%!important;height:100%%!important;overflow:hidden!important}
  body{display:grid!important;place-items:center!important}
  header,.barra,.nota,footer{display:none!important}
  .cena-viva{margin:0!important}
  canvas#tela{cursor:default!important}
</style>
<script data-marca="%s">
/* O TAMANHO E DADO POR CODIGO.
   `max-width/max-height` encaixa uma <img>, nao um <canvas>: o navegador
   resolve a largura primeiro e a altura sai proporcional a ela, estourando a
   janela. Aqui a escala e calculada nas duas direcoes e vence a menor — o
   quarto ocupa a tela inteira e o pouco que sobra fica preto. */
(function(){
  function encaixar(){
    var cv = document.getElementById("tela");
    var cena = document.querySelector(".cena-viva");
    if(!cv || !cena || !cv.width) return;
    var bruto = Math.min(innerWidth / cv.width, innerHeight / cv.height);
    if(!isFinite(bruto) || bruto <= 0) return;
    /* Escala LIVRE (nao arredondada): foi o que ele marcou no editor.
       ?inteiro=1 volta pro 1:1 com pixelated; ?render=pixel/suave forca o
       traco. Ver a REGRA QUE CUSTOU CARO no topo do script que gerou isto. */
    var q = location.search;
    var inteiro = /[?&]inteiro=1/.test(q) && bruto >= 1;
    var k = inteiro ? Math.floor(bruto) : bruto;
    var forca = /[?&]render=(pixel|suave)/.exec(q);
    var lg = Math.round(cv.width * k), al = Math.round(cv.height * k);
    cv.style.width = lg + "px";
    cv.style.height = al + "px";
    cv.style.maxWidth = "none";
    cv.style.maxHeight = "none";
    cv.style.imageRendering = forca ? (forca[1] === "pixel" ? "pixelated" : "auto")
                                    : (inteiro ? "pixelated" : "auto");
    /* a cena acompanha o canvas: o painel do navegador dela e posicionado em
       porcentagem DA CENA, entao ela precisa ter o tamanho da imagem, nao o da
       janela — senao o painel flutua fora do quarto. */
    cena.style.width = lg + "px";
    cena.style.height = al + "px";
  }
  /* AUTO-RECARGA. A tela pergunta ao servidor qual e a versao do HTML; se ela
     mudou depois que esta pagina carregou, recarrega sozinha. Sem isso, quem
     esta assistindo continua vendo a versao velha — inclusive bugs ja
     corrigidos — ate lembrar de apertar F5. */
  (function(){
    var minha = null;
    setInterval(function(){
      fetch("/api/versao", { cache: "no-store" }).then(function(r){ return r.json(); })
        .then(function(j){
          if(!j || !j.versao) return;
          if(minha === null){ minha = j.versao; return; }
          if(j.versao !== minha) location.reload();
        }).catch(function(){});
    }, 4000);
  })();

  addEventListener("resize", encaixar);
  addEventListener("load", encaixar);
  if(document.readyState !== "loading") encaixar();
  else document.addEventListener("DOMContentLoaded", encaixar);
  /* insiste no comeco: o canvas so ganha tamanho depois que o motor monta */
  var n = 0, t = setInterval(function(){ encaixar(); if(++n > 20) clearInterval(t); }, 150);
})();
</script>
""" % (MARCA, MARCA)


def main(caminho):
    s = io.open(caminho, encoding="utf-8").read()
    achados = len(re.findall(r'data-marca="%s"' % MARCA, s))
    for marca in (MARCA, "yuna-live-estilo"):
        s = re.sub(r'<style data-marca="%s">[\s\S]*?</style>\s*' % marca, "", s)
        s = re.sub(r'<script data-marca="%s">[\s\S]*?</script>\s*' % marca, "", s)
    s = BLOCO + s
    io.open(caminho, "w", encoding="utf-8").write(s)
    print("tela da live aplicada em %s (havia %d bloco(s) antes)" % (caminho, achados))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/yuna-live.html")
