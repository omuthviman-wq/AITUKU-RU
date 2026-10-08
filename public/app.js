import { SEED_PROMPTS } from './js/seeds.js';
import { composeSimple, composeWithAI } from './js/compose.js';
import { generateImage } from './js/generate.js';
import { fetchTweet } from './js/tweet.js';
import { loadStore, saveStore, exportStore, importStore } from './js/store.js';

const $ = (s) => document.querySelector(s);

let store = loadStore();
const state = { xPrompts: [], scene: null };
const save = () => saveStore(store);
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
        c.image ? el('img', { src: c.image, alt: c.name }) : null,
        el('h2', {}, c.name),
        c.appearance ? el('p', {}, c.appearance) : null,
        c.extra ? el('p', { class: 'muted' }, c.extra) : null,
        el('div', { class: 'row' },
          el('button', { onclick: () => editChar(c) }, '編集'),
          el('button', {
            onclick: () => {
              if (!confirm(`${c.name} を削除しますか?`)) return;
              store.chars = store.chars.filter((x) => x.id !== c.id);
              save();
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
  save();
  if (state.scene) compose(false);
};

function editChar(c) {
  const f = $('#charForm');
  f.id.value = c.id;
  f.name.value = c.name;
  f.appearance.value = c.appearance;
  f.extra.value = c.extra;
  f.adult.checked = c.adult;
  $('#charFormTitle').textContent = `${c.name} を編集`;
  $('#charCancel').hidden = false;
  f.scrollIntoView({ behavior: 'smooth' });
}

function resetCharForm() {
  const f = $('#charForm');
  f.reset();
  f.id.value = '';
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
      image: f.image.files[0] ? await shrinkImage(f.image.files[0]) : old?.image || '',
    };
    const prev = store.chars;
    store.chars = old ? prev.map((c) => (c.id === ch.id ? ch : c)) : [...prev, ch];
    store.currentChar = ch.id;
    try {
      save();
    } catch (e) {
      store.chars = prev;
      throw e;
    }
    resetCharForm();
    renderChars();
    toast(`${ch.name} を保存しました`);
  });
};

// ---------- ② プロンプト一覧 ----------
const SOURCE_LABEL = { x: 'X', manual: '手動', builtin: '内蔵' };

function allPrompts() {
  const seeds = SEED_PROMPTS.map((p, i) => ({ id: `builtin-${i}`, source: 'builtin', score: 0, likes: 0, ...p }));
  const hidden = new Set(store.hidden);
  const favs = new Set(store.favs);
  return [...store.prompts, ...state.xPrompts, ...seeds]
    .filter((p) => !hidden.has(p.id))
    .map((p) => ({ ...p, fav: favs.has(p.id) }))
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
              save();
              renderPrompts();
            },
          }, p.fav ? '★' : '☆'),
        ),
        el('div', { class: 'meta' },
          el('span', { class: 'badge' }, SOURCE_LABEL[p.source] || p.source),
          p.author ? el('span', {}, p.author) : null,
          p.likes ? el('span', {}, `♥ ${p.likes}`) : null,
          ...(p.tags || []).map((t) => el('span', {}, `#${t}`)),
          p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener' }, '元ツイート') : null,
        ),
        el('div', { class: 'text', onclick: () => card.classList.toggle('open') }, p.text),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => pickScene(p) }, 'このキャラで作る'),
          el('button', {
            onclick: () => {
              if (!confirm('この項目を一覧から消しますか?')) return;
              if (p.source === 'manual') store.prompts = store.prompts.filter((x) => x.id !== p.id);
              else store.hidden = [...store.hidden, p.id];
              save();
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
    const url = f.url.value.trim();
    let text = f.text.value.trim();
    let extra = { url };
    if (url && !text) {
      const t = await fetchTweet(url);
      if (allPrompts().some((p) => p.externalId === t.externalId)) throw new Error('そのツイートは追加済みです');
      text = t.text;
      extra = t;
    }
    if (!text) throw new Error('本文かURLを入力してください');
    const first = text.split('\n').map((s) => s.trim()).find(Boolean);
    const title = f.title.value.trim() || (first.length > 30 ? `${first.slice(0, 30)}…` : first);
    store.prompts = [{ id: uid(), source: 'manual', score: 0, likes: 0, tags: [], ...extra, text, title }, ...store.prompts];
    save();
    f.reset();
    renderPrompts();
    toast('追加しました');
  });
};

// ---------- ③ 作る ----------
function pickScene(p) {
  if (!currentChar()) {
    toast('先に①でキャラを登録してください');
    return showTab('chars');
  }
  state.scene = p;
  $('#makeScene').replaceChildren(el('strong', {}, p.title), el('div', { class: 'muted' }, p.text));
  showTab('make');
  compose(false);
}

async function compose(useAI) {
  const ch = currentChar();
  if (!state.scene || !ch) return;
  $('#refNote').hidden = !ch.image;
  $('#finalPrompt').value = useAI ? await composeWithAI(state.scene, ch, { apiKey: store.openaiKey }) : composeSimple(state.scene, ch);
}

$('#aiCompose').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!store.openaiKey) throw new Error('設定タブで OpenAI APIキーを入れると使えます');
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
      refImage: $('#useRef').checked ? ch?.image : '',
    });
    $('#results').prepend(el('div', { class: 'card' }, el('img', { src, alt: '生成結果' }), el('p', { class: 'muted' }, '長押しで保存')));
    toast('できました');
  });

// ---------- 設定 ----------
$('#keyForm').onsubmit = (ev) => {
  ev.preventDefault();
  const key = ev.target.key.value.trim();
  if (key) {
    store.openaiKey = key;
    save();
  }
  ev.target.reset();
  renderKeyState();
  toast('保存しました');
};
$('#keyClear').onclick = () => {
  store.openaiKey = '';
  save();
  renderKeyState();
  toast('削除しました');
};
function renderKeyState() {
  $('#keyForm').key.placeholder = store.openaiKey ? `保存済み(…${store.openaiKey.slice(-4)})` : 'sk-...';
  $('#genNote').hidden = !!store.openaiKey;
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
    save();
    renderChars();
    renderPrompts();
    toast('復元しました');
  } catch (e) {
    toast(e.message);
  }
  ev.target.value = '';
};

// ---------- init ----------
$('#genCard').append(el('p', { class: 'muted', id: 'genNote' }, '設定タブで OpenAI APIキーを入れると、ここで直接生成できます。今はコピーしてChatGPTに貼ってください。'));
renderKeyState();
renderChars();
await loadXPrompts().catch(() => {});
renderPrompts();
if (!store.chars.length) showTab('chars');
