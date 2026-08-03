import Foundation

@main
enum LauncherModelSmoke {
    static func main() throws {
        try expect(
            LauncherShortcut.displayName == "⇧ Space",
            "Shift-Space shortcut"
        )
        try expect(
            LauncherIPC.requestID(
                uuid: UUID(
                    uuidString: "11111111-2222-3333-4444-555555555555"
                )!
            ) == "request-11111111-2222-3333-4444-555555555555",
            "request ID"
        )
        try expect(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42"
            ) != nil,
            "exact GitHub destination"
        )
        try expect(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42?token=private"
            ) == nil,
            "GitHub query rejection"
        )
        try expect(
            SafeURLPolicy.dashboardURL(
                path: "/",
                baseURL: URL(string: "https://evil.example")!
            ) == nil,
            "dashboard host rejection"
        )
        let validProjectionString = #"""
        {
          "contract":"blabase-launcher-attention-v1",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"insufficient_evidence",
          "card":null,
          "clarificationQuestion":null,
          "scopeStatement":"연결되고 갱신된 source만 평가했습니다.",
          "unavailableSources":["github"],
          "dashboardPath":"/"
        }
        """#
        let validProjection = Data(validProjectionString.utf8)
        _ = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: validProjection
        )
        try expectThrows("projection invariant") {
            let invalidProjection = Data(
                validProjectionString.replacingOccurrences(
                    of: #""dashboardPath":"/""#,
                    with: #""dashboardPath":"/private""#
                ).utf8
            )
            _ = try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: invalidProjection
            )
        }

        let childEnvironment =
            LauncherRuntimeConfiguration.sanitizedChildEnvironment([
                "PATH": "/usr/bin",
                "GITHUB_APP_CLIENT_ID": "connector-config",
                "NODE_OPTIONS": "--require=/tmp/untrusted.js",
                "DYLD_INSERT_LIBRARIES": "/tmp/untrusted.dylib",
                "BLABASE_LAUNCHER_SOURCE_MODE": "managed",
                "BLABASE_CODE_COMMIT_SHA": String(repeating: "a", count: 40),
                "GITHUB_SHA": String(repeating: "b", count: 40)
            ])
        try expect(childEnvironment["PATH"] == "/usr/bin", "PATH retention")
        try expect(
            childEnvironment["GITHUB_APP_CLIENT_ID"] == "connector-config",
            "connector environment retention"
        )
        try expect(childEnvironment["NODE_OPTIONS"] == nil, "Node injection")
        try expect(
            childEnvironment["DYLD_INSERT_LIBRARIES"] == nil,
            "dynamic-loader injection"
        )
        try expect(
            childEnvironment["BLABASE_LAUNCHER_SOURCE_MODE"] == nil,
            "source-mode injection"
        )
        try expect(
            childEnvironment["BLABASE_CODE_COMMIT_SHA"] == nil,
            "provenance injection"
        )
        try expect(
            childEnvironment["GITHUB_SHA"] == nil,
            "ambient CI provenance injection"
        )

        let manifest = Data(
            """
            {
              "contract":"blabase-launcher-runtime-manifest-v1",
              "codeState":"dirty_worktree",
              "codeFingerprintSha256":"\(String(repeating: "b", count: 64))",
              "agentSha256":"\(String(repeating: "c", count: 64))"
            }
            """.utf8
        )
        let runtimeEnvironment = try LauncherRuntimeConfiguration
            .validatedRuntimeEnvironment(manifestData: manifest)
        try expect(
            runtimeEnvironment["BLABASE_CODE_FINGERPRINT_SHA256"] ==
                String(repeating: "b", count: 64),
            "runtime fingerprint provenance"
        )

        var policy = SupervisorRestartPolicy(
            maximumRestarts: 1,
            window: 60,
            delaysNanoseconds: [1]
        )
        let now = Date(timeIntervalSince1970: 1_000)
        try expect(
            policy.recordUnexpectedExit(at: now) ==
                .restart(afterNanoseconds: 1),
            "bounded restart first attempt"
        )
        try expect(
            policy.recordUnexpectedExit(at: now) == .stop,
            "bounded restart stop"
        )

        print("Blabase launcher model smoke passed")
    }

    private static func expect(
        _ condition: @autoclosure () -> Bool,
        _ label: String
    ) throws {
        guard condition() else {
            throw SmokeError.failed(label)
        }
    }

    private static func expectThrows(
        _ label: String,
        _ action: () throws -> Void
    ) throws {
        do {
            try action()
            throw SmokeError.failed(label)
        } catch is SmokeError {
            throw SmokeError.failed(label)
        } catch {
            return
        }
    }
}

private enum SmokeError: Error {
    case failed(String)
}
