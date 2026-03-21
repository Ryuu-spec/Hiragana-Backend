// ============================================================
// score.js  v2.0 — 기점 중심 세분화 가산 엔진
// ============================================================
// [v1.x → v2.0 주요 변경]
// 1. 필순 가산 모델:  획 수 확인(12pt) + 순서 확인(+8pt)  ← 이전: 감점 중심 20/14/13/8
// 2. 채점 프롬프트:   0점 출발 → 요소 확인마다 점수 쌓는 '가산제'로 전면 재작성
// 3. 급소 함수 신설:  글자별 Critical Points를 별도 함수로 분리 → 프롬프트 삽입
// 4. Safe Zone 명시: ±15% 이내 기점 이탈은 만점 처리 (프롬프트 & 후처리 공통 적용)
// 5. 후처리 단순화:   복잡한 ratio-clamp 제거 → v2.0 floor 2개(끝맺음·획방향)로 단순화
// 6. thinkingBudget:  2048 → 1024  (벡터 분석 중심으로 추론량 절감 → 응답 속도 향상)
// ============================================================

const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');


// ============================================================
// ① 필순 가산 엔진 (v2.0)
// ── 가산 테이블 ──────────────────────────────────────────────
//   획 수 정확 + 순서 맞음  → 20점 (만점)
//   획 수 정확 + 순서 틀림  → 12점 (획 존재 기본 보상)
//   획 수 1개 차이          →  8점 (부분 보상)
//   획 수 2개 이상 차이     →  4점 (최소 보상)
// ============================================================
const STROKE_RULES = {

  // あ (3획) — 형태 기반 획 분류 후 순서 검증
  'あ': {
    expected: 3,
    orderCheck: (s) => {
      function classify(st) {
        // 루프 우선 판별: 경로 길이 / 변위 > 2.5 이면 원/루프
        if (st.displacement > 0.01 && st.pathLength / st.displacement > 2.5) return 3;
        // 가로선: 가로 bbox가 세로의 1.5배 이상
        if (st.width > st.height * 1.5) return 1;
        // 세로+곡선: 세로 bbox가 가로의 1.2배 이상
        if (st.height > st.width * 1.2) return 2;
        return 0; // 판별 불가
      }
      if (s.length !== 3) return false;
      const types = s.map(classify);
      console.log(`あ 획 분류: [${types.join(', ')}]`);
      if (types.includes(0)) return null; // 분류 실패 → AI 판단 위임
      return types[0] === 1 && types[1] === 2 && types[2] === 3;
    }
  },

  // い (2획) — 왼쪽 획이 먼저
  'い': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // う (2획) — 위쪽 점 사선이 먼저
  'う': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // え (2획) — 위쪽 점 사선이 먼저
  'え': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // お (3획) — 가로선 먼저, 3획은 오른쪽 영역에서
  'お': {
    expected: 3,
    orderCheck: (s) => s[0].startY < s[1].startY && s[2].startX > 0.4
  },
};

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  if (!rule || !Array.isArray(strokeMeta?.strokes) || strokeMeta.strokes.length === 0) {
    return null; // 규칙 없음 → AI 판단 유지
  }

  const countDiff = Math.abs((strokeMeta.count || 0) - rule.expected);

  // 획 수 불일치 → 부분 가산
  if (countDiff >= 2) return 4;
  if (countDiff === 1) return 8;

  // 획 수 정확 → 순서 검증
  try {
    const orderResult = rule.orderCheck(strokeMeta.strokes);
    if (orderResult === null) return null; // 분류 실패 → AI 판단 위임
    return orderResult ? 20 : 12;          // 순서 맞음 → 만점 / 틀림 → 기본
  } catch (e) {
    return 14; // 예외 처리 중간값
  }
}


