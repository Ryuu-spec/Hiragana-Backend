"""
score_a.py — 히라가나 'あ' 채점 시스템 (Python 포팅)
======================================================
워크북 'Hiragana Line A' 기반 루브릭 채점

채점 구조 (총 100점):
  형태정확성  40점  — 글자 실루엣이 'あ'와 얼마나 닮았나
  필순        20점  — 획 순서·개수가 맞는가 (기하학적 자동 판정)
  획방향      20점  — 각 획의 진행 벡터가 올바른가
  끝맺음      10점  — 획 마무리 처리의 자연스러움
  균형비율    10점  — 글자의 크기·위치·균형

워크북 あ 포인트 (채점 기준점):
  1획: 좌상단 → 우로 가로선, 끝에서 아래·왼쪽 갈고리
  2획: 1획 우측 하단 시작, 아래로 내려와 좌하방 큰 곡선
  3획: 2획과 교차, 반시계방향 타원 루프 (거의 닫힌 원)
"""

import json
import base64
import math
import os
import re
import logging
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path

# 외부 라이브러리 (pip install google-generativeai)
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    logging.warning("google-generativeai 미설치. AI 채점 비활성화.")


# ══════════════════════════════════════════════════════════════
# 1. 데이터 구조 정의
# ══════════════════════════════════════════════════════════════

@dataclass
class SingleStroke:
    """클라이언트에서 전송하는 획 하나의 기하학적 메타데이터"""
    start_x: float       # 시작점 X (0.0~1.0 정규화)
    start_y: float       # 시작점 Y (0.0~1.0 정규화)
    end_x: float         # 끝점 X
    end_y: float         # 끝점 Y
    width: float         # 획 bounding box 가로 크기
    height: float        # 획 bounding box 세로 크기
    path_length: float   # 실제 경로 총 길이
    displacement: float  # 시작→끝 직선 거리 (변위)

    @property
    def is_horizontal(self) -> bool:
        """가로선 판별: bounding box 가로 > 세로 × 1.5"""
        return self.width > self.height * 1.5

    @property
    def is_vertical_curve(self) -> bool:
        """세로+곡선 판별: bounding box 세로 > 가로 × 1.2"""
        return self.height > self.width * 1.2

    @property
    def is_loop(self) -> bool:
        """원/루프 판별: 경로 길이 / 변위 > 2.5 (제자리를 많이 돌았음)"""
        if self.displacement < 0.01:
            return True   # 거의 제자리: 루프로 간주
        return (self.path_length / self.displacement) > 2.5

    def classify(self) -> int:
        """
        획 유형 분류
        Returns:
            1 = 가로선 (1획)
            2 = 세로+곡선 (2획)
            3 = 원/루프 (3획)
            0 = 판별 불가
        """
        if self.is_loop:
            return 3
        if self.is_horizontal:
            return 1
        if self.is_vertical_curve:
            return 2
        return 0


@dataclass
class StrokeMeta:
    """클라이언트에서 전송하는 전체 획 데이터"""
    count: int                              # 총 획 수
    strokes: list[SingleStroke] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "StrokeMeta":
        """
        클라이언트 JSON 페이로드에서 StrokeMeta 생성
        
        예시 페이로드:
        {
          "count": 3,
          "strokes": [
            {"startX": 0.2, "startY": 0.15, "endX": 0.75, "endY": 0.2,
             "width": 0.55, "height": 0.08, "pathLength": 0.58, "displacement": 0.56},
            ...
          ]
        }
        """
        strokes = []
        for s in data.get("strokes", []):
            strokes.append(SingleStroke(
                start_x=s.get("startX", 0),
                start_y=s.get("startY", 0),
                end_x=s.get("endX", 0),
                end_y=s.get("endY", 0),
                width=s.get("width", 0),
                height=s.get("height", 0),
                path_length=s.get("pathLength", 0),
                displacement=s.get("displacement", 0),
            ))
        return cls(count=data.get("count", 0), strokes=strokes)


