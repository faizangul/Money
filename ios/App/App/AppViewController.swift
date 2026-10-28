import UIKit
import Capacitor

/// The app's web view screen. Registers the plugins that live in this app (not in npm packages).
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MoneyStorePlugin())
    }
}
