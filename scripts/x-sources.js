// X API v2 recent search でプロンプトっぽいツイートを集める(GitHub Actions から実行)。
import { cleanTweetText, makeTitle } from '../public/js/tweet-api.js';

export const DEFAULT_X_QUERY =
  '(ChatGPT OR GPT-4o OR gpt-image OR GPT画像) (プロンプト OR prompt) ' +
  '(水着 OR グラビア OR セクシー OR 色っぽ OR ランジェリー OR ビキニ OR 彼シャツ OR バニー) ' +
  '-is:retweet -is:reply';

export async function searchX({ bearer, query, maxResults = 100 }) {
  const params = new URLSearchParams({
    query: query || DEFAULT_X_QUERY,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    'tweet.fields': 'public_metrics,created_at,author_id,note_tweet,attachments',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,name',
    'media.fields': 'type,url,preview_image_url',
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
  const media = new Map((json.includes?.media || []).map((m) => [m.media_key, m]));
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
        // 生成サンプル(添付画像。動画/GIFはサムネイル)
        images: (t.attachments?.media_keys || [])
          .map((k) => media.get(k))
          .map((m) => m?.url || m?.preview_image_url)
          .filter(Boolean),
        tags: [],
      };
    })
    // 本文が短すぎるもの(プロンプトが画像やリプ欄にあるもの)は使いづらいので除外
    .filter((p) => p.text.length >= 40);
}

const netError = (name) => (e) => {
  throw new Error(`${name} に接続できませんでした (${e.cause?.code || e.message})`);
};
