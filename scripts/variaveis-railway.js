// ============================================================================
// GERA O BLOCO DE VARIAVEIS PRO RAILWAY, juntando os dois .env.
//
// Por que existe (01/09/2026): a chave da Anthropic e as do Browserbase moram
// no `.env` da RAIZ (herdadas do Conatus), e o `.env.yuna` so tem o que e
// especifico dela. Quem colasse so o `.env.yuna` no Railway subiria uma Yuna
// sem chave de API e sem navegador — e o erro so apareceria com o show no ar.
//
// O que este script NAO deixa passar, e e o motivo principal de existir:
// as chaves privadas do Sable e do Rook estao no mesmo `.env` da raiz. Copiar o
// arquivo inteiro pro painel do Railway publicaria a carteira de outros dois
// agentes num servico que nao e deles. A lista de exclusao abaixo e explicita.
//
//     node scripts/variaveis-railway.js
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const SAIDA = path.join(RAIZ, "RAILWAY-VARIAVEIS.txt");

/* NAO VAI. Cada linha tem um motivo, e nenhum e "por via das duvidas". */
const FORA = [
  [/^(SABLE|ROOK)_/, "carteira e X de outro agente — nao e dela"],
  [/^MAX_TRADE_PCT_(SABLE|ROOK)$/, "teto de trade de outro agente"],
  [/^(REBUTTAL_TICKS|ROOM_POST_COOLDOWN_TICKS)$/, "debate entre agentes; ela mora sozinha"],
  [/^GEMINI_API_KEY$/, "geracao de imagem roda na maquina de casa, nao no Railway"],
  [/^(ATELIER_DIR|ACERVO_DIR)$/, "caminho do ateliê local — reescrito abaixo"],
  [/^PORT$/, "o Railway define a porta sozinho"],
  [/^ENV_FILE$/, "aponta pra arquivo local"],
];

/* VAI, mesmo estando so no .env da raiz. Sem estas ela sobe quebrada. */
const PUXAR_DA_RAIZ = [
  "ANTHROPIC_API_KEY", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID",
  "SOLANA_RPC", "MODEL", "EFFORT", "SCHEDULE", "SHIFTS",
  "DAILY_LOSS_LIMIT_PCT", "MAX_POOL_PCT", "MIN_POOL_USD", "CONVICTION_OVERRIDE",
  "TICK_SECONDS", "TICKS_PER_DAY", "DAY_HOURS", "CHAT_MSGS_PER_TURN",
  "SEASON_START_USD", "TREASURY_USD", "RENT_MULTIPLIER", "HOUSE_NOTE",
  "OWNER_WALLET", "BANK_SOL_PUBKEY", "ADMIN_TOKEN",
  "INTERVENTIONS_PER_DAY", "RUGCHECK_PER_DAY",
  /* Achadas na varredura de pre-voo (01/09/2026): sem AUTOSTART o motor nao
     nasce depois do restart do lancamento, e sem TZ ela dorme as 21h de
     Brasilia — em cima da plateia. Nenhuma das duas dava erro. */
  "AUTOSTART", "TZ",
];

/* REESCRITAS pro ambiente do Railway. */
const NO_RAILWAY = {
  SITE_URL: "https://yuna.cam",
  ACERVO_DIR: "/app/src/data/acervo",
  STATE_FILE: "/app/src/data/state-yuna.json",
  CHECKPOINT_FILE: "/app/src/data/checkpoint-yuna.json",
};

function ler(p) {
  const m = new Map();
  try {
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!l.includes("=") || l.trim().startsWith("#")) continue;
      const i = l.indexOf("=");
      m.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
    }
  } catch { /* arquivo pode nao existir */ }
  return m;
}

const raiz = ler(path.join(RAIZ, ".env"));
const dela = ler(path.join(RAIZ, ".env.yuna"));

const saida = new Map();
const excluidas = [];

/* 1. tudo do .env.yuna (e o dela, tem prioridade) */
for (const [k, v] of dela) {
  const fora = FORA.find(([re]) => re.test(k));
  if (fora) { excluidas.push([k, fora[1]]); continue; }
  saida.set(k, v);
}
/* 2. o que falta, puxado da raiz */
for (const k of PUXAR_DA_RAIZ) {
  if (saida.has(k) || !raiz.has(k)) continue;
  const fora = FORA.find(([re]) => re.test(k));
  if (fora) { excluidas.push([k, fora[1]]); continue; }
  saida.set(k, raiz.get(k));
}
/* 3. as do ambiente do Railway, por cima */
for (const [k, v] of Object.entries(NO_RAILWAY)) saida.set(k, v);

const faltando = ["ANTHROPIC_API_KEY", "BROWSERBASE_API_KEY", "YUNA_SOL_KEYPAIR"]
  .filter((k) => !saida.get(k));

const cabecalho = [
  "# VARIAVEIS DA YUNA PARA O RAILWAY",
  "# Gerado por scripts/variaveis-railway.js — NAO vai pro git (tem chave dentro).",
  "#",
  "# Cole isto em Variables > RAW Editor no servico do Railway.",
  "#",
  "# ANTES DE SUBIR, no mesmo servico:",
  "#   Settings > Volumes > Add Volume  ->  mount path  /app/src/data",
  "#   (NAO /data: carteira, memoria e persona usam caminho fixo src/data/,",
  "#    e montar no lugar errado apaga a carteira dela a cada deploy)",
  "#",
  "# O DESENHO RODA NO RAILWAY (desde 01/09): as gravacoes viajam no deploy e o",
  "# proprio servidor reproduz. O que continua so em casa e CALCULAR a obra (o",
  "# modelo de imagem precisa da GPU) — reproduzir nao precisa.",
  "#",
  "# A JORNADA conta do lancamento: POST /api/lancar marca a hora, e dali sao",
  "# 16 acordada e 8 dormindo. Reinicie o servico depois (a marca e lida no boot).",
  "",
].join("\n");

const corpo = [...saida.entries()].sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `${k}=${v}`).join("\n");

fs.writeFileSync(SAIDA, cabecalho + corpo + "\n");

console.log(`  ${saida.size} variaveis -> RAILWAY-VARIAVEIS.txt`);
console.log(`  ${excluidas.length} excluidas de proposito:`);
for (const [k, porque] of excluidas) console.log(`   ${k.padEnd(24)} ${porque}`);
if (faltando.length) {
  console.log(`\n  !! FALTANDO (ela sobe quebrada): ${faltando.join(", ")}`);
} else {
  console.log("\n  as tres essenciais estao la (chave da API, Browserbase, carteira dela)");
}
