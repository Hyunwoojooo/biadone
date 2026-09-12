import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("AppInstallation", .serialized)
struct AppInstallationTests {
    @Test("a renamed source installs its entire bundle and preserves quarantine and xattrs")
    func freshInstallationPreservesWholeBundle() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let quarantine = Data("0081;00000000;BlabeeInstallationFixture;".utf8)
        let extraAttribute = Data("fixture metadata".utf8)
        let sourceResource = fixture.source.appendingPathComponent("Contents/Resources/nested/payload.bin")
        try fixture.setAttribute("com.apple.quarantine", data: quarantine, at: fixture.source)
        try fixture.setAttribute("com.biadone.blabee.installation-test", data: extraAttribute, at: sourceResource)

        let service = fixture.service()
        let plan = try service.inspect(source: fixture.source)
        #expect(plan.sourceURL.lastPathComponent == "Blabee 2.app")
        #expect(plan.comparison == .freshInstall)
        let receipt = try service.install(plan, replacementApproved: false)

        #expect(receipt.destinationURL == fixture.destination)
        #expect(receipt.backupURL == nil)
        #expect(receipt.identity == AppInstallationFixture.sourceIdentity)
        #expect(try Data(contentsOf: fixture.destination.appendingPathComponent("Contents/Resources/nested/payload.bin")) == Data([0, 1, 2, 255]))
        #expect(try String(contentsOf: fixture.destination.appendingPathComponent(".hidden-bundle-resource"), encoding: .utf8) == "retain me")
        let copiedQuarantine = try String(decoding: fixture.attribute("com.apple.quarantine", at: fixture.destination), as: UTF8.self)
        let expectedQuarantine = String(decoding: quarantine, as: UTF8.self)
        let copiedFields = copiedQuarantine.split(separator: ";", omittingEmptySubsequences: false)
        let expectedFields = expectedQuarantine.split(separator: ";", omittingEmptySubsequences: false)
        let copiedFlags = try #require(copiedFields.first.flatMap { UInt32($0, radix: 16) })
        let expectedFlags = try #require(expectedFields.first.flatMap { UInt32($0, radix: 16) })
        // macOS copies quarantine through its dedicated quarantine API. It may
        // add flags and normalize the agent field; do not rewrite security
        // metadata merely to force byte equality with the source.
        #expect(copiedFields.count >= 3)
        #expect(copiedFlags & expectedFlags == expectedFlags)
        #expect(copiedFields.dropFirst().first == expectedFields.dropFirst().first)
        #expect(try fixture.attribute("com.apple.quarantine", at: fixture.source) == quarantine)
        #expect(try fixture.attribute("com.biadone.blabee.installation-test", at: fixture.destination.appendingPathComponent("Contents/Resources/nested/payload.bin")) == extraAttribute)
        #expect(FileManager.default.fileExists(atPath: fixture.source.path))
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.mode(at: fixture.applications.appendingPathComponent(".Blabee.install.lock")) == 0o600)
    }

    @Test("all existing installs require confirmation, including the same and newer builds")
    func replacementAlwaysNeedsConfirmation() throws {
        let cases: [(String, String, String, AppInstallationComparison)] = [
            ("1.0", "1", AppInstallationFixture.oldIdentity, .upgrade),
            ("2.0", "20", AppInstallationFixture.oldIdentity, .sameVersion),
            ("3.0", "30", AppInstallationFixture.oldIdentity, .downgrade),
            ("2.0", "20", AppInstallationFixture.sourceIdentity, .sameIdentity),
            ("preview", "unknown", AppInstallationFixture.oldIdentity, .unknown),
        ]
        for (version, build, identity, comparison) in cases {
            let fixture = try AppInstallationFixture()
            defer { fixture.remove() }
            try fixture.makeApp(at: fixture.destination, identity: identity, version: version, build: build)
            let service = fixture.service()
            let plan = try service.inspect(source: fixture.source)
            #expect(plan.comparison == comparison)
            let failure = try installationFailure { _ = try service.install(plan, replacementApproved: false) }
            #expect(failure.code == .replacementApprovalRequired)
            #expect(try fixture.identity(at: fixture.destination) == identity)
            #expect(try fixture.children(prefix: ".Blabee.").isEmpty)
        }
    }

    @Test("approved replacement preserves the exact previous app in a unique retained backup")
    func approvedReplacementBacksUpOldApp() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity, version: "1.0", build: "1")
        let previousInode = try fixture.inode(at: fixture.destination)
        let service = fixture.service()
        let plan = try service.inspect(source: fixture.source)
        let receipt = try service.install(plan, replacementApproved: true)
        let backup = try #require(receipt.backupURL)
        #expect(backup.deletingLastPathComponent() == fixture.applications)
        #expect(backup.lastPathComponent.hasPrefix(".Blabee.backup-"))
        #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.inode(at: backup) == previousInode)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
    }

    @Test("running-code identity must match the source signed identity")
    func sourceMustMatchRunningIdentity() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let service = fixture.service(expectedIdentity: AppInstallationFixture.oldIdentity)
        let failure = try installationFailure { _ = try service.inspect(source: fixture.source) }
        #expect(failure.code == .identityMismatch)
        #expect(try fixture.children(prefix: ".Blabee.").isEmpty)
    }

    @Test("live signature inspection rejects unsigned fixture bundles")
    func unsignedBundleFailsValidation() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let service = AppInstallationService(
            destinationURL: fixture.destination,
            expectedSourceIdentity: AppInstallationFixture.sourceIdentity,
            validator: { app in
                guard let inspection = OperationalRuntimeIdentity.installedInspection(
                    forExecutable: app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
                ) else { throw AppInstallationError(.invalidSource) }
                return inspection.snapshot.runtimeIdentity
            }
        )
        #expect(throws: AppInstallationError.self) { _ = try service.inspect(source: fixture.source) }
    }

    @Test("bundle metadata must be exact and bounded", arguments: [
        "CFBundleIdentifier", "CFBundleName", "CFBundleExecutable", "CFBundleShortVersionString", "CFBundleVersion",
    ])
    func malformedMetadataIsRejected(key: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.rewriteInfo(at: fixture.source, key: key, value: key.hasPrefix("CFBundleS") || key == "CFBundleVersion" ? String(repeating: "x", count: 65) : "Wrong")
        #expect(throws: AppInstallationError.self) { _ = try fixture.service().inspect(source: fixture.source) }
    }

    @Test("oversized Info.plist is rejected before parsing")
    func oversizedInfoIsRejected() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try Data(repeating: 0x20, count: 65_537).write(to: fixture.source.appendingPathComponent("Contents/Info.plist"))
        #expect(throws: AppInstallationError.self) { _ = try fixture.service().inspect(source: fixture.source) }
    }

    @Test("source and destination root symlinks are never followed", arguments: [true, false])
    func rootSymlinkIsRejected(sourceLink: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        if sourceLink {
            let actual = fixture.root.appendingPathComponent("Original.app")
            try FileManager.default.moveItem(at: fixture.source, to: actual)
            try FileManager.default.createSymbolicLink(at: fixture.source, withDestinationURL: actual)
        } else {
            try FileManager.default.createSymbolicLink(at: fixture.destination, withDestinationURL: fixture.source)
        }
        #expect(throws: AppInstallationError.self) { _ = try fixture.service().inspect(source: fixture.source) }
        #expect(try fixture.children(prefix: ".Blabee.").isEmpty)
    }

    @Test("source parent aliases resolve physically while the destination parent stays no-follow")
    func sourceParentAliasAndDestinationParentPolicy() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let sourceAlias = fixture.root.appendingPathComponent("DownloadsAlias", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: sourceAlias, withDestinationURL: fixture.source.deletingLastPathComponent())
        let service = fixture.service()
        let plan = try service.inspect(source: sourceAlias.appendingPathComponent(fixture.source.lastPathComponent))
        #expect(plan.sourceURL.path == fixture.source.path)

        let destinationAlias = fixture.root.appendingPathComponent("ApplicationsAlias", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: destinationAlias, withDestinationURL: fixture.applications)
        let unsafeService = AppInstallationService(
            destinationURL: destinationAlias.appendingPathComponent("Blabee.app"),
            expectedSourceIdentity: AppInstallationFixture.sourceIdentity,
            validator: { try fixture.identity(at: $0) }
        )
        let failure = try installationFailure { _ = try unsafeService.inspect(source: fixture.source) }
        #expect(failure.code == .invalidDestination)
        #expect(!FileManager.default.fileExists(atPath: fixture.destination.path))
        _ = try service.install(plan, replacementApproved: false)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
    }

    @Test("metadata symlinks and special files are rejected", arguments: ["Info.plist", "fifo", "escaping-link"])
    func unsafeBundleEntriesAreRejected(kind: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let resources = fixture.source.appendingPathComponent("Contents/Resources")
        if kind == "Info.plist" {
            let info = fixture.source.appendingPathComponent("Contents/Info.plist")
            let moved = fixture.root.appendingPathComponent("Moved.plist")
            try FileManager.default.moveItem(at: info, to: moved)
            try FileManager.default.createSymbolicLink(at: info, withDestinationURL: moved)
        } else if kind == "fifo" {
            #expect(mkfifo(resources.appendingPathComponent("pipe").path, 0o600) == 0)
        } else {
            try FileManager.default.createSymbolicLink(atPath: resources.appendingPathComponent("escape").path, withDestinationPath: "../../../../outside")
        }
        #expect(throws: AppInstallationError.self) { _ = try fixture.service().inspect(source: fixture.source) }
    }

    @Test("contained framework-style relative symlinks survive relocation")
    func internalSymlinkIsPreserved() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let link = fixture.source.appendingPathComponent("Contents/Resources/payload-link")
        try FileManager.default.createSymbolicLink(atPath: link.path, withDestinationPath: "nested/payload.bin")
        let service = fixture.service()
        _ = try service.install(service.inspect(source: fixture.source), replacementApproved: false)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: fixture.destination.appendingPathComponent("Contents/Resources/payload-link").path) == "nested/payload.bin")
    }

    @Test("source replacement after inspection fails even if its signed identity is unchanged")
    func sourceInodeChangeInvalidatesPlan() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let service = fixture.service()
        let plan = try service.inspect(source: fixture.source)
        let saved = fixture.root.appendingPathComponent("SavedSource.app")
        try FileManager.default.moveItem(at: fixture.source, to: saved)
        try FileManager.default.copyItem(at: saved, to: fixture.source)
        let failure = try installationFailure { _ = try service.install(plan, replacementApproved: false) }
        #expect(failure.code == .changedSinceInspection)
        #expect(!FileManager.default.fileExists(atPath: fixture.destination.path))
    }

    @Test("changed or newly appeared destinations invalidate the confirmation", arguments: [true, false])
    func destinationChangeInvalidatesPlan(hadExistingApp: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        if hadExistingApp { try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity) }
        let service = fixture.service()
        let plan = try service.inspect(source: fixture.source)
        if hadExistingApp {
            try FileManager.default.moveItem(at: fixture.destination, to: fixture.root.appendingPathComponent("SavedDestination.app"))
        }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.otherIdentity)
        let failure = try installationFailure { _ = try service.install(plan, replacementApproved: true) }
        #expect(failure.code == .changedSinceInspection)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.otherIdentity)
    }

    @Test("activity guard blocks installation before staging or moving an app")
    func activeDestinationIsRejected() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(activityGuard: { _ in throw AppInstallationError(.destinationActive) })
        let plan = try service.inspect(source: fixture.source)
        let failure = try installationFailure { _ = try service.install(plan, replacementApproved: true) }
        #expect(failure.code == .destinationActive)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("explicit legacy quit confirmation accepts only a completed path gap and retains the old app")
    func confirmedLegacyPathGapPreservesBackup() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let oldInode = try fixture.inode(at: fixture.destination)
        let processGuard = AppInstallationProcessGuard(snapshot: { [.unresolvedExecutable] })
        let service = fixture.service(activityGuard: { try processGuard.requireInactive($0) })

        let strictFailure = try installationFailure {
            _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true)
        }
        #expect(strictFailure.code == .activityInspectionIncomplete)
        #expect(try fixture.inode(at: fixture.destination) == oldInode)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)

        let receipt = try service.install(
            service.inspect(source: fixture.source), replacementApproved: true, legacyQuitConfirmed: true
        )
        let backup = try #require(receipt.backupURL)
        #expect(try fixture.inode(at: backup) == oldInode)
        #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
    }

    @Test("legacy quit confirmation never bypasses active users, enumeration or unknown-state failures", arguments: [
        "active", "enumeration", "unknown-state", "application-error",
    ])
    func confirmedLegacyQuitRetainsHardFailures(reason: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let oldInode = try fixture.inode(at: fixture.destination)
        let executable = fixture.executable(at: fixture.destination)
        let processGuard = AppInstallationProcessGuard(snapshot: {
            switch reason {
            case "active": return [.unresolvedExecutable, .running(executableURL: executable)]
            case "enumeration": throw AppInstallationPlatformError.processInspectionIncomplete
            default: return [.unresolvedExecutable, .unavailable]
            }
        })
        let service = fixture.service(activityGuard: { app in
            if reason == "application-error" { throw AppInstallationError(.activityInspectionIncomplete) }
            try processGuard.requireInactive(app)
        })
        let failure = try installationFailure {
            _ = try service.install(
                service.inspect(source: fixture.source), replacementApproved: true, legacyQuitConfirmed: true
            )
        }
        let expected: AppInstallationError.Code = reason == "active" ? .destinationActive
            : reason == "application-error" ? .activityInspectionIncomplete : .activityInspectionUnavailable
        #expect(failure.code == expected)
        #expect(try fixture.inode(at: fixture.destination) == oldInode)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("legacy quit confirmation still rejects late active users and restores a renamed backup", arguments: [
        AppInstallationCheckpoint.afterCopy, .afterBackup,
    ])
    func confirmedLegacyQuitRejectsLateActiveUsers(activeAfter: AppInstallationCheckpoint) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let oldInode = try fixture.inode(at: fixture.destination)
        let checkpoints = AppInstallationCheckpointRecorder()
        let service = fixture.service(activityGuard: { app in
            if checkpoints.phases().contains(activeAfter),
               activeAfter == .afterCopy || app.lastPathComponent.hasPrefix(".Blabee.backup-") {
                throw AppInstallationPlatformError.applicationActive
            }
            throw AppInstallationPlatformError.processInspectionIncomplete
        }, checkpoint: { phase, _ in checkpoints.record(phase) })
        let failure = try installationFailure {
            _ = try service.install(
                service.inspect(source: fixture.source), replacementApproved: true, legacyQuitConfirmed: true
            )
        }
        #expect(failure.code == .destinationActive)
        #expect(failure.recoveryURL != nil)
        #expect(try fixture.inode(at: fixture.destination) == oldInode)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
        #expect(checkpoints.phases().contains(.beforeRestore) == (activeAfter == .afterBackup))
    }

    @Test("legacy quit confirmation cannot replace a destination changed after inspection")
    func confirmedLegacyQuitRejectsChangedPlan() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(activityGuard: { _ in throw AppInstallationPlatformError.processInspectionIncomplete })
        let plan = try service.inspect(source: fixture.source)
        try fixture.writeIdentity(AppInstallationFixture.otherIdentity, at: fixture.destination)
        let failure = try installationFailure {
            _ = try service.install(plan, replacementApproved: true, legacyQuitConfirmed: true)
        }
        #expect(failure.code == .changedSinceInspection)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.otherIdentity)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("a confirmed absent fresh target does not inspect unrelated running processes")
    func freshInstallationDoesNotCallActivityGuard() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let observation = AppInstallationErrorRecorder()
        let service = fixture.service(activityGuard: { _ in
            observation.record(.activityInspectionUnavailable)
            throw AppInstallationPlatformError.processInspectionUnavailable
        })
        let plan = try service.inspect(source: fixture.source)
        let receipt = try service.install(plan, replacementApproved: false)
        #expect(receipt.identity == AppInstallationFixture.sourceIdentity)
        #expect(observation.codes().isEmpty)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
    }

    @Test("an admitted previous release or identical release uses leases despite unknown process visibility", arguments: [true, false])
    func leaseReplacementDoesNotCallActivityGuard(sameRelease: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let oldIdentity = sameRelease ? AppInstallationFixture.sourceIdentity : AppInstallationFixture.oldIdentity
        try fixture.makeApp(at: fixture.destination, identity: oldIdentity)
        try fixture.enableRuntimeUseLease(at: fixture.destination)
        try fixture.enableRuntimeUseLease(at: fixture.source, previousIdentities: sameRelease ? [] : [
            AppInstallationFixture.otherIdentity, AppInstallationFixture.oldIdentity,
        ])
        let observation = AppInstallationErrorRecorder()
        let service = fixture.service(activityGuard: { _ in
            observation.record(.activityInspectionUnavailable)
            throw AppInstallationPlatformError.processInspectionUnavailable
        })
        let plan = try service.inspect(source: fixture.source)
        let existing = try #require(plan.existing)
        #expect(plan.source.admitsRuntimeUseLease(for: existing))
        let receipt = try service.install(plan, replacementApproved: true)
        let backup = try #require(receipt.backupURL)
        #expect(observation.codes().isEmpty)
        #expect(try fixture.identity(at: backup) == oldIdentity)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
        try fixture.expectLeaseReleased(at: fixture.destination)
        try fixture.expectLeaseReleased(at: backup)
    }

    @Test("unapproved releases and unsupported payloads retain the legacy activity guard", arguments: [
        "unapproved-previous", "target-self-approval", "legacy-target", "missing-source-marker",
        "unknown-target-marker", "source-extra-helper", "target-extra-helper",
        "source-symlink", "target-symlink", "changed-launcher",
    ])
    func unsupportedReplacementCallsActivityGuard(reason: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        try fixture.enableRuntimeUseLease(at: fixture.destination)
        try fixture.enableRuntimeUseLease(at: fixture.source, previousIdentities: [AppInstallationFixture.oldIdentity])
        switch reason {
        case "unapproved-previous", "target-self-approval":
            try fixture.rewriteInfo(at: fixture.source, key: AppRuntimeUseLease.previousIdentitiesInfoKey,
                                    value: [AppInstallationFixture.otherIdentity])
            if reason == "target-self-approval" {
                try fixture.rewriteInfo(at: fixture.destination, key: AppRuntimeUseLease.previousIdentitiesInfoKey,
                                        value: [AppInstallationFixture.sourceIdentity])
            }
        case "legacy-target":
            try fixture.rewriteInfo(at: fixture.destination, key: AppRuntimeUseLease.protocolInfoKey, value: nil)
        case "missing-source-marker":
            try fixture.rewriteInfo(at: fixture.source, key: AppRuntimeUseLease.protocolInfoKey, value: nil)
        case "unknown-target-marker":
            try fixture.rewriteInfo(at: fixture.destination, key: AppRuntimeUseLease.protocolInfoKey,
                                    value: "blabee.runtime-use-lease.v2")
        case "source-extra-helper", "target-extra-helper":
            let app = reason == "source-extra-helper" ? fixture.source : fixture.destination
            try fixture.writeExecutable(Data("uncovered executable".utf8), at: app.appendingPathComponent("Contents/MacOS/extra-helper"))
        case "source-symlink", "target-symlink":
            let app = reason == "source-symlink" ? fixture.source : fixture.destination
            try FileManager.default.createSymbolicLink(atPath: app.appendingPathComponent("Contents/Resources/payload-link").path,
                                                      withDestinationPath: "nested/payload.bin")
        case "changed-launcher":
            try fixture.writeExecutable(Data("different launcher".utf8),
                                        at: fixture.source.appendingPathComponent(AppRuntimeUseLease.launcherPath))
        default:
            Issue.record("Unexpected fallback fixture")
        }
        let oldInode = try fixture.inode(at: fixture.destination)
        let observation = AppInstallationErrorRecorder()
        let service = fixture.service(activityGuard: { _ in
            observation.record(.activityInspectionUnavailable)
            throw AppInstallationError(.activityInspectionUnavailable)
        })
        let plan = try service.inspect(source: fixture.source)
        let existing = try #require(plan.existing)
        #expect(!plan.source.admitsRuntimeUseLease(for: existing))
        let failure = try installationFailure { _ = try service.install(plan, replacementApproved: true) }
        #expect(failure.code == .activityInspectionUnavailable)
        #expect(observation.codes() == [.activityInspectionUnavailable])
        #expect(try fixture.inode(at: fixture.destination) == oldInode)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("previous-release admission metadata is a unique bounded array of valid identities", arguments: [
        "not-an-array", "mixed-types", "invalid-identity", "short-identity", "too-many", "duplicates",
    ])
    func invalidLeaseAdmissionMetadataIsRejected(reason: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.enableRuntimeUseLease(at: fixture.source)
        let value: Any
        switch reason {
        case "not-an-array": value = AppInstallationFixture.oldIdentity
        case "mixed-types": value = [AppInstallationFixture.oldIdentity, 1] as [Any]
        case "invalid-identity": value = ["md5:" + String(repeating: "b", count: 64)]
        case "short-identity": value = ["sha256:b"]
        case "too-many": value = [AppInstallationFixture.sourceIdentity, AppInstallationFixture.oldIdentity, AppInstallationFixture.otherIdentity]
        default: value = [AppInstallationFixture.oldIdentity, AppInstallationFixture.oldIdentity]
        }
        try fixture.rewriteInfo(at: fixture.source, key: AppRuntimeUseLease.previousIdentitiesInfoKey, value: value)
        let failure = try installationFailure { _ = try fixture.service().inspect(source: fixture.source) }
        #expect(failure.code == .invalidSource)
        #expect(try fixture.children(prefix: ".Blabee.").isEmpty)
    }

    @Test("an existing runtime shared lease blocks replacement even with legacy quit confirmation", arguments: [false, true])
    func runningLeaseDestinationIsRejected(legacyQuitConfirmed: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeLeaseReplacement()
        let oldInode = try fixture.inode(at: fixture.destination)
        let runtime = try AppRuntimeUseLease.acquire(executableURL: fixture.executable(at: fixture.destination), use: .runtime)
        defer { withExtendedLifetime(runtime) {} }
        let observation = AppInstallationErrorRecorder()
        let service = fixture.service(activityGuard: { _ in observation.record(.activityInspectionUnavailable) })
        let failure = try installationFailure {
            _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true,
                                    legacyQuitConfirmed: legacyQuitConfirmed)
        }
        #expect(failure.code == .destinationActive)
        #expect(observation.codes().isEmpty)
        #expect(try fixture.inode(at: fixture.destination) == oldInode)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
        try runtime.verify(at: fixture.executable(at: fixture.destination))
    }

    @Test("old and staged exclusive leases survive every publication and rollback checkpoint", arguments: [false, true])
    func transactionRetainsAndReleasesUseLeases(rollback: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeLeaseReplacement()
        let observation = AppInstallationCheckpointRecorder()
        let service = fixture.service(checkpoint: { phase, app in
            let oldApp: URL
            switch phase {
            case .beforeCopy, .beforeBackup: oldApp = fixture.destination
            case .afterBackup, .beforeRestore: oldApp = try #require(app)
            case .beforePublish, .afterPublish: oldApp = try #require(fixture.children(prefix: ".Blabee.backup-").first)
            default: return
            }
            observation.record(phase)
            try fixture.expectRuntimeUseBlocked(at: oldApp)
            if phase == .beforePublish || phase == .afterPublish {
                try fixture.expectRuntimeUseBlocked(at: try #require(app))
            }
            if phase == .beforeRestore {
                let stage = try #require(fixture.children(prefix: ".Blabee.install-").first)
                try fixture.expectRuntimeUseBlocked(at: stage.appendingPathComponent("Blabee.app"))
            }
            if rollback, phase == .beforePublish { throw AppInstallationError(.publishFailed) }
        })
        let plan = try service.inspect(source: fixture.source)
        if rollback {
            let failure = try installationFailure { _ = try service.install(plan, replacementApproved: true) }
            #expect(failure.code == .publishFailed)
            #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
            #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
            let stage = try #require(fixture.children(prefix: ".Blabee.install-").first)
            try fixture.expectLeaseReleased(at: stage.appendingPathComponent("Blabee.app"))
        } else {
            let receipt = try service.install(plan, replacementApproved: true)
            try fixture.expectLeaseReleased(at: try #require(receipt.backupURL))
            #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
        }
        #expect(observation.phases() == [.beforeCopy, .beforeBackup, .afterBackup, .beforePublish,
                                        rollback ? .beforeRestore : .afterPublish])
        try fixture.expectLeaseReleased(at: fixture.destination)
    }

    @Test("a same-byte old executable inode swap never escapes its lease or becomes a verified rollback", arguments: [
        AppInstallationCheckpoint.beforeBackup, .afterBackup, .beforePublish, .afterPublish, .beforeRestore,
    ])
    func oldExecutableInodeSwapPreservesRecovery(swapPhase: AppInstallationCheckpoint) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeLeaseReplacement()
        let oldBundleInode = try fixture.inode(at: fixture.destination)
        let savedExecutable = fixture.root.appendingPathComponent("saved-old-coordinator")
        let observation = AppInstallationCheckpointRecorder()
        let service = fixture.service(checkpoint: { phase, app in
            if swapPhase == .beforeRestore, phase == .beforePublish { throw AppInstallationError(.publishFailed) }
            guard phase == swapPhase else { return }
            let oldApp: URL
            switch phase {
            case .beforeBackup: oldApp = fixture.destination
            case .afterBackup, .beforeRestore: oldApp = try #require(app)
            default: oldApp = try #require(fixture.children(prefix: ".Blabee.backup-").first)
            }
            observation.record(phase)
            try fixture.replaceExecutableWithIdenticalCopy(at: oldApp, savingTo: savedExecutable)
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(observation.phases() == [swapPhase])
        #expect(failure.code == (swapPhase == .beforeBackup ? .changedSinceInspection : .recoveryRequired))
        let recovery = try #require(failure.recoveryURL)
        #expect(FileManager.default.fileExists(atPath: recovery.path))
        if swapPhase == .beforeBackup {
            #expect(try fixture.inode(at: fixture.destination) == oldBundleInode)
            #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
            #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
        } else {
            let backup = try #require(fixture.children(prefix: ".Blabee.backup-").first)
            #expect(try fixture.inode(at: backup) == oldBundleInode)
            #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
            if swapPhase == .afterPublish {
                #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
            } else {
                #expect(!FileManager.default.fileExists(atPath: fixture.destination.path))
            }
        }
        if swapPhase == .afterPublish {
            try fixture.expectLeaseReleased(at: fixture.destination)
        } else {
            let stage = try #require(fixture.children(prefix: ".Blabee.install-").first)
            let stagedApp = stage.appendingPathComponent("Blabee.app")
            #expect(try fixture.identity(at: stagedApp) == AppInstallationFixture.sourceIdentity)
            try fixture.expectLeaseReleased(at: stagedApp)
        }
        let released = try AppRuntimeUseLease.acquire(executableURL: savedExecutable, use: .installation)
        try released.verify(at: savedExecutable)
        withExtendedLifetime(released) {}
    }

    @Test("a same-byte staged or published executable inode swap preserves both recoverable bundles", arguments: [
        AppInstallationCheckpoint.beforePublish, .afterPublish,
    ])
    func publishedExecutableInodeSwapPreservesRecovery(swapPhase: AppInstallationCheckpoint) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeLeaseReplacement()
        let oldBundleInode = try fixture.inode(at: fixture.destination)
        let savedExecutable = fixture.root.appendingPathComponent("saved-new-coordinator")
        let observation = AppInstallationCheckpointRecorder()
        let service = fixture.service(checkpoint: { phase, app in
            guard phase == swapPhase else { return }
            observation.record(phase)
            try fixture.replaceExecutableWithIdenticalCopy(at: try #require(app), savingTo: savedExecutable)
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(observation.phases() == [swapPhase])
        if swapPhase == .beforePublish {
            #expect(failure.code == .changedSinceInspection)
            #expect(try fixture.inode(at: fixture.destination) == oldBundleInode)
            #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
            #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
            let stage = try #require(fixture.children(prefix: ".Blabee.install-").first)
            #expect(try fixture.identity(at: stage.appendingPathComponent("Blabee.app")) == AppInstallationFixture.sourceIdentity)
            try fixture.expectLeaseReleased(at: fixture.destination)
        } else {
            #expect(failure.code == .recoveryRequired)
            #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
            let backup = try #require(fixture.children(prefix: ".Blabee.backup-").first)
            #expect(try fixture.inode(at: backup) == oldBundleInode)
            #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
            try fixture.expectLeaseReleased(at: backup)
        }
        let released = try AppRuntimeUseLease.acquire(executableURL: savedExecutable, use: .installation)
        try released.verify(at: savedExecutable)
        withExtendedLifetime(released) {}
    }

    @Test("initial process visibility failures distinguish path gaps without claiming activity", arguments: [false, true])
    func initialUnknownProcessVisibilityKeepsReason(stablePathGap: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(activityGuard: { _ in
            throw stablePathGap ? AppInstallationPlatformError.processInspectionIncomplete : .processInspectionUnavailable
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == (stablePathGap ? .activityInspectionIncomplete : .activityInspectionUnavailable))
        #expect(failure.userMessage.contains("확인하지 못했습니다"))
        if stablePathGap { #expect(failure.userMessage.contains("실행 중이라는 뜻은 아닙니다")) }
        #expect(!failure.userMessage.contains("Mac을 재시작"))
        #expect(!failure.userMessage.contains("프로세스가 실행 중입니다"))
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.install-").isEmpty)
    }

    @Test("late platform activity failures preserve their reason and restore the old app", arguments: [true, false])
    func lateActivityGuardKeepsReason(active: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(activityGuard: { app in
            if app.lastPathComponent.hasPrefix(".Blabee.backup-") {
                throw active ? AppInstallationPlatformError.applicationActive : .processInspectionUnavailable
            }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == (active ? .destinationActive : .activityInspectionUnavailable))
        #expect(failure.recoveryURL != nil)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("copy failures retain private partial staging and leave the installed app intact")
    func copyFailurePreservesOldApp() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(copyBundle: { _, staged in
            try FileManager.default.createDirectory(at: staged, withIntermediateDirectories: false)
            try Data("partial copy".utf8).write(to: staged.appendingPathComponent("partial"))
            throw AppInstallationError(.copyFailed)
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .copyFailed)
        let recovery = try #require(failure.recoveryURL)
        #expect(try fixture.mode(at: recovery) == 0o700)
        #expect(FileManager.default.fileExists(atPath: recovery.appendingPathComponent("Blabee.app/partial").path))
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("copy permission denial gives the manual Finder fallback without modifying the old app")
    func copyPermissionDenialHasManualFallback() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(copyBundle: { _, _ in
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .insufficientPermissions)
        #expect(failure.userMessage.contains("Finder"))
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
    }

    @Test("a copied bundle must have the source identity before any backup happens")
    func stagedIdentityMismatchIsRejected() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(checkpoint: { phase, app in
            if phase == .afterCopy, let app {
                try fixture.writeIdentity(AppInstallationFixture.otherIdentity, at: app)
            }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .identityMismatch)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
    }

    @Test("a publish failure restores the verified backup exclusively")
    func publishFailureRestoresBackup() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let previousInode = try fixture.inode(at: fixture.destination)
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .beforePublish { throw AppInstallationError(.publishFailed) }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .publishFailed)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.oldIdentity)
        #expect(try fixture.inode(at: fixture.destination) == previousInode)
        #expect(try fixture.children(prefix: ".Blabee.backup-").isEmpty)
        #expect(try fixture.children(prefix: ".Blabee.install-").count == 1)
    }

    @Test("a destination created immediately before publication is not overwritten")
    func exclusivePublishPreservesConcurrentFile() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let marker = Data("concurrent file".utf8)
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .beforePublish { try marker.write(to: fixture.destination) }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: false) }
        #expect(failure.code == .publishFailed)
        #expect(try Data(contentsOf: fixture.destination) == marker)
        #expect(try fixture.children(prefix: ".Blabee.install-").count == 1)
    }

    @Test("a restore collision preserves the concurrent file and the previous app backup")
    func restoreCollisionPreservesBoth() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let marker = Data("concurrent restore occupant".utf8)
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .beforePublish { throw AppInstallationError(.publishFailed) }
            if phase == .beforeRestore { try marker.write(to: fixture.destination) }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .recoveryRequired)
        #expect(try Data(contentsOf: fixture.destination) == marker)
        let backup = try #require(fixture.children(prefix: ".Blabee.backup-").first)
        #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
    }

    @Test("a bundle swapped into the rename source is retained but never called a verified rollback")
    func backupSourceRacePreservesDisplacedBundle() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let savedOriginal = fixture.root.appendingPathComponent("UserSavedOld.app")
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .beforeBackup {
                try FileManager.default.moveItem(at: fixture.destination, to: savedOriginal)
                try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.otherIdentity)
            }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .recoveryRequired)
        let backup = try #require(failure.recoveryURL)
        #expect(try fixture.identity(at: backup) == AppInstallationFixture.otherIdentity)
        #expect(try fixture.identity(at: savedOriginal) == AppInstallationFixture.oldIdentity)
        #expect(!FileManager.default.fileExists(atPath: fixture.destination.path))
    }

    @Test("post-publication verification failure retains the destination and old backup")
    func postPublishFailureDoesNotDeletePublishedBundle() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .afterPublish { throw AppInstallationError(.publishFailed) }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .recoveryRequired)
        #expect(try fixture.identity(at: fixture.destination) == AppInstallationFixture.sourceIdentity)
        let backup = try #require(fixture.children(prefix: ".Blabee.backup-").first)
        #expect(try fixture.identity(at: backup) == AppInstallationFixture.oldIdentity)
    }

    @Test("parent directory rotation preserves recovery material at its actual location")
    func parentRotationDoesNotTouchReplacementParent() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        try fixture.makeApp(at: fixture.destination, identity: AppInstallationFixture.oldIdentity)
        let movedParent = fixture.root.appendingPathComponent("MovedApplications")
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .afterBackup {
                try FileManager.default.moveItem(at: fixture.applications, to: movedParent)
                try FileManager.default.createDirectory(at: fixture.applications, withIntermediateDirectories: false)
                try Data("new parent".utf8).write(to: fixture.destination)
            }
        })
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: true) }
        #expect(failure.code == .recoveryRequired)
        let recovery = try #require(failure.recoveryURL)
        #expect(recovery.deletingLastPathComponent().path == movedParent.path)
        #expect(try fixture.identity(at: recovery) == AppInstallationFixture.oldIdentity)
        #expect(try String(contentsOf: fixture.destination, encoding: .utf8) == "new parent")
    }

    @Test("the owned lock serializes competing self-installs")
    func concurrentSelfInstallIsRejected() throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let competing = fixture.service()
        let plan = try competing.inspect(source: fixture.source)
        let observation = AppInstallationErrorRecorder()
        let service = fixture.service(checkpoint: { phase, _ in
            if phase == .beforeCopy {
                do { _ = try competing.install(plan, replacementApproved: false) }
                catch let error as AppInstallationError { observation.record(error.code) }
            }
        })
        _ = try service.install(plan, replacementApproved: false)
        #expect(observation.codes() == [.installationBusy])
    }

    @Test("symlink and insecure existing locks are refused", arguments: [true, false])
    func unsafeLockIsRejected(symlink: Bool) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        let lock = fixture.applications.appendingPathComponent(".Blabee.install.lock")
        let other = fixture.root.appendingPathComponent("other-file")
        try Data("preserve".utf8).write(to: other)
        if symlink {
            try FileManager.default.createSymbolicLink(at: lock, withDestinationURL: other)
        } else {
            try Data().write(to: lock)
            #expect(chmod(lock.path, 0o666) == 0)
        }
        let service = fixture.service()
        let failure = try installationFailure { _ = try service.install(service.inspect(source: fixture.source), replacementApproved: false) }
        #expect(failure.code == .installationBusy)
        #expect(try Data(contentsOf: other) == Data("preserve".utf8))
        #expect(!FileManager.default.fileExists(atPath: fixture.destination.path))
    }

    @Test("bounded preflight rejects excessive size, count, depth, or elapsed time", arguments: ["bytes", "entries", "depth", "time"])
    func preflightLimitsAreEnforced(bound: String) throws {
        let fixture = try AppInstallationFixture()
        defer { fixture.remove() }
        var limits = AppInstallationLimits()
        if bound == "bytes" { limits.maximumBytes = 1 }
        if bound == "entries" { limits.maximumEntries = 1 }
        if bound == "depth" { limits.maximumDepth = 0 }
        if bound == "time" { limits.maximumDuration = 0 }
        let service = fixture.service(limits: limits)
        let failure = try installationFailure { _ = try service.inspect(source: fixture.source) }
        #expect(failure.code == (bound == "time" ? .deadlineExceeded : .sizeLimitExceeded))
        #expect(try fixture.children(prefix: ".Blabee.").isEmpty)
    }
}

