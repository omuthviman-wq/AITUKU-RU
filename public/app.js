const $ = (s) => document.querySelector(s);

const state = { config: {}, chars: [], prompts: [], scene: null };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `エラー ${res.status}`);
  return json;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
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
}
for (const b of document.querySelectorAll('nav button')) b.onclick = () => showTab(b.dataset.tab);

// ---------- ① キャラ ----------
const currentCharId = () => $('#currentChar').value;
const currentChar = () => state.chars.find((c) => c.id === currentCharId());

async function loadChars() {
  state.chars = await api('GET', '/api/characters');
  const sel = $('#currentChar');
  const saved = localStorage.getItem('currentChar');
  sel.replaceChildren(
    ...(state.chars.length ? state.chars.map((c) => el('option', { value: c.id }, c.name)) : [el('option', { value: '' }, '未登録')]),
  );
  if (state.chars.some((c) => c.id === saved)) sel.value = saved;
  renderChars();
}
$('#currentChar').onchange = () => {
  localStorage.setItem('currentChar', currentCharId());
  if (state.scene) compose(false);
};

function renderChars() {
  $('#charList').replaceChildren(
    ...state.chars.map((c) =>
      el('div', { class: 'card char' },
        c.hasImage ? el('img', { src: `/images/${c.id}.png?v=${c.imageVersion || 0}`, alt: c.name }) : null,
        el('h2', {}, c.name),
        c.appearance ? el('p', {}, c.appearance) : null,
        c.extra ? el('p', { class: 'muted' }, c.extra) : null,
        el('div', { class: 'row' },
          el('button', { onclick: () => editChar(c) }, '編集'),
          el('button', {
            onclick: async () => {
              if (!confirm(`${c.name} を削除しますか?`)) return;
              await api('DELETE', `/api/characters/${c.id}`);
              await loadChars();
            },
          }, '削除'),
        ),
      ),
    ),
  );
}

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
  $('#charForm').reset();
  $('#charForm').id.value = '';
  $('#charFormTitle').textContent = 'キャラを登録';
  $('#charCancel').hidden = true;
}
$('#charCancel').onclick = resetCharForm;

// 参考画像は1024px以内のPNGに変換してから送る
function toPng(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

$('#charForm').onsubmit = (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f.querySelector('button[type=submit]'), async () => {
    const body = { name: f.name.value, appearance: f.appearance.value, extra: f.extra.value, adult: f.adult.checked };
    const ch = f.id.value ? await api('PUT', `/api/characters/${f.id.value}`, body) : await api('POST', '/api/characters', body);
    if (f.image.files[0]) await api('POST', `/api/characters/${ch.id}/image`, { dataUrl: await toPng(f.image.files[0]) });
    localStorage.setItem('currentChar', ch.id);
    resetCharForm();
    await loadChars();
    toast(`${ch.name} を保存しました`);
  });
};

// ---------- ② プロンプト一覧 ----------
async function loadPrompts() {
  state.prompts = await api('GET', '/api/prompts');
  renderPrompts();
}

const SOURCE_LABEL = { x: 'X', manual: '手動', builtin: '内蔵' };

function renderPrompts() {
  const q = $('#search').value.trim().toLowerCase();
  const src = $('#sourceFilter').value;
  const list = state.prompts.filter((p) => {
    if (src === 'fav' ? !p.fav : src && p.source !== src) return false;
    return !q || `${p.title}\n${p.text}\n${(p.tags || []).join(' ')}`.toLowerCase().includes(q);
  });
  $('#promptList').replaceChildren(
    ...(list.length ? list : []).map((p) => {
      const card = el('div', { class: 'card prompt' },
        el('div', { class: 'row spread' },
          el('h2', {}, p.title),
          el('button', {
            class: `star ${p.fav ? 'on' : ''}`,
            title: 'お気に入り',
            onclick: async () => {
              await api('PUT', `/api/prompts/${p.id}`, { fav: !p.fav });
              await loadPrompts();
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
            onclick: async () => {
              if (!confirm('この項目を削除しますか?')) return;
              await api('DELETE', `/api/prompts/${p.id}`);
              await loadPrompts();
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

$('#fetchX').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!state.config.hasX) throw new Error('.env に X_BEARER_TOKEN を設定すると自動収集できます。今はURL貼り付けで追加してください。');
    const r = await api('POST', '/api/prompts/fetch-x');
    await loadPrompts();
    toast(`${r.total}件ヒット、新規 ${r.added}件を追加しました`);
  });

$('#addForm').onsubmit = (ev) => {
  ev.preventDefault();
  const f = ev.target;
  busy(f.querySelector('button'), async () => {
    await api('POST', '/api/prompts', { url: f.url.value.trim(), text: f.text.value.trim(), title: f.title.value.trim() });
    f.reset();
    await loadPrompts();
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
  $('#refNote').hidden = !ch.hasImage;
  const { prompt } = await api('POST', '/api/compose', { promptId: state.scene.id, characterId: ch.id, useAI });
  $('#finalPrompt').value = prompt;
}

$('#aiCompose').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!state.scene) throw new Error('先に②でシーンを選んでください');
    await compose(true);
    toast('AIで合成しました');
  });

async function copyPrompt() {
  await navigator.clipboard.writeText($('#finalPrompt').value);
  toast('コピーしました');
}
$('#copyBtn').onclick = () => copyPrompt().catch((e) => toast(e.message));
$('#openChatGPT').onclick = async () => {
  const text = $('#finalPrompt').value;
  await copyPrompt().catch(() => {});
  // ?q= で入力欄に流し込まれる(長すぎるとURLが切れるので、その時は貼り付けで)
  const url = text.length < 1800 ? `https://chatgpt.com/?q=${encodeURIComponent(text)}` : 'https://chatgpt.com/';
  window.open(url, '_blank', 'noopener');
};

$('#generate').onclick = (ev) =>
  busy(ev.target, async () => {
    if (!state.config.hasOpenAI) throw new Error('.env に OPENAI_API_KEY を設定するとワンボタン生成できます');
    const prompt = $('#finalPrompt').value;
    toast('生成中…(30秒〜1分ほどかかります)');
    const { url } = await api('POST', '/api/generate', {
      prompt,
      characterId: currentCharId(),
      size: $('#size').value,
      quality: $('#quality').value,
      useRef: $('#useRef').checked,
    });
    $('#results').prepend(
      el('a', { href: url, target: '_blank', class: 'card' }, el('img', { src: url, alt: '生成結果' })),
    );
    toast('できました');
  });

// ---------- init ----------
state.config = await api('GET', '/api/config');
if (!state.config.hasOpenAI) {
  $('#aiCompose').title = '.env に OPENAI_API_KEY が必要です';
  $('#genCard').append(el('p', { class: 'muted' }, 'OPENAI_API_KEY 未設定のため、今はコピーしてChatGPTに貼る運用になります。'));
}
await Promise.all([loadChars(), loadPrompts()]);
if (!state.chars.length) showTab('chars');
