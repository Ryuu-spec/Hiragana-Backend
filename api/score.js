export default async function handler(req, res) {
  // 모든 출처(Origin)로부터의 요청을 허용함
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 브라우저가 보낸 사전 점검(OPTIONS) 요청에 200 OK로 즉시 응답
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const response = await fetch(
      // Gemini 3 Flash v1beta 엔드포인트 사용
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `이 히라가나 '${target}'를 채점해줘. JSON 형식으로만 응답해.` },
              { inline_data: { mime_type: "image/png", data: imageData.split(',')[1] } }
            ]
          }],
          generationConfig: { 
            response_mime_type: "application/json",
            temperature: 0 
          }
        })
      }
    );

    const data = await response.json();

    // 데이터 구조가 안전한지 확인 (TypeError 방지)
    if (!data.candidates || data.candidates.length === 0) {
      return res.status(500).json({ error: "AI 응답 생성 실패", detail: data });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (err) {
    return res.status(500).json({ error: "서버 에러", message: err.message });
  }
}
