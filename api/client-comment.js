const { getSubmission, updateSubmission, getClientIp, checkRateLimit } = require("./_redis");

const MAX_COMMENTS_PER_WINDOW = 15;
const COMMENT_WINDOW_SECONDS = 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ratelimit:comment:${ip}`, MAX_COMMENTS_PER_WINDOW, COMMENT_WINDOW_SECONDS);
    if (!allowed) {
      res.status(429).json({ error: "Trop de commentaires envoyés récemment. Merci de réessayer plus tard." });
      return;
    }
  } catch (err) {
    console.error("Rate limit check failed", err);
  }

  try {
    const { id, text, author } = req.body || {};
    if (!id || !text || !text.trim()) {
      res.status(400).json({ error: "Commentaire vide" });
      return;
    }
    const sub = await getSubmission(id);
    if (!sub) {
      res.status(404).json({ error: "Candidature introuvable" });
      return;
    }
    const comments = Array.isArray(sub.comments) ? sub.comments : [];
    comments.push({
      text: text.trim().slice(0, 2000),
      author: (author || "Client").trim().slice(0, 80) || "Client",
      date: new Date().toISOString()
    });
    await updateSubmission(id, { comments });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
