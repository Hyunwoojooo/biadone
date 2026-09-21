import CoordinatorSwift
import CryptoKit
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Claude payload signed assembly binding")
struct ClaudeInstalledRuntimeTrustTests {
    @Test("Only the exact signed assembly bytes supply the payload descriptor pin")
    func exactAssemblyBytes() throws {
        let pin = String(repeating: "a", count: 64)
        let data = try assembly(pin: pin)
        let signedHash = "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #expect(try ClaudeInstalledLauncher.manifestPin(in: data, verifiedAssemblySHA256: signedHash) == pin)
        let replaced = try assembly(pin: String(repeating: "b", count: 64))
        #expect(throws: (any Error).self) {
            try ClaudeInstalledLauncher.manifestPin(in: replaced, verifiedAssemblySHA256: signedHash)
        }
        #expect(throws: (any Error).self) {
            try ClaudeInstalledLauncher.manifestPin(in: data + Data([10]), verifiedAssemblySHA256: signedHash)
        }
    }

    @Test("A signed legacy app without a Claude descriptor cannot start the packaged launcher")
    func missingDescriptor() throws {
        let data = try assembly(pin: nil)
        let hash = "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #expect(throws: (any Error).self) {
            try ClaudeInstalledLauncher.manifestPin(in: data, verifiedAssemblySHA256: hash)
        }
    }

    private func assembly(pin: String?) throws -> Data {
        var paths = ["Contents/MacOS/blabee-coordinator", "Contents/Resources/Plugin/blabee/scripts/blabee-launcher"]
        if pin != nil { paths.append("Contents/Resources/claude/manifest.json") }
        let files: [[String: Any]] = paths.sorted().map { path in
            ["path": path, "sha256": path.hasSuffix("manifest.json") ? pin! : String(repeating: "0", count: 64),
             "size": 123, "mode": path.hasSuffix("manifest.json") ? "0644" : "0755"]
        }
        return try JSONSerialization.data(withJSONObject: ["schema_version": "blabee.macos-app-assembly.v2",
            "bundle_identifier": "com.biadone.blabee", "hash_phase": "assembled_payload_before_optional_code_signing",
            "compatible_previous_runtimes": [], "files": files], options: [.sortedKeys])
    }
}
