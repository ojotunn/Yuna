// ============================================================================
// Navegador de verdade. Chromium via Puppeteer.
//
// Motivo de existir: fetch cru nao e como gente navega. Site moderno renderiza
// com JavaScript, e CDN devolve {"error":"not found"} para qualquer coisa que
// nao pareca navegador. Aqui o agente ve a MESMA pagina que o Michel veria no
// Chrome dele — e o palco tira screenshot disso para o espectador conferir.
//
// UM NAVEGADOR POR AGENTE, com perfil em disco. Nao e capricho: cada agente tem
// a propria carteira, entao sao identidades diferentes na mesma internet. Um
// Chromium compartilhado significa um cookie jar compartilhado — logar a Sable
// logaria o Rook como a mesma pessoa, e o segundo login sobrescreveria o
// primeiro. O perfil em disco tambem faz a sessao sobreviver a um restart.
//
// O navegador ANONIMO (sem perfil) continua existindo para leitura avulsa
// (`readPage`, `searchPage`): sem identidade, sem rastro, e mais barato.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILES = path.join(ROOT, "src", "data", "profiles");

const SHARED = "__anon__"; // chave do navegador sem identidade
const browsers = new Map(); // chave -> Browser
const launching = new Map(); // chave -> Promise<Browser>

// ------------------------------- Browserbase ---------------------------------
// Navegadores REMOTOS (Chromium num datacenter dos EUA): IP americano de
// verdade, menos parede de anti-bot, e a maquina do Michel livre dos Chromium.
// LIGA quando as duas chaves existem no .env; sem elas (ou se a API deles
// falhar) cai SEMPRE no Chromium local — o show nunca para por causa disso.
//
// Identidade: cada agente ganha um "context" persistente (id guardado em
// src/data/browserbase-contexts.json) — cookies/sessoes sobrevivem entre
// sessoes remotas, o papel que o userDataDir cumpre no local. O navegador
// anonimo nao persiste nada, igual ao local.

const BB_API = "https://api.browserbase.com/v1";
const CTX_FILE = path.join(ROOT, "src", "data", "browserbase-contexts.json");
const bbEnabled = () =>
  !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);

