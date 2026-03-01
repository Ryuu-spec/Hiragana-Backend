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
              { text: `당신은 일본어 히라가나 쓰기 채점 선생님입니다.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 아래 5가지 항목을 각각 채점하세요.
학습자 수준에서 관대하게 평가하되, 이미지를 실제로 보고 항목마다 다른 점수를 주세요.

채점 기준:
- 형태정확성 (0~35): 획의 전체적인 형태가 '${target}'와 얼마나 닮았는가
- 필순 (0~25): 획의 순서와 개수가 맞는가
- 획방향 (0~20): 각 획의 방향과 흐름이 올바른가
- 끝맺음 (0~10): 획의 시작과 끝 처리가 자연스러운가
- 균형비율 (0~10): 글자의 크기, 위치, 균형이 잘 맞는가

반드시 아래 JSON 형식으로만 응답하고, 다른 텍스트는 절대 포함하지 마세요:
{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2~3문장. 잘된 점과 개선할 점을 함께."
}` },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }]
        })
      }
    );

    const data = await response.json();

    if (data.candidates && data.candidates[0]) {
      const parts = data.candidates[0]?.content?.parts;
      if (!parts || !parts[0]) {
        return res.status(500).json({ error: "parts 없음", detail: data });
      }
      const resultText = parts[0].text;
      if (!resultText) {
        return res.status(500).json({ error: "text 없음", detail: data.candidates[0] });
      }
      const cleaned = resultText.replace(/```json|```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        // 총점 계산해서 함께 반환
        parsed.score = (parsed.형태정확성 || 0) + (parsed.필순 || 0) + (parsed.획방향 || 0) + (parsed.끝맺음 || 0) + (parsed.균형비율 || 0);
        return res.status(200).json(parsed);
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
