// Répertoire d'agents : agence, agent, email, téléphone.
const { kvGet, kvSet } = require("./_redis");
const { guardDashboard } = require("./_auth");

const KV_PREFIX = "orage";
const KEY = `${KV_PREFIX}:agents_directory`;

const norm = s => String(s || "").trim();
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function cleanAssistant(x) {
  const out = { name: norm(x && x.name), email: norm(x && x.email), phone: norm(x && x.phone) };
  if (out.email && !emailOk(out.email)) out.email = "";
  return out;
}

function cleanAgent(a) {
  let assistants = Array.isArray(a.assistants) ? a.assistants.map(cleanAssistant) : [];
  // Rétrocompatibilité : anciens champs assistant à plat
  if (assistants.length === 0 && (a.assistantName || a.assistantEmail || a.assistantPhone)) {
    assistants = [cleanAssistant({ name: a.assistantName, email: a.assistantEmail, phone: a.assistantPhone })];
  }
  assistants = assistants.filter(x => x.name || x.email || x.phone).slice(0, 10);
  return {
    agency: norm(a.agency), name: norm(a.name), email: norm(a.email), phone: norm(a.phone),
    assistants,
    notes: norm(a.notes)
  };
}

// Migration à la lecture : les fiches enregistrées avec les anciens champs
// assistantName/Email/Phone passent au format "assistants: []".
function liftLegacy(a) {
  if (Array.isArray(a.assistants)) return a;
  const migrated = { ...a, assistants: [] };
  if (a.assistantName || a.assistantEmail || a.assistantPhone) {
    migrated.assistants = [cleanAssistant({ name: a.assistantName, email: a.assistantEmail, phone: a.assistantPhone })];
  }
  delete migrated.assistantName; delete migrated.assistantEmail; delete migrated.assistantPhone;
  return migrated;
}

module.exports = async (req, res) => {
  if (!(await guardDashboard(req, res))) return;

  try {
    if (req.method === "GET") {
      const agents = ((await kvGet(KEY)) || []).map(liftLegacy);
      res.status(200).json({ agents });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const { action, agent, agents: incoming, id } = req.body || {};
    let agents = ((await kvGet(KEY)) || []).map(liftLegacy);
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    if (action === "add") {
      if (!agent || !norm(agent.agency) || !emailOk(norm(agent.email))) {
        res.status(400).json({ error: "Agence et email valide requis" });
        return;
      }
      agents.push({ id: newId(), ...cleanAgent(agent) });
      await kvSet(KEY, agents);
      res.status(200).json({ ok: true, agents });
      return;
    }

    if (action === "update") {
      if (!id || !agent || !norm(agent.agency) || !emailOk(norm(agent.email))) {
        res.status(400).json({ error: "id, agence et email valide requis" });
        return;
      }
      let found = false;
      agents = agents.map(a => {
        if (a.id !== id) return a;
        found = true;
        return { ...a, ...cleanAgent(agent) };
      });
      if (!found) { res.status(404).json({ error: "Agent introuvable" }); return; }
      await kvSet(KEY, agents);
      res.status(200).json({ ok: true, agents });
      return;
    }

    if (action === "delete") {
      if (!id) { res.status(400).json({ error: "id requis" }); return; }
      agents = agents.filter(a => a.id !== id);
      await kvSet(KEY, agents);
      res.status(200).json({ ok: true, agents });
      return;
    }

    if (action === "import") {
      // Import en masse depuis les candidatures : dédoublonné par email (puis agence+agent).
      if (!Array.isArray(incoming)) {
        res.status(400).json({ error: "Liste d'agents requise" });
        return;
      }
      const seen = new Set(agents.map(a => a.email.toLowerCase()));
      const seenCombo = new Set(agents.map(a => (a.agency + "|" + a.name).toLowerCase()));
      let added = 0;
      for (const raw of incoming.slice(0, 500)) {
        const a = cleanAgent(raw);
        if (!a.agency || !emailOk(a.email)) continue;
        const ek = a.email.toLowerCase();
        const ck = (a.agency + "|" + a.name).toLowerCase();
        if (seen.has(ek) || seenCombo.has(ck)) continue;
        seen.add(ek); seenCombo.add(ck);
        agents.push({ id: newId(), ...a });
        added++;
      }
      await kvSet(KEY, agents);
      res.status(200).json({ ok: true, added, agents });
      return;
    }

    res.status(400).json({ error: "Action inconnue" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
