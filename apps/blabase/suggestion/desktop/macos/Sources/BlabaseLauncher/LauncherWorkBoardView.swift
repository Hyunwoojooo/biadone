import SwiftUI

struct LauncherWorkBoardView: View {
    let display: LauncherWorkBoardDisplayState

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(LauncherWorkBoardLane.allCases, id: \.rawValue) { lane in
                    laneSection(lane)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityLabel("Work Board 표시 전용 제안")
    }

    private func laneSection(_ lane: LauncherWorkBoardLane) -> some View {
        let items = display.items.filter { $0.lane == lane }
        return VStack(alignment: .leading, spacing: 7) {
            Text(LauncherWorkBoardPresentation.laneTitle(lane))
                .font(.system(size: 13, weight: .bold))
            if items.isEmpty {
                Text(LauncherWorkBoardPresentation.emptyLaneText)
                    .font(.system(size: 12))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            } else {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    itemRow(item)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LauncherVisualTokens.surfaceFloating(colorScheme))
        .clipShape(
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
            .stroke(
                LauncherVisualTokens.borderDefault(colorScheme),
                lineWidth: 1
            )
        }
    }

    private func itemRow(_ item: LauncherWorkBoardItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title)
                .font(.system(size: 13, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Text(LauncherWorkBoardPresentation.evidenceText(item.evidenceBand))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
            if !item.caveatCodes.isEmpty {
                Text(
                    item.caveatCodes.map(
                        LauncherWorkBoardPresentation.caveatText
                    ).joined(separator: " · ")
                )
                .font(.system(size: 11))
                .foregroundStyle(
                    LauncherVisualTokens.textTertiary(colorScheme)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
