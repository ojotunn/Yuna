// ============================================================================
// A CARTEIRA DELA DENTRO DO NAVEGADOR
//
// Por que existe: a pump.fun entra por Privy, e o Privy quer uma carteira que
// assine um desafio. No navegador remoto (Browserbase) nao ha extensao Phantom
// nenhuma, entao o login simplesmente nao acontecia — e sem login nao ha chat,
// nao ha callout, nao ha renda. As saidas eram duas:
//
//   (a) logar com email/Google e usar a "app wallet" que a pump cria. Facil,
//       mas a carteira dela passaria a ser uma carteira custodiada pela Privy,
//       diferente da que o Michel criou e financiou, e o motor perderia a
//       capacidade de assinar transacao fora do navegador;
//   (b) ela assinar o desafio com a PROPRIA chave. E o que este arquivo faz.
//
// Escolhi (b): a identidade dela continua sendo a carteira que ele criou.
//
// TRANSACAO: ASSINA, MAS NUNCA AS CEGAS (mudou em 31/08/2026).
//   Ate entao esta carteira recusava qualquer transacao — so texto. O Michel
//   decidiu o contrario, e com razao: "tudo acontece na pump, nao tem sentido
//   na api, as pessoas nao vao ver". Uma compra feita por API e invisivel; o
//   show e ela digitar o valor, clicar em comprar e assinar, na tela.
//
//   Entao a transacao passa, mas por um funil mais rigoroso que o de uma
//   carteira comum. Antes de assinar, o Node:
//     1. DECODIFICA a transacao (inspectTx) e confere que quem assina e ela;
//     2. checa a LISTA DE PROGRAMAS permitidos — se aparecer um programa que
//        nao seja de troca conhecida, recusa;
//     3. SIMULA contra o RPC e mede quanto SOL sairia de verdade;
//     4. so assina se esse valor couber no teto (MAX_TX_SOL).
//   Uma Phantom de verdade nao faz o passo 3: ela assina o que o site mandar.
//   Aqui, uma pagina comprometida que peca uma transferencia da carteira inteira
//   leva um "nao" antes de qualquer byte ser assinado.
//
// A CHAVE NUNCA VAI PRA PAGINA. O provider injetado chama uma funcao exposta
// pelo puppeteer; quem assina e o processo do Node.
// ============================================================================
import * as signer from "./signer.js";

const b58 = (bytes) => signer.b58encode(bytes);

/* A ULTIMA ASSINATURA DE CADA AGENTE.
   Quem assina a compra feita na tela e a ponte aqui embaixo — mas quem precisa
   do numero da transacao e o motor, do outro lado. Sem este registro o motor
   recebia `signature: null`, tentava cortar a string pra mostrar o link e caia
   INTEIRO com "Cannot read properties of null" depois de a compra ja ter sido
   feita: dinheiro gasto, show derrubado. */
const ultimasAssinaturas = new Map();
export const ultimaAssinatura = (envKey) => ultimasAssinaturas.get(envKey) || null;

// nome estranho de proposito: nao pode colidir com nada que o site declare
const PONTE = "__assinaturaDoAgente__";

/* O provider vive dentro da pagina. Escrito como texto porque roda la, antes
   de qualquer script do site (evaluateOnNewDocument): quando a pump carrega,
   a carteira JA esta na window, que e como uma extensao de verdade aparece. */
