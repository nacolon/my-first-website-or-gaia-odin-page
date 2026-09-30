/* Analizador del grafo: convierte una lista de archivos {path, text, size}
   en nodos (carpetas, archivos, skills) y aristas (contiene, enlace, menciona).
   Se usa en grafo.html y en el script que genera la muestra. */
(function (global) {
  const TEXT_EXT = /\.(md|markdown|mdx|txt|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|json|ya?ml|py|sh|toml|ini|csv|xml|svg)$/i;
  const IGNORE_DIR = /^(\.git|node_modules|__pycache__|\.venv|venv|\.next|\.cache|\.DS_Store)$/;
  const MAX_TEXT = 512 * 1024;

  const norm = (p) => {
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s);
    }
    return out.join('/');
  };
  const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function isIgnored(path) {
    return path.split('/').some((s) => IGNORE_DIR.test(s));
  }

  function frontmatter(text) {
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(text || '');
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = /^(name|description):\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  }

  function build(files, rootName) {
    const nodes = new Map();
    const edges = new Map();
    const addEdge = (s, t, type) => {
      if (s === t || !nodes.has(s) || !nodes.has(t)) return;
      const k = s + '\u0000' + t + '\u0000' + type;
      if (!edges.has(k)) edges.set(k, { s, t, type });
    };
    nodes.set('', { id: '', label: rootName || 'raíz', type: 'folder', parent: null });

    const ensureFolder = (p) => {
      if (nodes.has(p)) return;
      const parent = dirname(p);
      ensureFolder(parent);
      nodes.set(p, { id: p, label: basename(p), type: 'folder', parent });
      addEdge(parent, p, 'contiene');
    };

    const texts = new Map();
    for (const f of files) {
      const path = norm(f.path);
      if (!path || isIgnored(path)) continue;
      const dir = dirname(path);
      ensureFolder(dir);
      const ext = (/\.([^.\/]+)$/.exec(path) || [, ''])[1].toLowerCase();
      nodes.set(path, { id: path, label: basename(path), type: 'file', ext, size: f.size || 0, parent: dir });
      addEdge(dir, path, 'contiene');
      if (f.text != null) texts.set(path, f.text);
    }

    // Skills: toda carpeta que contiene un SKILL.md
    const skills = [];
    for (const [path, text] of texts) {
      if (basename(path).toLowerCase() !== 'skill.md') continue;
      const dir = dirname(path);
      const n = nodes.get(dir);
      const fm = frontmatter(text);
      n.type = 'skill';
      n.skillName = fm.name || n.label;
      if (fm.description) n.desc = fm.description.slice(0, 400);
      skills.push(n);
    }
    const skillOf = (p) => {
      let d = nodes.get(p) && nodes.get(p).type === 'file' ? dirname(p) : p;
      while (d != null) {
        const n = nodes.get(d);
        if (n && n.type === 'skill') return d;
        if (d === '') return null;
        d = dirname(d);
      }
      return null;
    };

    // Índice por nombre para [[wikilinks]]
    const byName = new Map();
    for (const n of nodes.values()) {
      if (n.type !== 'file') continue;
      for (const key of [n.label.toLowerCase(), n.label.toLowerCase().replace(/\.[^.]+$/, '')]) {
        if (!byName.has(key)) byName.set(key, n.id);
      }
    }

    const resolve = (from, raw) => {
      let t = raw.trim().replace(/^<|>$/g, '').split(/[?#]/)[0];
      if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return null;
      try { t = decodeURIComponent(t); } catch (e) { /* se deja tal cual */ }
      t = t.replace(/\/$/, '');
      const dir = dirname(from);
      const sk = skillOf(from);
      const tries = t.startsWith('/') ? [t] : [dir + '/' + t, sk != null ? sk + '/' + t : null, t];
      for (const c of tries) {
        if (c == null) continue;
        const p = norm(c);
        if (p != null && p !== from && nodes.has(p)) return p;
      }
      return null;
    };

    const PATTERNS = [
      /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g,                         // [texto](ruta)
      /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,                   // HTML
      /(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]/g,       // JS import
      /\bimport\s*\(?\s*['"]([^'"]+)['"]/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /@import\s+(?:url\()?['"]?([^'")\s;]+)/g,                   // CSS
      /(?:^|[\s`'"(])((?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-z]{1,5})(?=[\s`'"),:;]|$)/gim, // rutas sueltas
    ];

    for (const [path, text] of texts) {
      for (const re of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          const target = resolve(path, m[1]);
          if (target) addEdge(path, target, 'enlace');
        }
      }
      const wiki = /\[\[([^\]|#]+)/g;
      let w;
      while ((w = wiki.exec(text))) {
        const key = basename(w[1].trim()).toLowerCase();
        const target = byName.get(key) || byName.get(key + '.md');
        if (target && target !== path) addEdge(path, target, 'enlace');
      }
    }

    // Menciones entre skills: el texto de un .md nombra otra skill
    const mentionRes = skills.map((s) => {
      const n = escRe(s.skillName);
      const re = s.skillName.includes('-')
        ? new RegExp('(?<![\\w-])' + n + '(?![\\w-])')
        : new RegExp('(?:[`"\'/:]' + n + '(?![\\w-])|(?<![\\w.-])' + n + '[`"\']|\\bskills?\\s+[`"\']?' + n + '\\b|(?<![\\w.-])' + n + '\\s+skill\\b)');
      return { id: s.id, re };
    });
    for (const [path, text] of texts) {
      if (!/\.(md|markdown|mdx|txt)$/i.test(path)) continue;
      const from = skillOf(path);
      for (const { id, re } of mentionRes) {
        if (id === from) continue;
        if (re.test(text)) addEdge(from != null ? from : path, id, 'menciona');
      }
    }

    return { rootName: rootName || 'raíz', nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  global.GrafoCore = { build, TEXT_EXT, MAX_TEXT, isIgnored };
})(typeof window !== 'undefined' ? window : globalThis);
