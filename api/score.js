export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { target, imageData } = req.body;
  if (!target || !imageData) return res.status(400).json({ error: 'target과 imageData가 필요합니다.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const charGuides = {
    'あ': "두 번째 세로획이 가로획과 교차하는 위치가 가로획의 중앙~오른쪽인지 확인. 가로획의 길이 자체는 체크하지 말 것. あ vs お 혼동 주의: お는 오른쪽 위에 점이 있음.",
    'い': "두 획의 길이 차이가 자연스러운지, 오른쪽 획이 살짝 짧고 안쪽으로 굽었는지 확인. 두 획이 너무 벌어지거나 붙지 않게.",
    'う': "첫 번째 점과 아래 곡선의 위치가 수직으로 맞는지 체크. 점의 위치가 너무 치우치지 않게.",
    'え': "아래 가로획이 중심을 지나 좌우로 균형 있게 뻗었는지 확인. 위아래 비율이 균등한지 체크.",
    'お': "오른쪽 위 점의 위치 확인. あ와 혼동하지 않도록 점의 유무가 핵심. 세로획이 가로획 중앙을 관통하는지 확인.",
    'か': "삐침(하네)이 살아 있는지 확인. 두 번째 획의 각도가 너무 눕지 않게.",
    'き': "가로획이 2개인지 확인 (さ와 혼동 주의). 아래 곡선이 떨어져 있는지 붙어 있는지는 서체 차이.",
    'く': "한 획으로 자연스럽게 꺾이는지, 각도가 너무 예리하거나 둔하지 않은지 확인.",
    'け': "왼쪽 세로획의 삐침(하네)이 살아 있는지 체크.",
    'こ': "두 획이 평행하고 간격이 적당한지 확인.",
    'さ': "ち와 혼동 주의: 윗부분 획의 방향이 반대. 마지막 획이 자연스럽게 이어지는지.",
    'し': "한 획의 굽힘이 자연스럽고 끝이 살짝 올라가는지 확인.",
    'す': "동그란 매듭이 너무 커지면 뚱뚱해 보임. 작고 단단하게. 필순 확인.",
    'せ': "가로획 3개의 간격이 균등한지, 마지막 획이 왼쪽으로 자연스럽게 뻗는지.",
    'そ': "한 번에 이어서 쓰는지(Z형 연속) 확인. 두 번에 나눠 쓰지 않도록.",
    'た': "오른쪽 'こ' 모양이 너무 크지 않게 조절. に와 혼동하지 않도록.",
    'ち': "윗부분 획의 방향이 さ와 반대임을 강조. 곡선이 안쪽으로 자연스럽게 말리는지.",
    'つ': "한 획으로 부드럽게 이어지는지, 너무 각지지 않게. っ(작은 つ)와 크기 구분.",
    'て': "가로획의 끝이 살짝 올라가며 맺히는지 확인.",
    'と': "세로획에서 곡선이 자연스럽게 이어지는지, 끝 처리(토메) 확인.",
    'な': "세 번째 획(점)의 위치가 너무 멀어지지 않게 주의. 필순이 복잡하므로 획순 확인.",
    'に': "두 가로획이 평행하고 세로획이 중앙을 관통하는지 확인.",
    'ぬ': "ぬ vs め 혼동 주의: ぬ의 꼬리에는 동그란 매듭이 없음. 끝 처리가 핵심.",
    'ね': "わ·れ와 혼동 주의: ね의 오른쪽 끝은 동그란 매듭으로 마무리.",
    'の': "한 획으로 동그랗게 이어지는지, 시작점과 끝점이 자연스럽게 교차하는지.",
    'は': "は vs ほ 혼동 주의: は는 세 번째 세로획 위쪽이 뚫려 있음.",
    'ひ': "곡선이 자연스럽게 이어지고 끝이 올라가는지 확인.",
    'ふ': "네 부분(4획)의 균형이 중앙을 향하고 있는지 확인. 크기가 고른지 체크.",
    'へ': "산 모양의 꼭짓점이 너무 뾰족하거나 뭉툭하지 않게. 좌우 균형 확인.",
    'ほ': "は vs ほ 혼동 주의: ほ는 오른쪽 세로획이 막혀 있고 고리 모양.",
    'ま': "위쪽 두 가로획 중 아래쪽이 더 짧은지 확인. ほ의 하단 구조와 비교.",
    'み': "두 번의 곡선이 자연스럽게 이어지는지, 끝 처리가 매끄러운지.",
    'む': "세로획에서 꺾인 후 동그란 고리가 자연스럽게 닫히는지 확인.",
    'め': "ぬ vs め 혼동 주의: め는 꼬리가 없고 안쪽으로 말리며 끝남.",
    'も': "세로획을 먼저 쓰고 가로획을 쓰는 필순 강조. 가로획 2개의 간격 균등.",
    'や': "획 사이의 공간이 충분한지 확인. 첫 획이 자연스럽게 시작하는지.",
    'ゆ': "왼쪽 세로획과 오른쪽 곡선의 균형. 오른쪽 부분이 너무 크지 않게.",
    'よ': "가로획의 시작이 너무 길지 않게 조절. 세로획과의 비율 확인.",
    'ら': "첫 가로획이 너무 길지 않게. 곡선이 자연스럽게 아래로 이어지는지.",
    'り': "왼쪽 획보다 오른쪽 획이 더 길고 시원하게 뻗었는지 체크.",
    'る': "る vs ろ 혼동 주의: る는 끝에 동그란 매듭이 있음.",
    'れ': "わ·ね와 혼동 주의: れ는 오른쪽 끝이 밖으로 뻗어 나감.",
    'ろ': "る vs ろ 혼동 주의: ろ는 매듭 없이 끝이 열려 있음.",
    'わ': "わ vs れ vs ね 혼동 주의: わ는 오른쪽 끝이 안쪽으로 말림.",
    'を': "3획의 필순이 맞는지 확인. 가로획이 균등한 간격인지 체크.",
    'ん': "붓글씨처럼 끝을 자연스럽게 올리며 마무리하는지 확인.",
  };

  const charGuide = charGuides[target] || "자형의 정확성과 균형을 중심으로 채점.";

  const prompt = `당신은 한국 중고등학생의 히라가나 손글씨를 채점하는 일본어 전문 교사입니다.
학생이 히라가나 '${target}'을(를) 손으로 쓴 이미지를 분석해주세요.

## 채점 루브릭 (3개 항목 합산)
- 자형의 정확성 (40점): 획의 모양·방향·굴곡이 표준 자형과 일치하는가
  - 우수(36~40): 표준 자형과 일치, 굴곡과 획 방향 정확
  - 보통(28~35): 인식 가능하나 획의 각도·곡선이 다소 어색
  - 미흡(20~27): 형태가 뭉개지거나 다른 글자와 혼동될 수 있음
- 획순 및 위치 (30점): 필순이 맞고 획 간 간격·위치 배분이 균형 잡혔는가
  - 우수(27~30): 획순 정확, 간격·위치 균형
  - 보통(21~26): 획순은 맞으나 간격·위치 불균형
  - 미흡(15~20): 획순 오류 또는 획 누락으로 구조 붕괴
- 가독성/종합 (30점): 실제 소통에 활용 가능한 수준인가
  - 우수(27~30): 가독성 뛰어남, 즉시 활용 가능
  - 보통(21~26): 읽을 수 있으나 필체 불안정
  - 미흡(15~20): 읽기 어렵고 추가 연습 필요

## '${target}' 핵심 체크포인트
${charGuide}

## 피드백 작성 원칙
- 학생 입장에서 따뜻하고 동기부여가 되는 어조로 작성
- 강점을 먼저 언급한 뒤 개선점을 구체적으로 제시
- 잘 쓴 글자에 개선점을 억지로 만들어내면 학생에게 혼란을 주므로 절대 금지. 명확한 오류가 없으면 반드시 칭찬만 할 것
- 위의 핵심 체크포인트에 명시된 항목에서만 오류를 판단할 것. 체크포인트에 없는 내용은 잘 썼더라도 언급 자체를 하지 말 것
- 체크포인트 항목을 확인했을 때 오류가 없으면 "잘 썼습니다" 류의 칭찬 피드백만 작성할 것. 억지로 "조금 더 ~하면"이라는 식의 표현 금지
- 2~3문장 이내로 간결하게, 한국어로 작성

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:
{"score": 숫자, "feedback": "한국어 피드백 2~3문장"}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: imageData } }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300,
          }
        })
      }
    );
    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API 오류:', errText);
      return res.status(502).json({ error: 'Gemini API 호출 실패', detail: errText });
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.score !== 'number' || !parsed.feedback) throw new Error('응답 형식 오류');
    return res.status(200).json({
      score: Math.round(Math.max(0, Math.min(100, parsed.score))),
      feedback: parsed.feedback
    });
  } catch (err) {
    console.error('처리 오류:', err);
    return res.status(500).json({ error: '채점 중 오류가 발생했습니다.', detail: err.message });
  }
}
