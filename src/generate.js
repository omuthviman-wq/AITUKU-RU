// OpenAI Images API で生成(ChatGPT の画像生成と同じ gpt-image 系モデル)。
// キャラに参考画像があれば edits エンドポイントに添付して見た目を寄せる。
import { readFile } from 'node:fs/promises';

export async function generateImage({ apiKey, model, prompt, size, quality, refImagePath }) {
  let res;
  if (refImagePath) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('image[]', new Blob([await readFile(refImagePath)], { type: 'image/png' }), 'reference.png');
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, size, quality, moderation: 'low', n: 1 }),
    });
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenAI error ${res.status}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像データが返ってきませんでした');
  return Buffer.from(b64, 'base64');
}
