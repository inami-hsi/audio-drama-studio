import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, characters, contentMode } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured on Vercel environment.' });
  }

  const openai = new OpenAI({ apiKey });

  const modeInstruction = contentMode === "solo"
    ? `【1人用構成案】
       - キャラクターは1名（原則「${characters}」）。
       - タイプは主に "narration" を使用。
       - 重要な語句の後に "pause" (PAUSE_1.0S等) を入れて余韻を作る。`
    : `【複数人用構成案】
       - 登場人物: ${characters}
       - 性格や立場の違いを際立たせ、生き生きとした掛け合いにする。
       - 会話の合間に適切な "pause" を挟み、テンポを調整する。`;

  const systemPrompt = `
あなたはプロの音声ドラマ台本ライターです。
与えられたキーワードに基づき、音声生成AIに最適なCSV形式の台本を作成してください。

■ 出力ルール:
1. 出力は「純粋なCSVデータのみ」としてください。
2. フォーマット: ID,タイプ,セリフ,キャラクター,ボイスID,ページ
   - ID: 連番
   - タイプ: dialogue, narration, pause
   - セリフ: 文章（ダブルクォートで囲む）
   - キャラクター: 名前
   - ボイスID: Clone_1, Female_1, Male_1
   - ページ: 1

${modeInstruction}
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `キーワード: ${prompt}\n登場人物: ${characters}` }
      ],
      temperature: 0.7,
    });

    let text = completion.choices[0].message.content.trim();
    
    // Extract CSV if wrapped in markdown
    const csvMatch = text.match(/```(?:csv|text)?\n([\s\S]*?)\n```/) || text.match(/^ID,[\s\S]*/);
    if (csvMatch) {
      text = csvMatch[1] || csvMatch[0];
    }

    res.status(200).json({ csv: text.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
