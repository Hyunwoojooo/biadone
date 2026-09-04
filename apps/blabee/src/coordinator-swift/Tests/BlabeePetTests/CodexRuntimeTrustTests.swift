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
        let privateRoot = first.deletingLastPathComponent()
            .deletingLastPathComponent()
        #expect(try runtimeMode(privateRoot) == 0o700)
        #expect(try runtimeMode(privateRoot.appendingPathComponent("bin"))
            == 0o700)
        #expect(try runtimeMode(first) == 0o500)
        #expect(try runtimeMode(privateRoot.appendingPathComponent(
            "bin/codex-code-mode-host"
        )) == 0o500)
        #expect(try runtimeMode(privateRoot.appendingPathComponent(
            "codex-path/rg"
        )) == 0o500)
        #expect(try runtimeMode(privateRoot.appendingPathComponent(
            "codex-package.json"
        )) == 0o400)
        #expect(try runtimeMode(privateRoot.appendingPathComponent(".lease"))
            == 0o600)
        #expect(try runtimeMode(privateRoot.appendingPathComponent(
            ".blabee-runtime-manifest.json"
        )) == 0o400)
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
            runtimeExecutableVerification: .trustedTestFixture,
            versionReader: { versions.read($0) }
        )

        let first = try provider.next()
        let second = try provider.next()

        #expect(first == second)
        #expect(first != fixture.source)
        #expect(first != fixture.target)
        #expect(first.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent() == fixture.root)
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
        try fixture.installRuntimeBundle(for: candidate)
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = try ManagedCodexApprovedExecutableProvider.live(
            environment: [
                "HOME": home.path,
                "PATH": "/nonexistent-managed-codex-bin",
            ],
            pinParentURL: fixture.root,
            runtimeExecutableVerification: .trustedTestFixture,
            versionReader: { versions.read($0) }
        )

        let first = try provider.next()
        let second = try provider.next()

        #expect(first == second)
        #expect(first != candidate)
        #expect(first.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent() == fixture.root)
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
                    runtimeExecutableVerification: .trustedTestFixture,
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
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
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
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
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
            .deletingLastPathComponent() == parentFixture.prefix)
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
            .deletingLastPathComponent()
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
            .deletingLastPathComponent()
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
            .deletingLastPathComponent()
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

    @Test("create failure after a complete copy still removes exact staging")
    func managedProviderCreateFailureAfterCompleteCopyCleansExactStaging()
        throws
    {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            pinParentURL: fixture.root,
            versionReader: { versions.read($0) }
        )

        ManagedCodexPinnedExecutableTesting.injectCreateFailure(
            .afterDestinationCopy
        )
        defer { ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil) }

        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        let remaining = try FileManager.default.contentsOfDirectory(
            atPath: fixture.root.path
        ).filter { $0.hasPrefix("blabee-managed-codex.") }
        #expect(remaining.isEmpty)
        #expect(versions.callCount == 0)
    }

    @Test("abandoned runtime staging is lease aware and preserves unknown data")
    func abandonedRuntimeStagingRecoveryIsExactAndLeaseAware() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            pinParentURL: fixture.root,
            versionReader: { versions.read($0) }
        )
        ManagedCodexPinnedExecutableTesting.preserveFailedRuntimeStaging(true)
        ManagedCodexPinnedExecutableTesting.injectCreateFailure(
            .afterDestinationCopy
        )
        defer {
            ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil)
            ManagedCodexPinnedExecutableTesting
                .preserveFailedRuntimeStaging(false)
        }
        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil)
        ManagedCodexPinnedExecutableTesting.preserveFailedRuntimeStaging(false)

        let stagingName = try #require(
            FileManager.default.contentsOfDirectory(atPath: fixture.root.path)
                .first(where: {
                    $0.hasPrefix("blabee-managed-codex.staging.")
                })
        )
        let staging = fixture.root.appendingPathComponent(
            stagingName,
            isDirectory: true
        )
        let lease = staging.appendingPathComponent(".lease", isDirectory: false)
        let leaseDescriptor = Darwin.open(lease.path, O_RDWR | O_NOFOLLOW)
        #expect(leaseDescriptor >= 0)
        guard leaseDescriptor >= 0 else { return }
        defer { Darwin.close(leaseDescriptor) }
        #expect(flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0)
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(FileManager.default.fileExists(atPath: staging.path))
        _ = flock(leaseDescriptor, LOCK_UN)

        let unknown = staging.appendingPathComponent(
            "unexpected-user-data",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unknown)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o400],
            ofItemAtPath: unknown.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(FileManager.default.fileExists(atPath: staging.path))

        try FileManager.default.removeItem(at: unknown)
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(!FileManager.default.fileExists(atPath: staging.path))
        #expect(versions.callCount == 0)
    }

    @Test("published but unmarked runtime staging is recovered on next start")
    func publishedRuntimeStagingRecoveryIsDurable() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [fixture.source],
            monitoredEntries: [],
            pinParentURL: fixture.root,
            versionReader: { versions.read($0) }
        )
        ManagedCodexPinnedExecutableTesting.injectCreateFailure(
            .afterStagingPublish
        )
        defer { ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil) }
        #expect(throws: ManagedCodexPinnedExecutableInjectedFailure.self) {
            _ = try resolver.resolveApproved()
        }
        ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil)

        let candidateName = try #require(
            FileManager.default.contentsOfDirectory(atPath: fixture.root.path)
                .first(where: {
                    $0.hasPrefix("blabee-managed-codex.")
                        && !$0.hasPrefix("blabee-managed-codex.staging.")
                })
        )
        let candidate = fixture.root.appendingPathComponent(
            candidateName,
            isDirectory: true
        )
        #expect(FileManager.default.fileExists(atPath: candidate
            .appendingPathComponent(".blabee-runtime-staging.json").path))

        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(!FileManager.default.fileExists(atPath: candidate.path))
        #expect(versions.callCount == 0)
    }

    @Test("hostile staging timestamps preserve the candidate without trapping")
    func abandonedRuntimeStagingRejectsOverflowingAndFutureAges() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let staging = try makePreservedRuntimeStaging(in: fixture)
        let plan = staging.appendingPathComponent(
            ".blabee-runtime-staging.json",
            isDirectory: false
        )

        for hostileTimestamp in [Int64.min, Int64.max] {
            try rewriteStagingPlanTimestamp(
                at: plan,
                createdAtSeconds: hostileTimestamp
            )
            try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
                in: fixture.root
            )
            #expect(FileManager.default.fileExists(atPath: staging.path))
        }

        try rewriteStagingPlanTimestamp(
            at: plan,
            createdAtSeconds: Int64(Date().timeIntervalSince1970)
        )
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: 3_600)],
            ofItemAtPath: staging.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(FileManager.default.fileExists(atPath: staging.path))
    }

    @Test("crowded shared parent does not hide an exact abandoned runtime")
    func abandonedRuntimeStagingIgnoresUnrelatedParentEntries() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let staging = try makePreservedRuntimeStaging(in: fixture)
        var unrelated: [URL] = []
        for index in 0..<4_105 {
            let entry = fixture.root.appendingPathComponent(
                "unrelated-\(index)",
                isDirectory: false
            )
            try Data().write(to: entry)
            unrelated.append(entry)
        }

        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )

        #expect(!FileManager.default.fileExists(atPath: staging.path))
        #expect(unrelated.allSatisfy {
            FileManager.default.fileExists(atPath: $0.path)
        })
    }

    @Test("over-limit managed names are scavenged through bounded windows")
    func abandonedRuntimeStagingMakesBoundedProgress() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let prefix = "blabee-managed-codex.staging."
        let batchSize = ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
        let total = batchSize + 6
        for index in 0..<total {
            let identifier = String(
                format: "00000000-0000-0000-0000-%012llx",
                UInt64(index + 1)
            )
            let name = prefix + identifier
            let candidate = fixture.root.appendingPathComponent(
                name,
                isDirectory: true
            )
            try FileManager.default.createDirectory(
                at: candidate,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: candidate.path
            )
        }
        let unrelated = fixture.root.appendingPathComponent(
            "unrelated-user-file",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unrelated)

        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )

        let firstRemainder = try FileManager.default.contentsOfDirectory(
            atPath: fixture.root.path
        ).filter { $0.hasPrefix(prefix) }.sorted()
        #expect(firstRemainder.isEmpty)
        #expect(FileManager.default.fileExists(atPath: unrelated.path))

        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        let secondRemainder = try FileManager.default.contentsOfDirectory(
            atPath: fixture.root.path
        ).filter { $0.hasPrefix(prefix) }
        #expect(secondRemainder.isEmpty)
        #expect(FileManager.default.fileExists(atPath: unrelated.path))
    }

    @Test("protected first window cannot starve later removable runtimes")
    func abandonedRuntimeStagingAdvancesPastProtectedWindow() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        let prefix = "blabee-managed-codex.staging."
        let protectedCount =
            ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
        var protectedNames: [String] = []
        var removableNames: [String] = []
        for index in 0..<(protectedCount + 6) {
            let identifier = String(
                format: "00000000-0000-0000-0000-%012llx",
                UInt64(index + 1)
            )
            let name = prefix + identifier
            let candidate = fixture.root.appendingPathComponent(
                name,
                isDirectory: true
            )
            let isProtected = index < protectedCount
            try FileManager.default.createDirectory(
                at: candidate,
                withIntermediateDirectories: false,
                attributes: [
                    .posixPermissions: isProtected ? 0o755 : 0o700,
                ]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: isProtected ? 0o755 : 0o700],
                ofItemAtPath: candidate.path
            )
            if isProtected {
                protectedNames.append(name)
            } else {
                removableNames.append(name)
            }
        }
        let unrelated = fixture.root.appendingPathComponent(
            "unrelated-user-file",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unrelated)

        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )

        let remaining = Set(try FileManager.default.contentsOfDirectory(
            atPath: fixture.root.path
        ))
        #expect(protectedNames.allSatisfy(remaining.contains))
        #expect(removableNames.allSatisfy { !remaining.contains($0) })
        #expect(FileManager.default.fileExists(atPath: unrelated.path))
    }

    @Test("partial staging plan recovery is exact and fail closed")
    func abandonedRuntimeStagingRecoversOnlyReservedPartialPlan() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()

        let removable = try makePreservedRuntimeStaging(in: fixture)
        try replacePublishedPlanWithPartial(in: removable)
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(!FileManager.default.fileExists(atPath: removable.path))

        let preserved = try makePreservedRuntimeStaging(in: fixture)
        try replacePublishedPlanWithPartial(in: preserved)
        let unknown = preserved.appendingPathComponent(
            "unexpected-user-data",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: unknown)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o400],
            ofItemAtPath: unknown.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(FileManager.default.fileExists(atPath: preserved.path))
        #expect(FileManager.default.fileExists(atPath: unknown.path))

        try FileManager.default.removeItem(at: unknown)
        let partial = preserved.appendingPathComponent(
            ".blabee-runtime-staging.json.partial",
            isDirectory: false
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: partial.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: fixture.root
        )
        #expect(FileManager.default.fileExists(atPath: preserved.path))
    }

    @Test("unchanged private runtime revalidation performs no full signature walk")
    func unchangedPrivateRuntimeRevalidationIsMetadataOnly() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [fixture.source],
                monitoredEntries: [],
                pinParentURL: fixture.root,
                versionReader: { versions.read($0) }
            )
        )
        let first = try provider.next()
        let signatureProbe = RuntimeSignatureValidationProbe()
        try ManagedCodexRuntimeBundleInspector.withSignatureValidationHook(
            { _, _ in signatureProbe.record() }
        ) { () throws -> Void in
            let second = try provider.next()
            let third = try provider.next()
            let fourth = try provider.next()
            #expect(second == first)
            #expect(third == first)
            #expect(fourth == first)
        }
        #expect(signatureProbe.callCount == 0)
        #expect(versions.callCount == 1)
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
            .deletingLastPathComponent()
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

        #expect(throws: ManagedCodexRuntimeBundleError.self) {
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

    @Test("a complete closed runtime bundle is inspected as one trust subject")
    func completeRuntimeBundleIsAccepted() throws {
        let fixture = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { fixture.remove() }
        try fixture.replaceTargetWithNativeExecutable()

        let inspection = try ManagedCodexRuntimeBundleInspector.inspect(
            executableURL: fixture.target,
            executableVerification: .trustedTestFixture
        )

        #expect(inspection.rootURL == fixture.runtimeRoot)
        #expect(inspection.executableURL == fixture.target)
        #expect(inspection.codeModeHostURL == fixture.host)
        #expect(inspection.pathDirectoryURL == fixture.ripgrep
            .deletingLastPathComponent())
        #expect(inspection.manifestVersion == "0.150.1")
        #expect(inspection.target
            == ManagedCodexRuntimeBundleInspector.expectedTarget)
    }

    @Test("the host and ripgrep companions are mandatory")
    func mandatoryCompanionsCannotBeMissing() throws {
        let missingHost = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { missingHost.remove() }
        try missingHost.replaceTargetWithNativeExecutable()
        try FileManager.default.removeItem(at: missingHost.host)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: missingHost.target,
                executableVerification: .trustedTestFixture
            )
        }

        let missingRipgrep = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { missingRipgrep.remove() }
        try missingRipgrep.replaceTargetWithNativeExecutable()
        try FileManager.default.removeItem(at: missingRipgrep.ripgrep)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: missingRipgrep.target,
                executableVerification: .trustedTestFixture
            )
        }
    }

    @Test("host and ripgrep unsafe permissions or ACLs fail closed")
    func companionMetadataFailsClosed() throws {
        let writableHost = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { writableHost.remove() }
        try writableHost.replaceTargetWithNativeExecutable()
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o775],
            ofItemAtPath: writableHost.host.path
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: writableHost.target,
                executableVerification: .trustedTestFixture
            )
        }

        let aclRipgrep = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { aclRipgrep.remove() }
        try aclRipgrep.replaceTargetWithNativeExecutable()
        try addRuntimeTrustACL(at: aclRipgrep.ripgrep)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: aclRipgrep.target,
                executableVerification: .trustedTestFixture
            )
        }
    }

    @Test("links and special files are rejected without blocking")
    func unsafeCompanionFileTypesAreRejected() throws {
        let symbolic = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { symbolic.remove() }
        try symbolic.replaceTargetWithNativeExecutable()
        try FileManager.default.removeItem(at: symbolic.host)
        try FileManager.default.createSymbolicLink(
            at: symbolic.host,
            withDestinationURL: URL(fileURLWithPath: "/usr/bin/true")
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: symbolic.target,
                executableVerification: .trustedTestFixture
            )
        }

        let special = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { special.remove() }
        try special.replaceTargetWithNativeExecutable()
        try FileManager.default.removeItem(at: special.host)
        try #require(mkfifo(special.host.path, mode_t(0o500)) == 0)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: special.target,
                executableVerification: .trustedTestFixture
            )
        }

        let hardlink = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { hardlink.remove() }
        try hardlink.replaceTargetWithNativeExecutable()
        try FileManager.default.removeItem(at: hardlink.host)
        try FileManager.default.linkItem(at: hardlink.target, to: hardlink.host)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: hardlink.target,
                executableVerification: .trustedTestFixture
            )
        }
    }

    @Test("manifest paths, duplicate keys, nulls, and unknown root entries fail closed")
    func closedManifestAndRootRejectAmbiguity() throws {
        let traversal = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { traversal.remove() }
        try traversal.replaceTargetWithNativeExecutable()
        try traversal.writeManifest(entrypoint: "../bin/codex")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: traversal.target,
                executableVerification: .trustedTestFixture
            )
        }

        let absolutePathDir = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { absolutePathDir.remove() }
        try absolutePathDir.replaceTargetWithNativeExecutable()
        try absolutePathDir.writeManifest(pathDir: "/tmp/codex-path")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: absolutePathDir.target,
                executableVerification: .trustedTestFixture
            )
        }

        let traversalResources = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { traversalResources.remove() }
        try traversalResources.replaceTargetWithNativeExecutable()
        try traversalResources.writeManifest(resourcesDir: "../resources")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: traversalResources.target,
                executableVerification: .trustedTestFixture
            )
        }

        let duplicate = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { duplicate.remove() }
        try duplicate.replaceTargetWithNativeExecutable()
        try duplicate.writeRawManifest(
            #"{"entrypoint":"bin/codex","layoutVersion":1,"layoutVersion":1,"pathDir":"codex-path","target":"\#(ManagedCodexRuntimeBundleInspector.expectedTarget)","variant":"codex","version":"0.150.1"}"#
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: duplicate.target,
                executableVerification: .trustedTestFixture
            )
        }

        let nullResources = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { nullResources.remove() }
        try nullResources.replaceTargetWithNativeExecutable()
        try nullResources.writeRawManifest(
            #"{"entrypoint":"bin/codex","layoutVersion":1,"pathDir":"codex-path","resourcesDir":null,"target":"\#(ManagedCodexRuntimeBundleInspector.expectedTarget)","variant":"codex","version":"0.150.1"}"#
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: nullResources.target,
                executableVerification: .trustedTestFixture
            )
        }

        let unknownField = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { unknownField.remove() }
        try unknownField.replaceTargetWithNativeExecutable()
        try unknownField.writeRawManifest(
            #"{"entrypoint":"bin/codex","layoutVersion":1,"pathDir":"codex-path","target":"\#(ManagedCodexRuntimeBundleInspector.expectedTarget)","unexpected":true,"variant":"codex","version":"0.150.1"}"#
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: unknownField.target,
                executableVerification: .trustedTestFixture
            )
        }

        let unknown = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { unknown.remove() }
        try unknown.replaceTargetWithNativeExecutable()
        try Data("unknown".utf8).write(to: unknown.runtimeRoot
            .appendingPathComponent("unexpected", isDirectory: false))
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: unknown.target,
                executableVerification: .trustedTestFixture
            )
        }
    }

    @Test("layout, target, qualified version, and 0.152 mismatches fail closed")
    func bundleMetadataMustMatchQualification() throws {
        let layout = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { layout.remove() }
        try layout.replaceTargetWithNativeExecutable()
        try layout.writeManifest(layoutVersion: 2)
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: layout.target,
                executableVerification: .trustedTestFixture
            )
        }

        let target = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { target.remove() }
        try target.replaceTargetWithNativeExecutable()
        try target.writeManifest(target: "unsupported-apple-darwin")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: target.target,
                executableVerification: .trustedTestFixture
            )
        }

        let version = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { version.remove() }
        try version.replaceTargetWithNativeExecutable()
        try version.writeManifest(version: "0.150.0")
        let versions = RuntimeTrustVersionProbe(["0.150.1"])
        let resolver = ManagedCodexTrustResolver(
            candidateURLs: [version.source],
            monitoredEntries: [],
            versionReader: { versions.read($0) }
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try resolver.resolveApproved()
        }
        #expect(versions.callCount == 1)

        let future = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { future.remove() }
        try future.replaceTargetWithNativeExecutable()
        try future.writeManifest(version: "0.152.0")
        let futureVersions = RuntimeTrustVersionProbe(["0.152.0"])
        let futureResolver = ManagedCodexTrustResolver(
            candidateURLs: [future.source],
            monitoredEntries: [],
            versionReader: { futureVersions.read($0) }
        )
        #expect(throws: CodexRuntimeTrustError.self) {
            _ = try futureResolver.resolveApproved()
        }
        #expect(futureVersions.callCount == 1)
    }

    @Test("managed runtime catalog rejects unregistered and mismatched builds before a child")
    func runtimeBuildQualificationFailsClosed() throws {
        let unregistered = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { unregistered.remove() }
        try unregistered.replaceTargetWithNativeExecutable()
        let unregisteredInspection = try ManagedCodexRuntimeBundleInspector
            .inspect(
                executableURL: unregistered.target,
                executableVerification: .trustedTestFixture
            )
        #expect(throws: ManagedCodexRuntimeBundleQualificationError.self) {
            try ManagedCodexRuntimeBundleQualificationCatalog
                .requireProductionQualificationForTesting(
                    unregisteredInspection
                )
        }

        let mismatched = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { mismatched.remove() }
        try mismatched.replaceTargetWithNativeExecutable()
        try mismatched.writeManifest(version: "0.151.0")
        let mismatchedInspection = try ManagedCodexRuntimeBundleInspector.inspect(
            executableURL: mismatched.target,
            executableVerification: .trustedTestFixture
        )
        #expect(throws: ManagedCodexRuntimeBundleQualificationError.self) {
            try ManagedCodexRuntimeBundleQualificationCatalog
                .requireProductionQualificationForTesting(mismatchedInspection)
        }
    }

    @Test("the audited Homebrew 0.151 arm64 bundle matches its catalog fingerprint")
    func auditedProductionBundleMatchesCatalogWhenInstalled() throws {
        let environment = ProcessInfo.processInfo.environment
        let executable = URL(
            fileURLWithPath: environment["BLABEE_CODEX_RUNTIME_ARTIFACT"]
                ?? "/opt/homebrew/Caskroom/codex/0.151.0/bin/codex",
            isDirectory: false
        )
        guard FileManager.default.fileExists(atPath: executable.path) else {
            if environment["BLABEE_REQUIRE_CODEX_RUNTIME_ARTIFACT"] == "1" {
                Issue.record(
                    "required production Codex runtime artifact is missing"
                )
            }
            return
        }
        let inspection = try ManagedCodexRuntimeBundleInspector.inspect(
            executableURL: executable,
            executableVerification: .production
        )

        #expect(ManagedCodexRuntimeBundleQualificationCatalog
            .fingerprintForTesting(inspection)
            == "3519a4614dbea34f15941b0886e29aa4c9a961b5b40bab942a3f38f61cc8eef9")
        try ManagedCodexRuntimeBundleQualificationCatalog.requireQualified(
            inspection
        )
    }

    @Test("optional resources are accepted but depth and entry count are bounded")
    func resourceTreeIsClosedAndBounded() throws {
        let valid = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { valid.remove() }
        try valid.replaceTargetWithNativeExecutable()
        let resources = valid.runtimeRoot.appendingPathComponent(
            "codex-resources",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: resources,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        try Data("resource".utf8).write(to: resources.appendingPathComponent(
            "defaults.json",
            isDirectory: false
        ))
        try valid.writeManifest(resourcesDir: "codex-resources")
        let inspection = try ManagedCodexRuntimeBundleInspector.inspect(
            executableURL: valid.target,
            executableVerification: .trustedTestFixture
        )
        #expect(inspection.resourcesDirectoryURL == resources)

        let deep = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { deep.remove() }
        try deep.replaceTargetWithNativeExecutable()
        var current = deep.runtimeRoot.appendingPathComponent(
            "codex-resources",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: current,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        for index in 0...ManagedCodexRuntimeBundleInspector.maximumDirectoryDepth {
            current.appendPathComponent("d\(index)", isDirectory: true)
            try FileManager.default.createDirectory(
                at: current,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
        }
        try deep.writeManifest(resourcesDir: "codex-resources")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: deep.target,
                executableVerification: .trustedTestFixture
            )
        }

        let crowded = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { crowded.remove() }
        try crowded.replaceTargetWithNativeExecutable()
        let crowdedResources = crowded.runtimeRoot.appendingPathComponent(
            "codex-resources",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: crowdedResources,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        let crowdedDescriptor = open(
            crowdedResources.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        try #require(crowdedDescriptor >= 0)
        defer { close(crowdedDescriptor) }
        for index in 0...ManagedCodexRuntimeBundleInspector.maximumEntryCount {
            let descriptor = openat(
                crowdedDescriptor,
                "f\(index)",
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                mode_t(0o600)
            )
            try #require(descriptor >= 0)
            close(descriptor)
        }
        try crowded.writeManifest(resourcesDir: "codex-resources")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: crowded.target,
                executableVerification: .trustedTestFixture
            )
        }

        let noncanonical = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { noncanonical.remove() }
        try noncanonical.replaceTargetWithNativeExecutable()
        let noncanonicalResources = noncanonical.runtimeRoot
            .appendingPathComponent("codex-resources", isDirectory: true)
        try FileManager.default.createDirectory(
            at: noncanonicalResources,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        let decomposedName = "e\u{301}.txt"
        let noncanonicalDescriptor = open(
            noncanonicalResources.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        try #require(noncanonicalDescriptor >= 0)
        let decomposedFile = openat(
            noncanonicalDescriptor,
            decomposedName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        close(noncanonicalDescriptor)
        try #require(decomposedFile >= 0)
        close(decomposedFile)
        try noncanonical.writeManifest(resourcesDir: "codex-resources")
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: noncanonical.target,
                executableVerification: .trustedTestFixture
            )
        }
    }

    @Test("signer, architecture, and named-path ABA evidence fail closed")
    func executableEvidenceIsBoundToTheOpenedFiles() throws {
        let signer = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { signer.remove() }
        try signer.replaceTargetWithNativeExecutable()
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: signer.target,
                executableVerification: .mismatchedTeamTestFixture
            )
        }

        let architecture = try RuntimeTrustFixture(
            groupWritableAncestors: false
        )
        defer { architecture.remove() }
        try architecture.replaceTargetWithNativeExecutable()
        #if arch(arm64)
            let otherCPU: UInt32 = 0x0100_0007
        #else
            let otherCPU: UInt32 = 0x0100_000C
        #endif
        let wrongArchitecture: [UInt8] = [
            0xcf, 0xfa, 0xed, 0xfe,
            UInt8(otherCPU & 0xff), UInt8((otherCPU >> 8) & 0xff),
            UInt8((otherCPU >> 16) & 0xff), UInt8((otherCPU >> 24) & 0xff),
        ]
        try Data(wrongArchitecture).write(to: architecture.host)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: architecture.host.path
        )
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: architecture.target,
                executableVerification: .trustedTestFixture
            )
        }

        let aba = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { aba.remove() }
        try aba.replaceTargetWithNativeExecutable()
        let backup = aba.host.appendingPathExtension("original")
        try ManagedCodexRuntimeBundleInspector.withSignatureValidationHook(
            { label, path in
                guard label == "bin/codex-code-mode-host",
                      URL(fileURLWithPath: path).standardizedFileURL
                        == aba.host.standardizedFileURL
                else { return }
                try FileManager.default.moveItem(at: aba.host, to: backup)
                do {
                    try Data(contentsOf: URL(fileURLWithPath: "/usr/bin/false"))
                        .write(to: aba.host)
                    try FileManager.default.setAttributes(
                        [.posixPermissions: 0o755],
                        ofItemAtPath: aba.host.path
                    )
                    try FileManager.default.removeItem(at: aba.host)
                    try FileManager.default.moveItem(at: backup, to: aba.host)
                } catch {
                    try? FileManager.default.removeItem(at: aba.host)
                    try? FileManager.default.moveItem(at: backup, to: aba.host)
                    throw error
                }
            }
        ) { () -> Void in
            #expect(throws: ManagedCodexRuntimeBundleError.self) {
                _ = try ManagedCodexRuntimeBundleInspector.inspect(
                    executableURL: aba.target,
                    executableVerification: .trustedTestFixture
                )
            }
        }
    }

    @Test("source mutation during copy and private host drift never execute")
    func bundleMutationFailsBeforeReuse() throws {
        let source = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { source.remove() }
        try source.replaceTargetWithNativeExecutable()
        let before = try managedPinDirectories()
        let sourceVersions = RuntimeTrustVersionProbe(["0.150.1"])
        let sourceResolver = ManagedCodexTrustResolver(
            candidateURLs: [source.source],
            monitoredEntries: [],
            versionReader: { sourceVersions.read($0) }
        )
        ManagedCodexPinnedExecutableTesting.beforeRuntimeSourceRevalidation {
            try Data(contentsOf: URL(fileURLWithPath: "/usr/bin/false"))
                .write(to: source.host)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o755],
                ofItemAtPath: source.host.path
            )
        }
        defer {
            ManagedCodexPinnedExecutableTesting
                .beforeRuntimeSourceRevalidation(nil)
        }
        #expect(throws: ManagedCodexRuntimeBundleError.self) {
            _ = try sourceResolver.resolveApproved()
        }
        #expect(sourceVersions.callCount == 0)
        #expect(try managedPinDirectories() == before)

        let pinned = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { pinned.remove() }
        try pinned.replaceTargetWithNativeExecutable()
        let pinnedVersions = RuntimeTrustVersionProbe(["0.150.1"])
        let provider = ManagedCodexApprovedExecutableProvider(
            resolver: ManagedCodexTrustResolver(
                candidateURLs: [pinned.source],
                monitoredEntries: [],
                versionReader: { pinnedVersions.read($0) }
            )
        )
        let executable = try provider.next()
        let host = executable.deletingLastPathComponent()
            .appendingPathComponent("codex-code-mode-host", isDirectory: false)
        try replaceNativeExecutable(
            at: host,
            from: URL(fileURLWithPath: "/usr/bin/false")
        )
        do {
            _ = try provider.next()
            Issue.record("drifted private host unexpectedly revalidated")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .approvalDrift)
        }
        #expect(pinnedVersions.callCount == 1)
    }

    @Test("private runtime permission drift is never absorbed into its baseline")
    func privateRuntimePermissionDriftFailsClosed() throws {
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
        let executable = try provider.next()
        let host = executable.deletingLastPathComponent()
            .appendingPathComponent("codex-code-mode-host", isDirectory: false)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: host.path
        )

        do {
            _ = try provider.next()
            Issue.record("private permission drift unexpectedly revalidated")
        } catch let error as CodexRuntimeTrustError {
            #expect(error == .approvalDrift)
        }
        #expect(versions.callCount == 1)
    }

    @Test("sealed runtime cleanup honors leases and exact unknown-entry checks")
    func sealedRuntimeScavengingIsExactAndLeaseAware() throws {
        let active = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { active.remove() }
        try active.replaceTargetWithNativeExecutable()
        let activeVersions = RuntimeTrustVersionProbe(["0.150.1"])
        var activeProvider: ManagedCodexApprovedExecutableProvider? =
            ManagedCodexApprovedExecutableProvider(
                resolver: ManagedCodexTrustResolver(
                    candidateURLs: [active.source],
                    monitoredEntries: [],
                    pinParentURL: active.root,
                    versionReader: { activeVersions.read($0) }
                )
            )
        let activeExecutable = try activeProvider!.next()
        let activeRoot = activeExecutable.deletingLastPathComponent()
            .deletingLastPathComponent()
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -120)],
            ofItemAtPath: activeRoot.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: active.root
        )
        #expect(FileManager.default.fileExists(atPath: activeRoot.path))
        activeProvider = nil
        #expect(!FileManager.default.fileExists(atPath: activeRoot.path))

        let abandoned = try RuntimeTrustFixture(groupWritableAncestors: false)
        defer { abandoned.remove() }
        try abandoned.replaceTargetWithNativeExecutable()
        let abandonedVersions = RuntimeTrustVersionProbe(["0.150.1"])
        var abandonedProvider: ManagedCodexApprovedExecutableProvider? =
            ManagedCodexApprovedExecutableProvider(
                resolver: ManagedCodexTrustResolver(
                    candidateURLs: [abandoned.source],
                    monitoredEntries: [],
                    pinParentURL: abandoned.root,
                    versionReader: { abandonedVersions.read($0) }
                )
            )
        let abandonedExecutable = try abandonedProvider!.next()
        let abandonedRoot = abandonedExecutable.deletingLastPathComponent()
            .deletingLastPathComponent()
        let marker = abandonedRoot.appendingPathComponent(
            "unknown-entry",
            isDirectory: false
        )
        try Data("preserve".utf8).write(to: marker)
        abandonedProvider = nil
        #expect(FileManager.default.fileExists(atPath: abandonedRoot.path))
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -120)],
            ofItemAtPath: abandonedRoot.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: abandoned.root
        )
        #expect(FileManager.default.fileExists(atPath: abandonedRoot.path))
        try FileManager.default.removeItem(at: marker)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -120)],
            ofItemAtPath: abandonedRoot.path
        )
        try ManagedCodexPinnedExecutableTesting.scavengeRuntimeBundles(
            in: abandoned.root
        )
        #expect(!FileManager.default.fileExists(atPath: abandonedRoot.path))
    }

}

