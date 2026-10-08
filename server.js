import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_PROMPTS } from './src/seeds.js';
import { composeSimple, composeWithAI } from './src/compose.js';
import { searchX, fetchTweetByUrl, makeTitle, DEFAULT_X_QUERY } from './src/sources.js';
import { generateImage } from './src/generate.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const DATA = path.join(ROOT, 'data');
const IMAGES = path.join(DATA, 'images');
const OUTPUTS = path.join(DATA, 'outputs');
const CHARS_FILE = path.join(DATA, 'characters.json');
const PROMPTS_FILE = path.join(DATA, 'prompts.json');
const env = () => ({
  xBearer: process.env.X_BEARER_TOKEN,
  xQuery: process.env.X_QUERY || DEFAULT_X_QUERY,
  openaiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
});

await mkdir(IMAGES, { recursive: true });
await mkdir(OUTPUTS, { recursive: true });

// ---------- storage ----------
async function load(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2));

async function loadPrompts() {
  let prompts = await load(PROMPTS_FILE, null);
  if (!prompts) {
    const now = new Date().toISOString();
    prompts = SEED_PROMPTS.map((p) => ({ id: randomUUID(), source: 'builtin', score: 0, likes: 0, fav: false, createdAt: now, ...p }));
    await save(PROMPTS_FILE, prompts);
  }
  return prompts;
}

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('リクエストが大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(res, file) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// ルートディレクトリの外に出ないようにする
function safeJoin(base, rel) {
  const p = path.join(base, rel);
  return p.startsWith(base + path.sep) ? p : null;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

route('GET', '/api/config', async () => {
  const e = env();
  return { hasX: !!e.xBearer, hasOpenAI: !!e.openaiKey, xQuery: e.xQuery };
});

// ① キャラクター
route('GET', '/api/characters', () => load(CHARS_FILE, []));

route('POST', '/api/characters', async (req) => {
  const b = await readBody(req);
  const chars = await load(CHARS_FILE, []);
  const ch = validateChar({ id: randomUUID(), hasImage: false, createdAt: new Date().toISOString() }, b);
  chars.push(ch);
  await save(CHARS_FILE, chars);
  return ch;
});

route('PUT', '/api/characters/([\\w-]+)', async (req, [id]) => {
  const b = await readBody(req);
  const chars = await load(CHARS_FILE, []);
  const i = chars.findIndex((c) => c.id === id);
  if (i < 0) throw Object.assign(new Error('キャラが見つかりません'), { status: 404 });
  chars[i] = validateChar(chars[i], b);
  await save(CHARS_FILE, chars);
  return chars[i];
});

route('DELETE', '/api/characters/([\\w-]+)', async (_req, [id]) => {
  const chars = await load(CHARS_FILE, []);
  await save(CHARS_FILE, chars.filter((c) => c.id !== id));
  await unlink(path.join(IMAGES, `${id}.png`)).catch(() => {});
  return { ok: true };
});

route('POST', '/api/characters/([\\w-]+)/image', async (req, [id]) => {
  const { dataUrl } = await readBody(req);
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('PNG画像のみ対応です'), { status: 400 });
  const chars = await load(CHARS_FILE, []);
  const ch = chars.find((c) => c.id === id);
  if (!ch) throw Object.assign(new Error('キャラが見つかりません'), { status: 404 });
  await writeFile(path.join(IMAGES, `${id}.png`), Buffer.from(m[1], 'base64'));
  ch.hasImage = true;
  ch.imageVersion = Date.now();
  await save(CHARS_FILE, chars);
  return ch;
});

route('DELETE', '/api/characters/([\\w-]+)/image', async (_req, [id]) => {
  const chars = await load(CHARS_FILE, []);
  const ch = chars.find((c) => c.id === id);
  if (ch) ch.hasImage = false;
  await save(CHARS_FILE, chars);
  await unlink(path.join(IMAGES, `${id}.png`)).catch(() => {});
  return ch || {};
});

function validateChar(base, b) {
  const name = String(b.name ?? base.name ?? '').trim();
  if (!name) throw Object.assign(new Error('名前は必須です'), { status: 400 });
  if (b.adult !== true) throw Object.assign(new Error('成人キャラのみ登録できます(「18歳以上」にチェック)'), { status: 400 });
  return {
    ...base,
    name,
    appearance: String(b.appearance ?? '').trim(),
    extra: String(b.extra ?? '').trim(),
    adult: true,
  };
}

// ② プロンプト一覧
route('GET', '/api/prompts', async () => {
  const prompts = await loadPrompts();
  return prompts.sort((a, b) => (b.fav - a.fav) || (b.score - a.score) || b.createdAt.localeCompare(a.createdAt));
});

route('POST', '/api/prompts/fetch-x', async () => {
  const e = env();
  if (!e.xBearer) throw Object.assign(new Error('.env に X_BEARER_TOKEN が設定されていません'), { status: 400 });
  const found = await searchX({ bearer: e.xBearer, query: e.xQuery });
  const prompts = await loadPrompts();
  const known = new Map(prompts.filter((p) => p.externalId).map((p) => [p.externalId, p]));
  let added = 0;
  for (const f of found) {
    const existing = known.get(f.externalId);
    if (existing) {
      existing.likes = f.likes;
      existing.score = f.score;
    } else {
      prompts.push({ id: randomUUID(), fav: false, createdAt: new Date().toISOString(), ...f });
      added++;
    }
  }
  await save(PROMPTS_FILE, prompts);
  return { added, total: found.length };
});

route('POST', '/api/prompts', async (req) => {
  const b = await readBody(req);
  const prompts = await loadPrompts();
  let item;
  if (b.url && !b.text) {
    item = await fetchTweetByUrl(b.url);
    if (prompts.some((p) => p.externalId === item.externalId)) throw Object.assign(new Error('そのツイートは追加済みです'), { status: 409 });
  } else {
    const text = String(b.text || '').trim();
    if (!text) throw Object.assign(new Error('本文かURLを入力してください'), { status: 400 });
    item = { source: 'manual', text, title: makeTitle(text), url: b.url || '', likes: 0, score: 0, tags: [] };
  }
  if (b.title) item.title = String(b.title).trim();
  const p = { id: randomUUID(), fav: false, createdAt: new Date().toISOString(), ...item };
  prompts.push(p);
  await save(PROMPTS_FILE, prompts);
  return p;
});

route('PUT', '/api/prompts/([\\w-]+)', async (req, [id]) => {
  const b = await readBody(req);
  const prompts = await loadPrompts();
  const p = prompts.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('見つかりません'), { status: 404 });
  if (typeof b.fav === 'boolean') p.fav = b.fav;
  if (typeof b.title === 'string' && b.title.trim()) p.title = b.title.trim();
  if (typeof b.text === 'string' && b.text.trim()) p.text = b.text.trim();
  await save(PROMPTS_FILE, prompts);
  return p;
});

