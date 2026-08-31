// Testa garantirLoginPump(): a sessao da pump se mantem sozinha, sem humano.
//     ENV_FILE=.env.yuna node scripts/probe-login-auto.js
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
try {
  const r = await chrome.garantirLoginPump(process.argv[2] || "yuna");
  console.log("  garantirLoginPump:", r);
  console.log(r === "falhou" ? "\n  FALHOU\n" : "\n  SESSAO DE PE\n");
} catch (e) { console.log("  ERRO:", e.message); }
finally { await chrome.closeBrowser().catch(() => {}); }
