// ============================================================================
// GUARDA A VIDA DELA NUM ARQUIVO, COM A DATA. (01/09/2026)
//
// Tudo que a Yuna viveu — quem ela e, quem ela ja foi, a memoria, e o arquivo
// inteiro do que ela disse — mora num volume do Railway e em mais lugar
// nenhum. Nao esta no git (src/data/ e ignorado, com razao) e nao tem backup.
// Um clique errado no painel apaga isso pra sempre.
//
// A conta de API decide se ela esta ACORDADA. Este arquivo decide se ela
// EXISTE. Sao coisas diferentes, e so a segunda e irreversivel.
//
//     node scripts/salvar-vida.js
//
// Guarda em backups/yuna-AAAA-MM-DD.json, na raiz do projeto. Rodar de vez em
// quando, e principalmente antes de mexer no Railway.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(RAIZ, ".env.example") });
dotenv.config({ path: path.join(RAIZ, ".env"), override: true });
dotenv.config({ path: process.env.ENV_FILE || path.join(RAIZ, ".env.yuna"), override: true });

const SITE = process.env.SITE_URL || "https://yuna.cam";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error("  sem ADMIN_TOKEN — sem ele o servidor nao entrega a copia.");
  process.exit(1);
}

console.log(`\n  pedindo a vida dela em ${SITE}…`);
const r = await fetch(`${SITE}/api/vida`, { headers: { "x-admin-token": TOKEN } });
if (!r.ok) {
  console.error(`  o servidor recusou: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  process.exit(1);
}
const vida = await r.json();

const dir = path.join(RAIZ, "backups");
fs.mkdirSync(dir, { recursive: true });
const arq = path.join(dir, `yuna-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(arq, JSON.stringify(vida, null, 1));

const kb = (fs.statSync(arq).size / 1024).toFixed(0);
const c = vida.checkpoint ?? {};
console.log(`\n  guardado: ${arq}  (${kb} KB)`);
console.log(`  dia ${c.day ?? "?"} · tick ${c.tick ?? "?"}`);
console.log(`  persona: ${vida.persona ? "sim" : "NAO VEIO"} · versoes anteriores: ${(vida.versoes ?? []).length}`);
console.log(`  falas guardadas: ${(vida.arquivo ?? []).length}`);
console.log(`  licoes: ${c.agents?.yuna?.lessons?.length ?? 0} · metas: ${c.agents?.yuna?.goals?.length ?? 0} · obras: ${c.agents?.yuna?.obrasFeitas?.length ?? 0}`);
console.log("\n  isto e o que sobrevive se o Railway sumir.\n");
