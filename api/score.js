export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { target, imageData } = req.body;

  if (!target || !imageData) {
    return res.status(400).json({ error: 'target과 imageData가 필요합니다.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  const prompt = `당신은 일본어 히라가나 필기 채점 전문가입니다.
사용자가 히라가나 '${target}'을(를) 손으로 쓴 이미지를 분석해주세요.

다음 기준으로 0~100점 사이의 점수를 매겨주세요:
- 글자의 정확성 (획의 모양, 방향, 구성)
- 비율과 균형
- 전체적인 가독성

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:
{"score": 숫자, "feedback": "한국어로 2~3문장의 구체적인 피드백"}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300,
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API 오류:', errText);
      return res.status(502).json({ error: 'Gemini API 호출 실패', detail: errText });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // JSON 파싱 (마크다운 코드블록 제거)
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (typeof parsed.score !== 'number' || !parsed.feedback) {
      throw new Error('응답 형식 오류');
    }

    return res.status(200).json({
      score: Math.round(Math.max(0, Math.min(100, parsed.score))),
      feedback: parsed.feedback
    });

  } catch (err) {
    console.error('처리 오류:', err);
    return res.status(500).json({ error: '채점 중 오류가 발생했습니다.', detail: err.message });
  }
}
