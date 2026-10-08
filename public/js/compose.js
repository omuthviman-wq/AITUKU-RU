// シーン用プロンプト + 保存済みキャラ → ChatGPT にそのまま投げられるプロンプトを作る。

export function characterBlock(ch) {
  const lines = [`名前: ${ch.name}`];
  if (ch.appearance) lines.push(`外見: ${ch.appearance}`);
  if (ch.extra) lines.push(`補足: ${ch.extra}`);
  if (ch.images?.length) lines.push(`添付の参考画像${ch.images.length > 1 ? `(${ch.images.length}枚、すべて同じ人物)` : ''}のキャラクターと同一人物として、顔立ち・髪型・髪色・体型を一致させてください。`);
  lines.push('※登場人物は成人(20代)として描写してください。');
  return lines.join('\n');
}

export function composeSimple(scene, ch) {
  return [
    '以下の【シーン】の構図・衣装・ポーズ・表情・ライティング・画風を使い、登場人物を【キャラクター】に置き換えて画像を1枚生成してください。',
    '【シーン】内に人物の外見(髪型・髪色・顔立ち・名前など)の記述がある場合は、【キャラクター】の設定を優先してください。',
    '',
    '【キャラクター】',
    characterBlock(ch),
    '',
    '【シーン】',
    scene.text.trim(),
  ].join('\n');
}

const SYSTEM = `あなたは画像生成AI(ChatGPT の画像生成)向けのプロンプトエンジニアです。
ユーザーから「シーン用プロンプト」と「キャラクター設定」が渡されます。
シーンの構図・衣装・ポーズ・表情・ライティング・画風・色気のある雰囲気はできるだけ残したまま、
人物の外見をキャラクター設定に完全に置き換えた、1つの日本語の画像生成プロンプトに書き直してください。
- 露出は水着・ランジェリー程度までにとどめ、ChatGPT のポリシーで拒否されにくい表現にする(ヌード・性行為の描写は入れない)
- 人物は必ず成人として描写する
- 参考画像がある場合は「添付画像のキャラクターと同一人物として」と明記する
- 出力はプロンプト本文のみ。前置きや説明は書かない`;

const userMessage = (scene, ch) => `【シーン用プロンプト】\n${scene.text.trim()}\n\n【キャラクター設定】\n${characterBlock(ch)}`;

export const TEXT_MODEL = 'gpt-5-mini';

export async function composeWithAI(scene, ch, { apiKey, model = TEXT_MODEL }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMessage(scene, ch) },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenAI error ${res.status}`);
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI から空の応答が返りました');
  return text;
}

// Gemini(Google AI Studio の無料APIキーで使える)。安全フィルターは一番ゆるく設定。
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const SAFETY_OFF = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({
  category: `HARM_CATEGORY_${c}`,
  threshold: 'BLOCK_NONE',
}));

export async function composeWithGemini(scene, ch, { apiKey }) {
  let lastError;
  for (const model of GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userMessage(scene, ch) }] }],
        safetySettings: SAFETY_OFF,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) {
      // モデル名が廃止されていたら次の候補へ
      lastError = new Error(json.error?.message || `Gemini error ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini: ${json.error?.message || res.status}`);
    if (json.promptFeedback?.blockReason) throw new Error(`Gemini に断られました(${json.promptFeedback.blockReason})。シーンを少しマイルドにしてください`);
    const cand = json.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!text) throw new Error(`Gemini に断られました(${cand?.finishReason || '空の応答'})。シーンを少しマイルドにしてください`);
    return text;
  }
  throw lastError;
}
