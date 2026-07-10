const { updateSubmission } = require("./_redis");

const ALLOWED_FIELDS = ["status", "vimeo", "photo", "archived", "role", "name", "email", "email2", "agency", "cv", "showreel", "availability", "note", "displayOrder", "displayGroup", "declineReason", "internalStatus"];
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
    const { id, status, field, value } = req.body || {};
    const targetField = field || "status";
    const targetValue = value !== undefined ? value : status;

    if (!id || targetValue === undefined || !ALLOWED_FIELDS.includes(targetField)) {
      res.status(400).json({ error: "id et une valeur valide sont requis" });
      return;
    }
    if (targetField === "photo" && typeof targetValue === "string" && targetValue.length > MAX_PHOTO_BASE64_LENGTH) {
      res.status(400).json({ error: "Photo trop volumineuse" });
      return;
    }
    const ok = await updateSubmission(id, { [targetField]: targetValue });
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
