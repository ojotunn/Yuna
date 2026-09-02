// ============================================================================
// O X DELA, PELO SEU COMPUTADOR. (02/09/2026)
//
// O motor mora na Railway e sai por IP de datacenter — que e o que o X barra.
// Proxy residencial resolve, mas custaria uns $300/mes porque ela navega a
// pump o dia inteiro e TUDO passaria por ele.
//
// Entao a direcao se inverte: em vez de o motor buscar o seu PC, o SEU PC
// busca o motor. Este programa roda aqui, pergunta ao yuna.cam se ha post na
// fila dela, e publica no X pelo SEU navegador e pelo SEU IP — o mesmo par
// onde a sessao dela ja funciona. Custo de proxy: zero.
//
// PERFIL PROPRIO, nao o seu. Abrir o Chrome que voce usa daria conflito de
// arquivo e fecharia suas abas. Este usa uma pasta so dele, em
// scripts/x-perfil, logada uma vez e lembrada pra sempre.
//
// O QUE ELE NAO FAZ: nao inventa texto (o texto e dela), nao resolve captcha
// (se o X pedir verificacao, ele PARA e avisa), e nao publica nada que ela nao
// tenha escrito.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { estaLogada, pediuVerificacao, postar, responder, lerMencoes } from "../src/lib/x-tela.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PERFIL = path.join(AQUI, "x-perfil");
const SITE = process.env.YUNA_URL || "https://yuna.cam";
const TOKEN = process.env.ADMIN_TOKEN || "";
const INTERVALO = Number(process.env.X_LOCAL_INTERVALO_S || 60) * 1000;
/* De quanto em quanto tempo ele olha as mencoes. Ler e de graca pelo navegador
   — e a razao inteira deste caminho existir, porque o tier gratuito da API do
   X nao da leitura nenhuma. */
const LER_MENCOES_MIN = Number(process.env.X_LOCAL_MENCOES_MIN || 10);
const PUBLICAR = process.env.X_LOCAL_PUBLICAR !== "0";   // 0 = ensaio, nao clica em Post

if (!TOKEN) { console.log("  falta ADMIN_TOKEN no ambiente."); process.exit(1); }

const api = async (metodo, corpo) => {
  const r = await fetch(`${SITE}/api/x`, {
    method: metodo,
    headers: { "content-type": "application/json", "x-admin-token": TOKEN },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (!r.ok) throw new Error(`${metodo} /api/x -> HTTP ${r.status}`);
  return r.json();
};

console.log("  perfil do navegador:", PERFIL);
const browser = await puppeteer.launch({
  headless: false,                 // visivel: e assim que voce loga na primeira vez
  userDataDir: PERFIL,
  /* `AutomationControlled` e a marca que poe navigator.webdriver=true. O X le
     isso e recusa LOGIN na hora ("Limitamos temporariamente seu acesso"). Sem
     ela, a janela se parece com um Chrome comum. */
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900",
         "--disable-blink-features=AutomationControlled"],
  defaultViewport: null,
});
const page = (await browser.pages())[0] ?? await browser.newPage();

await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

if (!await estaLogada(page)) {
  /* NAO TENTA LOGAR: PLANTA A SESSAO QUE JA EXISTE.
     O X recusa login em janela automatizada — "Limitamos temporariamente seu
     acesso" — e insistir so gasta tentativa. Os cookies vem de um arquivo que
     voce preenche uma vez, copiando do Chrome que ja esta logado. Mesmo
     caminho que funcionou na nuvem. */
  const ARQ = path.join(AQUI, "x-cookies-local.json");
  if (!fs.existsSync(ARQ)) {
    fs.writeFileSync(ARQ, JSON.stringify({ auth_token: "", ct0: "" }, null, 2));
    console.log("");
    console.log("  Ela nao esta logada, e o X nao aceita login em janela automatizada.");
    console.log("  Preencha este arquivo com os cookies do seu Chrome e rode de novo:");
    console.log("    " + ARQ);
    console.log("  (Chrome logado como @yunaagent: F12 > Application > Cookies > x.com,");
    console.log("   copie os valores de `auth_token` e `ct0`)");
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(ARQ, "utf8"));
  if (!c.auth_token || !c.ct0) { console.log("  o arquivo de cookies esta vazio: " + ARQ); process.exit(1); }
  const comuns = { domain: ".x.com", path: "/", secure: true, sameSite: "Lax" };
  await page.setCookie(
    { name: "auth_token", value: c.auth_token, ...comuns, httpOnly: true },
    { name: "ct0", value: c.ct0, ...comuns, httpOnly: false },
  );
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));
  if (!await estaLogada(page)) { console.log("  a sessao nao pegou — os cookies podem ter expirado."); process.exit(1); }
  console.log("  sessao plantada — o perfil guarda daqui pra frente.");
}
console.log("  logada no X. Vigiando a fila dela a cada " + (INTERVALO / 1000) + "s.");
if (!PUBLICAR) console.log("  MODO ENSAIO: escreve o post e NAO clica em publicar.");

