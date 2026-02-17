export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

// 서버 실행 중 키 로테이션을 위한 인덱스
let currentKeyIndex = 0;

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    
    // Vercel 환경변수에서 API 키들을 가져옴
    const apiKeys = (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    if (apiKeys.length === 0) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
    }

    // 키 선택 및 로테이션
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    /**
     * 💡 모델 설정 변경:
     * gemini-2.0-flash에서 할당량 부족 에러가 발생하므로, 
     * 가장 안정적이고 무료 할당량이 넉넉한 'gemini-1.5-flash'를 사용합니다.
     */
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
                // Base64 데이터에서 접두어가 있다면 제거
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        generationConfig: {
          responseMimeType: "application/json", // 응답을 순수 JSON으로 강제
        }
      })
    });

    const data = await response.json();

    // 에러 핸들링
    if (!response.ok) {
      console.error('Gemini API Error:', data);
      
      // 할당량 에러(Quota Exceeded)에 대한 친절한 안내
      if (data.error?.message.toLowerCase().includes("quota") || data.error?.message.includes("limit")) {
        return res.status(429).json({ 
          error: '할당량 부족', 
          details: '현재 API 키의 무료 사용량이 소진되었습니다. 잠시 후 다시 시도하거나 새 키를 발급받으세요.' 
        });
      }
      throw new Error(data.error?.message || 'API 호출 중 오류 발생');
    }

    // 결과 추출 및 파싱
    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    console.error('Server Handler Error:', error.message);
    return res.status(500).json({ error: '서버 에러가 발생했습니다.', details: error.message });
  }
}
