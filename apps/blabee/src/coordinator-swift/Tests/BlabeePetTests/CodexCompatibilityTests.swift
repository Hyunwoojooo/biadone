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
    #expect(CodexCompatibility.supportedVersions == ["0.149.1", "0.150.1", "0.151.0"])

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

    let unsupported = CodexCompatibility.qualify(version: "0.149.0")
    #expect(unsupported == .notAllowlisted(version: "0.149.0"))
    #expect(!unsupported.isApprovedForManagedUse)
    #expect(unsupported.diagnosticCode == "codex_version_not_allowlisted")

    let unavailable = CodexCompatibility.qualify(version: nil)
    #expect(unavailable == .unavailable)
    #expect(!unavailable.isApprovedForManagedUse)
    #expect(unavailable.diagnosticCode == "codex_version_unavailable")
}