private func installationFailure(_ operation: () throws -> Void) throws -> AppInstallationError {
    do { try operation() }
    catch let error as AppInstallationError { return error }
    Issue.record("Expected AppInstallationError")
    throw AppInstallationError(.publishFailed)
}

private struct AppInstallationFixture: Sendable {
    static let sourceIdentity = "sha256:" + String(repeating: "a", count: 64)
    static let oldIdentity = "sha256:" + String(repeating: "b", count: 64)
    static let otherIdentity = "sha256:" + String(repeating: "c", count: 64)
    let root: URL
    let source: URL
    let applications: URL
    let destination: URL

    init() throws {
        guard let resolved = realpath(FileManager.default.temporaryDirectory.path, nil) else {
            throw AppInstallationError(.invalidDestination)
        }
        defer { free(resolved) }
        root = URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
            .appendingPathComponent("blabee-app-install-test-" + UUID().uuidString, isDirectory: true)
        applications = root.appendingPathComponent("Applications", isDirectory: true)
        destination = applications.appendingPathComponent("Blabee.app", isDirectory: true)
        source = root.appendingPathComponent("Downloads/Blabee 2.app", isDirectory: true)
        try FileManager.default.createDirectory(at: applications, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try makeApp(at: source, identity: Self.sourceIdentity)
    }

    func remove() {
        // This UUID fixture is the only recursively removed tree in the tests.
        guard root.lastPathComponent.hasPrefix("blabee-app-install-test-") else { return }
        try? FileManager.default.removeItem(at: root)
    }

    func service(
        expectedIdentity: String = AppInstallationFixture.sourceIdentity,
        activityGuard: @escaping AppInstallationService.ActivityGuard = { _ in },
        copyBundle: @escaping @Sendable (URL, URL) throws -> Void = { try FileManager().copyItem(at: $0, to: $1) },
        checkpoint: @escaping AppInstallationService.Checkpoint = { _, _ in },
        limits: AppInstallationLimits = AppInstallationLimits()
    ) -> AppInstallationService {
        AppInstallationService(
            destinationURL: destination,
            expectedSourceIdentity: expectedIdentity,
            validator: { try self.identity(at: $0) },
            activityGuard: activityGuard,
            copyBundle: copyBundle,
            checkpoint: checkpoint,
            limits: limits
        )
    }

    func makeApp(at app: URL, identity: String, version: String = "2.0", build: String = "20") throws {
        let macOS = app.appendingPathComponent("Contents/MacOS", isDirectory: true)
        let resources = app.appendingPathComponent("Contents/Resources/nested", isDirectory: true)
        try FileManager.default.createDirectory(at: macOS, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o755])
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o755])
        let info = [
            "CFBundleIdentifier": "com.biadone.blabee", "CFBundleName": "Blabee",
            "CFBundleExecutable": "blabee-coordinator", "CFBundleShortVersionString": version,
            "CFBundleVersion": build, "CFBundlePackageType": "APPL",
        ]
        try PropertyListSerialization.data(fromPropertyList: info, format: .binary, options: 0)
            .write(to: app.appendingPathComponent("Contents/Info.plist"))
        let executable = macOS.appendingPathComponent("blabee-coordinator")
        try Data("fixture executable, never run".utf8).write(to: executable)
        guard chmod(executable.path, 0o755) == 0 else { throw AppInstallationError(.copyFailed) }
        try Data([0, 1, 2, 255]).write(to: resources.appendingPathComponent("payload.bin"))
        try Data("retain me".utf8).write(to: app.appendingPathComponent(".hidden-bundle-resource"))
        try writeIdentity(identity, at: app)
    }

    func writeIdentity(_ identity: String, at app: URL) throws {
        try Data(identity.utf8).write(to: app.appendingPathComponent("Contents/Resources/fixture-identity"))
    }

    func identity(at app: URL) throws -> String {
        try String(contentsOf: app.appendingPathComponent("Contents/Resources/fixture-identity"), encoding: .utf8)
    }

    func rewriteInfo(at app: URL, key: String, value: Any?) throws {
        let url = app.appendingPathComponent("Contents/Info.plist")
        var info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        info[key] = value
        try PropertyListSerialization.data(fromPropertyList: info, format: .binary, options: 0).write(to: url)
    }

    func makeLeaseReplacement() throws {
        try makeApp(at: destination, identity: Self.oldIdentity)
        try enableRuntimeUseLease(at: destination)
        try enableRuntimeUseLease(at: source, previousIdentities: [Self.oldIdentity])
    }

    func enableRuntimeUseLease(at app: URL, previousIdentities: [String] = []) throws {
        try rewriteInfo(at: app, key: AppRuntimeUseLease.protocolInfoKey, value: AppRuntimeUseLease.protocolVersion)
        try rewriteInfo(at: app, key: AppRuntimeUseLease.previousIdentitiesInfoKey, value: previousIdentities)
        try writeExecutable(Data("fixture launcher, never run".utf8), at: app.appendingPathComponent(AppRuntimeUseLease.launcherPath))
    }

    func writeExecutable(_ data: Data, at executable: URL) throws {
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o755])
        try data.write(to: executable)
        guard chmod(executable.path, 0o755) == 0 else { throw AppInstallationError(.copyFailed) }
    }

    func executable(at app: URL) -> URL {
        app.appendingPathComponent(AppRuntimeUseLease.executablePath)
    }

    func expectRuntimeUseBlocked(at app: URL) throws {
        #expect(throws: AppRuntimeUseLeaseError.busy) {
            _ = try AppRuntimeUseLease.acquire(executableURL: executable(at: app), use: .runtime)
        }
    }

    func expectLeaseReleased(at app: URL) throws {
        let lease = try AppRuntimeUseLease.acquire(executableURL: executable(at: app), use: .installation)
        try lease.verify(at: executable(at: app))
        withExtendedLifetime(lease) {}
    }

    func replaceExecutableWithIdenticalCopy(at app: URL, savingTo saved: URL) throws {
        let executable = executable(at: app)
        let previousInode = try inode(at: executable)
        try FileManager.default.moveItem(at: executable, to: saved)
        try FileManager.default.copyItem(at: saved, to: executable)
        #expect(try inode(at: saved) == previousInode)
        #expect(try inode(at: executable) != previousInode)
        #expect(try Data(contentsOf: executable) == Data(contentsOf: saved))
    }

    func children(prefix: String) throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: applications, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix(prefix) }
    }

    func mode(at url: URL) throws -> mode_t {
        var value = stat()
        guard lstat(url.path, &value) == 0 else { throw AppInstallationError(.invalidSource) }
        return value.st_mode & 0o7777
    }

    func inode(at url: URL) throws -> ino_t {
        var value = stat()
        guard lstat(url.path, &value) == 0 else { throw AppInstallationError(.invalidSource) }
        return value.st_ino
    }

    func setAttribute(_ name: String, data: Data, at url: URL) throws {
        let result = data.withUnsafeBytes { setxattr(url.path, name, $0.baseAddress, $0.count, 0, 0) }
        guard result == 0 else { throw AppInstallationError(.copyFailed) }
    }

    func attribute(_ name: String, at url: URL) throws -> Data {
        let size = getxattr(url.path, name, nil, 0, 0, 0)
        guard size >= 0 else { throw AppInstallationError(.copyFailed) }
        var data = Data(count: size)
        let count = data.withUnsafeMutableBytes { getxattr(url.path, name, $0.baseAddress, $0.count, 0, 0) }
        guard count == size else { throw AppInstallationError(.copyFailed) }
        return data
    }
}

private final class AppInstallationErrorRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [AppInstallationError.Code] = []

    func record(_ code: AppInstallationError.Code) {
        lock.lock()
        defer { lock.unlock() }
        stored.append(code)
    }

    func codes() -> [AppInstallationError.Code] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

private final class AppInstallationCheckpointRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [AppInstallationCheckpoint] = []

    func record(_ phase: AppInstallationCheckpoint) {
        lock.lock()
        defer { lock.unlock() }
        stored.append(phase)
    }

    func phases() -> [AppInstallationCheckpoint] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}
