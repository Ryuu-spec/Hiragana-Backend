// score.js  v3.0 — 4루브릭 / 루프방향 스트로크계산 / 루프관대화 / 배열계산
const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

// ① 필순 (25점 만점)
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
  'い': { expected:2, orderCheck:(s)=> s[0].startX < s[1].startX },
  'う': { expected:2, orderCheck:(s)=> s[0].startY < s[1].startY },
  'え': { expected:2, orderCheck:(s)=> s[0].startY < s[1].startY },
  'お': { expected:3, orderCheck:(s)=> s[0].startY < s[1].startY && s[2].startX > 0.4 },
};

function calculateStrokeScore(target, strokeMeta) {
  const rule = STROKE_RULES[target];
  if (!rule || !Array.isArray(strokeMeta?.strokes) || !strokeMeta.strokes.length) return null;
  const diff = Math.abs((strokeMeta.count||0) - rule.expected);
  if (diff >= 2) return 5;
  if (diff === 1) return 10;
  try {
    const r = rule.orderCheck(strokeMeta.strokes);
    if (r === null) return null;
    return r ? 25 : 15;
  } catch(e) { return 17; }
}

// ② 쇼엘레이스 공식 — 루프 방향 계산
// 스크린 좌표(y↓): 음수=CCW(반시계)=あ·お의 올바른 방향
function calcLoopDirection(points) {
  if (!points || points.length < 3) return null;
  let area = 0;
  for (let i=0; i<points.length; i++) {
    const j = (i+1) % points.length;
    area += points[i][0]*points[j][1] - points[j][0]*points[i][1];
  }
  if (Math.abs(area) < 0.005) return null;
  return area < 0 ? 'ccw' : 'cw';
}

// ③ 배열 채점 (田字格 기준, 20점)
function calculateArrangement(strokeMeta) {
  const arr = strokeMeta?.arrangement;
  if (!arr) { console.log('배열 데이터 없음 → 기본값 12'); return 12; }
  let score = 0;
  // 크기 (8pt): 격자의 60~85%
  const size = Math.max(arr.charWidth||0, arr.charHeight||0);
  if      (size >= 0.60 && size <= 0.85) score += 8;
  else if (size >= 0.45 && size <  0.60) score += 5;
  else if (size >  0.85 && size <= 0.93) score += 5;
  else if (size >= 0.30)                 score += 3;
  else                                   score += 1;
  // 중앙 정렬 (7pt)
  const dX = Math.abs((arr.charCenterX||0.5)-0.5);
  const dY = Math.abs((arr.charCenterY||0.5)-0.5);
  const d  = Math.sqrt(dX*dX + dY*dY);
  if      (d < 0.08) score += 7;
  else if (d < 0.15) score += 5;
  else if (d < 0.22) score += 3;
  else               score += 1;
  // 기울기 추정 (5pt)
  const ratio = (arr.charHeight||0)>0.01 ? (arr.charWidth||0)/(arr.charHeight||1) : 1;
  if      (ratio >= 0.55 && ratio <= 1.60) score += 5;
  else if (ratio >= 0.40 || ratio <= 2.00) score += 3;
  else                                     score += 1;
  const total = Math.min(20, Math.max(0, score));
  console.log(`배열: 크기${size.toFixed(2)} 중심편차${d.toFixed(2)} 비율${ratio.toFixed(2)} → ${total}pt`);
  return total;
}

// ④ 앵커 포인트
function extractAnchors(target, strokeMeta) {
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s)) return null;
  if (target==='あ' && s.length===3) {
    const [s1,s2,s3] = s;
    const minXPt = (st) => st.points?.length
      ? st.points.reduce((m,p)=>p[0]<m[0]?p:m)
      : [st.minX??st.startX, st.minY??st.startY];
    return {
      P5:[s3.startX,s3.startY], P6:minXPt(s3), P7:[s3.endX,s3.endY],
      s1minX: s1.minX??s1.startX, s2minX: s2.minX??s2.startX
    };
  }
  return null;
}

function ptDist(a,b){ return Math.sqrt((b[0]-a[0])**2+(b[1]-a[1])**2); }

