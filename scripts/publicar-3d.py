# -*- coding: utf-8 -*-
"""
VERSAO PUBLICA LEVE DO PALCO 3D (pra live no yuna.cam: o navegador de cada
visitante renderiza a cena).

As pecas de edicao ficam em quarto/3d/lain (360 mil triangulos e textura 2048
cada, 15 MB); o publico recebe copias em public/3d/lain com ~90 mil triangulos,
textura 1024 e compressao meshopt (-c). O VRM da Yuna e o rig de clipes tambem
ganham copia leve. estacao.json vai igual (as pecas normalizam por tamanho).

  python scripts/publicar-3d.py            # tudo
  python scripts/publicar-3d.py lain       # so as pecas

Saida em public/3d/{lain,yuna,jiji}/ + public/3d/manifesto.json (tamanhos).
"""
import io, os, sys, json, struct, subprocess, shutil, time
from PIL import Image

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ORIGEM = os.path.join(RAIZ, "quarto", "3d")
DESTINO = os.path.join(RAIZ, "public", "3d")
GLTFPACK = shutil.which("gltfpack") or os.path.join(RAIZ, "node_modules", ".bin", "gltfpack.cmd")
SI_PECA = float(os.environ.get("PUBLICAR_SI", "0.03"))     # fracao de triangulos das pecas
TEX_MAX = int(os.environ.get("PUBLICAR_TEX", "1024"))

def ler_glb(p):
    d = open(p, "rb").read()
    cl, = struct.unpack_from("<I", d, 12); js = json.loads(d[20:20+cl]); bl, = struct.unpack_from("<I", d, 20+cl)
    return js, d[28+cl:28+cl+bl]

def escrever_glb(p, js, bin_):
    j = json.dumps(js, separators=(",", ":")).encode("utf-8")
    while len(j) % 4: j += b" "
    while len(bin_) % 4: bin_ += b"\0"
    total = 12 + 8 + len(j) + 8 + len(bin_)
    with open(p, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, total)); f.write(struct.pack("<I", len(j)) + b"JSON" + j); f.write(struct.pack("<I", len(bin_)) + b"BIN\0" + bin_)

def reduzir_texturas(p, maximo):
    """reescreve as imagens embutidas com no maximo `maximo` px de lado (JPEG q85; PNG fica PNG)"""
    js, bin_ = ler_glb(p)
    if not js.get("images"): return 0
    bvs = js["bufferViews"]; novo = bytearray(); mapa = {}
    # copia todos os bufferViews, trocando os das imagens
    imagens_bv = {im["bufferView"]: i for i, im in enumerate(js["images"]) if "bufferView" in im}
    ganho = 0
    for k, bv in enumerate(bvs):
        ini = bv.get("byteOffset", 0); dados = bin_[ini:ini + bv["byteLength"]]
        if k in imagens_bv:
            im = Image.open(io.BytesIO(dados)); w, h = im.size
            if max(w, h) > maximo:
                f = maximo / max(w, h); im = im.resize((max(1, int(w * f)), max(1, int(h * f))), Image.LANCZOS)
            saida = io.BytesIO(); mime = js["images"][imagens_bv[k]].get("mimeType", "image/jpeg")
            if mime == "image/png": im.save(saida, "PNG", optimize=True)
            else:
                if im.mode not in ("RGB", "L"): im = im.convert("RGB")
                im.save(saida, "JPEG", quality=85, optimize=True)
            novos = saida.getvalue(); ganho += len(dados) - len(novos); dados = novos
        while len(novo) % 4: novo.append(0)
        mapa[k] = (len(novo), len(dados)); novo += dados
    for k, bv in enumerate(bvs): bv["byteOffset"], bv["byteLength"] = mapa[k]
    js["buffers"][0]["byteLength"] = len(novo)
    escrever_glb(p, js, bytes(novo)); return ganho

def tirar_malha(p_in, p_out):
    """rig de clipes: fora a malha (o VRM tem a dela), ficam os nos, o esqueleto e as animacoes"""
    js, bin_ = ler_glb(p_in)
    # acessores usados pelas animacoes + os inverseBindMatrices nao sao necessarios sem a malha
    usados = set()
    for an in js.get("animations", []):
        for sm in an["samplers"]: usados.add(sm["input"]); usados.add(sm["output"])
    for n in js["nodes"]: n.pop("mesh", None); n.pop("skin", None)
    js.pop("meshes", None); js.pop("skins", None); js.pop("materials", None); js.pop("textures", None); js.pop("images", None); js.pop("samplers", None)
    # recompacta so os acessores usados
    acc_novo = {}; bv_novo = []; novo = bytearray()
    for i in sorted(usados):
        a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]
        ini = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]; tam = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[a["componentType"]]
        comp = a["count"] * n * tam; dados = bin_[ini:ini + comp]
        while len(novo) % 4: novo.append(0)
        bv_novo.append({"buffer": 0, "byteOffset": len(novo), "byteLength": comp}); novo += dados
        acc_novo[i] = dict(a); acc_novo[i]["bufferView"] = len(bv_novo) - 1; acc_novo[i].pop("byteOffset", None)
    ordem = sorted(usados); indice = {i: k for k, i in enumerate(ordem)}
    js["accessors"] = [acc_novo[i] for i in ordem]; js["bufferViews"] = bv_novo
    for an in js["animations"]:
        for sm in an["samplers"]: sm["input"] = indice[sm["input"]]; sm["output"] = indice[sm["output"]]
    js["buffers"] = [{"byteLength": len(novo)}]
    escrever_glb(p_out, js, bytes(novo))

