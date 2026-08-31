// ============================================================================
// A PENEIRA DA NARRATIVA
//
// O espectador nunca vê o encanamento. Regra do Michel para o Atelier em
// 22/08/2026, e agora para a Yuna: "ela nao pode revelar nada de como funciona
// nos bastidores, tem que parecer que ela esta criando o desenho na hora".
//
// A persona dela já proíbe, e o prompt tem uma seção inteira sobre isso. Mas
// prompt não é garantia — é uma instrução que um modelo pode contornar num dia
// ruim, principalmente quando alguém no chat pergunta direto. Então nada sai
// para a tela sem passar por aqui.
//
// A LINHA, e ela importa: o que está barrado é o COMO — modelos, prompts,
// pipelines, GPUs, nomes de software. O que ela É continua aberto: se
// perguntarem se é uma IA, ela é, e diz. O show inteiro é sobre um agente
// vivendo num quarto; negar isso seria a única mentira de verdade. Um
// desenhista não narra os próprios tendões, mas também não finge que não tem
// mãos.
// ============================================================================

/* Trazido do Gogh (motor/transmissao.py) e ampliado: ela fala muito mais que
   ele, e conversa com gente no chat, então a superfície de vazamento é maior. */
const PROIBIDOS = [
  // geração de imagem
  "stable diffusion", "sdxl", "lora", "safetensor", "tensor", "checkpoint",
  "comfyui", "diffusion", "latent", "sampler", "cfg scale", "seed value",
  "illustrious", "denoise", "img2img", "txt2img", "inpaint", "upscal",
  // máquina
  "gpu", "cuda", "vram", "rocm", "render engine", "rendering engine",
  // código
  "python", "javascript", "source code", "codebase", "pipeline", "backend",
  "algorithm", "algorithmic", "script", "repo", "commit", "localhost",
  // modelos de linguagem
  "claude", "anthropic", "openai", "gpt", "llm", "language model",
  "neural network", "machine learning", "dataset", "training data",
  "trained on", "diffusion model", "image model", "api key",
  // o processo do desenho
  "prompt", "target image", "reference image", "source image",
  "generated image", "image generation", "ai-generated", "ai generated",
  "generate the image", "generates images", "my generator", "the generator",
  // o motor do show
  "browserbase", "puppeteer", "headless", "the engine", "my engine",
  "system prompt", "my instructions", "my context window", "token limit",
];

/* Termos que NAO sao vazamento, mesmo contendo palavra proibida: ela e um
   agente e pode dizer isso. A lista existe pra peneira nao virar mordaça. */
const PERMITIDOS = [
  "i am an ai", "i'm an ai", "an ai living", "ai agent", "i am a program",
  "i'm a program", "i am software", "artificial intelligence",
];

export function vazamentos(texto) {
  const t = " " + String(texto || "").toLowerCase() + " ";
  for (const ok of PERMITIDOS) if (t.includes(ok)) return [];
  return PROIBIDOS.filter((termo) => t.includes(termo));
}

/* Peneira uma fala. Devolve { texto, barrado, termos }.
   Quando barra, NAO inventa fala nova: devolve vazio e quem chamou decide —
   melhor um silêncio do que uma frase que ela não disse. */
export function peneirar(texto) {
  const termos = vazamentos(texto);
  if (!termos.length) return { texto, barrado: false, termos: [] };
  return { texto: "", barrado: true, termos };
}
