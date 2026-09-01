// ============================================================================
// A HORA DO DESENHO
//
// Uma vez por dia ela para de olhar o mercado e desenha. Foi decisao do Michel
// (31/08/2026), e o motivo e o show: uma personagem que so negocia e um
// terminal com um sprite em cima. O que prende alguem numa live e o intervalo.
//
// O ciclo, igual ao do Gogh e com as trocas que o estilo pede:
//   1. ELA escolhe o tema — no turno anterior, a partir do dia que teve
//   2. o alvo nasce (Illustrious, na GPU de casa, custo zero)
//   3. `desenhar_manga.py` desenha em traco e cor chapada, gravando cada toque
//   4. a tela reproduz os toques devagar — e ISSO que vai ao ar, por ~1 hora
//   5. a obra entra no acervo com a data e a historia do dia
//
// Por que gravar e reproduzir em vez de desenhar em tempo real: o motor leva
// dois minutos pra calcular e a hora dura sessenta. Reproduzir traco a traco e
// o que faz o espectador VER o desenho nascer — e e exatamente o que o Gogh ja
// fazia. O player redesenha os toques que o Python gravou, entao o que aparece
// e o que o motor fez, nao uma aproximacao em JavaScript.
//
// O QUE NUNCA SAI DAQUI PRA TELA: nada deste arquivo. Ver lib/peneira.js.
// ============================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ATELIER = process.env.ATELIER_DIR || "C:\\Higgsfield Games\\atelier";
const PYTHON = path.join(ATELIER, "sd", "py312", "python.exe");
const MOTOR = path.join(ATELIER, "motor");
const ESTUDOS = path.join(ATELIER, "estudos");
const ACERVO = process.env.ACERVO_DIR || path.join(ATELIER, "acervo", "yuna");

/* O estilo dela, fixo. O tema muda todo dia; o traco nao — e assim que um
   acervo vira obra de alguem em vez de pasta de imagens soltas. */
/* O ESTILO SE PARTE EM DOIS, e o motivo custou um lote inteiro (01/09/2026).
   O estilo era uma string so, com `simple background` dentro dela. Isso serve
   pra retrato e pra bicho em close — e BRIGA de frente com cenario: `scenery,
   wide shot` pede um lugar, `simple background` pede fundo liso, e o fundo
   liso ganha. No primeiro lote de 15, tres voltaram como um retangulo de cor
   solida (halteres no chao, cama desfeita, gato se espreguicando) e uma quarta
   veio quase vazia. Nao era o assunto ser fraco: era o proprio estilo apagando
   a cena. O traco continua igual em tudo — o que muda e so o FUNDO. */
/* A IDENTIDADE VISUAL — escolhida pelo Michel na variacao B (01/09/2026).
   Antes disto o estilo variava por ACASO entre uma obra e outra: seis testes
   com o mesmo estilo escrito devolveram uma colorida e suave, uma de fundo
   lilas chapado, uma cinza-esverdeada. Um acervo assim nao tem autor — tem
   sorte. O que ele escolheu tem nome no vocabulario do modelo:

     greyscale + spot color  — a imagem inteira em tons de cinza, com cor SO
                               em dois pontos: o rosa do cabelo e o azul dos
                               olhos dela. E o que faz a figura saltar.
     heavy black shadows     — sombra em bloco preto puro, sem meio-tom
     white outline           — o halo branco que separa a figura do fundo
     sketch background       — o fundo em traco solto, nao em cor chapada

   Isto vale para TUDO que ela desenha, figura ou cena. Estilo e o que faz o
   acervo ser de uma pessoa so. */
const TRACO = "greyscale, spot color, limited palette, high contrast, " +
  "bold outline, thick lineart, heavy black shadows, white outline, " +
  "no gradient, sketch background";
const QUALIDADE = "masterpiece, best quality, amazing quality, very aesthetic";
const ESTILO = `${QUALIDADE}, simple background, ${TRACO}`;
const ESTILO_CENA = `${QUALIDADE}, detailed background, ${TRACO}`;
const NEGATIVO = "worst quality, low quality, bad anatomy, bad hands, extra fingers, " +
  "jpeg artifacts, watermark, signature, text, blurry, 3d, realistic, photo, " +
  "busy background, cluttered, gradient, soft shading";

/* ===========================================================================
   O COMPOSITOR: o tema dela vira um prompt que o modelo sabe desenhar.

   Ela diz "o Jiji dormindo no tapete". Mandar isso cru devolveu um borrao
   cinza — e desenho feio nao e interessante justamente porque ela e artista.
   O modelo de anime nao entende frase; entende ENQUADRAMENTO e assunto. Entao
   aqui a frase dela ganha o esqueleto que faltava: quem esta na imagem, de que
   distancia, olhando pra onde. O tema continua sendo dela; o oficio e meu.
   =========================================================================== */
