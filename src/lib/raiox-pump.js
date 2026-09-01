// ============================================================================
// RAIO-X DA MOEDA, LIDO DA PROPRIA PAGINA.
//
// O Michel apontou o buraco olhando as moedas que eu vinha escolhendo:
// "essas moedas geralmente sao rug pools, um candle grande para milhoes sem
// vendas". Ele estava certo — eu escolhia por "maior market cap negociando
// agora", que e exatamente o filtro que seleciona manipulacao: $250M em duas
// horas nao acontece organicamente.
//
// A API da pump nao entrega mais nem liquidez nem trades (testado: o endpoint
// devolve 404 e `real_sol_reserves` vem 0 em tudo). Mas a PAGINA da moeda
// mostra o que decide a pergunta certa — "alguem consegue VENDER isto?":
//   16,624 buys / 417 sells · $129K buy vol / $1.62M sell vol · 92 buyers /
//   82 sellers · holders.
//
// Sem vendas nao ha saida, e sem saida a posicao e uma armadilha, por maior que
// seja o numero no topo da tela.
// ============================================================================

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* "1.62M" / "$129K" / "3,639" -> numero */
function numero(txt) {
  if (!txt) return 0;
  const m = /([\d.,]+)\s*([KMB])?/i.exec(String(txt).replace(/[$\s]/g, ""));
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return n * mult;
}

