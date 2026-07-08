const { getClientIp, checkRateLimit } = require("./_redis");

const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;

function isPrivateOrLocalHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

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
    const allowed = await checkRateLimit(`ratelimit:fetchphoto:${ip}`, 30, 60 * 60);
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
    if (!["http:", "https:"].includes(parsed.protocol) || isPrivateOrLocalHost(parsed.hostname)) {
      res.status(400).json({ error: "URL non autorisée" });
      return;
    }

    const pageRes = await fetchWithTimeout(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OrageCastingBot/1.0)" }
    });
    if (!pageRes.ok) {
      res.status(200).json({ photo: null, reason: "Page inaccessible" });
      return;
    }
    const contentLength = parseInt(pageRes.headers.get("content-length") || "0", 10);
    if (contentLength && contentLength > MAX_FETCH_BYTES) {
      res.status(200).json({ photo: null, reason: "Page trop volumineuse" });
      return;
    }
    const html = await pageRes.text();

    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

    let candidateUrl = ogMatch ? ogMatch[1] : null;

    if (!candidateUrl) {
      const linkedMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/gi)];
      const skipPattern = /(logo|icon|sprite|pixel|fleche|arrow|bt_|btn_|spacer)/i;
      for (const m of linkedMatches) {
        const href = m[1];
        const src = m[2];
        if (skipPattern.test(href) || skipPattern.test(src)) continue;
        if (/\.(jpe?g|png)(\?|$)/i.test(href)) { candidateUrl = href; break; }
        if (/\.(jpe?g|png)(\?|$)/i.test(src)) { candidateUrl = src; break; }
      }
    }

    if (!candidateUrl) {
      const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
      const skipPattern = /(logo|icon|sprite|pixel|fleche|arrow|bt_|btn_|spacer)/i;
      for (const m of imgMatches) {
        const src = m[1];
        if (!/\.(jpe?g|png)(\?|$)/i.test(src)) continue;
        if (skipPattern.test(src)) continue;
        candidateUrl = src;
        break;
      }
    }

    if (!candidateUrl) {
      res.status(200).json({ photo: null, reason: "Aucune image détectée sur cette page" });
      return;
    }

    let imageUrl = candidateUrl;
    try {
      imageUrl = new URL(imageUrl, parsed).toString();
    } catch {
      res.status(200).json({ photo: null, reason: "Lien d'image invalide" });
      return;
    }
    const imgParsed = new URL(imageUrl);
    if (!["http:", "https:"].includes(imgParsed.protocol) || isPrivateOrLocalHost(imgParsed.hostname)) {
      res.status(200).json({ photo: null, reason: "Image non autorisée" });
      return;
    }

    const imgRes = await fetchWithTimeout(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OrageCastingBot/1.0)" }
    });
    if (!imgRes.ok) {
      res.status(200).json({ photo: null, reason: "Image inaccessible" });
      return;
    }
    const imgContentType = (imgRes.headers.get("content-type") || "").split(";")[0].trim();
    if (!["image/jpeg", "image/jpg", "image/png"].includes(imgContentType)) {
      res.status(200).json({ photo: null, reason: "Format d'image non supporté" });
      return;
    }
    const arrayBuffer = await imgRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FETCH_BYTES) {
      res.status(200).json({ photo: null, reason: "Image trop volumineuse" });
      return;
    }
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${imgContentType};base64,${base64}`;

    res.status(200).json({ photo: dataUrl });
  } catch (err) {
    console.error(err);
    res.status(200).json({ photo: null, reason: "Erreur lors de la récupération" });
  }
};