/* FRONTEIRA DE PALAVRA — e o `\b` tem que ser BARRA-INVERTIDA + b (01/09/2026).
   Estas tres regex estavam com o byte 0x08 (backspace) no lugar do escape: um
   shell comeu a barra quando o arquivo foi escrito. Nenhuma delas casava nada,
   entao TODO tema caia no ramo generico e o enquadramento por assunto nunca
   rodou — nem `cat, sleeping, close-up`, nem `scenery, no humans, wide shot`.
   Os desenhos sairam bons por sorte, porque o tema ja descrevia a cena.
   A fronteira tambem importa por si: sem ela o "he" casa dentro de "the", e
   qualquer tema com artigo viraria "1girl, solo". */
/* A FICHA DO PERSONAGEM.
   O primeiro lote devolveu quinze garotas DIFERENTES — uma castanha, uma
   loira, uma morena — e o acervo de uma artista com personagem nao pode ser
   isso: quem assiste assume que a figura e ela, e cabelo trocando a cada obra
   quebra o vinculo entre a arte e quem esta desenhando.
   Os tracos sao lidos do sprite dela do quarto (recortes/yuna-1.png), pra
   figura desenhada e figura na tela serem a mesma pessoa. */
/* SEM COR DE ROUPA. `light blue sweater` brigava de frente com `greyscale`:
   um pede azul, o outro pede cinza, e o resultado virava loteria. O que fica
   colorido e so o que E o spot color — cabelo rosa e olhos azuis. */
const EU = "long straight black hair, blue eyes, pink hair clip, pink streaked hair, oversized sweater, black thighhighs, pale skin";

/* Quando o tema fala DELA. Se ela um dia quiser desenhar outra pessoa — um
   velho, um estranho na rua — a ficha nao entra, senao o estranho sai de
   moletom azul e cabelo rosa. */
const SOU_EU = /\b(i|me|my|myself|self|herself|she|her)\b/i;
const OUTRA_PESSOA = /\b(man|boy|old|stranger|crowd|someone else|father|mother)s?\b/i;

const PESSOA = /\b(girl|boy|woman|man|she|he|her|him|myself|me|self|portrait|face|someone|person|trader|artist)s?\b/i;
const BICHO = /\b(cat|jiji|dog|animal|bird|fox|creature)s?\b/i;
const LUGAR = /\b(bed|bedroom|room|city|street|window|sky|rain|night|landscape|building|desk|screen|floor|shelf|plant|cup|mug|keyboard|dumbbell|rug|table|chair|lamp|curtain|window ?sill)s?\b/i;

export function compor(tema) {
  const t = String(tema).trim();
  const baixo = t.toLowerCase();

  /* A ORDEM MANDA. Modelo de anime pesa o comeco do prompt: com o estilo na
     frente, "simple background" virou o assunto e voltou um quarto vazio
     quando ela pediu o gato. Assunto primeiro, tema no meio, estilo no fim.
     E `no humans` nao entra junto de bicho — empurra pra cenario. */
  let sujeito;
  if (BICHO.test(baixo)) {
    const bicho = /(jiji|cat)/.test(baixo) ? "cat" : "animal";
    sujeito = /(sleep|asleep|curled|resting)/.test(baixo)
      ? `${bicho}, sleeping, curled up, close-up, centered composition`
      : `${bicho}, close-up, centered composition`;
  } else if (PESSOA.test(baixo)) {
    const eu = SOU_EU.test(baixo) && !OUTRA_PESSOA.test(baixo);
    const enquadra = /(full body|standing|sitting|walking)/.test(baixo)
      ? "full body" : "upper body, looking at viewer";
    sujeito = ["1girl", "solo", enquadra, eu ? EU : null].filter(Boolean).join(", ");
  } else if (LUGAR.test(baixo)) {
    sujeito = "scenery, no humans, wide shot";
  } else {
    /* Nem bicho nem gente: e uma COISA do quarto dela. `solo` aqui pedia uma
       figura que nao existe no tema, e junto de `simple background` devolvia
       um retangulo de cor. Natureza-morta e o que ela desenharia de fato. */
    sujeito = "still life, no humans, close-up, centered composition";
  }

  /* Cenario leva o estilo SEM `simple background`; o resto leva o de sempre. */
  /* O FUNDO SEGUE O TEMA, NAO O SUJEITO.
     Primeira versao amarrava fundo detalhado so ao ramo `scenery`, e o gato
     na janela — que e ramo BICHO — voltava boiando num retangulo roxo com a
     cidade reduzida a um risco. Se o tema cita um lugar, o lugar tem que
     aparecer, seja quem for o assunto. */
  const temCena = LUGAR.test(baixo) || sujeito.startsWith("scenery");
  const estilo = temCena ? ESTILO_CENA : ESTILO;
  return [sujeito, t, estilo].join(", ");
}

