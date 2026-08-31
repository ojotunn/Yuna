// ============================================================================
// ENSAIO DE CALLOUT — monta a call inteira e PARA antes de publicar.
//
// Serve pra conferir o caminho de cliques sem soltar nada no mundo. Com
// PUBLICAR=1 ele vai ate o fim (acao publica: so com o Michel mandando).
//
//     ENV_FILE=.env.yuna node scripts/probe-callout-ensaio.js <mint>
//     ENV_FILE=.env.yuna PUBLICAR=1 node scripts/probe-callout-ensaio.js <mint>
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

const AGENTE = "yuna";
const MINT = process.argv[2] || "";
const PUBLICAR = process.env.PUBLICAR === "1";
const linha = "-".repeat(64);

const chrome = await import("../src/lib/browser.js");
const callout = await import("../src/lib/callout-pump.js");

console.log(`\n${linha}\n  ${PUBLICAR ? "CALLOUT DE VERDADE" : "ENSAIO DE CALLOUT"} — ${AGENTE}\n${linha}`);
if (!MINT) { console.log("  falta o mint: node scripts/probe-callout-ensaio.js <mint>\n"); process.exit(1); }

try {
  console.log("  sessao:", await chrome.garantirLoginPump(AGENTE));
  const page = await chrome.getAgentPage(AGENTE);   // a aba que a live mostra
  await page.bringToFront().catch(() => {});

  const nota = process.env.NOTA ||
    "testing my own hands here — small size, watching how the chart reacts before I say anything louder";

  const r = await callout.publicarCallout(page, {
    mint: MINT, simbolo: process.env.SIMBOLO || null, nota, publicar: PUBLICAR,
    prints: path.join(__dirname, "ensaio-callout"),
  });

  console.log(`  moeda escolhida: ${r.moeda}`);
  console.log(`  publicado: ${r.publicado ? "SIM" : (r.ensaio ? "nao — foi ensaio, parei antes do botao" : "nao")}`);
  console.log("  --- a tela no fim ---");
  console.log("  campos:", r.tela.campos.join(" | ") || "nenhum");
  console.log("  botoes:", r.tela.botoes.join(" | ") || "nenhum");
  console.log(r.tela.texto.split("\n").filter(Boolean).slice(0, 18).map((l) => "   " + l).join("\n"));
  console.log("  prints:", (r.prints || []).filter(Boolean).join(" , "));
} catch (e) {
  console.log("  ERRO:", e && e.message);
} finally {
  await chrome.closeBrowser().catch(() => {});
}
console.log("");
