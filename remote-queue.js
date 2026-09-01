const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_BASE_URL = 'https://qr.revolearning.online';
const CONFIG_FILE = 'remote-queue.json';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('Alamat QR Queue harus menggunakan HTTPS.');
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password) throw new Error('Alamat QR Queue tidak boleh berisi username/password.');
  return baseUrl;
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const data = JSON.parse(raw);
    return {
      baseUrl: normalizeBaseUrl(data.baseUrl || DEFAULT_BASE_URL),
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      consumedJobIds: Array.isArray(data.consumedJobIds) ? data.consumedJobIds.filter(Boolean).slice(-500) : []
    };
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, apiKey: '', consumedJobIds: [] };
  }
}

function writeConfig(data) {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${configPath()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({
    baseUrl: normalizeBaseUrl(data.baseUrl || DEFAULT_BASE_URL),
    apiKey: String(data.apiKey || ''),
    consumedJobIds: Array.isArray(data.consumedJobIds) ? data.consumedJobIds.filter(Boolean).slice(-500) : []
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, configPath());
}

function requireApiKey(config) {
  if (!config.apiKey) throw new Error('API key QR Queue belum diatur.');
  return config.apiKey;
}

async function requestJson(url, apiKey) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    redirect: 'error'
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = body?.error || body?.message || `QR Queue HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function sanitizeFilename(name) {
  const clean = path.basename(String(name || 'remote-job.pdf')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean || 'remote-job'}.pdf`;
}

function extractFilename(contentDisposition) {
  const value = String(contentDisposition || '');
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try { return sanitizeFilename(decodeURIComponent(utf8[1].replace(/^"|"$/g, ''))); } catch {}
  }
  const quoted = value.match(/filename\s*=\s*"([^"]+)"/i);
  if (quoted) return sanitizeFilename(quoted[1]);
  const plain = value.match(/filename\s*=\s*([^;]+)/i);
  return plain ? sanitizeFilename(plain[1].trim()) : 'remote-job.pdf';
}

async function downloadJob(jobId) {
  const config = readConfig();
  const apiKey = requireApiKey(config);
  const safeJobId = String(jobId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeJobId)) throw new Error('Job ID tidak valid.');

  const url = `${config.baseUrl}/api/jobs/${encodeURIComponent(safeJobId)}/file`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/pdf', 'Cache-Control': 'no-cache' },
    redirect: 'error'
  });
  if (!response.ok) {
    let message = `Gagal mengambil PDF (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      message = body?.error || body?.message || message;
    } catch {}
    throw new Error(message);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error('PDF melebihi batas 50 MB.');

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('PDF melebihi batas 50 MB.');
  if (!bytes.subarray(0, 5).toString('ascii').startsWith('%PDF-')) throw new Error('Server tidak mengirim file PDF yang valid.');
  if (contentType && !contentType.includes('application/pdf') && !contentType.includes('octet-stream')) {
    throw new Error('Server mengirim tipe file yang bukan PDF.');
  }

  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop', 'qr-queue');
  fs.mkdirSync(tempDir, { recursive: true });
  const filename = extractFilename(response.headers.get('content-disposition'));
  const outputPath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${filename}`);
  fs.writeFileSync(outputPath, bytes, { mode: 0o600 });

  const next = readConfig();
  if (!next.consumedJobIds.includes(safeJobId)) next.consumedJobIds.push(safeJobId);
  writeConfig(next);

  return {
    path: outputPath,
    name: filename,
    size: bytes.length,
    jobId: safeJobId,
    url: `file://${outputPath.replace(/\\/g, '/')}`
  };
}

ipcMain.handle('remote-queue-get-config', async () => {
  const config = readConfig();
  return { baseUrl: config.baseUrl, hasApiKey: Boolean(config.apiKey) };
});

ipcMain.handle('remote-queue-save-config', async (_event, payload) => {
  const current = readConfig();
  const baseUrl = normalizeBaseUrl(payload?.baseUrl || DEFAULT_BASE_URL);
  const suppliedKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  const apiKey = suppliedKey || current.apiKey;
  if (!apiKey) throw new Error('API key belum diisi.');
  writeConfig({ ...current, baseUrl, apiKey });
  return { ok: true, baseUrl, hasApiKey: true };
});

ipcMain.handle('remote-queue-list', async () => {
  const config = readConfig();
  const apiKey = requireApiKey(config);
  const body = await requestJson(`${config.baseUrl}/api/jobs?status=uploaded`, apiKey);
  const jobs = Array.isArray(body?.jobs) ? body.jobs : Array.isArray(body) ? body : [];
  const consumed = new Set(config.consumedJobIds);
  return jobs.filter(job => job && job.jobId && !consumed.has(String(job.jobId))).map(job => ({
    jobId: String(job.jobId),
    filename: String(job.filename || job.fileName || 'PDF'),
    size: Number(job.size || 0),
    createdAt: job.createdAt || null,
    status: job.status || 'uploaded'
  }));
});

ipcMain.handle('remote-queue-download', async (_event, jobId) => downloadJob(jobId));
