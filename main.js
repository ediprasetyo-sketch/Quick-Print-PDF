// Revo Print Shop V1.5.3
// QR Upload is hosted by the NAS at qr.revolearning.online.
// This desktop process does NOT start a local upload server or Cloudflare Tunnel.

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const util = require('node:util');
const execFileAsync = util.promisify(execFile);
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const QRCode = require('qrcode');
const { PDFDocument } = require('pdf-lib');
const crypto = require('node:crypto');
const forge = require('node-forge');

const NATIVE_PRINT_EXE = 'SumatraPDF.exe';
const QR_UPLOAD_URL = 'https://qr.revolearning.online';
const mimeTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.ico':'image/x-icon', '.svg':'image/svg+xml', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2' };

let appServer = null;
let appServerUrl = null;
let mainWindow;
let printWindow = null;
let currentFile = null;
let qzIdentity = null;

function findNativePrintEngine() {
  const candidates = [path.join(process.resourcesPath || __dirname, 'native-print', NATIVE_PRINT_EXE), path.join(__dirname, 'native-print', NATIVE_PRINT_EXE), path.join(process.resourcesPath || __dirname, NATIVE_PRINT_EXE), path.join(__dirname, NATIVE_PRINT_EXE)];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function quotePrintSetting(value) { return String(value).replace(/,/g, ' '); }

async function nativePrint({ filePath, printer, paper, copies, color, duplex, pages }) {
  if (process.platform !== 'win32') throw new Error('Native Windows Print hanya tersedia di Windows.');
  const exe = findNativePrintEngine();
  if (!exe) throw new Error('Mesin Native Windows Print belum tersedia. Jalankan setup-native-print.bat terlebih dahulu.');
  if (!printer) throw new Error('Printer belum dipilih.');
  const settings = ['ignore-pdf-print-settings', 'disable-auto-rotation', 'noscale'];
  if (color === 'bw') settings.push('monochrome'); else settings.push('color');
  if (duplex === 'longEdge') settings.push('duplexlong'); else if (duplex === 'shortEdge') settings.push('duplexshort'); else settings.push('simplex');
  settings.push(`${Math.max(1, Number(copies) || 1)}x`);
  if (paper) settings.push(`paper=${quotePrintSetting(paper)}`);
  if (pages && pages !== 'all') settings.push(pages);
  const args = ['-print-to', printer, '-print-settings', settings.join(','), '-silent', filePath];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => stdout += d.toString()); child.stderr?.on('data', d => stderr += d.toString());
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  if (result.code !== 0) {
    const reasons = {2:'PDF tidak dapat dibuka.',3:'PDF tidak mengizinkan pencetakan.',4:'Printer tidak ditemukan.',5:'Driver printer gagal memproses pekerjaan.',6:'Pencetakan diblokir oleh kebijakan Windows.'};
    throw new Error(reasons[result.code] || `Native Print gagal (kode ${result.code}).`);
  }
  return { ok: true, message: 'Dokumen dikirim ke Windows Print Spooler.' };
}

function qzIdentityDir() { return path.join(app.getPath('appData'), 'revo-print-shop', 'qz-identity'); }
function qzCertPath() { return path.join(qzIdentityDir(), 'digital-certificate.txt'); }
function qzKeyPath() { return path.join(qzIdentityDir(), 'private-key.pem'); }
function ensureQzIdentity() {
  const dir = qzIdentityDir(); fs.mkdirSync(dir, { recursive: true });
  const certPath = qzCertPath(), keyPath = qzKeyPath();
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) { qzIdentity = { cert: fs.readFileSync(certPath, 'utf8'), keyPath, certPath }; return qzIdentity; }
  const keys = forge.pki.rsa.generateKeyPair(2048); const cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = crypto.randomBytes(16).toString('hex');
  const now = new Date(); cert.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000); cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: 'Revo Print Shop Local' }, { name: 'organizationName', value: 'Revo Print Shop' }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.setExtensions([{ name:'basicConstraints', cA:false, critical:true }, { name:'keyUsage', critical:true, digitalSignature:true }, { name:'subjectKeyIdentifier' }]); cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert), keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(certPath, certPem, { mode:0o600 }); fs.writeFileSync(keyPath, keyPem, { mode:0o600 }); qzIdentity = { cert:certPem, keyPath, certPath }; return qzIdentity;
}
function signQzRequest(request) { const identity = ensureQzIdentity(); const privateKey = crypto.createPrivateKey({ key:fs.readFileSync(identity.keyPath,'utf8'), format:'pem', type:'pkcs1' }); return crypto.sign('RSA-SHA512', Buffer.from(String(request),'utf8'), privateKey).toString('base64'); }

