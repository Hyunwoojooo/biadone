import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let mcpMaximumInputBytes = 1_048_576

/// A regular file makes adjacent lines available in the same read without pipe scheduling.
private func withMCPInputReader(
    _ input: Data,
    maximumBytes: Int = mcpMaximumInputBytes,
    body: (StandardInputLineReader) throws -> Void
) throws {
    let directory = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("blabee-mcp-input-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let inputURL = directory.appendingPathComponent("input.jsonl")
    try input.write(to: inputURL)
    let handle = try FileHandle(forReadingFrom: inputURL)
    defer { try? handle.close() }
    try body(StandardInputLineReader(
        maximumBytes: maximumBytes, inputDescriptor: handle.fileDescriptor
    ))
}

@Test func mcpInputReaderAcceptsCoalescedLinesWithinIndividualLimit() throws {
    let first = Data(#"{"jsonrpc":"2.0","id":1}"#.utf8)
    let second = Data(#"{"jsonrpc":"2.0","id":2}"#.utf8)
    var input = first
    input.append(0x0A)
    input.append(second)
    input.append(0x0A)

    // Throwing work inside #expect must not infer a nonthrowing closure.
    try withMCPInputReader(input, maximumBytes: 32) { reader throws -> Void in
        #expect(try reader.nextLine() == first)
        #expect(try reader.nextLine() == second)
        #expect(try reader.nextLine() == nil)
    }
}

@Test func mcpInputReaderAcceptsExactLimitWithNewlineAndFollowingLine() throws {
    let line = Data(repeating: 0x61, count: mcpMaximumInputBytes)
    let following = Data("{}".utf8)
    var input = line
    input.append(0x0A)
    input.append(following)
    input.append(0x0A)

    try withMCPInputReader(input) { reader throws -> Void in
        #expect(try reader.nextLine() == line)
        #expect(try reader.nextLine() == following)
        #expect(try reader.nextLine() == nil)
    }
}

@Test(arguments: [false, true])
func mcpInputReaderRejectsOversizedLine(terminated: Bool) throws {
    var input = Data(repeating: 0x61, count: mcpMaximumInputBytes + 1)
    if terminated { input.append(0x0A) }

    try withMCPInputReader(input) { reader in
        #expect(throws: CoordinatorError("operational_message_too_large")) {
            _ = try reader.nextLine()
        }
    }
}

@Test func mcpInputReaderRejectsOversizedBufferedLineAfterValidLine() throws {
    let first = Data("{}".utf8)
    var input = first
    input.append(0x0A)
    input.append(Data(repeating: 0x61, count: 33))
    input.append(0x0A)

    try withMCPInputReader(input, maximumBytes: 32) { reader throws -> Void in
        #expect(try reader.nextLine() == first)
        #expect(throws: CoordinatorError("operational_message_too_large")) {
            _ = try reader.nextLine()
        }
    }
}

@Test func mcpInputReaderAcceptsExactLimitAtEOF() throws {
    let line = Data(repeating: 0x61, count: mcpMaximumInputBytes)

    try withMCPInputReader(line) { reader throws -> Void in
        #expect(try reader.nextLine() == line)
        #expect(try reader.nextLine() == nil)
        #expect(try reader.nextLine() == nil)
    }
}

@Test func mcpInputReaderPreservesEmptyLinesAndFinalUnterminatedLine() throws {
    try withMCPInputReader(Data("\n{}\n\nlast".utf8), maximumBytes: 4) { reader throws -> Void in
        #expect(try reader.nextLine() == Data())
        #expect(try reader.nextLine() == Data("{}".utf8))
        #expect(try reader.nextLine() == Data())
        #expect(try reader.nextLine() == Data("last".utf8))
        #expect(try reader.nextLine() == nil)
    }
}

@Test func mcpInputReaderReturnsNilForEmptyInput() throws {
    try withMCPInputReader(Data()) { reader throws -> Void in
        #expect(try reader.nextLine() == nil)
        #expect(try reader.nextLine() == nil)
    }
}
