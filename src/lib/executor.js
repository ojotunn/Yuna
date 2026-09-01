// ============================================================================
// O EXECUTOR REAL — a unica porta por onde o valor dos agentes se MOVE, e ela
// so abre pra dentro da propria carteira.
//
// O `signer.js` recusa assinar qualquer coisa que nao seja texto, e diz no
// comentario: "se um dia precisar, sera uma decisao explicita do Michel, num
// modulo separado, com o executor no meio". Este e esse modulo. A decisao foi
// tomada em 12/08/2026: os trades passam a ser REAIS na pump.fun, porque
// "na vida real nao existe simulacao".
//
// A TRAVA CONTINUA DE PE, e agora ela e VERIFICADA, nao apenas ausente:
//
//   1. O agente nunca ve a chave nem monta transacao. Ele PROPOE; o broker
//      aprova por regra; aqui a transacao e montada, conferida e assinada.
//   2. LISTA BRANCA de programas: se a transacao tocar qualquer programa fora
//      do conjunto {pump, pump-amm, Token, ATA, System, ComputeBudget, Memo},
//      e recusada. Isso mata Approve/SetAuthority/delegate na origem.
//   3. SIMULACAO antes de assinar: a transacao roda no RPC e o executor compara
//      os DELTAS DE SALDO. Se a carteira perder mais SOL do que o combinado,
//      e recusada — nao importa como o ataque tenha sido montado.
//   4. TETO DURO em dolar por operacao (MAX_REAL_TRADE_USD), independente do
//      que o agente pediu e do que o broker aprovou.
//
// Nao existe aqui: transferir para terceiro, sacar, aprovar delegate, assinar
// transacao arbitraria. O que existe e trocar SOL por token e token por SOL,
// dentro da carteira do proprio agente.
//
// Zero dependencia nova: a transacao vem serializada do PumpPortal e a
// assinatura e ed25519 do node:crypto, o mesmo que o signer.js ja usa.
// ============================================================================

import crypto from "node:crypto";
import { b58encode, b58decode } from "./signer.js";

const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";
const rpcUrl = () => process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

// ---------------------------- a lista branca --------------------------------
// Todo programa que a transacao pode tocar. Em transacao versionada (v0) o
// program id NUNCA pode vir de address lookup table — a propria Solana exige
// que esteja nas contas estaticas. Entao ler as estaticas basta.
// Cada entrada aqui foi VERIFICADA on-chain em 12/08/2026 (dono da bonding
// curve, autoridade de upgrade), nao copiada de tutorial.
const ALLOWED_PROGRAMS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",  // pump.fun — confirmado: e o DONO da conta da bonding curve
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",  // pump AMM (token graduado) — mesma autoridade da pump
  "FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe", // PumpPortal (router + taxa 0,5%) — ver nota abaixo
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  // Token-2022 — ver nota abaixo
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "11111111111111111111111111111111",             // System (criar conta, wrap SOL)
  "ComputeBudget111111111111111111111111111111",  // taxa de prioridade
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",  // Memo
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter v6 — ver nota abaixo
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",  // Jupiter v4 (rotas antigas)
]);
//
// JUPITER entrou em 31/08/2026, e a descoberta foi por ironia: eu tinha acabado
// de ensinar a Yuna a so comprar moeda de onde as pessoas CONSEGUEM SAIR — as
// antigas, ja graduadas, com centenas de vendas — e essas sao exatamente as que
// a pump.fun roteia pelo Jupiter, porque nao estao mais na curva nem no pump
// AMM. A lista branca entao recusava justamente as moedas boas e deixava passar
// so as recem-lancadas. "programa fora da lista branca: JUP6Lkb..." era a minha
// propria protecao trabalhando contra o criterio que eu tinha escrito.
//
// O Jupiter e um AGREGADOR: ele roteia por qualquer pool. Confiar no programa
// nao e confiar no destino. Quem protege aqui nao e esta lista e sim a
// SIMULACAO — `simulateAndCheck` mede quanto SOL sai de verdade e recusa acima
// do teto. Uma rota maluca gasta o mesmo teto que uma rota boa; o que ela nao
// consegue e tirar mais dinheiro do que o combinado.
//
// TOKEN-2022 entrou na lista (antes era recusa automatica). Motivo: em
// 12/08/2026 a maioria dos tokens da pump.fun ja e Token-2022 usando SO
// extensoes de metadata — recusar o programa bloquearia o mercado inteiro e
// ainda deixava passar honeypot de SPL comum (freeze authority). Quem julga
// agora e `wallet.inspectMint`, que le as EXTENSOES do mint e reprova transfer
// hook, permanent delegate, taxa de transferencia, non-transferable e freeze.
// Checagem mais precisa e mais abrangente do que a regra que ela substituiu.
//
// PUMPPORTAL (FAdo9NCw) e um TERCEIRO: e o programa deles que roteia a ordem e
// cobra os 0,5%. A autoridade de upgrade e diferente da pump.fun oficial, entao
// ele pode mudar sem aviso. Por isso ele NAO e confiado — e apenas tolerado:
// quem realmente segura a porta e a SIMULACAO com conferencia de delta logo
// abaixo. Se um dia esse programa tentar levar mais do que o combinado, a
// transacao e recusada antes de ser assinada.

