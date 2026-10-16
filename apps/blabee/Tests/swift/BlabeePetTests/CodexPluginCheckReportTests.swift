import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("Copied native check evidence redacts home and runtime paths without losing known version and stage", .petLanguage(.korean))
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

@Test("Copied check diagnostic omits arbitrary reason, unknown paths, control characters and malformed fields", .petLanguage(.korean))
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

@Test("An installed Plugin check is not labeled as Hook trust or full roundtrip success", .petLanguage(.korean))
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

@Test("Rejected native version remains visible in copied diagnostics without claiming qualification", .petLanguage(.korean))
func codexPluginCheckReportIncludesRejectedVersion() {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.result = .init(
        state: .error(code: "codex_native_version_unqualified"),
        evidence: .init(
            stage: .nativeExecutable,
            sourcePath: "/opt/homebrew/bin/codex",
            canonicalPath: "/opt/homebrew/Caskroom/codex/9.9.9/bin/codex",
            codexVersion: "9.9.9"
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "63")
    #expect(text.contains("result=check_failed"))
    #expect(text.contains("error_code=codex_native_version_unqualified"))
    #expect(text.contains("codex_version=9.9.9"))
    #expect(text.contains("source_path=/opt/homebrew/bin/codex"))
    #expect(text.contains("canonical_path=/opt/homebrew/Caskroom/codex/<runtime>"))
    #expect(text.contains("hook_trust=not_verified"))
}

@Test("Copied path diagnostics expose stable reasons while omitting private failing paths", .petLanguage(.korean))
func codexPluginCheckReportIncludesSafePathDiagnostic() {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.result = .init(
        state: .error(code: "codex_native_path_unsafe"),
        evidence: .init(
            stage: .nativeExecutable,
            sourcePath: "/Users/private-name/.local/bin/codex",
            pathDiagnostic: .init(
                issue: .untrustedOwner, role: .sourceAncestor,
                path: "/Users/private-name/private-project"
            )
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "68")
    #expect(text.contains("error_code=codex_native_path_unsafe"))
    #expect(text.contains("path_issue=untrusted_owner"))
    #expect(text.contains("path_component=source_ancestor"))
    #expect(text.contains("failed_path=omitted"))
    #expect(text.contains("canonical_path=unknown"))
    #expect(!text.contains("private-name"))
    #expect(!text.contains("private-project"))
}

@Test("Known Homebrew diagnostics preserve safe install layout on either architecture", .petLanguage(.korean),
      arguments: ["/opt/homebrew", "/usr/local"])
func codexPluginCheckReportRetainsKnownInstallationLayout(prefix: String) {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.result = .init(
        state: .error(code: "codex_native_path_unsafe"),
        evidence: .init(
            stage: .nativeExecutable,
            sourcePath: "\(prefix)/bin/codex",
            canonicalPath: "\(prefix)/Caskroom/codex/private-runtime/bin/codex",
            pathDiagnostic: .init(issue: .groupWritable, role: .sourceAncestor, path: prefix)
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "68")
    #expect(text.contains("source_path=\(prefix)/bin/codex"))
    #expect(text.contains("canonical_path=\(prefix)/Caskroom/codex/<runtime>"))
    #expect(text.contains("failed_path=\(prefix)"))
    #expect(text.contains("path_issue=group_writable"))
    #expect(!text.contains("private-runtime"))
}

@Test("Path diagnostic control characters and arbitrary locations are never copied", .petLanguage(.korean))
func codexPluginCheckReportRejectsUnsafeDiagnosticPath() {
    var report = CodexPluginRecheckReport()
    report.completedAt = report.startedAt
    report.result = .init(
        state: .error(code: "codex_native_path_unsafe"),
        evidence: .init(pathDiagnostic: .init(
            issue: .aclUnreadable, role: .target, path: "/opt/homebrew\nTOKEN=private-secret"
        ))
    )
    let text = report.sanitizedDiagnosticText(appBuild: "68")
    #expect(text.contains("path_issue=acl_unreadable"))
    #expect(text.contains("path_component=target"))
    #expect(text.contains("failed_path=omitted"))
    #expect(!text.contains("TOKEN"))
    #expect(!text.contains("private-secret"))
}