@dataclass
class ScoreResult:
    """채점 결과"""
    형태정확성: int = 0
    필순: int = 0
    획방향: int = 0
    끝맺음: int = 0
    균형비율: int = 0
    score: int = 0
    feedback: str = ""

    def to_dict(self) -> dict:
        return {
            "형태정확성": self.형태정확성,
            "필순": self.필순,
            "획방향": self.획방향,
            "끝맺음": self.끝맺음,
            "균형비율": self.균형비율,
            "score": self.score,
            "feedback": self.feedback,
        }


# ══════════════════════════════════════════════════════════════
# 2. 'あ' 전용 필순 계산기
# ══════════════════════════════════════════════════════════════

class AStrokeScorer:
    """
    'あ' 필순 자동 채점 (클라이언트 획 데이터 기반)

    あ 3획 표준 순서 (워크북 필순 이미지 기준):
      1획 — 가로선 (수평으로 넓음)
      2획 — 세로+곡선 (세로로 길고 아래로 크게 휨)
      3획 — 타원 루프 (반시계 방향 원)

    채점 기준:
      획 수 정확 + 순서 정확 → 20점 (만점)
      획 수 정확 + 순서 오류 → 14점
      획 수 1개 오류          → 13점
      획 수 2개 이상 오류     → 8점
      분류 실패 (None)        → AI 판단 유지
    """

    EXPECTED_STROKES = 3

    def score(self, meta: Optional[StrokeMeta]) -> Optional[int]:
        """
        필순 점수 계산
        Returns:
            int: 0~20 사이의 점수
            None: 판별 불가 (AI 점수 유지)
        """
        if not meta or not meta.strokes:
            return None

        count_diff = abs(meta.count - self.EXPECTED_STROKES)

        # 획 수 오류 → 즉시 감점 반환
        if count_diff >= 2:
            logging.info(f"あ 필순: 획 수 오류 ({meta.count}획, 기대 {self.EXPECTED_STROKES}획) → 8점")
            return 8
        if count_diff == 1:
            logging.info(f"あ 필순: 획 수 1개 오류 ({meta.count}획) → 13점")
            return 13

        # 획 수 정확 → 순서 검증
        return self._check_order(meta.strokes)

    def _check_order(self, strokes: list[SingleStroke]) -> Optional[int]:
        """획 유형 분류 후 순서 검증"""
        if len(strokes) != 3:
            return None

        types = [s.classify() for s in strokes]
        logging.info(f"あ 획 분류 결과: {types}")

        # 판별 불가 획 포함 → AI 판단 유지
        if 0 in types:
            logging.info("あ 획 분류 실패 (0 포함) → AI 판단 유지")
            return None

        # 정순: [1, 2, 3] = 가로선 → 세로곡선 → 루프
        is_correct = (types[0] == 1 and types[1] == 2 and types[2] == 3)
        score = 20 if is_correct else 14
        logging.info(f"あ 순서 {'정확' if is_correct else '오류'} → {score}점")
        return score


# ══════════════════════════════════════════════════════════════
# 3. 퓨샷 프롬프트 빌더
# ══════════════════════════════════════════════════════════════

# あ 채점 기준 데이터 (fewshot_db.js 에서 이식)
FEWSHOT_DATA_A = {
    "s90": {
        "description": (
            "3획. 1획=좌상단에서 오른쪽으로 가로선을 긋다 끝에서 아래·왼쪽으로 갈고리. "
            "2획=1획 오른쪽 아래에서 시작해 세로로 내려오다 왼쪽 아래로 크게 휘는 곡선. "
            "3획=2획과 교차하면서 반시계 방향으로 타원 루프를 그려 끝이 루프 안쪽으로 마무리."
        ),
        "scores": {"형태정확성": 38, "필순": 19, "획방향": 19, "끝맺음": 9, "균형비율": 8, "score": 93},
    },
    "s80": {
        "description": (
            "あ로 인식 가능. 다음 중 실제 해당 케이스만 피드백: "
            "(A) 3획 루프가 크게 열려 C자 형태 → '아래쪽 원의 끝선이 시작점 근처까지 돌아오도록 좀 더 감아주세요' "
            "(B) 하단 원이 상단 대비 지나치게 큼 → '아래 원 부분을 조금 더 작게 그려서 상단과 균형을 맞춰보세요' "
            "(C) 2획 꺾임이 급격하거나 전체 기울어짐 → '가운데 세로선이 중앙에 오도록 조정해 보세요'."
        ),
        "scores": {"형태정확성": 32, "필순": 18, "획방향": 16, "끝맺음": 8, "균형비율": 7, "score": 81},
    },
    "s70": {
        "description": (
            "あ로 인식 가능하나 복수 문제. (A) 3획 루프가 C자·반원 형태 "
            "(B) 균형 붕괴 — 상단 작고 하단 원 과대 "
            "(C) 2획 꺾임 약해 あ 형태 약화."
        ),
        "scores": {"형태정확성": 31, "필순": 15, "획방향": 13, "끝맺음": 6, "균형비율": 5, "score": 70},
    },
    "s60": {
        "description": "1획 갈고리 없이 직선. 3획 루프가 열린 C자 형태. あ로 인식 어려움.",
        "scores": {"형태정확성": 16, "필순": 13, "획방향": 8, "끝맺음": 4, "균형비율": 3, "score": 44},
    },
}

# あ 전용 NEG 패턴 (필수 감점 패턴)
NEG_PATTERNS_A = [
    "NEG-15: あ의 3획 루프(고리)가 크게 열려 C자·반원 형태로 원으로 인식하기 어려운 경우에만 F-02 적용 (-10점). "
    "시각적으로 원(타원)으로 인식되면 닫혀 있지 않아도 감점 없음. "
    "붓글씨 특성상 시작점과 끝점이 완전히 겹치지 않는 것은 자연스러움. "
    "/ 피드백(C자·반원일 때만): '아래 원을 끝까지 둥글게 감아주세요. 반원이 아닌 완성된 원 형태가 되어야 해요'",

    "NEG-27: あ의 하단 원(3획)이 상단 1·2획 대비 지나치게 커 전체 무게중심이 아래로 쏠린 경우 "
    "→ B-01 적용 (-3점) / 피드백: '아래 원 부분이 너무 커요. 상단 선들과 비슷한 크기로 균형을 맞춰주세요'",

    "NEG-08: 올바른 획 수보다 2획 이상 적은 경우 → F-03 × 2 적용 (-10점) "
    "/ 피드백: '획이 부족해요. あ는 3획으로 이루어져 있어요'",

    "NEG-28: 실제 필기에서 해당 문제가 없는데 피드백에 포함하는 것 엄격히 금지",
]


def build_fewshot_prompt() -> str:
    """あ 채점 기준 퓨샷 프롬프트 생성"""
    data = FEWSHOT_DATA_A
    lines = [f"\n## あ 채점 기준 예시 (4단계 닻 — 등급 기준과 일치)"]
    lines.append(f"[90점 - 완벽(A등급)]          {data['s90']['description']} → 점수: {json.dumps(data['s90']['scores'], ensure_ascii=False)}")
    lines.append(f"[80점 - 양호(B등급 기준)]     {data['s80']['description']} → 점수: {json.dumps(data['s80']['scores'], ensure_ascii=False)}")
    lines.append(f"[70점 - 보통(C등급 기준)]     {data['s70']['description']} → 점수: {json.dumps(data['s70']['scores'], ensure_ascii=False)}")
    lines.append(f"[60점 - 노력필요(D등급 기준)] {data['s60']['description']} → 점수: {json.dumps(data['s60']['scores'], ensure_ascii=False)}")
    lines.append("위 4단계를 기준 닻(anchor)으로 삼아, 제출된 이미지가 어느 단계에 가까운지 상대적으로 판단하세요.")
    return "\n".join(lines)


def build_scoring_prompt() -> str:
    """あ 채점용 전체 Gemini 프롬프트 구성"""
    fewshot = build_fewshot_prompt()
    neg_patterns = "\n".join(f"- {p}" for p in NEG_PATTERNS_A)

    return f"""당신은 20년 경력의 일본어 교사입니다. 히라가나는 붓글씨에서 기원했으므로 획의 시작·흐름·끝맺음에 자연스러운 힘의 흐름이 담겨야 합니다. 중학교 1학년 초학습자를 가르친다는 관점에서, 전문 용어 없이 동작을 직접 묘사하는 쉬운 말로 구체적인 개선 방법을 알려주세요.

학습자가 쓴 히라가나 'あ'를 이미지로 보고 5가지 항목을 각각 채점하세요.
{fewshot}

## 채점 가이드라인 (반드시 준수)
- 대상: 한국 중고등학생 초학습자. 학습 동기를 위해 관대하게 평가하세요.
- 글자가 'あ'로 인식 가능하면 → 형태정확성 최소 23점 이상
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
- あ의 3획(아랫부분 원)은 붓글씨 특성상 완전히 닫히지 않는 것이 자연스럽습니다. 원이 둥글고 식별 가능하면 감점 없이 평가하세요.
- F-02는 루프나 고리가 **아예 그려지지 않았거나** 완전히 열려서 원으로 인식할 수 없는 경우에만 적용하세요.

## 규칙 ID 기반 감점표

### 형태정확성 감점 규칙 (5점 단위)
- F-01: 곡선으로 써야 할 획을 직선으로 쓴 경우 → -5점
- F-02: 고리(루프)나 닫힌 곡선이 **아예 없거나** 완전히 열려 원으로 인식 불가한 경우 → -10점
- F-03: 두 획이 하나로 합쳐지거나 하나가 둘로 나뉜 경우 → 사례당 -5점
- F-04: 글자 구성 요소를 잇는 획이 없는 경우 → -5점
- F-05: 전체 모양이 'あ'로 전혀 알아볼 수 없는 경우 → 이 항목 0점
- F-06: 구성 요소 크기 비율이 어긋나나 글자는 식별 가능한 경우 → -5점

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

## 필수 감점 패턴 (아래 오류 감지 시 재량 없이 반드시 적용)
{neg_patterns}

## 채점 기준 (각 항목 최대값을 절대 초과하지 마세요)
- 형태정확성 (0~40, 최대 40점): 획의 전체적인 형태가 'あ'와 얼마나 닮았는가
- 필순 (0~20, 최대 20점): 획의 순서와 개수가 맞는가
- 획방향 (0~20, 최대 20점): 각 획의 방향과 흐름이 올바른가
- 끝맺음 (0~10, 최대 10점): 획의 시작과 끝 처리가 자연스러운가
- 균형비율 (0~10, 최대 10점): 글자의 크기, 위치, 균형이 잘 맞는가

반드시 아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 포함하지 마세요:
{{
  "형태정확성": 숫자,
  "필순": 숫자,
  "획방향": 숫자,
  "끝맺음": 숫자,
  "균형비율": 숫자,
  "feedback": "한국어 2~3문장. 'はね', 'はらい', 'とめ' 등 일본어 필법 전문 용어 절대 금지. 동작을 직접 묘사하는 쉬운 표현 사용(예: '획의 끝을 살짝 위로 올려주세요'). [총점 60 미만] 칭찬 없이 핵심 오류 지적 + 개선점 1가지. [총점 60~79] 잘 된 점 1가지 + 개선점 1가지. [총점 80 이상] 칭찬 위주 + 개선점 있을 때만 부드럽게."
}}"""


# ══════════════════════════════════════════════════════════════
# 4. AI 채점 엔진 (Gemini 연동)
# ══════════════════════════════════════════════════════════════

class GeminiScorer:
    """
    Gemini API를 사용한 'あ' 시각적 채점

    사용법:
        scorer = GeminiScorer(api_key="YOUR_GEMINI_API_KEY")
        result = scorer.score_image(image_base64)
    """

    MODEL_NAME = "gemini-2.5-flash"   # 워크북 설계 기준 모델
    THINKING_BUDGET = 2048            # 추론 토큰 예산 (속도·정확도 균형)

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY 환경변수 또는 api_key 인자가 필요합니다.")
        if not GENAI_AVAILABLE:
            raise ImportError("pip install google-generativeai 를 먼저 실행하세요.")

        genai.configure(api_key=self.api_key)
        self._model = genai.GenerativeModel(self.MODEL_NAME)
        self._prompt = build_scoring_prompt()

    def score_image(self, image_base64: str) -> dict:
        """
        base64 인코딩된 이미지를 채점하여 원본 AI 점수 반환

        Args:
            image_base64: 'data:image/jpeg;base64,...' 또는 순수 base64 문자열

        Returns:
            dict: {형태정확성, 필순, 획방향, 끝맺음, 균형비율, feedback}
        """
        # data URL 접두사 제거
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]

        if len(image_base64) < 100:
            raise ValueError("이미지 데이터가 너무 짧습니다. 글자를 먼저 써주세요.")

        image_part = {
            "mime_type": "image/jpeg",
            "data": image_base64,
        }

        response = self._model.generate_content(
            contents=[self._prompt, image_part],
            generation_config={
                "thinking_config": {"thinking_budget": self.THINKING_BUDGET}
            },
        )

        raw_text = response.text or ""
        cleaned = re.sub(r"```json|```", "", raw_text).strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logging.error(f"JSON 파싱 실패. raw: {raw_text[:300]}")
            raise ValueError(f"AI 응답 파싱 실패: {e}") from e


# ══════════════════════════════════════════════════════════════
# 5. 점수 후처리 파이프라인
# ══════════════════════════════════════════════════════════════

class ScorePostProcessor:
    """
    AI 원본 점수에 대한 보정 로직 파이프라인

    보정 순서:
      1. 항목별 상한 클램핑 (만점 초과 방지)
      2. 필순 덮어쓰기 (기하학적 계산값 우선)
      3. 획방향 스마트 보정 (역방향 언급 없으면 15점 하한)
      4. 총점 계산
      5. 최저 보증 보정 (식별 가능 글자 55점 하한)
    """

    MIN_SCORE = 55         # 식별 가능 글자의 최저 보증 총점
    MIN_DIRECTION = 15     # 역방향 오류 없을 때 획방향 최솟값
    MIN_SHAPE = 20         # 이 이상이어야 '식별 가능' 판정

    # 각 항목 최댓값
    MAX = {"형태정확성": 40, "필순": 20, "획방향": 20, "끝맺음": 10, "균형비율": 10}

    DIRECTION_ERROR_KEYWORDS = re.compile(r"반대|역방향|D-02|완전히 반대|거꾸로")

    def process(self, ai_scores: dict, stroke_score: Optional[int]) -> ScoreResult:
        """
        전체 보정 파이프라인 실행

        Args:
            ai_scores: Gemini 원본 채점 결과 dict
            stroke_score: 기하학적 필순 계산값 (None이면 AI 값 유지)

        Returns:
            ScoreResult: 최종 보정된 점수
        """
        result = ScoreResult()

        # ── Step 1: 항목별 상한 클램핑 ───────────────────────────
        result.형태정확성 = self._clamp(ai_scores.get("형태정확성", 0), "형태정확성")
        result.필순        = self._clamp(ai_scores.get("필순", 0),        "필순")
        result.획방향      = self._clamp(ai_scores.get("획방향", 0),      "획방향")
        result.끝맺음      = self._clamp(ai_scores.get("끝맺음", 0),      "끝맺음")
        result.균형비율    = self._clamp(ai_scores.get("균형비율", 0),    "균형비율")
        result.feedback    = ai_scores.get("feedback", "")

        logging.info(
            f"[あ] AI 원본 — "
            f"형태:{result.형태정확성} 필순:{result.필순} "
            f"획방향:{result.획방향} 끝맺음:{result.끝맺음} 균형:{result.균형비율}"
        )

        # ── Step 2: 필순 덮어쓰기 ───────────────────────────────
        if stroke_score is not None:
            logging.info(f"필순 덮어쓰기: AI {result.필순} → 계산값 {stroke_score}")
            result.필순 = stroke_score

        # ── Step 3: 획방향 스마트 보정 ──────────────────────────
        has_direction_error = bool(self.DIRECTION_ERROR_KEYWORDS.search(result.feedback))
        if result.획방향 < self.MIN_DIRECTION and not has_direction_error:
            logging.info(f"획방향 스마트 보정: {result.획방향} → {self.MIN_DIRECTION}")
            result.획방향 = self.MIN_DIRECTION

        # ── Step 4: 총점 계산 ───────────────────────────────────
        result.score = (
            result.형태정확성 + result.필순 + result.획방향
            + result.끝맺음 + result.균형비율
        )

        # ── Step 5: 최저 보증 보정 ──────────────────────────────
        # 형태정확성 ≥ 20 이면 '식별 가능' → 최소 55점 보장
        # 필순은 이미 정확히 계산됐으므로 비율 보정 대상 제외
        is_recognizable = result.형태정확성 >= self.MIN_SHAPE
        if 0 < result.score < self.MIN_SCORE and is_recognizable:
            ratio = self.MIN_SCORE / result.score
            logging.info(f"최저 보증 보정: {result.score}점 → {self.MIN_SCORE}점 (비율 {ratio:.2f})")
            result.형태정확성 = min(self.MAX["형태정확성"], round(result.형태정확성 * ratio))
            result.획방향      = min(self.MAX["획방향"],      round(result.획방향      * ratio))
            result.끝맺음      = min(self.MAX["끝맺음"],      round(result.끝맺음      * ratio))
            result.균형비율    = min(self.MAX["균형비율"],    round(result.균형비율    * ratio))
            # 필순은 비율 보정 대상 아님
            result.score = (
                result.형태정확성 + result.필순 + result.획방향
                + result.끝맺음 + result.균형비율
            )

        logging.info(
            f"[あ] 최종 점수 — "
            f"형태:{result.형태정확성} 필순:{result.필순} "
            f"획방향:{result.획방향} 끝맺음:{result.끝맺음} 균형:{result.균형비율} "
            f"총점:{result.score}"
        )
        return result

    def _clamp(self, value: int, key: str) -> int:
        """항목 값을 [0, 최댓값] 범위로 제한"""
        return min(self.MAX[key], max(0, int(value or 0)))


# ══════════════════════════════════════════════════════════════
# 6. 'あ' 메인 채점기 (퍼사드)
# ══════════════════════════════════════════════════════════════

class AHiraganaScorer:
    """
    'あ' 히라가나 채점 메인 클래스

    사용 예시:
        scorer = AHiraganaScorer(api_key="YOUR_KEY")

        # 이미지 파일로 채점
        result = scorer.score_from_file("handwriting.jpg", stroke_meta_dict)

        # base64로 채점
        result = scorer.score(image_base64, stroke_meta_dict)

        print(result.to_dict())
    """

    def __init__(self, api_key: Optional[str] = None):
        self._stroke_scorer = AStrokeScorer()
        self._ai_scorer = GeminiScorer(api_key=api_key)
        self._post_processor = ScorePostProcessor()

    def score(
        self,
        image_base64: str,
        stroke_meta_dict: Optional[dict] = None,
    ) -> ScoreResult:
        """
        'あ' 채점 실행

        Args:
            image_base64: base64 인코딩 이미지 (data URL 또는 순수 base64)
            stroke_meta_dict: 클라이언트 획 데이터 dict (없으면 필순을 AI 판단에 맡김)
                예: {
                    "count": 3,
                    "strokes": [
                        {"startX": 0.2, "startY": 0.15, "endX": 0.75, "endY": 0.20,
                         "width": 0.55, "height": 0.08, "pathLength": 0.58, "displacement": 0.56},
                        {"startX": 0.65, "startY": 0.22, "endX": 0.30, "endY": 0.65,
                         "width": 0.38, "height": 0.50, "pathLength": 0.72, "displacement": 0.60},
                        {"startX": 0.45, "startY": 0.45, "endX": 0.46, "endY": 0.44,
                         "width": 0.30, "height": 0.32, "pathLength": 1.10, "displacement": 0.02},
                    ]
                }

        Returns:
            ScoreResult: 최종 채점 결과
        """
        # 1. 기하학적 필순 계산
        stroke_meta = None
        stroke_score = None
        if stroke_meta_dict:
            stroke_meta = StrokeMeta.from_dict(stroke_meta_dict)
            stroke_score = self._stroke_scorer.score(stroke_meta)

        # 2. AI 시각 채점
        ai_raw = self._ai_scorer.score_image(image_base64)

        # 3. 후처리 보정
        return self._post_processor.process(ai_raw, stroke_score)

    def score_from_file(
        self,
        image_path: str,
        stroke_meta_dict: Optional[dict] = None,
    ) -> ScoreResult:
        """
        이미지 파일 경로로 채점 (편의 메서드)

        Args:
            image_path: JPEG 또는 PNG 파일 경로
            stroke_meta_dict: 클라이언트 획 데이터 dict
        """
        with open(image_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode("utf-8")
        return self.score(image_base64, stroke_meta_dict)


# ══════════════════════════════════════════════════════════════
# 7. Flask API 엔드포인트 (선택적 — 서버 모드)
# ══════════════════════════════════════════════════════════════

def create_flask_app(api_key: Optional[str] = None):
    """
    Flask REST API 서버 생성

    POST /api/score
    Body: {
        "imageData": "data:image/jpeg;base64,...",
        "strokeMeta": { "count": 3, "strokes": [...] }
    }
    Response: {
        "형태정확성": int,
        "필순": int,
        "획방향": int,
        "끝맺음": int,
        "균형비율": int,
        "score": int,
        "feedback": str
    }
    """
    try:
        from flask import Flask, request, jsonify
    except ImportError:
        raise ImportError("pip install flask 를 먼저 실행하세요.")

    app = Flask(__name__)
    scorer = AHiraganaScorer(api_key=api_key)

    @app.after_request
    def add_cors(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.route("/api/score", methods=["POST", "OPTIONS"])
    def score_endpoint():
        if request.method == "OPTIONS":
            return "", 200

        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "요청 바디가 없습니다."}), 400

        image_data = data.get("imageData", "")
        stroke_meta = data.get("strokeMeta")

        if not image_data:
            return jsonify({"error": "imageData가 없습니다."}), 400

        try:
            result = scorer.score(image_data, stroke_meta)
            return jsonify(result.to_dict()), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            logging.exception("채점 중 오류 발생")
            return jsonify({"error": "서버 오류", "detail": str(e)}), 500

    return app


# ══════════════════════════════════════════════════════════════
# 8. 단독 실행 (테스트 모드)
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

    parser = argparse.ArgumentParser(description="あ 히라가나 채점기")
    parser.add_argument("image", nargs="?", help="채점할 이미지 파일 경로 (JPEG/PNG)")
    parser.add_argument("--server", action="store_true", help="Flask 서버 모드로 실행")
    parser.add_argument("--port", type=int, default=5000, help="서버 포트 (기본: 5000)")
    parser.add_argument(
        "--stroke",
        type=str,
        default=None,
        help='획 메타 JSON 문자열. 예: \'{"count":3,"strokes":[...]}\''
    )
    args = parser.parse_args()

    if args.server:
        # ── 서버 모드 ───────────────────────────────────────────
        print(f"Flask 서버 시작 (port {args.port})")
        app = create_flask_app()
        app.run(port=args.port, debug=False)

    elif args.image:
        # ── 단일 이미지 채점 모드 ────────────────────────────────
        stroke_meta = json.loads(args.stroke) if args.stroke else None

        print(f"채점 중: {args.image}")
        scorer = AHiraganaScorer()
        result = scorer.score_from_file(args.image, stroke_meta)

        print("\n" + "=" * 50)
        print("  あ 채점 결과")
        print("=" * 50)
        for k, v in result.to_dict().items():
            if k == "feedback":
                print(f"  {k:8s}: {v}")
            else:
                bar = "█" * (v // 2)
                print(f"  {k:8s}: {v:3d}점  {bar}")
        print("=" * 50)

    else:
        # ── 스트로크 계산 데모 (AI 없이) ─────────────────────────
        print("=== あ 필순 계산 데모 (AI 없이) ===\n")

        demo_cases = [
            {
                "name": "정상 3획 (가로→세로곡선→루프)",
                "data": {
                    "count": 3,
                    "strokes": [
                        # 1획: 가로선 (width 크고 height 작음)
                        {"startX": 0.15, "startY": 0.20, "endX": 0.80, "endY": 0.22,
                         "width": 0.65, "height": 0.05, "pathLength": 0.66, "displacement": 0.65},
                        # 2획: 세로+곡선 (height 크고 width 작음)
                        {"startX": 0.70, "startY": 0.18, "endX": 0.25, "endY": 0.72,
                         "width": 0.45, "height": 0.60, "pathLength": 0.82, "displacement": 0.68},
                        # 3획: 루프 (pathLength >> displacement)
                        {"startX": 0.48, "startY": 0.55, "endX": 0.50, "endY": 0.53,
                         "width": 0.32, "height": 0.30, "pathLength": 1.20, "displacement": 0.03},
                    ],
                },
            },
            {
                "name": "역순 3획 (루프→세로→가로)",
                "data": {
                    "count": 3,
                    "strokes": [
                        # 3획 먼저: 루프
                        {"startX": 0.48, "startY": 0.55, "endX": 0.50, "endY": 0.53,
                         "width": 0.32, "height": 0.30, "pathLength": 1.20, "displacement": 0.03},
                        # 2획: 세로
                        {"startX": 0.70, "startY": 0.18, "endX": 0.25, "endY": 0.72,
                         "width": 0.45, "height": 0.60, "pathLength": 0.82, "displacement": 0.68},
                        # 1획 마지막: 가로
                        {"startX": 0.15, "startY": 0.20, "endX": 0.80, "endY": 0.22,
                         "width": 0.65, "height": 0.05, "pathLength": 0.66, "displacement": 0.65},
                    ],
                },
            },
            {
                "name": "2획 (획 수 부족)",
                "data": {
                    "count": 2,
                    "strokes": [
                        {"startX": 0.15, "startY": 0.20, "endX": 0.80, "endY": 0.22,
                         "width": 0.65, "height": 0.05, "pathLength": 0.66, "displacement": 0.65},
                        {"startX": 0.70, "startY": 0.18, "endX": 0.25, "endY": 0.72,
                         "width": 0.45, "height": 0.60, "pathLength": 0.82, "displacement": 0.68},
                    ],
                },
            },
        ]

        stroke_scorer = AStrokeScorer()
        for case in demo_cases:
            meta = StrokeMeta.from_dict(case["data"])
            score = stroke_scorer.score(meta)
            types = [s.classify() for s in meta.strokes]
            print(f"케이스: {case['name']}")
            print(f"  획 유형 분류: {types}")
            print(f"  필순 점수: {score if score is not None else 'AI 판단 유지'}")
            print()