route('DELETE', '/api/prompts/([\\w-]+)', async (_req, [id]) => {
  const prompts = await loadPrompts();
  await save(PROMPTS_FILE, prompts.filter((p) => p.id !== id));
  return { ok: true };
});

// ③ 合成
route('POST', '/api/compose', async (req) => {
  const { promptId, characterId, useAI } = await readBody(req);
  const scene = (await loadPrompts()).find((p) => p.id === promptId);
  const ch = (await load(CHARS_FILE, [])).find((c) => c.id === characterId);
  if (!scene || !ch) throw Object.assign(new Error('プロンプトかキャラが見つかりません'), { status: 404 });
  const e = env();
  if (useAI) {
    if (!e.openaiKey) throw Object.assign(new Error('.env に OPENAI_API_KEY が設定されていません'), { status: 400 });
    return { prompt: await composeWithAI(scene, ch, { apiKey: e.openaiKey, model: e.textModel }) };
  }
  return { prompt: composeSimple(scene, ch) };
});

// ④ 生成
route('POST', '/api/generate', async (req) => {
  const { prompt, characterId, size = '1024x1536', quality = 'medium', useRef = true } = await readBody(req);
  const e = env();
  if (!e.openaiKey) throw Object.assign(new Error('.env に OPENAI_API_KEY が設定されていません'), { status: 400 });
  if (!prompt?.trim()) throw Object.assign(new Error('プロンプトが空です'), { status: 400 });
  const ch = (await load(CHARS_FILE, [])).find((c) => c.id === characterId);
  const refImagePath = useRef && ch?.hasImage ? path.join(IMAGES, `${ch.id}.png`) : null;
  const png = await generateImage({ apiKey: e.openaiKey, model: e.imageModel, prompt, size, quality, refImagePath });
  const name = `${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  await writeFile(path.join(OUTPUTS, name), png);
  return { url: `/outputs/${name}` };
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(p);
        if (m) return send(res, 200, await r.fn(req, m.slice(1)));
      }
      return send(res, 404, { error: 'not found' });
    }
    if (p.startsWith('/images/')) return serveFile(res, safeJoin(IMAGES, p.slice(8)) || '');
    if (p.startsWith('/outputs/')) return serveFile(res, safeJoin(OUTPUTS, p.slice(9)) || '');
    const file = safeJoin(path.join(ROOT, 'public'), p === '/' ? 'index.html' : p.slice(1));
    return serveFile(res, file || '');
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  const e = env();
  console.log(`AITUKU-RU: http://localhost:${PORT}`);
  console.log(`  X API: ${e.xBearer ? 'あり' : 'なし(URL貼り付けで手動追加)'} / OpenAI: ${e.openaiKey ? 'あり' : 'なし(コピペ運用)'}`);
});

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
