const { getSubmission, updateSubmission } = require("./_redis");
const { guardDashboard } = require("./_auth");

const PROJECT_NAME = "ORAGE";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!(await guardDashboard(req, res))) return;
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
    if (!sub.sceneSentAt) {
      res.status(400).json({ error: "La scène n'a pas encore été envoyée pour cette candidature" });
      return;
    }
    if (sub.vimeo) {
      res.status(400).json({ error: "Une self-tape est déjà enregistrée pour cette candidature" });
      return;
    }

    const sentDate = new Date(sub.sceneSentAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

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
        bcc: [CASTING_CONTACT],
        subject: `${PROJECT_NAME} — Relance self-tape : ${sub.name} (${sub.role})`,
        html: `
          <p>Bonjour,</p>
          <p>Sauf erreur de notre part, nous n'avons pas encore reçu la self-tape de <strong>${escapeHtml(sub.name)}</strong> pour le rôle de <strong>${escapeHtml(sub.role)}</strong> dans <strong>${PROJECT_NAME}</strong>.</p>
          <p>La scène d'essai et les consignes vous ont été envoyées le <strong>${sentDate}</strong>.</p>
          <p>Merci de nous faire parvenir la vidéo dès que possible — ou de nous indiquer si le comédien n'est finalement pas disponible, afin que nous puissions ajuster notre sélection.</p>
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
      reminderSentAt: new Date().toISOString(),
      reminderCount: (Number(sub.reminderCount) || 0) + 1
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
