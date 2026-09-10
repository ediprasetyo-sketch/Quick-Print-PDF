import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc='./node_modules/pdfjs-dist/build/pdf.worker.mjs';

const $=id=>document.getElementById(id);
const setText=(id,value)=>{const el=$(id); if(el) el.textContent=value;};
const setValue=(id,value)=>{const el=$(id); if(el) el.value=value;};
const setClass=(id,cls,on)=>{const el=$(id); if(el) el.classList.toggle(cls,on);};
let pdfDoc=null,currentPage=1,zoom=1,fitMode=true,renderToken=0,currentFileMeta=null;
const DEFAULT_STATE={orientation:'portrait',color:'color',pages:'all',pageMode:'all',copies:1,paper:'A4',scale:'actual',customScale:100,margin:'normal',duplex:'simplex',tray:'default'};
const state={...DEFAULT_STATE};
let lang='id';
let qzReady=false;
let qzPrinters=[];

function resetPrintSettings(){
  Object.assign(state, DEFAULT_STATE);
  setValue('copies', state.copies);
  setValue('paper', state.paper);
  setValue('scale', state.scale);
  setValue('customScale', state.customScale);
  setValue('margin', state.margin);
  setValue('duplex', state.duplex);
  setValue('tray', 'default'); state.tray='default';
  const custom=$('customScaleWrap');
  if(custom) custom.classList.add('hidden');
  document.querySelectorAll('[data-orientation]').forEach(x=>x.classList.toggle('active',x.dataset.orientation===state.orientation));
  document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x.dataset.color===state.color));
  $('allPages')?.classList.toggle('active',true);
  $('specificPages')?.classList.toggle('active',false);
  $('rangeInput')?.classList.add('hidden');
  if($('rangeInput')) $('rangeInput').value='';
  document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));
  $('allPageMode')?.classList.add('active');
  updateJob();
}


