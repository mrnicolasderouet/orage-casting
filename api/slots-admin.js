// Gestion des créneaux d'essais — réservé au tableau de bord.
const { listSlots, createSlots, patchSlot, deleteSlot, getSlot, releaseSlot, tryBookSlot, MAX_CAPACITY } = require("./_slots");
const { guardDashboard } = require("./_auth");
const { updateSubmission } = require("./_redis");

module.exports = async (req, res) => {
  if (!(await guardDashboard(req, res))) return;

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

    const { action, slots, slotId, from, to, capacity } = req.body || {};

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
      // Anti-chevauchement : on ignore tout créneau qui chevauche un créneau existant
      // (ou un autre créneau de la même fournée).
      const existing = await listSlots();
      const toCreate = [];
      let skipped = 0;
      for (const s of slots) {
        const conflict =
          existing.some(e => slotsOverlap(s, e)) ||
          toCreate.some(e => slotsOverlap(s, e));
        if (conflict) skipped++;
        else toCreate.push(s);
      }
      const created = toCreate.length > 0 ? await createSlots(toCreate) : [];
      res.status(200).json({ ok: true, created: created.length, skipped });
      return;
    }

    if (action === "delete-free-range") {
      if (!from || !to || isNaN(new Date(from)) || isNaN(new Date(to))) {
        res.status(400).json({ error: "Plage de dates invalide" });
        return;
      }
      const all = await listSlots();
      const fromT = new Date(from).getTime();
      const toT = new Date(to).getTime();
      const targets = all.filter(s => {
        const t = new Date(s.start).getTime();
        return (s.bookedIds || []).length === 0 && t >= fromT && t < toT;
      });
      for (const t of targets) {
        await deleteSlot(t.id);
      }
      res.status(200).json({ ok: true, deleted: targets.length });
      return;
    }

    if (action === "unassign") {
      const { submissionId } = req.body || {};
      if (!slotId || !submissionId) {
        res.status(400).json({ error: "slotId et submissionId requis" });
        return;
      }
      await releaseSlot(slotId, submissionId);
      await updateSubmission(submissionId, { essaiDate: "" }).catch(() => {});
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "move") {
      const { fromSlotId, toSlotId, submissionId } = req.body || {};
      if (!toSlotId || !submissionId) {
        res.status(400).json({ error: "toSlotId et submissionId requis" });
        return;
      }
      const result = await tryBookSlot(toSlotId, submissionId);
      if (!result.ok) {
        res.status(409).json({ error: result.error });
        return;
      }
      if (fromSlotId) {
        await releaseSlot(fromSlotId, submissionId);
      }
      await updateSubmission(submissionId, { essaiMode: "presentiel", essaiDate: result.slot.start });
      res.status(200).json({ ok: true });
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
    const bookedCount = (slot.bookedIds || []).length;

    if (action === "block" || action === "unblock") {
      if (action === "block" && bookedCount > 0) {
        res.status(400).json({ error: "Impossible de bloquer un créneau réservé — libère-le d'abord." });
        return;
      }
      await patchSlot(slotId, { blocked: action === "block" });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "capacity") {
      const cap = Math.max(1, Math.min(MAX_CAPACITY, Number(capacity) || 1));
      if (cap < bookedCount) {
        res.status(400).json({ error: "Impossible : " + bookedCount + " candidat(s) déjà réservé(s) sur ce créneau." });
        return;
      }
      await patchSlot(slotId, { capacity: cap });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "assign") {
      const { submissionId } = req.body || {};
      if (!submissionId) {
        res.status(400).json({ error: "submissionId requis" });
        return;
      }
      const { getSubmission } = require("./_redis");
      const sub = await getSubmission(submissionId);
      if (!sub) {
        res.status(404).json({ error: "Candidature introuvable" });
        return;
      }
      const result = await tryBookSlot(slotId, submissionId);
      if (!result.ok) {
        res.status(409).json({ error: result.error });
        return;
      }
      await updateSubmission(submissionId, { essaiMode: "presentiel", essaiDate: result.slot.start });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "free") {
      const { released } = await releaseSlot(slotId, "");
      for (const subId of released) {
        await updateSubmission(subId, { essaiDate: "" }).catch(() => {});
      }
      res.status(200).json({ ok: true, released: released.length });
      return;
    }

    if (action === "delete") {
      for (const subId of (slot.bookedIds || [])) {
        await updateSubmission(subId, { essaiDate: "" }).catch(() => {});
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

function slotsOverlap(a, b) {
  const a1 = new Date(a.start).getTime();
  const a2 = a1 + (Number(a.durationMin) || 20) * 60000;
  const b1 = new Date(b.start).getTime();
  const b2 = b1 + (Number(b.durationMin) || 20) * 60000;
  return a1 < b2 && b1 < a2;
}
