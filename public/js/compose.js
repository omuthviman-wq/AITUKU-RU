// シーン用プロンプト + 保存済みキャラ → ChatGPT にそのまま投げられるプロンプトを作る。

export function characterBlock(ch) {
  const lines = [`名前: ${ch.name}`];
  const field = (label, v) => (v.includes('\n') ? `${label}:\n${v}` : `${label}: ${v}`);
  if (ch.appearance) lines.push(field('外見', ch.appearance));
  if (ch.extra) lines.push(field('補足', ch.extra));
  if (ch.images?.length) lines.push(`添付の参考画像${ch.images.length > 1 ? `(${ch.images.length}枚、すべて同じ人物)` : ''}のキャラクターと同一人物として、顔立ち・髪型・髪色・体型を一致させてください。`);
  lines.push('※登場人物は成人(20代)として描写してください。');
  return lines.join('\n');
}

// キャラ設定は AI に書き換えさせず、登録した文章をそのまま入れる(要約されて体型などが消えるのを防ぐ)
export function composeSimple(scene, ch, sceneText = scene.text) {
  return [
    '以下の【シーン】の構図・衣装・ポーズ・表情・ライティング・画風を使い、登場人物を【キャラクター】に置き換えて画像を1枚生成してください。',
    '【キャラクター】に書かれた外見(年齢・身長・頭身・体型・スタイル・髪型・顔など)は省略せず、すべて正確に反映してください。',
    '【シーン】内に人物の外見(髪型・髪色・顔立ち・体型・名前など)の記述がある場合は、【キャラクター】の設定を優先してください。',
    '',
    '【キャラクター】',
    characterBlock(ch),
    '',
    '【シーン】',
    sceneText.trim(),
  ].join('\n');
}

const SYSTEM = `あなたは画像生成AI(ChatGPT の画像生成)向けのプロンプトエンジニアです。
ユーザーから「シーン用プロンプト」と、参考として「キャラクター設定」が渡されます。
あなたの仕事は【シーン部分だけ】を、日本語の分かりやすい画像生成用の描写に書き直すことです。
キャラクター設定は別途そのまま付け足すので、あなたの出力には含めないでください。
- 構図・カメラアングル・衣装・ポーズ・表情・場所・ライティング・画風・色気のある雰囲気は、具体的にできるだけ残す
- 元のシーンにある人物の外見(年齢・国籍・髪型・髪色・顔立ち・体型・名前)の記述は削除し、人物は「彼女」と呼ぶ
- キャラクター設定と矛盾する描写(例: 髪の長さ・体型)があれば削除する
- 外国語のシーンは日本語に訳す。「リプに続く」などプロンプト以外の文章は捨てる
- 露出は水着・ランジェリー程度までにとどめ、ChatGPT のポリシーで拒否されにくい表現にする(ヌード・性行為の描写は入れない)
- 出力はシーンの描写本文のみ。前置き・見出し・説明は書かない`;

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
  return composeSimple(scene, ch, text);
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
    return composeSimple(scene, ch, text);
  }
  throw lastError;
}
