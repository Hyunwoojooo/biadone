import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Private Pet selector bootstrap", .serialized)
@MainActor
struct PetSelectorBootstrapTests {
    @Test("Only the exact public bootstrap flag opts in; legacy invocation has no capability")
    func explicitFlag() throws {
        #expect(try !AppPetSelectorBootstrap.isEnabled(arguments: []))
        #expect(try AppPetSelectorBootstrap.isEnabled(arguments: ["--pet-bootstrap-v1"]))
        for arguments in [["--pet-bootstrap-v2"], ["--pet-bootstrap-v1", "extra"],
                          ["--pet-bootstrap-v1", "--pet-bootstrap-v1"], ["--pet-bootstrap-v1=value"]] {
            #expect(throws: CoordinatorError("invalid_arguments")) {
                try AppPetSelectorBootstrap.isEnabled(arguments: arguments)
            }
        }
        let input = Pipe(), output = Pipe()
        let lifetime = try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor, exitProcess: { _ in })
        defer { lifetime.cancel() }
        #expect(lifetime.petSelectorCredential == nil)
        #expect(PetBootstrapLegacyChild().petSelectorCredential == nil)
    }

    @Test("Fresh capabilities have exact 256-bit lowerhex shape and remain unique")
    func freshCapabilities() throws {
        let values = try (0..<16).map { _ in try AppPetSelectorBootstrap.freshCredential() }
        #expect(values.allSatisfy(AppPetSelectorBootstrap.validCredential))
        #expect(Set(values).count == values.count)
        for invalid in ["", String(repeating: "A", count: 64), String(repeating: "a", count: 63),
                        String(repeating: "a", count: 65), String(repeating: "g", count: 64),
                        String(repeating: "a", count: 64) + "\n"] {
            #expect(!AppPetSelectorBootstrap.validCredential(invalid))
            #expect(throws: CoordinatorError("app_service_pet_bootstrap_invalid")) {
                try AppPetSelectorBootstrap.frame(credential: invalid)
            }
        }
    }

    @Test("A fragmented private frame is consumed once before the unchanged ready and EOF protocol")
    func fragmentedBootstrapAndEOF() async throws {
        let input = Pipe(), output = Pipe()
        let credential = try AppPetSelectorBootstrap.freshCredential()
        let frame = try AppPetSelectorBootstrap.frame(credential: credential)
        let events = PetBootstrapExitEvents()
        let lifetime = try receiveFragmentedBootstrap(input: input, output: output, frame: frame, events: events)
        defer { lifetime.cancel() }
        // Lifetime owns its duplicate. Retaining this original writer would
        // prevent ready-pipe EOF after publishReady closes the duplicate.
        try output.fileHandleForWriting.close()
        let readyReader = output.fileHandleForReading.fileDescriptor
        let flags = fcntl(readyReader, F_GETFL)
        try #require(flags >= 0 && fcntl(readyReader, F_SETFL, flags | O_NONBLOCK) == 0)
        #expect(lifetime.petSelectorCredential.map { $0 == credential } == true)
        lifetime.start()
        try lifetime.publishReady()
        // publishReady is synchronous. A nonblocking read also makes a future
        // missing write/FD leak a bounded test failure instead of a suite hang.
        let received = try readPetBootstrapPipe(readyReader, maximumCount: AppOwnedServiceControlFrame.ready.count + 1)
        #expect(received == AppOwnedServiceControlFrame.ready)
        #expect(received.range(of: Data(credential.utf8)) == nil)
        #expect(try readPetBootstrapPipe(readyReader, maximumCount: 1).isEmpty)
        try input.fileHandleForWriting.close()
        try await petBootstrapEventually { events.values == [0] }
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("Malformed, oversized, duplicate and trailing-byte frames cannot issue a capability",
           arguments: ["version", "uppercase", "short", "newline", "duplicate", "trailing", "oversized", "utf8"])
    func malformedFrame(kind: String) throws {
        let input = Pipe(), output = Pipe()
        let token = String(repeating: "d", count: 64)
        let good = try AppPetSelectorBootstrap.frame(credential: token)
        let value: Data
        switch kind {
        case "version": value = Data("BLABEE_PET_SELECTOR_BOOTSTRAP_V2 \(token)\n".utf8)
        case "uppercase": value = AppPetSelectorBootstrap.prefix + Data(String(repeating: "D", count: 64).utf8) + Data([10])
        case "short": value = AppPetSelectorBootstrap.prefix + Data("abc\n".utf8)
        case "newline": value = good.dropLast() + Data([13, 10])
        case "duplicate": value = good + good
        case "trailing": value = good + Data([0])
        case "oversized": value = Data(repeating: 97, count: 512)
        default: value = AppPetSelectorBootstrap.prefix + Data(repeating: 0xff, count: 64) + Data([10])
        }
        try input.fileHandleForWriting.write(contentsOf: value)
        #expect(throws: CoordinatorError("app_service_pet_bootstrap_invalid")) {
            try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
                readyDescriptor: output.fileHandleForWriting.fileDescriptor, petBootstrap: true,
                bootstrapTimeoutMilliseconds: 100, exitProcess: { _ in })
        }
        // A failed initializer must release both private duplicates. With the
        // original reader closed, a leaked duplicate would let this write pass.
        let writer = input.fileHandleForWriting.fileDescriptor
        #expect(fcntl(writer, F_SETNOSIGPIPE, 1) == 0)
        try input.fileHandleForReading.close()
        var byte: UInt8 = 0
        let written = Darwin.write(writer, &byte, 1), code = errno
        #expect(written == -1 && code == EPIPE)
        try output.fileHandleForWriting.close()
        let ready = output.fileHandleForReading.fileDescriptor
        #expect(fcntl(ready, F_SETFL, fcntl(ready, F_GETFL) | O_NONBLOCK) == 0)
        #expect(Darwin.read(ready, &byte, 1) == 0)
    }

    @Test("Empty and partial frame timeouts are bounded without waiting for parent EOF", arguments: [false, true])
    func boundedTimeout(partial: Bool) throws {
        let input = Pipe(), output = Pipe()
        if partial { try input.fileHandleForWriting.write(contentsOf: AppPetSelectorBootstrap.prefix) }
        let start = ContinuousClock.now
        #expect(throws: CoordinatorError("app_service_pet_bootstrap_timeout")) {
            try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
                readyDescriptor: output.fileHandleForWriting.fileDescriptor, petBootstrap: true,
                bootstrapTimeoutMilliseconds: 30, exitProcess: { _ in })
        }
        #expect(ContinuousClock.now - start < .seconds(2))
    }

    @Test("EOF before or immediately after the complete frame rejects an already-orphaned service",
           arguments: [false, true])
    func startupEOF(complete: Bool) throws {
        let input = Pipe(), output = Pipe()
        if complete {
            try input.fileHandleForWriting.write(contentsOf:
                AppPetSelectorBootstrap.frame(credential: String(repeating: "e", count: 64)))
        }
        try input.fileHandleForWriting.close()
        #expect(throws: CoordinatorError.self) {
            try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
                readyDescriptor: output.fileHandleForWriting.fileDescriptor, petBootstrap: true,
                bootstrapTimeoutMilliseconds: 100, exitProcess: { _ in })
        }
    }

    @Test("Unflagged bytes and bytes sent after bootstrap retain the lifetime fail-closed behavior",
           arguments: [false, true])
    func unexpectedLaterBytes(bootstrap: Bool) async throws {
        let input = Pipe(), output = Pipe()
        if bootstrap {
            try input.fileHandleForWriting.write(contentsOf:
                AppPetSelectorBootstrap.frame(credential: String(repeating: "f", count: 64)))
        }
        let events = PetBootstrapExitEvents()
        let lifetime = try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
            readyDescriptor: output.fileHandleForWriting.fileDescriptor, petBootstrap: bootstrap,
            bootstrapTimeoutMilliseconds: 100, exitProcess: { events.record($0) })
        defer { lifetime.cancel() }
        #expect((lifetime.petSelectorCredential != nil) == bootstrap)
        lifetime.start()
        try input.fileHandleForWriting.write(contentsOf: Data("unexpected".utf8))
        try await petBootstrapEventually { events.values == [78] }
        #expect(throws: CoordinatorError.self) { try lifetime.publishReady() }
    }

    @Test("The owned child receives one private frame with no capability in argv, env or ready output")
    func ownedChildrenStayIsolated() async throws {
        let firstToken = try AppPetSelectorBootstrap.freshCredential()
        let secondToken = try AppPetSelectorBootstrap.freshCredential()
        let first = try petBootstrapTestChild(credential: firstToken)
        let second = try petBootstrapTestChild(credential: secondToken)
        try await petBootstrapEventually { first.hasPublishedService && second.hasPublishedService }
        #expect(first.petSelectorCredential.map { $0 == firstToken } == true)
        #expect(second.petSelectorCredential.map { $0 == secondToken } == true)
        await first.stop()
        #expect(!first.isRunning && first.petSelectorCredential == nil)
        #expect(first.terminationSummary == "app_service_exit_0")
        #expect(second.isRunning && second.hasPublishedService)
        await second.stop()
        #expect(!second.isRunning && second.petSelectorCredential == nil)
        #expect(second.terminationSummary == "app_service_exit_0")
    }

    @Test("Spawn refuses accidental capability reflection in arguments and environment")
    func noPublicCapabilityInputs() throws {
        let token = String(repeating: "a", count: 64)
        for (arguments, environment) in [([token], [String: String]()),
                                          ([String](), ["VALUE": token]),
                                          ([String](), [token: "value"])] {
            #expect(throws: CoordinatorError("app_service_launch_invalid")) {
                try AppOwnedServiceProcess.spawn(executable: URL(fileURLWithPath: "/usr/bin/true"),
                    arguments: arguments, environment: environment, petSelectorCredential: token)
            }
        }
    }

    @Test("Real app-service CLI consumes the private frame before its existing identity gate")
    func actualChildCapture() async throws {
        let executable = Bundle(for: PetBootstrapBundleToken.self).bundleURL
            .deletingLastPathComponent().appendingPathComponent("blabee-coordinator")
        #expect(FileManager.default.isExecutableFile(atPath: executable.path))
        // Missing identity deliberately stops before product bootstrap/Keychain.
        let child = try AppOwnedServiceProcess.spawn(executable: executable,
            arguments: ["app-service", AppPetSelectorBootstrap.argument], environment: [:],
            stopGraceMilliseconds: 100, petSelectorCredential: AppPetSelectorBootstrap.freshCredential())
        try await petBootstrapEventually { !child.isRunning }
        #expect(!child.hasPublishedService)
        #expect(child.petSelectorCredential == nil)
        #expect(child.terminationSummary == "app_service_identity_mismatch")
        await child.stop()
    }
}

