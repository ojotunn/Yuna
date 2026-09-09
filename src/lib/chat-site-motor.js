// ============================================================================
// O CHAT DO SITE, visto pelo MOTOR. O servidor (yuna.js) e o dono da fila; o
// motor conversa com ele por HTTP na porta local: le o que o publico escreveu
// desde o ultimo id e publica o que ela responde (como ela, `dela: true`).
//
// Nunca lanca: sem servidor, sem token ou com a rede fora, devolve vazio e
// o turno dela segue -- o chat e plateia, nao motor.
// ============================================================================
export function criarChatDoSite({ base, token }) {
  const cab = { "x-admin-token": token || "" };
  async function pegar(url, opts = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { ...cab, ...(opts.headers || {}) } });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return {
    ligado: !!(base && token),
    base,
    /* o que o publico disse com id > desde: {itens: [{id, nome, texto, t}], publico, ultimo} */
    async novas(desde) {
      if (!base || !token) return { itens: [], publico: 0, ultimo: Number(desde) || 0 };
      const d = await pegar(`${base}/api/chat?desde=${Number(desde) || 0}&motor=1`);
      if (!d || !Array.isArray(d.itens)) return { itens: [], publico: 0, ultimo: Number(desde) || 0 };
      const ultimo = d.itens.reduce((m, x) => Math.max(m, Number(x.id) || 0), Number(desde) || 0);
      return { itens: d.itens.filter((m) => !m.dela), publico: Number(d.publico) || 0, ultimo };
    },
    /* o que ela diz no chat, como ela */
    async falar(texto) {
      if (!base || !token) return { ok: false, code: "off" };
      const d = await pegar(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dela: true, texto }),
      });
      return d && d.ok ? { ok: true, id: d.id } : { ok: false, code: (d && d.erro) || "rejected" };
    },
  };
}
