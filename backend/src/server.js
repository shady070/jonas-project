import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import archiver from "archiver";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, "..", "storage");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Multer setup for file uploads
const upload = multer({ dest: path.join(STORAGE_DIR, "uploads") });

// DB bootstrap
const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS datapoints (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_values (
      id SERIAL PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      datapoint_id INTEGER REFERENCES datapoints(id) ON DELETE CASCADE,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS pdf_templates (
      id SERIAL PRIMARY KEY,
      original_filename TEXT,
      stored_path TEXT NOT NULL,
      pages INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pdf_mappings (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES pdf_templates(id) ON DELETE CASCADE,
      datapoint_id INTEGER REFERENCES datapoints(id) ON DELETE CASCADE,
      page INTEGER DEFAULT 1,
      x NUMERIC, -- normalized 0..1
      y NUMERIC, -- normalized 0..1
      font_size NUMERIC DEFAULT 12
    );
  `);
};
ensureTables().catch(console.error);

// ----- Routes -----

// health
app.get("/api/health", (req, res) => res.json({ ok: true }));

// list companies and datapoints
app.get("/api/companies", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM companies ORDER BY id ASC");
  res.json(rows);
});

app.get("/api/datapoints", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM datapoints ORDER BY id ASC");
  res.json(rows);
});

app.get("/api/company/:id/values", async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT d.key, d.label, cv.value
    FROM datapoints d
    LEFT JOIN company_values cv ON cv.datapoint_id = d.id AND cv.company_id = $1
    ORDER BY d.id ASC
  `,
    [req.params.id]
  );
  res.json(rows);
});

// upload a PDF template
app.post("/api/templates/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const storedPath = req.file.path;

  // Try to read pages count via pdf-lib
  let pages = 1;
  try {
    const bytes = fs.readFileSync(storedPath);
    const pdfDoc = await PDFDocument.load(bytes);
    pages = pdfDoc.getPageCount();
  } catch (e) {
    console.error("Failed to read PDF:", e);
  }

  const { rows } = await pool.query(
    "INSERT INTO pdf_templates (original_filename, stored_path, pages) VALUES ($1,$2,$3) RETURNING *",
    [req.file.originalname, storedPath, pages]
  );
  res.json(rows[0]);
});

// list templates
app.get("/api/templates", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM pdf_templates ORDER BY id DESC");
  res.json(rows);
});

// save mappings
app.post("/api/templates/:id/mappings", async (req, res) => {
  const templateId = req.params.id;
  const { mappings } = req.body; // [{datapoint_id,page,x,y,font_size}]
  if (!Array.isArray(mappings)) return res.status(400).json({ error: "mappings array required" });
  await pool.query("DELETE FROM pdf_mappings WHERE template_id = $1", [templateId]);
  const ops = [];
  for (const m of mappings) {
    ops.push(
      pool.query(
        "INSERT INTO pdf_mappings (template_id, datapoint_id, page, x, y, font_size) VALUES ($1,$2,$3,$4,$5,$6)",
        [templateId, m.datapoint_id, m.page || 1, Number(m.x), Number(m.y), Number(m.font_size) || 12]
      )
    );
  }
  await Promise.all(ops);
  res.json({ ok: true });
});

// get mappings
app.get("/api/templates/:id/mappings", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM pdf_mappings WHERE template_id = $1 ORDER BY id ASC", [
    req.params.id,
  ]);
  // Coerce to numbers on the way out (defensive)
  res.json(
    rows.map((m) => ({
      ...m,
      x: Number(m.x),
      y: Number(m.y),
      font_size: Number(m.font_size) || 12,
      page: Number(m.page) || 1,
    }))
  );
});

// generate filled PDFs for selected companies -> returns zip
app.post("/api/templates/:id/generate", async (req, res) => {
  try {
    const templateId = req.params.id;
    const { companyIds } = req.body; // array
    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return res.status(400).json({ error: "companyIds required" });
    }

    const { rows: tRows } = await pool.query("SELECT * FROM pdf_templates WHERE id=$1", [templateId]);
    if (!tRows.length) return res.status(404).json({ error: "template not found" });
    const template = tRows[0];

    if (!fs.existsSync(template.stored_path)) {
      // File was wiped (e.g., after docker volume reset)
      return res.status(410).json({ error: "template file missing on server; please re-upload" });
    }

    const tplBytes = fs.readFileSync(template.stored_path);
    const mappings = (
      await pool.query("SELECT * FROM pdf_mappings WHERE template_id = $1 ORDER BY id ASC", [templateId])
    ).rows;

    // stream zip
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("zip error:", err);
      if (!res.headersSent) res.status(500).json({ error: "zip failed" });
    });
    res.attachment(`generated_${templateId}.zip`);
    archive.pipe(res);

    for (const cid of companyIds) {
      const { rows: compRows } = await pool.query("SELECT * FROM companies WHERE id=$1", [cid]);
      if (!compRows.length) continue;
      const comp = compRows[0];

      const rows = (
        await pool.query(
          `
        SELECT d.id as datapoint_id, d.key, d.label, cv.value
        FROM datapoints d
        LEFT JOIN company_values cv ON cv.datapoint_id = d.id AND cv.company_id = $1
        ORDER BY d.id ASC
      `,
          [cid]
        )
      ).rows;

      const valuesById = Object.fromEntries(rows.map((r) => [r.datapoint_id, (r.value ?? "").toString()]));

      const pdfDoc = await PDFDocument.load(tplBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const m of mappings) {
        const pageIndex = Math.max(0, Math.min(pages.length - 1, (Number(m.page) || 1) - 1));
        const pg = pages[pageIndex];

        const text = valuesById[m.datapoint_id] ?? "";
        if (!text) continue;

        const { width, height } = pg.getSize();

        // Ensure numeric values
        const nx = Number(m.x);
        const ny = Number(m.y);
        const size = Number(m.font_size) || 12;

        if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;

        // Compute coordinates safely (invert Y for PDF coords)
        const x = Math.max(0, Math.min(width, nx * width));
        const y = Math.max(0, Math.min(height, (1 - ny) * height));

        pg.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
      }

      const pdfBytes = await pdfDoc.save();
      archive.append(Buffer.from(pdfBytes), {
        name: `${comp.name.replace(/[^a-z0-9_\-]+/gi, "_")}.pdf`,
      });
    }

    await archive.finalize();
  } catch (err) {
    console.error("generate error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "generate failed", details: String(err?.message || err) });
    }
  }
});

// static serve storage (for preview images if needed)
app.use("/storage", express.static(STORAGE_DIR));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`);
});
