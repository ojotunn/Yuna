/* ESTACAO DA LAIN -- o que e feito em codigo: telas CRT animadas (com a luz
   que jogam no ambiente), cabos serpenteando no CHAO entre as maquinas e tubos
   de refrigeracao com liquido correndo. Nada desce do teto (Michel: "os cabos
   nao podem descer do teto").

   montarTelas(THREE)            -> T; T.nova(spec) pendura uma tela no monitor (spec.pai), T.animar(dt)
   montarCabos(THREE, cena, spec)-> C; grupo com cabos de chao e tubos; C.animar(dt); C.descartar() */
function geradorAleatorio(seed){ let s = seed || 7; return function(){ s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function montarTelas(THREE){
  const rnd = geradorAleatorio(23);
  const telas = [];
  const HEX = "0123456789ABCDEF";
  /* spec: {pai (Object3D do monitor), centro, normal (no espaco local do pai), largura, altura, tipo, cor, brilho, luz} */
  function nova(spec){
    const w = spec.largura, h = spec.altura;
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = Math.max(32, Math.round(256 * h / w)); const x = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(w, h, 12, 8);
    const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++){ const u = pos.getX(i) / (w / 2), v = pos.getY(i) / (h / 2); pos.setZ(i, (1 - (u * u + v * v) * 0.5) * (spec.barriga || 0.012)); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: spec.brilho || 1.6, roughness: 0.3}));
    m.name = "tela-crt"; m.userData.tela = true;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), spec.normal.clone().normalize());
    m.position.copy(spec.centro).addScaledVector(spec.normal, (spec.saliencia || 0) + 0.004); m.quaternion.copy(q);   // na frente da barriga do CRT
    spec.pai.add(m);
    const luz = new THREE.SpotLight(spec.cor || 0x9fe8b0, spec.luz != null ? spec.luz : 2.0, 2.2, 0.9, 0.7, 1.2);
    luz.name = "luz-tela"; luz.position.copy(m.position); luz.target.position.copy(m.position.clone().add(new THREE.Vector3(0, -0.15, 0.9).applyQuaternion(q)));
    spec.pai.add(luz); spec.pai.add(luz.target);
    const t = {cv: cv, x: x, tex: tex, tipo: spec.tipo || "terminal", cor: spec.cor || 0x9fe8b0, fase: rnd() * 100, linhas: [], luz: luz, brilhoBase: luz.intensity, malha: m, pai: spec.pai};
    telas.push(t); return t;
  }
  function tirar(pai){ for (let i = telas.length - 1; i >= 0; i--) if (telas[i].pai === pai) telas.splice(i, 1); }
  function desenhar(t, tempo){
    const x = t.x, W = t.cv.width, H = t.cv.height; const cor = new THREE.Color(t.cor);
    const rgb = function(k){ return "rgb(" + Math.round(cor.r * 255 * k) + "," + Math.round(cor.g * 255 * k) + "," + Math.round(cor.b * 255 * k) + ")"; };
    x.fillStyle = "#050806"; x.fillRect(0, 0, W, H);
    if (t.texto && t.texto.length){
      /* TEXTO DE VERDADE (o codigo que ela escreve, a saida que rodou): linhas
         ja quebradas pela pagina; as ultimas que couberem */
      x.font = "bold 11px monospace"; x.fillStyle = rgb(0.9);
      const cabem = Math.floor((H - 8) / 12), ini = Math.max(0, t.texto.length - cabem);
      for (let i = ini; i < t.texto.length; i++) x.fillText(t.texto[i], 6, 14 + (i - ini) * 12);
      if (Math.floor(tempo * 2) % 2) x.fillRect(6, 14 + (t.texto.length - ini) * 12 - 9, 7, 10);
    } else if (t.tipo === "terminal"){
      if (rnd() < 0.35){ let s = ""; for (let i = 0; i < 26; i++) s += HEX[Math.floor(rnd() * 16)] + (i % 2 ? " " : ""); t.linhas.push(s); if (t.linhas.length > Math.floor(H / 12) - 1) t.linhas.shift(); }
      x.font = "bold 11px monospace"; x.fillStyle = rgb(0.85);
      t.linhas.forEach(function(l, i){ x.fillText(l, 6, 14 + i * 12); });
      if (Math.floor(tempo * 2) % 2) x.fillRect(6, 14 + t.linhas.length * 12 - 9, 7, 10);
    } else if (t.tipo === "onda"){
      x.strokeStyle = rgb(0.9); x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < W; i++){ const y = H / 2 + Math.sin(i * 0.08 + tempo * 4 + t.fase) * H * 0.25 * Math.sin(i * 0.011 + tempo); if (i) x.lineTo(i, y); else x.moveTo(i, y); }
      x.stroke(); x.strokeStyle = rgb(0.25); x.lineWidth = 1; for (let k = 0; k < 6; k++){ x.beginPath(); x.moveTo(0, k * H / 5); x.lineTo(W, k * H / 5); x.stroke(); }
    } else if (t.tipo === "ruido"){
      const img = x.createImageData(W, H); const d = img.data;
      for (let i = 0; i < d.length; i += 4){ const v = rnd() * 255; d[i] = v * cor.r; d[i+1] = v * cor.g; d[i+2] = v * cor.b; d[i+3] = 255; }
      x.putImageData(img, 0, 0);
    } else if (t.tipo === "grade"){
      x.strokeStyle = rgb(0.6); x.lineWidth = 1; const n = 8, s = (tempo * 0.4 + t.fase) % 1;
      for (let k = 0; k <= n; k++){ const yy = H * 0.45 + (H * 0.55) * Math.pow((k + s) / (n + 1), 2.2); x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); }
      for (let k = -6; k <= 6; k++){ x.beginPath(); x.moveTo(W / 2 + k * W * 0.06, H * 0.45); x.lineTo(W / 2 + k * W * 0.3, H); x.stroke(); }
    }
    x.fillStyle = "rgba(0,0,0,0.25)"; for (let yy = 0; yy < H; yy += 3) x.fillRect(0, yy, W, 1);
    const grad = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,0.55)");
    x.fillStyle = grad; x.fillRect(0, 0, W, H);
    t.tex.needsUpdate = true;
  }
  let acum = 0, tempo = 0;
  function animar(dt){
    tempo += dt; acum += dt;
    if (acum > 1 / 12){ acum = 0; telas.forEach(function(t){ desenhar(t, tempo); t.luz.intensity = t.brilhoBase * (0.92 + 0.08 * Math.sin(tempo * 11 + t.fase) + (rnd() < 0.02 ? -0.25 : 0)); }); }
  }
  /* texto numa tela (pai = raiz da peca); linhas = array ou null pra voltar ao efeito */
  function texto(pai, linhas){ telas.forEach(function(t){ if (t.pai === pai) t.texto = linhas && linhas.length ? linhas.slice() : null; }); }
  function lista(){ return telas.slice(); }
  return {nova: nova, tirar: tirar, animar: animar, texto: texto, lista: lista, telas: telas};
}

