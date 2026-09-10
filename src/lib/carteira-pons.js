// ============================================================================
// A CARTEIRA DELA NA ROBINHOOD CHAIN (onde a Pons vive).
//
//   - NASCE NO VOLUME (src/data) na primeira vez que o motor sobe: keystore
//     padrao Ethereum (scrypt) em carteira-pons.json + senha aleatoria em
//     carteira-pons.senha, ao lado. A chave privada nunca sai deste processo:
//     nao aparece em log, estado, prompt nem rota. O Michel recebe so o
//     endereco e manda o saldo.
//   - NAO EXISTE FUNCAO DE TRANSFERIR. Por construcao: a unica assinatura que
//     este modulo faz e de transacao PARA A PONS (a fabrica da curva V2) — e
//     recusa qualquer outra, inclusive mandar ETH pra um endereco.
//   - Regras da casa (Michel, 09/09/2026): o token dela ela compra ate 20% do
//     saldo e NUNCA vende; nos outros, no maximo 10% por operacao. Quem aplica
//     e o executor (proxima etapa); os numeros moram aqui pra ninguem esquecer.
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
  fabrica: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",   // Pons V2: a curva
};
export const REGRAS = {
  tokenProprioMaxPct: Number(process.env.PONS_TOKEN_PROPRIO_MAX_PCT || 20),   // do saldo; e nunca vende
  tradeMaxPct: Number(process.env.PONS_TRADE_MAX_PCT || 10),                  // por operacao, nos outros
};

const ARQ = "carteira-pons.json";
const ARQ_SENHA = "carteira-pons.senha";

/* Abre (ou cria) a carteira no diretorio `dir`. Devolve um objeto que NAO
   expoe a chave: so endereco, saldo e assinatura restrita a Pons.
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

  return {
    endereco,
    nasceu,
    cadeia: CADEIA,
    regras: REGRAS,
    /* saldo em ETH (numero) — null se o RPC falhar */
    async saldo() {
      try { return Number(ethers.formatEther(await provider.getBalance(endereco))); } catch { return null; }
    },
    async saldoWei() { return provider.getBalance(endereco); },
    provider,
    /* A UNICA ASSINATURA: transacao para a Pons. Qualquer outro destino e
       recusado — mandar ETH pra alguem, chamar outro contrato, tudo. */
    async assinarParaPons(tx) {
      const para = String(tx?.to || "").toLowerCase();
      if (para !== CADEIA.fabrica.toLowerCase()) throw new Error(`recusado: destino ${tx?.to} nao e a Pons`);
      if (tx.chainId != null && Number(tx.chainId) !== CADEIA.id) throw new Error("recusado: outra cadeia");
      return signer.signTransaction({ ...tx, chainId: CADEIA.id });
    },
    async enviarParaPons(tx) {
      const para = String(tx?.to || "").toLowerCase();
      if (para !== CADEIA.fabrica.toLowerCase()) throw new Error(`recusado: destino ${tx?.to} nao e a Pons`);
      return signer.sendTransaction({ ...tx, chainId: CADEIA.id });
    },
  };
}
