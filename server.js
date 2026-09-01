const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { generateVariants } = require('./services/imageProvider');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowedTypes.has(file.mimetype))
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(process.env.HF_TOKEN), provider: process.env.IMAGE_PROVIDER || 'huggingface' });
});

app.post('/api/generate', upload.single('reference'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload one JPG, JPEG, PNG, or WEBP image.' });
    if (!allowedTypes.has(req.file.mimetype)) return res.status(415).json({ error: 'Unsupported image type.' });

    const normalized = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    const metadata = await analyzeImage(normalized);
    const generationId = crypto.randomUUID();
    const seedBase = crypto.randomInt(1, 2147483646);
    const results = await generateVariants({ imageBuffer: normalized, metadata, generationId, seedBase });
    res.json({ generationId, metadata, results });
  } catch (error) {
    console.error(error);
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Image is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`
      : (error.publicMessage || 'Generation failed. Please try again.');
    res.status(error.statusCode || 500).json({ error: message });
  }
});

async function analyzeImage(buffer) {
  const image = sharp(buffer);
  const stats = await image.stats();
  const meta = await image.metadata();
  const channels = stats.channels || [];
  const means = channels.map(c => Math.round(c.mean));
  const variance = channels.reduce((sum, c) => sum + (c.stdev || 0), 0) / Math.max(channels.length, 1);
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    aspectRatio: meta.width && meta.height ? Number((meta.width / meta.height).toFixed(2)) : 1,
    channelMeans: means,
    contrastScore: Math.round(variance),
    brightnessScore: Math.round(channels[0]?.mean || 0),
    textureScore: Math.round(Math.min(100, variance * 1.8)),
    designFamily: inferFamily(meta.width, meta.height, variance),
    paletteHint: paletteHint(means),
    compositionHint: compositionHint(meta.width, meta.height),
    analyzedAutomatically: true
  };
}

function inferFamily(width, height, variance) {
  const ratio = width && height ? width / height : 1;
  if (variance > 45) return 'high-detail textile or decorative surface pattern';
  if (ratio > 1.6 || ratio < 0.62) return 'directional textile or elongated surface pattern';
  return 'balanced textile, fabric, motif, or surface pattern';
}

function paletteHint(means) {
  if (!means.length) return 'reference-derived palette';
  const avg = means.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, means.length);
  if (avg < 75) return 'deep, rich, low-key palette relationship';
  if (avg > 190) return 'light, airy, high-key palette relationship';
  return 'mid-tone palette relationship with preserved color character';
}

function compositionHint(width, height) {
  const ratio = width && height ? width / height : 1;
  if (ratio > 1.25) return 'horizontal flow with balanced repetition';
  if (ratio < 0.8) return 'vertical flow with balanced repetition';
  return 'balanced all-over composition';
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => console.log(`VAMSHI AI listening on port ${PORT}`));
