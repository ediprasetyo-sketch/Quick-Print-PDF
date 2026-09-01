const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_BASE_URL = 'https://qr.revolearning.online';
const DEFAULT_API_KEY = 'REVO-QR-QUEUE-2026-CHANGE-ME';

function baseUrl() {
  return String(process.env.REVO_QR_API_BASE || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function apiKey() {
  return String(process.env.REVO_QR_API_KEY || DEFAULT_API_KEY);
}

async function requestJson(url, options = {}) {
  const headers = { ...(options.headers || {}), 'X-API-Key': apiKey(), Accept: 'application/json' };
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`QR Queue: ${message}`);
  }
  return data;
}

async function fetchJobs(status = 'uploaded') {
  const url = `${baseUrl()}/api/jobs?status=${encodeURIComponent(status)}`;
  const data = await requestJson(url);
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

async function downloadJob(jobId) {
  if (!jobId) throw new Error('Job ID kosong.');
  const encoded = encodeURIComponent(jobId);
  const candidates = [
    `${baseUrl()}/api/jobs/${encoded}/download`,
    `${baseUrl()}/api/jobs/${encoded}/file`,
    `${baseUrl()}/api/jobs/${encoded}/pdf`
  ];
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { 'X-API-Key': apiKey() } });
      if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) { lastError = new Error('File kosong.'); continue; }
      if (!type.includes('pdf') && bytes.subarray(0, 4).toString() !== '%PDF') {
        lastError = new Error('Response bukan PDF.'); continue;
      }
      const safeName = String(jobId).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempDir = path.join(os.tmpdir(), 'revo-print-shop', 'qr-queue');
      fs.mkdirSync(tempDir, { recursive: true });
      const filePath = path.join(tempDir, `${safeName}-${Date.now()}.pdf`);
      fs.writeFileSync(filePath, bytes);
      return { path: filePath, size: bytes.length, jobId };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Tidak dapat mengambil PDF Job ${jobId}. ${lastError?.message || ''}`.trim());
}

module.exports = { fetchJobs, downloadJob, baseUrl };
