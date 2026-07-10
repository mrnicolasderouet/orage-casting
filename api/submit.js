const { createSubmission, listRoles, getClientIp, checkRateLimit } = require("./_redis");

const MAX_PHOTO_BASE64_LENGTH = 1.5 * 1024 * 1024;
const MAX_SUBMISSIONS_PER_WINDOW = 20;
const SUBMIT_WINDOW_SECONDS = 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:submit:${ip}`, MAX_SUBMISSIONS_PER_WINDOW, SUBMIT_WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de candidatures envoyées récemment. Merci de réessayer plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const { role, name, email, agency, agentName, assistantName, cv, showreel, availability, note, photo, agentPassword } = req.body || {};
    if (!role || !name) {
      res.status(400).json({ error: "Rôle et nom du comédien requis" });
      return;
    }
    if (process.env.AGENT_PASSWORD && agentPassword !== process.env.AGENT_PASSWORD) {
      res.status(401).json({ error: "Accès non autorisé" });
      return;
    }
    try {
      const roles = await listRoles();
      const matchingRole = roles.find(r => r.name === role);
      if (matchingRole && ["caste", "ferme"].includes(matchingRole.processStatus)) {
        res.status(403).json({ error: "Ce rôle n'est plus en casting." });
        return;
      }
    } catch (err) {
      console.error("Closed-role check failed", err);
    }
    if (photo && (typeof photo !== "string" || photo.length > MAX_PHOTO_BASE64_LENGTH)) {
      res.status(400).json({ error: "Photo trop volumineuse" });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Email de contact valide requis" });
      return;
    }
    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      name,
      email,
      agency: agency || "",
      agentName: agentName || "",
      assistantName: assistantName || "",
      cv: cv || "",
      showreel: showreel || "",
      availability: availability || "",
      note: note || "",
      photo: photo || "",
      status: "peutetre",
      submittedAt: new Date().toISOString()
    };
    await createSubmission(submission);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
