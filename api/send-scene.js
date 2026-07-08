const { getSubmission, updateSubmission } = require("./_redis");
const fs = require("fs");
const path = require("path");

const ROLE_FILES = {
  "ALEXANDRE DE CHASTENET": "ALEXANDRE.pdf",
  "AUGUSTIN DE CHASTENET": "AUGUSTIN.pdf",
  "BIXENTE APARRA": "BIXENTE.pdf",
  "LÉANDRO APARRA": "LEANDRO.pdf",
  "LORÉA APARRA": "LOREA.pdf",
  "VANESSA": "VANESSA.pdf",
  "JO": "JO.pdf",
  "STÉPHANIE CRÉMIEUX": "STEPHANIE.pdf",
  "ROMÉO GARANO": "ROMEO.pdf",
  "MIKEL BASAGOITI": "MIKEL.pdf",
  "RÉMI": "REMI.pdf",
  "ESTEBAN AUDIBERT": "ESTEBAN.pdf",
  "MATHIS": "MATHIS.pdf",
  "ELIOTT BOVAL": "ELIOTT.pdf"
};

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
    const filename = ROLE_FILES[sub.role];
    if (!filename) {
      res.status(400).json({ error: `Rôle inconnu : ${sub.role}` });
      return;
    }
    const filePath = path.join(process.cwd(), "scenes", filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Fichier manquant : scenes/${filename}. Dépose-le sur GitHub puis redéploie.` });
      return;
    }
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfBase64 = pdfBuffer.toString("base64");

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "ORAGE Casting <onboarding@resend.dev>",
        to: [sub.email],
        subject: `ORAGE — Scène d'essai et consignes selftape (${sub.role})`,
        html: `
          <p>Bonjour,</p>
          <p>Merci pour la candidature de <strong>${escapeHtml(sub.name)}</strong> pour le rôle de <strong>${escapeHtml(sub.role)}</strong> dans <strong>ORAGE</strong>.</p>
          <p>Vous trouverez en pièce jointe la scène d'essai ainsi que les consignes de selftape.</p>
          <p>Merci de nous faire parvenir la vidéo selon les modalités indiquées dans le document.</p>
          <p>Bien à vous,<br>Nicolas Derouet Casting</p>
        `,
        attachments: [
          { filename, content: pdfBase64 }
        ]
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }

    await updateSubmission(id, { sceneSentAt: new Date().toISOString() });

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
