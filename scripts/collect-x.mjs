// GitHub Actions から定期実行: X を検索して public/data/prompts-x.json に追記する。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { searchX, DEFAULT_X_QUERY } from './x-sources.js';

const OUT = new URL('../public/data/prompts-x.json', import.meta.url);
const MAX_ITEMS = 500;

const bearer = process.env.X_BEARER_TOKEN;
if (!bearer) {
  console.log('X_BEARER_TOKEN が未設定なので収集をスキップします');
  process.exit(0);
}

let existing = [];
try {
  existing = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}

const found = await searchX({ bearer, query: process.env.X_QUERY || DEFAULT_X_QUERY });
const byId = new Map(existing.map((p) => [p.externalId, p]));
let added = 0;
for (const f of found) {
  const old = byId.get(f.externalId);
  if (old) Object.assign(old, { likes: f.likes, score: f.score });
  else {
    byId.set(f.externalId, { id: `x-${f.externalId}`, createdAt: new Date().toISOString(), ...f });
    added++;
  }
}

const list = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS);
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(list, null, 1));
console.log(`${found.length}件ヒット、新規${added}件、合計${list.length}件`);
