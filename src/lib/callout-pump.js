// ============================================================================
// A CALLOUT NA PUMP, DE VERDADE — cliques na tela, como qualquer pessoa faz.
//
// O motor registrava a call so no placar interno. Isso nao e renda: a pump paga
// pela call que existe LA. O caminho, conferido na tela em 30/08/2026:
//
//   1. ter pelo menos $1 do token (requisito da plataforma — a compra e feita
//      antes, pelo executor, com as travas dele);
//   2. menu Create -> Callout;
//   3. escolher a moeda;
//   4. escrever a NOTE, que e OBRIGATORIA ("Why are you bullish?", ate 2000
//      caracteres) — sem ela o botao de publicar nao libera;
//   5. publicar.
//
// Tudo aqui e clique e digitacao na pagina logada dela. Nada de API escondida:
// o espectador ve a mesma tela que ela usa.
//
// PUBLICAR E ACAO PUBLICA. `publicarCallout` so vai ate o fim quando recebe
// `publicar: true`. O padrao e ENSAIO: monta tudo, fotografa e para antes do
// botao, pra dar pra conferir sem soltar nada no mundo.
// ============================================================================
import fs from "node:fs";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Clique de MOUSE — o .click() do DOM nao dispara os handlers deste app (o item
   do menu ate destacava e nada acontecia). Devolve o texto do que clicou. */
async function clicar(page, regex, { max = 40, lado = null } = {}) {
  const caixa = await page.evaluate((fonte, flags, maxLen, ladoX) => {
    const p = new RegExp(fonte, flags);
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 14 && r.height > 10 && r.top > -40 && r.top < innerHeight + 40;
    };
    let cands = [...document.querySelectorAll("button,a,div[role=button],li,[role=menuitem]")]
      .filter(vis)
      .filter((e) => {
        const t = (e.textContent || e.getAttribute("aria-label") || "").trim();
        return t.length <= maxLen && p.test(t);
      });
    if (ladoX === "esquerda") cands = cands.filter((e) => e.getBoundingClientRect().x < 140);
    if (ladoX === "direita") cands = cands.filter((e) => e.getBoundingClientRect().x > 140);
    const el = cands[cands.length - 1];   // o mais fundo da arvore
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: (el.textContent || "").trim().slice(0, 40) };
  }, regex.source, regex.flags, max, lado);
  if (!caixa) return null;
  await page.mouse.click(caixa.x, caixa.y);
  return caixa.texto;
}

/* Digita num campo do modal.
   DUAS VIAS, e as duas importam:
   1. teclado de verdade — e o que aparece na tela, e o show e o produto;
   2. setter nativo do React — porque teclado sozinho NAO chega ao estado do
      componente de forma confiavel neste app. O texto aparecia no campo, a
      busca nunca rodava, e eu recebia "nao consegui escolher a moeda" com a
      moeda certa listada logo abaixo. Custou varias rodadas.
   React ignora `el.value = x`; ele escuta o setter do prototype mais um evento
   de input. */
async function digitar(page, regexCampo, texto) {
  const localizar = () => page.evaluate((fonte, flags) => {
    const p = new RegExp(fonte, flags);
    const raiz = document.querySelector("[role=dialog],[aria-modal=true]") || document;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 14; };
    const campos = [...raiz.querySelectorAll("input,textarea,[contenteditable=true]")].filter(vis);
    const el = campos.find((e) => p.test(
      (e.getAttribute("placeholder") || "") + " " +
      (e.getAttribute("aria-label") || "") + " " +
      (e.getAttribute("name") || ""))) || campos[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, regexCampo.source, regexCampo.flags);

  const alvo = await localizar();
  if (!alvo) return false;

  await page.mouse.click(alvo.x, alvo.y);
  await espera(300);
  await page.keyboard.type(texto, { delay: 22 });   // devagar: e uma pessoa digitando
  await espera(900);

  /* conferir e, se o React nao viu, insistir pelo caminho que ele escuta */
  const valorAgora = () => page.evaluate((fonte, flags) => {
    const p = new RegExp(fonte, flags);
    const raiz = document.querySelector("[role=dialog],[aria-modal=true]") || document;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 14; };
    const campos = [...raiz.querySelectorAll("input,textarea,[contenteditable=true]")].filter(vis);
    const el = campos.find((e) => p.test(
      (e.getAttribute("placeholder") || "") + " " +
      (e.getAttribute("aria-label") || "") + " " +
      (e.getAttribute("name") || ""))) || campos[0];
    return el ? String(el.value ?? el.textContent ?? "") : "";
  }, regexCampo.source, regexCampo.flags);

  if ((await valorAgora()).trim() === String(texto).trim()) return true;

  const forcou = await page.evaluate((fonte, flags, t) => {
    const p = new RegExp(fonte, flags);
    const raiz = document.querySelector("[role=dialog],[aria-modal=true]") || document;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 14; };
    const campos = [...raiz.querySelectorAll("input,textarea")].filter(vis);
    const el = campos.find((e) => p.test(
      (e.getAttribute("placeholder") || "") + " " +
      (e.getAttribute("aria-label") || "") + " " +
      (e.getAttribute("name") || ""))) || campos[0];
    if (!el) return false;
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, t);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, regexCampo.source, regexCampo.flags, texto);
  await espera(900);
  return forcou;
}

