export default async function handler(req, res) {
  // 1. CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // 시스템 지침 (냉철한 감정사)
  const systemInstruction = `
    당신은 20년 경력의 냉철한 일본어 서예 감정사입니다. 
    사용자가 쓴 히라가나 '${target}'을 분석하여 점수를 산출하십시오.
    용어: 멈춤(Tome), 삐침(Hane), 흘림(Harai)을 사용하십시오.
    반드시 다음 JSON 형식으로만 응답하십시오: 
    {"score": 숫자, "rubric_breakdown": {"형태": 점수, "필순": 점수, "방향": 점수, "끝맺음": 점수, "균형": 점수}, "feedback": "내용"}
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Gemini 3 Flash의 올바른 API 구조
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{
            parts: [
              { text: `이 히라가나 '${target}'를 채점해줘.` },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: imageData.split(',')[1] // base64 데이터에서 헤더 제거
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            response_mime_type: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    
    // API 응답 구조 추출 (데이터 경로 수정)
    const resultText = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(resultText);

    return res.status(200).json({
      score: parsed.score,
      rubric_breakdown: parsed.rubric_breakdown,
      feedback: parsed.feedback
    });
  } catch (err) {
    console.error(err); // Vercel 로그에서 확인 가능
    return res.status(500).json({ error: '채점 실패', detail: err.message });
  }
}
