import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Managed Codex native fallback")
struct CodexLaunchErrorMappingTests {
    @Test("managed pre-child failure falls back exactly once with original arguments")
    func managedPreChildFailureFallsBackExactlyOnce() throws {
        var managedCalls = 0
        var revalidationCalls = 0
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
            revalidateNativeExecutable: { executable in
                revalidationCalls += 1
                return executable
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
        #expect(revalidationCalls == 1)
        #expect(nativeCalls == 1)
        #expect(nativeExecutable == expectedExecutable)
        #expect(nativeArguments == expectedArguments)
    }

    @Test("managed native fallback revalidates the pinned executable before exec")
    func managedFallbackRejectsExecutableDrift() {
        var nativeCalls = 0
        let expectedExecutable = URL(fileURLWithPath: "/opt/homebrew/bin/codex")

        #expect(throws: (any Error).self) {
            _ = try runExplicitManagedCodexLaunch(
                arguments: ["--"],
                managedRun: { _ in
                    throw ManagedCodexLaunchFailure(
                        childStartState: .notStarted,
                        nativeExecutableURL: expectedExecutable,
                        tuiArguments: [],
                        underlyingError: TestFailure.sample
                    )
                },
                revalidateNativeExecutable: { _ in
                    URL(fileURLWithPath: "/usr/local/bin/codex")
                },
                nativeRun: { _, _ in
                    nativeCalls += 1
                    return 0
                }
            )
        }
        #expect(nativeCalls == 0)
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
                revalidateNativeExecutable: { $0 },
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
                revalidateNativeExecutable: { $0 },
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
