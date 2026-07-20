import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const port = Number(process.env.PORT || process.env.NOCODB_PORT || 8080);
const dataDir = process.env.NC_DATA_DIR || path.join(__dirname, "data");

fs.mkdirSync(dataDir, { recursive: true });
process.chdir(dataDir);

process.env.PORT = String(port);
process.env.NC_DISABLE_TELE = process.env.NC_DISABLE_TELE || "true";
process.env.NC_BINARY_BUILD = process.env.NC_BINARY_BUILD || "true";

const express = require("express");
const { Noco } = require("nocodb");

async function main() {
  const app = express();
  const httpServer = app.listen(port, () => {
    console.log(`[liangce-nocodb] listening on http://127.0.0.1:${port}`);
  });

  app.use(await Noco.init({}, httpServer, app));
  app.get("/", (_req, res) => {
    res.redirect("/dashboard");
  });

  console.log(`[liangce-nocodb] data dir: ${dataDir}`);
  console.log(`[liangce-nocodb] dashboard: http://127.0.0.1:${port}/dashboard`);
}

main().catch((err) => {
  console.error("[liangce-nocodb] failed to start", err);
  process.exit(1);
});
