const { createSubmission, listRoles, getClientIp, checkRateLimit } = require("./_redis");

const PROJECT_NAME = "ORAGE";
const CASTING_CONTACT = "casting@mrnicolasderouet.com";
const MAX_PHOTO_BASE64_LENGTH = 1.5 * 1024 * 1024;
const MAX_SUBMISSIONS_PER_WINDOW = 20;
const SUBMIT_WINDOW_SECONDS = 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:submit:${ip}`, MAX_SUBMISSIONS_PER_WINDOW, SUBMIT_WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de candidatures envoyées récemment. Merci de réessayer plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const { role, name, email, agency, agentName, assistantName, cv, showreel, availability, note, photo, agentPassword } = req.body || {};
    if (!role || !name) {
      res.status(400).json({ error: "Rôle et nom du comédien requis" });
      return;
    }
    if (process.env.AGENT_PASSWORD && agentPassword !== process.env.AGENT_PASSWORD) {
      res.status(401).json({ error: "Accès non autorisé" });
      return;
    }
    try {
      const roles = await listRoles();
      const matchingRole = roles.find(r => r.name === role);
      if (matchingRole && ["caste", "ferme"].includes(matchingRole.processStatus)) {
        res.status(403).json({ error: "Ce rôle n'est plus en casting." });
        return;
      }
    } catch (err) {
      console.error("Closed-role check failed", err);
    }
    if (photo && (typeof photo !== "string" || photo.length > MAX_PHOTO_BASE64_LENGTH)) {
      res.status(400).json({ error: "Photo trop volumineuse" });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Email de contact valide requis" });
      return;
    }
    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      name,
      email,
      agency: agency || "",
      agentName: agentName || "",
      assistantName: assistantName || "",
      cv: cv || "",
      showreel: showreel || "",
      availability: availability || "",
      note: note || "",
      photo: photo || "",
      status: "peutetre",
      submittedAt: new Date().toISOString()
    };
    await createSubmission(submission);

    // Accusé de réception à l'agence — ne doit JAMAIS faire échouer la soumission.
    try {
      await sendAcknowledgmentEmail(submission);
    } catch (err) {
      console.error("Acknowledgment email failed", err);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};

async function sendAcknowledgmentEmail(sub) {
  if (!process.env.RESEND_API_KEY) return;

  const recapRows = [
    ["Comédien(ne)", sub.name],
    ["Rôle", sub.role],
    ["Projet", PROJECT_NAME],
    sub.agency ? ["Agence", sub.agency] : null,
    sub.agentName ? ["Agent", sub.agentName] : null,
    sub.availability ? ["Disponibilités", sub.availability] : null
  ].filter(Boolean).map(([label, value]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`
  ).join("");

  const links = [
    sub.cv ? `<li>CV / fiche : <a href="${escapeHtml(sub.cv)}">${escapeHtml(sub.cv)}</a></li>` : "",
    sub.showreel ? `<li>Showreel : <a href="${escapeHtml(sub.showreel)}">${escapeHtml(sub.showreel)}</a></li>` : ""
  ].filter(Boolean).join("");

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
      subject: `${PROJECT_NAME} — Candidature bien reçue : ${sub.name} (${sub.role})`,
      html: `
        <p>Bonjour,</p>
        <p>Nous vous confirmons la bonne réception de votre proposition pour <strong>${PROJECT_NAME}</strong> :</p>
        <table style="border-collapse:collapse;font-size:14px;margin:8px 0 16px;">${recapRows}</table>
        ${links ? `<p style="margin:0 0 4px;">Liens transmis :</p><ul style="margin:0 0 16px;">${links}</ul>` : ""}
        <p>Votre candidature sera étudiée avec attention. Il n'est pas nécessaire de la soumettre à nouveau — pour rappel, une seule candidature par comédien et par rôle.</p>
        <p>Nous reviendrons vers vous si le profil est retenu pour la suite du processus.</p>
        <p>Pour toute question : <a href="mailto:${CASTING_CONTACT}">${CASTING_CONTACT}</a></p>
        <p>Bien à vous,<br>Nicolas Derouet Casting</p>
      `
    })
  });

  if (!emailRes.ok) {
    const errBody = await emailRes.text();
    throw new Error(`Resend error: ${errBody}`);
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
