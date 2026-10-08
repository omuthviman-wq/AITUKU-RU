// X(Twitter) からプロンプトを集める。
//  - X API v2 recent search(Bearer Token が必要)
//  - ツイートURLを貼ると oEmbed で本文を取得(認証不要)

export const DEFAULT_X_QUERY =
  '(ChatGPT OR GPT-4o OR gpt-image OR GPT画像) (プロンプト OR prompt) ' +
  '(水着 OR グラビア OR セクシー OR 色っぽ OR ランジェリー OR ビキニ OR 彼シャツ OR バニー) ' +
  '-is:retweet -is:reply';

export async function searchX({ bearer, query, maxResults = 100 }) {
  const params = new URLSearchParams({
    query: query || DEFAULT_X_QUERY,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    'tweet.fields': 'public_metrics,created_at,author_id,note_tweet',
    expansions: 'author_id',
    'user.fields': 'username,name',
  });
  const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  }).catch(netError('X API'));
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.detail || json.title || json.errors?.[0]?.message || `X API error ${res.status}`;
    throw new Error(msg);
  }
  const users = new Map((json.includes?.users || []).map((u) => [u.id, u]));
  return (json.data || [])
    .map((t) => {
      const m = t.public_metrics || {};
      const user = users.get(t.author_id);
      const text = cleanTweetText(t.note_tweet?.text || t.text);
      return {
        source: 'x',
        externalId: t.id,
        title: makeTitle(text),
        text,
        author: user ? `@${user.username}` : '',
        url: user ? `https://x.com/${user.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        likes: m.like_count || 0,
        score: (m.like_count || 0) + 2 * (m.retweet_count || 0) + 3 * (m.bookmark_count || 0),
        postedAt: t.created_at,
        tags: [],
      };
    })
    // 本文が短すぎるもの(プロンプトが画像やリプ欄にあるもの)は使いづらいので除外
    .filter((p) => p.text.length >= 40);
}

export async function fetchTweetByUrl(url) {
  const m = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/);
  if (!m) throw new Error('ツイートのURLではありません');
  const res = await fetch(
    `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/${m[1]}/status/${m[2]}`)}`,
  ).catch(netError('X'));
  if (!res.ok) throw new Error(`ツイートを取得できませんでした (${res.status})。本文を直接貼り付けてください。`);
  const json = await res.json();
  const p = (json.html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const text = cleanTweetText(htmlToText(p ? p[1] : ''));
  if (!text) throw new Error('本文が空でした。本文を直接貼り付けてください。');
  return {
    source: 'x',
    externalId: m[2],
    title: makeTitle(text),
    text,
    author: `@${m[1]}`,
    url: `https://x.com/${m[1]}/status/${m[2]}`,
    likes: 0,
    score: 0,
    tags: [],
  };
}

const netError = (name) => (e) => {
  throw new Error(`${name} に接続できませんでした (${e.cause?.code || e.message})`);
};

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function cleanTweetText(text) {
  return (text || '')
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/pic\.twitter\.com\/\S+/g, '')
    .trim();
}

export function makeTitle(text) {
  const first = text.split('\n').map((s) => s.trim()).find(Boolean) || '無題';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first;
}
