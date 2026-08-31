// O que a Yuna VE na bussola da pump — a lista de onde ela escolhe a call.
//     ENV_FILE=.env.yuna node scripts/probe-explorar.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_SHOW = process.env.ENV_FILE || path.join(ROOT, ".env.yuna");
dotenv.config({ path: path.join(ROOT, ".env.example") });
dotenv.config({ path: path.join(ROOT, ".env"), override: true });
dotenv.config({ path: ENV_SHOW, override: true });
const chrome = await import("../src/lib/browser.js");
const { explorarPump, fotografar } = await import("../src/lib/callout-pump.js");
try {
  console.log("  sessao:", await chrome.garantirLoginPump("yuna"));
  const page = await chrome.identityPage("yuna");
  const moedas = await explorarPump(page);
  console.log(`\n  ${moedas.length} moedas na bussola:\n`);
  for (const m of moedas.slice(0, 16))
    console.log(`   ${(m.mcap || "?").padStart(7)}  ${(m.idade || "").padStart(4)}  ${m.mint.slice(0, 10)}…  ${m.texto.slice(0, 70)}`);
  console.log("\n  print:", await fotografar(page, path.join(__dirname, "explorar.png")));
} catch (e) { console.log("  ERRO:", e.message); }
finally { await chrome.closeBrowser().catch(() => {}); }
