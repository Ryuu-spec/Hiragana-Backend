export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    // 환경변수에서 첫 번째 키를 가져옵니다.
    const apiKey = (process.env.GEMINI_API_KEYS || '').split(',')[0].trim();

    if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

    // 💡 가장 범용적인 모델명과 안정적인 v1 API 주소 사용
    const model = "gemini-1.5-flash"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: `Evaluate the handwritten Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Respond ONLY in JSON: {"score":number, "feedback":"string"}` },
            { 
              inlineData: { 
                mimeType: "image/jpeg", 
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        generationConfig: { 
          responseMimeType: "application/json" 
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // ⚠️ 여기서 'Quota exceeded'나 'limit: 0'이 뜬다면 계정 자체의 문제입니다.
      return res.status(response.status).json({ 
        error: '구글 API 제한', 
        details: data.error?.message 
      });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    return res.status(500).json({ error: '서버 에러', details: error.message });
  }
}
