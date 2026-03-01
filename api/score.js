module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `당신은 냉철한 일본어 서예 감정사입니다. 결과를 반드시 JSON으로만 응답하세요. 이 히라가나 '${target}'를 채점해줘.` },
              { inline_data: { mime_type: "image/png", data: imageData.split(',')[1] } }
            ]
          }],
          generationConfig: { 
            temperature: 0 
          }
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

      // JSON 블록 마크다운 제거 후 파싱
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
