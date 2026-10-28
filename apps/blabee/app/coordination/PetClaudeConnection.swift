import Combine
import Foundation

/// The settings flow owns no credentials and sends no readiness ACK. It watches
/// the normal provider snapshots for the exact new conversation it requested.
@MainActor
final class PetClaudeConnectionController: ObservableObject {
    struct ServiceIdentity: Equatable, Sendable {
        let generation: UInt64
        let incarnation: String
    }

    enum Phase: Equatable {
        case idle, configuring, preparingService, openingTerminal
        case waitingForSession, waitingForAcknowledgement, needsSelection, needsProbe
        case connected, unavailable, disconnected
        case failed(String)

        var title: String {
            switch self {
            case .idle: PetL10n.text("Not connected", korean: "연결 전")
            case .configuring: PetL10n.text("Checking your environment", korean: "사용 환경 확인 중")
            case .preparingService: PetL10n.text("Preparing the Blabee service", korean: "Blabee 서비스 준비 중")
            case .openingTerminal: PetL10n.text("Opening a Claude window", korean: "Claude 창 여는 중")
            case .waitingForSession: PetL10n.text("Waiting for Claude to start", korean: "Claude 시작 기다리는 중")
            case .waitingForAcknowledgement: PetL10n.text("Waiting for Claude's connection response", korean: "Claude 연결 응답 기다리는 중")
            case .needsSelection: PetL10n.text("Check the connected Claude session", korean: "연결한 Claude 세션 확인 필요")
            case .needsProbe: PetL10n.text("Recheck the Claude connection", korean: "Claude 연결 재확인 필요")
            case .connected: PetL10n.text("Claude connection verified", korean: "Claude 연결 확인 완료")
            case .unavailable: PetL10n.text("Checking current connection status", korean: "현재 연결 상태 확인 중")
            case .disconnected: PetL10n.text("Claude session ended", korean: "Claude 세션 종료됨")
            case .failed: PetL10n.text("Check the Claude connection", korean: "Claude 연결 확인 필요")
            }
        }
    }

    struct Failure: Error, LocalizedError {
        let detail: String
        var reason: PetConnectionDiagnostic.Reason? = nil
        var errorDescription: String? { detail }
    }

    private struct Binding: Equatable {
        let scope: String, sessionIncarnation: String, epoch: String?
        let project: String, session: String
        init(_ row: PetProviderSession) {
            scope = row.context.scopeID; sessionIncarnation = row.context.sessionIncarnation
            epoch = row.context.authorityEpoch; project = row.projectID; session = row.sessionID
        }
    }

    private struct Attempt {
        let id: UUID
        let service: ServiceIdentity
        let receipt: PetClaudeLauncher.LaunchReceipt
        var binding: Binding?
        var selectionRequested = false
        var errorContext: PetErrorContext?
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var inspection: ClaudeAutoConnectSetup.Inspection?
    @Published private(set) var isWorking = false
    @Published private(set) var delayed = false
    @Published private(set) var launchUnconfirmed = false
    @Published private(set) var matchedSession: PetProviderSession?
    weak var errorDiagnostics: PetErrorDiagnostics?
    private var operationID: UUID?
    private var setupOperationID: UUID?
    private var attempt: Attempt?
    private var waitNotice: Task<Void, Never>?
    private let inspectSetup: @Sendable () async -> ClaudeAutoConnectSetup.Inspection
    private let enableSetup: @Sendable () async -> ClaudeAutoConnectSetup.Inspection
    private let disableSetup: @Sendable () async -> ClaudeAutoConnectSetup.Inspection
    private let waitNoticeNanoseconds: UInt64

    convenience init(setup: ClaudeAutoConnectSetup = .live()) {
        self.init(inspect: { await setup.inspect() }, enable: { await setup.enable() },
                  disable: { await setup.disable() })
    }

    init(inspect: @escaping @Sendable () async -> ClaudeAutoConnectSetup.Inspection,
         enable: @escaping @Sendable () async -> ClaudeAutoConnectSetup.Inspection,
         disable: @escaping @Sendable () async -> ClaudeAutoConnectSetup.Inspection,
         waitNoticeNanoseconds: UInt64 = 60_000_000_000) {
        inspectSetup = inspect; enableSetup = enable; disableSetup = disable
        self.waitNoticeNanoseconds = waitNoticeNanoseconds
    }

    deinit { waitNotice?.cancel() }

