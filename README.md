# Money Tracker

An Australian-first personal finance app: accounts and cards, budgets and safe-to-spend, recurring bills, savings goals with pay-based plans, investments, super and FIRE progress, loans and IOUs, remittances, prop-trading accounts, multi-currency, a PIN lock, and bank statement import from CSV or PDF.

This repository holds the working web version, exported from Claude. The next job is turning it into an iOS app for the App Store, with a free and a paid (Plus) tier.

## What's here

| Path | What it is |
| --- | --- |
| `web/index.html` | The whole app: markup, styles and script in one file (fonts are embedded) |
| `web/pdf.min.js` | Mozilla pdf.js 3.11.174, loaded only when a PDF statement is imported |
| `web/pdf.worker.min.js` | pdf.js worker, loaded with the file above |

## What has to change for iOS

The app currently runs inside claude.ai and depends on two Claude-only features. Both must be replaced before it can run as a standalone app.

1. **Storage — `window.claude.use("db")`**
   All data is read and written through this database. It uses:
   - `app/config` — a single document with settings, accounts, categories, budgets, goals, bills and feature switches
   - `tx` — a collection of transactions
   - `props` — a collection for prop-trading accounts

   The calls go through a small `wrapDb()` function and are started in `boot()`. Replace that wrapper with on-device storage (SQLite via Capacitor, for example) that offers the same `doc()` / `collection()` shape, so the rest of the code doesn't need to change.

2. **File downloads — `window.claude.use("downloads")`**
   Used for exports such as CSV. On iOS, replace it with the native share sheet.

Some data also uses `localStorage` (for example the PIN settings). Move anything sensitive to the iOS Keychain.

## Feature switches for the free and paid tiers

The code already has switches, checked with `feat("...")`, for: `goals`, `investments`, `loans`, `people`, `remit`, `trading`. Gate the paid features with these plus a subscription check from StoreKit. See the launch plan for the full free and paid split.

## Suggested first steps (iOS Engineer)

1. Add Capacitor and an iOS project around `web/`.
2. Replace the storage wrapper and test that data survives an app restart.
3. Add Face ID, local bill reminders and statement import from the Files app.
4. Add StoreKit 2 subscriptions and the paywall.

Building the iOS app needs a Mac with Xcode installed.
