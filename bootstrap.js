const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

require('./main.js');

const DEFAULT_BASE_URL = 'https://qr.revolearning.online';
const configPath = () => path.join(app.getPath('userData'), 'qr-queue-config.json');
const receivedJobsPath = () => path.join(app.getPath('userData'), 'qr-queue-received.json');
const QR_POLL_MS = 3000;
const QR_WORKER_ID = () => `revo-print-shop-${process.pid}`;
let qrPollTimer = null;
let qrPollBusy = false;
const receivingJobs = new Set();

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

function normalizeJob(job, fallbackStatus = 'uploaded') {
  return {
    jobId: job?.jobId || job?.id,
    filename: job?.filename || job?.fileName || 'PDF',
    size: Number(job?.size || 0),
    createdAt: job?.createdAt || job?.receivedAt || null,
    status: job?.status || fallbackStatus,
    workerId: job?.workerId || job?.claimedBy || job?.worker || null,
    message: job?.message || ''
  };
}

async function qrRequest(pathname, options = {}) {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error('API key QR Queue belum diatur.');
  const url = `${cfg.baseUrl}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'X-API-Key': cfg.apiKey, ...(options.headers || {}) },
    body: options.body,
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
    const err = new Error(`QR Queue gagal: ${detail}`);
    err.statusCode = response.status;
    throw err;
  }
  return response;
}

ipcMain.handle('remote-queue-get-config', async () => {
  const cfg = readConfig();
  return { baseUrl: cfg.baseUrl, hasApiKey: Boolean(cfg.apiKey) };
});

ipcMain.handle('remote-queue-save-config', async (_event, input) => writeConfig(input));

async function getJobsByStatus(status) {
  const safeStatus = String(status || '').trim();
  if (!/^[a-z]+$/i.test(safeStatus)) throw new Error('Status QR Queue tidak valid.');
  const response = await qrRequest(`/api/jobs?status=${encodeURIComponent(safeStatus)}`);
  const body = await response.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
  return jobs.map(job => normalizeJob(job, safeStatus)).filter(job => job.jobId);
}

async function getUploadedJobs() {
  return getJobsByStatus('uploaded');
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

async function claimRemoteJob(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!/^RP-[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: QR_WORKER_ID() })
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return body && typeof body === 'object' ? body : { ok: true, jobId: safeJobId, status: 'processing', workerId: QR_WORKER_ID() };
}

ipcMain.handle('remote-queue-claim', async (_event, jobId) => claimRemoteJob(jobId));

async function downloadRemoteJob(jobId, fileNameHint = '') {
  const safeJobId = String(jobId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/file`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('PDF QR Queue kosong.');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf') && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Server QR Queue tidak mengembalikan PDF.');

  let fileName = path.basename(String(fileNameHint || `${safeJobId}.pdf`)).replace(/[^\w .()\-]/g, '_');
  if (!/\.pdf$/i.test(fileName)) fileName = `${fileName}.pdf`;
  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop', 'qr-queue');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, `${safeJobId}-${Date.now()}.pdf`);
  fs.writeFileSync(outputPath, bytes);
  return { path: outputPath, name: fileName, url: `file://${outputPath.replace(/\\/g, '/')}`, size: bytes.length, jobId: safeJobId, source: readConfig().baseUrl };
}

ipcMain.handle('remote-queue-download', async (_event, jobId) => downloadRemoteJob(jobId));

function sendReceivedFile(file) {
  const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  if (!windows.length) return false;
  for (const win of windows) win.webContents.send('qr-pdf-received', file);
  return true;
}

async function receiveClaimedJob(job) {
  const jobId = String(job?.jobId || '').trim();
  if (!jobId || receivingJobs.has(jobId)) return false;
  receivingJobs.add(jobId);
  let file = null;
  try {
    file = await downloadRemoteJob(jobId, job.filename);
    if (!sendReceivedFile(file)) throw new Error('Jendela Revo Print Shop belum tersedia.');
    markReceived(jobId);
    return true;
  } catch (err) {
    if (file?.path) { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {} }
    throw err;
  } finally {
    receivingJobs.delete(jobId);
  }
}

async function claimAndReceive(job) {
  const jobId = String(job?.jobId || '').trim();
  if (!jobId || receivingJobs.has(jobId) || readReceivedJobs().includes(jobId)) return false;
  try {
    const claim = await claimRemoteJob(jobId);
    const claimedJob = normalizeJob(claim?.job || claim, 'processing');
    if (claimedJob.jobId && claimedJob.status && !['processing', 'claimed'].includes(String(claimedJob.status).toLowerCase())) {
      throw new Error(`Claim job ditolak: status=${claimedJob.status}`);
    }
    return await receiveClaimedJob({ ...job, ...claimedJob, jobId, status: 'processing' });
  } catch (err) {
    if (err?.statusCode === 409) return false;
    throw err;
  }
}

async function recoverOwnProcessingJobs() {
  const jobs = await getJobsByStatus('processing');
  const workerId = QR_WORKER_ID();
  for (const job of jobs.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
    if (readReceivedJobs().includes(String(job.jobId))) continue;
    if (job.workerId && String(job.workerId) !== workerId) continue;
    if (!job.workerId) continue;
    try {
      const done = await receiveClaimedJob(job);
      if (done) return true;
    } catch (err) {
      console.error('[QR Queue] Processing recovery failed:', job.jobId, err?.message || err);
    }
  }
  return false;
}

async function autoReceiveQrJobs() {
  if (qrPollBusy) return;
  qrPollBusy = true;
  try {
    const recovered = await recoverOwnProcessingJobs();
    if (recovered) return;

    const jobs = await getUploadedJobs();
    const received = new Set(readReceivedJobs());
    for (const job of jobs.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
      const jobId = String(job.jobId || '').trim();
      if (!jobId || received.has(jobId) || receivingJobs.has(jobId)) continue;
      try {
        const done = await claimAndReceive(job);
        if (done) break;
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