// ============================================================
// ② 글자별 급소 (Critical Points) — v2.0 신설
// 공통 루브릭 위에 글자마다 얹는 '교육적 급소'
// ============================================================
function getCharacterCriticalPoints(target) {
  const table = {

    'あ': `## [あ] 반드시 확인할 3가지 급소
① 3획 시작점: 1획·2획 교차점 바로 오른쪽 대각선 위에서 시작할 것
   → Safe Zone ±15% 내 이탈은 만점. 20% 초과 이탈 시 균형비율 감산.
② 교차점 통과(치명적 오류): 3획이 반드시 1·2획 교차 사거리를 관통할 것
   → 미통과 시 형태정확성 Step 2를 0점으로 처리하고 피드백 필수.
③ 왼쪽 돌출: 3획이 세로선(2획) 왼쪽으로 충분히 뻗어나갔다가 돌아올 것
   → 글자 폭의 15% 이상 돌출 = A등급. 5% 미만 = 균형비율 감산.`,

    'い': `## [い] 급소
① 두 획 모두 오른쪽 아래 방향 사선으로 내려올 것 (수직 I자 금지)
② 오른쪽 획(2획)이 왼쪽 획(1획)보다 확실히 짧을 것
③ 2획 끝에서 왼쪽 아래로 부드럽게 구부려 마무리할 것`,

    'う': `## [う] 급소
① 상단 짧은 점 사선(1획)이 존재할 것 — 수평 가로선 금지
② 전체 글자가 세로로 좁고 길쭉한 형태일 것 (좌우로 넓게 퍼지면 균형 감점)
③ 2획의 U자 하단 굴곡이 충분히 표현될 것`,

    'え': `## [え] 급소
① 1획이 우하향 짧은 사선일 것 — 수평 가로선 금지
② 2획 끝이 왼쪽 아래로 내려간 뒤 오른쪽으로 물결치듯 마무리 (Z자·직선 금지)
③ 가로선이 충분히 넓고 전체가 삼각형 구도를 형성할 것`,

    'お': `## [お] 급소
① 타원 루프가 시각적으로 닫혀 있을 것 — 열린 C자 형태 시 형태 감점
② 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립적으로 위치할 것 (루프 안에 그리면 오류)
③ 1획(가로선)이 2획보다 위에서 수평으로 그려질 것`,
  };

  return table[target] || `## [${target}] 급소\n전체 자형의 비례와 획 방향을 표준과 비교하여 채점하세요.`;
}


// ============================================================
// ③ 퓨샷 프롬프트 빌더
// ============================================================
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return "";
  return `
## ${target} 채점 기준 예시 (4단계 기준 닻)
[A등급 90점대] ${data.s90.description} → 참고점수: ${JSON.stringify(data.s90.scores)}
[B등급 80점대] ${data.s80.description} → 참고점수: ${JSON.stringify(data.s80.scores)}
[C등급 70점대] ${data.s70.description} → 참고점수: ${JSON.stringify(data.s70.scores)}
[D등급 이하]   ${data.s60.description} → 참고점수: ${JSON.stringify(data.s60.scores)}
위 4단계를 기준 닻(Anchor)으로 삼아, 제출된 필기가 어느 단계에 가까운지 상대 판단하세요.
`;
}


