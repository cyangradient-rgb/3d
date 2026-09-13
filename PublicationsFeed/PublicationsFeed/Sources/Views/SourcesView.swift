import SwiftUI

struct SourcesView: View {
    @EnvironmentObject private var store: FeedStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(store.allPublications) { publication in
                Button {
                    store.togglePublication(publication.id)
                } label: {
                    HStack {
                        Text(publication.name)
                            .foregroundStyle(.primary)
                        Spacer()
                        if store.enabledPublicationIDs.contains(publication.id) {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
            .navigationTitle("Publications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
