import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packagePath = path.join(rootDir, 'package.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const iosPlistPath = path.join(rootDir, 'src-tauri', 'gen', 'apple', 'note-gen_iOS', 'Info.plist');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const packageJson = readJson(packagePath);
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const tauriConfig = readJson(tauriConfigPath);
tauriConfig.version = version;
if (tauriConfig.bundle?.iOS) {
  tauriConfig.bundle.iOS.bundleVersion = version;
}
writeJson(tauriConfigPath, tauriConfig);

if (fs.existsSync(cargoTomlPath)) {
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  const updatedCargoToml = cargoToml.replace(
    /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  fs.writeFileSync(cargoTomlPath, updatedCargoToml, 'utf8');
}

if (fs.existsSync(iosPlistPath)) {
  const plist = fs.readFileSync(iosPlistPath, 'utf8');
  const updatedPlist = plist
    .replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`,
    )
    .replace(
      /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`,
    );
  fs.writeFileSync(iosPlistPath, updatedPlist, 'utf8');
}

console.log(`Synced app version to ${version}`);