async function bbFetch(pathname, body) {
  const r = await fetch(`${BB_API}${pathname}`, {
    method: "POST",
    headers: {
      "x-bb-api-key": process.env.BROWSERBASE_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`browserbase ${pathname}: HTTP ${r.status} ${detail}`.slice(0, 240));
  }
  return r.json();
}

function loadCtxIds() {
  try { return JSON.parse(fs.readFileSync(CTX_FILE, "utf8")); } catch { return {}; }
}
function saveCtxIds(map) {
  try {
    fs.mkdirSync(path.dirname(CTX_FILE), { recursive: true });
    fs.writeFileSync(CTX_FILE, JSON.stringify(map, null, 2));
  } catch { /* sem disco, contexto novo na proxima — só perde login */ }
}

// Nome da variavel que crava o context de um agente: BROWSERBASE_CTX_SABLE etc.
const ctxEnvKey = (key) => `BROWSERBASE_CTX_${String(key).toUpperCase()}`;

async function bbContextId(key) {
  if (key === SHARED) return null; // leitura avulsa nao persiste identidade
  // CONTEXT CRAVADO POR VARIAVEL (13/08/2026). O id vinha so do arquivo em
  // src/data — que no Railway nasce vazio, entao o servidor criava um context
  // NOVO e o login feito aqui nunca chegava la. Com a variavel, a mesma
  // identidade (e os mesmos cookies) valem nas duas pontas: loga uma vez, de
  // onde for, e o navegador remoto sobe logado em qualquer lugar.
  const cravado = String(process.env[ctxEnvKey(key)] ?? "").trim();
  if (cravado) return cravado;
  const ids = loadCtxIds();
  if (ids[key]) return ids[key];
  const ctx = await bbFetch("/contexts", { projectId: process.env.BROWSERBASE_PROJECT_ID });
  ids[key] = ctx.id;
  saveCtxIds(ids);
  return ctx.id;
}

// Sessao remota por chave + a URL de LIVE VIEW dela (o navegador transmitido
// ao vivo, que o palco embute — e o "assistir navegar em tempo real" do
// claudius). Cache sincrono: publish() le sem await.
const bbSessions = new Map(); // key -> { id, liveUrl }

async function bbLaunch(key) {
  const ctxId = await bbContextId(key);
  const session = await bbFetch("/sessions", {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    ...(ctxId ? { browserSettings: { context: { id: ctxId, persist: true } } } : {}),
    /* PROXY RESIDENCIAL, so quando pedido. Ver o comentario no topo: o X barra
       login vindo de datacenter. Custa por GB, entao nao vale ligar pra tudo —
       a pump nunca reclamou. `BROWSERBASE_PROXY=1` liga. */
    ...(process.env.BROWSERBASE_PROXY === "1" ? {
      proxies: [{
        type: "browserbase",
        geolocation: { country: process.env.BROWSERBASE_PROXY_PAIS || "US" },
      }],
    } : {}),
    /* Regiao: ver o comentario no topo do arquivo. Vazio = deixa o Browserbase
       escolher (us-west-2), que do Brasil e a rota mais longa. */
    ...(process.env.BROWSERBASE_REGION ? { region: process.env.BROWSERBASE_REGION } : {}),
  });
  const ws = session.connectUrl ??
    `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${session.id}`;
  const browser = await puppeteer.connect({ browserWSEndpoint: ws });
  bbSessions.set(key, { id: session.id, liveUrl: null });
  // Busca a URL do live view ja na criacao (uma chamada por sessao). Falhar
  // aqui nao derruba nada — o palco cai no screenshot.
  try {
    const r = await fetch(`${BB_API}/sessions/${session.id}/debug`, {
      headers: { "x-bb-api-key": process.env.BROWSERBASE_API_KEY },
    });
    if (r.ok) {
      const j = await r.json();
      const s = bbSessions.get(key);
      if (s) s.liveUrl = j.debuggerFullscreenUrl ?? j.debuggerUrl ?? null;
    }
  } catch { /* sem live view, com screenshot */ }
  return browser;
}

// O id do context em uso por este agente — e ele que carrega o login entre
// sessoes remotas. Serve ao `scripts/login-remoto.js`, que precisa dizer qual
// valor cravar no Railway depois que a pessoa logou.
export function contextIdFor(key) {
  return String(process.env[ctxEnvKey(key)] ?? "").trim() || loadCtxIds()[key] || null;
}

// URL de live view da sessao ATIVA desta chave (null = sem live: local, sessao
// morta ou dormindo). Sincrono de proposito — publish() chama a cada snapshot.
export function liveViewFor(key) {
  const b = browsers.get(key);
  if (!b || !b.connected) return null;
  return bbSessions.get(key)?.liveUrl ?? null;
}

/* A SESSAO DO BROWSERBASE MORRE SOZINHA (ociosidade, tempo, queda de rede) e o
   link do live view continua apontando pro cadaver: o painel na tela mostra
   "Debugging connection was closed. WebSocket disconnected". Foi o que o Michel
   viu. Aqui a gente confere se o navegador ainda responde e, se nao, derruba a
   sessao pra proxima chamada abrir uma nova — mesmo context, mesmo login. */
export async function navegadorVivo(id) {
  const b = browsers.get(id);
  if (!b || !b.connected) return false;
  try {
    const page = agentPages.get(id);
    if (page && !page.isClosed()) { await page.title(); return true; }
    await b.version();
    return true;
  } catch {
    return false;
  }
}

export async function religarSeMorto(id) {
  if (await navegadorVivo(id)) return false;
  try { await browsers.get(id)?.disconnect?.(); } catch { /* ja morto */ }
  browsers.delete(id);
  agentPages.delete(id);
  identityPages.delete(id);
  bbSessions.delete(id);
  return true;                 // a proxima chamada abre uma sessao nova
}

// Mira o live view NA ABA DO AGENTE. O link da sessao aponta pro primeiro alvo
// (aba em branco) — dava tela branca no palco. O /debug lista as paginas; a
// gente casa pela URL atual da aba e guarda o link DAQUELA pagina. O id da
// pagina e estavel entre navegacoes da mesma aba, entao o iframe nao remonta.
/* PUBLICA de proposito: o link do live view aponta pra UMA PAGINA, e quando a
   aba navega por fora do `openPage` (o explore, a pagina da moeda, o raio-x)
   ninguem reapontava. O painel na tela ficava em `about:blank` enquanto ela
   trabalhava — o Michel via um retangulo branco no lugar do trabalho dela. */
export async function updateLiveView(key) {
  if (!bbEnabled()) return;
  const s = bbSessions.get(key);
  const page = agentPages.get(key);
  if (!s || !page || page.isClosed()) return;
  const atual = page.url();
  try {
    const r = await fetch(`${BB_API}/sessions/${s.id}/debug`, {
      headers: { "x-bb-api-key": process.env.BROWSERBASE_API_KEY },
    });
    if (!r.ok) return;
    const j = await r.json();
    const pages = j.pages ?? [];
    // 1) a aba com a URL exata do agente; 2) QUALQUER aba que nao seja a
    // about:blank inicial. O passo 2 e o que salva: a URL do Puppeteer e a do
    // /debug divergem por um instante durante a navegacao, e antes disso a
    // falha era permanente — o link ficava preso na aba em branco (tela PRETA)
    // porque o fallback so agia quando ainda nao havia link nenhum.
    const hit = pages.find((p) => p.url === atual)
      ?? pages.find((p) => p.url && p.url !== "about:blank");
    if (hit?.debuggerFullscreenUrl) s.liveUrl = hit.debuggerFullscreenUrl;
    else if (!s.liveUrl) s.liveUrl = j.debuggerFullscreenUrl ?? null;
  } catch { /* live view e cosmetico — nunca derruba a acao */ }
}

function profileDir(key) {
  return path.join(PROFILES, key.replace(/[^a-z0-9_-]/gi, "_"));
}

// O stop do painel mata a arvore com `taskkill /T /F`. Isso deixa o perfil
// marcado como "Crashed" e um SingletonLock pendurado — o proximo launch ou
// recusa, ou abre a barra de "restaurar paginas". Limpar antes de subir.
function sanitizeProfile(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
    const prefs = path.join(dir, "Default", "Preferences");
    if (fs.existsSync(prefs)) {
      const j = JSON.parse(fs.readFileSync(prefs, "utf8"));
      if (j?.profile?.exit_type && j.profile.exit_type !== "Normal") {
        j.profile.exit_type = "Normal";
        j.profile.exited_cleanly = true;
        fs.writeFileSync(prefs, JSON.stringify(j));
      }
    }
  } catch { /* perfil novo ou Preferences ilegivel: seguir e deixar o Chromium decidir */ }
}

