export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // 이미지 업로드를 위해 용량 제한을 늘리는 것이 좋습니다
    },
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

    // 💡 핵심 수정: 모델명을 변수로 분리하고 URL 형식을 가장 표준적인 v1beta로 고정
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
                // 접두어 제거 로직
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        // v1beta에서 JSON 응답을 강제하는 가장 정확한 설정
        generationConfig: {
          responseMimeType: "application/json",
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API 상세 에러:', data);
      // 만약 1.5-flash를 못 찾는다면 1.5-pro로 자동 폴백(Fallback) 시도 로직을 넣을 수도 있습니다.
      throw new Error(data.error?.message || 'API Error');
    }

    // 결과값 추출
    const resultText = data.candidates[0].content.parts[0].text;
    
    // JSON 응답이 확실하므로 바로 파싱
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    console.error('서버 에러 발생:', error.message);
    return res.status(500).json({ error: '서버 에러', details: error.message });
  }
}
