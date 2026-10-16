# Repositorio de Nacolon / CodeOfOdin

- `index.html`: página personal.
- `estudio/`: estudio de imágenes y video. Lee `estudio/README.md` antes de usarlo.

## Cuando el usuario pida imágenes o un video

1. `cd estudio && npm install` (si falta `node_modules`).
2. Crea una carpeta por proyecto en `estudio/proyectos/<nombre>/` con su `proyecto.json`
   y copia allí las fotos, logos o audio que vayas a usar.
3. Ejecuta `node estudio.mjs proyectos/<nombre>/proyecto.json --solo-imagenes` y **mira**
   `salida/hoja-de-contacto.jpg` (y los PNG que haga falta) para revisar legibilidad,
   cortes y contraste. Corrige y repite; usa `--escena N` para iterar en una sola escena.
4. Cuando las imágenes estén bien, genera el video sin `--solo-imagenes`, revisa algunos
   cuadros con `ffmpeg -ss <segundo> -i video.mp4 -frames:v 1 cuadro.jpg` y entrega el MP4.

Identidad visual de CodeOfOdin: fondo carbón (#1e1f26 → #3b3f51), beige/pergamino
(#e3cba8), acento menta (#66ffcc) y azul (#99ccff); logo en `estudio/ejemplos/demo/logo-codeofodin.png`.
Textos en español.
