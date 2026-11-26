
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
let outputUrl = null;
let ffmpeg = null;
let ffmpegLoading = null;
let lastFFmpegError = '';

function setStatus(message) {
  status.textContent = message;
}

function parseTime(value) {
  const parts = value.trim().split(':').map(Number);

  if (
    parts.length !== 3 ||
    parts.some(n => !Number.isFinite(n) || n < 0)
  ) {
    return NaN;
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function showVideo(url, name, sizeText = '') {
  if (sourceUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(sourceUrl);
  }

  sourceUrl = url;
  video.src = url;
  video.load();

  videoArea.classList.remove('hidden');
  meta.textContent = `${name}${sizeText ? ` · ${sizeText}` : ''}`;

  downloadArea.classList.add('hidden');
  cutBtn.disabled = false;

  setStatus('Video loaded successfully.');
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];

  if (!file) return;

  const isVideo =
    file.type.startsWith('video/') ||
    /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name);

  if (!isVideo) {
    setStatus('Please choose a valid video file.');
    return;
  }

  sourceFile = file;
  sourceRemoteUrl = null;

  const url = URL.createObjectURL(file);

  showVideo(
    url,
    file.name,
    `${(file.size / 1024 / 1024).toFixed(1)} MB`
  );
});

document.querySelector('#loadUrl').addEventListener('click', () => {
  const url = document.querySelector('#videoUrl').value.trim();

  if (!url) {
    setStatus('Paste a direct video URL first.');
    return;
  }

  try {
    new URL(url);
  } catch {
    setStatus('Invalid video URL.');
    return;
  }

  sourceFile = null;
  sourceRemoteUrl = url;

  showVideo(url, 'Video from link');

  video.onerror = () => {
    setStatus('Could not load link. The website may block browser access (CORS).');
  };
});

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const instance = new FFmpeg();

    instance.on('log', ({ message }) => {
      if (message && /error|failed|not found/i.test(message)) {
        lastFFmpegError = message;
        console.error('FFmpeg:', message);
      }
    });

    instance.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) {
        setStatus(
          `Processing video... ${Math.round(progress * 100)}%`
        );
      }
    });

    const base =
      'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

    setStatus('Loading video engine...');

    await instance.load({
      coreURL: await toBlobURL(
        `${base}/ffmpeg-core.js`,
        'text/javascript'
      ),
      wasmURL: await toBlobURL(
        `${base}/ffmpeg-core.wasm`,
        'application/wasm'
      )
    });

    ffmpeg = instance;
    return instance;
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

cutBtn.addEventListener('click', async () => {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    setStatus('Invalid time. Use HH:MM:SS and make end later than start.');
    return;
  }

  if (!sourceFile && !sourceRemoteUrl) {
    setStatus('Please upload a video first.');
    return;
  }

  if (!Number.isFinite(video.duration)) {
    setStatus('Please wait until the video has loaded.');
    return;
  }

  if (end > video.duration) {
    setStatus('End time is longer than the video duration.');
    return;
  }

  cutBtn.disabled = true;
  downloadArea.classList.add('hidden');

  let engine;
  let inputName;
  const outputName = `ard-cut-${Date.now()}.mp4`;

  try {
    if (!sourceFile && sourceRemoteUrl) {
      setStatus('Downloading video from link...');

      const response = await fetch(sourceRemoteUrl);

      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error('The video file is empty.');
      }

      sourceFile = new File(
        [blob],
        'ard-source.mp4',
        { type: blob.type || 'video/mp4' }
      );
    }

    engine = await getFFmpeg();

    lastFFmpegError = '';

    const extension =
      sourceFile.name.split('.').pop().toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'mp4';

    inputName = `ard-input-${Date.now()}.${extension}`;

    setStatus('Preparing video...');

    const fileData = new Uint8Array(
      await sourceFile.arrayBuffer()
    );

    await engine.writeFile(inputName, fileData);

    setStatus('Cutting your video...');

    const exitCode = await engine.exec([
      '-ss', String(start),
      '-i', inputName,
      '-t', String(end - start),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'mpeg4',
      '-q:v', '5',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-threads', '1',
      '-movflags', '+faststart',
      '-f', 'mp4',
      outputName
    ]);

    if (exitCode !== 0) {
      throw new Error(
        lastFFmpegError || `FFmpeg exit code: ${exitCode}`
      );
    }

    setStatus('Preparing your download...');

    const data = await engine.readFile(outputName);

    if (!data || data.length === 0) {
      throw new Error('The output video is empty.');
    }

    const blob = new Blob(
      [data],
      { type: 'video/mp4' }
    );

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
    }

    outputUrl = URL.createObjectURL(blob);

    downloadLink.href = outputUrl;
    downloadLink.download = 'ARD-Cut-Video.mp4';

    downloadArea.classList.remove('hidden');

    setStatus('Success! Your MP4 video is ready.');

  } catch (error) {
    console.error('ARD Video Cutter Error:', error);

    setStatus(
      `Processing failed: ${error?.message || String(error)}`
    );

  } finally {
    if (engine) {
      try {
        if (inputName) await engine.deleteFile(inputName);
      } catch (e) {
        console.warn('Input cleanup:', e);
      }

      try {
        await engine.deleteFile(outputName);
      } catch (e) {
        console.warn('Output cleanup:', e);
      }
    }

    cutBtn.disabled = false;
  }
});

window.addEventListener('beforeunload', () => {
  if (sourceUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(sourceUrl);
  }

  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
  }
});
      
