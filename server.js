// UAT Module Allocation Dashboard - small server
// Serves index.html and saves the team's shared data in PostgreSQL.
const express = require("express");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const DB_URL = process.env.DATABASE_URL;
const PASSWORD = process.env.TEAM_PASSWORD || "";
const SEED = "saas|uat|v6.4.1(10)";

if (!DB_URL) {
  console.error("DATABASE_URL is not set. Add it in Railway > Variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DB_URL,
  ssl: /\.railway\.internal/.test(DB_URL) ? false : { rejectUnauthorized: false }
});

async function setup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doc (
      field TEXT PRIMARY KEY,
      value JSONB,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS status (
      build TEXT NOT NULL,
      key TEXT NOT NULL,
      a TEXT,
      w TEXT,
      t TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (build, key)
    );
    ALTER TABLE status ADD COLUMN IF NOT EXISTS t TEXT;
    CREATE TABLE IF NOT EXISTS notes (
      key TEXT PRIMARY KEY,
      text TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

async function loadState() {
  const [d, s, n] = await Promise.all([
    pool.query("SELECT field, value FROM doc"),
    pool.query("SELECT build, key, a, w, t FROM status"),
    pool.query("SELECT key, text FROM notes")
  ]);
  const doc = {};
  d.rows.forEach(r => { if (r.value !== null) doc[r.field] = r.value; });
  const status = {}, bstatus = {};
  s.rows.forEach(r => {
    const cell = {};
    if (r.a !== null) cell.a = r.a;
    if (r.w !== null) cell.w = r.w;
    if (r.t !== null) cell.t = r.t;
    if (r.build === SEED) status[r.key] = cell;
    else (bstatus[r.build] = bstatus[r.build] || {})[r.key] = cell;
  });
  const notes = {};
  n.rows.forEach(r => { notes[r.key] = r.text; });
  return { doc, status, bstatus, notes };
}

const app = express();
app.use(express.json({ limit: "5mb" }));

// Simple team password (browser login box). Any username works.
app.use((req, res, next) => {
  if (!PASSWORD || req.path === "/health") return next();
  const h = req.headers.authorization || "";
  const [type, value] = h.split(" ");
  if (type === "Basic" && value) {
    const pass = Buffer.from(value, "base64").toString().split(":").slice(1).join(":");
    if (pass === PASSWORD) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="UAT Dashboard"');
  res.status(401).send("Password needed");
});

const who = req => {
  try { return decodeURIComponent(req.get("X-User") || "").slice(0, 80); } catch { return ""; }
};

app.get("/health", (req, res) => res.send("ok"));

app.get(["/", "/index.html"], async (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const state = JSON.stringify(await loadState()).replace(/</g, "\\u003c");
    res.set("Cache-Control", "no-store");
    res.type("html").send(html.replace("/*__STATE__*/null", state));
  } catch (e) {
    console.error(e);
    res.status(500).send("Could not load the dashboard.");
  }
});

app.get("/api/state", async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json(await loadState()); }
  catch (e) { console.error(e); res.status(500).json({ error: "load failed" }); }
});

app.post("/api/doc", async (req, res) => {
  const fields = (req.body && req.body.fields) || {};
  try {
    for (const [field, value] of Object.entries(fields)) {
      await pool.query(
        `INSERT INTO doc (field, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (field) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [field, JSON.stringify(value), who(req)]
      );
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "save failed" }); }
});

app.post("/api/status", async (req, res) => {
  const cells = (req.body && req.body.cells) || [];
  try {
    for (const c of cells) {
      const hasA = Object.prototype.hasOwnProperty.call(c, "a");
      const hasW = Object.prototype.hasOwnProperty.call(c, "w");
      const hasT = Object.prototype.hasOwnProperty.call(c, "t");
      await pool.query(
        `INSERT INTO status (build, key, a, w, t, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (build, key) DO UPDATE SET
           a = CASE WHEN $7 THEN EXCLUDED.a ELSE status.a END,
           w = CASE WHEN $8 THEN EXCLUDED.w ELSE status.w END,
           t = CASE WHEN $9 THEN EXCLUDED.t ELSE status.t END,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [c.build, c.key, hasA ? c.a : null, hasW ? c.w : null, hasT ? c.t : null, who(req), hasA, hasW, hasT]
      );
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "save failed" }); }
});

app.post("/api/notes", async (req, res) => {
  const notes = (req.body && req.body.notes) || {};
  try {
    for (const [key, text] of Object.entries(notes)) {
      if (text === null || text === "") await pool.query("DELETE FROM notes WHERE key = $1", [key]);
      else await pool.query(
        `INSERT INTO notes (key, text, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET text = EXCLUDED.text, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, text, who(req)]
      );
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "save failed" }); }
});

setup()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log("UAT Dashboard listening on port " + PORT)))
  .catch(e => { console.error("Database setup failed:", e); process.exit(1); });
