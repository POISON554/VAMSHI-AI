const crypto = require('crypto');

const DEFAULT_WORKFLOW_URL = 'https://huggingface.co/PoopMan333/H3_Character_Sheet_Generator/raw/main/H3_CharSheetMaker_4_Panel_%28Faster%29.json';

const H3_AUTO_PROMPT = `Analyze the single uploaded reference automatically. Build a consistent character/reference-sheet interpretation from it. Preserve the reference subject's identity, visual style, colors, materials, clothing, distinctive details and overall design language. Create a clean four-view turnaround/reference sheet with consistent identity across all views. Do not add text, labels, logos, signatures, watermarks or unrelated objects. The uploaded reference is the only user-provided reference; do not ask the user for a prompt.`;

async function generateH3Variants({ imageBuffer, metadata, seedBase }) {
  const baseUrl = String(process.env.COMFYUI_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw Object.assign(new Error('Missing COMFYUI_URL'), {
      statusCode: 503,
      publicMessage: 'H3 is selected, but COMFYUI_URL is not configured. VAMSHI AI needs a GPU ComfyUI server to run MiniMax H3.'
    });
  }

  const workflowUrl = process.env.H3_WORKFLOW_URL || DEFAULT_WORKFLOW_URL;
  const clientId = crypto.randomUUID();
  const workflow = await fetchJson(workflowUrl);
  const uploadedName = await uploadImage(baseUrl, imageBuffer);
  const results = [];

  for (let i = 0; i < 4; i++) {
    const seed = seedBase + i * 7919;
    const uiWorkflow = JSON.parse(JSON.stringify(workflow));
    patchH3Workflow(uiWorkflow, uploadedName, metadata, seed, i);
    const apiPrompt = uiWorkflowToApiPrompt(uiWorkflow);

    const queued = await postJson(`${baseUrl}/prompt`, {
      prompt: apiPrompt,
      client_id: clientId
    });

    if (!queued.prompt_id) {
      throw Object.assign(new Error('ComfyUI did not return a prompt id'), {
        statusCode: 502,
        publicMessage: 'The H3 GPU server rejected the workflow. Check the ComfyUI logs and installed H3 custom nodes.'
      });
    }

    const history = await waitForHistory(baseUrl, queued.prompt_id);
    const image = await findFirstOutputImage(baseUrl, history);
    if (!image) {
      throw Object.assign(new Error('No H3 output image'), {
        statusCode: 502,
        publicMessage: 'H3 finished without returning a character-sheet image. Check the ComfyUI workflow output node.'
      });
    }

    results.push({
      index: i + 1,
      seed,
      dataUrl: `data:${image.mime};base64,${image.base64}`
    });
  }

  return results;
}

function patchH3Workflow(workflow, uploadedName, metadata, seed, variationIndex) {
  const nodes = workflow.nodes || [];
  const byId = new Map(nodes.map(n => [Number(n.id), n]));

  // The published 4-panel workflow uses LoadImage nodes 137 and 251 as its
  // two active reference slots; node 253 is bypassed in the supplied workflow.
  for (const id of [137, 251]) {
    const node = byId.get(id);
    if (node) {
      node.widgets_values_named = node.widgets_values_named || {};
      node.widgets_values_named.image = uploadedName;
      node.widgets_values_named.upload = 'image';
      if (Array.isArray(node.widgets_values)) node.widgets_values[0] = uploadedName;
    }
  }

  const inputPrompt = byId.get(138);
  if (inputPrompt) {
    const text = `${H3_AUTO_PROMPT}\n\nAutomatic reference analysis: ${describeMetadata(metadata)}\n\nVariation ${variationIndex + 1}: create a fresh but identity-consistent arrangement and camera interpretation.`;
    inputPrompt.widgets_values_named = inputPrompt.widgets_values_named || {};
    inputPrompt.widgets_values_named.value = text;
    if (Array.isArray(inputPrompt.widgets_values)) inputPrompt.widgets_values[0] = text;
  }

  const seedNode = byId.get(129);
  if (seedNode) {
    seedNode.widgets_values_named = seedNode.widgets_values_named || {};
    seedNode.widgets_values_named.noise_seed = seed;
    if (Array.isArray(seedNode.widgets_values)) seedNode.widgets_values[0] = seed;
  }

  const resolution = byId.get(115);
  if (resolution) {
    const ratio = Number(metadata.aspectRatio || 1);
    const aspect = ratio >= 1 ? '16:9 (Landscape Widescreen)' : '9:16 (Portrait Widescreen)';
    resolution.widgets_values_named = resolution.widgets_values_named || {};
    resolution.widgets_values_named.aspect_ratio = aspect;
    resolution.widgets_values_named.megapixels = 0.4;
    resolution.widgets_values_named.multiple = 32;
    if (Array.isArray(resolution.widgets_values)) {
      resolution.widgets_values[0] = aspect;
      resolution.widgets_values[1] = 0.4;
      resolution.widgets_values[2] = 32;
    }
  }
}