export function montarCabos(THREE, cena, op){
  op = op || {};
  const g = new THREE.Group(); g.name = "cabos-lain"; cena.add(g);
  const rnd = geradorAleatorio(op.semente || 11);
  const CORES = [0x101010, 0x1a1a1f, 0x2a1414, 0x14182a, 0x222222, 0x3a2a12];
  const mats = {};
  function mat(cor){ if (!mats[cor]) mats[cor] = new THREE.MeshStandardMaterial({color: cor, roughness: 0.75, metalness: 0.05}); return mats[cor]; }
  const pisoY = op.pisoY || 0, rMin = op.raioMin || 0.004, rMax = op.raioMax || 0.007;
  function caboChao(de, ate, raio, cor){
    const n = 5, pts = [];
    for (let i = 0; i <= n; i++){
      const t = i / n; const p = new THREE.Vector3().lerpVectors(de, ate, t);
      if (i > 0 && i < n){ p.x += (rnd() - 0.5) * 0.3; p.z += (rnd() - 0.5) * 0.3; }
      p.y = pisoY + raio + (i > 0 && i < n ? rnd() * 0.015 : 0.02);
      pts.push(p);
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5), 60, raio, 6, false), mat(cor));
    m.castShadow = true; return m;
  }
  (op.chao || []).forEach(function(c){ for (let i = 0; i < (c.n || 2); i++) g.add(caboChao(c.de, c.ate, rMin + rnd() * (rMax - rMin), CORES[Math.floor(rnd() * CORES.length)])); });
  const tubos = [];
  (op.tubos || []).forEach(function(t){
    const curva = new THREE.CatmullRomCurve3(t.pts, false, "centripetal", 0.5), raio = t.raio || 0.02;
    const vidro = new THREE.Mesh(new THREE.TubeGeometry(curva, 64, raio, 10, false), new THREE.MeshStandardMaterial({color: 0x9fd6e8, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.28}));
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 8; const x = cv.getContext("2d");
    for (let i = 0; i < 256; i++){ const k = (Math.sin(i / 256 * Math.PI * 6) + 1) / 2; x.fillStyle = "rgba(" + Math.round(40 + 80 * k) + "," + Math.round(200 + 55 * k) + "," + Math.round(210 + 45 * k) + ",1)"; x.fillRect(i, 0, 1, 8); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(6, 1); tex.colorSpace = THREE.SRGBColorSpace;
    const liq = new THREE.Mesh(new THREE.TubeGeometry(curva, 64, raio * 0.7, 8, false), new THREE.MeshStandardMaterial({color: t.cor || 0x66f0ff, emissive: t.cor || 0x66f0ff, emissiveIntensity: 0.9, emissiveMap: tex, map: tex, roughness: 0.4}));
    vidro.add(liq); tubos.push({tex: tex, vel: 0.25 + rnd() * 0.3}); g.add(vidro);
  });
  function animar(dt){ tubos.forEach(function(t){ t.tex.offset.x -= dt * t.vel; }); }
  function descartar(){ cena.remove(g); g.traverse(function(o){ if (o.geometry) o.geometry.dispose(); }); }
  return {grupo: g, animar: animar, descartar: descartar};
}

