const { contextBridge, ipcRenderer, webUtils } = require('electron');

const qrPdfCallbacks = new Set();

function notifyQrPdfReceived(file) {
  for (const callback of qrPdfCallbacks) {
    try { callback(file); } catch (err) { console.error('QR PDF callback failed:', err); }
  }
}

ipcRenderer.on('qr-pdf-received', (_event, file) => notifyQrPdfReceived(file));

async function openRemoteJob(jobId) {
  const file = await ipcRenderer.invoke('remote-queue-download', jobId);
  if (!file?.path) throw new Error('PDF dari QR Queue tidak berhasil diunduh.');
  await ipcRenderer.invoke('set-current-file', file.path);
  notifyQrPdfReceived(file);
  return file;
}

function addRemoteQueueUi() {
  if (document.getElementById('remoteQueueButton')) return;
  const qrBtn = document.getElementById('qrBtn');
  if (!qrBtn?.parentElement) return;

  const button = document.createElement('button');
  button.id = 'remoteQueueButton';
  button.className = qrBtn.className;
  button.innerHTML = '<span>QR Queue</span>';
  button.title = 'Ambil PDF dari antrean QR Internet';
  qrBtn.parentElement.insertBefore(button, qrBtn.nextSibling);

  const modal = document.createElement('div');
  modal.id = 'remoteQueueModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,30,28,.42);display:none;align-items:center;justify-content:center;z-index:99999;padding:24px;font-family:Inter,Arial,sans-serif';
  modal.innerHTML = `<div style="width:min(760px,96vw);max-height:82vh;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.22);overflow:hidden"><div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e7eeee"><div><b style="font-size:19px;color:#203335">QR Queue</b><div id="remoteQueueStatus" style="font-size:12px;color:#738284;margin-top:4px">Memuat antrean…</div></div><div style="display:flex;gap:8px"><button id="remoteQueueRefresh" style="border:1px solid #ccd7d7;background:#fff;border-radius:9px;padding:8px 12px;cursor:pointer">Refresh</button><button id="remoteQueueSettings" style="border:1px solid #ccd7d7;background:#fff;border-radius:9px;padding:8px 12px;cursor:pointer">Pengaturan</button><button id="remoteQueueClose" style="border:0;background:#eef4f3;border-radius:9px;padding:8px 12px;cursor:pointer">Tutup</button></div></div><div id="remoteQueueList" style="padding:16px 22px;overflow:auto;max-height:65vh"></div></div>`;
  document.body.appendChild(modal);

  const listEl = modal.querySelector('#remoteQueueList');
  const statusEl = modal.querySelector('#remoteQueueStatus');

  async function configure() {
    const current = await ipcRenderer.invoke('remote-queue-get-config');
    const base = window.prompt('Alamat QR Queue API:', current?.baseUrl || 'https://qr.revolearning.online');
    if (base === null) return false;
    const key = window.prompt('API Key QR Queue:', current?.hasApiKey ? 'API key tersimpan — kosongkan untuk mempertahankan' : 'Masukkan API key');
    if (key === null) return false;
    await ipcRenderer.invoke('remote-queue-save-config', { baseUrl: base.trim(), apiKey: key });
    statusEl.textContent = 'Konfigurasi QR Queue tersimpan.';
    return true;
  }

  async function loadQueue() {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#738284">Mengambil job dari QR Queue…</div>';
    try {
      const jobs = await ipcRenderer.invoke('remote-queue-list');
      if (!jobs.length) {
        listEl.innerHTML = '<div style="padding:32px;text-align:center;color:#738284">Tidak ada PDF baru di antrean.</div>';
        statusEl.textContent = 'Antrean kosong.';
        return;
      }
      statusEl.textContent = `${jobs.length} PDF menunggu dicetak.`;
      listEl.innerHTML = jobs.map(job => `<div data-job="${String(job.jobId).replace(/[^A-Za-z0-9_-]/g,'')}" style="display:flex;align-items:center;gap:14px;padding:14px;border:1px solid #e3ebea;border-radius:12px;margin-bottom:10px;background:#fbfdfd"><div style="flex:1;min-width:0"><b style="display:block;color:#203335;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(job.filename || job.fileName || 'PDF')}</b><span style="font-size:12px;color:#738284">${escapeHtml(job.jobId || '')} · ${Number(job.size || 0).toLocaleString('id-ID')} bytes · ${escapeHtml(job.status || 'uploaded')}</span></div><button data-open="${String(job.jobId).replace(/[^A-Za-z0-9_-]/g,'')}" style="border:0;background:#1f6f62;color:#fff;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer">Buka PDF</button></div>`).join('');
      listEl.querySelectorAll('[data-open]').forEach(btn => btn.onclick = async () => {
        const jobId = btn.getAttribute('data-open');
        btn.disabled = true; btn.textContent = 'Mengunduh…';
        try { await openRemoteJob(jobId); modal.style.display = 'none'; }
        catch (err) { statusEl.textContent = 'Gagal: ' + (err?.message || String(err)); btn.disabled = false; btn.textContent = 'Buka PDF'; }
      });
    } catch (err) {
      listEl.innerHTML = '<div style="padding:24px;color:#9b3838">' + escapeHtml(err?.message || String(err)) + '</div>';
      statusEl.textContent = 'QR Queue belum terhubung.';
      if (String(err?.message || '').includes('API key')) {
        const ok = window.confirm('QR Queue belum dikonfigurasi. Isi API Key sekarang?');
        if (ok && await configure()) await loadQueue();
      }
    }
  }

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>\'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[ch])); }

  button.onclick = async () => { modal.style.display = 'flex'; await loadQueue(); };
  modal.querySelector('#remoteQueueClose').onclick = () => { modal.style.display = 'none'; };
  modal.querySelector('#remoteQueueRefresh').onclick = loadQueue;
  modal.querySelector('#remoteQueueSettings').onclick = async () => { if (await configure()) await loadQueue(); };
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
}