function startAppServer() {
  if (appServer && appServerUrl) return Promise.resolve(appServerUrl);
  return new Promise((resolve, reject) => {
    appServer = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1'); let pathname = decodeURIComponent(u.pathname); if (pathname === '/') pathname = '/index.html';
        const safe = path.normalize(pathname).replace(/^([.][.][/\\\\])+/, ''); const filePath = path.join(__dirname, safe);
        if (!filePath.startsWith(path.resolve(__dirname))) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath).toLowerCase(); res.writeHead(200, { 'Content-Type':mimeTypes[ext] || 'application/octet-stream', 'Cache-Control':'no-store' }); fs.createReadStream(filePath).pipe(res);
      } catch { res.writeHead(500); res.end('Server error'); }
    });
    appServer.on('error', reject); appServer.listen(0, '127.0.0.1', () => { appServerUrl = `http://127.0.0.1:${appServer.address().port}/`; resolve(appServerUrl); });
  });
}
async function stopAppServer() { if (!appServer) return; await new Promise(resolve => appServer.close(() => resolve())); appServer = null; appServerUrl = null; }

function createWindow() {
  mainWindow = new BrowserWindow({ width:1450, height:900, minWidth:1050, minHeight:700, backgroundColor:'#f5f8f7', title:'Revo Print Shop — PDF Print Utility', icon:path.join(__dirname,'build','icon.ico'), autoHideMenuBar:false, webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false } });
  startAppServer().then(url => mainWindow.loadURL(url)).catch(err => { console.error('App server failed:', err); mainWindow.loadFile('index.html'); });
}
function fileUrl(filePath) { return pathToFileURL(filePath).href; }

