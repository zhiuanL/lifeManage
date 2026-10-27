/* global window, document */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2]);
const directory = resolve(process.argv[3] ?? "portable/v1-20261022/test");
const output = resolve(process.argv[4] ?? ".verification/v1-20261022/portable");
const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8").then(value => value.replace(/^\uFEFF/, "")));
if (manifest.identifier !== "com.lifeos.verification20261022" ||
    manifest.dataMode !== "isolated-test" || manifest.executable !== "LifeOS.exe") {
  throw new Error("Only the isolated test executable may be launched by this runner.");
}
const executable = join(directory, manifest.executable);
const binary = await readFile(executable);
const hash = createHash("sha256").update(binary).digest("hex");
if (hash !== manifest.sha256) throw new Error("Executable hash does not match the packaging manifest.");
if (binary.toString("ascii", 0, 2) !== "MZ") throw new Error("Expected a Windows executable.");
const peOffset = binary.readUInt32LE(0x3c);
if (binary.readUInt32LE(peOffset) !== 0x4550) throw new Error("Invalid PE header.");
const subsystem = binary.readUInt16LE(peOffset + 24 + 68);
if (subsystem !== 2) throw new Error("The desktop executable must use the Windows GUI subsystem, not a console.");
await mkdir(output, { recursive: true });
const endpoint = "http://127.0.0.1:9460";
try {
  await fetch(`${endpoint}/json/version`);
  throw new Error("CDP port 9460 is already occupied.");
} catch (error) {
  if (error.message === "CDP port 9460 is already occupied.") throw error;
}
const application = spawn(executable, [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9460",
    WEBVIEW2_USER_DATA_FOLDER: join(output, "webview-profile"),
  },
});
let launchError;
application.once("error", error => { launchError = error; });
let browser;
const errors = [];
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (application.exitCode !== null) throw new Error(`Application exited: ${application.exitCode}`);
    try {
      await fetch(`${endpoint}/json/version`);
      browser = await chromium.connectOverCDP(endpoint);
      break;
    } catch {
      await new Promise(done => setTimeout(done, 500));
    }
  }
  if (!browser) throw new Error("Timed out waiting for the isolated application.");
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "添加领域", exact: true }).waitFor();
  const metrics = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const scaleFactor = await invoke("plugin:window|scale_factor", { label: "main" });
    const innerSize = await invoke("plugin:window|inner_size", { label: "main" });
    return {
      scaleFactor, innerSize, devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  await page.screenshot({ path: join(output, "native-home.png"), fullPage: true });
  if (metrics.horizontalOverflow || errors.length) throw new Error("Native preview has overflow or page errors.");
  await writeFile(join(output, "report.json"), JSON.stringify({
    success: true, identifier: manifest.identifier, sha256: hash, peSubsystem: subsystem,
    nativeMetrics: metrics, system125Percent: Math.abs(metrics.scaleFactor - 1.25) < 0.001,
    emulationUsed: false, pageErrors: errors, recordedAt: new Date().toISOString(),
  }, null, 2));
  console.log(JSON.stringify(metrics));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (application.exitCode === null && application.pid) {
    const stopped = new Promise(done => application.once("exit", done));
    application.kill();
    await stopped;
  }
}
