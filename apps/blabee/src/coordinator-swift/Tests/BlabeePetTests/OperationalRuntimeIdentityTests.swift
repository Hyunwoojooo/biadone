import CryptoKit
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("OperationalRuntimeIdentity", .serialized)
struct OperationalRuntimeIdentityTests {
    @Test("signed identity combiner is stable and binds both inputs")
    func signedIdentityCombiner() throws {
        let cdHash = Data((0..<20).map(UInt8.init))
        let manifestDigest = Data(SHA256.hash(data: Data("manifest-a".utf8)))
        let otherManifestDigest = Data(SHA256.hash(data: Data("manifest-b".utf8)))

        let first = try #require(OperationalRuntimeIdentity.combine(
            cdHash: cdHash,
            manifestDigest: manifestDigest
        ))
        let repeated = try #require(OperationalRuntimeIdentity.combine(
            cdHash: cdHash,
            manifestDigest: manifestDigest
        ))
        let changedCode = try #require(OperationalRuntimeIdentity.combine(
            cdHash: Data(cdHash.dropLast()),
            manifestDigest: manifestDigest
        ))
        let changedManifest = try #require(OperationalRuntimeIdentity.combine(
            cdHash: cdHash,
            manifestDigest: otherManifestDigest
        ))

        #expect(first == repeated)
        #expect(OperationalRuntimeIdentity.isValid(first))
        #expect(first != changedCode)
        #expect(first != changedManifest)
        #expect(OperationalRuntimeIdentity.combine(
            cdHash: Data(),
            manifestDigest: manifestDigest
        ) == nil)
        #expect(OperationalRuntimeIdentity.combine(
            cdHash: cdHash,
            manifestDigest: Data(repeating: 0, count: 31)
        ) == nil)
    }

    @Test("packaged identity requires matching running and installed signatures")
    func packagedIdentityRequiresMatchingSignatures() throws {
        let fixture = try RuntimeIdentityFixture()
        defer { fixture.remove() }
        let cdHash = Data(repeating: 0xA5, count: 20)
        let evidence = OperationalCodeSignatureEvidence(
            identifier: OperationalRuntimeIdentity.expectedBundleIdentifier,
            cdHash: cdHash,
            executableURL: fixture.executable
        )
        let verifier = OperationalCodeSignatureVerifier(
            runningCode: { evidence },
            installedCode: { _, _ in evidence }
        )
        let manifestDigest = Data(SHA256.hash(data: fixture.manifestData))
        let expected = try #require(OperationalRuntimeIdentity.combine(
            cdHash: cdHash,
            manifestDigest: manifestDigest
        ))

        #expect(OperationalRuntimeIdentity.resolve(
            executableURL: fixture.executable,
            environment: [
                OperationalRuntimeIdentity.environmentKey:
                    "sha256:" + String(repeating: "f", count: 64),
            ],
            signatureVerifier: verifier
        ) == expected)
        #expect(OperationalRuntimeIdentity.installedIdentity(
            forExecutable: fixture.executable,
            signatureVerifier: verifier
        ) == expected)
    }

    @Test("packaged signature failure never downgrades to environment or filesystem identity")
    func packagedSignatureFailureIsClosed() throws {
        let fixture = try RuntimeIdentityFixture()
        defer { fixture.remove() }
        let environmentIdentity = "sha256:" + String(repeating: "e", count: 64)
        let running = OperationalCodeSignatureEvidence(
            identifier: OperationalRuntimeIdentity.expectedBundleIdentifier,
            cdHash: Data(repeating: 0x11, count: 20),
            executableURL: fixture.executable
        )
        let installed = OperationalCodeSignatureEvidence(
            identifier: OperationalRuntimeIdentity.expectedBundleIdentifier,
            cdHash: Data(repeating: 0x22, count: 20),
            executableURL: fixture.executable
        )
        let mismatch = OperationalCodeSignatureVerifier(
            runningCode: { running },
            installedCode: { _, _ in installed }
        )
        let unavailable = OperationalCodeSignatureVerifier(
            runningCode: { nil },
            installedCode: { _, _ in nil }
        )

        #expect(OperationalRuntimeIdentity.resolve(
            executableURL: fixture.executable,
            environment: [OperationalRuntimeIdentity.environmentKey: environmentIdentity],
            signatureVerifier: mismatch
        ).isEmpty)
        #expect(OperationalRuntimeIdentity.resolve(
            executableURL: fixture.executable,
            environment: [OperationalRuntimeIdentity.environmentKey: environmentIdentity],
            signatureVerifier: unavailable
        ).isEmpty)
        #expect(OperationalRuntimeIdentity.installedIdentity(
            forExecutable: fixture.executable,
            signatureVerifier: unavailable
        ) == nil)
    }

    @Test("packaged identity rejects identifier and executable path substitution")
    func packagedIdentityRejectsSubstitution() throws {
        let fixture = try RuntimeIdentityFixture()
        defer { fixture.remove() }
        let valid = OperationalCodeSignatureEvidence(
            identifier: OperationalRuntimeIdentity.expectedBundleIdentifier,
            cdHash: Data(repeating: 0x33, count: 20),
            executableURL: fixture.executable
        )
        let wrongIdentifier = OperationalCodeSignatureEvidence(
            identifier: "com.example.lookalike",
            cdHash: valid.cdHash,
            executableURL: fixture.executable
        )
        let wrongPath = OperationalCodeSignatureEvidence(
            identifier: OperationalRuntimeIdentity.expectedBundleIdentifier,
            cdHash: valid.cdHash,
            executableURL: fixture.root.appendingPathComponent("other")
        )

        for invalid in [wrongIdentifier, wrongPath] {
            let verifier = OperationalCodeSignatureVerifier(
                runningCode: { valid },
                installedCode: { _, _ in invalid }
            )
            #expect(OperationalRuntimeIdentity.resolve(
                executableURL: fixture.executable,
                environment: [:],
                signatureVerifier: verifier
            ).isEmpty)
        }
    }

    @Test("unbundled SwiftPM runtime retains explicit environment fallback")
    func unbundledEnvironmentFallback() throws {
        let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("bri-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("blabee-coordinator")
        try Data("test".utf8).write(to: executable)
        let expected = "sha256:" + String(repeating: "d", count: 64)

        let actual = OperationalRuntimeIdentity.resolve(
            executableURL: executable,
            environment: [OperationalRuntimeIdentity.environmentKey: expected],
            signatureVerifier: OperationalCodeSignatureVerifier(
                runningCode: { nil },
                installedCode: { _, _ in nil }
            )
        )

        #expect(actual == expected)
    }

    @Test("live verifier accepts a valid signed bundle and rejects sealed manifest drift")
    func liveInstalledSignatureVerification() throws {
        let fixture = try RuntimeIdentityFixture(useMachOExecutable: true)
        defer { fixture.remove() }
        try fixture.sign()

        let identity = try #require(OperationalRuntimeIdentity.installedIdentity(
            forExecutable: fixture.executable
        ))
        #expect(OperationalRuntimeIdentity.isValid(identity))

        var tampered = fixture.manifestData
        tampered.append(0x20)
        try tampered.write(to: fixture.manifestURL)
        #expect(OperationalRuntimeIdentity.installedIdentity(
            forExecutable: fixture.executable
        ) == nil)
    }
}

