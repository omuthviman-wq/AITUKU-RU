import { SEED_PROMPTS } from './js/seeds.js?v=dev';
import { composeSimple, composeWithAI, composeWithGemini } from './js/compose.js?v=dev';
import { generateImage } from './js/generate.js?v=dev';
import { fetchTweet, tweetIdOf, embedTweet } from './js/tweet.js?v=dev';
import { fetchTweetDetail, TWEET_URL_RE } from './js/tweet-api.js?v=dev';
import { loadStore, saveStore, exportStore, importStore } from './js/store.js?v=dev';

const $ = (s) => document.querySelector(s);

let store = await loadStore();
const state = { xPrompts: [], scene: null, formImages: [], enriched: new Map(), enriching: new Set() };
const MAX_REF_IMAGES = 8;
const save = () => saveStore(store);
const saveQuiet = () => save().catch((e) => toast(e.message));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// GitHub Pages の URL(user.github.io/repo/)から元リポジトリを割り出す
const REPO_URL = location.hostname.endsWith('github.io')
  ? `https://github.com/${location.hostname.split('.')[0]}/${location.pathname.split('/')[1]}`
  : 'https://github.com/omuthviman-wq/AITUKU-RU';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function busy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
}

// ---------- tabs ----------
function showTab(name) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
  scrollTo(0, 0);
}
for (const b of document.querySelectorAll('nav button')) b.onclick = () => showTab(b.dataset.tab);

// ---------- ① キャラ ----------
const currentChar = () => store.chars.find((c) => c.id === store.currentChar);

function renderChars() {
  const sel = $('#currentChar');
  sel.replaceChildren(
    ...(store.chars.length ? store.chars.map((c) => el('option', { value: c.id }, c.name)) : [el('option', { value: '' }, '未登録')]),
  );
  if (!currentChar() && store.chars[0]) store.currentChar = store.chars[0].id;
  sel.value = store.currentChar;

  $('#charList').replaceChildren(
    ...store.chars.map((c) =>
      el('div', { class: 'card char' },
        c.images.length ? el('div', { class: 'thumbs' }, ...c.images.map((src) => el('img', { src, alt: c.name }))) : null,
        el('h2', {}, c.name),
        c.appearance ? el('p', {}, c.appearance) : null,
        c.extra ? el('p', { class: 'muted' }, c.extra) : null,
        el('div', { class: 'row' },
          el('button', { onclick: () => editChar(c) }, '編集'),
          el('button', {
            onclick: () => {
              if (!confirm(`${c.name} を削除しますか?`)) return;
              store.chars = store.chars.filter((x) => x.id !== c.id);
              saveQuiet();
              renderChars();
            },
          }, '削除'),
        ),
      ),
    ),
  );
}
$('#currentChar').onchange = (ev) => {
  store.currentChar = ev.target.value;
  saveQuiet();
  if (state.scene) compose(false);
};

function editChar(c) {
  const f = $('#charForm');
  f.id.value = c.id;
  f.name.value = c.name;
  f.appearance.value = c.appearance;
  f.extra.value = c.extra;
  f.adult.checked = c.adult;
  state.formImages = [...c.images];
  renderFormImages();
  $('#charFormTitle').textContent = `${c.name} を編集`;
  $('#charCancel').hidden = false;
  f.scrollIntoView({ behavior: 'smooth' });
}

function resetCharForm() {
  const f = $('#charForm');
  f.reset();
  f.id.value = '';
  state.formImages = [];
  renderFormImages();
  $('#charFormTitle').textContent = 'キャラを登録';
  $('#charCancel').hidden = true;
}
$('#charCancel').onclick = resetCharForm;

// 参考画像は保存容量を食うので 768px 以内の JPEG に縮める
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 768 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

function renderFormImages() {
  $('#charImages').replaceChildren(
    ...state.formImages.map((src, i) =>
      el('div', { class: 'ref' },
        el('img', { src, alt: `参考画像${i + 1}` }),
        el('button', {
          type: 'button',
          title: '外す',
          onclick: () => {
            state.formImages.splice(i, 1);
            renderFormImages();
          },
        }, '×'),
      ),
    ),
  );
  $('#charImageCount').textContent = `${state.formImages.length} / ${MAX_REF_IMAGES}枚`;
}

$('#charForm').image.onchange = async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  const room = MAX_REF_IMAGES - state.formImages.length;
  if (files.length > room) toast(`参考画像は${MAX_REF_IMAGES}枚までです`);
  try {
    for (const file of files.slice(0, Math.max(room, 0))) state.formImages.push(await shrinkImage(file));
  } catch (e) {
    toast(e.message);
  }
  renderFormImages();
};

