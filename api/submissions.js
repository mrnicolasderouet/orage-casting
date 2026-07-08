const { listSubmissions, getClientIp, checkRateLimit, resetRateLimit } = require("./_redis");

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const password = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD) {
    res.status(500).json({ error: "DASHBOARD_PASSWORD non configuré côté serveur" });
    return;
  }

  const ip = getClientIp(req);
  const rateLimitKey = `ratelimit:login:${ip}`;

  try {
    const allowed = await checkRateLimit(rateLimitKey, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  if (password !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return;
  }

  try {
    await resetRateLimit(rateLimitKey);
  } catch (err) {
    console.error("Rate limit reset failed", err);
  }

  try {
    const submissions = await listSubmissions();
    res.status(200).json({ submissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
