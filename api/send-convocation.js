// Envoi de la convocation à un essai/call back présentiel — réservé au tableau de bord.
// Joint automatiquement la scène + consignes (PDF du dossier /scenes correspondant au rôle).
const { getSubmission, updateSubmission } = require("./_redis");
const { guardDashboard } = require("./_auth");
const { findSlotBySubmission } = require("./_slots");
const fs = require("fs");
const path = require("path");

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
    const { id, location } = req.body || {};
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
    if (!sub.essaiDate) {
      res.status(400).json({ error: "Fixe d'abord la date et l'heure de l'essai (type d'essai présentiel + date, ou assignation à un créneau)." });
      return;
    }

    // Lieu : priorité au lieu fourni, sinon celui du créneau réservé/assigné.
    let lieu = (location || "").trim();
    if (!lieu) {
      try {
        const slot = await findSlotBySubmission(id);
        if (slot && slot.location) lieu = slot.location;
      } catch {}
    }

    const isCallback = !!sub.callback;
    const kindLabel = isCallback ? "call back" : "essai";
    const d = new Date(sub.essaiDate);
    const dateStr = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    const timeStr = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    const shortDate = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

    // Scène + consignes : on cherche le PDF du rôle dans /scenes (même convention que l'envoi de scène).
    const scenePath = findSceneFile(sub.role);
    const attachments = [];
    if (scenePath) {
      attachments.push({
        filename: path.basename(scenePath),
        content: fs.readFileSync(scenePath).toString("base64")
      });
    }

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
        subject: `${PROJECT_NAME} — Convocation ${kindLabel} : ${sub.name} (${sub.role}) — ${shortDate} ${timeStr}`,
        html: `
          <p>Bonjour,</p>
          <p><strong>${escapeHtml(sub.name)}</strong> est convoqué(e) en <strong>${kindLabel}</strong> pour le rôle de <strong>${escapeHtml(sub.role)}</strong> dans <strong>${PROJECT_NAME}</strong> :</p>
          <table style="border-collapse:collapse;font-size:15px;margin:12px 0 16px;">
            <tr><td style="padding:4px 12px 4px 0;color:#666;">📅 Date</td><td style="padding:4px 0;"><strong>${escapeHtml(dateStr)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666;">🕐 Heure</td><td style="padding:4px 0;"><strong>${escapeHtml(timeStr)}</strong></td></tr>
            ${lieu ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">📍 Lieu</td><td style="padding:4px 0;"><strong>${escapeHtml(lieu)}</strong></td></tr>` : ""}
          </table>
          ${scenePath ?
            `<p>Vous trouverez en pièce jointe la scène ${isCallback ? "du call back" : "d'essai"} ainsi que les consignes.</p>` :
            `<p>La scène et les consignes suivront dans un envoi séparé si nécessaire.</p>`}
          <p>Merci de confirmer la bonne réception de cette convocation. En cas d'empêchement, contactez-nous au plus vite : <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
          <p>Bien à vous,<br>Nicolas Derouet Casting</p>
        `,
        attachments
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }

    await updateSubmission(id, { convocationSentAt: new Date().toISOString() });
    res.status(200).json({ ok: true, sceneAttached: !!scenePath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};

// Trouve le PDF de scène du rôle : nom de fichier = début du nom du rôle,
// accents ignorés (ex. "LÉANDRO APARRA" -> LEANDRO.pdf). Prend le préfixe le plus long.
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
