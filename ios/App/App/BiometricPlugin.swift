import Foundation
import Capacitor
import LocalAuthentication

/// Face ID / Touch ID for the PIN lock. The app's own PIN is always the fallback, so this uses
/// biometrics only (not the phone passcode) and labels the fallback button "Use PIN".
@objc(BiometricPlugin)
public class BiometricPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricPlugin"
    public let jsName = "Biometric"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    /// Resolves { available, type: "faceID" | "touchID" | "opticID" | "none" }.
    /// available is false when the phone has no face or fingerprint set up.
    @objc func available(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        call.resolve(["available": ok, "type": typeName(context.biometryType)])
    }

    /// Shows the system prompt. Resolves { ok: true, state, changed } on success, where state identifies
    /// the faces/fingers enrolled right now and changed is true if it differs from the `state` passed in.
    /// Resolves { ok: false, reason: "cancelled" | "fallback" | "failed" | "lockout" | "unavailable" } otherwise.
    @objc func authenticate(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock Money Tracker"
        let previous = call.getString("state")
        let context = LAContext()
        context.localizedFallbackTitle = "Use PIN"
        context.localizedCancelTitle = "Cancel"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return call.resolve(["ok": false, "reason": reasonName(error)])
        }
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            guard success else { return call.resolve(["ok": false, "reason": self.reasonName(error as NSError?)]) }
            let state = context.evaluatedPolicyDomainState?.base64EncodedString() ?? ""
            call.resolve(["ok": true, "state": state, "changed": previous != nil && previous != state])
        }
    }

    private func typeName(_ type: LABiometryType) -> String {
        switch type {
        case .faceID: return "faceID"
        case .touchID: return "touchID"
        case .opticID: return "opticID"
        default: return "none"
        }
    }

    private func reasonName(_ error: NSError?) -> String {
        guard let error = error, error.domain == LAErrorDomain else { return "failed" }
        switch LAError.Code(rawValue: error.code) {
        case .userCancel, .systemCancel, .appCancel: return "cancelled"
        case .userFallback: return "fallback"
        case .biometryLockout: return "lockout"
        case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet: return "unavailable"
        default: return "failed"
        }
    }
}
