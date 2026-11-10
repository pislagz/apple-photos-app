#!/usr/bin/env node
// Usage: node check_external_urls.mjs <dist-dir>   exit 1 and print offenders.
// Rules and the narrow library-string exceptions live in external_urls.mjs;
// its behavior is covered by web/src/externalUrls.test.ts.
import { existsSync } from "node:fs";
import { checkDir } from "./external_urls.mjs";

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error("usage: check_external_urls.mjs <dist-dir> (run `npm run build` first)");
  process.exit(2);
}
const offenders = checkDir(dir);
if (offenders.length > 0) {
  console.error("Unexpected external URL(s) in the production build:");
  for (const line of offenders) console.error(line);
  process.exit(1);
}
console.log(`ok: no unexpected external URLs under ${dir}`);
