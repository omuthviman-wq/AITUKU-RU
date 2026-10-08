// OpenAI Images API(ChatGPT の画像生成と同じ gpt-image 系)をブラウザから直接呼ぶ。
// 参考画像があれば edits に添付して見た目を寄せる。
export const IMAGE_MODEL = 'gpt-image-1';

export async function generateImage({ apiKey, prompt, size, quality, refImage }) {
  let res;
  if (refImage) {
    const form = new FormData();
    form.append('model', IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('image[]', await (await fetch(refImage)).blob(), 'reference.jpg');
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality, moderation: 'low', n: 1 }),
    });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `OpenAI error ${res.status}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像データが返ってきませんでした');
  return `data:image/png;base64,${b64}`;
}
