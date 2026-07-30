// Cursor/CI may set this and break Electron's main-process APIs.
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, execSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const net = require("node:net");
const { rememberProjectRoot, syncEnvToDataDir, buildServerEnv, discoverRepoRoot } = require("./env.cjs");
const { WEB_PORT, APP_PORT } = require("./ports.cjs");

const ROOT = join(__dirname, "..");
const HOST = "127.0.0.1";
const DATA_DIR = join(homedir(), ".harness-dashboard");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;

function port() {
  return app.isPackaged ? APP_PORT : WEB_PORT;
}

function baseUrl() {
  return `http://${HOST}:${port()}`;
}

function healthUrl() {
  return `${baseUrl()}/api/health`;
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: port() }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function healthOk() {
  try {
    const res = await fetch(healthUrl(), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthOk()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function freePort() {
  const p = port();
  try {
    const pids = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, {
      encoding: "utf8",
    }).trim();
    if (!pids) return;
    for (const pid of pids.split("\n")) {
      if (!pid) continue;
      process.kill(Number(pid), "SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // nothing listening
  }
}

function bunPath() {
  const candidates = [
    process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : null,
    join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ].filter(Boolean);
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  try {
    return execSync("which bun", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function ensureServer() {
  mkdirSync(DATA_DIR, { recursive: true });

  const repoRoot = discoverRepoRoot(
    DATA_DIR,
    app.isPackaged ? process.resourcesPath : ROOT,
  );
  if (!app.isPackaged) rememberProjectRoot(ROOT, DATA_DIR);
  syncEnvToDataDir(repoRoot ?? (!app.isPackaged ? ROOT : undefined), DATA_DIR);

  if (await healthOk()) {
    await freePort();
  }

  const binary = app.isPackaged
    ? join(process.resourcesPath, "harness-dashboard")
    : join(ROOT, "dist", "harness-dashboard");
  const isDev = !app.isPackaged;
  const packagedEnv = app.isPackaged
    ? { NODE_ENV: "production", HARNESS_DASHBOARD_PORT: String(APP_PORT) }
    : {};
  const spawnEnv = () =>
    buildServerEnv({
      repoRoot: repoRoot ?? ROOT,
      dataDir: DATA_DIR,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      extra: packagedEnv,
    });

  if (isDev) {
    const bun = bunPath();
    if (!bun) throw new Error("Bun not found. Install from https://bun.sh");
    serverProcess = spawn(bun, ["run", "dev"], {
      cwd: ROOT,
      env: spawnEnv(),
      stdio: "inherit",
    });
  } else if (existsSync(binary)) {
    serverProcess = spawn(binary, [], {
      cwd: DATA_DIR,
      env: spawnEnv(),
      stdio: "inherit",
    });
  } else {
    const bun = bunPath();
    if (!bun) throw new Error("Server binary missing and Bun not found.");
    serverProcess = spawn(bun, ["run", "start"], {
      cwd: ROOT,
      env: spawnEnv(),
      stdio: "inherit",
    });
  }

  serverProcess.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[harness-dashboard] server exited with code ${code}`);
    }
    serverProcess = null;
  });

  if (!(await waitForServer())) {
    throw new Error("Harness Dashboard server did not start in time.");
  }
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

async function createWindow() {
  const url = baseUrl();
  const win = new BrowserWindow({
    title: "Harness Dashboard",
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(url);

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(url)) {
      return { action: "allow" };
    }
    shell.openExternal(target);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", async () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    } else if (await portOpen()) {
      await createWindow();
    }
  });

  app.whenReady().then(async () => {
    try {
      await ensureServer();
      await createWindow();
    } catch (err) {
      dialog.showErrorBox(
        "Harness Dashboard",
        err instanceof Error ? err.message : String(err),
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        if (await healthOk()) await createWindow();
        else {
          await ensureServer();
          await createWindow();
        }
      } catch (err) {
        dialog.showErrorBox(
          "Harness Dashboard",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  });

  app.on("before-quit", () => {
    stopServer();
  });
}
