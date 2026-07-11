// Envoi de la scène + consignes SELF-TAPE (distanciel) — délai 48h.
// Le PDF du rôle est retrouvé automatiquement dans /scenes (préfixe du nom du rôle, accents ignorés).
const { getSubmission, updateSubmission } = require("./_redis");
const { guardDashboard } = require("./_auth");
const fs = require("fs");
const path = require("path");

const PROJECT_NAME = "ORAGE";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";
const DEADLINE_HOURS = 48;

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
    const scenePath = findSceneFile(sub.role);
    if (!scenePath) {
      res.status(404).json({ error: `Aucun PDF de scène trouvé pour "${sub.role}" dans le dossier scenes/. Dépose-le sur GitHub (nom = début du nom du rôle, ex. VANESSA.pdf) puis redéploie.` });
      return;
    }
    const pdfBase64 = fs.readFileSync(scenePath).toString("base64");

    const deadline = new Date(Date.now() + DEADLINE_HOURS * 3600 * 1000);
    const deadlineStr = deadline.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }) +
      " à " + deadline.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    const fileBase = `NOM_${PROJECT_NAME}_${(sub.role || "").split(" ")[0]}`;

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
        subject: `${PROJECT_NAME} — Scène d'essai et consignes self-tape (${sub.role}) — retour sous ${DEADLINE_HOURS}h`,
        html: `
          <p>Bonjour,</p>
          <p>Merci pour la candidature de <strong>${escapeHtml(sub.name)}</strong> pour le rôle de <strong>${escapeHtml(sub.role)}</strong> dans <strong>${PROJECT_NAME}</strong>.</p>
          <p>Vous trouverez en pièce jointe la scène d'essai. Merci de nous faire parvenir la self-tape <strong>sous ${DEADLINE_HOURS}h</strong>, soit avant le <strong>${escapeHtml(deadlineStr)}</strong>.</p>
          ${sub.conditions ? `<p style="background:#fdf6e3;border-left:3px solid #b8952a;padding:10px 14px;"><strong>Conditions particulières :</strong> ${escapeHtml(sub.conditions)}</p>` : ""}
          <p style="margin-bottom:6px;"><strong>Consignes techniques :</strong></p>
          <ul style="margin-top:0;line-height:1.7;">
            <li>Se filmer à l'horizontale, sur fond neutre.</li>
            <li>De préférence en lumière naturelle (pas de ring light).</li>
            <li>Avec un ou une partenaire, dans un endroit calme pour éviter les bruits parasites.</li>
            <li>Une seule prise par scène suffit.</li>
            <li>Nommer les fichiers comme suit : <strong>${escapeHtml(fileBase)}_SCENE1</strong>, etc.</li>
            <li>Envoyer également une vidéo de présentation : présentez-vous rapidement, donnez votre taille (pas votre âge), montrez vos profils et filmez-vous en pied.</li>
            <li>Nommer ce fichier : <strong>NOM_PRESENTATION</strong></li>
          </ul>
          <p>Envoi de préférence via <a href="https://www.swisstransfer.com">Swiss Transfer</a> à <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a>.</p>
          <p>Bien à vous,<br>Nicolas Derouet Casting</p>
        `,
        attachments: [
          { filename: path.basename(scenePath), content: pdfBase64 }
        ]
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }

    await updateSubmission(id, {
      sceneSentAt: new Date().toISOString(),
      selftapeDeadline: deadline.toISOString()
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};

function findSceneFile(role) {
  try {
    const dir = path.join(process.cwd(), "scenes");
    if (!fs.existsSync(dir)) return null;
    const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
    const nrole = norm(role);
    const candidates = fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith(".pdf"))
      .filter(f => nrole.startsWith(norm(f.replace(/\.pdf$/i, ""))))
      .sort((a, b) => b.length - a.length);
    return candidates.length > 0 ? path.join(dir, candidates[0]) : null;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