// ⑤ 기하학 분석 (루프 3단계 + 방향 스트로크 계산)
function analyzeStrokeGeometry(target, strokeMeta) {
  const result = { loopPenalty:0, aspectPenalty:0, hasLeftProtrusion:null };
  const s = strokeMeta?.strokes;
  if (!Array.isArray(s) || !s.length) return result;

  // あ
  if (target==='あ' && s.length===3) {
    const an = extractAnchors('あ', strokeMeta);
    if (an) {
      const {P5,P6,P7} = an;
      const loop = s[2];
      // 루프 닫힘 3단계
      const ratio = loop.pathLength>0.01 ? ptDist(P5,P7)/loop.pathLength : 1;
      if      (ratio < 0.40) result.loopPenalty = 0;
      else if (ratio < 0.60) result.loopPenalty = 3;
      else if (ratio < 0.80) result.loopPenalty = 5;
      else                   result.loopPenalty = 8;
      console.log(`あ 루프닫힘 ratio:${ratio.toFixed(3)} → -${result.loopPenalty}pt`);

      // 루프 방향 — 스트로크 데이터 직접 계산 ★
      const dir = loop.direction || calcLoopDirection(loop.points);
      if (dir==='cw') {
        result.loopPenalty = Math.min(10, result.loopPenalty + 4);
        console.log(`あ 루프방향 오류 CW → 총패널티 ${result.loopPenalty}pt`);
      } else {
        console.log(`あ 루프방향 OK: ${dir||'불명'}`);
      }
      // 왼쪽 돌출
      result.hasLeftProtrusion = P6[0] < (an.s2minX - 0.05);
    }
  }

  // お 루프
  if (target==='お' && s.length===3) {
    const loop = s[1];
    const dir  = loop.direction || calcLoopDirection(loop.points);
    if (dir==='cw') result.loopPenalty = Math.min(8, result.loopPenalty+4);
    const ratio2 = loop.pathLength>0.01
      ? ptDist([loop.startX,loop.startY],[loop.endX,loop.endY])/loop.pathLength : 1;
    if      (ratio2 >= 0.65) result.loopPenalty = Math.min(8, result.loopPenalty+5);
    else if (ratio2 >= 0.45) result.loopPenalty = Math.min(8, result.loopPenalty+2);
    console.log(`お 루프: dir=${dir} ratio=${ratio2.toFixed(3)} pen=${result.loopPenalty}`);
  }

  // Aspect Ratio
  if (['あ','え','お'].includes(target) && s.length>=2) {
    const avgW = s.reduce((a,st)=>a+(st.width||0),0)/s.length;
    const avgH = s.reduce((a,st)=>a+(st.height||0),0)/s.length;
    const r = avgH>0.01 ? avgW/avgH : 1;
    if (r<0.5 || r>2.0) {
      result.aspectPenalty = 6;
      console.log(`AspectRatio 왜곡 -6pt (${r.toFixed(2)})`);
    }
  }
  return result;
}

// ⑥ 글자별 급소
function getCharacterCriticalPoints(target) {
  const T = {
    'あ': `## [あ] 급소\n① 3획 시작점: 1·2획 교차점 바로 오른쪽 위\n② 교차점 통과 + 삼각형 여백 형성\n③ 3획이 2획 왼쪽으로 충분히 돌출하여 루프 형성\n④ 루프: 반시계 방향으로 둥글게 닫히고 왼쪽 아래로 흘림`,
    'い': `## [い] 급소\n① 두 획 모두 우하향 사선 (수직 금지)\n② 오른쪽 획이 왼쪽 획보다 짧을 것\n③ 2획 끝 왼쪽 아래로 구부려 마무리`,
    'う': `## [う] 급소\n① 상단 짧은 점 사선 존재 (수평 금지)\n② 전체 세로로 길쭉한 형태\n③ U자 하단 굴곡 충분히 표현`,
    'え': `## [え] 급소\n① 1획 우하향 짧은 사선 (수평 금지)\n② 2획 끝 왼쪽 아래 후 오른쪽으로 물결 마무리\n③ 가로선 충분히 넓고 삼각형 구도`,
    'お': `## [お] 급소\n① 타원 루프 반시계 방향으로 닫힐 것\n② 3획(짧은 사선)이 루프 오른쪽 상단 바깥에 독립\n③ 1획(가로선)이 2획보다 위에서 수평으로`,
  };
  return T[target] || `## [${target}] 전체 자형의 비례와 획 방향을 표준과 비교하세요.`;
}