private struct RuntimeIdentityFixture {
    let root: URL
    let executable: URL
    let manifestURL: URL
    let manifestData: Data

    init(useMachOExecutable: Bool = false) throws {
        root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("bri-\(UUID().uuidString.prefix(8))", isDirectory: true)
        executable = root.appendingPathComponent(
            "Blabee.app/Contents/MacOS/blabee-coordinator"
        )
        manifestURL = root.appendingPathComponent(
            "Blabee.app/Contents/Resources/assembly-manifest.json"
        )
        let launcher = root.appendingPathComponent(
            "Blabee.app/Contents/Resources/Plugin/blabee/scripts/blabee-launcher"
        )
        try FileManager.default.createDirectory(
            at: executable.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: manifestURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: launcher.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if useMachOExecutable {
            try FileManager.default.copyItem(
                at: URL(fileURLWithPath: "/usr/bin/true"),
                to: executable
            )
        } else {
            try Data("fixture-executable".utf8).write(to: executable)
        }
        guard chmod(executable.path, mode_t(0o755)) == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: launcher)
        guard chmod(launcher.path, mode_t(0o755)) == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        let infoPlist = root.appendingPathComponent("Blabee.app/Contents/Info.plist")
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: [
                "CFBundleIdentifier": OperationalRuntimeIdentity.expectedBundleIdentifier,
                "CFBundleExecutable": "blabee-coordinator",
                "CFBundleName": "Blabee",
                "CFBundlePackageType": "APPL",
                "CFBundleVersion": "1",
                "CFBundleShortVersionString": "0.1.0",
            ],
            format: .xml,
            options: 0
        )
        try plistData.write(to: infoPlist)
        manifestData = try JSONSerialization.data(
            withJSONObject: [
                "schema_version": OperationalRuntimeIdentity.assemblyManifestSchemaVersion,
                "bundle_identifier": OperationalRuntimeIdentity.expectedBundleIdentifier,
                "hash_phase": "assembled_payload_before_optional_code_signing",
                "files": [
                    [
                        "path": "Contents/MacOS/blabee-coordinator",
                        "sha256": String(repeating: "a", count: 64),
                        "size": 18,
                        "mode": "0755",
                    ],
                    [
                        "path": "Contents/Resources/Plugin/blabee/scripts/blabee-launcher",
                        "sha256": String(repeating: "b", count: 64),
                        "size": 1,
                        "mode": "0755",
                    ],
                ],
            ],
            options: [.sortedKeys]
        )
        try manifestData.write(to: manifestURL)
    }

    func sign() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        process.arguments = [
            "--force", "--sign", "-", "--timestamp=none", "--options", "runtime",
            root.appendingPathComponent("Blabee.app").path,
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationReason == .exit,
              process.terminationStatus == 0
        else { throw CocoaError(.fileWriteUnknown) }
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }
}
