import type { ThreadStructure } from "@/components/extraction-monitor/threadStructureModel";

export const ATLAS_DEMO_STRUCTURE: ThreadStructure = {
  nodes: [
    {
      id: "demo-cli",
      label: "Codex CLI",
      description: "사용자가 계속 실행 중인 로컬 Codex CLI 세션",
      type: "entity",
      tone: "violet",
      mentions: 8,
      evidenceMessageIndexes: [97, 108],
      turnIds: [1, 2],
      source: "mixed",
      confidence: 0.98,
      status: "active",
      category: "tool",
      triggerPhrase: "내 codex cli 세션을 계속 모니터링",
      verificationStatus: "verified",
      x: 19,
      y: 49
    },
    {
      id: "demo-monitor",
      label: "세션 모니터링",
      description: "CLI 출력을 지속적으로 관찰하고 새 결과를 감지하는 작업",
      type: "action",
      tone: "amber",
      mentions: 4,
      evidenceMessageIndexes: [97, 114],
      turnIds: [1, 4],
      source: "llm",
      confidence: 0.94,
      status: "required",
      category: "workflow",
      triggerPhrase: "세션을 계속 모니터링하면서",
      verificationStatus: "verified",
      x: 38,
      y: 28
    },
    {
      id: "demo-kakao",
      label: "카카오톡",
      description: "추출 결과를 사용자에게 계속 전달하는 메시징 채널",
      type: "entity",
      tone: "teal",
      mentions: 6,
      evidenceMessageIndexes: [97, 108],
      turnIds: [1, 2],
      source: "mixed",
      confidence: 0.97,
      status: "selected",
      category: "channel",
      triggerPhrase: "카카오톡에 계속 뿌려줘야되는거야",
      verificationStatus: "verified",
      x: 59,
      y: 50
    },
    {
      id: "demo-relay",
      label: "중계 서버",
      description: "카카오톡과 로컬 에이전트 사이의 메시지를 전달하는 구성요소",
      type: "entity",
      tone: "violet",
      mentions: 3,
      evidenceMessageIndexes: [108, 114],
      turnIds: [2, 4],
      source: "llm",
      confidence: 0.91,
      status: "proposed",
      category: "architecture",
      triggerPhrase: "중계 서버와 Local Agent를 두는 방식",
      verificationStatus: "verified",
      x: 76,
      y: 29
    },
    {
      id: "demo-agent",
      label: "Local Agent",
      description:
        "로컬 환경에서 세션을 관찰하고 중계 서버로 이벤트를 전송하는 에이전트",
      type: "entity",
      tone: "blue",
      mentions: 3,
      evidenceMessageIndexes: [108, 109, 114],
      turnIds: [2, 3, 4],
      source: "llm",
      confidence: 0.93,
      status: "proposed",
      category: "architecture",
      triggerPhrase: "백그라운드 에이전트가 세션을 관찰",
      verificationStatus: "verified",
      x: 78,
      y: 70
    },
    {
      id: "demo-no-api",
      label: "API 미사용",
      description:
        "OpenAI API 호출 대신 사용자의 실제 CLI 세션을 관찰해야 한다는 제약",
      type: "content_constraint",
      tone: "rose",
      mentions: 2,
      evidenceMessageIndexes: [97],
      turnIds: [1],
      source: "rule",
      confidence: 0.99,
      status: "confirmed",
      category: "constraint",
      triggerPhrase: "api를 사용하는게 아니라",
      verificationStatus: "rule_only",
      x: 45,
      y: 73
    }
  ],
  links: [
    link("demo-cli", "demo-monitor", [97], [1], 4),
    link("demo-monitor", "demo-kakao", [97], [1], 4),
    link("demo-cli", "demo-kakao", [97, 108], [1, 2], 8),
    link("demo-kakao", "demo-relay", [108], [2], 4),
    link("demo-relay", "demo-agent", [108, 114], [2, 4], 8),
    link("demo-no-api", "demo-cli", [97], [1], 4),
    link("demo-no-api", "demo-relay", [], [1], 1)
  ],
  flow: [
    {
      id: "demo-flow-97",
      role: "user",
      turnId: 1,
      messageIndex: 97,
      title: "Turn 1 · 방식 정정",
      text: "API를 사용하는 게 아니라 내 Codex CLI 세션을 계속 모니터링하면서 받아오는 결과들을 카카오톡에 계속 전달해야 해.",
      tags: ["Codex CLI", "API 미사용", "카카오톡"],
      createdAt: null
    },
    {
      id: "demo-flow-108",
      role: "assistant",
      turnId: 2,
      messageIndex: 108,
      title: "Turn 2 · 구조 제안",
      text: "카카오톡과 로컬 Codex CLI 사이에 중계 서버와 Local Agent를 두는 방식으로 구성할 수 있습니다.",
      tags: ["중계 서버", "Local Agent"],
      createdAt: null
    },
    {
      id: "demo-flow-109",
      role: "user",
      turnId: 3,
      messageIndex: 109,
      title: "Turn 3 · 사용 조건 추가",
      text: "사용자에게 설치 과정이 복잡하면 안 되고, 한 번 연결하면 계속 동작해야 해.",
      tags: ["Local Agent", "간편 설치", "지속 실행"],
      createdAt: null
    },
    {
      id: "demo-flow-114",
      role: "assistant",
      turnId: 4,
      messageIndex: 114,
      title: "Turn 4 · 운영 흐름 구체화",
      text: "초기 인증 후 백그라운드 에이전트가 세션을 관찰하고 중계 서버로 새 이벤트를 전송하도록 설계하겠습니다.",
      tags: ["세션 모니터링", "Local Agent", "중계 서버"],
      createdAt: null
    }
  ]
};

function link(
  from: string,
  to: string,
  sharedMessageIndexes: number[],
  sharedTurnIds: number[],
  strength: number
) {
  return {
    id: `${from}:${to}`,
    from,
    to,
    strength,
    sharedMessageIndexes,
    sharedTurnIds
  };
}
