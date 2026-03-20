const { FEWSHOT_DB, getFilteredNEG } = require('../fewshot_db');

// ============================================================
// 워크북 행별 핵심 포인트 (빨간색 기준선 기반)
// — buildPrompt()에서 AI 프롬프트에 주입됨
// ============================================================
const WORKBOOK_POINTS = {
  // あ行
  'あ': '역삼각형 구도: 1획(가로선)이 위, 2획(세로곡선)이 왼쪽 아래로 내려와 크게 휨, 3획(타원 루프)이 중앙 아래. 세 획이 역삼각형을 이루어야 함.',
  'い': '두 획이 서로 마주보는 형태. 2획(오른쪽)이 1획보다 반드시 짧아야 함. 1획은 오른쪽 아래 방향 대각선(수직 직선 금지).',
  'う': '세로 중앙선 위에 1획(짧은 점 사선)이 위치. 2획은 위로 살짝 올라갔다 U자로 내려오며 왼쪽 위로 끝올림.',
  'え': '역삼각형 구도: 1획(짧은 점 사선)이 꼭짓점, 2획(가로선+꺾임+물결 마무리)이 넓은 밑변. 2획 끝의 물결(~) 마무리가 핵심.',
  'お': '가로선(1획) + 세로+루프(2획) + 오른쪽 분리 사선(3획). 2획의 타원 루프가 닫혀야 하고 3획은 반드시 2획과 분리.',

  // か行
  'か': '1획(가로선)과 2획(세로+끝올림)의 교차점이 글자 중앙에 위치. 3획(오른쪽 짧은 사선)은 2획과 분리된 독립 획.',
  'き': '두 가로선(1·2획)이 평행. 세로선(3획)이 두 가로선 모두를 교차해야 함. 4획(오른쪽 짧은 곡선)은 분리 또는 연결 모두 허용.',
  'く': '부드러운 V자 꺾임. 꺾임이 직각이 되면 안 되고 곡선으로 자연스럽게 방향 전환. 단 1획.',
  'け': '1획(세로선)과 2획(가로+꺾임+세로+끝올림)의 교차점 위치가 세로선 중간. 3획은 2획 하단 오른쪽 짧은 사선.',
  'こ': '두 가로선이 수평으로 나란히 평행. 아래 가로선(2획) 오른쪽 끝에서 아래로 갈고리.',

  // さ行
  'さ': '1획(가로선) + 2획(세로+곡선+끝올림) + 3획(오른쪽 위 짧은 사선). 3획은 반드시 2획에서 분리된 독립 획.',
  'し': 'J자 곡선. 위에서 아래로 내려오다 하단에서 오른쪽으로 부드럽게 구부러져 위로 끝올림. 단 1획.',
  'す': '1획(가로선+원호) + 2획(중앙 세로선). 2획이 원호 중앙을 관통해야 함. 원호 끝에서 위로 끝올림.',
  'せ': '1획(가로선)과 2획(세로+끝올림)이 교차. 3획(오른쪽 위 짧은 가로선)은 오른쪽 상단에 분리.',
  'そ': '부드러운 S자 곡선. 각진 Z자가 되면 안 됨. 세로 중앙선 기준 좌우로 물결치듯 흐름. 단 1획.',

  // た行
  'た': '1획(가로선)+2획(세로선) 교차 후, 3획(오른쪽 사선), 4획(오른쪽 아래 つ 모양 곡선). 4획을 빠뜨리기 쉬우니 주의.',
  'ち': '1획(가로선+아래 꺾임 L자) + 2획(풍성한 반원). 2획 반원이 충분히 둥글고 커야 함.',
  'つ': '가로로 넓은 타원. 세로 U자가 아니라 옆으로 납작한 형태. 단 1획.',
  'て': '가로선에서 오른쪽 끝이 아래로 꺾이는 1획. 끊지 않고 연결. 세로 중앙선에서 꺾임.',
  'と': '1획(세로선+위로 짧은 꺾임) + 2획(오른쪽 반원). 반원이 충분히 둥글어야 함.',

  // な行
  'な': 'V자/역삼각형 구도(포인트 이미지 빨간 X자). 1획(세로) → 2획(교차 가로) → 3획(오른쪽 세로+꺾임) → 4획(사선). 2획이 1획과 교차.',
  'に': '위 가로선(1획) + 아래 가로선(2획) 평행. 3획(세로+갈고리)이 두 가로선 사이에서 시작해 아래로.',
  'ぬ': '두 원호(1·2획)가 중앙에서 반드시 교차. 2획 끝이 나선으로 열림. 교차 없으면 글자 불성립.',
  'ね': '1획(세로선) + 2획(오른쪽 원호+나선). 나선 끝이 위로 열려야 함(닫히면 ぬ로 보임).',
  'の': '반시계 방향 열린 나선. 끝이 시작점에 닿지 않고 오른쪽 위로 열려야 함. 단 1획.',

  // は行
  'は': '1획(세로선) + 2획(가로+꺾임+세로+끝올림) + 3획(오른쪽 원호). 2획 하단 끝올림이 핵심 포인트.',
  'ひ': '왼쪽 상단에서 시작해 오른쪽으로 크게 원호를 그리는 단 1획. 위아래로 열린 형태.',
  'ふ': '삼각형(후지산) 구도: 4획이 삼각형을 이룸. 1획(위 점/사선) + 2획(왼쪽 사선) + 3획(오른쪽 사선) + 4획(아래 사선).',
  'へ': '꼭짓점이 중앙에 위치하는 산(へ) 모양. 꼭짓점이 너무 왼쪽·오른쪽으로 치우치면 감점. 단 1획.',
  'ほ': '1획(세로선) + 2획(가로선) + 3획(세로+끝올림) + 4획(오른쪽 루프). 루프가 닫혀야 함.',

  // ま行
  'ま': '1획(위 가로) + 2획(아래 가로) + 3획(세로+루프). 두 가로선이 X자형으로 교차하는 구도(포인트 이미지).',
  'み': '1획(왼쪽 원호) + 2획(오른쪽 원호+나선). 두 원호가 마주보는 형태.',
  'む': '1획(가로선) + 2획(원호, 위쪽 획을 반드시 넘어야 함) + 3획(오른쪽 사선). 2획이 1획 위를 넘지 못하면 글자 불성립.',
  'め': '1획(왼쪽 세로+원호) + 2획(나선). 나선이 열린 형태(の와 유사하지만 좌우 구조 다름).',
  'も': '1획(위 가로) + 2획(아래 가로) + 3획(세로+루프). 두 가로선이 평행하고 균등 간격.',

  // や行
  'や': '삼각형(X자) 구도: 1획(왼쪽 사선+꺾임) + 2획(오른쪽 위 세로) + 3획(오른쪽 아래 사선). 세 획이 삼각형 형태.',
  'ゆ': '1획(세로+왼쪽 반원) + 2획(오른쪽 가로선). 1획의 반원이 충분히 둥글어야 함.',
  'よ': '1획(위 가로+갈고리) + 2획(아래 가로+갈고리). 두 획의 길이 차이가 뚜렷해야 함(1획이 더 짧음).',

  // ら行
  'ら': '1획(세로선) + 2획(꺾임+원호). 2획이 꺾이며 아래로 내려오다 원호로 마무리.',
  'り': '두 사선이 나란히 평행. 1획(왼쪽 짧은 사선) + 2획(오른쪽 긴 사선+끝올림).',
  'る': '위에서 시작해 아래로 원을 그리며 안쪽으로 나선이 들어오는 형태. 나선이 열린 채 끝남. 단 1획.',
  'れ': '1획(세로선) + 2획(오른쪽 원호). 2획 끝이 아래를 향해야 함(위로 올라가면 ね로 오해).',
  'ろ': '원호를 그리다 위쪽으로 열린 채 끝남. 나선이 추가되면 る로 오해됨. 단 1획.',

  // わ行 + ん
  'わ': '1획(세로선) + 2획(오른쪽 원호+사선). 2획 끝이 아래로 내려옴(れ와 구분).',
  'を': '1획(위 가로) + 2획(중간 가로+꺾임) + 3획(세로+원호). 복잡한 구조이므로 획 수 주의.',
  'ん': '왼쪽 위에서 아래로 내려오다 오른쪽 위로 끝이 향하는 단 1획. し와 달리 끝이 오른쪽 위(45도).',
};

