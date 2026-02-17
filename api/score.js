export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    
    // 환경변수 GROQ_API_KEYS에서 콤마(,)로 구분된 키들을 배열로 가져옵니다.
    const apiKeys = (process.env.GROQ_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    if (apiKeys.length === 0) {
      return res.status(500).json({ error: '등록된 Groq API 키가 없습니다.' });
    }

    const model = "llama-3.2-11b-vision-preview"; // 이미지 분석이 가능한 비전 모델
    const apiUrl = "https://api.groq.com/openai/v1/chat/completions";
    const pureBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;

    // --- 🔑 키 로테이션 및 페일오버 로직 시작 ---
    let lastError = null;
    
    for (const apiKey of apiKeys) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: `Evaluate the handwritten Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Respond ONLY in JSON: {"score":number, "feedback":"string"}` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pureBase64}` } }
                ]
              }
            ],
            response_format: { type: "json_object" }
          })
        });

        const data = await response.json();

        // 429(할당량 초과) 에러 발생 시 다음 키로 넘어갑니다.
        if (response.status === 429) {
          console.warn(`키 할당량 소진됨. 다음 키로 재시도합니다...`);
          lastError = data.error?.message;
          continue; 
        }

        if (!response.ok) throw new Error(data.error?.message || 'API 호출 실패');

        // 성공 시 결과 반환 후 종료
        const resultText = data.choices[0].message.content;
        return res.status(200).json(JSON.parse(resultText));

      } catch (err) {
        lastError = err.message;
        console.error(`API 요청 중 오류: ${err.message}`);
        // 일반적인 서버 에러가 아닌 할당량 문제일 때만 다음 키를 시도하도록 구성 가능합니다.
      }
    }
    // --- 🔑 키 로테이션 로직 끝 ---

    // 모든 키가 실패했을 경우
    return res.status(500).json({ 
      error: '모든 API 키 사용 불가', 
      details: lastError || '할당량 부족 또는 네트워크 오류' 
    });

  } catch (error) {
    return res.status(500).json({ error: '서버 에러', details: error.message });
  }
}
