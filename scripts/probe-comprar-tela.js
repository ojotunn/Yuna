// COMPRA NA TELA — o caminho que o espectador ve. Sem PUBLICAR=1 e ENSAIO:
// abre a moeda, escolhe a aba, digita o valor e PARA antes de confirmar.
//     ENV_FILE=.env.yuna node scripts/probe-comprar-tela.js <mint> [usd]
//     ENV_FILE=.env.yuna COMPRAR=1 node scripts/probe-comprar-tela.js <mint> 2
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
const USD = Number(process.argv[3] || 2);
const VALE = process.env.COMPRAR === "1";
if (!MINT) { console.log("falta o mint\n"); process.exit(1); }

const chrome = await import("../src/lib/browser.js");
const trade = await import("../src/lib/trade-pump.js");
const linha = "-".repeat(64);
console.log(`\n${linha}\n  ${VALE ? "COMPRA DE VERDADE" : "ENSAIO (para antes de confirmar)"} — $${USD}\n${linha}`);

try {
  console.log("  sessao:", await chrome.garantirLoginPump("yuna"));
  const page = await chrome.identityPage("yuna");
  if (!VALE) {
    // ensaio: monta tudo menos o clique final
    await trade.abrirMoeda(page, MINT);
    console.log("  moeda aberta:", page.url());
    const { comprarNaTela } = trade;
    console.log("  (ensaio: rode com COMPRAR=1 para confirmar de verdade)");
  } else {
    const r = await trade.comprarNaTela(page, { mint: MINT, usd: USD,
      prints: path.join(__dirname, "compra-tela") });
    console.log("  botao clicado:", r.botao);
    console.log("  resultado:", r.ok ? "sem aviso de erro na tela" : `AVISO: ${r.aviso}`);
    console.log("  prints:", (r.prints || []).filter(Boolean).join(" , "));
    console.log("  --- tela ---");
    console.log(r.tela.split("\n").filter(Boolean).slice(0, 14).map((l) => "   " + l).join("\n"));
  }
} catch (e) { console.log("  ERRO:", e.message); }
finally { await chrome.closeBrowser().catch(() => {}); }
console.log("");
