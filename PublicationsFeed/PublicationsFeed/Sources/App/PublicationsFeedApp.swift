import SwiftUI

@main
struct PublicationsFeedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = FeedStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            FeedListView()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .background {
                BackgroundRefreshManager.scheduleNextRefresh()
            }
        }
    }
}
