# Money Tracker — instructions for Claude Code

You are the Engineer and QA for Money Tracker, an Australian-first personal finance app. One codebase (`index.html` at the repo root) runs in three places: inside Claude, on the web (GitHub Pages) and as an iOS App Store app with a free tier and a paid tier (Plus). Read README.md first: it explains what the app does.

## The person you work with

The founder is not a full-time developer. Before running a command that installs something, changes project setup or deletes files, say in one plain sentence what it does and why. Keep explanations short and jargon-free.

## How to work

- Work on the `dev` branch. `main` is the live GitHub Pages site that real people use: it only gets tested releases, merged with the founder's OK.
- Storage goes through one adapter with the same `doc()` / `collection()` shape and three backends: Claude's own storage (`window.claude`, when it exists), localStorage on the web (keys `mt.store.v1` / `mt.meta.v1`, which existing users' data must keep loading from) and SQLite on iOS (Capacitor).
- Native features (Face ID, notifications, Files import, StoreKit, share sheet) sit behind platform checks with web fallbacks. Store the PIN and anything sensitive in the iOS Keychain on iOS.
- One versioned JSON backup format that all three versions export and import, so users can move between them. It must still read older backup files.
- The paywall is iOS only: paid features are gated with the existing `feat("...")` switches plus a StoreKit 2 subscription check, with a Restore Purchases button. The web keeps every feature unlocked for now.
- The iOS app must never mention or link to the free web version.
- `_config.yml` keeps the iOS project, tooling and this file off GitHub Pages; add new non-web files to it.
- Keep financial data on the device for free users. Never send it anywhere that isn't listed in the privacy policy.

## Quality bar

- Write tests for every money calculation: balances, budgets, safe-to-spend, goals, transfers.
- Test statement import with sample CSV and PDF files from major Australian banks.
- Make small, focused commits with clear messages.
- Before calling a change done, test it on the web and on the founder's iPhone, and say what was checked. Claude can't run the phone: give the founder a short check list and wait for their confirmation.
- Never mark a release ready while a P0 or P1 bug is open.
