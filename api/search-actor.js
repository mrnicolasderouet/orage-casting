const { getClientIp, checkRateLimit } = require("./_redis");

const FETCH_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.SERPER_API_KEY) {
    res.status(500).json({ error: "SERPER_API_KEY non configuré côté serveur" });
    return;
  }

  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:searchactor:${ip}`, 30, 60 * 60);
    if (!allowed) {
      res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nom requis" });
      return;
    }
    const query = `${name.trim()} comédien acteur agence fiche`;

    const searchRes = await fetchWithTimeout("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, gl: "fr", hl: "fr", num: 8 })
    });

    if (!searchRes.ok) {
      const errBody = await searchRes.text().catch(() => "");
      console.error("Serper API error", searchRes.status, errBody);
      res.status(502).json({ error: "Erreur lors de la recherche", debugPreview: `HTTP ${searchRes.status} — ${errBody.slice(0, 300)}` });
      return;
    }

    const data = await searchRes.json();
    const organic = Array.isArray(data.organic) ? data.organic : [];

    const results = organic
      .filter(r => r.link && r.title)
      .slice(0, 5)
      .map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet || ""
      }));

    res.status(200).json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Erreur serveur",
      debugPreview: `${err && err.name}: ${err && err.message}`
    });
  }
};
