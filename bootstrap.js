const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

require('./main.js');

const DEFAULT_BASE_URL = 'https://qr.revolearning.online';
const configPath = () => path.join(app.getPath('userData'), 'qr-queue-config.json');
const receivedJobsPath = () => path.join(app.getPath('userData'), 'qr-queue-received.json');
const QR_POLL_MS = 3000;
let qrPollTimer = null;
let qrPollBusy = false;

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

function readReceivedJobs() {
  try {
    if (!fs.existsSync(receivedJobsPath())) return [];
    const value = JSON.parse(fs.readFileSync(receivedJobsPath(), 'utf8'));
    return Array.isArray(value) ? value.filter(Boolean).map(String).slice(-500) : [];
  } catch { return []; }
}

function markReceived(jobId) {
  const ids = readReceivedJobs();
  if (!ids.includes(jobId)) ids.push(jobId);
  fs.mkdirSync(path.dirname(receivedJobsPath()), { recursive: true });
  fs.writeFileSync(receivedJobsPath(), JSON.stringify(ids.slice(-500), null, 2), 'utf8');
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

async function getUploadedJobs() {
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

ipcMain.handle('remote-queue-list', async () => getUploadedJobs());

ipcMain.handle('remote-queue-delete', async (_event, jobId) => {
  const safeJobId = String(jobId || '').trim();
  if (!/^RP-[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}`, { method: 'DELETE' });
  let body = null;
  try { body = await response.json(); } catch {}
  return { ok: true, jobId: safeJobId, ...(body && typeof body === 'object' ? body : {}) };
});

async function downloadRemoteJob(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/file`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('PDF QR Queue kosong.');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf') && bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('Server QR Queue tidak mengembalikan PDF.');

  const cfg = readConfig();
  let fileName = `${safeJobId}.pdf`;
  try {
    const jobs = await getUploadedJobs();
    const remoteJob = jobs.find(j => String(j.jobId) === safeJobId);
    fileName = path.basename(String(remoteJob?.filename || remoteJob?.fileName || fileName)).replace(/[^\w .()\-]/g, '_');
  } catch {}

  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop', 'qr-queue');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, `${safeJobId}-${Date.now()}.pdf`);
  fs.writeFileSync(outputPath, bytes);
  return { path: outputPath, name: fileName, url: `file://${outputPath.replace(/\\/g, '/')}`, size: bytes.length, jobId: safeJobId, source: cfg.baseUrl };
}

ipcMain.handle('remote-queue-download', async (_event, jobId) => downloadRemoteJob(jobId));

async function autoReceiveQrJobs() {
  if (qrPollBusy) return;
  qrPollBusy = true;
  try {
    const jobs = await getUploadedJobs();
    const received = new Set(readReceivedJobs());
    for (const job of jobs.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))) ) {
      const jobId = String(job.jobId || '').trim();
      if (!jobId || received.has(jobId)) continue;
      try {
        const file = await downloadRemoteJob(jobId);
        markReceived(jobId);
        received.add(jobId);
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('qr-pdf-received', file);
        }
        break;
      } catch (err) {
        console.error('[QR Queue] Auto receive failed:', jobId, err?.message || err);
      }
    }
  } catch (err) {
    if (!String(err?.message || '').includes('API key')) console.error('[QR Queue] Poll failed:', err?.message || err);
  } finally {
    qrPollBusy = false;
  }
}

function startQrQueueWatcher() {
  if (qrPollTimer) return;
  qrPollTimer = setInterval(autoReceiveQrJobs, QR_POLL_MS);
  setTimeout(autoReceiveQrJobs, 1200);
}

app.whenReady().then(startQrQueueWatcher);
