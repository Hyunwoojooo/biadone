import Foundation

enum LauncherScreenState: Equatable, Sendable {
    case setupRequired(String?)
    case loading
    case projection(
        LauncherAttentionProjection,
        execution: LauncherExecutionProjection?
    )
    case error(String)
}

enum LauncherScreenReducer {
    static func loaded(_ projection: LauncherAttentionProjection) -> LauncherScreenState {
        .projection(projection, execution: nil)
    }

    static func executing(
        _ execution: LauncherExecutionProjection,
        from state: LauncherScreenState
    ) -> LauncherScreenState {
        guard case .projection(let projection, _) = state else { return state }
        return .projection(projection, execution: execution)
    }
}
