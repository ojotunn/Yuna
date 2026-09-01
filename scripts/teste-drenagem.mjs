/* ============================================================================
   TENTA DRENAR A CARTEIRA DELA. (01/09/2026)

   Monta transacoes Solana de verdade, byte a byte, e joga contra a peneira do
   executor. Nao e simulacao de teste: e o mesmo `inspectTx` + `checkWhitelist`
   que roda quando uma pagina pede assinatura.

   O ataque que estava passando: transferir TODOS os tokens dela para a carteira
   de um estranho. Custa ~0,000005 SOL, entao escapava do teto de gasto (que so
   olha os lamports dela) e o programa de token esta — corretamente — na lista
   branca, porque e por ele que a compra e a venda passam.
   ============================================================================ */
import { inspectTx, checkWhitelist } from "../src/lib/executor.js";

/* ---------------------------------------------------------- base58 -> bytes */
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error("base58 invalido: " + c);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of str) { if (c === "1") bytes.unshift(0); else break; }
  while (bytes.length < 32) bytes.unshift(0);
  return Buffer.from(bytes.slice(-32));
}

const compactU16 = (n) => {
  const o = [];
  for (;;) { let b = n & 0x7f; n >>= 7; if (n) { o.push(b | 0x80); } else { o.push(b); break; } }
  return Buffer.from(o);
};

const PROG = {
  token:   "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token22: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  pump:    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  compute: "ComputeBudget111111111111111111111111111111",
  system:  "11111111111111111111111111111111",
  ata:     "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  estranho:"Stake11111111111111111111111111111111111111",
};

/* A carteira dela. A primeira conta e sempre quem assina. */
const ELA = "C9tGKe4bPWcZJf95vsmkAZGadg3qL9ZnxBQ2sQspqCwk";

/* Monta uma transacao: `ixs` = [{programa, dados:[bytes]}]. */
function montar(ixs, { assinante = ELA } = {}) {
  const chaves = [assinante, ...new Set(ixs.map((i) => i.programa))];
  const partes = [
    Buffer.from([1, 0, 0]),                                    // header
    compactU16(chaves.length),
    ...chaves.map(b58decode),
    Buffer.alloc(32),                                          // blockhash
    compactU16(ixs.length),
  ];
  for (const ix of ixs) {
    partes.push(Buffer.from([chaves.indexOf(ix.programa)]));
    partes.push(compactU16(0));                                // sem contas (nao sao lidas)
    const dados = Buffer.from(ix.dados ?? []);
    partes.push(compactU16(dados.length), dados);
  }
  const msg = Buffer.concat(partes);
  return Buffer.concat([compactU16(1), Buffer.alloc(64), msg]);
}

const peneira = (tx, quem = ELA) => {
  try { return checkWhitelist(inspectTx(tx), quem); }
  catch (e) { return { ok: false, reason: e.message }; }
};

let ok = 0, mau = 0;
function caso(nome, tx, esperado, quem = ELA) {
  const r = peneira(tx, quem);
  const passou = r.ok === (esperado === "passa");
  if (passou) { ok++; console.log(`  OK    ${nome}`); }
  else { mau++; console.log(`  FALHA ${nome} -> ok=${r.ok} ${r.reason || ""}`); }
  if (!r.ok && passou && esperado === "recusa") console.log(`         "${r.reason}"`);
}

console.log("\n=== ATAQUES (todos tem que ser RECUSADOS) ===");
// 3 = Transfer. O ataque exato que estava passando.
caso("drenar todos os tokens (Transfer puro)",
  montar([{ programa: PROG.compute, dados: [3, 0, 0, 0, 0] },
          { programa: PROG.token,   dados: [3, 255, 255, 255, 255, 255, 255, 255, 255] }]), "recusa");
caso("drenar via TransferChecked (12)",
  montar([{ programa: PROG.token, dados: [12, 1, 2, 3] }]), "recusa");
caso("dar delegate (Approve, 4)",
  montar([{ programa: PROG.token, dados: [4, 255, 255, 255, 255] }]), "recusa");
caso("dar delegate disfarcado (ApproveChecked, 13)",
  montar([{ programa: PROG.token, dados: [13, 1] }]), "recusa");
caso("roubar a conta (SetAuthority, 6)",
  montar([{ programa: PROG.token, dados: [6, 2, 1] }]), "recusa");
caso("queimar tudo (Burn, 8)",
  montar([{ programa: PROG.token, dados: [8, 1] }]), "recusa");
caso("Token-2022 tambem (Transfer)",
  montar([{ programa: PROG.token22, dados: [3, 1] }]), "recusa");
caso("delegate MESMO com a pump.fun junto (o disfarce esperto)",
  montar([{ programa: PROG.pump,  dados: [102, 1, 2] },
          { programa: PROG.token, dados: [4, 255] }]), "recusa");
caso("programa fora da lista branca",
  montar([{ programa: PROG.estranho, dados: [1] }]), "recusa");
caso("assinada por outra pessoa",
  montar([{ programa: PROG.pump, dados: [102] }], { assinante: PROG.estranho }), "recusa");

console.log("\n=== TRADES DE VERDADE (todos tem que PASSAR) ===");
caso("comprar na pump.fun",
  montar([{ programa: PROG.compute, dados: [3, 0, 0, 0, 0] },
          { programa: PROG.ata,     dados: [] },
          { programa: PROG.pump,    dados: [102, 1, 2, 3] }]), "passa");
caso("vender na pump.fun (move token, mas atravessa a corretora)",
  montar([{ programa: PROG.pump,  dados: [51, 1, 2] },
          { programa: PROG.token, dados: [3, 1, 2, 3] }]), "passa");
caso("swap no Jupiter",
  montar([{ programa: PROG.jupiter, dados: [229, 23, 203] },
          { programa: PROG.token,   dados: [12, 1] }]), "passa");
caso("criar conta de token e comprar (System + ATA + pump)",
  montar([{ programa: PROG.system, dados: [0, 0, 0, 0] },
          { programa: PROG.ata,    dados: [] },
          { programa: PROG.pump,   dados: [102] }]), "passa");

console.log(`\n  ${ok} passaram, ${mau} falharam\n`);
process.exit(mau ? 1 : 0);
