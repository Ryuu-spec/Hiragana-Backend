// score.js  v4.5 — 루브릭 v1.0 기준
// v4.5 변경: D8 열린루프 보정 + D6/D9 실데이터 기준 재보정 + _debug 응답 포함
const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

async function saveLog(data) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/scoring_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify(data)
    });
  } catch(e) { console.log('Supabase 저장 실패:', e.message); }
}

// ── 획순 (25점) ──
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
    const firstIsTop = s[0].startY < s[1].startY;
    const thirdIsRight = s[2].startX > s[1].startX - 0.05;
    const thirdIsUpper = s[2].startY < (s[1].startY + s[1].height * 0.6);
    return firstIsTop && thirdIsRight && thirdIsUpper;
  }},
};
const TYPE_A_PENALTY = { 1: 0, 2: 10, 3: 7, 4: 5 };

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  if (!rule || !Array.isArray(strokeMeta?.strokes) || !strokeMeta.strokes.length) return null;
  const n = rule.expected;
  const diff = Math.abs((strokeMeta.count || 0) - n);
  if (diff >= 2) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5) * 2);
  if (diff === 1) return Math.max(0, 25 - (TYPE_A_PENALTY[n] || 5));
  try {
    const r = rule.orderCheck(strokeMeta.strokes);
    if (r === null) return null;
    return r ? 25 : Math.max(0, 25 - (TYPE_A_PENALTY[n] || 7));
  } catch(e) { return 17; }
}

// ── 비율 균형 (15점) ──
const RATIO_NORMS = { 'あ': [1.0, 1.2], 'い': [1.2, 1.0], 'う': [0.5, 1.0], 'え': [0.6, 1.0], 'お': [1.0, 0.5] };

function calculateProportionScore(target, strokeMeta) {
  const norm = RATIO_NORMS[target];
  const s = strokeMeta?.strokes;
  if (!norm || !Array.isArray(s) || s.length < 2) return 10;
  if (s.length !== norm.length) return 8;
  const lengths = s.map(st => st.pathLength > 0.01 ? st.pathLength : Math.sqrt((st.width||0.01)**2 + (st.height||0.01)**2));
  if (target === 'い' && lengths[1] > lengths[0] * 1.15) return 0;
  const base = lengths[0] || 0.01;
  const actual = lengths.map(l => l / base);
  const normRel = norm.map(v => v / norm[0]);
  let totalDev = 0;
  for (let i = 1; i < actual.length; i++) totalDev += Math.abs(actual[i] - normRel[i]) / (normRel[i] || 1);
  const avgDev = totalDev / (actual.length - 1);
  if (avgDev <= 0.20) return 15;
  if (avgDev <= 0.35) return 10;
  return 5;
}

// ── 크기·위치 (10점) ──
function calculateGridScore(strokeMeta) {
  const arr = strokeMeta?.arrangement;
  if (!arr) return 6;
  const size = Math.max(arr.charWidth || 0, arr.charHeight || 0);
  let sizeScore = (size >= 0.60 && size <= 0.90) ? 5 : (size >= 0.50 && size <= 1.00) ? 3 : 0;
  const dX = Math.abs((arr.charCenterX || 0.5) - 0.5);
  const dY = Math.abs((arr.charCenterY || 0.5) - 0.5);
  const d = Math.sqrt(dX*dX + dY*dY);
  let centerScore = d < 0.25 ? 5 : d < 0.35 ? 3 : 0;
  return Math.min(10, sizeScore + centerScore);
}

// ── 쇼엘레이스 공식 ──
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

// ── 앵커·기하학 (오버레이용) ──

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 품질 지표 함수 (v4.4 신규)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// D8: 루프 원형도 — 4π×|area| / perimeter²  (완벽한 원=1, 찌그러짐→0)
function calcCircularity(points) {
  if (!points || points.length < 4) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  area = Math.abs(area) / 2;
  let peri = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i-1][0], dy = points[i][1] - points[i-1][1];
    peri += Math.sqrt(dx*dx + dy*dy);
  }
  const dx0 = points[0][0] - points[points.length-1][0];
  const dy0 = points[0][1] - points[points.length-1][1];
  peri += Math.sqrt(dx0*dx0 + dy0*dy0);
  if (peri < 0.001) return 0;
  return Math.min(1, (4 * Math.PI * area) / (peri * peri));
}

