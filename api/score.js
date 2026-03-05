const { FEWSHOT_DB, NEG_PATTERNS } = require('../fewshot_db');

// ============================================================
// 퓨샷 프롬프트 빌더
// ============================================================
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return "";
  return `
## ${target} 채점 기준 예시 (4단계 닻 — 등급 기준과 일치)
[90점 - 완벽(A등급)]          ${data.s90.description} → 점수: ${JSON.stringify(data.s90.scores)}
[80점 - 양호(B등급 기준)]     ${data.s80.description} → 점수: ${JSON.stringify(data.s80.scores)}
[70점 - 보통(C등급 기준)]     ${data.s70.description} → 점수: ${JSON.stringify(data.s70.scores)}
[60점 - 노력필요(D등급 기준)] ${data.s60.description} → 점수: ${JSON.stringify(data.s60.scores)}
위 4단계를 기준 닻(anchor)으로 삼아, 제출된 이미지가 어느 단계에 가까운지 상대적으로 판단하세요.
`;
}

// ============================================================
// 채점 프롬프트 빌더
// ============================================================
function buildPrompt(target) {
  const fewShotSection = buildFewShotPrompt(target);

  return `당신은 일본어 히라가나 쓰기 채점 선생님입니다.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 5가지 항목을 각각 채점하세요.
${fewShotSection}
## 채점 가이드라인 (반드시 준수)
- 대상: 한국 중고등학생 초학습자. 학습 동기를 위해 관대하게 평가하세요.
- 글자가 '${target}'로 인식 가능하면 → 형태정확성 최소 23점 이상
- 기본 형태가 대체로 맞고 주요 획이 표현되었다면 → 총점 70점 이상
- 형태가 잘 잡혀 있고 흐름이 자연스럽다면 → 총점 85점 이상
- 획순 오류가 있어도 형태가 맞으면 필순 최대 5점만 감점
- 글자를 전혀 알아볼 수 없는 경우가 아니면 총점 40점 이하 부여 금지

## 규칙 ID 기반 감점표 (각 항목 감점 시 반드시 아래 규칙에 근거할 것)

### 형태정확성 감점 규칙 (5점 단위)
- F-01: 곡선으로 써야 할 획을 직선으로 쓴 경우 → -5점
- F-02: 고리(루프)나 닫힌 곡선이 빠진 경우 → -10점
- F-03: 두 획이 하나로 합쳐지거나 하나가 둘로 나뉜 경우 → 사례당 -5점
- F-04: 글자 구성 요소를 잇는 획이 없는 경우 → -5점
- F-05: 전체 모양이 '${target}'로 전혀 알아볼 수 없는 경우 → 이 항목 0점
- F-06: 구성 요소 크기 비율이 어긋나나 글자는 식별 가능한 경우 → -5점

### 필순 감점 규칙
- S-01: 첫 번째 획이 올바른 순서와 다른 경우 → -8점
- S-02: 이후 획이 순서를 벗어난 경우 → 위반 1건당 -4점 (단, 형태가 맞으면 최대 -4점으로 제한)

### 획방향 감점 규칙
- D-01: 올바른 방향 대비 30° 초과 기울어진 경우 → 획당 -5점
- D-02: 방향이 완전히 반대인 경우 → -10점

### 끝맺음 감점 규칙
- E-01: 획 끝을 위로 짧게 올려야 하는데 그냥 멈추거나 내린 경우 → -4점
- E-02: 딱 멈춰야 하는데 끝이 흘러내린 경우 → -3점
- E-03: 가늘게 빼며 끝내야 하는데 뚝 끊긴 경우 → -3점

### 균형비율 감점 규칙
- B-01: 좌우 비율이 기준 대비 40% 이상 벗어난 경우 → -4점
- B-02: 상하 비율이 기준 대비 40% 이상 벗어난 경우 → -4점
- B-03: 획 간격이 너무 밀집하거나 벌어진 경우 → -2점

## 필수 감점 패턴 (NEG 샘플 — 아래 오류 감지 시 재량 없이 반드시 적용)
${NEG_PATTERNS}

## 채점 기준
- 형태정확성 (0~40): 획의 전체적인 형태가 '${target}'와 얼마나 닮았는가
- 필순 (0~20): 획의 순서와 개수가 맞는가
- 획방향 (0~20): 각 획의 방향과 흐름이 올바른가
- 끝맺음 (0~10): 획의 시작과 끝 처리가 자연스러운가
- 균형비율 (0~10): 글자의 크기, 위치, 균형이 잘 맞는가

반드시 아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 포함하지 마세요:
{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2~3문장. '하네', '하라이', '토메' 등 일본어 필법 전문 용어 절대 금지. 동작을 직접 묘사하는 쉬운 표현 사용(예: '획의 끝을 살짝 위로 올려주세요', '선을 부드럽게 멈춰주세요'). 점수 구간별 톤 기준: [총점 60 미만] 칭찬 없이 핵심 구조 오류를 명확히 지적하고 가장 중요한 개선점 1가지만 집중 설명. [총점 60~79] 잘 된 점 1가지 + 구체적 개선점 1가지. [총점 80 이상] 칭찬 위주로 쓰되 개선점은 있을 때만 부드럽게 언급."
}`;
}

// ============================================================
// API Route 핸들러
// ============================================================
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { target, imageData } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  const prompt = buildPrompt(target);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }]
        })
      }
    );

    const data = await response.json();

    // ★ 디버그 로그 추가
    console.log("Gemini HTTP status:", response.status);
    console.log("Gemini response keys:", Object.keys(data));
    if (data.error) {
      console.log("Gemini error:", JSON.stringify(data.error));
      return res.status(500).json({ error: "Gemini API 오류", detail: data.error });
    }
    if (!data.candidates?.[0]) {
      console.log("candidates 없음. full response:", JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ error: "candidates 없음", detail: data });
    }

    const parts = data.candidates[0]?.content?.parts;
    if (!parts?.[0]) {
      console.log("parts 없음:", JSON.stringify(data.candidates[0]).slice(0, 500));
      return res.status(500).json({ error: "parts 없음", detail: data });
    }

    const resultText = parts[0].text;
    if (!resultText) {
      return res.status(500).json({ error: "text 없음", detail: data.candidates[0] });
    }

    const cleaned = resultText.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      parsed.score = (parsed.형태정확성 || 0)
                   + (parsed.필순 || 0)
                   + (parsed.획방향 || 0)
                   + (parsed.끝맺음 || 0)
                   + (parsed.균형비율 || 0);
      return res.status(200).json(parsed);
    } catch (e) {
      console.log("JSON 파싱 실패. raw:", resultText.slice(0, 300));
      return res.status(500).json({ error: "JSON 파싱 실패", raw: resultText });
    }

  } catch (err) {
    console.log("fetch 실패:", err.message);
    return res.status(500).json({ error: "서버 연결 실패", message: err.message });
  }
}

module.exports = handler;
module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
