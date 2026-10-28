import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Claude detached runtime arguments")
struct ClaudeInstalledLauncherArgumentsTests {
    private let source = URL(fileURLWithPath: "/Applications/Blabee.app")
    private let copy = URL(fileURLWithPath: "/private/tmp/isolated Claude runtime/Blabee.app")
    private let identity = "sha256:" + String(repeating: "a", count: 64)

    private func arguments() -> [String] {
        ["--owner-socket", "/private/tmp/owner.sock", "--session-socket", "/private/tmp/session.sock",
         "--runtime-identity", identity, "--cwd", "/private/tmp/project ' 한글",
         "--claude-bin", "/private/tmp/cli/claude",
         "--node-bin", source.appendingPathComponent("Contents/Resources/claude/node/bin/node").path,
         "--payload-root", source.appendingPathComponent("Contents/Resources/claude/payload").path,
         "--configuration-root", "/private/tmp/claude-config", "--observe-session", "--terminal", "--",
         "--resume", "saved conversation", "--", "--payload-root", "literal prompt $(not executed)"]
    }

    @Test("Only exact bundled resource paths move; host arguments and session binding are unchanged")
    func rebasePreservesBindings() throws {
        let original = arguments()
        let updated = try ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy(original,
            sourceBundleURL: source, copiedBundleURL: copy)
        var expected = original
        expected[try #require(original.firstIndex(of: "--node-bin")) + 1] =
            copy.appendingPathComponent("Contents/Resources/claude/node/bin/node").path
        expected[try #require(original.firstIndex(of: "--payload-root")) + 1] =
            copy.appendingPathComponent("Contents/Resources/claude/payload").path
        #expect(updated == expected)
        let before = try ClaudeInstalledLauncherArguments(original)
        let after = try ClaudeInstalledLauncherArguments(updated)
        #expect(after.options.runtimeIdentity == before.options.runtimeIdentity)
        #expect(after.options.ownerSocketPath == before.options.ownerSocketPath)
        #expect(after.options.sessionSocketPath == before.options.sessionSocketPath)
        #expect(after.options.cwd == before.options.cwd)
        #expect(after.options.claudeExecutable == before.options.claudeExecutable)
        #expect(after.options.configurationRoot == before.options.configurationRoot)
        #expect(after.options.observeSession == before.options.observeSession)
        #expect(after.options.claudeArguments == before.options.claudeArguments)
        #expect(after.openTerminal == before.openTerminal)
    }

    @Test("A caller cannot replace an unverified resource path with a copied signed resource",
           arguments: ["--node-bin", "--payload-root"])
    func rejectsUnrelatedResources(flag: String) throws {
        var original = arguments()
        original[try #require(original.firstIndex(of: flag)) + 1] = "/private/tmp/unverified-resource"
        #expect(throws: CoordinatorError("claude_installed_invalid_arguments")) {
            try ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy(original,
                sourceBundleURL: source, copiedBundleURL: copy)
        }
    }

    @Test("Malformed launcher arguments are rejected before rebasing")
    func rejectsInvalidArguments() {
        for original in [Array(arguments().prefix(3)), ["--node-bin"],
                         arguments() + ["invalid\0argument"]] {
            #expect(throws: CoordinatorError("claude_installed_invalid_arguments")) {
                try ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy(original,
                    sourceBundleURL: source, copiedBundleURL: copy)
            }
        }
    }

    @Test("Runtime handoff does not accept non-app destinations")
    func rejectsUnrecognizedBundle() {
        #expect(throws: CoordinatorError("claude_installed_invalid_arguments")) {
            try ClaudeInstalledLauncherArguments.rebasedForRuntimeCopy(arguments(), sourceBundleURL: source,
                copiedBundleURL: URL(fileURLWithPath: "/private/tmp/unverified-bundle"))
        }
    }
}
