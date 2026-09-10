// ============================================================================
// O CHAT DO SITE (yuna.cam). A Pons nao tem stream nem chat, entao quem
// assiste fala com ela aqui: nome livre, mensagem curta, sem carteira.
//
//   - fila em memoria (ultimas 300) + arquivo jsonl (o motor le o rabo dele
//     pra saber o que o publico disse; e o historico sobrevive ao restart)
//   - limite: 1 mensagem a cada 4 s por IP, 240 letras, nome de 2 a 20
//   - o que ELA fala entra como mensagem dela (dela: true), espelhado pelo
//     servidor a partir do estado do motor (cenaFala)
//   - publico = IPs que puxaram o chat nos ultimos 40 s
// ============================================================================
import fs from "node:fs";
import path from "node:path";

export function criarChat(arquivo) {
  const itens = [];
  let seq = 0;
  const ultimoPorIp = new Map();      // ip -> t da ultima mensagem
  const vistos = new Map();           // ip -> t da ultima sondagem
  const falasVistas = new Set();      // t das falas dela ja espelhadas

  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    if (fs.existsSync(arquivo)) {
      const linhas = fs.readFileSync(arquivo, "utf8").trim().split("\n").slice(-300);
      for (const l of linhas) {
        try {
          const m = JSON.parse(l);
          if (!m || !m.id) continue;
          seq = Math.max(seq, m.id);
          if (m.marca === "limpo") { itens.length = 0; continue; }   // a limpeza do lancamento: o que veio antes nao volta
          itens.push(m); if (m.dela && m.falaT) falasVistas.add(m.falaT);
        } catch { /* linha torta */ }
      }
    }
  } catch { /* sem historico */ }

  function guardar(m) {
    itens.push(m); if (itens.length > 300) itens.splice(0, itens.length - 300);
    try { fs.appendFileSync(arquivo, JSON.stringify(m) + "\n"); } catch { /* disco cheio: a fila em memoria segue */ }
    return m;
  }

  function limpar(s, max) {
    return String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  return {
    /* mensagem do publico; devolve {erro} ou o item */
    publicar({ nome, texto, ip }) {
      nome = limpar(nome, 20); texto = limpar(texto, 240);
      if (nome.length < 2) return { erro: "pick a name (2 to 20 letters)" };
      if (/^yuna$/i.test(nome)) return { erro: "that name is taken" };
      if (!texto) return { erro: "say something" };
      if (/(https?:\/\/|www\.)/i.test(texto)) return { erro: "no links here" };
      const agora = Date.now(), ult = ultimoPorIp.get(ip) || 0;
      if (agora - ult < 4000) return { erro: "slow down a bit" };
      ultimoPorIp.set(ip, agora);
      return guardar({ id: ++seq, t: agora, nome, texto, dela: false });
    },
    /* fala dela (espelho do estado do motor); `falaT` evita repetir a mesma */
    dela(texto, falaT) {
      texto = limpar(texto, 600); if (!texto) return null;
      if (falaT && falasVistas.has(falaT)) return null;
      if (falaT) falasVistas.add(falaT);
      return guardar({ id: ++seq, t: Date.now(), nome: "Yuna", texto, dela: true, falaT: falaT || null });
    },
    recentes(desde) {
      desde = Number(desde) || 0;
      const r = desde ? itens.filter((m) => m.id > desde) : itens.slice(-60);
      return r.map((m) => ({ id: m.id, t: m.t, nome: m.nome, texto: m.texto, dela: !!m.dela }));
    },
    /* quem esta assistindo agora (sondou o chat nos ultimos 40 s) */
    viu(ip) { vistos.set(ip, Date.now()); },
    publico() {
      const agora = Date.now(); let n = 0;
      for (const [ip, t] of vistos) { if (agora - t < 40000) n++; else vistos.delete(ip); }
      return n;
    },
    /* LIMPA TUDO (o dia do lancamento): a fila esvazia, o arquivo ganha uma
       marca com o contador — os ids continuam de onde estavam, senao o motor,
       que guarda o ultimo id visto, ignoraria as mensagens novas. */
    limpar() {
      const n = itens.length; itens.length = 0;
      try { fs.appendFileSync(arquivo, JSON.stringify({ id: seq, marca: "limpo", t: Date.now() }) + "\n"); } catch { /* segue so em memoria */ }
      return n;
    },
    /* pro motor: o que o publico disse depois de `desde` (id), so gente */
    doPublico(desde) { return itens.filter((m) => !m.dela && m.id > (Number(desde) || 0)); },
    ultimoId() { return seq; },
  };
}
