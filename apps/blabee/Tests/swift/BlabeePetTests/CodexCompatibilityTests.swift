import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("Codex compatibility parses only bounded canonical version output")
func codexCompatibilityVersionParsing() {
    #expect(CodexCompatibility.parseVersionOutput(Data("codex-cli 0.150.1\n".utf8))
        == "0.150.1")
    #expect(CodexCompatibility.parseVersionOutput("  codex-cli 0.149.1  \n") == "0.149.1")

    for malformed in [
        "Codex 0.150.1",
        "codex-cli v0.150.1",
        "codex-cli 0.150",
        "codex-cli 0.150.1 extra",
        "codex-cli 0.159.2-alpha.1",
        "codex-cli 0.160.0-alpha.1",
        "codex-cli 0.162.1-alpha.1",
        "codex-cli 0.163.0-alpha.1",
        "codex-cli 0.164.0-alpha.1",
        "codex-cli ٠.١٥٠.١",
        "codex-cli 0.150.1\ncodex-cli 0.149.1",
    ] {
        #expect(CodexCompatibility.parseVersionOutput(malformed) == nil)
    }

    let oversized = Data(repeating: 0x31, count: CodexCompatibility.maximumVersionOutputBytes + 1)
    #expect(CodexCompatibility.parseVersionOutput(oversized) == nil)
    #expect(CodexCompatibility.parseVersionOutput(
        String(repeating: "1", count: CodexCompatibility.maximumVersionOutputBytes + 1)
    ) == nil)
    #expect(CodexCompatibility.parseVersionOutput(Data([0xFF])) == nil)
}

@Test("Codex compatibility keeps managed use fail closed")
func codexCompatibilityQualification() {
    #expect(CodexCompatibility.supportedVersions == [
        "0.149.1", "0.150.1", "0.151.0", "0.155.0", "0.155.1", "0.156.0", "0.156.1",
        "0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0", "0.164.0",
    ])
    #expect(CodexCompatibility.pluginCLISupportedVersions == [
        "0.151.0", "0.152.0", "0.152.1", "0.153.0", "0.153.1", "0.153.2",
        "0.153.3", "0.153.4", "0.154.0", "0.155.0", "0.155.1", "0.156.0", "0.156.1",
        "0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0", "0.164.0",
    ])
    #expect(CodexCompatibility.supportedVersions(for: .managedAppServer)
        == CodexCompatibility.supportedVersions)
    #expect(CodexCompatibility.supportedVersions(for: .pluginCLI)
        == CodexCompatibility.pluginCLISupportedVersions)
    #expect(CodexCompatibility.supportedVersions.intersection(
        CodexCompatibility.pluginCLISupportedVersions
    ) == [
        "0.151.0", "0.155.0", "0.155.1", "0.156.0", "0.156.1", "0.157.0", "0.157.1",
        "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0", "0.164.0",
    ])

    for version in CodexCompatibility.pluginCLISupportedVersions.subtracting(
        CodexCompatibility.supportedVersions
    ) {
        #expect(CodexCompatibility.qualify(version: version)
            == .notAllowlisted(version: version))
        #expect(!CodexCompatibility.qualify(version: version).isApprovedForManagedUse)
    }

    for version in CodexCompatibility.supportedVersions {
        let qualification = CodexCompatibility.qualify(version: version)
        #expect(qualification == .supported(version: version))
        #expect(qualification.isApprovedForManagedUse)
        #expect(qualification.diagnosticCode == "codex_version_supported")
    }

    let alpha = CodexCompatibility.qualify(
        version: CodexCompatibility.alphaBaselineVersion
    )
    #expect(alpha == .alphaQualificationRequired(version: "0.148.0"))
    #expect(!alpha.isApprovedForManagedUse)
    #expect(alpha.diagnosticCode == "codex_alpha_qualification_required")

    for version in ["0.149.0", "0.156.2", "0.157.2", "0.158.1", "0.159.4", "0.160.2", "0.161.1", "0.162.2", "0.163.1", "0.164.1", "0.165.0"] {
        let unsupported = CodexCompatibility.qualify(version: version)
        #expect(unsupported == .notAllowlisted(version: version))
        #expect(!unsupported.isApprovedForManagedUse)
        #expect(unsupported.diagnosticCode == "codex_version_not_allowlisted")
    }

    let unavailable = CodexCompatibility.qualify(version: nil)
    #expect(unavailable == .unavailable)
    #expect(!unavailable.isApprovedForManagedUse)
    #expect(unavailable.diagnosticCode == "codex_version_unavailable")
}