/* Esvazia o campo de busca sem fechar o modal. */
async function limparBusca(page) {
  try {
    const achou = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog],[aria-modal=true]") || document;
      const el = [...d.querySelectorAll("input")].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 60 && r.height > 14;
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, vazio: !el.value };
    });
    if (!achou || achou.vazio) return true;
    await page.mouse.click(achou.x, achou.y, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await espera(600);
    return true;
  } catch { return false; }
}

export async function fotografar(page, caminho) {
  try { fs.writeFileSync(caminho, await page.screenshot({ type: "png" })); return caminho; }
  catch { return null; }
}

/* O que esta na tela agora — usado nos ensaios e quando algo da errado. */
export async function descreverTela(page) {
  try {
    return await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 16 && r.height > 10; };
      const rot = (e) => (e.getAttribute("placeholder") || e.getAttribute("aria-label") ||
        e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
      const d = document.querySelector("[role=dialog],[aria-modal=true]");
      const raiz = d || document.body;
      return {
        temModal: !!d,
        texto: raiz.innerText.replace(/\n{2,}/g, "\n").slice(0, 700),
        campos: [...raiz.querySelectorAll("input,textarea,[contenteditable=true]")].filter(vis)
          .map((e) => `${e.tagName.toLowerCase()} "${rot(e)}"`),
        botoes: [...raiz.querySelectorAll("button,div[role=button]")].filter(vis)
          .map(rot).filter((t) => t && t.length < 40).slice(0, 20),
      };
    });
  } catch { return { temModal: false, texto: "", campos: [], botoes: [] }; }
}

/* Abre o formulario de callout. Devolve true se o modal apareceu.
   REGRA QUE O MICHEL ME MOSTROU (31/08/2026, na tela dele):
   "pela call create callout, voce tem que estar na pagina da moeda para fazer
   a callout dela". Eu fazia o oposto — voltava pra home antes de abrir o menu,
   e depois tentava achar a moeda numa busca que retorna dez moedas com o mesmo
   simbolo. Estando na pagina da moeda, o formulario ja abre apontado pra ela e
   a busca deixa de ser necessaria. */
export async function abrirCallout(page, mint = null) {
  if (mint) await irParaMoeda(page, mint);
  await dispensarAvisos(page);

  /* O menu de criar sai do botao "Create". Depois de uma navegacao a pagina
     ainda esta montando e o primeiro clique cai no vazio — entao tento algumas
     vezes, e digo o que vi quando desisto. */
  for (let volta = 0; volta < 4; volta++) {
    const abriu = await clicar(page, /^\s*\+?\s*create\s*$/i, { lado: "direita" })
      || await clicar(page, /^\s*\+?\s*create\s*$/i, { lado: "esquerda" });
    if (abriu) {
      await espera(2200);
      const item = await clicar(page, /^callout$/i, { max: 20 });
      if (item) {
        await espera(4500);
        const t = await descreverTela(page);
        if (t.temModal || /note\s*\(required\)|why are you bullish|calling at mc/i.test(t.texto)) return true;
      }
    }
    await espera(1500);
  }

  const visto = await page.evaluate(() =>
    [...document.querySelectorAll("button,a,div[role=button]")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => t && t.length < 22).slice(0, 18));
  console.log("[callout] nao abri o formulario. Clicaveis na pagina:", visto.join(" | "));
  return false;
}

/* Escolhe a moeda dentro do formulario, pelo mint.
   O campo e "Search a coin by name, symbol or mint" e a lista aparece embaixo;
   a busca demora, entao a espera aqui e generosa e reexaminada em voltas. */
