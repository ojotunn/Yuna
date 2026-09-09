/* YUNA-VRM -- o motor da personagem no corpo VRM (VRoid), three moderno.
   Porte do tela/yuna3d.js (corpo do Meshy, three r128), que continua servindo
   o /palco e o /montar. Mesma ideia: anda pela grade de 7,5 cm (A*), ocupa
   ESTACOES derivadas dos moveis, senta/levanta/deita com os QUADRIS como
   ancora (a origem do objeto e recolocada por clipe: origem = quadris -
   deslocamento do clipe), cadeira do PC gira em torno do assento.

   O que muda no VRM: os clipes ja vem retargetados (vrm-clipes.js) e em
   METROS no humanoid normalizado do three-vrm; nao ha cabelo nem dedos por
   codigo (o cabelo tem spring bones nativos; os dedos existem de verdade e
   ganham uma pose relaxada/digitando por codigo); piscar e boca sao
   EXPRESSOES do VRM; o olhar segue a camera.

   Uso:  const Y = criarYuna({THREE, cena, vrm, clips, malha, MAPA, postos, PISO_Y});
         await Y.iniciar();   ...   Y.atualizar(dt) por quadro (chama vrm.update). */
export function criarYuna(ctx){
  const THREE = ctx.THREE, cena = ctx.cena, vrm = ctx.vrm, malha = ctx.malha, MAPA = ctx.MAPA, postos = ctx.postos, PISO_Y = ctx.PISO_Y || 0;
  const Y = {
    pronto: false, obj: vrm.scene, vrm: vrm, mixer: null, acoes: {}, clipes: [], atual: null, clipeAtual: null,
    altura: 1.6, escala: 1, raio: 0.22, vel: 0.9,
    x: 0, y: 0, z: 0, giro: 0, giroAlvo: null,
    quadris: {x: 0, z: 0}, superficie: null,
    estado: "parada", estacao: null, caminho: [], passo: 0, lerp: null, pivot: null,
    aoChegar: null, aoVirar: null, aoTerminar: null,
    cfg: {altura: 0, vel: 0.9, inicio: "mesa", estacoes: {}},
    grade: null, marcas: null, off: {}, fatorQuadris: 1, log: [], tempo: 0,
    cfgUrl: ctx.cfgUrl || "/casa/yuna-vrm.json", salvarUrl: ctx.salvarUrl || "/salvar-yuna-vrm"
  };
  const CEL = 0.075;
  const LOOP = {idle:1, idle_2:1, look_around:1, sit_idle:1, sit_arms_crossed:1, sit_floor:1, sleep:1, sleep_desk:1,
                walk:1, walking_basico:1, running_basico:1, typing:1, draw:1, talk:1, sit_talk:1, phone:1, dance:1, halteres:1, sofa_deitada:1, dormir_lado:1, dormir_lado_esp:1};
  /* loops deitados tocam em vai-e-vem: o loop do Meshy nao fecha e a respiracao ao contrario e igual */
  const VAI_E_VEM = {sofa_deitada: 1, dormir_lado: 1, dormir_lado_esp: 1};
  const NA_ESTACAO = {
    mesa: ["typing", "draw", "sit_idle", "sit_talk", "sit_drink", "sleep_desk", "sit_clap", "sit_arms_crossed", "phone"],
    sofa: ["sofa_deitada", "sit_idle", "sit_arms_crossed", "sit_talk", "sit_drink", "phone", "sit_clap"],
    halter: ["halteres", "idle", "stretch", "tired"],
    pikachu: ["pet_pikachu", "idle", "look_around", "wave"],
    cafe: ["idle", "drink", "talk", "phone", "look_around", "tired"],
    cama: [], tapete: ["sit_floor"],
    porta: ["idle", "wave", "wave_big", "talk", "look_around"],
    janela: ["look_around", "idle", "idle_2", "tired"],
    centro: ["idle", "idle_2", "stretch", "dance", "wave", "wave_big", "talk", "look_around", "cheer", "tired", "phone", "drink"]
  };
  function anota(m){ Y.log.push(m); if (Y.log.length > 40) Y.log.shift(); if (typeof console !== "undefined") console.log("[yuna-vrm]", m); }
  function anguloDif(a, b){ let d = a - b; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; }
  function osso(n){ return vrm.humanoid.getNormalizedBoneNode(n); }
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const hipsNome = osso("hips").name;

  /* ------------------------------------------------------- deslocamentos */
  /* quadris no clipe (metros, espaco local do VRM) no COMECO e no FIM */
  function medirQuadris(clip){
    const t = clip.tracks.find(function(tr){ return tr.name === hipsNome + ".position"; });
    if (!t) return {ini: {x: 0, y: 0.8, z: 0}, fim: {x: 0, y: 0.8, z: 0}};
    const n = Math.floor(t.values.length / 3);
    const media = function(a, b){ let sx = 0, sy = 0, sz = 0, k = 0; for (let i = a; i < b; i++){ sx += t.values[i*3]; sy += t.values[i*3+1]; sz += t.values[i*3+2]; k++; } return k ? {x: sx/k, y: sy/k, z: sz/k} : {x: 0, y: 0.8, z: 0}; };
    return {ini: media(0, Math.max(1, Math.floor(n * 0.1))), fim: media(Math.floor(n * 0.75), n)};
  }
  function off(clipe, fase){ const o = Y.off[clipe]; return o ? o[fase || "fim"] : {x: 0, y: 0.8, z: 0}; }
  function paraMundo(d, giro){ const f = Y.fatorQuadris; return {x: (d.x * Math.cos(giro) + d.z * Math.sin(giro)) * f, z: (-d.x * Math.sin(giro) + d.z * Math.cos(giro)) * f}; }
  function origemPara(q, giro, clipe, fase){ const w = paraMundo(off(clipe, fase), giro); return {x: q.x - w.x, z: q.z - w.z}; }
  function quadrisDe(o, giro, clipe, fase){ const w = paraMundo(off(clipe, fase), giro); return {x: o.x + w.x, z: o.z + w.z}; }
  function SENTAR(){ return Y.acoes.sentar_reto ? "sentar_reto" : "sit_down"; }
  /* andar: o "walk" do Meshy (texto) cruza as pernas na linha do meio e leva os
     bracos duros (Michel viu); o walking_basico (biblioteca) passa larga e
     balanca os bracos com o cotovelo dobrado */
  function ANDAR(){ return Y.acoes.walking_basico ? "walking_basico" : "walk"; }
  const PELVE = 0.09;                        // centro dos quadris ~9 cm acima do assento
  function alturaPara(ySup, clipe, fase){
    if (ySup == null || ySup - PISO_Y < 0.15) return PISO_Y;
    const q = off(clipe, fase).y * Y.fatorQuadris;
    if (q > 0.75) return PISO_Y + Math.max(-9, (ySup - PISO_Y) - q);            // deitada: o clipe traz a cama embutida
    return PISO_Y + Math.max(-0.08, (ySup + PELVE - PISO_Y) - q);
  }
  /* ALINHAR CLIPE: gira o clipe `nome` em torno do eixo vertical pra direcao
     quadris->cabeca da pose dele bater com a do clipe de referencia (o Meshy
     deita a moca em qualquer direcao; o deitada-no-sofa vinha atravessado em
     relacao ao fim do subir-pernas e os pes saiam pela frente do sofa). Mexe so
     nas trilhas dos quadris (raiz do humanoide): o resto vem junto. */
  function alinharClipe(nome, frac, ref, fracRef){
    const pa = poseDe(nome, frac), pb = poseDe(ref, fracRef); if (!pa || !pb) return;
    const eixo = function(pose){ const h = pose.find(function(b){ return b.osso === "head"; }); return h ? Math.atan2(h.dx, h.dz) : 0; };
    const delta = anguloDif(eixo(pb), eixo(pa)); if (Math.abs(delta) < 0.03) return;
    const clip = Y.acoes[nome].getClip(), R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), delta);
    const q = new THREE.Quaternion(), v = new THREE.Vector3();
    clip.tracks.forEach(function(tr){
      if (!/Hips\.quaternion$/.test(tr.name) && !/Hips\.position$/.test(tr.name)) return;
      const a = tr.values;
      if (/quaternion$/.test(tr.name)) for (let i = 0; i < a.length; i += 4){ q.set(a[i], a[i+1], a[i+2], a[i+3]).premultiply(R); a[i] = q.x; a[i+1] = q.y; a[i+2] = q.z; a[i+3] = q.w; }
      else for (let i = 0; i < a.length; i += 3){ v.set(a[i], a[i+1], a[i+2]).applyQuaternion(R); a[i] = v.x; a[i+1] = v.y; a[i+2] = v.z; }
    });
    const velho = Y.acoes[nome]; velho.stop(); Y.mixer.uncacheAction(clip);
    const a = Y.mixer.clipAction(clip); if (!LOOP[nome]){ a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else if (VAI_E_VEM[nome]) a.setLoop(THREE.LoopPingPong, Infinity);
    Y.acoes[nome] = a; Y.off[nome] = medirQuadris(clip);
    anota("clipe " + nome + " girado " + (delta * 180 / Math.PI).toFixed(0) + " graus pra alinhar com " + ref);
  }
  function vetorCabeca(nome){
    const a = Y.acoes[nome]; if (!a) return {x: 0, z: 1};
    const giroAntes = Y.obj.rotation.y, atual = Y.atual; Y.obj.rotation.y = 0;
    if (atual) atual.enabled = false;
    a.enabled = true; a.setEffectiveWeight(1); a.play(); a.time = a.getClip().duration * 0.9; Y.mixer.update(0); Y.obj.updateMatrixWorld(true);
    const vh = new THREE.Vector3(), vq = new THREE.Vector3(); osso("head").getWorldPosition(vh); osso("hips").getWorldPosition(vq);
    a.stop(); if (atual) atual.enabled = true;
    Y.obj.rotation.y = giroAntes;
    const dx = vh.x - vq.x, dz = vh.z - vq.z, d = Math.hypot(dx, dz) || 1;
    return {x: dx / d, z: dz / d};
  }

  /* ------------------------------------------------------------ carregar */
  Y.iniciar = async function(){
    try { const r = await fetch(Y.cfgUrl, {cache: "no-store"}); if (r.ok) Object.assign(Y.cfg, await r.json()); } catch (e){}
    Y.vel = Y.cfg.vel || 0.9; Y.cfg.estacoes = Y.cfg.estacoes || {};
    /* altura natural do VRM (ela em T-pose) e escala opcional da cfg */
    Y.obj.updateMatrixWorld(true);
    const cx = new THREE.Box3().setFromObject(Y.obj); Y.alturaNatural = cx.max.y - cx.min.y;
    Y.altura = Y.cfg.altura || Y.alturaNatural; Y.escala = Y.altura / Y.alturaNatural; Y.obj.scale.setScalar(Y.escala); Y.fatorQuadris = Y.escala;
    Y.mixer = new THREE.AnimationMixer(Y.obj);
    (ctx.clips || []).forEach(function(cl){
      const a = Y.mixer.clipAction(cl);
      if (!LOOP[cl.name]){ a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else if (VAI_E_VEM[cl.name]) a.setLoop(THREE.LoopPingPong, Infinity);
      Y.acoes[cl.name] = a; Y.clipes.push(cl.name); Y.off[cl.name] = medirQuadris(cl);
    });
    Y.clipes.sort();
    Y.mixer.addEventListener("finished", function(e){
      if (e.action !== Y.atual) return;
      Y.quadris = quadrisDe({x: Y.x, z: Y.z}, Y.giro, Y.clipeAtual, "fim");
      if (Y.aoTerminar){ const f = Y.aoTerminar; Y.aoTerminar = null; f(); }
    });
    Y.cabeca = {sleep: vetorCabeca("sleep")};
    alinharClipe("sofa_deitada", 0.5, "subir_pernas", 0.98);
    alinharClipe("dormir_lado", 0.5, "deitar_lado", 0.98);
    Y.maosMedia = medirMaos("typing");
    alinharClipe("dormir_lado_esp", 0.5, "deitar_lado_esp", 0.98);
    /* DEDOS de verdade (VRM): pose relaxada por codigo; digitando mexem */
    Y.dedos = [];
    ["left", "right"].forEach(function(lado, li){
      ["Index", "Middle", "Ring", "Little"].forEach(function(dedo, di){
        ["Proximal", "Intermediate", "Distal"].forEach(function(seg, si){
          const n = osso(lado + dedo + seg); if (n) Y.dedos.push({no: n, lado: lado, dedo: di, seg: si, sinal: li === 0 ? -1 : 1, fase: di * 1.7 + li * 0.9});
        });
      });
      ["Metacarpal", "Proximal", "Distal"].forEach(function(seg, si){ const n = osso(lado + "Thumb" + seg); if (n) Y.dedos.push({no: n, lado: lado, dedo: -1, seg: si, sinal: li === 0 ? -1 : 1, fase: 0}); });
    });
    Y.olhos = {proxima: 2, fechadosAte: 0};
    /* OBJETOS NA MAO: caneca (beber) e celular (telefone), filhos do osso da mao
       direita; aparecem so durante os clipes certos */
    (function(){
      const mao = osso("rightHand"); if (!mao) return;
      const caneca = new THREE.Group();
      const corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.09, 20, 1, true), new THREE.MeshStandardMaterial({color: 0xf2f2f2, roughness: 0.5, side: THREE.DoubleSide}));
      const fundo = new THREE.Mesh(new THREE.CircleGeometry(0.032, 20).rotateX(Math.PI/2), corpo.material); fundo.position.y = -0.045;
      const cafe = new THREE.Mesh(new THREE.CircleGeometry(0.034, 20).rotateX(-Math.PI/2), new THREE.MeshStandardMaterial({color: 0x3a2412, roughness: 0.3})); cafe.position.y = 0.03;
      const alca = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 20, Math.PI), corpo.material); alca.rotation.z = -Math.PI/2; alca.position.x = 0.036;
      caneca.add(corpo, fundo, cafe, alca);
      /* na mao normalizada (T-pose: dedos pra -x na direita, palma pra baixo): a caneca fica na palma, alca pra fora */
      caneca.position.set(-0.07, -0.03, 0.0); caneca.rotation.set(0, 0, Math.PI/2); caneca.visible = false;
      const celular = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.145, 0.008), new THREE.MeshStandardMaterial({color: 0x15151a, roughness: 0.35, metalness: 0.4}));
      const telaCel = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.13), new THREE.MeshStandardMaterial({color: 0x000000, emissive: 0x9fc4ff, emissiveIntensity: 0.9})); telaCel.position.z = 0.0045; celular.add(telaCel);
      celular.position.set(-0.08, -0.02, 0.0); celular.rotation.set(0, Math.PI/2, Math.PI/2); celular.visible = false;
      caneca.traverse(function(o){ if (o.isMesh) o.castShadow = true; }); celular.castShadow = true;
      mao.add(caneca); mao.add(celular);
      Y.objetosMao = {caneca: caneca, celular: celular};
    })();
    Y.y = PISO_Y;
    const E = Y.estacoes(); const ini = E[Y.cfg.inicio] || E.centro;
    if (ini){ Y.x = ini.aprox.x; Y.z = ini.aprox.z; Y.giro = ini.giro; }
    Y.quadris = quadrisDe({x: Y.x, z: Y.z}, Y.giro, "idle");
    Y.pronto = true;
    Y.tocar("idle", 0);
    if (ini && ini.chegar && ini.chegar.length){ if (ini.preparar) ini.preparar(); Y.sequencia(ini.chegar, function(){ Y.estacao = Y.cfg.inicio; Y.estado = "na estacao"; }); }
    anota("pronta: " + Y.clipes.length + " clipes, altura " + Y.altura.toFixed(2) + " m, " + Y.dedos.length + " ossos de dedo");
    return Y;
  };
  Y.mudarAltura = function(h){
    Y.altura = h; Y.cfg.altura = h; Y.escala = h / Y.alturaNatural; Y.obj.scale.setScalar(Y.escala); Y.fatorQuadris = Y.escala;
  };

  /* -------------------------------------------------------------- clipes */
  Y.tocar = function(nome, fade, aoTerminar, ancorar){
    const a = Y.acoes[nome];
    if (!a){ anota("sem clipe " + nome); if (aoTerminar) aoTerminar(); return; }
    if (fade == null) fade = 0.3;
    if (ancorar){
      const sup = (ancorar === true) ? {ini: Y.superficie, fim: Y.superficie} : ancorar;
      const g = Y.giroAlvo != null ? Y.giroAlvo : Y.giro;
      const o = origemPara(Y.quadris, g, nome, "ini");
      const yIni = alturaPara(sup.ini, nome, "ini"), yFim = alturaPara(sup.fim, nome, "fim");
      const dur = LOOP[nome] ? Math.max(0.2, fade) : a.getClip().duration;
      /* deriva: deslocamento extra espalhado pela duracao do clipe (ela senta na
         beira da cama e ESCORREGA pra dentro enquanto deita, e volta ao levantar) */
      Y.lerp = {de: {x: Y.x, y: Y.y, z: Y.z}, para: {x: o.x, z: o.z}, yIni: yIni, yFim: yFim, t: 0, fade: Math.max(0.15, fade), durY: Math.max(dur, fade + 0.05), deriva: (ancorar !== true && ancorar.deriva) || null};
    }
    a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.reset(); a.play();
    if (nome === "walk" || nome === "walking_basico") a.setEffectiveTimeScale(Math.max(0.5, Y.vel / 1.0));
    if (Y.atual && Y.atual !== a) Y.atual.crossFadeTo(a, fade, true);
    Y.atual = a; Y.clipeAtual = nome; Y.aoTerminar = null;
    if (aoTerminar){ if (LOOP[nome]) aoTerminar(); else Y.aoTerminar = aoTerminar; }
  };
  Y.sequencia = function(passos, fim){
    let i = 0;
    const proximo = function(){
      if (i >= passos.length){ if (fim) fim(); return; }
      const p = passos[i++];
      if (p.pivot){
        const pv = p.pivot; if (pv.antes) pv.antes();
        Y.superficie = pv.superficie !== undefined ? pv.superficie : Y.superficie;
        /* movel junto: o centro "posto" e o pe do movel onde ele esta AGORA; com `arco`
           os quadris dela giram em torno do mesmo centro que o movel (ela vai com a
           cadeira, em vez de cortar em linha reta por dentro dela) */
        const mv = pv.movel || null, mc = mv ? centroDoMovel(mv) : null;
        Y.pivot = {de: {q: {x: Y.quadris.x, z: Y.quadris.z}, giro: Y.giro, y: Y.y}, para: {q: pv.quadris, giro: pv.giro}, t: 0, dur: pv.dur || 1.2,
                   clipe: pv.clipe || Y.clipeAtual, movel: mv, movelCentro: mc,
                   arco: (mv && mv.arco && mc && mv.posto && mv.posto.obj) ? {centro: mc, ang: anguloDif(mv.giro, mv.posto.obj.rotation.y)} : null, fim: proximo};
        Y.giroAlvo = null; Y.lerp = null;
        const fadePv = pv.fade != null ? pv.fade : 0.5;
        if (pv.clipe && pv.clipe !== Y.clipeAtual) Y.tocar(pv.clipe, fadePv, null, false);
        /* a origem nao pula na troca de clipe: a diferenca e desfeita no ritmo do crossfade */
        const o0 = origemPara(Y.pivot.de.q, Y.giro, Y.pivot.clipe, "fim");
        Y.pivot.desloc = {x: Y.x - o0.x, z: Y.z - o0.z, fade: Math.max(0.1, fadePv)};
        return;
      }
      const antes = Y.superficie;
      if (p.superficie !== undefined) Y.superficie = p.superficie;
      if (p.giro != null){ Y.giro = p.giro; Y.giroAlvo = null; }
      if (p.movel) girarMovel(p.movel.posto, p.movel.giro, p.movel.dur || 0.8, centroDoMovel(p.movel), p.movel.desloc, p.movel.paraPos, p.movel.atraso);
      Y.tocar(p.clipe, p.fade, proximo, {ini: antes, fim: Y.superficie, deriva: p.deriva || null});
    };
    proximo();
  };
  Y.opcoes = function(){ return (Y.estacao && NA_ESTACAO[Y.estacao]) ? NA_ESTACAO[Y.estacao].filter(function(c){ return Y.acoes[c]; }) : []; };
  Y.fazer = function(nome){
    const E = Y.estacoes(); const e = Y.estacao ? E[Y.estacao] : null;
    const ficar = e ? e.ficar : "idle";
    const deitada = Y.clipeAtual === "sofa_deitada" && nome !== "sofa_deitada" && Y.acoes.descer_pernas;
    const naCama = /^dormir_lado/.test(Y.clipeAtual) && !/^dormir_lado/.test(nome) && Y.acoes.levantar_lado;
    const levantar = Y.clipeAtual === "dormir_lado_esp" ? "levantar_lado_esp" : "levantar_lado", deitar = ficar === "dormir_lado_esp" ? "deitar_lado_esp" : "deitar_lado";
    const voltar = function(){
      if (ficar === "sofa_deitada" && nome !== "sofa_deitada" && Y.acoes.subir_pernas) Y.sequencia([{clipe: "subir_pernas", fade: 0.5}, {clipe: "sofa_deitada", fade: 0.6}]);
      else if (/^dormir_lado/.test(ficar) && !/^dormir_lado/.test(nome) && Y.acoes[deitar]) Y.sequencia([{clipe: deitar, fade: 0.5}, {clipe: ficar, fade: 0.8}]);
      else Y.tocar(ficar, 0.35, null, true); };
    const tocarAcao = function(){ if (LOOP[nome]) Y.tocar(nome, 0.35, null, true); else Y.tocar(nome, 0.3, voltar, true); };
    if (deitada) Y.sequencia([{clipe: "descer_pernas", fade: 0.5}], tocarAcao); else if (naCama) Y.sequencia([{clipe: levantar, fade: 0.5}], tocarAcao); else tocarAcao();
  };

  /* IK DE 2 OSSOS (braco): leva a mao (punho) ate `alvo` dobrando o cotovelo no
     plano em que ele ja esta e girando o braco no ombro; a mao mantem a
     orientacao que o clipe deu. `peso` 0..1 mistura com a pose do clipe. */
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _qm = new THREE.Quaternion();
  function girarNoMundo(no, R){
    no.parent.getWorldQuaternion(_qa); _qb.copy(_qa).invert();
    _qm.copy(_qb).multiply(R).multiply(_qa); no.quaternion.premultiply(_qm);
  }
  function ik2(A, B, C, alvo, peso, frente){
    if (peso <= 0) return false;
    A.getWorldPosition(_pa); B.getWorldPosition(_pb); C.getWorldPosition(_pc);
    const l1 = _pa.distanceTo(_pb), l2 = _pb.distanceTo(_pc);
    /* GUARDA: alvo atras do ombro ou fora do alcance vira rotacao de 150 graus por
       quadro (a mao "gira loucamente"). Nesses casos o braco fica com o clipe. */
    const rel = alvo.clone().sub(_pa);
    if (frente && rel.x * frente.x + rel.z * frente.z < 0.05) return false;
    if (rel.length() > (l1 + l2) * 0.97) return false;
    const qMao = new THREE.Quaternion(); C.getWorldQuaternion(qMao);
    const T = _pc.clone().lerp(alvo, peso);
    let d = _pa.distanceTo(T); d = Math.max(Math.abs(l1 - l2) + 0.002, Math.min(d, (l1 + l2) * 0.995));
    _u.subVectors(_pa, _pb).normalize(); _w.subVectors(_pc, _pb).normalize();
    const angAtual = Math.acos(Math.max(-1, Math.min(1, _u.dot(_w))));
    const angNovo = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
    _n.crossVectors(_u, _w); if (_n.lengthSq() < 1e-8){ _n.set(0, 1, 0).cross(_u); } _n.normalize();
    girarNoMundo(B, new THREE.Quaternion().setFromAxisAngle(_n, angNovo - angAtual)); A.updateMatrixWorld(true);
    C.getWorldPosition(_pc);
    _u.subVectors(_pc, _pa).normalize(); _w.subVectors(T, _pa).normalize();
    const R2 = new THREE.Quaternion().setFromUnitVectors(_u, _w), MAXG = 1.3;        // no maximo ~75 graus de giro no ombro
    const ang2 = 2 * Math.acos(Math.max(-1, Math.min(1, Math.abs(R2.w))));
    if (ang2 > MAXG) R2.slerp(new THREE.Quaternion(), 1 - MAXG / ang2);
    girarNoMundo(A, R2); A.updateMatrixWorld(true);
    /* mao: de volta a orientacao do clipe */
    C.parent.getWorldQuaternion(_qa); C.quaternion.copy(_qa.invert().multiply(qMao)); C.updateMatrixWorld(true);
    return true;
  }
  /* media da posicao das maos (relativa aos quadris, eixos dela) ao longo de um
     clipe: o IK poe a media no teclado e mantem o vai-e-vem do clipe por cima */
  function medirMaos(nome){
    const a = Y.acoes[nome]; if (!a) return null;
    const giroAntes = Y.obj.rotation.y, posAntes = Y.obj.position.clone(), atual = Y.atual;
    Y.obj.rotation.y = 0; Y.obj.position.set(0, 0, 0); if (atual) atual.enabled = false;
    a.enabled = true; a.setEffectiveWeight(1); a.play();
    const q = new THREE.Vector3(), v = new THREE.Vector3(), mE = new THREE.Vector3(), mD = new THREE.Vector3(); const n = 16;
    for (let i = 0; i < n; i++){
      a.time = a.getClip().duration * (0.2 + 0.7 * i / n); Y.mixer.update(0); Y.obj.updateMatrixWorld(true);
      osso("hips").getWorldPosition(q); osso("leftHand").getWorldPosition(v); mE.add(v.sub(q)); osso("rightHand").getWorldPosition(v); mD.add(v.sub(q));
    }
    mE.divideScalar(n); mD.divideScalar(n);
    a.stop(); if (atual) atual.enabled = true; Y.obj.rotation.y = giroAntes; Y.obj.position.copy(posAntes);
    return {E: mE, D: mD};
  }
  /* MAOS NO TECLADO: quando esta digitando na mesa (sem lerp/pivot em curso), o
     IK leva cada punho ao alvo do teclado + (posicao atual - media do clipe), ou
     seja, o teclado vira o centro do vai-e-vem de digitar. Peso sobe em 0,6 s. */
  const _vq = new THREE.Vector3(), _vm = new THREE.Vector3(), _alvo = new THREE.Vector3();
  /* MEMORIA DO IK: o AnimationMixer so reescreve um osso quando o valor do clipe
     MUDA de um quadro pro outro (PropertyMixer.apply compara com o ultimo valor
     escrito). O punho no clipe de digitar e quase fixo, entao o mixer nao repunha
     a mao e o giro do IK ACUMULAVA 13 graus por quadro (Michel: "as maos girando
     loucamente"). Aqui: antes do IK, se o osso ainda esta com o valor que o IK
     deixou (o mixer nao mexeu), volta pro valor do clipe guardado; guarda o valor
     do clipe e, depois do IK, o valor que o IK deixou. */
  const IK_MEM = {};
  function ikRepor(no){
    const m = IK_MEM[no.name]; if (!m) return;
    if (no.quaternion.equals(m.pos)) no.quaternion.copy(m.pre);
  }
  function ikGuardarPre(no){ const m = IK_MEM[no.name] || (IK_MEM[no.name] = {pre: new THREE.Quaternion(), pos: new THREE.Quaternion()}); m.pre.copy(no.quaternion); }
  function ikGuardarPos(no){ const m = IK_MEM[no.name]; if (m) m.pos.copy(no.quaternion); }
  /* APOIO DA CABECA no travesseiro: quando deitada na cama (dormir_lado*), curva
     spine, chest, upperChest e neck em torno do eixo lateral do corpo pra cabeca
     subir `Y.apoio.subir` metros. Mesma memoria do IK (o mixer nao reescreve osso
     cujo valor nao muda). */
  const APOIO_MEM = {};
  const _bd = new THREE.Vector3(), _eixo = new THREE.Vector3(), _ph = new THREE.Vector3(), _pq = new THREE.Vector3();
  function apoiarCabeca(dt){
    const quer = Y.apoio && Y.estacao === "cama" && /^dormir_lado/.test(Y.clipeAtual) && !Y.lerp;
    const ossos = ["spine", "chest", "upperChest", "neck"].map(osso).filter(Boolean);
    if (quer && !Y.apoio.medido && Y.mapaCama && Y.colchao){
      /* MEDIDA REAL, no primeiro quadro deitada e sem curva: onde a cabeca esta e
         quanto falta pra rampa do travesseiro (superficie >= colchao + 7 cm) na
         direcao da cabeceira; ela escorrega esse tanto em 1 s e a coluna curva o
         que faltar pra cabeca afundar so 4 cm */
      ossos.forEach(function(o){ const m = APOIO_MEM[o.name]; if (m && o.quaternion.equals(m.pos)) o.quaternion.copy(m.pre); });
      Y.obj.updateMatrixWorld(true); osso("head").getWorldPosition(_ph);
      const cab = Y.colchao.cabeceira, sup = Y.colchao.sup, mapa = Y.mapaCama;
      let d = 0; for (let k = 0; k <= 0.30; k += 0.02){ if (mapa.em(_ph.x + cab.x * k, _ph.z + cab.z * k) >= sup + 0.07){ d = k; break; } }
      const sob = mapa.em(_ph.x + cab.x * d, _ph.z + cab.z * d);
      Y.apoio.subir = Math.max(0, Math.min(0.22, (sob - 0.04 + 0.10) - _ph.y));
      Y.apoio.escorregar = {x: cab.x * d, z: cab.z * d, feito: 0};
      Y.apoio.medido = true;
      anota("cabeca no travesseiro: escorrega " + (d * 100).toFixed(0) + " cm, sobe " + (Y.apoio.subir * 100).toFixed(0) + " cm (travesseiro a " + ((sob - sup) * 100).toFixed(0) + " cm do colchao)");
    }
    if (Y.apoio && Y.apoio.escorregar && Y.apoio.escorregar.feito < 1 && quer){
      const e = Y.apoio.escorregar, k0 = e.feito; e.feito = Math.min(1, e.feito + dt); const dk = e.feito - k0;
      Y.x += e.x * dk; Y.z += e.z * dk; Y.quadris.x += e.x * dk; Y.quadris.z += e.z * dk;
    }
    if (Y.apoio) Y.apoio.peso = Math.max(0, Math.min(1, (Y.apoio.peso || 0) + (quer && Y.apoio.medido ? dt / 0.8 : -dt / 0.4)));
    ossos.forEach(function(o){ const m = APOIO_MEM[o.name]; if (m && o.quaternion.equals(m.pos)) o.quaternion.copy(m.pre); });
    if (!Y.apoio || Y.apoio.peso <= 0){ for (const k in APOIO_MEM) delete APOIO_MEM[k]; return; }
    ossos.forEach(function(o){ const m = APOIO_MEM[o.name] || (APOIO_MEM[o.name] = {pre: new THREE.Quaternion(), pos: new THREE.Quaternion()}); m.pre.copy(o.quaternion); });
    Y.obj.updateMatrixWorld(true);
    osso("hips").getWorldPosition(_pq); osso("head").getWorldPosition(_ph);
    _bd.subVectors(_ph, _pq); _bd.y = 0; if (_bd.lengthSq() < 1e-6) return; _bd.normalize();
    _eixo.copy(_bd).cross(new THREE.Vector3(0, 1, 0)).normalize();                     // (corpo x cima): girar em torno dele levanta a cabeca
    const braco = Math.max(0.25, _ph.distanceTo(_pq));                              // quadris -> cabeca
    const total = Math.asin(Math.max(-1, Math.min(1, Y.apoio.subir / braco))) * Y.apoio.peso;
    const parte = total / ossos.length;
    ossos.forEach(function(o){ girarNoMundo(o, new THREE.Quaternion().setFromAxisAngle(_eixo, parte)); o.updateMatrixWorld(true); });
    ossos.forEach(function(o){ APOIO_MEM[o.name].pos.copy(o.quaternion); });
  }
  function maosNoTeclado(dt){
    const quer = Y.digitar && Y.estacao === "mesa" && Y.clipeAtual === "typing" && !Y.lerp && !Y.pivot && Y.maosMedia;
    Y.pesoMaos = Math.max(0, Math.min(1, (Y.pesoMaos || 0) + (quer ? dt / 0.6 : -dt / 0.3)));
    const ossos = []; ["left", "right"].forEach(function(l){ ["UpperArm", "LowerArm", "Hand"].forEach(function(n){ const o = osso(l + n); if (o) ossos.push(o); }); });
    ossos.forEach(ikRepor);                                   // volta ao clipe onde o mixer nao reescreveu
    if (Y.pesoMaos <= 0 || !Y.digitar || !Y.maosMedia){ for (const k in IK_MEM) delete IK_MEM[k]; return; }
    ossos.forEach(ikGuardarPre);
    Y.obj.updateMatrixWorld(true); osso("hips").getWorldPosition(_vq);
    const cg = Math.cos(Y.giro), sg = Math.sin(Y.giro);
    [["left", Y.maosMedia.E, Y.digitar.alvoE], ["right", Y.maosMedia.D, Y.digitar.alvoD]].forEach(function(lado){
      const A = osso(lado[0] + "UpperArm"), B = osso(lado[0] + "LowerArm"), C = osso(lado[0] + "Hand"); if (!A || !B || !C) return;
      const m = lado[1]; _vm.set(_vq.x + (m.x * cg + m.z * sg), _vq.y + m.y, _vq.z + (-m.x * sg + m.z * cg));   // onde a media do clipe esta agora
      C.getWorldPosition(_pc); _pc.sub(_vm); _pc.x = Math.max(-0.03, Math.min(0.03, _pc.x)); _pc.y = Math.max(-0.03, Math.min(0.03, _pc.y)); _pc.z = Math.max(-0.03, Math.min(0.03, _pc.z));
      _alvo.copy(lado[2]).add(_pc);                                                                                                        // alvo + desvio atual do clipe (ate 3 cm)
      ik2(A, B, C, _alvo, Y.pesoMaos, {x: sg, z: cg});   // frente dela = (sin giro, cos giro)
    });
    ossos.forEach(ikGuardarPos);
  }
  /* moveis que se mexem com ela: a cadeira do PC gira em torno do assento */
  const MOVEIS = [];
  function centroDoMovel(mv){ return (mv.centro === "posto" && mv.posto && mv.posto.obj) ? {x: mv.posto.obj.position.x, z: mv.posto.obj.position.z} : mv.centro; }
  function girarMovel(posto, giroAlvo, dur, centro, desloc, paraPos, atraso){
    if (!posto || !posto.obj) return;
    if (centro === "posto") centro = {x: posto.obj.position.x, z: posto.obj.position.z};
    if (paraPos && centro){
      /* onde a origem termina so com a rotacao em torno do centro; o resto e deslocamento */
      const d = anguloDif(giroAlvo, posto.obj.rotation.y), cd = Math.cos(d), sd = Math.sin(d), rx = posto.obj.position.x - centro.x, rz = posto.obj.position.z - centro.z;
      const fx = centro.x + cd * rx + sd * rz, fz = centro.z - sd * rx + cd * rz;
      desloc = {x: paraPos.x - fx, z: paraPos.z - fz};
    }
    /* um movimento novo no mesmo movel cancela o anterior (senao os dois brigam
       pela posicao a cada quadro e a cadeira termina fora do lugar) */
    for (let i = MOVEIS.length - 1; i >= 0; i--) if (MOVEIS[i].posto.obj === posto.obj) MOVEIS.splice(i, 1);
    MOVEIS.push({posto: posto, de: posto.obj.rotation.y, para: giroAlvo, t: -(atraso || 0), dur: dur || 0.8, centro: centro || null, desloc: desloc || null, pos0: {x: posto.obj.position.x, z: posto.obj.position.z}});
  }
  function animarMoveis(dt){
    for (let i = MOVEIS.length - 1; i >= 0; i--){
      const m = MOVEIS[i]; m.t += dt; const k = Math.min(1, Math.max(0, m.t / m.dur)), s = k * k * (3 - 2 * k);
      const ang = m.de + anguloDif(m.para, m.de) * s;
      m.posto.obj.rotation.y = ang;
      if (m.centro){
        const d = ang - m.de, c = Math.cos(d), sn = Math.sin(d), rx = m.pos0.x - m.centro.x, rz = m.pos0.z - m.centro.z;
        m.posto.obj.position.x = m.centro.x + c * rx + sn * rz;
        m.posto.obj.position.z = m.centro.z - sn * rx + c * rz;
      }
      if (m.desloc){ m.posto.obj.position.x += m.desloc.x * s; m.posto.obj.position.z += m.desloc.z * s; }   // puxada/empurrada junto
      if (k >= 1) MOVEIS.splice(i, 1);
    }
  }

  /* --------------------------------------------------------------- grade */
  function celulaMapa(lx, lz){
    const ix = Math.floor((lx - MAPA.x0) / MAPA.cel), iz = Math.floor((lz - MAPA.z0) / MAPA.cel);
    if (ix < 0 || iz < 0 || ix >= MAPA.nx || iz >= MAPA.nz) return ".";
    return MAPA.linhas[iz].charAt(ix);
  }
  Y.montarGrade = function(){
    if (!MAPA || !malha) return null;
    /* cache: a grade so muda quando um movel muda de lugar (custava 1 s por chamada e estacoes() chama sempre) */
    const chave = (postos || []).map(function(p){ return p.obj ? p.obj.position.x.toFixed(3) + "," + p.obj.position.z.toFixed(3) + "," + p.obj.rotation.y.toFixed(3) + "," + p.obj.scale.x.toFixed(3) : ""; }).join("|");
    if (Y.grade && Y.grade.chave === chave) return Y.grade;
    malha.updateMatrixWorld(true);
    const a = malha.localToWorld(new THREE.Vector3(MAPA.x0, MAPA.pisoY, MAPA.z0));
    const b = malha.localToWorld(new THREE.Vector3(MAPA.x0 + MAPA.nx*MAPA.cel, MAPA.pisoY, MAPA.z0 + MAPA.nz*MAPA.cel));
    const x0 = Math.min(a.x, b.x), z0 = Math.min(a.z, b.z), x1 = Math.max(a.x, b.x), z1 = Math.max(a.z, b.z);
    const nx = Math.ceil((x1 - x0) / CEL), nz = Math.ceil((z1 - z0) / CEL);
    const piso = new Uint8Array(nx * nz), livre = new Uint8Array(nx * nz);
    const v = new THREE.Vector3();
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++){
      let ok = 1;
      for (let sz = 0; sz < 3 && ok; sz++) for (let sx = 0; sx < 3 && ok; sx++){
        v.set(x0 + (ix + (sx + 0.5) / 3) * CEL, PISO_Y, z0 + (iz + (sz + 0.5) / 3) * CEL);
        malha.worldToLocal(v);
        if (celulaMapa(v.x, v.z) !== "P") ok = 0;
      }
      piso[iz*nx + ix] = ok;
    }
    const bloq = new Uint8Array(nx * nz);
    (postos || []).forEach(function(p){
      if (!p.obj || (p.pasta !== "moveis" && p.pasta !== "lain")) return;
      const bx = new THREE.Box3().setFromObject(p.obj);
      if (bx.max.y - bx.min.y < 0.06) return;
      if (bx.min.y > PISO_Y + 1.3) return;
      const i0 = Math.max(0, Math.floor((bx.min.x - x0) / CEL)), i1 = Math.min(nx - 1, Math.floor((bx.max.x - x0) / CEL));
      const k0 = Math.max(0, Math.floor((bx.min.z - z0) / CEL)), k1 = Math.min(nz - 1, Math.floor((bx.max.z - z0) / CEL));
      /* pecas grandes da estacao (cama, sofa, mesa...): PEGADA REAL pelo mapa de
         altura, nao a caixa -- a caixa de um sofa girado cobre o chao na frente
         dele, o ponto de sentar era empurrado pra fora e ela sentava no ar
         (Michel: "deitada fora da cama e do sofa"). Os outros (pilhas, pikachu,
         halteres) seguem pela caixa. */
      const mapa = p.pasta === "lain" ? mapaAltura(p) : null;
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++){
        if (mapa){
          const cx = x0 + (i + 0.5) * CEL, cz = z0 + (k + 0.5) * CEL;
          if (mapa.em(cx, cz) < PISO_Y + 0.06 && mapa.em(cx - CEL * 0.4, cz) < PISO_Y + 0.06 && mapa.em(cx + CEL * 0.4, cz) < PISO_Y + 0.06 && mapa.em(cx, cz - CEL * 0.4) < PISO_Y + 0.06 && mapa.em(cx, cz + CEL * 0.4) < PISO_Y + 0.06) continue;
        }
        bloq[k*nx + i] = 1;
      }
    });
    const r = Math.ceil(Y.raio / CEL);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++){
      let ok = 1;
      for (let dz = -r; dz <= r && ok; dz++) for (let dx = -r; dx <= r && ok; dx++){
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz){ ok = 0; break; }
        const k = jz*nx + jx; if (!piso[k] || bloq[k]) ok = 0;
      }
      livre[iz*nx + ix] = ok;
    }
    Y.grade = {x0: x0, z0: z0, nx: nx, nz: nz, livre: livre, piso: piso, bloq: bloq, chave: chave};
    return Y.grade;
  };
  Y.pontoAlcancavel = function(x, z, g){
    g = g || Y.grade || Y.montarGrade(); if (!g) return {x: x, z: z};
    const ok = function(ix, iz){ return ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz && g.piso[iz*g.nx + ix] === 1 && g.bloq[iz*g.nx + ix] === 0; };
    const c = celulaDe(g, x, z);
    if (ok(c.ix, c.iz)) return {x: x, z: z};
    for (let r = 1; r <= 20; r++){
      let melhor = null, md = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!ok(c.ix + dx, c.iz + dz)) continue;
        const p = centroDe(g, c.ix + dx, c.iz + dz), d = Math.hypot(p.x - x, p.z - z);
        if (d < md){ md = d; melhor = p; }
      }
      if (melhor) return melhor;
    }
    return {x: x, z: z};
  };
  function celulaDe(g, x, z){ return {ix: Math.floor((x - g.x0) / CEL), iz: Math.floor((z - g.z0) / CEL)}; }
  function centroDe(g, ix, iz){ return {x: g.x0 + (ix + 0.5) * CEL, z: g.z0 + (iz + 0.5) * CEL}; }
  function livreEm(g, ix, iz){ return ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz && g.livre[iz*g.nx + ix] === 1; }
  Y.pontoLivre = function(x, z, g){
    g = g || Y.grade || Y.montarGrade(); if (!g) return {x: x, z: z};
    const c = celulaDe(g, x, z);
    if (livreEm(g, c.ix, c.iz)) return {x: x, z: z};
    for (let r = 1; r <= 20; r++){
      let melhor = null, md = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!livreEm(g, c.ix + dx, c.iz + dz)) continue;
        const p = centroDe(g, c.ix + dx, c.iz + dz), d = Math.hypot(p.x - x, p.z - z);
        if (d < md){ md = d; melhor = p; }
      }
      if (melhor) return melhor;
    }
    return {x: x, z: z};
  };
  function linhaLivre(g, a, b){
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / (CEL * 0.5)));
    for (let i = 0; i <= n; i++){
      const t = i / n, c = celulaDe(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (!livreEm(g, c.ix, c.iz)) return false;
    }
    return true;
  }
  function astar(g, s, t){
    const N = g.nx * g.nz, INF = 1e30;
    const gs = new Float32Array(N).fill(INF), veio = new Int32Array(N).fill(-1), fechado = new Uint8Array(N);
    const heap = [], pos = new Int32Array(N).fill(-1), fk = new Float32Array(N);
    const troca = function(i, j){ const a = heap[i]; heap[i] = heap[j]; heap[j] = a; pos[heap[i]] = i; pos[heap[j]] = j; };
    const sobe = function(i){ while (i > 0){ const p = (i - 1) >> 1; if (fk[heap[p]] <= fk[heap[i]]) break; troca(i, p); i = p; } };
    const desce = function(i){ for (;;){ let m = i; const l = 2*i + 1, r = l + 1; if (l < heap.length && fk[heap[l]] < fk[heap[m]]) m = l; if (r < heap.length && fk[heap[r]] < fk[heap[m]]) m = r; if (m === i) break; troca(i, m); i = m; } };
    const empurra = function(k){ if (pos[k] >= 0){ sobe(pos[k]); return; } heap.push(k); pos[k] = heap.length - 1; sobe(pos[k]); };
    const tira = function(){ const k = heap[0]; const u = heap.pop(); pos[k] = -1; if (heap.length){ heap[0] = u; pos[u] = 0; desce(0); } return k; };
    const h = function(k){ const dx = Math.abs((k % g.nx) - t.ix), dz = Math.abs(Math.floor(k / g.nx) - t.iz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    const ks = s.iz*g.nx + s.ix, kt = t.iz*g.nx + t.ix;
    gs[ks] = 0; fk[ks] = h(ks); empurra(ks);
    while (heap.length){
      const k = tira(); if (k === kt) break; fechado[k] = 1;
      const ix = k % g.nx, iz = Math.floor(k / g.nx);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++){
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (!livreEm(g, jx, jz)) continue;
        if (dx && dz && (!livreEm(g, ix + dx, iz) || !livreEm(g, ix, iz + dz))) continue;
        const j = jz*g.nx + jx; if (fechado[j]) continue;
        const ng = gs[k] + ((dx && dz) ? 1.4142 : 1);
        if (ng < gs[j]){ gs[j] = ng; veio[j] = k; fk[j] = ng + h(j); empurra(j); }
      }
    }
    if (gs[kt] >= INF) return null;
    const cam = []; for (let k = kt; k >= 0; k = veio[k]) cam.push(k);
    cam.reverse();
    return cam.map(function(k){ return centroDe(g, k % g.nx, Math.floor(k / g.nx)); });
  }
  Y.caminhoAte = function(alvo){
    const g = Y.montarGrade(); if (!g) return [alvo];
    const de = Y.pontoLivre(Y.x, Y.z, g), para = Y.pontoLivre(alvo.x, alvo.z, g);
    const bruto = astar(g, celulaDe(g, de.x, de.z), celulaDe(g, para.x, para.z));
    if (!bruto){ anota("sem caminho ate (" + alvo.x.toFixed(2) + ", " + alvo.z.toFixed(2) + ")"); return null; }
    const pts = [{x: Y.x, z: Y.z}].concat(bruto); pts.push({x: alvo.x, z: alvo.z});
    const liso = []; let i = 0;
    while (i < pts.length - 1){
      let j = pts.length - 1;
      while (j > i + 1 && !linhaLivre(g, pts[i], pts[j])) j--;
      liso.push(pts[j]); i = j;
    }
    return liso;
  };
  Y.andarAte = function(alvo, fim){
    const o = origemPara(Y.quadris, Y.giro, ANDAR(), "ini"); Y.x = o.x; Y.z = o.z; Y.y = PISO_Y;
    const cam = Y.caminhoAte(alvo);
    if (!cam){
      anota("TELEPORTE pra (" + alvo.x.toFixed(2) + ", " + alvo.z.toFixed(2) + ")");
      Y.x = alvo.x; Y.z = alvo.z; Y.quadris = quadrisDe({x: Y.x, z: Y.z}, Y.giro, "idle", "fim"); if (fim) fim(); return;
    }
    Y.caminho = cam; Y.passo = 0; Y.estado = "andando"; Y.aoChegar = fim || null; Y.lerp = null; Y.pivot = null; Y.superficie = null;
    Y.tocar(ANDAR(), 0.3, null, true);
  };
  Y.virarPara = function(giro, fim){
    Y.giroAlvo = giro;
    if (Math.abs(anguloDif(giro, Y.giro)) < 0.02){ Y.giro = giro; Y.giroAlvo = null; if (fim) fim(); return; }
    Y.estado = "virando"; Y.aoVirar = fim || null;
  };

  /* ------------------------------------------------------------ estacoes */
  function posto(prefixo){ return (postos || []).find(function(p){ return p.arquivo.indexOf(prefixo) === 0 && p.obj; }); }
  /* peca da estacao por nome de arquivo (teclado, mouse...): as pecas em cima da
     mesa nao sao postos; a raiz de cada peca guarda userData.peca */
  function pecaPorArquivo(nome, perto){
    let achou = null, md = 1e9;
    if (cena) cena.traverse(function(o){
      if (!(o.userData && o.userData.peca && o.userData.peca.arquivo === nome)) return;
      const d = perto ? Math.hypot(o.position.x - perto.x, o.position.z - perto.z) : 0;
      if (d < md){ md = d; achou = o; }
    });
    return achou;
  }
  function caixa(p){ return new THREE.Box3().setFromObject(p.obj); }
  function centro(b){ return {x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2}; }
  function norma(dx, dz){ const d = Math.hypot(dx, dz) || 1; return {x: dx / d, z: dz / d}; }
  function giroDe(dir){ return Math.atan2(dir.x, dir.z); }
  const raio = new THREE.Raycaster();
  /* MAPA DE ALTURA de um movel: o maior y dos vertices em cada celula de 4 cm,
     no mundo (uma passada pelos vertices; o raio no sofa de 360 mil triangulos
     custa 80 ms cada). Diz onde e almofada, travesseiro, manta e braco do sofa.
     Celula sem vertice (triangulo grande) copia a vizinha mais perto. */
  function mapaAltura(p, extras){
    extras = extras || [];
    const chave = p.obj.matrixWorld.elements.join(",") + extras.map(function(e){ return "|" + e.obj.matrixWorld.elements.join(","); }).join("");
    if (p.obj.userData._mapa && p.obj.userData._mapa.chave === chave) return p.obj.userData._mapa;
    const cel = 0.04, b = caixa(p), x0 = b.min.x, z0 = b.min.z;
    const nx = Math.ceil((b.max.x - x0) / cel) + 1, nz = Math.ceil((b.max.z - z0) / cel) + 1;
    const h = new Float32Array(nx * nz).fill(-1e9);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const poe = function(x, y, z){ const ix = Math.floor((x - x0) / cel), iz = Math.floor((z - z0) / cel); if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return; const k = iz * nx + ix; if (y > h[k]) h[k] = y; };
    [p].concat(extras).forEach(function(pp){ pp.obj.traverse(function(o){
      if (!o.isMesh || o.userData.tela || o.name === "luz-tela") return;
      const pos = o.geometry.attributes.position; if (!pos) return;
      const idx = o.geometry.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3){
        A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
        C.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
        poe(A.x, A.y, A.z); poe(B.x, B.y, B.z); poe(C.x, C.y, C.z);
        /* triangulo maior que uma celula: interpola o y nos centros de celula que ele cobre */
        const ix0 = Math.floor((Math.min(A.x, B.x, C.x) - x0) / cel), ix1 = Math.floor((Math.max(A.x, B.x, C.x) - x0) / cel);
        const iz0 = Math.floor((Math.min(A.z, B.z, C.z) - z0) / cel), iz1 = Math.floor((Math.max(A.z, B.z, C.z) - z0) / cel);
        if (ix1 - ix0 < 2 && iz1 - iz0 < 2) continue;
        const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z); if (Math.abs(d) < 1e-9) continue;
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++){
          const px = x0 + (ix + 0.5) * cel, pz = z0 + (iz + 0.5) * cel;
          const l1 = ((B.z - C.z) * (px - C.x) + (C.x - B.x) * (pz - C.z)) / d, l2 = ((C.z - A.z) * (px - C.x) + (A.x - C.x) * (pz - C.z)) / d, l3 = 1 - l1 - l2;
          if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
          if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
          const y = l1 * A.y + l2 * B.y + l3 * C.y, k = iz * nx + ix; if (y > h[k]) h[k] = y;
        }
      }
    }); });
    const h2 = new Float32Array(h);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++){
      const k = iz * nx + ix; if (h[k] > -1e8) continue;
      let melhor = -1e9, md = 1e9;
      for (let r = 1; r <= 2 && melhor < -1e8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){
        const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx; if (h[j] < -1e8) continue;
        const d = dx * dx + dz * dz; if (d < md){ md = d; melhor = h[j]; }
      }
      h2[k] = melhor > -1e8 ? melhor : PISO_Y;
    }
    p.obj.userData._mapa = {chave: chave, x0: x0, z0: z0, cel: cel, nx: nx, nz: nz, h: h2, em: function(x, z){
      const ix = Math.floor((x - x0) / cel), iz = Math.floor((z - z0) / cel);
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return PISO_Y;
      return h2[iz * nx + ix];
    }};
    return p.obj.userData._mapa;
  }
  /* POSE de um clipe num instante (fracao 0..1), nos eixos dela (giro 0, escala
     dela): posicao de cada osso relativa aos quadris, com a "margem" = quanto o
     corpo desce abaixo do centro do osso (costas, nuca, calcanhar). */
  const MARGEM_OSSO = {hips: 0.09, spine: 0.10, chest: 0.11, upperChest: 0.11, neck: 0.06, head: 0.10,
    leftShoulder: 0.06, rightShoulder: 0.06, leftUpperArm: 0.05, rightUpperArm: 0.05, leftLowerArm: 0.04, rightLowerArm: 0.04, leftHand: 0.03, rightHand: 0.03,
    leftUpperLeg: 0.07, rightUpperLeg: 0.07, leftLowerLeg: 0.06, rightLowerLeg: 0.06, leftFoot: 0.04, rightFoot: 0.04, leftToes: 0.02, rightToes: 0.02};
  function poseDe(nome, frac){
    const a = Y.acoes[nome]; if (!a) return null;
    const giroAntes = Y.obj.rotation.y, posAntes = Y.obj.position.clone(), atual = Y.atual;
    Y.obj.rotation.y = 0; Y.obj.position.set(0, 0, 0);
    if (atual) atual.enabled = false;
    a.enabled = true; a.setEffectiveWeight(1); a.play(); a.time = a.getClip().duration * frac; Y.mixer.update(0); Y.obj.updateMatrixWorld(true);
    const q = new THREE.Vector3(), v = new THREE.Vector3(); osso("hips").getWorldPosition(q);
    const pose = [];
    Object.keys(MARGEM_OSSO).forEach(function(n){ const o = osso(n); if (!o) return; o.getWorldPosition(v); pose.push({osso: n, dx: v.x - q.x, dy: v.y - q.y, dz: v.z - q.z, margem: MARGEM_OSSO[n]}); });
    a.stop(); if (atual) atual.enabled = true;
    Y.obj.rotation.y = giroAntes; Y.obj.position.copy(posAntes);
    return pose;
  }
  /* ENCAIXE DA DEITADA NO SOFA: o sofa dele tem travesseiros encostados, uma
     manta e uma almofada solta em cima do assento; deitada no meio ela furava
     tudo (quadris 10 cm dentro do travesseiro, pe 33 cm dentro da almofada).
     Aqui a pose final do clipe deitado e testada em cada ponto da almofada
     (passo 4 cm, ao longo e na profundidade): pra cada ponto, a altura em que os
     quadris tem que ficar pra NENHUM osso entrar no que esta embaixo dele; vence
     o ponto em que ela fica mais baixa (= mais encostada no sofa), com um
     desempate pelo centro. O ponto de sentar sai dai: quadris deitada menos o
     que os quadris andam no clipe de subir as pernas. Ela passa a deitar na
     frente dos travesseiros, cabeca pro lado do braco do sofa. */
  function encaixarDeitada(sofa, c, dir, giro, sup, op){
    op = op || {}; const deitar = op.deitar || "subir_pernas", dormir = op.dormir || "sofa_deitada";
    const extras = op.extras || [];
    const chave = sofa.obj.matrixWorld.elements.join(",") + "|" + giro.toFixed(3) + "|" + sup.toFixed(3) + "|" + dormir + extras.map(function(e){ return "|" + e.obj.matrixWorld.elements.join(","); }).join("");
    const cache = sofa.obj.userData._deitada || {};
    if (cache[chave]) return cache[chave];
    const pose = poseDe(dormir, 0.5); if (!pose) return null;
    const cabeca = pose.find(function(b){ return b.osso === "head"; });
    const mapa = mapaAltura(sofa, extras), lat = {x: -dir.z, z: dir.x};
    const cg = Math.cos(giro), sg = Math.sin(giro);
    const oi = off(deitar, "ini"), of = off(deitar, "fim");
    const dq = paraMundo({x: of.x - oi.x, z: of.z - oi.z}, giro);           // quadris: sentada -> deitada
    const faixaS = op.s || [-0.4, 0.55], faixaT = op.t || [-1.5, 1.5];
    /* avalia os quadris deitada em (hx, hz): altura necessaria e quantos ossos do
       corpo (tronco, cabeca, bracos e coxas; mao e pe podem pender) ficam FORA
       do sofa (sem assento embaixo) -- Michel: "uma parte do corpo esta pra fora" */
    const avaliar = function(hx, hz){
      let y = -1e9, fora = 0;
      for (let i = 0; i < pose.length; i++){
        const b = pose[i];
        const wx = hx + (b.dx * cg + b.dz * sg), wz = hz + (-b.dx * sg + b.dz * cg);
        let sobB = mapa.em(wx, wz), margem = b.margem;
        if (sobB < sup - 0.15 && !/Hand|LowerArm|Foot|Toes/.test(b.osso)) fora++;
        /* travesseiro: a cabeca pode afundar ate 5 cm nele, nao mais (antes o
           travesseiro contava como se tivesse so 10 cm e ela afundava 20 -- Michel
           viu a cabeca sumindo); com isso o encaixe prefere a borda baixa do
           travesseiro, onde a cabeca apoia sem o corpo flutuar */
        if (op.cabeceira && /head|neck/.test(b.osso)) margem -= 0.12;   // o resto e compensado curvando a coluna (apoio da cabeca)
        const prec = sobB + margem - b.dy;
        if (prec > y) y = prec;
      }
      return {y: y, fora: fora};
    };
    /* "arredar pra dentro": depois de escolher, os quadris (e o ponto de sentar) vao
       mais uns cm em direcao ao encosto (cfg estacoes.sofa.dentro, em metros) */
    const dentro = op.dentro != null ? op.dentro : 0.08;
    let melhor = null;
    for (let s = faixaS[0]; s <= faixaS[1] + 1e-6; s += 0.04) for (let t = faixaT[0]; t <= faixaT[1] + 1e-6; t += 0.04){
      /* (hx, hz) = quadris ao fim do clipe de deitar, a partir da sentada; ela ainda
         escorrega `dentro` metros pra dentro (deriva no passo) -> a pose e avaliada
         em (fx, fz), a posicao FINAL (antes avaliava na beira e empurrava depois com
         a altura travada: no travesseiro mais alto a cabeca afundava 20 cm) */
      const hx = c.x + dir.x * s + lat.x * t, hz = c.z + dir.z * s + lat.z * t;
      const fx = hx - dir.x * dentro, fz = hz - dir.z * dentro;
      const sob = mapa.em(fx, fz); if (sob < sup - 0.06 || sob > sup + 0.12) continue;        // quadris deitada na almofada
      const sx = hx - dq.x, sz = hz - dq.z, sobS = mapa.em(sx, sz);
      if (sobS < sup - 0.06 || sobS > sup + 0.10) continue;                                  // e sentada tambem
      if (op.sentarS){ const sS = (sx - c.x) * dir.x + (sz - c.z) * dir.z; if (sS < op.sentarS[0] || sS > op.sentarS[1]) continue; }   // sentada perto da beira
      const av = avaliar(fx, fz);
      let custo = av.y + 0.03 * Math.abs(t) + 0.02 * Math.abs(s) + 0.08 * av.fora;
      if (op.cabeceira && cabeca){
        /* cama: a cabeca perto do travesseiro (ponto a 25 cm da cabeceira, no eixo)
           e virada pra ele; longe custa 12 cm de altura por metro */
        const hxC = fx + (cabeca.dx * cg + cabeca.dz * sg), hzC = fz + (-cabeca.dx * sg + cabeca.dz * cg);
        const alvo = {x: c.x + op.cabeceira.x * op.cabeceira.dist, z: c.z + op.cabeceira.z * op.cabeceira.dist};
        custo += 0.05 * Math.hypot(hxC - alvo.x, hzC - alvo.z);
        /* a cabeca tem que cair na RAMPA do travesseiro (5 a 13 cm acima do colchao):
           fora dele custa caro, em cima demais tambem (o apoio da coluna faz o resto) */
        const sobCab = mapa.em(hxC, hzC);
        custo += 0.6 * Math.max(0, (sup + 0.05) - sobCab) + 0.4 * Math.max(0, sobCab - (sup + 0.13));
        const vx = hxC - fx, vz = hzC - fz, vn = Math.hypot(vx, vz) || 1;
        custo += 0.10 * (1 - (vx * op.cabeceira.x + vz * op.cabeceira.z) / vn);     // corpo alinhado com a cama
      }
      if (!melhor || custo < melhor.custo){
        melhor = {custo: custo, x: fx, z: fz, y: av.y, fora: av.fora, sentar: {x: sx, z: sz}, s: s - dentro, t: t, sob: sob, dentro: dentro, deriva: {x: -dir.x * dentro, z: -dir.z * dentro}};
        if (cabeca) melhor.cabeca = {x: fx + (cabeca.dx * cg + cabeca.dz * sg), z: fz + (-cabeca.dx * sg + cabeca.dz * cg), dy: cabeca.dy, sob: mapa.em(fx + (cabeca.dx * cg + cabeca.dz * sg), fz + (-cabeca.dx * sg + cabeca.dz * cg))};
      }
    }
    if (melhor) melhor.y -= 0.03;                 // almofada afunda uns 3 cm com o peso dela
    if (melhor){ melhor.chave = chave; melhor.giro = giro; anota("deitada em " + sofa.arquivo + ": quadris a " + melhor.y.toFixed(2) + " m (almofada " + melhor.sob.toFixed(2) + "), ao longo " + melhor.t.toFixed(2) + " m, fundo " + melhor.s.toFixed(2) + " m, " + melhor.fora + " ossos fora, custo " + melhor.custo.toFixed(3)); }
    cache[chave] = melhor; sofa.obj.userData._deitada = cache;     // no obj: postos() cria objetos novos a cada chamada
    return melhor;
  }
  function superficieEm(p, x, z){ return mapaAltura(p).em(x, z); }
  /* MEDIR O COLCHAO pelo mapa de altura: a caixa da cama com o giro zerado nao
     serve (o modelo dele ja vem girado por dentro: a caixa saia 2,3 x 2,4 m pra
     uma cama de 2,1 x 1,5). Aqui: celulas do colchao = as que estao perto da
     altura tipica (mediana do que esta acima de 30 cm); eixo comprido por PCA
     dessas celulas; extensoes pela projecao (a beira do colchao de verdade, sem
     a borda da estrutura); cabeceira = ponta com a superficie mais alta
     (travesseiros). Devolve centro, eixos u (comprido) e w (largura), meias
     medidas, altura e direcao da cabeceira, tudo no mundo. */
  function medirColchao(p){
    const m = mapaAltura(p); const hs = [];
    for (let i = 0; i < m.h.length; i++) if (m.h[i] > PISO_Y + 0.3) hs.push(m.h[i]);
    if (hs.length < 20) return null;
    hs.sort(function(a, b){ return a - b; }); const sup = hs[Math.floor(hs.length * 0.5)];
    let n = 0, sx = 0, sz = 0; const pts = [];
    for (let iz = 0; iz < m.nz; iz++) for (let ix = 0; ix < m.nx; ix++){
      const h = m.h[iz * m.nx + ix]; if (h < sup - 0.08) continue;
      const x = m.x0 + (ix + 0.5) * m.cel, z = m.z0 + (iz + 0.5) * m.cel; pts.push([x, z, h]); sx += x; sz += z; n++;
    }
    const cx = sx / n, cz = sz / n; let sxx = 0, sxz = 0, szz = 0;
    pts.forEach(function(q){ const dx = q[0] - cx, dz = q[1] - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; });
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);            // eixo principal
    const u = {x: Math.cos(ang), z: Math.sin(ang)}, w = {x: -Math.sin(ang), z: Math.cos(ang)};
    let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
    pts.forEach(function(q){ const du = (q[0] - cx) * u.x + (q[1] - cz) * u.z, dw = (q[0] - cx) * w.x + (q[1] - cz) * w.z; if (du < u0) u0 = du; if (du > u1) u1 = du; if (dw < w0) w0 = dw; if (dw > w1) w1 = dw; });
    const c = {x: cx + u.x * (u0 + u1) / 2 + w.x * (w0 + w1) / 2, z: cz + u.z * (u0 + u1) / 2 + w.z * (w0 + w1) / 2};
    const meioComp = (u1 - u0) / 2, meiaLarg = (w1 - w0) / 2;
    /* cabeceira: media da altura no quarto final de cada ponta */
    let hA = 0, nA = 0, hB = 0, nB = 0;
    pts.forEach(function(q){ const du = (q[0] - c.x) * u.x + (q[1] - c.z) * u.z; if (du > meioComp * 0.5){ hA += q[2]; nA++; } else if (du < -meioComp * 0.5){ hB += q[2]; nB++; } });
    const cabeceira = (nA && nB && hA / nA >= hB / nB) || !nB ? {x: u.x, z: u.z} : {x: -u.x, z: -u.z};
    return {c: c, u: u, w: w, meioComp: meioComp, meiaLarg: meiaLarg, sup: sup, cabeceira: cabeceira};
  }   // era raio (80 ms cada no sofa); o mapa e a mesma superficie de cima
  function ladoLivre(b, dist, g){
    const c = centro(b), cand = [
      {dir: {x: 1, z: 0}, p: {x: b.max.x + dist, z: c.z}}, {dir: {x: -1, z: 0}, p: {x: b.min.x - dist, z: c.z}},
      {dir: {x: 0, z: 1}, p: {x: c.x, z: b.max.z + dist}}, {dir: {x: 0, z: -1}, p: {x: c.x, z: b.min.z - dist}}];
    let melhor = null, md = 1e9;
    cand.forEach(function(k){
      const cc = celulaDe(g, k.p.x, k.p.z); if (!livreEm(g, cc.ix, cc.iz)) return;
      const d = Math.hypot(k.p.x, k.p.z); if (d < md){ md = d; melhor = k; }
    });
    return melhor;
  }
  /* ASSENTO: patamar baixo (almofada) medido por raio ao longo de dir; quadris a 24 cm do encosto */
  function assentoDe(p, c, dir, alturaMin){
    /* varre o movel ao longo de dir (frente) pelo centro e acha a ALMOFADA: o
       trecho comprido (>= 10 cm) de altura quase constante mais baixo entre 20 cm
       e 1 m. (Antes pegava o ponto mais baixo e a borda arredondada da frente do
       sofa dele, a 21 cm, virava "assento" -- ela sentava no chao na frente.) */
    const amostras = [];
    for (let s = -0.7; s <= 0.7; s += 0.02){ const x = c.x + dir.x * s, z = c.z + dir.z * s; amostras.push({s: s, h: superficieEm(p, x, z) - PISO_Y}); }
    const minH = alturaMin || 0.2;
    const trechos = []; let atual = null;
    amostras.forEach(function(a){
      const ok = a.h > minH && a.h < 1.0;
      if (ok && atual && Math.abs(a.h - atual.h0) < 0.05){ atual.fim = a.s; atual.n++; atual.soma += a.h; }
      else if (ok){ if (atual) trechos.push(atual); atual = {ini: a.s, fim: a.s, h0: a.h, n: 1, soma: a.h}; }
      else { if (atual) trechos.push(atual); atual = null; }
    });
    if (atual) trechos.push(atual);
    /* trechos vizinhos com menos de 7 cm de diferenca sao a mesma almofada (a
       borda da frente desce um pouco e virava um "assento" separado, mais baixo,
       e o ponto de sentar caia fora da cadeira) */
    const juntos = [];
    trechos.forEach(function(t){
      const u = juntos[juntos.length - 1];
      if (u && t.ini - u.fim < 0.03 && Math.abs(t.soma / t.n - u.soma / u.n) < 0.07){ u.fim = t.fim; u.n += t.n; u.soma += t.soma; }
      else juntos.push({ini: t.ini, fim: t.fim, h0: t.h0, n: t.n, soma: t.soma});
    });
    const bons = juntos.filter(function(t){ return t.n >= 5; });
    if (!bons.length) return {ponto: c, altura: superficieEm(p, c.x, c.z)};
    bons.sort(function(a, b){ return (a.soma / a.n) - (b.soma / b.n); });          // o mais baixo = almofada (encosto e mais alto)
    const melhor = bons[0];
    const s = Math.min(melhor.fim - 0.06, melhor.ini + 0.24 + Math.min(0.04, (melhor.fim - melhor.ini) * 0.1));
    const ponto = {x: c.x + dir.x * s, z: c.z + dir.z * s};
    return {ponto: ponto, altura: superficieEm(p, ponto.x, ponto.z), profundidade: melhor.fim - melhor.ini, encostoS: melhor.ini};
  }
  function pontoDeSentar(q, giro, g){
    const a = off(SENTAR(), "ini"), b = off(SENTAR(), "fim");
    const w = paraMundo({x: b.x - a.x, z: b.z - a.z}, giro);
    /* ponto EXATO: fica na pegada da propria cadeira/sofa (as rodinhas, a borda) e
       era empurrado pra celula livre de lado -> ela sentava fora da cadeira e o
       giro levava ela pra cima da mesa (Michel viu). O caminho vai ate a celula
       livre mais perto e da o ultimo passo ate aqui (caminhoAte poe o alvo exato
       no fim). So garante que e piso. */
    const p = {x: q.x - w.x, z: q.z - w.z};
    g = g || Y.grade || Y.montarGrade(); if (!g) return p;
    const c = celulaDe(g, p.x, p.z);
    if (c.ix >= 0 && c.iz >= 0 && c.ix < g.nx && c.iz < g.nz && g.piso[c.iz*g.nx + c.ix] === 1) return p;
    return Y.pontoAlcancavel(p.x, p.z, g);
  }
  function somaAjuste(nome, e){
    const a = (Y.cfg.estacoes || {})[nome]; if (!a) return e;
    const dx = a.dx || 0, dz = a.dz || 0, dg = (a.giro || 0) * Math.PI / 180;
    e.aprox = {x: e.aprox.x + dx, z: e.aprox.z + dz}; e.giro += dg;
    const mexe = function(p){
      if (p.giro != null) p.giro += dg;
      if (p.superficie != null && a.dy) p.superficie += a.dy;
      if (p.pivot){ p.pivot.quadris = {x: p.pivot.quadris.x + dx, z: p.pivot.quadris.z + dz}; p.pivot.giro += dg; if (p.pivot.superficie != null && a.dy) p.pivot.superficie += a.dy; }
      const mv = p.pivot ? p.pivot.movel : p.movel;
      if (mv && mv.centro) mv.centro = {x: mv.centro.x + dx, z: mv.centro.z + dz};
    };
    (e.chegar || []).forEach(mexe); (e.sair || []).forEach(mexe);
    return e;
  }
  Y.estacoes = function(){
    const g = Y.montarGrade();
    const E = {};
    const cadeira = posto("27-cadeira"), mesa = posto("26-mesa"), sofa = posto("07-sofa"), tv = posto("10-tv"),
          balcao = posto("21-armarios-baixo"), cama = posto("22-cama"), tapete = posto("09-tapete"), capacho = posto("01-capacho");
    if (cadeira && mesa){
      /* A CASA DA CADEIRA: onde ele a deixou no editor, lembrada na primeira vez.
         A cadeira e puxada ate a mesa e devolvida; se uma sequencia for cortada no
         meio (o motor troca de estacao a qualquer hora), ela pode estar em qualquer
         lugar e GIRADA -- a medida do assento e da direcao da mesa e feita com a
         cadeira posta virtualmente em casa (posicao e giro), e os movimentos miram
         posicoes finais (paraPos), nao deslocamentos. */
      const ob = cadeira.obj;
      const casa = ob.userData.casa || (ob.userData.casa = {x: ob.position.x, z: ob.position.z, giro: ob.rotation.y});
      const salvo = {x: ob.position.x, z: ob.position.z, giro: ob.rotation.y};
      ob.position.x = casa.x; ob.position.z = casa.z; ob.rotation.y = casa.giro; ob.updateMatrixWorld(true);
      const c = centro(caixa(cadeira)), d = centro(caixa(mesa)), paraMesa = norma(d.x - c.x, d.z - c.z);
      const paraCorredor = {x: -paraMesa.x, z: -paraMesa.z};
      const as = assentoDe(cadeira, c, paraMesa);
      ob.position.x = salvo.x; ob.position.z = salvo.z; ob.rotation.y = salvo.giro; ob.updateMatrixWorld(true);
      const assento = as.ponto;                                                          // assento com a cadeira em casa, virada pra mesa
      /* A CADEIRA GIRA MEIA-VOLTA EM TORNO DO PROPRIO PE. Virada pro corredor (como ela
         senta e levanta), o assento e o espelho do assento em torno do pe -- e nao o
         mesmo ponto: com o ponto de "virada pra mesa" ela sentava atras do encosto e
         levantava atravessando ele (Michel viu). */
      const assentoFora = {x: 2 * casa.x - assento.x, z: 2 * casa.z - assento.z};
      /* meia-volta ambigua: um giro de exatamente pi pode sair pros dois lados
         (anguloDif escolhe o mais curto e o arredondamento decide); a cadeira ia
         pra um lado e ela pro outro (Michel viu). Giro de 0,999 pi, sinal fixo,
         igual pra ela e pra cadeira. */
      const giroSentarFora = giroDe(paraCorredor), MEIA = Math.PI * 0.999, giroMesa = giroSentarFora - MEIA;
      const aprox = pontoDeSentar(assentoFora, giroSentarFora, g);
      const sup = as.altura;
      const giroCadeira = casa.giro;
      /* TECLADO: ela senta na cadeira onde ele a deixou (a 40 cm da mesa) e a cadeira
         e PUXADA ate a mesa no giro pra mesa (quadris a `alcance` do teclado); as maos
         ficam presas no teclado por IK enquanto digita (Michel: "as maos tem que
         ficar em cima do teclado digitando"). Sem teclado, mira a beira da mesa. */
      const teclado = pecaPorArquivo("teclado", c), bm = caixa(mesa);   // o teclado mais perto da cadeira
      const lateral = {x: paraMesa.z, z: -paraMesa.x};                      // esquerda dela, olhando pra mesa
      let alvoK = null, topoK = bm.max.y;
      if (teclado){ const bk = new THREE.Box3().setFromObject(teclado); alvoK = {x: (bk.min.x + bk.max.x) / 2, z: (bk.min.z + bk.max.z) / 2}; topoK = bk.max.y; }
      else { /* beira da mesa mais perto da cadeira, no eixo cadeira->mesa */ let t = 0; for (let k = 0; k < 40; k++){ const px = c.x + paraMesa.x * (k * 0.03), pz = c.z + paraMesa.z * (k * 0.03); if (superficieEm(mesa, px, pz) > sup + 0.05){ t = k * 0.03; break; } } alvoK = {x: c.x + paraMesa.x * (t + 0.22), z: c.z + paraMesa.z * (t + 0.22)}; }
      const alcance = ((Y.cfg.estacoes || {}).mesa || {}).alcance || 0.24;   // quadris a 24 cm do centro do teclado (o braco dela tem 42 cm e a cadeira dele e alta: ombro a 1,02 m)
      const quadrisMesa = {x: alvoK.x - paraMesa.x * alcance, z: alvoK.z - paraMesa.z * alcance};
      let puxar = {x: quadrisMesa.x - assento.x, z: quadrisMesa.z - assento.z};
      const lp = Math.hypot(puxar.x, puxar.z); if (lp > 0.45){ puxar.x *= 0.45 / lp; puxar.z *= 0.45 / lp; }
      if (puxar.x * paraMesa.x + puxar.z * paraMesa.z < 0) puxar = {x: 0, z: 0};   // so puxa em direcao a mesa
      const naMesa = {x: assento.x + puxar.x, z: assento.z + puxar.z};
      const casaPuxada = {x: casa.x + puxar.x, z: casa.z + puxar.z};             // origem da cadeira puxada ate a mesa
      const aFrente = (alvoK.x - naMesa.x) * paraMesa.x + (alvoK.z - naMesa.z) * paraMesa.z;
      if (aFrente > 0.12 && aFrente < 0.7)
        Y.digitar = {alvoE: new THREE.Vector3(alvoK.x + lateral.x * 0.11 - paraMesa.x * 0.05, topoK + 0.05, alvoK.z + lateral.z * 0.11 - paraMesa.z * 0.05),
                     alvoD: new THREE.Vector3(alvoK.x - lateral.x * 0.11 - paraMesa.x * 0.05, topoK + 0.05, alvoK.z - lateral.z * 0.11 - paraMesa.z * 0.05)};
      else { Y.digitar = null; anota("teclado fora da frente dela (" + aFrente.toFixed(2) + " m): maos ficam no clipe"); }
      E.mesa = {aprox: aprox, giro: giroSentarFora, ficar: "typing", olhar: new THREE.Vector3(naMesa.x + paraMesa.x * 0.55, sup + 0.55, naMesa.z + paraMesa.z * 0.55),
        preparar: function(){ girarMovel(cadeira, giroCadeira + MEIA, 1.0, "posto", null, {x: casa.x, z: casa.z}); },   // de costas pra mesa, em casa (de onde estiver)
        desfazer: function(){ girarMovel(cadeira, giroCadeira, 1.0, "posto", null, {x: casa.x, z: casa.z}); },        // chegada cortada antes de sentar: cadeira volta como estava
        chegar: [{clipe: SENTAR(), superficie: sup},                                                                   // senta no assento virado pro corredor
                 {pivot: {quadris: naMesa, giro: giroMesa, dur: 1.6, clipe: "sit_idle", superficie: sup, movel: {posto: cadeira, giro: giroCadeira, centro: "posto", paraPos: casaPuxada, arco: true}}},   // gira no pe, com ela, e puxa ate a mesa
                 {clipe: "typing"}],
        sair: [{pivot: {quadris: assentoFora, giro: giroSentarFora, dur: 1.6, clipe: "sit_idle", superficie: sup, movel: {posto: cadeira, giro: giroCadeira + MEIA, centro: "posto", paraPos: {x: casa.x, z: casa.z}, arco: true}}},   // gira no pe, com ela, e volta pra casa
               {clipe: "stand_up", superficie: null},
               {clipe: "idle", movel: {posto: cadeira, giro: giroCadeira, dur: 1.0, centro: "posto", paraPos: {x: casa.x, z: casa.z}, atraso: 0.9}}]};   // a cadeira so vira pra mesa depois que ela se afastou
    }
    if (sofa){
      const b = caixa(sofa), c = centro(b);
      const alvoTv = tv ? centro(caixa(tv)) : {x: c.x - 1, z: c.z};
      const dir = norma(alvoTv.x - c.x, alvoTv.z - c.z);
      const as = assentoDe(sofa, c, dir); let assento = as.ponto; const giro = giroDe(dir); const sup = as.altura;
      /* senta, sobe as pernas pro sofa e fica relaxada olhando a TV (Michel: "bem natural");
         pra sair, desce as pernas (o mesmo clipe ao contrario) e levanta */
      const comPernas = !!(Y.acoes.subir_pernas && Y.acoes.sofa_deitada);
      let supDeitada = sup, derivaSofa = null, voltaSofa = null;
      if (comPernas){
        const enc = encaixarDeitada(sofa, c, dir, giro, sup - PISO_Y, {deitar: "subir_pernas", dormir: "sofa_deitada", s: [-0.4, 0.55], t: [-1.5, 1.5], dentro: ((Y.cfg.estacoes || {}).sofa || {}).dentro});
        if (enc){ assento = enc.sentar; supDeitada = PISO_Y + enc.y - PELVE; derivaSofa = enc.deriva; voltaSofa = {x: -enc.deriva.x, z: -enc.deriva.z}; }
      }
      E.sofa = {aprox: pontoDeSentar(assento, giro, g), giro: giro, ficar: comPernas ? "sofa_deitada" : "sit_idle", olhar: tv ? new THREE.Vector3(alvoTv.x, sup + 0.5, alvoTv.z) : null,
        chegar: comPernas ? [{clipe: SENTAR(), superficie: sup}, {clipe: "sit_idle", fade: 0.4}, {clipe: "subir_pernas", fade: 0.5, superficie: supDeitada, deriva: derivaSofa}, {clipe: "sofa_deitada", fade: 0.6, superficie: supDeitada}]
                          : [{clipe: SENTAR(), superficie: sup}, {clipe: "sit_idle"}],
        sair: comPernas ? [{clipe: "descer_pernas", fade: 0.5, superficie: sup, deriva: voltaSofa}, {clipe: "sit_idle", fade: 0.4}, {clipe: "stand_up", superficie: null}]
                        : [{clipe: "stand_up", superficie: null}]};
    }
    if (balcao){
      const b = caixa(balcao), lado = ladoLivre(b, 0.36, g);
      if (lado){ const aprox = Y.pontoLivre(lado.p.x, lado.p.z, g); E.cafe = {aprox: aprox, giro: giroDe({x: -lado.dir.x, z: -lado.dir.z}), ficar: "idle", chegar: [{clipe: "idle"}], sair: []}; }
    }
    if (cama){
      /* a cama pode estar GIRADA (editor): faco a conta no frame local dela
         (caixa medida com o giro zerado) e levo pontos e direcoes pro mundo */
      const r0 = cama.obj.rotation.y, cs = Math.cos(r0), sn = Math.sin(r0), ox = cama.obj.position.x, oz = cama.obj.position.z;
      cama.obj.rotation.y = 0; cama.obj.updateMatrixWorld(true); const b = caixa(cama); cama.obj.rotation.y = r0; cama.obj.updateMatrixWorld(true);
      const M = function(p){ const dx = p.x - ox, dz = p.z - oz; return {x: ox + dx * cs + dz * sn, z: oz - dx * sn + dz * cs}; };      // ponto local -> mundo
      const D = function(d){ return {x: d.x * cs + d.z * sn, z: -d.x * sn + d.z * cs}; };                                              // direcao local -> mundo
      const c = centro(b);
      const aoLongoX = (b.max.x - b.min.x) >= (b.max.z - b.min.z);
      const alturaDaPonta = function(fim){
        let m = PISO_Y;
        for (let k = 0; k < 5; k++){
          const t = (k + 0.5) / 5;
          const p = aoLongoX ? {x: fim ? b.max.x - 0.04 : b.min.x + 0.04, z: b.min.z + (b.max.z - b.min.z) * t} : {x: b.min.x + (b.max.x - b.min.x) * t, z: fim ? b.max.z - 0.04 : b.min.z + 0.04};
          const w = M(p); m = Math.max(m, superficieEm(cama, w.x, w.z));
        }
        return m;
      };
      const cabeceiraNoFim = alturaDaPonta(true) >= alturaDaPonta(false);
      const paraCabeceiraL = aoLongoX ? {x: cabeceiraNoFim ? 1 : -1, z: 0} : {x: 0, z: cabeceiraNoFim ? 1 : -1};
      const lados = aoLongoX ? [{dir: {x: 0, z: 1}}, {dir: {x: 0, z: -1}}] : [{dir: {x: 1, z: 0}}, {dir: {x: -1, z: 0}}];
      let lado = null, md = 1e9;
      lados.forEach(function(l){
        const borda = aoLongoX ? {x: c.x - paraCabeceiraL.x * 0.25, z: l.dir.z > 0 ? b.max.z : b.min.z} : {x: l.dir.x > 0 ? b.max.x : b.min.x, z: c.z - paraCabeceiraL.z * 0.25};
        const qL = {x: borda.x - l.dir.x * 0.12, z: borda.z - l.dir.z * 0.12};
        const q = M(qL), dirW = D(l.dir);
        const pe = pontoDeSentar(q, giroDe(dirW), g);
        const dist = Math.hypot(pe.x - (q.x + dirW.x * 0.5), pe.z - (q.z + dirW.z * 0.5));
        if (dist < md){ md = dist; lado = {dir: dirW, q: q, pe: pe}; }
      });
      const cW = M(c), paraCabeceira = D(paraCabeceiraL);
      const supBorda = superficieEm(cama, lado.q.x, lado.q.z), supMeio = superficieEm(cama, cW.x, cW.z);
      const deLado = !!(Y.acoes.deitar_lado && Y.acoes.dormir_lado && Y.acoes.levantar_lado);
      let feito = false;
      if (deLado){
        /* DE LADO: senta na beira do colchao (de costas pra cama), sobe as pernas e
           deita de lado (deitar_lado), dorme de lado (dormir_lado, vai-e-vem). O
           clipe deita pra UM lado dela; das duas beiras compridas, o encaixe escolhe
           a que poe a cabeca no travesseiro (custo pela cabeceira). Coisas em cima da
           cama (pikachu) entram no mapa de altura e ela desvia. */
        const col = medirColchao(cama);
        const emCima = col ? (postos || []).filter(function(p){
          if (p === cama || !p.obj) return false; const bx = caixa(p); const cc = centro(bx);
          return bx.min.y > PISO_Y + 0.2 && Math.hypot(cc.x - col.c.x, cc.z - col.c.z) < Math.max(col.meiaLarg, col.meioComp) + 0.2;
        }) : [];
        let melhor = null;
        const variantes = [{deitar: "deitar_lado", dormir: "dormir_lado", levantar: "levantar_lado"}];
        if (Y.acoes.deitar_lado_esp && Y.acoes.dormir_lado_esp && Y.acoes.levantar_lado_esp) variantes.push({deitar: "deitar_lado_esp", dormir: "dormir_lado_esp", levantar: "levantar_lado_esp"});
        if (col) [{x: col.w.x, z: col.w.z}, {x: -col.w.x, z: -col.w.z}].forEach(function(dirW){
          const giro = giroDe(dirW);
          variantes.forEach(function(va){
            const enc = encaixarDeitada(cama, col.c, dirW, giro, col.sup - PISO_Y, {deitar: va.deitar, dormir: va.dormir, s: [-col.meiaLarg + 0.1, col.meiaLarg - 0.04], sentarS: [col.meiaLarg - 0.30, col.meiaLarg - 0.02], t: [-col.meioComp + 0.2, col.meioComp - 0.2], extras: emCima, dentro: ((Y.cfg.estacoes || {}).cama || {}).dentro != null ? Y.cfg.estacoes.cama.dentro : 0.45,
                                         cabeceira: {x: col.cabeceira.x, z: col.cabeceira.z, dist: col.meioComp - 0.18}});
            if (enc && (!melhor || enc.custo < melhor.custo)) melhor = Object.assign({va: va}, enc);
          });
        });
        if (melhor){
          const giroSentar = melhor.giro, supDeitada = PISO_Y + melhor.y - PELVE, va = melhor.va, supCol = col.sup;
          /* o encaixe ja empurrou sentar e quadris `dentro` metros pra dentro; a sentada
             volta pra beira e a diferenca vira deriva durante o deitar (Michel: "ela ta
             deitada muito na beirada") */
          const sentar = melhor.sentar, deriva = melhor.deriva || {x: 0, z: 0}, volta = {x: -deriva.x, z: -deriva.z};
          E.cama = {aprox: pontoDeSentar(sentar, giroSentar, g), giro: giroSentar, ficar: va.dormir,
            chegar: [{clipe: SENTAR(), superficie: supCol}, {clipe: "sit_idle", fade: 0.4}, {clipe: va.deitar, fade: 0.5, superficie: supDeitada, deriva: deriva}, {clipe: va.dormir, fade: 0.8, superficie: supDeitada}],
            sair: [{clipe: va.levantar, fade: 0.6, superficie: supCol, deriva: volta}, {clipe: "sit_idle", fade: 0.4}, {clipe: "stand_up", superficie: null}]};
          Y.colchao = col;
          /* APOIO DA CABECA: travesseiro alto (18 cm) e corpo rigido nao combinam; em
             vez de flutuar o corpo, a coluna e o pescoco curvam pra cabeca subir ate
             apoiar no travesseiro afundando so 4 cm (o que uma pessoa faz) */
          Y.mapaCama = mapaAltura(cama, emCima);
          if (!(Y.estacao === "cama" && Y.apoio)) Y.apoio = {subir: 0, peso: 0, medido: false};   // medido de verdade quando ela deita (a pose real erra uns cm do encaixe)
          feito = true;
        }
      }
      if (!feito){
        const vc = (Y.cabeca && Y.cabeca.sleep) || {x: 0, z: 1};
        const giroDeitar = Math.atan2(paraCabeceira.x, paraCabeceira.z) - Math.atan2(vc.x, vc.z);
        const giroSentar = giroDe(lado.dir);
        E.cama = {aprox: lado.pe, giro: giroSentar, ficar: "sleep",
          chegar: [{clipe: SENTAR(), superficie: supBorda}, {pivot: {quadris: {x: cW.x, z: cW.z}, giro: giroDeitar, dur: 1.6, clipe: "sleep", superficie: supMeio, fade: 0.9}}],
          sair: [{clipe: "wake_up", superficie: supMeio}, {pivot: {quadris: lado.q, giro: giroSentar, dur: 1.3, clipe: "sit_idle", superficie: supBorda, fade: 0.6}}, {clipe: "stand_up", superficie: null}]};
      }
    }
    if (tapete){
      const c = centro(caixa(tapete));
      const alvoTv = tv ? centro(caixa(tv)) : {x: c.x - 1, z: c.z};
      const dir = norma(alvoTv.x - c.x, alvoTv.z - c.z);
      const lugar = Y.pontoLivre(c.x - dir.x * 0.5, c.z - dir.z * 0.5, g);
      E.tapete = {aprox: lugar, giro: giroDe(dir), ficar: "sit_floor", chegar: [{clipe: "sit_floor", superficie: null, fade: 0.7}], sair: [{clipe: "idle", fade: 0.6}]};
    }
    if (capacho){
      const b = caixa(capacho), c = centro(b);
      let dirPorta = null;
      [{x: 0, z: -1}, {x: 0, z: 1}, {x: 1, z: 0}, {x: -1, z: 0}].forEach(function(d){ if (dirPorta) return; const q = celulaDe(g, c.x + d.x * 0.6, c.z + d.z * 0.6); if (!livreEm(g, q.ix, q.iz)) dirPorta = d; });
      dirPorta = dirPorta || {x: 0, z: -1};
      E.porta = {aprox: Y.pontoLivre(c.x, c.z, g), giro: giroDe(dirPorta), ficar: "idle", chegar: [{clipe: "wave"}, {clipe: "idle"}], sair: []};
    }
    /* OBJETOS DE INTERACAO: halteres (exercicio) e pikachu (agachar e fazer carinho).
       Ela para a ~0,55 m do objeto, virada pra ele. */
    const halter = posto("9x-halter"), pikachu = posto("9x-pikachu");
    const pertoDe = function(p, dist){
      const b = caixa(p), c = centro(b);
      /* lado livre mais perto do centro do palco */
      const lado = ladoLivre(b, dist, g) || {dir: {x: 0, z: -1}, p: {x: c.x, z: c.z - dist}};
      return {aprox: Y.pontoLivre(lado.p.x, lado.p.z, g), giro: giroDe({x: -lado.dir.x, z: -lado.dir.z}), c: c, topo: b.max.y};
    };
    if (halter && Y.acoes.halteres){
      const h = pertoDe(halter, 0.5);
      E.halter = {aprox: h.aprox, giro: h.giro, ficar: "halteres", chegar: [{clipe: "halteres", fade: 0.5}], sair: [{clipe: "idle", fade: 0.5}]};
    }
    if (pikachu && Y.acoes.pet_pikachu){
      const h = pertoDe(pikachu, 0.6);
      E.pikachu = {aprox: h.aprox, giro: h.giro, ficar: "idle", olhar: new THREE.Vector3(h.c.x, h.topo, h.c.z), chegar: [{clipe: "pet_pikachu", fade: 0.4}, {clipe: "idle"}], sair: []};
    }
    /* centro do palco, virada pra camera da live (azimute -45 graus) */
    const cc = ctx.centro || {x: -0.4, z: 0.9};
    E.centro = {aprox: Y.pontoLivre(cc.x, cc.z, g), giro: -Math.PI / 4, ficar: "idle", chegar: [{clipe: "idle"}], sair: []};
    Object.keys(E).forEach(function(n){ somaAjuste(n, E[n]); });
    return E;
  };
  Y.lookAtObj = new THREE.Object3D(); cena.add(Y.lookAtObj); Y.olharAlvo = null;
  Y.irPara = function(nome, fim){
    /* chegada anterior cortada antes de sentar (o motor troca de ideia): desfaz o preparo (a cadeira volta) */
    if (Y.chegando && Y.chegando !== Y.estacao){ const Ea = Y.estacoes(); if (Ea[Y.chegando] && Ea[Y.chegando].desfazer) Ea[Y.chegando].desfazer(); }
    Y.chegando = nome;
    const E = Y.estacoes(); const e = E[nome];
    if (!e){ anota("estacao desconhecida: " + nome); return; }
    Y.olharAlvo = null;
    Y.giroAlvo = null; Y.aoChegar = null; Y.aoVirar = null; Y.aoTerminar = null; Y.lerp = null; Y.pivot = null;
    const depois = function(){
      if (e.preparar) e.preparar();
      Y.andarAte(e.aprox, function(){
        Y.virarPara(e.giro, function(){
          Y.quadris = quadrisDe({x: Y.x, z: Y.z}, Y.giro, Y.clipeAtual, "fim");
          Y.sequencia(e.chegar, function(){ Y.estacao = nome; Y.estado = "na estacao"; Y.olharAlvo = e.olhar || null; anota("na estacao " + nome); if (fim) fim(); });
        });
      });
    };
    const atual = Y.estacao ? E[Y.estacao] : null;
    Y.estacao = null;
    if (atual && atual.sair && atual.sair.length && Y.estado !== "andando") Y.sequencia(atual.sair, depois); else depois();
  };

  /* ------------------------------------------------------------- quadro */
  Y.atualizar = function(dt){
    if (!Y.pronto) return;
    dt = Math.min(0.1, dt || 0); Y.tempo += dt;
    if (Y.estado === "andando" && Y.caminho.length){
      const p = Y.caminho[Y.passo];
      const dx = p.x - Y.x, dz = p.z - Y.z, d = Math.hypot(dx, dz), passo = Y.vel * dt;
      if (d <= passo){
        Y.x = p.x; Y.z = p.z; Y.passo++;
        if (Y.passo >= Y.caminho.length){ Y.estado = "parada"; const f = Y.aoChegar; Y.aoChegar = null; if (f) f(); else Y.tocar("idle"); }
      } else { Y.x += dx / d * passo; Y.z += dz / d * passo; Y.giroAlvo = Math.atan2(dx, dz); }
      Y.quadris = quadrisDe({x: Y.x, z: Y.z}, Y.giro, Y.clipeAtual, "fim");
    }
    if (Y.giroAlvo != null){
      const dg = anguloDif(Y.giroAlvo, Y.giro), m = 6 * dt;
      if (Math.abs(dg) <= m){ Y.giro = Y.giroAlvo; Y.giroAlvo = null; if (Y.estado === "virando"){ Y.estado = "parada"; const f = Y.aoVirar; Y.aoVirar = null; if (f) f(); } }
      else Y.giro += Math.sign(dg) * m;
    }
    if (Y.pivot){
      const P = Y.pivot; P.t += dt; const k = Math.min(1, P.t / P.dur), s = k * k * (3 - 2 * k);
      Y.giro = P.de.giro + anguloDif(P.para.giro, P.de.giro) * s;
      let q;
      if (P.arco){
        /* mesmo giro do movel, em torno do mesmo centro; o que sobrar (a puxada) vai em linha */
        const A = P.arco, d = A.ang * s, c = Math.cos(d), sn = Math.sin(d), cA = Math.cos(A.ang), sA = Math.sin(A.ang), rx = P.de.q.x - A.centro.x, rz = P.de.q.z - A.centro.z;
        const fx = A.centro.x + cA * rx + sA * rz, fz = A.centro.z - sA * rx + cA * rz;
        q = {x: A.centro.x + c * rx + sn * rz + (P.para.q.x - fx) * s, z: A.centro.z - sn * rx + c * rz + (P.para.q.z - fz) * s};
      } else q = {x: P.de.q.x + (P.para.q.x - P.de.q.x) * s, z: P.de.q.z + (P.para.q.z - P.de.q.z) * s};
      const o = origemPara(q, Y.giro, P.clipe, "fim");
      const wd = P.desloc ? 1 - Math.min(1, P.t / P.desloc.fade) : 0;
      Y.x = o.x + (P.desloc ? P.desloc.x * wd : 0); Y.z = o.z + (P.desloc ? P.desloc.z * wd : 0); Y.quadris = q;
      Y.y = P.de.y + (alturaPara(Y.superficie, P.clipe, "fim") - P.de.y) * s;
      if (P.movel && !P.movelIniciado){ P.movelIniciado = true; girarMovel(P.movel.posto, P.movel.giro, P.dur, P.movelCentro || P.movel.centro, P.movel.desloc, P.movel.paraPos); }
      if (k >= 1){ Y.pivot = null; if (P.fim) P.fim(); }
    } else if (Y.lerp){
      const L = Y.lerp; L.t += dt;
      const suave = function(k){ k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
      const s = suave(L.t / L.fade), sl = Math.max(0, Math.min(1, L.t / L.fade));
      const dv = L.deriva ? suave(L.t / L.durY) : 0;
      Y.x = L.de.x + (L.para.x - L.de.x) * sl + (L.deriva ? L.deriva.x * dv : 0); Y.z = L.de.z + (L.para.z - L.de.z) * sl + (L.deriva ? L.deriva.z * dv : 0);
      if (L.t <= L.fade) Y.y = L.de.y + (L.yIni - L.de.y) * s;
      else Y.y = L.yIni + (L.yFim - L.yIni) * suave((L.t - L.fade) / Math.max(0.05, L.durY - L.fade));
      if (L.t >= L.durY){ Y.y = L.yFim; Y.x = L.para.x + (L.deriva ? L.deriva.x : 0); Y.z = L.para.z + (L.deriva ? L.deriva.z : 0); Y.lerp = null; }
    }
    animarMoveis(dt);
    Y.obj.position.set(Y.x, Y.y, Y.z); Y.obj.rotation.y = Y.giro;
    Y.mixer.update(dt);
    /* PE NO CHAO sentada: a perna do VRM e mais comprida que a do clipe (assento
       baixo pra ela) e o pe furava o piso 5 cm; aqui o corpo sobe o que faltar.
       (No chao branco o piso e transparente: pe furando aparece.) */
    if (Y.superficie != null && Y.lerp == null && Y.pivot == null){
      Y.obj.updateMatrixWorld(true);
      const pe = Math.min(osso("leftToes").getWorldPosition(_v).y, osso("rightToes").getWorldPosition(_v2).y);
      if (pe < PISO_Y - 0.004){ Y.obj.position.y += PISO_Y - pe; Y.obj.updateMatrixWorld(true); }
    }
    maosNoTeclado(dt);
    apoiarCabeca(dt);
    /* DEDOS: relaxados; digitando batem; desenhando a direita fecha; dormindo meio fechados.
       So quando o clipe nao traz dedos (os do Mixamo trazem). */
    const clip = Y.atual && Y.atual.getClip();
    const clipeTemDedos = clip && clip.userData && clip.userData.dedos;
    if (Y.dedos.length && !clipeTemDedos){
      const digitando = Y.clipeAtual === "typing", desenhando = Y.clipeAtual === "draw" || Y.clipeAtual === "halteres", dormindo = Y.clipeAtual === "sleep" || Y.clipeAtual === "sleep_desk";   // halteres: a direita fecha em punho na barra
      const t = Y.tempo;
      Y.dedos.forEach(function(d){
        let ang;
        if (d.dedo < 0){ ang = [0.15, 0.25, 0.2][d.seg]; if (desenhando && d.lado === "right") ang += 0.3; d.no.rotation.set(0, d.sinal * -ang * 0.6, d.sinal * -ang * 0.5); return; }
        ang = [0.32, 0.42, 0.22][d.seg] + d.dedo * 0.03;
        if (digitando) ang = [0.28, 0.35, 0.2][d.seg] + Math.max(0, Math.sin(t * 8.5 + d.fase)) * (d.seg === 0 ? 0.45 : 0.25);
        else if (desenhando && d.lado === "right") ang = [0.9, 0.9, 0.5][d.seg];
        else if (dormindo) ang = [0.5, 0.6, 0.3][d.seg];
        d.no.rotation.set(0, 0, d.sinal * ang);
      });
    }
    if (Y.objetosMao){
      Y.objetosMao.caneca.visible = /drink/.test(Y.clipeAtual || "");
      Y.objetosMao.celular.visible = Y.clipeAtual === "phone";
    }
    /* HALTER NA MAO: no clipe "halteres" o halter mais perto dela vai pra mao direita (o objeto de verdade, nao uma copia); ao sair volta pro lugar */
    (function(){
      const mao = osso("rightHand"); if (!mao) return;
      if (Y.clipeAtual === "halteres" && !Y.halterNaMao){
        let melhor = null, md = 1e9;
        (postos || []).forEach(function(p){ if (!/^9x-halter/.test(p.arquivo) || !p.obj) return; const d = Math.hypot(p.obj.position.x - Y.quadris.x, p.obj.position.z - Y.quadris.z); if (d < md){ md = d; melhor = p; } });
        if (melhor && md < 1.5){
          const o = melhor.obj; Y.halterNaMao = {obj: o, pai: o.parent, pos: o.position.clone(), rot: o.rotation.clone(), esc: o.scale.clone()};
          mao.add(o); o.scale.copy(Y.halterNaMao.esc);                                   // a mao normalizada tem escala 1
          /* a barra do modelo e o eixo x dele; na mao normalizada (T-pose: dedos pra -x,
             polegar pra +z) a barra atravessa a palma no eixo z -> gira 90 graus em y
             (antes ficava ao longo dos dedos, como um bastao saindo do punho: Michel
             viu "ela nao esta segurando") */
          o.position.set(-0.08, -0.025, 0.0); o.rotation.set(0, Math.PI / 2, 0);
        }
      } else if (Y.clipeAtual !== "halteres" && Y.halterNaMao){
        const h = Y.halterNaMao; h.pai.add(h.obj); h.obj.position.copy(h.pos); h.obj.rotation.copy(h.rot); h.obj.scale.copy(h.esc); Y.halterNaMao = null;
      }
    })();
    /* OLHAR: no sofa olha pra TV, na mesa pro monitor do meio, no resto pra camera (ctx.olharPadrao) */
    if (vrm.lookAt){
      const alvo = Y.olharAlvo; if (alvo && Y.lookAtObj){ Y.lookAtObj.position.copy(alvo); vrm.lookAt.target = Y.lookAtObj; }
      else if (ctx.olharPadrao) vrm.lookAt.target = ctx.olharPadrao;
    }
    /* PISCAR por expressao; dormindo fica fechado */
    if (vrm.expressionManager){
      const dormindo = Y.clipeAtual === "sleep" || Y.clipeAtual === "sleep_desk";
      let fechar = dormindo;
      if (!dormindo){
        if (Y.tempo > Y.olhos.proxima){ Y.olhos.fechadosAte = Y.tempo + 0.13; Y.olhos.proxima = Y.tempo + 2.2 + Math.random() * 3.5 - (Math.random() < 0.2 ? 1.9 : 0); }
        fechar = Y.tempo < Y.olhos.fechadosAte;
      }
      vrm.expressionManager.setValue("blink", fechar ? 1 : 0);
    }
    vrm.update(dt);
  };

  /* --------------------------------------------------- marcas e gravacao */
  Y.marcadores = function(on){
    if (Y.marcas){ cena.remove(Y.marcas); Y.marcas = null; }
    if (!on) return;
    const g = new THREE.Group(); const E = Y.estacoes();
    Object.keys(E).forEach(function(n){
      const e = E[n];
      const anel = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 32).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: 0x5fc9ff, depthTest: false, transparent: true, opacity: 0.9}));
      anel.position.set(e.aprox.x, PISO_Y + 0.02, e.aprox.z); anel.renderOrder = 999; g.add(anel);
      const seta = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 8).rotateX(Math.PI/2), anel.material);
      seta.position.set(e.aprox.x + Math.sin(e.giro) * 0.3, PISO_Y + 0.03, e.aprox.z + Math.cos(e.giro) * 0.3); seta.rotation.y = e.giro; seta.renderOrder = 999; g.add(seta);
    });
    const gr = Y.grade || Y.montarGrade();
    if (gr){
      const pts = [];
      for (let iz = 0; iz < gr.nz; iz += 2) for (let ix = 0; ix < gr.nx; ix += 2) if (gr.livre[iz*gr.nx + ix]){ const c = centroDe(gr, ix, iz); pts.push(c.x, PISO_Y + 0.015, c.z); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({color: 0x40e0a0, size: 0.03, depthTest: false, transparent: true, opacity: 0.6})));
    }
    Y.marcas = g; cena.add(g);
  };
  Y.gravar = async function(){
    Y.cfg.altura = Y.altura; Y.cfg.vel = Y.vel;
    const r = await fetch(Y.salvarUrl, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(Y.cfg)});
    anota(r.ok ? "cfg gravada" : "FALHOU ao gravar a cfg");
    return r.ok;
  };
  Y.ajustar = function(nome, dx, dz, dg, dy){
    nome = nome || Y.estacao; if (!nome) return;
    const a = Y.cfg.estacoes[nome] = Y.cfg.estacoes[nome] || {};
    a.dx = +((a.dx || 0) + (dx || 0)).toFixed(3); a.dz = +((a.dz || 0) + (dz || 0)).toFixed(3);
    a.giro = +((a.giro || 0) + (dg || 0)).toFixed(1); a.dy = +((a.dy || 0) + (dy || 0)).toFixed(3);
    if (Y.marcas) Y.marcadores(true);
    return a;
  };
  return Y;
}