// D9: 획 떨림(jitter) — 연속 3점 방향 변화의 표준편차 (낮을수록 매끄러움)
function calcStrokeJitter(points) {
  if (!points || points.length < 4) return 0;
  const angles = [];
  for (let i = 1; i < points.length - 1; i++) {
    const dx1 = points[i][0]-points[i-1][0], dy1 = points[i][1]-points[i-1][1];
    const dx2 = points[i+1][0]-points[i][0], dy2 = points[i+1][1]-points[i][1];
    const a1 = Math.atan2(dy1, dx1), a2 = Math.atan2(dy2, dx2);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= 2*Math.PI;
    while (diff < -Math.PI) diff += 2*Math.PI;
    angles.push(Math.abs(diff));
  }
  if (angles.length === 0) return 0;
  const mean = angles.reduce((a,b)=>a+b,0) / angles.length;
  const variance = angles.reduce((a,b)=>a+(b-mean)**2,0) / angles.length;
  return Math.sqrt(variance);
}

// D9: 전체 획 평균 떨림
function calcAvgJitter(strokes) {
  if (!strokes || strokes.length === 0) return 0;
  let total = 0, count = 0;
  strokes.forEach(st => {
    if (st.points && st.points.length >= 4) {
      total += calcStrokeJitter(st.points);
      count++;
    }
  });
  return count > 0 ? total / count : 0;
}

// D10: 교차 직교도 — 1획과 2획의 주 방향 각도 차이 (90°가 이상적)
function calcCrossAngle(s1, s2) {
  const dx1 = s1.endX - s1.startX, dy1 = s1.endY - s1.startY;
  const dx2 = s2.endX - s2.startX, dy2 = s2.endY - s2.startY;
  const mag1 = Math.sqrt(dx1*dx1+dy1*dy1), mag2 = Math.sqrt(dx2*dx2+dy2*dy2);
  if (mag1 < 0.001 || mag2 < 0.001) return 90;
  const cosA = Math.max(-1, Math.min(1, (dx1*dx2+dy1*dy2)/(mag1*mag2)));
  return Math.acos(cosA) * 180 / Math.PI;
}
function extractAnchors(target, strokeMeta) {
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s)) return null;
  if (target === 'あ' && s.length === 3) {
    const [s1, s2, s3] = s;
    const minXPt = (st) => st.points?.length ? st.points.reduce((m, p) => p[0] < m[0] ? p : m) : [st.minX ?? st.startX, st.minY ?? st.startY];
    return { P5: [s3.startX, s3.startY], P6: minXPt(s3), P7: [s3.endX, s3.endY], s1minX: s1.minX ?? s1.startX, s2minX: s2.minX ?? s2.startX };
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
      const loop = s[2];
      const ratio = loop.pathLength > 0.01 ? ptDist(an.P5, an.P7) / loop.pathLength : 1;
      if (ratio < 0.40) result.loopPenalty = 0;
      else if (ratio < 0.60) result.loopPenalty = 3;
      else if (ratio < 0.80) result.loopPenalty = 5;
      else result.loopPenalty = 8;
      const dir = loop.direction || calcLoopDirection(loop.points);
      if (dir === 'cw') result.loopPenalty = Math.min(8, result.loopPenalty + 3);
      result.hasLeftProtrusion = an.P6[0] < (an.s2minX - 0.05);
    }
  }
  if (target === 'お' && s.length === 3) {
    const loop = s[1];
    const dir = loop.direction || calcLoopDirection(loop.points);
    if (dir === 'cw') result.loopPenalty = Math.min(7, result.loopPenalty + 3);
    const ratio2 = loop.pathLength > 0.01 ? ptDist([loop.startX, loop.startY], [loop.endX, loop.endY]) / loop.pathLength : 1;
    if (ratio2 >= 0.45 && ratio2 < 0.65) result.loopPenalty = Math.min(7, result.loopPenalty + 3);
    else if (ratio2 >= 0.65) result.loopPenalty = Math.min(7, result.loopPenalty + 5);
  }
  return result;
}

