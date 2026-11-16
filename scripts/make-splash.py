# Builds the launch screens Apple devices show while the app opens (instead of a white screen),
# then writes the matching <link> tags into web/index.html between the SPLASH markers.
# Run: python3 scripts/make-splash.py
import os, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(WEB, "public", "splash")
BG = (7, 11, 20)  # same as the app background (#070b14)

# (CSS width, CSS height, pixel ratio) in portrait, for iPhones and iPads in use today.
DEVICES = [
    (440, 956, 3), (402, 874, 3), (420, 912, 3), (430, 932, 3), (393, 852, 3), (390, 844, 3), (428, 926, 3),
    (375, 812, 3), (414, 896, 2), (414, 896, 3), (375, 667, 2), (414, 736, 3), (320, 568, 2),
    (1032, 1376, 2), (1024, 1366, 2), (834, 1210, 2), (834, 1194, 2), (820, 1180, 2), (834, 1112, 2),
    (744, 1133, 2), (810, 1080, 2), (768, 1024, 2),
]

def main():
    os.makedirs(OUT, exist_ok=True)
    logo = Image.open(os.path.join(WEB, "public", "icons", "icon-512.png")).convert("RGBA")
    links = []
    for w, h, r in DEVICES:
        for orient in ("portrait", "landscape"):
            pw, ph = (w * r, h * r) if orient == "portrait" else (h * r, w * r)
            name = f"{pw}x{ph}.png"
            img = Image.new("RGB", (pw, ph), BG)
            size = int(min(pw, ph) * 0.24)
            l = logo.resize((size, size), Image.LANCZOS)
            img.paste(l, ((pw - size) // 2, (ph - size) // 2), l)
            img.save(os.path.join(OUT, name), optimize=True)
            links.append(f'    <link rel="apple-touch-startup-image" media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: {orient})" href="%BASE_URL%splash/{name}" />')
    path = os.path.join(WEB, "index.html")
    html = open(path).read()
    block = "    <!-- SPLASH START -->\n" + "\n".join(links) + "\n    <!-- SPLASH END -->"
    html = re.sub(r"    <!-- SPLASH START -->.*?<!-- SPLASH END -->", lambda m: block, html, flags=re.S)
    open(path, "w").write(html)
    print(len(links), "launch screens")

main()
