// ============================================================================
// COMPRAR E VENDER NA TELA DA PUMP — porque o espectador precisa VER.
//
// Decisao do Michel, 31/08/2026: "tudo acontece na pump, nao tem sentido na
// api, as pessoas nao vao ver". Uma ordem por API e um numero que aparece do
// nada; o que faz a live existir e ela abrir a moeda, digitar o valor, clicar
// em comprar e assinar. Entao o caminho de execucao passa a ser este, e a API
// fica de reserva.
//
// A assinatura vem da carteira injetada (carteira-navegador.js), que decodifica
// e SIMULA a transacao antes de assinar. Ou seja: os cliques sao de verdade, o
// dinheiro e de verdade, e a trava continua sendo nossa.
// ============================================================================
import fs from "node:fs";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Clique de MOUSE. O .click() do DOM nao dispara os handlers deste app —
   custou uma tarde pra descobrir no menu de callout. */
async function clicar(page, regex, { max = 30, dentro = null } = {}) {
  const caixa = await page.evaluate((fonte, flags, maxLen, sel) => {
    const p = new RegExp(fonte, flags);
    const raiz = sel ? document.querySelector(sel) || document : document;
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 14 && r.height > 10 && r.top > -40 && r.top < innerHeight + 60;
    };
    const cands = [...raiz.querySelectorAll("button,a,div[role=button],li,[role=tab]")]
      .filter(vis)
      .filter((e) => {
        const t = (e.textContent || "").trim();
        return t.length <= maxLen && p.test(t);
      });
    const el = cands[cands.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: (el.textContent || "").trim().slice(0, 30) };
  }, regex.source, regex.flags, max, dentro);
  if (!caixa) return null;
  await page.mouse.click(caixa.x, caixa.y);
  return caixa.texto;
}

/* Digita no campo de valor.
   Duas armadilhas, as duas ja custaram rodada:
   1. o campo nao e um input normal — e um `input[text]` de UM PIXEL escondido
      atras do <span> que desenha o numero;
   2. digitar no teclado nem sempre chega ao ESTADO do React. O texto aparece,
      o botao continua "Enter an amount", e a compra morre depois de eu ja ter
      dito que o valor estava la. React ignora `el.value = x`: ele escuta o
      setter nativo do prototype. Entao faco os dois — teclado (que e o gesto
      que aparece na tela, e o show importa) e, se o botao nao acordar, o
      setter nativo com evento de input.
   Devolve o valor que o campo ficou, ou false. */