private func makePreservedRuntimeStaging(
    in fixture: RuntimeTrustFixture
) throws -> URL {
    let versions = RuntimeTrustVersionProbe(["0.150.1"])
    let resolver = ManagedCodexTrustResolver(
        candidateURLs: [fixture.source],
        monitoredEntries: [],
        pinParentURL: fixture.root,
        versionReader: { versions.read($0) }
    )
    ManagedCodexPinnedExecutableTesting.preserveFailedRuntimeStaging(true)
    ManagedCodexPinnedExecutableTesting.injectCreateFailure(.afterLease)
    defer {
        ManagedCodexPinnedExecutableTesting.injectCreateFailure(nil)
        ManagedCodexPinnedExecutableTesting.preserveFailedRuntimeStaging(false)
    }
    do {
        _ = try resolver.resolveApproved()
        Issue.record("managed runtime staging failure was not injected")
    } catch is ManagedCodexPinnedExecutableInjectedFailure {
        // The preserved directory models a process that died after plan publish.
    }
    let name = try #require(
        FileManager.default.contentsOfDirectory(atPath: fixture.root.path)
            .first(where: {
                $0.hasPrefix("blabee-managed-codex.staging.")
            })
    )
    return fixture.root.appendingPathComponent(name, isDirectory: true)
}

