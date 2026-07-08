const { getPhoto } = require("./_redis");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
    const id = req.query && req.query.id;
    if (!id) {
      res.status(400).json({ error: "id requis" });
      return;
    }
    const photo = await getPhoto(id);
    res.status(200).json({ photo: photo || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
