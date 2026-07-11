// Étape 1 du présentiel : proposer un jour + créneau (matin/après-midi) AVANT la convocation.
// Pas de scène jointe — on attend le retour de l'agent pour confirmer jour et heure.
const { getSubmission, updateSubmission } = require("./_redis");
const { guardDashboard } = require("./_auth");

const PROJECT_NAME = "ORAGE";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";
const WINDOW_LABELS = { matin: "en matinée", apresmidi: "dans l'après-midi", journee: "dans la journée" };

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
    const { id, day, window: win } = req.body || {};
    if (!id || !day || isNaN(new Date(day))) {
      res.status(400).json({ error: "id et jour proposé requis" });
      return;
    }
    const windowLabel = WINDOW_LABELS[win] || "dans la journée";
    const sub = await getSubmission(id);
    if (!sub) {
      res.status(404).json({ error: "Candidature introuvable" });
      return;
    }
    if (!sub.email) {
      res.status(400).json({ error: "Aucun email enregistré pour cette candidature" });
      return;
    }

    const isCallback = !!sub.callback;
    const dayStr = new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

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
        subject: `${PROJECT_NAME} — ${isCallback ? "Call back" : "Essai"} : disponibilité de ${sub.name} (${sub.role}) — ${dayStr}`,
        html: `
          <p>Bonjour,</p>
          <p>Dans le cadre du casting de <strong>${PROJECT_NAME}</strong>, nous souhaitons ${isCallback ? "revoir" : "rencontrer"} <strong>${escapeHtml(sub.name)}</strong> en ${isCallback ? "call back" : "essai"} pour le rôle de <strong>${escapeHtml(sub.role)}</strong>.</p>
          <p>Nous vous proposons le <strong>${escapeHtml(dayStr)}</strong>, plutôt <strong>${windowLabel}</strong>.</p>
          <p>Merci de nous confirmer la disponibilité du comédien — ou de nous indiquer vos contraintes horaires (par exemple : uniquement après 15h). Nous vous enverrons ensuite la convocation précise avec l'horaire, l'adresse et la scène.</p>
          ${sub.conditions ? `<p style="background:#fdf6e3;border-left:3px solid #b8952a;padding:10px 14px;"><strong>À noter :</strong> ${escapeHtml(sub.conditions)}</p>` : ""}
          <p style="color:#555;">Si le comédien n'est pas disponible ou pas à Paris à cette période, une self-tape pourra être envisagée à la place — dites-le-nous simplement.</p>
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
      proposalDay: day,
      proposalWindow: win || "journee",
      proposalSentAt: new Date().toISOString()
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
