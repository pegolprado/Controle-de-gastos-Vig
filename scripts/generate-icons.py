#!/usr/bin/env python3
"""Gera ícones do PWA, favicon e logo a partir de assets-src/logo-finance-mv.jpg.

O símbolo é um anel centralizado em (~512, ~511) com raio ~306 px na arte 1024x1024.
- pwa-192/512 e apple-touch-icon: anel ocupando ~90% (o sistema arredonda os cantos)
- pwa-maskable-512: anel dentro da "zona segura" de 80% (Android recorta em círculo/gota)
- favicon.png / favicon-32: recorte justo
- logo-mark.png: disco recortado com fundo transparente, para usar dentro do app
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src' / 'logo-finance-mv.jpg'
PUB = ROOT / 'public'
CX, CY, R = 511.5, 510.5, 306

img = Image.open(SRC).convert('RGB')

def crop_for(ring_fraction: float) -> Image.Image:
    """Recorte quadrado em que o diâmetro do anel ocupa `ring_fraction` do lado."""
    half = R / ring_fraction
    box = (round(CX - half), round(CY - half), round(CX + half), round(CY + half))
    # se o recorte passar da borda, completa com o tom do fundo
    bg = img.getpixel((4, 4))
    canvas = Image.new('RGB', (box[2] - box[0], box[3] - box[1]), bg)
    canvas.paste(img, (-box[0], -box[1]))
    return canvas

def save(im: Image.Image, name: str, size: int):
    im.resize((size, size), Image.LANCZOS).save(PUB / name, optimize=True)
    print('✓', name)

normal = crop_for(0.90)
save(normal, 'pwa-192.png', 192)
save(normal, 'pwa-512.png', 512)
save(normal, 'apple-touch-icon.png', 180)
maskable = crop_for(0.72)
save(maskable, 'pwa-maskable-512.png', 512)
tight = crop_for(0.98)
save(tight, 'favicon.png', 64)
save(tight, 'favicon-32.png', 32)

# logo para a interface: disco com fundo transparente
disc = crop_for(0.985).resize((512, 512), Image.LANCZOS).convert('RGBA')
mask = Image.new('L', (512 * 4, 512 * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, 512 * 4 - 1, 512 * 4 - 1), fill=255)
disc.putalpha(mask.resize((512, 512), Image.LANCZOS))
disc.resize((256, 256), Image.LANCZOS).save(PUB / 'logo-mark.png', optimize=True)
print('✓ logo-mark.png')
