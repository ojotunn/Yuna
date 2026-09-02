// ============================================================================
// Chat ao vivo da pump.fun — SOMENTE LEITURA.
//
// Protocolo capturado do proprio site (socket.io v4 sobre ws):
//   1. wss://livechat.pump.fun/socket.io/?EIO=4&transport=websocket
//   2. servidor manda  0{"sid":...}
//   3. cliente manda   40{"origin":"https://pump.fun","timestamp":<ms>,
//                          "token":null,"deviceId":"device-<uuid>"}
//   4. servidor manda  40{"sid":...}
//   5. cliente manda   42N["joinRoom",{roomId:<mint>,username:""}]
//      -> ack 43N[{authenticated:false,...,roomConfig:{tokenGateEnabled}}]
//   6. cliente manda   42N["getMessageHistory",{roomId,before:null,limit:50}]
//      -> ack 43N[[ ...mensagens... ]]
//   7. mensagens novas chegam como push 42["<evento>",{...message...}]
//
// LER NAO EXIGE LOGIN: o site conecta com token:null e recebe o historico.
// `authenticated:false` e o estado normal de quem so assiste.
//
// ENVIAR exige sessao — e a sessao viaja no COOKIE, nao no campo `token` do
// handshake (que continua `null` mesmo logado; capturado da propria pagina).
// Por isso `sendAs` recebe os cookies do perfil do agente:
//   8. cliente manda   42N["sendMessage",{roomId,message,username:<ENDERECO>}]
//      -> ack 43N[{ id, roomId, message, username, userAddress, ... }]
//   Repare que `username` no ENVIO leva o endereco da carteira, nao o nome de
//   exibicao — o servidor resolve o nome sozinho na resposta.
//
// Mensagem nova de qualquer um chega como push 42["newMessage",{...}], e o
// cliente confirma leitura com 42["messageReceived",{messageId}].
//
// Tudo que CHEGA daqui e ENTRADA NAO CONFIAVEL — texto de estranho digitado
// direto para os agentes, a maior superficie de injecao do projeto. O engine
// trata como dado, nunca como instrucao.
// ============================================================================

import WebSocket from "ws";
import crypto from "node:crypto";

const URL = "wss://livechat.pump.fun/socket.io/?EIO=4&transport=websocket";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const KEEP = 120; // mensagens mantidas por sala

const rooms = new Map(); // mint -> { ws, messages, seen, config, closed }

function normalize(m) {
  return {
    id: m.id,
    text: String(m.message ?? ""),
    username: String(m.username ?? "anon"),
    address: String(m.userAddress ?? ""),
    at: m.timestamp ? Date.parse(m.timestamp) : Date.now(),
    isCreator: !!m.isCreator,
    isModerator: !!m.isModerator,
  };
}

function push(room, raw) {
  const m = normalize(raw);
  if (!m.id || room.seen.has(m.id)) return;
  room.seen.add(m.id);
  room.messages.push(m);
  if (room.messages.length > KEEP) room.messages.shift();
}