// ── 글자별 급소 ──
function getCharacterCriticalPoints(target) {
  const T = {
    'あ': "## [あ] 급소\n① 3획 시작점: 1·2획 교차점 바로 오른쪽 위\n② 교차점 통과 + 삼각형 여백 형성\n③ 【왼쪽 돌출 필수】3획의 가장 왼쪽 지점이 2획(세로선)보다 글자 전체 폭의 15% 이상 왼쪽으로 나와야 함 — 2획 왼쪽 경계를 넘지 못하면 골격 -7pt, 피드백 최우선 지적\n④ 루프: 반시계 방향으로 둥글게 닫히고 왼쪽 아래로 흘림",
    'い': "## [い] 급소\n① 두 획 모두 우하향 사선 (수직 금지)\n② 오른쪽 획이 왼쪽 획보다 짧을 것\n③ 2획 끝 왼쪽 아래 방향으로 구부리며 꾹 눌러 끝내기",
    'う': "## [う] 급소\n① 상단 짧은 점 사선 존재 (수평 금지)\n② 전체 세로로 길쭉한 형태\n③ U자 하단 굴곡 충분히 표현",
    'え': "## [え] 급소\n① 1획 우하향 짧은 사선 (수평 금지)\n② 2획 끝 왼쪽 아래 후 오른쪽으로 물결 마무리\n③ 가로선 충분히 넓고 삼각형 구도",
    'お': "## [お] 급소\n① 타원 루프 반시계 방향으로 닫힐 것\n② 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립\n③ 1획(가로선)이 2획보다 위에서 수평으로",
  };
  return T[target] || `## [${target}] 전체 자형의 비례와 획 방향을 표준과 비교하세요.`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ◆ あ 전용 v4.3 아키텍처
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── あ 좌표 분석 (v4.4: D6~D7 + D8원형도 + D9떨림 + D10직교도) ──
function analyzeAh(strokeMeta) {
  const s = strokeMeta?.strokes;
  const result = { d1_loop:'unknown', d2_cross:'unknown', d3_closure:'unknown', d4_dir:'unknown', d5_protrude:'unknown', d6_aspect:'unknown', d7_types:'unknown', d8_circularity:0, d9_jitter:0, d10_crossAngle:90, charWidth:0, loopRatio:0, strokeCount: s?.length ?? 0 };
  if (!Array.isArray(s) || s.length < 1) return result;

  if (s.length !== 3) {
    const allMinX = Math.min(...s.map(st=>st.minX)), allMaxX = Math.max(...s.map(st=>st.maxX));
    const allMinY = Math.min(...s.map(st=>st.minY)), allMaxY = Math.max(...s.map(st=>st.maxY));
    const ar = (allMaxX-allMinX) / ((allMaxY-allMinY)||0.01);
    result.d6_aspect = (ar >= 0.55 && ar <= 1.50) ? '정상' : (ar < 0.55 ? '세로과장' : '가로과장');
    result.d7_types = '획수불일치';
    return result;
  }

  const [s1, s2, s3] = s;
  const allMinX = Math.min(s1.minX, s2.minX, s3.minX);
  const allMaxX = Math.max(s1.maxX, s2.maxX, s3.maxX);
  const allMinY = Math.min(s1.minY, s2.minY, s3.minY);
  const allMaxY = Math.max(s1.maxY, s2.maxY, s3.maxY);
  result.charWidth = allMaxX - allMinX || 0.01;
  const charHeight = allMaxY - allMinY || 0.01;

  // D1: 루프 크기 (6단계)
  result.loopRatio = s3.width / result.charWidth;
  if      (result.loopRatio > 1.10) result.d1_loop = '과대';
  else if (result.loopRatio > 0.85) result.d1_loop = '약간과대';
  else if (result.loopRatio >= 0.50) result.d1_loop = '적정';
  else if (result.loopRatio >= 0.35) result.d1_loop = '약간과소';
  else if (result.loopRatio >= 0.20) result.d1_loop = '과소';
  else                               result.d1_loop = '매우과소';
  console.log(`あ D1 루프비율: ${result.loopRatio.toFixed(3)} → ${result.d1_loop}`);

  // D2: 교차점 (3단계)
  const yOvlp = s2.minY <= s1.maxY && s2.maxY >= s1.minY;
  const xOvlp = s2.minX <= s1.maxX && s2.maxX >= s1.minX;
  if (!yOvlp || !xOvlp) { result.d2_cross = '없음'; }
  else {
    const cx = ((s2.minX+s2.maxX)/2 - s1.minX) / ((s1.maxX-s1.minX)||0.01);
    if (cx < 0.10 || cx > 0.90) result.d2_cross = '크게이탈';
    else if (cx < 0.25 || cx > 0.75) result.d2_cross = '약간이탈';
    else result.d2_cross = '정상';
  }
  console.log(`あ D2 교차점: ${result.d2_cross}`);

  // D3: 루프 닫힘 (4단계)
  const loopDist = Math.sqrt((s3.endX-s3.startX)**2 + (s3.endY-s3.startY)**2);
  const cRatio = s3.pathLength > 0.01 ? loopDist / s3.pathLength : 1;
  if      (cRatio < 0.12) result.d3_closure = '닫힘';
  else if (cRatio < 0.22) result.d3_closure = '약간열림';
  else if (cRatio < 0.40) result.d3_closure = '많이열림';
  else                     result.d3_closure = '열림';
  console.log(`あ D3 루프닫힘: ${cRatio.toFixed(3)} → ${result.d3_closure}`);

  // D4: 루프 방향
  const dir = s3.direction || calcLoopDirection(s3.points);
  result.d4_dir = dir || 'unknown';
  console.log(`あ D4 루프방향: ${result.d4_dir}`);

  // D5: 루프 돌출 (4단계)
  const prot = s2.minX - s3.minX;
  const cw = result.charWidth;
  if      (prot >= cw * 0.20) result.d5_protrude = '충분';
  else if (prot >= cw * 0.10) result.d5_protrude = '약간';
  else if (prot >= cw * 0.03) result.d5_protrude = '미약';
  else                         result.d5_protrude = '없음';
  console.log(`あ D5 돌출: ${prot.toFixed(3)}/${cw.toFixed(3)} → ${result.d5_protrude}`);

  // D6: 종횡비
  const ar = result.charWidth / charHeight;
  if      (ar >= 0.55 && ar <= 1.45) result.d6_aspect = '정상';
  else if (ar >= 0.40 && ar <= 1.70) result.d6_aspect = '약간왜곡';
  else                                result.d6_aspect = '심한왜곡';
  console.log(`あ D6 종횡비: ${ar.toFixed(3)} → ${result.d6_aspect}`);

  // D7: 획 분류 정합성
  function classifyStroke(st) {
    if (st.displacement > 0.01 && st.pathLength / st.displacement > 2.5) return 'loop';
    if (st.width > st.height * 1.5) return 'horizontal';
    if (st.height > st.width * 1.2) return 'vertical';
    return 'ambiguous';
  }
  const types = s.map(classifyStroke);
  if (types[0]==='horizontal' && types[1]==='vertical' && types[2]==='loop') result.d7_types = '정상';
  else if (types[2] === 'loop') result.d7_types = '부분일치';
  else result.d7_types = '불일치';
  console.log(`あ D7 획분류: [${types.join(',')}] → ${result.d7_types}`);

  // ── D8: 루프 원형도 (v4.4 신규) ──
  result.d8_circularity = calcCircularity(s3.points);
  console.log(`あ D8 원형도: ${result.d8_circularity.toFixed(3)}`);

  // ── D9: 전체 획 떨림 (v4.4 신규) ──
  result.d9_jitter = calcAvgJitter(s);
  console.log(`あ D9 떨림: ${result.d9_jitter.toFixed(3)}`);

  // ── D10: 교차 직교도 (v4.4 신규) ──
  result.d10_crossAngle = calcCrossAngle(
    { startX: s1.startX, startY: s1.startY, endX: s1.endX, endY: s1.endY },
    { startX: s2.startX, startY: s2.startY, endX: s2.endX, endY: s2.endY }
  );
  console.log(`あ D10 교차각도: ${result.d10_crossAngle.toFixed(1)}° (90°이상적)`);

  return result;
}

// ── あ 골격 점수 (v4.3: 게이트 + 세분화 감점) ──
function calcAhSkeleton(defects, geminiYN) {
  const log = [];

  // ★ 게이트 1: Gemini 인식불가 → 상한 10
  if (geminiYN?.인식가능 === false) {
    console.log('あ 골격: Gemini 인식불가 → 10pt');
    return { score: 10, log: ['Gemini 인식불가 → 10pt'] };
  }
  // ★ 게이트 2: 획분류 불일치(루프 없음) → 상한 18
  if (defects.d7_types === '불일치') {
    console.log('あ 골격: 획분류 불일치 → 18pt');
    return { score: 18, log: ['획분류 불일치 → 18pt'] };
  }
  // ★ 게이트 3: 교차점 없음 → 상한 20
  if (defects.d2_cross === '없음') {
    let sc = 20;
    if (defects.d3_closure === '열림' || defects.d3_closure === '많이열림') sc -= 5;
    if (defects.d5_protrude === '없음') sc -= 3;
    sc = Math.max(5, sc);
    console.log(`あ 골격: 교차없음 → ${sc}pt`);
    return { score: sc, log: [`교차없음 → ${sc}pt`] };
  }

  let score = 43;

  // D1
  switch (defects.d1_loop) {
    case '과대':     score -= 8;  log.push('루프과대 -8'); break;
    case '약간과대': score -= 3;  log.push('루프약간과대 -3'); break;
    case '약간과소': score -= 4;  log.push('루프약간과소 -4'); break;
    case '과소':     score -= 8;  log.push('루프과소 -8'); break;
    case '매우과소': score -= 13; log.push('루프매우과소 -13'); break;
  }
  // D2
  if (defects.d2_cross === '크게이탈') { score -= 7; log.push('교차크게이탈 -7'); }
  if (defects.d2_cross === '약간이탈') { score -= 3; log.push('교차약간이탈 -3'); }
  // D3
  switch (defects.d3_closure) {
    case '약간열림': score -= 3;  log.push('약간열림 -3'); break;
    case '많이열림': score -= 7;  log.push('많이열림 -7'); break;
    case '열림':     score -= 12; log.push('열림 -12'); break;
  }
  // D4
  if (defects.d4_dir === 'ccw') { score -= 5; log.push('루프방향반대 -5'); }
  // D5 (Gemini 우선)
  if (geminiYN?.루프돌출 === false) { score -= 9; log.push('미돌출(Gemini) -9'); }
  else if (defects.d5_protrude === '없음' || defects.d5_protrude === '미약') { score -= 4; log.push('돌출미약(좌표) -4'); }
  else if (defects.d5_protrude === '약간') { score -= 2; log.push('돌출부족 -2'); }
  // D6
  if (defects.d6_aspect === '약간왜곡') { score -= 3; log.push('종횡비약간왜곡 -3'); }
  if (defects.d6_aspect === '심한왜곡') { score -= 7; log.push('종횡비심한왜곡 -7'); }
  // D7
  if (defects.d7_types === '부분일치') { score -= 4; log.push('획분류부분일치 -4'); }
  // 삼각여백
  if (geminiYN?.삼각여백 === false) { score -= 4; log.push('삼각여백없음 -4'); }

  // D8: 루프 원형도 (v4.5 — 열린 루프 보정: あ 루프는 끝이 빠지므로 원형도가 낮음)
  // 실데이터: 잘 쓴 あ = 0.195, 열린 루프 특성상 0.15 이상이면 양호
  const circ = defects.d8_circularity;
  if      (circ >= 0.15) { /* 양호 */ }
  else if (circ >= 0.08) { score -= 4;  log.push(`원형도${circ.toFixed(2)} -4`); }
  else if (circ >= 0.03) { score -= 8;  log.push(`원형도${circ.toFixed(2)} -8`); }
  else                   { score -= 12; log.push(`원형도${circ.toFixed(2)} -12`); }

  // D9: 획 떨림 (v4.5 — 태블릿 필기 특성 반영: 손글씨는 자연 떨림 있음)
  const jit = defects.d9_jitter;
  if      (jit <= 0.40) { /* 안정 */ }
  else if (jit <= 0.60) { score -= 3; log.push(`떨림${jit.toFixed(2)} -3`); }
  else if (jit <= 0.85) { score -= 6; log.push(`떨림${jit.toFixed(2)} -6`); }
  else                  { score -= 9; log.push(`떨림${jit.toFixed(2)} -9`); }

  // D10: 교차 직교도 (v4.4 신규)
  const crossDev = Math.abs(defects.d10_crossAngle - 90);
  if      (crossDev <= 15) { /* 정상 */ }
  else if (crossDev <= 30) { score -= 3; log.push(`교차${crossDev.toFixed(0)}°편차 -3`); }
  else                     { score -= 6; log.push(`교차${crossDev.toFixed(0)}°편차 -6`); }

  score = Math.max(0, Math.min(45, score));
  console.log(`あ 골격: 43 → ${score}pt [${log.join(', ')}]`);
  return { score, log };
}

// ── あ 마무리 점수 ──
function calcAhFinish(geminiYN) {
  if (geminiYN?.인식가능 === false) return 0;
  let score = 0;
  if (geminiYN?.끝처리 === true) score += 4;
  if (geminiYN?.삼각여백 === true) score += 1;
  return Math.max(0, Math.min(5, score));
}

// ── あ YES/NO 프롬프트 (v4.3: 인식가능 게이트 추가) ──
function buildAhYesNoPrompt(defects) {
  return `히라가나 'あ' 이미지를 보고 아래 네 가지 질문에 YES/NO로만 답하세요.

★ 질문 0 — 인식 가능 여부 [게이트 — 최우선]:
이 이미지가 히라가나 'あ'로 인식됩니까?
다음 중 하나라도 해당하면 false:
- 글자로 보이지 않거나 낙서에 가까움
- 다른 히라가나(お, む 등)나 다른 문자(한글, 로마자, 숫자)로 보임
- 획이 너무 부족하거나 기본 구조(가로선+세로선+루프)가 없음
- あ의 핵심 구조(십자 교차 + 동그란 루프)를 전혀 갖추지 않음
위 어느 것에도 해당하지 않고 あ로 읽을 수 있으면 true.

좌표 분석 참고:
- 획수: ${defects.strokeCount}획 (기대: 3)
- 루프 크기: ${defects.d1_loop} (${defects.loopRatio.toFixed(2)})
- 교차점: ${defects.d2_cross}
- 루프 닫힘: ${defects.d3_closure}
- 루프 방향: ${defects.d4_dir}
- 획 분류: ${defects.d7_types}
- 종횡비: ${defects.d6_aspect}

★ 질문 1 — 루프 돌출:
3획(루프)이 2획(세로선)보다 왼쪽으로 충분히 나와 있나요?
루프의 가장 왼쪽 끝이 세로선보다 확실히 왼쪽에 있어야 true.

★ 질문 2 — 끝처리:
1획 끝의 갈고리(아래·왼쪽 방향 꺾임)와 3획 끝의 흘림(왼쪽 아래로 빠짐)이 모두 표현되어 있나요?

★ 질문 3 — 삼각여백:
1획·2획·3획이 만드는 작은 삼각형 빈 공간이 글자 중앙 부근에 보이나요?

반드시 아래 JSON 형식으로만 (다른 텍스트 절대 금지):
{"인식가능":true또는false,"루프돌출":true또는false,"끝처리":true또는false,"삼각여백":true또는false}`;
}

// ── あ 피드백 프롬프트 (v4.3: 이미지 포함) ──
function buildAhFeedbackPrompt(defects, geminiYN, scores) {
  const problems = [];
  if (geminiYN?.인식가능 === false) problems.push('이 글자가 あ로 인식되지 않습니다');
  if (defects.d7_types === '불일치') problems.push('세 번째 획이 동그란 루프 형태가 아닙니다');
  if (defects.d1_loop === '과대') problems.push('루프가 너무 크게 퍼짐');
  if (defects.d1_loop === '과소' || defects.d1_loop === '매우과소' || defects.d1_loop === '약간과소') problems.push('루프가 작아서 세로선 왼쪽으로 충분히 돌지 않음');
  if (defects.d2_cross === '없음') problems.push('가로선과 세로선이 교차하지 않음');
  if (defects.d2_cross === '크게이탈') problems.push('교차점이 한쪽으로 크게 치우침');
  if (defects.d3_closure === '열림' || defects.d3_closure === '많이열림') problems.push('루프가 닫히지 않음');
  if (defects.d3_closure === '약간열림') problems.push('루프가 약간 열려 있음');
  if (defects.d4_dir === 'ccw') problems.push('루프 방향이 반대');
  if (geminiYN?.루프돌출 === false) problems.push('동그란 부분이 세로선 왼쪽으로 충분히 나오지 않음');
  if (geminiYN?.끝처리 === false) problems.push('1획 갈고리와 3획 끝 흘림이 없음');
  if (geminiYN?.삼각여백 === false) problems.push('교차점 부근 삼각형 빈 공간이 없음');
  if (defects.d6_aspect === '심한왜곡') problems.push('가로세로 비율이 크게 어긋남');
  if (defects.d8_circularity < 0.35) problems.push('루프(동그란 부분)가 원형이 아니라 찌그러져 있음');
  if (defects.d9_jitter > 0.45) problems.push('획이 떨리거나 울퉁불퉁함 — 좀 더 부드럽고 자신 있게 그어주세요');
  if (Math.abs(defects.d10_crossAngle - 90) > 30) problems.push('가로선과 세로선이 직각에 가깝게 교차해야 합니다');

  const total = scores.형태정확성 + scores.획순 + scores.비율균형 + scores.크기위치;
  const grade = total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'E';
  let tone;
  if (total >= 80) tone = '칭찬 위주. 개선점은 마지막에 한 가지.';
  else if (total >= 70) tone = '잘된 점 한 가지 + 개선 한 가지.';
  else if (total >= 60) tone = '칭찬 시작 금지. 핵심 문제 한 가지 먼저. 격려로 마무리.';
  else if (total >= 30) tone = '칭찬 없이 핵심 문제 한 가지만.';
  else tone = '기본 구조부터 다시 연습해야 함을 명확히 전달.';

  return `일본어 교사로서 히라가나 'あ' 피드백을 한국어로 써주세요.
이미지를 보고 실제 글씨를 확인 후 작성.
채점: ${total}점(${grade}) / 골격${scores.골격}/45 마무리${scores.마무리}/5
문제: ${problems.length===0 ? '없음' : problems.join(' / ')}
톤: ${tone}
- 2~3문장. 일본어 용어 금지. "あ" 대신 "'아'" 사용. 문제가 여러 개면 가장 중요한 것 1가지만.
JSON만: {"feedback":"내용"}`;
}

// ── あ 전체 채점 ──
async function scoreAh(b64, strokeMeta, apiKey) {
  const defects = analyzeAh(strokeMeta);

  let geminiYN = { 인식가능: true, 루프돌출: false, 끝처리: false, 삼각여백: false };
  try {
    const r1 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          contents: [{parts: [
            {text: buildAhYesNoPrompt(defects)},
            {inline_data: {mime_type:'image/jpeg', data:b64}}
          ]}],
          generationConfig: {thinkingConfig: {thinkingBudget: 0}}
        })
      }
    );
    const d1 = await r1.json();
    const t1 = d1.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`あ Gemini raw: ${t1.slice(0, 200)}`);
    const parsed = JSON.parse(t1.replace(/```json|```/g,'').trim());
    geminiYN = {
      인식가능: parsed.인식가능 ?? true,
      루프돌출: parsed.루프돌출 ?? false,
      끝처리:   parsed.끝처리   ?? false,
      삼각여백: parsed.삼각여백 ?? false,
    };
    console.log(`あ YN: 인식=${geminiYN.인식가능} 돌출=${geminiYN.루프돌출} 끝=${geminiYN.끝처리} 삼각=${geminiYN.삼각여백}`);
  } catch(e) {
    console.log(`あ YES/NO 파싱 실패: ${e.message}`);
  }

  const skelResult = calcAhSkeleton(defects, geminiYN);
  const 골격 = skelResult.score;
  const 마무리 = calcAhFinish(geminiYN);
  const 형태정확성 = 골격 + 마무리;
  const cs = calculateStrokeScore('あ', strokeMeta);
  const 획순 = cs !== null ? cs : 18;

  let 비율균형 = 10;
  if (Array.isArray(strokeMeta?.strokes) && strokeMeta.strokes.length === 3) {
    const ratio = (strokeMeta.strokes[0].pathLength||0.01) / (strokeMeta.strokes[1].pathLength||0.01);
    if (ratio >= 0.8 && ratio <= 1.8) 비율균형 = 15;
    else if (ratio >= 0.5 && ratio <= 2.5) 비율균형 = 10;
    else 비율균형 = 5;
  }

  const 크기위치 = calculateGridScore(strokeMeta);
  const scores = { 골격, 마무리, 형태정확성, 획순, 비율균형, 크기위치 };

  let feedback = '';
  try {
    const r2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          contents: [{parts: [
            {text: buildAhFeedbackPrompt(defects, geminiYN, scores)},
            {inline_data: {mime_type:'image/jpeg', data:b64}}
          ]}],
          generationConfig: {thinkingConfig: {thinkingBudget: 0}}
        })
      }
    );
    const d2 = await r2.json();
    const t2 = d2.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const pf = JSON.parse(t2.replace(/```json|```/g,'').trim());
    feedback = pf.feedback || '';
  } catch(e) {
    const total = 형태정확성+획순+비율균형+크기위치;
    if (total < 30) feedback = '기본 구조부터 다시 연습해보세요.';
    else if (total < 60) feedback = '글자의 기본 형태를 좀 더 신경 써보세요.';
    else feedback = '잘 쓰셨어요! 계속 연습하면 더 좋아질 거예요.';
  }

  return { ...scores, feedback, defects, geminiYN, skelLog: skelResult.log };
}

