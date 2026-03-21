// ============================================================
// score.js  v2.6 — 앵커 포인트(P1~P7) 기반 좌표 채점 엔진
// ============================================================
// [v2.5 → v2.6 주요 변경]
// extractAnchors() 신설 — points 배열에서 あ의 7개 앵커 포인트 직접 추출
//   P1~P2: 1획(가로선) 시작/끝
//   P3~P4: 2획(세로선) 시작/끝
//   P5~P7: 3획(루프) 시작/최좌점/끝
// dist(), angleDeg() 유틸 함수 추가
// analyzeStrokeGeometry → 앵커 포인트 기반으로 재작성
// 프론트엔드: points 배열 전송 추가 (64포인트 균등 샘플링)
// ────────────────────────────────────────────────────────────
// [v2.4 → v2.5 누적] 하드캡 → 소프트 패널티 전환
// [v2.3 → v2.4 누적] analyzeStrokeGeometry 신설, closingDist
// [v2.0 → v2.3 누적] 3단계 게이트, Group A/B, Safe Zone ±20%
// [v1.x → v2.0 누적] 가산제, 급소 함수, floor 3개
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
// ============================================================
// ① - A: 앵커 포인트 추출 엔진 (v2.6 신설)
// points 배열에서 あ의 7개 핵심 좌표를 수학으로 직접 계산
// 모든 좌표는 0~1 정규화 (캔버스 폭/높이 기준)
//
// あ 앵커 포인트 정의:
//   P1 = 1획 시작점 (가로선 왼쪽 끝)
//   P2 = 1획 끝점   (가로선 오른쪽 끝)
//   P3 = 2획 시작점 (세로선 상단)
//   P4 = 2획 끝점   (세로선 하단)
//   P5 = 3획 시작점 (루프 시작)
//   P6 = 3획 최좌점 (루프 가장 왼쪽 — 왼쪽 돌출 기준)
//   P7 = 3획 끝점   (루프 닫힘 기준)
// ============================================================
function extractAnchors(target, strokeMeta) {
  if (!Array.isArray(strokeMeta?.strokes)) return null;
  const s = strokeMeta.strokes;

  if (target === 'あ' && s.length === 3) {
    const [s1, s2, s3] = s;

    // points 배열이 있으면 직접 계산, 없으면 요약값으로 근사
    const getMinXPoint = (st) => {
      if (st.points?.length) {
        return st.points.reduce((m, p) => p[0] < m[0] ? p : m);
      }
      return [st.minX ?? st.startX, st.minY ?? st.startY];
    };

    const P1 = [s1.startX, s1.startY];
    const P2 = [s1.endX,   s1.endY];
    const P3 = [s2.startX, s2.startY];
    const P4 = [s2.endX,   s2.endY];
    const P5 = [s3.startX, s3.startY];
    const P6 = getMinXPoint(s3);   // 루프 최좌점
    const P7 = [s3.endX,   s3.endY];

    return { P1, P2, P3, P4, P5, P6, P7 };
  }

  return null;
}

// 두 점 사이 거리
function dist(a, b) {
  return Math.sqrt(Math.pow(b[0]-a[0], 2) + Math.pow(b[1]-a[1], 2));
}

// 두 점이 이루는 각도 (라디안 → 도)
function angleDeg(from, to) {
  return Math.atan2(to[1]-from[1], to[0]-from[0]) * 180 / Math.PI;
}



