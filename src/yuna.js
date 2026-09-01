// ============================================================================
// O SERVIDOR DA YUNA — projeto proprio, site proprio, dominio proprio.
//
// Nada aqui e herdado de outro show (30/08/2026, decisao do Michel): sem loja,
// sem journal, sem banco, sem console de admin. So a tela dela, o estado dela,
// e ligar/desligar o motor. O engine e o mesmo arquivo porque o que separa os
// shows e CONFIGURACAO, nao logica duplicada — mas o que aparece pra quem
// assiste e so dela.
//
// O motor (engine.js) continua sendo o MESMO codigo, porque o que separa os
// dois shows e configuracao (CAST, BANK_ENABLED, RENT_MODE...), nao logica
// duplicada. Este processo so sobe o engine com o .env dela e serve a tela.
//
//     node src/yuna.js                 (usa .env.yuna)
//     PORT=8433 node src/yuna.js
// ============================================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Cascata: padroes < segredos da maquina < arquivo do show. A mesma do engine —
// sem a do meio, subir a Yuna apaga ANTHROPIC_API_KEY e BROWSERBASE_*.
const ENV_SHOW = process.env.ENV_FILE || path.join(ROOT, ".env.yuna");
dotenv.config({ path: path.join(ROOT, ".env.example") });
dotenv.config({ path: path.join(ROOT, ".env"), override: true });
dotenv.config({ path: ENV_SHOW, override: true });
process.env.ENV_FILE = ENV_SHOW;      // o filho herda o mesmo arquivo

const PORTA = Number(process.env.PORT || 8433);
const TELA = path.join(ROOT, "public", "yuna-live.html");
/* O ACERVO mora na maquina que desenha (a GPU e local). No Railway a
   pasta simplesmente nao existe e a store aparece vazia — que e o
   comportamento certo, e nao um erro. */
/* As imagens que viajam no deploy (junto das gravacoes). A obra so
   APARECE na store depois de pintada — ver /api/obras. */
const GRAVACOES = process.env.GRAVACOES_DIR || path.join(ROOT, "gravacoes");
const ACERVO = process.env.ACERVO_DIR ||
  "C:/Higgsfield Games/atelier/acervo/yuna";
const ESTADO = process.env.STATE_FILE || path.join(ROOT, "src", "data", "state-yuna.json");

let filho = null;
let ultimoEstado = null;
let log = [];

function anotar(txt) {
  for (const linha of String(txt).split("\n")) {
    if (!linha.trim()) continue;
    // O engine publica o retrato do mundo por linhas "@STATE {...}".
    if (linha.startsWith("@STATE ")) {
      try { ultimoEstado = JSON.parse(linha.slice(7)); } catch { /* linha partida */ }
      continue;
    }
    log.push(linha);
    if (log.length > 400) log = log.slice(-400);
    process.stdout.write(`  [yuna] ${linha}\n`);
  }
}

function ligar() {
  if (filho) return { ok: false, erro: "ja esta rodando" };
  if (!process.env.ANTHROPIC_API_KEY)
    return { ok: false, erro: "sem ANTHROPIC_API_KEY — ela nao tem com o que pensar" };
  filho = spawn(process.execPath, [path.join(__dirname, "engine.js")], {
    cwd: ROOT,
    env: { ...process.env, STATE_FILE: ESTADO },
    stdio: ["ignore", "pipe", "pipe"],
  });
  filho.stdout.on("data", (d) => anotar(d.toString()));
  filho.stderr.on("data", (d) => anotar(d.toString()));
  filho.on("exit", (c) => { anotar(`— o motor parou (saida ${c}) —`); filho = null; });
  anotar("— o motor subiu —");
  return { ok: true };
}

function desligar() {
  if (!filho) return { ok: false, erro: "nao esta rodando" };
  // Windows nao propaga o sinal pra arvore do processo; sem isto o Chrome
  // remoto e o engine ficavam orfaos e continuavam gastando.
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { stdio: "ignore" });
  else filho.kill("SIGTERM");
  return { ok: true };
}

function enviar(res, codigo, corpo) {
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(corpo));
}

/* O ultimo estado que a maquina de casa mandou. Em memoria de proposito:
   se o servico reiniciar, e melhor cair pro estado local do que servir
   um retrato velho como se fosse ao vivo. */
