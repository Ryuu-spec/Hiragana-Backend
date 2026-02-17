export const config = {
  api: {
    bodyParser: true,
  },
};

// API 키 인덱스 관리 (서버가 켜져 있는 동안 유지)
let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;

    const apiKeys = (process.env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    if (apiKeys.length === 0) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
    }

    // 키 로테이션
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    /**
     * 🛠️ 핵심 수정 사항: 
     * 1. v1 -> v1beta (1.5 모델 지원을 위해 필수)
     * 2. gemini-1.5-flash -> gemini-1.5-flash-latest (인식 에러 해결을 위해 모델명 명시)
     */
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: `Evaluate Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Please respond ONLY with a valid JSON object: {"score":number, "feedback":"string"}` },
            { 
              inlineData: { 
                mimeType: "image/jpeg", 
                // base64 데이터 정제: 'data:image/jpeg;base64,' 등의 접두어가 있다면 제거
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        generationConfig: {
          // 응답 형식을 JSON으로 강제 (v1beta의 강력한 기능)
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();

    // API 응답 에러 핸들링
    if (!response.ok) {
      console.error('Gemini API Error Detail:', JSON.stringify(data, null, 2));
      throw new Error(data.error?.message || 'API 호출 중 오류가 발생했습니다.');
    }

    // 결과 추출
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('모델로부터 응답을 받지 못했습니다.');
    }

    const resultText = data.candidates[0].content.parts[0].text;
    
    // JSON 안전하게 파싱 및 반환
    try {
      const parsedResult = JSON.parse(resultText);
      return res.status(200).json(parsedResult);
    } catch (parseError) {
      // 혹시 모델이 마크다운 형식을 섞었을 경우를 대비한 정규식 추출
      const jsonMatch = resultText.match(/\{.*\}/s);
      if (jsonMatch) {
        return res.status(200).json(JSON.parse(jsonMatch[0]));
      }
      throw new Error('응답 데이터를 해석할 수 없습니다.');
    }

  } catch (error) {
    console.error('Server Handler Error:', error.message);
    return res.status(500).json({ 
      error: '서버 에러가 발생했습니다.', 
      details: error.message 
    });
  }
}
