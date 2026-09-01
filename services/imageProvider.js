const { InferenceClient } = require('@huggingface/inference');

const PROVIDER = (process.env.IMAGE_PROVIDER || 'huggingface').toLowerCase();
const MODEL = process.env.IMAGE_MODEL || 'black-forest-labs/FLUX.2-dev';
const HF_PROVIDER = process.env.HF_PROVIDER || 'fal-ai';

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
    throw Object.assign(new Error('Unsupported provider'), {
      publicMessage: `Provider "${PROVIDER}" is not configured. Set IMAGE_PROVIDER=huggingface.`
    });
  }

  if (!process.env.HF_TOKEN) {
    throw Object.assign(new Error('Missing HF_TOKEN'), {
      statusCode: 503,
      publicMessage: 'Image generation is not configured yet. Add HF_TOKEN on the server, then try again.'
    });
  }

  // HF_TOKEN is kept server-side. Hugging Face routes this request to the
  // selected Inference Provider (Fal.ai by default) without exposing secrets.
  const client = new InferenceClient(process.env.HF_TOKEN);
  const base = describeMetadata(metadata);
  const results = [];

  // Sequential calls reduce burst failures on low-cost inference accounts.
  for (let i = 0; i < 4; i++) {
    const seed = seedBase + i * 7919;
    const prompt = `${HIDDEN_INSTRUCTION}\n\nAutomatic reference analysis: ${base}\n\nVariation direction: ${MODES[i]}\n\nGenerate only the finished artwork. No mockup, no garment, no room scene, no typography.`;

    try {
      const image = await client.imageToImage({
        provider: HF_PROVIDER,
        model: MODEL,
        inputs: imageBuffer,
        parameters: {
          prompt,
          negative_prompt: 'text, letters, words, logo, watermark, signature, border, frame, mockup, clothing photograph, room, mannequin, unrelated objects, exact copy, mirror copy',
          guidance_scale: Number(process.env.IMAGE_GUIDANCE || 5.5),
          num_inference_steps: Number(process.env.IMAGE_STEPS || 28),
          seed
        }
      });

      const buffer = Buffer.from(await image.arrayBuffer());
      results.push({
        index: i + 1,
        seed,
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`
      });
    } catch (error) {
      console.error('Hugging Face provider error:', {
        name: error?.name,
        message: error?.message,
        status: error?.status,
        statusCode: error?.statusCode
      });

      const status = Number(error?.status || error?.statusCode || 0);
      let publicMessage = 'The image provider could not generate the variations. Please try again.';

      if (status === 401 || status === 403) {
        publicMessage = 'Hugging Face rejected the request. Check that HF_TOKEN is valid and has Inference Providers permission, and that you accepted the FLUX.2-dev model terms.';
      } else if (status === 402) {
        publicMessage = 'Hugging Face requires available inference credits for this request. Check your Hugging Face billing/credits and try again.';
      } else if (status === 404) {
        publicMessage = `The selected image model/provider is unavailable. Check IMAGE_MODEL (${MODEL}) and HF_PROVIDER (${HF_PROVIDER}).`;
      } else if (status === 429) {
        publicMessage = 'The image provider is temporarily rate-limited. Please wait a moment and try again.';
      }

      throw Object.assign(new Error('Provider generation failed'), {
        statusCode: 502,
        publicMessage
      });
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