function launchOptions(key) {
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    // Tira o sinal mais obvio de automacao. Nao e disfarce: e nao carregar
    // uma bandeira que faz CDN tratar o agente como ataque.
    "--disable-blink-features=AutomationControlled",
    // Os agentes vivem em INGLES (publico-alvo e anglofono): a maquina do
    // Michel e pt-BR e sem isto sites e desafios de verificacao vinham em
    // portugues no palco. Define UI do Chromium e navigator.language.
    "--lang=en-US",
  ];

  // Perfil de identidade: janela de verdade (headless leva desafio de CDN com
  // muito mais frequencia), posicionada fora da area visivel do monitor —
  // decisao do Michel: autonomo, e sem janela na cara dele.
  const headful = key !== SHARED && process.env.BROWSER_HEADLESS !== "1";
  if (headful) args.push("--window-position=-32000,-32000", "--window-size=1280,900");

  return {
    headless: !headful,
    args,
    ...(key === SHARED ? {} : { userDataDir: profileDir(key) }),
  };
}

// Uma instancia por chave, ligada sob demanda. Se o Chromium (ou a sessao
// remota) morrer, religa — com Browserbase, sessao nova + mesmo context.
async function getBrowser(key = SHARED) {
  const cur = browsers.get(key);
  if (cur && cur.connected) return cur;
  if (!launching.has(key)) {
    const boot = async () => {
      if (bbEnabled()) {
        try {
          return await bbLaunch(key);
        } catch (e) {
          // Browserbase fora do ar nao pode parar o show: cai pro local e avisa.
          console.error(`[browser] browserbase falhou (${String(e.message).slice(0, 160)}) — usando Chromium local`);
        }
      }
      if (key !== SHARED) sanitizeProfile(profileDir(key));
      return puppeteer.launch(launchOptions(key));
    };
    const p = boot()
      .then((b) => {
        browsers.set(key, b);
        launching.delete(key);
        return b;
      })
      .catch((e) => {
        launching.delete(key);
        // Erro tipico: outro engine ja rodando com o mesmo perfil.
        if (/ProcessSingleton|SingletonLock|profile/i.test(String(e.message))) {
          throw new Error(
            `perfil "${key}" ja esta em uso — ha outro engine rodando? (${e.message})`
          );
        }
        throw e;
      });
    launching.set(key, p);
  }
  return launching.get(key);
}

