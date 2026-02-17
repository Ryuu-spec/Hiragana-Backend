export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

// 서버가 실행되는 동안 유지되는 인덱스
let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    
    // 환경변수에서 여러 개의 키를 가져와 배열로 만듭니다.
    const apiKeys = (process.env.GROQ_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    if (apiKeys.length === 0) {
      return res.status(500).json({ error: 'Groq API 키가 설정되지 않았습니다.' });
    }

    // 현재 인덱스의 키 선택 후 인덱스 증가 (다음 요청 땐 다음 키 사용)
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    const model = "llama-3.2-11b-vision-preview"; 
    const apiUrl = "https://api.groq.com/openai/v1/chat/completions";
    const pureBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;

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
              { 
                type: "text", 
                text: `Evaluate the handwritten Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Respond ONLY in JSON format: {"score":number, "feedback":"string"}` 
              },
              { 
                type: "image_url", 
                image_url: { url: `data:image/jpeg;base64,${pureBase64}` } 
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // 할당량 초과(429 에러) 발생 시 안내 메시지
      if (response.status === 429) {
        return res.status(429).json({ 
          error: '할당량 부족', 
          details: '현재 사용 가능한 모든 키의 할당량이 소진되었습니다. 잠시 후 다시 시도해 주세요.' 
        });
      }
      throw new Error(data.error?.message || 'Groq API 호출 실패');
    }

    const resultText = data.choices[0].message.content;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    console.error('Server Error:', error.message);
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}
