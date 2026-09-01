const EDENAI_URL = 'https://api.edenai.run/v2/image/generation';

const HIDDEN_INSTRUCTION = `Analyze the uploaded reference image automatically. Identify its colors, palette, texture, pattern style, shapes, motifs, repetition, composition, visual density, scale, symmetry/asymmetry, overall aesthetic, and textile/surface-design characteristics. Generate an original textile or surface-pattern design inspired by the reference. Preserve the overall visual language, aesthetic, color relationship, texture character, and mood, but create a meaningfully different composition. Do not reproduce, trace, mirror, or make an exact copy. Do not add text, logos, signatures, watermarks, borders, frames, mockups, garments, mannequins, rooms, or unrelated objects. Return only the finished artwork.`;

const VARIATIONS = [
  'Stay very close to the original visual language while introducing a new motif placement and repetition rhythm.',
  'Keep the same aesthetic and color relationship but substantially change the arrangement and pattern structure.',
  'Create a more creative interpretation with a fresh motif flow while remaining clearly related to the reference.',
  'Create a premium fresh textile/surface-pattern variation with refined detail and balanced visual density.'
];

function publicError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function findImage(value) {
  if (!value || typeof value !== 'object') return null;
  const candidates = [
    value.image_resource_url,
    value.image,
    value.image_url,
    value.generated_image,
    value.base64,
    value.image_base64,
    value.content
  ];
  return candidates.find(v => typeof v === 'string' && v.length > 20) || null;
}

function extractImage(data) {
  if (typeof data === 'string') return data;
  const direct = findImage(data);
  if (direct) return direct;

  for (const key of ['openai', 'google', 'amazon', 'stabilityai', 'replicate', 'ideogram', 'flux']) {
    const found = findImage(data?.[key]);
    if (found) return found;
  }

  const items = data?.items || data?.results || data?.data || [];
  if (Array.isArray(items)) {
    for (const item of items) {
      const found = findImage(item);
      if (found) return found;
    }
  }

  return null;
}

async function generateOne({ imageBuffer, metadata, variationIndex, seed }) {
  if (!process.env.EDENAI_API_KEY) {
    throw publicError('Eden AI is not configured. Add EDENAI_API_KEY in Render Environment Variables.', 503);
  }

  const reference = imageBuffer.toString('base64');
  const analysis = describeMetadata(metadata);
  const text = `${HIDDEN_INSTRUCTION}\n\nReference characteristics detected automatically: ${analysis}\n\nVariation ${variationIndex + 1}: ${VARIATIONS[variationIndex]}\nRandom variation seed: ${seed}`;

  // Eden AI uses provider-specific generation capabilities. The provider can be
  // selected here without exposing its credentials to the browser.
  const provider = process.env.EDENAI_IMAGE_PROVIDER || 'stabilityai';
  const body = {
    providers: provider,
    text,
    resolution: process.env.EDENAI_RESOLUTION || '1024x1024',
    response_as_dict: true,
    show_original_response: false,
    num_images: 1,
    file: reference,
    file_type: 'image/png'
  };

  const response = await fetch(EDENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.EDENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw publicError('Eden AI rejected the API key. Check EDENAI_API_KEY.', response.status);
    }
    if (response.status === 429) {
      throw publicError('Eden AI rate limit reached. Please try again later.', 429);
    }
    throw publicError(data?.error?.message || data?.message || 'Eden AI image generation failed.', 502);
  }

  const image = extractImage(data);
  if (!image) {
    throw publicError('Eden AI returned no generated image. Check the enabled image provider/model in Eden AI.', 502);
  }

  if (/^https?:\/\//i.test(image)) {
    return { index: variationIndex + 1, seed, url: image };
  }

  if (/^data:image\//i.test(image)) {
    return { index: variationIndex + 1, seed, url: image };
  }

  return {
    index: variationIndex + 1,
    seed,
    url: `data:image/png;base64,${image}`
  };
}

async function generateVariants({ imageBuffer, mimeType, metadata, seedBase }) {
  if (!process.env.EDENAI_API_KEY) {
    throw publicError('Eden AI is not configured. Add EDENAI_API_KEY in Render Environment Variables.', 503);
  }

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await generateOne({
      imageBuffer,
      mimeType,
      metadata,
      variationIndex: i,
      seed: seedBase + i * 7919
    }));
  }
  return results;
}

function describeMetadata(metadata = {}) {
  return [
    `aspect ratio ${metadata.aspectRatio || 1}`,
    metadata.designFamily || 'textile/surface design',
    metadata.paletteHint || 'reference-derived palette',
    metadata.compositionHint || 'balanced composition',
    `texture score ${metadata.textureScore || 0}/100`,
    `contrast score ${metadata.contrastScore || 0}/100`,
    `channel means ${(metadata.channelMeans || []).join(', ')}`
  ].join('; ');
}

module.exports = { generateVariants };