// AI 판단 대신 strokeMeta 좌표로 직접 계산
// 반환값: { structureGateFail, shapeCapScore, hasLeftProtrusion, aspectRatioFail }
// ============================================================
// ============================================================
// ① - B: 기하학 분석 엔진 (v2.6 — 앵커 포인트 기반)
// ============================================================
function analyzeStrokeGeometry(target, strokeMeta) {
  const result = {
    structureGateFail:  false,
    loopPenalty:        0,
    aspectPenalty:      0,
    hasLeftProtrusion:  null,
    aspectRatioFail:    false,
  };

  if (!Array.isArray(strokeMeta?.strokes) || strokeMeta.strokes.length === 0) return result;
  const s = strokeMeta.strokes;

  // ── あ 전용 분석 ───────────────────────────────────────────
  if (target === 'あ' && s.length === 3) {
    const anchors = extractAnchors('あ', strokeMeta);
    if (!anchors) return result;
    const { P5, P6, P7 } = anchors;
    const loop = s[2];

    // [루프 닫힘] P5(시작)~P7(끝) 거리 vs pathLength 비율
    const closingDist = dist(P5, P7);
    const loopRatio = loop.pathLength > 0.01 ? closingDist / loop.pathLength : 0;
    const loopClosed = loop.pathLength > 0.01 && loopRatio < 0.35;

    if (!loopClosed) {
      result.structureGateFail = true;
      result.loopPenalty = 8;
      console.log(`あ 루프 열림 — 패널티 -8 (P5→P7/path: ${loopRatio.toFixed(3)})`);
    } else {
      console.log(`あ 루프 닫힘 PASS (P5→P7/path: ${loopRatio.toFixed(3)})`);
    }

    // [왼쪽 돌출] P6.x(루프 최좌) < 2획 최좌 x - 5%
    const stroke2minX = s[1].minX ?? s[1].startX;
    result.hasLeftProtrusion = P6[0] < (stroke2minX - 0.05);
    console.log(`あ 왼쪽 돌출: ${result.hasLeftProtrusion} (P6.x:${P6[0].toFixed(3)}, s2.minX:${stroke2minX.toFixed(3)})`);
  }

  // ── Group A Aspect Ratio 검사 (あ・え・お) ──────────────────
  if (['あ', 'え', 'お'].includes(target) && s.length >= 2) {
    const avgW = s.reduce((acc, st) => acc + (st.width  || 0), 0) / s.length;
    const avgH = s.reduce((acc, st) => acc + (st.height || 0), 0) / s.length;
    const ratio = avgH > 0.01 ? avgW / avgH : 1;
    result.aspectRatioFail = (ratio < 0.5 || ratio > 2.0);
    if (result.aspectRatioFail) {
      result.aspectPenalty = 8;
      console.log(`Aspect Ratio 왜곡 — 패널티 -8 (ratio: ${ratio.toFixed(2)})`);
    }
  }

  return result;
}