async function digitarValor(page, valor) {
  const achar = () => page.evaluate(() => {
    const cx = (e) => e.getBoundingClientRect();
    const campo = [...document.querySelectorAll("input[type=text]")]
      .map((e) => ({ e, r: cx(e) }))
      .filter(({ r }) => r.height > 20 && r.x > 600)
      .sort((a, b) => a.r.x - b.r.x)[0];
    if (!campo) return null;
    campo.e.focus();
    const numero = [...document.querySelectorAll("span,div")]
      .map((e) => ({ e, r: cx(e) }))
      .filter(({ e, r }) => /^[\d.,]+$/.test((e.textContent || "").trim()) &&
        Math.abs(r.y - campo.r.y) < 40 && r.x > 600 && r.width < 200)
      .sort((a, b) => a.r.x - b.r.x)[0];
    const r = numero ? numero.r : campo.r;
    return { x: r.x + Math.max(6, r.width / 2), y: r.y + r.height / 2 };
  });

  const alvo = await achar();
  if (!alvo) return false;

  // 1) do jeito que uma pessoa faz — e o que o espectador ve
  await page.mouse.click(alvo.x, alvo.y);
  await espera(400);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await espera(200);
  await page.keyboard.type(String(valor), { delay: 110 });
  await espera(1200);

  const leitura = () => page.evaluate(() => {
    const c = [...document.querySelectorAll("input[type=text]")]
      .filter((e) => e.getBoundingClientRect().x > 600)[0];
    const botoes = [...document.querySelectorAll("button")].map((e) => (e.textContent || "").trim());
    return { valor: c ? String(c.value || "") : "", acordou: botoes.some((t) => /^(buy|sell)\s*[\$\d]/i.test(t)) };
  });

  let l = await leitura();
  if (l.acordou) return l.valor || String(valor);

  // 2) o React nao viu o teclado: setter nativo + evento de input
  const forcou = await page.evaluate((v) => {
    const c = [...document.querySelectorAll("input[type=text]")]
      .filter((e) => e.getBoundingClientRect().x > 600)[0];
    if (!c) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(c, String(v));
    c.dispatchEvent(new Event("input", { bubbles: true }));
    c.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, valor);
  if (!forcou) return false;
  await espera(1500);
  l = await leitura();
  console.log(`[trade] campo: "${l.valor}" · botao de acao ${l.acordou ? "acordou" : "AINDA DORMINDO"}`);
  return l.acordou ? (l.valor || String(valor)) : false;
}

/* O BOTAO DE CONFIRMAR, ACHADO POR FORMA E NAO POR TEXTO.
   Errei isto varias vezes hoje, sempre igual: o rotulo carrega o valor ("Buy
   $2.00", "Sell 4.86 ARROW"), meu regex exigia texto exato, nao achava, e o
   ciclo morria depois de ja ter gasto dinheiro no passo anterior.
   Aqui vale forma, nao texto: o botao de confirmar e o MAIOR botao ativo que
   comeca com a palavra da acao. E o painel demora pra trocar o rotulo de
   "Enter an amount" pro valor, entao a busca insiste por alguns segundos em
   vez de desistir no primeiro olhar. Quando nao acha, IMPRIME o que existe —
   nunca mais quero depurar isto no escuro. */
async function botaoDeConfirmar(page, palavra, { voltas = 8 } = {}) {
  for (let i = 0; i < voltas; i++) {
    const alvo = await page.evaluate((pal) => {
      /* REGEX LITERAL, nunca montado por string. A versao anterior era
         `new RegExp("^\\s*" + pal + "\\b")` e os escapes se perderam ao gerar o
         arquivo: virou `"^\s*"`, que em JS e so a letra "s", e `"\b"`, que e um
         backspace. O regex ficou impossivel de casar e eu passei rodadas
         procurando um botao que estava na tela o tempo todo. */
      const p = pal === "sell" ? /^\s*sell\b/i : /^\s*buy\b/i;
      const todos = [...document.querySelectorAll("button,div[role=button]")]
        .map((e) => ({ e, r: e.getBoundingClientRect(), t: (e.textContent || "").trim() }))
        .filter(({ r }) => r.width > 60 && r.height > 24);
      const ativos = todos.filter(({ e }) => !e.disabled && e.getAttribute("aria-disabled") !== "true");
      const casam = ativos.filter(({ t }) => p.test(t) && t.length < 44)
        .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));
      const m = casam[0];
      return {
        achou: m ? { x: m.r.x + m.r.width / 2, y: m.r.y + m.r.height / 2, texto: m.t.slice(0, 34) } : null,
        visiveis: todos.slice(0, 14).map((c) => `"${c.t.slice(0, 22)}"${c.e.disabled ? "[off]" : ""}`),
      };
    }, palavra);
    if (alvo.achou) {
      await page.mouse.click(alvo.achou.x, alvo.achou.y);
      return alvo.achou.texto;
    }
    if (i === voltas - 1) {
      const detalhe = await page.evaluate((pal) => {
        const p = new RegExp(pal, "i");
        return [...document.querySelectorAll("button,div[role=button],[role=button]")]
          .map((e) => ({ e, r: e.getBoundingClientRect(), t: (e.textContent || "").trim() }))
          .filter(({ t }) => p.test(t))
          .map(({ e, r, t }) => `"${t.slice(0, 26)}" ${Math.round(r.width)}x${Math.round(r.height)} ` +
            `@${Math.round(r.x)},${Math.round(r.y)}${e.disabled ? " DISABLED" : ""}` +
            `${e.getAttribute("aria-disabled") === "true" ? " ARIA-OFF" : ""} <${e.tagName.toLowerCase()}>`);
      }, palavra);
      console.log(`[trade] nao achei "${palavra}". TUDO que contem a palavra:`);
      detalhe.forEach((d) => console.log(`         ${d}`));
    }
    await espera(1200);
  }
  return null;
}

/* Pergunta a CORRENTE, nao a tela. Os dois programas de token: as moedas novas
   da pump saem em Token-2022, e olhar so o classico responde "0" com a moeda na
   mao. Devolve a quantidade (ou 0), ou null se nao confirmou a tempo. */
async function confirmarSaldo(mint, alvo, segundos) {
  const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const signer = await import("./signer.js");
  let dono;
  try { dono = signer.load("YUNA_SOL_KEYPAIR").address; } catch { return null; }
  const ler = async () => {
    let total = 0;
    for (const prog of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
          params: [dono, { programId: prog }, { encoding: "jsonParsed" }] }) });
      const j = await r.json();
      for (const t of (j?.result?.value ?? [])) {
        const i = t.account.data.parsed.info;
        if (i.mint === mint) total += Number(i.tokenAmount.uiAmount || 0);
      }
    }
    return total;
  };
  for (let i = 0; i < Math.ceil(segundos / 3); i++) {
    const s = await ler();
    if (alvo === "positivo" && s > 0) return s;
    if (alvo === "zero" && s === 0) return 0;
    await espera(3000);
  }
  return null;
}

async function foto(page, caminho) {
  try { fs.writeFileSync(caminho, await page.screenshot({ type: "png" })); return caminho; }
  catch { return null; }
}

async function textoDaTela(page, chars = 700) {
  try { return await page.evaluate((n) => document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, n), chars); }
  catch { return ""; }
}

/* A moeda na tela dela — e na tela de quem assiste. */
export async function abrirMoeda(page, mint) {
  const url = `https://pump.fun/coin/${mint}`;
  if (!page.url().includes(mint)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await espera(5000);
  }
  return url;
}

/* Garante que o painel esta na aba certa (Buy ou Sell). */
async function escolherAba(page, qual) {
  const alvo = qual === "sell" ? /^sell$/i : /^buy$/i;
  const clicou = await clicar(page, alvo, { max: 8 });
  await espera(1200);
  return clicou;
}

