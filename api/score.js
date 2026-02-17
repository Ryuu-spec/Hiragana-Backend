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

    // 핵심 수정 부분: v1 -> v1beta 로 변경
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
                // base64 데이터에 접두어(data:image/jpeg;base64,)가 붙어있는 경우 제거 로직 추가
                data: imageData.includes(',') ? imageData.split(',')[1] : imageData 
              } 
            }
          ] 
        }],
        // 응답 형식을 JSON으로 강제하여 파싱 에러 방지 (v1beta 기능)
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();

    // API 응답 에러 핸들링 강화
    if (!response.ok) {
      console.error('Gemini API Error:', data);
      throw new Error(data.error?.message || 'API Error');
    }

    // 결과 추출 및 파싱
    let resultText = data.candidates[0].content.parts[0].text;
    
    // JSON 응답을 더 안전하게 파싱
    try {
      const parsedResult = JSON.parse(resultText);
      return res.status(200).json(parsedResult);
    } catch (parseError) {
      // 정규식으로 JSON만 추출 시도 (만약의 경우 대비)
      const jsonMatch = resultText.match(/\{.*\}/s);
      if (jsonMatch) {
        return res.status(200).json(JSON.parse(jsonMatch[0]));
      }
      throw new Error('JSON 파싱에 실패했습니다.');
    }

  } catch (error) {
    console.error('Server Handler Error:', error);
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}
