import Foundation
import Capacitor
import UserNotifications

/// Local reminders (bills, payday, card due dates, daily check-in), all scheduled on the phone.
/// The web app sends the full list each time; this replaces whatever was waiting before.
@objc(NotifyPlugin)
public class NotifyPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "NotifyPlugin"
    public let jsName = "Notify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let center = UNUserNotificationCenter.current()

    override public func load() {
        // Capacitor routes local notifications to one handler; this lets reminders show while the app is open.
        bridge?.notificationRouter.localNotificationHandler = self
    }

    /// Resolves { status: "granted" | "denied" | "notDetermined" | "provisional" }.
    @objc func status(_ call: CAPPluginCall) {
        center.getNotificationSettings { settings in
            call.resolve(["status": self.name(settings.authorizationStatus)])
        }
    }

    /// Shows the system "Allow notifications?" prompt (only the first time), then resolves like status().
    @objc func request(_ call: CAPPluginCall) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            self.status(call)
        }
    }

    /// items: [{ id, title, body, at: "YYYY-MM-DDTHH:MM" }] in local time; daily: { id, title, body, time: "HH:MM" } or null.
    @objc func schedule(_ call: CAPPluginCall) {
        let items = call.getArray("items", JSObject.self) ?? []
        let daily = call.getObject("daily")
        center.removeAllPendingNotificationRequests()
        var requests: [UNNotificationRequest] = []
        if let daily = daily, let time = daily["time"] as? String, let hm = parse(time: time) {
            let trigger = UNCalendarNotificationTrigger(dateMatching: hm, repeats: true)
            requests.append(request(daily, trigger))
        }
        for item in items {
            guard let at = item["at"] as? String, let when = parse(dateTime: at) else { continue }
            requests.append(request(item, UNCalendarNotificationTrigger(dateMatching: when, repeats: false)))
        }
        let group = DispatchGroup()
        var failed = 0
        for req in requests {
            group.enter()
            center.add(req) { error in
                DispatchQueue.main.async {
                    if error != nil { failed += 1 }
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) {
            call.resolve(["scheduled": requests.count - failed, "failed": failed])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // iOS 16+ opens the app's notification settings; iOS 15 opens the app's page in Settings.
            let link: String
            if #available(iOS 16.0, *) { link = UIApplication.openNotificationSettingsURLString } else { link = UIApplication.openSettingsURLString }
            if let url = URL(string: link) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    // MARK: - NotificationHandlerProtocol

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    public func didReceive(response: UNNotificationResponse) {}

    // MARK: - Helpers

    private func request(_ item: JSObject, _ trigger: UNNotificationTrigger) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = item["title"] as? String ?? "Money Tracker"
        content.body = item["body"] as? String ?? ""
        content.sound = .default
        return UNNotificationRequest(identifier: item["id"] as? String ?? UUID().uuidString, content: content, trigger: trigger)
    }

    private func parse(time: String) -> DateComponents? {
        let p = time.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return nil }
        return DateComponents(hour: p[0], minute: p[1])
    }

    private func parse(dateTime: String) -> DateComponents? {
        let halves = dateTime.split(separator: "T")
        guard halves.count == 2, var hm = parse(time: String(halves[1])) else { return nil }
        let ymd = halves[0].split(separator: "-").compactMap { Int($0) }
        guard ymd.count == 3 else { return nil }
        hm.year = ymd[0]; hm.month = ymd[1]; hm.day = ymd[2]
        return hm
    }

    private func name(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .ephemeral: return "granted"
        case .provisional: return "provisional"
        case .denied: return "denied"
        default: return "notDetermined"
        }
    }
}