// ── 퓨샷 ──
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return '';
  const fmt = (d) => `골격${d.골격}/마무리${d.마무리}`;
  return `\n## ${target} 채점 앵커\n[A] ${data.s90.description} → ${fmt(data.s90)}\n[B] ${data.s80.description} → ${fmt(data.s80)}\n[C] ${data.s70.description} → ${fmt(data.s70)}\n[D↓] ${data.s60.description} → ${fmt(data.s60)}\n`;
}

// ── Gemini 프롬프트 (い~お 등 나머지) ──
function buildPrompt(target) {
  return `당신은 20년 경력의 일본어 교사입니다. 히라가나 '${target}'를 이미지로 보고 자형(골격+마무리)만 채점하세요.
${buildFewShotPrompt(target)}
★ Klee One 교과서체 목표, UD 교과서체 허용. 가산제(0점 시작).
★ 루프 방향 이미지 판단 금지.

■ 골격(최대45점): 구조게이트→기하학검증→미학가산
 복합(あ·え·お) 기본31/FAIL→상한23 | 단순(い·う) 기본29/FAIL→상한20 | 인식불가→0~18
■ 마무리(최대5점): Klee One 끝처리 기준 (5/3/1/0)

${getCharacterCriticalPoints(target)}
## 오류 패턴
${getFilteredNEG(target)}

★ 골격≤45, 마무리≤5. 일본어용어 금지.
JSON만: {"골격":숫자,"마무리":숫자,"feedback":"2~3문장"}`;
}

