function uploadPageHtml(token) {
  const safeToken = String(token).replace(/[^a-zA-Z0-9_-]/g, '');
  const uploadPath = `/upload/${safeToken}`;

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#1f7568">
  <title>REVO PRINT SHOP</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%;font-family:Inter,Arial,sans-serif;background:#f4f8f7;color:#203335}
    body{padding:18px 12px 28px;display:flex;justify-content:center}
    main{width:100%;max-width:430px;background:#fff;border-radius:18px;padding:24px 18px 22px;box-shadow:0 10px 32px rgba(28,61,56,.10)}
    h1{text-align:center;font-size:26px;line-height:1.15;margin:4px 0 24px;font-weight:800;letter-spacing:.2px;color:#123f3a}
    .upload-box{border:2px dashed #b7cbc7;border-radius:15px;padding:18px 12px;background:#fbfdfc}
    .file-picker{min-height:48px;border:1px solid #d1dcda;border-radius:10px;background:#fff;display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer}
    .file-button{flex:0 0 auto;background:#e8eceb;color:#203335;border-radius:999px;padding:7px 12px;font-size:13px;line-height:1;font-weight:600}
    .file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#667574;font-size:13px}
    #file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
    button{width:100%;border:0;border-radius:11px;background:#1f7568;color:#fff;padding:15px 16px;margin-top:16px;font-size:16px;font-weight:800;cursor:pointer}
    button:disabled{opacity:.55;cursor:wait}
    .status{margin-top:14px;text-align:center;font-size:14px;line-height:1.45;min-height:20px}
    .ok{color:#1f7568;font-weight:700}
    .err{color:#a33d3d;font-weight:700}
    .job{display:none;margin-top:12px;padding:13px 14px;border-radius:11px;background:#eef8f5;color:#294640;font-size:13px;line-height:1.5}
    .job strong{font-size:17px;color:#173e38}
    .hint{text-align:center;color:#71807e;font-size:11px;line-height:1.45;margin-top:12px}
    footer{text-align:center;color:#8a9593;font-size:11px;margin-top:24px}
    @media (max-width:380px){main{padding:20px 14px}h1{font-size:23px}.file-button{font-size:12px;padding:7px 10px}.file-name{font-size:12px}}
  </style>
</head>
<body>
  <main>
    <h1>REVO PRINT SHOP</h1>

    <form id="uploadForm" novalidate>
      <div class="upload-box">
        <label class="file-picker" for="file">
          <span class="file-button">Pilih file PDF</span>
          <span class="file-name" id="fileName">Belum ada file dipilih</span>
        </label>
        <input id="file" type="file" name="pdf" accept="application/pdf,.pdf" required>
      </div>

      <button id="send" type="submit">Kirim PDF</button>
      <div class="status" id="status" aria-live="polite"></div>
      <div class="job" id="job"></div>
      <div class="hint">Hanya PDF · Maksimum 50 MB</div>
    </form>

    <footer>© REVO PRINT SHOP</footer>
  </main>

  <script>
    const form = document.getElementById('uploadForm');
    const fileInput = document.getElementById('file');
    const fileName = document.getElementById('fileName');
    const send = document.getElementById('send');
    const status = document.getElementById('status');
    const job = document.getElementById('job');

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      fileName.textContent = file ? file.name : 'Belum ada file dipilih';
      status.textContent = '';
      status.className = 'status';
      job.style.display = 'none';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput.files[0];

      if (!file) {
        status.className = 'status err';
        status.textContent = 'Silakan pilih file PDF terlebih dahulu.';
        return;
      }
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        status.className = 'status err';
        status.textContent = 'File harus berformat PDF.';
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        status.className = 'status err';
        status.textContent = 'Ukuran PDF melebihi 50 MB.';
        return;
      }

      send.disabled = true;
      status.className = 'status';
      status.textContent = 'Mengirim PDF…';
      job.style.display = 'none';

      try {
        const data = new FormData();
        data.append('pdf', file, file.name);
        const response = await fetch('${uploadPath}', { method: 'POST', body: data });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Upload gagal.');

        status.className = 'status ok';
        status.textContent = 'PDF berhasil dikirim ke Revo Print Shop.';
        job.innerHTML = '<strong>' + (result.jobId || '-') + '</strong><br>' +
          (result.fileName || file.name) + ' · ' + (result.pages || 0) + ' halaman';
        job.style.display = 'block';
        form.reset();
        fileName.textContent = 'Belum ada file dipilih';
      } catch (error) {
        status.className = 'status err';
        status.textContent = 'Gagal: ' + (error.message || 'Upload gagal.');
      } finally {
        send.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { uploadPageHtml };