/* Mencoes ja entregues ao motor. Sem isto, cada leitura reenviaria as mesmas
   e ela veria a mesma pergunta cinco vezes. */
const jaVistas = new Set();
let proximaLeitura = 0;
/* Quantos ciclos seguidos o X barrou. Zera quando volta a passar. */
let presoHa = 0;
/* O link de cada mencao, guardado pelo handle: e o que permite RESPONDER na
   conversa da pessoa em vez de postar solto. */
const linkDe = new Map();

for (;;) {
  try {
    /* O MOTIVO IMPORTA, E A REPETICAO NAO. A funcao devolve QUAL foi o sinal
       e o worker jogava fora, imprimindo vinte linhas iguais — que nao dizem
       se e captcha, se deslogou, ou se o detector esta enganado (que foi o
       caso em 02/09: "locked" num tweet de terceiro). */
    const desafio = await pediuVerificacao(page);
    if (desafio) {
      presoHa++;
      if (presoHa <= 3) {
        console.log(`  o X pediu verificacao (${desafio}). Resolva na janela; eu espero.`);
      } else if (presoHa === 4) {
        console.log(`  PRESO HA ${presoHa} CICLOS em "${desafio}" — a fila dela nao esta saindo.`);
        console.log("  se a janela do Chrome mostra a timeline normal, o detector errou: me avise.");
      }
      await new Promise((r) => setTimeout(r, 60000));
      continue;
    }
    if (presoHa) { console.log(`  destravou (estava preso ha ${presoHa} ciclos). Voltando ao trabalho.`); presoHa = 0; }
    /* 1) LER O QUE FALARAM COM ELA. */
    if (Date.now() >= proximaLeitura) {
      proximaLeitura = Date.now() + LER_MENCOES_MIN * 60000;
      const r = await lerMencoes(page, { limite: 8 }).catch(() => null);
      if (r?.ok) {
        const novas = (r.mencoes || []).filter((m) => m.link && !jaVistas.has(m.link));
        for (const m of novas) {
          jaVistas.add(m.link);
          if (m.autor) linkDe.set(String(m.autor).replace(/^@/, "").toLowerCase(), m.link);
          await api("POST", { tipo: "comentario", de: m.autor, texto: m.texto });
          console.log("  mencao de " + m.autor + ": " + String(m.texto).slice(0, 60));
        }
        if (novas.length) console.log("  " + novas.length + " mencao(oes) entregues ao motor.");
      } else if (r) {
        console.log("  nao consegui ler as mencoes:", r.motivo);
      }
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" }).catch(() => {});
    }

    /* 2) PUBLICAR O QUE ELA ESCREVEU. */
    const { pendentes = [] } = await api("GET");
    const fila = pendentes.filter((p) => !p.sent && !p.descartado);
    if (fila.length) {
      const p = fila[fila.length - 1];          // o mais novo primeiro
      /* RESPOSTA VAI NA CONVERSA, nao no vazio. `para` e o handle que ELA
         escolheu responder; o link veio da mencao. Sem link conhecido cai pro
         post solto, que e melhor que perder o texto dela. */
      const alvo = p.para ? linkDe.get(String(p.para).replace(/^@/, "").toLowerCase()) : null;
      console.log(alvo
        ? "  respondendo " + p.para + ": " + String(p.text).slice(0, 60)
        : "  publicando: " + String(p.text).slice(0, 70));
      const r = alvo
        ? await responder(page, alvo, p.text, { publicar: PUBLICAR })
        : await postar(page, p.text, { publicar: PUBLICAR });
      if (r?.ok && !r.ensaio) {
        /* SO MARCA DEPOIS DE PUBLICAR DE VERDADE. Marcar antes enterraria o
           post na fila sem ele ter saido — e o botao de desfazer no painel
           ficou quebrado o dia inteiro por um erro dessa familia. */
        await api("POST", { tipo: "postei", post: p.id });
        console.log("  publicado, e o motor foi avisado.");
      } else if (r?.ok && r.ensaio) {
        console.log("  ENSAIO: o texto entrou no campo e eu NAO cliquei em publicar.");
      } else {
        console.log("  nao publicou:", r?.motivo || "sem motivo");
      }
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" }).catch(() => {});
    }
  } catch (e) {
    console.log("  " + String(e.message).slice(0, 140));
  }
  await new Promise((r) => setTimeout(r, INTERVALO));
}
