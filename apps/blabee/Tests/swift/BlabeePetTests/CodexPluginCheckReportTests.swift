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
    #expect(text.contains("resolved_target_path=~/.codex/packages/standalone/<runtime>/bin/codex"))
    #expect(text.contains("installation_layout=standalone"))
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
    #expect(text.contains("resolved_target_path=unknown"))
    #expect(text.contains("installation_layout=unknown"))
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

@Test("Early path rejection copies its resolved target as an observation without a canonical or version claim")
func codexPluginCheckReportRetainsEarlyResolvedTarget() {
    let target = "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"
    var report = CodexPluginRecheckReport()
    report.result = .init(
        state: .error(code: "codex_native_path_unsafe"),
        evidence: .init(
            stage: .nativeExecutable, sourcePath: "/opt/homebrew/bin/codex",
            pathDiagnostic: .init(
                issue: .groupWritable, role: .sourceAncestor,
                path: "/opt/homebrew/bin", resolvedTargetPath: target
            )
        )
    )
    let text = report.sanitizedDiagnosticText(appBuild: "83")
    #expect(report.result?.evidence.resolvedTargetPath == target)
    #expect(report.result?.evidence.installationLayout == .npm)
    #expect(text.contains("canonical_path=unknown"))
    #expect(text.contains("codex_version=unknown"))
    #expect(text.contains("resolved_target_path=\(target)"))
    #expect(text.contains("installation_layout=npm"))
    #expect(text.contains("path_issue=group_writable"))
    #expect(text.contains("hook_trust=not_verified"))
}

@Test("Installation paths are classified lexically and copied only through known redacted layouts")
func codexPluginCheckReportClassifiesAndRedactsInstallationLayouts() {
    let examples: [(String, CodexInstallationLayout, String)] = [
        ("/opt/homebrew/Caskroom/codex/private-runtime/codex-aarch64-apple-darwin", .homebrewCask,
         "/opt/homebrew/Caskroom/codex/<runtime>/codex-aarch64-apple-darwin"),
        ("/usr/local/Caskroom/codex/private-runtime/codex-x86_64-apple-darwin", .homebrewCask,
         "/usr/local/Caskroom/codex/<runtime>/codex-x86_64-apple-darwin"),
        ("/opt/homebrew/Cellar/codex/private-runtime/bin/codex", .homebrewCellar,
         "/opt/homebrew/Cellar/codex/<runtime>/bin/codex"),
        ("/usr/local/Cellar/codex/private-runtime/bin/codex", .homebrewCellar,
         "/usr/local/Cellar/codex/<runtime>/bin/codex"),
        ("/usr/local/lib/node_modules/@openai/codex/bin/codex.js", .npm,
         "/usr/local/lib/node_modules/@openai/codex/bin/codex.js"),
        ("/opt/homebrew/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex", .npm,
         "/opt/homebrew/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex"),
        ("/Users/private-name/.nvm/versions/node/private-node/lib/node_modules/@openai/codex/bin/codex.js", .npm,
         "~/.nvm/versions/node/<node>/lib/node_modules/@openai/codex/bin/codex.js"),
        ("/Users/private-name/.nvm/versions/node/private-node/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex", .npm,
         "~/.nvm/versions/node/<node>/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex"),
        ("/Users/private-name/.npm-global/lib/node_modules/@openai/codex/bin/codex.js", .npm,
         "~/.npm-global/lib/node_modules/@openai/codex/bin/codex.js"),
        ("/Users/private-name/.codex/packages/standalone/private-runtime/bin/codex", .standalone,
         "~/.codex/packages/standalone/<runtime>/bin/codex"),
        ("/Users/private-name/.codex/packages/standalone/current/bin/codex", .standalone,
         "~/.codex/packages/standalone/current/bin/codex"),
        ("/opt/homebrew/bin/codex", .unknown, "/opt/homebrew/bin/codex"),
        ("/Users/private-name/.local/bin/codex", .unknown, "~/.local/bin/codex"),
        ("/Users/private-name/private-project/codex", .other, "omitted"),
        ("/Users/private-name/private-project/node_modules/@openai/codex/bin/codex.js", .other, "omitted"),
        ("/opt/homebrew/lib/node_modules/private-package/private-secret", .other, "omitted"),
    ]
    for (path, layout, redacted) in examples {
        var report = CodexPluginRecheckReport()
        report.result = .init(state: .error(code: "codex_native_path_unsafe"), evidence: .init(
            pathDiagnostic: .init(issue: .groupWritable, resolvedTargetPath: path)
        ))
        let text = report.sanitizedDiagnosticText(appBuild: "83")
        #expect(report.result?.evidence.installationLayout == layout)
        #expect(text.contains("resolved_target_path=\(redacted)\n"))
        #expect(text.contains("installation_layout=\(layout.rawValue)\n"))
        #expect(!text.contains("private-"))
        #expect(!text.contains("/Users/"))
    }
}