// ⑦ 퓨샷 (4루브릭 매핑)
function buildFewShotPrompt(target) {
  const data = FEWSHOT_DB[target];
  if (!data) return '';
  const map4 = (d) => {
    const sc = d.scores;
    return {
      글자형상: Math.min(45, Math.round((sc.형태정확성||0)/40*28 + (sc.획방향||0)/20*12 + (sc.균형비율||0)/10*5)),
      필순:   Math.round((sc.필순||0)/20*25),
      정성:   sc.끝맺음||0
    };
  };
  return `\n## ${target} 채점 기준 예시\n[A90] ${data.s90.description.slice(0,100)}... → ${JSON.stringify(map4(data.s90))}\n[B80] → ${JSON.stringify(map4(data.s80))}\n[C70] → ${JSON.stringify(map4(data.s70))}\n[D60↓] → ${JSON.stringify(map4(data.s60))}\n위 4단계를 기준 닻으로 삼아 상대 판단하세요.\n`;
}

// ⑧ 프롬프트 빌더
function buildPrompt(target) {
  return `당신은 20년 경력의 일본어 교사입니다. 중학교 1학년 초학습자 관점에서, 전문 용어 없이 쉬운 한국어로 개선 방법을 알려주세요.
히라가나 '${target}'를 이미지로 보고 아래 3개 항목을 채점하세요. (배열은 시스템 별도 계산)

${buildFewShotPrompt(target)}

★ 채점 철학: "교과서체를 최대한 닮았고, 정성껏 썼는가?" 85~90점 = 일본 초등 A+
★ 가산제: 0점에서 시작, 갖춰진 요소마다 점수를 쌓습니다.
★ Safe Zone ±20%: 위치 이탈 이 범위 내이면 만점 처리, 피드백 금지.
★ 루프 방향은 이미지로 판단 금지 — 완성 형태의 구조만 보고 판단하세요.

### ■ 글자형상 (최대 45점)
[1단계 구조 게이트]
 복합(あ·え·お) 기본33 / FAIL(교차없거나 루프전무)→상한24
 단순(い·う)   기본30 / FAIL(획 완전겹침)→상한20
 인식불가 → 0~18점
[2단계 기하학 검증] 감산 최대 -9pt
 Aspect 왜곡(あ·え·お): -6 / 삼각여백없음(あ): -5 / 역방향획: -3~5
[3단계 미학 가산] 오직 +, 최대 +12pt
 유려·자연스러움: +8~12 / 다소딱딱: +4~7 / 뭉툭: +0~3

### ■ 필순 (최대 25점)
Step1 역방향없음:18 / 1개:12 / 2↑:6
Step2 각도±30°이내:+7 / ±30~60°:+3~5 / ±60↑:+0~2
★ 완전역방향 아닌 한 18점↑ 유지

### ■ 정성 (최대 10점)
Step1 형태유지+획존재:7 / 획생략·형태붕괴:3~4
Step2 끝처리 자연스러움:+2~3 / 약간어색:+1 / 없음:+0

${getCharacterCriticalPoints(target)}

## 오류 패턴
${getFilteredNEG(target)}

★ 제한: 글자형상≤45 필순≤25 정성≤10 절대초과금지
★ 피드백: 일본어용어(하네·하라이·토메) 절대금지. 꾹눌러끝내기·살짝위로삐치듯·부드럽게빼면서 표현사용.

아래 JSON으로만 응답 (다른 텍스트 절대금지):
{"글자형상":숫자,"필순":숫자,"정성":숫자,"feedback":"한국어 2~3문장. 잘된점 먼저. [60미만]핵심1가지. [60~79]잘된점+개선1. [80↑]칭찬위주."}`;
}