contextBridge.exposeInMainWorld('revo', {
  openPdf: () => ipcRenderer.invoke('open-pdf'),
  pickPdfPath: () => ipcRenderer.invoke('pick-pdf-path'),
  setCurrentFile: (filePath) => ipcRenderer.invoke('set-current-file', filePath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  nativePrintStatus: () => ipcRenderer.invoke('native-print-status'),
  qzGetCertificate: () => ipcRenderer.invoke('qz-get-certificate'),
  qzSign: (request) => ipcRenderer.invoke('qz-sign', request),
  qzIdentityPaths: () => ipcRenderer.invoke('qz-identity-paths'),
  readPdf: (filePath) => ipcRenderer.invoke('read-pdf', filePath),
  printPdf: (payload) => ipcRenderer.invoke('print-pdf', payload),
  preparePrintPdf: (payload) => ipcRenderer.invoke('prepare-print-pdf', payload),
  deleteTempPrintFile: (filePath) => ipcRenderer.invoke('delete-temp-print-file', filePath),
  closeFile: () => ipcRenderer.invoke('close-file'),
  showInFolder: () => ipcRenderer.invoke('show-in-folder'),
  signalPrintReady: (ranges) => ipcRenderer.send('print-ready', { pageRanges: ranges }),
  startQrUpload: () => ipcRenderer.invoke('start-qr-upload'),
  stopQrUpload: () => ipcRenderer.invoke('stop-qr-upload'),
  remoteQueueGetConfig: () => ipcRenderer.invoke('remote-queue-get-config'),
  remoteQueueSaveConfig: (config) => ipcRenderer.invoke('remote-queue-save-config', config),
  remoteQueueList: () => ipcRenderer.invoke('remote-queue-list'),
  remoteQueueOpen: (jobId) => openRemoteJob(jobId),
  onQrPdfReceived: (callback) => { qrPdfCallbacks.add(callback); return () => qrPdfCallbacks.delete(callback); }
});

document.addEventListener('DOMContentLoaded', () => { setTimeout(addRemoteQueueUi, 50); });