/* Tema vago nao vira obra. Recusar e melhor que entregar borrao: uma pagina de
   diario precisa dizer de que dia ela e. */
export function temaServe(tema) {
  const t = String(tema || "").trim();
  if (t.length < 12) return { ok: false, motivo: "muito curto — diga o que é, e de que ângulo" };
  const palavras = t.split(/\s+/).filter((p) => p.length > 2);
  if (palavras.length < 3) return { ok: false, motivo: "faltam detalhes — o que aparece na imagem?" };
  return { ok: true };
}

function rodar(cmd, args, env = {}, minutos = 12) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd: MOTOR,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env },
      windowsHide: true,
    });
    let saida = "";
    p.stdout.on("data", (d) => { saida += d; });
    p.stderr.on("data", (d) => { saida += d; });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, minutos * 60000);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, saida }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, saida: String(e.message) }); });
  });
}

/* ===========================================================================
   A TRANSMISSAO: e o que transforma o desenho em SHOW.

   Sem isto a obra existe so como arquivo: ela senta no tapete, some por uma
   hora e aparece um PNG que ninguem viu nascer. O player reproduz os toques
   gravados devagar, e e ISSO que vai no painel do quarto durante a hora dela.

   Uma de cada vez: subir a segunda sem matar a primeira deixaria a porta
   ocupada e o painel abriria no desenho de ontem.
   =========================================================================== */
const PORTA_TELA = Number(process.env.ATELIER_PORTA || 8435);
let transmissao = null;

export function pararTransmissao() {
  if (!transmissao) return;
  try { transmissao.kill(); } catch {}
  transmissao = null;
}

function transmitir(nome) {
  pararTransmissao();
  const p = spawn(PYTHON, ["transmissao.py", nome, "--porta", String(PORTA_TELA)], {
    cwd: MOTOR,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    windowsHide: true,
    detached: false,
  });
  p.on("error", () => { transmissao = null; });
  transmissao = p;
  return PORTA_TELA;
}

/* ===========================================================================
   A FILA DE OBRAS.

   O Michel escolheu e ordenou quinze obras em 01/09/2026, e cada uma ja foi
   desenhada e gravada traco a traco. Isto muda o que acontece na hora do
   desenho: em vez de calcular a obra do dia com ela ja sentada no tapete —
   quarenta segundos de painel vazio, e o risco de um alvo ruim virar uma hora
   de live feia — o motor so REPRODUZ o que ja esta pronto e aprovado.

   O que o espectador ve nao muda em nada: o traco nasce na frente dele, no
   ritmo de uma hora. O que muda e que ninguem descobre junto com ele se a
   obra prestava.

   Quando a fila acaba, o caminho antigo volta a valer: ela gera a obra na
   hora. Melhor uma obra improvisada que uma hora de tela parada.
   =========================================================================== */
const FILA_DIR = path.join(ATELIER, "fila");
const FILA_ARQ = path.join(FILA_DIR, "fila.json");
const FILA_OBRAS = path.join(FILA_DIR, "obras");

function lerFila() {
  try { return JSON.parse(fs.readFileSync(FILA_ARQ, "utf8")); } catch { return null; }
}

/* A proxima obra SEM consumir — o motor precisa saber o tema do dia antes de
   ela sentar, pra contar pra ela o que vai desenhar hoje. */
export function proximaDaFila() {
  const f = lerFila();
  if (!f || !Array.isArray(f.obras) || !f.obras.length) return null;
  const i = Number(f.posicao || 0);
  if (i >= f.obras.length) return null;              // fila acabou
  const o = f.obras[i];
  const toques = path.join(FILA_OBRAS, `${o.nome}-toques.json`);
  if (!fs.existsSync(toques)) return null;
  return { ...o, posicao: i, restam: f.obras.length - i };
}

function avancarFila() {
  const f = lerFila();
  if (!f) return;
  f.posicao = Number(f.posicao || 0) + 1;
  fs.writeFileSync(FILA_ARQ, JSON.stringify(f, null, 2));
}

/* Reproduz a obra da fila: sobe a transmissao apontando pros toques dela.
   O `-toques.json` vive em fila/obras, mas a transmissao procura em estudos —
   entao a gravacao e copiada pra la antes de subir. Copiar 15 MB e instantaneo
   e evita mexer no caminho que o Gogh ja usa. */
