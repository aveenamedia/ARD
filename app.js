
import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

// ARD ELEMENTS
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
const loadUrlBtn = document.querySelector('#loadUrl');
const videoUrlInput = document.querySelector('#videoUrl');

// STATE
let sourceFile = null;
let sourceRemoteUrl = null;
let sourceUrl = null;
let outputUrl = null;
let ffmpeg = null;
let ffmpegLoading = null;
let lastFFmpegError = '';

// STATUS
function setStatus(message) {
  if (status) status.textContent = message;
}

// TIME FORMAT
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

// SHOW VIDEO
function showVideo(url, name, sizeText = '') {
  if (sourceUrl && sourceUrl.startsWith('blob:')) {
    URL.revokeObjectURL(sourceUrl);
  }

  sourceUrl = url;
  video.src = url;
  video.load();

  videoArea.classList.remove('hidden');
  meta.textContent = `${name}${sizeText ? ` · ${sizeText}` : ''}`;

  downloadArea.classList.add('hidden');
  cutBtn.disabled = false;

  setStatus('Video loaded. Enter start and end times.');
}

// UPLOAD VIDEO
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];

  if (!file) return;

  const validVideo =
    file.type.startsWith('video/') ||
    /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name);

  if (!validVideo) {
    setStatus('Please select a valid video file.');
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

// LOAD DIRECT VIDEO URL
loadUrlBtn.addEventListener('click', () => {
  const url = videoUrlInput.value.trim();

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
    setStatus('Could not load this link. The host may block CORS.');
  };
});

// LOAD FFMPEG ENGINE
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const instance = new FFmpeg();

    instance.on('log', ({ message }) => {
      if (message) {
        console.log('ARD FFmpeg:', message);

        if (/error|failed/i.test(message)) {
          lastFFmpegError = message;
        }
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

    // IMPORTANT:
    // Load FFmpeg's main worker from the ARD website itself.
    // This avoids the cross-origin Worker error.
    const localWorkerURL =
      `${window.location.origin}/ffmpeg/worker.js`;

    setStatus('Loading ARD video engine...');

    await instance.load({
      classWorkerURL: localWorkerURL,

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

// CUT VIDEO
cutBtn.addEventListener('click', async () => {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    setStatus('Use HH:MM:SS. End time must be later than start.');
    return;
  }

  if (!sourceFile && !sourceRemoteUrl) {
    setStatus('Please upload a video first.');
    return;
  }

  if (!Number.isFinite(video.duration)) {
    setStatus('Please wait for the video to load.');
    return;
  }

  if (end > video.duration) {
    setStatus('End time is longer than the video duration.');
    return;
  }

  cutBtn.disabled = true;
  downloadArea.classList.add('hidden');

  let engine = null;
  let inputName = null;
  const outputName = `ard-output-${Date.now()}.mp4`;

  try {
    // FETCH DIRECT VIDEO LINK
    if (!sourceFile && sourceRemoteUrl) {
      setStatus('Downloading video link...');

      const response = await fetch(sourceRemoteUrl);

      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error('Downloaded video is empty.');
      }

      sourceFile = new File(
        [blob],
        'ard-source.mp4',
        { type: blob.type || 'video/mp4' }
      );
    }

    // LOAD ENGINE
    engine = await getFFmpeg();

    lastFFmpegError = '';

    const extension =
      sourceFile.name.split('.').pop()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'mp4';

    inputName = `ard-input-${Date.now()}.${extension}`;

    // WRITE VIDEO FILE
    setStatus('Preparing video...');

    const inputData = new Uint8Array(
      await sourceFile.arrayBuffer()
    );

    await engine.writeFile(inputName, inputData);

    // CUT VIDEO
    setStatus('Cutting video...');

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
        lastFFmpegError ||
        `FFmpeg failed. Exit code: ${exitCode}`
      );
    }

    // READ OUTPUT
    setStatus('Preparing download...');

    const data = await engine.readFile(outputName);

    if (!data || data.length === 0) {
      throw new Error('Output video is empty.');
    }

    const blob = new Blob(
      [data],
      { type: 'video/mp4' }
    );

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
    }

    outputUrl = URL.createObjectURL(blob);

    // DOWNLOAD
    downloadLink.href = outputUrl;
    downloadLink.download = 'ARD-Cut-Video.mp4';

    downloadArea.classList.remove('hidden');

    setStatus('Success! Your video is ready to download.');

  } catch (error) {
    console.error('ARD VIDEO CUTTER ERROR:', error);

    setStatus(
      `Processing failed: ${error?.message || String(error)}`
    );

  } finally {
    // CLEAN TEMPORARY FILES
    if (engine) {
      if (inputName) {
        try {
          await engine.deleteFile(inputName);
        } catch (error) {
          console.warn('Input cleanup failed:', error);
        }
      }

      try {
        await engine.deleteFile(outputName);
      } catch (error) {
        console.warn('Output cleanup failed:', error);
      }
    }

    cutBtn.disabled = false;
  }
});

// CLEAN MEMORY
window.addEventListener('beforeunload', () => {
  if (sourceUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(sourceUrl);
  }

  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
  }
});
        
