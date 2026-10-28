import Foundation

enum LauncherScreenState: Equatable, Sendable {
    case setupRequired(String?)
    case loading
    case projection(
        LauncherAttentionProjection,
        execution: LauncherExecutionProjection?
    )
    case workBoard(LauncherWorkBoardDisplayState)
    case error(String)
}

enum LauncherScreenReducer {
    static func loaded(_ projection: LauncherAttentionProjection) -> LauncherScreenState {
        .projection(projection, execution: nil)
    }

    static func loaded(
        _ projection: LauncherPreferredProjection,
        now: Date = Date()
    ) -> LauncherScreenState {
        switch projection {
        case .workBoard(let board):
            .workBoard(
                LauncherWorkBoardDisplayState(
                    projection: board,
                    now: now
                )
            )
        case .attention(let attention):
            loaded(attention)
        case .degradedAttention(let attention):
            loaded(attention)
        }
    }

    static func executing(
        _ execution: LauncherExecutionProjection,
        from state: LauncherScreenState
    ) -> LauncherScreenState {
        guard case .projection(let projection, _) = state else { return state }
        return .projection(projection, execution: execution)
    }
}

struct LauncherWorkBoardDisplayState: Equatable, Sendable {
    let projection: LauncherWorkBoardProjection
    let items: [LauncherWorkBoardItem]

    init(projection: LauncherWorkBoardProjection, now: Date) {
        self.projection = projection
        items = projection.items.filter { item in
            guard let expiresAt = item.expiresAt else { return true }
            return launcherWorkBoardTimestampDate(expiresAt).map {
                $0 > now
            } ?? false
        }
    }

    var nextExpiry: Date? {
        items.compactMap { item in
            item.expiresAt.flatMap(launcherWorkBoardTimestampDate)
        }.min()
    }
}

let launcherWorkBoardExpiryTimerChunkNanoseconds: UInt64 = 60_000_000_000

func launcherWorkBoardExpiryDelayNanoseconds(
    now: Date,
    nextExpiry: Date
) -> UInt64 {
    let remaining = max(0, nextExpiry.timeIntervalSince(now))
    let nanoseconds = UInt64(
        min(remaining, 60) * 1_000_000_000
    )
    return max(1, min(nanoseconds, launcherWorkBoardExpiryTimerChunkNanoseconds))
}

enum LauncherPreferredProjection: Equatable, Sendable {
    case workBoard(LauncherWorkBoardProjection)
    case attention(LauncherAttentionProjection)
    case degradedAttention(LauncherAttentionProjection)
}

enum LauncherWorkBoardLoadError: Error, Equatable, Sendable {
    case invalidProjection
}

@MainActor
enum LauncherPreferredProjectionLoader {
    static func load(
        refresh: Bool,
        getWorkBoard: (Bool) async throws -> LauncherWorkBoardProjection,
        getAttention: (Bool) async throws -> LauncherAttentionProjection
    ) async throws -> LauncherPreferredProjection {
        let board: LauncherWorkBoardProjection
        do {
            board = try await getWorkBoard(refresh)
        } catch is CancellationError {
            throw CancellationError()
        } catch LauncherWorkBoardLoadError.invalidProjection {
            try Task.checkCancellation()
            return .degradedAttention(try await getAttention(false))
        } catch LauncherAgentError.agent(let code, _) where code == "INVALID_REQUEST" {
            try Task.checkCancellation()
            return .attention(try await getAttention(refresh))
        } catch LauncherAgentError.agent(let code, _)
            where code == "WORK_BOARD_RUN_FAILED" {
            try Task.checkCancellation()
            return .degradedAttention(try await getAttention(false))
        } catch {
            throw error
        }
        if board.mode == .full {
            return .workBoard(board)
        }
        try Task.checkCancellation()
        return .attention(try await getAttention(false))
    }
}
