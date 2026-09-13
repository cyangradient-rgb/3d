import SwiftUI

struct FeedListView: View {
    @EnvironmentObject private var store: FeedStore
    @State private var showingSources = false
    @State private var selectedArticle: Article?

    var body: some View {
        NavigationStack {
            Group {
                if store.visibleArticles.isEmpty {
                    emptyState
                } else {
                    List(store.visibleArticles) { article in
                        Button {
                            selectedArticle = article
                        } label: {
                            ArticleRowView(article: article)
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Feed")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showingSources = true
                    } label: {
                        Image(systemName: "list.bullet.rectangle")
                    }
                }
            }
            .refreshable {
                await store.refreshAll()
            }
            .overlay(alignment: .bottom) {
                if let last = store.lastRefreshDate {
                    Text("Updated \(last.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)
                        .background(.thinMaterial, in: Capsule())
                        .padding(.bottom, 8)
                }
            }
            .sheet(isPresented: $showingSources) {
                SourcesView()
                    .environmentObject(store)
            }
            .fullScreenCover(item: $selectedArticle) { article in
                SafariView(url: article.link)
                    .ignoresSafeArea()
            }
            .task {
                if store.articles.isEmpty {
                    await store.refreshAll()
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            if store.isRefreshing {
                ProgressView()
                Text("Loading your feed…")
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "newspaper")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("No articles yet")
                    .font(.headline)
                Button("Refresh") {
                    Task { await store.refreshAll() }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
