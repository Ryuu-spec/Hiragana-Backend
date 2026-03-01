export default async function handler(req, res) {
  // 1. CORS 문제 해결을 위한 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

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
              { text: `이 히라가나 '${target}'를 채점해줘. 결과는 반드시 JSON으로만 응답해.` },
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

    // [중요] 데이터 존재 여부를 먼저 확인하여 TypeError 방지
    if (!data.candidates || data.candidates.length === 0) {
      console.error("AI 응답 생성 실패:", JSON.stringify(data));
      return res.status(500).json({ error: "AI가 응답을 생성하지 못했습니다.", detail: data });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (err) {
    console.error("서버 내부 오류:", err.message);
    return res.status(500).json({ error: "서버 에러", message: err.message });
  }
}