const I18N={
  id:{originalSize:'Ukuran asli',dimensions:'Dimensi',orientationInfo:'Orientasi',pageInfo:'Halaman',sizeUnit:'MB',portraitInfo:'Portrait',landscapeInfo:'Landscape',appPrint:'Aplikasi Cetak',openPdf:'Buka PDF',qrUpload:'QR Upload',qrTitle:'Upload PDF via QR Internet',qrHelp:'Scan QR ini dari HP menggunakan Wi-Fi atau jaringan seluler. Tidak perlu domain. PDF akan dikirim melalui internet ke aplikasi Revo Print Shop.',qrWaiting:'Menunggu file PDF dari HP…',qrStop:'Tutup QR Upload',close:'Tutup',directPrint:'Cetak langsung',openStart:'Buka PDF untuk memulai',dropHelp:'Seret & lepas PDF di sini, atau pilih dari berkas Anda. Semua tetap<br>di perangkat Anda.',choosePdf:'Pilih PDF',orDrop:'atau lepas PDF di sini',page:'Halaman',of:'dari',ready:'Siap',printer:'PRINTER',refreshPrinter:'Segarkan printer',disconnect:'Putuskan',printSettings:'Pengaturan cetak',copiesLabel:'JUMLAH SALINAN',paperLabel:'UKURAN KERTAS',orientationLabel:'ORIENTASI',colorLabel:'WARNA',pagesLabel:'HALAMAN',portrait:'Potret',landscape:'Lanskap',color:'Berwarna',bw:'Hitam putih',all:'Semua',specific:'Khusus',allPages:'Semua halaman',odd:'Ganjil saja',even:'Genap saja',scaleLabel:'SKALA',marginLabel:'MARGIN',advancedLabel:'LANJUTAN (CETAK LANGSUNG)',duplexLabel:'Bolak-balik (duplex)',trayLabel:'Baki kertas',infoNote:'Printer fisik dikendalikan melalui QZ Tray dan driver Windows.',printJob:'TUGAS CETAK',jobNote:'QZ Tray mengirim job langsung ke printer fisik.',printPdf:'Cetak PDF',actual:'Ukuran asli',fit:'Fit ke kertas',custom:'Kustom',customScale:'Skala kustom',apply:'Terapkan',normal:'Normal',none:'Tanpa margin',simplex:'Satu sisi',longEdge:'Balik tepi panjang',shortEdge:'Balik tepi pendek',defaultPrinter:'Default printer',auto:'Auto',rangePlaceholder:'Contoh: 1-3, 5, 8-10',readyStatus:'Siap',opening:'Membuka PDF…',preparing:'Menyiapkan cetak…',sent:'Terkirim ke printer',closed:'File ditutup.',noPrinter:'Tidak ada printer terdeteksi',connected:'◉ Terhubung',noPrinterStatus:'○ Tidak ada',disconnected:'○ Terputus',printerReleased:'Printer dilepas dari pilihan.',opened:'PDF dibuka: ',openFailed:'Gagal membuka PDF: ',printFailed:'Cetak gagal: ',rangeInvalid:'Rentang halaman tidak valid.',printSuccess:'Dokumen berhasil dikirim ke printer.',printerFailed:'Gagal membaca printer: ',dropPdf:'Silakan jatuhkan file PDF.'},
  en:{originalSize:'Original size',dimensions:'Dimensions',orientationInfo:'Orientation',pageInfo:'Pages',sizeUnit:'MB',portraitInfo:'Portrait',landscapeInfo:'Landscape',appPrint:'Print Application',openPdf:'Open PDF',qrUpload:'QR Upload',qrTitle:'Upload PDF via Internet QR',qrHelp:'Scan this QR from a phone using Wi-Fi or mobile data. No domain is required. The PDF will be sent over the internet to Revo Print Shop.',qrWaiting:'Waiting for a PDF from the phone…',qrStop:'Close QR Upload',close:'Close',directPrint:'Print directly',openStart:'Open PDF to start',dropHelp:'Drag & drop a PDF here, or choose a file. Everything stays<br>on your device.',choosePdf:'Choose PDF',orDrop:'or drop PDF here',page:'Page',of:'of',ready:'Ready',printer:'PRINTER',refreshPrinter:'Refresh printers',disconnect:'Disconnect',printSettings:'Print settings',copiesLabel:'COPIES',paperLabel:'PAPER SIZE',orientationLabel:'ORIENTATION',colorLabel:'COLOR',pagesLabel:'PAGES',portrait:'Portrait',landscape:'Landscape',color:'Color',bw:'Black & white',all:'All',specific:'Custom',allPages:'All pages',odd:'Odd only',even:'Even only',scaleLabel:'SCALE',marginLabel:'MARGIN',advancedLabel:'ADVANCED (DIRECT PRINT)',duplexLabel:'Duplex',trayLabel:'Paper tray',infoNote:'Physical printers are controlled through QZ Tray and the Windows driver.',printJob:'PRINT JOB',jobNote:'QZ Tray sends the job directly to the physical printer.',printPdf:'Print PDF',actual:'Actual size',fit:'Fit to paper',custom:'Custom',customScale:'Custom scale',apply:'Apply',normal:'Normal',none:'No margin',simplex:'Single-sided',longEdge:'Flip on long edge',shortEdge:'Flip on short edge',defaultPrinter:'Default printer',auto:'Auto',rangePlaceholder:'Example: 1-3, 5, 8-10',readyStatus:'Ready',opening:'Opening PDF…',preparing:'Preparing print…',sent:'Sent to printer',closed:'File closed.',noPrinter:'No printer detected',connected:'◉ Connected',noPrinterStatus:'○ None',disconnected:'○ Disconnected',printerReleased:'Printer selection cleared.',opened:'PDF opened: ',openFailed:'Failed to open PDF: ',printFailed:'Print failed: ',rangeInvalid:'Invalid page range.',printSuccess:'Document sent to printer.',printerFailed:'Failed to read printers: ',dropPdf:'Please drop a PDF file.'}
};
const t=k=>I18N[lang][k]??k;

