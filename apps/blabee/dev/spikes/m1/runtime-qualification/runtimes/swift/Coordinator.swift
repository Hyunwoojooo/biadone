import Dispatch
import Foundation
import CoreFoundation

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

let protocolVersion = 1
let buildVersion = "t005-qualification-v1"
let runtimeName = "swift"
let nominalWaitMilliseconds = 120_000

struct RuntimeFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

func journalPath(arguments: [String]) throws -> String {
    guard let argument = arguments.first(where: { $0.hasPrefix("--journal=") }) else {
        throw RuntimeFailure("--journal=<path> is required")
    }
    return String(argument.dropFirst("--journal=".count))
}

func writeJSON(_ object: [String: Any], to handle: FileHandle) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    handle.write(data)
    handle.write(Data([0x0a]))
}

func log(_ event: String, fields: [String: Any] = [:]) {
    var record: [String: Any] = [
        "schema_version": "blabee.t005.runtime-log.v1",
        "event": event,
        "runtime": runtimeName,
    ]
    for (key, value) in fields {
        record[key] = value
    }
    try? writeJSON(record, to: FileHandle.standardError)
}

func respond(_ response: [String: Any]) {
    var envelope = response
    envelope["runtime"] = runtimeName
    envelope["protocol_version"] = protocolVersion
    do {
        try writeJSON(envelope, to: FileHandle.standardOutput)
    } catch {
        log("response_write_failed", fields: ["error": String(describing: error)])
    }
}

func positiveSequence(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber else {
        return nil
    }
    guard CFGetTypeID(number) != CFBooleanGetTypeID() else {
        return nil
    }
    let doubleValue = number.doubleValue
    let intValue = number.intValue
    guard doubleValue == Double(intValue), intValue > 0 else {
        return nil
    }
    return intValue
}

func validateEvent(_ event: Any?, expectedSequence: Int) throws -> [String: Any] {
    guard let object = event as? [String: Any] else {
        throw RuntimeFailure("event must be an object")
    }
    guard let eventID = object["event_id"] as? String, !eventID.isEmpty else {
        throw RuntimeFailure("event_id must be a non-empty string")
    }
    guard let sequence = positiveSequence(object["event_sequence"]) else {
        throw RuntimeFailure("event_sequence must be a positive integer")
    }
    guard sequence == expectedSequence else {
        throw RuntimeFailure(
            "event_sequence \(sequence) does not match expected \(expectedSequence)"
        )
    }
    return object
}

final class DurableJournal {
    let path: String
    let handle: FileHandle
    private(set) var events: [[String: Any]] = []
    private(set) var partialTailBytes = 0

    init(path: String) throws {
        self.path = path
        let fileManager = FileManager.default
        let directory = URL(fileURLWithPath: path).deletingLastPathComponent().path
        try fileManager.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true
        )
        if !fileManager.fileExists(atPath: path) {
            guard fileManager.createFile(atPath: path, contents: nil) else {
                throw RuntimeFailure("failed to create journal")
            }
        }

        self.handle = try FileHandle(forUpdating: URL(fileURLWithPath: path))
        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        let lastNewline = bytes.lastIndex(of: 0x0a)
        let completeLength = lastNewline.map { bytes.distance(from: bytes.startIndex, to: $0) + 1 } ?? 0
        self.partialTailBytes = bytes.count - completeLength

        if partialTailBytes > 0 {
            try handle.truncate(atOffset: UInt64(completeLength))
            try handle.synchronize()
            log(
                "journal_partial_tail_truncated",
                fields: ["partial_tail_bytes": partialTailBytes]
            )
        }

        guard completeLength > 0 else {
            return
        }
        let completeData = bytes.prefix(completeLength)
        let lines = completeData.split(separator: 0x0a, omittingEmptySubsequences: false)
        for (index, line) in lines.dropLast().enumerated() {
            guard !line.isEmpty else {
                throw RuntimeFailure("journal line \(index + 1) is empty")
            }
            let parsed: Any
            do {
                parsed = try JSONSerialization.jsonObject(with: Data(line))
            } catch {
                throw RuntimeFailure(
                    "journal line \(index + 1) is invalid JSON: \(error)"
                )
            }
            events.append(try validateEvent(parsed, expectedSequence: events.count + 1))
        }
    }

    deinit {
        try? handle.close()
    }

    func append(_ rawEvent: Any?) throws -> [String: Any] {
        let event = try validateEvent(rawEvent, expectedSequence: events.count + 1)
        let data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data([0x0a]))
        try handle.synchronize()
        events.append(event)
        log(
            "journal_append_durable",
            fields: [
                "event_id": event["event_id"] as! String,
                "event_sequence": event["event_sequence"] as! NSNumber,
            ]
        )
        return event
    }
}