export async function escolherMoeda(page, mint, foto = null, simbolo = null) {
  /* A BUSCA DESTA TELA NAO ACHA PELO MINT INTEIRO. Testado: colar o endereco
     completo devolve "No coins found", mesmo pra moeda grande. O que ela indexa
     e nome/simbolo. Entao tento o mint (que e o identificador certo quando
     funciona) e caio pro simbolo. */
  const termos = [mint, simbolo].filter(Boolean);
  let ok = false;
  for (const termo of termos) {
    await limparBusca(page);
    ok = await digitar(page, /search a coin|search|coin|token|ticker|mint|address/i, termo);
    if (!ok) continue;
    await espera(3000);
    const vazio = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog],[aria-modal=true]");
      return d ? /no coins found/i.test(d.innerText) : false;
    });
    if (!vazio) break;
    ok = false;
  }
  if (!ok) { if (foto) await foto("erro-campo-busca"); return false; }

  /* a lista so existe depois que a busca volta: tenta por 12s em vez de
     fotografar um "Searching..." e desistir */
  let escolhido = null;
  for (let volta = 0; volta < 8 && !escolhido; volta++) {
    await espera(1500);
    escolhido = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog],[aria-modal=true]");
      if (!d) return null;
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 80 && r.height > 28 && r.top > -20;
      };
      /* qualquer coisa clicavel DENTRO do modal que nao seja o campo, o titulo
         nem o X de fechar, e que tenha texto de moeda */
      const cands = [...d.querySelectorAll("[role=option],li,button,div[role=button],a,[class*=item],[class*=result],[class*=row]")]
        .filter(vis)
        .filter((e) => !e.querySelector("input"))
        .map((e) => ({ e, t: (e.textContent || "").trim().replace(/\s+/g, " ") }))
        .filter(({ t }) => t.length > 1 && t.length < 90)
        .filter(({ t }) => !/^(close|new callout|make a public|start typing|searching)/i.test(t));
      const alvo = cands[0];
      if (!alvo) return null;
      const r = alvo.e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: alvo.t.slice(0, 50) };
    });
  }
  if (!escolhido) { if (foto) await foto("erro-sem-sugestao"); return false; }
  await page.mouse.click(escolhido.x, escolhido.y);
  await espera(3000);
  return escolhido.texto;
}

/* A NOTA E OBRIGATORIA. Sem ela a pump nao deixa publicar — conferido pelo
   Michel no app: o campo aparece como "NOTE (REQUIRED)". */
export async function escreverNota(page, nota) {
  const t = String(nota || "").trim().slice(0, 1990);
  if (t.length < 5) throw new Error("uma call sem nota nao e uma call");

  /* O CAMPO E UM <textarea> E E ELE QUE LIBERA O BOTAO.
     O Michel reforçou olhando a tela: "tem que escrever alguma coisa aqui, se
     nao e impossivel fazer a callout". Era exatamente o que estava faltando —
     o texto nao chegava ao estado do React, o botao "Call $X" nascia travado, e
     eu ficava procurando um botao que estava na tela mas desabilitado.
     Aqui escrevo, CONFIRO o que ficou no campo, e insisto pelo caminho que o
     React escuta enquanto nao bater. */
  for (let volta = 0; volta < 3; volta++) {
    await digitar(page, /note|why are you bullish|thesis|say something/i, t);
    await espera(700);
    const dentro = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog],[aria-modal=true]") || document;
      const ta = [...d.querySelectorAll("textarea")]
        .filter((e) => e.getBoundingClientRect().height > 30)[0];
      return ta ? String(ta.value || "") : "";
    });
    if (dentro.trim().length >= 5) {
      console.log(`[callout] nota no campo (${dentro.length} caracteres)`);
      return true;
    }
  }
  console.log("[callout] a nota NAO entrou no campo — o botao vai continuar travado");
  return false;
}

/* Publica. So acontece com `publicar: true` — o padrao e ensaio. */
/* Tira da frente o que a pump empilha por cima: banner de cookies, o convite
   pra baixar o app, toasts de trade recem-feito. Qualquer um deles come o
   clique no menu Create. */
async function dispensarAvisos(page) {
  for (const alvo of [/^reject all$/i, /^dismiss/i, /^close$/i, /^not now$/i, /^×$/]) {
    try { await clicar(page, alvo, { max: 20 }); } catch { /* nao tinha */ }
  }
  await espera(600);
}

