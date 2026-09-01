const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const http = require('node:http');
const os = require('node:os');
const Busboy = require('busboy');
const QRCode = require('qrcode');
const { execFile, spawn } = require('node:child_process');
const util = require('node:util');
const execFileAsync = util.promisify(execFile);
const NATIVE_PRINT_EXE = 'SumatraPDF.exe';

function findNativePrintEngine() {
  const candidates = [
    path.join(process.resourcesPath || __dirname, 'native-print', NATIVE_PRINT_EXE),
    path.join(__dirname, 'native-print', NATIVE_PRINT_EXE),
    path.join(process.resourcesPath || __dirname, NATIVE_PRINT_EXE),
    path.join(__dirname, NATIVE_PRINT_EXE)
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function quotePrintSetting(value) {
  return String(value).replace(/,/g, ' ');
}

async function nativePrint({ filePath, printer, paper, copies, color, duplex, pages, mode, orientation }) {
  if (process.platform !== 'win32') throw new Error('Native Windows Print hanya tersedia di Windows.');
  const exe = findNativePrintEngine();
  if (!exe) throw new Error('Mesin Native Windows Print belum tersedia. Jalankan setup-native-print.bat terlebih dahulu.');
  if (!printer) throw new Error('Printer belum dipilih.');

  const settings = ['ignore-pdf-print-settings', 'disable-auto-rotation'];
  // The PDF has already been laid out at the requested paper size and scale.
  // Keep the native engine from applying a second fit or rotation.
  settings.push('noscale');
  if (color === 'bw') settings.push('monochrome'); else settings.push('color');
  if (duplex === 'longEdge') settings.push('duplexlong');
  else if (duplex === 'shortEdge') settings.push('duplexshort');
  else settings.push('simplex');
  settings.push(`${Math.max(1, Number(copies) || 1)}x`);
  if (paper) settings.push(`paper=${quotePrintSetting(paper)}`);
  if (pages && pages !== 'all') settings.push(pages);

  const args = ['-print-to', printer, '-print-settings', settings.join(','), '-silent', filePath];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => stdout += d.toString());
    child.stderr?.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  if (result.code !== 0) {
    const reasons = {2:'PDF tidak dapat dibuka.',3:'PDF tidak mengizinkan pencetakan.',4:'Printer tidak ditemukan.',5:'Driver printer gagal memproses pekerjaan.',6:'Pencetakan diblokir oleh kebijakan Windows.'};
    throw new Error(reasons[result.code] || `Native Print gagal (kode ${result.code}).`);
  }
  return { ok: true, message: 'Dokumen dikirim ke Windows Print Spooler.' };
}
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const mimeTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.ico':'image/x-icon', '.svg':'image/svg+xml', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2' };
let appServer = null;
let appServerUrl = null;
const { PDFDocument, rgb } = require('pdf-lib');
const crypto = require('node:crypto');
const forge = require('node-forge');

let mainWindow;
let printWindow = null;
let currentFile = null;
let uploadServer = null;
let uploadServerUrl = null;
let uploadToken = null;
let tunnelProcess = null;
let tunnelUrl = null;
let uploadJobs = [];
let nextJobNumber = 1001;

let qzIdentity = null;
function qzIdentityDir() { return path.join(app.getPath('appData'), 'revo-print-shop', 'qz-identity'); }
function qzCertPath() { return path.join(qzIdentityDir(), 'digital-certificate.txt'); }
function qzKeyPath() { return path.join(qzIdentityDir(), 'private-key.pem'); }
function ensureQzIdentity() {
  const dir = qzIdentityDir();
  fs.mkdirSync(dir, { recursive: true });
  const certPath = qzCertPath(), keyPath = qzKeyPath();
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    qzIdentity = { cert: fs.readFileSync(certPath, 'utf8'), keyPath, certPath };
    return qzIdentity;
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: 'Revo Print Shop Local' }, { name: 'organizationName', value: 'Revo Print Shop' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', critical: true, digitalSignature: true },
    { name: 'subjectKeyIdentifier' }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(certPath, certPem, { mode: 0o600 });
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
  qzIdentity = { cert: certPem, keyPath, certPath };
  return qzIdentity;
}
function signQzRequest(request) {
  const identity = ensureQzIdentity();
  const privateKey = crypto.createPrivateKey({ key: fs.readFileSync(identity.keyPath, 'utf8'), format: 'pem', type: 'pkcs1' });
  return crypto.sign('RSA-SHA512', Buffer.from(String(request), 'utf8'), privateKey).toString('base64');
}



