/* ESTACAO DE TRABALHO DA LAIN (v2, editavel): as pecas de quarto/3d/lain/*.glb
   conforme quarto/3d/lain/estacao.json, em coordenadas de MUNDO. Cada peca:
   {id, arquivo, papel, tamanho (maior lado, m), x, z, dy, giro, tela, cor}.
   A altura e automatica: a peca ASSENTA no que estiver embaixo dela (raio de
   cima pra baixo nas outras pecas; senao o chao) mais dy. Monitores: o vidro e
   achado pelo maior grupo de triangulos escuros quase verticais; com giro 0 a
   tela olha pra -z.

   API pro editor do /vrm: adicionar(arquivo), duplicar(id), remover(id),
   mover(id, x, z), girar(id, delta), escalar(id, fator), subir(id, dy),
   assentar(id), pecaDe(objeto), serializar(), postos(), cabos(). */
export const PAPEL_POR_NOME = [[/crt|lg|monitor|tela|tv/i, "monitor"], [/mesa|desk/i, "mesa"], [/cadeira|chair/i, "cadeira"], [/cama|bed/i, "cama"], [/sofa|couch/i, "sofa"], [/audio|rack|server/i, "rack"], [/mainframe|navi/i, "navi"]];
/* tamanho inicial (maior lado, m) ao adicionar, por papel */
export const TAMANHO_INICIAL = {mesa: 1.6, cadeira: 1.0, cama: 2.0, sofa: 1.8, monitor: 0.45, rack: 1.5, navi: 1.3, prop: 0.5};
export const TAMANHO_POR_NOME = {tv: 1.0, rack_tv: 1.4, halter: 0.35, pikachu: 0.35, teclado: 0.45, mouse: 0.11};
export function papelDe(arquivo){ for (const r of PAPEL_POR_NOME) if (r[0].test(arquivo)) return r[1]; return "prop"; }

