export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // AI 스튜디오에서 완성한 '냉철한 감정사' 시스템 지침을 변수로 넣습니다.
  const systemInstruction = `
    당신은 20년 경력의 냉철한 일본어 서예 감정사입니다. 점수는 루브릭 수치에 근거하여 매우 엄격하게 산출하십시오.
    용어 정의: 멈춤(Tome), 삐침(Hane), 흘림(Harai)을 사용하십시오.
    채점 루브릭: 형태(35), 필순(25), 방향(20), 끝맺음(10), 균형(10) 
  `;

  try {
    const response = await fetch(
      // 1. 모델 주소를 제미나이 3 플래시 프리뷰로 변경
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 2. 시스템 지침을 API 규격에 맞춰 분리하여 전달
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents:
          }],
          generationConfig: {
            temperature: 0,              // 일관성을 위해 0으로 고정 [6]
            thinking_level: "high",       // '흘림' 분석을 위한 핵심 설정 [1]
            response_mime_type: "application/json" // JSON 결과 강제 [7]
          }
        })
      }
    );

    const data = await response.json();
    const resultText = data.candidates.content.parts.text;
    const parsed = JSON.parse(resultText);

    return res.status(200).json({
      score: parsed.score,
      rubric_breakdown: parsed.rubric_breakdown,
      feedback: parsed.feedback
    });
  } catch (err) {
    return res.status(500).json({ error: '채점 실패', detail: err.message });
  }
}