def gltfpack(entrada, saida, extra):
    cmd = [GLTFPACK, "-i", entrada, "-o", saida] + extra
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError("gltfpack falhou em %s: %s" % (entrada, r.stderr[-400:]))

def mb(p): return os.path.getsize(p) / 1e6

def publicar_pecas(manifesto):
    src = os.path.join(ORIGEM, "lain"); dst = os.path.join(DESTINO, "lain"); os.makedirs(dst, exist_ok=True)
    for nome in sorted(os.listdir(src)):
        if not nome.endswith(".glb"): continue
        e, s = os.path.join(src, nome), os.path.join(dst, nome); t0 = time.time()
        # textura reduzida ANTES do gltfpack (o GLB meshopt tem bufferViews de fallback e
        # offsets dentro da extensao; reescrever depois corrompia os acessores)
        tmp = s + ".tmp.glb"; shutil.copy(e, tmp); reduzir_texturas(tmp, TEX_MAX)
        gltfpack(tmp, s, ["-si", str(SI_PECA), "-kn", "-c"]); os.remove(tmp)      # quantizado: 3x menor; three le KHR_mesh_quantization
        manifesto["lain/" + nome] = round(mb(s), 2); print("  %-16s %5.1f MB -> %5.1f MB  (%.0fs)" % (nome, mb(e), mb(s), time.time() - t0), flush=True)
    shutil.copy(os.path.join(src, "estacao.json"), os.path.join(dst, "estacao.json"))

def publicar_yuna(manifesto):
    src = os.path.join(ORIGEM, "yuna"); dst = os.path.join(DESTINO, "yuna"); os.makedirs(dst, exist_ok=True)
    vrm = os.path.join(dst, "yuna.vrm"); shutil.copy(os.path.join(src, "yuna.vrm"), vrm)
    ganho = reduzir_texturas(vrm, TEX_MAX); manifesto["yuna/yuna.vrm"] = round(mb(vrm), 2); print("  yuna.vrm textura %d: %.1f MB (menos %.1f MB)" % (TEX_MAX, mb(vrm), ganho / 1e6), flush=True)
    rig = os.path.join(dst, "yuna-rig.glb"); tirar_malha(os.path.join(src, "yuna-rig.glb"), rig)
    manifesto["yuna/yuna-rig.glb"] = round(mb(rig), 2); print("  yuna-rig.glb so clipes: %.1f MB" % mb(rig), flush=True)

def publicar_jiji(manifesto):
    src = os.path.join(ORIGEM, "jiji"); dst = os.path.join(DESTINO, "jiji")
    if not os.path.isdir(src): return
    os.makedirs(dst, exist_ok=True)
    for nome in os.listdir(src):
        if nome.endswith(".glb"):
            s = os.path.join(dst, nome); tmp = s + ".tmp.glb"; shutil.copy(os.path.join(src, nome), tmp); reduzir_texturas(tmp, TEX_MAX)
            gltfpack(tmp, s, ["-kn", "-c"]); os.remove(tmp)
            manifesto["jiji/" + nome] = round(mb(s), 2); print("  jiji/%s %.1f MB" % (nome, mb(s)), flush=True)

if __name__ == "__main__":
    o = sys.argv[1] if len(sys.argv) > 1 else "tudo"
    os.makedirs(DESTINO, exist_ok=True)
    manifesto = {}
    mp = os.path.join(DESTINO, "manifesto.json")
    if os.path.exists(mp): manifesto = json.load(open(mp))
    if o in ("tudo", "lain"): print("pecas (si %.2f, textura %d):" % (SI_PECA, TEX_MAX)); publicar_pecas(manifesto)
    if o in ("tudo", "yuna"): print("yuna:"); publicar_yuna(manifesto)
    if o in ("tudo", "jiji"): print("jiji:"); publicar_jiji(manifesto)
    json.dump(manifesto, open(mp, "w"), indent=1)
    print("total public/3d: %.1f MB" % sum(manifesto.values()))
