#!/usr/bin/env node
// Estudio: compone escenas (fondo + capas de texto, imagen, forma o HTML) desde un
// proyecto JSON, las exporta como PNG con Chromium y las une en un MP4 con ffmpeg.
//
// Uso:
//   node estudio.mjs <proyecto.json> [--solo-imagenes] [--escena N] [--salida DIR]
//
// Ver README.md para el formato completo del proyecto.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const FORMATOS = {
  youtube: [1920, 1080],
  miniatura: [1280, 720],
  reels: [1080, 1920],
  tiktok: [1080, 1920],
  historia: [1080, 1920],
  shorts: [1080, 1920],
  cuadrado: [1080, 1080],
  vertical: [1080, 1350],
};

// Nombre de la fuente → paquete de @fontsource incluido en package.json.
const FUENTES = {
  'anton': 'anton',
  'bebas neue': 'bebas-neue',
  'inter': 'inter',
  'lora': 'lora',
  'montserrat': 'montserrat',
  'oswald': 'oswald',
  'playfair display': 'playfair-display',
  'poppins': 'poppins',
  'roboto': 'roboto',
};

const TRANSICIONES = {
  corte: 'fade',
  fundido: 'fade',
  negro: 'fadeblack',
  blanco: 'fadewhite',
  disolver: 'dissolve',
  'deslizar-izq': 'slideleft',
  'deslizar-der': 'slideright',
  'deslizar-arriba': 'slideup',
  'deslizar-abajo': 'slidedown',
  'barrido-izq': 'wipeleft',
  'barrido-der': 'wiperight',
  circulo: 'circleopen',
  zoom: 'zoomin',
  pixelar: 'pixelize',
  radial: 'radial',
};

// ---------- utilidades ----------