private func readPetBootstrapPipe(_ descriptor: Int32, maximumCount: Int) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: maximumCount)
    for _ in 0..<3 {
        let count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        if count < 0 && errno == EINTR { continue }
        guard count >= 0 else { throw CoordinatorError("pet_bootstrap_fixture_read_failed") }
        return Data(bytes.prefix(count))
    }
    throw CoordinatorError("pet_bootstrap_fixture_read_failed")
}

/// Synchronous test helper keeps a tiny fragmented pipe writer independent of
/// the receiver. Its own duplicated FD is closed before the helper returns.
private func receiveFragmentedBootstrap(input: Pipe, output: Pipe, frame: Data,
                                       events: PetBootstrapExitEvents) throws -> AppOwnedServiceLifetime {
    let writer = fcntl(input.fileHandleForWriting.fileDescriptor, F_DUPFD_CLOEXEC, 3)
    guard writer >= 0 else { throw CoordinatorError("pet_bootstrap_fixture_failed") }
    guard fcntl(writer, F_SETNOSIGPIPE, 1) == 0 else { close(writer); throw CoordinatorError("pet_bootstrap_fixture_failed") }
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        defer { close(writer); done.signal() }
        for value in frame {
            var byte = value
            guard Darwin.write(writer, &byte, 1) == 1 else { return }
            usleep(500)
        }
    }
    defer { _ = done.wait(timeout: .now() + 3) }
    return try AppOwnedServiceLifetime(inputDescriptor: input.fileHandleForReading.fileDescriptor,
        readyDescriptor: output.fileHandleForWriting.fileDescriptor, petBootstrap: true,
        bootstrapTimeoutMilliseconds: 1_000, exitProcess: { events.record($0) })
}

