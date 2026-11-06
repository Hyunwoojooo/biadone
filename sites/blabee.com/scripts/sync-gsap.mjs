import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GSAP_VERSION = "3.15.0";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(root, "node_modules", "gsap", "package.json");
const vendorDirectory = join(root, "js", "vendor");
const gsapPackage = JSON.parse(await readFile(packagePath, "utf8"));

if (gsapPackage.version !== GSAP_VERSION) {
  throw new Error(`Expected GSAP ${GSAP_VERSION}, found ${gsapPackage.version}.`);
}

await mkdir(vendorDirectory, { recursive: true });

for (const filename of ["gsap.min.js", "ScrollTrigger.min.js"]) {
  await copyFile(
    join(root, "node_modules", "gsap", "dist", filename),
    join(vendorDirectory, filename)
  );
}

console.log(`Synced GSAP ${GSAP_VERSION} Core and ScrollTrigger to js/vendor/.`);
