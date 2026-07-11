// Email de non-retenue à l'agence — courtois, valorisant, porte ouverte.
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

    // Remerciement adapté : essai passé, self-tape reçue, ou simple candidature.
    const hadEssai = sub.essaiMode === "presentiel" && sub.essaiDate && new Date(sub.essaiDate).getTime() < Date.now();
    const hadTape = !!sub.vimeo && !hadEssai;
    const merci = hadEssai
      ? `, ainsi que pour l'essai passé — nous avons été ravis de rencontrer ${escapeHtml(sub.name)}`
      : hadTape
        ? `, ainsi que pour la self-tape envoyée, que nous avons regardée avec attention`
        : "";

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
        subject: `${PROJECT_NAME} — Casting ${sub.role} : retour concernant ${sub.name}`,
        html: `
          <p>Bonjour,</p>
          <p>Nous vous remercions sincèrement d'avoir proposé <strong>${escapeHtml(sub.name)}</strong> pour le rôle de <strong>${escapeHtml(sub.role)}</strong> dans <strong>${PROJECT_NAME}</strong>${merci}.</p>
          <p>Après réflexion, notre choix s'est finalement porté sur un autre profil pour ce rôle. Cette décision ne remet nullement en cause les qualités de ${escapeHtml(sub.name)} — les arbitrages d'un casting tiennent souvent à des équilibres de distribution bien plus qu'au talent de chacun.</p>
          <p>Nous conservons précieusement sa candidature, <strong>en espérant à très bientôt sur un nouveau projet</strong>.</p>
          <p>Bien à vous,<br>Nicolas Derouet Casting<br><a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
        `
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }

    await updateSubmission(id, { declineSentAt: new Date().toISOString() });
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
