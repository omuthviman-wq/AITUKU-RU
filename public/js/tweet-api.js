// ツイートの本文・添付画像・いいね数を取る(認証不要)。ブラウザと GitHub Actions(Node)の両方で使う。
// FxTwitter → vxTwitter の順に試す。どちらも CORS 対応。

export const TWEET_URL_RE = /(?:twitter\.com|x\.com)\/([^/?#\s]+)\/status\/(\d+)/;

export function parseTweetUrl(url) {
  const m = String(url).match(TWEET_URL_RE);
  return m ? { user: m[1], id: m[2] } : null;
}

export function cleanTweetText(text) {
  return (text || '')
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/pic\.twitter\.com\/\S+/g, '')
    .trim();
}

export function makeTitle(text) {
  const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '無題';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function viaFx(user, id) {
  const { tweet: t } = await getJson(`https://api.fxtwitter.com/${user}/status/${id}`);
  if (!t) throw new Error('no tweet');
  const media = t.media?.all || [];
  return {
    text: t.raw_text?.text || t.text,
    user: t.author?.screen_name || user,
    likes: t.likes || 0,
    retweets: t.retweets || 0,
    bookmarks: t.bookmarks || 0,
    images: media.map((m) => (m.type === 'photo' ? m.url : m.thumbnail_url)).filter(Boolean),
    postedAt: t.created_at,
  };
}

async function viaVx(user, id) {
  const t = await getJson(`https://api.vxtwitter.com/${user}/status/${id}`);
  return {
    text: t.text,
    user: t.user_screen_name || user,
    likes: t.likes || 0,
    retweets: t.retweets || 0,
    bookmarks: 0,
    images: (t.media_extended || []).map((m) => (m.type === 'image' ? m.url : m.thumbnail_url)).filter(Boolean),
    postedAt: t.date,
  };
}

// → プロンプト一覧の1項目の形にして返す
export async function fetchTweetDetail(url) {
  const ref = parseTweetUrl(url);
  if (!ref) throw new Error('ツイートのURLではありません');
  let d;
  try {
    d = await viaFx(ref.user, ref.id);
  } catch {
    d = await viaVx(ref.user, ref.id);
  }
  const text = cleanTweetText(d.text);
  return {
    source: 'x',
    externalId: ref.id,
    title: makeTitle(text || '(本文なし)'),
    text,
    author: `@${d.user}`,
    url: `https://x.com/${d.user}/status/${ref.id}`,
    likes: d.likes,
    score: d.likes + 2 * d.retweets + 3 * d.bookmarks,
    images: d.images,
    postedAt: d.postedAt,
    tags: [],
  };
}