async function rpc(method, params) {
  const r = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${j.error.message}`);
  return j.result;
}

// --------------------- leitura da transacao serializada ---------------------

// compact-u16 (shortvec): ate 3 bytes, 7 bits uteis cada, bit 8 = continua.
function readCompactU16(buf, off) {
  let val = 0, shift = 0, i = off;
  for (;;) {
    if (i >= buf.length) throw new Error("transacao truncada");
    const b = buf[i++];
    val |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 14) throw new Error("compact-u16 invalido");
  }
  return { val, off: i };
}

// Separa [assinaturas][mensagem] e devolve os program ids que a mensagem toca
// E O PRIMEIRO BYTE DE CADA INSTRUCAO. Aceita transacao versionada (v0) e legada.
//
// O primeiro byte passou a importar em 01/09/2026: sem ele, "o programa esta na
// lista branca" era a unica pergunta feita, e `Transfer`, `Approve` e
// `SetAuthority` sao instrucoes do MESMO programa de token por onde a compra
// legitima passa. Ler o discriminador e a diferenca entre vender uma moeda e
// entregar a carteira.
export function inspectTx(bytes) {
  const buf = Buffer.from(bytes);
  const { val: nSigs, off: afterCount } = readCompactU16(buf, 0);
  if (nSigs !== 1) throw new Error(`transacao exige ${nSigs} assinaturas — esperado exatamente 1`);
  const sigOffset = afterCount;
  const msgOffset = afterCount + 64 * nSigs;
  const msg = buf.subarray(msgOffset);
  if (!msg.length) throw new Error("mensagem vazia");

  let p = 0;
  let versioned = false;
  if (msg[0] & 0x80) { // prefixo de versao (0x80 = v0)
    if ((msg[0] & 0x7f) !== 0) throw new Error(`versao de transacao nao suportada: ${msg[0] & 0x7f}`);
    versioned = true;
    p = 1;
  }
  p += 3; // header: numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned

  const { val: nKeys, off: afterKeys } = readCompactU16(msg, p);
  p = afterKeys;
  const keys = [];
  for (let i = 0; i < nKeys; i++) {
    keys.push(b58encode(msg.subarray(p, p + 32)));
    p += 32;
  }
  p += 32; // recent blockhash

  const { val: nIx, off: afterIx } = readCompactU16(msg, p);
  p = afterIx;
  const programs = [];
  const instrucoes = [];
  for (let i = 0; i < nIx; i++) {
    const programIdIndex = msg[p++];
    if (programIdIndex >= keys.length)
      throw new Error("program id fora das contas estaticas — recusado por principio");
    programs.push(keys[programIdIndex]);
    const { val: nAcc, off: a1 } = readCompactU16(msg, p);
    p = a1 + nAcc;
    const { val: dataLen, off: a2 } = readCompactU16(msg, p);
    /* So o discriminador. Nao decodifico argumento nenhum: quanto menos este
       parser entender, menos ele erra. Instrucao sem dados vira null. */
    instrucoes.push({
      programa: keys[programIdIndex],
      op: dataLen > 0 ? msg[a2] : null,
    });
    p = a2 + dataLen;
  }

  return { versioned, nSigs, sigOffset, msgOffset, message: msg, keys, programs,
           instrucoes, signer: keys[0] };
}

/* OS DOIS PROGRAMAS DE TOKEN e as corretoras. A separacao existe por causa da
   regra logo abaixo: token so se move ATRAVESSANDO uma corretora. */
const PROGRAMAS_TOKEN = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  // Token-2022
]);
const CORRETORAS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",  // pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",  // pump AMM
  "FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe", // PumpPortal
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter v6
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",  // Jupiter v4
]);

/* Instrucoes do programa de token que ENTREGAM a carteira a outra pessoa.
   Numeracao do SPL Token (o primeiro byte dos dados), igual no Token-2022. */
const DELEGAR = new Map([
  [4,  "Approve"],         // da a um terceiro o direito de mover os tokens dela
  [6,  "SetAuthority"],    // troca o dono da conta de token
  [13, "ApproveChecked"],
]);
const MOVER = new Map([
  [3,  "Transfer"],
  [8,  "Burn"],
  [9,  "CloseAccount"],
  [12, "TransferChecked"],
]);

/* ONDE ESTA CARTEIRA ASSINA — e em mais lugar nenhum.
   Ela navega a internet inteira o dia todo: foruns, agregadores, qualquer link
   que aparecer no chat da live. Um site que pede assinatura fora desta lista
   nao e um site que ela deveria estar usando, e a distancia entre "pediu" e
   "conseguiu" e a carteira dela inteira.

   Mora AQUI, e nao em cada ponte, porque existem duas pontes de carteira
   (carteira-navegador.js e livetrade.js) e as duas precisam concordar. Quando
   a lista estava so numa delas, a outra assinava em qualquer lugar. */
export const ORIGENS_PERMITIDAS = ["pump.fun", "jup.ag", "jupiter.exchange"];

export function origemPermitida(url) {
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase(); } catch { return { ok: false, host: "" }; }
  /* `endsWith("." + d)` e nao `includes(d)`: `pump.fun.golpe.com` contem
     "pump.fun" e nao e a pump.fun. O ponto na frente e o que separa subdominio
     de dominio parecido. */
  const ok = ORIGENS_PERMITIDAS.some((d) => host === d || host.endsWith("." + d));
  return { ok, host };
}

// A peneira estrutural: todo programa tocado tem que estar na lista branca,
// quem assina tem que ser o proprio agente, e o que a transacao FAZ com os
// tokens tem que ser um trade — nao uma entrega.
export function checkWhitelist(info, expectedSigner) {
  if (info.signer !== expectedSigner)
    return { ok: false, reason: `this would be signed by ${info.signer}, not by the agent` };
  for (const prog of info.programs) {
    if (!ALLOWED_PROGRAMS.has(prog))
      return { ok: false, reason: `program not on the allowlist: ${prog}` };
  }

  /* DELEGAR E SEMPRE NAO — com corretora ou sem.
     Nenhum swap em Solana precisa de aprovacao previa: quem assina a transacao
     ja autoriza aquele movimento, e so aquele. Delegate e vicio de EVM, e em
     Solana e a assinatura predileta de quem drena carteira, porque parece
     inofensiva e vale para sempre. */
  for (const ix of info.instrucoes ?? []) {
    if (!PROGRAMAS_TOKEN.has(ix.programa)) continue;
    const nome = DELEGAR.get(ix.op);
    if (nome)
      return { ok: false, reason:
        `this asks for ${nome} — handing someone else power over her tokens. No trade needs that.` };
  }

  /* TOKEN SO SE MOVE ATRAVESSANDO UMA CORRETORA.
     Toda compra e toda venda de verdade passam pela pump.fun, pela pump AMM,
     pelo PumpPortal ou pelo Jupiter — e por isso que essas transacoes existem.
     Uma transferencia para a carteira de um estranho nao passa por nenhuma:
     ela toca so o programa de token, custa ~0,000005 SOL e por isso escapava
     do teto de gasto, que so olha os lamports dela. */
  const move = (info.instrucoes ?? []).filter(
    (ix) => PROGRAMAS_TOKEN.has(ix.programa) && MOVER.has(ix.op));
  if (move.length && !info.programs.some((prog) => CORRETORAS.has(prog))) {
    const quais = [...new Set(move.map((ix) => MOVER.get(ix.op)))].join(", ");
    return { ok: false, reason:
      `this moves tokens (${quais}) without going through any exchange — that is a transfer, not a trade` };
  }
  return { ok: true };
}

// ------------------------------- assinatura ---------------------------------

// Semente crua -> chave ed25519 (mesmo envelope PKCS8 do signer.js).
function keyFromSeed(seed) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]);
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

// Assina a MENSAGEM e escreve a assinatura no lugar reservado. A transacao ja
// vem montada com um slot de 64 bytes zerados — e ali que a assinatura entra.
function signTx(bytes, info, keypairRaw) {
  const s = String(keypairRaw ?? "").trim();
  const raw = s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : b58decode(s);
  if (raw.length !== 64) throw new Error("keypair deve ter 64 bytes");
  const pub = b58encode(raw.slice(32, 64));
  if (pub !== info.signer) throw new Error("a chave nao corresponde ao assinante da transacao");
  const sig = crypto.sign(null, Buffer.from(info.message), keyFromSeed(raw.slice(0, 32)));
  const out = Buffer.from(bytes);
  Buffer.from(sig).copy(out, info.sigOffset);
  return out;
}

// ------------------------------- o caminho ----------------------------------

// Monta a transacao no PumpPortal. Devolve os bytes crus — nada assinado.
// `pool`: "pump" (bonding curve) ou "pump-amm" (token graduado).
async function buildTrade({ owner, action, mint, amount, denominatedInSol, slippage, priorityFee, pool }) {
  const r = await fetch(PUMPPORTAL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publicKey: owner, action, mint, amount,
      denominatedInSol: denominatedInSol ? "true" : "false",
      slippage, priorityFee, pool,
    }),
  });
  if (!r.ok) throw new Error(`PumpPortal HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100) throw new Error(`PumpPortal devolveu ${buf.length} bytes — nao e transacao`);
  return buf;
}

