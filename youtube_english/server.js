const path = require("path");
const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");

const TEST_WORDS = [
  { en: "archipelago", ru: "архипелаг" },
  { en: "seafloor", ru: "морское дно" },
  { en: "silt", ru: "ил" },
  { en: "capsized", ru: "перевернувшийся" },
  { en: "reef", ru: "риф" },
  { en: "current", ru: "течение" },
  { en: "tide", ru: "прилив" },
  { en: "ebb", ru: "отлив" },
  { en: "depth", ru: "глубина" },
  { en: "surface", ru: "поверхность" },
  { en: "pressure", ru: "давление" },
  { en: "oxygen", ru: "кислород" },
  { en: "vessel", ru: "судно" },
  { en: "salvage", ru: "подъём затонувшего" },
  { en: "wreckage", ru: "обломки" },
  { en: "compass", ru: "компас" },
  { en: "anchor", ru: "якорь" },
  { en: "horizon", ru: "горизонт" },
  { en: "swell", ru: "зыбь" },
  { en: "cargo", ru: "груз" },
  { en: "navigate", ru: "навигация" },
  { en: "voyage", ru: "путешествие" },
  { en: "fathom", ru: "сажень" },
  { en: "harbor", ru: "гавань" },
  { en: "lighthouse", ru: "маяк" },
  { en: "current", ru: "текущий" },
  { en: "submerge", ru: "погружать" },
  { en: "float", ru: "плавать" },
  { en: "rescue", ru: "спасать" },
  { en: "buoy", ru: "буй" }
];

let db;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(__dirname)));

async function initDb() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      en TEXT NOT NULL,
      ru TEXT NOT NULL,
      level INTEGER NOT NULL,
      next_review INTEGER NOT NULL,
      streak INTEGER NOT NULL
    );
  `);

  const row = await db.get("SELECT COUNT(*) as count FROM words");
  if (row.count === 0) {
    const now = Date.now();
    const stmt = await db.prepare(
      "INSERT INTO words (en, ru, level, next_review, streak) VALUES (?, ?, ?, ?, ?)"
    );
    for (const item of TEST_WORDS) {
      await stmt.run(item.en, item.ru, 1, now, 0);
    }
    await stmt.finalize();
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/words", async (req, res) => {
  const words = await db.all(
    "SELECT id, en, ru, level, next_review, streak FROM words ORDER BY id"
  );
  res.json({ words });
});

app.post("/api/words/:id", async (req, res) => {
  const { id } = req.params;
  const { level, next_review, streak } = req.body || {};

  if (!Number.isInteger(level) || !Number.isInteger(next_review) || !Number.isInteger(streak)) {
    return res.status(400).json({ error: "level, next_review, streak must be integers." });
  }

  await db.run(
    "UPDATE words SET level = ?, next_review = ?, streak = ? WHERE id = ?",
    [level, next_review, streak, id]
  );

  res.json({ ok: true });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
