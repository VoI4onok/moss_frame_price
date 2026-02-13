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
      definition TEXT,
      example TEXT,
      fact TEXT,
      level INTEGER NOT NULL,
      next_review INTEGER NOT NULL,
      streak INTEGER NOT NULL
    );
  `);

  const row = await db.get("SELECT COUNT(*) as count FROM words");
  if (row.count === 0) {
    const now = Date.now();
    const stmt = await db.prepare(
      "INSERT INTO words (en, ru, definition, example, fact, level, next_review, streak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const item of TEST_WORDS) {
      await stmt.run(item.en, item.ru, null, null, null, 1, now, 0);
    }
    await stmt.finalize();
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/words", async (req, res) => {
  const words = await db.all(
    "SELECT id, en, ru, definition, example, fact, level, next_review, streak FROM words ORDER BY id"
  );
  res.json({ words });
});

app.post("/api/words", async (req, res) => {
  const { words } = req.body || {};
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: "words must be a non-empty array." });
  }
  const now = Date.now();
  const stmt = await db.prepare(
    "INSERT INTO words (en, ru, definition, example, fact, level, next_review, streak) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  let inserted = 0;
  for (const item of words) {
    if (!item || !item.en || !item.ru) continue;
    await stmt.run(
      String(item.en).trim(),
      String(item.ru).trim(),
      item.definition ? String(item.definition).trim() : null,
      item.example ? String(item.example).trim() : null,
      item.fact ? String(item.fact).trim() : null,
      1,
      now,
      0
    );
    inserted += 1;
  }
  await stmt.finalize();
  res.json({ inserted });
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

app.put("/api/words/:id", async (req, res) => {
  const { id } = req.params;
  const { en, ru, definition, example, fact } = req.body || {};
  if (!en || !ru) {
    return res.status(400).json({ error: "en and ru are required." });
  }
  await db.run(
    "UPDATE words SET en = ?, ru = ?, definition = ?, example = ?, fact = ? WHERE id = ?",
    [
      String(en).trim(),
      String(ru).trim(),
      definition ? String(definition).trim() : null,
      example ? String(example).trim() : null,
      fact ? String(fact).trim() : null,
      id
    ]
  );
  res.json({ ok: true });
});

app.delete("/api/words/:id", async (req, res) => {
  const { id } = req.params;
  await db.run("DELETE FROM words WHERE id = ?", [id]);
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
