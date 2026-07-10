const { listSubmissions, getClientIp, checkRateLimit } = require("./_redis");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:knownagents:${ip}`, 60, 60 * 60);
    if (!allowed) {
      res.status(429).json({ error: "Trop de tentatives. Réessayez plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const all = await listSubmissions();
    const agents = new Set();
    const assistants = new Set();
    const agencies = new Set();
    all.forEach(s => {
      if (s.agentName && s.agentName.trim()) agents.add(s.agentName.trim());
      if (s.assistantName && s.assistantName.trim()) assistants.add(s.assistantName.trim());
      if (s.agency && s.agency.trim()) agencies.add(s.agency.trim());
    });
    res.status(200).json({
      agents: [...agents].sort((a, b) => a.localeCompare(b, "fr")),
      assistants: [...assistants].sort((a, b) => a.localeCompare(b, "fr")),
      agencies: [...agencies].sort((a, b) => a.localeCompare(b, "fr"))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
