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
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:resolvevimeo:${ip}`, 60, 60 * 60);
    if (!allowed) {
      res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: "url requise" });
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: "URL invalide" });
      return;
    }
    if (!/(^|\.)vimeo\.com$/i.test(parsed.hostname)) {
      res.status(400).json({ error: "URL non autorisée" });
      return;
    }

    const pageRes = await fetchWithTimeout(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CastingBot/1.0)" }
    });
    if (!pageRes.ok) {
      res.status(200).json({ embedUrl: null });
      return;
    }
    const html = await pageRes.text();

    const match =
      /property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
      /content=["']([^"']+)["'][^>]+property=["']og:video:secure_url["']/i.exec(html) ||
      /name=["']twitter:player["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
      /content=["']([^"']+)["'][^>]+name=["']twitter:player["']/i.exec(html);

    if (!match) {
      res.status(200).json({ embedUrl: null });
      return;
    }

    res.status(200).json({ embedUrl: match[1] });
  } catch (err) {
    console.error(err);
    res.status(200).json({ embedUrl: null });
  }
};
