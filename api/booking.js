// Réservation de créneau d'essai — page publique, accès par lien personnel (id de candidature).
const { getSubmission, updateSubmission, getClientIp, checkRateLimit } = require("./_redis");
const { listSlots, tryBookSlot, releaseSlot, findSlotBySubmission } = require("./_slots");

const PROJECT_NAME = "ORAGE";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";
const MODIFY_DEADLINE_HOURS = Number(process.env.BOOKING_DEADLINE_HOURS || 24);
const MAX_ACTIONS_PER_WINDOW = 30;
const WINDOW_SECONDS = 60 * 60;

module.exports = async (req, res) => {
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:booking:${ip}`, MAX_ACTIONS_PER_WINDOW, WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de requêtes. Merci de réessayer plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    if (req.method === "GET") {
      const id = (req.query && req.query.id) || "";
      const sub = await getSubmission(id);
      if (!sub || sub.archived) {
        res.status(404).json({ error: "Lien de réservation invalide" });
        return;
      }
      const slots = await listSlots();
      const now = Date.now();
      const mySlot = slots.find(s => (s.bookedIds || []).includes(id)) || null;
      const available = slots.filter(s => !s.blocked && (s.bookedIds || []).length < (s.capacity || 1) && new Date(s.start).getTime() > now)
        .map(s => ({ id: s.id, start: s.start, durationMin: s.durationMin, location: s.location, capacity: s.capacity || 1, taken: (s.bookedIds || []).length }));
      res.status(200).json({
        project: PROJECT_NAME,
        candidate: { name: sub.name, role: sub.role },
        mySlot: mySlot ? { id: mySlot.id, start: mySlot.start, durationMin: mySlot.durationMin, location: mySlot.location } : null,
        available,
        deadlineHours: MODIFY_DEADLINE_HOURS
      });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { id, action, slotId } = req.body || {};
    if (!id || !action) {
      res.status(400).json({ error: "Paramètres manquants" });
      return;
    }
    const sub = await getSubmission(id);
    if (!sub || sub.archived) {
      res.status(404).json({ error: "Lien de réservation invalide" });
      return;
    }

    const existing = await findSlotBySubmission(id);

    const withinDeadline = (slot) =>
      new Date(slot.start).getTime() - Date.now() < MODIFY_DEADLINE_HOURS * 3600 * 1000;

    if (action === "cancel") {
      if (!existing) {
        res.status(400).json({ error: "Aucun créneau réservé à annuler" });
        return;
      }
      if (withinDeadline(existing)) {
        res.status(400).json({ error: `Annulation impossible à moins de ${MODIFY_DEADLINE_HOURS}h de l'essai. Merci de contacter ${CASTING_CONTACT}.` });
        return;
      }
      await releaseSlot(existing.id, id);
      await updateSubmission(id, { essaiDate: "" });
      await notify(sub, existing, "annulation").catch(err => console.error("Email annulation", err));
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "book") {
      if (!slotId) {
        res.status(400).json({ error: "slotId requis" });
        return;
      }
      if (existing && existing.id === slotId) {
        res.status(400).json({ error: "Ce créneau est déjà le vôtre" });
        return;
      }
      // Déplacement : l'ancien créneau doit être hors délai de modification.
      if (existing && withinDeadline(existing)) {
        res.status(400).json({ error: `Modification impossible à moins de ${MODIFY_DEADLINE_HOURS}h de l'essai. Merci de contacter ${CASTING_CONTACT}.` });
        return;
      }
      const result = await tryBookSlot(slotId, id);
      if (!result.ok) {
        res.status(409).json({ error: result.error });
        return;
      }
      if (existing) {
        await releaseSlot(existing.id, id);
      }
      await updateSubmission(id, { essaiMode: "presentiel", essaiDate: result.slot.start });
      await notify(sub, result.slot, existing ? "deplacement" : "reservation").catch(err => console.error("Email réservation", err));
      res.status(200).json({ ok: true, slot: { id: result.slot.id, start: result.slot.start, durationMin: result.slot.durationMin, location: result.slot.location } });
      return;
    }

    res.status(400).json({ error: "Action inconnue" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};

function formatSlot(slot) {
  const d = new Date(slot.start);
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  return `${date} à ${time}` + (slot.location ? ` — ${slot.location}` : "");
}

async function notify(sub, slot, kind) {
  if (!process.env.RESEND_API_KEY) return;
  const labels = {
    reservation: { subject: "Essai confirmé", intro: "Le créneau d'essai suivant est confirmé" },
    deplacement: { subject: "Essai déplacé", intro: "Le créneau d'essai a été déplacé au rendez-vous suivant" },
    annulation: { subject: "Essai annulé", intro: "Le créneau d'essai suivant a été annulé" }
  };
  const l = labels[kind];
  const when = formatSlot(slot);
  const send = (to, subject, html) => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || `${PROJECT_NAME} Casting <onboarding@resend.dev>`,
      to: [to],
      reply_to: CASTING_CONTACT,
      subject,
      html
    })
  });

  // Confirmation à l'agence / au comédien
  if (sub.email) {
    await send(
      sub.email,
      `${PROJECT_NAME} — ${l.subject} : ${sub.name} (${sub.role})`,
      `
        <p>Bonjour,</p>
        <p>${l.intro} pour <strong>${escapeHtml(sub.name)}</strong> (rôle de <strong>${escapeHtml(sub.role)}</strong>, ${PROJECT_NAME}) :</p>
        <p style="font-size:16px;"><strong>${escapeHtml(when)}</strong></p>
        ${kind !== "annulation" ? `<p>En cas d'empêchement, vous pouvez déplacer ou annuler ce rendez-vous via votre lien de réservation jusqu'à ${MODIFY_DEADLINE_HOURS}h avant l'essai. Passé ce délai, merci de nous contacter directement.</p>` : `<p>Vous pouvez réserver un nouveau créneau à tout moment via votre lien de réservation.</p>`}
        <p>Pour toute question : <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
        <p>Bien à vous,<br>Nicolas Derouet Casting</p>
      `
    );
  }

  // Notification au bureau de casting
  await send(
    CASTING_CONTACT,
    `${PROJECT_NAME} — ${l.subject} : ${sub.name} (${sub.role})`,
    `
      <p><strong>${escapeHtml(sub.name)}</strong> (${escapeHtml(sub.role)}${sub.agency ? " — " + escapeHtml(sub.agency) : ""})</p>
      <p>${l.intro} :</p>
      <p style="font-size:16px;"><strong>${escapeHtml(when)}</strong></p>
    `
  );
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
