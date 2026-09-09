/* CLIPES NO CORPO VRM: retarget de animacoes feitas em OUTRO esqueleto (o rig
   do Meshy de 24 ossos, e depois os FBX do Mixamo) pro humanoid do VRM.

   Metodo (o mesmo do exemplo loadMixamoAnimation do three-vrm): o humanoid
   "normalizado" do three-vrm e um esqueleto em T-pose com rotacao de repouso
   IDENTIDADE em todo osso. Entao, pra cada osso da fonte, a rotacao local do
   clipe e levada pro espaco do mundo com a pose de repouso da fonte:
       q' = repousoMundo(pai) * q * inverso(repousoMundo(osso))
   e aplicada direto no osso normalizado. Funciona pra qualquer fonte cujo
   repouso seja T-pose, sem se importar com o "roll" de cada osso.
   So o Hips leva translacao (escalada pela altura dos quadris); os outros
   ossos ficam com os comprimentos do VRM.

   Depois do retarget: tira trilhas de escala, recorta o que nao serve
   (RECORTES) e poe os pes no chao (o ponto mais baixo dos dedos do pe ao
   longo do clipe vai pra altura de repouso). */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/* rig do Meshy (nomes tipo Mixamo, hierarquia Hips > Spine02 > Spine01 > Spine > neck > Head) */
export const MAPA_MESHY = {
  Hips: "hips", Spine02: "spine", Spine01: "chest", Spine: "upperChest", neck: "neck", Head: "head",
  LeftShoulder: "leftShoulder", LeftArm: "leftUpperArm", LeftForeArm: "leftLowerArm", LeftHand: "leftHand",
  RightShoulder: "rightShoulder", RightArm: "rightUpperArm", RightForeArm: "rightLowerArm", RightHand: "rightHand",
  LeftUpLeg: "leftUpperLeg", LeftLeg: "leftLowerLeg", LeftFoot: "leftFoot", LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg", RightLeg: "rightLowerLeg", RightFoot: "rightFoot", RightToeBase: "rightToes"
};
/* Mixamo (FBX "without skin"): mixamorig prefixo, nomes iguais aos do Meshy salvo a coluna e o pescoco */
export const MAPA_MIXAMO = {
  mixamorigHips: "hips", mixamorigSpine: "spine", mixamorigSpine1: "chest", mixamorigSpine2: "upperChest", mixamorigNeck: "neck", mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder", mixamorigLeftArm: "leftUpperArm", mixamorigLeftForeArm: "leftLowerArm", mixamorigLeftHand: "leftHand",
  mixamorigRightShoulder: "rightShoulder", mixamorigRightArm: "rightUpperArm", mixamorigRightForeArm: "rightLowerArm", mixamorigRightHand: "rightHand",
  mixamorigLeftUpLeg: "leftUpperLeg", mixamorigLeftLeg: "leftLowerLeg", mixamorigLeftFoot: "leftFoot", mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg", mixamorigRightLeg: "rightLowerLeg", mixamorigRightFoot: "rightFoot", mixamorigRightToeBase: "rightToes",
  mixamorigLeftHandThumb1: "leftThumbMetacarpal", mixamorigLeftHandThumb2: "leftThumbProximal", mixamorigLeftHandThumb3: "leftThumbDistal",
  mixamorigLeftHandIndex1: "leftIndexProximal", mixamorigLeftHandIndex2: "leftIndexIntermediate", mixamorigLeftHandIndex3: "leftIndexDistal",
  mixamorigLeftHandMiddle1: "leftMiddleProximal", mixamorigLeftHandMiddle2: "leftMiddleIntermediate", mixamorigLeftHandMiddle3: "leftMiddleDistal",
  mixamorigLeftHandRing1: "leftRingProximal", mixamorigLeftHandRing2: "leftRingIntermediate", mixamorigLeftHandRing3: "leftRingDistal",
  mixamorigLeftHandPinky1: "leftLittleProximal", mixamorigLeftHandPinky2: "leftLittleIntermediate", mixamorigLeftHandPinky3: "leftLittleDistal",
  mixamorigRightHandThumb1: "rightThumbMetacarpal", mixamorigRightHandThumb2: "rightThumbProximal", mixamorigRightHandThumb3: "rightThumbDistal",
  mixamorigRightHandIndex1: "rightIndexProximal", mixamorigRightHandIndex2: "rightIndexIntermediate", mixamorigRightHandIndex3: "rightIndexDistal",
  mixamorigRightHandMiddle1: "rightMiddleProximal", mixamorigRightHandMiddle2: "rightMiddleIntermediate", mixamorigRightHandMiddle3: "rightMiddleDistal",
  mixamorigRightHandRing1: "rightRingProximal", mixamorigRightHandRing2: "rightRingIntermediate", mixamorigRightHandRing3: "rightRingDistal",
  mixamorigRightHandPinky1: "rightLittleProximal", mixamorigRightHandPinky2: "rightLittleIntermediate", mixamorigRightHandPinky3: "rightLittleDistal"
};
/* pedacos de clipe que nao servem (fracao do comeco e do fim): o texto-para-
   movimento do Meshy volta pra pose inicial no ultimo quadro; o sit_down da
   biblioteca fica parado 30% antes de sentar */
