import Testing
@testable import BlabeeCoordinator

@Suite("Provider settings evidence", .petLanguage(.korean))
struct PetProviderSettingsTests {
    @Test("Existing ready Claude sessions are summarized without a launch attempt")
    func existingReadySessions() {
        let summary = PetClaudeSettingsSummary(
            sessions: [entry("one"), entry("two")],
            directoryVerified: true, serviceConnected: true
        )
        #expect(summary.tone == .confirmed)
        #expect(summary.title == "2개 세션 연결됨")
    }

    @Test("Directory connection alone is not a Claude readiness response")
    func connectionIsNotReadiness() {
        let pending = entry("pending", state: "connected", ready: false)
        let summary = PetClaudeSettingsSummary(
            sessions: [pending], directoryVerified: true, serviceConnected: true
        )
        #expect(summary.tone == .neutral)
        #expect(summary.title == "연결 응답 대기")
        #expect(!PetClaudeSessionSettingsStatus(
            session: pending, directoryVerified: true, serviceConnected: true
        ).isReady)
    }

    @Test("One ready session does not hide another session requiring attention")
    func partialConnection() {
        let summary = PetClaudeSettingsSummary(
            sessions: [entry("ready"), entry("retry", state: "required", ready: false),
                       entry("old", state: "disconnected"), entry("codex", provider: .codex)],
            directoryVerified: true, serviceConnected: true
        )
        #expect(summary.title == "1개 연결 · 1개 확인 필요")
        #expect(summary.tone == .actionNeeded)
    }

    @Test("Missing fresh service or directory evidence invalidates cached ready status",
          arguments: [(false, false), (true, false), (false, true)])
    func lostFreshEvidence(_ flags: (Bool, Bool)) {
        let (service, directory) = flags
        let current = entry("ready")
        #expect(PetClaudeSettingsSummary(
            sessions: [current], directoryVerified: directory, serviceConnected: service
        ).tone != .confirmed)
        #expect(!PetClaudeSessionSettingsStatus(
            session: current, directoryVerified: directory, serviceConnected: service
        ).isReady)
    }

    @Test("A status must match the exact Claude session and have no current diagnostic",
          arguments: ["scope", "session", "cwd", "provider", "diagnostic", "missing", "bridge"])
    func rejectsUnmatchedOrFailedStatus(_ mismatch: String) {
        let original = entry("current")
        let status = original.status!
        let modified = PetProviderInboxSession(
            session: original.session,
            status: mismatch == "missing" ? nil : PetProviderStatus(
                provider: mismatch == "provider" ? .codex : .claude,
                scopeID: mismatch == "scope" ? "other" : status.scopeID,
                sessionID: mismatch == "session" ? "other" : status.sessionID,
                cwd: mismatch == "cwd" ? "/projects/other" : status.cwd,
                bridgeConnected: mismatch != "bridge", ready: true,
                selectionEnabled: true, latestOutcome: nil
            ),
            diagnostic: mismatch == "diagnostic" ? "fixture connection unavailable" : nil
        )
        #expect(!PetClaudeSessionSettingsStatus(
            session: modified, directoryVerified: true, serviceConnected: true
        ).isReady)
        #expect(PetClaudeSettingsSummary(
            sessions: [modified], directoryVerified: true, serviceConnected: true
        ).tone != .confirmed)
    }

    @Test("A verified empty directory distinguishes no sessions from unknown installation")
    func emptyDirectory() {
        let summary = PetClaudeSettingsSummary(
            sessions: [entry("closed", state: "disconnected")],
            directoryVerified: true, serviceConnected: true
        )
        #expect(summary.title == "연결된 세션 없음")
        #expect(summary.tone == .neutral)
    }

    private func entry(
        _ suffix: String, state: String = "ready", ready: Bool = true,
        provider: PetProvider = .claude
    ) -> PetProviderInboxSession {
        let context = PetProviderContext(
            provider: provider, scopeID: "scope-\(suffix)", serviceIncarnation: "service-current",
            sessionIncarnation: "incarnation-\(suffix)", authorityEpoch: "epoch-\(suffix)", uiGeneration: 1
        )
        let session = PetProviderSession(
            id: "session-\(suffix)", context: context, projectID: "project-\(suffix)",
            sessionID: "session-\(suffix)", cwd: "/projects/\(suffix)", state: state,
            title: "Claude · \(suffix)"
        )
        let status = PetProviderStatus(
            provider: provider, scopeID: context.scopeID, sessionID: session.sessionID,
            cwd: session.cwd, bridgeConnected: true, ready: ready,
            selectionEnabled: ready, latestOutcome: nil
        )
        return PetProviderInboxSession(session: session, status: status, diagnostic: nil)
    }
}