async function newPage(key = SHARED) {
  const b = await getBrowser(key);
  const page = await b.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // O UA do Chromium headless anuncia "HeadlessChrome" — troca pelo normal,
  // senao metade dos sites trata como bot e volta o problema que viemos resolver.
  const ua = (await b.userAgent()).replace("HeadlessChrome", "Chrome");
  await page.setUserAgent(ua);
  // en-US de verdade: o Accept-Language e o sinal que a maioria dos sites usa
  // pra escolher o idioma (a flag --lang sozinha nao muda o header), e o fuso
  // americano reforca o sinal "EUA" pra quem geolocaliza pelo relogio.
  // Ressalva: o IP continua brasileiro — site teimoso que geolocaliza por IP
  // (ex.: Google) ainda pode servir pt; a cura completa e proxy/hospedagem nos
  // EUA, decisao de launch.
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.emulateTimezone("America/New_York").catch(() => {});
  // Um `alert`/`confirm` trava o renderer inteiro e o Puppeteer NAO dispensa
  // sozinho — todo `evaluate` seguinte estoura em timeout. Ja custou um debug.
  page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  return page;
}

/* O BANNER DE COOKIES, DISPENSADO SOZINHO.
   A pump.fun (e meio mundo) abre com "We value your privacy" por cima de tudo:
   o banner engole o clique em "Sign in", e o login remoto simplesmente nao
   acontecia — foi isso que travou a Yuna, nao o Browserbase. Deixar o agente
   resolver isso clicando custa turno e credito toda vez que ele abre um site.

   Escolha: sempre a opcao que preserva mais privacidade — "reject all",
   "only necessary", "decline". Se o banner so oferece ACEITAR, eu nao aceito
   nada em nome dela: devolve `false` e quem chamou decide. */
const RECUSAR = [
  /^\s*reject all\s*$/i, /^\s*reject/i, /only necessary/i, /^\s*decline/i,
  /necessary (cookies )?only/i, /^\s*recusar/i, /rejeitar tudo/i, /essential only/i,
];

export async function dispensarConsentimento(page) {
  try {
    const alvo = await page.evaluate((fontes) => {
      const pats = fontes.map((f) => new RegExp(f.fonte, f.flags));
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 24 && r.height > 12 && r.top < innerHeight + 200;
      };
      const bts = [...document.querySelectorAll("button,a[role=button],div[role=button],[class*=consent] button")]
        .filter(vis);
      for (const b of bts) {
        const t = (b.textContent || "").trim();
        if (t.length < 40 && pats.some((p) => p.test(t))) {
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: t };
        }
      }
      return null;
    }, RECUSAR.map((r) => ({ fonte: r.source, flags: r.flags })));
    if (!alvo) return false;
    /* clique de MOUSE: em app React o handler costuma estar num pai, e um
       .click() sintetico no filho nao dispara nada. */
    await page.mouse.click(alvo.x, alvo.y);
    await new Promise((r) => setTimeout(r, 700));
    return alvo.texto;
  } catch { return false; }
}