function applyLanguage(next){
  lang=next;
  document.documentElement.lang=lang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.innerHTML=t(el.dataset.i18n)});
  document.querySelectorAll('[data-i18n-opt]').forEach(el=>{el.textContent=t(el.dataset.i18nOpt)});
  const range=$('rangeInput'); if(range) range.placeholder=t('rangePlaceholder');
  setClass('langId','active',lang==='id'); setClass('langEn','active',lang==='en');
  if(pdfDoc){setText('pageStatus',`${t('page')} ${currentPage} ${t('of')} ${pdfDoc.numPages}`); renderPage(currentPage); updateJob();}
}
function toast(message,error=false){const el=$('toast');el.textContent=message;el.style.background=error?'#7d2f2f':'#203335';el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),2800)}
function setWorkspace(open){$('emptyState').classList.toggle('hidden',open);$('workspace').classList.toggle('hidden',!open);$('closeBtn').disabled=!open;$('printBtnTop').disabled=!open;$('printBtn').disabled=!open}
function selectedPrinter(){return $('printerSelect').value||''}
function formatFileSize(bytes){if(!Number.isFinite(bytes))return '-';const mb=bytes/1024/1024;return `${mb<10?mb.toFixed(2):mb.toFixed(1)} ${t('sizeUnit')}`;}
function paperFromMm(w,h){const a=Math.min(w,h),b=Math.max(w,h);const known=[['A5',148,210],['A4',210,297],['A3',297,420],['Letter',215.9,279.4],['Legal',215.9,355.6],['Tabloid',279.4,431.8],['Folio',215.9,330.2]];let best=null,bestErr=Infinity;for(const [name,x,y] of known){const err=Math.abs(a-x)+Math.abs(b-y);if(err<bestErr){bestErr=err;best=name;}}return bestErr<=2?best:'Custom';}
function updatePageInfo(page){if(!pdfDoc)return;const viewport=page.getViewport({scale:1});const w=viewport.width*25.4/72,h=viewport.height*25.4/72;const orientation=w>=h?'landscape':'portrait';setText('originalPaperInfo',paperFromMm(w,h));setText('dimensionsInfo',`${w.toFixed(1)} × ${h.toFixed(1)} mm`);setText('orientationInfo',orientation==='portrait'?t('portraitInfo'):t('landscapeInfo'));setText('pageInfoDynamic',`${currentPage} ${t('of')} ${pdfDoc.numPages}`);setText('fileNameInfo',currentFileMeta?.name||'PDF');setText('fileSizeInfo',formatFileSize(currentFileMeta?.size));}
function getSelectedCount(){if(!pdfDoc)return 0;if(state.pages==='all')return pdfDoc.numPages;if(state.pages==='range')return parseRanges($('rangeInput').value,pdfDoc.numPages).reduce((n,r)=>n+(r.to-r.from+1),0);return state.pageMode==='odd'?Math.ceil(pdfDoc.numPages/2):Math.floor(pdfDoc.numPages/2)}
function updateJob(){$('jobSummary').textContent=`${pdfDoc?.numPages||0} × ${state.copies}`;$('jobPages').textContent=getSelectedCount();$('jobPaper').textContent=`${state.paper} · ${state.orientation==='portrait'?t('portrait'):t('landscape')}`;setText('pageCountText',`${currentPage} ${t('of')} ${pdfDoc?.numPages||0}`);}

async function renderPage(num){
  if(!pdfDoc)return;
  const token=++renderToken;
  currentPage=Math.max(1,Math.min(pdfDoc.numPages,Number(num)||1));
  setValue('pageInput',currentPage);
  const page=await pdfDoc.getPage(currentPage); if(token!==renderToken)return;
  updatePageInfo(page);
  const base=page.getViewport({scale:1}); const vp=$('pdfViewport');
  const availableW=Math.max(220,vp.clientWidth-44), availableH=Math.max(220,vp.clientHeight-44);
  const fitScale=Math.min(availableW/base.width,availableH/base.height);
  let scale=fitMode?fitScale:zoom;
  if(!isFinite(scale)||scale<=0)scale=1;
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas'); const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
  const ctx=canvas.getContext('2d',{alpha:false});ctx.setTransform(dpr,0,0,dpr,0,0);
  const wrap=$('pdfCanvasWrap'); if(!wrap) throw new Error('Elemen preview PDF tidak ditemukan.'); wrap.replaceChildren(canvas);
  await page.render({canvasContext:ctx,viewport}).promise; if(token!==renderToken)return;
  const shown=Math.round(scale*100);setText('zoomLabel',`${shown}%`);setText('zoomStatus',`${shown}%`);setText('pageStatus',`${t('page')} ${currentPage} ${t('of')} ${pdfDoc.numPages}`);setText('statusText',t('readyStatus'));
}