/* ------------------------------------------------------------------------
   CABOS DESENHADOS A MAO (Michel: "eu faco o traco e voce texturiza depois").
   Cada cabo: {id, espessura (raio, m), cor, pontos: [[x,y,z], ...]} e vira um
   tubo liso (CatmullRom) passando pelos pontos. Enquanto desenha, um tubo de
   previa acompanha o mouse. Materiais simples por enquanto (a textura vem
   depois: trocar `material(cor)` aqui basta). */
export const ESPESSURAS = {fino: 0.0025, medio: 0.005, grosso: 0.009, cabo_grosso: 0.016, duto: 0.03};   // raios (m): duto = 6 cm de diametro
export function montarCabosDesenhados(THREE, cena, op){
  op = op || {};
  const g = new THREE.Group(); g.name = "cabos-desenhados"; cena.add(g);
  const cabos = []; let seq = 0;
  const mats = {};
  function material(cor){ if (!mats[cor]) mats[cor] = new THREE.MeshStandardMaterial({color: cor, roughness: 0.7, metalness: 0.05}); return mats[cor]; }
  const matEncaixe = new THREE.MeshStandardMaterial({color: 0x2b2b30, roughness: 0.45, metalness: 0.7});
  const matRosca = new THREE.MeshStandardMaterial({color: 0x55555c, roughness: 0.5, metalness: 0.75});
  const ray = new THREE.Raycaster();
  /* ENCAIXE: na ponta do cabo, acha a superficie do aparelho mais perto (primeiro
     na direcao em que o cabo chega; senao em volta, ate 12 cm) e poe um conector
     (flange + corpo + rosca) alinhado com a normal da superficie. Devolve o ponto
     dentro do conector, pra onde o tubo do cabo e estendido. Ponta no chao ou
     longe de tudo fica sem conector. */
  function acharSuperficie(E, dir){
    const alvos = op.superficies ? op.superficies() : []; if (!alvos.length) return null;
    const filtra = function(hs){ return hs.filter(function(h){ return !h.object.userData.tela && h.object.name !== "luz-tela" && !h.object.userData.cabo && !(h.object.parent && h.object.parent.userData.encaixe); }); };
    let melhor = null;
    const tenta = function(origem, d, alcance){
      ray.set(origem, d); ray.far = alcance; const hs = filtra(ray.intersectObjects(alvos, true));
      if (hs.length && (!melhor || hs[0].distance < melhor.distancia)){ const h = hs[0]; const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize() : d.clone().negate(); if (n.dot(d) > 0) n.negate(); melhor = {ponto: h.point.clone(), normal: n, distancia: h.distance}; }
    };
    if (dir && dir.lengthSq() > 1e-6) tenta(E.clone().addScaledVector(dir, -0.06), dir.clone().normalize(), 0.30);
    if (!melhor){ [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0],[0,1,0]].forEach(function(v){ tenta(E.clone(), new THREE.Vector3(v[0], v[1], v[2]), 0.12); }); }
    return melhor;
  }
  function encaixe(c, E, dir){
    if (E.y < c.espessura + 0.03 && (!dir || Math.abs(dir.y) < 0.5)) return null;   // ponta deitada no chao: sem conector
    const sup = acharSuperficie(E, dir); if (!sup) return null;
    const r = c.espessura, rb = Math.max(0.006, r * 1.8), comp = r * 3.5 + 0.012, rf = Math.max(0.012, r * 2.8);
    const grupo = new THREE.Group(); grupo.userData.encaixe = true;
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(rf, rf, 0.0025, 24), matEncaixe);
    const corpo = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb, comp, 20), matEncaixe);
    const rosca = new THREE.Mesh(new THREE.CylinderGeometry(rb * 1.18, rb * 1.18, 0.004 + r * 0.4, 8), matRosca);
    flange.position.y = 0.00125; corpo.position.y = comp / 2; rosca.position.y = comp - (0.004 + r * 0.4) / 2 - 0.001;
    grupo.add(flange); grupo.add(corpo); grupo.add(rosca);
    grupo.position.copy(sup.ponto).addScaledVector(sup.normal, 0.001);
    grupo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sup.normal);
    grupo.traverse(function(o){ if (o.isMesh){ o.castShadow = true; o.userData.cabo = c; } });
    c.malha.add(grupo);                                   // filho do cabo: seleciona/remove junto
    return sup.ponto.clone().addScaledVector(sup.normal, comp * 0.45);   // onde o tubo termina (dentro do corpo)
  }
  function geometria(pontos, raio, c){
    const pts = pontos.map(function(p){ return new THREE.Vector3(p[0], p[1], p[2]); });
    if (pts.length === 1) pts.push(pts[0].clone().add(new THREE.Vector3(0.001, 0, 0)));
    if (c && pts.length >= 2){
      /* pontas: estende ate dentro do conector, se houver */
      const dirFim = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
      const dirIni = pts[0].clone().sub(pts[1]).normalize();
      const fim = encaixe(c, pts[pts.length - 1], dirFim); if (fim) pts.push(fim);
      const ini = encaixe(c, pts[0], dirIni); if (ini) pts.unshift(ini);
      /* ponta solta perto do chao: mergulha no piso (o piso e opaco, o cabo some) */
      const mergulho = function(E, d){ const h = new THREE.Vector3(d.x, 0, d.z); if (h.lengthSq() < 1e-6) h.set(1, 0, 0); h.normalize(); return [E.clone().addScaledVector(h, 0.05).setY(-raio * 1.5), E.clone().addScaledVector(h, 0.11).setY(-0.06)]; };
      if (!fim && pts[pts.length - 1].y < raio + 0.03){ const m = mergulho(pts[pts.length - 1], dirFim); pts.push(m[0], m[1]); }
      if (!ini && pts[0].y < raio + 0.03){ const m = mergulho(pts[0], dirIni); pts.unshift(m[1], m[0]); }
    }
    const curva = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    const seg = Math.max(8, Math.min(400, Math.round(curva.getLength() / 0.02)));
    return new THREE.TubeGeometry(curva, seg, raio, 8, false);
  }
  function novo(d){
    const c = {id: d.id || ("c" + (++seq)), espessura: d.espessura || 0.005, cor: d.cor || "111111", pontos: (d.pontos || []).map(function(p){ return p.slice(); })};
    const n = parseInt(c.id.replace(/\D/g, ""), 10); if (n > seq) seq = n;
    c.malha = new THREE.Mesh(new THREE.BufferGeometry(), material(parseInt(c.cor, 16)));
    c.malha.castShadow = true; c.malha.userData.cabo = c; g.add(c.malha); cabos.push(c);
    c.malha.geometry = geometria(c.pontos, c.espessura, c);
    return c;
  }
  function remover(id){ const i = cabos.findIndex(function(c){ return c.id === id; }); if (i < 0) return; g.remove(cabos[i].malha); cabos[i].malha.geometry.dispose(); cabos.splice(i, 1); }
  /* refaz os encaixes de todos (depois de mover pecas) */
  function refazerEncaixes(){ cabos.forEach(function(c){ while (c.malha.children.length) c.malha.remove(c.malha.children[0]); c.malha.geometry.dispose(); c.malha.geometry = geometria(c.pontos, c.espessura, c); }); }
  function caboDe(obj){ let o = obj; while (o){ if (o.userData && o.userData.cabo) return o.userData.cabo; o = o.parent; } return null; }
  function serializar(){ return cabos.map(function(c){ return {id: c.id, espessura: c.espessura, cor: c.cor, pontos: c.pontos.map(function(p){ return p.map(function(v){ return +v.toFixed(3); }); })}; }); }
  function carregar(lista){ (lista || []).forEach(novo); }
  /* previa enquanto desenha */
  let previa = null;
  function mostrarPrevia(pontos, raio, cor){
    if (previa){ g.remove(previa); previa.geometry.dispose(); previa = null; }
    if (!pontos || pontos.length < 1) return;
    previa = new THREE.Mesh(geometria(pontos, raio), new THREE.MeshStandardMaterial({color: parseInt(cor, 16), roughness: 0.7, transparent: true, opacity: 0.7, emissive: 0x2244aa, emissiveIntensity: 0.6}));
    g.add(previa);
  }
  return {grupo: g, cabos: cabos, novo: novo, remover: remover, caboDe: caboDe, serializar: serializar, carregar: carregar, mostrarPrevia: mostrarPrevia, refazerEncaixes: refazerEncaixes, selecionaveis: function(){ return cabos.map(function(c){ return c.malha; }); }};
}
