import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Persistent app update window", .petLanguage(.korean)) @MainActor
struct PetAppUpdateWindowTests {
    @Test("opening and reopening share preparation and never confirm session closure")
    func preparationIsSingleFlightAndRequiresConfirmation() async throws {
        let f = try UpdateWindowFixture()
        f.window.prepareIfNeeded(f.release)
        f.window.prepareIfNeeded(f.release)
        try await waitUntil { f.controller.phase == .review }
        let review = try #require(f.controller.preparedReview)
        f.window.prepareIfNeeded(nil)
        f.window.prepareIfNeeded(f.release)
        await Task.yield()

        #expect(await f.download.preparations == 1)
        #expect(f.controller.preparedReview?.release == review.release)
        #expect(f.controller.preparedReview?.currentVersion == review.currentVersion)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        #expect(f.window.window == nil)
        f.window.close()
    }

    @Test("focus changes and minimization preserve verified download and user confirmation")
    func focusAndMinimizationDoNotCancelOrInstall() async throws {
        let f = try UpdateWindowFixture()
        await f.controller.prepare(f.release)
        let review = try #require(f.controller.preparedReview)
        let delegate: any NSWindowDelegate = f.window
        delegate.windowDidResignKey?(.init(name: NSWindow.didResignKeyNotification))
        delegate.windowDidMiniaturize?(.init(name: NSWindow.didMiniaturizeNotification))
        delegate.windowDidDeminiaturize?(.init(name: NSWindow.didDeminiaturizeNotification))
        delegate.windowDidBecomeKey?(.init(name: NSWindow.didBecomeKeyNotification))
        await Task.yield()

        #expect(f.controller.phase == .review)
        #expect(f.controller.preparedReview?.release == review.release)
        #expect(f.controller.preparedReview?.currentVersion == review.currentVersion)
        #expect(await f.download.cleanups == 0)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        #expect(f.window.window == nil)
        f.window.close()
    }

    @Test("closing before preparation starts cancels synchronously")
    func closeBeforeFirstTaskTurn() async throws {
        let f = try UpdateWindowFixture()
        f.window.prepareIfNeeded(f.release)
        f.window.close()
        #expect(f.controller.phase == .idle && f.controller.canPrepare)
        for _ in 0..<5 { await Task.yield() }
        #expect(await f.download.preparations == 0)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
    }

    @Test("explicit close invalidates the review before any cleanup await", arguments: [false, true])
    func explicitCloseIsSynchronous(delegateNotification: Bool) async throws {
        let f = try UpdateWindowFixture()
        await f.controller.prepare(f.release)
        if delegateNotification {
            f.window.windowWillClose(.init(name: NSWindow.willCloseNotification))
        } else {
            f.window.close()
        }
        #expect(f.controller.phase == .idle)
        #expect(f.controller.preparedReview == nil)
        f.controller.confirmClosedSessionsAndInstall()
        await Task.yield()
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        #expect(f.window.window == nil)
    }

    @Test("closing while checking session exit ignores a late successful response")
    func closeDuringSessionWait() async throws {
        var response: CheckedContinuation<Void, Never>?
        let f = try UpdateWindowFixture(waiter: .init(requireReady: { _ in
            await withCheckedContinuation { response = $0 }
        }))
        await f.controller.prepare(f.release)
        f.controller.confirmClosedSessionsAndInstall()
        try await waitUntil { response != nil }
        #expect(f.controller.phase == .waitingForSessionExit)
        f.window.close()
        #expect(f.controller.phase == .idle && f.controller.preparedReview == nil)
        response?.resume()
        for _ in 0..<5 { await Task.yield() }
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        #expect(f.controller.phase == .idle)
    }

