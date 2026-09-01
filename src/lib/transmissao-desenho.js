// ============================================================================
// A TRANSMISSAO DO DESENHO, EM NODE.
//
// Por que existe (01/09/2026): o desenho so aparecia pra quem estivesse na
// maquina de casa. A transmissao era um processo Python separado, na porta
// 8435, e o painel do quarto apontava pra `localhost` — quem abrisse yuna.cam
// via o painel VAZIO. O Michel foi direto: "preciso que tudo funcione,
// inclusive ela desenhando em tempo real".
//
// A chave e uma coisa que passa despercebida: REPRODUZIR NAO PRECISA DE GPU.
// Calcular o desenho precisa (e por isso o ateliê continua em casa), mas
// reproduzir e ler um arquivo e mandar os toques em ordem. Isso o Railway faz.
//
// O tamanho era o obstaculo: 209 MB de gravacao. Toques sao arrays de numeros
// e comprimem a 13% — 28 MB, que cabem no repo. Entao as gravacoes viajam
// junto do codigo e o Railway serve o desenho sozinho.
//
// O formato e o mesmo que o player ja consome (o `tela-yuna.html` do ateliê),
// entao a tela nao muda: `inicio`, lotes de `toques`, `fim`.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* Quantos toques por mensagem. Lote grande engasga o navegador; pequeno vira
   sobrecarga de protocolo. 400 e o numero que o player do ateliê ja usava. */
const LOTE = 400;
/* Pausa entre lotes. O RITMO REAL de desenho quem manda e o player (ele tem o
   proprio controle de velocidade); aqui e so pra nao despejar 28 MB de uma vez
   e travar a aba. */
const PAUSA_MS = 30;

export function pastaDasGravacoes(raiz) {
  return process.env.GRAVACOES_DIR || path.join(raiz, "gravacoes");
}

/* O que existe pra reproduzir. */
export function indice(raiz) {
  const dir = pastaDasGravacoes(raiz);
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "indice.json"), "utf8"));
  } catch {
    /* sem indice, deduz pelos arquivos — nunca deixar a fila sumir por causa
       de um json de metadados */
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith("-toques.json.gz"))
        .map((f) => ({ nome: f.replace("-toques.json.gz", "") }));
    } catch { return []; }
  }
}

/* Carrega uma gravacao. Aceita comprimida (.gz, que e como ela viaja no repo)
   ou crua — a maquina de casa gera crua. */
export function carregar(raiz, nome) {
  const dir = pastaDasGravacoes(raiz);
  const seguro = path.basename(String(nome || ""));
  const gz = path.join(dir, `${seguro}-toques.json.gz`);
  const cru = path.join(dir, `${seguro}-toques.json`);
  try {
    if (fs.existsSync(gz))
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8"));
    if (fs.existsSync(cru))
      return JSON.parse(fs.readFileSync(cru, "utf8"));
  } catch { /* arquivo corrompido nao pode derrubar o servidor */ }
  return null;
}

/* Manda a gravacao por SSE, no formato que o player do ateliê ja entende.
   Nao bloqueia o servidor: o envio e assincrono e para sozinho se quem estava
   assistindo fechar a aba. */
/* Quanto dura a hora do desenho, em minutos. E o relogio que sincroniza todo
   mundo: a obra inteira e distribuida nesse tempo. */
const DURACAO_MIN = Number(process.env.DESENHO_MINUTOS) || 50;

export function transmitir(res, gravacao, { desde = null } = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "connection": "keep-alive",
    /* sem isto o proxy do Railway segura o stream inteiro num buffer e o
       desenho so aparece no fim, de uma vez — que e o oposto do ponto */
    "x-accel-buffering": "no",
  });

  let vivo = true;
  res.on("close", () => { vivo = false; });

  const enviar = (evento, dado) => {
    if (!vivo) return false;
    try {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`);
      return true;
    } catch { vivo = false; return false; }
  };

  const toques = gravacao.toques || [];

  /* ONDE A OBRA DEVERIA ESTAR AGORA.
     `desde` e o instante em que ela sentou (vem de `cena.desde`). O calculo e
     aqui, mas quem SALTA e o player: o ritmo do traco e dele, e mandar os
     toques mais cedo nao mudaria o compasso. Entao o numero viaja no `inicio`
     e a tela desenha esse pedaco de uma vez.
     Sem `desde`, comeca do zero — que e o certo pra um teste isolado. */
  let pular = 0;
  if (desde) {
    const fracao = Math.max(0, Math.min(1,
      (Date.now() - Number(desde)) / (DURACAO_MIN * 60000)));
    pular = Math.floor(toques.length * fracao);
  }

  enviar("inicio", {
    largura: gravacao.largura, altura: gravacao.altura,
    fundo: gravacao.fundo, total: toques.length,
    fala: "", ciclo: false, titulo: "",
    carimbos: gravacao.carimbos || {},
    pular,
  });

  let i = 0;

  const passo = () => {
    if (!vivo) return;
    if (i >= toques.length) {
      enviar("fim", { toques: toques.length });
      try { res.end(); } catch {}
      return;
    }
    enviar("toques", toques.slice(i, i + LOTE));
    i += LOTE;
    setTimeout(passo, PAUSA_MS);
  };
  setTimeout(passo, 60);
}
