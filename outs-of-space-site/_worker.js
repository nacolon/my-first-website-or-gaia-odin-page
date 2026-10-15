// Servidor de outs-of-space.pages.dev (Cloudflare Pages, "advanced mode").
// /api/scores guarda y entrega el ranking mundial (base de datos D1 enlazada como "DB").
// Todo lo demás se sirve tal cual desde los archivos subidos.

const MAX_SCORE = 2_000_000;   // tope razonable para descartar puntuaciones imposibles
const PER_MINUTE = 5;          // envíos permitidos por persona (IP) cada minuto

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function hashIp(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('oos:' + ip));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return name || 'Anónimo';
}

async function topScores(env, limit = 20) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, score, won, reached, created_at FROM scores ORDER BY score DESC, id ASC LIMIT ?'
  ).bind(limit).all();
  return results;
}

let tableReady = false;
async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0, reached TEXT, ip_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores(ip_hash, created_at)'),
  ]);
  tableReady = true;
}

async function handleScores(request, env) {
  if (!env.DB) return json({ error: 'El ranking no está conectado a la base de datos (falta el enlace DB).' }, 503);
  await ensureTable(env);

  if (request.method === 'GET') {
    return json({ scores: await topScores(env) });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Datos no válidos' }, 400); }

    const score = Math.floor(Number(body.score));
    if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) return json({ error: 'Puntuación no válida' }, 400);
    const name = cleanName(body.name);
    const won = body.won ? 1 : 0;
    const reached = String(body.reached || '').slice(0, 40);

    const ip = request.headers.get('cf-connecting-ip') || 'desconocida';
    const ipHash = await hashIp(ip);
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > datetime('now', '-1 minute')"
    ).bind(ipHash).first();
    if (recent && recent.n >= PER_MINUTE) return json({ error: 'Demasiados envíos. Espera un minuto.' }, 429);

    const res = await env.DB.prepare(
      'INSERT INTO scores (name, score, won, reached, ip_hash) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, score, won, reached, ipHash).run();
    const id = res.meta.last_row_id;
    const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ?').bind(score).first();

    return json({ id, rank: (better ? better.n : 0) + 1, scores: await topScores(env) }, 201);
  }

  return json({ error: 'Método no permitido' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/scores') {
      try { return await handleScores(request, env); }
      catch (e) { return json({ error: 'Error del servidor' }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