async function loadPdf(file){
  resetPrintSettings();
  try{
    setText('statusText',t('opening'));
    if(!file || !file.path) throw new Error('Path file PDF tidak tersedia.');
    const raw=await window.revo.readPdf(file.path);
    if(!raw) throw new Error('Data PDF kosong.');
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const task=pdfjsLib.getDocument({data});
    pdfDoc=await task.promise;
    currentFileMeta=file;
    currentPage=1; zoom=1; fitMode=true;
    setText('pageTotal',pdfDoc.numPages);
    setText('fileName',file.name || 'PDF');
    const chip=$('fileChip'); if(chip) chip.classList.remove('hidden');
    setWorkspace(true); updateJob();
    await renderPage(1);
    await refreshPrinters();
    toast(t('opened')+(file.name || 'PDF'));
  }catch(err){
    console.error('loadPdf failed',err);
    pdfDoc=null; setWorkspace(false);
    toast(t('openFailed')+(err?.message || String(err)),true);
  }
}

async function openPdf(){const file=await window.revo.openPdf();if(file)await loadPdf(file)}
async function openQrUpload(){try{const result=await window.revo.startQrUpload();$('qrImage').src=result.qrDataUrl;$('qrUrl').textContent=result.url;$('qrNetwork').textContent=result.public?'🌐 QR Internet aktif — bisa discan dari 4G/5G atau Wi-Fi lain.':'⚠️ Mode lokal';$('qrStatus').textContent=t('qrWaiting');$('qrModal').classList.remove('hidden');window.__qrUrl=result.url}catch(err){toast('QR Internet: '+(err?.message||String(err)),true)}}
async function closeQrUpload(){try{await window.revo.stopQrUpload()}finally{$('qrModal').classList.add('hidden')}}
async function ensureQz() {
  if (typeof qz === 'undefined') throw new Error('Library QZ Tray belum tersedia.');
  if (qz.api?.setTitle) qz.api.setTitle('Revo Print Shop');
  if (!window.__qzSecurityConfigured) {
    if (qz.security?.setSignatureAlgorithm) qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setCertificatePromise((resolve, reject) => {
      window.revo.qzGetCertificate().then(resolve).catch(reject);
    });
    qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
      window.revo.qzSign(toSign).then(resolve).catch(reject);
    });
    window.__qzSecurityConfigured = true;
  }
  if (qz.websocket.isActive()) { qzReady=true; return true; }
  qz.websocket.setErrorCallbacks(err => console.warn('QZ error', err));
  qz.websocket.setClosedCallbacks(() => { qzReady=false; setText('printerStatus', '○ QZ Tray terputus'); $('printerStatus')?.classList.remove('connected'); });
  await qz.websocket.connect({ retries: 10, delay: 1 });
  qzReady=true;
  setText('printerStatus','◉ QZ Tray terhubung');
  $('printerStatus')?.classList.add('connected');
  return true;
}

async function autoConnectQz() {
  try {
    setText('printerStatus','◌ Menghubungkan QZ Tray…');
    await ensureQz();
    const printers=await qz.printers.find();
    qzPrinters=Array.isArray(printers)?printers:[printers].filter(Boolean);
    const select=$('printerSelect');
    if(select) {
      const previous=select.value||'';
      select.replaceChildren();
      if(!qzPrinters.length) {
        select.add(new Option(t('noPrinter'),''));
        setText('printerStatus','○ Tidak ada printer');
        select.value='';
      } else {
        qzPrinters.forEach(name=>select.add(new Option(name,name)));
        const preferred=previous && qzPrinters.includes(previous)?previous:qzPrinters[0];
        select.value=preferred;
        await refreshTrays(preferred);
        setText('printerStatus','◉ QZ Tray terhubung');
        select.dispatchEvent(new Event('change'));
      }
    }
  } catch(err) {
    qzReady=false;
    setText('printerStatus','○ QZ Tray tidak terhubung');
    $('printerStatus')?.classList.remove('connected');
    console.warn('QZ auto-connect:',err?.message||err);
  }
}

