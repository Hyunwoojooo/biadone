import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("Copied native check evidence redacts home and runtime paths without losing known version and stage")
func codexPluginCheckReportCopyIsSanitized() {
    var report = CodexPluginRecheckReport(startedAt: Date(timeIntervalSince1970: 100))
    report.completedAt = Date(timeIntervalSince1970: 102)
    report.elapsedSeconds = 2
    report.result = .init(
        state: .error(code: "codex_native_probe_timeout"),
        evidence: .init(
            stage: .marketplaceList,
            sourcePath: "/Users/private-name/.local/bin/codex",
            canonicalPath: "/Users/private-name/.codex/packages/standalone/private-runtime/bin/codex",
            codexVersion: "0.153.4"
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "15")
    #expect(text.contains("app_build=15"))
    #expect(text.contains("codex_version=0.153.4"))
    #expect(text.contains("error_code=codex_native_probe_timeout"))
    #expect(text.contains("stage=marketplace_list"))
    #expect(text.contains("source_path=~/.local/bin/codex"))
    #expect(text.contains("canonical_path=~/.codex/packages/standalone/<runtime>/bin/codex"))
    #expect(!text.contains("private-name"))
    #expect(!text.contains("private-runtime"))
    #expect(!text.contains("/Users/"))
    #expect(text.contains("hook_trust=not_verified"))
    #expect(text.contains("service_and_selection_roundtrip=not_tested_by_this_check"))
}

@Test("Copied check diagnostic omits arbitrary reason, unknown paths, control characters and malformed fields")
func codexPluginCheckReportCopyRejectsUnsafeFields() {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.elapsedSeconds = 0
    report.result = .init(
        state: .unavailable(reason: "Computer Use -10005 stderr TOKEN=private-secret /Users/private-name"),
        evidence: .init(
            stage: .bundledResources,
            sourcePath: "/private/custom/private-secret/codex",
            canonicalPath: "/Users/private-name/.local/bin/codex\nTOKEN=private-secret",
            codexVersion: "0.153.4\nTOKEN=private-secret",
            errorCode: "-10005 private-secret"
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "15\nTOKEN=private-secret")
    #expect(!text.contains("private-secret"))
    #expect(!text.contains("private-name"))
    #expect(!text.contains("-10005"))
    #expect(!text.contains("TOKEN"))
    #expect(!text.contains("stderr"))
    #expect(text.contains("source_path=omitted"))
    #expect(text.contains("canonical_path=omitted"))
    #expect(text.contains("codex_version=unknown"))
    #expect(text.contains("app_build=unknown"))
    #expect(text.contains("error_code=codex_plugin_setup_check_failed"))
}

@Test("An installed Plugin check is not labeled as Hook trust or full roundtrip success")
func codexPluginCheckReportDoesNotOverclaimReadiness() {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.result = .init(state: .installedNeedsHookReview(version: "0.1.0"))
    let text = report.sanitizedDiagnosticText(appBuild: nil)
    #expect(text.contains("plugin_installed_hook_trust_unknown"))
    #expect(text.contains("source_path=unknown"))
    #expect(text.contains("canonical_path=unknown"))
    #expect(text.contains("codex_version=unknown"))
    #expect(text.contains("stage=unknown"))
    #expect(report.title == "마지막 실행 검사 완료")
}