import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
export async function montarEstacao(THREE, GLTFLoader, cena, op){
  op = op || {};
  const pisoY = op.pisoY || 0;
  const BASE = op.base || "/3d";                       // "/p3d" = copia publica leve (meshopt)
  const cfg = await (await fetch(BASE + "/lain/estacao.json?v=" + Date.now(), {cache: "no-store"})).json();
  if (cfg.versao !== 2) throw new Error("estacao.json nao e v2");
  const carregador = new GLTFLoader(); carregador.setMeshoptDecoder(MeshoptDecoder);
  const modelos = {};                                  // arquivo -> {scene, tela (no espaco do modelo normalizado)}
  const est = {cfg: cfg, pecas: [], telas: null, seq: 0};
  const ray = new THREE.Raycaster();

  async function modelo(arquivo){
    if (modelos[arquivo]) return modelos[arquivo];
    const g = await carregador.loadAsync(BASE + "/lain/" + arquivo + ".glb?v=" + (op.v || Date.now()));
    const o = g.scene;
    o.traverse(function(m){ if (m.isMesh){ m.castShadow = true; m.receiveShadow = true; if (m.material){ if (m.material.map) m.material.map.colorSpace = THREE.SRGBColorSpace; ["map", "normalMap", "metalnessMap", "roughnessMap"].forEach(function(k){ if (m.material[k]) m.material[k].anisotropy = op.anisotropia || 8; }); } } });
    /* normaliza: maior lado = 1 m, centro em (0,0), pes em y = 0 */
    const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
    o.scale.setScalar(1 / Math.max(0.001, sz.x, sz.y, sz.z));
    const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -b2.min.y, -c.z); o.updateMatrixWorld(true);
    /* o VIDRO: se o JSON ja traz a tela deste modelo (medida na malha de edicao,
       em alta), usa ela -- a malha publica leve e outra e a deteccao nela virava
       os monitores e desalinhava a TV (Michel viu). Senao detecta e guarda. */
    const guardada = cfg.telas && cfg.telas[arquivo];
    const tela = guardada ? {centro: new THREE.Vector3().fromArray(guardada.centro), normal: new THREE.Vector3(guardada.normal[0], 0, guardada.normal[1]).normalize(), largura: guardada.largura, altura: guardada.altura, saliencia: guardada.saliencia || 0} : acharTela(o);
    modelos[arquivo] = {cena: o, tam: new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), tela: tela};
    return modelos[arquivo];
  }
  /* vidro do monitor: maior grupo de triangulos escuros quase verticais numa
     mesma direcao (no espaco do modelo normalizado) */
  function acharTela(raiz){
    let melhor = null;
    raiz.updateMatrixWorld(true);
    raiz.traverse(function(m){
      if (!m.isMesh || !m.geometry.attributes.position) return;
      const geo = m.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
      let px = null, W = 0, H = 0;
      const tex = m.material && m.material.map && m.material.map.image;
      if (tex && uv){ try { const cv = document.createElement("canvas"); W = cv.width = 512; H = cv.height = 512; const x = cv.getContext("2d"); x.drawImage(tex, 0, 0, W, H); px = x.getImageData(0, 0, W, H).data; } catch (e){ px = null; } }
      const nt = idx ? idx.count / 3 : pos.count / 3;
      const bins = {};
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      const mm = m.matrixWorld;                       // raiz esta na identidade: mundo == espaco do modelo
      for (let t = 0; t < nt; t++){
        const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mm); b.fromBufferAttribute(pos, i1).applyMatrix4(mm); c.fromBufferAttribute(pos, i2).applyMatrix4(mm);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const area = n.length() / 2; if (area < 1e-8) continue; n.normalize();
        if (Math.abs(n.y) > 0.35) continue;
        if (px && uv){
          const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3, v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
          const xi = Math.min(W - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * W))), yi = Math.min(H - 1, Math.max(0, Math.floor(((v % 1) + 1) % 1 * H)));
          const k = (yi * W + xi) * 4; const lum = (px[k] * 0.3 + px[k+1] * 0.59 + px[k+2] * 0.11) / 255;
          if (lum > 0.22) continue;
        }
        const setor = Math.round(Math.atan2(n.x, n.z) / (Math.PI / 4));
        const bin = bins[setor] || (bins[setor] = {area: 0, sx: 0, sy: 0, sz: 0, nx: 0, nz: 0, min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9)});
        cen.addVectors(a, b).add(c).multiplyScalar(1 / 3);
        bin.area += area; bin.sx += cen.x * area; bin.sy += cen.y * area; bin.sz += cen.z * area; bin.nx += n.x * area; bin.nz += n.z * area;
        bin.min.min(a).min(b).min(c); bin.max.max(a).max(b).max(c);
      }
      Object.keys(bins).forEach(function(k){ const bn = bins[k]; if (!melhor || bn.area > melhor.area) melhor = bn; });
    });
    if (!melhor || melhor.area < 0.01) return null;                     // modelo normalizado a 1 m: vidro tem > 1 dm2
    const normal = new THREE.Vector3(melhor.nx, 0, melhor.nz).normalize();
    const lado = new THREE.Vector3(-normal.z, 0, normal.x);
    /* SEGUNDA PASSADA: so os triangulos escuros que olham pra mesma direcao do
       vidro; o retangulo sai por PERCENTIS ponderados por area (3%..97%) e nao
       pela caixa toda: a moldura preta da TV e o pe puxavam o centro pra baixo e
       pro lado (a tela saia deslocada, Michel viu). A profundidade e o percentil
       97 ao longo da normal: no CRT abaulado a tela fica na barriga, na TV plana
       fica no painel. */
    const amostras = [];
    raiz.traverse(function(m){
      if (!m.isMesh || !m.geometry.attributes.position) return;
      const geo = m.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
      let px = null, W = 0, H = 0;
      const tex = m.material && m.material.map && m.material.map.image;
      if (tex && uv){ try { const cv = document.createElement("canvas"); W = cv.width = 512; H = cv.height = 512; const x = cv.getContext("2d"); x.drawImage(tex, 0, 0, W, H); px = x.getImageData(0, 0, W, H).data; } catch (e){ px = null; } }
      const nt = idx ? idx.count / 3 : pos.count / 3, mm = m.matrixWorld;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (let t = 0; t < nt; t++){
        const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mm); b.fromBufferAttribute(pos, i1).applyMatrix4(mm); c.fromBufferAttribute(pos, i2).applyMatrix4(mm);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const area = n.length() / 2; if (area < 1e-8) continue; n.normalize();
        if (Math.abs(n.y) > 0.35 || n.dot(normal) < 0.8) continue;
        let escuro = true;
        if (px && uv){
          const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3, v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
          const xi = Math.min(W - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * W))), yi = Math.min(H - 1, Math.max(0, Math.floor(((v % 1) + 1) % 1 * H)));
          const k = (yi * W + xi) * 4; const lum = (px[k] * 0.3 + px[k+1] * 0.59 + px[k+2] * 0.11) / 255;
          escuro = lum <= 0.22;
        }
        cen.addVectors(a, b).add(c).multiplyScalar(1 / 3);
        amostras.push({l: cen.x * lado.x + cen.z * lado.z, y: cen.y, p: cen.x * normal.x + cen.z * normal.z, area: area, escuro: escuro});
      }
    });
    if (amostras.filter(function(x){ return x.escuro; }).length < 3) return null;
    const perc = function(chave, q, filtro){
      const arr = amostras.filter(filtro || function(x){ return x.escuro; }).sort(function(u, w){ return u[chave] - w[chave]; });
      let total = 0; arr.forEach(function(x){ total += x.area; });
      let acc = 0; for (let i = 0; i < arr.length; i++){ acc += arr[i].area; if (acc >= total * q) return arr[i][chave]; }
      return arr[arr.length - 1][chave];
    };
    const l0 = perc("l", 0.03), l1 = perc("l", 0.97), y0 = perc("y", 0.03), y1 = perc("y", 0.97);
    /* profundidade: TODOS os triangulos dentro do retangulo (o miolo do vidro do
       CRT e claro na textura -- o reflexo -- e e justamente a barriga) */
    const prof = perc("p", 0.97, function(x){ return x.l >= l0 && x.l <= l1 && x.y >= y0 && x.y <= y1; });
    const centro = new THREE.Vector3().addScaledVector(lado, (l0 + l1) / 2).addScaledVector(normal, prof); centro.y = (y0 + y1) / 2;
    return {centro: centro, normal: normal, saliencia: 0, largura: (l1 - l0) * 0.94, altura: (y1 - y0) * 0.92};
  }

  /* --------------------------------------------------------------- pecas */
  est.pecaDe = function(obj){ let o = obj; while (o){ if (o.userData && o.userData.peca) return o.userData.peca; o = o.parent; } return null; };
  function aplicar(p){
    /* escala (tamanho = maior lado), rotacao (correcao do modelo + giro), posicao (x, altura assentada + dy, z) */
    p.obj.scale.setScalar(p.tamanho);
    p.obj.rotation.y = p.frenteAuto + p.giro;
    p.obj.position.set(p.x, (p.y == null ? pisoY : p.y) + p.dy, p.z);   // p.y = altura absoluta da base (assentada)
    p.obj.updateMatrixWorld(true);
    p.tam = new THREE.Box3().setFromObject(p.obj).getSize(new THREE.Vector3());
  }
  /* quem esta EM CIMA de p: cada peca lembra em que peca assentou (p.sobre = id);
     a pilha inteira, recursivo. Nao depende de altura, entao escalar/girar a
     peca de baixo nao perde a pilha. */
  function dependentes(p){
    const out = [], fila = [p];
    while (fila.length){
      const a = fila.pop();
      est.pecas.forEach(function(q){ if (q !== p && out.indexOf(q) < 0 && q.sobre === a.id){ out.push(q); fila.push(q); } });
    }
    return out;
  }
  function assentar(p, candidatos){
    /* assenta na superficie MAIS ALTA embaixo do centro da peca (raio de cima),
       ignorando o que esta empilhado em cima dela mesma; senao o chao.
       candidatos: no carregamento, so as pecas ANTERIORES na lista (a mesa e a
       primeira e nunca sobe em nada -- sem isso ela assentava num monitor que
       estava em cima dela e "levitava") */
    const dep = dependentes(p);
    const alvos = (candidatos || est.pecas).filter(function(q){ return q !== p && q.obj && dep.indexOf(q) < 0; }).map(function(q){ return q.obj; });
    let y = pisoY;
    if (alvos.length){
      ray.set(new THREE.Vector3(p.x, pisoY + 5, p.z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObjects(alvos, true).filter(function(h){ return !h.object.userData.tela && h.object.name !== "luz-tela"; });
      if (hits.length && hits[0].point.y > y){ y = hits[0].point.y; const q = est.pecaDe(hits[0].object); p.sobre = q ? q.id : null; } else p.sobre = null;
    } else p.sobre = null;
    p.obj.position.y = y + p.dy; p.obj.updateMatrixWorld(true);
    p.y = y;
    return y;
  }
  async function criar(e){
    const m = await modelo(e.arquivo);
    const raiz = new THREE.Group(); raiz.name = "peca-" + e.arquivo; raiz.add(m.cena.clone(true));
    const p = {id: e.id || ("p" + (++est.seq)), arquivo: e.arquivo, papel: e.papel || papelDe(e.arquivo), tamanho: e.tamanho || 1, x: e.x || 0, z: e.z || 0, dy: e.dy || 0, giro: e.giro || 0,
               tela: e.tela, cor: e.cor, obj: raiz, frenteAuto: 0, telaLocal: null, y: null};
    raiz.userData.peca = p;
    if (p.papel === "monitor" && m.tela){ p.frenteAuto = -Math.atan2(m.tela.normal.x, m.tela.normal.z) + Math.PI; p.telaLocal = m.tela; }
    cena.add(raiz);
    aplicar(p);
    est.pecas.push(p);
    const n = parseInt(p.id.replace(/\D/g, ""), 10); if (n > est.seq) est.seq = n;
    if (p.telaLocal && est.telas) est.telas.nova({pai: raiz, centro: p.telaLocal.centro, normal: p.telaLocal.normal, saliencia: p.telaLocal.saliencia, largura: p.telaLocal.largura, altura: p.telaLocal.altura, tipo: p.tela || "terminal", cor: parseInt(p.cor || "9fe8b0", 16)});
    return p;
  }
  /* ordem de carga: tudo, depois assenta em ordem de altura (mesa antes do monitor) */
  for (const e of cfg.pecas){ try { await criar(e); } catch (err){ console.warn("peca da lain faltando:", e.arquivo, err.message || err); } }
  /* quem vem depois na lista pode sentar em quem veio antes (a gravacao ordena
     pelo "sobre": o apoio sempre antes do apoiado) */
  est.pecas.forEach(function(p, i){ assentar(p, est.pecas.slice(0, i)); });

  /* ------------------------------------------------------------- editor */
  est.selecionaveis = function(){ return est.pecas.map(function(p){ return p.obj; }); };
  est.adicionar = async function(arquivo, perto){
    const papel = papelDe(arquivo);
    const p = await criar({arquivo: arquivo, papel: papel, tamanho: TAMANHO_POR_NOME[arquivo] || TAMANHO_INICIAL[papel] || 0.5, x: perto ? perto.x : 0, z: perto ? perto.z : 0, giro: 0, tela: papel === "monitor" ? "terminal" : undefined});
    assentar(p); return p;
  };
  est.duplicar = async function(id){
    const q = est.pecas.find(function(p){ return p.id === id; }); if (!q) return null;
    const p = await criar({arquivo: q.arquivo, papel: q.papel, tamanho: q.tamanho, x: q.x + 0.35, z: q.z + 0.2, dy: q.dy, giro: q.giro, tela: q.tela, cor: q.cor});
    assentar(p); return p;
  };
  est.remover = function(id){
    const i = est.pecas.findIndex(function(p){ return p.id === id; }); if (i < 0) return;
    const p = est.pecas[i], dep = dependentes(p); cena.remove(p.obj); if (est.telas) est.telas.tirar(p.obj); est.pecas.splice(i, 1); dep.forEach(assentar);
  };
  est.mover = function(id, x, z){
    const p = est.pecas.find(function(q){ return q.id === id; }); if (!p) return;
    const dep = dependentes(p), dx = x - p.x, dz = z - p.z;
    p.x = x; p.z = z; aplicar(p); assentar(p);
    dep.forEach(function(q){ q.x += dx; q.z += dz; aplicar(q); });
    dep.forEach(assentar);
  };
  /* girar/escalar/subir: a pilha em cima re-assenta no topo novo */
  est.girar = function(id, d){ const p = est.pecas.find(function(q){ return q.id === id; }); if (!p) return; const dep = dependentes(p); p.giro += d; aplicar(p); assentar(p); dep.forEach(assentar); };
  est.escalar = function(id, f){ const p = est.pecas.find(function(q){ return q.id === id; }); if (!p) return; const dep = dependentes(p); p.tamanho = Math.max(0.02, p.tamanho * f); aplicar(p); assentar(p); dep.forEach(assentar); };
  est.subir = function(id, d){ const p = est.pecas.find(function(q){ return q.id === id; }); if (!p) return; const dep = dependentes(p); p.dy = +(p.dy + d).toFixed(3); aplicar(p); assentar(p); dep.forEach(assentar); };
  est.mudarPapel = function(id, papel){ const p = est.pecas.find(function(q){ return q.id === id; }); if (p) p.papel = papel; };
  est.assentar = function(id){ const p = est.pecas.find(function(q){ return q.id === id; }); if (p) assentar(p); };
  est.assentarTudo = function(){ est.pecas.forEach(assentar); };
  est.serializar = function(){
    const ordem = []; const feitos = {};
    for (let passe = 0; passe < 50 && ordem.length < est.pecas.length; passe++)
      est.pecas.forEach(function(p){ if (feitos[p.id]) return; if (!p.sobre || feitos[p.sobre] || !est.pecas.some(function(q){ return q.id === p.sobre; })){ ordem.push(p); feitos[p.id] = true; } });
    est.pecas.forEach(function(p){ if (!feitos[p.id]) ordem.push(p); });
    const telas = Object.assign({}, cfg.telas || {});
    Object.keys(modelos).forEach(function(a){ const t = modelos[a].tela; if (t) telas[a] = {centro: [+t.centro.x.toFixed(4), +t.centro.y.toFixed(4), +t.centro.z.toFixed(4)], normal: [+t.normal.x.toFixed(4), +t.normal.z.toFixed(4)], largura: +t.largura.toFixed(4), altura: +t.altura.toFixed(4), saliencia: +(t.saliencia || 0).toFixed(4)}; });
    return {_: cfg._, versao: 2, cabosChao: cfg.cabosChao !== false, tubos: cfg.tubos !== false, telas: telas,
      pecas: ordem.map(function(p){ const e = {id: p.id, arquivo: p.arquivo, papel: p.papel, tamanho: +p.tamanho.toFixed(3), x: +p.x.toFixed(3), z: +p.z.toFixed(3), dy: p.dy, giro: +p.giro.toFixed(4), sobre: p.sobre || null}; if (p.papel === "monitor"){ e.tela = p.tela || "terminal"; e.cor = p.cor || "9fe8b0"; } return e; })};
  };
  /* pro motor dela: mesa e cadeira pelo prefixo; o resto como movel (pegada) */
  est.postos = function(){
    const out = [];
    est.pecas.forEach(function(p){
      if (p.papel === "mesa") out.push({pasta: "lain", arquivo: "26-mesa-lain", obj: p.obj, giro: p.obj.rotation.y, peca: p});
      else if (p.papel === "cadeira") out.push({pasta: "lain", arquivo: "27-cadeira-lain", obj: p.obj, giro: p.obj.rotation.y, peca: p});
      else if (p.papel === "cama") out.push({pasta: "lain", arquivo: "22-cama-lain", obj: p.obj, giro: p.obj.rotation.y, peca: p});
      else if (p.papel === "sofa") out.push({pasta: "lain", arquivo: "07-sofa-lain", obj: p.obj, giro: p.obj.rotation.y, peca: p});
      else if (/^tv/.test(p.arquivo)) out.push({pasta: "moveis", arquivo: "10-tv-lain", obj: p.obj, giro: p.obj.rotation.y, peca: p});   // o sofa olha pra TV
      else if (p.y <= pisoY + 0.01 || /^(halter|pikachu)/.test(p.arquivo)) out.push({pasta: "moveis", arquivo: "9x-" + p.arquivo, obj: p.obj, giro: p.obj.rotation.y, peca: p});   // objetos de interacao entram mesmo em cima de algo
    });
    return out;
  };
  /* cabos de chao entre as maquinas e a mesa, e tubos entre navi e rack */
  est.cabos = function(){
    const mesa = est.pecas.find(function(p){ return p.papel === "mesa"; }), rack = est.pecas.find(function(p){ return p.papel === "rack"; }), navi = est.pecas.find(function(p){ return p.papel === "navi"; });
    const chao = [], tubos = [];
    if (mesa && cfg.cabosChao !== false){
      [rack, navi].forEach(function(m){ if (m) chao.push({de: new THREE.Vector3(m.x, 0, m.z), ate: new THREE.Vector3(mesa.x + (m.x - mesa.x) * 0.25, 0, mesa.z + (m.z - mesa.z) * 0.25), n: 2}); });
    }
    if (rack && navi && cfg.tubos !== false){
      const meio = new THREE.Vector3((rack.x + navi.x) / 2, 0.12, (rack.z + navi.z) / 2);
      tubos.push({pts: [new THREE.Vector3(navi.x, 0.45, navi.z), new THREE.Vector3(navi.x + (meio.x - navi.x) * 0.5, 0.15, navi.z + (meio.z - navi.z) * 0.5), meio, new THREE.Vector3(rack.x + (meio.x - rack.x) * 0.5, 0.15, rack.z + (meio.z - rack.z) * 0.5), new THREE.Vector3(rack.x, 0.45, rack.z)], raio: 0.02, cor: 0x66f0ff});
    }
    return {chao: chao, tubos: tubos, pisoY: pisoY, raioMin: 0.003, raioMax: 0.005};
  };
  est.ligarTelas = function(T){
    est.telas = T;
    est.pecas.forEach(function(p){ if (p.telaLocal) T.nova({pai: p.obj, centro: p.telaLocal.centro, normal: p.telaLocal.normal, saliencia: p.telaLocal.saliencia, largura: p.telaLocal.largura, altura: p.telaLocal.altura, tipo: p.tela || "terminal", cor: parseInt(p.cor || "9fe8b0", 16)}); });
  };
  return est;
}