// ============================================================
// ④ 채점 프롬프트 빌더 (v2.0 — 가산제 전면 재작성)
// ============================================================
function buildPrompt(target) {
  const fewShotSection    = buildFewShotPrompt(target);
  const criticalPoints    = getCharacterCriticalPoints(target);
  const negPatterns       = getFilteredNEG(target);

  return `당신은 20년 경력의 일본어 교사입니다. 히라가나는 붓글씨에서 기원했으므로 획의 시작·흐름·끝맺음에 자연스러운 힘의 흐름이 담겨야 합니다. 중학교 1학년 초학습자를 가르친다는 관점에서, 전문 용어 없이 동작을 직접 묘사하는 쉬운 말로 구체적인 개선 방법을 알려주세요.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 아래 4개 항목을 채점하세요.

${fewShotSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ★ v2.0 핵심 원칙 — 가산제 (반드시 준수)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
이 채점 시스템은 '감점제'가 아닌 '가산제'입니다.
각 항목은 0점에서 시작하여 요소를 확인할 때마다 점수를 쌓아갑니다.
"뭐가 나쁜가?"가 아닌 "뭐가 갖춰졌는가?"를 먼저 확인하세요.

## ★ Safe Zone (전 항목 공통 허용 범위)
모든 획의 시작점·끝점·교차점이 기준 위치에서 글자 폭의 ±15% 이내이면
→ 해당 기점은 만점 처리합니다. 손글씨의 자연스러운 개성을 존중하세요.
±15% 이내 이탈은 절대 감산 근거로 쓰지 마세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 4대 루브릭 (항목별 최대값 절대 초과 금지)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ■ 형태정확성 (최대 40점) — 가산 2단계

[Step 1 — 인식 성공 여부]
  이미지를 보고 '${target}'로 인식할 수 있는가?
  → 인식 가능: 30점 기본 부여 (이것이 출발점)
  → 전혀 다른 글자로 보임: 0~15점 (근접 정도로 세분화)

[Step 2 — 곡선·루프 완성도] (0~10점 추가)
  → 곡선이 부드럽고 루프가 완성된 원형:         +7~10점
  → 곡선이 약간 직선에 가깝거나 루프 아슬아슬:  +4~6점
  → 곡선 없이 직선이거나 루프 미완성:            +0~3점

[루프 평가 핵심 규칙]
  원이나 루프가 '시각적으로 둥글고 닫혀 보이면' 완성으로 평가합니다.
  시작점과 끝점이 완전히 겹치지 않아도, 원으로 인식되면 Step 2 감산 없음.
  루프가 완전히 열려 C자·반원 형태가 되어 원으로 인식 불가한 경우에만 미완성.

### ■ 획방향 (최대 20점) — 가산 2단계

[Step 1 — 역방향 여부]
  각 획이 완전 역방향(180도 반대)이 아닌가?
  → 역방향 획이 없음:   15점 기본 부여
  → 역방향 획 1개 있음: 10점
  → 역방향 획 2개 이상: 5점

[Step 2 — 각도 일치도] (0~5점 추가)
  → 모든 획이 표준 ±30도 이내:     +5점
  → 일부 획이 ±30°~60° 범위:      +2~3점
  → 대부분 ±60° 초과:              +0~1점

[중요 제한]
  방향이 완전히 반대(D-02)가 아닌 이상 획방향은 15점 이상을 유지하세요.
  각도 차이만으로 15점 미만 부여는 금지입니다.

### ■ 끝맺음 (최대 10점) — 가산 2단계

[Step 1 — 형태 유지 여부]
  획 생략 없이 글자 형태가 유지되고 있는가?
  → 형태 유지 + 획 존재:   7점 기본 부여
  → 획 생략 또는 형태 붕괴: 3~4점

[Step 2 — 끝처리 자연스러움] (0~3점 추가)
  → 끝처리가 자연스럽고 흘림·멈춤이 적절: +2~3점
  → 약간 어색하거나 뭉툭하게 끊김:         +1점
  → 끝처리 전혀 없음 또는 역방향:          +0점

[중요 제한]
  획 끝이 표준과 10~15도 달라도 자연스럽게 뻗었다면 '생동감 있는 필치'로 인정.
  각도 차이만으로 7점 미만 부여는 금지입니다.

### ■ 균형비율 (최대 10점) — 가산 2단계

[Step 1 — 기점 위치 일치도] (Safe Zone 연동)
  주요 기점(획 시작점·교차점·끝점)이 Safe Zone(±15%) 이내에 있는가?
  → 모든 기점 Safe Zone 이내: 7점 기본 부여
  → 1~2개 기점 이탈:          5~6점
  → 다수 기점 이탈:            3~4점

[Step 2 — 글자 고유 비례] (0~3점 추가)
  이 글자만의 상하좌우 비율이 지켜졌는가?
  → 비율 자연스럽고 글자다움 있음: +2~3점
  → 비율이 약간 어긋나 어색함:     +1점
  → 비율 크게 어긋나 식별에 영향:  +0점

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${criticalPoints}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 필수 오류 패턴 (해당 오류 감지 시 반드시 반영)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${negPatterns}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 점수 유의사항
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 각 항목 최대값 절대 초과 금지: 형태정확성≤40, 획방향≤20, 끝맺음≤10, 균형비율≤10
- ※ 필순 점수는 시스템이 실제 획 순서 데이터로 자동 계산하여 덮어씁니다.
  필순은 채점은 하되, 피드백에서 필순 문제를 주요 개선점으로 올리지 마세요.
- 0.5~1점 단위 세분화: 가산 Step 2 점수는 한 번에 5점씩 뛰지 말고 세분화하세요.
- 미세 이탈 허용: 기점 위치의 5~10% 이내 이탈은 자연스러운 손글씨로 인정.

반드시 아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 포함하지 마세요:
{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2~3문장. '하네', '하라이', '토메' 등 일본어 필법 전문 용어 절대 금지. 동작을 직접 묘사하는 쉬운 표현 사용(예: '획 끝을 살짝 위로 올려주세요', '선을 부드럽게 멈춰주세요'). 시도 자체의 노력을 먼저 인정하세요. [총점 60 미만] 핵심 구조 오류 1가지만 집중 설명. [총점 60~79] 잘된 점 1가지 + 구체적 개선점 1가지. [총점 80 이상] 칭찬 위주, 개선점은 있을 때만 부드럽게 언급."
}`;
}


