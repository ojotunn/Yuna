# -*- coding: utf-8 -*-
"""MARCAR O CHAO POR CLIQUE, NAO POR PINCEL. (02/09/2026)

Eu tinha mandado o Michel PINTAR uma mascara de 2752x1536 a mao. Resposta
dele: "pra marcar isso aqui na mao vai ser foda". Estava certo — era a
ferramenta errada.

Chao isometrico e um punhado de POLIGONOS de lados retos. Sao uns 30 cliques,
nao 4 milhoes de pixels. Esta pagina mostra a casa, ele clica os cantos, e o
servidor grava a mascara e a prova.

    python scripts/marcar-piso.py
    depois abre  http://localhost:8100
"""
import base64
import http.server
import json
import os
import socketserver

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASA = os.path.join(AQUI, "quarto", "casa")
IMG = os.path.join(CASA, "CASA-VAZIA.png")
PORTA = 8100

PLANTA = os.path.join(CASA, "CASA-PLANTA.png")
im = Image.open(IMG).convert("RGB")
W, H = im.size
with open(IMG, "rb") as f:
    B64 = base64.b64encode(f.read()).decode()
# A PLANTA: mesma casa sem paredes, pra ele ver o chao que a parede esconde.
with open(PLANTA, "rb") as f:
    B64P = base64.b64encode(f.read()).decode()
# O que ele ja marcou volta carregado — nao se recomeca trabalho feito.
try:
    JA = json.dumps(json.load(open(os.path.join(CASA, "piso-poligonos.json")))["poligonos"])
except Exception:
    JA = "[]"

PAGINA = """<!doctype html><meta charset="utf-8"><title>Marcar o chao</title>
<style>
 body{margin:0;background:#15131c;color:#e8e4f0;font:14px system-ui,sans-serif}
 .topo{padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;
   position:sticky;top:0;background:#15131c;border-bottom:1px solid #2e2a3c;z-index:2}
 button{background:#2a2636;color:#e8e4f0;border:1px solid #443d5c;border-radius:5px;
   padding:7px 13px;font-size:13px;cursor:pointer}
 button:hover{background:#37314a} button.ok{background:#2f6d46;border-color:#3f8f5e}
 .dica{color:#9a92b0;font-size:12.5px}
 #wrap{position:relative;display:inline-block;margin:12px}
 canvas{display:block;cursor:crosshair}
</style>
<div class="topo">
  <button onclick="fechar()">Fechar poligono (F)</button>
  <button onclick="desfazer()">Desfazer ponto (Z)</button>
  <button onclick="apagar()">Apagar ultimo poligono</button>
  <button onclick="trocar()">Planta / Casa (TAB)</button>
  <button onclick="menos()">&minus;</button>
  <button onclick="mais()">+ zoom</button>
  <button class="ok" onclick="salvar()">SALVAR</button>
  <span class="dica">Clique os cantos de um comodo. F fecha. Marque tambem os VAOS DE PORTA como poligono ligando os dois lados.</span>
  <span id="st" class="dica"></span>
</div>
<div id="wrap"><canvas id="c"></canvas></div>
<script>
const W=__W__, H=__H__;
const img=new Image(); img.src="data:image/png;base64,__B64__";
const imgP=new Image(); imgP.src="data:image/png;base64,__B64P__";
let mostraPlanta=true;
const c=document.getElementById("c"), g=c.getContext("2d");
let esc=1, polis=__JA__, atual=[];
let zoom=1;
function ajustar(){ const cabe=(window.innerWidth-44)/W; esc=cabe*zoom;
  c.width=Math.round(W*esc); c.height=Math.round(H*esc); desenhar(); }
img.onload=ajustar; window.onresize=ajustar;
function trocar(){ mostraPlanta=!mostraPlanta; desenhar(); }
function mais(){ zoom=Math.min(4,zoom*1.4); ajustar(); }
function menos(){ zoom=Math.max(1,zoom/1.4); ajustar(); }
function desenhar(){
  g.clearRect(0,0,c.width,c.height);
  g.drawImage(mostraPlanta?imgP:img,0,0,c.width,c.height);
  g.lineWidth=2;
  for(const p of polis) pinta(p,"rgba(60,230,130,.42)","#5ff0a0",true);
  if(atual.length) pinta(atual,"rgba(255,210,120,.30)","#ffd27a",false);
  document.getElementById("st").textContent =
    polis.length+" poligono(s) · "+atual.length+" ponto(s) no atual";
}
function pinta(p,fill,linha,fechado){
  if(!p.length) return;
  g.beginPath(); g.moveTo(p[0][0]*esc,p[0][1]*esc);
  for(let i=1;i<p.length;i++) g.lineTo(p[i][0]*esc,p[i][1]*esc);
  if(fechado) g.closePath();
  g.fillStyle=fill; if(fechado||p.length>2) g.fill();
  g.strokeStyle=linha; g.stroke();
  g.fillStyle=linha;
  for(const [x,y] of p){ g.beginPath(); g.arc(x*esc,y*esc,4,0,7); g.fill(); }
}
c.onclick=e=>{ const r=c.getBoundingClientRect();
  atual.push([Math.round((e.clientX-r.left)/esc), Math.round((e.clientY-r.top)/esc)]); desenhar(); };
function fechar(){ if(atual.length>2){ polis.push(atual); atual=[]; desenhar(); } }
function desfazer(){ atual.pop(); desenhar(); }
function apagar(){ if(!atual.length) polis.pop(); else atual=[]; desenhar(); }
document.onkeydown=e=>{ const k=e.key.toLowerCase();
  if(k==="f"){fechar();} if(k==="z"){desfazer();}
  if(e.key==="Tab"){e.preventDefault(); trocar();} };
async function salvar(){
  fechar();
  const r=await fetch("/salvar",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({poligonos:polis})});
  const j=await r.json();
  document.getElementById("st").textContent = j.msg;
}
</script>"""

PAGINA = (PAGINA.replace("__W__", str(W)).replace("__H__", str(H))
          .replace("__B64P__", B64P).replace("__B64__", B64).replace("__JA__", JA))


class Mao(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        corpo = PAGINA.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        d = json.loads(self.rfile.read(n) or b"{}")
        polis = d.get("poligonos") or []
        m = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(m)
        for p in polis:
            if len(p) > 2:
                dr.polygon([tuple(q) for q in p], fill=255)
        m.save(os.path.join(CASA, "piso-casa.png"))
        piso = np.array(m) > 127
        prova = np.array(im).astype(int)
        prova[piso] = (prova[piso] * .4 + np.array([40, 230, 120]) * .6).astype(int)
        Image.fromarray(prova.astype(np.uint8)).save(os.path.join(CASA, "piso-prova.png"))
        json.dump({"poligonos": polis}, open(os.path.join(CASA, "piso-poligonos.json"), "w"), indent=1)
        msg = "gravado: %d poligono(s), %.1f%% pisavel" % (len(polis), 100 * piso.mean())
        print("  " + msg)
        corpo = json.dumps({"msg": msg}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


print("  casa %dx%d" % (W, H))
print("  abra:  http://localhost:8100")
print("  (ctrl+c aqui pra parar)")
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORTA), Mao) as s:
    s.serve_forever()