function getLanIp() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) return n.address;
    }
  }
  return '127.0.0.1';
}

function uploadPageHtml(token) {
  const safeToken = String(token).replace(/[^a-zA-Z0-9_-]/g, '');
  return `<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Revo Print Shop</title><style>*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;background:linear-gradient(135deg,#eef6f4,#f8fbfa);margin:0;padding:20px;color:#203335}main{max-width:560px;margin:28px auto;background:#fff;padding:30px;border-radius:22px;box-shadow:0 18px 50px #153b3517}h1{font-size:25px;margin:0 0 8px}p{color:#5b6b6d;line-height:1.55}.badge{display:inline-block;background:#e6f4f0;color:#1f6f62;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:700;margin-bottom:14px}.drop{border:2px dashed #b9cdca;border-radius:16px;padding:24px;text-align:center;margin:18px 0;background:#fbfdfd}input{width:100%;padding:14px;border:1px solid #ccd7d7;border-radius:10px;margin:12px 0;background:#fff}button{width:100%;padding:15px;border:0;border-radius:12px;background:#1f6f62;color:#fff;font-weight:700;font-size:16px;cursor:pointer}button:disabled{opacity:.55}.hint{font-size:12px;color:#738284;margin-top:10px}.job{margin-top:18px;padding:15px;border-radius:12px;background:#f1f7f5;color:#29433f;display:none}.ok{color:#1f6f62;font-weight:700}.err{color:#9b3838;font-weight:700}</style></head><body><main><div class="badge">REVO PRINT SHOP · FREE INTERNET UPLOAD</div><h1>Kirim PDF untuk dicetak</h1><p>Pilih file PDF dari HP. Tidak perlu domain atau Wi-Fi yang sama. File akan dikirim ke Revo Print Shop dan masuk ke antrean cetak.</p><form id="f"><div class="drop"><input id="file" type="file" name="pdf" accept="application/pdf,.pdf" required></div><button id="send" type="submit">Kirim PDF</button><div class="hint">Maksimum 50 MB · Hanya PDF · Link gratis sementara dari Cloudflare · token upload acak · maksimum 50 MB.</div></form><div id="msg"></div><div id="job" class="job"></div></main><script>const f=document.getElementById('f'),send=document.getElementById('send'),msg=document.getElementById('msg'),job=document.getElementById('job');f.onsubmit=async e=>{e.preventDefault();send.disabled=true;msg.className='';msg.textContent='Mengirim PDF…';job.style.display='none';try{const file=document.getElementById('file').files[0];if(!file||!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Pilih file PDF.');const fd=new FormData();fd.append('pdf',file,file.name);const r=await fetch('/upload/${safeToken}',{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.message||'Upload gagal.');msg.className='ok';msg.textContent='PDF berhasil dikirim.';job.innerHTML='<b>Nomor job: '+j.jobId+'</b><br>'+j.fileName+' · '+j.pages+' halaman';job.style.display='block';f.reset()}catch(x){msg.className='err';msg.textContent='Gagal: '+x.message}finally{send.disabled=false}};</script></main></body></html>`;
}

