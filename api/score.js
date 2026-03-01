export default async function handler(req, res) {
  // CORS 대응 헤더 추가
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `사용자가 쓴 히라가나 '${target}'를 채점하고 JSON으로만 답해.` },
              { inline_data: { mime_type: "image/png", data: imageData.split(',')[1] } }
            ]
          }],
          generationConfig: { response_mime_type: "application/json" }
        })
      }
    );

    const data = await response.json();

    // [중요] 데이터 구조가 안전한지 확인
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const resultText = data.candidates[0].content.parts[0].text;
      return res.status(200).json(JSON.parse(resultText));
    } else {
      // AI가 답변을 안 줬을 때의 상세 로그
      console.error("AI Response Error:", JSON.stringify(data));
      return res.status(500).json({ error: "AI 답변 없음", detail: data });
    }

  } catch (err) {
    return res.status(500).json({ error: "서버 에러", message: err.message });
  }
}
