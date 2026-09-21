import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

/// Performs one bounded, read-only `hooks/list` request against the official
/// Codex App Server. It never reads Codex's private trust files or reproduces
/// Codex's hook hashing rules.
enum DoctorHookTrustInspector {
    private static let maximumMessageBytes = 1_048_576
    private static let maximumTotalBytes = 4 * 1_048_576
    private static let maximumMessages = 64

    static func inspect(
        executable: URL,
        projectURL: URL,
        timeoutMilliseconds: Int
    ) throws -> Data {
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let terminated = DispatchSemaphore(value: 0)
        process.executableURL = executable
        process.arguments = ["app-server", "--listen", "stdio://"]
        process.currentDirectoryURL = projectURL
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in terminated.signal() }

        let startedAt = DispatchTime.now().uptimeNanoseconds
        let timeout = UInt64(max(1, timeoutMilliseconds))
        let (timeoutNanoseconds, multiplicationOverflow) = timeout
            .multipliedReportingOverflow(by: 1_000_000)
        let (deadline, additionOverflow) = startedAt
            .addingReportingOverflow(timeoutNanoseconds)
        guard !multiplicationOverflow, !additionOverflow else {
            closePipeEnds(input: input, output: output)
            throw CoordinatorError("doctor_hook_trust_timeout")
        }

        do {
            try process.run()
        } catch {
            closePipeEnds(input: input, output: output)
            throw CoordinatorError("doctor_hook_trust_process_unavailable")
        }
        try? input.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()

        var reader = BoundedLineReader(
            descriptor: output.fileHandleForReading.fileDescriptor
        )
        let response: Data?
        let operationError: Error?
        do {
            try configureWriter(input.fileHandleForWriting.fileDescriptor)
            try writeJSON([
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": [
                    "clientInfo": [
                        "name": "blabee-doctor",
                        "version": "0.1.0",
                    ],
                ],
            ], to: input.fileHandleForWriting.fileDescriptor, deadline: deadline)
            _ = try readResponse(id: 1, reader: &reader, deadline: deadline)

            try writeJSON([
                "jsonrpc": "2.0",
                "method": "initialized",
            ], to: input.fileHandleForWriting.fileDescriptor, deadline: deadline)
            try writeJSON([
                "jsonrpc": "2.0",
                "id": 2,
                "method": "hooks/list",
                "params": ["cwds": [projectURL.standardizedFileURL.path]],
            ], to: input.fileHandleForWriting.fileDescriptor, deadline: deadline)
            response = try readResponse(id: 2, reader: &reader, deadline: deadline)
            operationError = nil
        } catch {
            response = nil
            operationError = error
        }

        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        try stop(process: process, terminated: terminated)
        if let operationError { throw operationError }
        guard let response else {
            throw CoordinatorError("doctor_hook_trust_protocol_invalid")
        }
        return response
    }
}

private extension DoctorHookTrustInspector {
    struct BoundedLineReader {
        let descriptor: Int32
        var buffer = Data()
        var totalBytes = 0
        var messages = 0