/* Leva a aba pra pagina da moeda — o formulario de call so nasce certo dali. */
async function irParaMoeda(page, mint) {
  if (page.url().includes(mint)) return;
  await page.goto(`https://pump.fun/coin/${mint}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await espera(5000);
}

/* A moeda ja veio escolhida no formulario? Estando na pagina dela, vem. */
async function moedaJaEscolhida(page, simbolo) {
  try {
    return await page.evaluate((sim) => {
      const d = document.querySelector("[role=dialog],[aria-modal=true]");
      if (!d) return null;
      const t = d.innerText;
      if (!/calling at mc/i.test(t)) return null;
      const m = /\$([A-Za-z0-9_]{2,16})/.exec(t);
      if (sim && m && m[1].toLowerCase() !== String(sim).toLowerCase()) return null;
      return (m ? "$" + m[1] : "a moeda da pagina");
    }, simbolo);
  } catch { return null; }
}

export async function publicarCallout(page, { mint, simbolo = null, nota, publicar = false, prints = null }) {
  const passos = [];
  const foto = async (nome) => { if (prints) passos.push(await fotografar(page, `${prints}-${nome}.png`)); };

  if (!await abrirCallout(page, mint)) { await foto("erro-abrir"); throw new Error("nao consegui abrir o formulario de callout"); }
  await foto("1-formulario");

  /* Vindo da pagina da moeda, o formulario ja abre com ela. So busco quando
     nao veio — e a busca continua sendo o caminho ruim: dez resultados com o
     mesmo simbolo e nenhum jeito seguro de saber qual e o certo. */
  let moeda = await moedaJaEscolhida(page, simbolo);
  if (moeda) console.log(`[callout] o formulario ja abriu em ${moeda} (vim da pagina da moeda)`);
  else {
    moeda = await escolherMoeda(page, mint, foto, simbolo);
    if (!moeda) { await foto("erro-moeda"); throw new Error(`nao consegui escolher a moeda ${mint}`); }
  }
  await foto("2-moeda");

  if (!await escreverNota(page, nota)) { await foto("erro-nota"); throw new Error("nao achei o campo da nota"); }
  await espera(800);
  await foto("3-nota");

  const tela = await descreverTela(page);
  if (!publicar) return { publicado: false, ensaio: true, moeda, tela, prints: passos };

  /* O BOTAO CARREGA O SIMBOLO: "Call $ARROW". Procurar "call" exato nao acha
     nada — o mesmo erro que ja tinha me custado a compra, onde o botao e
     "Buy $2.00". Nesta tela o nome do ativo entra no rotulo do botao. */
  /* Mesmo criterio da tela de trade: o botao de publicar e o MAIOR do modal e
     comeca com "call" — o rotulo traz o simbolo ("Call $ARROW") e exigir texto
     exato ja me custou uma rodada inteira. */
  /* ESPERA O BOTAO ACORDAR, e nao exige botao grande.
     Ele so libera depois que a NOTA entra no estado do React — o Michel
     apontou isso olhando a tela: "tem que escrever alguma coisa aqui, se nao e
     impossivel fazer a callout". Eu procurava UMA vez, nao achava, e desistia;
     o diagnostico logo em seguida mostrava "Call $WOFI" pronto, 116x32. E a
     minha exigencia de largura > 80 e altura > 26 passava raspando, quebrando
     a cada mudanca de padding da pump. */
  const botao = await (async () => {
    let alvo = null;
    for (let volta = 0; volta < 10 && !alvo; volta++) {
      if (volta) await espera(1200);
      alvo = await page.evaluate(() => {
        const d = document.querySelector("[role=dialog],[aria-modal=true]") || document;
        const cands = [...d.querySelectorAll("button,div[role=button]")]
          .map((e) => ({ e, r: e.getBoundingClientRect(), t: (e.textContent || "").trim() }))
          .filter(({ r }) => r.width > 55 && r.height > 18)
          .filter(({ t }) => /^\s*(call|post|publish)/i.test(t) && t.length < 40)
          .filter(({ e }) => !e.disabled && e.getAttribute("aria-disabled") !== "true")
          .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));
        const m = cands[0];
        if (!m) return null;
        return { x: m.r.x + m.r.width / 2, y: m.r.y + m.r.height / 2, texto: m.t.slice(0, 34) };
      });
    }
    /* JA CHAMEI ESTA MOEDA ANTES.
       A pump nao deixa duas calls na mesma moeda: o botao "Call $X" fica
       DISABLED e aparece um "Update your callout" ao lado. Isso nao e falha —
       e a call existindo. Eu tratava como erro e o motor registrava recusa numa
       call que estava publicada. */
    if (!alvo) {
      const jaChamada = await page.evaluate(() => {
        const d = document.querySelector("[role=dialog],[aria-modal=true]") || document.body;
        return /update your callout/i.test(d.innerText);
      });
      if (jaChamada) {
        console.log("[callout] esta moeda ja tem call minha — a pump oferece atualizar, nao chamar de novo");
        return "JA-CHAMADA";
      }
    }
    if (!alvo) {
      /* Nunca mais depurar no escuro: quando nao acho, digo o que existe. */
      const tudo = await page.evaluate(() => {
        const d = document.querySelector("[role=dialog],[aria-modal=true]") || document.body;
        return [...d.querySelectorAll("button,div[role=button]")]
          .map((e) => { const r = e.getBoundingClientRect();
            return `"${(e.textContent || "").trim().slice(0, 26)}" ${Math.round(r.width)}x${Math.round(r.height)}` +
                   `${e.disabled ? " DISABLED" : ""}${e.getAttribute("aria-disabled") === "true" ? " ARIA-OFF" : ""}`; });
      });
      console.log("[callout] nao achei o botao. Botoes do modal:");
      tudo.forEach((t) => console.log("          " + t));
      return null;
    }
    await page.mouse.click(alvo.x, alvo.y);
    return alvo.texto;
  })();
  if (!botao) { await foto("erro-botao"); throw new Error("nao achei o botao de publicar"); }
  await espera(6000);
  await foto("4-publicado");

  if (botao === "JA-CHAMADA")
    return { publicado: true, jaExistia: true, moeda, botao, tela: await descreverTela(page), prints: passos };

  const depois = await descreverTela(page);
  const fechou = !depois.temModal;
  return { publicado: fechou, moeda, botao, tela: depois, prints: passos };
}

/* ===========================================================================
   A BUSSOLA — de onde ela tira o que chamar.
   Decisao do Michel (30/08/2026): a moeda nao vem de lista minha nem de API
   escondida. Ela vai no Explore (o segundo icone da lateral, a bussola), olha
   o que esta correndo e escolhe. Aqui eu so devolvo o que ESTA NA TELA, em
   forma que ela consiga comparar: simbolo, nome, mint e o numero que a pump
   mostra no card. Quem escolhe e ela.
   =========================================================================== */
export async function explorarPump(page, { max = 24, onde = "explore" } = {}) {
  /* DUAS PORTAS, as duas apontadas pelo Michel (31/08/2026):
       explore -> a bussola, o que esta correndo agora
       live    -> as livestreams, onde tem gente falando da moeda ao vivo
     Sao lugares diferentes de achar a mesma coisa, e a segunda tem uma
     informacao que a primeira nao tem: quem esta por tras, falando. */
  const PORTAS = {
    explore: { rotulo: /^explore$/i, url: "https://pump.fun/explore" },
    live: { rotulo: /^live$/i, url: "https://pump.fun/live" },
  };
  const porta = PORTAS[onde] || PORTAS.explore;

  // vai pela lateral, como uma pessoa vai
  const foi = await clicar(page, porta.rotulo, { max: 12, lado: "esquerda" });
  if (!foi) {
    // a lateral pode estar recolhida: cai pra navegacao direta
    await page.goto(porta.url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  }
  await espera(5500);

  const moedas = await page.evaluate((limite) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 40; };
    const vistos = new Set();
    const saida = [];
    for (const a of document.querySelectorAll('a[href*="/coin/"]')) {
      if (!vis(a)) continue;
      const mint = (a.getAttribute("href") || "").split("/coin/")[1]?.split(/[?#]/)[0];
      if (!mint || vistos.has(mint)) continue;
      vistos.add(mint);
      /* o card e o ancestral que carrega o texto todo (simbolo, nome, mcap) */
      let caixa = a;
      for (let i = 0; i < 4 && caixa.parentElement; i++) {
        if ((caixa.innerText || "").length > 25) break;
        caixa = caixa.parentElement;
      }
      const texto = (caixa.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160);
      /* o card da bussola escreve "$12.6M MC" (valor antes da sigla); o card da
         livestream escreve so "$14.7K", sem sigla nenhuma. Tento os dois. */
      const mc = /\$([\d.,]+\s*[KMB]?)\s*MC/i.exec(texto) ||
                 /(?:MC|market cap)\s*\$?([\d.,]+[KMB]?)/i.exec(texto) ||
                 /\$([\d.,]+[KMB])/i.exec(texto);
      /* quantos estao assistindo — so existe na aba live, e e sinal de verdade:
         moeda com gente na frente da camera se move diferente de moeda parada */
      const olhos = /(\d+)\s*viewers?/i.exec(texto);
      const idade = /(\d+\s*(?:s|m|h|d|mo)\b)\s*(?:ago)?/i.exec(texto);
      saida.push({
        mint,
        texto,
        mcap: mc ? mc[1].replace(/\s+/g, "") : null,
        idade: idade ? idade[1] : null,
        assistindo: olhos ? Number(olhos[1]) : null,
      });
      if (saida.length >= limite) break;
    }
    return saida;
  }, max);

  return moedas;
}
