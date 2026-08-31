// ============================================================================
// O login da pump ainda vale? Abre a pump.fun no navegador remoto DELA (o
// contexto guarda o cookie) e procura sinal de sessao. Nao clica em nada, nao
// loga, nao publica — so olha.
//
//     ENV_FILE=.env.yuna node scripts/probe-login-pump.js yuna
// ============================================================================
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(ROOT, ".env.example") });
dotenv.config({ path: path.join(ROOT, ".env"), override: true });
if (process.env.ENV_FILE) dotenv.config({ path: process.env.ENV_FILE, override: true });

const id = (process.argv[2] || "yuna").toLowerCase();
const chrome = await import("../src/lib/browser.js");
let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) fails++; };

console.log(`\nagente: ${id}`);
console.log(`  contexto: ${chrome.contextIdFor(id) || "NENHUM"}`);

try {
  const r = await chrome.openPage(id, "https://pump.fun");
  const txt = (r?.text || "").toLowerCase();
  ok(!!txt, "a pump.fun abriu");
  console.log("  --- o que a pagina mostrou (300 primeiros chars) ---");
  console.log("  " + (r?.text || "").slice(0, 300).replace(/\s+/g, " "));
  console.log("  ---");

  /* SINAL POSITIVO, nao ausencia de palavra. Procurar "connect wallet" dava
     falso negativo: a pump tem esse texto na pagina mesmo com a sessao de pe.
     O que so aparece logado e o endereco dela no cabecalho e o menu Create. */
  const { load } = await import("../src/lib/signer.js");
  let addr = null;
  try { addr = load(id.toUpperCase() + "_SOL_KEYPAIR").address; } catch { /* sem chave */ }
  const pedaco = addr ? addr.slice(0, 4).toLowerCase() : null;
  const temEndereco = pedaco ? txt.includes(pedaco) : false;
  const temCreate = /create/.test(txt);
  console.log(`  endereco dela na pagina: ${temEndereco ? "sim" : "nao"} · menu Create: ${temCreate ? "sim" : "nao"}`);
  /* O sinal que decide e o "sign in" no cabecalho: a pump so o mostra pra
     quem NAO esta logado. "Create" aparece pros dois. */
  const pedeLogin = /sign in/.test(txt);
  ok(!pedeLogin, pedeLogin
    ? "a pagina oferece SIGN IN — este navegador nao esta logado como ela"
    : "sem sign in no cabecalho: a sessao dela esta de pe" +
      (temEndereco ? " (e o endereco dela aparece)" : ""));

  /* cookiesFor devolve UMA STRING "a=1; b=2" (ou null), nao um array — a
     primeira versao deste teste tratou como array e estourou depois de ja ter
     dado o diagnostico certo. */
  const cookies = await chrome.cookiesFor(id, "https://pump.fun").catch(() => null);
  const nomes = cookies ? cookies.split(";").map((c) => c.split("=")[0].trim()) : [];
  ok(nomes.length > 0, `o contexto trouxe ${nomes.length} cookie(s) da pump`);
  const auth = nomes.find((n) => /auth|session|token/i.test(n));
  console.log(`  cookie de sessao: ${auth || "nenhum com cara de sessao"}`);
} catch (e) {
  ok(false, `nao consegui abrir: ${e.message}`);
}

try { await chrome.closeBrowser(); } catch { /* ok */ }
console.log(fails ? `\n${fails} FALHA(S) — rode login-remoto.js de novo\n` : "\nLOGIN DE PE\n");
process.exit(fails ? 1 : 0);
