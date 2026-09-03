from pathlib import Path

p = Path('bootstrap.js')
s = p.read_text(encoding='utf-8')
old = """    merged.set(key, normalizeJob({ ...record, jobId: key, status: 'processing' }, 'processing'));"""
new = """    const localStatus = ['printed', 'error'].includes(String(record.status || '').toLowerCase()) ? String(record.status).toLowerCase() : 'processing';
    merged.set(key, normalizeJob({ ...record, jobId: key, status: localStatus }, localStatus));"""
if old not in s:
    raise SystemExit('terminal display block not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