let estadoDeCasa = null;

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* O SITE. Primeira coisa que quem chega pelo dominio ve: a sala embutida,
     quem ela e, e as obras. A live continua crua em `/live` — e o que o OBS
     captura, e mexer nessa rota derrubaria a transmissao. */
  if (url.pathname === "/" || url.pathname === "/site") {
    const arq = path.join(ROOT, "public", "site.html");
    if (!fs.existsSync(arq)) return enviar(res, 404, { erro: "o site nao foi montado" });
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    });
    return res.end(fs.readFileSync(arq));
  }

  /* O ACERVO: o que ela ja desenhou, mais novo primeiro. E a mesma pasta que
     o motor grava quando ela larga a prancheta. */
  if (url.pathname === "/api/obras") {
    /* 1. o acervo LOCAL — a maquina que desenha tem as fichas em disco */
    let obras = [];
    try {
      obras = fs.readdirSync(ACERVO)
        .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(ACERVO, f), "utf8")); }
                      catch { return null; } })
        .filter((o) => o && o.arquivo && fs.existsSync(path.join(ACERVO, o.arquivo)));
    } catch { /* sem acervo aqui — normal no Railway */ }

    /* 2. o que ela PINTOU AO VIVO, vindo do espelho.
       So entra na vitrine o que aconteceu na frente de alguem: os arquivos das
       15 viajam no deploy (ela precisa deles pra reproduzir, e o NFT precisa da
       imagem existindo), mas a store nao e catalogo de estoque. */
    try {
      const feitas = (estadoDeCasa?.estado?.agents?.yuna?.obrasFeitas) || [];
      const jaTem = new Set(obras.map((o) => o.arquivo));
      for (const f of feitas) {
        if (!f || !f.arquivo || jaTem.has(f.arquivo)) continue;
        const img = path.join(GRAVACOES, f.arquivo);
        if (fs.existsSync(img)) obras.push(f);
      }
    } catch { /* sem espelho: mostra so o acervo local */ }

    obras.sort((a, b) => String(b.dia).localeCompare(String(a.dia)));
    return enviar(res, 200, { obras });
  }

  /* A IMAGEM da obra. Nome saneado: `/obras/../..` nao pode virar leitura de
     arquivo fora do acervo. */
  if (url.pathname.startsWith("/obras/")) {
    const nome = path.basename(decodeURIComponent(url.pathname.slice(7)));
    /* Procura no acervo (maquina que desenha) E no deploy (onde as 15 viajam).
       A ordem importa: o acervo tem a obra em resolucao cheia. */
    let arq = path.join(ACERVO, nome);
    if (!fs.existsSync(arq)) arq = path.join(GRAVACOES, nome);
    if (!nome.endsWith(".png") || !fs.existsSync(arq))
      return enviar(res, 404, { erro: "obra nao encontrada" });
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
    return res.end(fs.readFileSync(arq));
  }

  /* A TELA DO DESENHO — o player, servido pelo proprio site.
     `?obra=` escolhe qual gravacao reproduzir; sem isso, a primeira da fila. */
  if (url.pathname === "/desenho" || url.pathname === "/desenho.html") {
    const arq = path.join(ROOT, "public", "tela-desenho.html");
    if (!fs.existsSync(arq)) return enviar(res, 404, { erro: "o player nao foi empacotado" });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(arq));
  }

  /* OS TOQUES, por SSE. E o mesmo formato que o player do ateliê ja consome —
     a tela nao precisou mudar. Reproduzir nao exige GPU: exige ler e enviar. */
  if (url.pathname === "/eventos") {
    const td = await import("./lib/transmissao-desenho.js");
    const pedida = url.searchParams.get("obra");
    const lista = td.indice(ROOT);
    const nome = pedida || (lista[0] && lista[0].nome);
    const g = nome ? td.carregar(ROOT, nome) : null;
    if (!g) return enviar(res, 404, { erro: "sem gravacao pra reproduzir" });
    /* `desde` = quando ela sentou. E o que sincroniza todo mundo no mesmo
       ponto da obra, e o que faz o refresh nao voltar pro comeco. */
    return td.transmitir(res, g, { desde: url.searchParams.get("desde") });
  }

  /* `/papo` era o chat da tela do Gogh. Aqui ela conversa no quarto, nao no
     player — mas o EventSource do player pede mesmo assim, e um 404 faz ele
     reconectar pra sempre, martelando o servidor. Um stream aberto e vazio
     custa nada e cala a reconexao. */
  if (url.pathname === "/papo") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store", "x-accel-buffering": "no",
    });
    res.write(": sem papo aqui\n\n");
    const bat = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(bat); } }, 30000);
    req.on("close", () => clearInterval(bat));
    return;
  }

  /* O que existe pra reproduzir. */
  if (url.pathname === "/api/gravacoes") {
    const td = await import("./lib/transmissao-desenho.js");
    return enviar(res, 200, { gravacoes: td.indice(ROOT) });
  }

  /* O METADATA DO NFT. E o `uri` gravado dentro do asset, entao esta rota nao
     pode sumir nem mudar de formato: NFT ja mintado nao troca de endereco.
     Le a mesma ficha do acervo que a store usa — uma fonte so. */
  if (url.pathname.startsWith("/api/meta/")) {
    const id = path.basename(decodeURIComponent(url.pathname.slice(10)))
      .replace(/\.json$/i, "");
    const ficha = path.join(ACERVO, `${id}.json`);
    if (!fs.existsSync(ficha)) return enviar(res, 404, { erro: "obra nao encontrada" });
    try {
      const obra = JSON.parse(fs.readFileSync(ficha, "utf8"));
      const { metadataDe } = await import("./lib/nft.js");
      const base = (process.env.SITE_URL || `http://${req.headers.host}`).replace(/\/+$/, "");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8",
                           "cache-control": "public, max-age=300" });
      return res.end(JSON.stringify(metadataDe(obra, base), null, 2));
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 120) });
    }
  }

  /* O TOKEN dela, pro CA no topo do site. Vazio enquanto nao existir — CA em
     branco num site de token parece projeto abandonado, entao o site esconde. */
  if (url.pathname === "/api/token") {
    /* A carteira DELA, publica, pra quem quiser mandar apoio. Endereco publico
       de Solana nao e segredo — a chave privada e, e essa nunca sai do .env. */
    let carteira = null;
    try {
      const st = filho ? ultimoEstado : JSON.parse(fs.readFileSync(ESTADO, "utf8"));
      carteira = st?.agents?.yuna?.address || null;
    } catch { /* sem estado ainda */ }
    return enviar(res, 200, {
      mint: process.env.LIVE_CHAT_MINT || null,
      x: process.env.X_URL || null,
      carteira,
    });
  }

  // A TELA. E o que o OBS captura e o que o site embute num iframe.
  if (url.pathname === "/live") {
    if (!fs.existsSync(TELA)) return enviar(res, 404, { erro: "a tela ainda nao foi gerada" });
    /* NUNCA CACHEAR. A tela tem 3 MB e o navegador guardava a versao antiga:
       eu corrigia, mandava recarregar, e ele via exatamente a mesma coisa. */
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "pragma": "no-cache",
    });
    return res.end(fs.readFileSync(TELA));
  }

  // O ESTADO. O quarto le daqui pra saber onde ela esta e o que ela disse.
  // Sem filho de pe, a verdade e o disco: o palco nao pode mostrar um retrato
  // vivo de um motor que morreu.
  /* VERSAO DA TELA. O Michel ficava com a pagina antiga aberta enquanto eu
     corrigia bugs, e via defeito ja consertado — varias rodadas foram gastas
     assim. Aqui o servidor diz quando o HTML mudou; a propria tela se recarrega
     e ele nunca mais precisa lembrar de dar F5. */
  if (url.pathname === "/api/versao") {
    let carimbo = 0;
    try { carimbo = fs.statSync(TELA).mtimeMs; } catch { /* sem arquivo */ }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ versao: Math.round(carimbo) }));
  }

  /* O ESTADO VINDO DE CASA. Ver o comentario no topo: uma fonte so.
     Se chegou estado externo recente, ele MANDA — o motor de casa e a verdade,
     e o daqui (se existir) e secundario. */
  if (url.pathname === "/api/estado-externo" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const p of req) {
      corpo += p;
      if (corpo.length > 4e6) return enviar(res, 413, { erro: "estado grande demais" });
    }
    try {
      const j = JSON.parse(corpo);
      if (!j || typeof j !== "object") throw new Error("nao e objeto");
      estadoDeCasa = { estado: j.state ?? j, running: !!j.running, t: Date.now() };
      return enviar(res, 200, { ok: true });
    } catch (e) {
      return enviar(res, 400, { erro: String(e.message).slice(0, 100) });
    }
  }

  if (url.pathname === "/api/state") {
    /* O QUE VEIO DE CASA VENCE, enquanto for recente. Dois minutos de validade:
       se a maquina de casa cair, o site nao pode ficar mostrando para sempre um
       retrato de ela trabalhando. */
    if (estadoDeCasa && Date.now() - estadoDeCasa.t < 120000)
      return enviar(res, 200, { running: estadoDeCasa.running, state: estadoDeCasa.estado, deCasa: true });
    let estado = filho ? ultimoEstado : null;
    if (!estado) {
      try { estado = JSON.parse(fs.readFileSync(ESTADO, "utf8")); } catch { estado = null; }
    }
    return enviar(res, 200, { running: !!filho, state: estado });
  }

  /* O LANCAMENTO. Marca a hora e a jornada passa a contar dali: 16 acordada,
     8 dormindo, a partir deste instante. Precisa reiniciar o motor pra valer
     (a marca e lida no boot) — a resposta diz isso. */
  if (url.pathname === "/api/lancar" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    /* GRAVA NO VOLUME, nao num .env. (01/09/2026)
       Antes escrevia em /app/.env.yuna: arquivo que NAO existe no Railway (o
       .gitignore o exclui), entao a rota devolvia 500 e nada era marcado. E se
       existisse seria pior — /app nao e o volume, e o restart que a propria
       resposta mandava dar apagaria a marca. Aqui sobrevive a deploy, e o
       motor le a cada ciclo: nao precisa mais reiniciar. */
    const quando = new Date().toISOString();
    const arq = process.env.LANCAMENTO_FILE || path.join(ROOT, "src", "data", "lancamento.json");
    try {
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify({ showStart: quando }, null, 2));
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 160) });
    }
    console.log(`[lancamento] a jornada dela comeca em ${quando}`);
    return enviar(res, 200, {
      ok: true, showStart: quando,
      proximo: "ja vale — o motor pega no proximo ciclo, sem reiniciar",
    });
  }

  /* O RITMO, ao vivo. `POST /api/ritmo {"tickSeconds":45}` — o motor le no
     proximo ciclo e muda sem reiniciar. Reiniciar no meio da live congelaria a
     tela na frente de quem esta assistindo.
     `{"tickSeconds":null}` devolve o controle pro automatico (estreia rapida,
     depois o ritmo do .env). */
  if (url.pathname === "/api/ritmo" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const p of req) { corpo += p; if (corpo.length > 4000) break; }
    let s = null;
    try { s = JSON.parse(corpo || "{}").tickSeconds; } catch { /* corpo torto */ }
    const arq = path.join(ROOT, "src", "data", "ritmo.json");
    try {
      if (s === null || s === undefined || s === "") {
        try { fs.unlinkSync(arq); } catch {}
        return enviar(res, 200, { ok: true, ritmo: "automatico" });
      }
      const n = Number(s);
      if (!Number.isFinite(n) || n < 5 || n > 600)
        return enviar(res, 400, { erro: "tickSeconds tem que ser entre 5 e 600" });
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify({ tickSeconds: n, quando: Date.now() }, null, 2));
      return enviar(res, 200, { ok: true, tickSeconds: n, vale: "no proximo ciclo, sem restart" });
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 120) });
    }
  }

  /* ESTAS TRES ESTAVAM ABERTAS. (01/09/2026)
     `curl -X POST https://yuna.cam/api/desligar` de qualquer pessoa que
     descobrisse o dominio matava a live — e como nada supervisiona o motor, ele
     nao voltaria sozinho: a tela congelaria no ultimo retrato dela e pareceria
     uma cena parada, nao um show derrubado. O /api/log ainda entregava o log
     interno de graca. */
  if (url.pathname === "/api/ligar" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    return enviar(res, 200, ligar());
  }
  if (url.pathname === "/api/desligar" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    return enviar(res, 200, desligar());
  }
  if (url.pathname === "/api/log") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    return enviar(res, 200, { log: log.slice(-120) });
  }

  /* O EDITOR DA TELA. O Michel marca na mao onde e de que tamanho o quarto
     fica na live — eu parei de adivinhar escala depois de errar varias vezes.
     O que ele salvar cai num JSON que eu leio e aplico igual. */
  if (url.pathname === "/editor") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    return res.end(fs.readFileSync(path.join(ROOT, "public", "editor-tela.html")));
  }
  if (url.pathname === "/api/tela" && req.method === "POST") {
    let corpo = "";
    req.on("data", (p) => { corpo += p; if (corpo.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const dado = JSON.parse(corpo || "{}");
        const arq = path.join(ROOT, "src", "data", "tela-live.json");
        fs.mkdirSync(path.dirname(arq), { recursive: true });
        fs.writeFileSync(arq, JSON.stringify(dado, null, 2));
        console.log("[tela] marcacao salva:", JSON.stringify(dado));
        enviar(res, 200, { ok: true, arquivo: arq });
      } catch (e) { enviar(res, 400, { erro: String(e && e.message || e) }); }
    });
    return;
  }

  /* A ENERGIA DA CASA. (01/09/2026, no dia do lancamento)
     Quando a treasury zera o motor entra em coma — "nobody here thinks" — e o
     show para. O canal de recarga existia no motor desde sempre
     (processTreasuryTopups le treasury-topups.json a cada ciclo), mas NENHUMA
     rota escrevia nesse arquivo: no Railway nao havia como recarregar, e o
     show morreria sem volta.

     POST /api/energia {"usd": 100, "nota": "recarga"} — vale no proximo turno.
     GET  /api/energia — quanto resta e por quanto tempo. */
  if (url.pathname === "/api/energia" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const p of req) { corpo += p; if (corpo.length > 4000) break; }
    let dado = {};
    try { dado = JSON.parse(corpo || "{}"); } catch { return enviar(res, 400, { erro: "corpo torto" }); }
    const usd = Number(dado.usd);
    if (!Number.isFinite(usd) || usd <= 0 || usd > 5000)
      return enviar(res, 400, { erro: "usd tem que ser entre 0 e 5000" });
    const arq = process.env.TREASURY_TOPUPS_FILE || path.join(ROOT, "src", "data", "treasury-topups.json");
    try {
      let topups = [];
      try { topups = JSON.parse(fs.readFileSync(arq, "utf8"))?.topups ?? []; } catch { /* primeiro uso */ }
      /* Id unico: o motor deduplica por ele (state.topupsSeen), senao um
         restart creditaria a mesma recarga de novo. */
      const id = `t${Date.now().toString(36)}${topups.length.toString(36)}`;
      topups.push({ id, usd, quando: Date.now(), ...(dado.nota ? { note: String(dado.nota).slice(0, 120) } : {}) });
      if (topups.length > 200) topups = topups.slice(-100);
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify({ topups }, null, 2));
      console.log(`[energia] +$${usd} na treasury`);
      return enviar(res, 200, { ok: true, id, usd, vale: "no proximo turno dela" });
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 160) });
    }
  }

  if (url.pathname === "/api/energia") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    const e = (ultimoEstado || estadoDeCasa?.estado || {});
    return enviar(res, 200, {
      treasury: e.treasury ?? null,
      gastoReal: e.spentReal ?? null,
      queimaPorHora: e.burnPerHour ?? null,
      horasRestantes: e.runwayHours ?? null,
    });
  }

  /* ===================== AJUSTE AO VIVO =====================
     Mexer num numero SEM reiniciar o show. No Railway, mudar uma variavel no
     painel reinicia o servico — e reiniciar no meio da live congela a tela de
     quem esta assistindo. Isto escreve num arquivo do volume que o motor le no
     ciclo seguinte, mesmo padrao do /api/ritmo.

     GET devolve o que esta valendo e a lista do que da pra mexer.
     POST {"MAX_REAL_TRADE_USD":"1"} muda; {"MAX_REAL_TRADE_USD":null} devolve
     ao valor do ambiente. */
  if (url.pathname === "/api/ajustes" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const p of req) { corpo += p; if (corpo.length > 8000) break; }
    let dado = {};
    try { dado = JSON.parse(corpo || "{}"); } catch { return enviar(res, 400, { erro: "corpo torto" }); }

    const arq = process.env.AJUSTES_FILE || path.join(ROOT, "src", "data", "ajustes.json");
    try {
      const { AJUSTAVEIS } = await import("./engine.js");
      let atual = {};
      try { atual = JSON.parse(fs.readFileSync(arq, "utf8")); } catch { /* primeiro uso */ }

      /* RECUSA O QUE NAO ADIANTA. Aceitar uma chave que o motor so le no boot
         seria pior que recusar: o Michel mexeria, nada mudaria, e ele passaria
         o show achando que mudou. */
      const fora = Object.keys(dado).filter((k) => !AJUSTAVEIS.includes(k));
      if (fora.length)
        return enviar(res, 400, {
          erro: `estas so mudam reiniciando: ${fora.join(", ")}`,
          ajustaveis: AJUSTAVEIS,
        });

      const mudou = [];
      for (const [k, v] of Object.entries(dado)) {
        if (v === null || v === "") { delete atual[k]; mudou.push(`${k}: de volta ao ambiente`); }
        else { atual[k] = String(v); mudou.push(`${k}=${v}`); }
      }
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify(atual, null, 2));
      console.log(`[ajustes] ${mudou.join(" · ")}`);
      return enviar(res, 200, { ok: true, mudou, valendo: atual, quando: "no proximo turno dela, sem restart" });
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 160) });
    }
  }

  if (url.pathname === "/api/ajustes") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    const arq = process.env.AJUSTES_FILE || path.join(ROOT, "src", "data", "ajustes.json");
    let valendo = {};
    try { valendo = JSON.parse(fs.readFileSync(arq, "utf8")); } catch { /* nenhum ajuste */ }
    let ajustaveis = [];
    try { ({ AJUSTAVEIS: ajustaveis } = await import("./engine.js")); } catch { /* motor nao carregou */ }
    return enviar(res, 200, {
      valendo,
      ajustaveis,
      nota: "estas valem no proximo turno, sem restart. O resto exige reiniciar o servico.",
    });
  }

  /* A VIDA DELA, EM UM ARQUIVO. (01/09/2026)
     Tudo que ela viveu mora num volume do Railway e em mais lugar nenhum —
     nem no git (src/data/ e ignorado, com razao: tem chave por perto). Um
     clique errado no painel e a memoria, a persona, as licoes e o arquivo
     inteiro do que ela disse somem pra sempre.

     Isto entrega tudo isso num JSON. `node scripts/salvar-vida.js` guarda com
     a data no nome. Rodar de vez em quando e a unica coisa que protege o que
     ela e — a conta de API so decide se ela esta acordada. */
  if (url.pathname === "/api/vida") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });

    const dataDir = path.join(ROOT, "src", "data");
    const ler = (p, json = false) => {
      try {
        const t = fs.readFileSync(p, "utf8");
        return json ? JSON.parse(t) : t;
      } catch { return null; }
    };

    const vida = { tirada: new Date().toISOString(), agente: "yuna" };

    /* Quem ela e agora, e todas as que ela ja foi. A pasta history/ guarda o
       texto anterior E o motivo de cada mudanca — e o registro dela virando
       outra pessoa, que e a coisa mais insubstituivel aqui dentro. */
    vida.persona = ler(path.join(dataDir, "agents", "yuna.md"));
    vida.versoes = [];
    try {
      const h = path.join(dataDir, "agents", "history");
      for (const f of fs.readdirSync(h).sort()) {
        vida.versoes.push({ arquivo: f, conteudo: ler(path.join(h, f)) });
      }
    } catch { /* nunca se reescreveu ainda */ }

    /* A memoria de verdade: carteira, licoes, metas, sonhos, posicoes, fila
       do X, tudo que sobrevive a um restart. */
    vida.checkpoint = ler(process.env.CHECKPOINT_FILE || path.join(dataDir, "checkpoint-yuna.json"), true);

    /* Tudo que ela disse, desde sempre. E o maior e o mais barato de perder. */
    const arq = ler(process.env.ARCHIVE_FILE || path.join(dataDir, "archive.jsonl"));
    vida.arquivo = arq ? arq.split(/\r?\n/).filter(Boolean) : [];

    /* NENHUMA CHAVE SAI DAQUI. O checkpoint nao guarda chave (a carteira vem
       do ambiente), mas conferir e barato e um backup que vaza chave e pior
       que backup nenhum. */
    const texto = JSON.stringify(vida);
    if (/sk-ant-|bb_[a-z]+_[A-Za-z0-9]{20,}|\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,[\s\S]{200,}\]/.test(texto)) {
      return enviar(res, 500, { erro: "abortei: achei algo com cara de chave na copia" });
    }

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="yuna-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(texto);
  }

  /* O QUE ELA PEDIU. (01/09/2026)
     Ela sabe que a lista de acoes dela e finita e escrita por outra pessoa.
     `ask` e o que ela faz com isso: nomeia o que falta e argumenta. Aqui o
     Michel responde — constroi ou diz por que nao. As duas voltam pra ela.

     GET  /api/pedidos           o que esta aberto e o que ja foi respondido
     POST {pedido, aceito, porque}   a resposta */
  if (url.pathname === "/api/pedidos" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const p of req) { corpo += p; if (corpo.length > 8000) break; }
    let d = {};
    try { d = JSON.parse(corpo || "{}"); } catch { return enviar(res, 400, { erro: "corpo torto" }); }
    if (!String(d.pedido || "").trim()) return enviar(res, 400, { erro: "falta o id do pedido" });
    if (typeof d.aceito !== "boolean") return enviar(res, 400, { erro: "aceito tem que ser true ou false" });
    /* RECUSA PRECISA DE MOTIVO. Um "nao" sem porque ensina que pedir nao
       adianta; um "nao, porque X" ensina o formato do que vale pedir. */
    if (!d.aceito && !String(d.porque || "").trim())
      return enviar(res, 400, { erro: "recusa precisa de motivo — ela le" });

    const arq = process.env.X_ACOES_FILE || path.join(ROOT, "src", "data", "x-acoes.json");
    try {
      let acoes = [];
      try { acoes = JSON.parse(fs.readFileSync(arq, "utf8"))?.acoes ?? []; } catch {}
      const id = `r${Date.now().toString(36)}${acoes.length.toString(36)}`;
      acoes.push({ id, tipo: "responder", quando: Date.now(),
        pedido: String(d.pedido).slice(0, 40), aceito: !!d.aceito,
        ...(d.porque ? { porque: String(d.porque).slice(0, 400) } : {}) });
      if (acoes.length > 300) acoes = acoes.slice(-150);
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify({ acoes }, null, 2));
      console.log(`[pedido] ${d.aceito ? "aceito" : "recusado"}: ${d.pedido}`);
      return enviar(res, 200, { ok: true, vale: "no proximo turno dela" });
    } catch (e) { return enviar(res, 500, { erro: String(e.message).slice(0, 160) }); }
  }

  if (url.pathname === "/api/pedidos") {
    const chk = process.env.CHECKPOINT_FILE || path.join(ROOT, "src", "data", "checkpoint-yuna.json");
    let pedidos = [];
    try { pedidos = JSON.parse(fs.readFileSync(chk, "utf8"))?.pedidos ?? []; } catch {}
    const tok = req.headers["x-admin-token"];
    const dono = process.env.ADMIN_TOKEN && tok === process.env.ADMIN_TOKEN;
    /* PUBLICO DE PROPOSITO, e so o que ja foi respondido: a lista do que ela
       pediu e do que foi recusado (com o motivo) e a parte mais incomum deste
       show. O que ainda esta aberto so o dono ve — senao a resposta dele vira
       enquete. */
    return enviar(res, 200, {
      respondidos: pedidos.filter((q) => q.estado !== "aberto")
        .sort((a, b) => b.t - a.t).slice(0, 60),
      ...(dono ? { abertos: pedidos.filter((q) => q.estado === "aberto").sort((a, b) => b.t - a.t) } : {}),
    });
  }

  /* ===================== O PAINEL DO X =====================
     O X barrou o login automatizado (deteccao de navegador, nao de conta nem
     de IP — o Michel confirmou deslogando do Chrome dele e religando). Entao
     ela escreve e ele publica.

     ORDEM IMPORTA: o metodo e checado, e o POST vem antes do GET, porque 16
     das 22 rotas deste arquivo nao olham req.method e um GET solto engoliria
     o POST. E tudo isto tem que ficar acima do coringa estatico. */

  /* O QUE O MICHEL FEZ. Escreve num arquivo proprio, que o motor le no ciclo
     seguinte — o servidor NUNCA escreve no checkpoint (um escritor por
     arquivo; o motor reescreve o checkpoint inteiro a cada ~700ms e apagaria
     qualquer marca posta por fora). */
  if (url.pathname === "/api/x" && req.method === "POST") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    let corpo = "";
    for await (const pedaco of req) { corpo += pedaco; if (corpo.length > 20000) break; }
    let dado = {};
    try { dado = JSON.parse(corpo || "{}"); } catch { return enviar(res, 400, { erro: "corpo torto" }); }

    const tipo = String(dado.tipo || "");
    if (!["postei", "descartar", "comentario", "restaurar"].includes(tipo))
      return enviar(res, 400, { erro: "tipo tem que ser postei, descartar, comentario ou restaurar" });
    if (tipo === "comentario" && !String(dado.texto || "").trim())
      return enviar(res, 400, { erro: "comentario vazio" });
    if (tipo !== "comentario" && !String(dado.post || "").trim())
      return enviar(res, 400, { erro: "falta o id do post" });

    const arq = process.env.X_ACOES_FILE || path.join(ROOT, "src", "data", "x-acoes.json");
    try {
      let acoes = [];
      try { acoes = JSON.parse(fs.readFileSync(arq, "utf8"))?.acoes ?? []; } catch { /* primeiro uso */ }
      /* ID unico: o motor deduplica por ele, senao todo restart reprocessaria
         a lista inteira e ela receberia os mesmos comentarios de novo. */
      const id = `x${Date.now().toString(36)}${acoes.length.toString(36)}`;
      acoes.push({
        id, tipo, quando: Date.now(),
        ...(dado.post ? { post: String(dado.post).slice(0, 40) } : {}),
        ...(dado.porque ? { porque: String(dado.porque).slice(0, 200) } : {}),
        ...(dado.de ? { de: String(dado.de).slice(0, 40) } : {}),
        ...(dado.texto ? { texto: String(dado.texto).slice(0, 500) } : {}),
      });
      /* Poda: o motor ja lembra o que aplicou (state.xVistas), entao a cauda
         deste arquivo nao serve pra nada alem de crescer. */
      if (acoes.length > 300) acoes = acoes.slice(-150);
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, JSON.stringify({ acoes }, null, 2));
      return enviar(res, 200, { ok: true, id, vale: "no proximo turno dela" });
    } catch (e) {
      return enviar(res, 500, { erro: String(e.message).slice(0, 120) });
    }
  }

  /* A FILA. Lida do CHECKPOINT, que e a fonte de verdade e mora no volume —
     o snapshot de apresentacao serve, mas some no restart. Servidor le, motor
     escreve. */
  if (url.pathname === "/api/x") {
    const tok = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || tok !== process.env.ADMIN_TOKEN)
      return enviar(res, 401, { erro: "token invalido" });
    const chk = process.env.CHECKPOINT_FILE || path.join(ROOT, "src", "data", "checkpoint-yuna.json");
    let posts = [], comentarios = [];
    try {
      const c = JSON.parse(fs.readFileSync(chk, "utf8"));
      posts = Array.isArray(c.posts) ? c.posts : [];
      comentarios = Array.isArray(c.xComentarios) ? c.xComentarios : [];
    } catch {
      /* Sem checkpoint (deploy novo, volume vazio) a fila esta vazia — nao e
         erro. Tenta o espelho de casa antes de desistir. */
      const esp = estadoDeCasa?.estado ?? null;
      if (esp) { posts = esp.posts ?? []; comentarios = esp.xComentarios ?? []; }
    }
    return enviar(res, 200, {
      pendentes: posts.filter((p) => !p.sent && !p.descartado).sort((a, b) => b.t - a.t),
      historico: posts.filter((p) => p.sent || p.descartado).sort((a, b) => b.t - a.t).slice(0, 40),
      comentarios: comentarios.slice(-20).reverse(),
      ligado: process.env.X_ENABLED === "1",
      conta: process.env.X_URL || "",
    });
  }

  /* A CASCA DO PAINEL. Sem dado dentro de proposito: o header do token nao
     existe quando o Michel digita a URL, entao a pagina pede o token e guarda
     no navegador dele. Os DADOS e que exigem o token, acima. */
  if (url.pathname === "/x") {
    const arq = path.join(ROOT, "public", "x.html");
    if (!fs.existsSync(arq)) return enviar(res, 404, { erro: "painel nao instalado" });
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    });
    return res.end(fs.readFileSync(arq));
  }

  // Arquivos soltos de public/ (imagens que a tela venha a pedir).
  const alvo = path.join(ROOT, "public", url.pathname.replace(/^\/+/, ""));
  if (alvo.startsWith(path.join(ROOT, "public")) && fs.existsSync(alvo) && fs.statSync(alvo).isFile()) {
    const tipo = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                   ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
                   ".ico": "image/x-icon", ".svg": "image/svg+xml", ".webp": "image/webp",
                   ".woff2": "font/woff2" }[path.extname(alvo)];
    /* charset so em texto: numa imagem e ruido, e em .ico chega a atrapalhar. */
    const texto = /^(text\/|application\/(json|javascript)|image\/svg)/.test(tipo || "");
    res.writeHead(200, {
      "content-type": (tipo || "application/octet-stream") + (texto ? "; charset=utf-8" : ""),
    });
    return res.end(fs.readFileSync(alvo));
  }

  enviar(res, 404, { erro: "nao existe aqui" });
});

servidor.listen(PORTA, () => {
  console.log(`
  YUNA`);
  console.log(`  tela:   http://localhost:${PORTA}/live`);
  console.log(`  estado: http://localhost:${PORTA}/api/state`);
  console.log(`  ligar o motor:    curl -X POST http://localhost:${PORTA}/api/ligar`);
  console.log(`  desligar:         curl -X POST http://localhost:${PORTA}/api/desligar\n`);
  if (process.env.AUTOSTART === "1") ligar();
});

// Fechar o servidor sem levar o motor junto deixaria o engine gastando sozinho.
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => { try { desligar(); } catch { /* ja morreu */ } process.exit(0); });
}
