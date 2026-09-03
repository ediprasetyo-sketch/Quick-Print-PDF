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

function readReceivedRecords() {
  try {
    if (!fs.existsSync(receivedJobsPath())) return [];
    const value = JSON.parse(fs.readFileSync(receivedJobsPath(), 'utf8'));
    if (!Array.isArray(value)) return [];
    return value.map(item => {
      if (typeof item === 'string') return { jobId: item };
      if (!item || typeof item !== 'object') return null;
      return {
        jobId: item.jobId || item.id || '',
        filename: item.filename || item.fileName || 'PDF',
        size: Number(item.size || 0),
        createdAt: item.createdAt || item.receivedAt || null,
        receivedAt: item.receivedAt || null,
        status: item.status || 'processing',
        message: item.message || '',
        updatedAt: item.updatedAt || item.receivedAt || item.createdAt || null,
        syncPending: Boolean(item.syncPending)
      };
    }).filter(item => item?.jobId).slice(-500);
  } catch { return []; }
}

function readReceivedJobs() {
  return readReceivedRecords().map(item => String(item.jobId));
}

function markReceived(job) {
  const jobId = String(job?.jobId || job?.id || '').trim();
  if (!jobId) return;
  const records = readReceivedRecords().filter(item => String(item.jobId) !== jobId);
  records.push({
    jobId,
    filename: job?.filename || job?.fileName || 'PDF',
    size: Number(job?.size || 0),
    createdAt: job?.createdAt || job?.receivedAt || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    status: 'processing',
    message: 'PDF diterima dan menunggu proses cetak.',
    updatedAt: new Date().toISOString(),
    syncPending: false
  });
  fs.mkdirSync(path.dirname(receivedJobsPath()), { recursive: true });
  fs.writeFileSync(receivedJobsPath(), JSON.stringify(records.slice(-500), null, 2), 'utf8');
}


function updateReceivedRecord(jobId, patch = {}) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return null;
  const records = readReceivedRecords();
  const index = records.findIndex(item => String(item.jobId) === safeJobId);
  const current = index >= 0 ? records[index] : { jobId: safeJobId };
  const next = { ...current, ...patch, jobId: safeJobId, updatedAt: patch.updatedAt || new Date().toISOString() };
  if (index >= 0) records[index] = next; else records.push(next);
  fs.mkdirSync(path.dirname(receivedJobsPath()), { recursive: true });
  fs.writeFileSync(receivedJobsPath(), JSON.stringify(records.slice(-500), null, 2), 'utf8');
  return next;
}

function forgetReceived(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const records = readReceivedRecords().filter(item => String(item.jobId) !== safeJobId);
  fs.mkdirSync(path.dirname(receivedJobsPath()), { recursive: true });
  fs.writeFileSync(receivedJobsPath(), JSON.stringify(records.slice(-500), null, 2), 'utf8');
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

async function getQueueJobs() {
  const [uploaded, processing] = await Promise.all([
    getJobsByStatus('uploaded'),
    getJobsByStatus('processing')
  ]);
  const receivedRecords = readReceivedRecords();
  const received = new Map(receivedRecords.map(record => [String(record.jobId), record]));
  const merged = new Map();

  for (const job of uploaded) merged.set(String(job.jobId), job);
  for (const job of processing) {
    const key = String(job.jobId);
    const local = received.get(key);
    if (!local) continue;
    const terminal = ['printed','error'].includes(String(local.status || '').toLowerCase());
    merged.set(key, terminal ? normalizeJob({ ...job, ...local, jobId:key }, local.status) : job);
  }

  // V1.5.2: once a job has been received by this desktop, keep it visible
  // until the user explicitly deletes it, even if the server later changes
  // the status away from processing.
  for (const record of receivedRecords) {
    const key = String(record.jobId);
    if (merged.has(key)) continue;
    merged.set(key, normalizeJob({ ...record, jobId: key, status: 'processing' }, 'processing'));
  }

  return [...merged.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function getUploadedJobs() {
  return getJobsByStatus('uploaded');
}


async function setRemoteJobStatus(jobId, status, message = '') {
  const safeJobId = String(jobId || '').trim();
  const safeStatus = String(status || '').trim().toLowerCase();
  if (!/^RP-[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  if (!['uploaded','processing','printed','error'].includes(safeStatus)) throw new Error('Status QR Queue tidak valid.');
  const payload = JSON.stringify({ status: safeStatus, message: String(message || '').slice(0, 500) });
  try {
    const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}/status`, { method:'POST', headers:{'Content-Type':'application/json'}, body:payload });
    let body = null; try { body = await response.json(); } catch {}
    updateReceivedRecord(safeJobId, { status:safeStatus, message:String(message || '').slice(0,500), syncPending:false });
    return { ok:true, jobId:safeJobId, status:safeStatus, ...(body && typeof body === 'object' ? body : {}) };
  } catch (err) {
    updateReceivedRecord(safeJobId, { status:safeStatus, message:String(message || '').slice(0,500), syncPending:true });
    return { ok:false, jobId:safeJobId, status:safeStatus, syncPending:true, error:err?.message || String(err) };
  }
}
ipcMain.handle('remote-queue-status', async (_event, input) => setRemoteJobStatus(input?.jobId, input?.status, input?.message));

ipcMain.handle('remote-queue-list', async () => getQueueJobs());

ipcMain.handle('remote-queue-delete', async (_event, jobId) => {
  const safeJobId = String(jobId || '').trim();
  if (!/^RP-[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID QR tidak valid.');
  try {
    const response = await qrRequest(`/api/jobs/${encodeURIComponent(safeJobId)}`, { method: 'DELETE' });
    let body = null;
    try { body = await response.json(); } catch {}
    forgetReceived(safeJobId);
    return { ok: true, jobId: safeJobId, ...(body && typeof body === 'object' ? body : {}) };
  } catch (err) {
    // A job already gone from NAS should also be removed from the local queue.
    if (err?.statusCode === 404) {
      forgetReceived(safeJobId);
      return { ok: true, jobId: safeJobId, alreadyDeleted: true };
    }
    throw err;
  }
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
    markReceived(job);
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


async function syncPendingTerminalStatuses() {
  const records = readReceivedRecords().filter(item => item?.syncPending && ['printed','error'].includes(String(item.status || '').toLowerCase()));
  for (const record of records.slice(0,10)) {
    try { await setRemoteJobStatus(record.jobId, record.status, record.message || ''); }
    catch (err) { console.error('[QR Queue] Terminal status sync failed:', record.jobId, err?.message || err); }
  }
}

async function autoReceiveQrJobs() {
  if (qrPollBusy) return;
  qrPollBusy = true;
  try {
    await syncPendingTerminalStatuses();
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

// QR_LIFECYCLE_V1_5_6
