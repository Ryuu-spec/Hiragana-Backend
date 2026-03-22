// score.js  v4.0 — 루브릭 v1.0 기준
// ┌─────────────────────────────────────────────────┐
// │  영역          배점  담당                        │
// │  자형          50pt  Gemini 2.5 Flash (이미지)   │
// │  필순          25pt  태블릿 시간·순서 데이터      │
// │  길이·비율     15pt  태블릿 좌표 데이터           │
// │  그리드 배치   10pt  태블릿 바운딩박스 데이터     │
// └─────────────────────────────────────────────────┘
const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ① 필순 (25점 만점) — 루브릭 §6
//    태블릿이 시간순으로 넘겨준 strokes 배열을 그대로 사용
//    (strokes[0]이 첫 번째 그은 획, strokes[n-1]이 마지막 획)
//
//    TYPE A 순서역전(가장 심각): 2획-10pt / 3획-7pt / 4획-5pt
//    TYPE B 인접교환(n↔n+1):   2획 TYPE A 처리 / 3획-5pt / 4획-4pt
//    TYPE C 방향역행(획 내):    1획-4pt / 2획-3pt / 3획-2pt / 4획-2pt
//    TYPE D 분리·합치기:        1획-2pt / 2획-2pt / 3획-1pt / 4획-1pt
//    최저 0점, 최고 25점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STROKE_RULES = {

  // あ (3획): 가로획→세로획→루프
  'あ': { expected: 3, orderCheck: (s) => {
    function classify(st) {
      if (st.displacement > 0.01 && st.pathLength / st.displacement > 2.5) return 3; // 루프
      if (st.width > st.height * 1.5) return 1;  // 가로획
      if (st.height > st.width * 1.2) return 2;  // 세로획
      return 0;
    }
    if (s.length !== 3) return false;
    const types = s.map(classify);
    console.log(`あ 획분류: [${types.join(',')}]`);
    if (types.includes(0)) return null;
    return types[0]===1 && types[1]===2 && types[2]===3;
  }},

  // い (2획): 왼쪽 획이 먼저 — 시간순 배열에서 s[0]이 더 왼쪽이어야 함
  'い': { expected: 2, orderCheck: (s) => s[0].startX < s[1].startX },

  // う (2획): 위쪽 짧은 사선이 먼저
  'う': { expected: 2, orderCheck: (s) => s[0].startY < s[1].startY },

  // え (2획): 위쪽 짧은 사선이 먼저
  'え': { expected: 2, orderCheck: (s) => s[0].startY < s[1].startY },

  // お (3획): 가로획→루프→오른쪽 사선
  'お': { expected: 3, orderCheck: (s) => {
    const firstIsTop   = s[0].startY < s[1].startY;
    const thirdIsRight = s[2].startX > s[1].startX - 0.05;
    const thirdIsUpper = s[2].startY < (s[1].startY + s[1].height * 0.6);
    console.log(`お 필순: firstIsTop=${firstIsTop} thirdIsRight=${thirdIsRight} thirdIsUpper=${thirdIsUpper}`);
    return firstIsTop && thirdIsRight && thirdIsUpper;
  }},
};