// SIMULA e confere os DELTAS. E a defesa que nao depende de entender a
// instrucao: se a carteira perder mais SOL do que o combinado, recusa.
export async function simulateAndCheck(txBytes, { owner, maxSolSpend }) {
  const sim = await rpc("simulateTransaction", [
    Buffer.from(txBytes).toString("base64"),
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "processed",
      accounts: { encoding: "base64", addresses: [owner] },
    },
  ]);
  const v = sim?.value;
  if (!v) return { ok: false, reason: "the RPC returned no simulation" };
  if (v.err) {
    const log = (v.logs ?? []).slice(-3).join(" | ").slice(0, 200);
    return { ok: false, reason: `the transaction would fail: ${JSON.stringify(v.err)}${log ? ` — ${log}` : ""}` };
  }
  const post = v.accounts?.[0]?.lamports;
  if (post == null) return { ok: false, reason: "the simulation returned no post-balance — I do not sign blind" };
  const pre = (await rpc("getBalance", [owner]))?.value ?? 0;
  const spentSol = (pre - post) / 1e9;
  // Teto com folga pequena para taxa de rede/prioridade (0.01 SOL).
  if (spentSol > maxSolSpend + 0.01)
    return { ok: false, reason: `this would spend ${spentSol.toFixed(4)} SOL, over the ${maxSolSpend.toFixed(4)} cap` };
  return { ok: true, spentSol, units: v.unitsConsumed ?? null };
}

