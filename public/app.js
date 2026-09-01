const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const emptyUpload = document.getElementById('emptyUpload');
const previewWrap = document.getElementById('previewWrap');
const preview = document.getElementById('preview');
const removeBtn = document.getElementById('removeBtn');
const generateBtn = document.getElementById('generateBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const results = document.getElementById('results');
const loading = document.getElementById('loading');
const loadingTitle = document.getElementById('loadingTitle');
const loadingText = document.getElementById('loadingText');
const errorBox = document.getElementById('errorBox');
const errorText = document.getElementById('errorText');
const retryBtn = document.getElementById('retryBtn');
const analysisCard = document.getElementById('analysisCard');
const analysisTags = document.getElementById('analysisTags');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const closeLightbox = document.getElementById('closeLightbox');
let referenceFile = null;
let busy = false;

fileInput.addEventListener('change', e => acceptFile(e.target.files[0]));
removeBtn.addEventListener('click', e => { e.preventDefault(); clearReference(); });
['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => acceptFile(e.dataTransfer.files[0]));
generateBtn.addEventListener('click', generate);
regenerateBtn.addEventListener('click', generate);
retryBtn.addEventListener('click', generate);
closeLightbox.addEventListener('click', () => lightbox.classList.add('hidden'));
lightbox.addEventListener('click', e => { if (e.target === lightbox) lightbox.classList.add('hidden'); });

document.addEventListener('keydown', e => { if (e.key === 'Escape') lightbox.classList.add('hidden'); });

function acceptFile(file) {
  if (!file) return;
  const valid = ['image/jpeg','image/png','image/webp'];
  if (!valid.includes(file.type)) return showError('Please choose JPG, JPEG, PNG, or WEBP.');
  if (file.size > 8 * 1024 * 1024) return showError('That image is larger than 8 MB.');
  referenceFile = file;
  preview.src = URL.createObjectURL(file);
  emptyUpload.classList.add('hidden');
  previewWrap.classList.remove('hidden');
  generateBtn.disabled = false;
  errorBox.classList.add('hidden');
}

function clearReference() {
  referenceFile = null;
  fileInput.value = '';
  preview.removeAttribute('src');
  previewWrap.classList.add('hidden');
  emptyUpload.classList.remove('hidden');
  generateBtn.disabled = true;
  regenerateBtn.classList.add('hidden');
  analysisCard.classList.add('hidden');
  results.innerHTML = '<div class="empty-result">Upload a reference to begin.</div>';
}

async function generate() {
  if (!referenceFile || busy) return;
  busy = true;
  setLoading(true);
  errorBox.classList.add('hidden');
  generateBtn.disabled = true;
  regenerateBtn.disabled = true;
  const body = new FormData();
  body.append('reference', referenceFile, referenceFile.name);
  try {
    const response = await fetch('/api/generate', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Generation failed.');
    renderResults(data.results || []);
    renderAnalysis(data.metadata || {});
    regenerateBtn.classList.remove('hidden');
  } catch (err) {
    showError(err.message || 'Generation failed.');
  } finally {
    busy = false;
    setLoading(false);
    generateBtn.disabled = false;
    regenerateBtn.disabled = false;
  }
}

function setLoading(on) {
  loading.classList.toggle('hidden', !on);
  results.classList.toggle('hidden', on);
  if (on) {
    loadingTitle.textContent = 'Analyzing your design...';
    loadingText.textContent = 'Understanding color, texture, motifs and repetition.';
    setTimeout(() => { if (busy) { loadingTitle.textContent = 'Creating 4 new variations...'; loadingText.textContent = 'Building fresh compositions from the same design family.'; } }, 1300);
  }
}

function renderResults(items) {
  results.innerHTML = '';
  if (!items.length) { results.innerHTML = '<div class="empty-result">No variations were returned.</div>'; return; }
  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'result-card';
    const img = document.createElement('img');
    img.className = 'result-image'; img.alt = `Generated variation ${item.index}`; img.src = item.dataUrl;
    img.addEventListener('click', () => openLightbox(item.dataUrl));
    const meta = document.createElement('div'); meta.className = 'result-meta';
    const label = document.createElement('span'); label.textContent = `Variation ${item.index}`;
    const actions = document.createElement('div'); actions.className = 'result-actions';
    const full = button('Fullscreen', () => openLightbox(item.dataUrl));
    const download = button('Download', () => downloadImage(item.dataUrl, `vamshi-ai-variation-${item.index}.png`));
    actions.append(full, download); meta.append(label, actions); card.append(img, meta); results.append(card);
  });
}

function button(text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); return b; }
function openLightbox(src) { lightboxImage.src = src; lightbox.classList.remove('hidden'); }
function downloadImage(dataUrl, name) { const a = document.createElement('a'); a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

function renderAnalysis(m) {
  analysisTags.innerHTML = '';
  const tags = [m.designFamily, m.paletteHint, m.compositionHint, `Texture ${m.textureScore ?? '—'}/100`, `Contrast ${m.contrastScore ?? '—'}/100`].filter(Boolean);
  tags.forEach(t => { const span = document.createElement('span'); span.textContent = t; analysisTags.appendChild(span); });
  analysisCard.classList.remove('hidden');
}

function showError(message) { errorText.textContent = message; errorBox.classList.remove('hidden'); results.classList.remove('hidden'); }
