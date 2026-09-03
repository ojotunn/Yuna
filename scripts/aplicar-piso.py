# -*- coding: utf-8 -*-
"""LE A FOLHA QUE O MICHEL PINTOU E VIRA A MASCARA DO CHAO.

Ele pinta em quarto/casa/PISO-MARCAR.png: branco onde ela anda, escuro onde
nao anda. Aqui vira preto-e-branco puro, do jeito que o motor espera, e sai
uma prova visual pra conferir antes de valer.

    python scripts/aplicar-piso.py
"""
import os
import numpy as np
from PIL import Image

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = os.path.join(AQUI, "quarto", "casa")

folha = np.array(Image.open(os.path.join(C, "PISO-MARCAR.png")).convert("RGB")).astype(int)
# BRANCO e o que ele pintou: claro nos tres canais e sem cor dominante.
lum = folha.mean(axis=2)
sat = folha.max(axis=2) - folha.min(axis=2)
piso = (lum > 150) & (sat < 60)

Image.fromarray((piso * 255).astype(np.uint8), "L").save(os.path.join(C, "piso-casa.png"))

casa = np.array(Image.open(os.path.join(C, "CASA-VAZIA.png")).convert("RGB")).astype(int)
casa[piso] = (casa[piso] * 0.4 + np.array([40, 230, 120]) * 0.6).astype(int)
Image.fromarray(casa.astype(np.uint8)).save(os.path.join(C, "piso-prova.png"))

print("  piso-casa.png gravado — %.1f%% pisavel" % (100 * piso.mean()))
print("  confira em quarto/casa/piso-prova.png (verde = onde ela anda)")
