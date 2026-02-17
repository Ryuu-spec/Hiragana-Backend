let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { target, imageData } = req.body;
    const apiKeys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim());
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: `Evaluate Hiragana '${target}'. Give a score (0-100) and short Korean feedback. Response MUST be in JSON format: {"score": number, "feedback": "string"}` },
            { inlineData: { mimeType: "image/jpeg", data: imageData } }
          ] }],
          generationConfig: { 
            // ✅ 에러 원인인 responseMimeType을 제거하고 기본 설정으로 진행합니다.
            temperature: 0.1,
            topP: 0.95,
            topK: 64,
            maxOutputTokens: 1024,
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini API Error');
    
    // AI가 텍스트 앞뒤에 ```json 등을 붙일 경우를 대비해 순수 JSON만 추출합니다.
    let resultText = data.candidates[0].content.parts[0].text;
    const jsonMatch = resultText.match(/\{.*\}/s);
    if (jsonMatch) {
        resultText = jsonMatch[0];
    }
    
    return res.status(200).json(JSON.parse(resultText));
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류', details: error.message });
  }
}