    @Test("recovery preparation is single flight and never installs or restarts")
    func recoveryPreparationRequiresRestart() async throws {
        var response: CheckedContinuation<ClaudeRuntimePayloadUse.RecoveryPreparation, Never>?
        let f = try UpdateWindowFixture(prepareRecovery: {
            await withCheckedContinuation { response = $0 }
        })
        await f.controller.prepare(f.release)
        let review = try #require(f.controller.preparedReview)
        f.controller.prepareConnectionRecoveryAfterRestart()
        f.controller.prepareConnectionRecoveryAfterRestart()
        f.controller.confirmClosedSessionsAndInstall()
        try await waitUntil { response != nil }
        #expect(f.recoveryCalls == 1)
        #expect(f.controller.phase == .preparingConnectionRecovery)
        #expect(!f.controller.canBeginInstallation && f.controller.canCancel)
        #expect(f.controller.preparedReview?.release == review.release)
        #expect(await f.download.cleanups == 0)

        response?.resume(returning: .restartRequired(outstandingUseCount: 1))
        try await waitUntil { f.controller.phase == .connectionRestartRequired }
        f.controller.loadLastResult()
        f.controller.confirmClosedSessionsAndInstall()
        f.controller.prepareConnectionRecoveryAfterRestart()
        await Task.yield()
        #expect(f.controller.phase == .connectionRestartRequired)
        #expect(f.controller.detail == PetAppUpdatePresentation.connectionRecoveryRestartInstructions)
        #expect(!f.controller.canBeginInstallation && !f.controller.canPrepareConnectionRecovery)
        #expect(f.recoveryCalls == 1 && f.helperCalls == 0 && f.terminationCalls == 0)
        f.window.close()
    }