function uiWorkflowToApiPrompt(workflow) {
  const nodes = (workflow.nodes || []).filter(n => Number(n.mode || 0) !== 4);
  const linkMap = new Map();
  for (const node of nodes) {
    for (const output of node.outputs || []) {
      for (const linkId of output.links || []) {
        linkMap.set(Number(linkId), [String(node.id), outputIndex(node, output)]);
      }
    }
  }

  const prompt = {};
  for (const node of nodes) {
    const type = String(node.type || '');
    if (!type || ['Note', 'MarkdownNote'].includes(type)) continue;
    if (type === 'PrimitiveNode') continue;

    const inputs = {};
    for (const input of node.inputs || []) {
      const name = input.name;
      if (!name) continue;

      if (input.link != null) {
        const source = linkMap.get(Number(input.link));
        if (source) inputs[name] = source;
        continue;
      }

      if (input.type === 'IMAGEUPLOAD') continue;
      if (!input.widget) continue;

      const named = node.widgets_values_named || {};
      if (Object.prototype.hasOwnProperty.call(named, name)) {
        inputs[name] = named[name];
      }
    }

    prompt[String(node.id)] = { class_type: type, inputs };
  }
  return prompt;
}

function outputIndex(node, output) {
  const outputs = node.outputs || [];
  const index = outputs.indexOf(output);
  return Math.max(0, index);
}

async function uploadImage(baseUrl, buffer) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: 'image/png' }), `reference-${crypto.randomUUID()}.png`);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw providerError(response, 'ComfyUI image upload failed.');
  const json = await response.json();
  if (!json.name) throw new Error('ComfyUI did not return an uploaded filename.');
  return json.name;
}

async function waitForHistory(baseUrl, promptId) {
  const timeoutMs = Number(process.env.COMFYUI_TIMEOUT_MS || 900000);
  const intervalMs = Number(process.env.COMFYUI_POLL_MS || 2500);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
    if (response.ok) {
      const data = await response.json();
      const entry = data[promptId];
      if (entry) {
        const status = entry.status || {};
        if (status.status_str === 'error' || status.status_str === 'failed') {
          throw Object.assign(new Error('ComfyUI execution failed'), {
            statusCode: 502,
            publicMessage: 'H3 generation failed inside ComfyUI. Check the ComfyUI console for the missing node/model/error.'
          });
        }
        if (entry.outputs && Object.keys(entry.outputs).length) return entry;
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw Object.assign(new Error('ComfyUI timeout'), {
    statusCode: 504,
    publicMessage: 'H3 generation timed out. The 4-panel H3 workflow is GPU-heavy; check the GPU server or increase COMFYUI_TIMEOUT_MS.'
  });
}

async function findFirstOutputImage(baseUrl, history) {
  for (const output of Object.values(history.outputs || {})) {
    for (const image of output.images || []) {
      const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output'
      });
      const response = await fetch(`${baseUrl}/view?${query.toString()}`);
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const mime = response.headers.get('content-type') || 'image/png';
      return { mime, base64: buffer.toString('base64') };
    }
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw providerError(response, 'Could not download the H3 ComfyUI workflow.');
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw providerError(response, 'ComfyUI rejected the H3 workflow.');
  return response.json();
}

function providerError(response, fallback) {
  const error = new Error(fallback);
  error.statusCode = 502;
  error.publicMessage = fallback;
  return error;
}

function describeMetadata(m) {
  return [
    `aspect ratio ${m.aspectRatio}`,
    m.designFamily,
    m.paletteHint,
    m.compositionHint,
    `texture/detail score ${m.textureScore}/100`,
    `contrast score ${m.contrastScore}/100`
  ].join('; ');
}

module.exports = { generateH3Variants };