@Test("Malformed targets never become install classifications or copied paths", arguments: [
    "opt/homebrew/Caskroom/codex/0.154.0/bin/codex",
    "/opt/homebrew/Caskroom/codex/../private-secret/bin/codex",
    "/opt/homebrew/Cellar/codex/./private-secret/bin/codex",
    "/opt/homebrew//Caskroom/codex/private-secret/bin/codex",
    "/Users//.codex/packages/standalone/current/bin/codex",
    "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js\nTOKEN=private-secret",
    "/opt/homebrew/Caskroom/codex/0.154.0/bin/codex\0private-secret",
    "/Users/private-name/.codex/packages/standalone/" + String(repeating: "x", count: 4_096) + "/bin/codex",
])
func codexPluginCheckReportOmitsMalformedResolvedTargets(_ path: String) {
    var report = CodexPluginRecheckReport()
    report.result = .init(state: .error(code: "codex_native_path_unsafe"), evidence: .init(
        sourcePath: path, canonicalPath: path,
        pathDiagnostic: .init(issue: .invalidPath, path: path, resolvedTargetPath: path)
    ))
    let text = report.sanitizedDiagnosticText(appBuild: "83")
    #expect(report.result?.evidence.installationLayout == .unknown)
    for key in ["source_path", "canonical_path", "failed_path", "resolved_target_path"] {
        #expect(text.contains("\(key)=omitted\n"))
    }
    #expect(!text.contains("private-secret"))
    #expect(!text.contains("TOKEN"))
}

@Test("A later failure's observed target takes precedence without rewriting the earlier canonical evidence")
func codexPluginCheckEvidenceKeepsResolvedAndCanonicalMeaningsSeparate() {
    let canonical = "/opt/homebrew/Cellar/codex/0.154.0/bin/codex"
    let resolved = "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"
    let evidence = CodexPluginCheckEvidence(
        sourcePath: "/opt/homebrew/bin/codex", canonicalPath: canonical,
        pathDiagnostic: .init(issue: .groupWritable, resolvedTargetPath: resolved)
    )
    #expect(evidence.canonicalPath == canonical)
    #expect(evidence.resolvedTargetPath == resolved)
    #expect(evidence.installationLayout == .npm)
    #expect(CodexPluginCheckEvidence(canonicalPath: canonical).resolvedTargetPath == canonical)
    #expect(CodexPluginCheckEvidence().resolvedTargetPath == nil)
    #expect(CodexPluginCheckEvidence().installationLayout == .unknown)
}

@Test("A check without native observations copies unknown fields instead of inferred attempts or timings")
func codexPluginCheckReportLeavesMissingNativeObservationsUnknown() {
    var report = CodexPluginRecheckReport()
    report.result = .init(state: .installedNeedsHookReview(version: "0.1.3"))
    let text = report.sanitizedDiagnosticText(appBuild: "86")
    #expect(report.result?.evidence.nativeOperation == nil)
    for key in [
        "native_stage", "native_command_invocation_attempted", "native_cached_failure",
        "native_exit_code", "native_termination_signal", "native_elapsed_ms",
        "native_preparation_elapsed_ms", "native_command_elapsed_ms",
    ] {
        #expect(text.contains("\(key)=unknown\n"))
    }
    #expect(text.contains("hook_trust=not_verified"))
    #expect(text.contains("service_and_selection_roundtrip=not_tested_by_this_check"))
}

