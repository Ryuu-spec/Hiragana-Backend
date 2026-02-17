// 키 순환을 위한 전역 변수
let currentKeyIndex = 0;

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { target, imageData } = req.body;
    if (!target || !imageData) {
      return res.status(400).json({ error: '필수 데이터가 없습니다.' });
    }

    const apiKeysString = process.env.GEMINI_API_KEYS;
    if (!apiKeysString) {
      throw new Error('GEMINI_API_KEYS 환경 변수가 설정되지 않았습니다.');
    }

    const apiKeys = apiKeysString.split(',').map(key => key.trim());
    const modelName = "gemini-1.5-flash"; 
    const systemPrompt = `Evaluate Hiragana '${target}'. Check strokes, balance. Score(0-100) and short Korean feedback. JSON:{"score":number,"feedback":string}`;

    let lastError = null;
    
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      try {
        const apiKey = apiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        
        // ✅ v1 정식 버전 주소로 수정 완료
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ 
                parts: [
                  { text: systemPrompt }, 
                  { inlineData: { mimeType: "image/jpeg", data: imageData } }
                ] 
              }],
              generationConfig: { 
                responseMimeType: "application/json",
                temperature: 0.1
              }
            })
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error(`키 ${currentKeyIndex} 실패:`, errorData.error?.message);
          if (response.status === 429) continue; // 할당량 초과 시 다음 키로
          throw new Error(`Gemini API 오류: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        const result = JSON.parse(resultText);
        
        return res.status(200).json(result);
        
      } catch (error) {
        lastError = error;
        if (attempt === apiKeys.length - 1) {
          throw new Error(`모든 API 키 실패. 마지막 오류: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: '서버 오류가 발생했습니다.',
      details: error.message 
    });
  }
}