export const RECORTES = {sit_down: [0.30, 1.0], sentar_reto: [0, 0.9], get_in_bed: [0, 0.9], halteres: [0.05, 0.92], pet_pikachu: [0, 0.92], subir_pernas: [0, 0.9], sofa_deitada: [0.04, 0.92], deitar_lado: [0, 0.9], dormir_lado: [0.04, 0.92]};
/* clipes que tambem existem AO CONTRARIO (a volta de uma transicao): nome -> nome do invertido */
export const INVERTIDOS = {subir_pernas: "descer_pernas", deitar_lado: "levantar_lado"};
/* clipes que tambem existem ESPELHADOS (esquerda <-> direita): o Meshy deita a
   moca pra UM lado dela; espelhado, ela deita pro outro, e a cama pode ser
   abordada por qualquer beira com a cabeca no travesseiro. Espelho no plano
   x = 0 do rig normalizado (repouso identidade, esqueleto simetrico): troca as
   trilhas dos ossos Left/Right, quaternion (x, y, z, w) -> (x, -y, -z, w),
   posicao x -> -x. */
export const ESPELHADOS = {deitar_lado: "deitar_lado_esp", dormir_lado: "dormir_lado_esp"};
export function espelhar(clip, nome, vrm){
  const troca = {};
  ["UpperLeg", "LowerLeg", "Foot", "Toes", "Shoulder", "UpperArm", "LowerArm", "Hand", "Eye",
   "ThumbMetacarpal", "ThumbProximal", "ThumbDistal", "IndexProximal", "IndexIntermediate", "IndexDistal", "MiddleProximal", "MiddleIntermediate", "MiddleDistal",
   "RingProximal", "RingIntermediate", "RingDistal", "LittleProximal", "LittleIntermediate", "LittleDistal"].forEach(function(b){
    const L = vrm.humanoid.getNormalizedBoneNode("left" + b), R = vrm.humanoid.getNormalizedBoneNode("right" + b);
    if (L && R){ troca[L.name] = R.name; troca[R.name] = L.name; }
  });
  const trilhas = clip.tracks.map(function(t){
    const m = t.name.match(/^(.*)\.(quaternion|position)$/); if (!m) return t.clone();
    const no = troca[m[1]] || m[1], vals = new Float32Array(t.values);
    if (m[2] === "quaternion") for (let i = 0; i < vals.length; i += 4){ vals[i + 1] = -vals[i + 1]; vals[i + 2] = -vals[i + 2]; }
    else for (let i = 0; i < vals.length; i += 3) vals[i] = -vals[i];
    return new t.constructor(no + "." + m[2], t.times.slice(), vals);
  });
  const c = new THREE.AnimationClip(nome, clip.duration, trilhas); c.userData = Object.assign({}, clip.userData || {}); return c;
}
/* LIMITE DE ROTACAO por osso (graus, em relacao ao repouso): o texto-para-
   movimento do Meshy deitou a moca com o pescoco dobrado 75-84 graus (queixo
   no peito, a cara virada pra propria barriga -- Michel: "olha como ta a
   cabeca dela no sofa"); o subir_pernas vem com 34-52. Nos ossos normalizados
   do VRM o repouso e identidade, entao a trilha ja e a rotacao relativa: se
   passa do limite, encolhe o angulo mantendo o eixo. */