// Envia e espera confirmar. Devolve a assinatura (o link do Solscan).
async function sendAndConfirm(signed, { timeoutMs = 45000 } = {}) {
  const sig = await rpc("sendTransaction", [
    Buffer.from(signed).toString("base64"),
    { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" },
  ]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = (await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]))?.value?.[0];
    if (st?.err) throw new Error(`transacao falhou on-chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
      return { signature: sig, status: st.confirmationStatus };
    }
  }
  // Nao confirmou a tempo: PODE ter passado. Devolve a assinatura pra conferir.
  return { signature: sig, status: "unconfirmed" };
}

// ---------------------------------------------------------------------------
// O PORTAO — para transacao que a PAGINA montou (o agente clicando "buy" na
// pump.fun, ao vivo). Este e o caminho novo, e o mais exposto: aqui a
// transacao nao foi pedida por nos, foi entregue por um site.
//
// Por isso ela passa pela MESMA barreira que ja protege o caminho do
// PumpPortal — que tambem e um terceiro montando transacao:
//   1. estrutura (1 assinatura, e do agente)
//   2. lista branca de programas
//   3. simulacao + delta de saldo dentro do teto
// So depois disso a chave e usada. Recusa e resposta legivel, nao excecao.
// ---------------------------------------------------------------------------
export async function approveAndSign(txBytes, { owner, keypairEnvKey, maxSolSpend }) {
  try {
    const info = inspectTx(txBytes);
    const wl = checkWhitelist(info, owner);
    if (!wl.ok) return { ok: false, reason: wl.reason };
    const sim = await simulateAndCheck(txBytes, { owner, maxSolSpend });
    if (!sim.ok) return { ok: false, reason: sim.reason };
    const keypair = process.env[keypairEnvKey];
    if (!keypair) return { ok: false, reason: `${keypairEnvKey} is not configured` };
    const signed = signTx(txBytes, info, keypair);
    return {
      ok: true, signed, spentSol: sim.spentSol,
      programs: [...new Set(info.programs)],
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Envia uma transacao ja assinada e espera confirmar (usado pelo caminho da
// pagina, quando o site pede signAndSend).
export async function sendSigned(signed) {
  try {
    const r = await sendAndConfirm(signed);
    return { ok: true, ...r, url: `https://solscan.io/tx/${r.signature}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---------------------------------------------------------------------------
// A FUNCAO PUBLICA. Uma so, e ela so faz uma coisa: trocar, na carteira do
// proprio agente. `usd` e o tamanho em dolar; `solUsd` converte; `keypairEnvKey`
// e o NOME da variavel de ambiente (o valor nunca circula fora daqui).
//
// Devolve { ok, signature, spentSol, reason }. Nunca lanca pra fora do try do
// chamador sem motivo legivel — recusa e informacao, nao excecao.
// ---------------------------------------------------------------------------
/* DA PRA TENTAR DE NOVO?
   Verdadeiro so quando e certo que NENHUMA transacao valida ficou na rede.
   Na duvida, falso: nao comprar de novo e um prejuizo de oportunidade;
   comprar duas vezes e um prejuizo de dinheiro. */
export function daPraTentarDeNovo(motivo) {
  const m = String(motivo || "").toLowerCase();

  /* Recusa NOSSA, por principio — tentar de novo so repete a recusa. */
  if (/lista branca|assinada por|transferencia, nao trade|approve|setauthority/.test(m))
    return false;
  /* Nao ha o que reamostrar: falta dinheiro ou falta configuracao. */
  if (/insufficient|nao configurada|sem endereco|tamanho invalido|sem preco do sol/.test(m))
    return false;

  /* O PRECO ANDOU. E o caso do Michel, e o mais comum numa moeda nova:
     `TooMuchSolRequired` (compra) e `TooLittleSolReceived` (venda) sao os
     nomes que o programa da pump.fun devolve; 0x1772 e o mesmo erro em codigo. */
  if (/slippage|toomuchsolrequired|toolittlesolreceived|0x1772|exceeded/.test(m))
    return true;
  /* Nada saiu: o intermediario ou a rede falhou ANTES do envio. */
  if (/pumpportal|http (429|5\d\d)|fetch failed|timeout|econn|socket|blockhash/.test(m))
    return true;
  /* A CORRENTE rejeitou a transacao. Rejeitada e definitivo: nao existe uma
     transacao valida pendente com essa assinatura. */
  if (/transacao falhou on-chain/.test(m))
    return true;
  /* A simulacao recusou por gasto acima do teto: com a tolerancia maior o teto
     tambem sobe (ver o laco em `trade`), entao vale mais uma tentativa. */
  if (/acima do teto/.test(m))
    return true;

  return false;
}

export async function trade({
  owner, keypairEnvKey, action, mint, usd, solUsd, graduated = false,
  maxRealTradeUsd = 1, slippage = null, priorityFee = 0.00001, sellPercent = null,
  tentativas = null,
}) {
  /* A ESCADA DE TOLERANCIA. Cada tentativa aceita um pouco mais de escorregao
     que a anterior — a primeira e apertada de proposito, porque na maioria das
     vezes ela basta e paga o melhor preco. O teto de tentativas e baixo: se
     tres nao pegaram, o mercado esta se movendo rapido demais para o tamanho
     dela e insistir e pior que esperar o proximo turno. */
  const ESCADA = (process.env.SLIPPAGE_ESCADA || "10,18,30")
    .split(",").map((x) => Number(x.trim())).filter((x) => x > 0 && x <= 50);
  const escada = slippage != null ? [Number(slippage)] : (ESCADA.length ? ESCADA : [10, 18, 30]);
  const limite = Math.min(Number(tentativas) || escada.length, escada.length);

  const tentadas = [];
  for (let i = 0; i < limite; i++) {
    const r = await tentarTrade({
      owner, keypairEnvKey, action, mint, usd, solUsd, graduated,
      maxRealTradeUsd, slippage: escada[i], priorityFee, sellPercent,
    });
    tentadas.push({ slippage: escada[i], ok: r.ok, motivo: r.reason ?? null });
    if (r.ok) return { ...r, tentativas: tentadas };

    /* NAO INSISTE NO QUE NAO ADIANTA. Recusa por principio, falta de saldo ou
       erro de configuracao devolvem o mesmo resultado na proxima tentativa —
       e cada tentativa custa uma chamada de rede e alguns segundos de live. */
    if (!daPraTentarDeNovo(r.reason)) return { ...r, tentativas: tentadas };
    if (i < limite - 1) {
      /* Uma pausa curta: o bloco seguinte traz preco novo, e martelar o RPC no
         mesmo instante so repete a mesma leitura. */
      await new Promise((espera) => setTimeout(espera, 1200));
    }
  }

  const ultima = tentadas[tentadas.length - 1];
  return {
    ok: false,
    reason: `${ultima?.motivo || "it did not go through"} — tried ${tentadas.length}x, ` +
            `at ${tentadas.map((t) => t.slippage + "%").join(", ")} slippage`,
    tentativas: tentadas,
  };
}

/* UMA tentativa. Foi extraida de `trade` para o laco acima poder repeti-la sem
   duplicar nada — o corpo e exatamente o que existia antes. */
async function tentarTrade({
  owner, keypairEnvKey, action, mint, usd, solUsd, graduated,
  maxRealTradeUsd, slippage, priorityFee, sellPercent,
}) {
  try {
    if (!owner) return { ok: false, reason: "no wallet address for this agent" };
    const keypair = process.env[keypairEnvKey];
    if (!keypair) return { ok: false, reason: `${keypairEnvKey} is not configured` };
    if (!(solUsd > 0)) return { ok: false, reason: "no SOL price to size this with" };

    // TETO DURO em dolar — vale mesmo que o broker tenha aprovado mais.
    // 0 = sem teto: o broker ja limitou pelo % da carteira real e pela curva.
    const sizeUsd = maxRealTradeUsd > 0
      ? Math.min(Number(usd) || 0, maxRealTradeUsd)
      : (Number(usd) || 0);
    if (action === "buy" && !(sizeUsd > 0)) return { ok: false, reason: "invalid size" };
    const amountSol = sizeUsd / solUsd;

    // Compra: amount em SOL. Venda: percentual do que tem do token.
    const isBuy = action === "buy";
    const amount = isBuy ? Number(amountSol.toFixed(6)) : (sellPercent ?? "100%");

    const txBytes = await buildTrade({
      owner, action, mint, amount,
      denominatedInSol: isBuy,
      slippage, priorityFee,
      pool: graduated ? "pump-amm" : "pump",
    });

    // 1) peneira estrutural
    const info = inspectTx(txBytes);
    const wl = checkWhitelist(info, owner);
    if (!wl.ok) return { ok: false, reason: `REFUSED — ${wl.reason}` };

    /* 2) simulacao + deltas (na venda o SOL so entra, entao o teto e a taxa)
       O TETO ACOMPANHA A TOLERANCIA: era `* 1.2` fixo, e com a escada de
       slippage a tentativa de 30% seria recusada pela nossa propria peneira
       ("gastaria X SOL acima do teto") — o retry brigaria com a trava em vez
       de usar. Continua sendo teto DURO: a folga e a tolerancia pedida mais
       5% de taxa, nunca um cheque em branco. */
    const maxSolSpend = isBuy ? amountSol * (1 + (Number(slippage) || 10) / 100 + 0.05) : 0;
    const sim = await simulateAndCheck(txBytes, { owner, maxSolSpend });
    if (!sim.ok) return { ok: false, reason: `REFUSED — ${sim.reason}` };

    // 3) assina e envia
    const signed = signTx(txBytes, info, keypair);
    const sent = await sendAndConfirm(signed);
    return {
      ok: true,
      signature: sent.signature,
      status: sent.status,
      spentSol: sim.spentSol,
      sizeUsd,
      url: `https://solscan.io/tx/${sent.signature}`,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Para teste: expõe a lista branca sem permitir edicao.
export const _allowedPrograms = () => [...ALLOWED_PROGRAMS];
