import ignore from "ignore";
import { extensionOf, TEXT_EXTENSIONS } from "./file-types";

// Runs in the browser (before upload) and again on the server, so secrets and
// junk never leave the Mac and can't slip in through a zip either.

export const CODE_LIMITS = {
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFiles: 3000,
};

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".vercel",
  "dist", "build", "out", "coverage", "target", "bin", "obj", "vendor", "Pods",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".idea", ".vscode", ".gradle", ".dart_tool", ".expo", "__MACOSX",
]);

const SECRET_FILE = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|crt|cer)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^(credentials|secrets?|service[-_]?account.*)\.json$/i,
  /^\.(npmrc|netrc|pypirc)$/i,
];

const NOISE_FILE = [
  /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|uv\.lock)$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /^\.DS_Store$/,
];

const EXTENSIONLESS_TEXT = new Set(["Dockerfile", "Makefile", "Procfile", "README", "Gemfile", "Rakefile"]);

export type CodeEntry = { path: string; size: number };

export type CodeFilterResult<T extends CodeEntry> = {
  kept: T[];
  skipped: number;
  truncated: boolean;
};

/** Strips a shared top-level folder ("my-app/src/x.ts" → "src/x.ts"). */
export function stripCommonRoot<T extends CodeEntry>(entries: T[]): { root: string | null; entries: T[] } {
  const first = entries[0]?.path.split("/")[0];
  if (!first || !entries.every((e) => e.path.startsWith(`${first}/`))) {
    return { root: null, entries };
  }
  return {
    root: first,
    entries: entries.map((e) => ({ ...e, path: e.path.slice(first.length + 1) })),
  };
}

export function filterCodeEntries<T extends CodeEntry>(
  entries: T[],
  gitignore?: string
): CodeFilterResult<T> {
  const ig = ignore();
  if (gitignore) ig.add(gitignore);

  const kept: T[] = [];
  let skipped = 0;
  let total = 0;
  let truncated = false;

  for (const entry of entries) {
    const parts = entry.path.split("/");
    const base = parts[parts.length - 1];
    const ok =
      !parts.slice(0, -1).some((dir) => IGNORED_DIRS.has(dir) || (dir.startsWith(".") && dir !== ".github")) &&
      !SECRET_FILE.some((re) => re.test(base)) &&
      !NOISE_FILE.some((re) => re.test(base)) &&
      (TEXT_EXTENSIONS.has(extensionOf(base)) || EXTENSIONLESS_TEXT.has(base)) &&
      entry.size <= CODE_LIMITS.maxFileBytes &&
      !(gitignore && ig.ignores(entry.path));

    if (!ok) {
      skipped++;
      continue;
    }
    if (kept.length >= CODE_LIMITS.maxFiles || total + entry.size > CODE_LIMITS.maxTotalBytes) {
      truncated = true;
      skipped++;
      continue;
    }
    kept.push(entry);
    total += entry.size;
  }
  return { kept, skipped, truncated };
}

// Last line of defense for secrets hardcoded in source files.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
];

export function redactSecrets(content: string) {
  return SECRET_PATTERNS.reduce((text, re) => text.replace(re, "[REDACTED]"), content);
}