export const LIMITES = {sofa_deitada: {neck: 18, head: 22}, subir_pernas: {neck: 25, head: 30},
                        deitar_lado: {neck: 25, head: 30}, dormir_lado: {neck: 15, head: 20}};   // dormir_lado veio com o pescoco a 118 graus
export function limitar(clip, limites, vrm){
  Object.keys(limites).forEach(function(osso){
    const no = vrm.humanoid.getNormalizedBoneNode(osso); if (!no) return;
    const tr = clip.tracks.find(function(t){ return t.name === no.name + ".quaternion"; }); if (!tr) return;
    const max = limites[osso] * Math.PI / 180, a = tr.values;
    for (let i = 0; i < a.length; i += 4){
      const w = Math.max(-1, Math.min(1, a[i + 3])), ang = 2 * Math.acos(Math.abs(w));
      if (ang <= max) continue;
      const sv = Math.sqrt(Math.max(1e-12, 1 - w * w)), k = Math.sin(max / 2) / sv;
      a[i] *= k; a[i + 1] *= k; a[i + 2] *= k; a[i + 3] = Math.sign(w || 1) * Math.cos(max / 2);
    }
  });
  return clip;
}
export function inverter(clip, nome){
  const trilhas = clip.tracks.map(function(t){
    const n = t.times.length, k = t.getValueSize(), times = new Float32Array(n), vals = new Float32Array(t.values.length);
    for (let i = 0; i < n; i++){ times[i] = clip.duration - t.times[n - 1 - i]; for (let j = 0; j < k; j++) vals[i * k + j] = t.values[(n - 1 - i) * k + j]; }
    return new t.constructor(t.name, times, vals);
  });
  return new THREE.AnimationClip(nome, clip.duration, trilhas);
}
/* clipes em que ela NAO toca o chao com os pes (cama, chao): sem correcao de chao */
const SEM_CHAO = {sleep: 1, lie_down: 1, wake_up: 1, sit_floor: 1, get_in_bed: 1, get_out_of_bed: 1};

/* retarget de um clipe da `fonte` (Object3D em pose de repouso T) pro vrm */
export function retargetar(clip, fonte, vrm, mapa, opcoes){
  opcoes = opcoes || {};
  const restInv = new THREE.Quaternion(), paiRest = new THREE.Quaternion(), q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const nomeHips = Object.keys(mapa).find(function(k){ return mapa[k] === "hips"; });
  const hipsFonte = fonte.getObjectByName(nomeHips);
  /* altura dos quadris na fonte (unidade da fonte) vs no VRM (m): escala da translacao */
  const alturaFonte = hipsFonte ? hipsFonte.position.y : 1;
  const hipsVrm = vrm.humanoid.getNormalizedBoneNode("hips");
  const alturaVrm = Math.abs(hipsVrm.getWorldPosition(v).y - vrm.scene.getWorldPosition(new THREE.Vector3()).y);
  const escalaPos = opcoes.escalaPos != null ? opcoes.escalaPos : (alturaVrm / Math.max(1e-6, Math.abs(alturaFonte)));
  const trilhas = [];
  clip.tracks.forEach(function(t){
    const partes = t.name.split("."); const osso = partes[0], prop = partes[1];
    const nomeVrm = mapa[osso]; if (!nomeVrm) return;
    const no = vrm.humanoid.getNormalizedBoneNode(nomeVrm); if (!no) return;
    const noFonte = fonte.getObjectByName(osso); if (!noFonte) return;
    if (t instanceof THREE.QuaternionKeyframeTrack){
      noFonte.getWorldQuaternion(restInv).invert();
      noFonte.parent.getWorldQuaternion(paiRest);
      const vals = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 4){
        q.fromArray(t.values, i).premultiply(paiRest).multiply(restInv);
        q.toArray(vals, i);
      }
      trilhas.push(new THREE.QuaternionKeyframeTrack(no.name + ".quaternion", t.times, vals));
    } else if (t instanceof THREE.VectorKeyframeTrack && prop === "position" && nomeVrm === "hips"){
      const vals = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i++) vals[i] = t.values[i] * escalaPos;
      trilhas.push(new THREE.VectorKeyframeTrack(no.name + ".position", t.times, vals));
    }
    /* escala e posicao dos outros ossos: fora (o VRM tem as proporcoes dele) */
  });
  const novo = new THREE.AnimationClip(clip.name, clip.duration, trilhas);
  return novo;
}

