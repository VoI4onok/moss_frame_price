const path = require("path");
const crypto = require("crypto");
const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data.db");

let db;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(__dirname)));

async function initDb() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY,
      folder_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id TEXT NOT NULL,
      word TEXT NOT NULL,
      translation TEXT NOT NULL,
      definition TEXT,
      example TEXT,
      fact TEXT,
      good_count INTEGER DEFAULT 0,
      bad_count INTEGER DEFAULT 0,
      last_seen TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(set_id) REFERENCES sets(id)
    );
  `);

  const columns = await db.all("PRAGMA table_info(cards)");
  const columnNames = new Set(columns.map((col) => col.name));
  if (!columnNames.has("example")) {
    await db.exec("ALTER TABLE cards ADD COLUMN example TEXT;");
  }
  if (!columnNames.has("fact")) {
    await db.exec("ALTER TABLE cards ADD COLUMN fact TEXT;");
  }
  if (!columnNames.has("good_count")) {
    await db.exec("ALTER TABLE cards ADD COLUMN good_count INTEGER DEFAULT 0;");
  }
  if (!columnNames.has("bad_count")) {
    await db.exec("ALTER TABLE cards ADD COLUMN bad_count INTEGER DEFAULT 0;");
  }
  if (!columnNames.has("last_seen")) {
    await db.exec("ALTER TABLE cards ADD COLUMN last_seen TEXT;");
  }

  const setColumns = await db.all("PRAGMA table_info(sets)");
  const setColumnNames = new Set(setColumns.map((col) => col.name));
  if (!setColumnNames.has("folder_id")) {
    await db.exec("ALTER TABLE sets ADD COLUMN folder_id TEXT;");
  }
}

function makeId() {
  return crypto.randomBytes(10).toString("hex");
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/folders", async (req, res) => {
  const folders = await db.all(
    "SELECT id, name, created_at FROM folders ORDER BY created_at DESC"
  );
  res.json({ folders });
});

app.post("/api/folders", async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Folder name is required." });
  }
  const id = makeId();
  const createdAt = new Date().toISOString();
  await db.run("INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)", [
    id,
    name.trim(),
    createdAt
  ]);
  res.json({ id, name: name.trim(), created_at: createdAt });
});

app.get("/api/folders/:id/sets", async (req, res) => {
  const { id } = req.params;
  const sets = await db.all(
    "SELECT id, folder_id, created_at FROM sets WHERE folder_id = ? ORDER BY created_at DESC",
    [id]
  );
  res.json({ sets });
});

app.post("/api/sets", async (req, res) => {
  const { folderId } = req.body || {};
  const id = makeId();
  const createdAt = new Date().toISOString();
  await db.run("INSERT INTO sets (id, folder_id, created_at) VALUES (?, ?, ?)", [
    id,
    folderId || null,
    createdAt
  ]);
  res.json({ id, folderId: folderId || null, createdAt });
});

app.get("/api/sets/:id", async (req, res) => {
  const { id } = req.params;
  const set = await db.get(
    "SELECT id, folder_id, created_at FROM sets WHERE id = ?",
    [id]
  );
  if (!set) return res.status(404).json({ error: "Set not found." });
  res.json(set);
});

app.get("/api/sets/:id/cards", async (req, res) => {
  const { id } = req.params;
  const set = await db.get("SELECT id FROM sets WHERE id = ?", [id]);
  if (!set) return res.status(404).json({ error: "Set not found." });

  const cards = await db.all(
    "SELECT id, word, translation, definition, example, fact, good_count, bad_count, last_seen, created_at FROM cards WHERE set_id = ? ORDER BY id DESC",
    [id]
  );
  res.json({ cards });
});

app.post("/api/sets/:id/cards", async (req, res) => {
  const { id } = req.params;
  const { word, translation, definition, example, fact } = req.body || {};

  if (!word || !translation) {
    return res.status(400).json({ error: "word and translation are required." });
  }

  const set = await db.get("SELECT id FROM sets WHERE id = ?", [id]);
  if (!set) return res.status(404).json({ error: "Set not found." });

  const createdAt = new Date().toISOString();
  const result = await db.run(
    "INSERT INTO cards (set_id, word, translation, definition, example, fact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      word.trim(),
      translation.trim(),
      definition ? definition.trim() : null,
      example ? example.trim() : null,
      fact ? fact.trim() : null,
      createdAt
    ]
  );

  res.json({
    id: result.lastID,
    word: word.trim(),
    translation: translation.trim(),
    definition: definition ? definition.trim() : null,
    example: example ? example.trim() : null,
    fact: fact ? fact.trim() : null,
    good_count: 0,
    bad_count: 0,
    last_seen: null,
    created_at: createdAt
  });
});

app.delete("/api/sets/:id/cards/:cardId", async (req, res) => {
  const { id, cardId } = req.params;
  const set = await db.get("SELECT id FROM sets WHERE id = ?", [id]);
  if (!set) return res.status(404).json({ error: "Set not found." });

  await db.run("DELETE FROM cards WHERE id = ? AND set_id = ?", [cardId, id]);
  res.json({ ok: true });
});

app.post("/api/sets/:id/cards/:cardId/review", async (req, res) => {
  const { id, cardId } = req.params;
  const { result } = req.body || {};
  if (!["good", "bad"].includes(result)) {
    return res.status(400).json({ error: "result must be 'good' or 'bad'." });
  }

  const set = await db.get("SELECT id FROM sets WHERE id = ?", [id]);
  if (!set) return res.status(404).json({ error: "Set not found." });

  const now = new Date().toISOString();
  if (result === "good") {
    await db.run(
      "UPDATE cards SET good_count = good_count + 1, last_seen = ? WHERE id = ? AND set_id = ?",
      [now, cardId, id]
    );
  } else {
    await db.run(
      "UPDATE cards SET bad_count = bad_count + 1, last_seen = ? WHERE id = ? AND set_id = ?",
      [now, cardId, id]
    );
  }

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
