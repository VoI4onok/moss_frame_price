const path = require("path");
require("dotenv").config();
const express = require("express");
const { getSubtitles } = require("youtube-captions-scraper");
const { YoutubeTranscript } = require("youtube-transcript");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(__dirname)));

function isAllowedTranscriptUrl(rawUrl) {
  try {
    const value = String(rawUrl || "").trim();
    if (!value) return false;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isHttps = url.protocol === "https:" || url.protocol === "http:";
    return isHttps && (host === "criticalrole.fandom.com" || host.endsWith(".criticalrole.fandom.com"));
  } catch (err) {
    return false;
  }
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function htmlToText(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/dd>/gi, "\n")
    .replace(/<\/dt>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(stripped);
}

function extractTranscriptLines(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const speakerPattern = /^[A-Z][A-Z' .-]{2,25}:/;
  const speakerPatternLoose = /^[A-Z][a-zA-Z' .-]{1,30}:/;
  const transcript = [];

  for (const line of lines) {
    if (speakerPattern.test(line)) {
      const cleaned = line.replace(speakerPattern, "").trim();
      if (cleaned) transcript.push(cleaned);
      continue;
    }
    if (speakerPatternLoose.test(line)) {
      const cleaned = line.replace(speakerPatternLoose, "").trim();
      if (cleaned) transcript.push(cleaned);
      continue;
    }
  }

  if (transcript.length) return transcript;

  const blacklist = new Set([
    "transcript",
    "contents",
    "references",
    "see also",
    "navigation",
    "edit",
    "comments"
  ]);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (blacklist.has(lower)) continue;
    const wordCount = line.split(/\s+/).length;
    if (wordCount >= 3) {
      transcript.push(line);
    }
  }

  return transcript;
}

function buildFandomApiUrl(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.origin;
  const path = url.pathname || "";
  const wikiIndex = path.indexOf("/wiki/");
  const page = wikiIndex >= 0 ? decodeURIComponent(path.slice(wikiIndex + 6)) : "";
  if (!page) return null;
  const api = new URL("/api.php", host);
  api.searchParams.set("action", "parse");
  api.searchParams.set("page", page);
  api.searchParams.set("prop", "text");
  api.searchParams.set("format", "json");
  return api.toString();
}

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
  const languageRaw = (lang || "en").toString();
  const languageList = languageRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const language = languageList[0] || "en";

  if (!id) {
    return res.status(400).json({ error: "Invalid YouTube URL or videoId." });
  }

  try {
    let captions = null;
    let usedLang = language;

    const candidates = languageList.length ? languageList : [language];
    const errors = [];
    for (const langCandidate of candidates) {
      try {
        const result = await getSubtitles({ videoID: id, lang: langCandidate });
        if (Array.isArray(result) && result.length) {
          captions = result;
          usedLang = langCandidate;
          break;
        }
      } catch (innerErr) {
        errors.push({
          lang: langCandidate,
          message: innerErr && innerErr.message ? innerErr.message : String(innerErr)
        });
      }
    }

    if (!captions) {
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(id, {
          lang: candidates[0] || "en"
        });
        if (Array.isArray(transcript) && transcript.length) {
          return res.json({
            videoId: id,
            lang: candidates[0] || "en",
            captions: transcript,
            source: "youtube-transcript"
          });
        }
      } catch (fallbackErr) {
        errors.push({
          lang: candidates[0] || "en",
          message: fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr),
          source: "youtube-transcript"
        });
      }

      return res.status(404).json({
        error: "No captions found for the requested languages.",
        attemptedLangs: candidates,
        errors
      });
    }

    res.json({ videoId: id, lang: usedLang, captions, source: "youtube-captions-scraper" });
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

app.get("/api/transcript", async (req, res) => {
  const { url } = req.query;
  if (!url || !isAllowedTranscriptUrl(url)) {
    return res.status(400).json({
      error: "Invalid transcript URL. Only criticalrole.fandom.com transcripts are allowed."
    });
  }

  try {
    const apiUrl = buildFandomApiUrl(url.toString());
    if (!apiUrl) {
      return res.status(400).json({ error: "Could not parse transcript URL." });
    }

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const bodySnippet = (await response.text()).slice(0, 300);
      return res.status(response.status).json({
        error: "Failed to fetch transcript page.",
        status: response.status,
        statusText: response.statusText,
        snippet: bodySnippet
      });
    }

    const apiData = await response.json();
    const html = apiData && apiData.parse && apiData.parse.text && apiData.parse.text["*"]
      ? apiData.parse.text["*"]
      : "";
    if (!html) {
      return res.status(404).json({ error: "Transcript content not found in API response." });
    }

    const text = htmlToText(html);
    const lines = extractTranscriptLines(text);

    if (!lines.length) {
      return res.status(404).json({ error: "No transcript lines found on the page." });
    }

    const captions = lines.map((line, idx) => ({
      start: null,
      text: line,
      index: idx
    }));

    res.json({ captions, source: "criticalrole.fandom.com" });
  } catch (err) {
    res.status(500).json({ error: "Failed to parse transcript.", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