@Test("Native inspection diagnostics copy only closed fields and retain request phase timings")
func codexPluginCheckReportCopiesSafeNativeInspectionObservation() {
    var nativeOperation = CodexNativeOperationObservation(
        stage: .command, commandInvocationAttempted: true,
        exitCode: 124, terminationSignal: 15,
        codexVersion: "0.163.0\nTOKEN=private-secret",
        executableIdentity: "/Users/private-name/private-identity-hash"
    )
    nativeOperation.elapsedMilliseconds = 23_450
    nativeOperation.preparationElapsedMilliseconds = 2_050
    nativeOperation.commandElapsedMilliseconds = 21_400
    var report = CodexPluginRecheckReport()
    report.result = .init(state: .error(code: "codex_native_inspection_timeout"), evidence: .init(
        stage: .pluginList, codexVersion: "0.163.0", nativeOperation: nativeOperation
    ))
    let text = report.sanitizedDiagnosticText(appBuild: "86")
    #expect(text.contains("error_code=codex_native_inspection_timeout\n"))
    #expect(text.contains("\nstage=plugin_list\n"))
    #expect(text.contains("native_stage=command\n"))
    #expect(text.contains("native_command_invocation_attempted=true\n"))
    #expect(text.contains("native_cached_failure=false\n"))
    #expect(text.contains("native_exit_code=124\n"))
    #expect(text.contains("native_termination_signal=15\n"))
    #expect(text.contains("native_elapsed_ms=23450\n"))
    #expect(text.contains("native_preparation_elapsed_ms=2050\n"))
    #expect(text.contains("native_command_elapsed_ms=21400\n"))
    #expect(text.contains("codex_version=0.163.0\n"))
    #expect(text.contains("hook_trust=not_verified"))
    #expect(text.contains("service_and_selection_roundtrip=not_tested_by_this_check"))
    #expect(!text.contains("private-"))
    #expect(!text.contains("TOKEN"))
    #expect(!text.contains("/Users/"))
    #expect(!text.contains("executable_identity"))
}

@Test("Check stage, native phase, command attempt and cached failure remain separate observations")
func codexPluginCheckReportDoesNotInferCommandInvocationFromStage() {
    let observations: [CodexNativeOperationObservation] = [
        .init(stage: .notarization),
        .init(stage: .command),
        .init(stage: .command, commandInvocationAttempted: true),
        .init(stage: .qualification, cachedFailure: true),
    ]
    for nativeOperation in observations {
        var report = CodexPluginRecheckReport()
        report.result = .init(state: .error(code: "codex_native_probe_timeout"), evidence: .init(
            stage: .pluginList, nativeOperation: nativeOperation
        ))
        let text = report.sanitizedDiagnosticText(appBuild: "86")
        #expect(text.contains("\nstage=plugin_list\n"))
        #expect(text.contains("native_stage=\(nativeOperation.stage.rawValue)\n"))
        #expect(text.contains("native_command_invocation_attempted=\(nativeOperation.commandInvocationAttempted)\n"))
        #expect(text.contains("native_cached_failure=\(nativeOperation.cachedFailure)\n"))
        #expect(text.contains("native_exit_code=unknown\n"))
        #expect(text.contains("native_termination_signal=unknown\n"))
        #expect(text.contains("native_command_elapsed_ms=unknown\n"))
        #expect(text.contains("hook_trust=not_verified"))
        #expect(text.contains("service_and_selection_roundtrip=not_tested_by_this_check"))
    }
}

@Test("Invalid native durations stay unknown while a measured zero remains zero", arguments: [-1, Int.min, 0])
func codexPluginCheckReportSanitizesNativeDurations(_ milliseconds: Int) {
    var nativeOperation = CodexNativeOperationObservation(stage: .notarization)
    nativeOperation.elapsedMilliseconds = milliseconds
    nativeOperation.preparationElapsedMilliseconds = milliseconds
    nativeOperation.commandElapsedMilliseconds = milliseconds
    var report = CodexPluginRecheckReport()
    report.result = .init(state: .error(code: "codex_native_probe_timeout"), evidence: .init(
        stage: .pluginList, nativeOperation: nativeOperation
    ))
    let text = report.sanitizedDiagnosticText(appBuild: "86")
    let expected = milliseconds == 0 ? "0" : "unknown"
    for key in ["native_elapsed_ms", "native_preparation_elapsed_ms", "native_command_elapsed_ms"] {
        #expect(text.contains("\(key)=\(expected)\n"))
    }
}
