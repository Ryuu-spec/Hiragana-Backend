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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `이 히라가나 '${target}'를 채점해줘. JSON 형식으로 응답해.` },
              { inline_data: { mime_type: "image/png", data: imageData.split(',')[1] } }
            ]
          }],
          generationConfig: { response_mime_type: "application/json" }
        })
      }
    );

    const data = await response.json();

    // 2. 안전한 데이터 추출 (서버 죽음 방지)
    if (!data.candidates || data.candidates.length === 0) {
      return res.status(500).json({ error: "AI 응답 생성 실패", detail: data });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (err) {
    // 에러 발생 시 로그를 찍고 클라이언트에 전달
    console.error("Error details:", err.message);
    return res.status(500).json({ error: "서버 내부 에러", message: err.message });
  }
}
