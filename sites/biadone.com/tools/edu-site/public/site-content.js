/* Publish only confirmed content. Empty fields stay out of the public page. */
window.BIADONE_EDU_CONTENT = {
  heroMedia: null,
  publishedCases: [
    {
      id: 'clover-home',
      evidenceType: 'public-page',
      approved: true,
      published: true,
      title: '클로버베이킹 · 클래스 소개와 예약 연결',
      purpose: '방문자가 클래스 메뉴와 공방 정보를 살펴보고, 원하는 지점의 예약 상품을 찾을 수 있도록 안내합니다.',
      problem: null,
      materials: ['공개된 클래스 메뉴와 지점 안내', '공개된 사진과 상세 정보, 지점별 예약 연결 주소'],
      work: [],
      result: "방문자가 클래스 메뉴와 공방 정보를 살펴보고, 원하는 지점의 예약 상품을 찾을 수 있도록 안내합니다. 공개된 클래스 메뉴와 지점 안내, 사진과 상세 정보, 지점별 예약 연결 주소를 담았습니다.\n\n메뉴·지점 정보와 가격 안내가 최신인지, 예약 링크가 올바른 상품으로 이어지는지를 운영자가 확인할 항목으로 정리합니다.",
      showDetails: false,
      humanReview: '메뉴·지점 정보가 최신인지, 가격 안내와 예약 링크가 올바른 상품으로 이어지는지 운영자가 확인할 항목을 정합니다.',
      learning: '고객이 확인할 정보와 다음 행동을 먼저 정하고, 페이지의 내용과 연결 경로를 직접 점검하는 관점을 배울 수 있습니다.',
      evidenceNote: null,
      media: {
        type: 'image',
        src: '/assets/images/clover-home-20261027.png',
        alt: '클로버베이킹의 클래스 선택과 공방 안내가 보이는 실제 공개 홈페이지',
        caption: null
      },
      url: 'https://clover.biadone.com/home/'
    }
  ],
  courses: [
    {
      id: 'intro',
      category: '무료 입문·체험',
      description: '실제 활용 방향을 살펴보고, 내 업무 하나와 가지고 있는 자료를 정리하는 시작점입니다.',
      status: 'preparing',
      title: null,
      audience: [],
      curriculum: [],
      materials: [],
      outcomes: [],
      format: null,
      duration: null,
      schedule: null,
      location: null,
      price: null,
      support: null,
      application: null
    },
    {
      id: 'online',
      category: '온라인 실무교육',
      description: '자기 업무에 AI를 적용하는 방법을 익히는 과정입니다. 수강 방식과 신청 일정은 확정 후 안내합니다.',
      status: 'preparing',
      title: null,
      audience: [],
      curriculum: [],
      materials: [],
      outcomes: [],
      format: null,
      duration: null,
      schedule: null,
      location: null,
      price: null,
      support: null,
      application: null
    },
    {
      id: 'offline',
      category: '오프라인 프로젝트 피드백 특강',
      description: '진행 중인 프로젝트에서 막힌 부분과 다음 작업을 함께 살펴보는 과정입니다. 참여 방식과 준비물은 확정 후 안내합니다.',
      status: 'preparing',
      title: null,
      audience: [],
      curriculum: [],
      materials: [],
      outcomes: [],
      format: null,
      duration: null,
      schedule: null,
      location: null,
      price: null,
      support: null,
      application: null
    }
  ],
  curriculumPlan: {
    "published": true,
    "title": "상세 커리큘럼",
    "summary": null,
    "tracks": [
      {
        "id": "foundation",
        "title": "기초 · 홍보 · 홈페이지",
        "modules": [
          {
            "id": "F",
            "group": "공통 기초",
            "title": "GPT한테 우리 사업 제대로 이해시키기",
            "duration": "2시간 × 1회",
            "output": "내 사업 전용 GPT + 요청 템플릿",
            "items": [
              "우리 사업 소개·상품·가격·고객 질문 정리하기",
              "GPT 프로젝트 또는 맞춤 GPT에 사업 자료 세팅하기",
              "브랜드 말투·답변 원칙·금지 표현 설정하기",
              "실무에 바로 쓰는 요청문 3개 만들어 저장하기",
              "실제 고객 질문으로 답변 정확도 테스트하기",
              "상품·가격 변경 시 사업 정보 직접 업데이트하기"
            ]
          },
          {
            "id": "A",
            "group": "선택 A",
            "title": "조회수 1만 회를 노리는 AI 홍보 콘텐츠 제작법",
            "duration": "2시간 × 2회 · 총 4시간",
            "output": "홍보 이미지·게시물 + 제작 템플릿",
            "items": [
              "조회수 높은 콘텐츠의 첫 3초 후킹 분석하기",
              "고객이 멈춰 보는 제목·썸네일 기획하기",
              "GPT로 릴스 대본·홍보 문구 만들기",
              "실제 상품 사진으로 AI 홍보 이미지 제작하기",
              "우리 브랜드의 색상·폰트·자막 템플릿 만들기",
              "짧은 영상의 자막·장면 구성 실습하기 (선택)",
              "게시 후 조회수·클릭·문의 반응 점검하기"
            ]
          },
          {
            "id": "B",
            "group": "선택 B",
            "title": "홈페이지 외주비 아끼고 AI로 직접 제작하기",
            "duration": "2시간 × 3회 · 총 6시간",
            "output": "공개 웹페이지 + 문의 연결",
            "items": [
              "고객이 3초 만에 이해하는 페이지 구조 기획하기",
              "AI 코딩 도구·웹 빌더로 홈페이지 뼈대 만들기",
              "사업 소개·가격·사진·후기·FAQ 넣기",
              "문의 폼·전화·기존 예약 링크 연결하기",
              "모바일에서 깨지는 화면 직접 고치기",
              "웹페이지 공개·검색 노출 기본 설정하기",
              "가격·사진·문구 수정하고 이전 상태 복구하기"
            ]
          },
          {
            "id": "S",
            "group": "전 과정 공통",
            "title": "구독료 폭탄 막고 정보 유출 예방하기",
            "duration": "모든 과정에 포함",
            "output": "비용·보안·복구 운영 체크리스트",
            "items": [
              "AI 구독료와 API 사용 요금 구분하기",
              "개인정보·사업 자료의 입력 범위 정하기",
              "계정·공유 권한·외부 도구 연결 관리하기",
              "작업 실패 시 실행 중지·복구·수동 처리하기",
              "구독·API·도메인·호스팅 비용 점검하기",
              "권한·비용·오류 대응 내용을 운영 카드로 정리하기"
            ]
          }
        ]
      },
      {
        "id": "expansion",
        "title": "자동화 · 분석 · AI 업무팀",
        "modules": [
          {
            "id": "C",
            "group": "선택 C",
            "title": "고객 문의가 오면 자동 정리·알림까지!",
            "duration": "2시간 × 3회 · 총 6시간",
            "output": "문의 폼 + 고객 관리표 + 자동 알림",
            "items": [
              "고객 문의를 빠짐없이 받는 접수 폼 만들기",
              "접수 내용을 관리표에 자동 저장하기",
              "문의 유형·담당자·처리 상태 구분하기",
              "FAQ를 활용해 답변 초안 빠르게 작성하기",
              "새 문의가 오면 담당자에게 자동 알림 보내기",
              "AI 문의 분류·요약 자동화 연결하기 (선택)",
              "중복 접수·오발송 방지와 수동 처리 익히기"
            ]
          },
          {
            "id": "D",
            "group": "선택 D",
            "title": "매출 엑셀 속에서 돈 되는 상품 찾아내기",
            "duration": "2시간 × 2회 · 총 4시간",
            "output": "매출 분석표 + 반복 보고 템플릿",
            "items": [
              "매출·정산 엑셀 파일을 한 번에 정리하기",
              "취소·중복·누락 데이터 걸러내기",
              "잘 팔리는 상품·요일·채널 찾아보기",
              "실제 정산금과 매출 숫자 대조하기",
              "리뷰에서 고객 불만·개선 포인트 찾기",
              "매주 재사용할 매출 보고서 양식 만들기"
            ]
          },
          {
            "id": "E",
            "group": "선택 E",
            "title": "매번 반복하는 일, 나만의 업무 앱으로 끝내기",
            "duration": "과제에 따라 편성",
            "output": "맞춤 계산기·작은 앱 1개",
            "items": [
              "반복되는 귀찮은 업무 한 가지 골라보기",
              "입력값·계산 규칙·처리 결과 정리하기",
              "AI 코딩 도구로 계산기·작은 업무 앱 만들기",
              "직접 사용할 입력 화면·결과 화면 구성하기",
              "빈칸·오입력·파일 오류 테스트하기",
              "가격·업무 규칙이 바뀌면 직접 수정하기"
            ]
          },
          {
            "id": "T",
            "group": "심화 과정",
            "title": "AI 직원 3명으로 내 사업 업무팀 만들기",
            "duration": "2시간 × 6회 · 총 12시간",
            "output": "역할별 AI 팀 + 승인·운영 체계",
            "items": [
              "일을 기획·제작·검수 역할로 나누기",
              "AI 직원마다 역할·작업 지침 세팅하기",
              "공통 사업 자료를 연결해 같은 기준으로 일시키기",
              "AI끼리 결과를 전달하는 업무 흐름 만들기",
              "실전 실습: 마케팅 기획 → 제작 → 검수",
              "사장님 승인 전 외부 발송을 막는 단계 만들기",
              "반복 실행·비용·오류·작업 기록 점검하기"
            ]
          }
        ]
      }
    ],
    "notes": []
  },
  introExperience: {
    status: 'preparing',
    title: null,
    description: null,
    steps: [],
    application: null
  },
  offlineGallery: {
    cover: null,
    practice: null,
    feedback: null,
    additional: []
  },
  faqs: [
    {
      question: 'AI나 코딩을 전혀 몰라도 따라갈 수 있나요?',
      answer: '네. 강사가 실제 화면을 보여주며 하나씩 설명합니다. 실습에 꼭 필요한 지식도 각 단계에서 함께 설명하므로, AI나 코딩을 처음 접하는 분도 따라오실 수 있습니다.',
      published: true
    },
    { question: '어떤 업무나 프로젝트를 가져오면 되나요?', answer: null, published: false },
    { question: '온라인 강의와 오프라인 특강은 어떻게 다른가요?', answer: null, published: false },
    { question: '오프라인 특강 전에 무엇을 준비해야 하나요?', answer: null, published: false },
    {
      question: '어떤 AI 도구를 사용하나요? 유료 결제가 필요한가요?',
      answer: '실습은 ChatGPT를 사용하며, ChatGPT Plus 이상의 유료 요금제 구독이 필요합니다. Plus 구독료는 월 약 3만 원 수준이며, 강의 수강료와 별도입니다.',
      published: true
    },
    {
      question: '실습하다 막히면 질문하거나 피드백을 받을 수 있나요?',
      answer: '질문과 피드백을 위한 Slack 공간을 개설할 예정입니다. 실습 중 막히는 부분이나 궁금한 점을 남기면 피드백을 받을 수 있습니다. 개별적인 도움이 필요하다면 1:1 코칭을 별도로 신청할 수 있습니다.',
      published: true
    },
    { question: '구현이 어려운 부분은 별도 도움을 받을 수 있나요?', answer: null, published: false },
    {
      question: '기관·단체 교육은 어떻게 문의하나요?',
      answer: '기관·단체 교육 문의에서 기관명, 교육 대상과 예상 인원, 희망 주제와 일정, 답변받을 이메일을 작성해 주세요. 작성한 내용으로 메일 앱이 열리며, 메일 앱에서 전송을 완료해야 합니다.',
      published: true
    }
  ]
};
