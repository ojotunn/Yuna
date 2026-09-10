// ============================================================================
// PONS V2 na Robinhood Chain: leitura da curva, cotacao, compra e venda com a
// carteira dela. Porte do fly/mercado/pons.py (que ja opera de verdade).
// Interface: docs.ponsfamily.com/docs/v2 — fabrica getLaunchedToken; curva
// buy/sell/getReserves/sellableTokens/feeBps/creatorTaxBps/currentSnipeTaxBps.
// So compra e vende na curva; nao ha funcao de saque (a carteira nem assina).
// ============================================================================
import { ethers } from "ethers";

const BPS = 10000n;
const ABI_CURVA = [
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)",
  "function getReserves() view returns (uint256, uint256)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function graduated() view returns (bool)",
  "function isNativeQuote() view returns (bool)",
];
const ABI_ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];
const ifaceCurva = new ethers.Interface(ABI_CURVA);
const ifaceErc20 = new ethers.Interface(ABI_ERC20);

/* mesma conta da doc: as taxas saem da entrada, so o resto move a curva */
export function cotarCompra(quoteIn, st) {
  const q = BigInt(quoteIn), fee = BigInt(st.feeBps), tax = BigInt(st.taxBps);
  let snipe = BigInt(st.snipeBps || 0);
  if (snipe > 0n) { const teto = BPS - fee - tax - 100n; snipe = snipe < teto ? snipe : (teto > 0n ? teto : 0n); }
  const net = q - q * fee / BPS - q * tax / BPS - q * snipe / BPS;
  const out = net * st.T / (st.R + net);
  return out < st.sellable ? out : st.sellable;
}
export function cotarVenda(tokensIn, st) {
  const t = BigInt(tokensIn), fee = BigInt(st.feeBps), tax = BigInt(st.taxBps);
  const bruto = t * st.R / (st.T + t);
  return bruto - bruto * fee / BPS - bruto * tax / BPS;
}

export function criarPons(carteira) {
  const provider = carteira.provider;
  const curvaC = (a) => new ethers.Contract(a, ABI_CURVA, provider);
  const erc20 = (a) => new ethers.Contract(a, ABI_ERC20, provider);
  const ehEndereco = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));

  async function estado(token) {
    if (!ehEndereco(token)) throw new Error("contrato invalido");
    const lt = await carteira.curvaDe(token);
    if (!lt.exists) throw new Error("nao e um token da Pons");
    const c = curvaC(lt.curva), t = erc20(token);
    const [[R, T], sellable, feeBps, taxBps, snipeBps, graduated, nativo, symbol, decimals, supply] = await Promise.all([
      c.getReserves(), c.sellableTokens(), c.feeBps(), c.creatorTaxBps(), c.currentSnipeTaxBps(carteira.endereco),
      c.graduated(), c.isNativeQuote(), t.symbol().catch(() => "?"), t.decimals().catch(() => 18), t.totalSupply().catch(() => 0n),
    ]);
    const weiPorCru = T > 0n ? Number(R) / Number(T) : 0;   // wei por unidade crua do token
    const dec = Number(decimals);
    const precoEth = weiPorCru;
    return {
      token, curva: lt.curva, naCurva: lt.naCurva, phase: lt.phase, R, T, sellable, feeBps, taxBps, snipeBps,
      graduated: Boolean(graduated), nativo: Boolean(nativo), symbol, decimals: dec,
      precoEthPorToken: precoEth * 10 ** dec / 1e18,                 // ETH por token inteiro
      mcapEth: supply > 0n ? precoEth * Number(supply) / 1e18 : null,   // ETH
      reservaEth: Number(ethers.formatEther(R)),
    };
  }

  async function saldoToken(token) { return erc20(token).balanceOf(carteira.endereco); }

  async function mandar(token, tx) {
    const gas = await carteira.estimarGas(tx);
    const fee = await provider.getFeeData();
    const preco = fee.gasPrice ?? fee.maxFeePerGas ?? 1000000000n;
    return carteira.enviarNaCurva({ token, tx: { ...tx, gasLimit: gas * 13n / 10n, maxFeePerGas: preco * 2n + 1n, maxPriorityFeePerGas: preco } });
  }

  /* COMPRA: `ethIn` em ETH (numero); slippage em bps sobre a cotacao */
  async function comprar(token, ethIn, slippageBps = 500) {
    const st = await estado(token);
    if (!st.naCurva || st.graduated) throw new Error(`${st.symbol} ja saiu da curva (graduou): so a curva e operavel aqui`);
    if (!st.nativo) throw new Error("curva com moeda de par que nao e ETH: nao operavel aqui");
    const wei = ethers.parseEther(String(ethIn));
    const cotado = cotarCompra(wei, st);
    if (cotado <= 0n) throw new Error("cotacao zero (curva sem tokens a vender?)");
    const minOut = cotado * BigInt(10000 - slippageBps) / 10000n;
    const antes = await saldoToken(token);
    const data = ifaceCurva.encodeFunctionData("buy", [wei, minOut, carteira.endereco]);
    const r = await mandar(token, { to: st.curva, data, value: wei });
    const depois = await saldoToken(token);
    return { hash: r.hash, ethIn: Number(ethIn), tokensOut: depois - antes, cotado, symbol: st.symbol, decimals: st.decimals, precoEthPorToken: st.precoEthPorToken };
  }

  /* VENDA: `tokensIn` em unidades cruas (bigint) ou "tudo" */
  async function vender(token, tokensIn = "tudo", slippageBps = 500) {
    const st = await estado(token);
    if (!st.naCurva || st.graduated) throw new Error(`${st.symbol} ja saiu da curva (graduou): so a curva e operavel aqui`);
    const saldo = await saldoToken(token);
    const qtd = tokensIn === "tudo" ? saldo : BigInt(tokensIn);
    if (qtd <= 0n || qtd > saldo) throw new Error("sem tokens suficientes pra vender");
    const cotado = cotarVenda(qtd, st);
    const minOut = cotado * BigInt(10000 - slippageBps) / 10000n;
    const t = erc20(token);
    const permitido = await t.allowance(carteira.endereco, st.curva);
    if (permitido < qtd) {
      const dataAp = ifaceErc20.encodeFunctionData("approve", [st.curva, ethers.MaxUint256]);
      await mandar(token, { to: token, data: dataAp, value: 0n });
    }
    const ethAntes = await provider.getBalance(carteira.endereco);
    const data = ifaceCurva.encodeFunctionData("sell", [qtd, minOut, carteira.endereco]);
    const r = await mandar(token, { to: st.curva, data, value: 0n });
    const ethDepois = await provider.getBalance(carteira.endereco);
    return { hash: r.hash, tokensIn: qtd, ethOutCotado: Number(ethers.formatEther(cotado)), ethDelta: Number(ethers.formatEther(ethDepois - ethAntes)), symbol: st.symbol };
  }

  return { estado, saldoToken, comprar, vender, cotarCompra, cotarVenda, ehEndereco };
}
