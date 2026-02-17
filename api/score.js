export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { target, imageData } = req.body;
    // Vercel 환경변수에 넣으신 새 구글 키 (하나만 넣어도 작동합니다)
    const apiKey = (process.env.GEMINI_API_KEYS || '').split(',')[0].trim();

    if (!apiKey) return res.status(500).json({ error: 'API 키가 없습니다.' });

    /**
     * 💡 모델명 핵심 수정: 
     * 'gemini-1.5-flash'가 안 된다면 'gemini-1.5-flash-latest'가 정답입니다.
     * 주소 또한 v1beta 대신 v1을 사용하여 안정성을 높였습니다.
     */
    const model = "gemini-1.5-flash-latest"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [
            { text: `Evaluate the handwritten Hiragana '${target}'. Give a score(0-100) and short Korean feedback. Respond ONLY in JSON: {"score":number, "feedback":"string"}` },
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
      // 할당량 부족(limit: 0) 에러 발생 시의 상세 안내
      if (data.error?.message.includes("quota") || data.error?.message.includes("limit")) {
        return res.status(429).json({ 
          error: '구글 할당량 제한', 
          details: '현재 계정의 무료 사용량이 일시적으로 0으로 설정되었습니다. 다른 구글 계정의 키를 사용하거나 잠시 기다려야 합니다.' 
        });
      }
      throw new Error(data.error?.message || 'API Error');
    }

    const resultText = data.candidates[0].content.parts[0].text;
    return res.status(200).json(JSON.parse(resultText));

  } catch (error) {
    return res.status(500).json({ error: 'Server Error', details: error.message });
  }
}
