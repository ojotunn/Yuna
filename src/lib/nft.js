// ============================================================================
// A OBRA VIRA NFT.
//
// Modelo: Metaplex Core, um asset por obra — o mesmo que o Gogh usa. O que
// muda e QUANDO e para QUEM:
//
//   Gogh   minta na COMPRA, e o dono ja nasce sendo o comprador. Nao gasta
//          nada com obra que ninguem quis.
//   Yuna   minta AO TERMINAR, e a dona e ela. Foi o que o Michel pediu, e faz
//          sentido pra ela: a obra existe on-chain no minuto em que ela larga
//          a prancheta, assinada pela mesma carteira que negocia na frente de
//          todo mundo. Quem comprar depois recebe uma transferencia.
//
// O custo dessa escolha e real e pequeno: ~0.0025 SOL de rent por asset, pago
// da carteira DELA. Quinze obras custam menos de um dolar. Em troca, a autoria
// e verificavel e nao depende de ninguem comprar nada.
//
// O `uri` aponta pro proprio site (`/api/meta/<id>.json`), como no Gogh — sem
// IPFS no meio. A consequencia esta escrita em `podeM intar()`: com o site em
// localhost o metadata nao resolve pra ninguem de fora, entao o mint fica
// bloqueado ate existir um endereco publico. Um NFT apontando pra localhost e
// um NFT quebrado pra sempre, e isso nao se desfaz.
// ============================================================================
import fs from "node:fs";
import path from "node:path";

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const ACERVO = process.env.ACERVO_DIR || "C:/Higgsfield Games/atelier/acervo/yuna";

/* O registro do que ja foi mintado. Sem ele, um restart do motor no meio do
   dia faria a mesma obra ser mintada duas vezes — dois assets identicos, o
   dobro do rent, e uma colecao com duplicata que nao da pra apagar. */
const REGISTRO = path.join(ACERVO, "_mintadas.json");

function lerRegistro() {
  try { return JSON.parse(fs.readFileSync(REGISTRO, "utf8")); } catch { return {}; }
}
function gravarRegistro(r) {
  try {
    fs.mkdirSync(ACERVO, { recursive: true });
    fs.writeFileSync(REGISTRO, JSON.stringify(r, null, 2));
  } catch { /* o registro nao pode derrubar a hora do desenho */ }
}

export function jaMintada(id) {
  return !!lerRegistro()[id];
}
export function assetDe(id) {
  return lerRegistro()[id] || null;
}

/* A URL publica do site. Sem ela o metadata do NFT apontaria pra localhost. */
export function baseDoSite() {
  return (process.env.SITE_URL || "").replace(/\/+$/, "");
}

/* Por que NAO mintar, em portugues claro. Devolve null quando pode. */
export function porQueNaoPode() {
  if (process.env.MINT_ENABLED !== "1")
    return "o mint esta desligado (MINT_ENABLED=1 pra ligar)";
  const base = baseDoSite();
  if (!base) return "sem SITE_URL — o metadata apontaria pra lugar nenhum";
  if (/localhost|127\.0\.0\.1/.test(base))
    return `SITE_URL e local (${base}) — um NFT apontando pra localhost nasce quebrado`;
  if (!process.env.YUNA_SOL_KEYPAIR)
    return "sem YUNA_SOL_KEYPAIR no .env — e a chave da carteira dela";
  return null;
}

function chaveDela() {
  /* `YUNA_SOL_KEYPAIR` e o nome que o resto do motor ja usa (executor.js
     assina com ele). Eu tinha inventado `YUNA_SECRET_KEY` aqui e o mint
     falharia em silencio no primeiro desenho — achado no review. */
  const bruta = process.env.YUNA_SOL_KEYPAIR || "";
  const txt = bruta.trim();
  if (!txt) throw new Error("sem chave");
  /* Aceita os dois formatos que aparecem por aí: array JSON de 64 bytes, ou
     base58. A carteira dela ja esta num deles; nao quero descobrir qual na
     hora do mint. */
  if (txt.startsWith("[")) return Uint8Array.from(JSON.parse(txt));
  const bs58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of txt) {
    const i = bs58.indexOf(c);
    if (i < 0) throw new Error("chave em formato desconhecido");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of txt) { if (c === "1") bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}

/* O METADATA que o `uri` do asset serve. Formato Metaplex: o que carteira e
   marketplace leem pra mostrar a obra. */
export function metadataDe(obra, base = baseDoSite()) {
  const titulo = String(obra.tema || "untitled").split(",")[0].trim();
  const nome = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  const img = `${base}/obras/${encodeURIComponent(obra.arquivo)}`;
  return {
    name: nome.slice(0, 32),
    symbol: "YUNA",
    description:
      `Drawn live by Yuna on ${obra.dia}, stroke by stroke, in front of whoever ` +
      `was watching. ${obra.porque || ""}`.trim(),
    image: img,
    external_url: base,
    attributes: [
      { trait_type: "artist", value: "Yuna" },
      { trait_type: "date", value: String(obra.dia || "") },
      { trait_type: "made", value: "live on stream" },
    ],
    properties: { files: [{ uri: img, type: "image/png" }], category: "image" },
  };
}

/* Minta a obra pra carteira DELA. Devolve { ok, asset } ou { ok:false, motivo }. */
export async function mintarObra(obra) {
  const id = String(obra.arquivo || "").replace(/\.png$/i, "");
  if (!id) return { ok: false, motivo: "obra sem arquivo" };
  const antes = assetDe(id);
  if (antes) return { ok: true, asset: antes, jaExistia: true };

  const impedimento = porQueNaoPode();
  if (impedimento) return { ok: false, motivo: impedimento };

  try {
    const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
    const { keypairIdentity, generateSigner } = await import("@metaplex-foundation/umi");
    const { create, mplCore } = await import("@metaplex-foundation/mpl-core");

    const umi = createUmi(RPC).use(mplCore());
    umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(chaveDela())));

    const meta = metadataDe(obra);
    const asset = generateSigner(umi);
    await create(umi, {
      asset,
      name: meta.name,
      uri: `${baseDoSite()}/api/meta/${encodeURIComponent(id)}.json`,
    }).sendAndConfirm(umi);

    const endereco = asset.publicKey.toString();
    const reg = lerRegistro();
    reg[id] = endereco;
    gravarRegistro(reg);
    return { ok: true, asset: endereco };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 160) };
  }
}