/* Converte a unidade do campo pra USD quando o painel oferece o seletor.
   Sem isso "2" pode virar 2 SOL em vez de 2 dolares — que e a diferenca entre
   um teste e um susto. O teto da carteira barraria, mas errar aqui gastaria um
   turno e apareceria na tela como recusa. */
async function garantirUSD(page) {
  const jaEsta = await page.evaluate(() => /\bUSD\b/.test(
    (document.querySelector("[class*=trade],[class*=panel],aside") || document.body).innerText));
  if (!jaEsta) return false;
  // o seletor mostra a unidade ATUAL; se mostra SOL, um clique troca pra USD
  const trocou = await clicar(page, /^SOL$/i, { max: 6 });
  if (trocou) { await espera(900); await clicar(page, /^USD$/i, { max: 6 }); await espera(700); }
  return true;
}

/* COMPRA. `usd` em dolares. Devolve o que aconteceu, com prints. */
export async function comprarNaTela(page, { mint, usd, prints = null }) {
  const passos = [];
  const clique = async (nome) => { if (prints) passos.push(await foto(page, `${prints}-${nome}.png`)); };

  await abrirMoeda(page, mint);
  await clique("1-moeda");

  await escolherAba(page, "buy");
  await garantirUSD(page);
  const digitado = await digitarValor(page, usd);
  if (!digitado) throw new Error("nao consegui digitar o valor no painel");
  console.log(`[trade] valor no campo: ${digitado}`);
  await clique("2-valor-digitado");

  const botao = await botaoDeConfirmar(page, "buy");
  if (!botao) throw new Error("nao achei o botao de confirmar a compra");
  console.log(`[trade] confirmei em "${botao}"`);
  await espera(9000);          // assinatura + envio + confirmacao
  await clique("3-apos-comprar");

  const tela = await textoDaTela(page);
  const falhou = /insufficient|failed|error|rejected|slippage/i.exec(tela);
  const firma = (await import("./carteira-navegador.js")).ultimaAssinatura("YUNA_SOL_KEYPAIR");

  /* A TELA NAO E PROVA. A CORRENTE E.
     O motor chegou a anunciar "clicked Buy $2.00 — it went through" e registrar
     a posicao no placar sem NADA ter saido da carteira: eu media sucesso pela
     ausencia de texto de erro na pagina. Placar que discorda da carteira ja foi
     a raiz de meio dia de confusao. Agora a compra so e compra quando o token
     aparece no saldo. */
  const chegou = await confirmarSaldo(mint, "positivo", 50);
  if (!chegou) {
    return { ok: false, botao, aviso: "a tela aceitou mas o token nao chegou na carteira",
             tela, prints: passos, assinatura: firma?.assinatura || null, url: firma?.url || null };
  }
  console.log(`[trade] a corrente confirma: ${chegou} do token na carteira`);
  return { ok: !falhou, botao, aviso: falhou ? falhou[0] : null, tela, prints: passos,
           quantidade: chegou,
           assinatura: firma?.assinatura || null, url: firma?.url || null };
}

/* VENDA. `pct` = quanto da posicao (100 = tudo). A pump tem atalhos de
   porcentagem na aba Sell, que e como uma pessoa vende de verdade. */
export async function venderNaTela(page, { mint, pct = 100, prints = null }) {
  const passos = [];
  const clique = async (nome) => { if (prints) passos.push(await foto(page, `${prints}-${nome}.png`)); };

  await abrirMoeda(page, mint);
  await escolherAba(page, "sell");
  await clique("1-aba-sell");

  /* atalho de porcentagem primeiro; se nao houver, digita o valor */
  const atalho = await clicar(page, new RegExp(`^${pct}%$`), { max: 6 });
  if (!atalho) {
    const max = pct >= 100 ? await clicar(page, /^max$/i, { max: 6 }) : null;
    if (!max) throw new Error(`nao achei como vender ${pct}% na tela`);
  }
  await espera(1500);
  await clique("2-quantidade");

  const botao = await botaoDeConfirmar(page, "sell");
  if (!botao) throw new Error("nao achei o botao de confirmar a venda");
  console.log(`[trade] confirmei em "${botao}"`);
  await espera(9000);
  await clique("3-apos-vender");

  const tela = await textoDaTela(page);
  const falhou = /insufficient|failed|error|rejected|slippage/i.exec(tela);
  const firma = (await import("./carteira-navegador.js")).ultimaAssinatura("YUNA_SOL_KEYPAIR");
  /* vender e o mesmo: so vendeu quando o saldo do token zerou */
  const zerou = pct >= 100 ? await confirmarSaldo(mint, "zero", 60) : true;
  if (!zerou) {
    return { ok: false, botao, aviso: "a tela aceitou mas o token continua na carteira",
             tela, prints: passos, assinatura: firma?.assinatura || null, url: firma?.url || null };
  }
  return { ok: !falhou, botao, aviso: falhou ? falhou[0] : null, tela, prints: passos,
           assinatura: firma?.assinatura || null, url: firma?.url || null };
}
