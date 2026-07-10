const { updateSubmission } = require("./_redis");

const ALLOWED_FIELDS = ["role", "name", "email", "email2", "agency", "agentName", "assistantName", "cv", "showreel", "availability", "note"];

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
    const { id, patch } = req.body || {};
    if (!id || !patch || typeof patch !== "object") {
      res.status(400).json({ error: "id et patch requis" });
      return;
    }
    const cleanPatch = {};
    for (const key of Object.keys(patch)) {
      if (ALLOWED_FIELDS.includes(key)) {
        cleanPatch[key] = patch[key];
      }
    }
    if (Object.keys(cleanPatch).length === 0) {
      res.status(400).json({ error: "Aucun champ valide à modifier" });
      return;
    }
    const ok = await updateSubmission(id, cleanPatch);
    if (!ok) {
      res.status(404).json({ error: "Candidature introuvable" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
