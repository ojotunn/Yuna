// ============================================================================
// O TRANSPLANTE DA SESSAO DO X. (02/09/2026)
//
// A conta @yunaagent ja esta logada no Chrome do Michel. O login automatizado
// no navegador dela nunca passou — e a hipotese mais provavel esta escrita no
// proprio browser.js: "o X barra login vindo de datacenter", e o proxy
// residencial esta DESLIGADO.
//
// Isto nao tenta logar. Pega os cookies de uma sessao que JA existe e planta no
// contexto persistente dela no Browserbase, que e o mesmo mecanismo que guarda
// o login da pump.fun entre sessoes.
//
// COMO USAR
//   1. no Chrome, logado como @yunaagent:
//        F12 -> aba Application -> Storage -> Cookies -> https://x.com
//      copie o VALOR de `auth_token` e de `ct0`
//      (nao da pra pegar pelo console: `auth_token` e httpOnly)
//   2. preencha o arquivo que este script indica e rode de novo
//
// OS COOKIES NAO SAO IMPRESSOS em lugar nenhum, e o arquivo e apagado no fim.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const ARQ = process.env.X_COOKIES_FILE ||
  "C:/Users/Michel/AppData/Local/Temp/claude/C--Higgsfield-Games/86ce1dff-af7a-44e7-abd1-79f67fa56689/scratchpad/x-cookies.json";

if (!fs.existsSync(ARQ)) {
  fs.writeFileSync(ARQ, JSON.stringify({
    _como: "cole os valores do Chrome: F12 > Application > Cookies > https://x.com",
    auth_token: "",
    ct0: "",
  }, null, 2));
  console.log(`\n  Criei o arquivo pra voce preencher:\n    ${ARQ}\n`);
  console.log("  No Chrome, logado como @yunaagent:");
  console.log("    F12  ->  aba Application  ->  Storage  ->  Cookies  ->  https://x.com");
  console.log("    copie o VALOR de `auth_token` e de `ct0` para o arquivo, e rode de novo.\n");
  process.exit(0);
}

const c = JSON.parse(fs.readFileSync(ARQ, "utf8"));
if (!c.auth_token || !c.ct0) {
  console.log("  o arquivo existe mas está sem `auth_token` ou `ct0`. Preencha e rode de novo.");
  process.exit(1);
}

const BB = "https://api.browserbase.com/v1";
const chave = process.env.BROWSERBASE_API_KEY;
const projeto = process.env.BROWSERBASE_PROJECT_ID;
const ctx = process.env.BROWSERBASE_CTX_YUNA;
if (!chave || !projeto || !ctx) {
  console.log("  faltam BROWSERBASE_API_KEY / PROJECT_ID / CTX_YUNA no ambiente.");
  process.exit(1);
}

/* PROXY RESIDENCIAL LIGADO AQUI, sempre. E a razao de o login nunca ter
   passado, e plantar cookie por datacenter e queimar o cookie. */
const r = await fetch(`${BB}/sessions`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-bb-api-key": chave },
  body: JSON.stringify({
    projectId: projeto,
    browserSettings: { context: { id: ctx, persist: true } },
    proxies: [{ type: "browserbase", geolocation: { country: process.env.BROWSERBASE_PROXY_PAIS || "US" } }],
    region: process.env.BROWSERBASE_REGION || "us-east-1",
  }),
}).then((x) => x.json());
if (!r?.connectUrl) { console.log("  nao consegui abrir a sessao:", JSON.stringify(r).slice(0, 200)); process.exit(1); }
console.log("  sessao aberta no contexto dela, com proxy residencial");

const browser = await puppeteer.connect({ browserWSEndpoint: r.connectUrl });
const page = (await browser.pages())[0] ?? await browser.newPage();

const comuns = { domain: ".x.com", path: "/", secure: true, httpOnly: false, sameSite: "Lax" };
await page.setCookie(
  { name: "auth_token", value: c.auth_token, ...comuns, httpOnly: true },
  { name: "ct0", value: c.ct0, ...comuns },
  ...(c.twid ? [{ name: "twid", value: c.twid, ...comuns }] : []),
  ...(c.kdt ? [{ name: "kdt", value: c.kdt, ...comuns, httpOnly: true }] : []),
);
console.log("  cookies plantados");

await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 45000 });
await new Promise((s) => setTimeout(s, 6000));
const url = page.url();
const logada = await page.evaluate(() =>
  !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"]'));

console.log("");
console.log("  url final :", url);
console.log("  logada?   :", logada ? "SIM — a sessao pegou" : "nao (o X pediu verificacao ou recusou)");
if (logada) {
  const quem = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    return a ? a.innerText.replace(/\s+/g, " ").slice(0, 60) : null;
  });
  if (quem) console.log("  conta     :", quem);
  console.log("\n  O contexto e persistente: o login sobrevive as proximas sessoes dela.");
  console.log("  Ligue BROWSERBASE_PROXY=1 no Railway pra ela continuar saindo por IP residencial.");
}

await browser.close();
fs.unlinkSync(ARQ);
console.log("  arquivo de cookies apagado.");
