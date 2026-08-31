// ============================================================================
// Confere a carteira de um agente SEM NUNCA IMPRIMIR A CHAVE.
//
// Le <ID>_SOL_KEYPAIR do ambiente, deriva o endereco publico e mostra so ele —
// mais o saldo, se houver RPC. A chave nao aparece na tela, no log, nem em
// lugar nenhum: o que sai daqui e o que qualquer um ja pode ver na corrente.
//
//     node scripts/probe-carteira.js yuna
// ============================================================================
import { load as loadWallet } from "../src/lib/signer.js";
import * as onchain from "../src/lib/wallet.js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(RAIZ, ".env") });
dotenv.config({ path: process.env.ENV_FILE || path.join(RAIZ, ".env.yuna"), override: true });

const id = (process.argv[2] || "yuna").toLowerCase();
const chave = id.toUpperCase() + "_SOL_KEYPAIR";
console.log(`\nagente: ${id}   ·   variavel: ${chave}`);

if (!process.env[chave]) {
  console.log(`\n  NAO ENCONTRADA. Ponha a chave privada em ${chave}, no .env.yuna.`);
  console.log("  Aceita os dois formatos que a Phantom exporta: base58, ou o");
  console.log("  array de 64 numeros do arquivo de keypair.\n");
  process.exit(1);
}

let w;
try { w = loadWallet(chave); }
catch (e) {
  console.log(`\n  A CHAVE ESTA LA MAS NAO FOI LIDA: ${e.message}`);
  console.log("  (a chave nao e impressa aqui — confira o formato no arquivo)\n");
  process.exit(1);
}

console.log(`  endereco publico: ${w.address}`);
try {
  const b = await onchain.getBalances(w.address);
  console.log(`  saldo: ${b.sol.toFixed(4)} SOL${b.usdc ? ` · ${b.usdc.toFixed(2)} USDC` : ""}`);
} catch (e) {
  console.log(`  saldo: nao consegui ler (${e.message})`);
}
console.log("\n  Confira se o endereco acima e o mesmo que a sua Phantom mostra.\n");
