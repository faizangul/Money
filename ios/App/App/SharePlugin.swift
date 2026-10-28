import Foundation
import Capacitor
import UIKit

/// Backups, CSV exports and calendar files: writes the file to a temporary folder and opens the
/// share sheet, so it can be saved to Files (iCloud Drive), AirDropped or emailed.
@objc(SharePlugin)
public class SharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharePlugin"
    public let jsName = "Share"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    /// { filename, data } with data as text. Resolves once the person picks somewhere to send it;
    /// rejects with code "declined" if they close the sheet.
    @objc func share(_ call: CAPPluginCall) {
        guard let raw = call.getString("filename"), let data = call.getString("data") else {
            call.reject("Missing filename or data", "invalid_argument")
            return
        }
        // Only the last path part, so a name can't point outside the temporary folder.
        let name = (raw as NSString).lastPathComponent
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        let url = folder.appendingPathComponent(name.isEmpty ? "money-tracker.txt" : name)
        do {
            try? FileManager.default.removeItem(at: folder)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            call.reject("Couldn't prepare the file", "write_failed")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("Nothing to show the share sheet on", "unavailable")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, completed, _, error in
                if completed { call.resolve(["status": "saved"]) }
                else if error != nil { call.reject("Couldn't share the file", "unavailable") }
                else { call.reject("Cancelled", "declined") }
            }
            // iPad shows the sheet as a popover, which needs somewhere to point.
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = host.view
                pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.maxY - 80, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            host.present(sheet, animated: true)
        }
    }
}
