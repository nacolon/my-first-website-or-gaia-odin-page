#!/bin/sh
# Prepara la carpeta outs-of-space-site/ para subirla a Cloudflare Pages.
# El juego queda en /juego/ y _worker.js atiende el ranking mundial en /api/scores.
set -e
cd "$(dirname "$0")"
rm -rf outs-of-space-site/juego
mkdir -p outs-of-space-site/juego
sed 's|<a class="back" href="index.html">← Volver a Nacolon'"'"'s World</a>|<a class="back" href="/">← Volver a Outs of Space</a>|' game.html > outs-of-space-site/juego/index.html
cp -r assets outs-of-space-site/juego/assets
rm -f outs-of-space-site/juego/assets/alien.jpg outs-of-space-site/juego/assets/gaia.jpg outs-of-space-site/juego/assets/gaia-meteors.jpg
echo "Listo: outs-of-space-site/"
