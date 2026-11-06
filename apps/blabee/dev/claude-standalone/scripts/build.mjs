import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLE_ID, DEVELOPMENT_BUILD_ROOT, PROJECT_ROOT, runtimePath } from '../src/shared/identity.mjs';

const buildRoot = DEVELOPMENT_BUILD_ROOT;
const app = join(buildRoot, 'blabee-claude.app');
const binary = join(app, 'Contents/MacOS/blabee-claude');
const running = spawnSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
if (running.status !== 0) throw new Error('Could not verify that the Claude app is stopped');
if (running.stdout.split('\n').some(line => line.trim() === binary || line.trim().startsWith(binary + ' '))) {
  throw new Error('Blabee Claude is running. Quit that app before rebuilding; Codex Blabee can stay open.');
}
await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(join(app, 'Contents/Resources/runtime/src'), { recursive: true });
await mkdir(join(buildRoot, 'swift-cache'), { recursive: true });
const sources = (await readdir(join(PROJECT_ROOT, 'src/pet'))).filter(name => name.endsWith('.swift')).sort();
if (!sources.length) throw new Error('No Pet Swift sources found');
const compile = spawnSync('/usr/bin/swiftc', [
  '-swift-version', '6', '-O', '-module-cache-path', join(buildRoot, 'swift-cache'),
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
  '-framework', 'AppKit', ...sources.map(name => join(PROJECT_ROOT, 'src/pet', name)), '-o', binary,
], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(buildRoot, 'swift-cache') } });
if (compile.status !== 0) process.exit(compile.status || 1);
for (const directory of ['coordinator', 'shared']) {
  await cp(join(PROJECT_ROOT, 'src', directory), join(app, 'Contents/Resources/runtime/src', directory), { recursive: true });
}
await writeFile(join(app, 'Contents/Resources/runtime/package.json'), '{"type":"module"}\n');
await writeFile(join(app, 'Contents/Resources/runtime-config.json'), JSON.stringify({
  runtime: runtimePath(), node: process.execPath,
  service: join(app, 'Contents/Resources/runtime/src/coordinator/service.mjs'),
}, null, 2) + '\n');
const packageInfo = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleExecutable</key><string>blabee-claude</string>
<key>CFBundleName</key><string>Blabee Claude</string>
<key>CFBundleDisplayName</key><string>Blabee Claude</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${packageInfo.version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>\n`);
const sign = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, app], { stdio: 'inherit' });
if (sign.status !== 0) process.exit(sign.status || 1);
console.log(`Built development app: ${app}`);
console.log('Uses this checkout and its recorded Node runtime. No installation or launch agent registration performed.');
