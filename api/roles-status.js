const { listRoles } = require("./_redis");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const roles = await listRoles();
    res.status(200).json({ roles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