function getCharacterCriticalPoints(target) {
  const table = {

    'あ': `## [あ] 반드시 확인할 4가지 급소
① Aspect Ratio 왜곡 검사: 자형의 세로가 가로의 1.5배 초과, 또는 가로가 세로의 1.5배 초과 시
   → 형태정확성 Step 1 기본점 -8점 (30→22점). 획 끝 삐침은 측정 제외.
② 3획 시작점: 1획·2획 교차점 바로 오른쪽 대각선 위에서 시작할 것
   → Safe Zone ±20% 내 이탈은 만점. 20% 초과 이탈 시 균형비율 감산.
③ 교차점 통과 + 삼각형 여백(치명적 오류): 3획이 반드시 1·2획 교차 사거리를 관통하고,
   교차 후 중앙에 삼각형 열린 여백이 형성되어야 함.
   → 통과 O + 삼각형 여백 O: 정상
   → 통과 O + 여백 뭉침:     형태정확성 Step 1 -5점
   → 통과 X:                 형태정확성 Step 1 -8점 + 피드백 필수
④ 왼쪽 돌출 + 루프 원형성: 3획이 세로선(2획) 왼쪽으로 충분히 뻗어나갔다가 돌아올 것
   → 글자 폭의 20% 이상 돌출 + 루프가 둥근 원형 = A등급 (Step 2 +7~10점)
   → 돌출은 있으나 루프가 각지거나(삼각·사각형) 돌출이 부족함 = Step 2 +3~5점
   → 돌출 없이 루프가 세로선 오른쪽에 붙어있거나 각진 소형 루프 = Step 2 +0~2점
   ★ '루프가 닫혀있다'는 것과 '루프가 둥글다'는 것은 다릅니다. 반드시 형태를 구분하세요.`,

    'い': `## [い] 급소
① 두 획 모두 오른쪽 아래 방향 사선으로 내려올 것 (수직 I자 금지)
② 오른쪽 획(2획)이 왼쪽 획(1획)보다 확실히 짧을 것
③ 2획 끝에서 왼쪽 아래로 부드럽게 구부려 마무리할 것`,

    'う': `## [う] 급소
① 상단 짧은 점 사선(1획)이 존재할 것 — 수평 가로선 금지
② 전체 글자가 세로로 좁고 길쭉한 형태일 것 (좌우로 넓게 퍼지면 균형 감점)
③ 2획의 U자 하단 굴곡이 충분히 표현될 것`,

    'え': `## [え] 급소
① Aspect Ratio 왜곡 검사: 자형의 세로가 가로의 1.5배 초과, 또는 가로가 세로의 1.5배 초과 시
   → 형태정확성 Step 1 기본점 -8점 (30→22점).
② 1획이 우하향 짧은 사선일 것 — 수평 가로선 금지
③ 2획 끝이 왼쪽 아래로 내려간 뒤 오른쪽으로 물결치듯 마무리 (Z자·직선 금지)
④ 가로선이 충분히 넓고 전체가 삼각형 구도를 형성할 것`,

    'お': `## [お] 급소
① Aspect Ratio 왜곡 검사: 자형의 세로가 가로의 1.5배 초과, 또는 가로가 세로의 1.5배 초과 시
   → 형태정확성 Step 1 기본점 -8점 (30→22점).
② 타원 루프가 시각적으로 닫혀 있을 것 — 열린 C자 형태 시 형태 감점
③ 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립적으로 위치할 것 (루프 안에 그리면 오류)
④ 1획(가로선)이 2획보다 위에서 수평으로 그려질 것`,
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
  const fewShotSection = buildFewShotPrompt(target);
  const criticalPoints = getCharacterCriticalPoints(target);
  const negPatterns    = getFilteredNEG(target);

  // TIER 분류 (지침서 v2 §3.1)
  const tierMap = {
    'あ': { tier: 3, tol: 20 }, 'お': { tier: 3, tol: 20 },
    'む': { tier: 3, tol: 20 }, 'ぬ': { tier: 3, tol: 20 },
    'ね': { tier: 3, tol: 20 }, 'る': { tier: 3, tol: 20 },
    'い': { tier: 1, tol: 12 }, 'う': { tier: 1, tol: 12 },
    'え': { tier: 2, tol: 15 },
  };
  const t = tierMap[target] || { tier: 2, tol: 15 };

  return `당신은 히라가나 손글씨 AI 채점 엔진입니다.
한국인 학습자(중·고교생 또는 성인 입문자)가 쓴 히라가나 '${target}'를 이미지로 보고
아래 지침에 따라 4개 항목을 채점하고 한국어 피드백을 생성하세요.
필순 점수는 시스템이 자동 계산하므로 반드시 0을 출력하세요.

${fewShotSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 루브릭 1 — 형태정확성 (최대 40pt)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

이 문자('${target}')는 TIER ${t.tier} — 만점 허용 오차 ±${t.tol}%

▶ 방식 B 구간별 선형 감점
  구간1 만점: 0 ~ ±${t.tol}% 이내 → 감점 없음
  구간2 소폭: ±${t.tol}% ~ ±${t.tol + 10}% → 선형 최대 -8pt
  구간3 중폭: ±${t.tol + 10}% ~ ±25% → 선형 최대 -20pt
  구간4 최저: ±25% 초과 → 최저 2pt 보장

${t.tier === 3 ? `▶ TIER 3 전용 — 내부 공간 비율 추가 채점
  あ: 동그라미 면적이 전체 문자 면적의 35%~50% 범위인가?
      벗어날 경우 추가 감점 (-최대 5pt)
      한국인 빈번 오류: 동그라미가 너무 작음 (35% 미만)

▶ 구조 붕괴 판정
  あ: 루프(동그라미)가 완전히 열리거나 없음 → 상한 22pt 확정` : ''}

${criticalPoints}

▶ 오류 패턴 (감지 시 반드시 반영):
${negPatterns}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 루브릭 2 — 필순 → 반드시 0 출력 (시스템 자동 계산)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 루브릭 3 — 획방향 (최대 20pt) = 방향 12pt + 각도 8pt
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ 방향(흐름) 12pt
  역방향 획 없음 → 12pt   역방향 1개 → 7pt   역방향 2개 이상 → 3pt
  ★ 역방향(180° 반전)은 "조금 기울었다"와 다릅니다. 반드시 구분하세요.

▶ 각도(기울기) 8pt — 획 유형별 허용 오차
  TYPE H 수평·수직 획: ±10° → 8pt / 10~20° → 4~6pt / 20° 초과 → 0~3pt
  TYPE D 사선(↘↙) 획: ±15° → 8pt / 15~25° → 4~6pt / 25° 초과 → 0~3pt
  TYPE C 곡선·굴림 획: ±20° → 8pt / 20~30° → 4~6pt / 30° 초과 → 0~3pt

★ あ 전용: 3획(동그라미)은 TYPE C — 시계 방향이 표준
  한국인 오류: 한글 ㅇ 습관으로 반시계 방향 역전 빈번 → 방향 오류로 처리

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 루브릭 4 — 끝맺음 (최대 10pt)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ 끝맺음 3유형 (피드백에서 반드시 아래 한국어 표현 사용, 일본어 금지)
  とめ  → "꾹 눌러 끝내기"          획 끝에서 필압 높이며 딱 멈춤
  はね  → "살짝 위로 삐치듯 마무리"  획 끝을 위쪽으로 살짝 올림
  はらい → "부드럽게 빼면서 마무리"  획 끝을 아래로 자연스럽게 흘림

▶ 오류 심각도별 감점 (누락 > 오판 > 과잉·미달 순)
  완전 누락: 꾹 눌러 -5pt / 부드럽게 빼기 -7pt / 살짝 위로 삐치기 -9pt
  유형 오판: 꾹 눌러 -3pt / 부드럽게 빼기 -5pt / 살짝 위로 삐치기 -7pt
  과잉·미달: -1pt ~ -2pt (가장 작은 감점)

▶ 살짝 위로 삐치기 과잉 기준
  만점: 삐침 길이 획 전체의 8~25%, 방향 오차 ±30° 이내
  과잉(25% 초과) 또는 미달(8% 미만): -2pt
  ★ 과잉 피드백은 반드시 긍정으로 시작: "위로 올리는 방향은 맞아요!"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 루브릭 5 — 균형비율 (최대 10pt)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
크기는 채점 제외. 크게 쓰든 작게 쓰든 내부 비율만 평가합니다.

  ① 내부 비율 5pt: 각 부분 크기 비율이 자연스러운가 (기준 ±20% 만점)
  ② 간격 균일성 3pt: 획들 사이 간격이 고르게 분포하는가 (편차 ±15% 만점)
  ③ 무게 중심 2pt: 전체 시각 무게가 한쪽으로 쏠리지 않는가 (중앙 ±15% 만점)

★ 형태에서 이미 감점된 획은 균형에서 추가 감점하지 마세요 (중복 감점 금지)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 피드백 생성 — F·A·C·T 프레임 (지침서 v2 §8)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ STEP 0: 채점 전 이 글씨의 주요 오류 1가지를 먼저 특정하세요
  [あ 오류 목록 — 이미지에서 실제로 보이는 것 1개만]
  ERR-A: 동그라미(3획)가 완전히 열려 있거나 거의 안 형성됨
  ERR-B: 동그라미가 가운데 세로선 오른쪽에만 있고 왼쪽으로 안 뻗음
  ERR-C: 동그라미가 전체 글자에 비해 너무 작음 (35% 미만)
  ERR-D: 동그라미가 너무 커서 위쪽 선들을 가림 (50% 초과)
  ERR-E: 가로선(1획)·세로선(2획) 교차점이 없거나 크게 어긋남
  ERR-F: 가로선(1획)이 30° 초과 기울어짐
  ERR-G: 세로선(2획)이 크게 기울거나 굽어짐
  ERR-H: 동그라미 방향이 반시계 (한글 ㅇ 습관)
  ERR-I: 전체 글자가 한쪽으로 크게 쏠림
  ERR-NONE: 위 오류 없음

▶ F·A·C·T 프레임 순서로 2~4문장 작성
  F 발견: 잘된 점 1가지 구체적으로 (15~30자)
  A 교정: STEP 0에서 특정한 오류를 동작으로 설명 (20~60자)
  C 행동단서: 다음 시도에서 바로 실행 가능한 방법 1가지 (15~40자)
  T 마무리: 격려 또는 다음 행동 유도 (10~25자)

▶ 등급별 F·A·C·T 비중
  A (90+): 격려 70% + 교정 30% — F·T 중심
  B (80~): 격려 50% + 교정 50% — 균형
  C (70~): 격려 40% + 교정 60% — A·C 중심, 최대 2개 교정
  D (60~): 격려 35% + 교정 65% — A·C 집중, 최대 2개 교정
  E (60-): 격려 60% + 교정 30% + 재도전 10% — 교정 1개만, 압도감 방지

▶ 절대 금지 표현
  "틀렸습니다" / "잘못됐어요" / "못 쓴 글씨" / "다시 처음부터"
  일본어 용어: とめ·はね·はらい·도메·하네·하라이 (괄호 안 참고도 금지)
  수치 없는 추상 표현: "형태가 좀 이상해요"

▶ 행동 가능한 교정 필수
  교정 피드백은 "무엇을, 어느 방향으로, 얼마나" 세 가지 포함
  ❌ "형태가 조금 부정확해요"
  ✅ "동그라미를 가운데 선 왼쪽으로 현재보다 30% 더 크게 돌려보세요"

반드시 아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 포함하지 마세요:
{
  "형태정확성": 숫자,
  "필순": 0,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2~4문장. F·A·C·T 프레임. 일본어 용어 절대 금지. STEP 0 오류를 구체적 동작으로 설명. 행동 가능한 1문장 포함 필수."
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

      // ─ Step B2: 기하학 패널티 (strokeMeta 좌표 직접 계산) ──
      // 하드캡(상한) 방식 폐기 → 소프트 패널티(-8점 감산) 방식으로 전환
      // 효과: 루프 닫힌 좋은 글씨는 AI 원점수 유지, 루프 열리면 -8점만 적용
      const geo = analyzeStrokeGeometry(trimmedTarget, strokeMeta);

      // 루프 패널티 적용 (중첩 방지: loopPenalty + aspectPenalty 합계 최대 -8점)
      const totalShapePenalty = Math.min(8, geo.loopPenalty + geo.aspectPenalty);
      if (totalShapePenalty > 0) {
        const before = parsed.형태정확성;
        parsed.형태정확성 = Math.max(0, parsed.형태정확성 - totalShapePenalty);
        console.log(`기하학 패널티 -${totalShapePenalty}점 → 형태정확성 ${before} → ${parsed.형태정확성}`);
      }

      // 왼쪽 돌출 없음 → 균형비율 -2점 (최소 3점)
      if (geo.hasLeftProtrusion === false) {
        const before = parsed.균형비율;
        parsed.균형비율 = Math.max(3, parsed.균형비율 - 2);
        console.log(`왼쪽 돌출 없음 → 균형비율 ${before} → ${parsed.균형비율}`);
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

        // 균형비율 Floor: 명백한 구조 이탈이 아닌 한 최소 5점 (v2.1 신설)
        // 1~2개 기점 이탈 수준(±20~35%)에서 AI가 5점 미만으로 내리는 것을 방지
        const hasRealBalanceError = /크게 벗어|위치 오류|구조적 결함|전체 비율 붕괴/.test(parsed.feedback || '');
        if (parsed.균형비율 < 5 && !hasRealBalanceError) {
          console.log(`균형비율 v2.1 floor: ${parsed.균형비율} → 5`);
          parsed.균형비율 = 5;
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