function findCloudflared() {
  const candidates = [
    path.join(process.resourcesPath || __dirname, 'cloudflared.exe'),
    path.join(__dirname, 'cloudflared.exe'),
    path.join(process.cwd(), 'cloudflared.exe')
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function waitForTunnelUrl(child, timeoutMs=25000) {
  return new Promise((resolve, reject) => {
    let buffer=''; let done=false;
    const finish=(err,url)=>{ if(done)return; done=true; clearTimeout(timer); if(err)reject(err); else resolve(url); };
    const parse=(chunk)=>{ buffer += chunk.toString(); const matches=buffer.match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/g); if(matches?.[0]) finish(null,matches[0]); };
    child.stdout?.on('data',parse); child.stderr?.on('data',parse);
    child.on('error',e=>finish(new Error('cloudflared tidak dapat dijalankan: '+e.message)));
    child.on('exit',(code)=>{ if(!done) finish(new Error('Cloudflare Tunnel berhenti sebelum URL publik tersedia (kode '+code+').')); });
    const timer=setTimeout(()=>finish(new Error('Waktu membuat Cloudflare Tunnel habis. Pastikan internet aktif dan cloudflared tersedia.')),timeoutMs);
  });
}

async function startPublicTunnel(port) {
  if (tunnelProcess && tunnelUrl) return tunnelUrl;
  const binary=findCloudflared();
  tunnelProcess=spawn(binary,['tunnel','--url',`http://127.0.0.1:${port}`,'--no-autoupdate'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  try {
    tunnelUrl=await waitForTunnelUrl(tunnelProcess);
    return tunnelUrl;
  } catch(err) {
    try { tunnelProcess.kill(); } catch {}
    tunnelProcess=null; tunnelUrl=null; throw err;
  }
}

async function stopPublicTunnel() {
  if (tunnelProcess) { try { tunnelProcess.kill(); } catch {} }
  tunnelProcess=null; tunnelUrl=null;
}

async function startUploadServer() {
  if (uploadServer && uploadServerUrl) {
    const qr = await QRCode.toDataURL(uploadServerUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
    return { url: uploadServerUrl, qrDataUrl: qr, public: Boolean(tunnelUrl), jobs: uploadJobs.slice(-10).reverse() };
  }
  uploadToken = require('node:crypto').randomBytes(24).toString('hex');
  uploadJobs=[];
  uploadServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === `/u/${uploadToken}` && req.method === 'GET') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(uploadPageHtml(uploadToken)); return;
    }
    if (u.pathname === `/upload/${uploadToken}` && req.method === 'POST') {
      const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 50 * 1024 * 1024 } });
      let saved=false, savePath='', fileName='upload.pdf', tooLarge=false, writeStream=null;
      bb.on('filesLimit',()=>{});
      bb.on('file',(field,file,info)=>{
        fileName=path.basename(info.filename || 'upload.pdf');
        const valid=/\.pdf$/i.test(fileName) && (!info.mimeType || info.mimeType==='application/pdf' || info.mimeType==='application/octet-stream');
        if(!valid){file.resume(); return;}
        savePath=path.join(app.getPath('temp'),`revo-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        writeStream=fs.createWriteStream(savePath); file.pipe(writeStream);
        file.on('limit',()=>{tooLarge=true; try{writeStream.destroy()}catch{}});
        file.on('end',()=>{saved=!tooLarge;});
      });
      bb.on('finish',async()=>{
        if(!saved || !savePath || !fs.existsSync(savePath)){ try{if(savePath&&fs.existsSync(savePath))fs.unlinkSync(savePath)}catch{}; res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:tooLarge?'File melebihi batas 50 MB.':'File PDF tidak valid.'}));return; }
        let pages=0; try { const d=await PDFDocument.load(fs.readFileSync(savePath)); pages=d.getPageCount(); } catch {}
        const jobId=`RP-${nextJobNumber++}`;
        const job={jobId,fileName,pages,path:savePath,status:'Menunggu',receivedAt:new Date().toISOString()}; uploadJobs.push(job);
        currentFile=savePath;
        const result={path:savePath,name:fileName,url:fileUrl(savePath),size:fs.statSync(savePath).size,jobId,pages};
        if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.webContents.send('qr-pdf-received',result);mainWindow.webContents.send('remote-job-received',job);mainWindow.show();mainWindow.focus();}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message:'PDF berhasil dikirim ke Revo Print Shop.',jobId,fileName,pages}));
      });
      req.pipe(bb); return;
    }
    if (u.pathname === `/status/${uploadToken}` && req.method === 'GET') {
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(uploadJobs.slice(-20).reverse().map(j=>({jobId:j.jobId,fileName:j.fileName,pages:j.pages,status:j.status}))));return;
    }
    res.writeHead(404);res.end('Not found');
  });
  await new Promise((resolve,reject)=>uploadServer.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
  const port=uploadServer.address().port;
  let baseUrl;
  try { baseUrl=await startPublicTunnel(port); }
  catch (err) {
    await new Promise(resolve=>uploadServer.close(()=>resolve())); uploadServer=null; uploadToken=null;
    throw new Error('Internet QR gagal dibuat. Pastikan cloudflared tersedia. '+err.message);
  }
  uploadServerUrl=`${baseUrl}/u/${uploadToken}`;
  const qr=await QRCode.toDataURL(uploadServerUrl,{margin:1,width:360,errorCorrectionLevel:'M'});
  return {url:uploadServerUrl,qrDataUrl:qr,public:true,jobs:[]};
}

async function stopUploadServer() {
  await stopPublicTunnel();
  if (!uploadServer) return true;
  await new Promise(resolve => uploadServer.close(() => resolve()));
  uploadServer = null; uploadServerUrl = null; uploadToken = null; uploadJobs = []; return true;
}

function startAppServer() {
  if (appServer && appServerUrl) return Promise.resolve(appServerUrl);
  return new Promise((resolve, reject) => {
    appServer = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(u.pathname);
        if (pathname === '/') pathname = '/index.html';
        const safe = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
        const filePath = path.join(__dirname, safe);
        if (!filePath.startsWith(path.resolve(__dirname))) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) { res.writeHead(500); res.end('Server error'); }
    });
    appServer.on('error', reject);
    appServer.listen(0, '127.0.0.1', () => {
      const port = appServer.address().port;
      appServerUrl = `http://127.0.0.1:${port}/`;
      resolve(appServerUrl);
    });
  });
}

