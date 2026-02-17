export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    const apiKeys = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k);

    if (apiKeys.length === 0) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    // 💡 2.0-flash가 limit: 0 이므로, 가장 범용적인 1.5-flash를 사용합니다.
    const model = "gemini-1.5-flash"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: `Evaluate the handwritten Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Respond ONLY in JSON format: {"score":number, "feedback":"string"}` },
            { 
              inlineData: { 
                mimeType: "image/jpeg", 
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // 에러가 발생하면 모델명과 함께 리턴하여 디버깅을 돕습니다.
      return res.status(response.status).json({ 
        error: 'API 에러', 
        details: data.error?.message,
        tried_model: model 
      });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}
