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

export const TEXT_MODEL = 'gpt-5-mini';

export async function composeWithAI(scene, ch, { apiKey, model = TEXT_MODEL }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `【シーン用プロンプト】\n${scene.text.trim()}\n\n【キャラクター設定】\n${characterBlock(ch)}`,
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenAI error ${res.status}`);
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI から空の応答が返りました');
  return text;
}
