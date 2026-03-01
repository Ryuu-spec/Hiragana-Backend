export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { target, imageData } = req.body;
  if (!target ||!imageData) return res.status(400).json({ error: 'target과 imageData가 필요합니다.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  // 46자별 상세 채점 기준 데이터베이스 (용어: 멈춤, 삐침, 흘림) [1, 4, 5]
  const charGuides = {
    'あ': "1획 가로선이 중앙 상단 위치, 3획 곡선이 1/2획 교차점을 부드럽게 감싸는 타원형 여부 확인. 2획 세로선이 중심에서 약간 왼쪽으로 휘어져야 함. 3획 끝은 반드시 '멈춤' 처리.",
    'い': "1획이 2획보다 길고 서로 마주 보는 형태. 1획 끝에 다음 획을 향한 강한 '삐침'이 있어야 하며, 2획 끝은 '멈춤' 처리.",
    'う': "1획은 짧은 대각선, 2획 곡선은 오른쪽으로 팽창했다가 왼쪽 아래 수직 방향으로 부드럽게 꺾여야 함. 1/2획 모두 '멈춤'.",
    'え': "2획 하단 수평선이 글자를 안정적으로 받쳐야 함. 마지막 수평선 끝에서 단호하게 '멈춤'. 삐쳐 올리면 감점.",
    'お': "2획 루프가 1획보다 훨씬 아래 지점에서 형성되어야 あ와 구분됨. 2획 루프 끝은 '멈춤', 3획 점은 '멈춤' 또는 가볍게 눌러 씀.",
    'か': "1획 끝의 '삐침'이 명확해야 함. 3획 점의 위치가 너무 붙지 않게 주의.",
    'き': "가로획 2개 확인. 3획 세로선 끝에 '삐침'이 있고 4획 곡선이 분리된 형태를 권장. '삐침' 생략 시 감점.",
    'さ': "1획 가로선과 2획 세로선의 교차점이 중앙. 2획 끝에 '삐침' 필수, 3획 곡선과 분리되어야 함.",
    'ぬ': "마지막 획의 끝에 동그란 '매듭'이 명확히 있어야 함. 매듭이 없거나 '흘림' 처리 시 'め'로 간주하여 최대 감점.",
    'る': "끝부분에 동그란 '매듭' 필수. 매듭이 없거나 열려 있으면 'ろ'와 혼동되므로 감점.",
    'ん': "붓글씨의 흐름을 따라 마지막을 오른쪽 위로 부드럽게 '흘림' 처리해야 함.",
    // 나머지 글자들도 위와 같은 형식으로 멈춤, 삐침, 흘림 기준으로 확장 가능합니다. [6]
  };

  const charGuide = charGuides[target] |

| "자형의 정확성과 '멈춤, 삐침, 흘림'의 일관성을 중심으로 냉정하게 채점.";

  // 객관성 확보를 위한 시스템 프롬프트 (페르소나 및 CoT 도입) [7, 8, 9]
  const prompt = `당신은 20년 경력의 냉철한 일본어 서예 감정사입니다. 
학생에 대한 격려와 별개로, 점수는 루브릭의 기술적 기준에 따라 매우 엄격하고 객관적으로 산출해야 합니다. 
모호한 경우 학생의 성장을 위해 반드시 감점 방향으로 결정하십시오.

## 채점 루브릭 (100점 만점) [1]
1. 형태 정확성 (35점): 표준 서체와 95% 이상 일치 여부.
2. 필순 (25점): 획의 순서와 개수 일치 여부 (이미지 추론 기반).
3. 획 방향 (20점): 표준 대비 각도 오차 30도 이내 여부.
4. 끝맺음 (10점): '멈춤, 삐침, 흘림'이 각 획의 끝부분에서 정확히 처리되었는가.
5. 균형 및 비율 (10점): 자중(중심)과 글자 내 공간 배분의 균형.

## '${target}' 핵심 체크포인트
${charGuide}

## 분석 및 출력 지침
1. 단계별 사고(Chain-of-Thought): 픽셀 단위 스캔 -> 표준체 대조 -> 루브릭별 감점 -> 최종 점수 산출 단계를 거칠 것. [9, 10]
2. 용어 사용: 끝맺음 분석 시 반드시 '멈춤, 삐침, 흘림'이라는 용어를 사용하십시오.
3. 피드백: 초등학생 눈높이에서 친절하게 작성하되, 점수와 모순되지 않아야 함.

반드시 아래 구조의 JSON 객체로만 응답하십시오:
{
  "score": 0,
  "rubric_breakdown": { "형태": 0, "필순": 0, "방향": 0, "끝맺음": 0, "균형": 0 },
  "feedback": "한국어 피드백 2~3문장 (멈춤, 삐침, 흘림 용어 사용)"
}`;

  try {
    // 최신 Gemini 3 Flash Preview 모델 사용 및 설정값 최적화 [2, 10, 11]
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents:
          }],
          generationConfig: {
            temperature: 0,              // 일관성을 위해 0으로 고정 [12]
            thinking_level: "high",       // 정밀한 추론을 위한 하이 레벨 설정 [2]
            response_mime_type: "application/json", // JSON 출력 강제 [13]
            maxOutputTokens: 500,
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Gemini API 호출 실패', detail: errText });
    }

    const data = await response.json();
    const text = data.candidates?.?.content?.parts?.?.text |

| '';
    const parsed = JSON.parse(text);

    return res.status(200).json({
      score: Math.round(parsed.score),
      rubric_breakdown: parsed.rubric_breakdown,
      feedback: parsed.feedback
    });
  } catch (err) {
    console.error('처리 오류:', err);
    return res.status(500).json({ error: '채점 중 오류가 발생했습니다.', detail: err.message });
  }
}
