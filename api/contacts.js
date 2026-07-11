// Espace « Contacts du projet » : réalisateur/trice, producteur, assistants...
const { kvGet, kvSet } = require("./_redis");
const { guardDashboard } = require("./_auth");

const KV_PREFIX = "orage";
const KEY = `${KV_PREFIX}:project_contacts`;

module.exports = async (req, res) => {
  if (!(await guardDashboard(req, res))) return;

  try {
    if (req.method === "GET") {
      const contacts = (await kvGet(KEY)) || [];
      res.status(200).json({ contacts });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const { action, contact, id } = req.body || {};
    let contacts = (await kvGet(KEY)) || [];

    if (action === "add") {
      if (!contact || !contact.name || !contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        res.status(400).json({ error: "Nom et email valide requis" });
        return;
      }
      contacts.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: String(contact.name).trim(),
        fonction: String(contact.fonction || "").trim(),
        email: String(contact.email).trim(),
        phone: String(contact.phone || "").trim()
      });
      await kvSet(KEY, contacts);
      res.status(200).json({ ok: true, contacts });
      return;
    }
    if (action === "update") {
      if (!id || !contact || !contact.name || !contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        res.status(400).json({ error: "id, nom et email valide requis" });
        return;
      }
      let found = false;
      contacts = contacts.map(c => {
        if (c.id !== id) return c;
        found = true;
        return { ...c, name: String(contact.name).trim(), fonction: String(contact.fonction || "").trim(), email: String(contact.email).trim(), phone: String(contact.phone || "").trim() };
      });
      if (!found) { res.status(404).json({ error: "Contact introuvable" }); return; }
      await kvSet(KEY, contacts);
      res.status(200).json({ ok: true, contacts });
      return;
    }
    if (action === "delete") {
      if (!id) { res.status(400).json({ error: "id requis" }); return; }
      contacts = contacts.filter(c => c.id !== id);
      await kvSet(KEY, contacts);
      res.status(200).json({ ok: true, contacts });
      return;
    }
    res.status(400).json({ error: "Action inconnue" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