/* recorta o clipe (fracao inicio..fim) a 30 fps */
export function recortar(clip, ini, fim){
  const fps = 30, n = Math.round(clip.duration * fps);
  return THREE.AnimationUtils.subclip(clip, clip.name, Math.round(n * ini), Math.round(n * fim), fps);
}

/* poe os pes no chao: o ponto mais baixo dos dedos ao longo do clipe vai pra
   altura de repouso (a do T-pose). Altera a trilha de posicao do hips. */
export function porNoChao(clips, vrm){
  const toes = ["leftToes", "rightToes"].map(function(n){ return vrm.humanoid.getNormalizedBoneNode(n); }).filter(Boolean);
  if (!toes.length) return [];
  const raiz = vrm.scene; raiz.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const repouso = Math.min.apply(null, toes.map(function(t){ return t.getWorldPosition(v).y - raiz.getWorldPosition(new THREE.Vector3()).y; }));
  const mx = new THREE.AnimationMixer(raiz); const relato = [];
  clips.forEach(function(cl){
    if (SEM_CHAO[cl.name]) return;
    const tr = cl.tracks.find(function(t){ return /\.position$/.test(t.name); }); if (!tr) return;
    const a = mx.clipAction(cl); a.play();
    let minY = 1e9; const n = 24;
    for (let i = 0; i <= n; i++){
      a.time = cl.duration * i / n; mx.update(0); raiz.updateMatrixWorld(true);
      toes.forEach(function(t){ minY = Math.min(minY, t.getWorldPosition(v).y - raiz.getWorldPosition(new THREE.Vector3()).y); });
    }
    a.stop(); mx.uncacheClip(cl);
    const delta = minY - repouso;
    if (Math.abs(delta) < 0.005) return;
    for (let i = 1; i < tr.values.length; i += 3) tr.values[i] -= delta;
    relato.push(cl.name + " " + (delta * 100).toFixed(0) + "cm");
  });
  mx.stopAllAction();
  /* deixa o humanoid de volta no repouso */
  vrm.humanoid.resetNormalizedPose();
  return relato;
}

/* carrega o GLB do rig do Meshy (com os 33 clipes) e devolve os clipes ja
   retargetados, recortados e no chao */
export async function carregarClipesMeshy(vrm, url, aoProgredir){
  const ld = new GLTFLoader(); ld.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await ld.loadAsync(url, aoProgredir);
  const fonte = gltf.scene; fonte.updateMatrixWorld(true);
  const clips = [];
  gltf.animations.forEach(function(cl){
    cl.tracks = cl.tracks.filter(function(t){ return !/\.scale$/.test(t.name); });
    if (cl.duration < 0.2) return;
    let novo = retargetar(cl, fonte, vrm, MAPA_MESHY);
    if (LIMITES[cl.name]) limitar(novo, LIMITES[cl.name], vrm);
    const r = RECORTES[cl.name]; if (r) novo = recortar(novo, r[0], r[1]);
    clips.push(novo);
    if (INVERTIDOS[cl.name]) clips.push(inverter(novo, INVERTIDOS[cl.name]));
    if (ESPELHADOS[cl.name]){
      const e = espelhar(novo, ESPELHADOS[cl.name], vrm); clips.push(e);
      if (INVERTIDOS[cl.name]) clips.push(inverter(e, INVERTIDOS[cl.name] + "_esp"));
    }
  });
  /* sem creditos pro clipe "sofa_deitada" (loop relaxada): derivo do fim do
     subir_pernas -- o ultimo trecho, tocado em vai-e-vem (LoopPingPong no motor) */
  if (!clips.some(function(c){ return c.name === "sofa_deitada"; })){
    const sp = clips.find(function(c){ return c.name === "subir_pernas"; });
    if (sp){ const d = recortar(sp, 0.78, 1.0); d.name = "sofa_deitada"; clips.push(d); }
  }
  const chao = porNoChao(clips, vrm);
  return {clips: clips, chao: chao, fonte: fonte};
}
