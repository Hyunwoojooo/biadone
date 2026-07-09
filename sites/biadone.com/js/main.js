// ==========================================================================
// BiaDone — Personal Context OS — main interactions
// ==========================================================================

const LANGUAGE_STORAGE_KEY = 'biadone-language';

const KOREAN_COPY = {
  "BiaDone carries your context across conversations, calendars, documents, and decisions — then prepares the next action before you have to start from scratch.": "BiaDone은 대화, 캘린더, 문서, 결정의 맥락을 이어받아, 사용자가 처음부터 다시 정리하지 않아도 다음 행동을 준비합니다.",
  "Permissioned memory. Explainable preparation. User-controlled action.": "허용한 기억. 설명 가능한 준비. 사용자가 통제하는 실행.",
  "BiaDone turns everyday context into prepared momentum.": "BiaDone은 일상의 업무 맥락을 준비된 추진력으로 바꿉니다.",
  "Designed for meeting briefs, decision recall, action queues, and prepared replies.": "회의 브리프, 결정 회상, Action Queue, 답변 초안을 위해 설계되었습니다.",
  "Meeting briefs": "회의 브리프",
  "Decision recall": "결정 회상",
  "Action queues": "Action Queue",
  "Prepared replies": "준비된 답변",
  "Work resumption": "업무 재개",
  "Context search": "맥락 검색",
  "Permissioned memory": "허용 기반 메모리",
  "Done signals": "Done Signal",

  "The real cost is not the work. It is restarting the context.": "진짜 비용은 일이 아니라, 맥락을 다시 시작하는 데 있습니다.",
  "Every scattered decision becomes time you have to recover later.": "흩어진 결정은 나중에 다시 복구해야 하는 시간이 됩니다.",
  "A meeting ends. A decision disappears into chat. A task loses the reason behind it. A document lives in one tool, the deadline in another, and the next step in someone's memory.": "회의는 끝나고, 결정은 채팅 속에 묻힙니다. 업무는 그 이유를 잃고, 문서는 한 도구에, 마감일은 다른 도구에, 다음 단계는 누군가의 기억 속에 남습니다.",
  "BiaDone is built for the moments when you are forced to re-find, re-explain, re-organize, and re-start.": "BiaDone은 다시 찾고, 다시 설명하고, 다시 정리하고, 다시 시작해야 하는 순간을 줄이기 위해 만들어졌습니다.",
  "Re-explaining": "다시 설명하기",
  "The same background gets repeated across meetings, messages, and tools.": "같은 배경 설명이 회의, 메시지, 도구 사이에서 반복됩니다.",
  "Re-finding": "다시 찾기",
  "Decisions, links, files, and reasons scatter across your workflow.": "결정, 링크, 파일, 이유가 업무 흐름 곳곳에 흩어집니다.",
  "Re-organizing": "다시 정리하기",
  "Meeting notes become stale before the next action is clear.": "다음 행동이 명확해지기 전에 회의록은 금방 낡아집니다.",
  "Re-starting": "다시 시작하기",
  "Returning to a project means rebuilding the mental state from scratch.": "프로젝트로 돌아온다는 것은 머릿속 상태를 처음부터 다시 만드는 일이 됩니다.",
  "Re-deciding": "다시 판단하기",
  "Without context, every next step becomes another judgment call.": "맥락이 없으면 모든 다음 단계가 또 하나의 판단 문제가 됩니다.",

  "What is BiaDone?": "BiaDone은 무엇인가요?",
  "A Personal Context OS for carrying work forward.": "일의 맥락을 다음 행동까지 이어주는 Personal Context OS.",
  "BiaDone connects the context behind your work — conversations, calendars, documents, decisions, and workflows — into a memory layer that can be recalled, prepared, confirmed, and completed.": "BiaDone은 대화, 캘린더, 문서, 결정, 워크플로우 뒤에 있는 업무 맥락을 다시 불러오고, 준비하고, 확인하고, 완료할 수 있는 메모리 레이어로 연결합니다.",
  "It does not wait for you to rebuild the story. It prepares the next step from the context you choose to keep.": "사용자가 흐름을 처음부터 다시 설명할 때까지 기다리지 않습니다. 사용자가 보관하기로 한 맥락에서 다음 단계를 준비합니다.",
  "The connected background behind a decision, task, meeting, or workflow.": "결정, 업무, 회의, 워크플로우 뒤에 연결되어 있는 배경 맥락입니다.",
  "The permissioned record of what should be available again later.": "나중에 다시 사용할 수 있도록 허용을 거쳐 남겨두는 기록입니다.",
  "Finding the right past decision, source, or thread at the right moment.": "필요한 순간에 맞는 과거 결정, 출처, 대화 흐름을 찾아오는 일입니다.",
  "Turning context into a brief, reply, queue, or next action.": "맥락을 브리프, 답변, 큐, 다음 행동으로 바꾸는 과정입니다.",
  "Asking before important memory, sharing, sending, scheduling, or updates.": "중요한 기억, 공유, 전송, 일정 등록, 업데이트 전에 확인을 요청합니다.",
  "Showing what is prepared, what needs review, and what has been completed.": "무엇이 준비됐고, 무엇이 검토가 필요하며, 무엇이 완료됐는지 보여줍니다.",

  "From scattered input to prepared action.": "흩어진 입력에서 준비된 행동까지.",
  "BiaDone captures selected context, structures it into memory, recalls what matters, prepares the next step, and asks for confirmation before important action.": "BiaDone은 선택된 맥락을 수집하고 메모리로 구조화한 뒤, 중요한 내용을 불러오고 다음 단계를 준비하며, 중요한 행동 전에는 확인을 요청합니다.",
  "Selected conversations, documents, calendar events, and workflow signals are collected.": "선택한 대화, 문서, 캘린더 일정, 업무 흐름 신호를 모읍니다.",
  "Scattered inputs become a structured context unit.": "흩어진 입력을 구조화된 맥락 단위로 바꿉니다.",
  "Important context is saved with permission.": "중요한 맥락은 허용을 거쳐 저장됩니다.",
  "Relevant past decisions, sources, and threads are retrieved.": "관련 있는 과거 결정, 출처, 대화 흐름을 다시 가져옵니다.",
  "The next action, brief, reply, or task queue is prepared.": "다음 행동, 브리프, 답변, 작업 큐를 준비합니다.",
  "Important actions are reviewed before they happen.": "중요한 행동은 실행되기 전에 검토됩니다.",
  "Prepared, confirmed, and completed states become visible.": "준비됨, 확인됨, 완료됨 상태가 보이게 됩니다.",
  "\"BiaDone does not just answer a question. It keeps the operating context alive until the next action is ready.\"": "\"BiaDone은 질문에 답하는 데서 끝나지 않습니다. 다음 행동이 준비될 때까지 업무 맥락을 살아 있게 유지합니다.\"",

  "Time Is Value. Start by recovering the time lost to context switching.": "Time Is Value. 맥락 전환으로 잃는 시간부터 되찾으세요.",
  "T.I.V is BiaDone's first product. It turns conversations and work sessions into Context Packs, Decision Logs, and Action Queues — so you can return to work with the next step already prepared.": "T.I.V는 BiaDone의 첫 번째 제품입니다. 대화와 업무 세션을 Context Pack, Decision Log, Action Queue로 바꿔, 다음 단계가 준비된 상태로 다시 업무에 돌아오게 합니다.",
  "Connect context": "맥락 연결",
  "Bring in selected meetings, documents, calendars, and conversations.": "선택한 회의, 문서, 캘린더, 대화를 가져옵니다.",
  "Choose what BiaDone can remember.": "BiaDone이 기억할 수 있는 대상을 사용자가 정합니다.",
  "Review the Context Pack": "Context Pack 검토",
  "See decisions, sources, and open loops organized in one place.": "결정, 출처, 아직 열린 항목을 한곳에서 정리된 상태로 봅니다.",
  "Edit or delete anything.": "필요한 것은 수정하거나 삭제할 수 있습니다.",
  "Confirm the next action": "다음 행동 확인",
  "Approve prepared briefs, replies, reminders, or action queues.": "준비된 브리프, 답변, 리마인더, Action Queue를 승인합니다.",
  "Nothing important happens without review.": "중요한 일은 검토 없이 실행되지 않습니다.",
  "Move forward": "앞으로 진행",
  "Start from the prepared state instead of rebuilding the context.": "맥락을 다시 만드는 대신 준비된 상태에서 시작합니다.",

  "Product Experiences": "제품 경험",
  "The building blocks that turn context into momentum.": "맥락을 추진력으로 바꾸는 구성 요소.",
  "Each experience shows what was prepared, where it came from, and what still needs your confirmation.": "각 경험은 무엇이 준비됐고, 어디에서 왔으며, 무엇이 아직 확인을 기다리는지 보여줍니다.",
  "A structured bundle of the conversations, documents, decisions, links, and tasks behind a workflow.": "워크플로우 뒤에 있는 대화, 문서, 결정, 링크, 작업을 구조화한 묶음입니다.",
  "Prepared from": "준비 출처",
  "Planning call · Roadmap doc · Project brief": "기획 통화 · 로드맵 문서 · 프로젝트 브리프",
  "User control": "사용자 통제",
  "Edit sources, remove items, or choose not to remember this context.": "출처를 수정하고, 항목을 제거하거나, 이 맥락을 기억하지 않도록 선택할 수 있습니다.",
  "Status": "상태",
  "Context Pack ready.": "Context Pack 준비 완료.",
  "A clear record of what was decided, when it was decided, and why it matters.": "무엇이 언제 결정됐고 왜 중요한지 보여주는 명확한 기록입니다.",
  "Planning call · Roadmap doc · Team thread": "기획 통화 · 로드맵 문서 · 팀 스레드",
  "Confirm, edit, or dismiss any recorded decision.": "기록된 결정을 확인, 수정, 제외할 수 있습니다.",
  "3 decisions confirmed. 1 needs review.": "결정 3개 확인 완료. 1개 검토 필요.",
  "A prepared list of what needs to happen next, connected to the context behind each action.": "각 행동의 배경 맥락과 연결된 다음 할 일 목록입니다.",
  "Decision Log · Open tasks · Calendar deadlines": "Decision Log · 열린 작업 · 캘린더 마감일",
  "Reorder, dismiss, or confirm each action before it moves forward.": "각 행동을 진행하기 전에 순서를 바꾸거나 제외하거나 확인할 수 있습니다.",
  "Action Queue ready.": "Action Queue 준비 완료.",
  "A concise preparation layer before a meeting, reply, handoff, or work session.": "회의, 답변, 인수인계, 업무 세션 전에 필요한 핵심 준비 레이어입니다.",
  "Calendar event · Project doc · Last Decision Log": "캘린더 일정 · 프로젝트 문서 · 최근 Decision Log",
  "Review and edit before the session starts.": "세션이 시작되기 전에 검토하고 수정할 수 있습니다.",
  "Brief ready for review.": "Brief 검토 준비 완료.",
  "A quiet signal that something relevant needs attention now.": "지금 주의해야 할 관련 항목을 조용히 알려주는 신호입니다.",
  "Upcoming deadline · Related decision · Open thread": "다가오는 마감 · 관련 결정 · 열린 스레드",
  "Snooze, dismiss, or act on it.": "나중으로 미루거나, 제외하거나, 바로 처리할 수 있습니다.",
  "Cue active.": "Cue 활성화됨.",
  "A visible state showing what is ready, what needs confirmation, and what has been completed.": "무엇이 준비됐고, 무엇이 확인이 필요하며, 무엇이 완료됐는지 보여주는 상태입니다.",
  "Action Queue · Confirmations · Completed items": "Action Queue · 확인 항목 · 완료 항목",
  "Review what changed and why at any time.": "언제든 무엇이 왜 바뀌었는지 검토할 수 있습니다.",
  "Done Signal: Ready.": "Done Signal: 준비 완료.",

  "Built for high-context work": "맥락이 많은 일을 위해",
  "When the thread breaks, BiaDone keeps the next step ready.": "흐름이 끊겨도 BiaDone은 다음 단계를 준비해 둡니다.",
  "Founders": "창업자",
  "Operators": "운영 담당자",
  "Product Managers": "프로덕트 매니저",
  "Team Leads": "팀 리드",
  "Knowledge Workers": "지식 노동자",
  "AI Power Users": "AI 고급 사용자",
  "After a meeting": "회의 후",
  "Turn decisions, owners, rationale, and follow-ups into a prepared Action Queue.": "결정, 담당자, 이유, 후속 조치를 준비된 Action Queue로 바꿉니다.",
  "Before a meeting": "회의 전",
  "Receive a Brief with relevant history, open questions, and decisions to revisit.": "관련 히스토리, 열린 질문, 다시 볼 결정을 담은 Brief를 받습니다.",
  "When resuming work": "업무를 다시 시작할 때",
  "Return to the last meaningful context instead of reconstructing the project state manually.": "프로젝트 상태를 수동으로 다시 만들지 않고 마지막으로 의미 있던 맥락으로 돌아갑니다.",
  "When replying": "답변할 때",
  "Prepare a response draft with the right background and require confirmation before sending.": "맞는 배경 맥락으로 답변 초안을 준비하고, 전송 전 확인을 요구합니다.",
  "When searching history": "히스토리를 찾을 때",
  "Recall the decision, source, and rationale behind a task, document, or project.": "작업, 문서, 프로젝트 뒤에 있는 결정, 출처, 이유를 다시 불러옵니다.",
  "When the day starts": "하루를 시작할 때",
  "See what matters today based on calendar events, open loops, and recent context.": "캘린더 일정, 열린 항목, 최근 맥락을 바탕으로 오늘 중요한 것을 확인합니다.",

  "Trust by design": "설계 단계부터 신뢰",
  "Prepared does not mean automatic. You stay in control.": "준비된다는 것은 자동 실행을 뜻하지 않습니다. 통제권은 사용자에게 있습니다.",
  "BiaDone is designed around permissioned memory, explainable preparation, and controlled action. You choose what can be remembered, you can see why something was prepared, and important actions wait for your confirmation.": "BiaDone은 허용 기반 메모리, 설명 가능한 준비, 통제된 실행을 중심으로 설계됩니다. 사용자는 무엇을 기억할지 선택하고, 왜 준비됐는지 확인하며, 중요한 행동은 사용자의 확인을 기다립니다.",
  "Permissioned Memory": "허용 기반 메모리",
  "Choose what BiaDone can remember, what it should ignore, and what should be deleted at any time.": "BiaDone이 무엇을 기억하고, 무엇을 무시하며, 언제 무엇을 삭제할지 사용자가 정합니다.",
  "Explainable Preparation": "설명 가능한 준비",
  "See exactly which sources and reasons led to a prepared brief, reply, or queue.": "준비된 브리프, 답변, 큐가 어떤 출처와 이유에서 나왔는지 확인할 수 있습니다.",
  "Controlled Action": "통제된 실행",
  "Sending, sharing, scheduling, or updating requires your confirmation before it happens.": "전송, 공유, 일정 등록, 업데이트는 실행 전에 사용자의 확인을 요구합니다.",
  "Easy Forgetting": "쉬운 삭제",
  "Exclude a source or delete a memory in the same place you review it.": "검토하는 곳에서 바로 출처를 제외하거나 메모리를 삭제할 수 있습니다.",
  "Quiet Signals": "조용한 신호",
  "Get useful cues without turning your workflow into an alert feed.": "업무 흐름을 알림 피드로 만들지 않으면서 필요한 신호만 받습니다.",
  "Visible Time Value": "보이는 시간 가치",
  "Understand where BiaDone saved time by reducing re-finding, re-explaining, and re-starting.": "다시 찾기, 다시 설명하기, 다시 시작하기를 줄여 어디에서 시간이 절약됐는지 확인합니다.",
  "This brief was prepared from:": "이 Brief는 다음에서 준비됐습니다:",
  "Calendar event": "캘린더 일정",
  "Project document": "프로젝트 문서",
  "Last meeting's Decision Log": "지난 회의의 Decision Log",
  "Why it was prepared": "준비된 이유",
  "You have a related meeting starting today and two unresolved action items from the last discussion.": "오늘 관련 회의가 시작되고, 지난 논의에서 해결되지 않은 액션 아이템이 두 개 남아 있습니다.",
  "Action required: Review before sending.": "필요한 행동: 전송 전 검토하세요.",
  "Remember this context": "이 맥락 기억하기",
  "Exclude this source": "이 출처 제외",
  "Delete this memory": "이 메모리 삭제",
  "Confirm & Send": "확인 후 전송",
  "Not now": "나중에",

  "Planned and beta integrations": "예정 및 베타 연동",
  "Designed to work across the tools where context lives.": "맥락이 존재하는 도구 전반에서 작동하도록 설계되었습니다.",
  "BiaDone is being built to connect with the places where work context already lives — meetings, calendars, documents, conversations, tasks, and AI tools. Availability may vary during beta.": "BiaDone은 업무 맥락이 이미 존재하는 회의, 캘린더, 문서, 대화, 작업, AI 도구와 연결되도록 만들어지고 있습니다. 베타 기간에는 제공 범위가 달라질 수 있습니다.",
  "Planned": "예정",
  "Meetings": "회의",
  "Calendar": "캘린더",
  "Documents": "문서",
  "Conversations": "대화",
  "Tasks": "작업",
  "AI Tools": "AI 도구",
  "ChatGPT, Claude, Cursor, Copilot via context handoff": "맥락 핸드오프를 통한 ChatGPT, Claude, Cursor, Copilot",
  "Some integrations may be planned, limited, or available only during selected beta programs.": "일부 연동은 예정 단계이거나 제한적으로 제공되며, 선택된 베타 프로그램에서만 사용할 수 있습니다.",

  "Why we are building BiaDone": "BiaDone을 만드는 이유",
  "People should not have to start from zero every time context changes.": "맥락이 바뀔 때마다 사람은 처음부터 다시 시작할 필요가 없어야 합니다.",
  "Modern work is not short on tools. It is short on continuity.": "현대의 일에는 도구가 부족하지 않습니다. 부족한 것은 연속성입니다.",
  "Every day, people lose time rebuilding the same background, searching for the same decision, and translating scattered information into the next action.": "사람들은 매일 같은 배경을 다시 만들고, 같은 결정을 다시 찾고, 흩어진 정보를 다음 행동으로 바꾸느라 시간을 잃습니다.",
  "BiaDone exists to make context continuous. We are building a Personal Context OS that remembers what matters with permission, prepares what comes next, and keeps people moving forward without taking control away from them.": "BiaDone은 맥락을 연속적으로 만들기 위해 존재합니다. 우리는 허용을 바탕으로 중요한 것을 기억하고, 다음에 올 일을 준비하며, 통제권을 빼앗지 않고 사람들이 앞으로 나아가게 하는 Personal Context OS를 만들고 있습니다.",

  "Join the beta and experience BiaDone's first step toward a Personal Context OS: turning scattered context into prepared next action.": "베타에 참여해 흩어진 맥락을 준비된 다음 행동으로 바꾸는 BiaDone의 첫 번째 Personal Context OS 경험을 만나보세요.",
  "Built for people and teams who lose too much time rebuilding context.": "맥락을 다시 만드는 데 너무 많은 시간을 쓰는 사람과 팀을 위해 만들었습니다.",
  "Work email": "업무용 이메일"
};

