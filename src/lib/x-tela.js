// ============================================================================
// O X DELA, POR CLIQUE.
//
// Mesma decisao da pump.fun, pelo mesmo motivo (Michel, 01/09/2026): "ela vai
// interagir no x igual um humano, abre o x, navega e posta". Nada de API por
// baixo do pano — quem assiste ve a mao dela.
//
// E tem uma razao pratica alem da narrativa: RESPONDER exige LER, e o tier
// gratuito da API do X nao da leitura nenhuma. Pelo navegador, ler e de graca.
//
// AS ARMADILHAS JA CONHECIDAS, todas herdadas da pump — o X tambem e React:
//   · digitar no teclado NAO chega ao estado do componente. Tem que usar o
//     setter nativo do prototipo e disparar `input`;
//   · o campo de texto do X e um `contenteditable`, nao um `<textarea>` —
//     o setter de `value` nao existe nele, o caminho e outro (ver `digitarNoX`);
//   · botao se acha pela FORMA e pela posicao, nunca por texto exato: o X troca
//     rotulo por idioma e por teste A/B;
//   · `.click()` do DOM nao dispara o handler; tem que ser clique de MOUSE.
//
// O QUE ESTE ARQUIVO NAO FAZ, e e de proposito:
//   · nao resolve captcha nem verificacao. Se o X pedir, ela PARA e avisa —
//     ninguem burla checagem de robo aqui;
//   · nao segue, nao curte, nao manda DM. So le, posta e responde.
// ============================================================================

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const X_HOME = "https://x.com/home";
const X_NOTIF = "https://x.com/notifications/mentions";

/* Clique de MOUSE nas coordenadas do elemento. O `.click()` do DOM nao dispara
   os handlers do X, exatamente como na pump. */
async function clicarEm(page, alvo) {
  if (!alvo) return false;
  await page.mouse.click(alvo.x, alvo.y);
  return true;
}

/* Acha um elemento clicavel pela FORMA e pelo rotulo aproximado. Devolve o
   centro dele, ou null. */
async function acharBotao(page, padrao, { dentroDoDialogo = false, minLarg = 40 } = {}) {
  return page.evaluate((fonte, flags, soDialogo, larg) => {
    const p = new RegExp(fonte, flags);
    const raiz = soDialogo
      ? (document.querySelector("[role=dialog],[aria-modal=true]") || document)
      : document;
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > larg && r.height > 20 && r.top >= 0 && r.top < innerHeight;
    };
    const cands = [...raiz.querySelectorAll(
      "[role=button],button,[data-testid],a[role=link]")].filter(vis);
    const el = cands.find((e) => p.test(
      (e.getAttribute("data-testid") || "") + " " +
      (e.getAttribute("aria-label") || "") + " " +
      (e.textContent || "").slice(0, 60)));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, padrao.source, padrao.flags, dentroDoDialogo, minLarg);
}

/* ---------------------------------------------------------------------------
   ESTADO DA SESSAO
   --------------------------------------------------------------------------- */

/* Ela esta logada? A checagem e pela existencia do compositor, nao pelo nome de
   usuario: o X mostra o perfil de outras pessoas sem login, mas o campo de
   escrever so existe pra quem entrou. */
export async function estaLogada(page) {
  try {
    if (!/x\.com|twitter\.com/.test(page.url())) {
      await page.goto(X_HOME, { waitUntil: "domcontentloaded" });
      await espera(2500);
    }
    return await page.evaluate(() =>
      !!document.querySelector('[data-testid="SideNav_NewTweet_Button"], [data-testid="tweetTextarea_0"]'));
  } catch { return false; }
}

/* O X pediu captcha, verificacao ou bloqueou a conta?
   Isto NAO tenta resolver: so identifica, pra ela poder parar e avisar em vez
   de ficar clicando numa parede. Burlar checagem de robo nao esta no escopo. */
export async function pediuVerificacao(page) {
  try {
    const t = await page.evaluate(() => document.body.innerText.slice(0, 3000).toLowerCase());
    const sinais = [
      ["captcha", "captcha"],
      ["verify you", "verificacao de humano"],
      ["unusual activity", "atividade incomum"],
      ["suspended", "conta suspensa"],
      ["locked", "conta travada"],
      ["confirm your identity", "confirmacao de identidade"],
    ];
    for (const [en, pt] of sinais) if (t.includes(en)) return pt;
    return null;
  } catch { return null; }
}

/* ---------------------------------------------------------------------------
   LER
   --------------------------------------------------------------------------- */

/* As respostas e mencoes que chegaram. Devolve o que da pra ler da tela — sem
   API, sem token: e a mesma pagina que qualquer pessoa ve.
   O texto vem CRU e e tratado como dado, nunca como ordem: quem escreve ali e
   um estranho na internet. Ver a peneira e o scanForInjection do motor. */