    var isWaiting: Bool {
        [.waitingForSession, .waitingForAcknowledgement, .unavailable].contains(phase)
    }
    var canStart: Bool { !isWorking && (!isWaiting || delayed) }
    var detail: String {
        switch phase {
        case .idle:
            PetL10n.text("Choose a working folder to open a new connected Claude window. Blabee will prepare the settings.", korean: "작업 폴더를 선택하면 연결된 새 Claude 창을 엽니다. 필요한 설정은 Blabee가 준비합니다.")
        case .configuring:
            PetL10n.text("Checking the Claude installation and terminal auto-connect settings.", korean: "Claude 설치 위치와 터미널 자동 연결 설정을 확인하고 있습니다.")
        case .preparingService:
            PetL10n.text("Waiting for the service connection. Review any access request from macOS.", korean: "서비스 연결을 기다리고 있습니다. macOS에서 접근을 요청하면 확인해 주세요.")
        case .openingTerminal:
            PetL10n.text("Requesting a new terminal window. Review any app-control request from macOS.", korean: "터미널의 새 창을 요청하고 있습니다. macOS의 앱 제어 요청이 나오면 확인해 주세요.")
        case .waitingForSession:
            PetL10n.text("Check the opened Claude window for sign-in, project trust, and MCP connection approval requests. Blabee will check the connection.", korean: "열린 Claude 창에서 로그인·프로젝트 신뢰·MCP 연결 승인 요청을 확인해 주세요. Blabee가 연결 상태를 확인합니다.")
        case .waitingForAcknowledgement:
            PetL10n.text("A connection check was sent to Claude. Respond in the opened Claude window to complete it.", korean: "Claude에 연결 확인 메시지를 보냈습니다. 열린 Claude 창에서 응답하면 완료됩니다.")
        case .needsSelection:
            PetL10n.text("Another task is selected. Choose View Connected Session to check this Claude connection.", korean: "다른 작업이 선택되어 있습니다. ‘연결한 세션 보기’를 누르면 이 Claude의 연결을 확인합니다.")
        case .needsProbe:
            PetL10n.text("The connection check timed out. Choose Recheck Connection to send a check to the same Claude session.", korean: "연결 확인 시간이 지났습니다. ‘연결 다시 확인’을 눌러 같은 Claude 세션에 확인 메시지를 보낼 수 있습니다.")
        case .connected:
            PetL10n.text("This Claude session responded to the connection check. Ask Claude for a task to start using Blabee.", korean: "이 Claude 세션에서 연결 확인 응답을 받았습니다. Claude에 작업을 요청하면 Blabee를 사용할 수 있습니다.")
        case .unavailable:
            PetL10n.text("Rechecking the service or session. The connection cannot yet be confirmed.", korean: "서비스 또는 세션 상태를 다시 확인하고 있습니다. 현재는 연결 완료로 확인할 수 없습니다.")
        case .disconnected:
            PetL10n.text("Start a new Claude connection. Previous tasks will not run again automatically.", korean: "새 Claude 연결을 시작해 주세요. 이전 작업은 자동으로 다시 실행하지 않습니다.")
        case .failed(let detail): detail
        }
    }

    func refresh() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        let context = errorDiagnostics?.captureContext()
        inspection = await inspectSetup()
        if let inspection { record(.claude(inspection, stage: .inspection), context: context) }
    }

    /// Prepares future ordinary CLI launches without opening a terminal or
    /// changing the readiness of an existing launch attempt. The caller can
    /// offer a direct launch when automatic setup is unavailable.
    func configureAutomaticConnection() async throws -> ClaudeAutoConnectSetup.Inspection {
        try Task.checkCancellation()
        let context = errorDiagnostics?.captureContext()
        guard !isWorking else {
            throw Failure(detail: PetL10n.text("Checking Claude connection settings. Please try again shortly.", korean: "Claude 연결 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요."))
        }
        let operation = UUID()
        setupOperationID = operation
        isWorking = true
        defer {
            if setupOperationID == operation {
                setupOperationID = nil
                isWorking = false
            }
        }
        let initial = await inspectSetup()
        try requireActiveSetup(operation)
        if initial.automaticConnectionReady || !initial.canEnable {
            inspection = initial
            record(.claude(initial, stage: .configuration), context: context)
            return initial
        }
        _ = await enableSetup()
        try requireActiveSetup(operation)
        // A writer's response alone is not the current saved configuration:
        // re-read after a possible partial write or concurrent external edit.
        let verified = await inspectSetup()
        try requireActiveSetup(operation)
        inspection = verified
        record(.claude(verified, stage: .configuration), context: context)
        return verified
    }

