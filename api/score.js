export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

// 키 로테이션을 위한 인덱스
let currentKeyIndex = 0;

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;

    // 환경변수에서 키 리스트 가져오기
    const apiKeys = (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    if (apiKeys.length === 0) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
    }

    // 현재 사용할 키 선택 및 다음을 위해 인덱스 증가
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    // 💡 1.5 Flash 모델로 설정 (2.0에서 0 할당량 에러가 났으므로 가장 안전한 선택)
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
        generationConfig: {
          responseMimeType: "application/json",
        }
      })
    });

    const data = await response.json();

    // 💡 할당량(Quota) 에러 대응 로직
    if (!response.ok) {
      console.error('API 에러 상세:', JSON.stringify(data, null, 2));
      
      if (data.error?.message.includes("quota")) {
        return res.status(429).json({ 
          error: '할당량 초과', 
          details: '현재 API 키의 무료 사용량이 소진되었거나 제한되었습니다. 다른 키를 확인해 보세요.' 
        });
      }
      throw new Error(data.error?.message || 'API Error');
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    console.error('서버 핸들러 에러:', error.message);
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}