// ⑨ 오버레이 힌트 생성
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
      const crossY = s1.startY + (s1.endY - s1.startY) * 0.45;
      const d = Math.sqrt(Math.pow(P5[0]-crossX,2)+Math.pow(P5[1]-crossY,2));
      if (d > 0.14) {
        hints.push({type:'problem', x:P5[0], y:P5[1], label:'원 시작점이 너무 멀어요'});
        hints.push({type:'target', x:crossX+0.04, y:crossY-0.04, label:'여기서 시작'});
        hints.push({type:'arrow', fromX:P5[0], fromY:P5[1], toX:crossX+0.04, toY:crossY-0.04});
      }
      if (geo.hasLeftProtrusion === false)
        hints.push({type:'arrow_left', fromX:P6[0], fromY:P6[1], toX:Math.max(0,P6[0]-0.14), toY:P6[1], label:'왼쪽으로 더 뻗어요'});
      if (geo.loopPenalty >= 5)
        hints.push({type:'close_loop', fromX:P7[0], fromY:P7[1], toX:P5[0], toY:P5[1], label:'원을 닫아주세요'});
      if (geo.loopDirWrong) {
        const cx=(P5[0]+P6[0]+P7[0])/3, cy=(P5[1]+P6[1]+P7[1])/3;
        hints.push({type:'direction', x:cx, y:cy, label:'반시계 방향으로 그려요'});
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

// ⑩ 핸들러
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials','true');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers','X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST')    return res.status(405).json({error:'POST만 허용'});

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({error:'API 키 없음'});

  const {target, imageData, strokeMeta} = req.body||{};
  if (!target||!imageData) return res.status(400).json({error:'필수 파라미터 누락'});

  const trimmed   = target.trim();
  const b64       = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  if (b64.length < 100) return res.status(400).json({error:'이미지 데이터 부족'});

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          contents:[{parts:[{text:buildPrompt(trimmed)},{inline_data:{mime_type:'image/jpeg',data:b64}}]}],
          generationConfig:{thinkingConfig:{thinkingBudget:512}}
        })
      }
    );
    const data = await resp.json();
    if (data.error) return res.status(500).json({error:'Gemini 오류',detail:data.error});
    if (!data.candidates?.[0]) return res.status(500).json({error:'candidates 없음'});
    const text = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({error:'text 없음'});

    try {
      const p = JSON.parse(text.replace(/```json|```/g,'').trim());

      // 클램핑
      p.글자형상 = Math.min(45,Math.max(0,p.글자형상||0));
      p.필순     = Math.min(25,Math.max(0,p.필순    ||0));
      p.정성     = Math.min(10,Math.max(0,p.정성    ||0));
      console.log(`[${trimmed}] Gemini: 형상${p.글자형상} 필순${p.필순} 정성${p.정성}`);

      // 필순 덮어쓰기
      const cs = calculateStrokeScore(trimmed, strokeMeta);
      if (cs!==null) { console.log(`필순 ${p.필순}→${cs}`); p.필순=cs; }

      // 기하학 패널티
      const geo = analyzeStrokeGeometry(trimmed, strokeMeta);
      const pen = Math.min(10, geo.loopPenalty + geo.aspectPenalty);
      if (pen>0) { p.글자형상 = Math.max(0,p.글자형상-pen); console.log(`패널티 -${pen}pt → 형상${p.글자형상}`); }
      if (geo.hasLeftProtrusion===false) { p.글자형상=Math.max(2,p.글자형상-2); console.log('왼돌출없음 -2pt'); }

      // 배열 계산
      p.배열 = calculateArrangement(strokeMeta);

      // Floor 보정
      const broken = p.글자형상 < 22 || /완성되지|열려|해독|루프.*(없|열|미완)/.test(p.feedback||'');
      if (!broken) {
        if (p.정성<7 && !/끊기|생략|뚝|없음/.test(p.feedback||''))   { p.정성=7;  console.log('정성 floor→7'); }
        if (p.필순<18 && !/반대|역방향|거꾸로/.test(p.feedback||''))  { p.필순=18; console.log('필순 floor→18'); }
      }

      p.score = (p.글자형상||0)+(p.필순||0)+(p.배열||0)+(p.정성||0);
      console.log(`[${trimmed}] 최종 ${p.score}점 (형상${p.글자형상} 필순${p.필순} 배열${p.배열} 정성${p.정성})`);

      // 오버레이 힌트 생성
      p.overlayHints = generateOverlayHints(trimmed, strokeMeta, geo);
      console.log(`오버레이 힌트 ${p.overlayHints.length}개`);

      return res.status(200).json(p);

    } catch(e) {
      console.log('JSON 파싱 실패:', text.slice(0,300));
      return res.status(500).json({error:'JSON 파싱 실패', raw:text});
    }
  } catch(err) {
    return res.status(500).json({error:'서버 연결 실패', message:err.message});
  }
}

module.exports = handler;
module.exports.config = { api:{ bodyParser:{ sizeLimit:'10mb' } } };
