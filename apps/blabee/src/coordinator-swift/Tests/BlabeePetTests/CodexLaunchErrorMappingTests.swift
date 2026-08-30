import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Codex launch error mapping")
struct CodexLaunchErrorMappingTests {
    @Test("auto-connect failures expose stable redacted categories")
    func autoConnectCategories() {
        #expect(codexAutoConnectLaunchCoordinatorError(
            CodexAutoConnectError.conflict("private conflict detail")
        ).code == "codex_auto_connect_conflict")
        #expect(codexAutoConnectLaunchCoordinatorError(
            CodexAutoConnectError.unavailable("private unavailable detail")
        ).code == "codex_auto_connect_unavailable")
        #expect(codexAutoConnectLaunchCoordinatorError(
            CodexAutoConnectError.unsafeFilesystem("private filesystem detail")
        ).code == "codex_auto_connect_repair_required")
        #expect(codexAutoConnectLaunchCoordinatorError(
            CodexAutoConnectError.writeFailed("private write detail")
        ).code == "codex_auto_connect_repair_required")
    }

    @Test("unrelated coordinator errors keep their behavior")
    func coordinatorErrorsArePreserved() {
        let original = CoordinatorError("routing_unavailable", "private detail")
        #expect(codexAutoConnectLaunchCoordinatorError(original) == original)
    }

    @Test("unknown failures retain the existing internal error fallback")
    func unknownFailuresRemainInternal() {
        let mapped = codexAutoConnectLaunchCoordinatorError(TestFailure.sample)
        #expect(mapped.code == "internal_error")
    }

    @Test("managed pre-child failure falls back exactly once with original arguments")
    func managedPreChildFailureFallsBackExactlyOnce() throws {
        var managedCalls = 0
        var nativeCalls = 0
        var nativeExecutable: URL?
        var nativeArguments: [String] = []
        let expectedExecutable = URL(fileURLWithPath: "/opt/homebrew/bin/codex")
        let expectedArguments = ["resume", "thread with spaces", "--no-alt-screen"]

        let status = try runExplicitManagedCodexLaunch(
            arguments: ["--", "ignored-by-fault-injection"],
            managedRun: { _ in
                managedCalls += 1
                throw ManagedCodexLaunchFailure(
                    childStartState: .notStarted,
                    nativeExecutableURL: expectedExecutable,
                    tuiArguments: expectedArguments,
                    underlyingError: TestFailure.sample
                )
            },
            nativeRun: { executable, arguments in
                nativeCalls += 1
                nativeExecutable = executable
                nativeArguments = arguments
                return 37
            }
        )

        #expect(status == 37)
        #expect(managedCalls == 1)
        #expect(nativeCalls == 1)
        #expect(nativeExecutable == expectedExecutable)
        #expect(nativeArguments == expectedArguments)
    }

    @Test("managed post-child failure never runs native Codex")
    func managedPostChildFailureDoesNotFallback() {
        var nativeCalls = 0

        #expect(throws: TestFailure.sample) {
            _ = try runExplicitManagedCodexLaunch(
                arguments: ["--", "resume", "thread-1"],
                managedRun: { _ in
                    throw ManagedCodexLaunchFailure(
                        childStartState: .started,
                        nativeExecutableURL: URL(fileURLWithPath: "/usr/bin/codex"),
                        tuiArguments: ["resume", "thread-1"],
                        underlyingError: TestFailure.sample
                    )
                },
                nativeRun: { _, _ in
                    nativeCalls += 1
                    return 0
                }
            )
        }
        #expect(nativeCalls == 0)
    }

    @Test("invalid managed syntax remains an error without native fallback")
    func invalidManagedSyntaxDoesNotFallback() {
        var nativeCalls = 0

        #expect(throws: (any Error).self) {
            _ = try runExplicitManagedCodexLaunch(
                arguments: ["resume", "thread-1"],
                managedRun: { arguments in
                    _ = try ManagedCodexLauncherArguments(arguments)
                    return 0
                },
                nativeRun: { _, _ in
                    nativeCalls += 1
                    return 0
                }
            )
        }
        #expect(nativeCalls == 0)
    }
}

private enum TestFailure: Error, Equatable {
    case sample
}
