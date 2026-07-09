const { createRole } = require("./_redis");

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
    const { name, age, job, desc } = req.body || {};
    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nom du rôle requis" });
      return;
    }
    const id = await createRole({
      name: name.trim(),
      age: (age || "").trim(),
      job: (job || "").trim(),
      desc: (desc || "").trim(),
      closed: false,
      order: Date.now()
    });
    res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