app.whenReady().then(() => { try { ensureQzIdentity(); } catch (e) { console.warn('QZ identity setup failed:', e.message); } createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('before-quit', async () => { try { await stopAppServer(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// V1.5.3: QR Upload is always NAS-hosted. No local upload server, temporary
// upload token, or Cloudflare Tunnel is created by the desktop application.
ipcMain.handle('start-qr-upload', async () => { const qrDataUrl = await QRCode.toDataURL(QR_UPLOAD_URL, { margin:1, width:360, errorCorrectionLevel:'M' }); return { url:QR_UPLOAD_URL, qrDataUrl, public:true, jobs:[] }; });
ipcMain.handle('stop-qr-upload', async () => true);

ipcMain.handle('qz-get-certificate', async () => ensureQzIdentity().cert);
ipcMain.handle('qz-sign', async (_event, request) => signQzRequest(request));
ipcMain.handle('qz-identity-paths', async () => { const x=ensureQzIdentity(); return { certPath:x.certPath, keyPath:x.keyPath }; });

ipcMain.handle('open-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title:'Pilih file PDF', properties:['openFile'], filters:[{ name:'PDF', extensions:['pdf'] }] });
  if (result.canceled || !result.filePaths[0]) return null; currentFile = result.filePaths[0]; return { path:currentFile, name:path.basename(currentFile), url:fileUrl(currentFile), size:fs.statSync(currentFile).size };
});
ipcMain.handle('set-current-file', async (_event, filePath) => { if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.pdf')) throw new Error('File yang dipilih bukan PDF.'); if (!fs.existsSync(filePath)) throw new Error('File PDF tidak ditemukan.'); const stat=fs.statSync(filePath); if(!stat.isFile()) throw new Error('Path PDF tidak valid.'); currentFile=filePath; return { path:currentFile, name:path.basename(currentFile), url:fileUrl(currentFile), size:stat.size }; });
ipcMain.handle('pick-pdf-path', async () => { const result=await dialog.showOpenDialog(mainWindow,{title:'Pilih file PDF',properties:['openFile'],filters:[{name:'PDF',extensions:['pdf']}]}); if(result.canceled||!result.filePaths[0]) return null; currentFile=result.filePaths[0]; return {path:currentFile,name:path.basename(currentFile),url:fileUrl(currentFile),size:fs.statSync(currentFile).size}; });

ipcMain.handle('get-printers', async () => {
  try {
    if (process.platform === 'win32') {
      const ps = `Get-Printer | Select-Object Name,Default,PrinterStatus,DriverName,PortName | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{windowsHide:true,timeout:8000});
      const parsed=stdout.trim()?JSON.parse(stdout):[]; const winPrinters=Array.isArray(parsed)?parsed:[parsed]; const electronPrinters=await mainWindow.webContents.getPrintersAsync();
      return winPrinters.map(p=>{ const name=p.Name||''; const ep=electronPrinters.find(x=>x.name===name||x.displayName===name); return {name,displayName:ep?.displayName||name,isDefault:!!p.Default,status:p.PrinterStatus,driverName:p.DriverName,options:ep?.options||{},description:ep?.description||''}; }).filter(p=>p.name);
    }
  } catch(err) { console.warn('Windows printer refresh failed:',err.message); }
  return await mainWindow.webContents.getPrintersAsync();
});
ipcMain.handle('native-print-status', async () => ({ available:Boolean(findNativePrintEngine()), engine:findNativePrintEngine() }));
ipcMain.handle('read-pdf', async (_event,filePath) => { if(typeof filePath!=='string'||!filePath.toLowerCase().endsWith('.pdf')) throw new Error('File yang dipilih bukan PDF.'); if(!fs.existsSync(filePath)) throw new Error('File PDF tidak ditemukan.'); const stat=fs.statSync(filePath); if(!stat.isFile()) throw new Error('Path PDF tidak valid.'); return fs.readFileSync(filePath); });

async function buildPrintPdf({sourcePath,pages,paper,orientation,scale,margin}) {
  const sourceBytes=fs.readFileSync(sourcePath); const srcDoc=await PDFDocument.load(sourceBytes,{ignoreEncryption:false}); const outDoc=await PDFDocument.create();
  const paperMm={A4:[210,297],A5:[148,210],A3:[297,420],Letter:[215.9,279.4],Legal:[215.9,355.6],Tabloid:[279.4,431.8],Folio:[215.9,330.2]};
  let [paperWmm,paperHmm]=paperMm[paper]||paperMm.A4; if(orientation==='landscape') [paperWmm,paperHmm]=[paperHmm,paperWmm]; const mmToPt=mm=>mm/25.4*72; const paperW=mmToPt(paperWmm),paperH=mmToPt(paperHmm); const marginPt=margin==='none'?0:mmToPt(6);
  function selectedIndices(total,raw){ if(!raw||raw==='all') return Array.from({length:total},(_,i)=>i); const result=[]; for(const part of String(raw).split(',')){const m=part.trim().match(/^(\d+)(?:-(\d+))?$/); if(!m) continue; let a=Math.max(1,Math.min(total,Number(m[1]))),b=Math.max(1,Math.min(total,Number(m[2]||m[1]))); if(a>b)[a,b]=[b,a]; for(let i=a;i<=b;i++) result.push(i-1);} return [...new Set(result)]; }
  const indices=selectedIndices(srcDoc.getPageCount(),pages); if(!indices.length) throw new Error('Tidak ada halaman yang dipilih.');
  for(const index of indices){const srcPage=srcDoc.getPage(index),srcW=srcPage.getWidth(),srcH=srcPage.getHeight(),embedded=await outDoc.embedPage(srcPage); let scaleFactor=1; if(scale==='fit'){const availW=Math.max(1,paperW-marginPt*2),availH=Math.max(1,paperH-marginPt*2); scaleFactor=Math.min(availW/srcW,availH/srcH);} else if(/^\d+(?:\.\d+)?$/.test(String(scale))) scaleFactor=Math.max(0.01,Number(scale)/100); const drawW=srcW*scaleFactor,drawH=srcH*scaleFactor; const page=outDoc.addPage([paperW,paperH]); page.drawPage(embedded,{x:(paperW-drawW)/2,y:(paperH-drawH)/2,xScale:scaleFactor,yScale:scaleFactor,opacity:1}); }
  return await outDoc.save({useObjectStreams:true});
}

ipcMain.handle('delete-temp-print-file', async (_event,filePath)=>{ if(typeof filePath!=='string') return false; const tempRoot=path.resolve(app.getPath('temp'),'revo-print-shop'),target=path.resolve(filePath); if(!target.startsWith(tempRoot+path.sep)) return false; try{if(fs.existsSync(target))fs.unlinkSync(target);return true;}catch{return false;} });
ipcMain.handle('prepare-print-pdf', async (_event,payload)=>{ if(!currentFile||!fs.existsSync(currentFile)) throw new Error('File PDF belum dipilih atau sudah tidak tersedia.'); const tempDir=path.join(app.getPath('temp'),'revo-print-shop'); fs.mkdirSync(tempDir,{recursive:true}); const outputPath=path.join(tempDir,`qz-print-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`); const transformed=await buildPrintPdf({sourcePath:currentFile,pages:payload.pages||'all',paper:payload.paper||'A4',orientation:payload.orientation||'portrait',scale:payload.scale||'actual',margin:payload.margin||'normal'}); fs.writeFileSync(outputPath,transformed); return {path:outputPath,base64:Buffer.from(transformed).toString('base64')}; });
ipcMain.handle('print-pdf', async (_event,payload)=>{ if(!currentFile||!fs.existsSync(currentFile)) throw new Error('File PDF belum dipilih atau sudah tidak tersedia.'); if(process.platform!=='win32') throw new Error('V5.12 Native Windows Print membutuhkan Windows.'); const tempDir=path.join(app.getPath('temp'),'revo-print-shop'); fs.mkdirSync(tempDir,{recursive:true}); const outputPath=path.join(tempDir,`print-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`); try{const transformed=await buildPrintPdf({sourcePath:currentFile,pages:payload.pages||'all',paper:payload.paper||'A4',orientation:payload.orientation||'portrait',scale:payload.scale||'actual',margin:payload.margin||'normal'}); fs.writeFileSync(outputPath,transformed); return await nativePrint({filePath:outputPath,printer:payload.deviceName,paper:payload.paper||'A4',copies:payload.copies||1,color:payload.color||'color',duplex:payload.duplex||'simplex',pages:'all'});}finally{setTimeout(()=>{try{if(fs.existsSync(outputPath))fs.unlinkSync(outputPath);}catch{}},3000);} });
ipcMain.on('print-page-ranges', (_event,ranges)=>{});
ipcMain.handle('close-file', async ()=>{currentFile=null;if(printWindow&&!printWindow.isDestroyed())printWindow.close();printWindow=null;return true;});
ipcMain.handle('show-in-folder', async ()=>{if(currentFile)shell.showItemInFolder(currentFile);});