@MainActor
private func petBootstrapTestChild(credential: String) throws -> AppOwnedServiceProcess {
    // Only the pipe contains the generated value. The child checks every argv
    // and environment field, then emits only the unchanged public ready marker.
    let program = #"""
    $|=1;
    my $frame=<STDIN>;
    exit 71 unless defined($frame) && $frame =~ /\ABLABEE_PET_SELECTOR_BOOTSTRAP_V1 ([0-9a-f]{64})\n\z/;
    my $cap=$1;
    for my $value (@ARGV, keys(%ENV), values(%ENV)) { exit 72 if index($value,$cap)>=0; }
    print "BLABEE_APP_SERVICE_READY_V1\n";
    my $later=<STDIN>;
    exit(defined($later) ? 78 : 0);
    """#
    return try AppOwnedServiceProcess.spawn(executable: URL(fileURLWithPath: "/usr/bin/perl"),
        arguments: ["-e", program, "--", AppPetSelectorBootstrap.argument], environment: ["PATH": "/usr/bin:/bin"],
        stopGraceMilliseconds: 100, petSelectorCredential: credential)
}

@MainActor
private func petBootstrapEventually(_ predicate: () -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(3)
    while !predicate() {
        guard ContinuousClock.now < deadline else { throw CoordinatorError("pet_bootstrap_fixture_timeout") }
        try await Task.sleep(for: .milliseconds(10))
    }
}

@MainActor
private final class PetBootstrapLegacyChild: AppOwnedServiceChild {
    var isRunning: Bool { true }
    var hasPublishedService: Bool { true }
    var terminationSummary: String? { nil }
    func stop() async {}
}
private final class PetBootstrapExitEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Int32] = []
    func record(_ code: Int32) { lock.withLock { recorded.append(code) } }
    var values: [Int32] { lock.withLock { recorded } }
}
private final class PetBootstrapBundleToken: NSObject {}
