// Local development launcher.
// Starts a private PostgreSQL instance (data kept in ./.pgdata), then runs server.js against it.
// Usage: npm run dev   (open http://localhost:8080)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, ".pgdata");
// 5440 avoids the other PostgreSQL already using 5433 on this machine. Override with PG_PORT.
const PG_PORT = Number(process.env.PG_PORT || 5440);

const logs = [];
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: PG_PORT,
  persistent: true,
  // UTF-8 like the Railway database (Windows would otherwise default to WIN1252).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: m => { logs.push(String(m)); if (logs.length > 40) logs.shift(); },
  onError: m => logs.push(String(m)),
});

try {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log("Creating local database in .pgdata ...");
    await pg.initialise();
  }
  await pg.start();
} catch (e) {
  console.error("Could not start local PostgreSQL. Last log lines:\n" + logs.slice(-12).join(""));
  console.error(`If port ${PG_PORT} is taken, run with another one, e.g.  $env:PG_PORT=5441; npm run dev`);
  process.exit(1);
}
try { await pg.createDatabase("uat_dashboard"); } catch { /* already exists */ }
console.log(`PostgreSQL running on localhost:${PG_PORT}`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping PostgreSQL ...");
  try { await pg.stop(); } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// sslmode=disable: the local database has no SSL (server.js requests SSL for non-Railway hosts).
process.env.DATABASE_URL ||= `postgres://postgres:postgres@localhost:${PG_PORT}/uat_dashboard?sslmode=disable`;
process.env.PORT ||= "8080";

createRequire(import.meta.url)("./server.js");
