import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("App-owned service child process", .serialized)
@MainActor
struct AppOwnedServiceProcessTests {
    @Test("the production launcher refuses an unpackaged test runner")
    func productionLaunchRequiresExactApp() {
        #expect(throws: (any Error).self) {
            try AppOwnedServiceProcessLauncher(socketPath: "/tmp/not-the-product.sock").launch()
        }
    }

    @Test("extra app-service arguments fail before capturing stdio")
    func additionalArgumentsAreRejected() {
        #expect(throws: CoordinatorError.self) {
            try AppOwnedServiceLifetime.captureStandardIO(arguments: ["--socket", "/tmp/other"])
        }
    }

    @Test("launch identity is an exact comparison, not an environment override")
    func expectedIdentityGate() throws {
        let current = "sha256:" + String(repeating: "a", count: 64)
        let different = "sha256:" + String(repeating: "b", count: 64)
        try AppOwnedServiceLaunchBinding.verify(
            environment: [AppOwnedServiceLaunchBinding.environmentKey: current],
            currentIdentity: current
        )
        for environment in [
            [:],
            [AppOwnedServiceLaunchBinding.environmentKey: different],
            [AppOwnedServiceLaunchBinding.environmentKey: current + "\n"],
            [OperationalRuntimeIdentity.environmentKey: current],
            [AppOwnedServiceLaunchBinding.environmentKey: "invalid"],
        ] {
            #expect(throws: CoordinatorError.self) {
                try AppOwnedServiceLaunchBinding.verify(
                    environment: environment, currentIdentity: current
                )
            }
        }
        #expect(throws: CoordinatorError.self) {
            try AppOwnedServiceLaunchBinding.verify(
                environment: [AppOwnedServiceLaunchBinding.environmentKey: "invalid"],
                currentIdentity: "invalid"
            )
        }
    }

    @Test("app-service CLI rejects missing, invalid, and mismatched identity before product bootstrap")
    func actualCLIIdentityGate() async throws {
        let executable = try appServiceTestCoordinatorExecutable()
        for environment in [
            [:],
            [AppOwnedServiceLaunchBinding.environmentKey: "invalid"],
            [AppOwnedServiceLaunchBinding.environmentKey: "sha256:" + String(repeating: "0", count: 64)],
        ] {
            // This is the unpackaged SwiftPM executable, never the installed app.
            // The identity gate precedes product bootstrap and any Keychain use.
            let child = try AppOwnedServiceProcess.spawn(
                executable: executable, arguments: ["app-service"], environment: environment,
                stopGraceMilliseconds: 100
            )
            try await appServiceEventually { !child.isRunning }
            #expect(!child.hasPublishedService)
            #expect(child.terminationSummary == "app_service_identity_mismatch")
            await child.stop()
        }
    }

    @Test("startup diagnostics accept only bounded exact allowlisted codes")
    func startupErrorFrameSanitization() {
        let valid = AppOwnedServiceControlFrame.failure(code: "freshness_anchor_unavailable")
        #expect(AppOwnedServiceControlFrame.failureCode(in: valid) == "freshness_anchor_unavailable")
        for unsafe in ["token_secret", "/Users/example/private", "internal_error\nREADY", String(repeating: "x", count: 1000)] {
            let frame = AppOwnedServiceControlFrame.failure(code: unsafe)
            #expect(AppOwnedServiceControlFrame.failureCode(in: frame) == "app_service_startup_failed")
            #expect(frame.count <= AppOwnedServiceControlFrame.maximumBytes)
        }
        for malformed in [
            Data("BLABEE_APP_SERVICE_ERROR_V1 token_secret\n".utf8),
            valid + Data("trailing".utf8),
            valid + AppOwnedServiceControlFrame.ready,
            Data(String(repeating: "x", count: 129).utf8),
        ] {
            #expect(AppOwnedServiceControlFrame.failureCode(in: malformed) == nil)
        }
    }

    @Test("lifetime rejects null input and a wrong-direction pipe")
    func lifetimeInputGate() throws {
        let output = Pipe()
        let input = Pipe()
        let null = open("/dev/null", O_RDONLY | O_CLOEXEC)
        defer { close(null) }
        for invalid in [null, -1, input.fileHandleForWriting.fileDescriptor] {
            #expect(throws: CoordinatorError.self) {
                try AppOwnedServiceLifetime(
                    inputDescriptor: invalid,
                    readyDescriptor: output.fileHandleForWriting.fileDescriptor
                )
            }
        }
        #expect(throws: CoordinatorError.self) {
            try AppOwnedServiceLifetime(
                inputDescriptor: input.fileHandleForReading.fileDescriptor,
                readyDescriptor: output.fileHandleForReading.fileDescriptor
            )
        }
    }

    @Test("an open lifetime pipe is idle; EOF before initialization requests one exit")
    func parentEOFBeforeInitialization() async throws {
        let input = Pipe()
        let output = Pipe()
        let events = AppServiceTestEvents()
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { events.record($0) }
        )
        defer { lifetime.cancel() }
        lifetime.start()
        lifetime.start() // An accidental repeated start cannot duplicate the watcher.
        try await Task.sleep(for: .milliseconds(30))
        #expect(events.values.isEmpty)
        try input.fileHandleForWriting.close()
        try await appServiceEventually { events.values == [0] }
        try await Task.sleep(for: .milliseconds(30))
        #expect(events.values == [0])
    }

    @Test("unexpected lifetime bytes fail closed without a ready marker")
    func invalidLifetimeInput() async throws {
        let input = Pipe()
        let output = Pipe()
        let events = AppServiceTestEvents()
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { events.record($0) }
        )
        defer { lifetime.cancel() }
        lifetime.start()
        try input.fileHandleForWriting.write(contentsOf: Data("unexpected".utf8))
        try await appServiceEventually { events.values == [78] }
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("lifetime publishes the exact private ready marker only once")
    func lifetimeReadyMarker() throws {
        let input = Pipe()
        let output = Pipe()
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { _ in }
        )
        defer { lifetime.cancel() }
        lifetime.start()
        try lifetime.publishReady()
        #expect(try output.fileHandleForReading.read(
            upToCount: AppOwnedServiceLifetime.readyMarker.count
        ) == AppOwnedServiceLifetime.readyMarker)
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("private startup failure is emitted once and cannot become readiness")
    func lifetimeFailureFrame() throws {
        let input = Pipe()
        let output = Pipe()
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { _ in }
        )
        defer { lifetime.cancel() }
        lifetime.start()
        lifetime.publishStartupFailure(code: "freshness_anchor_unavailable")
        let expected = AppOwnedServiceControlFrame.failure(code: "freshness_anchor_unavailable")
        #expect(try output.fileHandleForReading.read(upToCount: expected.count) == expected)
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("watchdog survives a blocked graceful shutdown handler")
    func parentEOFHasIndependentWatchdog() async throws {
        let input = Pipe()
        let output = Pipe()
        let exits = AppServiceTestEvents()
        let handled = AppServiceTestEvents()
        let release = DispatchSemaphore(value: 0)
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { exits.record($0) }
        )
        defer { release.signal(); lifetime.cancel() }
        lifetime.installShutdownHandler {
            handled.record(1)
            _ = release.wait(timeout: .now() + .seconds(4))
        }
        lifetime.start()
        try input.fileHandleForWriting.close()
        try await appServiceEventually { handled.values == [1] }
        try await appServiceEventually(milliseconds: 3_500) { exits.values == [0] }
        #expect(handled.values == [1])
    }

    @Test("cancel disarms parent loss and does not publish readiness")
    func lifetimeCancellation() async throws {
        let input = Pipe()
        let output = Pipe()
        let exits = AppServiceTestEvents()
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor,
            exitProcess: { exits.record($0) }
        )
        lifetime.start()
        lifetime.cancel()
        try input.fileHandleForWriting.close()
        try await Task.sleep(for: .milliseconds(40))
        #expect(exits.values.isEmpty)
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("owned child reports readiness then exits on its parent's EOF")
    func ownedChildGracefulStop() async throws {
        let child = try appServiceTestChild(
            #"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; my $line = <STDIN>; exit 0;"#
        )
        try await appServiceEventually { child.hasPublishedService }
        #expect(child.isRunning)
        await child.stop()
        #expect(!child.isRunning)
        #expect(!child.hasPublishedService)
        #expect(child.terminationSummary == "app_service_exit_0")
    }

    @Test("a partial ready marker is not readiness")
    func partialReadyIsNotReady() async throws {
        let child = try appServiceTestChild(
            #"$|=1; print "BLABEE_APP_SERVICE_READY_"; my $line = <STDIN>; exit 0;"#
        )
        try await Task.sleep(for: .milliseconds(70))
        #expect(child.isRunning)
        #expect(!child.hasPublishedService)
        await child.stop()
        #expect(!child.isRunning)
    }

    @Test("unrelated stdout and oversized output do not imply readiness")
    func invalidReadyIsNotReady() async throws {
        for program in [
            #"$|=1; print "READY\n"; my $line = <STDIN>; exit 0;"#,
            #"$|=1; print "x" x 4096; my $line = <STDIN>; exit 0;"#,
        ] {
            let child = try appServiceTestChild(program)
            try await Task.sleep(for: .milliseconds(70))
            #expect(!child.hasPublishedService)
            await child.stop()
            #expect(!child.isRunning)
        }
    }

    @Test("early child failure is sanitized and never marked ready")
    func earlyFailureIsReported() async throws {
        let child = try appServiceTestChild(#"print STDERR "secret diagnostic"; exit 7;"#)
        try await appServiceEventually { !child.isRunning }
        #expect(!child.hasPublishedService)
        #expect(child.terminationSummary == "app_service_exit_7")
        await child.stop()
        #expect(child.terminationSummary == "app_service_exit_7")
    }

    @Test("immediate ERROR then exit preserves the startup cause despite exit/read ordering")
    func immediateErrorSurvivesReaping() async throws {
        for _ in 0..<20 {
            let child = try appServiceTestChild(
                #"$|=1; print "BLABEE_APP_SERVICE_ERROR_V1 freshness_anchor_unavailable\n"; exit 1;"#
            )
            try await appServiceEventually { !child.isRunning }
            #expect(!child.hasPublishedService)
            #expect(child.terminationSummary == "freshness_anchor_unavailable")
            await child.stop()
            #expect(child.terminationSummary == "freshness_anchor_unavailable")
        }
    }

    @Test("fragmented ERROR frame preserves only the allowlisted code")
    func fragmentedStartupFailure() async throws {
        let child = try appServiceTestChild(
            #"$|=1; for (split //, "BLABEE_APP_SERVICE_ERROR_V1 operational_runtime_directory_unavailable\n") { print; select undef, undef, undef, 0.001; } exit 1;"#
        )
        try await appServiceEventually { !child.isRunning }
        #expect(child.terminationSummary == "operational_runtime_directory_unavailable")
        #expect(!child.hasPublishedService)
        await child.stop()
        await child.stop()
        #expect(child.terminationSummary == "operational_runtime_directory_unavailable")
    }

    @Test("malformed child ERROR output is not exposed or considered ready")
    func malformedChildErrorIsNotExposed() async throws {
        for program in [
            #"print "BLABEE_APP_SERVICE_ERROR_V1 token_secret\n"; exit 1;"#,
            #"print "BLABEE_APP_SERVICE_ERROR_V1 freshness_anchor_unavailable\nTRAILING"; exit 1;"#,
            #"print "BLABEE_APP_SERVICE_ERROR_V1 " . ("x" x 2048) . "\n"; exit 1;"#,
        ] {
            let child = try appServiceTestChild(program)
            try await appServiceEventually { !child.isRunning }
            #expect(!child.hasPublishedService)
            #expect(child.terminationSummary?.contains("token_secret") == false)
            #expect(child.terminationSummary == "app_service_exit_1")
            await child.stop()
        }
    }

    @Test("concurrent stop is bounded and only terminates the owned child")
    func stopDoesNotAdoptAnotherChild() async throws {
        let other = try appServiceTestChild(#"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; <STDIN>;"#)
        let target = try appServiceTestChild(#"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; sleep 20;"#)
        try await appServiceEventually { other.hasPublishedService && target.hasPublishedService }
        async let first: Void = target.stop()
        async let second: Void = target.stop()
        _ = await (first, second)
        #expect(!target.isRunning)
        #expect(other.isRunning)
        #expect(other.hasPublishedService)
        #expect(target.terminationSummary == "app_service_signal_15")
        await other.stop()
        #expect(!other.isRunning)
    }

    @Test("TERM-ignoring directly owned child is killed and reaped")
    func killBoundForUnresponsiveChild() async throws {
        let child = try appServiceTestChild(
            #"$SIG{TERM}='IGNORE'; $|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; sleep 20;"#
        )
        try await appServiceEventually { child.hasPublishedService }
        await child.stop()
        #expect(!child.isRunning)
        #expect(child.terminationSummary == "app_service_signal_9")
    }

    @Test("a later child cannot inherit and hold another child's lifetime writer")
    func lifetimeWriterIsNotInherited() async throws {
        let first = try appServiceTestChild(#"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; <STDIN>; exit 0;"#)
        let second = try appServiceTestChild(#"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; <STDIN>; exit 0;"#)
        try await appServiceEventually { first.hasPublishedService && second.hasPublishedService }
        await first.stop()
        #expect(first.terminationSummary == "app_service_exit_0")
        #expect(second.isRunning)
        await second.stop()
        #expect(second.terminationSummary == "app_service_exit_0")
    }

    @Test("task cancellation does not cancel owned child cleanup")
    func stopSurvivesTaskCancellation() async throws {
        let child = try appServiceTestChild(#"$|=1; print "BLABEE_APP_SERVICE_READY_V1\n"; sleep 20;"#)
        try await appServiceEventually { child.hasPublishedService }
        let task = Task { await child.stop() }
        task.cancel()
        await task.value
        #expect(!child.isRunning)
    }

    @Test("missing executable fails without publishing an owned handle")
    func failedSpawnDoesNotAdopt() {
        #expect(throws: CoordinatorError.self) {
            try AppOwnedServiceProcess.spawn(
                executable: URL(fileURLWithPath: "/private/tmp/blabee-missing-" + UUID().uuidString),
                arguments: [], environment: [:]
            )
        }
    }
}

@MainActor
private func appServiceTestChild(_ program: String) throws -> AppOwnedServiceProcess {
    try AppOwnedServiceProcess.spawn(
        executable: URL(fileURLWithPath: "/usr/bin/perl"),
        arguments: ["-e", program],
        environment: ["PATH": "/usr/bin:/bin"],
        stopGraceMilliseconds: 100
    )
}

@MainActor
private func appServiceEventually(
    milliseconds: Int = 2_000,
    _ condition: () -> Bool
) async throws {
    let deadline = ContinuousClock.now + .milliseconds(milliseconds)
    while !condition() {
        guard ContinuousClock.now < deadline else {
            throw CoordinatorError("app_service_test_timeout")
        }
        try await Task.sleep(for: .milliseconds(10))
    }
}

private final class AppServiceTestEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Int32] = []
    func record(_ value: Int32) { lock.withLock { stored.append(value) } }
    var values: [Int32] { lock.withLock { stored } }
}

private final class AppOwnedServiceTestBundleToken: NSObject {}

private func appServiceTestCoordinatorExecutable() throws -> URL {
    let executable = Bundle(for: AppOwnedServiceTestBundleToken.self).bundleURL
        .deletingLastPathComponent().appendingPathComponent("blabee-coordinator")
    var info = stat()
    guard lstat(executable.path, &info) == 0,
          info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          info.st_uid == geteuid(), access(executable.path, X_OK) == 0
    else { throw CoordinatorError("app_service_test_binary_missing") }
    return executable
}
