const { getClientIp, checkRateLimit } = require("./_redis");

const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.AGENT_PASSWORD) {
    res.status(500).json({ error: "AGENT_PASSWORD non configuré côté serveur" });
    return;
  }
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:agentpw:${ip}`, MAX_ATTEMPTS, WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }
  const { password } = req.body || {};
  if (!password || password !== process.env.AGENT_PASSWORD) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return;
  }
  res.status(200).json({ valid: true });
};