// ── 오버레이 ──
function generateOverlayHints(target, strokeMeta, geo) {
  const hints = [];
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s) || !s.length) return hints;
  if (target === 'あ' && s.length === 3) {
    const an = extractAnchors('あ', strokeMeta);
    if (an) {
      const { P5, P6, P7 } = an;
      const crossX = s[1].startX, crossY = (s[0].startY + s[0].endY) / 2;
      const d = Math.sqrt((P5[0]-crossX)**2 + (P5[1]-crossY)**2);
      if (d > 0.20) {
        hints.push({type:'problem', x:P5[0], y:P5[1], label:'원 시작점이 너무 멀어요'});
        hints.push({type:'target', x:crossX+0.03, y:crossY+0.06, label:'여기서 시작'});
        hints.push({type:'arrow', fromX:P5[0], fromY:P5[1], toX:crossX+0.03, toY:crossY+0.06});
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
  if (target === 'い' && s.length === 2 && s[0].height > s[0].width * 2.5)
    hints.push({type:'arrow', fromX:s[0].startX, fromY:s[0].startY, toX:s[0].startX+0.15, toY:s[0].startY+0.3, label:'오른쪽 아래로 사선'});
  return hints;
}

// ── 핸들러 ──
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST만 허용'});

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({error:'API 키 없음'});

  const {target, imageData, strokeMeta} = req.body || {};
  if (!target || !imageData) return res.status(400).json({error:'필수 파라미터 누락'});
  const trimmed = target.trim();
  const b64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  if (b64.length < 100) return res.status(400).json({error:'이미지 데이터 부족'});

  try {
    // ── あ: v4.3 ──
    if (trimmed === 'あ') {
      const result = await scoreAh(b64, strokeMeta, apiKey);
      const p = {
        골격: result.골격, 마무리: result.마무리, 형태정확성: result.형태정확성,
        획순: result.획순, 비율균형: result.비율균형, 크기위치: result.크기위치,
        feedback: result.feedback, overlayHints: [],
      };
      p.score = p.형태정확성 + p.획순 + p.비율균형 + p.크기위치;
      p.grade = p.score >= 90 ? 'A' : p.score >= 80 ? 'B' : p.score >= 70 ? 'C' : p.score >= 60 ? 'D' : 'E';
      const geo = analyzeStrokeGeometry(trimmed, strokeMeta);
      p.overlayHints = generateOverlayHints(trimmed, strokeMeta, geo);
      console.log(`[あ v4.5] ${p.score}점 골격${p.골격} 마무리${p.마무리} 획순${p.획순} 비율${p.비율균형} 크기${p.크기위치}`);
      // ★ 디버그: F12 → Network 탭에서 D8~D10 수치 확인용
      p._debug = { defects: result.defects, geminiYN: result.geminiYN, skelLog: result.skelLog };
      console.log(`[あ v4.5] defects: ${JSON.stringify(result.defects)}`);
      console.log(`[あ v4.5] YN: ${JSON.stringify(result.geminiYN)}`);
      console.log(`[あ v4.5] skelLog: ${result.skelLog?.join(', ')}`);
      await saveLog({ character:trimmed, score_total:p.score, score_skeleton:p.골격, score_finish:p.마무리, score_shape:p.형태정확성, score_stroke:p.획순, score_ratio:p.비율균형, score_grid:p.크기위치, grade:p.grade, feedback:p.feedback, arch:'v4.5_ah' });
      return res.status(200).json(p);
    }

    // ── 나머지 ──
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          contents: [{parts: [{text: buildPrompt(trimmed)}, {inline_data: {mime_type:'image/jpeg', data:b64}}]}],
          generationConfig: {thinkingConfig: {thinkingBudget: 512}}
        })
      }
    );
    const data = await resp.json();
    if (data.error) return res.status(500).json({error:'Gemini 오류', detail:data.error});
    if (!data.candidates?.[0]) return res.status(500).json({error:'candidates 없음'});
    const text = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({error:'text 없음'});

    try {
      const p = JSON.parse(text.replace(/```json|```/g, '').trim());
      p.골격 = Math.min(45, Math.max(0, p.골격 || 0));
      p.마무리 = Math.min(5, Math.max(0, p.마무리 || 0));
      p.형태정확성 = p.골격 + p.마무리;
      const geo = analyzeStrokeGeometry(trimmed, strokeMeta);
      const cs = calculateStrokeScore(trimmed, strokeMeta);
      p.획순 = cs !== null ? cs : 18;
      p.비율균형 = calculateProportionScore(trimmed, strokeMeta);
      p.크기위치 = calculateGridScore(strokeMeta);
      p.score = p.형태정확성 + p.획순 + p.비율균형 + p.크기위치;
      p.grade = p.score >= 90 ? 'A' : p.score >= 80 ? 'B' : p.score >= 70 ? 'C' : p.score >= 60 ? 'D' : 'E';
      p.overlayHints = generateOverlayHints(trimmed, strokeMeta, geo);
      console.log(`[${trimmed}] ${p.score}점 골격${p.골격} 마무리${p.마무리} 획순${p.획순} 비율${p.비율균형} 크기${p.크기위치}`);
      await saveLog({ character:trimmed, score_total:p.score, score_skeleton:p.골격, score_finish:p.마무리, score_shape:p.형태정확성, score_stroke:p.획순, score_ratio:p.비율균형, score_grid:p.크기위치, grade:p.grade, feedback:p.feedback });
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
