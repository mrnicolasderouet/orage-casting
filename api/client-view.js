const { listSubmissions } = require("./_redis");

function normalizeStatus(status) {
  if (status === "confirme") return "confirme";
  if (["oui", "shortlist", "validated"].includes(status)) return "oui";
  if (["non", "rejected"].includes(status)) return "non";
  return "peutetre";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const all = await listSubmissions();

    const selected = all
      .filter(s => !s.archived && normalizeStatus(s.status) === "oui")
      .map(s => ({
        id: s.id,
        role: s.role,
        name: s.name,
        agency: s.agency,
        cv: s.cv,
        showreel: s.showreel,
        vimeo: s.vimeo,
        comments: s.comments || []
      }))
      .sort((a, b) => a.role.localeCompare(b.role));

    const confirmed = all
      .filter(s => !s.archived && normalizeStatus(s.status) === "confirme")
      .map(s => ({ id: s.id, role: s.role, name: s.name }))
      .sort((a, b) => a.role.localeCompare(b.role));

    res.status(200).json({ submissions: selected, confirmed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
