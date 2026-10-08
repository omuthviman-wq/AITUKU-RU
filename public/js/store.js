// データはすべてこのスマホのブラウザ内(IndexedDB)に保存する。サーバーには送らない。
// 参考画像を何枚も入れるので、容量の小さい localStorage ではなく IndexedDB を使う。
const DB = 'aituku-ru';
const KEY = 'aituku-ru:v1'; // 旧バージョン(localStorage)のキー

const empty = () => ({ chars: [], prompts: [], favs: [], hidden: [], edits: {}, currentChar: '', openaiKey: '' });

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// 古いデータ形式を今の形に直す
function migrate(s) {
  for (const c of s.chars) {
    if (!c.images) c.images = c.image ? [c.image] : [];
    delete c.image;
  }
  return s;
}

export async function loadStore() {
  try {
    const saved = await kv('readonly', (os) => os.get('store'));
    if (saved) return migrate({ ...empty(), ...saved });
  } catch {}
  try {
    return migrate({ ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') });
  } catch {
    return empty();
  }
}

export async function saveStore(s) {
  try {
    await kv('readwrite', (os) => os.put(structuredClone(s), 'store'));
  } catch {
    throw new Error('保存できませんでした(容量オーバーかプライベートモード)。参考画像を減らしてください。');
  }
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function exportStore(s) {
  const { openaiKey, ...rest } = s; // キーはバックアップに含めない
  return JSON.stringify(rest);
}

export function importStore(s, json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.chars)) throw new Error('バックアップ形式が違います');
  return migrate({ ...empty(), ...data, openaiKey: s.openaiKey });
}
