const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const ALLOWED_FIELDS = ["name", "role", "agency", "email", "email2", "cv", "showreel", "availability", "note"];

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
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY non configuré côté serveur" });
    return;
  }

  try {
    const { fileBase64, fileName } = req.body || {};
    if (!fileBase64 || !fileName) {
      res.status(400).json({ error: "Fichier requis" });
      return;
    }
    const buffer = Buffer.from(fileBase64, "base64");
    if (buffer.length > 3 * 1024 * 1024) {
      res.status(400).json({ error: "Fichier trop volumineux (3 Mo max)" });
      return;
    }

    let text = "";
    const lowerName = fileName.toLowerCase();
    try {
      if (lowerName.endsWith(".pdf")) {
        const data = await pdfParse(buffer);
        text = data.text;
      } else if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        res.status(400).json({ error: "Format non supporté. Utilisez un PDF ou un document Word (.docx)." });
        return;
      }
    } catch (err) {
      console.error("Extraction failed", err);
      res.status(400).json({ error: "Impossible de lire le contenu de ce document." });
      return;
    }

    if (!text || text.trim().length < 10) {
      res.status(400).json({ error: "Aucun texte détecté dans ce document." });
      return;
    }

    const truncated = text.slice(0, 18000);

    const prompt = `Voici le texte extrait d'un document listant des comédiens pour un casting. Le nom du fichier est "${fileName}" (peut indiquer le rôle concerné si le document lui-même ne le précise pas).

Ce type de document se présente souvent comme une liste répétitive : nom du comédien, parfois un âge, un statut de disponibilité ("Disponible", "Disponibilité à vérifier", "Proposé", "Récurrent [série]", "Au théâtre à Paris", etc.), et un lien vers sa fiche chez son agence.

Identifie CHAQUE comédien mentionné, même ceux avec très peu d'informations (parfois juste un nom, sans lien ni statut). Pour chacun, extrait :
- name : nom complet du comédien
- role : le rôle/personnage visé. S'il n'est pas explicitement écrit dans le texte, déduis-le du nom du fichier si celui-ci semble désigner un personnage (ignore les mots génériques comme le nom du projet). Sinon laisse vide.
- agency : nom de l'agence si identifiable (souvent déductible du domaine du lien, ex: "zelig-fr.com" → "Zelig")
- email, email2 : uniquement si une adresse email est explicitement présente dans le texte
- cv : le lien vers la fiche/profil du comédien (souvent le seul lien présent dans ces listes)
- showreel : uniquement s'il y a un lien distinct clairement identifié comme showreel/bande démo
- availability : le statut de disponibilité tel qu'indiqué (ex: "Disponible", "Disponibilité à vérifier", "Proposé", "Disponible si pas en préparation", "Récurrent Un Si Grand Soleil"). Inclus aussi les mentions du type "au théâtre à Paris" ici.
- note : l'âge du comédien si indiqué (ex: "61 ans"), ou toute autre information utile ne rentrant pas ailleurs

Réponds UNIQUEMENT avec un tableau JSON valide, sans aucun texte avant ou après, au format exact :
[{"name": "", "role": "", "agency": "", "email": "", "email2": "", "cv": "", "showreel": "", "availability": "", "note": ""}]

Règles :
- Laisse une chaîne vide "" pour toute information absente. N'invente jamais de données non présentes dans le texte.
- Un objet par comédien identifié, même les entrées très incomplètes (juste un nom).
- Si aucun comédien n'est identifiable, réponds avec un tableau vide [].

Texte du document :
${truncated}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Anthropic API error", errText);
      res.status(502).json({ error: "Erreur lors de l'analyse par l'IA" });
      return;
    }

    const aiData = await aiRes.json();
    const rawText = (aiData.content && aiData.content[0] && aiData.content[0].text) || "";
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);

    let candidates;
    try {
      candidates = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (err) {
      // Response was likely truncated mid-array (very long candidate list).
      // Salvage every complete {...} object found before the cut-off point.
      const objectMatches = rawText.match(/\{[^{}]*\}/g);
      if (objectMatches && objectMatches.length > 0) {
        candidates = [];
        for (const objStr of objectMatches) {
          try {
            candidates.push(JSON.parse(objStr));
          } catch {
            // skip the one broken object at the cut-off point
          }
        }
      }
      if (!candidates || candidates.length === 0) {
        console.error("JSON parse failed", rawText);
        res.status(500).json({
          error: "Impossible d'interpréter la réponse de l'IA. Essaie avec un document plus court ou moins de comédiens à la fois.",
          debugPreview: rawText.slice(0, 800)
        });
        return;
      }
    }

    if (!Array.isArray(candidates)) {
      res.status(500).json({ error: "Réponse inattendue de l'IA." });
      return;
    }

    const cleaned = candidates
      .filter(c => c && typeof c === "object" && c.name)
      .map(c => {
        const clean = {};
        ALLOWED_FIELDS.forEach(f => { clean[f] = typeof c[f] === "string" ? c[f].trim() : ""; });
        return clean;
      });

    res.status(200).json({ candidates: cleaned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