func residentSetBytes() -> UInt64? {
    var usage = rusage()
    guard getrusage(RUSAGE_SELF, &usage) == 0 else {
        return nil
    }
    #if canImport(Darwin)
    return UInt64(usage.ru_maxrss)
    #else
    return UInt64(usage.ru_maxrss) * 1024
    #endif
}

func diagnostics(_ journal: DurableJournal) -> [String: Any] {
    let lastEvent = journal.events.last
    return [
        "ok": true,
        "build_version": buildVersion,
        "journal_event_count": journal.events.count,
        "last_event_id": lastEvent?["event_id"] ?? NSNull(),
        "last_event_sequence": lastEvent?["event_sequence"] ?? NSNull(),
        "replayed_event_count": journal.events.count,
        "partial_tail_truncated": journal.partialTailBytes > 0,
        "partial_tail_bytes": journal.partialTailBytes,
        "rss_bytes": residentSetBytes() ?? NSNull(),
        "rss_kind": "peak_resident_set_bytes",
        "pid": ProcessInfo.processInfo.processIdentifier,
    ]
}

func handleRequest(_ request: [String: Any], journal: DurableJournal) -> [String: Any] {
    guard let method = request["method"] as? String else {
        return ["ok": false, "error": "invalid_request"]
    }

    switch method {
    case "health":
        return ["ok": true]
    case "append":
        do {
            let event = try journal.append(request["event"])
            return [
                "ok": true,
                "durable": true,
                "event_id": event["event_id"] as! String,
                "event_sequence": event["event_sequence"] as! NSNumber,
                "journal_event_count": journal.events.count,
            ]
        } catch {
            return [
                "ok": false,
                "error": "append_rejected",
                "detail": String(describing: error),
            ]
        }
    case "diagnostics":
        return diagnostics(journal)
    case "update_info":
        return [
            "ok": true,
            "build_version": buildVersion,
            "update_strategy": "external_atomic_replacement_not_implemented",
        ]
    case "wait_probe":
        guard
            positiveSequence(request["nominal_wait_ms"]) == nominalWaitMilliseconds,
            let divisor = positiveSequence(request["scale_divisor"]),
            divisor <= nominalWaitMilliseconds
        else {
            return ["ok": false, "error": "invalid_wait_probe"]
        }
        let scaledWaitMilliseconds = Double(nominalWaitMilliseconds) / Double(divisor)
        let started = DispatchTime.now().uptimeNanoseconds
        Thread.sleep(forTimeInterval: scaledWaitMilliseconds / 1_000)
        let ended = DispatchTime.now().uptimeNanoseconds
        let elapsedMilliseconds = Double(ended - started) / 1_000_000
        log(
            "wait_probe_completed",
            fields: [
                "nominal_wait_ms": nominalWaitMilliseconds,
                "scale_divisor": divisor,
                "elapsed_monotonic_ms": elapsedMilliseconds,
            ]
        )
        return [
            "ok": true,
            "nominal_wait_ms": nominalWaitMilliseconds,
            "scale_divisor": divisor,
            "scaled_wait_ms": scaledWaitMilliseconds,
            "elapsed_monotonic_ms": elapsedMilliseconds,
            "automatic_selection": false,
        ]
    case "shutdown":
        return ["ok": true, "shutdown": true]
    default:
        return ["ok": false, "error": "unsupported_method"]
    }
}

do {
    let path = try journalPath(arguments: Array(CommandLine.arguments.dropFirst()))
    let journal = try DurableJournal(path: path)
    log(
        "runtime_started",
        fields: [
            "build_version": buildVersion,
            "journal_event_count": journal.events.count,
        ]
    )

    while let line = readLine() {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let request = object as? [String: Any]
        else {
            respond(["ok": false, "error": "invalid_json"])
            continue
        }

        let response = handleRequest(request, journal: journal)
        respond(response)
        if request["method"] as? String == "shutdown" {
            break
        }
    }
} catch {
    log("runtime_start_failed", fields: ["error": String(describing: error)])
    exit(2)
}
