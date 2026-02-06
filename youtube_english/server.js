const path = require("path");
const express = require("express");
const { getSubtitles } = require("youtube-captions-scraper");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(__dirname)));

function extractVideoId(input) {
  if (!input) return null;

  // If already looks like a YouTube ID (11 chars, letters/numbers/_-)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (url.hostname.includes("youtube.com")) {
      const id = url.searchParams.get("v");
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch (err) {
    return null;
  }

  return null;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/captions", async (req, res) => {
  const { url, videoId, lang } = req.query;
  const id = extractVideoId(videoId || url);
  const language = (lang || "en").toString();

  if (!id) {
    return res.status(400).json({ error: "Invalid YouTube URL or videoId." });
  }

  try {
    const captions = await getSubtitles({ videoID: id, lang: language });
    res.json({ videoId: id, lang: language, captions });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch captions. The video may not have subtitles for this language.",
      details: err.message
    });
  }
});

app.post("/api/translate", async (req, res) => {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "DEEPL_API_KEY is not set on the server." });
  }

  const { words, targetLang } = req.body || {};
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: "words must be a non-empty array." });
  }

  try {
    const endpoint = "https://api-free.deepl.com/v2/translate";

    // DeepL accepts multiple text parameters.
    const params = new URLSearchParams();
    params.append("target_lang", (targetLang || "RU").toString());
    for (const word of words) {
      params.append("text", word);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "DeepL API error", details: errorText });
    }

    const data = await response.json();
    const translations = {};
    data.translations.forEach((item, i) => {
      translations[words[i]] = item.text;
    });

    res.json({ translations });
  } catch (err) {
    res.status(500).json({ error: "Translation failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