function scriptDoProvider(endereco, ponte) {
  return `(() => {
    const ENDERECO = ${JSON.stringify(endereco)};
    const PONTE = ${JSON.stringify(ponte)};
    const PONTE_TX = ${JSON.stringify(ponte + "Tx")};
    const PONTE_LOG = ${JSON.stringify(ponte + "Log")};

    /* base58 na mao: a pagina precisa transformar o endereco em bytes e a
       assinatura que vem do Node (base58) em Uint8Array. Sao 30 linhas e
       evitam depender de qualquer coisa que o site carregue. */
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    function b58dec(s){
      const bytes = [0];
      for (const ch of s) {
        const v = A.indexOf(ch);
        if (v < 0) throw new Error("base58 invalido");
        let carry = v;
        for (let i = 0; i < bytes.length; i++) {
          carry += bytes[i] * 58;
          bytes[i] = carry & 0xff;
          carry >>= 8;
        }
        while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
      }
      for (let i = 0; i < s.length && s[i] === "1"; i++) bytes.push(0);
      return new Uint8Array(bytes.reverse());
    }

    const chaveBytes = b58dec(ENDERECO);
    const publicKey = {
      toString: () => ENDERECO,
      toBase58: () => ENDERECO,
      toBytes: () => chaveBytes,
      toBuffer: () => chaveBytes,
      equals: (o) => String(o) === ENDERECO,
      _bn: ENDERECO,
    };

    /* A pagina entrega um objeto de transacao (legacy ou versioned) e espera
       receber o MESMO objeto assinado. Aqui viram bytes e voltam com a firma. */
    function serializar(tx) {
      if (!tx) throw new Error("no transaction");
      if (tx instanceof Uint8Array) return Array.from(tx);
      if (typeof tx.serialize === "function") {
        try { return Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })); }
        catch (_) { return Array.from(tx.serialize()); }
      }
      throw new Error("transaction shape not supported");
    }
    function aplicarAssinatura(tx, sig) {
      /* versioned: signatures e um array de Uint8Array de 64 bytes */
      if (Array.isArray(tx.signatures) && tx.signatures[0] instanceof Uint8Array) {
        tx.signatures[0].set(sig);
        return;
      }
      /* legacy: o objeto tem addSignature(publicKey, assinatura) */
      if (typeof tx.addSignature === "function") { tx.addSignature(publicKey, sig); return; }
      if (Array.isArray(tx.signatures) && tx.signatures[0] && tx.signatures[0].signature !== undefined) {
        tx.signatures[0].signature = sig;
        return;
      }
      throw new Error("could not attach the signature");
    }

    const ouvintes = new Map();
    const avisar = (ev, arg) => (ouvintes.get(ev) || []).forEach((f) => { try { f(arg); } catch (_) {} });

    const NAO = "esta carteira assina texto para provar identidade; transacao passa pelo executor";

    async function assinarTexto(msg) {
      const texto = typeof msg === "string" ? msg
        : new TextDecoder().decode(msg instanceof Uint8Array ? msg : new Uint8Array(msg));
      const b58 = await window[PONTE](texto);
      return { signature: b58dec(b58), publicKey };
    }

    const provider = {
      isPhantom: true,
      isConnected: true,
      publicKey,
      connect: async () => { avisar("connect", publicKey); return { publicKey }; },
      disconnect: async () => { avisar("disconnect"); },
      signMessage: assinarTexto,
      signIn: async (input) => {
        /* SIWS (sign in with solana): o Privy manda os campos e espera de volta
           a mensagem exata que foi assinada. */
        const i = input || {};
        const linhas = [];
        linhas.push((i.domain || location.host) + " wants you to sign in with your Solana account:");
        linhas.push(ENDERECO);
        if (i.statement) linhas.push("", i.statement);
        const extra = [];
        if (i.uri) extra.push("URI: " + i.uri);
        if (i.version) extra.push("Version: " + i.version);
        if (i.chainId) extra.push("Chain ID: " + i.chainId);
        if (i.nonce) extra.push("Nonce: " + i.nonce);
        if (i.issuedAt) extra.push("Issued At: " + i.issuedAt);
        if (i.expirationTime) extra.push("Expiration Time: " + i.expirationTime);
        if (i.resources && i.resources.length)
          extra.push("Resources:", ...i.resources.map((r) => "- " + r));
        if (extra.length) linhas.push("", ...extra);
        const mensagem = linhas.join("\\n");
        const { signature } = await assinarTexto(mensagem);
        return {
          account: { address: ENDERECO, publicKey: chaveBytes },
          signature,
          signedMessage: new TextEncoder().encode(mensagem),
        };
      },
      /* TRANSACAO: assina SIM, mas nunca as cegas.
         O Michel quer que a compra e a venda acontecam NA TELA da pump, como
         qualquer pessoa faz — e pra isso a carteira tem que assinar. O que sai
         daqui vai pro Node, que decodifica, confere a lista de programas
         permitidos, SIMULA a transacao e so assina se o SOL que sai couber no
         teto. E mais rigoroso que uma carteira comum: uma Phantom de verdade
         assinaria sem simular nada. */
      signTransaction: async (tx) => {
        /* DIZ O QUE DEU ERRADO. Sem isto, qualquer falha aqui dentro virava um
           "User rejected the request" na tela da pump e eu ficava sem saber se
           a recusa foi minha, se a transacao veio num formato que eu nao sei
           serializar, ou se a ponte nao existia naquela aba. */
        let bytes;
        try { bytes = serializar(tx); }
        catch (e) {
          await window[PONTE_LOG]("nao consegui serializar a transacao: " + e.message +
            " · tipo=" + (tx && tx.constructor ? tx.constructor.name : typeof tx) +
            " · chaves=" + (tx ? Object.keys(tx).slice(0, 8).join(",") : "-"));
          throw e;
        }
        const r = await window[PONTE_TX](bytes);
        if (!r || !r.ok) {
          await window[PONTE_LOG]("a ponte recusou: " + (r && r.reason ? r.reason : "sem motivo"));
          throw new Error(r && r.reason ? r.reason : "refused");
        }
        try { aplicarAssinatura(tx, b58dec(r.assinatura)); }
        catch (e) {
          await window[PONTE_LOG]("assinei mas nao consegui devolver a assinatura: " + e.message);
          throw e;
        }
        return tx;
      },
      signAllTransactions: async (txs) => {
        const saida = [];
        for (const tx of txs) saida.push(await provider.signTransaction(tx));
        return saida;
      },
      signAndSendTransaction: async (tx) => {
        const r = await window[PONTE_TX](serializar(tx), true);
        if (!r || !r.ok) throw new Error(r && r.reason ? r.reason : "refused");
        return { signature: r.enviada };
      },
      sendTransaction: async (tx) => {
        const r = await window[PONTE_TX](serializar(tx), true);
        if (!r || !r.ok) throw new Error(r && r.reason ? r.reason : "refused");
        return r.enviada;
      },
      on: (ev, fn) => { ouvintes.set(ev, [...(ouvintes.get(ev) || []), fn]); },
      off: (ev, fn) => { ouvintes.set(ev, (ouvintes.get(ev) || []).filter((f) => f !== fn)); },
      removeListener: (ev, fn) => provider.off(ev, fn),
      removeAllListeners: () => ouvintes.clear(),
      request: async ({ method, params }) => {
        if (method === "connect") return { publicKey: ENDERECO };
        if (method === "disconnect") return null;
        if (method === "signMessage") return assinarTexto(params && params.message);
        if (method === "signIn") return provider.signIn(params);
        throw new Error("metodo nao suportado: " + method);
      },
    };

    try {
      Object.defineProperty(window, "phantom", { value: { solana: provider }, configurable: true });
      Object.defineProperty(window, "solana", { value: provider, configurable: true });
    } catch (_) { window.phantom = { solana: provider }; window.solana = provider; }

    /* WALLET STANDARD. As carteiras modernas nao sao mais achadas pela window:
       elas se ANUNCIAM num evento, e o app responde. Sem isto o Privy mostra
       "Phantom" so como sugestao de instalar, e o clique nao faz nada. */
    const conta = {
      address: ENDERECO,
      publicKey: chaveBytes,
      chains: ["solana:mainnet"],
      features: ["solana:signMessage", "solana:signIn"],
      label: "Yuna",
      icon: undefined,
    };
    const carteiraPadrao = {
      version: "1.0.0",
      name: "Phantom",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["solana:mainnet"],
      accounts: [conta],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [conta] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (...entradas) => {
            const saidas = [];
            for (const e of entradas.flat()) {
              const { signature } = await assinarTexto(e.message);
              saidas.push({ signedMessage: e.message, signature });
            }
            return saidas;
          },
        },
        "solana:signIn": {
          version: "1.0.0",
          signIn: async (...entradas) => {
            const saidas = [];
            for (const e of entradas.flat()) saidas.push(await provider.signIn(e));
            return saidas;
          },
        },
      },
    };
    const registrar = ({ register }) => { try { register(carteiraPadrao); } catch (_) {} };
    window.addEventListener("wallet-standard:app-ready", (ev) => registrar(ev.detail));
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
        detail: (cb) => cb({ register: (w) => w }),
      }));
    } catch (_) {}
    /* o app pode ter perguntado antes de a gente chegar: repete o anuncio */
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
          detail: (cb) => cb({ register: (w) => w }),
        }));
      } catch (_) {}
    }, 1200);
  })();`;
}

