// score.js — v4
// 변경사항:
//   ✅ 루브릭 구조 예전과 동일 유지 (형태40 + 필순20 + 획방향20 + 끝맺음10 + 균형비율10)
//   ✅ NEG_PATTERNS 직렬화 버그 수정 (${NEG_PATTERNS} → negList.map(...))
//   ✅ fewshot 앵커 제거 (환각 원인)
//   ✅ 글자별 핵심 체크포인트 3가지로 교체
//   ✅ 피드백 톤: 잘된 점 1문장 + 개선점 1문장 고정
// ============================================================

const { NEG_PATTERNS } = require('../fewshot_db');

// 글자별 핵심 체크포인트 (Gemini가 집중할 3가지)
const CHECKPOINTS = {
  'あ': [
    '1획이 짧고 위로 기울어져 있는가',
    '1획과 2획의 교차점이 명확한가',
    '3획의 원(루프)이 세로 중심선 왼쪽으로 돌출되어 있는가',
  ],
  'い': [
    '두 획의 시작점 높이가 같은가',
    '1획이 2획보다 확실히 긴가',
    '두 획 모두 우하향 사선 방향인가',
  ],
  'う': [
    '1획(점)이 아주 짧게 위에 위치하는가',
    '전체 형태가 세로로 길쭉한가',
    '2획 끝이 오른쪽으로 둥글게 감겨 있는가',
  ],
  'え': [
    '전체 형태가 역삼각형(▽) 구도인가',
    '1획이 우하향으로 꺾여 내려오는가',
    '2획이 1획 하단에서 출발해 오른쪽으로 뻗는가',
  ],
  'お': [
    '1획과 3획의 높이가 같은가',
    '2획의 루프가 너무 크지 않고 가로축 아래에 위치하는가',
    '3획이 오른쪽 위 칸 중앙에 독립적으로 위치하는가',
  ],
  'か': ['세로획이 직선인가', '가로획이 세로획 중간에서 교차하는가', '3획 삐침 방향이 자연스러운가'],
  'き': ['가로획 2개가 평행한가', '세로획 위치가 정확한가', 'さ와 혼동되지 않는가'],
  'く': ['꺾이는 각도가 적절한가', '위아래 길이 균형이 맞는가', '직선이 아닌 꺾인 형태인가'],
  'け': ['세로획이 직선인가', '가로획 2개 위치가 정확한가', '오른쪽 획 방향이 자연스러운가'],
  'こ': ['가로획 2개가 평행한가', '간격이 균등한가', '오른쪽 끝 연결이 자연스러운가'],
  'さ': ['가로획 위치가 정확한가', '아래 곡선 방향이 자연스러운가', 'き와 혼동되지 않는가'],
  'し': ['세로로 길쭉한 형태인가', '하단 꺾임이 있는가', '끝이 오른쪽 위로 향하는가'],
  'す': ['가로획 위치가 정확한가', '세로 곡선이 자연스러운가', '작은 루프가 반시계 방향인가'],
  'せ': ['세로획이 직선인가', '가로획 위치가 정확한가', '오른쪽 끝 방향이 자연스러운가'],
  'そ': ['위 꺾임이 있는가', '아래 곡선 방향이 정확한가', '전체 균형이 맞는가'],
  'た': ['교차점 위치가 정확한가', '교차 후 오른쪽 획 방향이 자연스러운가', '전체 균형이 맞는가'],
  'ち': ['위 짧은 가로획이 있는가', '아래 곡선 방향이 정확한가', '숫자 5와 혼동되지 않는가'],
  'つ': ['가로로 퍼진 형태인가 (세로형 아님)', '시작점이 오른쪽 위인가', 'う와 혼동되지 않는가'],
  'て': ['가로획 오른쪽 끝에서 꺾임이 있는가', '꺾임 각도가 적절한가', '아래로 내려가는 흐름이 자연스러운가'],
  'と': ['세로획이 직선인가', '오른쪽으로 튀어나오는 작은 획이 있는가', '돌출 획 방향이 정확한가'],
  'な': ['루프 위치가 정확한가', '교차점이 올바른가', '4획 구조가 명확한가'],
  'に': ['세로획 2개 위치가 정확한가', '가로획 위치가 맞는가', '전체 균형이 맞는가'],
  'ぬ': ['루프 방향이 정확한가', 'め와 혼동되지 않는가', '획 연결이 자연스러운가'],
  'ね': ['루프가 명확히 닫혀 있는가', 'れ·わ와 혼동되지 않는가', '획 연결이 자연스러운가'],
  'は': ['3획 구조가 명확한가', '세로획이 직선인가', 'ほ·ま와 혼동되지 않는가'],
  'ひ': ['루프 모양이 자연스러운가', '세로 방향 흐름이 정확한가', '루프가 닫혀 있는가'],
  'ふ': ['상단 가로획 위치가 정확한가', '하단 3개 획 위치가 정확한가', '4획 구조가 명확한가'],
  'へ': ['꼭짓점 위치가 정확한가', '좌우 획 길이 비율이 맞는가', '거의 직선이 되지 않는가'],
  'ほ': ['4획 구조가 명확한가', 'は와 구조 차이가 표현되는가', '루프가 자연스러운가'],
  'ま': ['가로획 2개 위치가 정확한가', '세로 곡선이 자연스러운가', 'ほ·は와 혼동되지 않는가'],
  'み': ['위 짧은 획 방향이 맞는가', '아래 곡선 방향이 정확한가', '끝처리가 자연스러운가'],
  'む': ['가로획 위치가 정확한가', '루프 방향이 맞는가', 'す와 혼동되지 않는가'],
  'め': ['루프 방향이 정확한가', 'ぬ와 혼동되지 않는가', '획 연결이 자연스러운가'],
  'も': ['가로획 2개 위치가 정확한가', '아래 곡선 방향이 자연스러운가', '전체 균형이 맞는가'],
  'や': ['3획 구조가 명확한가', '각 획 방향이 정확한가', '전체 비율 균형이 맞는가'],
  'ゆ': ['세로획이 직선인가', '반루프 방향이 정확한가', '전체 비율 균형이 맞는가'],
  'よ': ['가로획 위치가 정확한가', '세로획 범위가 이탈하지 않는가', '전체 균형이 맞는가'],
  'ら': ['위 짧은 획 방향이 맞는가', '아래 곡선이 자연스러운가', '숫자 5·ち와 혼동되지 않는가'],
  'り': ['오른쪽 획(2획)이 왼쪽보다 긴가', '두 획 모두 우하향인가', 'い와 혼동되지 않는가'],
  'る': ['루프가 닫혀 있는가', 'ろ와 혼동되지 않는가', '전체 흐름이 자연스러운가'],
  'れ': ['루프 닫힘 여부가 정확한가', 'ね·わ와 혼동되지 않는가', '전체 흐름이 자연스러운가'],
  'ろ': ['루프가 열려 있는가 (닫히면 안 됨)', 'る와 혼동되지 않는가', '숫자 3과 혼동되지 않는가'],
  'わ': ['루프가 명확히 닫혀 있는가', 'ね·れ와 혼동되지 않는가', '끝 방향이 자연스러운가'],
  'を': ['가로획 2개 위치가 정확한가', '아래 루프 방향이 맞는가', '3획 구조가 명확한가'],
  'ん': ['시작 방향이 맞는가', '하단 반루프 방향이 정확한가', '끝이 오른쪽 위로 향하는가'],
  'の': ['루프가 반시계 방향인가', '시작점이 오른쪽 위인가', '끝이 루프 밖으로 빠지는가'],
};

