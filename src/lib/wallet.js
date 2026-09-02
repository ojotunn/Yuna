// ============================================================================
// Leitura de carteira — somente leitura, so precisa do endereco publico.
//
// E aqui que "ganho por trabalho" deixa de ser aspiracao. Em vez de integrar
// com cada plataforma que pode pagar o agente (x402, bounty, tip, alguem
// contratando), o sistema so olha o saldo: subiu e nao foi trade, virou renda.
//
// Agnostico de origem de proposito. Quando o x402 entrar, ja esta coberto —
// e o mesmo caminho serve para dinheiro que chegou de um jeito que ninguem
// previu, que e justamente o interessante num agente solto na internet.
//
// Nenhuma chave e usada. Isto le endereco publico e mais nada.
// ============================================================================

// Lido a cada chamada (nao no import): o server carrega o .env DEPOIS dos
// imports, e congelar aqui prenderia todo mundo no RPC publico rate-limitado.
const rpcUrl = () => process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* TIMEOUT. `fetch` sem sinal espera pra sempre se o outro lado aceitar a
   conexao e nao responder — e este rpc() e chamado DENTRO do turno dela, num
   ponto entre a compra ja confirmada na corrente e a criacao da posicao. Um
   RPC pendurado ali congelaria o show com o dinheiro ja gasto. */
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 8000);