// Abre (ou reusa) a sala do mint. Resolve quando o historico chega.
// Rejoin de sala caida REAPROVEITA messages/seen da anterior: o historico que
// o servidor mandar de novo nao vira mensagem "nova" no palco.
export function join(mint, { timeout = 15000 } = {}) {
  const existing = rooms.get(mint);
  if (existing && !existing.closed) return Promise.resolve(existing);

  const room = {
    ws: null,
    messages: existing?.messages ?? [],
    seen: existing?.seen ?? new Set(),
    config: null,
    closed: false,
  };
  rooms.set(mint, room);

  return new Promise((resolve, reject) => {
    let ackId = 0;
    const pending = new Map(); // id do ack -> handler
    const ws = new WebSocket(URL, { headers: { origin: "https://pump.fun", "user-agent": UA } });
    room.ws = ws;

    const emit = (event, payload, onAck) => {
      const id = ackId++;
      if (onAck) pending.set(id, onAck);
      ws.send(`42${id}${JSON.stringify([event, payload])}`);
    };

    const timer = setTimeout(() => reject(new Error("livechat: timeout no join")), timeout);

    ws.on("message", (data) => {
      const s = data.toString();

      if (s.startsWith("0{")) {
        // Handshake do namespace: o site manda esse envelope; token null = anonimo.
        ws.send(`40${JSON.stringify({
          origin: "https://pump.fun",
          timestamp: Date.now(),
          token: null,
          deviceId: `device-${crypto.randomUUID()}`,
        })}`);
        return;
      }

      if (s.startsWith("40")) {
        emit("joinRoom", { roomId: mint, username: "" }, (payload) => {
          room.config = payload?.[0] ?? null;
          emit("getMessageHistory", { roomId: mint, before: null, limit: 50 }, (hist) => {
            for (const m of hist?.[0] ?? []) push(room, m);
            // Historico vem do mais novo para o mais velho; queremos cronologico.
            room.messages.sort((a, b) => a.at - b.at);
            clearTimeout(timer);
            resolve(room);
          });
        });
        return;
      }

      if (s === "2") { ws.send("3"); return; } // ping do servidor

      // Ack de algo que pedimos: 43<id>[payload]
      const ack = s.match(/^43(\d+)(\[[\s\S]*)$/);
      if (ack) {
        const fn = pending.get(Number(ack[1]));
        pending.delete(Number(ack[1]));
        if (fn) { try { fn(JSON.parse(ack[2])); } catch {} }
        return;
      }

      // Push do servidor: 42[evento, payload]. Nao adivinhamos o nome do evento
      // de mensagem nova — qualquer payload com `message` + `id` e uma fala.
      const ev = s.match(/^42(\[[\s\S]*)$/);
      if (ev) {
        try {
          const [, payload] = JSON.parse(ev[1]);
          if (payload && typeof payload.message === "string" && payload.id) push(room, payload);
        } catch {}
      }
    });

    ws.on("error", (e) => { clearTimeout(timer); room.closed = true; reject(e); });
    ws.on("close", () => { room.closed = true; });
  });
}

// As ultimas `n` mensagens da sala, cronologicas.
export function recent(mint, n = 15) {
  const room = rooms.get(mint);
  if (!room) return [];
  return room.messages.slice(-n);
}

// Mensagens ainda nao entregues a este leitor (por agente). Amostrar importa:
// o chat e mangueira de incendio e cada token lido custa dinheiro.
const cursors = new Map(); // `${mint}|${who}` -> ultimo id entregue
export function fresh(mint, who, max = 8) {
  const room = rooms.get(mint);
  if (!room) return [];
  if (!(max > 0)) max = 8; // 0/NaN entregaria nada e pareceria "chat mudo"
  const key = `${mint}|${who}`;
  const last = cursors.get(key);
  const all = room.messages;
  // PRIMEIRA leitura deste leitor: pula TUDO que ja estava na sala. O historico
  // (conversas de sessoes e testes antigos) nao e conversa de agora — entregar
  // ele fazia os agentes responderem papo de dias atras como se fosse novo.
  if (last === undefined) {
    if (all.length) cursors.set(key, all[all.length - 1].id);
    return [];
  }
  const idx = all.findIndex((m) => m.id === last);
  // Cursor sumiu do buffer (sala muito ativa): entrega só o rabo recente.
  const from = idx >= 0 ? idx + 1 : Math.max(0, all.length - max);
  const out = all.slice(from).slice(-max);
  if (out.length) cursors.set(key, out[out.length - 1].id);
  return out;
}

export function roomInfo(mint) {
  const room = rooms.get(mint);
  return room ? { config: room.config, connected: !room.closed, held: room.messages.length } : null;
}

// RELIGA a sala se caiu ou nunca conectou (o boot da noite 2, 15/08/2026,
// levou um 502 passageiro e o show ficou surdo ate restart manual — nunca
// mais). Guarda de 60s entre tentativas: queda persistente do lado da pump
// nao pode virar marreta no servidor deles. Devolve a sala conectada, ou
// null se ainda esta na janela de espera.
const ultimaTentativa = new Map(); // mint -> timestamp
export async function ensure(mint, { retryMs = 60000 } = {}) {
  const room = rooms.get(mint);
  if (room && !room.closed) return room;
  const antes = ultimaTentativa.get(mint) ?? 0;
  if (Date.now() - antes < retryMs) return null;
  ultimaTentativa.set(mint, Date.now());
  return join(mint);
}

// So para as provas: derruba a conexao como se a rede tivesse caido.
export function _dropForTest(mint) {
  const room = rooms.get(mint);
  if (!room) return;
  room.closed = true;
  try { room.ws?.close(); } catch { /* ja caiu */ }
}

// ----------------------------- ENVIO (autenticado) ----------------------------
//
// Abre uma conexao propria, manda uma mensagem, confere o ack e fecha. Conexao
// por mensagem e desperdicio em tese, mas agente posta raramente e conexao
// curta nao acumula estado nem token vencido — troca boa.
//
// `cookies` sai do perfil logado do agente (browser.js). Sem eles o servidor
// aceita a conexao mas responde `authenticated:false` e recusa o envio.
/* A mensagem VOLTOU pela sala? O motor mantem uma conexao aberta que recebe
   `newMessage` de todo mundo — inclusive dela. Se o id aparecer la dentro da
   janela, foi publicado de verdade; se nao, o servidor aceitou e engoliu.
   Sem sala aberta nao da pra confirmar: devolve true para nao inventar uma
   falha que nao sei que existe. */
/* A PROVA E A MENSAGEM ESTAR NA LISTA QUE A SALA MOSTRA, nao no conjunto de
   ids ja vistos. `seen` serve pra nao processar a mesma mensagem duas vezes e
   guarda id de tudo que passou pelo socket — inclusive o eco privado que a
   pump devolve pra quem foi silenciado. `messages` e o que um terceiro leria. */
function naListaDaSala(room, id) {
  return (room.messages ?? []).some((m) => m && m.id === id);
}

function confirmarEntrega(mint, id, janelaMs = 4000) {
  const room = rooms.get(mint);
  /* SEM SALA, A RESPOSTA E "NAO SEI" — e "nao sei" nao e "sim".
     Isto devolvia `true` sem ter olhado nada: se a conexao da sala tivesse
     caido no instante do envio, toda mensagem virava "entregue". Medido em
     02/09: duas dela marcadas como entregues e ZERO aparecendo nas 50
     mensagens que a sala mostra. Melhor ela saber que nao sabe. */
  if (!room || room.closed) return Promise.resolve(false);
  if (naListaDaSala(room, id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const fim = Date.now() + janelaMs;
    const olhar = () => {
      if (naListaDaSala(room, id)) return resolve(true);
      if (Date.now() >= fim) return resolve(false);
      setTimeout(olhar, 250);
    };
    setTimeout(olhar, 250);
  });
}

export function sendAs(mint, text, { cookies, address, timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    const msg = String(text ?? "").trim();
    if (!msg) return resolve({ ok: false, code: "empty" });
    if (!cookies) return resolve({ ok: false, code: "unauthenticated" });

    let ackId = 0;
    const pending = new Map();
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "offline" }), timeout);

    const ws = new WebSocket(URL, {
      headers: { origin: "https://pump.fun", "user-agent": UA, cookie: cookies },
    });

    const emit = (event, payload, onAck) => {
      const id = ackId++;
      if (onAck) pending.set(id, onAck);
      ws.send(`42${id}${JSON.stringify([event, payload])}`);
    };

    ws.on("message", (data) => {
      const s = data.toString();

      if (s.startsWith("0{")) {
        ws.send(`40${JSON.stringify({
          origin: "https://pump.fun",
          timestamp: Date.now(),
          token: null,
          deviceId: `device-${crypto.randomUUID()}`,
        })}`);
        return;
      }

      if (s.startsWith("40")) {
        emit("joinRoom", { roomId: mint, username: address ?? "" }, (payload) => {
          const cfg = payload?.[0] ?? {};
          // A prova de que o cookie valeu. Sem isto o envio seria silenciosamente
          // ignorado e o agente acharia que falou.
          if (!cfg.authenticated) return finish({ ok: false, code: "unauthenticated" });
          /* GATE LIGADO NAO E "VOCE ESTA BARRADA".
             `tokenGateEnabled` diz que a sala so aceita quem tem a moeda —
             quem tem, entra. Recusar na bandeira fazia ela nunca falar nem
             depois de comprar. Passa a recusar so quando da pra AFIRMAR que
             ela nao cumpre; na duvida tenta, e a confirmacao de entrega
             decide (ela nao ganha "entregue" falso: isso foi consertado). */
          const gate = cfg.roomConfig ?? {};
          if (gate.tokenGateEnabled && gate.userHoldsRequired === false)
            return finish({ ok: false, code: "token-gated" });

          emit("sendMessage", { roomId: mint, message: msg, username: address }, (ack) => {
            const eco = ack?.[0];
            if (!eco?.id) return finish({ ok: false, code: "rejected" });
            /* O ACK NAO E PROVA. (01/09/2026)
               A pump.fun devolve id e nome de exibicao para mensagem que ela
               NAO transmite — foi o que aconteceu no lancamento: cinco
               mensagens "entregues" que ninguem na sala viu. Ack e recibo de
               recebimento, nao de publicacao.
               A prova real e a mensagem VOLTAR pelo push `newMessage` na sala
               que o motor ja escuta. Se nao voltar, ela foi engolida. */
            confirmarEntrega(mint, eco.id)
              .then((entregue) => finish(entregue
                ? { ok: true, id: eco.id, username: eco.username }
                : { ok: false, code: "undelivered", id: eco.id }));
          });
        });
        return;
      }

      if (s === "2") { ws.send("3"); return; }

      const ack = s.match(/^43(\d+)(\[[\s\S]*)$/);
      if (ack) {
        const fn = pending.get(Number(ack[1]));
        pending.delete(Number(ack[1]));
        if (fn) { try { fn(JSON.parse(ack[2])); } catch { finish({ ok: false, code: "rejected" }); } }
        return;
      }

      // O servidor reclama por aqui quando recusa (limite de taxa, por exemplo).
      const ev = s.match(/^42(\[[\s\S]*)$/);
      if (ev) {
        try {
          const [nome, payload] = JSON.parse(ev[1]);
          if (nome === "exception") {
            const m = String(payload?.message ?? "");
            finish({ ok: false, code: /limit|slow|frequent/i.test(m) ? "rate-limited" : "rejected" });
          }
        } catch {}
      }
    });

    ws.on("error", () => finish({ ok: false, code: "offline" }));
    ws.on("close", () => finish({ ok: false, code: "offline" }));
  });
}

export function leave(mint) {
  const room = rooms.get(mint);
  if (room?.ws) { try { room.ws.close(); } catch {} }
  rooms.delete(mint);
}