private func rewriteStagingPlanTimestamp(
    at planURL: URL,
    createdAtSeconds: Int64
) throws {
    let data = try Data(contentsOf: planURL)
    var object = try #require(
        try JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    object["createdAtSeconds"] = NSNumber(value: createdAtSeconds)
    let updated = try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: planURL.path
    )
    try updated.write(to: planURL)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o400],
        ofItemAtPath: planURL.path
    )
}

private func replacePublishedPlanWithPartial(in stagingURL: URL) throws {
    let published = stagingURL.appendingPathComponent(
        ".blabee-runtime-staging.json",
        isDirectory: false
    )
    let partial = stagingURL.appendingPathComponent(
        ".blabee-runtime-staging.json.partial",
        isDirectory: false
    )
    try FileManager.default.moveItem(at: published, to: partial)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: partial.path
    )
    try Data("{".utf8).write(to: partial)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: partial.path
    )
}

private final class RuntimeTrustFixture: @unchecked Sendable {
    let root: URL
    let prefix: URL
    let source: URL
    let canonicalRoot: URL
    let target: URL

    var runtimeRoot: URL {
        target.deletingLastPathComponent().deletingLastPathComponent()
    }

    var host: URL {
        runtimeRoot.appendingPathComponent(
            "bin/codex-code-mode-host",
            isDirectory: false
        )
    }

