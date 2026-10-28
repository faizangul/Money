import Foundation
import Capacitor
import SQLite3

/// On-device storage for the web app's doc()/collection() store.
/// One row per document path (e.g. "app/config", "tx/abc123"), holding the document as JSON text,
/// plus a small key/value table for app metadata such as backup reminders.
@objc(MoneyStorePlugin)
public class MoneyStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MoneyStorePlugin"
    public let jsName = "MoneyStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replaceAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setValue", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.faizangul.moneytracker.store")
    private var db: OpaquePointer?

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    /// Returns every document and every key/value pair: { docs: [{p, d}], values: {k: v} }.
    @objc func load(_ call: CAPPluginCall) {
        queue.async {
            do {
                try self.open()
                var docs: [[String: String]] = []
                try self.query("SELECT path, data FROM docs") { row in
                    docs.append(["p": self.text(row, 0), "d": self.text(row, 1)])
                }
                var values: [String: String] = [:]
                try self.query("SELECT k, v FROM kv") { row in
                    values[self.text(row, 0)] = self.text(row, 1)
                }
                call.resolve(["docs": docs, "values": values])
            } catch {
                call.reject("\(error)", "load_failed")
            }
        }
    }

    /// Saves documents in one transaction. puts: [{p, d}] (d is JSON text), dels: [path].
    @objc func write(_ call: CAPPluginCall) {
        let puts = call.getArray("puts", JSObject.self) ?? []
        let dels = call.getArray("dels", String.self) ?? []
        queue.async {
            do {
                try self.open()
                try self.transaction {
                    for p in dels { try self.run("DELETE FROM docs WHERE path = ?", [p]) }
                    try self.insert(puts)
                }
                call.resolve()
            } catch {
                call.reject("\(error)", "write_failed")
            }
        }
    }

    /// Replaces every document at once (restore from backup, erase everything).
    @objc func replaceAll(_ call: CAPPluginCall) {
        let docs = call.getArray("docs", JSObject.self) ?? []
        let clearValues = call.getBool("clearValues") ?? false
        queue.async {
            do {
                try self.open()
                try self.transaction {
                    try self.run("DELETE FROM docs", [])
                    if clearValues { try self.run("DELETE FROM kv", []) }
                    try self.insert(docs)
                }
                call.resolve()
            } catch {
                call.reject("\(error)", "write_failed")
            }
        }
    }

    /// Sets (or with no value, removes) one key/value pair.
    @objc func setValue(_ call: CAPPluginCall) {
        guard let k = call.getString("k") else { return call.reject("Missing key", "invalid_argument") }
        let v = call.getString("v")
        queue.async {
            do {
                try self.open()
                if let v = v {
                    try self.run("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", [k, v])
                } else {
                    try self.run("DELETE FROM kv WHERE k = ?", [k])
                }
                call.resolve()
            } catch {
                call.reject("\(error)", "write_failed")
            }
        }
    }

    // MARK: - SQLite helpers (only called on `queue`)

    private struct StoreError: Error, CustomStringConvertible {
        let description: String
    }

    private func open() throws {
        if db != nil { return }
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("MoneyTracker", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("money.sqlite").path
        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
            sqlite3_close(handle)
            throw StoreError(description: "Couldn't open database: \(message)")
        }
        db = handle
        try exec("PRAGMA journal_mode = WAL")
        try exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)")
        try exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
    }

    private func insert(_ docs: [JSObject]) throws {
        for doc in docs {
            guard let p = doc["p"] as? String, let d = doc["d"] as? String else {
                throw StoreError(description: "Bad document")
            }
            try run("INSERT OR REPLACE INTO docs (path, data) VALUES (?, ?)", [p, d])
        }
    }

    private func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw lastError() }
    }

    private func run(_ sql: String, _ args: [String]) throws {
        try query(sql, args) { _ in }
    }

    private func query(_ sql: String, _ args: [String] = [], row: (OpaquePointer) -> Void) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt = stmt else { throw lastError() }
        defer { sqlite3_finalize(stmt) }
        for (i, arg) in args.enumerated() {
            sqlite3_bind_text(stmt, Int32(i + 1), arg, -1, MoneyStorePlugin.transient)
        }
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW { row(stmt); continue }
            if rc == SQLITE_DONE { return }
            throw lastError()
        }
    }

    private func text(_ stmt: OpaquePointer, _ col: Int32) -> String {
        guard let c = sqlite3_column_text(stmt, col) else { return "" }
        return String(cString: c)
    }

    private func lastError() -> StoreError {
        StoreError(description: db.map { String(cString: sqlite3_errmsg($0)) } ?? "Database not open")
    }
}
