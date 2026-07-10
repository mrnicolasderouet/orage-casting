const { getSubmission } = require("./_redis");

function normalizeStatus(status) {
  if (status === "confirme") return "confirme";
  if (["oui", "shortlist", "validated"].includes(status)) return "oui";
  if (["non", "rejected"].includes(status)) return "non";
  return "peutetre";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const id = req.query && req.query.id;
    if (!id) {
      res.status(400).json({ error: "id requis" });
      return;
    }
    const sub = await getSubmission(id);
    const status = sub ? normalizeStatus(sub.status) : null;
    if (!sub || sub.archived || (status !== "oui" && status !== "confirme")) {
      res.status(404).json({ error: "Introuvable" });
      return;
    }
    res.status(200).json({
      id: sub.id,
      name: sub.name,
      role: sub.role,
      agency: sub.agency || "",
      cv: sub.cv || "",
      showreel: sub.showreel || "",
      vimeo: sub.vimeo || "",
      status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
