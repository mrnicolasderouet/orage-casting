const { listSubmissions, getPhoto } = require("./_redis");
const PDFDocument = require("pdfkit");

const GREEN = "#1A6B3C";
const DARK = "#0D1B2A";
const GRAY = "#555555";

const STATUS_LABELS = {
  oui: "Oui",
  peutetre: "Peut-être",
  non: "Non"
};

function normalizeStatus(status) {
  if (["oui", "shortlist", "validated"].includes(status)) return "oui";
  if (["non", "rejected"].includes(status)) return "non";
  return "peutetre";
}

function decodePhoto(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

function generatePdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Promise.resolve(buildFn(doc)).then(() => doc.end()).catch(reject);
  });
}

function infoLine(doc, label, value, x, y, labelWidth, valueWidth) {
  doc.fontSize(9).fillColor(GRAY).font("Helvetica-Bold").text(label, x, y, { width: labelWidth });
  doc.fontSize(9).fillColor("#222222").font("Helvetica").text(value || "—", x + labelWidth, y, { width: valueWidth });
}

async function drawCandidate(doc, sub, index) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startY = doc.y;

  if (startY > doc.page.height - doc.page.margins.bottom - 160) {
    doc.addPage();
  }
  const y = doc.y;

  doc.fontSize(13).fillColor(GREEN).font("Helvetica-Bold")
    .text(`${String(index + 1).padStart(2, "0")} — `, doc.page.margins.left, y, { continued: true });
  doc.fillColor(DARK).text(sub.name, { continued: true });
  doc.fontSize(10).fillColor(GRAY).font("Helvetica-Oblique").text(`   (${sub.role})`);

  doc.moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.margins.left + pageWidth, doc.y + 2)
    .strokeColor(GREEN).lineWidth(1.2).stroke();

  doc.moveDown(0.6);
  const blockTop = doc.y;
  const photoW = 88, photoH = 116;
  const photoDataUrl = await getPhoto(sub.id);
  const photoBuf = decodePhoto(photoDataUrl);
  if (photoBuf) {
    try {
      doc.image(photoBuf, doc.page.margins.left, blockTop, { width: photoW, height: photoH, fit: [photoW, photoH] });
    } catch (e) {
      // skip unreadable image
    }
  }

  const textX = doc.page.margins.left + photoW + 16;
  const labelW = 90;
  const valueW = pageWidth - photoW - 16 - labelW;
  let ly = blockTop;
  const lineH = 15;

  const rows = [
    ["Agence", sub.agency],
    ...(sub.email ? [["Email", sub.email]] : []),
    ...(sub.email2 ? [["Deuxième email", sub.email2]] : []),
    ["CV / fiche", sub.cv],
    ["Showreel", sub.showreel],
    ...(sub.vimeo ? [["Essai (Vimeo)", sub.vimeo]] : []),
    ["Disponibilités", sub.availability],
    ["Note", sub.note],
    ["Statut", STATUS_LABELS[normalizeStatus(sub.status)]],
    ["Soumis le", new Date(sub.submittedAt).toLocaleDateString("fr-FR")]
  ];
  rows.forEach(([label, value]) => {
    infoLine(doc, label, value, textX, ly, labelW, valueW);
    ly += lineH;
  });

  doc.y = Math.max(blockTop + photoH, ly) + 18;
}

module.exports = async (req, res) => {
  const password = req.headers["x-dashboard-password"];
  if (!process.env.DASHBOARD_PASSWORD) {
    res.status(500).json({ error: "DASHBOARD_PASSWORD non configuré côté serveur" });
    return;
  }
  if (password !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return;
  }
  try {
    const statusFilter = (req.query && req.query.status) || "oui";
    const all = await listSubmissions();
    const selected = all
      .filter(s => !s.archived && normalizeStatus(s.status) === statusFilter)
      .sort((a, b) => a.role.localeCompare(b.role) || new Date(a.submittedAt) - new Date(b.submittedAt));

    const buffer = await generatePdfBuffer(async (doc) => {
      doc.fontSize(30).fillColor(DARK).font("Helvetica-Bold")
        .text("ORAGE", { align: "center" });
      doc.moveDown(0.2);
      doc.fontSize(12).fillColor(GREEN).font("Helvetica-Bold")
        .text(
          statusFilter === "oui" ? "PROPOSITION DE CASTING — COMÉDIENS RETENUS" : `COMÉDIENS — ${STATUS_LABELS[statusFilter].toUpperCase()}`,
          { align: "center" }
        );
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor(GRAY).font("Helvetica-Oblique")
        .text(`${selected.length} comédien${selected.length > 1 ? "s" : ""} — généré le ${new Date().toLocaleDateString("fr-FR")}`, { align: "left" });
      doc.moveDown(0.8);

      if (selected.length === 0) {
        doc.fontSize(11).fillColor(GRAY).font("Helvetica").text("Aucun comédien dans cette catégorie.");
      } else {
        for (let i = 0; i < selected.length; i++) {
          await drawCandidate(doc, selected[i], i);
        }
      }
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ORAGE_${statusFilter}_${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.status(200).send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur", detail: String(err && err.message) });
  }
};