    @Test("recovery pauses session waiting and only explicit confirmation can resume installation")
    func recoveryFencesWaitingResponseAndKeepsDownload() async throws {
        var waitingResponse: CheckedContinuation<Void, Never>?
        var readinessCalls = 0
        let f = try UpdateWindowFixture(waiter: .init(requireReady: { _ in
            readinessCalls += 1
            if readinessCalls == 1 {
                await withCheckedContinuation { waitingResponse = $0 }
            }
        }))
        await f.controller.prepare(f.release)
        f.controller.confirmClosedSessionsAndInstall()
        try await waitUntil { waitingResponse != nil }
        f.controller.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.controller.phase == .review }
        waitingResponse?.resume()
        for _ in 0..<5 { await Task.yield() }
        #expect(f.controller.phase == .review)
        #expect(f.controller.detail == PetAppUpdatePresentation.connectionRecoveryClear)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        #expect(await f.download.preparations == 1)
        #expect(await f.download.cleanups == 0)
        f.controller.confirmClosedSessionsAndInstall()
        try await waitUntil { f.terminationCalls == 1 }
        #expect(readinessCalls == 2 && f.helperCalls == 1)
    }

    @Test("closing before recovery starts prevents its persistent preparation")
    func closeBeforeRecoveryTaskStarts() async throws {
        let f = try UpdateWindowFixture()
        await f.controller.prepare(f.release)
        f.controller.prepareConnectionRecoveryAfterRestart()
        f.window.close()
        for _ in 0..<5 { await Task.yield() }
        #expect(f.recoveryCalls == 0)
        #expect(f.controller.phase == .idle && f.controller.preparedReview == nil)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
    }

    @Test("cancelled recovery replies cannot overwrite a new review", arguments: [false, true])
    func cancelledRecoveryCannotOverwriteNewReview(fails: Bool) async throws {
        var response: CheckedContinuation<ClaudeRuntimePayloadUse.RecoveryPreparation, any Error>?
        let f = try UpdateWindowFixture(prepareRecovery: {
            try await withCheckedThrowingContinuation { response = $0 }
        })
        await f.controller.prepare(f.release)
        f.controller.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { response != nil }
        f.window.close()
        await f.controller.prepare(f.release)
        let detail = f.controller.detail
        if fails { response?.resume(throwing: AppUpdateAdmissionError.unavailable) }
        else { response?.resume(returning: .restartRequired(outstandingUseCount: 1)) }
        for _ in 0..<10 { await Task.yield() }
        #expect(f.controller.phase == .review && f.controller.detail == detail)
        #expect(f.recoveryCalls == 1 && f.helperCalls == 0 && f.terminationCalls == 0)
        await f.controller.cancel()
    }

    @Test("failed recovery preparation permits an explicit retry without installation")
    func recoveryFailureCanRetry() async throws {
        var attempts = 0
        let f = try UpdateWindowFixture(prepareRecovery: {
            attempts += 1
            if attempts == 1 { throw AppUpdateAdmissionError.unavailable }
            return .clear
        })
        await f.controller.prepare(f.release)
        f.controller.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.controller.phase == .deferred }
        #expect(f.controller.canPrepareConnectionRecovery)
        f.controller.prepareConnectionRecoveryAfterRestart()
        try await waitUntil { f.controller.phase == .review }
        #expect(attempts == 2 && f.controller.canBeginInstallation)
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
        f.window.close()
    }

    @Test("close requests cannot interrupt helper handoff or the verified update")
    func helperHandoffPreventsClose() async throws {
        var helperResponse: CheckedContinuation<Void, Never>?
        let f = try UpdateWindowFixture(holdHelper: {
            await withCheckedContinuation { helperResponse = $0 }
        })
        await f.controller.prepare(f.release)
        f.controller.confirmClosedSessionsAndInstall()
        try await waitUntil { helperResponse != nil }
        #expect(f.controller.phase == .startingHelper)
        f.controller.prepareConnectionRecoveryAfterRestart()
        #expect(f.recoveryCalls == 0)
        #expect(!f.window.requestClose())
        f.window.close()
        f.window.windowWillClose(.init(name: NSWindow.willCloseNotification))
        #expect(f.controller.phase == .startingHelper)
        #expect(f.controller.preparedReview != nil)

        helperResponse?.resume()
        try await waitUntil { f.terminationCalls == 1 }
        #expect(f.controller.phase == .updating)
        #expect(!f.window.requestClose())
        #expect(f.helperCalls == 1 && f.terminationCalls == 1)
        #expect(await f.download.cleanups == 0)
        #expect(f.window.window == nil)
    }

    @Test("closing a result preserves recovery restrictions and completed status",
          arguments: [AppUpdateJournal.Phase.recoveryRequired, .succeeded, .partialRestore])
    func closingResultKeepsStatus(_ phase: AppUpdateJournal.Phase) throws {
        let f = try UpdateWindowFixture()
        defer { try? FileManager.default.removeItem(at: f.rootURL) }
        let jobID = UUID().uuidString.lowercased()
        let journal = AppUpdateJournal(schema: 3, jobID: jobID, nonce: UUID().uuidString.lowercased(),
            parentPID: 1, parentStartTime: 1, createdAt: .now,
            previousIdentity: "sha256:" + String(repeating: "a", count: 64),
            candidateIdentity: f.prepared.runtimeIdentity, download: try .init(f.prepared),
            helperApplicationURL: f.rootURL.appendingPathComponent("helper-runtime-\(jobID)/Blabee.app"),
            phase: phase, sessions: [], detail: "Saved result", updatedAt: .now)
        try f.store.save(journal)
        f.controller.loadLastResult()
        let displayedPhase = f.controller.phase
        #expect(f.controller.preparedReview == nil)
        if phase == .recoveryRequired {
            #expect(displayedPhase == .recoveryRequired)
            #expect(!f.controller.canPrepare)
        }

        f.window.close()
        #expect(f.controller.phase == displayedPhase)
        #expect(f.controller.detail == "Saved result")
        #expect(f.controller.lastResult == journal)
        if phase == .recoveryRequired { #expect(!f.controller.canPrepare) }
        #expect(f.helperCalls == 0 && f.terminationCalls == 0)
    }

    @Test("session instructions wrap in both languages without claiming sessions were detected")
    func instructionsRenderAndWrap() throws {
        for language in PetUILanguage.allCases {
            try PetL10n.$languageOverride.withValue(language) {
                let wide = NSHostingView(rootView: PetAppUpdateSessionInstructionsView().frame(width: 480))
                let narrow = NSHostingView(rootView: PetAppUpdateSessionInstructionsView().frame(width: 280))
                #expect(abs(narrow.fittingSize.width - 280) < 0.01)
                #expect(narrow.fittingSize.height > wide.fittingSize.height + 20)
                #expect(PetAppUpdatePresentation.sessionClosureSteps.count == 3)
                #expect(PetAppUpdatePresentation.confirmationTitle == (language == .english
                    ? "Sessions Closed — Update" : "세션 종료 완료 · 업데이트"))
                let wording = PetAppUpdatePresentation.sessionClosureSteps.joined(separator: " ")
                    + PetAppUpdatePresentation.restartExplanation
                #expect(!wording.contains("0 sessions") && !wording.contains("0개"))

                narrow.frame = NSRect(origin: .zero, size: narrow.fittingSize)
                narrow.layoutSubtreeIfNeeded()
                let bitmap = try #require(narrow.bitmapImageRepForCachingDisplay(in: narrow.bounds))
                narrow.cacheDisplay(in: narrow.bounds, to: bitmap)
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            }
        }
    }

    @Test("recovery instructions render in both languages and describe the persistent restart step")
    func recoveryInstructionsRenderAndWrap() throws {
        for language in PetUILanguage.allCases {
            try PetL10n.$languageOverride.withValue(language) {
                let wide = NSHostingView(rootView: PetAppUpdateConnectionRecoveryInstructionsView(
                    canPrepare: true, prepare: {}).frame(width: 480))
                let narrow = NSHostingView(rootView: PetAppUpdateConnectionRecoveryInstructionsView(
                    canPrepare: true, prepare: {}).frame(width: 280))
                #expect(abs(narrow.fittingSize.width - 280) < 0.01)
                #expect(narrow.fittingSize.height > wide.fittingSize.height + 20)
                let message = PetAppUpdatePresentation.connectionRecoveryRestartInstructions
                #expect(message.contains(language == .english ? "restart your Mac" : "Mac을 재시동"))
                #expect(message.contains(language == .english ? "does not undo" : "취소되지 않습니다"))
                narrow.frame = NSRect(origin: .zero, size: narrow.fittingSize)
                narrow.layoutSubtreeIfNeeded()
                let bitmap = try #require(narrow.bitmapImageRepForCachingDisplay(in: narrow.bounds))
                narrow.cacheDisplay(in: narrow.bounds, to: bitmap)
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            }
        }
    }

    @Test("independent update window keeps controls reachable at its compact size")
    func confirmationWindowLayout() async throws {
        for language in PetUILanguage.allCases {
            try await PetL10n.$languageOverride.withValue(language) {
                let f = try UpdateWindowFixture()
                await f.controller.prepare(f.release)
                defer { f.window.close() }
                for dark in [false, true] {
                    let view = PetAppUpdateWindowView(controller: f.controller, onClose: {})
                        .frame(width: 460, height: 480)
                        .background(Color(nsColor: .windowBackgroundColor))
                        .environment(\.colorScheme, dark ? .dark : .light)
                    let host = NSHostingView(rootView: view)
                    host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: 460, height: 480),
                        styleMask: .borderless, backing: .buffered, defer: false)
                    window.isReleasedWhenClosed = false
                    window.appearance = host.appearance
                    window.contentView = host
                    // No ordering, activation, real update window, or live app.
                    defer { window.contentView = nil; window.close() }
                    #expect(abs(host.fittingSize.width - 460) < 0.01)
                    #expect(abs(host.fittingSize.height - 480) < 0.01)
                    host.frame = NSRect(origin: .zero, size: host.fittingSize)
                    for _ in 0..<5 {
                        host.layoutSubtreeIfNeeded()
                        window.displayIfNeeded()
                        try await Task.sleep(for: .milliseconds(20))
                    }
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    if let directory = ProcessInfo.processInfo.environment["BLABEE_APP_UPDATE_RENDER_DIRECTORY"] {
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                            .appendingPathComponent("app-update-window-\(language.rawValue)-\(dark ? "dark" : "light").png"))
                    }
                }
            }
        }
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !condition(), ContinuousClock.now < deadline { await Task.yield() }
        #expect(condition())
    }
}

