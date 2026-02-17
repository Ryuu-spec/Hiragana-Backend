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

    // 환경 변수에서 API 키 가져오기 (Vercel 대시보드에서 설정)
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = "gemini-1.5-flash";
    
    const systemPrompt = `Evaluate Hiragana '${target}'. Check strokes, balance. Score(0-100) and short Korean feedback. JSON:{"score":number,"feedback":string}`;

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
      throw new Error('Gemini API 오류');
    }
    
    const data = await response.json();
    const result = JSON.parse(data.candidates[0].content.parts[0].text);
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
