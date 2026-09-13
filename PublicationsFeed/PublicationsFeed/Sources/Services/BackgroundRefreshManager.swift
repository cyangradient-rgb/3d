import Foundation
import BackgroundTasks

/// Wires up iOS Background App Refresh so the feed has new articles waiting
/// even before the user opens the app. Must be registered before the app
/// finishes launching, so `register(store:)` is called from AppDelegate.
enum BackgroundRefreshManager {
    static let taskIdentifier = "com.cyangradient.publicationsfeed.refresh"
    private static let minimumInterval: TimeInterval = 30 * 60

    static func register(store: FeedStore) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(task: refreshTask, store: store)
        }
    }

    static func scheduleNextRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: minimumInterval)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("Could not schedule background refresh: \(error)")
        }
    }

    private static func handle(task: BGAppRefreshTask, store: FeedStore) {
        // Always schedule the next refresh first, in case this one is cut short.
        scheduleNextRefresh()

        let refreshTask = Task {
            await store.refreshAll()
            task.setTaskCompleted(success: true)
        }

        task.expirationHandler = {
            refreshTask.cancel()
        }
    }
}
