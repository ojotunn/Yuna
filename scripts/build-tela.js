// ============================================================================
// BUILD DA TELA DA YUNA — um comando, na ordem certa, com as variaveis certas.
//
// Por que existe (01/09/2026): empacotar a live dela sao dois passos e uma
// variavel de ambiente, e esquecer a variavel nao da erro — da uma live SEM os
// sprites dela. O empacotador nasceu pro Conatus e por isso o prefixo padrao
// dos sprites ainda e `sable`; sem `SPRITE_PREFIXO=yuna` o gesto de desenhar
// (que so existe como `yuna-desenhar-*`) simplesmente nao entra, em silencio.
// Perdi um empacotamento assim.
//
// A ordem tambem importa: `finalizar-live` injeta o CSS de cinema no arquivo
// pronto, entao tem que rodar DEPOIS do empacotador — inverter apaga o bloco.
//
//     node scripts/build-live-yuna.js
// ============================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
/* A FONTE DA TELA MORA NO REPO DA YUNA. (02/09/2026)
   Antes apontava pra uma pasta de sessao em AppData\Local\Temp — limpou a
   pasta, o build morria e a origem da tela sumia junto. O yuna-live.html e um
   EMPACOTADO de 3,3 MB; nao da pra voltar dele pro template.
   Fica no repo dela e nao no do agent-arena de proposito: aquele e o Conatus,
   e a tela e dela. */
const TEMPLATE = process.env.TEMPLATE_YUNA || path.join(RAIZ, "tela", "template.html");
/* UM destino agora: a propria casa dela. Antes eram dois porque o build
   morava no repo do Conatus e precisava copiar pra ca. */
const DESTINOS = [path.join(RAIZ, "public", "yuna-live.html")];

function passo(rotulo, cmd, args, env = {}) {
  process.stdout.write(`  ${rotulo}… `);
  const r = spawnSync(cmd, args, {
    cwd: RAIZ,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.log("FALHOU");
    console.log((r.stdout || "") + (r.stderr || ""));
    process.exit(1);
  }
  return r.stdout || "";
}

if (!fs.existsSync(TEMPLATE)) {
  console.error(`  template nao encontrado: ${TEMPLATE}`);
  process.exit(1);
}

const saida = passo("empacotando o quarto", "python",
  ["scripts/empacotar-artifact.py", TEMPLATE, DESTINOS[0]],
  { SPRITE_PREFIXO: "yuna" });

/* Um gesto que nao entrou nao para o build — mas TEM que aparecer, senao a
   live vai ao ar sem a pose e ninguem descobre ate ver a tela. */
const gestos = [...saida.matchAll(/^gesto (\w+):/gm)].map((m) => m[1]);
console.log("OK");
console.log(`  gestos empacotados: ${gestos.length ? gestos.join(", ") : "NENHUM"}`);
if (!gestos.includes("desenhar"))
  console.log("  !! sem o gesto `desenhar` — ela vai aparecer EM PE no tapete");

passo("aplicando a tela de cinema", "python",
  ["scripts/finalizar-live.py", DESTINOS[0]]);
console.log("OK");

for (const d of DESTINOS.slice(1)) fs.copyFileSync(DESTINOS[0], d);
const mb = (fs.statSync(DESTINOS[0]).size / 1048576).toFixed(2);
console.log(`  ${mb} MB -> ${DESTINOS.length} destino(s)`);
