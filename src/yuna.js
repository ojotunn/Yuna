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
    let obras = [];
    try {
      obras = fs.readdirSync(ACERVO)
        .filter((f) => f.endsWith(".json"))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(ACERVO, f), "utf8")); }
                      catch { return null; } })
        .filter((o) => o && o.arquivo && fs.existsSync(path.join(ACERVO, o.arquivo)))
        .sort((a, b) => String(b.dia).localeCompare(String(a.dia)));
    } catch { /* sem acervo ainda */ }
    return enviar(res, 200, { obras });
  }

  /* A IMAGEM da obra. Nome saneado: `/obras/../..` nao pode virar leitura de
     arquivo fora do acervo. */
  if (url.pathname.startsWith("/obras/")) {
    const nome = path.basename(decodeURIComponent(url.pathname.slice(7)));
    const arq = path.join(ACERVO, nome);
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

  if (url.pathname === "/api/ligar" && req.method === "POST") return enviar(res, 200, ligar());
  if (url.pathname === "/api/desligar" && req.method === "POST") return enviar(res, 200, desligar());
  if (url.pathname === "/api/log") return enviar(res, 200, { log: log.slice(-120) });

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

  // Arquivos soltos de public/ (imagens que a tela venha a pedir).
  const alvo = path.join(ROOT, "public", url.pathname.replace(/^\/+/, ""));
  if (alvo.startsWith(path.join(ROOT, "public")) && fs.existsSync(alvo) && fs.statSync(alvo).isFile()) {
    const tipo = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                   ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" }[path.extname(alvo)];
    res.writeHead(200, { "content-type": (tipo || "application/octet-stream") + "; charset=utf-8" });
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