// TYPE A 획수별 감점
const TYPE_A_PENALTY = { 1: 0, 2: 10, 3: 7, 4: 5 };

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  if (!rule || !Array.isArray(strokeMeta?.strokes) || !strokeMeta.strokes.length) return null;

  const n    = rule.expected;
  const diff = Math.abs((strokeMeta.count || 0) - n);

  // 획수 차이: TYPE A 수준 감점
  if (diff >= 2) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5) * 2);
  if (diff === 1) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5));

  // 획수 일치: 순서 검증
  try {
    const r = rule.orderCheck(strokeMeta.strokes);
    if (r === null) return null;   // 판별 불가 → 호출부에서 기본값 처리
    return r ? 25 : Math.max(0, 25 - (TYPE_A_PENALTY[n] || 7));
  } catch(e) { return 17; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ② 길이·비율 채점 (15점 만점) — 루브릭 §7
//    획 간 상대적 길이 비율 계산 (절대 길이는 그리드에서 처리)
//    ±20% 이내: 0감점(15pt) / ±20~35%: -5pt / ±35% 초과: -10pt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 획 간 기준 길이 비율 (첫 획 기준 정규화)
// い: 1획 > 2획이 정상 / 역전 시 り 혼동 오류 (루브릭 §5-1)
// loopIdx: 루프성 획 인덱스(0-based) — 자형에서 이미 처리하므로 비율 계산에서 제외
const RATIO_NORMS = {
  'あ': { norm: [1.0, 2.5],  loopIdx: [2] },  // 3획(루프) 제외, 1획(가로):2획(세로)≈1:2.5
  'い': { norm: [1.2, 1.0],  loopIdx: []  },
  'う': { norm: [0.5, 1.0],  loopIdx: []  },
  'え': { norm: [0.6, 1.0],  loopIdx: []  },
  'お': { norm: [1.0, 0.5],  loopIdx: [1] },  // 2획(루프) 제외, 1·3획만 비교
};

function calculateProportionScore(target, strokeMeta) {
  const entry = RATIO_NORMS[target];
  const s     = strokeMeta?.strokes;
  if (!entry || !Array.isArray(s) || s.length < 2) {
    console.log(`길이비율: ${target} 데이터 부족 → 기본값 10`);
    return 10;
  }

  // 루프 획 제외 — 루프는 자형(Gemini)에서 이미 채점
  const loopSet  = new Set(entry.loopIdx);
  const indices  = s.map((_, i) => i).filter(i => !loopSet.has(i));
  const norm     = entry.norm;

  if (indices.length < 2 || indices.length !== norm.length) {
    console.log(`길이비율: ${target} 비루프 획수 불일치(${indices.length}/${norm.length}) → 기본값 8`);
    return 8;
  }

  // pathLength 우선, 없으면 대각선 길이로 추정
  const lengths = indices.map(i => {
    const st = s[i];
    return st.pathLength > 0.01 ? st.pathLength
      : Math.sqrt((st.width || 0.01) ** 2 + (st.height || 0.01) ** 2);
  });

  // い 비율 역전: り 혼동 → 0점 (1단계 혼동 판정은 핸들러에서 별도 처리)
  if (target === 'い' && lengths[1] > lengths[0] * 1.15) {
    console.log(`い 비율역전(り 혼동 가능성) → 길이비율 0pt`);
    return 0;
  }

  // 첫 획 기준 상대 비율 → 기준값 대비 편차 평균
  const base    = lengths[0] || 0.01;
  const actual  = lengths.map(l => l / base);
  const normRel = norm.map(v => v / norm[0]);

  let totalDev = 0;
  for (let i = 1; i < actual.length; i++) {
    totalDev += Math.abs(actual[i] - normRel[i]) / (normRel[i] || 1);
  }
  const avgDev = totalDev / (actual.length - 1);

  let score;
  if      (avgDev <= 0.20) score = 15;   // ±20% 이내
  else if (avgDev <= 0.35) score = 10;   // ±20~35%: -5pt
  else                     score = 5;    // ±35% 초과: -10pt

  console.log(`길이비율: ${target} 비루프획[${indices.join(',')}] avgDev=${avgDev.toFixed(3)} → ${score}pt`);
  return score;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ③ 그리드 배치 채점 (10점 만점) — 루브릭 §8
//    크기비율(5pt): 칸의 60~90%
//    중심배치(5pt): 글자별 표준 중심점 ±15% 이내
//    ※ v1 중심점 기준: 칸 정중앙(0.5,0.5) 사용
//       추후 46자 표준 중심점 DB로 교체 예정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calculateGridScore(strokeMeta) {
  const arr = strokeMeta?.arrangement;
  if (!arr) { console.log('그리드 데이터 없음 → 기본값 6'); return 6; }

  // 크기비율 (5pt) — 순차 감점
  const size = Math.max(arr.charWidth || 0, arr.charHeight || 0);
  let sizeScore;
  if      (size >= 0.60 && size <= 0.90) sizeScore = 5;   // 적정
  else if (size >= 0.55 && size <  0.60) sizeScore = 4;   // -1pt
  else if (size >= 0.50 && size <  0.55) sizeScore = 3;   // -2pt
  else if (size >= 0.40 && size <  0.50) sizeScore = 2;   // -3pt
  else if (size >  0.90 && size <= 0.95) sizeScore = 4;   // -1pt
  else if (size >  0.95 && size <= 1.00) sizeScore = 3;   // -2pt
  else if (size >  1.00)                 sizeScore = 1;   // -4pt
  else                                   sizeScore = 0;   // 40% 미만
  console.log(`그리드 크기: ${size.toFixed(2)} → ${sizeScore}pt`);

  // 중심배치 (5pt)
  const dX = Math.abs((arr.charCenterX || 0.5) - 0.5);
  const dY = Math.abs((arr.charCenterY || 0.5) - 0.5);
  const d  = Math.sqrt(dX * dX + dY * dY);
  let centerScore;
  if      (d < 0.15) centerScore = 5;   // ±15% 이내
  else if (d < 0.25) centerScore = 3;   // ±15~25%: -2pt
  else               centerScore = 0;   // ±25% 초과: -5pt
  console.log(`그리드 중심편차: ${d.toFixed(3)} → ${centerScore}pt`);

  const total = Math.min(10, sizeScore + centerScore);
  console.log(`그리드 배치 합계: ${total}pt`);
  return total;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ④ 쇼엘레이스 공식 — 루프 방향 계산
//    스크린 좌표(y↓): 음수=CCW(반시계)=あ·お의 올바른 방향
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcLoopDirection(points) {
  if (!points || points.length < 3) return null;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  if (Math.abs(area) < 0.005) return null;
  return area < 0 ? 'cw' : 'ccw';  // 화면좌표계 Y↓: 부호 반전
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑤ 앵커 포인트
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑥ 기하학 분석 — 자형 패널티 계산 (루브릭 §4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      if      (ratio < 0.60) result.loopPenalty = 0;   // ±허용 범위 완화
      else if (ratio < 0.80) result.loopPenalty = 3;
      else                   result.loopPenalty = 5;
      console.log(`あ 루프닫힘 ratio:${ratio.toFixed(3)} → -${result.loopPenalty}pt`);

      const dir = loop.direction || calcLoopDirection(loop.points);
      if (dir === 'cw') {
        result.loopPenalty = Math.min(8, result.loopPenalty + 3);
        console.log(`あ 루프방향 오류 CW → 총패널티 ${result.loopPenalty}pt`);
      } else {
        console.log(`あ 루프방향 OK: ${dir || '불명'}`);
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
    if      (ratio2 < 0.60) { /* OK */ }                           // 허용 범위 완화
    else if (ratio2 < 0.80) result.loopPenalty = Math.min(5, result.loopPenalty + 3);
    else                    result.loopPenalty = Math.min(5, result.loopPenalty + 5);
    console.log(`お 루프: dir=${dir} ratio=${ratio2.toFixed(3)} pen=${result.loopPenalty}`);
  }

  if (['あ', 'え', 'お'].includes(target) && s.length >= 2) {
    const avgW = s.reduce((a, st) => a + (st.width || 0), 0) / s.length;
    const avgH = s.reduce((a, st) => a + (st.height || 0), 0) / s.length;
    const r = avgH > 0.01 ? avgW / avgH : 1;
    if (r < 0.40 || r > 2.20) {
      result.aspectPenalty = 4;
      console.log(`AspectRatio 왜곡 -4pt (${r.toFixed(2)})`);
    }
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑦ 글자별 급소
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getCharacterCriticalPoints(target) {
  const T = {
    'あ': `## [あ] 급소\n① 3획 시작점: 1·2획 교차점 바로 오른쪽 위\n② 교차점 통과 + 삼각형 여백 형성\n③ 3획이 2획 왼쪽으로 충분히 돌출하여 루프 형성\n④ 루프: 반시계 방향으로 둥글게 닫히고 왼쪽 아래로 흘림`,
    'い': `## [い] 급소\n① 두 획 모두 우하향 사선 (수직 금지)\n② ★길이 규칙: 왼쪽 획(1획)이 오른쪽 획(2획)보다 반드시 길어야 함 — 반대로 피드백 절대 금지\n③ 2획(오른쪽) 끝 왼쪽 아래로 구부려 마무리`,
    'う': `## [う] 급소\n① 상단 짧은 점 사선 존재 (수평 금지)\n② 전체 세로로 길쭉한 형태\n③ U자 하단 굴곡 충분히 표현`,
    'え': `## [え] 급소\n① 1획 우하향 짧은 사선 (수평 금지)\n② 2획 끝 왼쪽 아래 후 오른쪽으로 물결 마무리\n③ 가로선 충분히 넓고 삼각형 구도`,
    'お': `## [お] 급소\n① 타원 루프 반시계 방향으로 닫힐 것\n② 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립\n③ 1획(가로선)이 2획보다 위에서 수평으로`,
  };
  return T[target] || `## [${target}] 전체 자형의 비례와 획 방향을 표준과 비교하세요.`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑧ 퓨샷 (자형 50pt 기준으로 재매핑)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return '';
  const map = (d) => {
    const sc = d.scores;
    return {
      자형: Math.min(50, Math.round(
        (sc.형태정확성||0)/40*32 + (sc.획방향||0)/20*12 + (sc.균형비율||0)/10*6
      )),
    };
  };
  return `\n## ${target} 채점 기준 예시 (자형만)\n[A] ${data.s90.description.slice(0,100)}... → ${JSON.stringify(map(data.s90))}\n[B] → ${JSON.stringify(map(data.s80))}\n[C] → ${JSON.stringify(map(data.s70))}\n[D↓] → ${JSON.stringify(map(data.s60))}\n위 4단계를 기준 닻으로 삼아 상대 판단하세요.\n`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑨ 프롬프트 빌더 — Gemini용
//    Gemini 담당: 자형(50pt) + 피드백
//    필순·길이비율·그리드배치는 태블릿 데이터로 시스템 별도 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildPrompt(target) {
  return `당신은 20년 경력의 일본어 교사입니다. 중학교 1학년 초학습자 관점에서, 전문 용어 없이 쉬운 한국어로 개선 방법을 알려주세요.
히라가나 '${target}'를 이미지로 보고 자형 항목만 채점하세요.
(필순 25점은 태블릿 시간 데이터 / 길이·비율 15점·그리드 배치 10점은 좌표 데이터로 시스템이 별도 계산합니다)

${buildFewShotPrompt(target)}

★ 채점 철학: "교과서체를 최대한 닮았고, 정성껏 썼는가?" 85~90점 = 일본 초등 A+
★ 가산제: 0점에서 시작, 갖춰진 요소마다 점수를 쌓습니다.
★ Safe Zone ±20%: 위치 이탈이 이 범위 내이면 만점 처리, 피드백 금지.
★ 루프 방향은 이미지로 판단 금지 — 완성 형태의 구조만 보고 판단하세요.

### ■ 자형 (최대 50점) — 루브릭 §4
[그룹별 핵심 채점 기준]
 끝처리 그룹(し·つ·い·り 등): 끝 방향·はね 명확성 / 획 간 길이·비율
 복합+루프 그룹(あ·お·ぬ 등): 루프 방향 / 교차점 위치 / 획 연결 / 내부 공간
 비율·각도 그룹(へ·く·て 등): 획 길이·비율 / 꺾이는 각도 허용 범위
[1단계 구조 게이트]
 복합(あ·え·お) 기본35 / FAIL(교차없거나 루프전무)→상한26
 단순(い·う)   기본32 / FAIL(획 완전겹침)→상한22
 인식불가 → 0~20점
[2단계 기하학 검증] 감산 최대 -9pt
 Aspect 왜곡(あ·え·お): -4 / 삼각여백없음(あ): -5 / 역방향획: -3~5
[3단계 미학 가산] 오직 +, 최대 +15pt
 유려·자연스러움: +10~15 / 다소딱딱: +5~9 / 뭉툭: +0~4

${getCharacterCriticalPoints(target)}

## 오류 패턴
${getFilteredNEG(target)}

★ 제한: 자형≤50 절대초과금지
★ 피드백: 일본어용어(하네·하라이·토메) 절대금지. 꾹눌러끝내기·살짝위로삐치듯·부드럽게빼면서 표현사용.

아래 JSON으로만 응답 (다른 텍스트 절대금지):
{"자형":숫자,"feedback":"한국어 2~3문장. 잘된점 먼저. [60미만]핵심1가지. [60~79]잘된점+개선1. [80↑]칭찬위주."}`;
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
      if (geo.loopDirWrong) {
        const cx = (P5[0]+P6[0]+P7[0])/3, cy = (P5[1]+P6[1]+P7[1])/3;
        hints.push({type:'direction',  x:cx, y:cy, label:'반시계 방향으로 그려요'});
      }
    }
  }

  if (target === 'お' && s.length === 3) {
    const loop = s[1];
    if (geo.loopPenalty >= 5)
      hints.push({type:'close_loop', fromX:loop.endX, fromY:loop.endY, toX:loop.startX, toY:loop.startY, label:'원을 닫아주세요'});
    if (geo.loopDirWrong)
      hints.push({type:'direction', x:(loop.startX+loop.endX)/2, y:(loop.startY+loop.endY)/2, label:'반시계 방향으로 그려요'});
  }

  if (target === 'い' && s.length === 2) {
    const [s1] = s;
    if (s1.height > s1.width * 2.5)
      hints.push({type:'arrow', fromX:s1.startX, fromY:s1.startY, toX:s1.startX+0.15, toY:s1.startY+0.3, label:'오른쪽 아래로 사선'});
  }

  return hints;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⑪ 핸들러
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
    // Gemini 2.5 Flash — 자형(50pt)만 채점
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: [
            {text: buildPrompt(trimmed)},
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

      // 자형 클램핑
      p.자형 = Math.min(50, Math.max(0, p.자형 || 0));
      console.log(`[${trimmed}] Gemini 자형: ${p.자형}pt`);

      // 자형 기하학 패널티 적용 (태블릿 좌표 데이터 기반)
      const geo = analyzeStrokeGeometry(trimmed, strokeMeta);
      const pen = Math.min(7, geo.loopPenalty + geo.aspectPenalty);
      if (pen > 0) { p.자형 = Math.max(0, p.자형 - pen); console.log(`기하학 패널티 -${pen}pt → 자형${p.자형}`); }
      if (geo.hasLeftProtrusion === false) { p.자형 = Math.max(2, p.자형 - 2); console.log('왼돌출없음 -2pt'); }

      // 필순 (25pt) — 태블릿 시간·순서 데이터로 계산
      const cs = calculateStrokeScore(trimmed, strokeMeta);
      p.필순 = cs !== null ? cs : 18;   // 판별 불가 시 기본값 18pt
      console.log(`[${trimmed}] 필순: ${p.필순}pt${cs === null ? ' (기본값)' : ''}`);

      // 길이·비율 (15pt) — 태블릿 좌표 데이터로 계산
      p.길이비율 = calculateProportionScore(trimmed, strokeMeta);

      // 그리드 배치 (10pt) — 태블릿 바운딩박스 데이터로 계산
      p.그리드배치 = calculateGridScore(strokeMeta);

      // 최종 합산 (루브릭 §3-2)
      p.score = (p.자형||0) + (p.필순||0) + (p.길이비율||0) + (p.그리드배치||0);
      console.log(`[${trimmed}] 최종 ${p.score}점 (자형${p.자형} 필순${p.필순} 길이비율${p.길이비율} 그리드배치${p.그리드배치})`);

      // 성취 등급 (루브릭 §2)
      if      (p.score >= 90) p.grade = 'A';
      else if (p.score >= 80) p.grade = 'B';
      else if (p.score >= 70) p.grade = 'C';
      else if (p.score >= 60) p.grade = 'D';
      else                    p.grade = 'E';

      // 오버레이 힌트
      p.overlayHints = generateOverlayHints(trimmed, strokeMeta, geo);
      console.log(`오버레이 힌트 ${p.overlayHints.length}개`);

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
