const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

// ============================================================
// 필순 계산 — 클라이언트 획 데이터 기반 (AI 판단 대체)
// ============================================================
const STROKE_RULES = {

  // あ(3획) — 형태 기반 획 분류
  // 각 획을 모양으로 분류한 뒤 순서가 1→2→3인지 검증
  //
  // 획 분류 기준:
  //   TYPE 1 (가로선): bounding box 가로(width) > 세로(height) × 1.5 → 수평으로 넓은 획
  //   TYPE 2 (세로+곡선): bounding box 세로(height) > 가로(width) × 1.2 AND 끝점이 아래쪽
  //   TYPE 3 (원/루프): pathLength / displacement > 4 → 경로가 변위보다 훨씬 길어 제자리를 많이 돌았음
  'あ': {
    expected: 3,
    orderCheck: (s) => {
      function classifyStroke(st) {
        // 원 판별 우선: 경로 길이가 시작→끝 변위의 4배 이상이면 원
        if (st.displacement > 0.01 && st.pathLength / st.displacement > 4) return 3;
        // 가로선: 가로 bounding box가 세로의 1.5배 이상
        if (st.width > st.height * 1.5) return 1;
        // 세로+곡선: 세로 bounding box가 가로의 1.2배 이상
        if (st.height > st.width * 1.2) return 2;
        // 판별 불가
        return 0;
      }

      if (s.length !== 3) return false;
      const types = s.map(classifyStroke);
      console.log(`あ 획 분류: [${types.join(', ')}]`);

      // 분류 실패(0 포함)하면 판별 불가 → 예외 처리
      if (types.includes(0)) return null;

      // 정순: 1→2→3
      return types[0] === 1 && types[1] === 2 && types[2] === 3;
    }
  },

  // い(2획)
  // 1획(왼쪽 사선)이 2획(오른쪽 짧은 선)보다 왼쪽에서 시작
  'い': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // う(2획)
  // 1획(상단 점 사선)이 2획(U자)보다 위에서 시작
  'う': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // え(2획)
  // 1획(상단 점 사선)이 2획(수평선+꺾임)보다 위에서 시작
  'え': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // お(3획)
  // 1획(가로선)이 2획(세로+타원루프)보다 위에서 시작
  // 3획(오른쪽 짧은 사선)은 오른쪽 영역(startX > 0.5)에서 시작
  'お': {
    expected: 3,
    orderCheck: (s) => {
      const firstAboveSecond = s[0].startY < s[1].startY;
      const thirdIsRight     = s[2].startX > 0.4;
      return firstAboveSecond && thirdIsRight;
    }
  },
};

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  // 규칙 없거나 획 데이터 없으면 null → AI 판단 유지
  if (!rule || !Array.isArray(strokeMeta?.strokes) || strokeMeta.strokes.length === 0) {
    return null;
  }

  const countDiff = Math.abs((strokeMeta.count || 0) - rule.expected);

  if (countDiff >= 2) return 8;   // 획 수 2개 이상 틀림
  if (countDiff === 1) return 13; // 획 수 1개 틀림

  // 획 수 정확 → 순서 검증
  try {
    const orderResult = rule.orderCheck(strokeMeta.strokes);
    // null = 분류 실패 → AI 판단 유지
    if (orderResult === null) return null;
    return orderResult ? 20 : 14; // 순서 맞으면 만점, 틀리면 감점
  } catch (e) {
    return 16; // 검증 실패 시 중간값
  }
}

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

  return `당신은 20년 경력의 일본어 교사입니다. 히라가나는 붓글씨에서 기원했으므로 획의 시작·흐름·끝맺음에 자연스러운 힘의 흐름이 담겨야 합니다. 중학교 1학년 초학습자를 가르친다는 관점에서, 전문 용어 없이 동작을 직접 묘사하는 쉬운 말로 구체적인 개선 방법을 알려주세요.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 5가지 항목을 각각 채점하세요.
${fewShotSection}
## 채점 가이드라인 (반드시 준수)
- 대상: 한국 중고등학생 초학습자. 학습 동기를 위해 관대하게 평가하세요.
- 글자가 '${target}'로 인식 가능하면 → 형태정확성 최소 23점 이상
- 주요 구성 획이 2개 이상 존재하고 글자가 식별 가능하면 → 총점 최소 55점 이상 부여
- 기본 형태가 대체로 맞고 주요 획이 표현되었다면 → 총점 70점 이상
- 형태가 잘 잡혀 있고 흐름이 자연스럽다면 → 총점 85점 이상
- 획순 오류가 있어도 형태가 맞으면 필순 최대 5점만 감점
- 획방향은 방향이 완전히 반대가 아닌 이상 15점 이상 유지
- 글자를 전혀 알아볼 수 없는 경우가 아니면 총점 55점 이하 부여 금지
- ※ 필순 점수는 시스템이 실제 획 순서 데이터로 자동 계산해 덮어씁니다. 필순 항목은 참고용으로만 채점하고, feedback에서 필순 문제를 주요 개선점으로 언급하지 마세요.

## 원형·루프 획 평가 기준 (중요)
- 원이나 루프 형태의 획은 **시각적으로 둥글고 닫혀 보이면** 완성된 것으로 평가하세요.
- 시작점과 끝점이 완전히 겹치지 않아도, 원이 거의 닫혀 있으면(틈이 획 전체 길이의 10% 이하) F-02 감점을 적용하지 마세요.
- 특히 'あ'의 3획(아랫부분 원)은 붓글씨 특성상 완전히 닫히지 않는 것이 자연스럽습니다. 원이 둥글고 식별 가능하면 감점 없이 평가하세요.
- F-02는 루프나 고리가 **아예 그려지지 않았거나** 완전히 열려서 원으로 인식할 수 없는 경우에만 적용하세요.

## 규칙 ID 기반 감점표 (각 항목 감점 시 반드시 아래 규칙에 근거할 것)

### 형태정확성 감점 규칙 (5점 단위)
- F-01: 곡선으로 써야 할 획을 직선으로 쓴 경우 → -5점
- F-02: 고리(루프)나 닫힌 곡선이 **아예 없거나** 완전히 열려 원으로 인식 불가한 경우 → -10점 (거의 닫힌 원은 해당 없음)
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
${getFilteredNEG(target)}

## 채점 기준 (각 항목 최대값을 절대 초과하지 마세요)
- 형태정확성 (0~40, 최대 40점): 획의 전체적인 형태가 '${target}'와 얼마나 닮았는가
- 필순 (0~20, 최대 20점): 획의 순서와 개수가 맞는가
- 획방향 (0~20, 최대 20점): 각 획의 방향과 흐름이 올바른가
- 끝맺음 (0~10, 최대 10점): 획의 시작과 끝 처리가 자연스러운가
- 균형비율 (0~10, 최대 10점): 글자의 크기, 위치, 균형이 잘 맞는가

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

  // ── 1. HTTP 메서드 검증 ──────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다. POST만 허용됩니다.' });
  }

  // ── 2. 환경변수 검증 ─────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    return res.status(500).json({ error: 'API 키가 서버에 설정되지 않았습니다.' });
  }

  // ── 3. 요청 바디 존재 여부 검증 ──────────────────────────────
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: '요청 바디가 없거나 잘못된 형식입니다.' });
  }

  const { target, imageData, strokeMeta } = req.body;

  // ── 4. target 검증 ───────────────────────────────────────────
  if (!target || typeof target !== 'string' || target.trim() === '') {
    return res.status(400).json({ error: 'target 값이 없거나 잘못되었습니다.' });
  }
  const trimmedTarget = target.trim();

  // ── 5. imageData 검증 ────────────────────────────────────────
  if (!imageData || typeof imageData !== 'string' || imageData.trim() === '') {
    return res.status(400).json({ error: 'imageData 값이 없거나 비어 있습니다.' });
  }

  // base64 추출: data URL 접두사 제거
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;

  // base64 최소 길이 검증 (빈 캔버스 방지 — 300×300 흰 이미지는 약 3000자 이상)
  if (base64Data.length < 100) {
    return res.status(400).json({ error: '이미지 데이터가 너무 짧습니다. 글자를 먼저 써주세요.' });
  }

  const prompt = buildPrompt(trimmedTarget);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: base64Data } }
            ]
          }],
          generationConfig: {
            thinkingConfig: { thinkingBudget: 2048 }  // 추론 활성화 — 속도·정확도 균형
          }
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

      // ★ Gemini 원본 점수 로그 (디버그용)
      console.log(`[${trimmedTarget}] Gemini 원본 점수 — 형태:${parsed.형태정확성} 필순:${parsed.필순} 획방향:${parsed.획방향} 끝맺음:${parsed.끝맺음} 균형:${parsed.균형비율}`);

      // ★ 각 항목 상한 클램핑 (만점 초과 방지)
      parsed.형태정확성 = Math.min(40, Math.max(0, parsed.형태정확성 || 0));
      parsed.필순        = Math.min(20, Math.max(0, parsed.필순 || 0));
      parsed.획방향      = Math.min(20, Math.max(0, parsed.획방향 || 0));
      parsed.끝맺음      = Math.min(10, Math.max(0, parsed.끝맺음 || 0));
      parsed.균형비율    = Math.min(10, Math.max(0, parsed.균형비율 || 0));

      // ★ 필순 덮어쓰기 — 클라이언트 획 데이터로 정확하게 계산
      const calculatedStroke = calculateStrokeScore(trimmedTarget, strokeMeta);
      if (calculatedStroke !== null) {
        console.log(`필순 덮어쓰기: AI ${parsed.필순} → 계산값 ${calculatedStroke}`);
        parsed.필순 = calculatedStroke;
      }

      // ★ 스마트 클램핑 — 획방향 최솟값 보정
      // 피드백에 실제 역방향(D-02) 언급이 없는데 15 미만이면 AI 실수로 판단해 15로 보정
      // 진짜 D-02 케이스(완전 반대 방향)는 피드백에 반드시 관련 키워드가 등장하므로 오탐 없음
      const hasRealDirectionError = /반대|역방향|D-02|완전히 반대|거꾸로/.test(parsed.feedback || '');
      if (parsed.획방향 < 15 && !hasRealDirectionError) {
        console.log(`획방향 스마트 보정: ${parsed.획방향} → 15 (역방향 언급 없음)`);
        parsed.획방향 = 15;
      }

      parsed.score = (parsed.형태정확성 || 0)
                   + (parsed.필순 || 0)
                   + (parsed.획방향 || 0)
                   + (parsed.끝맺음 || 0)
                   + (parsed.균형비율 || 0);

      // ★ 방법 B: 글자가 식별 가능한데 55점 미만이면 비율 유지하며 55점으로 올림
      // 단, 형태정확성 20점 미만은 글자 자체를 못 쓴 것으로 보고 보정 미적용
      // 필순은 이미 정확히 계산됐으므로 보정에서 제외
      const MIN_SCORE = 55;
      const isRecognizable = parsed.형태정확성 >= 20;
      if (parsed.score > 0 && parsed.score < MIN_SCORE && isRecognizable) {
        const ratio = MIN_SCORE / parsed.score;
        parsed.형태정확성 = Math.min(40, Math.round((parsed.형태정확성 || 0) * ratio));
        parsed.획방향      = Math.min(20, Math.round((parsed.획방향 || 0) * ratio));
        parsed.끝맺음      = Math.min(10, Math.round((parsed.끝맺음 || 0) * ratio));
        parsed.균형비율    = Math.min(10, Math.round((parsed.균형비율 || 0) * ratio));
        // 필순은 비율 보정 대상에서 제외 (이미 정확한 값)
        parsed.score = (parsed.형태정확성) + (parsed.필순) + (parsed.획방향) + (parsed.끝맺음) + (parsed.균형비율);
      }

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
