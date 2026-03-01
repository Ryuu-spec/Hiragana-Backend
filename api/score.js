export default async function handler(req, res) {
  // CORS 헤더 설정 (에러 방지)
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
          // Gemini 3 Flash 규격에 맞춘 구조
          contents: [{
            parts: [
              { text: `이 히라가나 '${target}'를 채점해줘. JSON 형식으로만 답해.` },
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

    // 에러 방지: 데이터가 있는지 먼저 확인
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.error("API Response Error:", data);
      return res.status(500).json({ error: "AI가 응답을 생성하지 못했습니다.", detail: data });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (err) {
    return res.status(500).json({ error: "서버 에러", message: err.message });
  }
}