async function refreshPrinters(){
  const btn=$('refreshPrinters'); const select=$('printerSelect'); const previous=select?.value||'';
  if(btn){btn.disabled=true;btn.classList.add('busy')}
  try{
    await ensureQz();
    const printers=await qz.printers.find();
    qzPrinters=Array.isArray(printers)?printers:[printers].filter(Boolean);
    select.replaceChildren();
    if(!qzPrinters.length){select.add(new Option(t('noPrinter'),''));setText('printerStatus','○ Tidak ada');$('printerStatus').classList.remove('connected');return;}
    qzPrinters.forEach(name=>select.add(new Option(name,name)));
    const preferred=previous && qzPrinters.includes(previous) ? previous : qzPrinters[0];
    select.value=preferred;
    await refreshTrays(preferred);
    setText('printerStatus','◉ QZ Tray terhubung'); $('printerStatus').classList.add('connected');
  }catch(err){
    qzReady=false; setText('printerStatus','○ QZ Tray tidak terhubung'); $('printerStatus').classList.remove('connected');
    toast(t('printerFailed')+err.message,true);
  }finally{if(btn){btn.disabled=false;btn.classList.remove('busy')}}
}

async function refreshTrays(printerName){
  const tray=$('tray');
  if(!tray || !qzReady) return;
  tray.replaceChildren(new Option(t('defaultPrinter'),'default'));
  try {
    const details=await qz.printers.details();
    const list=Array.isArray(details)?details:[];
    const info=list.find(p=>p.name===printerName);
    const trays=Array.isArray(info?.trays)?info.trays:[];
    for(const item of trays){
      const value=(typeof item==='object' && item!==null) ? (item.name ?? item.id ?? item.index) : item;
      if(value!==undefined && value!==null && String(value).trim()) tray.add(new Option(String(value),String(value)));
    }
    if(state.tray && state.tray!=='default') tray.value=state.tray;
    if(tray.value!==state.tray) state.tray='default';
  } catch(err) {
    console.warn('QZ tray details failed:',err);
  }
}

function paperMm(paper){return {A4:[210,297],A5:[148,210],A3:[297,420],Letter:[215.9,279.4],Legal:[215.9,355.6],Tabloid:[279.4,431.8],Folio:[215.9,330.2]}[paper]||[210,297]}

async function qzPrintPdf(payload){
  await ensureQz();
  const printer=payload.deviceName||selectedPrinter();
  if(!printer) throw new Error('Printer belum dipilih.');
  const prepared=await window.revo.preparePrintPdf(payload);
  const [pw,ph]=paperMm(payload.paper||'A4');
  const size=payload.orientation==='landscape'?{width:ph,height:pw}:{width:pw,height:ph};
  const tray=(payload.tray&&payload.tray!=='default')?payload.tray:null;
  const duplex={simplex:false,longEdge:'long-edge',shortEdge:'short-edge'}[payload.duplex||'simplex'];
  const config=qz.configs.create(printer,{
    size, units:'mm', orientation:null, scaleContent:false,
    margins: payload.margin==='none'?0:0,
    copies:Math.max(1,Number(payload.copies)||1),
    colorType:payload.color==='bw'?'blackwhite':'color',
    duplex, printerTray:tray,
    jobName:`Revo Print Shop - ${currentFileMeta?.name||'PDF'}`
  });
  // QZ Tray can reject Electron's local file path as a file:// URL.
  // Send the prepared PDF as base64 instead; the PDF bytes remain unchanged.
  const data=[{type:'pixel',format:'pdf',flavor:'base64',data:prepared.base64}];
  try {
    await qz.print(config,data);
    return {ok:true,message:t('printSuccess')};
  } finally {
    // The temporary PDF is left briefly so QZ can finish reading it; cleanup happens in main.
    setTimeout(()=>window.revo.deleteTempPrintFile?.(prepared.path), 15000);
  }
}

