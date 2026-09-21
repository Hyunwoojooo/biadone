#!/usr/bin/env python3
"""Build only the independent local demo. Does not install or launch it."""
from pathlib import Path
import os
import platform
import plistlib
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP = HERE / "build" / "Blabee Air Demo.app"
MACOS = APP / "Contents" / "MacOS"
UI = APP / "Contents" / "Resources" / "ui"
MACOS.mkdir(parents=True, exist_ok=True)
UI.mkdir(parents=True, exist_ok=True)
for name in ("index.html", "style.css", "studio.css", "studio.js", "icons.js", "data.js", "components.js", "app.js"):
    shutil.copy2(ROOT / name, UI / name)
info = {
    "CFBundleIdentifier": "com.biadone.blabee.air-demo",
    "CFBundleName": "Blabee Air Demo",
    "CFBundleDisplayName": "Blabee Air Demo",
    "CFBundleExecutable": "BlabeeAirDemo",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": "0.1.0",
    "CFBundleVersion": "1",
    "LSMinimumSystemVersion": "13.0",
    "NSHighResolutionCapable": True,
    "NSPrincipalClass": "NSApplication",
}
with (APP / "Contents" / "Info.plist").open("wb") as out:
    plistlib.dump(info, out)
cache = HERE / "build" / "module-cache"
cache.mkdir(exist_ok=True)
arch = "arm64" if platform.machine() == "arm64" else "x86_64"
env = dict(os.environ)
subprocess.run(["/usr/bin/xcrun", "swiftc", str(HERE / "Preview.swift"), "-O", "-target", f"{arch}-apple-macosx13.0", "-module-cache-path", str(cache), "-framework", "AppKit", "-framework", "WebKit", "-o", str(MACOS / "BlabeeAirDemo")], check=True, env=env)
subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(APP)], check=True)
subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(APP)], check=True)
print(APP)
