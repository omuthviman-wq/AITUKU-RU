// ツイートURL → 本文。publish.twitter.com の oEmbed を JSONP で呼ぶ(CORS不要・認証不要)。
export function fetchTweet(url) {
  const m = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/);
  if (!m) return Promise.reject(new Error('ツイートのURLではありません'));
  const [, user, id] = m;
  return new Promise((resolve, reject) => {
    const cb = `__tw${Date.now()}`;
    const script = document.createElement('script');
    const done = () => {
      delete window[cb];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('ツイートを取得できませんでした。本文を直接貼り付けてください。'));
    }, 10000);
    window[cb] = (json) => {
      done();
      const p = (json?.html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const doc = new DOMParser().parseFromString((p ? p[1] : '').replace(/<br\s*\/?>/gi, '\n'), 'text/html');
      const text = doc.body.textContent.replace(/https?:\/\/t\.co\/\S+/g, '').replace(/pic\.twitter\.com\/\S+/g, '').trim();
      if (!text) return reject(new Error('本文が空でした。本文を直接貼り付けてください。'));
      resolve({ text, author: `@${user}`, url: `https://x.com/${user}/status/${id}`, externalId: id });
    };
    script.onerror = () => {
      done();
      reject(new Error('ツイートを取得できませんでした。本文を直接貼り付けてください。'));
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
