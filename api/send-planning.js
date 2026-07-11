// Envoi du planning des essais par email aux contacts du projet (réalisateur, producteur...).
const { listSubmissions, kvGet } = require("./_redis");
const { listSlots } = require("./_slots");

const PROJECT_NAME = "ORAGE";
const KV_PREFIX = "orage";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";

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
  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "RESEND_API_KEY non configuré côté serveur" });
    return;
  }

  try {
    const { contactIds, note, pdfBase64 } = req.body || {};
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: "Choisis au moins un destinataire" });
      return;
    }
    const contacts = (await kvGet(`${KV_PREFIX}:project_contacts`)) || [];
    const recipients = contacts.filter(c => contactIds.includes(c.id));
    if (recipients.length === 0) {
      res.status(400).json({ error: "Destinataires introuvables" });
      return;
    }

    const subs = (await listSubmissions()).filter(s => !s.archived && s.essaiMode === "presentiel" && s.essaiDate);
    if (subs.length === 0) {
      res.status(400).json({ error: "Aucun essai planifié à envoyer" });
      return;
    }
    subs.sort((a, b) => new Date(a.essaiDate) - new Date(b.essaiDate));

    // Lieu par candidat via le créneau réservé/assigné
    let locBySub = {};
    try {
      const slots = await listSlots();
      slots.forEach(sl => (sl.bookedIds || []).forEach(bid => { if (sl.location) locBySub[bid] = sl.location; }));
    } catch {}

    const fmtDay = iso => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    const fmtTime = iso => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    const groups = {};
    const order = [];
    subs.forEach(s => {
      const key = fmtDay(s.essaiDate);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(s);
    });

    let planningHtml = "";
    order.forEach(day => {
      planningHtml += `<h3 style="font-size:15px;margin:20px 0 8px;text-transform:capitalize;">${escapeHtml(day)}</h3>`;
      planningHtml += `<table style="border-collapse:collapse;width:100%;font-size:13px;">`;
      groups[day].forEach(s => {
        planningHtml += `<tr>
          <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">${fmtTime(s.essaiDate)}</td>
          <td style="padding:6px 12px 6px 0;vertical-align:top;"><strong>${escapeHtml(s.name)}</strong>${s.callback ? ' <span style="color:#c0483a;font-size:11px;font-weight:bold;">CALL BACK</span>' : ""}</td>
          <td style="padding:6px 12px 6px 0;color:#555;vertical-align:top;">${escapeHtml(s.role)}</td>
          <td style="padding:6px 12px 6px 0;color:#777;font-size:12px;vertical-align:top;">${escapeHtml(s.agency || "")}</td>
          <td style="padding:6px 0;color:#777;font-size:12px;vertical-align:top;">${locBySub[s.id] ? "📍 " + escapeHtml(locBySub[s.id]) : ""}</td>
        </tr>`;
      });
      planningHtml += `</table>`;
    });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || `${PROJECT_NAME} Casting <onboarding@resend.dev>`,
        to: recipients.map(r => r.email),
        reply_to: CASTING_CONTACT,
        subject: `${PROJECT_NAME} — Planning des essais (${subs.length} candidat${subs.length > 1 ? "s" : ""})`,
        attachments: pdfBase64 ? [{ filename: `${PROJECT_NAME}_Planning_essais.pdf`, content: pdfBase64 }] : [],
        html: `
          <p>Bonjour,</p>
          ${note ? `<p>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : ""}
          <p>Voici le planning des essais pour <strong>${PROJECT_NAME}</strong> :</p>
          ${planningHtml}
          ${pdfBase64 ? `<p style="margin-top:16px;color:#555;">📎 Le planning détaillé <strong>avec photos</strong> est joint en PDF.</p>` : ""}
          <p style="margin-top:24px;">Pour toute question : <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
          <p>Bien à vous,<br>Nicolas Derouet Casting</p>
        `
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }
    res.status(200).json({ ok: true, sentTo: recipients.length, candidates: subs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
