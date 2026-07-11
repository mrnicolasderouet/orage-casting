// Garde d'authentification partagée : mot de passe dashboard + verrou anti-force-brute.
// 10 tentatives incorrectes max par 15 minutes et par adresse IP.
const crypto = require("crypto");
const { checkRateLimit, getClientIp } = require("./_redis");

const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function guardDashboard(req, res) {
  if (!process.env.DASHBOARD_PASSWORD) {
    res.status(500).json({ error: "DASHBOARD_PASSWORD non configuré côté serveur" });
    return false;
  }
  const password = req.headers["x-dashboard-password"];
  if (safeEqual(password, process.env.DASHBOARD_PASSWORD)) {
    return true;
  }
  // Échec : on compte la tentative et on verrouille au-delà du seuil.
  let allowed = true;
  try {
    const ip = getClientIp(req);
    allowed = await checkRateLimit(`ratelimit:pwfail:${ip}`, MAX_FAILED_ATTEMPTS, WINDOW_SECONDS);
  } catch {}
  if (!allowed) {
    res.status(429).json({ error: "Trop de tentatives incorrectes. Réessaie dans 15 minutes." });
    return false;
  }
  res.status(401).json({ error: "Mot de passe incorrect" });
  return false;
}

module.exports = { guardDashboard, safeEqual };