$('#charForm').onsubmit = (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f.querySelector('button[type=submit]'), async () => {
    const name = f.name.value.trim();
    if (!name) throw new Error('名前は必須です');
    if (!f.adult.checked) throw new Error('成人キャラのみ登録できます(「18歳以上」にチェック)');
    const old = store.chars.find((c) => c.id === f.id.value);
    const ch = {
      id: old?.id || uid(),
      name,
      appearance: f.appearance.value.trim(),
      extra: f.extra.value.trim(),
      adult: true,
      images: [...state.formImages],
    };
    const prev = store.chars;
    store.chars = old ? prev.map((c) => (c.id === ch.id ? ch : c)) : [...prev, ch];
    store.currentChar = ch.id;
    try {
      await save();
    } catch (e) {
      store.chars = prev;
      throw e;
    }
    resetCharForm();
    renderChars();
    toast(`${ch.name} を保存しました`);
  });
};

// ---------- 生成サンプル & ツイートへのリンク ----------
// サンプル画像がまだ無いツイートは、表示した時に裏で取ってくる
async function enrich(p, box) {
  const id = tweetIdOf(p);
  state.enriching.add(id);
  try {
    const d = await fetchTweetDetail(p.url || `https://x.com/i/status/${id}`);
    const patch = { images: d.images, likes: d.likes || p.likes, score: d.score || p.score, author: d.author, url: d.url };
    if (!p.text && d.text) Object.assign(patch, { text: d.text, title: d.title });
    state.enriched.set(id, patch);
    const mine = store.prompts.find((x) => x.id === p.id);
    if (mine) {
      Object.assign(mine, patch);
      saveQuiet();
    }
    if (box.isConnected) box.replaceWith(sampleBlock({ ...p, ...patch }));
  } catch {
    state.enriched.set(id, { images: [] });
    box.querySelector('.loading')?.remove();
  }
}

function sampleBlock(p) {
  const id = tweetIdOf(p);
  if (!p.images?.length && !id && !p.url) return null;
  const box = el('div', { class: 'samples' });
  if (id && !p.images?.length && !state.enriched.has(id)) {
    box.append(el('p', { class: 'muted loading' }, 'サンプル画像を読み込み中…'));
    if (!state.enriching.has(id)) enrich(p, box);
  }
  if (p.images?.length) {
    box.append(
      el('div', { class: 'thumbs' },
        ...p.images.map((src) =>
          el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src, alt: '生成サンプル', loading: 'lazy' })),
        ),
      ),
    );
  }
  const embed = el('div', { class: 'embed' });
  const row = el('div', { class: 'row' });
  if (id) {
    const btn = el('button', {
      onclick: () => {
        if (embed.childElementCount) {
          embed.replaceChildren();
          btn.textContent = p.images?.length ? 'ツイートを表示' : 'サンプルを見る(ツイート表示)';
          return;
        }
        busy(btn, async () => {
          await embedTweet(id, embed);
          btn.textContent = '閉じる';
        });
      },
    }, p.images?.length ? 'ツイートを表示' : 'サンプルを見る(ツイート表示)');
    row.append(btn);
  }
  if (p.url) row.append(el('a', { class: 'button', href: p.url, target: '_blank', rel: 'noopener' }, 'Xで開く ↗'));
  box.append(row, embed);
  return box;
}

// ---------- ② プロンプト一覧 ----------
const SOURCE_LABEL = { x: 'X', manual: '手動', builtin: '内蔵' };

function allPrompts() {
  const seeds = SEED_PROMPTS.map((p, i) => ({ id: `builtin-${i}`, source: 'builtin', score: 0, likes: 0, ...p }));
  const hidden = new Set(store.hidden);
  const favs = new Set(store.favs);
  return [...store.prompts, ...state.xPrompts, ...seeds]
    .filter((p) => !hidden.has(p.id))
    .map((p) => ({ ...p, ...state.enriched.get(tweetIdOf(p)), ...(store.edits[p.id] != null ? { text: store.edits[p.id], edited: true } : {}), fav: favs.has(p.id) }))
    .sort((a, b) => b.fav - a.fav || (b.score || 0) - (a.score || 0));
}

async function loadXPrompts() {
  const res = await fetch(`data/prompts-x.json?t=${Date.now()}`);
  state.xPrompts = res.ok ? await res.json() : [];
}

