// Copies the web app (kept at the repo root so GitHub Pages keeps working) into www/ for Capacitor.
// sw.js is left out: service workers don't run inside the iOS app.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const files = [
  "index.html",
  "pdf.min.js",
  "pdf.worker.min.js",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
];

rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const f of files) cpSync(f, `www/${f}`);
// Files from a zip download carry macOS extended attributes, which make iOS code signing fail.
if (process.platform === "darwin") execFileSync("xattr", ["-cr", "www"]);
console.log(`Copied ${files.length} files to www/`);
