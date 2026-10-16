# Estudio de imágenes y video

Tu propio "Adobe Express" controlado por texto. Describes cada imagen (escena) en un
archivo `proyecto.json`; el estudio la dibuja con Chromium, la exporta a PNG y luego une
todas las escenas en un video MP4 con movimiento, transiciones y música.

Está pensado para que Claude lo use: tú le pides el video, Claude escribe el
`proyecto.json`, lo ejecuta, revisa las imágenes y te entrega el resultado.

## Instalación (una vez por máquina o sesión)

Necesita Node.js 18+ y `ffmpeg`.

```bash
cd estudio
npm install
```

## Uso

```bash
node estudio.mjs ruta/proyecto.json                 # imágenes + video
node estudio.mjs ruta/proyecto.json --solo-imagenes # solo PNG
node estudio.mjs ruta/proyecto.json --escena 3      # solo la escena 3 (vista previa rápida)
node estudio.mjs ruta/proyecto.json --salida otra/carpeta
```

Resultado en `ruta/salida/`:

- `escena-01-<nombre>.png`, … : cada imagen al tamaño final
- `hoja-de-contacto.jpg` : todas las escenas en miniatura, para revisarlas de un vistazo
- `video.mp4` : el video (H.264, listo para YouTube, Reels o TikTok)

Las rutas de imágenes y audio son relativas a la carpeta del `proyecto.json`.

Ejemplo completo: `ejemplos/demo/proyecto.json` (`npm run demo`).

## Formato del proyecto

```jsonc
{
  "formato": "youtube",      // youtube 1920x1080 · miniatura 1280x720 · reels/tiktok/shorts/historia 1080x1920
                             // cuadrado 1080x1080 · vertical 1080x1350 · o [ancho, alto]
  "fps": 30,
  "duracion": 4,             // segundos por escena (cada escena puede cambiarlo)
  "movimiento": "zoom-in",   // movimiento por defecto (ver abajo)
  "intensidad": 0.08,        // cuánto zoom/paneo (0.08 = 8 %)
  "transicion": { "tipo": "fundido", "duracion": 0.6 },
  "fundidos": true,          // fundido desde/hacia negro al inicio y al final
  "audio": { "archivo": "musica.mp3", "volumen": 0.6, "inicio": 0, "fundidoFinal": 2 },
  "salida": "video.mp4",
  "escenas": [ /* … */ ]
}
```

### Escena

```jsonc
{
  "nombre": "portada",          // opcional, se usa en el nombre del PNG
  "duracion": 5,
  "movimiento": "paneo-der",    // zoom-in · zoom-out · paneo-izq · paneo-der · paneo-arriba · paneo-abajo · ninguno
  "transicion": "deslizar-izq", // cómo ENTRA esta escena (texto o { "tipo", "duracion" })
  "fondo": { /* … */ },
  "capas": [ /* se dibujan en orden: la última queda encima */ ]
}
```

Transiciones: `corte`, `fundido`, `negro`, `blanco`, `disolver`, `deslizar-izq`,
`deslizar-der`, `deslizar-arriba`, `deslizar-abajo`, `barrido-izq`, `barrido-der`,
`circulo`, `zoom`, `pixelar`, `radial`, o cualquier nombre de `xfade` de ffmpeg.

### Fondo

| Clave | Ejemplo | Qué hace |
|---|---|---|
| `color` | `"#111"` | Color sólido |
| `degradado` | `["#66ffcc", "#3b6cff"]` | Degradado; con `angulo` (grados) o `"tipo": "radial"` |
| `imagen` | `"foto.jpg"` | Foto de fondo; `ajuste` (`cover`/`contain`), `foco` (`"50% 30%"`) |
| `filtros` | `{ "brillo": 0.6, "desenfoque": 12 }` | Ver filtros abajo |
| `superposicion` | `"rgba(0,0,0,.4)"` o `{ "degradado": [...], "angulo": 90, "opacidad": 0.8 }` | Capa de color encima de la foto (para que el texto se lea) |
| `vineta` | `true` o `0.6` | Oscurece los bordes |
| `grano` | `true` o `0.08` | Textura de grano de película |

**Filtros** (fondo e imágenes): `brillo`, `contraste`, `saturacion` (1 = normal),
`desenfoque` (px), `grises`, `sepia`, `invertir` (0–1), `tono` (grados).

### Capas

Comunes a todas: `x`, `y`, `ancho`, `alto` (número = px, o texto como `"50%"`),
`ancla: "centro"` (x/y marcan el centro), `rotacion` (grados), `opacidad`,
`voltear` (`"h"` / `"v"`).

**Texto** — `{ "tipo": "texto", … }`

| Clave | Ejemplo |
|---|---|
| `texto` | `"Línea 1\n**resaltado**"`: `\n` para un salto de línea, `**…**` pinta esas palabras con `colorResaltado` |
| `posicion` | `"arriba"` · `"centro"` · `"abajo"`: ocupa todo el ancho con `margen`, sin necesidad de x/y |
| `fuente`, `peso` | `"Montserrat"`, `900` |
| `tamano`, `color`, `alinear` | `96`, `"#fff"`, `"center"` |
| `interlineado`, `espaciado`, `mayusculas`, `cursiva` | `1.2`, `4`, `true`, `true` |
| `sombra` | `true` o sombra CSS |
| `contorno` | `{ "ancho": 6, "color": "#000" }` |
| `fondo`, `relleno`, `radio` | caja de color detrás del texto (estilo subtítulo o etiqueta) |

Fuentes incluidas (funcionan sin internet): Montserrat, Poppins, Inter, Roboto, Oswald,
Anton, Bebas Neue, Playfair Display, Lora. Se pueden añadir más con
`npm i @fontsource/<nombre>` y agregándolas a `FUENTES` en `estudio.mjs`.

**Imagen** — `{ "tipo": "imagen", "src": "logo.png", … }`: `ajuste`, `foco` (recorte),
`radio` (`"50%"` = círculo), `borde: { ancho, color }`, `sombra`, `filtros`.

**Forma** — `{ "tipo": "forma", "forma": "rect" | "circulo", … }`: `color` o `degradado`,
`radio`, `borde`, `sombra`, `desenfoqueFondo` (efecto cristal).

**HTML** — `{ "tipo": "html", "contenido": "<svg>…</svg>" }`: cualquier HTML/SVG, para
iconos, gráficas o ilustraciones.

## Límites

- No genera fotos con IA ni quita fondos automáticamente. Las fotos y videos los aportas tú
  (o se descargan antes de usarlos); el estudio compone, edita y anima.
- El movimiento de cámara afecta a toda la escena (fondo y texto juntos), no a capas sueltas.
