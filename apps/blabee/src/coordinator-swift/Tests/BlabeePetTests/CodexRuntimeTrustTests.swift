import Darwin
import Foundation
import Testing
import CoordinatorSwift
@testable import BlabeeCoordinator

@Suite("CodexRuntimeTrust", .serialized)
struct CodexRuntimeTrustTests {
    @Test("explicit managed provider qualifies once and only revalidates afterward")
    func managedProviderPinsOneFreshQualification() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )
        let provider = ManagedCodexApprovedExecutableProvider(resolver: resolver)

        let first = try provider.next()
        let second = try provider.next()

        #expect(first != fixture.target)
        #expect(first == second)
        #expect(try Data(contentsOf: first) == Data(contentsOf: fixture.target))
        #expect(versions.callCount == 1)
        #expect(versions.requestedURLs == [first])
    }

    @Test("live managed resolution uses PATH and probes only its private pin")
    func liveManagedProviderResolvesPATHCandidateIntoPrivatePin() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = try ManagedCodexApprovedExecutableProvider.live(
            environment: [
                "HOME": fixture.root.path,
                "PATH": fixture.source.deletingLastPathComponent().path,
            ],
            pinParentURL: fixture.root,
            versionReader: { versions.read($0) }
        )

        let first = try provider.next()
        let second = try provider.next()

        #expect(first == second)
        #expect(first != fixture.source)
        #expect(first != fixture.target)
        #expect(first.deletingLastPathComponent().deletingLastPathComponent()
            == fixture.root)
        #expect(versions.callCount == 1)
        #expect(versions.requestedURLs == [first])
    }

    @Test("live managed resolution uses HOME local bin when PATH has no candidate")
    func liveManagedProviderResolvesHomeLocalCandidate() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let home = fixture.root.appendingPathComponent(
            "isolated-home",
            isDirectory: true
        )
        let local = home.appendingPathComponent(".local", isDirectory: true)
        let bin = local.appendingPathComponent("bin", isDirectory: true)
        for directory in [home, local, bin] {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: directory.path
            )
        }
        let candidate = bin.appendingPathComponent("codex", isDirectory: false)
        try Data(contentsOf: URL(fileURLWithPath: "/usr/bin/true")).write(
            to: candidate
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: candidate.path
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = try ManagedCodexApprovedExecutableProvider.live(
            environment: [
                "HOME": home.path,
                "PATH": "/nonexistent-managed-codex-bin",
            ],
            pinParentURL: fixture.root,
            versionReader: { versions.read($0) }
        )

        let first = try provider.next()
        let second = try provider.next()

        #expect(first == second)
        #expect(first != candidate)
        #expect(first.deletingLastPathComponent().deletingLastPathComponent()
            == fixture.root)
        #expect(versions.callCount == 1)
        #expect(versions.requestedURLs == [first])
    }

    @Test("managed resolution rejects dynamic-loader overrides before probing")
    func liveManagedProviderRejectsLoaderOverrides() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe([])

        for name in [
            "DYLD_INSERT_LIBRARIES",
            "DYLD_LIBRARY_PATH",
            "__XPC_DYLD_INSERT_LIBRARIES",
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
        ] {
            do {
                _ = try ManagedCodexApprovedExecutableProvider.live(
                    environment: [
                        "HOME": fixture.root.path,
                        "PATH": fixture.root.path,
                        name: "/tmp/untrusted.dylib",
                    ],
                    pinParentURL: fixture.root,
                    versionReader: { versions.read($0) }
                )
                Issue.record("loader override unexpectedly entered managed mode")
            } catch let error as CoordinatorError {
                #expect(error.code == "managed_codex_environment_unsafe")
            }
        }
        #expect(versions.callCount == 0)
    }

    @Test("live version probe captures a native process result")
    func managedVersionProbeRunnerCapturesNativeResult() throws {
        let result = try ManagedCodexVersionProbeRunner.run(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                "printf 'codex-cli 0.150.1\\n'; printf 'probe-note\\n' >&2",
            ],
            environment: [:],
            timeoutMilliseconds: 1_000
        )

        #expect(result.exitCode == 0)
        #expect(String(data: result.stdout, encoding: .utf8)
            == "codex-cli 0.150.1\n")
        #expect(String(data: result.stderr, encoding: .utf8) == "probe-note\n")
    }

    @Test("live version probe stops an unbounded output flood at its byte cap")
    func managedVersionProbeRunnerStopsOutputFlood() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let directPIDFile = fixture.root.appendingPathComponent(
            "flood-version-probe.pid",
            isDirectory: false
        )
        let childPIDFile = fixture.root.appendingPathComponent(
            "flood-version-probe-child.pid",
            isDirectory: false
        )
        let releaseFile = fixture.root.appendingPathComponent(
            "flood-version-probe-release",
            isDirectory: false
        )
        let command = #"""
        trap '' TERM
        /bin/echo "$$" > "$1"
        (
          trap '' TERM
          while [ ! -e "$3" ]; do /bin/sleep 0.01; done
          exec /usr/bin/yes version-flood
        ) &
        child=$!
        /bin/echo "$child" > "$2"
        : > "$3"
        wait "$child"
        """#
        let started = DispatchTime.now().uptimeNanoseconds

        do {
            _ = try ManagedCodexVersionProbeRunner.run(
                executable: URL(fileURLWithPath: "/bin/sh"),
                arguments: [
                    "-c", command, "managed-version-probe",
                    directPIDFile.path, childPIDFile.path, releaseFile.path,
                ],
                environment: [:],
                timeoutMilliseconds: 5_000
            )
            Issue.record("unbounded version output unexpectedly succeeded")
        } catch let error as CoordinatorError {
            #expect(error.code == "managed_codex_version_probe_output_too_large")
        }
        #expect(DispatchTime.now().uptimeNanoseconds - started < 2_000_000_000)
        let directPID = try #require(pid_t(
            String(contentsOf: directPIDFile, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        ))
        let childPID = try #require(pid_t(
            String(contentsOf: childPIDFile, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        ))
        defer {
            if kill(childPID, 0) == 0 { _ = kill(childPID, SIGKILL) }
        }
        let goneDeadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while kill(childPID, 0) == 0,
              DispatchTime.now().uptimeNanoseconds < goneDeadline
        {
            usleep(10_000)
        }
        #expect(kill(childPID, 0) == -1)
        #expect(errno == ESRCH)
        var directStatus: Int32 = 0
        errno = 0
        #expect(waitpid(directPID, &directStatus, WNOHANG) == -1)
        #expect(errno == ECHILD)
    }

    @Test("successful native probe kills a fork that still holds its pipes")
    func managedVersionProbeRunnerCleansSuccessfulForkedDescendant() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let childPIDFile = fixture.root.appendingPathComponent(
            "successful-version-probe-child.pid",
            isDirectory: false
        )
        let directPIDFile = fixture.root.appendingPathComponent(
            "successful-version-probe.pid",
            isDirectory: false
        )
        let command = #"""
        trap '' TERM
        /bin/echo "$$" > "$1"
        /bin/sleep 30 &
        child=$!
        /bin/echo "$child" > "$2"
        printf 'codex-cli 0.150.1\n'
        exit 0
        """#

        let result = try ManagedCodexVersionProbeRunner.run(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c", command, "managed-version-probe",
                directPIDFile.path, childPIDFile.path,
            ],
            environment: [:],
            timeoutMilliseconds: 2_000
        )

        #expect(result.exitCode == 0)
        #expect(String(data: result.stdout, encoding: .utf8)
            == "codex-cli 0.150.1\n")
        let pidText = try String(contentsOf: childPIDFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let childPID = try #require(pid_t(pidText))
        let directPIDText = try String(
            contentsOf: directPIDFile,
            encoding: .utf8
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let directPID = try #require(pid_t(directPIDText))
        defer {
            if kill(childPID, 0) == 0 { _ = kill(childPID, SIGKILL) }
        }
        let goneDeadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while kill(childPID, 0) == 0,
              DispatchTime.now().uptimeNanoseconds < goneDeadline
        {
            usleep(10_000)
        }
        let childResult = kill(childPID, 0)
        let childError = errno
        #expect(childResult == -1)
        #expect(childError == ESRCH)
        var directStatus: Int32 = 0
        errno = 0
        #expect(waitpid(directPID, &directStatus, WNOHANG) == -1)
        #expect(errno == ECHILD)
    }

    @Test("timed out native probe kills its forked process group")
    func managedVersionProbeRunnerKillsForkedDescendant() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let childPIDFile = fixture.root.appendingPathComponent(
            "version-probe-child.pid",
            isDirectory: false
        )
        let directPIDFile = fixture.root.appendingPathComponent(
            "version-probe.pid",
            isDirectory: false
        )
        let command = #"""
        trap '' TERM
        /bin/echo "$$" > "$1"
        /bin/sleep 30 &
        child=$!
        /bin/echo "$child" > "$2"
        wait "$child"
        """#

        do {
            _ = try ManagedCodexVersionProbeRunner.run(
                executable: URL(fileURLWithPath: "/bin/sh"),
                arguments: [
                    "-c", command, "managed-version-probe",
                    directPIDFile.path, childPIDFile.path,
                ],
                environment: [:],
                timeoutMilliseconds: 500
            )
            Issue.record("forking version probe unexpectedly completed")
        } catch let error as CoordinatorError {
            #expect(error.code == "managed_codex_version_probe_timeout")
        }

        let pidText = try String(contentsOf: childPIDFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let childPID = try #require(pid_t(pidText))
        let directPIDText = try String(
            contentsOf: directPIDFile,
            encoding: .utf8
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let directPID = try #require(pid_t(directPIDText))
        defer {
            if kill(childPID, 0) == 0 { _ = kill(childPID, SIGKILL) }
        }
        let goneDeadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while kill(childPID, 0) == 0,
              DispatchTime.now().uptimeNanoseconds < goneDeadline
        {
            usleep(10_000)
        }
        let result = kill(childPID, 0)
        let resultError = errno
        #expect(result == -1)
        #expect(resultError == ESRCH)
        var directStatus: Int32 = 0
        errno = 0
        #expect(waitpid(directPID, &directStatus, WNOHANG) == -1)
        #expect(errno == ECHILD)
    }

    @Test("managed pin parent must be owner-safe and grant-ACL-free")
    func managedPinParentMetadataFailsClosedBeforeVersionProbe() throws {
        let candidate = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { candidate.remove() }
        try candidate.replaceTargetWithNativeExecutable()

        let writableParent = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { writableParent.remove() }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o770],
            ofItemAtPath: writableParent.root.path
        )
        let writableVersions = RuntimeTrustVersionProbe(["0.150.1"])
        let writableResolver = ManagedCodexTrustResolver(
            candidateURLs: [candidate.source],
            monitoredEntries: [],
            pinParentURL: writableParent.root,
            versionReader: { writableVersions.read($0) }
        )
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try writableResolver.resolveApproved()
        }
        #expect(writableVersions.callCount == 0)

        let aclParent = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { aclParent.remove() }
        try addRuntimeTrustACL(at: aclParent.root)
        let aclVersions = RuntimeTrustVersionProbe(["0.150.1"])
        let aclResolver = ManagedCodexTrustResolver(
            candidateURLs: [candidate.source],
            monitoredEntries: [],
            pinParentURL: aclParent.root,
            versionReader: { aclVersions.read($0) }
        )
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try aclResolver.resolveApproved()
        }
        #expect(aclVersions.callCount == 0)
    }

    @Test("managed pin creation uses the canonical temporary parent")
    func managedPinUsesCanonicalParent() throws {
        let candidate = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { candidate.remove() }
        try candidate.replaceTargetWithNativeExecutable()
        let parentFixture = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { parentFixture.remove() }
        let alias = parentFixture.root.appendingPathComponent(
            "pin-parent-alias",
            isDirectory: false
        )
        try FileManager.default.createSymbolicLink(
            at: alias,
            withDestinationURL: parentFixture.prefix
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [candidate.source],
                monitoredEntries: [],
                pinParentURL: alias,
                versionReader: { versions.read($0) }
            )
        )

        let pinned = try provider.next()

        #expect(pinned.deletingLastPathComponent().deletingLastPathComponent()
            == parentFixture.prefix)
        #expect(versions.callCount == 1)
    }

    @Test("releasing a managed provider removes its private pin")
    func managedProviderCleansPrivatePinOnRelease() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )
        var provider: ManagedCodexApprovedExecutableProvider? =
            ManagedCodexApprovedExecutableProvider(resolver: resolver)

        let pinned = try provider!.next()
        let directory = pinned.deletingLastPathComponent()
        #expect(FileManager.default.fileExists(atPath: pinned.path))
        provider = nil

        #expect(!FileManager.default.fileExists(atPath: directory.path))
        #expect(versions.callCount == 1)
    }

    @Test("provider cleanup never recursively removes an unexpected entry")
    func managedProviderCleanupPreservesUnexpectedEntry() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )
        var provider: ManagedCodexApprovedExecutableProvider? =
            ManagedCodexApprovedExecutableProvider(resolver: resolver)
        let pinned = try provider!.next()
        let directory = pinned.deletingLastPathComponent()
        defer { try? FileManager.default.removeItem(at: directory) }
        let unexpected = directory.appendingPathComponent(
            "user-owned-unexpected",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unexpected)

        provider = nil

        #expect(FileManager.default.fileExists(atPath: unexpected.path))
        #expect(FileManager.default.fileExists(atPath: pinned.path))
    }

    @Test("abandoned-pin scavenging never removes a concurrently leased pin")
    func managedProviderScavengerPreservesActiveLease() throws {
        let firstFixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { firstFixture.remove() }
        try firstFixture.replaceTargetWithNativeExecutable()
        let firstVersions = RuntimeTrustVersionProbe(["0.150.1"])
        var firstProvider: ManagedCodexApprovedExecutableProvider? =
            ManagedCodexApprovedExecutableProvider(
                resolver: ManagedCodexTrustResolver(
                    candidateURLs: [firstFixture.source],
                    monitoredEntries: [],
                    versionReader: { firstVersions.read($0) }
                )
            )
        let firstPin = try firstProvider!.next()
        let firstDirectory = firstPin.deletingLastPathComponent()
        defer {
            firstProvider = nil
            try? FileManager.default.removeItem(at: firstDirectory)
        }
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -120)],
            ofItemAtPath: firstDirectory.path
        )

        let secondFixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { secondFixture.remove() }
        try secondFixture.replaceTargetWithNativeExecutable()
        let secondVersions = RuntimeTrustVersionProbe(["0.150.1"])
        let secondProvider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [secondFixture.source],
                monitoredEntries: [],
                versionReader: { secondVersions.read($0) }
            )
        )

        _ = try secondProvider.next()

        #expect(FileManager.default.fileExists(atPath: firstPin.path))
        #expect(firstVersions.callCount == 1)
        #expect(secondVersions.callCount == 1)
    }

    @Test("the next managed invocation reaps an exact unlocked abandoned pin")
    func managedProviderScavengerReapsExactAbandonedPin() throws {
        let abandoned = try makeSyntheticAbandonedPin()
        defer { try? FileManager.default.removeItem(at: abandoned) }

        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                versionReader: { versions.read($0) }
            )
        )

        _ = try provider.next()

        #expect(!FileManager.default.fileExists(atPath: abandoned.path))
        #expect(versions.callCount == 1)
    }

    @Test("the next managed invocation reaps an exact unlocked partial pin")
    func managedProviderScavengerReapsExactPartialPin() throws {
        let abandoned = try makeSyntheticAbandonedPin(state: .partialExecutable)
        defer { try? FileManager.default.removeItem(at: abandoned) }

        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                versionReader: { versions.read($0) }
            )
        )

        _ = try provider.next()

        #expect(!FileManager.default.fileExists(atPath: abandoned.path))
        #expect(versions.callCount == 1)
    }

    @Test("the next managed invocation reaps a lease-only partial-unlink residue")
    func managedProviderScavengerReapsLeaseOnlyResidue() throws {
        let abandoned = try makeSyntheticAbandonedPin(state: .leaseOnly)
        defer { try? FileManager.default.removeItem(at: abandoned) }

        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                versionReader: { versions.read($0) }
            )
        )

        _ = try provider.next()

        #expect(!FileManager.default.fileExists(atPath: abandoned.path))
        #expect(versions.callCount == 1)
    }

    @Test("the next managed invocation reaps an exact empty partial directory")
    func managedProviderScavengerReapsEmptyPartialDirectory() throws {
        let abandoned = try makeSyntheticAbandonedPin(state: .empty)
        defer { try? FileManager.default.removeItem(at: abandoned) }

        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                versionReader: { versions.read($0) }
            )
        )

        _ = try provider.next()

        #expect(!FileManager.default.fileExists(atPath: abandoned.path))
        #expect(versions.callCount == 1)
    }

    @Test("the next managed invocation preserves an abandoned pin with unknown entries")
    func managedProviderScavengerPreservesUnknownEntry() throws {
        let abandoned = try makeSyntheticAbandonedPin(state: .unknownEntry)
        defer { try? FileManager.default.removeItem(at: abandoned) }

        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                versionReader: { versions.read($0) }
            )
        )

        _ = try provider.next()

        #expect(FileManager.default.fileExists(atPath: abandoned.path))
        #expect(versions.callCount == 1)
    }

    @Test("create failure after lease removes only the exact partial objects")
    func managedProviderCreateFailureAfterLeaseCleansExactPartialState() throws {
        let before = try managedPinDirectories()
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        ManagedCodexPinnedExecutableTesting.injectCreateFailure(.afterLease)
        defer { ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil) }

        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(try managedPinDirectories() == before)
        #expect(versions.callCount == 0)
    }

    @Test("create failure after destination creation removes only the exact partial objects")
    func managedProviderCreateFailureAfterDestinationCreateCleansExactPartialState()
        throws
    {
        let before = try managedPinDirectories()
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        ManagedCodexPinnedExecutableTesting.injectCreateFailure(
            .afterDestinationCreate
        )
        defer { ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil) }

        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(try managedPinDirectories() == before)
        #expect(versions.callCount == 0)
    }

    @Test("create failure after a partial copy removes only the exact invalid executable")
    func managedProviderCreateFailureAfterPartialCopyCleansExactPartialState()
        throws
    {
        let before = try managedPinDirectories()
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        ManagedCodexPinnedExecutableTesting.injectCreateFailure(.afterPartialCopy)
        defer { ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil) }

        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(try managedPinDirectories() == before)
        #expect(versions.callCount == 0)
    }

    @Test("source drift is isolated while private pin drift fails without requalification")
    func managedProviderRejectsPrivatePinDriftWithoutRequalification() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1", "0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )
        let provider = ManagedCodexApprovedExecutableProvider(resolver: resolver)

        let pinned = try provider.next()
        let pinnedDirectory = pinned.deletingLastPathComponent()
        defer { try? FileManager.default.removeItem(at: pinnedDirectory) }
        try fixture.replaceTargetWithNativeExecutable(
            URL(fileURLWithPath: "/usr/bin/false")
        )
        #expect(try provider.next() == pinned)
        try replaceNativeExecutable(
            at: pinned,
            from: URL(fileURLWithPath: "/bin/echo")
        )

        do {
            _ = try provider.next()
            Issue.record("drifted private pin unexpectedly requalified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .approvalDrift)
        }
        #expect(versions.callCount == 1)
    }

    @Test("the first existing candidate is the only candidate ever version-probed")
    func firstExistingCandidateProbeFailureDoesNotFallThrough() throws {
        let first = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { first.remove() }
        try first.replaceTargetWithNativeExecutable()
        let second = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { second.remove() }
        try second.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.149.0", "0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [first.source, second.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        do {
            _ = try resolver.resolveApproved()
            Issue.record("unsupported first candidate unexpectedly fell through")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .unsupportedVersion("0.149.0"))
        }
        #expect(versions.callCount == 1)
    }

    @Test("safe NVM candidates use descending semantic version order")
    func safeNVMCandidatesUseSemanticVersionOrder() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "blabee-nvm-order-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        let home = root.appendingPathComponent("home", isDirectory: true)
        let versions = home.appendingPathComponent(
            ".nvm/versions/node",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: versions,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: versions.path
        )
        for name in [
            "v9.99.0", "v10.9.0", "v10.10.0", "v22.0.1",
            "v10.010.0", "current", "v23.0",
        ] {
            let version = versions.appendingPathComponent(
                name,
                isDirectory: true
            )
            let bin = version.appendingPathComponent("bin", isDirectory: true)
            try FileManager.default.createDirectory(
                at: bin,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: version.path
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: bin.path
            )
        }

        let candidates = ManagedCodexTrustResolver.safeNVMVersionCandidates(
            homeURL: home
        )

        #expect(candidates.map {
            $0.deletingLastPathComponent()
                .deletingLastPathComponent()
                .lastPathComponent
        } == ["v22.0.1", "v10.10.0", "v10.9.0", "v9.99.0"])
    }

    @Test("an unsafe first existing candidate fails before probing any later candidate")
    func firstExistingUnsafeCandidateDoesNotFallThrough() throws {
        let first = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { first.remove() }
        try first.replaceTargetWithNativeExecutable()
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: first.target.path
        )
        let second = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { second.remove() }
        try second.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [first.source, second.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(versions.callCount == 0)
    }

    @Test("unsafe managed candidates never execute a version process")
    func managedProviderRejectsDynamicShimBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            dynamicShimRootURLs: [fixture.source.deletingLastPathComponent()],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(versions.callCount == 0)
    }

    @Test("a hardlink to the running Blabee executable is excluded before version qualification")
    func managedProviderExcludesCoordinatorHardlinkBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let hardlink = fixture.root.appendingPathComponent(
            "coordinator-hardlink",
            isDirectory: false
        )
        try FileManager.default.linkItem(at: fixture.target, to: hardlink)
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            excludedExecutableURLs: [hardlink],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        #expect(throws: Error.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(versions.callCount == 0)
    }

    @Test("interpreter scripts are rejected before version qualification")
    func managedProviderRejectsInterpreterScriptBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(versions.callCount == 0)
    }

    @Test("unchanged strict path qualifies once and revalidates without a version read")
    func strictUnchangedApproval() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        let approval = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        let executable = try gate.revalidate(approval: approval)

        #expect(versions.callCount == 1)
        #expect(executable.stableSourceURL.path == fixture.source.path)
        #expect(executable.canonicalURL.path == fixture.target.path)
        #expect(executable.qualifiedVersion == "0.150.1")
        #expect(executable.targetIdentity == approval.targetIdentity)
    }

    @Test("non-Homebrew group-writable ancestry is rejected before version execution")
    func nonHomebrewGroupWriteFailsBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: true)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try fixture.gate(monitored: false).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
        }
        #expect(versions.callCount == 0)
    }

    @Test("configured dynamic shim roots are rejected before version execution")
    func dynamicShimFailsBeforeVersion() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let gate = CodexRuntimeTrustGate(
            monitoredEntries: [],
            dynamicShimRootURLs: [fixture.source.deletingLastPathComponent()]
        )

        do {
            _ = try gate.qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
            Issue.record("dynamic shim unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .dynamicShim("configured"))
        }
        #expect(versions.callCount == 0)
    }

    @Test("an exact monitored Homebrew-style source accepts 0775 ancestors")
    func monitoredHomebrewGroupWriteIsRevalidated() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: true)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let gate = fixture.gate(monitored: true)

        let approval = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        let executable = try gate.revalidate(approval: approval)

        #expect(versions.callCount == 1)
        #expect(executable.canonicalURL.path == fixture.target.path)
        #expect(approval.sourceAncestors.contains { $0.identity.mode & 0o020 != 0 })
        #expect(approval.canonicalAncestors.contains { $0.identity.mode & 0o020 != 0 })
    }

    @Test("a monitored Homebrew exception never covers ancestors above its prefix")
    func monitoredHomebrewRejectsGroupWriteAbovePrefix() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o770],
            ofItemAtPath: fixture.root.path
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try fixture.gate(monitored: true).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
        }
        #expect(versions.callCount == 0)
    }

    @Test("identity drift requests a full qualification and a new approval")
    func driftRequiresFullQualification() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)
        let versions = RuntimeTrustVersionProbe(["0.150.1", "0.150.1"])
        let first = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )

        try fixture.replaceTargetBody("printf 'updated-runtime-trust-fixture\\n'")
        do {
            _ = try gate.revalidate(approval: first)
            Issue.record("drifted approval unexpectedly revalidated")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .approvalDrift)
        }
        #expect(versions.callCount == 1)

        let second = try gate.qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )
        #expect(versions.callCount == 2)
        #expect(second.targetIdentity != first.targetIdentity)
        _ = try gate.revalidate(approval: second)
        #expect(versions.callCount == 2)
    }

    @Test("mutation during version qualification cannot publish an approval")
    func mutationDuringQualificationFailsClosed() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let gate = fixture.gate(monitored: false)

        do {
            _ = try gate.qualify(sourceURL: fixture.source) { _ in
                try fixture.replaceTargetBody("printf 'changed-during-version\\n'")
                return "0.150.1"
            }
            Issue.record("a moving executable unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .changedDuringQualification)
        }
    }

    @Test("unsupported versions fail after structural inspection")
    func unsupportedVersionFailsClosed() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let versions = RuntimeTrustVersionProbe(["0.149.0"])

        do {
            _ = try fixture.gate(monitored: false).qualify(
                sourceURL: fixture.source,
                versionReader: { versions.read($0) }
            )
            Issue.record("unsupported Codex unexpectedly qualified")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .unsupportedVersion("0.149.0"))
        }
        #expect(versions.callCount == 1)
    }

    @Test("world-writable targets and extended ACLs fail before version execution")
    func targetMetadataFailsClosed() throws {
        let writable = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { writable.remove() }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o777],
            ofItemAtPath: writable.target.path
        )
        let writableVersions = RuntimeTrustVersionProbe(["0.150.1"])
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try writable.gate(monitored: false).qualify(
                sourceURL: writable.source,
                versionReader: { writableVersions.read($0) }
            )
        }
        #expect(writableVersions.callCount == 0)

        let acl = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { acl.remove() }
        try addRuntimeTrustACL(at: acl.target)
        let aclVersions = RuntimeTrustVersionProbe(["0.150.1"])
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try acl.gate(monitored: false).qualify(
                sourceURL: acl.source,
                versionReader: { aclVersions.read($0) }
            )
        }
        #expect(aclVersions.callCount == 0)
    }

    @Test("deny-only ancestor ACLs are allowed but permission grants are not")
    func denyOnlyAncestorACLIsSafe() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try addRuntimeTrustACL(
            at: fixture.prefix,
            rule: "group:everyone deny delete"
        )
        let versions = RuntimeTrustVersionProbe(["0.150.1"])

        _ = try fixture.gate(monitored: false).qualify(
            sourceURL: fixture.source,
            versionReader: { versions.read($0) }
        )

        #expect(versions.callCount == 1)
    }

}

private final class RuntimeTrustFixture: @unchecked Sendable {
    let root: URL
    let prefix: URL
    let source: URL
    let canonicalRoot: URL
    let target: URL

    init(groupWritableAncestors: Bool) throws {
        // Resolve `/var` before constructing the fixture so every lexical
        // ancestor is a real directory and `/var` itself is not mistaken for
        // a symbolic-link ancestor. Deny-only macOS home ACLs are covered by
        // a separate test and are intentionally allowed.
        let temporaryPath = FileManager.default.temporaryDirectory.path
        let realTemporaryPath = temporaryPath.hasPrefix("/var/")
            ? "/private" + temporaryPath
            : temporaryPath
        let base = URL(fileURLWithPath: realTemporaryPath, isDirectory: true)
            .appendingPathComponent("codex-runtime-trust-tests", isDirectory: true)
        try RuntimeTrustFixture.makeDirectory(base, mode: 0o700)
        root = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        prefix = root.appendingPathComponent("homebrew", isDirectory: true)
        source = prefix.appendingPathComponent("bin/codex", isDirectory: false)
        canonicalRoot = prefix.appendingPathComponent("Cellar", isDirectory: true)
        target = canonicalRoot.appendingPathComponent(
            "codex/0.150.1/bin/codex",
            isDirectory: false
        )

        let directories = [
            root,
            prefix,
            source.deletingLastPathComponent(),
            canonicalRoot,
            canonicalRoot.appendingPathComponent("codex", isDirectory: true),
            canonicalRoot.appendingPathComponent("codex/0.150.1", isDirectory: true),
            target.deletingLastPathComponent(),
        ]
        for directory in directories {
            try Self.makeDirectory(
                directory,
                mode: groupWritableAncestors && directory != root ? 0o775 : 0o700
            )
        }
        try replaceTargetBody("printf 'runtime-trust-fixture\\n'")
        try FileManager.default.createSymbolicLink(
            at: source,
            withDestinationURL: target
        )
    }

    func gate(monitored: Bool) -> CodexRuntimeTrustGate {
        CodexRuntimeTrustGate(
            monitoredEntries: monitored ? [
                CodexRuntimeMonitoredEntry(
                    stableSourceURL: source,
                    canonicalRootURLs: [canonicalRoot]
                ),
            ] : []
        )
    }

    func replaceTargetBody(_ body: String) throws {
        try Data(("#!/bin/zsh\nset -eu\n" + body + "\n").utf8).write(to: target)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: target.path
        )
    }

    func replaceTargetWithNativeExecutable(
        _ sourceURL: URL = URL(fileURLWithPath: "/usr/bin/true")
    ) throws {
        try Data(contentsOf: sourceURL).write(to: target)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: target.path
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    private static func makeDirectory(_ url: URL, mode: Int) throws {
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: mode]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: mode],
            ofItemAtPath: url.path
        )
    }
}

private final class RuntimeTrustVersionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let versions: [String?]
    private var calls = 0
    private var urls: [URL] = []

    init(_ versions: [String?]) {
        self.versions = versions
    }

    var callCount: Int {
        lock.withLock { calls }
    }

    var requestedURLs: [URL] {
        lock.withLock { urls }
    }

    func read(_ url: URL) -> String? {
        lock.withLock {
            let index = min(calls, max(0, versions.count - 1))
            calls += 1
            urls.append(url)
            return versions.isEmpty ? nil : versions[index]
        }
    }
}

private func replaceNativeExecutable(at target: URL, from source: URL) throws {
    try FileManager.default.removeItem(at: target)
    try Data(contentsOf: source).write(to: target)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o500],
        ofItemAtPath: target.path
    )
}

private func makeSyntheticAbandonedPin() throws -> URL {
    try makeSyntheticAbandonedPin(state: .nativeExecutable)
}

private func managedPinDirectories() throws -> Set<String> {
    let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
    let entries = try FileManager.default.contentsOfDirectory(
        atPath: parent.path
    )
    return Set(entries.filter {
        $0.hasPrefix("blabee-managed-codex.")
    })
}

private enum SyntheticAbandonedPinState {
    case empty
    case leaseOnly
    case partialExecutable
    case nativeExecutable
    case unknownEntry
}

private func makeSyntheticAbandonedPin(
    state: SyntheticAbandonedPinState
) throws -> URL {
    let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
    let directory = parent.appendingPathComponent(
        "blabee-managed-codex.\(UUID().uuidString)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: directory.path
    )
    if state != .empty {
        let lease = directory.appendingPathComponent(".lease", isDirectory: false)
        try Data().write(to: lease)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: lease.path
        )
    }
    if state == .partialExecutable || state == .nativeExecutable
        || state == .unknownEntry
    {
        let executable = directory.appendingPathComponent("codex", isDirectory: false)
        if state == .partialExecutable {
            try Data().write(to: executable)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o500],
                ofItemAtPath: executable.path
            )
        } else {
            try Data(contentsOf: URL(fileURLWithPath: "/usr/bin/true")).write(
                to: executable
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o500],
                ofItemAtPath: executable.path
            )
        }
    }
    if state == .unknownEntry {
        let unexpected = directory.appendingPathComponent(
            "user-owned-unexpected",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unexpected)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: unexpected.path
        )
    }
    try FileManager.default.setAttributes(
        [.modificationDate: Date(timeIntervalSinceNow: -120)],
        ofItemAtPath: directory.path
    )
    return directory
}

private func addRuntimeTrustACL(
    at url: URL,
    rule: String = "user:\(NSUserName()) allow read"
) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/chmod")
    process.arguments = ["+a", rule, url.path]
    process.standardOutput = Pipe()
    let error = Pipe()
    process.standardError = error
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        let message = String(
            data: error.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? "unknown chmod error"
        throw RuntimeTrustFixtureError.aclSetup(message)
    }
}

private enum RuntimeTrustFixtureError: Error {
    case aclSetup(String)
}