    var ripgrep: URL {
        runtimeRoot.appendingPathComponent("codex-path/rg", isDirectory: false)
    }

    var manifestURL: URL {
        runtimeRoot.appendingPathComponent(
            "codex-package.json",
            isDirectory: false
        )
    }

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
        try installRuntimeBundle(for: target)
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

    func installRuntimeBundle(for executable: URL) throws {
        let runtimeRoot = executable.deletingLastPathComponent()
            .deletingLastPathComponent()
        let bin = runtimeRoot.appendingPathComponent("bin", isDirectory: true)
        let path = runtimeRoot.appendingPathComponent(
            "codex-path",
            isDirectory: true
        )
        for directory in [runtimeRoot, bin, path] {
            try Self.makeDirectory(directory, mode: 0o700)
        }
        let native = URL(fileURLWithPath: "/usr/bin/true")
        for companion in [
            bin.appendingPathComponent(
                "codex-code-mode-host",
                isDirectory: false
            ),
            path.appendingPathComponent("rg", isDirectory: false),
        ] {
            try Data(contentsOf: native).write(to: companion)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o755],
                ofItemAtPath: companion.path
            )
        }
        let manifest = runtimeRoot.appendingPathComponent(
            "codex-package.json",
            isDirectory: false
        )
        try writeManifest(to: manifest)
    }

    func writeManifest(
        layoutVersion: Int = 1,
        version: String = "0.150.1",
        target: String = ManagedCodexRuntimeBundleInspector.expectedTarget,
        variant: String = "codex",
        entrypoint: String = "bin/codex",
        pathDir: String = "codex-path",
        resourcesDir: String? = nil,
        to destination: URL? = nil
    ) throws {
        var fields: [String: Any] = [
            "entrypoint": entrypoint,
            "layoutVersion": layoutVersion,
            "pathDir": pathDir,
            "target": target,
            "variant": variant,
            "version": version,
        ]
        if let resourcesDir { fields["resourcesDir"] = resourcesDir }
        let body = try JSONSerialization.data(
            withJSONObject: fields,
            options: [.sortedKeys]
        )
        let manifest = destination ?? manifestURL
        try body.write(to: manifest)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: manifest.path
        )
    }

    func writeRawManifest(_ body: String) throws {
        try Data(body.utf8).write(to: manifestURL)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o644],
            ofItemAtPath: manifestURL.path
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

private final class RuntimeSignatureValidationProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0

    var callCount: Int { lock.withLock { calls } }

    func record() {
        lock.withLock { calls += 1 }
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

private func runtimeMode(_ url: URL) throws -> Int {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return try #require(
        (attributes[.posixPermissions] as? NSNumber)?.intValue
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