private actor UpdateWindowDownloadProbe {
    let prepared: AppUpdatePreparedDownload
    private(set) var preparations = 0
    private(set) var cleanups = 0
    init(prepared: AppUpdatePreparedDownload) { self.prepared = prepared }
    func prepare() -> AppUpdatePreparedDownload { preparations += 1; return prepared }
    func cleanup() { cleanups += 1 }
}

@MainActor
private final class UpdateWindowFixture {
    let release: PetAppUpdateRelease
    let rootURL: URL
    let store: AppUpdateJournalStore
    let prepared: AppUpdatePreparedDownload
    let download: UpdateWindowDownloadProbe
    let controller: AppUpdateTransactionController
    lazy var window = PetAppUpdateWindowController(controller: controller)
    private let counts: UpdateWindowCounts
    var helperCalls: Int { counts.helperCalls }
    var terminationCalls: Int { counts.terminationCalls }
    var recoveryCalls: Int { counts.recoveryCalls }

    init(waiter: AppUpdateSafePointWaiter = .init(requireReady: { _ in }),
         prepareRecovery: (@MainActor () async throws -> ClaudeRuntimePayloadUse.RecoveryPreparation)? = nil,
         holdHelper: (@MainActor () async -> Void)? = nil) throws {
        let version = try #require(PetAppUpdateVersion(version: "0.1.0", build: "84"))
        let current = try #require(PetAppUpdateVersion(version: "0.1.0", build: "83"))
        let name = AppUpdateDownloadPolicy.diskImageName(version)
        let base = try #require(URL(string: "https://github.com/test/Blabee/releases/download/blabee-v0.1.0+build.84/"))
        release = PetAppUpdateRelease(version: version,
            releaseURL: try #require(URL(string: "https://github.com/test/Blabee/releases/tag/blabee-v0.1.0+build.84")),
            installerAssets: .init(dmg: .init(name: name, url: base.appendingPathComponent(name), size: 100),
                checksum: .init(name: name + ".sha256", url: base.appendingPathComponent(name + ".sha256"), size: 100)))
        let root = URL(fileURLWithPath: "/private/tmp/blabee-update-window-tests-\(UUID().uuidString)", isDirectory: true)
        rootURL = root
        let prepared = AppUpdatePreparedDownload(release: release, workRootURL: root,
            applicationURL: root.appendingPathComponent("Blabee.app"), diskImageURL: root.appendingPathComponent(name),
            sha256: String(repeating: "b", count: 64), runtimeIdentity: "sha256:" + String(repeating: "b", count: 64))
        self.prepared = prepared
        let store = AppUpdateJournalStore(rootURL: root.appendingPathComponent("journal"))
        self.store = store
        let download = UpdateWindowDownloadProbe(prepared: prepared)
        self.download = download
        let counts = UpdateWindowCounts()
        self.counts = counts
        controller = AppUpdateTransactionController(store: store,
            closedSessionsWaiter: waiter,
            prepareDownload: { _ in await download.prepare() },
            cleanupDownload: { _ in await download.cleanup() },
            installedVersion: { (version: current, identity: "sha256:" + String(repeating: "a", count: 64)) },
            prepareConnectionRecovery: {
                counts.recoveryCalls += 1
                return try await prepareRecovery?() ?? .clear
            },
            prepareHelper: { _, policy in
                #expect(policy == .userConfirmedSessionClosure)
                counts.helperCalls += 1
                if let holdHelper { await holdHelper() }
            }, terminateApplication: { counts.terminationCalls += 1 })
    }
}

@MainActor
private final class UpdateWindowCounts {
    var helperCalls = 0
    var terminationCalls = 0
    var recoveryCalls = 0
}
