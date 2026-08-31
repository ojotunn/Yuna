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

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // A TELA. E o que o OBS captura e o que qualquer um que abrir o site ve.
  if (url.pathname === "/" || url.pathname === "/live") {
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

  if (url.pathname === "/api/state") {
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