/* SO FECHAR — nunca aceitar.
   Cada padrao aqui e uma forma de dizer "nao, obrigado" ou de fechar a janela.
   Nao ha um unico "accept"/"agree"/"continue" na lista, e nao deve haver: um
   modal que EXIGE aceitar termo fica na tela para o Michel decidir. */
const FECHAR = [
  /^[\s]*[x✕✖×⨯]\s*$/i, /^close$/i, /^dismiss$/i, /^no thanks$/i,
  /^not now$/i, /^maybe later$/i, /^skip$/i, /^later$/i,
];

/* Rotulos que NUNCA podem ser clicados por engano, mesmo que caiam perto de um
   padrao de fechar. Rede de seguranca explicita. */
const NUNCA = /accept|agree|continue|i'm ready|im ready|connect|approve|allow|sign|buy|sell|confirm/i;

export async function fecharPopups(page) {
  let fechou = [];
  try {
    /* 1. Esc primeiro: e o jeito universal, nao clica em nada e a maioria dos
          modais bem-feitos responde. */
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise((r) => setTimeout(r, 250));

    /* 2. Botao de fechar, no maximo 3 (um banner + um modal + folga). Mais que
          isso e sinal de que estou clicando em coisa que nao devia. */
    for (let i = 0; i < 3; i++) {
      const alvo = await page.evaluate((fontes, nunca) => {
        const pats = fontes.map((f) => new RegExp(f.fonte, f.flags));
        const proibido = new RegExp(nunca.fonte, nunca.flags);
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          if (r.width < 8 || r.height < 8 || r.width > 200 || r.height > 120) return false;
          const st = getComputedStyle(e);
          return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.1
                 && r.top >= -10 && r.top < innerHeight;
        };
        const cand = [...document.querySelectorAll(
          "button,a[role=button],div[role=button],[aria-label],[class*=close],[class*=dismiss]")];
        for (const b of cand) {
          if (!vis(b)) continue;
          const rot = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).trim();
          if (!rot || rot.length > 24) continue;
          if (proibido.test(rot)) continue;          // nao aceita nada, nunca
          if (!pats.some((p) => p.test(rot.trim()))) continue;
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, rot };
        }
        return null;
      }, FECHAR.map((r) => ({ fonte: r.source, flags: r.flags })),
         { fonte: NUNCA.source, flags: NUNCA.flags });
      if (!alvo) break;
      /* clique de MOUSE: em app React o handler costuma estar num pai, e um
         .click() sintetico no filho nao dispara nada. */
      await page.mouse.click(alvo.x, alvo.y);
      fechou.push(alvo.rot || "x");
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch { /* pop-up e cosmetico: nunca pode derrubar o turno */ }
  return fechou;
}

async function gotoAndSettle(page, url) {
  // domcontentloaded + janela curta de rede ociosa, em vez de networkidle2:
  // pagina com websocket/grafico ao vivo NUNCA assenta e estourava os 25s de
  // timeout — cada leitura levava meio minuto e o show ficava lento.
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 3500 }).catch(() => {});
  // Respiro curto para a SPA pintar o que acabou de chegar.
  await new Promise((r) => setTimeout(r, 600));
  // e o banner de consentimento sai da frente antes de qualquer leitura/clique
  await dispensarConsentimento(page);
  await fecharPopups(page);
  /* reaponta o live view: sem isto o painel mostra a aba em branco */
  for (const [id, p2] of agentPages) if (p2 === page) updateLiveView(id).catch(() => {});
  return resp ? resp.status() : 200;
}