const META_COPY = {
  en: {
    description: 'BiaDone is a Personal Context OS that carries conversations, calendars, documents, decisions, and workflows forward into prepared next actions. Start with T.I.V by BiaDone.',
    ogDescription: 'Your context, carried forward. Your next action, prepared. Meet BiaDone, the Personal Context OS behind T.I.V.'
  },
  ko: {
    description: 'BiaDone은 대화, 캘린더, 문서, 결정, 워크플로우의 맥락을 이어받아 다음 행동을 준비하는 Personal Context OS입니다. T.I.V에서 시작하세요.',
    ogDescription: '맥락은 이어지고, 다음 행동은 준비됩니다. T.I.V 뒤에 있는 Personal Context OS, BiaDone을 만나보세요.'
  }
};

const FORM_STATUS_COPY = {
  en: (email) => `Thanks — we'll reach out to ${email} when the T.I.V beta opens.`,
  ko: (email) => `감사합니다. T.I.V beta가 열리면 ${email}로 연락드리겠습니다.`
};

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------- Language toggle ---------------- */
  const langButtons = document.querySelectorAll('[data-lang-option]');
  const textNodes = [];
  let currentLanguage = 'en';

  const getStoredLanguage = () => {
    try {
      return localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  };

  const setStoredLanguage = (language) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      // Language switching still works for the current page when storage is unavailable.
    }
  };

  const preferredLanguage = () => {
    const stored = getStoredLanguage();
    if (stored === 'ko' || stored === 'en') return stored;
    return navigator.language && navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  };

  const preserveWhitespace = (original, replacement) => {
    const leading = original.match(/^\s*/)[0];
    const trailing = original.match(/\s*$/)[0];
    return `${leading}${replacement}${trailing}`;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }

      return KOREAN_COPY[node.nodeValue.trim()]
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  let node = walker.nextNode();
  while (node) {
    textNodes.push({ node, original: node.nodeValue });
    node = walker.nextNode();
  }

  const updateMetaCopy = (language) => {
    const description = document.querySelector('meta[name="description"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const copy = META_COPY[language];

    if (description) description.setAttribute('content', copy.description);
    if (ogDescription) ogDescription.setAttribute('content', copy.ogDescription);
  };

  const applyLanguage = (language, shouldStore = true) => {
    currentLanguage = language === 'ko' ? 'ko' : 'en';
    document.documentElement.lang = currentLanguage;

    textNodes.forEach(({ node: textNode, original }) => {
      const source = original.trim();
      const nextText = currentLanguage === 'ko' ? KOREAN_COPY[source] : source;
      textNode.nodeValue = preserveWhitespace(original, nextText);
    });

    langButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.langOption === currentLanguage));
    });

    updateMetaCopy(currentLanguage);

    if (shouldStore) {
      setStoredLanguage(currentLanguage);
    }
  };

  langButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyLanguage(button.dataset.langOption);
    });
  });

  applyLanguage(preferredLanguage(), false);

  /* ---------------- Mobile menu ---------------- */
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      const isOpen = !mobileMenu.hasAttribute('hidden');
      if (isOpen) {
        mobileMenu.setAttribute('hidden', '');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      } else {
        mobileMenu.removeAttribute('hidden');
        menuToggle.setAttribute('aria-expanded', 'true');
        menuToggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      }
    });

    // Close mobile menu when a link is clicked
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.setAttribute('hidden', '');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      });
    });
  }

  /* ---------------- Sticky nav shadow on scroll ---------------- */
  const header = document.getElementById('site-header');
  const onScroll = () => {
    if (window.scrollY > 8) {
      header.style.boxShadow = '0 4px 24px rgba(15,23,42,0.08)';
    } else {
      header.style.boxShadow = 'none';
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- Reveal-on-scroll ---------------- */
  const revealTargets = document.querySelectorAll(
    '.problem-card, .definition-card, .step-card, .pe-card, .usecase-card, .eco-card, .trust-principle'
  );
  revealTargets.forEach(el => el.classList.add('reveal'));

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealTargets.forEach(el => observer.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  }

  /* ---------------- Beta waitlist form (client-side only) ---------------- */
  const betaForm = document.getElementById('tiv-form');
  const betaStatus = document.getElementById('beta-form-status');

  if (betaForm) {
    betaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('beta-email');
      const email = emailInput.value.trim();
      if (!email) return;

      betaStatus.textContent = FORM_STATUS_COPY[currentLanguage](email);
      betaForm.reset();
    });
  }

});