async function stopAppServer() {
  if (!appServer) return;
  await new Promise(resolve => appServer.close(() => resolve()));
  appServer = null; appServerUrl = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#f5f8f7',
    title: 'Revo Print Shop — PDF Print Utility',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  startAppServer().then(url => mainWindow.loadURL(url)).catch(err => { console.error('App server failed:', err); mainWindow.loadFile('index.html'); });
}

function fileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

app.whenReady().then(() => {
  try { ensureQzIdentity(); } catch (e) { console.warn('QZ identity setup failed:', e.message); }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', async () => { try { await stopUploadServer(); } catch {} try { await stopAppServer(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('start-qr-upload', async () => startUploadServer());
ipcMain.handle('stop-qr-upload', async () => stopUploadServer());

ipcMain.handle('qz-get-certificate', async () => ensureQzIdentity().cert);
ipcMain.handle('qz-sign', async (_event, request) => signQzRequest(request));
ipcMain.handle('qz-identity-paths', async () => { const x=ensureQzIdentity(); return { certPath:x.certPath, keyPath:x.keyPath }; });

ipcMain.handle('open-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih file PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  currentFile = result.filePaths[0];
  return { path: currentFile, name: path.basename(currentFile), url: fileUrl(currentFile), size: fs.statSync(currentFile).size };
});

ipcMain.handle('set-current-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.pdf')) throw new Error('File yang dipilih bukan PDF.');
  if (!fs.existsSync(filePath)) throw new Error('File PDF tidak ditemukan.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Path PDF tidak valid.');
  currentFile = filePath;
  return { path: currentFile, name: path.basename(currentFile), url: fileUrl(currentFile), size: stat.size };
});

