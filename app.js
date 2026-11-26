import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

const fileInput = document.querySelector('#videoFile');
const video = document.querySelector('#preview');
const videoArea = document.querySelector('#videoArea');
const meta = document.querySelector('#videoMeta');
const cutBtn = document.querySelector('#cutBtn');
const status = document.querySelector('#status');
const downloadArea = document.querySelector('#downloadArea');
const downloadLink = document.querySelector('#downloadLink');
const startInput = document.querySelector('#startTime');
const endInput = document.querySelector('#endTime');
let sourceFile = null;
let sourceRemoteUrl = null;
let sourceUrl = null;
let ffmpeg = null;
let ffmpegLoading = null;
let outputUrl = null;

function setStatus(message) { status.textContent = message; }
function parseTime(value) {
  const parts = value.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return NaN;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function showVideo(fileOrUrl, name, sizeText = '') {
  if (sourceUrl && sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
  sourceUrl = fileOrUrl.startsWith?.('blob:') ? fileOrUrl : fileOrUrl;
  video.src = sourceUrl;
  videoArea.classList.remove('hidden');
  meta.textContent = `${name}${sizeText ? ` · ${sizeText}` : ''}`;
  cutBtn.disabled = false;
  downloadArea.classList.add('hidden');
  setStatus('Video loaded. Enter the start and end times.');
}
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('video/')) { setStatus('Please choose a video file.'); return; }
  sourceFile = file;
  sourceRemoteUrl = null;
  const url = URL.createObjectURL(file);
  showVideo(url, file.name, `${(file.size / 1024 / 1024).toFixed(1)} MB`);
});

document.querySelector('#loadUrl').addEventListener('click', () => {
  const url = document.querySelector('#videoUrl').value.trim();
  if (!url) { setStatus('Paste a direct video URL first.'); return; }
  try { new URL(url); } catch { setStatus('That URL does not look valid.'); return; }
  sourceFile = null;
  sourceRemoteUrl = url;
  showVideo(url, 'Video from link');
  video.onerror = () => setStatus('Could not load this link. Use a direct video URL that allows browser access (CORS).');
  video.onloadedmetadata = () => { video.onerror = null; };
});

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    const instance = new FFmpeg();
    instance.on('log', ({ message }) => { if (message) setStatus(message.slice(0, 120)); });
    instance.on('progress', ({ progress }) => setStatus(`Processing video… ${Math.round(progress * 100)}%`));
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await instance.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpeg = instance;
    return instance;
  })();
  try { return await ffmpegLoading; } finally { ffmpegLoading = null; }
}

cutBtn.addEventListener('click', async () => {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { setStatus('Check the time format. Use HH:MM:SS and make end later than start.'); return; }
  if (!sourceFile && !sourceRemoteUrl) { setStatus('Choose a video file or a direct video URL first.'); return; }
  if (end > video.duration) { setStatus('End time is longer than the video duration.'); return; }
  cutBtn.disabled = true;
  downloadArea.classList.add('hidden');
  try {
    setStatus('Loading video engine. First use may take a little while…');
    if (!sourceFile && sourceRemoteUrl) {
      setStatus('Fetching the direct video link…');
      const response = await fetch(sourceRemoteUrl);
      if (!response.ok) throw new Error('Video link could not be fetched');
      const remoteBlob = await response.blob();
      if (!remoteBlob.type.startsWith('video/') && remoteBlob.size === 0) throw new Error('URL did not return a video');
      sourceFile = new File([remoteBlob], 'ard-source.mp4', { type: remoteBlob.type || 'video/mp4' });
    }
    const engine = await getFFmpeg();
    const inputName = `input-${Date.now()}.${(sourceFile.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '')}`;
    const outputName = 'ard-cut.mp4';
    await engine.writeFile(inputName, new Uint8Array(await sourceFile.arrayBuffer()));
    setStatus('Cutting your video…');
    await engine.exec(['-ss', String(start), '-i', inputName, '-t', String(end - start), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', outputName]);
    const data = await engine.readFile(outputName);
    const blob = new Blob([data], { type: 'video/mp4' });
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    downloadLink.href = outputUrl;
    downloadArea.classList.remove('hidden');
    setStatus('Finished. Your MP4 clip is ready to download.');
    await engine.deleteFile(inputName);
    await engine.deleteFile(outputName);
  } catch (error) {
    console.error(error);
    setStatus(sourceRemoteUrl && !sourceFile ? 'Could not access this link. The host may block browser access (CORS). Try downloading the video and uploading it.' : 'Could not process this video. Try a smaller MP4 file or another browser.');
  } finally { cutBtn.disabled = false; }
});

window.addEventListener('beforeunload', () => {
  if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
});
