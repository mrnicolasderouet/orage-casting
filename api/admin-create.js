const { createSubmission } = require("./_redis");

const MAX_PHOTO_BASE64_LENGTH = 1.5 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const password = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD) {
    res.status(500).json({ error: "DASHBOARD_PASSWORD non configuré côté serveur" });
    return;
  }
  if (password !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return;
  }
  try {
    const { role, name, email, email2, agency, agentName, assistantName, cv, showreel, availability, note, photo } = req.body || {};
    if (!role || !name) {
      res.status(400).json({ error: "Rôle et nom du comédien requis" });
      return;
    }
    if (photo && (typeof photo !== "string" || photo.length > MAX_PHOTO_BASE64_LENGTH)) {
      res.status(400).json({ error: "Photo trop volumineuse" });
      return;
    }
    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      name,
      email: email || "",
      email2: email2 || "",
      agency: agency || "",
      agentName: agentName || "",
      assistantName: assistantName || "",
      cv: cv || "",
      showreel: showreel || "",
      availability: availability || "",
      note: note || "",
      photo: photo || "",
      status: "peutetre",
      addedByAdmin: true,
      submittedAt: new Date().toISOString()
    };
    await createSubmission(submission);
    res.status(200).json({ ok: true, id: submission.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
