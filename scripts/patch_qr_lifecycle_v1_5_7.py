from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Renderer: report terminal state after an actual print attempt.
p = ROOT / 'renderer.js'
s = p.read_text(encoding='utf-8')
old = """async function printPdf(){\n  if(!pdfDoc)return;\n  const ranges=pageRanges();"""
new = """async function syncQrJobStatus(status, message='') {\n  const jobId = String(currentFileMeta?.jobId || '').trim();\n  if (!jobId || typeof window.revo.remoteQueueStatus !== 'function') return;\n  try {\n    const result = await window.revo.remoteQueueStatus(jobId, status, message);\n    if (result?.syncPending) console.warn('[QR Queue] Status sync pending:', jobId, status);\n  } catch (err) {\n    console.warn('[QR Queue] Status sync failed:', jobId, err?.message || err);\n  }\n}\n\nasync function printPdf(){\n  if(!pdfDoc)return;\n  const ranges=pageRanges();"""
if old not in s:
    raise SystemExit('renderer printPdf anchor not found')
s = s.replace(old, new, 1)
old = """    const result=await qzPrintPdf(payload);\n    toast(result.message||t('printSuccess'));$('statusText').textContent=t('sent');\n  }catch(err){toast(t('printFailed')+(err?.message||String(err)),true);$('statusText').textContent=t('readyStatus')}"""
new = """    const result=await qzPrintPdf(payload);\n    await syncQrJobStatus('printed', result?.message || t('printSuccess'));\n    toast(result.message||t('printSuccess'));$('statusText').textContent=t('sent');\n  }catch(err){\n    await syncQrJobStatus('error', err?.message || String(err));\n    toast(t('printFailed')+(err?.message||String(err)),true);$('statusText').textContent=t('readyStatus');\n  }"""
if old not in s:
    raise SystemExit('renderer printPdf status anchor not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Bootstrap: retry terminal status updates that were locally recorded but not
# accepted by NAS (for example a temporary network failure).
p = ROOT / 'bootstrap.js'
s = p.read_text(encoding='utf-8')
old = """async function getUploadedJobs() {\n  return getJobsByStatus('uploaded');\n}\n\n\nasync function setRemoteJobStatus"""
new = """async function getUploadedJobs() {\n  return getJobsByStatus('uploaded');\n}\n\nasync function retryPendingStatusSync() {\n  const pending = readReceivedRecords().filter(item => item.syncPending && ['printed', 'error'].includes(String(item.status || '').toLowerCase()));\n  for (const record of pending) {\n    try {\n      await setRemoteJobStatus(record.jobId, record.status, record.message || '');\n    } catch (err) {\n      console.warn('[QR Queue] Pending status retry failed:', record.jobId, err?.message || err);\n    }\n  }\n}\n\n\nasync function setRemoteJobStatus"""
if old not in s:
    raise SystemExit('bootstrap getUploadedJobs anchor not found')
s = s.replace(old, new, 1)
old = """  try {\n    const recovered = await recoverOwnProcessingJobs();"""
new = """  try {\n    await retryPendingStatusSync();\n    const recovered = await recoverOwnProcessingJobs();"""
if old not in s:
    raise SystemExit('bootstrap autoReceive anchor not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Keep package metadata aligned with the lifecycle patch.
p = ROOT / 'package.json'
s = p.read_text(encoding='utf-8')
s = s.replace('"version": "1.5.6"', '"version": "1.5.7"', 1)
s = s.replace('Revo Print Shop V1.5.6 — QR Queue lifecycle synchronization.', 'Revo Print Shop V1.5.7 — QR Queue lifecycle synchronization.', 1)
p.write_text(s, encoding='utf-8')

print('patched QR lifecycle to V1.5.7')
