const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// V5.14.3: keep the QR upload page UI in its own module so future UI changes
// do not require editing the large main.js file. The loader swaps only the
// uploadPageHtml() implementation when main.js is compiled.
const mainJsPath = path.resolve(__dirname, 'main.js');
const originalJsLoader = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
  if (path.resolve(filename) !== mainJsPath) return originalJsLoader(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  const startMarker = 'function uploadPageHtml(token) {';
  const endMarker = '\nfunction findCloudflared()';
  const start = source.indexOf(startMarker);
  const end = start >= 0 ? source.indexOf(endMarker, start) : -1;
  if (start < 0 || end < 0) return originalJsLoader(module, filename);

  const replacement = "const { uploadPageHtml } = require('./qr-upload-ui');\n";
  const transformed = source.slice(0, start) + replacement + source.slice(end + 1);
  module._compile(transformed, filename);
};

require('./main.js');

const DEFAULT_BASE_URL = 'https://qr.revolearning.online';
const configPath = () => path.join(app.getPath('userData'), 'qr-queue-config.json');
const consumedJobsPath = () => path.join(app.getPath('userData'), 'qr-queue-consumed.json');
const AUTO_POLL_MS = 3000;
let autoReceiveTimer = null;
let autoReceiveBusy = false;

function readConfig() {
  const fallback = { baseUrl: DEFAULT_BASE_URL, apiKey: '' };
  try {
    if (!fs.existsSync(configPath())) return fallback;
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { baseUrl: String(parsed.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''), apiKey: String(parsed.apiKey || '') };
  } catch {
    return fallback;
  }
}

function writeConfig(input) {
  const current = readConfig();
  const baseUrl = String(input?.baseUrl || current.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const apiKey = input && Object.prototype.hasOwnProperty.call(input, 'apiKey') && String(input.apiKey) !== '' ? String(input.apiKey).trim() : current.apiKey;
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('Alamat QR Queue harus menggunakan HTTPS.');
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ baseUrl, apiKey }, null, 2), { encoding: 'utf8' });
  return { baseUrl, hasApiKey: Boolean(apiKey) };
}

function readConsumedJobs() {
  try {
    if (!fs.existsSync(consumedJobsPath())) return new Set();
    const parsed = JSON.parse(fs.readFileSync(consumedJobsPath(), 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberConsumedJob(jobId) {
  const set = readConsumedJobs();
  set.add(String(jobId));
  const values = Array.from(set).slice(-1000);
  fs.mkdirSync(path.dirname(consumedJobsPath()), { recursive: true });
  fs.writeFileSync(consumedJobsPath(), JSON.stringify(values, null, 2), 'utf8');
}

async function qrRequest(pathname, options = {}) {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error('API key QR Queue belum diatur.');
  const url = `${cfg.baseUrl}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'X-API-Key': cfg.apiKey, ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000)
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      if (contentType.includes('json')) {
        const body = await response.json();
        detail = body.error || body.message || detail;
      } else {
        const text = await response.text();
        if (text) detail = text.slice(0, 180);
      }
    } catch {}
    if (response.status === 401 || response.status === 403) throw new Error('API key QR Queue ditolak. Periksa Pengaturan QR Queue.');
    throw new Error(`QR Queue gagal: ${detail}`);
  }
  return response;
}

async function listRemoteJobs() {
  const response = await qrRequest('/api/jobs?status=uploaded');
  const body = await response.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
  return jobs.map(job => ({
    jobId: job.jobId || job.id,
    filename: job.filename || job.fileName || 'PDF',
    size: Number(job.size || 0),
    createdAt: job.createdAt || job.receivedAt || null,
    status: job.status || 'uploaded'
  })).filter(job => job.jobId);
}

ipcMain.handle('remote-queue-get-config', async () => {
  const cfg = readConfig();
  return { baseUrl: cfg.baseUrl, hasApiKey: Boolean(cfg.apiKey) };
});

ipcMain.handle('remote-queue-save-config', async (_event, input) => {
  const result = writeConfig(input);
  // Wake the watcher immediately after configuration is saved.
  setTimeout(() => autoReceiveOnce().catch(err => console.warn('QR auto receive:', err.message)), 50);
  return result;
});

ipcMain.handle('remote-queue-list', async () => listRemoteJobs());

async function downloadRemoteJob(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');

  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/file`, { headers: { Accept: 'application/pdf' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('PDF QR Queue kosong.');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf') && bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Server QR Queue tidak mengembalikan PDF.');
  }

  const jobs = await listRemoteJobs();
  const remoteJob = jobs.find(j => String(j.jobId) === safeJobId) || {};
  const fileName = path.basename(String(remoteJob.filename || remoteJob.fileName || `${safeJobId}.pdf`)).replace(/[^\w .()\-]/g, '_');

  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop', 'qr-queue');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, `${safeJobId}-${Date.now()}.pdf`);
  const tempPath = `${outputPath}.part`;
  try {
    fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
    fs.renameSync(tempPath, outputPath);
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw new Error(`Gagal menyimpan PDF QR Queue: ${err.message}`);
  }
  return { path: outputPath, name: fileName, url: `file://${outputPath.replace(/\\/g, '/')}`, size: bytes.length, jobId: safeJobId, source: readConfig().baseUrl };
}

ipcMain.handle('remote-queue-download', async (_event, jobId) => downloadRemoteJob(jobId));

async function autoReceiveOnce() {
  if (autoReceiveBusy) return false;
  const cfg = readConfig();
  if (!cfg.apiKey) return false;

  autoReceiveBusy = true;
  try {
    const jobs = await listRemoteJobs();
    const consumed = readConsumedJobs();
    const pending = jobs.filter(job => !consumed.has(String(job.jobId)));
    if (!pending.length) return false;

    // Oldest first: this keeps the desktop queue deterministic when several
    // phones upload PDFs close together.
    pending.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const job = pending[0];
    const file = await downloadRemoteJob(job.jobId);

    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (!win) return false;

    // Reuse the existing QR PDF event path in renderer.js. That path already
    // calls set-current-file and loadPdf(), so the normal preview opens automatically.
    win.webContents.send('qr-pdf-received', file);
    rememberConsumedJob(job.jobId);
    console.log(`[QR AUTO] ${job.jobId} -> ${file.name}`);
    return true;
  } catch (err) {
    console.warn('[QR AUTO] ' + (err?.message || String(err)));
    return false;
  } finally {
    autoReceiveBusy = false;
  }
}

function startAutoReceiveWatcher() {
  if (autoReceiveTimer) return;
  // Do not make startup depend on QR Queue being configured. The watcher simply
  // stays idle until an API key exists.
  autoReceiveOnce().catch(err => console.warn('[QR AUTO]', err.message));
  autoReceiveTimer = setInterval(() => {
    autoReceiveOnce().catch(err => console.warn('[QR AUTO]', err.message));
  }, AUTO_POLL_MS);
}

app.whenReady().then(() => {
  startAutoReceiveWatcher();
});

app.on('before-quit', () => {
  if (autoReceiveTimer) clearInterval(autoReceiveTimer);
  autoReceiveTimer = null;
});
