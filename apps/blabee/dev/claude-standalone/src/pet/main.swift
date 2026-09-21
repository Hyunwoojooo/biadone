import AppKit
import Foundation
import Darwin

do {
    let (configuration, mode, hold) = try RuntimeConfiguration.load(arguments: Array(CommandLine.arguments.dropFirst()))
    if mode == "--diagnose" {
        try writeJSON([
            "product": "blabee-claude", "provider": "claude", "protocol": "blabee-claude.v1",
            "bundle_identifier": "com.biadone.blabee.claude", "display_name": "Blabee Claude",
            "runtime": configuration.runtime, "node": configuration.node, "service": configuration.service,
            "lock_path": configuration.runtime + "/pet/instance-v1.lock",
            "socket_path": configuration.runtime + "/blabee-claude.sock", "read_only": true
        ])
        exit(0)
    }
    let lease = try PetInstanceLease(runtime: configuration.runtime)
    if mode == "--probe-instance" {
        try writeJSON(["product": "blabee-claude", "probe": "holding", "pid": getpid(),
                       "runtime": configuration.runtime, "lock_path": lease.path, "hold_seconds": hold])
        withExtendedLifetime(lease) { Thread.sleep(forTimeInterval: hold) }
        exit(0)
    }
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = PetApplication(configuration: configuration, lease: lease)
    application.delegate = delegate
    withExtendedLifetime(delegate) { application.run() }
} catch {
    FileHandle.standardError.write(Data(("Blabee Claude: " + error.localizedDescription + "\n").utf8))
    if case PetFailure.alreadyRunning = error { exit(2) }
    exit(1)
}
