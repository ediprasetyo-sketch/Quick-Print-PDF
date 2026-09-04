from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# V1.5.6 already reports printed/error from renderer.js. Keep that logic intact
# and only add durable retry for status updates that could not reach the NAS.
renderer = (ROOT / 'renderer.js').read_text(encoding='utf-8')
if "remoteQueueStatus(currentFileMeta.jobId,'printed'" not in renderer and "remoteQueueStatus(currentFileMeta.jobId,'error'" not in renderer:
    raise SystemExit('renderer lifecycle status calls are missing; refusing to patch blindly')

p = ROOT / 'bootstrap.js'
s = p.read_text(encoding='utf-8')

if 'async function retryPendingStatusSync()' not in s:
    old = """async function getUploadedJobs() {\n  return getJobsByStatus('uploaded');\n}\n\n\nasync function setRemoteJobStatus"""
    new = """async function getUploadedJobs() {\n  return getJobsByStatus('uploaded');\n}\n\nasync function retryPendingStatusSync() {\n  const pending = readReceivedRecords().filter(item => item.syncPending && ['printed', 'error'].includes(String(item.status || '').toLowerCase()));\n  for (const record of pending) {\n    try {\n      await setRemoteJobStatus(record.jobId, record.status, record.message || '');\n    } catch (err) {\n      console.warn('[QR Queue] Pending status retry failed:', record.jobId, err?.message || err);\n    }\n  }\n}\n\n\nasync function setRemoteJobStatus"""
    if old not in s:
        raise SystemExit('bootstrap getUploadedJobs anchor not found')
    s = s.replace(old, new, 1)

if 'await retryPendingStatusSync();' not in s:
    old = """  try {\n    const recovered = await recoverOwnProcessingJobs();"""
    new = """  try {\n    await retryPendingStatusSync();\n    const recovered = await recoverOwnProcessingJobs();"""
    if old not in s:
        raise SystemExit('bootstrap autoReceive anchor not found')
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')

p = ROOT / 'package.json'
s = p.read_text(encoding='utf-8')
s = s.replace('"version": "1.5.6"', '"version": "1.5.7"', 1)
s = s.replace('Revo Print Shop V1.5.6 — QR Queue lifecycle synchronization.', 'Revo Print Shop V1.5.7 — QR Queue lifecycle synchronization.', 1)
p.write_text(s, encoding='utf-8')

print('patched QR lifecycle to V1.5.7')
