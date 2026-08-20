const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  onQrPdfReceived: (callback) => ipcRenderer.on('qr-pdf-received', (_event, file) => callback(file))
});