// Abre a pagina como um navegador abre, espera a rede assentar e devolve o
// texto RENDERIZADO (innerText, nao HTML cru). Se shotPath vier, salva um
// screenshot do que estava na tela — e isso que o palco mostra.
export async function readPage(url, { maxChars = 6000, shotPath = null } = {}) {
  const page = await newPage();
  try {
    const status = await gotoAndSettle(page, url);
    const text = (await page.evaluate(() => document.body?.innerText ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    if (shotPath) {
      await page.screenshot({ path: shotPath, type: "jpeg", quality: 70 }).catch(() => {});
    }
    return { url: page.url(), status, text: text.slice(0, maxChars) };
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------------- Sessao de navegacao por agente ---------------------
//
// Cada agente tem UMA aba de navegacao que fica aberta entre turnos — como uma
// pessoa deixa a aba aberta. E o que permite scrollar, clicar e voltar em vez de
// so "abrir e fotografar". Essa aba e RENAVEGADA todo turno.
//
// E tem uma SEGUNDA aba, a de identidade, que o agente nunca dirige: e onde a
// sessao logada fica parada. Se a sessao morasse na aba de navegacao, o proximo
// `research` a destruiria.

const agentPages = new Map();
const identityPages = new Map();

// Exportada: o `livetrade` precisa da MESMA aba que o palco transmite — se ele
// abrisse outra, o espectador veria a aba antiga enquanto a compra acontece
// fora da tela, que e exatamente o que nao pode acontecer.
export async function getAgentPage(id) {
  const cur = agentPages.get(id);
  if (cur && !cur.isClosed() && cur.browser().connected) return cur;
  const page = await newPage(id); // navegador do proprio agente
  await porCarteira(page, id);
  agentPages.set(id, page);
  /* O LINK DA LIVE TEM QUE SEGUIR A ABA NOVA.
     `updateLiveView` so era chamado por `openPage`. Quando a sessao morria e o
     motor abria outra por aqui, o estado continuava publicando o link da sessao
     ANTIGA: o painel na tela mostrava um cadaver enquanto ela comprava e vendia
     de verdade na aba nova. O Michel viu o ciclo inteiro acontecer sem ver
     nada acontecer. */
  updateLiveView(id).catch(() => {});
  return page;
}

/* A CARTEIRA DELA ENTRA EM TODA ABA NOVA.
   A pump.fun entra por Privy e pede uma carteira que assine um desafio; no
   navegador remoto nao existe extensao, entao sem isto o login e impossivel e
   ela fica sem chat, sem callout e sem renda. Com a carteira instalada ela
   assina sozinha, com a propria chave, e a sessao fica salva no context.
   So assina TEXTO — transacao continua sendo caminho do executor. */
async function porCarteira(page, id) {
  const envKey = String(id).toUpperCase() + "_SOL_KEYPAIR";
  if (!process.env[envKey]) return false;          // agente sem carteira: segue
  try {
    const { instalarCarteira } = await import("./carteira-navegador.js");
    await instalarCarteira(page, envKey);
    return true;
  } catch (e) {
    console.log(`[browser] carteira nao instalada para ${id}: ${e.message}`);
    return false;
  }
}

// A aba de identidade do agente. Mesmo perfil da aba de navegacao (mesmo cookie
// jar), mas separada: quem loga aqui continua logado enquanto o agente navega.
export async function identityPage(id) {
  const cur = identityPages.get(id);
  if (cur && !cur.isClosed() && cur.browser().connected) return cur;
  const page = await newPage(id);
  await porCarteira(page, id);   // e nesta aba que ela loga na pump
  identityPages.set(id, page);
  return page;
}

/* GARANTE A SESSAO DA PUMP. Chamar antes de falar no chat ou fazer callout:
   sessao de site expira, e sem isto ela ficaria mandando mensagem no vazio.
   Devolve "ja estava" | "logou" | "falhou". Nao pede nada a ninguem — quem
   assina o desafio e ela. */
export async function garantirLoginPump(id) {
  /* NA ABA DO AGENTE, que e a TRANSMITIDA.
     Eu fazia login, callout e trade na aba de identidade — que existe pra
     sessao sobreviver enquanto ela navega, mas NAO e a aba que o live view
     mostra. Resultado: tudo funcionava e o espectador via um quarto parado.
     O Michel perguntou "porque nao me mostrou tudo funcionando na tela?" e a
     resposta era essa. Uma aba so: a que aparece. */
  const page = await getAgentPage(id);
  const estaLogada = async () => {
    try {
      const t = await page.evaluate(() => document.body.innerText.slice(0, 600));
      return !/Sign in/i.test(t);
    } catch { return false; }
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!/pump\.fun/.test(page.url())) await gotoAndSettle(page, "https://pump.fun");
  else { await dispensarConsentimento(page); await fecharPopups(page); }
  await espera(1500);
  if (await estaLogada()) return "ja estava";

  // 1. abre o modal
  const clique = async (frame, fonte, flags) => {
    try {
      return await frame.evaluate((f, fl) => {
        const p = new RegExp(f, fl);
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10; };
        const cands = [...document.querySelectorAll("button,a,div[role=button],li")]
          .filter(vis).filter((e) => {
            const t = (e.textContent || "").trim();
            return t.length < 30 && p.test(t);
          });
        const alvo = cands[cands.length - 1];
        if (!alvo) return false;
        alvo.click();
        return (alvo.textContent || "").trim().slice(0, 30);
      }, fonte, flags);
    } catch { return false; }
  };

  if (!await clique(page, "^sign\s*in$", "i")) return "falhou";
  await espera(5000);

  // 2. escolhe a carteira dentro do iframe do Privy
  const frames = [page, ...page.frames().filter((f) => /privy/i.test(f.url()))];
  let escolheu = false;
  for (const f of frames) if (await clique(f, "phantom", "i")) { escolheu = true; break; }
  if (!escolheu) return "falhou";
  await espera(7000);

  if (await estaLogada()) return "logou";
  // alguns fluxos pedem um segundo OK
  for (const f of frames) if (await clique(f, "^(sign|confirm|continue|approve)", "i")) break;
  await espera(6000);
  return (await estaLogada()) ? "logou" : "falhou";
}

// O que o agente VE agora: texto do viewport (nao da pagina inteira — rolar e
// que revela o resto), o que da pra clicar na tela, e onde o scroll esta.
async function view(page, { maxChars = 3000, shotPath = null } = {}) {
  await new Promise((r) => setTimeout(r, 350));
  const data = await page.evaluate(() => {
    const vh = innerHeight, vw = innerWidth;
    const inView = (r) =>
      r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (inView(el.getBoundingClientRect())) parts.push(t);
    }
    const links = [];
    for (const el of document.querySelectorAll("a, button, [role=button], [role=link], [role=tab]")) {
      if (!inView(el.getBoundingClientRect())) continue;
      const t = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (t && t.length <= 60 && !links.includes(t)) links.push(t);
      if (links.length >= 30) break;
    }
    const max = Math.max(document.documentElement.scrollHeight - vh, 1);
    return {
      text: parts.join(" "),
      links,
      scrollPct: Math.min(100, Math.round((scrollY / max) * 100)),
      atEnd: scrollY >= max - 4,
    };
  });
  if (shotPath) {
    await page.screenshot({ path: shotPath, type: "jpeg", quality: 70 }).catch(() => {});
  }
  return {
    url: page.url(),
    text: data.text.slice(0, maxChars),
    links: data.links,
    scrollPct: data.scrollPct,
    atEnd: data.atEnd,
  };
}

// Abre uma URL na aba do agente e devolve a primeira vista.
export async function openPage(id, url, opts = {}) {
  const page = await getAgentPage(id);
  const status = await gotoAndSettle(page, url);
  updateLiveView(id).catch(() => {});
  return { status, ...(await view(page, opts)) };
}

// Um movimento de navegacao na aba do agente: "scroll down" | "scroll up" |
// "click: <texto do link>" | "back". Devolve a nova vista.
export async function browseMove(id, move, opts = {}) {
  const page = agentPages.get(id);
  if (!page || page.isClosed()) throw new Error("no page open — research a URL first");
  const m = String(move ?? "").trim();

  if (/^scroll\s+(down|up)$/i.test(m)) {
    const dir = /down$/i.test(m) ? 1 : -1;
    await page.evaluate((d) => scrollBy({ top: d * innerHeight * 0.85, behavior: "instant" }), dir);
  } else if (/^back$/i.test(m)) {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
  } else if (/^click[:\s]/i.test(m)) {
    const label = m.replace(/^click[:\s]+/i, "").trim();
    if (!label) throw new Error("click needs the link text");
    const handle = await page.evaluateHandle((txt) => {
      const want = txt.toLowerCase();
      const all = [...document.querySelectorAll("a, button, [role=button], [role=link], [role=tab]")];
      const vis = all.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const label = (el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
      const el = vis.find((e) => label(e) === want) ?? vis.find((e) => label(e).includes(want));
      // target=_blank abriria outra aba que ninguem esta vendo — navega na mesma.
      if (el && el.tagName === "A") el.target = "";
      return el ?? null;
    }, label);
    const el = handle.asElement();
    if (!el) throw new Error(`nothing on this page reads "${label}"`);
    await page.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }), el);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
      el.click(),
    ]);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 }).catch(() => {});
  } else {
    throw new Error(`unknown move "${m}" — use "scroll down", "scroll up", "click: <text>" or "back"`);
  }
  updateLiveView(id).catch(() => {});
  return { status: null, ...(await view(page, opts)) };
}