ipcMain.handle('pick-pdf-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih file PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  currentFile = result.filePaths[0];
  return { path: currentFile, name: path.basename(currentFile), url: fileUrl(currentFile), size: fs.statSync(currentFile).size };
});

ipcMain.handle('get-printers', async () => {
  // Electron's printer list can lag behind Windows when a printer is installed,
  // removed, or restarted. Refresh from Windows first, then merge with Electron's
  // capabilities so the renderer always gets the current device names.
  try {
    if (process.platform === 'win32') {
      const ps = `Get-Printer | Select-Object Name,Default,PrinterStatus,DriverName,PortName | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide: true, timeout: 8000 });
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      const winPrinters = Array.isArray(parsed) ? parsed : [parsed];
      const electronPrinters = await mainWindow.webContents.getPrintersAsync();
      return winPrinters.map(p => {
        const name = p.Name || '';
        const ep = electronPrinters.find(x => x.name === name || x.displayName === name);
        return {
          name,
          displayName: ep?.displayName || name,
          isDefault: !!p.Default,
          status: p.PrinterStatus,
          driverName: p.DriverName,
          options: ep?.options || {},
          description: ep?.description || ''
        };
      }).filter(p => p.name);
    }
  } catch (err) {
    console.warn('Windows printer refresh failed:', err.message);
  }
  return await mainWindow.webContents.getPrintersAsync();
});

ipcMain.handle('native-print-status', async () => ({ available: Boolean(findNativePrintEngine()), engine: findNativePrintEngine() }));

ipcMain.handle('read-pdf', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.pdf')) throw new Error('File yang dipilih bukan PDF.');
  if (!fs.existsSync(filePath)) throw new Error('File PDF tidak ditemukan.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Path PDF tidak valid.');
  return fs.readFileSync(filePath);
});

async function buildPrintPdf({ sourcePath, pages, paper, orientation, scale, margin }) {
  const sourceBytes = fs.readFileSync(sourcePath);
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
  const outDoc = await PDFDocument.create();

  const paperMm = {
    A4: [210, 297], A5: [148, 210], A3: [297, 420], Letter: [215.9, 279.4],
    Legal: [215.9, 355.6], Tabloid: [279.4, 431.8], Folio: [215.9, 330.2]
  };
  let [paperWmm, paperHmm] = paperMm[paper] || paperMm.A4;
  if (orientation === 'landscape') [paperWmm, paperHmm] = [paperHmm, paperWmm];
  const mmToPt = mm => mm / 25.4 * 72;
  const paperW = mmToPt(paperWmm);
  const paperH = mmToPt(paperHmm);
  const marginPt = margin === 'none' ? 0 : mmToPt(6);

  function selectedIndices(total, raw) {
    if (!raw || raw === 'all') return Array.from({ length: total }, (_, i) => i);
    const result = [];
    for (const part of String(raw).split(',')) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      let a = Math.max(1, Math.min(total, Number(m[1])));
      let b = Math.max(1, Math.min(total, Number(m[2] || m[1])));
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) result.push(i - 1);
    }
    return [...new Set(result)];
  }

  const indices = selectedIndices(srcDoc.getPageCount(), pages);
  if (!indices.length) throw new Error('Tidak ada halaman yang dipilih.');

  for (const index of indices) {
    const srcPage = srcDoc.getPage(index);
    const srcW = srcPage.getWidth();
    const srcH = srcPage.getHeight();
    const embedded = await outDoc.embedPage(srcPage);

    let scaleFactor = 1;
    if (scale === 'fit') {
      const availW = Math.max(1, paperW - marginPt * 2);
      const availH = Math.max(1, paperH - marginPt * 2);
      scaleFactor = Math.min(availW / srcW, availH / srcH);
    } else if (/^\d+(?:\.\d+)?$/.test(String(scale))) {
      scaleFactor = Math.max(0.01, Number(scale) / 100);
    }

    const drawW = srcW * scaleFactor;
    const drawH = srcH * scaleFactor;
    const x = (paperW - drawW) / 2;
    const y = (paperH - drawH) / 2;

    // A real PDF page is created at the selected paper size. The source page
    // is embedded as PDF content, not rasterized to JPEG/PNG. If Actual Size
    // is larger than the paper, content outside the media box is naturally
    // clipped by the PDF page boundary.
    const page = outDoc.addPage([paperW, paperH]);
    page.drawPage(embedded, {
      x,
      y,
      xScale: scaleFactor,
      yScale: scaleFactor,
      opacity: 1
    });
  }

  return await outDoc.save({ useObjectStreams: true });
}

ipcMain.handle('delete-temp-print-file', async (_event, filePath) => {
  if (typeof filePath !== 'string') return false;
  const tempRoot = path.resolve(app.getPath('temp'), 'revo-print-shop');
  const target = path.resolve(filePath);
  if (!target.startsWith(tempRoot + path.sep)) return false;
  try { if (fs.existsSync(target)) fs.unlinkSync(target); return true; } catch { return false; }
});

ipcMain.handle('prepare-print-pdf', async (_event, payload) => {
  if (!currentFile || !fs.existsSync(currentFile)) throw new Error('File PDF belum dipilih atau sudah tidak tersedia.');
  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, `qz-print-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const transformed = await buildPrintPdf({
    sourcePath: currentFile,
    pages: payload.pages || 'all',
    paper: payload.paper || 'A4',
    orientation: payload.orientation || 'portrait',
    scale: payload.scale || 'actual',
    margin: payload.margin || 'normal'
  });
  fs.writeFileSync(outputPath, transformed);
  // Return the exact PDF bytes as base64 for QZ Tray's pixel/pdf base64 flavor.
  // This avoids QZ treating an Electron Windows path as an invalid file:// URL.
  return { path: outputPath, base64: Buffer.from(transformed).toString('base64') };
});

ipcMain.handle('print-pdf', async (_event, payload) => {
  if (!currentFile || !fs.existsSync(currentFile)) throw new Error('File PDF belum dipilih atau sudah tidak tersedia.');
  if (process.platform !== 'win32') throw new Error('V5.12 Native Windows Print membutuhkan Windows.');

  const tempDir = path.join(app.getPath('temp'), 'revo-print-shop');
  fs.mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, `print-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const rangeText = payload.pages || 'all';

  try {
    // We deliberately create a paper-sized PDF first. This makes the document
    // geometry deterministic; the Windows driver then receives the exact
    // paper, duplex, color and printer selection through the native print path.
    const transformed = await buildPrintPdf({
      sourcePath: currentFile,
      pages: rangeText,
      paper: payload.paper || 'A4',
      orientation: payload.orientation || 'portrait',
      scale: payload.scale || 'actual',
      margin: payload.margin || 'normal'
    });
    fs.writeFileSync(outputPath, transformed);

    // The transformed PDF already contains the selected page range, so do not
    // pass the original page range to the native engine again.
    return await nativePrint({
      filePath: outputPath,
      printer: payload.deviceName,
      paper: payload.paper || 'A4',
      copies: payload.copies || 1,
      color: payload.color || 'color',
      duplex: payload.duplex || 'simplex',
      pages: 'all',
      mode: payload.scale === 'fit' ? 'fit' : 'actual',
      orientation: payload.orientation || 'portrait'
    });
  } finally {
    setTimeout(() => { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {} }, 3000);
  }
});

ipcMain.on('print-page-ranges', (_event, ranges) => {
  // reserved for future direct print range transport
});

ipcMain.handle('close-file', async () => {
  currentFile = null;
  if (printWindow && !printWindow.isDestroyed()) printWindow.close();
  printWindow = null;
  return true;
});

ipcMain.handle('show-in-folder', async () => {
  if (currentFile) shell.showItemInFolder(currentFile);
});
