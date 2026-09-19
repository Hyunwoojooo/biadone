import SwiftUI

/// Read-only content: opening a preview never submits or confirms a choice.
struct PetChoicePreviewView: View {
    @Environment(\.colorScheme) private var colorScheme
    let preview: PetChoicePreview

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "text.magnifyingglass")
                        .accessibilityHidden(true)
                    Text("미리보기")
                    Text("\(preview.choice.slot)번 선택지")
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                }
                .font(.callout.weight(.semibold))
                .foregroundStyle(PetAirPalette.accent(for: colorScheme))

                Text("\(preview.shortcutPreset.holdKeyName) 키를 떼면 닫힙니다")
                    .font(.system(size: 13))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }

            Text(verbatim: preview.choice.displayTitle)
                .font(.system(size: 23, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            if let action = preview.choice.action {
                section(title: "할 일") {
                    bodyText(action.objective)
                }
                if !action.constraints.isEmpty {
                    section(title: "지킬 조건") {
                        textList(action.constraints)
                    }
                }
                section(title: "완료 기준") {
                    textList(action.doneWhen)
                }
            }
        }
        .foregroundStyle(PetAirPalette.ink(for: colorScheme))
        .lineLimit(nil)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("choice-preview")
    }

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .petInsetSurface()
    }

    private func bodyText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 16))
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func textList(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, text in
                HStack(alignment: .top, spacing: 10) {
                    Text("•")
                        .font(.system(size: 16))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                        .accessibilityHidden(true)
                    bodyText(text)
                }
            }
        }
    }
}
