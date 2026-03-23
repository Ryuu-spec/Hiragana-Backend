// score.js  v5.0 — 루브릭 v1.0 기준
// ┌──────────────────────────────────────────────────────────┐
// │  v5.0 변경점:                                             │
// │  · あ 전용 v2 아키텍처 제거                               │
// │  · あ도 い~お와 동일한 Gemini 채점 경로 사용              │
// │  · analyzeAh() 좌표 분석 → Gemini 프롬프트 보조 힌트     │
// │  · 1단계 판정 게이트를 프롬프트에 명시적 포함             │
// │                                                           │
// │  영역            배점  담당                               │
// │  형태 정확성     50pt  Gemini 2.5 Flash (이미지+좌표힌트) │
// │    ├ 골격        45pt    전체 자형 구조·형태              │
// │    └ 마무리(끝처리) 5pt  끝처리 (Klee One 교과서체 기준) │
// │  획순            25pt  태블릿 시간·순서 데이터            │
// │  비율 균형       15pt  태블릿 좌표 데이터                 │
// │  크기·위치       10pt  태블릿 바운딩박스 데이터           │
// └──────────────────────────────────────────────────────────┘
const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

// Supabase 채점 로그 저장
async function saveLog(data) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/scoring_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    });
  } catch(e) {
    console.log('Supabase 저장 실패:', e.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ① 획순 (25점 만점) — 루브릭 §6
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STROKE_RULES = {
  'あ': { expected: 3, orderCheck: (s) => {
    function classify(st) {
      if (st.displacement > 0.01 && st.pathLength / st.displacement > 2.5) return 3;
      if (st.width > st.height * 1.5) return 1;
      if (st.height > st.width * 1.2) return 2;
      return 0;
    }
    if (s.length !== 3) return false;
    const types = s.map(classify);
    console.log(`あ 획분류: [${types.join(',')}]`);
    if (types.includes(0)) return null;
    return types[0]===1 && types[1]===2 && types[2]===3;
  }},
  'い': { expected: 2, orderCheck: (s) => s[0].startX < s[1].startX },
  'う': { expected: 2, orderCheck: (s) => s[0].startY < s[1].startY },
  'え': { expected: 2, orderCheck: (s) => s[0].startY < s[1].startY },
  'お': { expected: 3, orderCheck: (s) => {
    const firstIsTop   = s[0].startY < s[1].startY;
    const thirdIsRight = s[2].startX > s[1].startX - 0.05;
    const thirdIsUpper = s[2].startY < (s[1].startY + s[1].height * 0.6);
    console.log(`お 필순: firstIsTop=${firstIsTop} thirdIsRight=${thirdIsRight} thirdIsUpper=${thirdIsUpper}`);
    return firstIsTop && thirdIsRight && thirdIsUpper;
  }},
};

const TYPE_A_PENALTY = { 1: 0, 2: 10, 3: 7, 4: 5 };

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  if (!rule || !Array.isArray(strokeMeta?.strokes) || !strokeMeta.strokes.length) return null;

  const n    = rule.expected;
  const diff = Math.abs((strokeMeta.count || 0) - n);

  if (diff >= 2) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5) * 2);
  if (diff === 1) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5));

  try {
    const r = rule.orderCheck(strokeMeta.strokes);
    if (r === null) return null;
    return r ? 25 : Math.max(0, 25 - (TYPE_A_PENALTY[n] || 7));
  } catch(e) { return 17; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ② 비율 균형 (15점 만점) — 루브릭 §7
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RATIO_NORMS = {
  'あ': [1.0, 1.2],
  'い': [1.2, 1.0],
  'う': [0.5, 1.0],
  'え': [0.6, 1.0],
  'お': [1.0, 0.5],
};

function calculateProportionScore(target, strokeMeta) {
  const norm = RATIO_NORMS[target];
  const s    = strokeMeta?.strokes;
  if (!norm || !Array.isArray(s) || s.length < 2) {
    console.log(`비율균형: ${target} 데이터 부족 → 기본값 10`);
    return 10;
  }
  if (s.length !== norm.length) {
    console.log(`비율균형: 획수 불일치(${s.length}/${norm.length}) → 기본값 8`);
    return 8;
  }

  const lengths = s.map(st =>
    st.pathLength > 0.01 ? st.pathLength
      : Math.sqrt((st.width || 0.01) ** 2 + (st.height || 0.01) ** 2)
  );

  if (target === 'い' && lengths[1] > lengths[0] * 1.15) {
    console.log(`い 비율역전(り 혼동 가능성) → 길이비율 0pt`);
    return 0;
  }

  const base    = lengths[0] || 0.01;
  const actual  = lengths.map(l => l / base);
  const normRel = norm.map(v => v / norm[0]);

  let totalDev = 0;
  for (let i = 1; i < actual.length; i++) {
    totalDev += Math.abs(actual[i] - normRel[i]) / (normRel[i] || 1);
  }
  const avgDev = totalDev / (actual.length - 1);

  let score;
  if      (avgDev <= 0.20) score = 15;
  else if (avgDev <= 0.35) score = 10;
  else                     score = 5;

  console.log(`비율균형: ${target} avgDev=${avgDev.toFixed(3)} → ${score}pt`);
  return score;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ③ 크기·위치 (10점 만점) — 루브릭 §8
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calculateGridScore(strokeMeta) {
  const arr = strokeMeta?.arrangement;
  if (!arr) { console.log('크기위치 데이터 없음 → 기본값 6'); return 6; }

  const size = Math.max(arr.charWidth || 0, arr.charHeight || 0);
  let sizeScore;
  if      (size >= 0.60 && size <= 0.90) sizeScore = 5;
  else if (size >= 0.50 && size <= 1.00) sizeScore = 3;
  else                                   sizeScore = 0;
  console.log(`크기비율: ${size.toFixed(2)} → ${sizeScore}pt`);

  const dX = Math.abs((arr.charCenterX || 0.5) - 0.5);
  const dY = Math.abs((arr.charCenterY || 0.5) - 0.5);
  const d  = Math.sqrt(dX * dX + dY * dY);
  let centerScore;
  if      (d < 0.25) centerScore = 5;
  else if (d < 0.35) centerScore = 3;
  else               centerScore = 0;
  console.log(`중심편차: ${d.toFixed(3)} → ${centerScore}pt`);

  const total = Math.min(10, sizeScore + centerScore);
  console.log(`크기위치 합계: ${total}pt`);
  return total;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ④ 쇼엘레이스 공식 — 루프 방향 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcLoopDirection(points) {
  if (!points || points.length < 3) return null;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  if (Math.abs(area) < 0.005) return null;
  return area < 0 ? 'ccw' : 'cw';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑤ あ 좌표 분석 → Gemini 보조 힌트 생성용
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function analyzeAh(strokeMeta) {
  const s = strokeMeta?.strokes;
  const result = {
    d1_loop:     'unknown',
    d2_cross:    'unknown',
    d3_closure:  'unknown',
    d4_dir:      'unknown',
    d5_protrude: 'unknown',
    charWidth:   0,
    loopRatio:   0,
    strokeCount: s?.length ?? 0,
  };

  if (!Array.isArray(s) || s.length !== 3) {
    console.log(`あ 분석: 획수 ${s?.length ?? 0} → 분석 불가`);
    return result;
  }

  const [s1, s2, s3] = s;

  const allMinX = Math.min(s1.minX, s2.minX, s3.minX);
  const allMaxX = Math.max(s1.maxX, s2.maxX, s3.maxX);
  result.charWidth = allMaxX - allMinX || 0.01;

  // D1: 루프(3획) 크기 비율
  result.loopRatio = s3.width / result.charWidth;
  if      (result.loopRatio > 1.30) result.d1_loop = '과대';
  else if (result.loopRatio >= 0.50) result.d1_loop = '적정';
  else if (result.loopRatio >= 0.30) result.d1_loop = '과소';
  else                               result.d1_loop = '매우과소';
  console.log(`あ D1 루프비율: ${result.loopRatio.toFixed(3)} → ${result.d1_loop}`);

  // D2: 교차점
  const yOverlap = s2.minY <= s1.maxY && s2.maxY >= s1.minY;
  const xOverlap = s2.minX <= s1.maxX && s2.maxX >= s1.minX;
  const crossOk  = yOverlap && xOverlap;

  if (!crossOk) {
    result.d2_cross = '없음';
  } else {
    const s2centerX  = (s2.minX + s2.maxX) / 2;
    const s1width    = (s1.maxX - s1.minX) || 0.01;
    const crossRatio = (s2centerX - s1.minX) / s1width;
    if (crossRatio < 0.15 || crossRatio > 0.85) {
      result.d2_cross = '크게이탈';
    } else {
      result.d2_cross = '정상';
    }
    console.log(`あ D2 교차비율: ${crossRatio.toFixed(3)} → ${result.d2_cross}`);
  }

  // D3: 루프 닫힘
  const loopDist = Math.sqrt((s3.endX - s3.startX) ** 2 + (s3.endY - s3.startY) ** 2);
  const closureRatio = s3.pathLength > 0.01 ? loopDist / s3.pathLength : 1;
  if      (closureRatio < 0.18) result.d3_closure = '닫힘';
  else if (closureRatio < 0.35) result.d3_closure = '약간열림';
  else                          result.d3_closure = '열림';
  console.log(`あ D3 루프닫힘: ratio=${closureRatio.toFixed(3)} → ${result.d3_closure}`);

  // D4: 루프 방향
  const dir = s3.direction || calcLoopDirection(s3.points);
  result.d4_dir = dir || 'unknown';
  console.log(`あ D4 루프방향: ${result.d4_dir}`);

  // D5: 루프 왼쪽 돌출
  const protrusion = s2.minX - s3.minX;
  const threshold  = result.charWidth * 0.15;
  result.d5_protrude = protrusion >= threshold ? '정상' : '미돌출';
  console.log(`あ D5 왼쪽돌출: ${result.d5_protrude}`);

  return result;
}

// ── あ 좌표 분석 결과 → 프롬프트용 힌트 텍스트 ─────────
function buildCoordinateHints(target, strokeMeta) {
  if (target !== 'あ') return '';

  const d = analyzeAh(strokeMeta);
  const lines = [];

  lines.push(`\n## 좌표 분석 보조 정보 (참고용 — 이미지와 불일치 시 이미지 우선)`);
  lines.push(`- 입력 획수: ${d.strokeCount}획 (기대: 3획)`);

  if (d.strokeCount !== 3) {
    lines.push(`- ⚠️ 획수가 기대와 다름 — 이미지로 직접 판단하세요`);
    return lines.join('\n');
  }

  lines.push(`- 루프(3획) 크기: ${d.d1_loop} (루프폭/글자폭 = ${d.loopRatio.toFixed(2)})`);
  lines.push(`- 1·2획 교차점: ${d.d2_cross}`);
  lines.push(`- 루프 닫힘 상태: ${d.d3_closure}`);
  lines.push(`- 루프 방향(좌표): ${d.d4_dir === 'cw' ? '시계방향(정상)' : d.d4_dir === 'ccw' ? '반시계방향(반대)' : '판별불가'}`);
  lines.push(`- 루프 왼쪽 돌출: ${d.d5_protrude}`);
  lines.push(`\n위 좌표 데이터는 참고용입니다. 이미지를 직접 보고 골격·마무리 점수를 매기세요.`);
  lines.push(`단, 좌표와 이미지 판단이 일치하면 확신을 갖고 채점하세요.`);
  lines.push(`좌표와 이미지가 불일치하면 이미지 기준으로 판단하세요.`);

  return lines.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑥ 기하학 분석 — 오버레이 힌트용 (자형 패널티 계산)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractAnchors(target, strokeMeta) {
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s)) return null;
  if (target === 'あ' && s.length === 3) {
    const [s1, s2, s3] = s;
    const minXPt = (st) => st.points?.length
      ? st.points.reduce((m, p) => p[0] < m[0] ? p : m)
      : [st.minX ?? st.startX, st.minY ?? st.startY];
    return {
      P5: [s3.startX, s3.startY], P6: minXPt(s3), P7: [s3.endX, s3.endY],
      s1minX: s1.minX ?? s1.startX, s2minX: s2.minX ?? s2.startX
    };
  }
  return null;
}

function ptDist(a, b) { return Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2); }

function analyzeStrokeGeometry(target, strokeMeta) {
  const result = { loopPenalty: 0, aspectPenalty: 0, hasLeftProtrusion: null };
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s) || !s.length) return result;

  if (target === 'あ' && s.length === 3) {
    const an = extractAnchors('あ', strokeMeta);
    if (an) {
      const { P5, P6, P7 } = an;
      const loop = s[2];
      const ratio = loop.pathLength > 0.01 ? ptDist(P5, P7) / loop.pathLength : 1;
      if      (ratio < 0.40) result.loopPenalty = 0;
      else if (ratio < 0.60) result.loopPenalty = 3;
      else if (ratio < 0.80) result.loopPenalty = 5;
      else                   result.loopPenalty = 8;

      const dir = loop.direction || calcLoopDirection(loop.points);
      if (dir === 'cw') {
        result.loopPenalty = Math.min(8, result.loopPenalty + 3);
      }
      result.hasLeftProtrusion = P6[0] < (an.s2minX - 0.05);
    }
  }

  if (target === 'お' && s.length === 3) {
    const loop = s[1];
    const dir  = loop.direction || calcLoopDirection(loop.points);
    if (dir === 'cw') result.loopPenalty = Math.min(7, result.loopPenalty + 3);
    const ratio2 = loop.pathLength > 0.01
      ? ptDist([loop.startX, loop.startY], [loop.endX, loop.endY]) / loop.pathLength : 1;
    if      (ratio2 < 0.45) { /* OK */ }
    else if (ratio2 < 0.65) result.loopPenalty = Math.min(7, result.loopPenalty + 3);
    else                    result.loopPenalty = Math.min(7, result.loopPenalty + 5);
  }

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑦ 글자별 급소
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getCharacterCriticalPoints(target) {
  const T = {
    'あ': `## [あ] 급소\n① 3획 시작점: 1·2획 교차점 바로 오른쪽 위\n② 교차점 통과 + 삼각형 여백 형성\n③ 【왼쪽 돌출 필수】3획의 가장 왼쪽 지점이 2획(세로선)보다 글자 전체 폭의 15% 이상 왼쪽으로 나와야 함 — 2획 왼쪽 경계를 넘지 못하면 골격 -7pt, 피드백 최우선 지적\n④ 루프: 반시계 방향으로 둥글게 닫히고 왼쪽 아래로 흘림`,
    'い': `## [い] 급소\n① 두 획 모두 우하향 사선 (수직 금지)\n② 오른쪽 획이 왼쪽 획보다 짧을 것\n③ 2획 끝 왼쪽 아래 방향으로 구부리며 꾹 눌러 끝내기 (토메 — 뚝 끊기면 마무리 -2pt)`,
    'う': `## [う] 급소\n① 상단 짧은 점 사선 존재 (수평 금지)\n② 전체 세로로 길쭉한 형태\n③ U자 하단 굴곡 충분히 표현`,
    'え': `## [え] 급소\n① 1획 우하향 짧은 사선 (수평 금지)\n② 2획 끝 왼쪽 아래 후 오른쪽으로 물결 마무리\n③ 가로선 충분히 넓고 삼각형 구도`,
    'お': `## [お] 급소\n① 타원 루프 반시계 방향으로 닫힐 것\n② 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립\n③ 1획(가로선)이 2획보다 위에서 수평으로`,
  };
  return T[target] || `## [${target}] 전체 자형의 비례와 획 방향을 표준과 비교하세요.`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑧ 퓨샷 — 골격(45pt) + 마무리(5pt) 기준으로 매핑
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return '';

  const fmt = (d) => `골격${d.골격}/마무리${d.마무리}`;

  return `
## ${target} 채점 앵커 (골격 + 마무리)
[A등급] ${data.s90.description} → ${fmt(data.s90)}
[B등급] ${data.s80.description} → ${fmt(data.s80)}
[C등급] ${data.s70.description} → ${fmt(data.s70)}
[D등급↓] ${data.s60.description} → ${fmt(data.s60)}
위 4단계를 기준 닻으로 삼아 상대 판단하세요.
`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑨ 프롬프트 빌더 — Gemini용 (통합)
//    coordHints: あ의 경우 좌표 분석 보조 힌트 텍스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildPrompt(target, coordHints) {
  const hintsBlock = coordHints || '';

  return `당신은 20년 경력의 일본어 교사입니다. 중학교 1학년 초학습자 관점에서, 전문 용어 없이 쉬운 한국어로 개선 방법을 알려주세요.
히라가나 '${target}'를 이미지로 보고 자형 항목(골격 + 마무리)만 채점하세요.
(획순 25점은 태블릿 시간 데이터 / 비율 균형 15점·크기·위치 10점은 좌표 데이터로 시스템이 별도 계산합니다)

${buildFewShotPrompt(target)}

★ 채점 철학: "Klee One 교과서체를 목표로, UD 교과서체 수준이면 감점 없음"
★ 가산제: 0점에서 시작, 갖춰진 요소마다 점수를 쌓습니다.
★ Safe Zone ±20%: 위치 이탈이 이 범위 내이면 만점 처리, 피드백 금지.
★ 루프 방향은 이미지로 판단 금지 — 완성 형태의 구조만 보고 판단하세요.

### ■ 0단계 — 1단계 판정 게이트 (반드시 먼저 수행)
이미지를 보고 아래 기준에 해당하는지 먼저 판단하세요:
- 【판독 불가】 글자로 인식할 수 없는 경우 → 골격 0~10, 마무리 0
- 【다른 문자】 히라가나 '${target}'가 아닌 다른 문자(한글·로마자·숫자·다른 히라가나)인 경우 → 골격 0, 마무리 0, feedback에 "히라가나 '${target}'로 다시 써주세요" 포함
- 【혼동 오류】 다른 히라가나와 혼동되는 경우(예: あ↔お, い↔り, う↔つ) → 골격 0, 마무리 0, feedback에 구체적 혼동 쌍 명시
- 【미완성】 획이 명백히 부족하거나 중간에 끊긴 경우 → 골격 0~15, 마무리 0
- 위 어느 것에도 해당하지 않으면 → 아래 세부 채점 진행

### ■ 골격 (최대 45점)
【이중 앵커 원칙】
 · 목표 기준: Klee One 교과서체 — 이 자형에 가까울수록 높은 점수
 · 허용범위: UD 교과서체 — 획 방향·교차점·비율이 UD 수준이면 감점 없음
 · UD 수준 충족 → 기본점 확보 / Klee One에 근접할수록 가산
 · 붓글씨적 세밀함이 부족해도 UD처럼 핵심 뼈대가 명확하고 가독성 높으면 긍정 평가

【그룹별 핵심 채점 기준】
 끝처리 그룹(し·つ·い·り 등): 끝 방향 명확성 / 획 간 길이·비율
  ※ い: 1획 하단 오른쪽 위 튕김 방향이 골격에 포함 — 방향 맞으면 감점 없음
 복합+루프 그룹(あ·お·ぬ 등): 루프 방향 / 교차점 위치 / 획 연결 / 내부 공간
 비율·각도 그룹(へ·く·て 등): 획 길이·비율 / 꺾이는 각도 허용 범위

【1단계 구조 게이트】
 복합(あ·え·お) 기본 31 / FAIL(교차 없거나 루프 전무) → 상한 23
 단순(い·う)   기본 29 / FAIL(획 완전 겹침) → 상한 20
 인식불가 → 0~18점

【う 전용 비율 판정】 ← 인식불가 아님, 골격 감점만 적용
 세로 > 가로 (세로 길쭉) → 감점 없음 (UD 허용범위 충족)
 세로 ≈ 가로 (정사각형) → -5pt
 가로 > 세로 (つ형)      → -10pt ※ う로 인식은 되므로 인식불가 처리 금지

【え 1·2획 방향 기준】
 1획: 오른쪽 아래로 향하는 짧은 사선 (우하향)
 2획: 왼쪽 아래에서 오른쪽 위로 시작(위쪽으로 기울기) → 접기 → 돌아가기 → 접기 → 똑바로 → 휘기 → 맺음

【2단계 기하학 검증】 감산 최대 -9pt
 Aspect 왜곡(あ·え·お): -4 / 삼각여백 없음(あ): -5 / 역방향획: -3~5

【3단계 미학 가산】 오직 +, 최대 +14pt
 Klee One에 근접(유려·자연스러움): +9~14
 UD 수준 유지(다소 딱딱): +4~8
 UD 미달(뭉툭·불안정): +0~3

### ■ 마무리(끝처리) (최대 5점) — Klee One 교과서체 끝처리 기준
획의 끝 처리가 Klee One 교과서체와 얼마나 일치하는가를 채점합니다.
UD 교과서체는 끝처리를 단순화하므로 마무리에는 UD 허용범위 적용 안 함 — Klee One 기준 엄격 적용.

【채점 기준】
 5점: 모든 획의 끝처리가 자연스럽고 Klee One과 일치 (꾹 눌러 끝내기 / 살짝 위로 삐치듯 / 부드럽게 빼면서)
 3점: 절반 이상의 획에서 끝처리가 표현됨
 1점: 끝처리 시도는 있으나 방향·강도 부정확
 0점: 모든 획이 뚝 끊기거나 끝처리 전무

【い 전용 마무리 기준】
 1획 곡선미(완만하게 휘어짐): Klee One 특징 — 직선이어도 골격 감점 없음, 곡선이면 마무리 가산
 끝처리 방향이 표준과 같으면 세기가 약해도 3점 이상 부여

${getCharacterCriticalPoints(target)}

## 오류 패턴
${getFilteredNEG(target)}
${hintsBlock}

★ 제한: 골격≤45, 마무리≤5 절대 초과 금지
★ 피드백: 일본어용어(하네·하라이·토메) 절대금지. 꾹눌러끝내기·살짝위로삐치듯·부드럽게빼면서 표현사용.
★ 피드백 우선순위 예외: 급소에 "피드백 최우선 지적"으로 표시된 결함은 점수와 무관하게 반드시 첫 문장에서 지적할 것 — 80점 이상이어도 예외 없음.

아래 JSON으로만 응답 (다른 텍스트 절대금지):
{"골격":숫자,"마무리":숫자,"feedback":"한국어 2~3문장. [0단계 해당시]해당 이유만 짧게. [60미만]핵심1가지. [60~79]잘된점+개선1. [80↑]칭찬위주."}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑩ 오버레이 힌트 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateOverlayHints(target, strokeMeta, geo) {
  const hints = [];
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s) || !s.length) return hints;

  if (target === 'あ' && s.length === 3) {
    const an = extractAnchors('あ', strokeMeta);
    if (an) {
      const { P5, P6, P7 } = an;
      const [s1, s2] = s;
      const crossX = s2.startX;
      const crossY = (s1.startY + s1.endY) / 2;
      const d = Math.sqrt((P5[0]-crossX)**2 + (P5[1]-crossY)**2);
      if (d > 0.20) {
        hints.push({type:'problem',    x:P5[0], y:P5[1], label:'원 시작점이 너무 멀어요'});
        hints.push({type:'target',     x:crossX+0.03, y:crossY+0.06, label:'여기서 시작'});
        hints.push({type:'arrow',      fromX:P5[0], fromY:P5[1], toX:crossX+0.03, toY:crossY+0.06});
      }
      if (geo.hasLeftProtrusion === false)
        hints.push({type:'arrow_left', fromX:P6[0], fromY:P6[1], toX:Math.max(0,P6[0]-0.14), toY:P6[1], label:'왼쪽으로 더 뻗어요'});
      if (geo.loopPenalty >= 5)
        hints.push({type:'close_loop', fromX:P7[0], fromY:P7[1], toX:P5[0], toY:P5[1], label:'원을 닫아주세요'});
    }
  }

  if (target === 'お' && s.length === 3) {
    const loop = s[1];
    if (geo.loopPenalty >= 5)
      hints.push({type:'close_loop', fromX:loop.endX, fromY:loop.endY, toX:loop.startX, toY:loop.startY, label:'원을 닫아주세요'});
  }

  if (target === 'い' && s.length === 2) {
    const [s1] = s;
    if (s1.height > s1.width * 2.5)
      hints.push({type:'arrow', fromX:s1.startX, fromY:s1.startY, toX:s1.startX+0.15, toY:s1.startY+0.3, label:'오른쪽 아래로 사선'});
  }

  return hints;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑪ 핸들러 — あ~お 모두 동일 경로
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({error:'POST만 허용'});

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({error:'API 키 없음'});

  const {target, imageData, strokeMeta} = req.body || {};
  if (!target || !imageData) return res.status(400).json({error:'필수 파라미터 누락'});

  const trimmed = target.trim();
  const b64     = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  if (b64.length < 100) return res.status(400).json({error:'이미지 데이터 부족'});

  try {
    // ── あ 좌표 분석 보조 힌트 (あ만 해당) ──────────────
    const coordHints = buildCoordinateHints(trimmed, strokeMeta);

    // ── Gemini 2.5 Flash — 골격(45pt) + 마무리(5pt) 채점 ──
    const prompt = buildPrompt(trimmed, coordHints);
    console.log(`[${trimmed}] 프롬프트 길이: ${prompt.length}자${coordHints ? ' (좌표힌트 포함)' : ''}`);

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: [
            {text: prompt},
            {inline_data: {mime_type:'image/jpeg', data:b64}}
          ]}],
          generationConfig: {thinkingConfig: {thinkingBudget: 512}}
        })
      }
    );
    const data = await resp.json();
    if (data.error)            return res.status(500).json({error:'Gemini 오류', detail:data.error});
    if (!data.candidates?.[0]) return res.status(500).json({error:'candidates 없음'});
    const text = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!text)                 return res.status(500).json({error:'text 없음'});

    try {
      const p = JSON.parse(text.replace(/```json|```/g, '').trim());

      // ── 골격 / 마무리 클램핑 ──────────────────────────────
      p.골격    = Math.min(45, Math.max(0, p.골격    || 0));
      p.마무리  = Math.min(5,  Math.max(0, p.마무리  || 0));
      p.형태정확성 = p.골격 + p.마무리;
      console.log(`[${trimmed}] Gemini 골격: ${p.골격}pt  마무리: ${p.마무리}pt  형태정확성: ${p.형태정확성}pt`);

      // 오버레이 힌트용 기하학 분석
      const geo = analyzeStrokeGeometry(trimmed, strokeMeta);

      // 획순 (25pt)
      const cs = calculateStrokeScore(trimmed, strokeMeta);
      p.획순 = cs !== null ? cs : 18;
      console.log(`[${trimmed}] 획순: ${p.획순}pt${cs === null ? ' (기본값)' : ''}`);

      // 비율 균형 (15pt)
      p.비율균형 = calculateProportionScore(trimmed, strokeMeta);

      // 크기·위치 (10pt)
      p.크기위치 = calculateGridScore(strokeMeta);

      // 최종 합산
      p.score = p.형태정확성 + p.획순 + p.비율균형 + p.크기위치;
      console.log(`[${trimmed}] 최종 ${p.score}점 (골격${p.골격} 마무리${p.마무리} 획순${p.획순} 비율균형${p.비율균형} 크기위치${p.크기위치})`);

      // 성취 등급 (루브릭 §2)
      if      (p.score >= 90) p.grade = 'A';
      else if (p.score >= 80) p.grade = 'B';
      else if (p.score >= 70) p.grade = 'C';
      else if (p.score >= 60) p.grade = 'D';
      else                    p.grade = 'E';

      // 오버레이 힌트
      p.overlayHints = generateOverlayHints(trimmed, strokeMeta, geo);
      console.log(`오버레이 힌트 ${p.overlayHints.length}개`);

      // Supabase 로그
      await saveLog({
        character:        trimmed,
        score_total:      p.score,
        score_skeleton:   p.골격,
        score_finish:     p.마무리,
        score_shape:      p.형태정확성,
        score_stroke:     p.획순,
        score_ratio:      p.비율균형,
        score_grid:       p.크기위치,
        grade:            p.grade,
        feedback:         p.feedback,
        arch:             trimmed === 'あ' ? 'v5_unified_with_hints' : 'v5_unified'
      });

      return res.status(200).json(p);

    } catch(e) {
      console.log('JSON 파싱 실패:', text.slice(0, 300));
      return res.status(500).json({error:'JSON 파싱 실패', raw:text});
    }
  } catch(err) {
    return res.status(500).json({error:'서버 연결 실패', message:err.message});
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };
