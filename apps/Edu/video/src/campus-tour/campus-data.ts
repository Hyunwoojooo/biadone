// Snapshot of the user's existing campus. Original HTML sources remain unchanged.
import type {CampusCourse} from './RoomBoard';

export const COURSES = [
  {
    "id": "F",
    "badge": "기초",
    "group": "공통 기초",
    "short": "내 사업에 AI 적용하기",
    "title": "GPT한테 우리 사업 제대로 이해시키기",
    "result": "내 사업 전용 GPT + 요청 템플릿",
    "learn": [
      "우리 사업 소개·상품·가격·고객 질문 정리하기",
      "GPT 프로젝트 또는 맞춤 GPT에 사업 자료 세팅하기",
      "브랜드 말투·답변 원칙·금지 표현 설정하기",
      "실무에 바로 쓰는 요청문 3개 만들어 저장하기",
      "실제 고객 질문으로 답변 정확도 테스트하기",
      "상품·가격 변경 시 사업 정보 직접 업데이트하기"
    ],
    "outputs": [
      "내 사업 전용 GPT",
      "실무용 요청 템플릿 3개"
    ],
    "color": "#4589e8",
    "ink": "#2269bd",
    "summary": "내 사업을 이해하는 GPT와, 실무에 바로 쓰는 요청문을 준비합니다.",
    "takeaway": "먼저, 우리 사업을 제대로 알려주는 일부터 시작합니다."
  },
  {
    "id": "A",
    "badge": "A",
    "group": "선택 A",
    "short": "홍보 콘텐츠 만들기",
    "title": "조회수 1만 회를 노리는 AI 홍보 콘텐츠 제작법",
    "result": "홍보 이미지·게시물 + 제작 템플릿",
    "learn": [
      "조회수 높은 콘텐츠의 첫 3초 후킹 분석하기",
      "고객이 멈춰 보는 제목·썸네일 기획하기",
      "GPT로 릴스 대본·홍보 문구 만들기",
      "실제 상품 사진으로 AI 홍보 이미지 제작하기",
      "우리 브랜드의 색상·폰트·자막 템플릿 만들기",
      "짧은 영상의 자막·장면 구성 실습하기 (선택)",
      "게시 후 조회수·클릭·문의 반응 점검하기"
    ],
    "outputs": [
      "홍보 이미지·게시물",
      "브랜드 제작 템플릿"
    ],
    "color": "#35a4df",
    "ink": "#13759f",
    "summary": "고객이 멈춰 보는 문구와 이미지, 반복해서 쓸 제작 템플릿을 만듭니다.",
    "takeaway": "한 번 만들고 끝내지 않고, 반응을 보고 고칩니다."
  },
  {
    "id": "B",
    "badge": "B",
    "group": "선택 B",
    "short": "사업 소개·문의 웹페이지",
    "title": "홈페이지 외주비 아끼고 AI로 직접 제작하기",
    "result": "공개 웹페이지 + 문의 연결",
    "learn": [
      "고객이 3초 만에 이해하는 페이지 구조 기획하기",
      "AI 코딩 도구·웹 빌더로 홈페이지 뼈대 만들기",
      "사업 소개·가격·사진·후기·FAQ 넣기",
      "문의 폼·전화·기존 예약 링크 연결하기",
      "모바일에서 깨지는 화면 직접 고치기",
      "웹페이지 공개·검색 노출 기본 설정하기",
      "가격·사진·문구 수정하고 이전 상태 복구하기"
    ],
    "outputs": [
      "공개된 사업 소개 웹페이지",
      "문의 폼·전화·예약 링크 연결"
    ],
    "color": "#997be0",
    "ink": "#7353b9",
    "summary": "고객이 사업을 이해하고 문의할 수 있는 홈페이지를 직접 만들고 고칩니다.",
    "takeaway": "가격이나 사진이 바뀌어도, 내가 직접 수정할 수 있게."
  },
  {
    "id": "C",
    "badge": "C",
    "group": "선택 C",
    "short": "고객 문의 자동화",
    "title": "고객 문의가 오면 자동 정리·알림까지!",
    "result": "문의 폼 + 고객 관리표 + 자동 알림",
    "learn": [
      "고객 문의를 빠짐없이 받는 접수 폼 만들기",
      "접수 내용을 관리표에 자동 저장하기",
      "문의 유형·담당자·처리 상태 구분하기",
      "FAQ를 활용해 답변 초안 빠르게 작성하기",
      "새 문의가 오면 담당자에게 자동 알림 보내기",
      "AI 문의 분류·요약 자동화 연결하기 (선택)",
      "중복 접수·오발송 방지와 수동 처리 익히기"
    ],
    "outputs": [
      "고객 문의 접수 폼",
      "고객 관리표",
      "담당자 자동 알림"
    ],
    "color": "#e17b8b",
    "ink": "#b43f58",
    "summary": "문의 접수부터 관리표 저장과 담당자 알림까지 연결합니다.",
    "takeaway": "문의 한 건이 다음 업무로 이어지도록 정리합니다."
  },
  {
    "id": "D",
    "badge": "D",
    "group": "선택 D",
    "short": "매출 분석·보고서",
    "title": "매출 엑셀 속에서 돈 되는 상품 찾아내기",
    "result": "매출 분석표 + 반복 보고 템플릿",
    "learn": [
      "매출·정산 엑셀 파일을 한 번에 정리하기",
      "취소·중복·누락 데이터 걸러내기",
      "잘 팔리는 상품·요일·채널 찾아보기",
      "실제 정산금과 매출 숫자 대조하기",
      "리뷰에서 고객 불만·개선 포인트 찾기",
      "매주 재사용할 매출 보고서 양식 만들기"
    ],
    "outputs": [
      "매출 분석표",
      "반복 보고 템플릿"
    ],
    "color": "#e5aa65",
    "ink": "#a56423",
    "summary": "매출과 정산 자료를 정리하고, 원본과 맞는 반복 보고서를 만듭니다.",
    "takeaway": "숫자를 보기 전에, 숫자가 맞는지부터 확인합니다."
  },
  {
    "id": "E",
    "badge": "E",
    "group": "선택 E",
    "short": "나만의 업무 도구",
    "title": "매번 반복하는 일, 나만의 업무 앱으로 끝내기",
    "result": "맞춤 계산기·작은 앱 1개",
    "learn": [
      "반복되는 귀찮은 업무 한 가지 골라보기",
      "입력값·계산 규칙·처리 결과 정리하기",
      "AI 코딩 도구로 계산기·작은 업무 앱 만들기",
      "직접 사용할 입력 화면·결과 화면 구성하기",
      "빈칸·오입력·파일 오류 테스트하기",
      "가격·업무 규칙이 바뀌면 직접 수정하기"
    ],
    "outputs": [
      "내 업무에 맞는 계산기 또는 작은 앱 1개"
    ],
    "color": "#65b89b",
    "ink": "#277e5b",
    "summary": "귀찮은 반복 업무 한 가지를 골라, 내 일에 맞는 작은 앱으로 만듭니다.",
    "takeaway": "크게 시작하지 않아도 됩니다. 불편한 일 하나부터."
  },
  {
    "id": "T",
    "badge": "심화",
    "group": "심화 과정",
    "short": "AI 업무팀 구축·운영",
    "title": "AI 직원 3명으로 내 사업 업무팀 만들기",
    "result": "역할별 AI 팀 + 승인·운영 체계",
    "learn": [
      "일을 기획·제작·검수 역할로 나누기",
      "AI 직원마다 역할·작업 지침 세팅하기",
      "공통 사업 자료를 연결해 같은 기준으로 일시키기",
      "AI끼리 결과를 전달하는 업무 흐름 만들기",
      "실전 실습: 마케팅 기획 → 제작 → 검수",
      "사장님 승인 전 외부 발송을 막는 단계 만들기",
      "반복 실행·비용·오류·작업 기록 점검하기"
    ],
    "outputs": [
      "기획·제작·검수 역할별 AI 팀",
      "사장님 승인 단계",
      "반복 실행·비용·오류 운영 체계"
    ],
    "color": "#8c78ce",
    "ink": "#5d45a0",
    "summary": "기획·제작·검수 역할을 연결하고, 사장의 승인과 운영 기준을 세웁니다.",
    "takeaway": "일은 나눠 맡기고, 마지막 기준은 내가 정합니다."
  },
  {
    "id": "S",
    "badge": "공통",
    "group": "전 과정 공통",
    "short": "운영 안내 · 비용·보안·복구",
    "title": "구독료 폭탄 막고 정보 유출 예방하기",
    "result": "비용·보안·복구 운영 체크리스트",
    "learn": [
      "AI 구독료와 API 사용 요금 구분하기",
      "개인정보·사업 자료의 입력 범위 정하기",
      "계정·공유 권한·외부 도구 연결 관리하기",
      "작업 실패 시 실행 중지·복구·수동 처리하기",
      "구독·API·도메인·호스팅 비용 점검하기",
      "권한·비용·오류 대응 내용을 운영 카드로 정리하기"
    ],
    "outputs": [
      "비용·보안·복구 운영 체크리스트"
    ],
    "color": "#87929b",
    "ink": "#465561",
    "summary": "비용·권한·자료 입력 범위와, 문제가 생겼을 때의 중지·복구 기준을 정리합니다.",
    "takeaway": "잘 만드는 것만큼, 안전하게 운영하는 것도 배웁니다."
  }
] satisfies CampusCourse[];

export const MAP = {
  "width": 1200,
  "height": 900,
  "start": {
    "x": 615,
    "y": 835
  },
  "nodes": [
    {
      "id": "entry",
      "x": 615,
      "y": 835,
      "links": [
        "front"
      ]
    },
    {
      "id": "front",
      "x": 615,
      "y": 805,
      "links": [
        "entry",
        "leftFront"
      ]
    },
    {
      "id": "leftFront",
      "x": 525,
      "y": 770,
      "links": [
        "front",
        "F-door",
        "westPass"
      ]
    },
    {
      "id": "westPass",
      "x": 490,
      "y": 675,
      "links": [
        "leftFront",
        "south",
        "T-front"
      ]
    },
    {
      "id": "south",
      "x": 540,
      "y": 565,
      "links": [
        "westPass",
        "center",
        "west"
      ]
    },
    {
      "id": "center",
      "x": 625,
      "y": 455,
      "links": [
        "south",
        "west",
        "north",
        "east"
      ]
    },
    {
      "id": "west",
      "x": 480,
      "y": 450,
      "links": [
        "south",
        "center",
        "north",
        "A-front"
      ]
    },
    {
      "id": "north",
      "x": 630,
      "y": 360,
      "links": [
        "center",
        "west",
        "east",
        "B-front"
      ]
    },
    {
      "id": "east",
      "x": 795,
      "y": 435,
      "links": [
        "center",
        "north",
        "eastSouth",
        "C-front",
        "D-front"
      ]
    },
    {
      "id": "eastSouth",
      "x": 800,
      "y": 545,
      "links": [
        "east",
        "E-front"
      ]
    },
    {
      "id": "F-door",
      "x": 615,
      "y": 780,
      "links": [
        "leftFront"
      ]
    },
    {
      "id": "A-door",
      "x": 400,
      "y": 425,
      "links": [
        "A-front"
      ]
    },
    {
      "id": "B-door",
      "x": 560,
      "y": 310,
      "links": [
        "B-front"
      ]
    },
    {
      "id": "C-door",
      "x": 755,
      "y": 350,
      "links": [
        "C-front"
      ]
    },
    {
      "id": "D-door",
      "x": 895,
      "y": 450,
      "links": [
        "D-front"
      ]
    },
    {
      "id": "E-door",
      "x": 850,
      "y": 635,
      "links": [
        "E-front"
      ]
    },
    {
      "id": "T-door",
      "x": 405,
      "y": 610,
      "links": [
        "T-front"
      ]
    },
    {
      "id": "A-front",
      "x": 440,
      "y": 445,
      "links": [
        "west",
        "A-door"
      ]
    },
    {
      "id": "B-front",
      "x": 565,
      "y": 355,
      "links": [
        "north",
        "B-door"
      ]
    },
    {
      "id": "C-front",
      "x": 748,
      "y": 395,
      "links": [
        "east",
        "C-door"
      ]
    },
    {
      "id": "D-front",
      "x": 850,
      "y": 460,
      "links": [
        "east",
        "D-door"
      ]
    },
    {
      "id": "E-front",
      "x": 812,
      "y": 610,
      "links": [
        "eastSouth",
        "E-door"
      ]
    },
    {
      "id": "T-front",
      "x": 450,
      "y": 630,
      "links": [
        "westPass",
        "T-door"
      ]
    }
  ],
  "edges": [
    [
      "entry",
      "front"
    ],
    [
      "front",
      "leftFront"
    ],
    [
      "leftFront",
      "F-door"
    ],
    [
      "leftFront",
      "westPass"
    ],
    [
      "westPass",
      "south"
    ],
    [
      "south",
      "center"
    ],
    [
      "south",
      "west"
    ],
    [
      "center",
      "west"
    ],
    [
      "center",
      "north"
    ],
    [
      "center",
      "east"
    ],
    [
      "north",
      "west"
    ],
    [
      "north",
      "east"
    ],
    [
      "east",
      "eastSouth"
    ],
    [
      "west",
      "A-front"
    ],
    [
      "A-front",
      "A-door"
    ],
    [
      "north",
      "B-front"
    ],
    [
      "B-front",
      "B-door"
    ],
    [
      "east",
      "C-front"
    ],
    [
      "C-front",
      "C-door"
    ],
    [
      "east",
      "D-front"
    ],
    [
      "D-front",
      "D-door"
    ],
    [
      "eastSouth",
      "E-front"
    ],
    [
      "E-front",
      "E-door"
    ],
    [
      "westPass",
      "T-front"
    ],
    [
      "T-front",
      "T-door"
    ]
  ],
  "portals": [
    {
      "id": "F",
      "x": 615,
      "y": 780,
      "exit": {
        "x": 615,
        "y": 825
      },
      "node": "F-door",
      "radius": 52
    },
    {
      "id": "A",
      "x": 400,
      "y": 425,
      "exit": {
        "x": 440,
        "y": 445
      },
      "node": "A-door",
      "radius": 52
    },
    {
      "id": "B",
      "x": 560,
      "y": 310,
      "exit": {
        "x": 565,
        "y": 355
      },
      "node": "B-door",
      "radius": 52
    },
    {
      "id": "C",
      "x": 755,
      "y": 350,
      "exit": {
        "x": 748,
        "y": 395
      },
      "node": "C-door",
      "radius": 52
    },
    {
      "id": "D",
      "x": 895,
      "y": 450,
      "exit": {
        "x": 850,
        "y": 460
      },
      "node": "D-door",
      "radius": 52
    },
    {
      "id": "E",
      "x": 850,
      "y": 635,
      "exit": {
        "x": 812,
        "y": 610
      },
      "node": "E-door",
      "radius": 52
    },
    {
      "id": "T",
      "x": 405,
      "y": 610,
      "exit": {
        "x": 450,
        "y": 630
      },
      "node": "T-door",
      "radius": 56
    }
  ],
  "labels": {
    "F": [
      640,
      586
    ],
    "A": [
      240,
      270
    ],
    "B": [
      520,
      58
    ],
    "C": [
      855,
      65
    ],
    "D": [
      1100,
      492
    ],
    "E": [
      1015,
      753
    ],
    "T": [
      220,
      560
    ]
  }
};
