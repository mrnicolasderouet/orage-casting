// Envoi de l'invitation à réserver un créneau d'essai — réservé au tableau de bord.
const { getSubmission, updateSubmission } = require("./_redis");

const PROJECT_NAME = "ORAGE";
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
    const { id } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "id requis" });
      return;
    }
    const sub = await getSubmission(id);
    if (!sub) {
      res.status(404).json({ error: "Candidature introuvable" });
      return;
    }
    if (!sub.email) {
      res.status(400).json({ error: "Aucun email enregistré pour cette candidature" });
      return;
    }

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const bookingUrl = `https://${host}/booking.html?id=${encodeURIComponent(id)}`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || `${PROJECT_NAME} Casting <onboarding@resend.dev>`,
        to: [sub.email],
        reply_to: CASTING_CONTACT,
        subject: `${PROJECT_NAME} — Réservez votre créneau d'essai : ${sub.name} (${sub.role})`,
        html: `
          <p>Bonjour,</p>
          <p>Dans le cadre du casting de <strong>${PROJECT_NAME}</strong>, nous souhaitons rencontrer <strong>${escapeHtml(sub.name)}</strong> en essai pour le rôle de <strong>${escapeHtml(sub.role)}</strong>.</p>
          <p>Vous pouvez choisir directement le créneau qui vous convient via ce lien personnel :</p>
          <p style="margin:18px 0;"><a href="${bookingUrl}" style="background:#1a6b3c;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">Choisir un créneau d'essai</a></p>
          <p style="font-size:12px;color:#666;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${bookingUrl}</p>
          <p>Ce lien vous permet également de déplacer ou d'annuler le rendez-vous en cas d'empêchement.</p>
          <p>Pour toute question : <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
          <p>Bien à vous,<br>Nicolas Derouet Casting</p>
        `
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }

    await updateSubmission(id, {
      essaiMode: "presentiel",
      bookingInviteSentAt: new Date().toISOString()
    });

    res.status(200).json({ ok: true });
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
