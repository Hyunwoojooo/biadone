#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const execFile = promisify(execFileCallback);
const defaultSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumFileBytes = 512 * 1024 * 1024;
const inspectionEnvironment = Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" });

export const BLABEE_TEST_APP_PROFILE = Object.freeze({
  id: "blabee-test", bundleIdentifier: "com.biadone.blabee.test", name: "Blabee Test",
  bundleName: "Blabee Test.app", executable: "blabee-coordinator", icon: "BlabeeTest.icns",
});

function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function requireBuildID(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
    throw new Error("test build ID must be a single safe path component");
  }
  return value;
}

async function requireRealPath(root, candidate, directory) {
  if (!isWithin(root, candidate)) throw new Error("test build path escaped its owned root");
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("test build root must be a real directory");
  }
  let current = root;
  const parts = relative(root, candidate).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("test build paths must not contain symlinks");
  }
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
    throw new Error("test build input has an unexpected file type");
  }
  return metadata;
}

async function ensureOutputParent(sourceRoot, componentPath) {
  let current = sourceRoot;
  for (const component of componentPath) {
    current = join(current, component);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const metadata = await requireRealPath(sourceRoot, current, true);
    if ((metadata.mode & 0o022) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      throw new Error("test output directories must be owned and not writable by other users");
    }
  }
  return current;
}

async function copyStableFile(sourceRoot, source, destination, mode) {
  const before = await requireRealPath(sourceRoot, source, false);
  if (before.size > maximumFileBytes) throw new Error("test app input exceeds its size limit");
  const data = await readFile(source, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
  const after = await lstat(source);
  if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error("test app input changed during assembly");
  }
  await writeFile(destination, data, { mode, flag: "wx" });
  await chmod(destination, mode);
}

export function makeTestSwiftBuildArguments({ sourceRoot, scratchPath, configuration = "debug", showBinPath = false }) {
  if (!["debug", "release"].includes(configuration)) throw new Error("unsupported test build configuration");
  const args = ["--sdk", "macosx", "swift", "build", "--package-path", sourceRoot,
    "--scratch-path", scratchPath, "--configuration", configuration, "--jobs", "1",
    "--disable-keychain", "--disable-netrc", "-Xswiftc", "-DBLABEE_TEST_APP"];
  return [...args, ...(showBinPath ? ["--show-bin-path"] : ["--product", BLABEE_TEST_APP_PROFILE.executable])];
}

export async function verifyCompiledTestAppProfile(binary, { runner = execFile } = {}) {
  if (!isAbsolute(binary)) throw new Error("test profile probe requires an absolute binary path");
  const { stdout, stderr } = await runner(binary, ["distribution-profile"], {
    cwd: dirname(binary), env: inspectionEnvironment, encoding: "utf8", maxBuffer: 4096,
    timeout: 5000, killSignal: "SIGKILL",
  });
  if (typeof stdout !== "string" || typeof stderr !== "string"
      || Buffer.byteLength(stdout) > 4096 || Buffer.byteLength(stderr) > 4096) {
    throw new Error("compiled Test app profile exceeds its bounded response");
  }
  let value;
  try { value = JSON.parse(stdout); } catch { throw new Error("invalid compiled Test app profile"); }
  if (value === null || Array.isArray(value) || stderr !== "" || !stdout.endsWith("\n")
      || Object.keys(value).sort().join(",") !== "bundle_identifier,profile_id,schema_version"
      || value.schema_version !== "blabee.distribution-profile.v1"
      || value.profile_id !== BLABEE_TEST_APP_PROFILE.id
      || value.bundle_identifier !== BLABEE_TEST_APP_PROFILE.bundleIdentifier) {
    throw new Error("compiled binary is not the Blabee Test profile");
  }
  const normalized = stdout.replace(/"(?:\\.|[^"\\])*"|\s+/gu,
    token => token.startsWith('"') ? JSON.stringify(JSON.parse(token)) : "");
  if (normalized !== JSON.stringify(value)) throw new Error("ambiguous compiled Test app profile");
  return value;
}

function plist() {
  const profile = BLABEE_TEST_APP_PROFILE;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>${profile.name}</string>
<key>CFBundleName</key><string>${profile.name}</string>
<key>CFBundleExecutable</key><string>${profile.executable}</string>
<key>CFBundleIconFile</key><string>${profile.icon}</string>
<key>CFBundleIdentifier</key><string>${profile.bundleIdentifier}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>BlabeeDistributionProfile</key><string>${profile.id}</string>
<key>BlabeeTestMilestone</key><string>M2</string>
<key>BlabeeTestMode</key><string>isolated-development</string>
<key>BlabeeTestSimulationOnly</key><false/>
<key>BlabeeTestEngineEnabled</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), output.length - 4);
  return output;
}

