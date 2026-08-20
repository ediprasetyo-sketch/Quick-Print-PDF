const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const forge = require('node-forge');

const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'revo-print-shop', 'qz-identity');
fs.mkdirSync(dir, { recursive: true });

const rootCertPath = path.join(dir, 'revo-qz-root.crt');
const rootKeyPath = path.join(dir, 'revo-qz-root-key.pem');
const certPath = path.join(dir, 'digital-certificate.txt');
const keyPath = path.join(dir, 'private-key.pem');

function writeSecure(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
}

if (fs.existsSync(rootCertPath) && fs.existsSync(rootKeyPath) && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('QZ local root/leaf certificate sudah ada.');
  console.log(`Root: ${rootCertPath}`);
  console.log(`Leaf: ${certPath}`);
  process.exit(0);
}

const rootKeys = forge.pki.rsa.generateKeyPair(2048);
const root = forge.pki.createCertificate();
root.publicKey = rootKeys.publicKey;
root.serialNumber = crypto.randomBytes(16).toString('hex');
const now = new Date();
root.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
root.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
const rootAttrs = [
  { name: 'commonName', value: 'Revo Print Shop Local Root' },
  { name: 'organizationName', value: 'Revo Print Shop' }
];
root.setSubject(rootAttrs);
root.setIssuer(rootAttrs);
root.setExtensions([
  { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 },
  { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true },
  { name: 'subjectKeyIdentifier' },
  { name: 'authorityKeyIdentifier', keyIdentifier: true }
]);
root.sign(rootKeys.privateKey, forge.md.sha256.create());

const leafKeys = forge.pki.rsa.generateKeyPair(2048);
const leaf = forge.pki.createCertificate();
leaf.publicKey = leafKeys.publicKey;
leaf.serialNumber = crypto.randomBytes(16).toString('hex');
leaf.validity.notBefore = new Date(now.getTime() - 5 * 60 * 1000);
leaf.validity.notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
const leafAttrs = [
  { name: 'commonName', value: 'Revo Print Shop Local' },
  { name: 'organizationName', value: 'Revo Print Shop' }
];
leaf.setSubject(leafAttrs);
leaf.setIssuer(rootAttrs);
leaf.setExtensions([
  { name: 'basicConstraints', cA: false, critical: true },
  { name: 'keyUsage', critical: true, digitalSignature: true },
  { name: 'subjectKeyIdentifier' },
  { name: 'authorityKeyIdentifier', keyIdentifier: true, authorityCertIssuer: true }
]);
leaf.sign(rootKeys.privateKey, forge.md.sha256.create());

writeSecure(rootCertPath, forge.pki.certificateToPem(root));
writeSecure(rootKeyPath, forge.pki.privateKeyToPem(rootKeys.privateKey));
writeSecure(certPath, forge.pki.certificateToPem(leaf));
writeSecure(keyPath, forge.pki.privateKeyToPem(leafKeys.privateKey));

console.log('Generated QZ local root:', rootCertPath);
console.log('Generated QZ signing certificate:', certPath);
console.log('Generated QZ signing key:', keyPath);
console.log('The private keys remain local to this Windows user.');
