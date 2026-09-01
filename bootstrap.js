const { app, ipcMain } = require('electron');
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
const MAX_QR_PDF_BYTES = 50 * 1024 * 1024;
const configPath = () => path.join(app.getPath('userData'), 'qr-queue-config.json');

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

ipcMain.handle('remote-queue-get-config', async () => {
  const cfg = readConfig();
  return { baseUrl: cfg.baseUrl, hasApiKey: Boolean(cfg.apiKey) };
});

ipcMain.handle('remote-queue-save-config', async (_event, input) => writeConfig(input));

ipcMain.handle('remote-queue-list', async () => {
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
});

ipcMain.handle('remote-queue-download', async (_event, jobId) => {
  const safeJobId = String(jobId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/file`, { headers: { Accept: 'application/pdf' } });
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_QR_PDF_BYTES) throw new Error('PDF QR Queue melebihi batas 50 MB.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('PDF QR Queue kosong.');
  if (bytes.length > MAX_QR_PDF_BYTES) throw new Error('PDF QR Queue melebihi batas 50 MB.');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf') && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Server QR Queue tidak mengembalikan PDF.');

  const cfg = readConfig();
  const jobsResponse = await qrRequest('/api/jobs?status=uploaded');
  const jobsBody = await jobsResponse.json();
  const jobs = Array.isArray(jobsBody?.jobs) ? jobsBody.jobs : [];
  const remoteJob = jobs.find(j => String(j.jobId || j.id) === safeJobId) || {};
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
  return { path: outputPath, name: fileName, url: `file://${outputPath.replace(/\\/g, '/')}`, size: bytes.length, jobId: safeJobId, source: cfg.baseUrl };
});