function parseRanges(s,total){const arr=[];for(const part of s.split(',')){const p=part.trim();if(!p)continue;const m=p.match(/^(\d+)\s*-\s*(\d+)$/);if(m){let a=+m[1],b=+m[2];if(a<1||b<1||a>total||b>total)continue;if(a>b)[a,b]=[b,a];arr.push({from:a-1,to:b-1})}else if(/^\d+$/.test(p)){const n=+p;if(n>=1&&n<=total)arr.push({from:n-1,to:n-1})}}return arr}
function pageRanges(){if(!pdfDoc)return[];if(state.pages==='range')return parseRanges($('rangeInput').value,pdfDoc.numPages);if(state.pageMode==='odd'||state.pageMode==='even'){const odd=state.pageMode==='odd',out=[];for(let i=1;i<=pdfDoc.numPages;i++)if((i%2===1)===odd)out.push({from:i-1,to:i-1});return out}return[{from:0,to:pdfDoc.numPages-1}]}
async function printPdf(){
  if(!pdfDoc)return;
  const ranges=pageRanges();
  if(!ranges.length){toast(t('rangeInvalid'),true);return}
  const rangeText=ranges.map(r=>`${r.from+1}${r.to!==r.from?'-'+(r.to+1):''}`).join(',');
  const payload={...state,deviceName:selectedPrinter(),pages:rangeText||'all',scale:state.scale==='custom'?String(state.customScale):state.scale};
  $('printBtn').disabled=true;$('printBtnTop').disabled=true;$('statusText').textContent=t('preparing');
  try{
    const result=await qzPrintPdf(payload);
    if(currentFileMeta?.jobId && /^RP-[A-Za-z0-9_-]+$/.test(String(currentFileMeta.jobId))){
      const sync=await window.revo.remoteQueueStatus(currentFileMeta.jobId,'printed',`Cetak berhasil dikirim ke printer ${selectedPrinter()}.`);
      if(!sync?.ok) toast('Cetak berhasil; status QR menunggu sinkronisasi.',false);
    }
    toast(result.message||t('printSuccess'));$('statusText').textContent=t('sent');
  }catch(err){
    if(currentFileMeta?.jobId && /^RP-[A-Za-z0-9_-]+$/.test(String(currentFileMeta.jobId))){
      const sync=await window.revo.remoteQueueStatus(currentFileMeta.jobId,'error',`Cetak gagal: ${err?.message||String(err)}`);
      if(!sync?.ok) console.warn('QR Queue error status pending:',sync?.error);
    }
    toast(t('printFailed')+(err?.message||String(err)),true);$('statusText').textContent=t('readyStatus')
  }
  finally{$('printBtn').disabled=false;$('printBtnTop').disabled=false}
}

async function closeFile(){await window.revo.closeFile();pdfDoc=null;currentFileMeta=null;renderToken++;$('fileChip').classList.add('hidden');setWorkspace(false);$('pageTotal').textContent='0';$('pageInput').value='1';$('pageStatus').textContent=`${t('page')} 1 ${t('of')} 0`;setText('pageCountText',`1 ${t('of')} 0`);setText('fileNameInfo','-');setText('fileSizeInfo','-');setText('originalPaperInfo','-');setText('dimensionsInfo','-');setText('orientationInfo','-');setText('pageInfoDynamic',`1 ${t('of')} 0`);$('pdfCanvasWrap').replaceChildren();toast(t('closed'))}

