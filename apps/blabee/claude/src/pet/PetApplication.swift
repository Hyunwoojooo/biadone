import AppKit
import Foundation
import Darwin

@MainActor
private final class SelectionButton: NSButton {
    var sessionID = ""
    var packetID = ""
    var revision = 0
    var optionID = ""
}

@MainActor
final class PetApplication: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let configuration: RuntimeConfiguration
    private let lease: PetInstanceLease
    private let token: String
    private let client: CoordinatorClient
    private let requests = DispatchQueue(label: "com.biadone.blabee.claude.pet.requests", qos: .utility)
    private var child: Process?
    private var timer: Timer?
    private var statusItem: NSStatusItem?
    private var panel: NSPanel!
    private let connection = NSTextField(labelWithString: "Claude 연결을 준비하고 있어요")
    private let activity = NSTextField(labelWithString: "")
    private let errorLabel = NSTextField(wrappingLabelWithString: "")
    private let sessionPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let cards = NSStackView()
    private let scroll = NSScrollView()
    private var snapshots: [SessionSnapshot] = []
    private var selectedSessionID: String?
    private var connected = false
    private var pollInFlight = false
    private var selectionInFlight = false
    private var pendingSelection: PendingPetSelection?
    private var isTerminating = false
    private var serviceExited = false
    private var lastRenderedSession: SessionSnapshot?
    private var lastRenderedEnabled: Bool?

    init(configuration: RuntimeConfiguration, lease: PetInstanceLease) {
        self.configuration = configuration
        self.lease = lease
        var random = [UInt8](repeating: 0, count: 32)
        random.withUnsafeMutableBytes { buffer in arc4random_buf(buffer.baseAddress!, buffer.count) }
        token = random.map { String(format: "%02x", $0) }.joined()
        client = CoordinatorClient(runtime: configuration.runtime, token: token)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildInterface()
        do {
            try startCoordinator()
            refresh()
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        } catch {
            serviceExited = true
            connected = false
            connection.stringValue = "Claude 서비스를 시작하지 못했어요"
            errorLabel.stringValue = error.localizedDescription
        }
        // Show once without activating Claude's terminal or stealing focus during polling.
        panel.orderFrontRegardless()
    }

    private func startCoordinator() throws {
        var socketInfo = stat()
        let path = configuration.runtime + "/blabee-claude.sock"
        if lstat(path, &socketInfo) == 0 {
            throw PetFailure.invalid("A coordinator socket already exists in this Claude runtime. The app will not attach to or remove it.")
        }
        guard errno == ENOENT else { throw PetFailure.system("Inspect Claude coordinator socket", errno) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: configuration.node)
        process.arguments = [configuration.service, "--runtime", configuration.runtime]
        process.currentDirectoryURL = URL(fileURLWithPath: configuration.runtime)
        var environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("BLABEE_") }
        environment["BLABEE_CLAUDE_UI_TOKEN"] = token
        environment["BLABEE_CLAUDE_RUNTIME"] = configuration.runtime
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] process in
            let status = process.terminationStatus
            DispatchQueue.main.async {
                guard let self, !self.isTerminating else { return }
                self.serviceExited = true
                self.connected = false
                self.timer?.invalidate()
                self.connection.stringValue = "Claude 서비스 연결이 종료됐어요"
                self.errorLabel.stringValue = "Claude coordinator exited (status \(status)). Quit and reopen this app after checking its runtime."
                self.renderSession()
            }
        }
        try process.run()
        child = process
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        timer?.invalidate()
        isTerminating = true
        guard let child, child.isRunning else { return .terminateNow }
        child.terminate()
        // Only this exact Process child is stopped; no process-name or shared-service lookup.
        DispatchQueue.global(qos: .utility).async {
            let deadline = ProcessInfo.processInfo.systemUptime + 3
            while child.isRunning, ProcessInfo.processInfo.systemUptime < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if child.isRunning { _ = Darwin.kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
            DispatchQueue.main.async { NSApplication.shared.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    @objc private func showPanel() {
        panel.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }

    private func buildInterface() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "● Claude"
        item.button?.toolTip = "Blabee Claude — Claude Code 작업 선택"
        let menu = NSMenu(title: "Blabee Claude")
        let openItem = NSMenuItem(title: "Blabee Claude 열기", action: #selector(showPanel), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Blabee Claude 종료", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        item.menu = menu
        statusItem = item

        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 424, height: 640),
                        styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        panel.title = "Blabee Claude"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 380, height: 380)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = NSColor(calibratedRed: 1, green: 0.98, blue: 0.91, alpha: 1)
        panel.delegate = self
        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.maxX - 448, y: frame.minY + 40))
        }

        let content = NSView()
        panel.contentView = content
        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 12
        root.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
            root.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -18),
            root.topAnchor.constraint(equalTo: content.topAnchor, constant: 18),
            root.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14)
        ])
        let title = NSTextField(labelWithString: "●  BLABEE  /  CLAUDE")
        title.font = .systemFont(ofSize: 16, weight: .bold)
        title.textColor = NSColor(calibratedRed: 0.36, green: 0.27, blue: 0.07, alpha: 1)
        root.addArrangedSubview(title)
        connection.font = .systemFont(ofSize: 12, weight: .medium)
        connection.textColor = .secondaryLabelColor
        root.addArrangedSubview(connection)
        sessionPicker.target = self
        sessionPicker.action = #selector(changeSession)
        sessionPicker.addItem(withTitle: "연결된 Claude 세션이 없어요")
        sessionPicker.isEnabled = false
        root.addArrangedSubview(sessionPicker)
        sessionPicker.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
        activity.font = .systemFont(ofSize: 12, weight: .semibold)
        root.addArrangedSubview(activity)
        errorLabel.font = .systemFont(ofSize: 11)
        errorLabel.textColor = .systemRed
        errorLabel.isSelectable = true
        root.addArrangedSubview(errorLabel)
        errorLabel.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true

        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        cards.orientation = .vertical
        cards.alignment = .leading
        cards.spacing = 14
        cards.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 12, right: 0)
        cards.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = cards
        root.addArrangedSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.widthAnchor.constraint(equalTo: root.widthAnchor),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 150),
            cards.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            cards.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            cards.topAnchor.constraint(equalTo: scroll.contentView.topAnchor)
        ])
        let footer = NSTextField(wrappingLabelWithString: "Claude Code 전용 · 실행 권한은 Claude에서 확인해요")
        footer.font = .systemFont(ofSize: 10)
        footer.textColor = .secondaryLabelColor
        root.addArrangedSubview(footer)
        footer.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
        renderSession(force: true)
    }

    private func refresh() {
        guard !pollInFlight, !selectionInFlight, !serviceExited, !isTerminating,
              child?.isRunning == true else { return }
        pollInFlight = true
        let client = client
        requests.async { [weak self] in
            let result = Result { try client.list() }
            DispatchQueue.main.async {
                guard let self, !self.isTerminating, !self.serviceExited else { return }
                self.pollInFlight = false
                switch result {
                case .success(let sessions):
                    self.connected = true
                    self.connection.stringValue = "● Claude coordinator 연결됨"
                    let oldIDs = self.snapshots.map(\.session_id)
                    self.snapshots = sessions
                    if self.selectedSessionID == nil || !sessions.contains(where: { $0.session_id == self.selectedSessionID }) {
                        self.selectedSessionID = sessions.first?.session_id
                    }
                    if oldIDs != sessions.map(\.session_id) { self.rebuildSessionPicker() }
                    if self.errorLabel.stringValue.hasPrefix("연결:") { self.errorLabel.stringValue = "" }
                case .failure(let error):
                    self.connected = false
                    self.connection.stringValue = "Claude 연결을 기다리고 있어요"
                    self.errorLabel.stringValue = "연결: \(error.localizedDescription)"
                }
                self.renderSession()
            }
        }
    }

    private func rebuildSessionPicker() {
        sessionPicker.removeAllItems()
        for session in snapshots {
            let name = (session.cwd as NSString).lastPathComponent
            sessionPicker.addItem(withTitle: "\(name) · \(session.session_id.prefix(8))")
            sessionPicker.lastItem?.toolTip = session.cwd
            sessionPicker.lastItem?.representedObject = session.session_id
        }
        if snapshots.isEmpty { sessionPicker.addItem(withTitle: "연결된 Claude 세션이 없어요") }
        sessionPicker.isEnabled = !snapshots.isEmpty
        if let index = snapshots.firstIndex(where: { $0.session_id == selectedSessionID }) {
            sessionPicker.selectItem(at: index)
        }
    }

    @objc private func changeSession() {
        selectedSessionID = sessionPicker.selectedItem?.representedObject as? String
        errorLabel.stringValue = ""
        renderSession(force: true)
        scroll.contentView.scroll(to: .zero)
    }

    private func renderSession(force: Bool = false) {
        let session = snapshots.first { $0.session_id == selectedSessionID }
        let pending = session.map { pendingSelection?.blocks($0) == true } ?? false
        let enabled = connected && !serviceExited && !selectionInFlight && session?.isSelectionReady == true
            && !pending
        guard force || session != lastRenderedSession || enabled != lastRenderedEnabled else { return }
        lastRenderedSession = session
        lastRenderedEnabled = enabled
        for view in cards.arrangedSubviews { cards.removeArrangedSubview(view); view.removeFromSuperview() }
        guard let session else {
            activity.stringValue = "연결 대기"
            addText("Claude Code에서 Blabee Claude launcher로 작업을 시작하면 이곳에 세션과 다음 선택이 나타나요.", color: .secondaryLabelColor)
            return
        }
        let connectionLabel = !session.connected ? "Claude 연결 대기"
            : session.continuation_ready == true ? "선택 연결 확인됨" : "Claude 연결 확인 필요"
        activity.stringValue = phaseLabel(session.phase) + " · " + connectionLabel
        addText(session.cwd, size: 11, color: .secondaryLabelColor)
        if session.connected && session.continuation_ready != true && session.phase != "ended" {
            addText("Claude Code에 ‘Blabee 연결을 확인해 줘’라고 요청해 주세요. 확인이 끝나면 선택할 수 있어요.", size: 12, color: .secondaryLabelColor)
        }
        if let selection = session.selection {
            addText("선택 상태: \(phaseLabel(selection.status))", size: 12, weight: .semibold)
            if let note = selection.note, !note.isEmpty { addText(note, size: 12) }
            if selection.status == "completed" { addText("완료 상태는 Claude의 보고예요.", size: 10, color: .secondaryLabelColor) }
        }
        guard let packet = session.packet else {
            addText(session.phase == "working" ? "Claude가 작업하고 있어요. 다음 선택이 준비되면 여기에 표시돼요." : "아직 제안된 선택이 없어요.", color: .secondaryLabelColor)
            return
        }
        addText(packet.summary, size: 15, weight: .semibold)
        for (index, option) in packet.options.enumerated() {
            let box = NSStackView()
            box.orientation = .vertical
            box.alignment = .leading
            box.spacing = 7
            box.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
            box.wantsLayer = true
            box.layer?.backgroundColor = NSColor(calibratedRed: 1, green: 0.94, blue: 0.73, alpha: 1).cgColor
            box.layer?.cornerRadius = 10
            let button = SelectionButton(title: "\(index + 1). \(option.title)", target: self, action: #selector(selectOption(_:)))
            button.bezelStyle = .rounded
            button.font = .systemFont(ofSize: 13, weight: .semibold)
            button.isEnabled = enabled
            button.sessionID = session.session_id
            button.packetID = packet.packet_id
            button.revision = packet.revision
            button.optionID = option.id
            button.toolTip = "이 작업을 현재 Claude 세션에 전달"
            box.addArrangedSubview(button)
            for (text, size, color) in [
                (option.description, CGFloat(12), NSColor.labelColor),
                ("실행할 작업", CGFloat(10), NSColor.secondaryLabelColor),
                (option.task, CGFloat(12), NSColor.labelColor),
                ("완료 조건: " + option.done_when, CGFloat(11), NSColor.secondaryLabelColor)
            ] where !text.isEmpty {
                let label = makeText(text, size: size, color: color)
                box.addArrangedSubview(label)
                label.widthAnchor.constraint(equalTo: box.widthAnchor, constant: -24).isActive = true
            }
            cards.addArrangedSubview(box)
            box.widthAnchor.constraint(equalTo: cards.widthAnchor, constant: -4).isActive = true
        }
        if !enabled { addText(selectionInFlight ? "선택을 전달하고 있어요…" : "응답이 멈추고 Claude 연결 확인이 끝나면 선택할 수 있어요.", size: 11, color: .secondaryLabelColor) }
    }

    @objc private func selectOption(_ sender: SelectionButton) {
        guard !selectionInFlight, sender.isEnabled else { return }
        selectionInFlight = true
        pendingSelection = PendingPetSelection(sessionID: sender.sessionID, packetID: sender.packetID)
        errorLabel.stringValue = ""
        renderSession()
        let client = client
        let session = sender.sessionID, packet = sender.packetID, revision = sender.revision, option = sender.optionID
        requests.async { [weak self] in
            let result = Result { try client.select(session: session, packet: packet, revision: revision, option: option) }
            DispatchQueue.main.async {
                guard let self, !self.isTerminating else { return }
                self.selectionInFlight = false
                switch result {
                case .success(let selectionID):
                    self.pendingSelection?.selectionID = selectionID
                    self.errorLabel.stringValue = ""
                case .failure(let error):
                    self.pendingSelection = nil
                    self.errorLabel.stringValue = "선택을 전달하지 못했어요: \(error.localizedDescription)"
                }
                self.renderSession()
                self.refresh()
            }
        }
    }

    private func phaseLabel(_ phase: String) -> String {
        ["registered": "시작 대기", "working": "작업 중", "ready": "다음 선택 준비됨",
         "selected": "선택됨", "delivered": "전달됨", "claimed": "Claude가 작업 수신",
         "completed": "완료 보고됨", "failed": "실패 보고됨", "ended": "세션 종료",
         "idle": "대기 중", "stale": "지난 선택", "cancelled": "취소됨"][phase] ?? phase
    }

    private func makeText(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular,
                          color: NSColor = .labelColor) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.isSelectable = true
        label.maximumNumberOfLines = 0
        label.setContentCompressionResistancePriority(.required, for: .vertical)
        return label
    }

    private func addText(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular,
                         color: NSColor = .labelColor) {
        let label = makeText(text, size: size, weight: weight, color: color)
        cards.addArrangedSubview(label)
        label.widthAnchor.constraint(equalTo: cards.widthAnchor, constant: -4).isActive = true
    }
}