// A distinct, deterministic TEST icon needs no downloaded artwork or tool.
export function testAppIcon() {
  const size = 256;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const letters = {
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const cornerX = Math.max(36 - x, x - 219, 0);
    const cornerY = Math.max(36 - y, y - 219, 0);
    const visible = cornerX * cornerX + cornerY * cornerY <= 36 * 36;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set([47, 61, 142, visible ? 255 : 0], offset);
  }
  for (const [index, letter] of [..."TEST"].entries()) for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 5; column += 1) if (letters[letter][row][column] === "1") {
      for (let dy = 0; dy < 8; dy += 1) for (let dx = 0; dx < 8; dx += 1) {
        const x = 36 + index * 48 + column * 8 + dx;
        const y = 100 + row * 8 + dy;
        pixels.set([255, 255, 255, 255], y * (size * 4 + 1) + 1 + x * 4);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
  const icon = Buffer.alloc(16);
  icon.write("icns", 0, "ascii"); icon.writeUInt32BE(16 + png.length, 4);
  icon.write("ic08", 8, "ascii"); icon.writeUInt32BE(8 + png.length, 12);
  return Buffer.concat([icon, png]);
}

export async function buildTestApp({
  sourceRoot = defaultSourceRoot,
  buildID = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`,
  configuration = "debug", runner = execFile, platform = process.platform,
} = {}) {
  if (platform !== "darwin") throw new Error("Blabee Test.app requires macOS");
  if (!isAbsolute(sourceRoot)) throw new Error("test app source root must be absolute");
  const source = await realpath(sourceRoot);
  requireBuildID(buildID);
  // Validate before reserving output or invoking any native tool.
  makeTestSwiftBuildArguments({ sourceRoot: source, scratchPath: source, configuration });
  const outputParent = await ensureOutputParent(source, ["build", "test-app"]);
  const outputRoot = join(outputParent, buildID);
  await mkdir(outputRoot, { mode: 0o700 }); // Existing outputs are never overwritten.
  const scratchPath = join(outputRoot, "swift-build");
  const toolHome = join(outputRoot, "tool-home");
  const temporaryDirectory = join(outputRoot, "tool-tmp");
  const moduleCache = join(outputRoot, "module-cache");
  for (const directory of [toolHome, temporaryDirectory, moduleCache]) await mkdir(directory, { mode: 0o700 });
  const options = {
    cwd: source, encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...inspectionEnvironment, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
      HOME: toolHome, TMPDIR: temporaryDirectory, CLANG_MODULE_CACHE_PATH: moduleCache,
      SWIFTPM_MODULECACHE_OVERRIDE: moduleCache },
  };
  try {
    await runner("/usr/bin/xcrun", makeTestSwiftBuildArguments({ sourceRoot: source, scratchPath, configuration }), options);
    const result = await runner("/usr/bin/xcrun", makeTestSwiftBuildArguments({
      sourceRoot: source, scratchPath, configuration, showBinPath: true,
    }), options);
    const binDirectory = String(result.stdout).trim();
    if (result.stderr !== "" || !isAbsolute(binDirectory) || /[\r\n\0]/u.test(binDirectory)) {
      throw new Error("invalid Test app Swift output path");
    }
    const binary = join(binDirectory, BLABEE_TEST_APP_PROFILE.executable);
    const binaryMetadata = await requireRealPath(scratchPath, binary, false);
    if ((binaryMetadata.mode & 0o111) === 0) throw new Error("Test app binary is not executable");
    await verifyCompiledTestAppProfile(binary, { runner });
    const stagingBundle = join(outputRoot, ".Blabee Test.app.staging");
    const contents = join(stagingBundle, "Contents");
    const resources = join(contents, "Resources");
    const macOS = join(contents, "MacOS");
    await mkdir(join(resources, "Fonts", "Pretendard"), { recursive: true, mode: 0o700 });
    await mkdir(macOS, { mode: 0o700 });
    await copyStableFile(scratchPath, binary, join(macOS, BLABEE_TEST_APP_PROFILE.executable), 0o755);
    for (const name of ["PretendardVariable.ttf", "LICENSE.txt"]) {
      await copyStableFile(source, join(source, "Packaging", "macos", "Resources", "Fonts", "Pretendard", name),
        join(resources, "Fonts", "Pretendard", name), 0o644);
    }
    await writeFile(join(resources, BLABEE_TEST_APP_PROFILE.icon), testAppIcon(), { mode: 0o644, flag: "wx" });
    await writeFile(join(contents, "Info.plist"), plist(), { mode: 0o644, flag: "wx" });
    await writeFile(join(resources, "TestAppManifest.json"), `${JSON.stringify({
      schema_version: "blabee.test-app-bundle.v1", profile_id: BLABEE_TEST_APP_PROFILE.id,
      build_id: buildID, milestone: "M2", simulation_only: false, keychain_policy: "run_scoped_freshness_only",
      capabilities: { network: false, keychain: true, native_providers: false, production_services: false,
        auto_update: false, login_items: false, global_hotkeys: false, telemetry: false },
    }, null, 2)}\n`, { mode: 0o644, flag: "wx" });
    await runner("/usr/bin/codesign", ["--force", "--sign", "-", stagingBundle], options);
    await runner("/usr/bin/codesign", ["--verify", "--strict", stagingBundle], options);
    const bundlePath = join(outputRoot, BLABEE_TEST_APP_PROFILE.bundleName);
    await rename(stagingBundle, bundlePath);
    return Object.freeze({ bundlePath, outputRoot, scratchPath, buildID, profile: BLABEE_TEST_APP_PROFILE.id });
  } catch (error) {
    // Preserve the unique owned directory for diagnosis. Never inspect, stop,
    // remove, install over, or relaunch an existing product app on failure.
    await writeFile(join(outputRoot, "BUILD_FAILED.txt"), "Test app assembly failed. No product installation was modified.\n",
      { mode: 0o600, flag: "wx" });
    throw error;
  }
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = { "--build-id": "buildID", "--configuration": "configuration" }[values[index]];
    if (!key || options[key] !== undefined || values[index + 1] === undefined) {
      throw new Error("usage: build-test-app.mjs [--build-id ID] [--configuration debug|release]");
    }
    options[key] = values[index + 1];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await buildTestApp(parseArguments(process.argv.slice(2))))}\n`); }
  catch (error) { process.stderr.write(`Blabee Test build failed: ${error.message}\n`); process.exitCode = 1; }
}
