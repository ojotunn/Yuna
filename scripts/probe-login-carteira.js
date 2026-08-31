// ============================================================================
// LOGIN NA PUMP COM A CARTEIRA DELA — sem extensao, sem humano.
//
// Instala a carteira do agente na aba (src/lib/carteira-navegador.js), abre a
// pump, dispensa o banner de cookies, clica em Sign in, escolhe Phantom e
// assina o desafio. Se der certo, a sessao fica gravada no context do
// Browserbase e vale para o motor inteiro: chat, callout, perfil.
//
//     ENV_FILE=.env.yuna node scripts/probe-login-carteira.js
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_SHOW = process.env.ENV_FILE || path.join(ROOT, ".env.yuna");
dotenv.config({ path: path.join(ROOT, ".env.example") });
dotenv.config({ path: path.join(ROOT, ".env"), override: true });
dotenv.config({ path: ENV_SHOW, override: true });

const AGENTE = process.argv[2] || "yuna";
const CHAVE = AGENTE.toUpperCase() + "_SOL_KEYPAIR";
const linha = "-".repeat(64);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = await import("../src/lib/browser.js");
const { instalarCarteira } = await import("../src/lib/carteira-navegador.js");

console.log(`\n${linha}\n  LOGIN COM A CARTEIRA — ${AGENTE.toUpperCase()}\n${linha}`);

let falhas = 0;
const png = (nome) => path.join(__dirname, `probe-login-${nome}.png`);
const print = async (page, nome) => {
  try { fs.writeFileSync(png(nome), await page.screenshot({ type: "png" })); }
  catch { /* sem print, sem drama */ }
};

try {
  const page = await chrome.getAgentPage(AGENTE);

  const endereco = await instalarCarteira(page, CHAVE);
  console.log(`  carteira instalada na aba: ${endereco}`);

  await page.goto("https://pump.fun", { waitUntil: "domcontentloaded", timeout: 60000 });
  await espera(5000);
  const banner = await chrome.dispensarConsentimento(page);
  console.log("  banner de cookies:", banner ? `dispensado ("${banner}")` : "nao apareceu");
  await espera(2000);

  // a carteira chegou mesmo na pagina?
  const viu = await page.evaluate(() => ({
    phantom: !!(window.phantom && window.phantom.solana && window.phantom.solana.isPhantom),
    endereco: window.solana && window.solana.publicKey ? String(window.solana.publicKey) : null,
  }));
  console.log(`  a pagina ve a carteira: ${viu.phantom ? "SIM · " + viu.endereco : "NAO"}`);
  if (!viu.phantom) falhas++;

  let logada = !/\bSign in\b/i.test(await page.evaluate(() => document.body.innerText.slice(0, 600)));
  if (logada) console.log("  ja estava logada — nada a fazer");
  else {
    const clicar = async (regex, oque) => {
      const caixa = await page.evaluate((fonte, flags) => {
        const p = new RegExp(fonte, flags);
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10; };
        const alvo = [...document.querySelectorAll("button,a,div[role=button],li,div")]
          .filter(vis).filter((e) => {
            const t = (e.textContent || "").trim();
            return t.length < 30 && p.test(t);
          })
          /* o mais fundo da arvore: o texto "Phantom" aparece no container e no
             botao, e clicar no container as vezes nao dispara nada */
          .sort((a, b) => b.compareDocumentPosition(a) & 16 ? 1 : -1)[0];
        if (!alvo) return null;
        const r = alvo.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: alvo.textContent.trim() };
      }, regex.source, regex.flags);
      if (!caixa) { console.log(`  NAO ACHEI: ${oque}`); return false; }
      console.log(`  clicando: ${oque} ("${caixa.texto}")`);
      await page.mouse.click(caixa.x, caixa.y);
      return true;
    };

    if (!await clicar(/^sign\s*in$/i, "Sign in")) falhas++;
    await espera(5000);
    await print(page, "1-modal");

    /* o modal do Privy vem num IFRAME — o clique tem que ser no frame certo */
    const frames = page.frames().filter((f) => /privy/i.test(f.url()));
    console.log(`  frames do Privy: ${frames.length}`);

    const clicarNoFrame = async (regex, oque) => {
      for (const f of [page, ...frames]) {
        try {
          const achou = await f.evaluate((fonte, flags) => {
            const p = new RegExp(fonte, flags);
            const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10; };
            const cands = [...document.querySelectorAll("button,div[role=button],li,a")]
              .filter(vis).filter((e) => p.test((e.textContent || "").trim()));
            const alvo = cands[cands.length - 1];
            if (!alvo) return false;
            alvo.click();
            return (alvo.textContent || "").trim().slice(0, 30);
          }, regex.source, regex.flags);
          if (achou) { console.log(`  clicando: ${oque} ("${achou}")`); return true; }
        } catch { /* frame morreu */ }
      }
      console.log(`  NAO ACHEI: ${oque}`);
      return false;
    };

    if (!await clicarNoFrame(/phantom/i, "Phantom")) falhas++;
    await espera(7000);
    await print(page, "2-apos-phantom");

    logada = !/\bSign in\b/i.test(await page.evaluate(() => document.body.innerText.slice(0, 600)));
    if (!logada) {
      /* alguns fluxos abrem um segundo passo pedindo a assinatura */
      await clicarNoFrame(/^(sign|confirm|continue|approve)/i, "confirmar assinatura");
      await espera(6000);
      logada = !/\bSign in\b/i.test(await page.evaluate(() => document.body.innerText.slice(0, 600)));
    }
    await print(page, "3-final");
  }

  console.log(`\n  LOGADA: ${logada ? "SIM" : "nao"}`);
  if (!logada) falhas++;

  const cookies = await chrome.cookiesFor(AGENTE).catch(() => null);
  console.log(`  cookies da pump: ${cookies ? cookies.split(";").length + " (sessao: " +
    (/pump_session|privy/i.test(cookies) ? "sim" : "nao vi") + ")" : "nenhum"}`);
  console.log(`  prints: ${png("1-modal")} , ${png("2-apos-phantom")} , ${png("3-final")}`);
} catch (e) {
  console.log("  ERRO:", e && e.message);
  falhas++;
} finally {
  await chrome.closeBrowser().catch(() => {});
}

console.log(falhas ? `\n${falhas} FALHA(S)\n` : "\n  TUDO CERTO\n");
