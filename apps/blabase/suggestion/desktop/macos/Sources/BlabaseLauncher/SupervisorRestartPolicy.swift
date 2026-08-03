import Foundation

enum SupervisorRestartDecision: Equatable, Sendable {
    case restart(afterNanoseconds: UInt64)
    case stop
}

struct SupervisorRestartPolicy: Sendable {
    let maximumRestarts: Int
    let window: TimeInterval
    let delaysNanoseconds: [UInt64]
    private(set) var crashTimes: [Date] = []

    init(
        maximumRestarts: Int = 3,
        window: TimeInterval = 60,
        delaysNanoseconds: [UInt64] = [250_000_000, 1_000_000_000, 4_000_000_000]
    ) {
        self.maximumRestarts = maximumRestarts
        self.window = window
        self.delaysNanoseconds = delaysNanoseconds
    }

    mutating func recordUnexpectedExit(at date: Date) -> SupervisorRestartDecision {
        crashTimes.removeAll { date.timeIntervalSince($0) > window }
        guard crashTimes.count < maximumRestarts else { return .stop }
        let delayIndex = min(crashTimes.count, max(0, delaysNanoseconds.count - 1))
        crashTimes.append(date)
        let delay = delaysNanoseconds.isEmpty ? 0 : delaysNanoseconds[delayIndex]
        return .restart(afterNanoseconds: delay)
    }
}
