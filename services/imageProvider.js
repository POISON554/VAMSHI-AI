const { InferenceClient } = require('@huggingface/inference');

const PROVIDER = (process.env.IMAGE_PROVIDER || 'huggingface').toLowerCase();
const MODEL = process.env.IMAGE_MODEL || 'black-forest-labs/FLUX.2-dev';

const HIDDEN_INSTRUCTION = `Analyze the uploaded reference image automatically. Identify its visual style, texture, pattern structure, colors, composition, density, scale, motifs, repetition, and overall design characteristics.
Generate an original textile/surface-design variation inspired by the uploaded reference. Maintain the same overall design language, aesthetic, color relationship, texture character, visual mood, and textile/surface-design quality, while creating a new composition and arrangement. Do not reproduce the reference exactly. Do not simply copy or mirror it. Do not add text, logos, signatures, watermarks, borders, mockup objects, or unrelated elements.`;

const MODES = [
  'Stay very close to the original visual language while introducing a clearly new composition, motif placement, and repetition rhythm.',
  'Keep the same aesthetic and color relationship but substantially change the arrangement, pattern structure, spacing, and motif flow.',
  'Create a more creative interpretation while remaining unmistakably related to the reference family; explore a fresh motif arrangement and texture rhythm.',
  'Create a fresh premium textile/surface-pattern variation with refined detail, balanced density, sophisticated repetition, and production-friendly visual clarity.'
];

async function generateVariants({ imageBuffer, metadata, seedBase }) {
  if (PROVIDER !== 'huggingface') {
    throw Object.assign(new Error('Unsupported provider'), { publicMessage: `Provider "${PROVIDER}" is not configured. Set IMAGE_PROVIDER=huggingface or add another adapter.` });
  }
  if (!process.env.HF_TOKEN) {
    throw Object.assign(new Error('Missing HF_TOKEN'), { statusCode: 503, publicMessage: 'Image generation is not configured yet. Add HF_TOKEN on the server, then try again.' });
  }

  const client = new InferenceClient(process.env.HF_TOKEN);
  const base = describeMetadata(metadata);
  const referenceBase64 = imageBuffer.toString('base64');
  const results = [];

  // Sequential calls reduce burst failures on low-cost inference accounts.
  for (let i = 0; i < 4; i++) {
    const seed = seedBase + i * 7919;
    const prompt = `${HIDDEN_INSTRUCTION}\n\nAutomatic reference analysis: ${base}\n\nVariation direction: ${MODES[i]}\n\nGenerate only the finished artwork. No mockup, no garment, no room scene, no typography.`;
    try {
      const image = await client.imageTextToImage({
        model: MODEL,
        inputs: referenceBase64,
        parameters: {
          prompt,
          negative_prompt: 'text, letters, words, logo, watermark, signature, border, frame, mockup, clothing photograph, room, mannequin, unrelated objects, exact copy, mirror copy',
          guidance_scale: Number(process.env.IMAGE_GUIDANCE || 5.5),
          num_inference_steps: Number(process.env.IMAGE_STEPS || 28),
          seed
        }
      });
      const buffer = Buffer.from(await image.arrayBuffer());
      results.push({ index: i + 1, seed, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` });
    } catch (error) {
      console.error('Provider error', error);
      throw Object.assign(new Error('Provider generation failed'), { statusCode: 502, publicMessage: 'The image provider could not generate the variations. Check your API key/credits and try again.' });
    }
  }
  return results;
}

function describeMetadata(m) {
  return [
    `aspect ratio ${m.aspectRatio}`,
    m.designFamily,
    m.paletteHint,
    m.compositionHint,
    `automatic texture/detail score ${m.textureScore}/100`,
    `automatic contrast score ${m.contrastScore}/100`,
    `average channel values ${m.channelMeans.join(', ')}`
  ].join('; ');
}

module.exports = { generateVariants };
