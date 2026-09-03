from pathlib import Path
import json


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'{label}: pattern not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# bootstrap.js
p = Path('bootstrap.js')
s = p.read_text(encoding='utf-8')
if '// QR_LIFECYCLE_V1_5_6' not in s:
    replace_once('bootstrap.js',
        "        receivedAt: item.receivedAt || null\n",
        "        receivedAt: item.receivedAt || null,\n        status: item.status || 'processing',\n        message: item.message || '',\n        updatedAt: item.updatedAt || item.receivedAt || item.createdAt || null,\n        syncPending: Boolean(item.syncPending)\n",
        'bootstrap record fields')
    replace_once('bootstrap.js',
        "    receivedAt: new Date().toISOString()\n",
        "    receivedAt: new Date().toISOString(),\n    status: 'processing',\n    message: 'PDF diterima dan menunggu proses cetak.',\n    updatedAt: new Date().toISOString(),\n    syncPending: false\n",
        'bootstrap markReceived fields')
    p = Path('bootstrap.js'); s = p.read_text(encoding='utf-8')
    marker = "\nfunction forgetReceived(jobId) {"
    helper = """

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
"""
    if marker not in s: raise SystemExit('bootstrap updateReceivedRecord marker not found')
    p.write_text(s.replace(marker, helper + marker, 1), encoding='utf-8')

    p = Path('bootstrap.js'); s = p.read_text(encoding='utf-8')
    marker = "\nipcMain.handle('remote-queue-list', async () => getQueueJobs());"
    helper = """

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
"""
    if marker not in s: raise SystemExit('bootstrap queue list marker not found')
    p.write_text(s.replace(marker, helper + marker, 1), encoding='utf-8')

    p = Path('bootstrap.js'); s = p.read_text(encoding='utf-8')
    old = """  for (const job of processing) {
    if (received.has(String(job.jobId))) merged.set(String(job.jobId), job);
  }"""
    new = """  for (const job of processing) {
    const key = String(job.jobId);
    const local = received.get(key);
    if (!local) continue;
    const terminal = ['printed','error'].includes(String(local.status || '').toLowerCase());
    merged.set(key, terminal ? normalizeJob({ ...job, ...local, jobId:key }, local.status) : job);
  }"""
    if old not in s: raise SystemExit('bootstrap processing merge block not found')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

    p = Path('bootstrap.js'); s = p.read_text(encoding='utf-8')
    marker = "\nasync function autoReceiveQrJobs() {"
    helper = """

async function syncPendingTerminalStatuses() {
  const records = readReceivedRecords().filter(item => item?.syncPending && ['printed','error'].includes(String(item.status || '').toLowerCase()));
  for (const record of records.slice(0,10)) {
    try { await setRemoteJobStatus(record.jobId, record.status, record.message || ''); }
    catch (err) { console.error('[QR Queue] Terminal status sync failed:', record.jobId, err?.message || err); }
  }
}
"""
    if marker not in s: raise SystemExit('bootstrap autoReceive marker not found')
    s = s.replace(marker, helper + marker, 1)
    old = """  try {
    const recovered = await recoverOwnProcessingJobs();"""
    new = """  try {
    await syncPendingTerminalStatuses();
    const recovered = await recoverOwnProcessingJobs();"""
    if old not in s: raise SystemExit('bootstrap autoReceive try block not found')
    s = s.replace(old, new, 1)
    s += "\n// QR_LIFECYCLE_V1_5_6\n"
    p.write_text(s, encoding='utf-8')

# preload.js
p = Path('preload.js'); s = p.read_text(encoding='utf-8')
if '// QR_LIFECYCLE_V1_5_6_PRELOAD' not in s:
    needle = "  remoteQueueDelete: (jobId) => ipcRenderer.invoke('remote-queue-delete', jobId),"
    repl = needle + "\n  // QR_LIFECYCLE_V1_5_6_PRELOAD\n  remoteQueueStatus: (jobId, status, message = '') => ipcRenderer.invoke('remote-queue-status', { jobId, status, message }),"
    if needle not in s: raise SystemExit('preload insertion point not found')
    p.write_text(s.replace(needle, repl, 1), encoding='utf-8')

# renderer.js
p = Path('renderer.js'); s = p.read_text(encoding='utf-8')
if 'QR_LIFECYCLE_V1_5_6_RENDERER' not in s:
    old = """    const result=await qzPrintPdf(payload);
    toast(result.message||t('printSuccess'));$('statusText').textContent=t('sent');"""
    new = """    const result=await qzPrintPdf(payload);
    if(currentFileMeta?.jobId && /^RP-[A-Za-z0-9_-]+$/.test(String(currentFileMeta.jobId))){
      const sync=await window.revo.remoteQueueStatus(currentFileMeta.jobId,'printed',`Cetak berhasil dikirim ke printer ${selectedPrinter()}.`);
      if(!sync?.ok) toast('Cetak berhasil; status QR menunggu sinkronisasi.',false);
    }
    toast(result.message||t('printSuccess'));$('statusText').textContent=t('sent');"""
    if old not in s: raise SystemExit('renderer success block not found')
    s = s.replace(old, new, 1)
    old = """  }catch(err){toast(t('printFailed')+(err?.message||String(err)),true);$('statusText').textContent=t('readyStatus')}"""
    new = """  }catch(err){
    if(currentFileMeta?.jobId && /^RP-[A-Za-z0-9_-]+$/.test(String(currentFileMeta.jobId))){
      const sync=await window.revo.remoteQueueStatus(currentFileMeta.jobId,'error',`Cetak gagal: ${err?.message||String(err)}`);
      if(!sync?.ok) console.warn('QR Queue error status pending:',sync?.error);
    }
    toast(t('printFailed')+(err?.message||String(err)),true);$('statusText').textContent=t('readyStatus')
  }"""
    if old not in s: raise SystemExit('renderer error block not found')
    s = s.replace(old, new, 1)
    s += "\n// QR_LIFECYCLE_V1_5_6_RENDERER\n"
    p.write_text(s, encoding='utf-8')

# package.json
p = Path('package.json')
data = json.loads(p.read_text(encoding='utf-8'))
data['version'] = '1.5.6'
data['description'] = 'Revo Print Shop V1.5.6 — QR Queue lifecycle synchronization.'
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
