// ============================================================================
// O CICLO INTEIRO, NA TELA: COMPRA -> CALLOUT -> VENDA.
//
// Existe porque eu estava testando peca por peca em cima da tela do Michel e
// gastando o tempo dele a cada falha. Aqui o caminho inteiro roda de uma vez,
// conferindo a CORRENTE entre um passo e outro (a carteira e a verdade, nao a
// tela nem o placar). Se este script passa, o motor passa — e so entao vale a
// pena chamar alguem pra assistir.
//
//     ENV_FILE=.env.yuna node scripts/ciclo-completo.js <mint> <SIMBOLO> [usd]
//
// Cada passo e real: dinheiro sai, a call fica publica, o token volta pra SOL.
// ============================================================================
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_SHOW = process.env.ENV_FILE || path.join(ROOT, ".env.yuna");
dotenv.config({ path: path.join(ROOT, ".env.example") });
dotenv.config({ path: path.join(ROOT, ".env"), override: true });
dotenv.config({ path: ENV_SHOW, override: true });

const MINT = process.argv[2];
const SIMBOLO = process.argv[3];
const USD = Number(process.argv[4] || 2);
if (!MINT || !SIMBOLO) {
  console.log("\n  uso: node scripts/ciclo-completo.js <mint> <SIMBOLO> [usd]\n");
  process.exit(1);
}

const chrome = await import("../src/lib/browser.js");
const trade = await import("../src/lib/trade-pump.js");
const callout = await import("../src/lib/callout-pump.js");
const signer = await import("../src/lib/signer.js");

const DONO = signer.load("YUNA_SOL_KEYPAIR").address;
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const linha = "-".repeat(66);

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}

/* Quanto do token a carteira tem AGORA. Os dois programas: as moedas novas da
   pump saem em Token-2022 e olhar so o classico diz "0" com a moeda na mao. */
async function saldoDoToken(mint) {
  let total = 0;
  for (const prog of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
    const r = await rpc("getTokenAccountsByOwner", [DONO, { programId: prog }, { encoding: "jsonParsed" }]);
    for (const t of (r?.value ?? [])) {
      const i = t.account.data.parsed.info;
      if (i.mint === mint) total += Number(i.tokenAmount.uiAmount || 0);
    }
  }
  return total;
}
const saldoSol = async () => ((await rpc("getBalance", [DONO]))?.value ?? 0) / 1e9;

/* Espera a corrente confirmar o que a tela disse. Tela mentindo e o erro mais
   caro aqui: o motor seguiria pro proximo passo achando que deu certo. */
async function esperarSaldo(mint, alvo, segundos = 45) {
  for (let i = 0; i < segundos / 3; i++) {
    const s = await saldoDoToken(mint);
    if (alvo === "positivo" && s > 0) return s;
    if (alvo === "zero" && s === 0) return 0;
    await espera(3000);
  }
  return await saldoDoToken(mint);
}

console.log(`\n${linha}\n  CICLO COMPLETO — ${SIMBOLO} · $${USD}\n  carteira ${DONO}\n${linha}`);
let falhou = null;

try {
  console.log("  sessao:", await chrome.garantirLoginPump("yuna"));
  const page = await chrome.getAgentPage("yuna");

  const solAntes = await saldoSol();
  console.log(`  SOL antes: ${solAntes.toFixed(4)}`);

  // ---------------------------------------------------------------- 1. COMPRA
  console.log(`\n  [1/3] COMPRANDO $${USD} na tela...`);
  const c = await trade.comprarNaTela(page, { mint: MINT, usd: USD,
    prints: path.join(__dirname, "ciclo-compra") });
  console.log(`        botao: ${c.botao} · aviso: ${c.aviso || "nenhum"}`);
  const temToken = await esperarSaldo(MINT, "positivo");
  console.log(`        a corrente confirma: ${temToken} ${SIMBOLO} na carteira`);
  if (!(temToken > 0)) throw new Error("a compra nao chegou na carteira");

  // --------------------------------------------------------------- 2. CALLOUT
  console.log("\n  [2/3] PUBLICANDO A CALL...");
  /* O formulario abre pelo menu Create, que so aparece direito com a pagina em
     estado limpo. Depois da compra sobra modal/toast na tela — entao volto pra
     home antes de comecar. Foi isso que fez a call falhar dentro do motor
     enquanto funcionava no ensaio, onde a pagina estava limpa. */
  /* NAO volto pra home: o Michel mostrou que a call se faz DA PAGINA DA MOEDA.
     Voltar pra home era o que me obrigava a caçar a moeda numa busca com dez
     homonimos. Depois da compra a aba ja esta onde precisa estar. */

  const nota = process.env.NOTA ||
    `Calling ${SIMBOLO} with my own money already in it. I bought it on the page and I will sell it ` +
    "on the page — every part of this is somewhere you can look.";
  const r = await callout.publicarCallout(page, {
    mint: MINT, simbolo: SIMBOLO, nota, publicar: true,
    prints: path.join(__dirname, "ciclo-callout"),
  });
  console.log(`        moeda: ${r.moeda} · botao: ${r.botao || "-"}`);
  console.log(`        publicada: ${r.publicado ? "SIM" : "NAO"}`);
  if (!r.publicado) {
    const t = (r.tela?.texto || "").split("\n").filter(Boolean).slice(0, 6).join(" | ");
    console.log(`        a tela dizia: ${t}`);
    falhou = "a call nao foi publicada";
  }

  // ----------------------------------------------------------------- 3. VENDA
  console.log("\n  [3/3] VENDENDO na tela...");
  const v = await trade.venderNaTela(page, { mint: MINT, pct: 100,
    prints: path.join(__dirname, "ciclo-venda") });
  console.log(`        botao: ${v.botao} · aviso: ${v.aviso || "nenhum"}`);
  const sobrou = await esperarSaldo(MINT, "zero", 60);
  console.log(`        a corrente confirma: ${sobrou} ${SIMBOLO} restante`);
  if (sobrou > 0) falhou = falhou || "a venda nao zerou a posicao";

  const solDepois = await saldoSol();
  console.log(`\n  SOL depois: ${solDepois.toFixed(4)} (${(solDepois - solAntes >= 0 ? "+" : "")}${(solDepois - solAntes).toFixed(4)})`);
} catch (e) {
  falhou = e.message;
} finally {
  await chrome.closeBrowser().catch(() => {});
}

console.log(`\n${linha}`);
console.log(falhou ? `  FALHOU: ${falhou}` : "  CICLO COMPLETO OK — compra, call e venda, todas na tela");
console.log(`${linha}\n`);
process.exit(falhou ? 1 : 0);