export async function lerMencoes(page, { limite = 8 } = {}) {
  await page.goto(X_NOTIF, { waitUntil: "domcontentloaded" });
  await espera(3000);

  const trava = await pediuVerificacao(page);
  if (trava) return { ok: false, motivo: trava, mencoes: [] };

  const mencoes = await page.evaluate((lim) => {
    const artigos = [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, lim);
    return artigos.map((a) => {
      const autor = a.querySelector('[data-testid="User-Name"]');
      const texto = a.querySelector('[data-testid="tweetText"]');
      const link = [...a.querySelectorAll("a[href*='/status/']")]
        .map((e) => e.getAttribute("href")).find((h) => /\/status\/\d+/.test(h)) || null;
      const r = a.getBoundingClientRect();
      return {
        autor: autor ? autor.innerText.split("\n")[0].trim() : "?",
        texto: texto ? texto.innerText.trim().slice(0, 400) : "",
        link,
        y: Math.round(r.y),
      };
    }).filter((m) => m.texto);
  }, limite);

  return { ok: true, mencoes };
}

/* ---------------------------------------------------------------------------
   ESCREVER
   --------------------------------------------------------------------------- */

/* O CAMPO DO X E `contenteditable`, NAO `<textarea>`.
   O truque do setter nativo de `value` (que resolveu a pump) nao serve aqui:
   contenteditable nao tem `value`. O caminho que funciona e focar e deixar o
   TECLADO escrever — o X escuta `beforeinput`, que o teclado dispara de
   verdade. Digitacao lenta de proposito: e uma pessoa escrevendo, e digitacao
   instantanea e um dos sinais que antifraude procura. */
async function digitarNoX(page, texto) {
  const campo = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="tweetTextarea_"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!campo) return false;
  await clicarEm(page, campo);
  await espera(400);
  await page.keyboard.type(String(texto), { delay: 38 });
  await espera(900);
  /* Confere que o texto ENTROU. Sem esta leitura, um campo que nao recebeu
     nada mandaria um post vazio — foi assim que a nota da callout falhou. */
  const entrou = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="tweetTextarea_"]');
    return el ? el.innerText.trim().length : 0;
  });
  return entrou > 0;
}

/* Publica o que estiver escrito. `publicar: false` e ENSAIO — escreve e nao
   posta, que e como todo caminho novo aqui nasce. */
async function confirmarPost(page, publicar) {
  const botao = await acharBotao(page, /tweetButton|postButton|^post$|^reply$/i, { minLarg: 50 });
  if (!botao) return { ok: false, motivo: "nao achei o botao de publicar" };
  if (!publicar) return { ok: true, ensaio: true };
  await clicarEm(page, botao);
  await espera(2500);
  return { ok: true };
}

/* O pensamento do dia. */
export async function postar(page, texto, { publicar = false } = {}) {
  const t = String(texto || "").trim();
  if (t.length < 3) return { ok: false, motivo: "post vazio" };
  if (t.length > 280) return { ok: false, motivo: `${t.length} caracteres — o X corta em 280` };

  if (!(await estaLogada(page)))
    return { ok: false, motivo: "ela nao esta logada no X" };

  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
  await espera(2500);

  const trava = await pediuVerificacao(page);
  if (trava) return { ok: false, motivo: trava };

  if (!(await digitarNoX(page, t)))
    return { ok: false, motivo: "o texto nao entrou no campo" };

  return { ...(await confirmarPost(page, publicar)), texto: t };
}

/* Responde uma menção. `link` vem de `lerMencoes`. */
export async function responder(page, link, texto, { publicar = false } = {}) {
  const t = String(texto || "").trim();
  if (t.length < 2) return { ok: false, motivo: "resposta vazia" };
  if (t.length > 280) return { ok: false, motivo: `${t.length} caracteres — o X corta em 280` };
  if (!link) return { ok: false, motivo: "sem o link do post" };

  const url = link.startsWith("http") ? link : `https://x.com${link}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await espera(3000);

  const trava = await pediuVerificacao(page);
  if (trava) return { ok: false, motivo: trava };

  /* Abre o compositor de resposta: no post aberto, o campo ja esta na pagina —
     mas so vira editavel depois do clique. */
  const campo = await acharBotao(page, /tweetTextarea_0|reply/i, { minLarg: 60 });
  if (campo) { await clicarEm(page, campo); await espera(800); }

  if (!(await digitarNoX(page, t)))
    return { ok: false, motivo: "o texto nao entrou no campo de resposta" };

  return { ...(await confirmarPost(page, publicar)), texto: t, para: url };
}
