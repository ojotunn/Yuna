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
import { estaLogada, pediuVerificacao, postar } from "../src/lib/x-tela.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PERFIL = path.join(AQUI, "x-perfil");
const SITE = process.env.YUNA_URL || "https://yuna.cam";
const TOKEN = process.env.ADMIN_TOKEN || "";
const INTERVALO = Number(process.env.X_LOCAL_INTERVALO_S || 60) * 1000;
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
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
  defaultViewport: null,
});
const page = (await browser.pages())[0] ?? await browser.newPage();

await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

if (!await estaLogada(page)) {
  console.log("");
  console.log("  ====================================================");
  console.log("   PRIMEIRA VEZ: faca login como @yunaagent na janela");
  console.log("   que abriu. Ela fica lembrada, voce nao repete isso.");
  console.log("   Quando terminar, esta janela segue sozinha.");
  console.log("  ====================================================");
  console.log("");
  for (let i = 0; i < 120; i++) {              // ate 10 minutos esperando
    await new Promise((r) => setTimeout(r, 5000));
    if (await estaLogada(page)) break;
  }
  if (!await estaLogada(page)) { console.log("  nao logou — feche e rode de novo."); process.exit(1); }
}
console.log("  logada no X. Vigiando a fila dela a cada " + (INTERVALO / 1000) + "s.");
if (!PUBLICAR) console.log("  MODO ENSAIO: escreve o post e NAO clica em publicar.");

for (;;) {
  try {
    if (await pediuVerificacao(page)) {
      console.log("  o X pediu verificacao. Resolva na janela; eu espero.");
      await new Promise((r) => setTimeout(r, 60000));
      continue;
    }
    const { pendentes = [] } = await api("GET");
    const fila = pendentes.filter((p) => !p.sent && !p.descartado);
    if (fila.length) {
      const p = fila[fila.length - 1];          // o mais novo primeiro
      console.log(`  publicando [${p.id}]: ${String(p.text).slice(0, 70)}...`);
      const r = await postar(page, p.text, { publicar: PUBLICAR });
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