function renderPrompts() {
  const q = $('#search').value.trim().toLowerCase();
  const src = $('#sourceFilter').value;
  const list = allPrompts().filter((p) => {
    if (src === 'fav' ? !p.fav : src && p.source !== src) return false;
    return !q || `${p.title}\n${p.text}\n${(p.tags || []).join(' ')}`.toLowerCase().includes(q);
  });
  $('#promptList').replaceChildren(
    ...list.map((p) => {
      const card = el('div', { class: 'card prompt' },
        el('div', { class: 'row spread' },
          el('h2', {}, p.title),
          el('button', {
            class: `star ${p.fav ? 'on' : ''}`,
            title: 'お気に入り',
            onclick: () => {
              store.favs = p.fav ? store.favs.filter((id) => id !== p.id) : [...store.favs, p.id];
              saveQuiet();
              renderPrompts();
            },
          }, p.fav ? '★' : '☆'),
        ),
        el('div', { class: 'meta' },
          el('span', { class: 'badge' }, SOURCE_LABEL[p.source] || p.source),
          p.edited ? el('span', { class: 'badge' }, '編集済み') : null,
          p.curated ? el('span', { class: 'badge' }, 'おすすめ') : null,
          p.author ? el('span', {}, p.author) : null,
          p.likes ? el('span', {}, `♥ ${p.likes}`) : null,
          ...(p.tags || []).map((t) => el('span', {}, `#${t}`)),
        ),
        el('div', { class: 'text', onclick: () => card.classList.toggle('open') }, p.text),
        sampleBlock(p),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => pickScene(p) }, 'このキャラで作る'),
          el('button', { onclick: () => editPromptText(p, card) }, '本文を編集'),
          el('button', {
            onclick: () => {
              if (!confirm('この項目を一覧から消しますか?')) return;
              if (p.source === 'manual') store.prompts = store.prompts.filter((x) => x.id !== p.id);
              else store.hidden = [...store.hidden, p.id];
              saveQuiet();
              renderPrompts();
            },
          }, '削除'),
        ),
      );
      return card;
    }),
  );
  if (!list.length) $('#promptList').append(el('p', { class: 'muted' }, '該当するプロンプトがありません'));
}
// リプ欄にあるプロンプト全文などを貼って保存できるように
function editPromptText(p, card) {
  if (card.querySelector('.edit')) return;
  const ta = el('textarea', { rows: '8' });
  ta.value = p.text;
  const box = el('div', { class: 'edit' },
    el('p', { class: 'muted' }, 'リプ欄や画像にあるプロンプト全文をここに貼って保存してください'),
    ta,
    el('div', { class: 'row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          const mine = store.prompts.find((x) => x.id === p.id);
          if (mine) mine.text = ta.value.trim();
          else store.edits[p.id] = ta.value.trim();
          await saveQuiet();
          renderPrompts();
          toast('保存しました');
        },
      }, '保存'),
      el('button', { onclick: () => box.remove() }, 'キャンセル'),
    ),
  );
  card.querySelector('.text').after(box);
  ta.focus();
}

$('#search').oninput = renderPrompts;
$('#sourceFilter').onchange = renderPrompts;

$('#fetchX').onclick = () => {
  toast('GitHub で「Run workflow」を押すと収集が始まります。数分後に「最新を読み込む」を押してください');
  window.open(`${REPO_URL}/actions/workflows/pages.yml`, '_blank', 'noopener');
};
$('#reloadX').onclick = (ev) =>
  busy(ev.target, async () => {
    await loadXPrompts();
    renderPrompts();
    toast(`Xのプロンプト ${state.xPrompts.length}件`);
  });

$('#addForm').onsubmit = (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f.querySelector('button'), async () => {
    const urls = [...new Set([...f.url.value.matchAll(new RegExp(TWEET_URL_RE, 'g'))].map((m) => `https://x.com/${m[1]}/status/${m[2]}`))];
    const text = f.text.value.trim();
    const known = new Set(allPrompts().map((p) => tweetIdOf(p)).filter(Boolean));
    const items = [];
    if (urls.length > 1 || (urls.length === 1 && !text)) {
      // URLだけ → ツイートから本文・サンプル画像を取ってくる(複数まとめてOK)
      let failed = 0;
      for (const url of urls) {
        if (known.has(url.match(TWEET_URL_RE)[2])) continue;
        try {
          items.push(await fetchTweet(url));
        } catch {
          failed++;
        }
      }
      if (!items.length) throw new Error(failed ? 'ツイートを取得できませんでした。本文を直接貼り付けてください。' : '全部追加済みです');
      if (failed) toast(`${failed}件は取得できませんでした`);
    } else {
      if (!text) throw new Error('本文かURLを入力してください');
      const first = text.split('\n').map((x) => x.trim()).find(Boolean);
      items.push({ url: urls[0] || '', externalId: urls[0]?.match(TWEET_URL_RE)[2], text, title: first.length > 30 ? `${first.slice(0, 30)}…` : first });
    }
    const title = f.title.value.trim();
    store.prompts = [
      ...items.map((t) => ({ id: uid(), score: 0, likes: 0, tags: [], images: [], ...t, ...(title && items.length === 1 ? { title } : {}), source: 'manual' })),
      ...store.prompts,
    ];
    await save();
    f.reset();
    $('#sourceFilter').value = '';
    renderPrompts();
    toast(`${items.length}件追加しました`);
  });
};