// Busca no DuckDuckGo pela pagina de resultados de verdade, extraindo os links
// do DOM renderizado. Mesmo formato do search antigo: [{title, url}].
// `key` de agente: a busca roda NA ABA PERSISTENTE dele — e o que o live view
// transmite, e a pagina de resultados FICA aberta (da pra `browse` clicar num
// resultado depois, como gente). Sem key (anonimo): aba descartavel, como antes.
export async function searchPage(query, max = 8, { shotPath = null, key = SHARED } = {}) {
  const isAgent = key !== SHARED && key !== undefined;
  const page = isAgent ? await getAgentPage(key) : await newPage();
  try {
    // kl=us-en trava a REGIAO da busca em EUA/ingles — sem isso o DDG
    // geolocaliza pelo IP (Brasil) e mistura resultado em portugues.
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web&kl=us-en`, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000,
    });
    await page.waitForSelector('a[data-testid="result-title-a"], a.result__a', { timeout: 6000 })
      .catch(() => {});
    // A pagina de resultados E uma pagina — o palco mostra ela como qualquer
    // outra. Buscar era o unico movimento de navegacao que ficava invisivel.
    if (shotPath) {
      await page.screenshot({ path: shotPath, type: "jpeg", quality: 70 }).catch(() => {});
    }
    const hits = await page.evaluate((limit) => {
      const links = document.querySelectorAll('a[data-testid="result-title-a"], a.result__a');
      const out = [];
      for (const a of links) {
        const title = a.textContent.replace(/\s+/g, " ").trim();
        const url = a.href;
        if (title && /^https?:\/\//.test(url)) out.push({ title, url });
        if (out.length >= limit) break;
      }
      return out;
    }, max);
    // Aba do agente: fica ABERTA nos resultados (live view transmite; `browse`
    // pode clicar). E mira a transmissao nesta aba — era a causa da tela branca.
    if (isAgent) updateLiveView(key).catch(() => {});
    return hits;
  } finally {
    if (!isAgent) await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  for (const [key, b] of browsers) {
    await b.close().catch(() => {});
    browsers.delete(key);
  }
  agentPages.clear();
  identityPages.clear();
}

// Os cookies do perfil do agente para um site. E assim que a sessao logada no
// navegador vira uma conexao autenticada fora dele: a pump.fun guarda o login
// no cookie, nao num token que desse para copiar.
export async function cookiesFor(agentId, url = "https://pump.fun") {
  const page = await identityPage(agentId);
  const cookies = await page.cookies(url);
  if (!cookies?.length) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// Quais navegadores estao de pe (diagnostico, e o teste da Fase 1 usa isto).
export function browserInfo() {
  return [...browsers.entries()].map(([key, b]) => ({
    key,
    connected: b.connected,
    profile: key === SHARED ? null : profileDir(key),
  }));
}
