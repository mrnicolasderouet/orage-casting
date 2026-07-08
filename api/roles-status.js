const { getClosedRoles } = require("./_redis");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const closedRoles = await getClosedRoles();
    res.status(200).json({ closedRoles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