// ---------- ③ 作る ----------
function pickScene(p) {
  if (!currentChar()) {
    toast('先に①でキャラを登録してください');
    return showTab('chars');
  }
  state.scene = p;
  if (!p.text.trim()) toast('このツイートは本文にプロンプトがありません。画像やリプ欄のプロンプトを下の欄に書き足してください');
  $('#makeScene').replaceChildren(el('strong', {}, p.title), el('div', { class: 'muted' }, p.text), sampleBlock(p) || '');
  showTab('make');
  compose(false);
}

async function compose(useAI) {
  const ch = currentChar();
  if (!state.scene || !ch) return;
  $('#refNote').hidden = !ch.images.length;
  $('#refImages').replaceChildren(...ch.images.map((src) => el('img', { src, alt: '参考画像' })));
  $('#finalPrompt').value = !useAI
    ? composeSimple(state.scene, ch)
    : store.geminiKey
      ? await composeWithGemini(state.scene, ch, { apiKey: store.geminiKey })
      : await composeWithAI(state.scene, ch, { apiKey: store.openaiKey });
}

$('#aiCompose').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!store.geminiKey && !store.openaiKey) throw new Error('設定タブで Gemini APIキー(無料)を入れると使えます');
    if (!state.scene) throw new Error('先に②でシーンを選んでください');
    await compose(true);
    toast('AIで合成しました');
  });

async function copyPrompt() {
  const ta = $('#finalPrompt');
  try {
    await navigator.clipboard.writeText(ta.value);
  } catch {
    ta.select();
    document.execCommand('copy');
  }
  toast('コピーしました');
}
$('#copyBtn').onclick = copyPrompt;
$('#openChatGPT').onclick = async () => {
  const text = $('#finalPrompt').value;
  await copyPrompt();
  // ?q= で入力欄に流し込まれる(長すぎるとURLが切れるので、その時は貼り付けで)
  location.href = text.length < 1800 ? `https://chatgpt.com/?q=${encodeURIComponent(text)}` : 'https://chatgpt.com/';
};

$('#generate').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!store.openaiKey) throw new Error('設定タブで OpenAI APIキーを入れるとワンボタン生成できます');
    const prompt = $('#finalPrompt').value.trim();
    if (!prompt) throw new Error('プロンプトが空です');
    toast('生成中…(30秒〜1分ほどかかります)');
    const ch = currentChar();
    const src = await generateImage({
      apiKey: store.openaiKey,
      prompt,
      size: $('#size').value,
      quality: $('#quality').value,
      refImages: $('#useRef').checked ? ch?.images || [] : [],
    });
    $('#results').prepend(el('div', { class: 'card' }, el('img', { src, alt: '生成結果' }), el('p', { class: 'muted' }, '長押しで保存')));
    toast('できました');
  });

// ---------- 設定 ----------
for (const form of document.querySelectorAll('.key-form')) {
  const name = form.dataset.key;
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const key = form.key.value.trim();
    if (key) {
      store[name] = key;
      saveQuiet();
    }
    form.reset();
    renderKeyState();
    toast('保存しました');
  };
  form.querySelector('.key-clear').onclick = () => {
    store[name] = '';
    saveQuiet();
    renderKeyState();
    toast('削除しました');
  };
}
function renderKeyState() {
  for (const form of document.querySelectorAll('.key-form')) {
    const key = store[form.dataset.key];
    form.key.placeholder = key ? `保存済み(…${key.slice(-4)})` : form.dataset.placeholder;
  }
  $('#genNote').hidden = !!store.openaiKey;
  $('#aiCompose').textContent = store.geminiKey ? 'AIで自然に合成(Gemini)' : 'AIで自然に合成';
}

$('#exportBtn').onclick = () => {
  const a = el('a', {
    href: URL.createObjectURL(new Blob([exportStore(store)], { type: 'application/json' })),
    download: `aituku-ru-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
};
$('#importFile').onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    store = importStore(store, await file.text());
    saveQuiet();
    renderChars();
    renderPrompts();
    toast('復元しました');
  } catch (e) {
    toast(e.message);
  }
  ev.target.value = '';
};

// ---------- init ----------
$('#version').textContent = new URL(import.meta.url).searchParams.get('v') || 'dev';
$('#genCard').append(el('p', { class: 'muted', id: 'genNote' }, '設定タブで OpenAI APIキーを入れると、ここで直接生成できます。今はコピーしてChatGPTに貼ってください。'));
renderKeyState();
renderChars();
await loadXPrompts().catch(() => {});
renderPrompts();
if (!store.chars.length) showTab('chars');
