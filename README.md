# VAMSHI AI — Textile Variant Generator

VAMSHI AI turns **one reference image** into four fresh textile, fabric, motif, print, and surface-pattern variations. There is deliberately **no prompt box** for users.

## What is included

- JPG / JPEG / PNG / WEBP upload with an 8 MB default limit
- Automatic reference-image analysis using server-side image statistics
- Hidden generation instruction and four different variation directions
- Four fresh image-to-image generations per run
- New random seed on every Generate / Regenerate action
- Download and fullscreen preview for every result
- Regenerate all without uploading again
- Responsive premium UI
- Server-only API key handling
- Provider abstraction in `services/imageProvider.js` so another image API can be added later
- Safe API error handling and preserved reference image after failures

## Architecture

```text
VAMSHI-AI/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── services/
│   └── imageProvider.js
├── .env.example
├── package.json
├── server.js
└── README.md
```

## Image provider

The first adapter uses Hugging Face Inference Providers through `@huggingface/inference`. The default model is `black-forest-labs/FLUX.2-dev`, which supports image-to-image workflows through the Inference Providers API.

A Hugging Face token is required on the **server**. Do not put it in `public/`, frontend JavaScript, or any `NEXT_PUBLIC_*` variable.

Hugging Face notes that Inference Providers use available credits/provider billing; do not assume image generation is permanently unlimited or free.

## Local setup

Requires Node.js 20+.

```bash
npm install
copy .env.example .env
```

Open `.env` and set:

```env
HF_TOKEN=your_real_server_side_token
IMAGE_PROVIDER=huggingface
IMAGE_MODEL=black-forest-labs/FLUX.2-dev
PORT=3000
```

Then:

```bash
npm start
```

Open `http://localhost:3000`.

## Render deployment

Create a Render **Web Service** from this GitHub repository.

- Build command: `npm install`
- Start command: `npm start`
- Node: 20+
- Add environment variable `HF_TOKEN`
- Optional variables: `IMAGE_MODEL`, `IMAGE_GUIDANCE`, `IMAGE_STEPS`, `MAX_UPLOAD_MB`

Do not commit `.env` or a real token.

## User experience

```text
UPLOAD ONE IMAGE
       ↓
AUTOMATIC ANALYSIS
       ↓
GENERATE
       ↓
4 NEW RELATED DESIGNS
       ↓
REGENERATE
       ↓
4 FRESH DESIGNS
```

The application never asks the user to write a generation prompt. The prompt used by the provider is generated internally by the server and is not returned to the browser.

## Important quality note

The automatic analysis layer provides measurable image characteristics such as aspect ratio, brightness, channel statistics, contrast/detail score, palette relationship, and composition hints. The image-to-image model then uses the actual reference image plus those hidden instructions to create the variations. A future vision-model adapter can be added without changing the frontend.
