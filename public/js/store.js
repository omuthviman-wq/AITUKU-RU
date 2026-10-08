// データはすべてこのスマホのブラウザ内(localStorage)に保存する。サーバーには送らない。
const KEY = 'aituku-ru:v1';

const empty = () => ({ chars: [], prompts: [], favs: [], hidden: [], currentChar: '', openaiKey: '' });

export function loadStore() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return empty();
  }
}

export function saveStore(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    throw new Error('保存できませんでした(容量オーバーかプライベートモード)。参考画像を減らしてください。');
  }
}

export function exportStore(s) {
  const { openaiKey, ...rest } = s; // キーはバックアップに含めない
  return JSON.stringify(rest);
}

export function importStore(s, json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.chars)) throw new Error('バックアップ形式が違います');
  return { ...empty(), ...data, openaiKey: s.openaiKey };
}