// ============================================================
// 프롬프트 빌더
// ============================================================
function buildPrompt(target) {
  const checkpoints = CHECKPOINTS[target] || [
    '글자의 전체 형태가 목표 글자와 닮았는가',
    '획의 방향과 비율이 자연스러운가',
    '획의 끝처리가 자연스러운가',
  ];

  // ✅ NEG 버그 수정: 객체를 문자열로 직렬화
  const negList = NEG_PATTERNS[target];
  const negSection = negList && negList.length > 0
    ? `\n## 반드시 확인할 오류 패턴 (해당 시 즉시 감점)\n${negList.map(p => `- [${p.id}] ${p.desc}`).join('\n')}`
    : '';

  return `당신은 한국 중고등학생의 히라가나 손글씨를 채점하는 일본어 전문 교사입니다.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 5가지 항목을 채점하세요.

## 핵심 체크포인트 (이 3가지를 중심으로 형태정확성 채점)
${checkpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${negSection}

## 채점 항목 (총 100점, 각 항목 최대값 절대 초과 금지)
- 형태정확성 (0~40점): 글자 전체 형태가 '${target}'와 얼마나 닮았는가. 체크포인트 3가지 충족도 기준.
- 필순 (0~20점): 획의 순서와 개수가 맞는가.
- 획방향 (0~20점): 각 획의 방향과 흐름이 올바른가.
- 끝맺음 (0~10점): 획의 시작과 끝 처리가 자연스러운가.
- 균형비율 (0~10점): 글자의 크기, 위치, 균형이 잘 맞는가.

## 채점 원칙
- 글자가 '${target}'로 식별 가능하면 형태정확성 최소 23점 이상
- 글자가 식별 가능하면 총점 55점 미만 부여 금지
- 일본어 필법 전문 용어 절대 사용 금지 (하네·하라이·토메 등)

## 피드백 규칙 (반드시 준수)
- 총점 80 이상: 잘된 점 1문장 + 개선점 1문장
- 총점 60~79: 잘된 점 1문장 + 개선점 1문장
- 총점 60 미만: 개선점 1문장만 (칭찬 없이)
- 동작으로 직접 묘사 (예: "획 끝을 살짝 위로 올려주세요")

반드시 아래 JSON 형식으로만 응답하세요:
{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 피드백"
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

  // Gemini 공통 호출 함수 (503 시 1회 재시도)
  const geminiCall = async (prompt, retry = true) => {
    const res = await fetch(
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
          }]
        })
      }
    );
    const data = await res.json();
    // 503 과부하 시 2초 후 1회 재시도
    if (data.error?.code === 503 && retry) {
      await new Promise(r => setTimeout(r, 2000));
      return geminiCall(prompt, false);
    }
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  try {
    // ── 1단계: 글자 식별 확인 ─────────────────────────────
    const checkpoints = CHECKPOINTS[target] || [];
    const step1Prompt = `이미지에 쓰인 히라가나가 '${target}'인지 판별하세요.

'${target}'의 핵심 구조 체크포인트:
${checkpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

위 체크포인트 중 2개 이상 충족하면 YES, 아니면 NO.
반드시 YES 또는 NO 한 단어로만 답하세요.`;

    const step1Result = (await geminiCall(step1Prompt)).trim().toUpperCase();
    const isTarget = step1Result.includes('YES');

    if (!isTarget) {
      return res.status(200).json({
        형태정확성: 10,
        필순: 5,
        획방향: 5,
        끝맺음: 2,
        균형비율: 2,
        score: 24,
        feedback: `'${target}'의 기본 구조가 표현되지 않았어요. 획의 개수와 방향을 다시 확인하고 써보세요.`,
      });
    }

    // ── 2단계: 상세 채점 ──────────────────────────────────
    const prompt = buildPrompt(target);
    const resultText = await geminiCall(prompt);
    const cleaned = resultText.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);

      // 항목별 상한 클램핑
      parsed.형태정확성 = Math.min(40, Math.max(0, parsed.형태정확성 || 0));
      parsed.필순       = Math.min(20, Math.max(0, parsed.필순       || 0));
      parsed.획방향     = Math.min(20, Math.max(0, parsed.획방향     || 0));
      parsed.끝맺음     = Math.min(10, Math.max(0, parsed.끝맺음     || 0));
      parsed.균형비율   = Math.min(10, Math.max(0, parsed.균형비율   || 0));
      parsed.score = parsed.형태정확성 + parsed.필순 + parsed.획방향 + parsed.끝맺음 + parsed.균형비율;

      // 55점 하한선
      if (parsed.score > 0 && parsed.score < 55) {
        const ratio = 55 / parsed.score;
        parsed.형태정확성 = Math.min(40, Math.round(parsed.형태정확성 * ratio));
        parsed.필순       = Math.min(20, Math.round(parsed.필순       * ratio));
        parsed.획방향     = Math.min(20, Math.round(parsed.획방향     * ratio));
        parsed.끝맺음     = Math.min(10, Math.round(parsed.끝맺음     * ratio));
        parsed.균형비율   = Math.min(10, Math.round(parsed.균형비율   * ratio));
        parsed.score = parsed.형태정확성 + parsed.필순 + parsed.획방향 + parsed.끝맺음 + parsed.균형비율;
      }

      return res.status(200).json(parsed);

    } catch (e) {
      console.log("JSON 파싱 실패. raw:", cleaned.slice(0, 300));
      return res.status(500).json({ error: "JSON 파싱 실패", raw: cleaned });
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
