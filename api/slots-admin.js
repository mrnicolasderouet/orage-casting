// Gestion des créneaux d'essais — réservé au tableau de bord.
const { listSlots, createSlots, patchSlot, deleteSlot, getSlot, releaseSlot } = require("./_slots");
const { updateSubmission } = require("./_redis");

module.exports = async (req, res) => {
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
    if (req.method === "GET") {
      const slots = await listSlots();
      res.status(200).json({ slots });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { action, slots, slotId } = req.body || {};

    if (action === "create-batch") {
      if (!Array.isArray(slots) || slots.length === 0) {
        res.status(400).json({ error: "Liste de créneaux requise" });
        return;
      }
      if (slots.length > 100) {
        res.status(400).json({ error: "Trop de créneaux d'un coup (100 max)" });
        return;
      }
      for (const s of slots) {
        if (!s.start || isNaN(new Date(s.start))) {
          res.status(400).json({ error: "Créneau invalide (date manquante)" });
          return;
        }
      }
      const created = await createSlots(slots);
      res.status(200).json({ ok: true, created: created.length });
      return;
    }

    if (!slotId) {
      res.status(400).json({ error: "slotId requis" });
      return;
    }
    const slot = await getSlot(slotId);
    if (!slot) {
      res.status(404).json({ error: "Créneau introuvable" });
      return;
    }

    if (action === "block" || action === "unblock") {
      if (action === "block" && slot.bookedBy) {
        res.status(400).json({ error: "Impossible de bloquer un créneau réservé — libère-le d'abord." });
        return;
      }
      await patchSlot(slotId, { blocked: action === "block" });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "free") {
      if (slot.bookedBy) {
        await releaseSlot(slotId, "");
        // On retire la convocation de la fiche candidat correspondante.
        await updateSubmission(slot.bookedBy, { essaiDate: "" }).catch(() => {});
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "delete") {
      if (slot.bookedBy) {
        await updateSubmission(slot.bookedBy, { essaiDate: "" }).catch(() => {});
      }
      await deleteSlot(slotId);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Action inconnue" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