/* Le os numeros da pagina da moeda. A aba precisa estar nela. */
export async function raioX(page, mint) {
  if (!page.url().includes(mint)) {
    await page.goto(`https://pump.fun/coin/${mint}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await espera(5500);
  }
  const cru = await page.evaluate(() => {
    const t = document.body.innerText;
    const pega = (re) => { const m = re.exec(t); return m ? m.slice(1) : null; };
    return {
      compras_vendas: pega(/([\d.,]+[KMB]?)\s*buys\s*([\d.,]+[KMB]?)\s*sells/i),
      volumes: pega(/\$([\d.,]+[KMB]?)\s*buy vol\s*\$([\d.,]+[KMB]?)\s*sell vol/i),
      pessoas: pega(/([\d.,]+[KMB]?)\s*buyers\s*([\d.,]+[KMB]?)\s*sellers/i),
      holders: pega(/([\d.,]+)\s*holders/i),
      idade: pega(/·\s*(\d+\s*(?:s|m|h|d|mo))\s*ago/i) || pega(/(\d+\s*(?:s|m|h|d|mo))\s*ago/i),
      mcap: pega(/Market cap.*?\$([\d.,]+[KMB]?)/is),
    };
  });

  const compras = cru.compras_vendas ? numero(cru.compras_vendas[0]) : 0;
  const vendas = cru.compras_vendas ? numero(cru.compras_vendas[1]) : 0;
  const volCompra = cru.volumes ? numero(cru.volumes[0]) : 0;
  const volVenda = cru.volumes ? numero(cru.volumes[1]) : 0;
  const compradores = cru.pessoas ? numero(cru.pessoas[0]) : 0;
  const vendedores = cru.pessoas ? numero(cru.pessoas[1]) : 0;

  return {
    compras, vendas, volCompra, volVenda, compradores, vendedores,
    holders: cru.holders ? numero(cru.holders[0]) : 0,
    idade: cru.idade ? cru.idade[0] : null,
    mcap: cru.mcap ? numero(cru.mcap[0]) : 0,
    leu: !!cru.compras_vendas || !!cru.pessoas,
  };
}

/* O DESENHO DO RUG, descrito pelo Michel: "um grande candle e depois pequenas
   compras". Traduzido em numeros que a pagina entrega:
     - o dinheiro entrou de uma vez e nao sai (volume de venda ~ nada);
     - muita compra, pouquissima venda (as maos que entraram nao conseguem sair);
     - market cap enorme para uma moeda de horas de vida.
   Nao e previsao de preco: e a pergunta de saida. */
export function pareceRug(x, idadeHoras = null) {
  const sinais = [];
  if (x.compras > 50 && x.vendas < x.compras * 0.08)
    sinais.push(`${x.compras} buys against ${x.vendas} sells`);
  if (x.volCompra > 0 && x.volVenda < x.volCompra * 0.1)
    sinais.push("the money goes in and does not come out");
  if (idadeHoras != null && idadeHoras < 6 && x.mcap > 5e6)
    sinais.push(`$${(x.mcap / 1e6).toFixed(0)}M at ${Math.round(idadeHoras)}h old`);
  if (x.compradores > 40 && x.vendedores < x.compradores * 0.1)
    sinais.push(`${x.compradores} buyers and only ${x.vendedores} sellers`);
  return { rug: sinais.length >= 2, sinais };
}

/* Vale arriscar $2 aqui? A pergunta nao e "vai subir" — e "consigo sair".
   Devolve { ok, motivo, x } pra a recusa poder ser dita em voz alta. */
/* RECALIBRADO EM 01/09/2026, e vale entender o porque antes de mexer.
   Havia DOIS tipos de filtro aqui misturados, e so um e a regra do Michel:

     PROPORCAO   "alguem conseguiu sair?" — compras contra vendas, dinheiro que
                 entra e nao sai, compradores contra vendedores. E ISTO que
                 descreve o rug que ele apontou: um candle gigante e depois so
                 compra miuda. Continua igual, e e o juiz.

     PISO ABSOLUTO  200 holders, 30 vendas, 15 vendedores. Isto nao detecta rug
                 nenhum — so exige que a moeda seja GRANDE. Numa pump.fun de
                 moedas com horas de vida, quase nada passa: numa hora de teste
                 ela propos tres vezes e nao comprou uma. Um filtro que recusa
                 tudo nao protege, so impede.

   Os pisos ficam, baixos, com um papel so: garantir que exista ALGUMA saida
   registrada antes de entrar. Quem decide de verdade e a proporcao logo acima.
   Ajustaveis por .env sem tocar no codigo. */
const n = (k, p) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : p; };

export function temSaida(x, {
  minVendedores = n("RUG_MIN_VENDEDORES", 4),
  minVendas = n("RUG_MIN_VENDAS", 6),
  /* HOLDERS BAIXO DE PROPOSITO, e o motivo e uma contradicao que eu mesmo
     escrevi: exigir MUITOS holders e exigir MUITAS vendas sao objetivos
     opostos — quem vende deixa de ser holder. A moeda que ela quis comprar
     tinha 95 compras, 44 vendas e 23 pessoas que sairam (proporcao saudavel) e
     era recusada por ter "so" 37 holders: barrada exatamente porque gente
     conseguiu sair. O piso aqui serve so contra concentracao EXTREMA — duas ou
     tres carteiras segurando tudo. Quem julga saida e a proporcao. */
  /* 40, por decisao do Michel (01/09/2026). Eu tinha baixado pra 15 depois de
     notar que exigir muitos holders e exigir muitas vendas puxam pra lados
     opostos — quem vende deixa de ser holder. Ele preferiu o lado conservador,
     e o custo esta medido: uma moeda com 95 compras, 44 vendas e 37 holders
     (proporcao saudavel) volta a ser recusada. Menos oportunidade, menos risco
     de entrar em moeda concentrada. `RUG_MIN_HOLDERS` no .env muda sem tocar
     no codigo. */
  minHolders = n("RUG_MIN_HOLDERS", 40),
  idadeHoras = null,
} = {}) {
  const r = pareceRug(x, idadeHoras);
  if (r.rug)
    return { ok: false, motivo: `this has the shape of a rug — ${r.sinais.join("; ")}`, x };
  if (!x.leu) return { ok: false, motivo: "I could not read the numbers off this coin's page", x };

  /* A PERGUNTA E PROPORCAO, NAO TAMANHO.
     Uma moeda com 12 compras e 9 vendas e mais saudavel que uma com 400
     compras e 12 vendas, e o piso absoluto reprovava a primeira e aprovava a
     segunda. Aqui: das pessoas que entraram, quantas conseguiram sair? */
  if (x.compradores >= 10 && x.vendedores < x.compradores * 0.12)
    return { ok: false, motivo:
      `${x.compradores} people bought and only ${x.vendedores} got out — that is a one-way door`, x };

  if (x.vendas < minVendas)
    return { ok: false, motivo: `only ${x.vendas} sells on record — nobody has left yet`, x };
  if (x.vendedores < minVendedores)
    return { ok: false, motivo: `only ${x.vendedores} people have sold — too few hands have made it out`, x };
  if (x.holders < minHolders)
    return { ok: false, motivo: `only ${x.holders} holders — too concentrated`, x };
  /* Volume de venda quase nulo com muita compra e o desenho classico do
     candle unico: todo mundo entrando, ninguem saindo. */
  if (x.volCompra > 0 && x.volVenda < x.volCompra * 0.15)
    return { ok: false, motivo:
      `$${Math.round(x.volCompra).toLocaleString("en-US")} went in and only ` +
      `$${Math.round(x.volVenda).toLocaleString("en-US")} — money that goes in and does not come out`, x };
  return { ok: true, motivo: `${x.vendas} sells from ${x.vendedores} people, ${x.holders} holders`, x };
}
