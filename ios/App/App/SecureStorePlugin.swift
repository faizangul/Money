import Foundation
import Capacitor
import Security

/// Small secrets (the PIN lock settings and failed-try counter) kept in the iOS Keychain.
/// Items are readable only while the phone is unlocked and never leave this device.
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "com.faizangul.moneytracker.secure"
    private static let installedKey = "mt.secureStoreInstalled"

    override public func load() {
        // Keychain items outlive the app. After a delete and reinstall, clear what the old install left,
        // so a fresh app doesn't ask for a PIN that belongs to data that's gone. UserDefaults is removed
        // with the app, so the flag is missing only on the first launch after an install.
        if !UserDefaults.standard.bool(forKey: SecureStorePlugin.installedKey) {
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: SecureStorePlugin.service] as CFDictionary)
            UserDefaults.standard.set(true, forKey: SecureStorePlugin.installedKey)
        }
    }

    /// Resolves { value } with the stored text, or { value: null } if there is none.
    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Missing key", "invalid_argument") }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return call.resolve(["value": NSNull()]) }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            return call.reject("Keychain read failed (\(status))", "unavailable")
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            return call.reject("Missing key or value", "invalid_argument")
        }
        let data = Data(value.utf8)
        var status = SecItemUpdate(baseQuery(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery(key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { return call.reject("Keychain write failed (\(status))", "unavailable") }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Missing key", "invalid_argument") }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            return call.reject("Keychain delete failed (\(status))", "unavailable")
        }
        call.resolve()
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: SecureStorePlugin.service,
         kSecAttrAccount as String: key]
    }
}