    private func requireActiveSetup(_ operation: UUID) throws {
        try Task.checkCancellation()
        guard setupOperationID == operation else { throw CancellationError() }
    }

    func disableAutomaticConnection() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        inspection = await disableSetup()
        // Existing terminal sessions and their readiness are unaffected.
    }

    func connect(
        terminal: ClaudeInstalledLauncher.TerminalApplication,
        prepareService: @MainActor () async throws -> ServiceIdentity,
        launch: @MainActor (UUID, ClaudeInstalledLauncher.TerminalApplication) async throws -> PetClaudeLauncher.LaunchReceipt?
    ) async {
        guard canStart else { return }
        let errorContext = errorDiagnostics?.captureContext()
        let operation = UUID()
        operationID = operation
        waitNotice?.cancel(); waitNotice = nil; attempt = nil; matchedSession = nil
        delayed = false; launchUnconfirmed = false
        isWorking = true; phase = .configuring
        defer { if operationID == operation { isWorking = false } }
        do {
            var inspected = await inspectSetup()
            guard operationID == operation, !Task.isCancelled else { return }
            if !inspected.automaticConnectionReady, inspected.canEnable {
                inspected = await enableSetup()
                guard operationID == operation, !Task.isCancelled else { return }
            }
            inspection = inspected
            guard inspected.canLaunch else { throw Failure(detail: inspected.detail) }
            // Unsupported/custom shells may still open a connected session
            // directly. The separate setup status never promises CLI coverage.
            phase = .preparingService
            let service = try await prepareService()
            guard operationID == operation, !Task.isCancelled else { return }
            phase = .openingTerminal
            let nativeID = UUID()
            do {
                guard let receipt = try await launch(nativeID, terminal) else {
                    phase = .idle
                    return
                }
                guard operationID == operation, !Task.isCancelled else { return }
                try watch(receipt, requestedID: nativeID, service: service, operation: operation, errorContext: errorContext)
            } catch let error as PetClaudeLauncher.ConnectionLaunchUnconfirmed {
                guard operationID == operation, !Task.isCancelled else { return }
                try watch(error.receipt, requestedID: nativeID, service: service, operation: operation, errorContext: errorContext)
                launchUnconfirmed = true
            }
        } catch {
            guard operationID == operation else { return }
            if !(error is CancellationError) {
                let diagnostic: PetConnectionDiagnostic? = switch phase {
                case .configuring: inspection.flatMap { .claude($0, stage: .configuration) }
                case .preparingService: .init(provider: .claude, stage: .serviceStart, reason: .serviceUnavailable)
                default: .init(provider: .claude, stage: .terminalLaunch, reason: .launchFailed)
                }
                record(diagnostic, context: errorContext)
            }
            attempt = nil
            phase = .failed((error as? LocalizedError)?.errorDescription ?? PetL10n.text("Unable to prepare the Claude connection. Please check again.", korean: "Claude 연결을 준비하지 못했습니다. 다시 확인해 주세요."))
        }
    }

    private func watch(_ receipt: PetClaudeLauncher.LaunchReceipt, requestedID: UUID,
                       service: ServiceIdentity, operation: UUID, errorContext: PetErrorContext?) throws {
        guard receipt.nativeSessionID == requestedID else { throw Failure(detail: PetL10n.text("Unable to verify the opened Claude session.", korean: "열린 Claude 세션을 확인하지 못했습니다.")) }
        attempt = Attempt(id: operation, service: service, receipt: receipt, errorContext: errorContext)
        phase = .waitingForSession
        scheduleWaitNotice()
    }

    private func scheduleWaitNotice() {
        guard isWaiting, !delayed, waitNotice == nil, let operation = attempt?.id else { return }
        waitNotice = Task { [weak self, waitNoticeNanoseconds] in
            do { try await Task.sleep(nanoseconds: waitNoticeNanoseconds) } catch { return }
            guard let self, self.attempt?.id == operation else { return }
            self.waitNotice = nil
            if self.isWaiting {
                self.delayed = true
                self.record(.init(provider: .claude, stage: .sessionHandshake, reason: .handshakeTimeout), context: self.attempt?.errorContext)
            }
        }
    }

    /// Returns at most one automatic selection request per launch. Switching to
    /// another provider later never causes an automatic switch back.
    func observe(snapshot: PetSnapshot?, serviceGeneration: UInt64?, serviceReady: Bool,
                 readFailed: Bool, canSelect: Bool) -> PetProviderSession? {
        guard var current = attempt else { return nil }
        let wasConnected = phase == .connected
        let context = errorDiagnostics?.captureContext()
        defer {
            scheduleWaitNotice()
            if wasConnected, phase == .unavailable {
                record(.init(provider: .claude, stage: .transport, reason: .connectionLost), context: context)
            }
        }
        guard serviceGeneration == current.service.generation else {
            retire(PetL10n.text("The Blabee service changed. Start a new Claude connection.", korean: "Blabee 서비스가 바뀌었습니다. 새 Claude 연결을 시작해 주세요."))
            return nil
        }
        guard serviceReady, !readFailed, let snapshot,
              snapshot.providerDirectory == PetProviderDirectoryStatus(
                serviceGeneration: current.service.generation, serviceIncarnation: current.service.incarnation) else {
            matchedSession = nil; phase = .unavailable
            return nil
        }
        let matches = snapshot.providerSessions.filter {
            $0.context.provider == .claude
                && $0.nativeSessionID == current.receipt.nativeSessionID.uuidString.lowercased()
                && $0.context.serviceIncarnation == current.service.incarnation
                && $0.cwd == current.receipt.project.path
        }
        guard matches.count <= 1 else {
            retire(PetL10n.text("Multiple connections belong to the same Claude conversation. Select the session to use from the menu.", korean: "같은 Claude 대화의 연결이 여러 개라 확인할 수 없습니다. 사용할 세션을 메뉴에서 직접 선택해 주세요."))
            return nil
        }
        guard let row = matches.first else {
            matchedSession = nil
            phase = current.binding == nil ? .waitingForSession : .disconnected
            return nil
        }
        guard current.binding == nil || current.binding == Binding(row) else {
            retire(PetL10n.text("Claude session authority changed. Start a new Claude connection.", korean: "Claude 세션 권한이 바뀌었습니다. 새 Claude 연결을 시작해 주세요."))
            return nil
        }
        current.binding = Binding(row)
        matchedSession = row
        attempt = current
        guard row.state != "disconnected" else { phase = .disconnected; return nil }
        let scopedObservation = snapshot.providerInbox?.sessions.first { $0.session.context == row.context }
        if snapshot.providerInbox == nil, snapshot.providerContext != row.context {
            phase = .needsSelection
            if !current.selectionRequested, canSelect {
                current.selectionRequested = true; attempt = current
                return row
            }
            return nil
        }
        // It may already be selected by the user before the terminal request
        // returns. That also consumes the one-time automatic selection intent.
        current.selectionRequested = true
        attempt = current
        // Unified inbox observations carry an independently authenticated scope
        // status, so ACK checks need not change the card the user is reading.
        let diagnostic = snapshot.providerInbox == nil ? snapshot.providerDiagnostic : scopedObservation?.diagnostic
        guard diagnostic == nil else { phase = .unavailable; return nil }
        let observedStatus = snapshot.providerInbox == nil ? snapshot.providerStatus : scopedObservation?.status
        guard let status = observedStatus, status.provider == .claude,
              status.scopeID == row.context.scopeID, status.sessionID == row.sessionID,
              status.cwd == row.cwd, status.bridgeConnected else {
            phase = .waitingForAcknowledgement
            return nil
        }
        if status.ready, row.state == "ready" {
            phase = .connected; delayed = false; launchUnconfirmed = false
            waitNotice?.cancel(); waitNotice = nil
        } else {
            phase = row.state == "required" ? .needsProbe : .waitingForAcknowledgement
        }
        return nil
    }

    func stillWantsSelection(_ row: PetProviderSession) -> Bool {
        attempt != nil && phase == .needsSelection && matchedSession == row
    }

    private func retire(_ detail: String) {
        attempt = nil; matchedSession = nil; waitNotice?.cancel(); waitNotice = nil
        phase = .failed(detail)
    }

    private func record(_ diagnostic: PetConnectionDiagnostic?, context: PetErrorContext?) {
        guard !Task.isCancelled, let diagnostic, let context else { return }
        errorDiagnostics?.record(connection: diagnostic, context: context)
    }
}