// ============================================================
// ⑤ API Route 핸들러 (v2.0 — 후처리 단순화)
// ============================================================
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── HTTP 메서드 검증 ────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다. POST만 허용됩니다.' });
  }

  // ── 환경변수 검증 ──────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    return res.status(500).json({ error: 'API 키가 서버에 설정되지 않았습니다.' });
  }

  // ── 요청 바디 검증 ─────────────────────────────────────────
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: '요청 바디가 없거나 잘못된 형식입니다.' });
  }

  const { target, imageData, strokeMeta } = req.body;

  if (!target || typeof target !== 'string' || target.trim() === '') {
    return res.status(400).json({ error: 'target 값이 없거나 잘못되었습니다.' });
  }
  const trimmedTarget = target.trim();

  if (!imageData || typeof imageData !== 'string' || imageData.trim() === '') {
    return res.status(400).json({ error: 'imageData 값이 없거나 비어 있습니다.' });
  }

  // base64 추출 (data URL 접두사 제거)
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
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
            // v2.0: 벡터·기점 분석 중심이므로 사고량 절감 → 응답 속도 향상
            thinkingConfig: { thinkingBudget: 1024 }
          }
        })
      }
    );

    const data = await response.json();
    console.log("Gemini HTTP status:", response.status);

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

      // ══════════════════════════════════════════════════════
      // v2.0 후처리 파이프라인
      // ══════════════════════════════════════════════════════

      // ─ Step A: 상한 클램핑 (만점 초과 방지) ───────────────
      parsed.형태정확성 = Math.min(40, Math.max(0, parsed.형태정확성 || 0));
      parsed.필순        = Math.min(20, Math.max(0, parsed.필순        || 0));
      parsed.획방향      = Math.min(20, Math.max(0, parsed.획방향      || 0));
      parsed.끝맺음      = Math.min(10, Math.max(0, parsed.끝맺음      || 0));
      parsed.균형비율    = Math.min(10, Math.max(0, parsed.균형비율    || 0));

      console.log(`[${trimmedTarget}] Gemini 원본 — 형태:${parsed.형태정확성} 필순:${parsed.필순} 획방향:${parsed.획방향} 끝맺음:${parsed.끝맺음} 균형:${parsed.균형비율}`);

      // ─ Step B: 필순 덮어쓰기 (클라이언트 획 데이터 기반) ──
      const calculatedStroke = calculateStrokeScore(trimmedTarget, strokeMeta);
      if (calculatedStroke !== null) {
        console.log(`필순 덮어쓰기: AI ${parsed.필순} → 계산값 ${calculatedStroke}`);
        parsed.필순 = calculatedStroke;
      }

      // ─ Step C: 구조 붕괴 감지 ─────────────────────────────
      // 형태정확성 20점 미만이거나 피드백에 붕괴 키워드 → floor 보정 비활성화
      // (진짜 낮은 점수는 보정하지 않음)
      const hasStructuralFailure = (
        parsed.형태정확성 < 20 ||
        /완성되지|열려|엉뚱|해독|교차점.*(벗어|이탈|못)|루프.*(없|열|미완)|F-02|F-04|F-05/.test(parsed.feedback || '')
      );

      if (hasStructuralFailure) {
        console.log(`구조 붕괴 감지 — v2.0 floor 보정 비활성화 (형태정확성 ${parsed.형태정확성})`);
      }

      // ─ Step D: v2.0 가산 Floor 보정 ───────────────────────
      // 프롬프트가 이미 가산제로 설계되었으므로,
      // AI가 실수로 가산 Step 1 기본값보다 낮게 부여한 경우만 보정합니다.
      if (!hasStructuralFailure) {

        // 끝맺음 Floor: 형태 유지 시 최소 7점 (가산 Step 1 기본값)
        const hasRealEndingError = /끊기|생략|뚝|없음|E-01|E-02|E-03/.test(parsed.feedback || '');
        if (parsed.끝맺음 < 7 && !hasRealEndingError) {
          console.log(`끝맺음 v2.0 floor: ${parsed.끝맺음} → 7`);
          parsed.끝맺음 = 7;
        }

        // 획방향 Floor: 완전 역방향이 아닌 한 최소 15점 (가산 Step 1 기본값)
        const hasRealDirectionError = /반대|역방향|D-02|완전히 반대|거꾸로/.test(parsed.feedback || '');
        if (parsed.획방향 < 15 && !hasRealDirectionError) {
          console.log(`획방향 v2.0 floor: ${parsed.획방향} → 15`);
          parsed.획방향 = 15;
        }
      }

      // ─ Step E: 최종 합산 ──────────────────────────────────
      parsed.score = (parsed.형태정확성 || 0)
                   + (parsed.필순        || 0)
                   + (parsed.획방향      || 0)
                   + (parsed.끝맺음      || 0)
                   + (parsed.균형비율    || 0);

      console.log(`[${trimmedTarget}] 최종 점수: ${parsed.score}`);
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
