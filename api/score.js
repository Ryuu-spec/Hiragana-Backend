export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `당신은 일본어 히라가나 쓰기 선생님입니다. 학습자가 쓴 히라가나 '${target}'를 평가해주세요.

점수는 100점 만점으로 채점하되, 일반적인 학습자 수준에서 관대하게 평가해주세요. 획의 기본 형태가 맞으면 70점 이상, 잘 썼으면 85점 이상을 주세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "score": 숫자(0-100),
  "feedback": "한국어로 2-3문장 피드백. 잘된 점과 개선할 점을 함께 언급해주세요."
}` },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }]
        })
      }
    );

    const data = await response.json();

    if (data.candidates && data.candidates[0]) {
      const candidate = data.candidates[0];
      const parts = candidate?.content?.parts;

      if (!parts || !parts[0]) {
        return res.status(500).json({ error: "parts 없음", detail: data });
      }

      const resultText = parts[0].text;

      if (!resultText) {
        return res.status(500).json({ error: "text 없음", detail: candidate });
      }

      const cleaned = resultText.replace(/```json|```/g, '').trim();

      try {
        return res.status(200).json(JSON.parse(cleaned));
      } catch(e) {
        return res.status(500).json({ error: "JSON 파싱 실패", raw: resultText });
      }

    } else {
      return res.status(500).json({ error: "candidates 없음", detail: data });
    }

  } catch (err) {
    return res.status(500).json({ error: "서버 연결 실패", message: err.message });
  }
}
