let currentKeyIndex = 0;

export default async function handler(req, res) {
  // 브라우저 보안 정책(CORS) 해결
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    const apiKeys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim());
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    // ✅ 에러가 났던 주소 대신, 가장 안정적인 v1 버전으로 호출합니다.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Evaluate the handwritten Hiragana '${target}'. Focus on stroke balance. Provide a score (0-100) and short Korean feedback. Output MUST be in valid JSON format: {"score": number, "feedback": "string"}` },
              { inlineData: { mimeType: "image/jpeg", data: imageData } }
            ]
          }]
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini API Error');
    
    // AI 응답에서 순수 JSON 데이터만 추출
    let resultText = data.candidates[0].content.parts[0].text;
    const jsonMatch = resultText.match(/\{.*\}/s);
    if (jsonMatch) resultText = jsonMatch[0];
    
    return res.status(200).json(JSON.parse(resultText));
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류', details: error.message });
  }
}
