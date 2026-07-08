const { getSubmission, getPhoto } = require("./_redis");

function normalizeStatus(status) {
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
    if (!sub || sub.archived || normalizeStatus(sub.status) !== "oui") {
      res.status(404).json({ error: "Introuvable" });
      return;
    }
    const photo = await getPhoto(id);
    res.status(200).json({ photo: photo || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
