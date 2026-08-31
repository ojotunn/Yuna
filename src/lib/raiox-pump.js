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
    sinais.push(`${x.compras} compras contra ${x.vendas} vendas`);
  if (x.volCompra > 0 && x.volVenda < x.volCompra * 0.1)
    sinais.push("o dinheiro entra e nao sai");
  if (idadeHoras != null && idadeHoras < 6 && x.mcap > 5e6)
    sinais.push(`$${(x.mcap / 1e6).toFixed(0)}M em ${Math.round(idadeHoras)}h de vida`);
  if (x.compradores > 40 && x.vendedores < x.compradores * 0.1)
    sinais.push(`${x.compradores} compradores e so ${x.vendedores} vendedores`);
  return { rug: sinais.length >= 2, sinais };
}

/* Vale arriscar $2 aqui? A pergunta nao e "vai subir" — e "consigo sair".
   Devolve { ok, motivo, x } pra a recusa poder ser dita em voz alta. */
export function temSaida(x, { minVendedores = 15, minVendas = 30, minHolders = 200, idadeHoras = null } = {}) {
  const r = pareceRug(x, idadeHoras);
  if (r.rug)
    return { ok: false, motivo: `desenho de rug — ${r.sinais.join("; ")}`, x };
  if (!x.leu) return { ok: false, motivo: "nao consegui ler os numeros da pagina desta moeda", x };
  if (x.vendas < minVendas)
    return { ok: false, motivo: `so ${x.vendas} vendas registradas — quase ninguem saiu daqui`, x };
  if (x.vendedores < minVendedores)
    return { ok: false, motivo: `so ${x.vendedores} pessoas venderam — poucas maos conseguiram sair`, x };
  if (x.holders < minHolders)
    return { ok: false, motivo: `so ${x.holders} holders — concentrado demais`, x };
  /* Volume de venda quase nulo com muita compra e o desenho classico do
     candle unico: todo mundo entrando, ninguem saindo. */
  if (x.volCompra > 0 && x.volVenda < x.volCompra * 0.15)
    return { ok: false, motivo:
      `entrou $${Math.round(x.volCompra).toLocaleString("en-US")} e saiu so ` +
      `$${Math.round(x.volVenda).toLocaleString("en-US")} — dinheiro que entra e nao sai`, x };
  return { ok: true, motivo: `${x.vendas} vendas de ${x.vendedores} pessoas, ${x.holders} holders`, x };
}
