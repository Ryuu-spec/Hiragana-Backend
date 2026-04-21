// score.js — 최종 안정화 버전
// 예전 1번 호출 구조 유지
// 변경사항:
//   ✅ NEG_PATTERNS 직렬화 버그 수정 (${NEG_PATTERNS} → negList.map(...))
//   ✅ 체크포인트 3가지 프롬프트에 추가
//   ✅ 55점 하한선 유지
// ============================================================

const { NEG_PATTERNS } = require('../fewshot_db');

// 글자별 핵심 체크포인트
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
// 채점 프롬프트 빌더
// ============================================================
function buildPrompt(target) {
  const checkpoints = CHECKPOINTS[target] || [
    '글자의 전체 형태가 목표 글자와 닮았는가',
    '획의 방향과 비율이 자연스러운가',
    '획의 끝처리가 자연스러운가',
  ];

  // NEG 패턴 직렬화 (버그 수정)
  const negList = NEG_PATTERNS[target];
  const negSection = negList && negList.length > 0
    ? `\n## 반드시 확인할 오류 패턴 (해당 시 즉시 감점)\n${negList.map(p => `- [${p.id}] ${p.desc}`).join('\n')}`
    : '';

  // 글자별 절대 규칙 (다른 모든 기준보다 우선 적용)
  const absoluteRulesMap = {
    'あ': `
## あ 절대 규칙 — 다른 모든 기준보다 우선 적용
- 3획의 원이 세로 중심선 오른쪽으로 충분히 나오지 않고 왼쪽에만 머무르면
  → 형태정확성 최대 15점, 총점 최대 55점으로 반드시 제한
  → feedback: "동그란 부분이 세로선 오른쪽으로 충분히 나와야 해요. 지금은 왼쪽에만 머물고 있어요."
- 형태가 아무리 좋아 보여도 위 규칙은 반드시 적용할 것`,
    'い': `
## い 절대 규칙 — 다른 모든 기준보다 우선 적용
- 2획(오른쪽 획)이 1획(왼쪽 획)보다 길거나 같으면 → り와 혼동
  → 형태정확성 최대 15점, 총점 최대 55점으로 반드시 제한
  → feedback: "왼쪽 획이 오른쪽 획보다 확실히 길어야 해요. 지금은 두 획 길이가 비슷하거나 오른쪽이 더 길어서 り처럼 보여요."
- 형태가 아무리 좋아 보여도 위 규칙은 반드시 적용할 것`,
  };
  const absoluteRules = absoluteRulesMap[target] || '';

  return `당신은 20년 경력의 일본어 교사입니다. 중학교 1학년 초학습자를 가르친다는 관점에서 채점하세요.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 5가지 항목을 각각 채점하세요.
${absoluteRules}
## '${target}' 핵심 체크포인트 (형태정확성 채점 기준)
${checkpoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${negSection}

## 채점 가이드라인
- 글자가 '${target}'로 인식 가능하면 → 형태정확성 최소 23점 이상
- 주요 획이 2개 이상 존재하고 글자가 식별 가능하면 → 총점 최소 55점 이상
- 기본 형태가 대체로 맞고 주요 획이 표현되었다면 → 총점 70점 이상
- 형태가 잘 잡혀 있고 흐름이 자연스럽다면 → 총점 85점 이상
- 획순 오류가 있어도 형태가 맞으면 필순 최대 5점만 감점
- 일본어 필법 전문 용어 절대 금지 (하네·하라이·토메 등)

## 원형·루프 획 평가 기준
- 원이나 루프가 시각적으로 둥글고 닫혀 보이면 완성된 것으로 평가
- 'あ'의 3획은 붓글씨 특성상 완전히 닫히지 않아도 자연스러움

## 채점 기준 (각 항목 최대값 절대 초과 금지)
- 형태정확성 (0~40): 획의 전체적인 형태가 '${target}'와 얼마나 닮았는가
- 필순 (0~20): 획의 순서와 개수가 맞는가
- 획방향 (0~20): 각 획의 방향과 흐름이 올바른가
- 끝맺음 (0~10): 획의 시작과 끝 처리가 자연스러운가
- 균형비율 (0~10): 글자의 크기, 위치, 균형이 잘 맞는가

반드시 아래 JSON 형식으로만 응답하세요:
{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2문장. 잘된 점 1문장 + 개선점 1문장. 총점 60 미만이면 개선점만. 동작을 직접 묘사하는 표현 사용."
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

  const { target, imageData, strokeMeta } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  const prompt = buildPrompt(target);

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
          }]
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.log("Gemini error:", JSON.stringify(data.error));
      return res.status(500).json({ error: "Gemini API 오류", detail: data.error });
    }

    if (!data.candidates?.[0]) {
      console.log("candidates 없음:", JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ error: "candidates 없음", detail: data });
    }

    const parts = data.candidates[0]?.content?.parts;
    if (!parts?.[0]?.text) {
      return res.status(500).json({ error: "응답 없음", detail: data });
    }

    const cleaned = parts[0].text.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);

      // 항목별 상한 클램핑
      parsed.형태정확성 = Math.min(40, Math.max(0, parsed.형태정확성 || 0));
      parsed.필순       = Math.min(20, Math.max(0, parsed.필순       || 0));
      parsed.획방향     = Math.min(20, Math.max(0, parsed.획방향     || 0));
      parsed.끝맺음     = Math.min(10, Math.max(0, parsed.끝맺음     || 0));
      parsed.균형비율   = Math.min(10, Math.max(0, parsed.균형비율   || 0));

      parsed.score = parsed.형태정확성 + parsed.필순 + parsed.획방향 + parsed.끝맺음 + parsed.균형비율;

      // あ 좌표 오류 시 점수 강제 제한
      if (target === 'あ' && strokeMeta) {
        if (strokeMeta.あ_교차_오류 || strokeMeta.あ_원_오류) {
          parsed.형태정확성 = Math.min(15, parsed.형태정확성);
          parsed.score = Math.min(55, parsed.형태정확성 + parsed.필순 + parsed.획방향 + parsed.끝맺음 + parsed.균형비율);
          if (!parsed.feedback.includes('세로선')) {
            parsed.feedback = strokeMeta.あ_원_오류
              ? '동그란 부분이 세로선 오른쪽으로 충분히 나와야 해요. 왼쪽에만 머물고 있어요.'
              : '첫 번째와 두 번째 획의 교차점이 너무 끝쪽에 있어요. 중앙 부근에서 만나야 해요.';
          }
        }
      }

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
      console.log("JSON 파싱 실패:", cleaned.slice(0, 300));
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