function fallar(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function px(v) {
  return typeof v === 'number' ? `${v}px` : v;
}

function escaparHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rutaRecurso(ruta, base) {
  if (/^(https?:|data:|file:)/.test(ruta)) return ruta;
  const abs = path.resolve(base, ruta);
  if (!fs.existsSync(abs)) fallar(`No encuentro el archivo: ${abs}`);
  return pathToFileURL(abs).href;
}

function filtrosCss(f) {
  if (!f) return '';
  const partes = [];
  if (f.brillo != null) partes.push(`brightness(${f.brillo})`);
  if (f.contraste != null) partes.push(`contrast(${f.contraste})`);
  if (f.saturacion != null) partes.push(`saturate(${f.saturacion})`);
  if (f.desenfoque != null) partes.push(`blur(${f.desenfoque}px)`);
  if (f.grises != null) partes.push(`grayscale(${f.grises})`);
  if (f.sepia != null) partes.push(`sepia(${f.sepia})`);
  if (f.tono != null) partes.push(`hue-rotate(${f.tono}deg)`);
  if (f.invertir != null) partes.push(`invert(${f.invertir})`);
  return partes.length ? `filter:${partes.join(' ')};` : '';
}

function degradadoCss(d) {
  const colores = d.colores || d.degradado;
  if (d.tipo === 'radial') return `radial-gradient(circle at center, ${colores.join(', ')})`;
  return `linear-gradient(${d.angulo ?? 135}deg, ${colores.join(', ')})`;
}

function sombraCss(s, porDefecto) {
  if (!s) return '';
  return s === true ? porDefecto : s;
}

// **texto** → resaltado; saltos de línea → <br>
function textoEnriquecido(texto, colorResaltado) {
  return escaparHtml(texto)
    .replace(/\*\*(.+?)\*\*/g, `<span style="color:${colorResaltado}">$1</span>`)
    .replace(/\n/g, '<br>');
}

// ---------- fuentes ----------

function pesoMasCercano(paquete, peso) {
  const dir = path.join(AQUI, 'node_modules', '@fontsource', paquete, 'files');
  if (!fs.existsSync(dir)) return null;
  const pesos = fs.readdirSync(dir)
    .map((f) => f.match(new RegExp(`^${paquete}-latin-(\\d+)-normal\\.woff2$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  if (!pesos.length) return null;
  return pesos.reduce((a, b) => (Math.abs(b - peso) < Math.abs(a - peso) ? b : a));
}

function fontFaces(usadas) {
  const reglas = [];
  for (const clave of usadas) {
    const [familia, pesoTxt] = clave.split('|');
    const paquete = FUENTES[familia.toLowerCase()];
    if (!paquete) continue; // fuente del sistema: el navegador la resuelve
    const peso = pesoMasCercano(paquete, Number(pesoTxt));
    if (peso == null) continue;
    for (const subset of ['latin', 'latin-ext']) {
      const archivo = path.join(AQUI, 'node_modules', '@fontsource', paquete, 'files', `${paquete}-${subset}-${peso}-normal.woff2`);
      if (!fs.existsSync(archivo)) continue;
      const datos = fs.readFileSync(archivo).toString('base64');
      reglas.push(`@font-face{font-family:'${familia}';font-weight:${pesoTxt};font-style:normal;src:url(data:font/woff2;base64,${datos}) format('woff2');}`);
    }
  }
  return reglas.join('\n');
}

// ---------- composición de una escena ----------

function cajaCss(c, ancho) {
  let css = 'position:absolute;';
  if (c.x != null) css += `left:${px(c.x)};`;
  if (c.y != null) css += `top:${px(c.y)};`;
  if (c.ancho != null) css += `width:${px(c.ancho)};`;
  if (c.alto != null) css += `height:${px(c.alto)};`;
  const transformaciones = [];
  if (c.ancla === 'centro') transformaciones.push('translate(-50%,-50%)');
  if (c.rotacion) transformaciones.push(`rotate(${c.rotacion}deg)`);
  if (c.voltear === 'h') transformaciones.push('scaleX(-1)');
  if (c.voltear === 'v') transformaciones.push('scaleY(-1)');
  if (transformaciones.length) css += `transform:${transformaciones.join(' ')};`;
  if (c.opacidad != null) css += `opacity:${c.opacidad};`;
  // Atajo para texto: posicion arriba|centro|abajo ocupa todo el ancho con margen.
  if (c.posicion && c.x == null && c.y == null) {
    const margen = c.margen ?? Math.round(ancho * 0.06);
    css += `left:${margen}px;right:${margen}px;`;
    if (c.posicion === 'arriba') css += `top:${margen}px;`;
    else if (c.posicion === 'abajo') css += `bottom:${margen}px;`;
    else css += 'top:50%;transform:translateY(-50%);';
  }
  return css;
}

function capaHtml(c, ctx) {
  const caja = cajaCss(c, ctx.ancho);
  switch (c.tipo) {
    case 'texto': {
      const familia = c.fuente || 'Montserrat';
      const peso = c.peso ?? 700;
      ctx.fuentes.add(`${familia}|${peso}`);
      let css = caja;
      css += `font-family:'${familia}',sans-serif;font-weight:${peso};`;
      css += `font-size:${px(c.tamano ?? 72)};color:${c.color ?? '#fff'};`;
      css += `text-align:${c.alinear ?? (c.posicion ? 'center' : 'left')};`;
      css += `line-height:${c.interlineado ?? 1.1};`;
      if (c.espaciado != null) css += `letter-spacing:${px(c.espaciado)};`;
      if (c.mayusculas) css += 'text-transform:uppercase;';
      if (c.cursiva) css += 'font-style:italic;';
      if (c.contorno) css += `-webkit-text-stroke:${c.contorno.ancho ?? 2}px ${c.contorno.color ?? '#000'};paint-order:stroke fill;`;
      const sombra = sombraCss(c.sombra, '0 4px 24px rgba(0,0,0,.55)');
      if (sombra) css += `text-shadow:${sombra};`;
      const interior = textoEnriquecido(c.texto ?? '', c.colorResaltado ?? '#ffd400');
      if (c.fondo) {
        // Caja de color detrás del texto (estilo subtítulo o etiqueta).
        const relleno = c.relleno ?? '0.25em 0.5em';
        const bloque = `background:${c.fondo};padding:${px(relleno)};border-radius:${px(c.radio ?? 12)};-webkit-box-decoration-break:clone;box-decoration-break:clone;`;
        return `<div style="${css}"><span style="${bloque}">${interior}</span></div>`;
      }
      return `<div style="${css}">${interior}</div>`;
    }
    case 'imagen': {
      let css = caja;
      css += `object-fit:${c.ajuste ?? 'cover'};object-position:${c.foco ?? 'center'};`;
      if (c.radio != null) css += `border-radius:${px(c.radio)};`;
      if (c.borde) css += `border:${c.borde.ancho ?? 4}px solid ${c.borde.color ?? '#fff'};box-sizing:border-box;`;
      const sombra = sombraCss(c.sombra, '0 20px 60px rgba(0,0,0,.5)');
      if (sombra) css += `box-shadow:${sombra};`;
      css += filtrosCss(c.filtros);
      return `<img src="${rutaRecurso(c.src, ctx.base)}" style="${css}">`;
    }
    case 'forma': {
      let css = caja;
      css += `background:${c.degradado ? degradadoCss(c) : (c.color ?? '#fff')};`;
      if (c.forma === 'circulo') css += 'border-radius:50%;';
      else if (c.radio != null) css += `border-radius:${px(c.radio)};`;
      if (c.borde) css += `border:${c.borde.ancho ?? 4}px solid ${c.borde.color ?? '#fff'};box-sizing:border-box;`;
      const sombra = sombraCss(c.sombra, '0 20px 60px rgba(0,0,0,.4)');
      if (sombra) css += `box-shadow:${sombra};`;
      if (c.desenfoqueFondo) css += `backdrop-filter:blur(${c.desenfoqueFondo}px);`;
      return `<div style="${css}"></div>`;
    }
    case 'html':
      return `<div style="${caja}">${c.contenido ?? ''}</div>`;
    default:
      fallar(`Tipo de capa desconocido: ${c.tipo}`);
  }
}

function fondoHtml(f = {}, ctx) {
  const partes = [];
  if (f.imagen) {
    let css = `position:absolute;inset:0;width:100%;height:100%;object-fit:${f.ajuste ?? 'cover'};object-position:${f.foco ?? 'center'};`;
    css += filtrosCss(f.filtros);
    if (f.filtros?.desenfoque) css += 'transform:scale(1.06);'; // evita bordes claros al desenfocar
    partes.push(`<div style="position:absolute;inset:0;background:${f.color ?? '#000'}"></div>`);
    partes.push(`<img src="${rutaRecurso(f.imagen, ctx.base)}" style="${css}">`);
  } else if (f.degradado) {
    partes.push(`<div style="position:absolute;inset:0;background:${degradadoCss(f)}"></div>`);
  } else {
    partes.push(`<div style="position:absolute;inset:0;background:${f.color ?? '#111'}"></div>`);
  }
  if (f.superposicion) {
    const s = typeof f.superposicion === 'string' ? { color: f.superposicion } : f.superposicion;
    const bg = s.degradado ? degradadoCss(s) : s.color;
    partes.push(`<div style="position:absolute;inset:0;background:${bg};opacity:${s.opacidad ?? 1}"></div>`);
  }
  if (f.vineta) {
    const fuerza = typeof f.vineta === 'number' ? f.vineta : 0.6;
    partes.push(`<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${fuerza}) 100%)"></div>`);
  }
  if (f.grano) {
    const opacidad = typeof f.grano === 'number' ? f.grano : 0.08;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
    partes.push(`<div style="position:absolute;inset:0;opacity:${opacidad};background-image:url(&quot;data:image/svg+xml;utf8,${svg}&quot;)"></div>`);
  }
  return partes.join('\n');
}

function escenaHtml(escena, ctx) {
  ctx.fuentes = new Set();
  const capas = (escena.capas ?? []).map((c) => capaHtml(c, ctx)).join('\n');
  const fondo = fondoHtml(escena.fondo, ctx);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(ctx.fuentes)}
*{margin:0;padding:0}
html,body{width:${ctx.ancho}px;height:${ctx.alto}px;overflow:hidden;background:#000}
#lienzo{position:relative;width:100%;height:100%;overflow:hidden}
</style></head><body><div id="lienzo">
${fondo}
${capas}
</div></body></html>`;
}

// ---------- video ----------

function ejecutar(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr.split('\n').slice(-25).join('\n'));
    fallar(`${cmd} terminó con error`);
  }
}

function filtroMovimiento(mov, frames, ancho, alto, fps, intensidad) {
  const z = intensidad;
  const centroX = "iw/2-(iw/zoom/2)";
  const centroY = "ih/2-(ih/zoom/2)";
  const t = `(on/${Math.max(frames - 1, 1)})`;
  let zoom, x = centroX, y = centroY;
  switch (mov) {
    case 'zoom-in': zoom = `1+${z}*${t}`; break;
    case 'zoom-out': zoom = `1+${z}-${z}*${t}`; break;
    case 'paneo-der': zoom = `1+${z}`; x = `(iw-iw/zoom)*${t}`; break;
    case 'paneo-izq': zoom = `1+${z}`; x = `(iw-iw/zoom)*(1-${t})`; break;
    case 'paneo-abajo': zoom = `1+${z}`; y = `(ih-ih/zoom)*${t}`; break;
    case 'paneo-arriba': zoom = `1+${z}`; y = `(ih-ih/zoom)*(1-${t})`; break;
    case 'ninguno': zoom = '1'; break;
    default: fallar(`Movimiento desconocido: ${mov}`);
  }
  return `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=${ancho}x${alto}:fps=${fps}`;
}

function crearVideo(proyecto, escenas, imagenesHd, destino, ctx) {
  const fps = proyecto.fps ?? 30;
  const transGlobal = proyecto.transicion ?? { tipo: 'fundido', duracion: 0.6 };
  const args = ['-y', '-hide_banner'];
  const filtros = [];
  const n = escenas.length;

  // transiciones[i] = cómo entra la escena i (la primera no tiene).
  const transiciones = escenas.map((e, i) => {
    if (i === 0) return null;
    const propia = typeof e.transicion === 'string' ? { tipo: e.transicion } : (e.transicion ?? {});
    const tr = { ...transGlobal, ...propia };
    const tipo = TRANSICIONES[tr.tipo] ?? tr.tipo;
    const duracion = tr.tipo === 'corte' ? 1 / fps : (tr.duracion ?? 0.6);
    return { tipo, duracion };
  });

  escenas.forEach((e, i) => {
    const dur = e.duracion ?? proyecto.duracion ?? 4;
    const extra = transiciones[i + 1]?.duracion ?? 0;
    const frames = Math.round((dur + extra) * fps);
    const mov = e.movimiento ?? proyecto.movimiento ?? 'zoom-in';
    const intensidad = e.intensidad ?? proyecto.intensidad ?? 0.08;
    args.push('-framerate', String(fps), '-i', imagenesHd[i]);
    filtros.push(`[${i}:v]scale=${ctx.ancho * 2}:${ctx.alto * 2},${filtroMovimiento(mov, frames, ctx.ancho, ctx.alto, fps, intensidad)},setsar=1,format=yuv420p[v${i}]`);
  });

  let ultimo = 'v0';
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += escenas[i - 1].duracion ?? proyecto.duracion ?? 4;
    const tr = transiciones[i];
    const etiqueta = `x${i}`;
    filtros.push(`[${ultimo}][v${i}]xfade=transition=${tr.tipo}:duration=${tr.duracion.toFixed(3)}:offset=${offset.toFixed(3)}[${etiqueta}]`);
    ultimo = etiqueta;
  }
  const total = escenas.reduce((s, e) => s + (e.duracion ?? proyecto.duracion ?? 4), 0);

  if (proyecto.fundidos !== false) {
    filtros.push(`[${ultimo}]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.6).toFixed(3)}:d=0.6[vf]`);
    ultimo = 'vf';
  }

  const mapas = ['-map', `[${ultimo}]`];
  if (proyecto.audio) {
    const a = typeof proyecto.audio === 'string' ? { archivo: proyecto.audio } : proyecto.audio;
    const archivo = path.resolve(ctx.base, a.archivo);
    if (!fs.existsSync(archivo)) fallar(`No encuentro el audio: ${archivo}`);
    if (a.inicio) args.push('-ss', String(a.inicio));
    args.push('-i', archivo);
    const fundido = a.fundidoFinal ?? 2;
    filtros.push(`[${n}:a]volume=${a.volumen ?? 1},afade=t=in:st=0:d=${a.fundidoInicio ?? 0.5},afade=t=out:st=${Math.max(total - fundido, 0).toFixed(3)}:d=${fundido}[af]`);
    mapas.push('-map', '[af]', '-c:a', 'aac', '-b:a', '192k');
  }

  args.push('-filter_complex', filtros.join(';'), ...mapas,
    '-t', total.toFixed(3), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', destino);
  ejecutar('ffmpeg', args);
  return total;
}

// ---------- principal ----------

async function main() {
  const argv = process.argv.slice(2);
  const archivo = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  if (!archivo) fallar('Uso: node estudio.mjs <proyecto.json> [--solo-imagenes] [--escena N] [--salida DIR]');
  const opcion = (nombre) => {
    const i = argv.indexOf(nombre);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const rutaProyecto = path.resolve(archivo);
  const proyecto = JSON.parse(fs.readFileSync(rutaProyecto, 'utf8'));
  const base = path.dirname(rutaProyecto);
  const salida = path.resolve(opcion('--salida') ?? path.join(base, 'salida'));
  const [ancho, alto] = Array.isArray(proyecto.formato)
    ? proyecto.formato
    : typeof proyecto.formato === 'object'
      ? [proyecto.formato.ancho, proyecto.formato.alto]
      : FORMATOS[proyecto.formato ?? 'youtube'] ?? fallar(`Formato desconocido: ${proyecto.formato}`);

  let escenas = proyecto.escenas ?? fallar('El proyecto no tiene "escenas"');
  const soloEscena = opcion('--escena');
  const indices = soloEscena ? [Number(soloEscena) - 1] : escenas.map((_, i) => i);
  const soloImagenes = argv.includes('--solo-imagenes') || soloEscena != null;

  fs.mkdirSync(path.join(salida, '.hd'), { recursive: true });
  const ctx = { ancho, alto, base };

  const navegador = await chromium.launch();
  const normal = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
  const hd = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2 });
  const imagenes = [];
  const imagenesHd = [];
  try {
    for (const i of indices) {
      const escena = escenas[i] ?? fallar(`No existe la escena ${i + 1}`);
      const nombre = escena.nombre ? `escena-${String(i + 1).padStart(2, '0')}-${escena.nombre}` : `escena-${String(i + 1).padStart(2, '0')}`;
      const html = path.join(salida, '.hd', `${nombre}.html`);
      fs.writeFileSync(html, escenaHtml(escena, ctx));
      const png = path.join(salida, `${nombre}.png`);
      const pngHd = path.join(salida, '.hd', `${nombre}@2x.png`);
      for (const [pagina, destino] of [[normal, png], [hd, pngHd]]) {
        await pagina.goto(pathToFileURL(html).href, { waitUntil: 'load' });
        await pagina.evaluate(() => document.fonts.ready);
        await pagina.screenshot({ path: destino });
      }
      imagenes.push(png);
      imagenesHd.push(pngHd);
      console.log(`✓ ${path.relative(process.cwd(), png)}`);
    }
  } finally {
    await navegador.close();
  }

  if (imagenes.length > 1) {
    const columnas = Math.min(4, imagenes.length);
    const filas = Math.ceil(imagenes.length / columnas);
    const hoja = path.join(salida, 'hoja-de-contacto.jpg');
    const entradas = imagenes.flatMap((p) => ['-i', p]);
    const escalas = imagenes.map((_, i) => `[${i}:v]scale=480:-2[s${i}]`).join(';');
    const fuentes = imagenes.map((_, i) => `[s${i}]`).join('');
    const tile = `${escalas};${fuentes}concat=n=${imagenes.length}:v=1:a=0,tile=${columnas}x${filas}:padding=8:color=0x222222`;
    ejecutar('ffmpeg', ['-y', '-hide_banner', ...entradas, '-filter_complex', tile, '-frames:v', '1', '-q:v', '3', hoja]);
    console.log(`✓ ${path.relative(process.cwd(), hoja)}`);
  }

  if (!soloImagenes) {
    const destino = path.join(salida, proyecto.salida ?? 'video.mp4');
    const total = crearVideo(proyecto, escenas, imagenesHd, destino, ctx);
    console.log(`✓ ${path.relative(process.cwd(), destino)} (${total.toFixed(1)} s, ${ancho}x${alto})`);
  }
}

main().catch((e) => fallar(e.stack || e.message));