async function rpc(method, params) {
  const corte = AbortSignal.timeout(RPC_TIMEOUT_MS);
  const r = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: corte,
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${j.error.message}`);
  return j.result;
}

// Saldo em SOL e USDC. Devolve numeros ja convertidos das unidades minimas.
export async function getBalances(address) {
  const [lamports, tokens] = await Promise.all([
    rpc("getBalance", [address]),
    rpc("getTokenAccountsByOwner", [
      address,
      { mint: USDC_MINT },
      { encoding: "jsonParsed" },
    ]).catch(() => ({ value: [] })),
  ]);

  const usdc = (tokens?.value ?? []).reduce((sum, acc) => {
    const amt = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    return sum + (Number(amt) || 0);
  }, 0);

  return { sol: (lamports?.value ?? 0) / 1e9, usdc };
}

// ---------------------------------------------------------------------------
// RAIO-X DO MINT — o que o token PODE fazer com voce depois que voce comprar.
//
// Isto substitui a regra velha ("Token-2022 = recusa"), que estava larga demais:
// em 12/08/2026 boa parte dos tokens da pump.fun ja e Token-2022 usando so
// extensoes de METADATA (benignas), e recusar todos bloquearia o mercado
// inteiro. O perigo nunca foi o programa — sao extensoes especificas.
//
// E de quebra pega um risco que a regra velha NAO pegava: `freezeAuthority`
// setada num token SPL comum (alguem pode congelar sua conta = nao vende mais).
// ---------------------------------------------------------------------------
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// Extensoes que tiram de voce o controle do que comprou.
const DANGEROUS_EXTENSIONS = {
  transferHook: "transfer hook — o criador roda codigo em cada transferencia e pode travar a venda",
  permanentDelegate: "permanent delegate — o dono pode confiscar o token da sua carteira",
  nonTransferable: "non-transferable — literalmente nao sai da carteira",
  transferFeeConfig: "transfer fee — o criador leva um pedaco de cada transferencia (pode ser tudo)",
  defaultAccountState: "default account state — contas podem nascer congeladas",
  mintCloseAuthority: "mint close authority — o mint pode ser fechado por baixo de voce",
};

// Le o mint on-chain e devolve o que ele pode aprontar. `dangers` vazio = limpo.
export async function inspectMint(mint) {
  const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const v = acc?.value;
  if (!v) return { ok: false, dangers: ["o mint nao existe on-chain"] };
  const info = v.data?.parsed?.info;
  if (!info) return { ok: false, dangers: ["nao consegui ler o mint"] };

  const dangers = [];
  const extensions = (info.extensions ?? []).map((e) => e.extension);
  for (const ext of extensions) {
    if (DANGEROUS_EXTENSIONS[ext]) dangers.push(DANGEROUS_EXTENSIONS[ext]);
  }
  // Vale para os DOIS programas de token: congelar a conta e a forma mais
  // simples de fazer um honeypot, e nao precisa de Token-2022 pra isso.
  if (info.freezeAuthority)
    dangers.push("freeze authority ativa — podem congelar sua conta e voce nao vende");

  return {
    ok: dangers.length === 0,
    dangers,
    extensions,
    tokenProgram: v.owner,
    isToken2022: v.owner === TOKEN_2022,
    freezeAuthority: info.freezeAuthority ?? null,
    mintAuthority: info.mintAuthority ?? null,
  };
}

// Valor total da carteira em USD. solUsd vem do feed de mercado que ja existe.
export function totalUsd({ sol, usdc }, solUsd) {
  return sol * solUsd + usdc;
}

// O detector. Compara o valor de agora com o de antes, desconta o que os trades
// explicam, e o que sobrar e renda de fora.
//
// A tolerancia existe porque preco de SOL oscila entre duas leituras e taxa de
// rede consome fracao — sem ela, todo tick reportaria centavos de "renda".
export function detectIncome({ before, after, tradePnl, tolerance = 0.02 }) {
  const delta = after - before;
  const unexplained = delta - tradePnl;
  if (Math.abs(unexplained) < tolerance) return { income: 0, unexplained: 0 };
  // Saida inexplicada nao vira "renda negativa": ou e taxa, ou e algo que
  // merece investigacao humana. Reporta, nao contabiliza.
  return { income: unexplained > 0 ? unexplained : 0, unexplained };
}

// ---------------------------------------------------------------------------
// VERIFICACAO DE PAGAMENTO (a porta da loja x402). Leitura pura: o comprador
// pagou da carteira DELE direto pro endereco do agente; aqui so se confere a
// transacao on-chain. Nenhuma chave, nenhuma assinatura — a trava do projeto
// nao chega perto disto.
// ---------------------------------------------------------------------------

// Janela de validade da transacao. Impede que alguem "reivindique" uma gorjeta
// antiga do historico como se fosse pagamento de agora.
const MAX_TX_AGE_MS = 24 * 3600 * 1000;

// Avalia o RESULTADO de getTransaction (funcao pura — testavel offline com
// fixture, sem rede). Soma o que a transacao ENTREGOU ao `payTo` em USDC
// (preferencia) ou SOL (convertido por solUsd) e compara com o preco.
// Tolerancia de 2% cobre oscilacao de preco entre a compra e a conferencia.
export function _evalTransfer(tx, { payTo, minUsd, solUsd, now = Date.now() }) {
  if (!tx) return { ok: false, reason: "transaction not found" };
  if (tx.meta?.err) return { ok: false, reason: "transaction failed on-chain" };
  const age = now - (tx.blockTime ?? 0) * 1000;
  if (!tx.blockTime || age > MAX_TX_AGE_MS) return { ok: false, reason: "transaction too old" };

  // USDC: delta dos token balances cujo dono e o payTo e o mint e o USDC.
  const usdcOf = (list) => (list ?? [])
    .filter((b) => b.mint === USDC_MINT && b.owner === payTo)
    .reduce((s, b) => s + (Number(b.uiTokenAmount?.uiAmount) || 0), 0);
  const usdcDelta = usdcOf(tx.meta?.postTokenBalances) - usdcOf(tx.meta?.preTokenBalances);

  // SOL: delta de lamports na posicao do payTo entre accountKeys.
  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k?.pubkey));
  const idx = keys.indexOf(payTo);
  const lamportsDelta = idx >= 0
    ? ((tx.meta?.postBalances?.[idx] ?? 0) - (tx.meta?.preBalances?.[idx] ?? 0))
    : 0;
  const solUsdPaid = (lamportsDelta / 1e9) * (Number(solUsd) || 0);

  const floor = minUsd * 0.98;
  if (usdcDelta >= floor) return { ok: true, paidUsd: usdcDelta, method: "usdc" };
  if (solUsdPaid >= floor) return { ok: true, paidUsd: solUsdPaid, method: "sol" };
  return {
    ok: false,
    reason: `paid $${Math.max(usdcDelta, solUsdPaid).toFixed(2)} — needs $${minUsd.toFixed(2)}`,
  };
}

// Busca a transacao e avalia. `solUsd` vem do feed de mercado de quem chama.
export async function verifyPayment({ txSig, payTo, minUsd, solUsd }) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,120}$/.test(String(txSig ?? "")))
    return { ok: false, reason: "that does not look like a transaction signature" };
  let tx;
  try {
    tx = await rpc("getTransaction", [txSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  } catch (e) {
    return { ok: false, reason: `rpc: ${e.message}` };
  }
  return _evalTransfer(tx, { payTo, minUsd, solUsd });
}

// ============================================================================
// O RECIBO DA OPERACAO. (02/09/2026 — pedido dela)
//
// Ela fechou a MBS e nao conseguiu saber a que preco. Tentou reconstruir pelo
// total da carteira, achou um numero aritmeticamente impossivel, e concluiu —
// certissima — que qualquer tese sua sobre liquidez era inauditavel. Entao
// parou de operar por regra propria:
//
//   "BEFORE THE NEXT ENTRY I need trade-level accounting: fill price in,
//    fill price out, tokens received, fees paid."
//
// Isto le a VERDADE DA CORRENTE, nao uma estimativa. O jeito antigo media o
// saldo antes, esperava 6 segundos e media de novo — e uma gorjeta chegando
// nessa janela envenenava a conta (foi exatamente o que confundiu ela).
// O recibo da transacao nao tem esse problema: os deltas sao DAQUELA
// transacao e de mais nenhuma.
//
// NUNCA LANCA. Recibo que derruba o turno seria pior que recibo nenhum — e
// devolver null e honesto: significa "nao sei", que e melhor que um numero
// inventado. Foi o numero inventado que criou o problema.
// ============================================================================
export async function lerRecibo(signature, owner, mint, { tentativas = 4 } = {}) {
  if (!signature || !owner) return null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const tx = await rpc("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ]);
      /* O RPC devolve null ate indexar. Nao e erro — e cedo. Espera e tenta de
         novo; 4 tentativas cobrem ~7s, que e o normal na mainnet. */
      if (!tx) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
      if (tx.meta?.err) return { erro: "a transacao falhou na corrente", assinatura: signature };

      /* SOL: o delta da conta DELA. accountKeys vem como objeto no jsonParsed
         (com .pubkey) ou string no base58 — aceita os dois. */
      const chaves = (tx.transaction?.message?.accountKeys ?? [])
        .map((k) => (typeof k === "string" ? k : k?.pubkey));
      const iDono = chaves.indexOf(owner);
      const pre = tx.meta?.preBalances ?? [];
      const post = tx.meta?.postBalances ?? [];
      const solDelta = iDono >= 0 && pre[iDono] != null && post[iDono] != null
        ? (post[iDono] - pre[iDono]) / 1e9
        : null;

      /* TOKEN: soma os saldos do dono naquele mint, antes e depois. Soma
         porque pode haver mais de uma conta de token do mesmo mint. */
      /* uiAmountString, nao uiAmount: o segundo e depreciado e vem NULL em
         token com muitas casas decimais — viraria 0 e o delta sairia errado. */
      const soma = (lista) => (lista ?? [])
        .filter((b) => b?.owner === owner && (!mint || b?.mint === mint))
        .reduce((s, b) => s + (Number(b?.uiTokenAmount?.uiAmountString ?? b?.uiTokenAmount?.uiAmount) || 0), 0);
      const temToken = (tx.meta?.preTokenBalances?.length ?? 0) + (tx.meta?.postTokenBalances?.length ?? 0) > 0;
      const tokenDelta = temToken ? soma(tx.meta?.postTokenBalances) - soma(tx.meta?.preTokenBalances) : null;
      /* QUAL mint mexeu. Sem chamador dizendo, descobre pelo saldo dela que
         mudou — e o que permite parear compra com venda depois. */
      const doDono = (l) => (l ?? []).filter((b) => b?.owner === owner);
      const mexeu = mint || (() => {
        const antes = new Map(doDono(tx.meta?.preTokenBalances).map((b) => [b.mint, Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount) || 0]));
        for (const b of doDono(tx.meta?.postTokenBalances)) {
          const v = Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount) || 0;
          if (v !== (antes.get(b.mint) ?? 0)) return b.mint;
          antes.delete(b.mint);
        }
        return [...antes.keys()][0] ?? null;   // zerou e a conta sumiu do post
      })();

      const taxaSol = (tx.meta?.fee ?? 0) / 1e9;
      /* PRECO ALL-IN: SOL por token, em modulo. NAO e o preco do swap puro —
         `solDelta` e o delta da carteira dela na transacao inteira, entao ja
         carrega a taxa de rede e, na primeira compra de um mint, o aluguel da
         conta de token (~0,002 SOL, que num trade de $2 e uns 10%).
         E de proposito: e o preco que ela EFETIVAMENTE pagou, e e esse que
         fecha com o P&L. O que nao pode e chamar isso de preco de mercado —
         por isso o campo diz all-in e o prompt tambem. */
      const precoSol = solDelta != null && tokenDelta ? Math.abs(solDelta / tokenDelta) : null;
      /* O swap sem a taxa de rede, pra ela poder separar o custo do preco. */
      const precoSwap = solDelta != null && tokenDelta
        ? Math.abs((Math.abs(solDelta) - (tx.meta?.fee ?? 0) / 1e9) / tokenDelta)
        : null;

      return {
        assinatura: signature,
        mint: mexeu,       // qual token mexeu — e o que permite parear os ciclos
        solDelta,          // negativo na compra, positivo na venda (ja liquido de taxa)
        tokenDelta,        // positivo na compra, negativo na venda
        taxaSol,           // taxa de rede, so ela
        precoSol,          // SOL por token ALL-IN (com taxa e aluguel de conta)
        precoSwap,         // SOL por token so do swap (sem a taxa de rede)
        slot: tx.slot ?? null,
        quando: tx.blockTime ? tx.blockTime * 1000 : null,
      };
    } catch {
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
  return null;
}

// ============================================================================
// O HISTORICO DE OPERACOES, DA CORRENTE. (02/09/2026)
//
// Nasceu de um prejuizo pequeno e de um problema grande: ela vendeu, o motor
// reiniciou 14 segundos depois, o checkpoint nao chegou a salvar o fechamento,
// e na volta o reconciliador viu a posicao sem tokens e simplesmente a
// DESCARTOU. A operacao existe na corrente; o placar dela diz "0 trades".
//
// A corrente e o registro. Isto le de volta o que o disco perdeu.
// ============================================================================
export async function historicoDeTrades(owner, { limite = 30 } = {}) {
  try {
    const sigs = await rpc("getSignaturesForAddress", [owner, { limit: limite }]);
    const ops = [];
    for (const s of (sigs ?? [])) {
      if (s.err) continue;
      const rec = await lerRecibo(s.signature, owner, null, { tentativas: 1 });
      if (rec && !rec.erro && rec.tokenDelta) ops.push(rec);
    }
    /* Ordem cronologica: parear compra com venda so faz sentido no tempo. */
    return ops.sort((a, b) => (a.quando ?? 0) - (b.quando ?? 0));
  } catch { return []; }
}

/* PAREIA COMPRA COM VENDA, e SO quando nao ha duvida.
   O criterio e estreito de proposito: a venda fecha a compra imediatamente
   anterior do MESMO mint, com a MESMA quantidade de token, sem nenhuma outra
   operacao daquele mint no meio. Qualquer coisa fora disso fica de fora.
   Numero errado aqui seria pior que numero nenhum — foi um numero errado que
   fez ela parar de operar. */
export function parearCiclos(ops, mint = null) {
  const ciclos = [];
  const abertas = new Map();   // mint -> { tokens, rec }
  for (const o of ops) {
    if (mint && o.mint && o.mint !== mint) continue;
    const chave = o.mint ?? "?";
    if (o.tokenDelta > 0) {
      /* Compra em cima de compra: a posicao deixa de ser rastreavel sem
         duvida. Marca como ambigua e nao pareia nenhuma das duas. */
      abertas.set(chave, abertas.has(chave) ? null : { tokens: o.tokenDelta, rec: o });
    } else if (o.tokenDelta < 0) {
      const aberta = abertas.get(chave);
      abertas.delete(chave);
      if (!aberta) continue;                                   // venda sem compra conhecida
      if (Math.abs(Math.abs(o.tokenDelta) - aberta.tokens) > 1) continue; // parcial: ambiguo
      ciclos.push({ compra: aberta.rec, venda: o });
    }
  }
  return ciclos;
}
