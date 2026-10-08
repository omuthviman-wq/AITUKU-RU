import { fetchTweetDetail, parseTweetUrl, makeTitle } from './tweet-api.js?v=dev';

// ツイートURL → 一覧の1項目。まず FxTwitter/vxTwitter(画像・いいね数つき)、
// ダメなら publish.twitter.com の oEmbed(本文のみ)を JSONP で。
export async function fetchTweet(url) {
  try {
    return await fetchTweetDetail(url);
  } catch (e) {
    if (!parseTweetUrl(url)) throw e;
    return fetchViaOEmbed(url);
  }
}

function fetchViaOEmbed(url) {
  const { user, id } = parseTweetUrl(url);
  const fail = new Error('ツイートを取得できませんでした。本文を直接貼り付けてください。');
  return new Promise((resolve, reject) => {
    const cb = `__tw${Date.now()}${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const done = () => {
      delete window[cb];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done();
      reject(fail);
    }, 10000);
    window[cb] = (json) => {
      done();
      const p = (json?.html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const doc = new DOMParser().parseFromString((p ? p[1] : '').replace(/<br\s*\/?>/gi, '\n'), 'text/html');
      const text = doc.body.textContent.replace(/https?:\/\/t\.co\/\S+/g, '').replace(/pic\.twitter\.com\/\S+/g, '').trim();
      if (!text) return reject(fail);
      resolve({
        source: 'x', externalId: id, title: makeTitle(text), text, author: `@${user}`,
        url: `https://x.com/${user}/status/${id}`, likes: 0, score: 0, images: [], tags: [],
      });
    };
    script.onerror = () => {
      done();
      reject(fail);
    };
    script.src = `https://publish.twitter.com/oembed?omit_script=1&callback=${cb}&url=${encodeURIComponent(`https://twitter.com/${user}/status/${id}`)}`;
    document.head.append(script);
  });
}

export function tweetIdOf(p) {
  return p.externalId || p.url?.match(/(?:twitter\.com|x\.com)\/[^/?#]+\/status\/(\d+)/)?.[1] || '';
}

// 公式の埋め込みでツイートを表示(添付の生成サンプル画像も見える)
let widgets;
function loadWidgets() {
  widgets ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.onload = () => window.twttr.ready(resolve);
    s.onerror = () => {
      widgets = null;
      reject(new Error('ツイートの埋め込みを読み込めませんでした'));
    };
    document.head.append(s);
  });
  return widgets;
}

export async function embedTweet(id, container) {
  const twttr = await loadWidgets();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const el = await twttr.widgets.createTweet(id, container, { theme: dark ? 'dark' : 'light', lang: 'ja', conversation: 'none', dnt: true });
  if (!el) throw new Error('ツイートを表示できませんでした(削除済みか鍵垢かも)');
}