export function reproduzirDaFila(obra) {
  const origem = path.join(FILA_OBRAS, `${obra.nome}-toques.json`);
  const destino = path.join(ESTUDOS, `${obra.nome}-toques.json`);
  if (!fs.existsSync(destino) ||
      fs.statSync(destino).size !== fs.statSync(origem).size) {
    fs.copyFileSync(origem, destino);
  }
  const porta = transmitir(obra.nome);

  /* A OBRA TEM QUE ENTRAR NO ACERVO.
     So `desenharObra` gravava no acervo, e com a fila ligada ela deixou de ser
     chamada — o site ficaria eternamente vazio enquanto ela desenha todo dia.
     O acervo e o que o site publica e o que vira NFT; se a obra nao chega la,
     ela existe so como arquivo de trabalho. */
  const dia = new Date().toISOString().slice(0, 10);
  const apelidoObra = `${dia}-${obra.nome}`;
  try {
    fs.mkdirSync(ACERVO, { recursive: true });
    const destino = path.join(ACERVO, `${apelidoObra}.png`);
    fs.copyFileSync(path.join(FILA_OBRAS, `${obra.nome}.png`), destino);
    fs.writeFileSync(path.join(ACERVO, `${apelidoObra}.json`), JSON.stringify({
      tema: obra.tema, porque: "", dia,
      arquivo: path.basename(destino),
      toques: path.join(FILA_OBRAS, `${obra.nome}-toques.json`),
      daFila: obra.n,
    }, null, 2));
  } catch { /* o acervo nao pode derrubar a hora do desenho */ }

  avancarFila();
  return { ok: true, nome: apelidoObra, tema: obra.tema, porta, daFila: true };
}

/* Nome de arquivo a partir do que ela quis desenhar. */
function apelido(tema, quando) {
  const base = String(tema || "obra").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "obra";
  return `${quando}-${base}`;
}

/* A obra do dia. `tema` é o que ELA disse que quer desenhar; `porque` é o
   motivo dela, que vai para o acervo junto — é o que transforma o arquivo em
   página de diário. */
export async function desenharObra({ tema, porque = "", quando = null }) {
  if (!tema || String(tema).trim().length < 4)
    return { ok: false, motivo: "sem tema — ela precisa dizer o que quer desenhar" };

  const dia = quando || new Date().toISOString().slice(0, 10);
  const nome = apelido(tema, dia);

  if (!fs.existsSync(PYTHON))
    return { ok: false, motivo: `o ateliê não está nesta máquina (${PYTHON})` };

  const serve = temaServe(tema);
  if (!serve.ok) return { ok: false, motivo: serve.motivo };

  // 1. o alvo, com o tema dela dentro de um enquadramento que o modelo entende
  const prompt = compor(tema);
  const alvo = await rodar(PYTHON, ["gerar_alvo.py", prompt, nome], {
    ATELIER_CKPT: "Illustrious-XL-v0.1.safetensors",
    ATELIER_LORA: "none",
    ATELIER_ANIME: "1",
    ATELIER_CFG: "5.0",
    ATELIER_STEPS: "32",
    ATELIER_NEGATIVO: NEGATIVO,
  }, 10);
  const caminhoAlvo = path.join(ESTUDOS, `alvo-${nome}.png`);
  if (!fs.existsSync(caminhoAlvo))
    return { ok: false, motivo: "o estudo não ficou pronto", detalhe: alvo.saida.slice(-300) };

  // 2. o desenho, gravando os toques
  const desenho = await rodar(PYTHON, ["desenhar_manga.py", caminhoAlvo, nome], {}, 14);
  const caminhoObra = path.join(ESTUDOS, `${nome}.png`);
  if (!fs.existsSync(caminhoObra))
    return { ok: false, motivo: "o desenho não fechou", detalhe: desenho.saida.slice(-300) };

  // 3. o acervo: a obra fica com a data e o motivo dela
  fs.mkdirSync(ACERVO, { recursive: true });
  const destino = path.join(ACERVO, `${nome}.png`);
  fs.copyFileSync(caminhoObra, destino);
  const ficha = path.join(ACERVO, `${nome}.json`);
  fs.writeFileSync(ficha, JSON.stringify({
    tema, porque, dia,
    arquivo: path.basename(destino),
    toques: path.join(ESTUDOS, `${nome}-toques.json`),
  }, null, 2));

  // 4. a tela: os toques gravados viram o desenho nascendo, no painel do quarto
  const gravacao = path.join(ESTUDOS, `${nome}-toques.json`);
  let porta = null;
  if (fs.existsSync(gravacao)) porta = transmitir(nome);

  const toques = (/(\d+)\s+toques/.exec(desenho.saida) || [])[1] || null;
  return { ok: true, nome, arquivo: destino, ficha, toques, porta };
}

/* O que ela já desenhou. Serve para ela lembrar e para o site depois. */
export function acervo() {
  try {
    return fs.readdirSync(ACERVO)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(ACERVO, f), "utf8")))
      .sort((a, b) => String(b.dia).localeCompare(String(a.dia)));
  } catch { return []; }
}
