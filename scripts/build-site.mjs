import { cp, mkdir } from "node:fs/promises";
await mkdir("dist-site", { recursive: true });
await cp("public", "dist-site", { recursive: true });
console.log("Built static documentation site in dist-site");