// ============================================================
// 필순 계산 — 클라이언트 획 데이터 기반 (AI 판단 대체)
// 워크북 행별 포인트(빨간선)를 기준점으로 삼아 기하학적 판정
// ============================================================
const STROKE_RULES = {

  // ── あ行 ──────────────────────────────────────────────────

  // あ(3획) — 역삼각형 구도 기반 형태 분류
  // 워크북 포인트: 1획(가로) → 2획(세로곡선) → 3획(루프)가 역삼각형
  'あ': {
    expected: 3,
    orderCheck: (s) => {
      function classifyStroke(st) {
        if (st.displacement > 0.01 && st.pathLength / st.displacement > 2.5) return 3; // 루프
        if (st.width > st.height * 1.5) return 1;  // 가로선
        if (st.height > st.width * 1.2) return 2;  // 세로+곡선
        return 0;
      }
      if (s.length !== 3) return false;
      const types = s.map(classifyStroke);
      console.log(`あ 획 분류: [${types.join(', ')}]`);
      if (types.includes(0)) return null;
      return types[0] === 1 && types[1] === 2 && types[2] === 3;
    }
  },

  // い(2획) — 워크북 포인트: 1획이 왼쪽(오른쪽 아래 대각선), 2획이 오른쪽(더 짧음)
  'い': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // う(2획) — 워크북 포인트: 1획(상단 점 사선)이 2획(U자)보다 위에서 시작
  'う': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // え(2획) — 워크북 포인트: 1획(점 사선)이 상단, 2획(가로+꺾임)이 하단
  'え': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // お(3획) — 워크북 포인트: 가로→루프→오른쪽 분리 사선
  'お': {
    expected: 3,
    orderCheck: (s) => {
      const firstAboveSecond = s[0].startY < s[1].startY;
      const thirdIsRight     = s[2].startX > 0.4;
      return firstAboveSecond && thirdIsRight;
    }
  },

  // ── か行 ──────────────────────────────────────────────────

  // か(3획) — 워크북 포인트: 교차점 중앙, 3획 분리 사선
  'か': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(가로선)이 2획(세로+끝올림)보다 위에서 시작
      // 3획(오른쪽 사선)은 오른쪽 영역에서 시작
      const firstAboveSecond = s[0].startY < s[1].startY;
      const thirdIsRight     = s[2].startX > 0.45;
      return firstAboveSecond && thirdIsRight;
    }
  },

  // き(4획) — 워크북 포인트: 두 가로선 평행, 세로선이 둘 다 교차
  'き': {
    expected: 4,
    orderCheck: (s) => {
      // 1획(위 가로) → 2획(아래 가로) → 3획(세로) → 4획(오른쪽 곡선)
      // 1획이 2획보다 위에서 시작, 3획이 두 가로선 사이 또는 교차
      const firstAboveSecond = s[0].startY < s[1].startY;
      const thirdBelowFirst  = s[2].startY > s[0].startY;
      return firstAboveSecond && thirdBelowFirst;
    }
  },

  // く(1획) — 단획, 획 수만 검증
  'く': {
    expected: 1,
    orderCheck: () => true
  },

  // け(3획) — 워크북 포인트: 세로선+교차 가로선+오른쪽 사선
  'け': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(세로선, 왼쪽)이 2획(가로+꺾임)보다 왼쪽에서 시작
      const firstLeftOfSecond = s[0].startX < s[1].startX;
      return firstLeftOfSecond;
    }
  },

  // こ(2획) — 워크북 포인트: 두 가로선 평행, 위→아래 순서
  'こ': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // ── さ行 ──────────────────────────────────────────────────

  // さ(3획) — 워크북 포인트: 3획이 2획에서 분리
  'さ': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(가로선)이 가장 위, 3획(오른쪽 사선)이 오른쪽 영역에서 시작
      const firstAboveSecond = s[0].startY < s[1].startY;
      const thirdIsRight     = s[2].startX > 0.4;
      return firstAboveSecond && thirdIsRight;
    }
  },

  // し(1획) — 단획, 획 수만 검증
  'し': {
    expected: 1,
    orderCheck: () => true
  },

  // す(2획) — 워크북 포인트: 원호+중앙 관통 세로선
  'す': {
    expected: 2,
    orderCheck: (s) => {
      // 1획(원호, 경로가 길고 복잡)이 2획(짧은 세로선)보다 위에서 시작
      return s[0].startY < s[1].startY;
    }
  },

  // せ(3획) — 워크북 포인트: 교차점 + 오른쪽 분리 가로선
  'せ': {
    expected: 3,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // そ(1획) — 단획, 획 수만 검증
  'そ': {
    expected: 1,
    orderCheck: () => true
  },

  // ── た行 ──────────────────────────────────────────────────

  // た(4획) — 워크북 포인트: 가로+세로 교차 + 오른쪽 사선 + つ 모양
  'た': {
    expected: 4,
    orderCheck: (s) => {
      // 1획(가로선)이 가장 위에서 시작
      return s[0].startY < s[1].startY;
    }
  },

  // ち(2획) — 워크북 포인트: L자 + 풍성한 반원
  'ち': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // つ(1획) — 단획, 획 수만 검증
  'つ': {
    expected: 1,
    orderCheck: () => true
  },

  // て(1획) — 단획, 획 수만 검증
  'て': {
    expected: 1,
    orderCheck: () => true
  },

  // と(2획) — 워크북 포인트: 세로선+꺾임 → 오른쪽 반원
  'と': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // ── な行 ──────────────────────────────────────────────────

  // な(4획) — 워크북 포인트: X자/역삼각형 구도
  'な': {
    expected: 4,
    orderCheck: (s) => {
      // 1획(세로선)이 2획(교차 가로선)보다 왼쪽에서 시작
      return s[0].startX < s[1].startX;
    }
  },

  // に(3획) — 워크북 포인트: 위 가로 → 아래 가로 → 세로+갈고리
  'に': {
    expected: 3,
    orderCheck: (s) => {
      // 1획이 2획보다 위에서 시작
      return s[0].startY < s[1].startY;
    }
  },

  // ぬ(2획) — 워크북 포인트: 두 원호가 중앙에서 교차
  'ぬ': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // ね(2획) — 워크북 포인트: 세로선 → 오른쪽 원호+나선(위로 열림)
  'ね': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // の(1획) — 단획, 획 수만 검증
  'の': {
    expected: 1,
    orderCheck: () => true
  },

  // ── は行 ──────────────────────────────────────────────────

  // は(3획) — 워크북 포인트: 끝올림(はね)이 핵심
  'は': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(세로선)이 2획(가로+세로 복합)보다 왼쪽에서 시작
      return s[0].startX < s[1].startX;
    }
  },

  // ひ(1획) — 단획, 획 수만 검증
  'ひ': {
    expected: 1,
    orderCheck: () => true
  },

  // ふ(4획) — 워크북 포인트: 삼각형(후지산) 구도
  'ふ': {
    expected: 4,
    orderCheck: (s) => {
      // 1획(위 점/사선)이 가장 위에서 시작
      return s[0].startY < s[1].startY;
    }
  },

  // へ(1획) — 단획, 획 수만 검증
  'へ': {
    expected: 1,
    orderCheck: () => true
  },

  // ほ(4획) — 워크북 포인트: 세로선+가로선+끝올림+루프
  'ほ': {
    expected: 4,
    orderCheck: (s) => {
      // 1획(세로선)이 2획(가로선)보다 왼쪽에서 시작
      return s[0].startX < s[1].startX;
    }
  },

  // ── ま行 ──────────────────────────────────────────────────

  // ま(3획) — 워크북 포인트: 두 가로선이 X자형 교차 구도
  'ま': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(위 가로) → 2획(아래 가로) → 3획(세로+루프)
      return s[0].startY < s[1].startY;
    }
  },

  // み(2획) — 워크북 포인트: 두 원호가 마주보는 형태
  'み': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // む(3획) — 워크북 포인트: 원호가 위쪽 획을 반드시 넘어야 함
  'む': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(가로선)이 2획(원호)보다 위에서 시작
      return s[0].startY < s[1].startY;
    }
  },

  // め(2획) — 워크북 포인트: 열린 나선
  'め': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // も(3획) — 워크북 포인트: 두 가로선 평행 + 세로+루프
  'も': {
    expected: 3,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // ── や行 ──────────────────────────────────────────────────

  // や(3획) — 워크북 포인트: 삼각형(X자) 구도
  'や': {
    expected: 3,
    orderCheck: (s) => {
      // 1획(왼쪽 사선)이 2획(오른쪽 위 세로)보다 왼쪽에서 시작
      return s[0].startX < s[1].startX;
    }
  },

  // ゆ(2획) — 워크북 포인트: 세로+반원(왼쪽) → 가로선(오른쪽)
  'ゆ': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // よ(2획) — 워크북 포인트: 위 가로 → 아래 가로+갈고리
  'よ': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // ── ら行 ──────────────────────────────────────────────────

  // ら(2획) — 워크북 포인트: 세로선 → 꺾임+원호
  'ら': {
    expected: 2,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // り(2획) — 워크북 포인트: 두 사선이 나란히 평행
  'り': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // る(1획) — 단획, 획 수만 검증
  'る': {
    expected: 1,
    orderCheck: () => true
  },

  // れ(2획) — 워크북 포인트: 끝이 아래를 향함(ね와 구분)
  'れ': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // ろ(1획) — 단획, 획 수만 검증
  'ろ': {
    expected: 1,
    orderCheck: () => true
  },

  // ── わ行 + ん ──────────────────────────────────────────────

  // わ(2획) — 워크북 포인트: 세로선 → 오른쪽 원호
  'わ': {
    expected: 2,
    orderCheck: (s) => s[0].startX < s[1].startX
  },

  // を(3획) — 워크북 포인트: 위 가로 → 중간 가로+꺾임 → 세로+원호
  'を': {
    expected: 3,
    orderCheck: (s) => s[0].startY < s[1].startY
  },

  // ん(1획) — 단획, 획 수만 검증
  'ん': {
    expected: 1,
    orderCheck: () => true
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
  const workbookPoint  = WORKBOOK_POINTS[target] || '';
  const workbookSection = workbookPoint
    ? `\n## 워크북 핵심 포인트 (이 기준을 최우선으로 삼아 채점하세요)\n${workbookPoint}\n`
    : '';

  return `당신은 20년 경력의 일본어 교사입니다. 히라가나는 붓글씨에서 기원했으므로 획의 시작·흐름·끝맺음에 자연스러운 힘의 흐름이 담겨야 합니다. 중학교 1학년 초학습자를 가르친다는 관점에서, 전문 용어 없이 동작을 직접 묘사하는 쉬운 말로 구체적인 개선 방법을 알려주세요.
학습자가 쓴 히라가나 '${target}'를 이미지로 보고 5가지 항목을 각각 채점하세요.
${workbookSection}
${fewShotSection}
## 채점 가이드라인 (반드시 준수)
- 대상: 한국 중고등학생 초학습자. 학습 동기를 위해 관대하게 평가하세요.
- 글자가 '${target}'로 인식 가능하면 → 형태정확성 최소 28점 이상
- 주요 구성 획이 2개 이상 존재하고 글자가 식별 가능하면 → 총점 최소 55점 이상 부여
- 기본 형태가 대체로 맞고 주요 획이 표현되었다면 → 총점 75점 이상
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
  "feedback": "한국어 2~3문장. 'はね', 'はらい', 'とめ' 등 일본어 필법 전문 용어 절대 금지. 동작을 직접 묘사하는 쉬운 표현 사용(예: '획의 끝을 살짝 위로 올려주세요', '선을 부드럽게 멈춰주세요'). 점수 구간별 톤 기준: [총점 60 미만] 칭찬 없이 핵심 구조 오류를 명확히 지적하고 가장 중요한 개선점 1가지만 집중 설명. [총점 60~79] 잘 된 점 1가지 + 구체적 개선점 1가지. [총점 80 이상] 칭찬 위주로 쓰되 개선점은 있을 때만 부드럽게 언급."
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

    // ★ 디버그 로그
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

      // ★ 최저 보증 보정 (55점 하한)
      const MIN_SCORE = 55;
      const isRecognizable = parsed.형태정확성 >= 20;
      if (parsed.score > 0 && parsed.score < MIN_SCORE && isRecognizable) {
        const ratio = MIN_SCORE / parsed.score;
        parsed.형태정확성 = Math.min(40, Math.round((parsed.형태정확성 || 0) * ratio));
        parsed.획방향      = Math.min(20, Math.round((parsed.획방향 || 0) * ratio));
        parsed.끝맺음      = Math.min(10, Math.round((parsed.끝맺음 || 0) * ratio));
        parsed.균형비율    = Math.min(10, Math.round((parsed.균형비율 || 0) * ratio));
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
