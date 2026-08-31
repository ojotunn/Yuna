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
const ESTILO = "masterpiece, best quality, amazing quality, very aesthetic, " +
  "simple background, flat color, bold outline, thick lineart, minimal shading, " +
  "clean cel shading, no gradient, high contrast";
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
const PESSOA = /(girl|boy|woman|man|she|he|her|him|myself|me|self|portrait|face|someone|person|trader|artist)/i;
const BICHO = /(cat|jiji|dog|animal|bird|fox|creature)/i;
const LUGAR = /(room|city|street|window|sky|rain|night|landscape|building|desk|screen)/i;

function compor(tema) {
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
    sujeito = "1girl, solo, " + (/(full body|standing|sitting|walking)/.test(baixo)
      ? "full body" : "upper body, looking at viewer");
  } else if (LUGAR.test(baixo)) {
    sujeito = "scenery, no humans, wide shot";
  } else {
    sujeito = "solo, centered composition, medium shot";
  }

  return [sujeito, t, ESTILO].join(", ");
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

  const toques = (/(\d+)\s+toques/.exec(desenho.saida) || [])[1] || null;
  return { ok: true, nome, arquivo: destino, ficha, toques };
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
