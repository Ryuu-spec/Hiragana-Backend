// 키 순환을 위한 전역 변수
let currentKeyIndex = 0;

// Vercel Serverless Function
export default async function handler(req, res) {
  // CORS 설정 (Genially에서 호출 가능하도록)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS 요청 처리 (CORS preflight)
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

    // 환경 변수에서 API 키들 가져오기 (쉼표로 구분)
    const apiKeysString = process.env.GEMINI_API_KEYS;
    const apiKeys = apiKeysString.split(',').map(key => key.trim());
    
    const modelName = "gemini-2.5-flash-lite";  // 하루 1,000회/키
    const systemPrompt = `Evaluate Hiragana '${target}'. Check strokes, balance. Score(0-100) and short Korean feedback. JSON:{"score":number,"feedback":string}`;

    // 모든 키로 시도
    let lastError = null;
    
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      try {
        // 다음 키 선택 (순환)
        const apiKey = apiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        
        console.log(`API 키 ${attempt + 1}/${apiKeys.length} 사용 중...`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
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
          
          // Rate limit 에러인 경우 다음 키로 시도
          if (response.status === 429) {
            console.log(`API 키 ${attempt + 1} Rate limit, 다음 키 시도...`);
            lastError = new Error('Rate limit exceeded');
            continue;
          }
          
          // 다른 에러는 바로 throw
          throw new Error(`Gemini API 오류: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        const result = JSON.parse(data.candidates[0].content.parts[0].text);
        
        console.log(`✅ API 키 ${attempt + 1} 성공!`);
        return res.status(200).json(result);
        
      } catch (error) {
        lastError = error;
        console.log(`API 키 ${attempt + 1} 실패:`, error.message);
        
        // 마지막 키까지 실패하면 에러 반환
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
```

4. **"Commit changes" 클릭**

---

### ⚙️ 4단계: Vercel 환경 변수 설정

1. **Vercel 대시보드 → Settings 탭**

2. **Environment Variables 클릭**

3. **입력:**
```
Name: GEMINI_API_KEYS
Value: [2단계에서 정리한 키 목록 붙여넣기]
