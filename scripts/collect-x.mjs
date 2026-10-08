// GitHub Actions から実行: public/data/prompts-x.json を更新する。
//  1. public/data/curated.txt のツイートURL → 本文・サンプル画像・いいね数を取得(キー不要)
//  2. X_BEARER_TOKEN があれば X API で検索して追加
import { readFile, writeFile } from 'node:fs/promises';
import { searchX, DEFAULT_X_QUERY } from './x-sources.js';
import { fetchTweetDetail, parseTweetUrl } from '../public/js/tweet-api.js';

const OUT = new URL('../public/data/prompts-x.json', import.meta.url);
const CURATED = new URL('../public/data/curated.txt', import.meta.url);
const MAX_ITEMS = 500;

let existing = [];
try {
  existing = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}
const byId = new Map(existing.map((p) => [p.externalId, p]));
let added = 0;

function upsert(f, extra = {}) {
  const old = byId.get(f.externalId);
  if (old) Object.assign(old, { likes: f.likes, score: f.score, images: f.images?.length ? f.images : old.images, ...extra });
  else {
    byId.set(f.externalId, { id: `x-${f.externalId}`, createdAt: new Date().toISOString(), ...f, ...extra });
    added++;
  }
}

// 1. 手動で選んだツイート
const urls = (await readFile(CURATED, 'utf8').catch(() => ''))
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#') && parseTweetUrl(s));
for (const url of urls) {
  try {
    upsert(await fetchTweetDetail(url), { curated: true });
  } catch (e) {
    console.warn(`取得失敗 ${url}: ${e.message}`);
  }
}
console.log(`おすすめURL ${urls.length}件を処理`);

// 2. X API 検索
if (process.env.X_BEARER_TOKEN) {
  const found = await searchX({ bearer: process.env.X_BEARER_TOKEN, query: process.env.X_QUERY || DEFAULT_X_QUERY });
  found.forEach((f) => upsert(f));
  console.log(`X検索 ${found.length}件ヒット`);
} else {
  console.log('X_BEARER_TOKEN が未設定なので X 検索はスキップ');
}

const list = [...byId.values()]
  .sort((a, b) => (b.curated ? 1 : 0) - (a.curated ? 1 : 0) || b.score - a.score)
  .slice(0, MAX_ITEMS);
await writeFile(OUT, JSON.stringify(list, null, 1));
console.log(`新規${added}件、合計${list.length}件`);
