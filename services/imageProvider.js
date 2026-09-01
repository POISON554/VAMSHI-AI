const { InferenceClient } = require('@huggingface/inference');
const { generateH3Variants } = require('./h3ComfyProvider');

const PROVIDER = (process.env.IMAGE_PROVIDER || 'google').toLowerCase();
const MODEL = process.env.IMAGE_MODEL || 'gemini-2.5-flash-image';
const FALLBACK_MODEL = process.env.IMAGE_FALLBACK_MODEL || 'black-forest-labs/FLUX.1-Kontext-dev';
const HF_PROVIDER = process.env.HF_PROVIDER || 'fal-ai';
const ANALYSIS_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

const HIDDEN_INSTRUCTION = `Analyze the uploaded reference image automatically. Identify its visual style, textile/surface texture, pattern structure, colors, composition, density, scale, motifs, repetition, symmetry or asymmetry, and overall aesthetic. Generate an original textile/surface-design variation inspired by the reference. Maintain the same design language, color relationship, texture character, and mood while creating a genuinely new composition. Do not reproduce, mirror, trace, or make an exact copy. No text, logos, signatures, watermarks, borders, mockups, garments, rooms, or unrelated objects.`;
const MODES = [
  'Stay closest to the reference design language but change composition, motif placement, and repetition rhythm.',
  'Preserve the color relationship and aesthetic while substantially changing arrangement, spacing, scale, and pattern structure.',
  'Create a more creative interpretation with a fresh motif flow and texture rhythm while clearly belonging to the same design family.',
  'Create a premium production-friendly textile/surface pattern with refined detail, balanced density, and a sophisticated new arrangement.'
];

async function analyzeWithGroq(imageBuffer) {
  if (!process.env.GROQ_API_KEY) return null;
  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANALYSIS_MODEL, temperature: 0.2, max_tokens: 700, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Analyze this textile/surface-design reference. Return concise JSON with palette, motifs, texture, pattern, repetition, composition, density, symmetry, scale, aesthetic, and design_family. Only describe visible characteristics.' },
      { type: 'image_url', image_url: { url: dataUrl } }
    ] }] })
  });
  if (!response.ok) throw new Error(`Groq analysis failed (${response.status})`);
  const json = await response.json();
  return json.choices?.[0]?.message?.content || null;
}

async function generateWithGoogle({ imageBuffer, analysis, seedBase }) {
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('Missing GEMINI_API_KEY'), { statusCode: 503, publicMessage: 'Add GEMINI_API_KEY to the Render server environment.' });
  const model = MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const base64 = imageBuffer.toString('base64');
  const results = [];
  for (let i = 0; i < 4; i++) {
    const seed = seedBase + i * 7919;
    const prompt = `${HIDDEN_INSTRUCTION}\n\nAutomatic visual analysis: ${analysis || 'Use the reference image as the primary visual guide.'}\n\nVariation direction: ${MODES[i]}\nFresh variation seed: ${seed}. Generate one finished textile/surface artwork only.`;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: base64 } }, { text: prompt }] }]
    }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const statusCode = response.status;
      const publicMessage = statusCode === 401 || statusCode === 403 ? 'Google rejected the API request. Check GEMINI_API_KEY and API access.' : statusCode === 429 ? 'Google AI is temporarily rate-limited. Please try again later.' : statusCode === 400 ? 'Google rejected the image-generation request. Check IMAGE_MODEL and Google AI access.' : 'Google image generation failed. Please try again.';
      throw Object.assign(new Error(data?.error?.message || 'Google generation failed'), { statusCode, publicMessage });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.data || p.inline_data?.data);
    const inline = imagePart?.inlineData || imagePart?.inline_data;
    if (!inline?.data) throw Object.assign(new Error('Google returned no image'), { statusCode: 502, publicMessage: 'Google returned no image. Check that IMAGE_MODEL is an image-generation model available to your API key.' });
    const mime = inline.mimeType || inline.mime_type || 'image/png';
    results.push({ index: i + 1, seed, model, dataUrl: `data:${mime};base64,${inline.data}` });
  }
  return results;
}

async function generateWithHF({ imageBuffer, analysis, seedBase, model }) {
  if (!process.env.HF_TOKEN) throw Object.assign(new Error('Missing HF_TOKEN'), { statusCode: 503, publicMessage: 'Add HF_TOKEN to the Render server environment.' });
  const client = new InferenceClient(process.env.HF_TOKEN);
  const results = [];
  for (let i = 0; i < 4; i++) {
    const seed = seedBase + i * 7919;
    const prompt = `${HIDDEN_INSTRUCTION}\n\nAutomatic visual analysis: ${analysis || 'Use the reference image itself as the primary visual guide.'}\n\nVariation direction: ${MODES[i]}`;
    const image = await client.imageToImage(imageBuffer, { provider: HF_PROVIDER, model, prompt, negative_prompt: 'text, letters, words, logo, watermark, signature, border, frame, mockup, garment, clothing photograph, room, mannequin, unrelated objects, exact copy, mirror copy', guidance_scale: Number(process.env.IMAGE_GUIDANCE || 5.5), num_inference_steps: Number(process.env.IMAGE_STEPS || 28), seed });
    const buffer = Buffer.from(await image.arrayBuffer());
    results.push({ index: i + 1, seed, model, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` });
  }
  return results;
}

async function generateVariants({ imageBuffer, metadata, seedBase }) {
  if (PROVIDER === 'comfyui' || PROVIDER === 'h3') return generateH3Variants({ imageBuffer, metadata, seedBase });
  const groqAnalysis = await analyzeWithGroq(imageBuffer).catch(error => { console.warn('Groq analysis unavailable:', error.message); return null; });
  const analysis = [groqAnalysis, describeMetadata(metadata)].filter(Boolean).join('\n');
  if (PROVIDER === 'google' || PROVIDER === 'gemini') {
    try { return await generateWithGoogle({ imageBuffer, analysis, seedBase }); }
    catch (googleError) {
      console.error('Google generation failed:', googleError?.message || googleError);
      if (process.env.IMAGE_FALLBACK_ENABLED !== 'false' && process.env.HF_TOKEN) {
        try { return await generateWithHF({ imageBuffer, analysis, seedBase: seedBase + 1000003, model: FALLBACK_MODEL }); }
        catch (fallbackError) { console.error('Hugging Face fallback failed:', fallbackError?.message || fallbackError); }
      }
      throw googleError;
    }
  }
  if (PROVIDER === 'huggingface') {
    try { return await generateWithHF({ imageBuffer, analysis, seedBase, model: MODEL }); }
    catch (primaryError) {
      if (process.env.IMAGE_FALLBACK_ENABLED !== 'false' && FALLBACK_MODEL !== MODEL && process.env.HF_TOKEN) {
        try { return await generateWithHF({ imageBuffer, analysis, seedBase: seedBase + 1000003, model: FALLBACK_MODEL }); } catch (_) {}
      }
      throw Object.assign(new Error('Provider generation failed'), { statusCode: 502, publicMessage: 'The image provider could not generate the variations. Please check your API access/credits and try again.' });
    }
  }
  throw Object.assign(new Error('Unsupported provider'), { statusCode: 503, publicMessage: `Provider "${PROVIDER}" is not configured.` });
}

function describeMetadata(m) {
  return [`aspect ratio ${m.aspectRatio}`, m.designFamily, m.paletteHint, m.compositionHint, `texture score ${m.textureScore}/100`, `contrast score ${m.contrastScore}/100`, `average channels ${m.channelMeans.join(', ')}`].join('; ');
}
module.exports = { generateVariants };
