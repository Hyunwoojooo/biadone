/// Settings describe current session evidence independently of the last launch
/// attempt. An installed launcher or a directory row alone is not a ready ACK.
struct PetClaudeSettingsSummary: Equatable {
    let title: String
    let detail: String
    let tone: PetSettingsStatusTone

    init(
        sessions: [PetProviderInboxSession],
        directoryVerified: Bool,
        serviceConnected: Bool
    ) {
        guard serviceConnected, directoryVerified else {
            title = serviceConnected ? PetL10n.text("Not checked", korean: "확인 전") : PetL10n.text("Service connection required", korean: "서비스 연결 필요")
            detail = serviceConnected
                ? PetL10n.text("Refresh to check the current Claude connection.", korean: "새로고침하면 현재 Claude 연결 상태를 확인합니다.")
                : PetL10n.text("Connect to the shared Blabee service before checking Claude status.", korean: "Blabee 공통 서비스에 연결한 뒤 Claude 상태를 확인할 수 있습니다.")
            tone = serviceConnected ? .neutral : .actionNeeded
            return
        }
        let active = sessions.filter {
            $0.session.context.provider == .claude && $0.session.state != "disconnected"
        }
        guard !active.isEmpty else {
            title = PetL10n.text("No connected sessions", korean: "연결된 세션 없음")
            detail = PetL10n.text("Start a Claude connection to see its task cards together in arrival order.", korean: "Claude 연결을 시작하면 작업 카드가 도착한 순서대로 함께 표시됩니다.")
            tone = .neutral
            return
        }
        let statuses = active.map {
            PetClaudeSessionSettingsStatus(
                session: $0, directoryVerified: true, serviceConnected: true
            )
        }
        let readyCount = statuses.filter(\.isReady).count
        if readyCount == active.count {
            title = PetL10n.text("\(readyCount) sessions connected", korean: "\(readyCount)개 세션 연결됨")
            detail = PetL10n.text("Claude sessions responded to the connection check. Cards will appear when they arrive.", korean: "Claude 세션의 연결 응답을 확인했습니다. 카드가 도착하면 바로 확인할 수 있습니다.")
            tone = .confirmed
        } else if readyCount > 0 {
            title = PetL10n.text("\(readyCount) connected · \(active.count - readyCount) need attention", korean: "\(readyCount)개 연결 · \(active.count - readyCount)개 확인 필요")
            detail = PetL10n.text("Some Claude session connections need checking. Review each session in the Connection tab.", korean: "일부 Claude 세션의 연결을 확인해야 합니다. 연결 탭에서 각 세션을 확인해 주세요.")
            tone = .actionNeeded
        } else {
            title = statuses.allSatisfy { $0.tone == .neutral } ? PetL10n.text("Waiting for connection response", korean: "연결 응답 대기") : PetL10n.text("Connection check needed", korean: "연결 확인 필요")
            detail = PetL10n.text("Check opened Claude sessions in the Connection tab.", korean: "연결 탭에서 열린 Claude 세션의 상태를 확인할 수 있습니다.")
            tone = statuses.allSatisfy { $0.tone == .neutral } ? .neutral : .actionNeeded
        }
    }
}

struct PetClaudeSessionSettingsStatus: Equatable {
    let title: String
    let detail: String
    let tone: PetSettingsStatusTone
    let isReady: Bool

    init(
        session entry: PetProviderInboxSession,
        directoryVerified: Bool,
        serviceConnected: Bool
    ) {
        let session = entry.session
        guard serviceConnected, directoryVerified else {
            title = PetL10n.text("Not checked", korean: "확인 전")
            detail = PetL10n.text("Recheck current connection status.", korean: "현재 연결 상태를 다시 확인해 주세요.")
            tone = .neutral
            isReady = false
            return
        }
        guard session.context.provider == .claude, session.state != "disconnected" else {
            title = PetL10n.text("Connection ended", korean: "연결 종료됨")
            detail = PetL10n.text("You can start a new Claude connection.", korean: "새 Claude 연결을 시작할 수 있습니다.")
            tone = .neutral
            isReady = false
            return
        }
        if let diagnostic = entry.diagnostic {
            title = PetL10n.text("Connection check needed", korean: "연결 확인 필요")
            detail = diagnostic
            tone = .actionNeeded
            isReady = false
            return
        }
        guard let status = entry.status,
              status.provider == .claude,
              status.scopeID == session.context.scopeID,
              status.sessionID == session.sessionID,
              status.cwd == session.cwd else {
            title = PetL10n.text("Not checked", korean: "확인 전")
            detail = PetL10n.text("Check this Claude session's connection status.", korean: "이 Claude 세션의 연결 상태를 확인해 주세요.")
            tone = .actionNeeded
            isReady = false
            return
        }
        if status.bridgeConnected, status.ready, session.state == "ready" {
            title = PetL10n.text("Connected", korean: "연결됨")
            detail = PetL10n.text("This session responded to the connection check.", korean: "이 세션의 연결 응답을 확인했습니다.")
            tone = .confirmed
            isReady = true
        } else if session.state == "required" {
            title = PetL10n.text("Recheck connection", korean: "연결 재확인 필요")
            detail = PetL10n.text("Choose Check Connection to verify this Claude session's response.", korean: "연결 확인을 눌러 이 Claude 세션의 응답을 확인해 주세요.")
            tone = .actionNeeded
            isReady = false
        } else {
            title = PetL10n.text("Waiting for connection response", korean: "연결 응답 대기")
            detail = PetL10n.text("Review the connection check request in the opened Claude window.", korean: "열린 Claude 창에서 연결 확인 요청을 확인해 주세요.")
            tone = .neutral
            isReady = false
        }
    }
}
