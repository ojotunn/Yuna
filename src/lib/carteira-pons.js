// ============================================================================
// A CARTEIRA DELA NA ROBINHOOD CHAIN (onde a Pons vive).
//
//   - NASCE NO VOLUME (src/data) na primeira vez que o motor sobe: keystore
//     padrao Ethereum (scrypt) em carteira-pons.json + senha aleatoria em
//     carteira-pons.senha, ao lado. A chave privada nunca sai deste processo:
//     nao aparece em log, estado, prompt nem rota. O Michel recebe so o
//     endereco e manda o saldo.
//   - NAO EXISTE FUNCAO DE TRANSFERIR. Por construcao: a unica transacao que
//     este modulo envia e (a) uma compra/venda na CURVA de um token que a
//     fabrica da Pons reconhece, ou (b) um `approve` desse token PARA essa
//     curva. Qualquer outro destino ou dado e recusado — mandar ETH pra
//     alguem, chamar outro contrato, aprovar outro spender, tudo.
//   - Regras da casa (Michel, 09/09/2026): o token dela ela compra ate 20% do
//     saldo e NUNCA vende; nos outros, no maximo 10% por operacao. Quem aplica
//     e o motor (operarNaPons); os numeros moram aqui pra ninguem esquecer.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ethers } from "ethers";

export const CADEIA = {
  id: 4663,
  nome: "Robinhood Chain",
  rpc: (process.env.PONS_RPC || "https://rpc.mainnet.chain.robinhood.com").trim(),
  moeda: "ETH",
  fabrica: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",   // Pons V2: a fabrica (getLaunchedToken -> curva)
};
export const REGRAS = {
  tokenProprioMaxPct: Number(process.env.PONS_TOKEN_PROPRIO_MAX_PCT || 20),   // do saldo; e nunca vende
  tradeMaxPct: Number(process.env.PONS_TRADE_MAX_PCT || 10),                  // por operacao, nos outros
  reservaGasEth: Number(process.env.PONS_RESERVA_GAS_ETH || 0.002),           // nunca gasta o ultimo gas
};

const ABI_FABRICA = [
  "function getLaunchedToken(address token) view returns (tuple(address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
];
const SELETOR_APPROVE = "0x095ea7b3";

const ARQ = "carteira-pons.json";
const ARQ_SENHA = "carteira-pons.senha";

/* Abre (ou cria) a carteira no diretorio `dir`. Devolve um objeto que NAO
   expoe a chave: so endereco, saldo e envio restrito a Pons.
   `segredo(valor)` e o registro de segredo do motor (pra redigir em log). */
export async function abrirCarteira(dir, { segredo } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, ARQ), arqSenha = path.join(dir, ARQ_SENHA);
  let senha = (process.env.PONS_CARTEIRA_SENHA || "").trim();
  let nasceu = false;
  let wallet;
  if (fs.existsSync(arq)) {
    if (!senha) {
      if (!fs.existsSync(arqSenha)) throw new Error("carteira-pons.json existe mas nao ha senha (PONS_CARTEIRA_SENHA ou carteira-pons.senha)");
      senha = fs.readFileSync(arqSenha, "utf8").trim();
    }
    wallet = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(arq, "utf8"), senha);
  } else {
    if (!senha) {
      senha = crypto.randomBytes(32).toString("base64url");
      fs.writeFileSync(arqSenha, senha, { mode: 0o600 });
    }
    wallet = ethers.Wallet.createRandom();
    const ks = await wallet.encrypt(senha);
    fs.writeFileSync(arq, ks, { mode: 0o600 });
    nasceu = true;
  }
  if (segredo) { segredo(wallet.privateKey); segredo(senha); if (wallet.mnemonic?.phrase) segredo(wallet.mnemonic.phrase); }
  const provider = new ethers.JsonRpcProvider(CADEIA.rpc, { chainId: CADEIA.id, name: CADEIA.nome }, { staticNetwork: true });
  const signer = wallet.connect(provider);
  const endereco = wallet.address;
  wallet = null;   // a referencia solta fica so dentro do signer
  const fabrica = new ethers.Contract(CADEIA.fabrica, ABI_FABRICA, provider);

  /* a curva de um token, segundo a FABRICA (nao segundo quem chamou) */
  async function curvaDe(token) {
    const lt = await fabrica.getLaunchedToken(token);
    return {
      token: lt.token, curva: lt.curve, deployer: lt.deployer, pairToken: lt.pairToken,
      creatorTaxBps: Number(lt.creatorTaxBps), phase: Number(lt.phase), exists: Boolean(lt.exists),
      naCurva: Number(lt.phase) === 0 && Boolean(lt.exists),
    };
  }

  return {
    endereco,
    nasceu,
    cadeia: CADEIA,
    regras: REGRAS,
    provider,
    curvaDe,
    /* saldo em ETH (numero) — null se o RPC falhar */
    async saldo() {
      try { return Number(ethers.formatEther(await provider.getBalance(endereco))); } catch { return null; }
    },
    async saldoWei() { return provider.getBalance(endereco); },
    /* A UNICA PORTA DE SAIDA: uma transacao na curva de `token` (ou o approve
       desse token para essa curva). A curva e conferida na fabrica. */
    async enviarNaCurva({ token, tx }) {
      const lt = await curvaDe(token);
      if (!lt.exists) throw new Error(`recusado: ${token} nao e um token da Pons`);
      const curva = String(lt.curva).toLowerCase(), para = String(tx?.to || "").toLowerCase(), dados = String(tx?.data || "0x").toLowerCase();
      if (para === curva) {
        /* compra/venda na curva: ok */
      } else if (para === String(token).toLowerCase()) {
        /* so approve(curva, x) */
        if (!dados.startsWith(SELETOR_APPROVE) || dados.length < 10 + 64) throw new Error("recusado: no token so se aceita approve");
        const spender = "0x" + dados.slice(10 + 24, 10 + 64);
        if (spender !== curva) throw new Error("recusado: approve para outro spender");
        if (tx.value && BigInt(tx.value) !== 0n) throw new Error("recusado: approve com valor");
      } else {
        throw new Error(`recusado: destino ${tx?.to} nao e a curva nem o token`);
      }
      if (tx.chainId != null && Number(tx.chainId) !== CADEIA.id) throw new Error("recusado: outra cadeia");
      const enviada = await signer.sendTransaction({ ...tx, chainId: CADEIA.id });
      const recibo = await enviada.wait(1, 120000);
      if (!recibo || recibo.status !== 1) throw new Error(`transacao revertida: ${enviada.hash}`);
      return { hash: enviada.hash, recibo };
    },
    /* estimativa de gas com a mesma conferencia (a chain simula a chamada) */
    async estimarGas(tx) { return provider.estimateGas({ ...tx, from: endereco }); },
  };
}
