// 📣 Lancement de casting : bel email visuel envoyé aux agences du répertoire,
// avec les rôles recherchés et le lien vers la plateforme de soumission.
const { kvGet, listRoles } = require("./_redis");
const { guardDashboard } = require("./_auth");

const PROJECT_NAME = "ORAGE";
const KV_PREFIX = "orage";
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
    const { agentIds, roleIds, message, includePassword } = req.body || {};
    const allAgents = (await kvGet(`${KV_PREFIX}:agents_directory`)) || [];
    const recipients = (Array.isArray(agentIds) && agentIds.length > 0)
      ? allAgents.filter(a => agentIds.includes(a.id))
      : allAgents;
    if (recipients.length === 0) {
      res.status(400).json({ error: "Aucun destinataire — remplis d'abord le répertoire d'agents." });
      return;
    }

    const allRoles = await listRoles();
    const roles = (Array.isArray(roleIds) && roleIds.length > 0)
      ? allRoles.filter(r => roleIds.includes(r.id))
      : allRoles.filter(r => (r.processStatus || "recherche") === "recherche");
    if (roles.length === 0) {
      res.status(400).json({ error: "Aucun rôle sélectionné." });
      return;
    }

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const formUrl = `https://${host}/`;
    const pwd = includePassword && process.env.AGENT_PASSWORD ? process.env.AGENT_PASSWORD : null;

    const rolesHtml = roles.map(r => `
      <div style="border:1px solid #e2ddd2;border-left:4px solid #1d7a48;border-radius:8px;padding:14px 18px;margin-bottom:12px;background:#fdfcf9;">
        <div style="font-size:16px;font-weight:bold;color:#1d2b22;letter-spacing:0.5px;">${escapeHtml(r.name)}</div>
        ${(r.age || r.job) ? `<div style="font-size:12px;color:#1d7a48;font-weight:bold;margin-top:2px;">${escapeHtml([r.age, r.job].filter(Boolean).join(" · "))}</div>` : ""}
        ${r.desc ? `<div style="font-size:13px;color:#555;line-height:1.55;margin-top:8px;">${escapeHtml(r.desc)}</div>` : ""}
      </div>`).join("");

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || `${PROJECT_NAME} Casting <onboarding@resend.dev>`,
        to: [CASTING_CONTACT],
        bcc: recipients.map(a => a.email),
        reply_to: CASTING_CONTACT,
        subject: `📣 Lancement de casting — ${PROJECT_NAME} (${roles.length} rôle${roles.length > 1 ? "s" : ""})`,
        html: `
          <div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#26302a;">
            <div style="background:linear-gradient(135deg,#143523,#1d7a48);border-radius:12px;padding:34px 30px;text-align:center;margin-bottom:26px;">
              <div style="font-size:12px;letter-spacing:3px;color:#a8d8bd;text-transform:uppercase;margin-bottom:8px;">Lancement de casting</div>
              <div style="font-size:34px;font-weight:bold;color:#ffffff;letter-spacing:2px;">${PROJECT_NAME}</div>
              <div style="font-size:12px;color:#a8d8bd;margin-top:8px;">Nicolas Derouet Casting</div>
            </div>
            <p style="font-size:14px;line-height:1.65;">Bonjour,</p>
            <p style="font-size:14px;line-height:1.65;">${message ? escapeHtml(message).replace(/\n/g, "<br>") : `Nous lançons le casting de <strong>${PROJECT_NAME}</strong>. Vous trouverez ci-dessous les rôles recherchés — vos propositions sont les bienvenues via notre plateforme.`}</p>
            <h2 style="font-size:15px;letter-spacing:1px;text-transform:uppercase;color:#1d7a48;border-bottom:2px solid #1d7a48;padding-bottom:6px;margin:26px 0 16px;">Rôles recherchés</h2>
            ${rolesHtml}
            <div style="text-align:center;margin:30px 0 24px;">
              <a href="${formUrl}" style="background:#1d7a48;color:#ffffff;padding:14px 34px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Proposer des comédiens</a>
              ${pwd ? `<div style="font-size:12px;color:#777;margin-top:12px;">Accès agences : <strong style="letter-spacing:1px;">${escapeHtml(pwd)}</strong></div>` : ""}
              <div style="font-size:11px;color:#999;margin-top:6px;">${formUrl}</div>
            </div>
            <p style="font-size:13px;color:#555;line-height:1.6;">Une photo, un lien CV et un showreel suffisent — vous recevrez un accusé de réception pour chaque proposition. Une seule candidature par comédien et par rôle.</p>
            <p style="font-size:13px;color:#555;">Au plaisir de découvrir vos talents,<br><strong>Nicolas Derouet Casting</strong><br><a href="mailto:${CASTING_CONTACT}" style="color:#1d7a48;">${CASTING_CONTACT}</a></p>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      res.status(502).json({ error: "Échec de l'envoi de l'email", detail: errBody });
      return;
    }
    res.status(200).json({ ok: true, sentTo: recipients.length, roles: roles.length });
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