document.addEventListener('DOMContentLoaded',()=>{
$('langId').onclick=()=>applyLanguage('id');
$('langEn').onclick=()=>applyLanguage('en');
$('openBtn').onclick=openPdf;$('chooseBtn').onclick=openPdf;$('qrBtn').onclick=openQrUpload;$('qrCopy').onclick=async()=>{try{await navigator.clipboard.writeText(window.__qrUrl||'');toast(lang==='id'?'Link QR disalin.':'QR link copied.')}catch{toast('Tidak dapat menyalin link.',true)}};$('qrClose').onclick=closeQrUpload;$('qrStop').onclick=closeQrUpload;$('qrBackdrop').onclick=closeQrUpload;$('closeBtn').onclick=closeFile;$('refreshPrinters').onclick=refreshPrinters;
$('printerSelect').onchange=()=>{refreshTrays(selectedPrinter())};
$('disconnectBtn').onclick=()=>{$('printerSelect').selectedIndex=-1;$('printerStatus').textContent=t('disconnected');$('printerStatus').classList.remove('connected');toast(t('printerReleased'))};
$('printBtn').onclick=printPdf;$('printBtnTop').onclick=printPdf;
$('prevPage').onclick=()=>renderPage(currentPage-1);$('nextPage').onclick=()=>renderPage(currentPage+1);$('pageInput').onchange=e=>renderPage(e.target.value);
$('zoomIn').onclick=()=>{fitMode=false;zoom=Math.min(3,zoom+.1);renderPage(currentPage)};$('zoomOut').onclick=()=>{fitMode=false;zoom=Math.max(.25,zoom-.1);renderPage(currentPage)};$('fitBtn').onclick=()=>{fitMode=true;renderPage(currentPage)};$('actualBtn').onclick=()=>{fitMode=false;zoom=1;renderPage(currentPage)};$('fullscreenBtn').onclick=()=>document.documentElement.requestFullscreen?.();
$('minusCopies').onclick=()=>{state.copies=Math.max(1,state.copies-1);$('copies').value=state.copies;updateJob()};$('plusCopies').onclick=()=>{state.copies=Math.min(999,state.copies+1);$('copies').value=state.copies;updateJob()};$('copies').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,3)};$('copies').onchange=e=>{state.copies=Math.max(1,Math.min(999,Number(e.target.value)||1));e.target.value=state.copies;updateJob()};$('paper').onchange=e=>{state.paper=e.target.value;updateJob()};$('scale').onchange=e=>{state.scale=e.target.value;const custom=$('customScaleWrap');if(custom)custom.classList.toggle('hidden',e.target.value!=='custom');if(e.target.value==='custom'){const n=Number($('customScale').value)||100;state.customScale=Math.max(10,Math.min(500,n));}};$('customScale').onchange=e=>{state.customScale=Math.max(10,Math.min(500,Number(e.target.value)||100));e.target.value=state.customScale};$('margin').onchange=e=>{state.margin=e.target.value};$('duplex').onchange=e=>{state.duplex=e.target.value};$('tray').onchange=e=>{state.tray=e.target.value};
document.querySelectorAll('[data-orientation]').forEach(b=>b.onclick=()=>{state.orientation=b.dataset.orientation;document.querySelectorAll('[data-orientation]').forEach(x=>x.classList.toggle('active',x===b));updateJob()});
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{state.color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b))});
$('allPages').onclick=()=>{state.pages='all';$('allPages').classList.add('active');$('specificPages').classList.remove('active');$('rangeInput').classList.add('hidden');updateJob()};$('specificPages').onclick=()=>{state.pages='range';$('specificPages').classList.add('active');$('allPages').classList.remove('active');$('rangeInput').classList.remove('hidden');updateJob()};$('rangeInput').oninput=updateJob;
$('allPageMode').onclick=()=>setPageMode('all');$('oddPages').onclick=()=>setPageMode('odd');$('evenPages').onclick=()=>setPageMode('even');function setPageMode(mode){state.pageMode=mode;document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));({all:$('allPageMode'),odd:$('oddPages'),even:$('evenPages')})[mode].classList.add('active');updateJob()}
$('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragging')});$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('dragging'));$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');const f=e.dataTransfer.files[0];const droppedPath=f?window.revo.getDroppedFilePath(f):'';if(droppedPath&&f.name.toLowerCase().endsWith('.pdf')){window.revo.setCurrentFile(droppedPath).then(file=>loadPdf(file)).catch(err=>toast(t('openFailed')+(err?.message||String(err)),true))}else toast(t('dropPdf'),true)});
window.addEventListener('resize',()=>{if(pdfDoc)renderPage(currentPage)});
window.revo.onQrPdfReceived(async(file)=>{ $('qrStatus').textContent=(lang==='id'?'PDF diterima dari HP. Membuka preview…':'PDF received from phone. Opening preview…'); try { await closeQrUpload(); } catch {} await loadPdf(file); });
applyLanguage('id');
// Automatically connect to QZ Tray when the application opens.
// On the first run QZ Tray may show its security prompt; click Allow and
// enable "Remember this decision" once. QZ will then reconnect automatically.
setTimeout(autoConnectQz, 250);
});

// QR_LIFECYCLE_V1_5_6_RENDERER