/* Instala a carteira numa aba. Chamar ANTES de navegar. */
export async function instalarCarteira(page, envKey) {
  const carteira = signer.load(envKey);           // lanca se a chave nao existe

  // A ponte: a pagina pede texto, o Node devolve assinatura. A chave fica aqui.
  try {
    await page.exposeFunction(PONTE, async (texto) => {
      /* Assinar TEXTO e como ela prova quem e (o login da pump). Fora de casa,
         um texto assinado tambem vale como autorizacao em muitos sites — entao
         a mesma regra vale aqui. */
      /* Mesma lista do executor.js — a de assinar transacao. Sao dois portoes
         (texto e transacao) e uma lista so: manter duas em sincronia e o tipo
         de coisa que funciona ate o dia em que nao funciona. */
      const { origemPermitida } = await import("./executor.js");
      const { ok: emCasa, host: onde } = origemPermitida(page.url());
      if (!emCasa) {
        console.log(`[carteira] recusei assinar texto em ${onde || "origem desconhecida"}`);
        throw new Error("this wallet only signs on pump.fun and jup.ag");
      }
      const t = String(texto ?? "");
      /* TETO DE SANIDADE: um desafio de login tem algumas centenas de bytes.
         Texto gigante e sinal de que a pagina esta tentando empurrar outra
         coisa. O signer ja recusa binario; aqui recuso tamanho. */
      if (t.length > 2000) throw new Error("texto longo demais para um desafio de login");
      return carteira.signMessage(t).signature;
    });
  } catch (e) {
    // ja instalada nesta aba (exposeFunction repete = erro) — segue o jogo
    if (!/already exists/i.test(String(e && e.message))) throw e;
  }

  /* A PONTE DA TRANSACAO. A pagina manda os bytes; aqui eles sao auditados e
     assinados. `enviar` = a pagina pediu signAndSend, entao a transacao tambem
     vai pra corrente daqui. */
  try {
    await page.exposeFunction(PONTE + "Tx", async (bytes, enviar = false) => {
      try {
        /* SO ASSINA EM CASA. Regra do Michel (31/08/2026): a carteira dela
           conecta na pump.fun e no Jupiter, e em mais lugar nenhum.
           Ela navega a internet inteira o dia todo — foruns, agregadores,
           qualquer link que aparecer no chat. Um site que peca assinatura fora
           desta lista nao e um site que ela deveria estar usando, e a diferenca
           entre "pediu" e "conseguiu" e a carteira dela inteira. A lista branca
           de programas continua valendo por dentro; esta e por fora. */
        /* A LISTA MORA NO executor.js, uma so para as duas pontes de carteira
           (esta e a do livetrade.js). Quando cada uma tinha a sua copia, dava
           para acrescentar uma corretora num arquivo e esquecer o outro — e o
           esquecido e sempre o que ninguem testa. */
        const executor = await import("./executor.js");
        const { ok: emCasa, host: onde } = executor.origemPermitida(page.url());
        if (!emCasa) {
          console.log(`[carteira] RECUSEI ASSINAR em ${onde || "origem desconhecida"}`);
          return { ok: false, reason:
            `this wallet only signs on ${executor.ORIGENS_PERMITIDAS.join(", ")}, not on ${onde || "an unknown origin"}` };
        }
        const tx = Uint8Array.from(bytes || []);
        if (!tx.length) return { ok: false, reason: "empty transaction" };
        const tetoSol = Number(process.env.MAX_TX_SOL || 0.05);
        const r = await executor.approveAndSign(tx, {
          owner: carteira.address, keypairEnvKey: envKey, maxSolSpend: tetoSol,
        });
        if (!r.ok) {
          console.log(`[carteira] recusei assinar: ${r.reason}`);
          return { ok: false, reason: r.reason };
        }
        console.log(`[carteira] assinei ${r.spentSol.toFixed(4)} SOL · programas: ${r.programs.join(", ")}`);
        const info = executor.inspectTx(r.signed);
        const assinatura = b58(r.signed.slice(info.sigOffset, info.sigOffset + 64));
        ultimasAssinaturas.set(envKey, { assinatura, url: `https://solscan.io/tx/${assinatura}`, t: Date.now() });
        if (!enviar) return { ok: true, assinatura };
        const env = await executor.sendSigned(r.signed);
        if (!env.ok) return { ok: false, reason: env.reason };
        console.log(`[carteira] enviada: ${env.url}`);
        ultimasAssinaturas.set(envKey, { assinatura: env.signature, url: env.url, t: Date.now() });
        return { ok: true, assinatura, enviada: env.signature, url: env.url };
      } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
      }
    });
  } catch (e) {
    if (!/already exists/i.test(String(e && e.message))) throw e;
  }

  try {
    await page.exposeFunction(PONTE + "Log", async (msg) => {
      console.log(`[carteira] ${String(msg).slice(0, 300)}`);
      return true;
    });
  } catch (e) {
    if (!/already exists/i.test(String(e && e.message))) throw e;
  }

  await page.evaluateOnNewDocument(scriptDoProvider(carteira.address, PONTE));
  return carteira.address;
}

export const enderecoDaCarteira = (envKey) => signer.load(envKey).address;