        mutating func readLine(deadline: UInt64) throws -> Data {
            while true {
                if let newline = buffer.firstIndex(of: 0x0A) {
                    var line = Data(buffer[..<newline])
                    buffer.removeSubrange(...newline)
                    if line.last == 0x0D { line.removeLast() }
                    guard !line.isEmpty,
                          line.count <= DoctorHookTrustInspector.maximumMessageBytes
                    else {
                        throw CoordinatorError("doctor_hook_trust_protocol_invalid")
                    }
                    messages += 1
                    guard messages <= DoctorHookTrustInspector.maximumMessages else {
                        throw CoordinatorError("doctor_hook_trust_protocol_invalid")
                    }
                    return line
                }
                guard buffer.count <= DoctorHookTrustInspector.maximumMessageBytes else {
                    throw CoordinatorError("doctor_hook_trust_response_too_large")
                }

                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline else {
                    throw CoordinatorError("doctor_hook_trust_timeout")
                }
                var item = pollfd(
                    fd: descriptor,
                    events: Int16(POLLIN | POLLHUP | POLLERR),
                    revents: 0
                )
                let remainingMilliseconds = max(
                    1,
                    Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
                )
                let pollResult = poll(&item, 1, remainingMilliseconds)
                if pollResult < 0 && errno == EINTR { continue }
                guard pollResult > 0,
                      item.revents & Int16(POLLNVAL) == 0
                else {
                    throw CoordinatorError(
                        pollResult == 0
                            ? "doctor_hook_trust_timeout"
                            : "doctor_hook_trust_read_failed"
                    )
                }

                var bytes = [UInt8](repeating: 0, count: 16_384)
                let count = bytes.withUnsafeMutableBytes { rawBuffer in
                    Darwin.read(descriptor, rawBuffer.baseAddress, rawBuffer.count)
                }
                if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
                    continue
                }
                guard count > 0 else {
                    throw CoordinatorError("doctor_hook_trust_read_failed")
                }
                guard count <= DoctorHookTrustInspector.maximumTotalBytes - totalBytes else {
                    throw CoordinatorError("doctor_hook_trust_response_too_large")
                }
                totalBytes += count
                buffer.append(contentsOf: bytes[0..<count])
            }
        }
    }

    static func readResponse(
        id: Int64,
        reader: inout BoundedLineReader,
        deadline: UInt64
    ) throws -> Data {
        while true {
            let line = try reader.readLine(deadline: deadline)
            let object = try StrictJSONTransport.object(
                from: line,
                limits: StrictJSONLimits(
                    maximumBytes: maximumMessageBytes,
                    maximumDepth: 32
                )
            )
            guard ExactJSONInteger.int64(object["id"]) == id else { continue }
            guard object["error"] == nil,
                  object["result"] is [String: Any]
            else {
                throw CoordinatorError("doctor_hook_trust_request_failed")
            }
            return line
        }
    }

    static func configureWriter(_ descriptor: Int32) throws {
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0,
              fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETNOSIGPIPE, 1) == 0
        else {
            throw CoordinatorError("doctor_hook_trust_write_failed")
        }
    }

    static func writeJSON(
        _ object: [String: Any],
        to descriptor: Int32,
        deadline: UInt64
    ) throws {
        var data = try StrictJSONTransport.data(forJSONObject: object)
        guard data.count < maximumMessageBytes else {
            throw CoordinatorError("doctor_hook_trust_protocol_invalid")
        }
        data.append(0x0A)
        try data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline else {
                    throw CoordinatorError("doctor_hook_trust_timeout")
                }
                var item = pollfd(
                    fd: descriptor,
                    events: Int16(POLLOUT),
                    revents: 0
                )
                let remainingMilliseconds = max(
                    1,
                    Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
                )
                let pollResult = poll(&item, 1, remainingMilliseconds)
                if pollResult < 0 && errno == EINTR { continue }
                guard pollResult > 0 else {
                    throw CoordinatorError(
                        pollResult == 0
                            ? "doctor_hook_trust_timeout"
                            : "doctor_hook_trust_write_failed"
                    )
                }
                let count = Darwin.write(
                    descriptor,
                    baseAddress.advanced(by: offset),
                    rawBuffer.count - offset
                )
                if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
                    continue
                }
                guard count > 0 else {
                    throw CoordinatorError("doctor_hook_trust_write_failed")
                }
                offset += count
            }
        }
    }

    static func stop(process: Process, terminated: DispatchSemaphore) throws {
        if !process.isRunning {
            _ = terminated.wait(timeout: .now() + .milliseconds(50))
            return
        }
        process.terminate()
        if terminated.wait(timeout: .now() + .milliseconds(750)) == .success { return }
        if kill(process.processIdentifier, SIGKILL) != 0 {
            guard errno == ESRCH else {
                throw CoordinatorError("doctor_hook_trust_cleanup_failed")
            }
            return
        }
        if terminated.wait(timeout: .now() + .seconds(1)) == .success { return }
        if kill(process.processIdentifier, 0) == -1, errno == ESRCH { return }
        throw CoordinatorError("doctor_hook_trust_cleanup_failed")
    }

    static func closePipeEnds(input: Pipe, output: Pipe) {
        try? input.fileHandleForReading.close()
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()
    }
}
