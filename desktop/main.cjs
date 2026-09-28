// Cursor/CI may set this and break Electron's main-process APIs.
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, dialog, shell, screen } = require("electron");
const { spawn, execSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const net = require("node:net");
const { rememberProjectRoot, syncEnvToDataDir, buildServerEnv, discoverRepoRoot } = require("./env.cjs");
const { WEB_PORT, APP_PORT } = require("./ports.cjs");

const ROOT = join(__dirname, "..");
const HOST = "127.0.0.1";
const DATA_DIR = join(homedir(), ".harness-dashboard");
const COMPACT_BOUNDS_PATH = join(DATA_DIR, "compact-bounds.json");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;
/** @type {import("electron").BrowserWindow | null} */
let compactWindow = null;
let isQuitting = false;

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

function loadCompactBounds() {
  try {
    if (!existsSync(COMPACT_BOUNDS_PATH)) return null;
    return JSON.parse(readFileSync(COMPACT_BOUNDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveCompactBounds(win) {
  try {
    const b = win.getBounds();
    writeFileSync(COMPACT_BOUNDS_PATH, JSON.stringify(b, null, 2));
  } catch {
    // best-effort
  }
}

const COMPACT_MAX_HEIGHT = 640;

function defaultCompactBounds() {
  const display = screen.getPrimaryDisplay().workArea;
  const width = 220;
  const height = 168;
  return {
    width,
    height,
    x: display.x + display.width - width - 16,
    y: display.y + 16,
  };
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
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(url);

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.includes("/compact")) {
      void openCompactWindow();
      return { action: "deny" };
    }
    if (target.startsWith(url)) {
      return { action: "allow" };
    }
    shell.openExternal(target);
    return { action: "deny" };
  });
}

async function openCompactWindow() {
  if (compactWindow && !compactWindow.isDestroyed()) {
    compactWindow.show();
    compactWindow.focus();
    return compactWindow;
  }

  const saved = loadCompactBounds();
  const bounds = saved && typeof saved.width === "number" ? saved : defaultCompactBounds();

  // Ignore oversized saved bounds from the first compact iteration.
  const width = Math.min(bounds.width || 220, 280);
  const height = Math.min(bounds.height || 168, 240);

  const win = new BrowserWindow({
    title: "Harness Compact",
    width,
    height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 180,
    minHeight: 140,
    maxWidth: 320,
    maxHeight: COMPACT_MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    vibrancy: "hud",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  compactWindow = win;
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on("moved", () => saveCompactBounds(win));
  win.on("resized", () => saveCompactBounds(win));
  // The HUD reports its content height as "[h=NNN]" in the title so the window
  // grows or shrinks with the number of subscription accounts shown.
  win.on("page-title-updated", (event, title) => {
    event.preventDefault();
    const match = /\[h=(\d+)\]/.exec(title);
    if (!match) return;
    const height = Math.min(COMPACT_MAX_HEIGHT, Math.max(140, Number(match[1])));
    const [width, current] = win.getContentSize();
    if (height !== current) win.setContentSize(width, height);
  });
  win.on("closed", () => {
    if (compactWindow === win) compactWindow = null;
    // Closing the HUD quits the whole desktop app (and stops the local server)
    // so nothing stays resident in the background.
    if (!isQuitting) app.quit();
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(`${baseUrl()}/compact`);

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(baseUrl()) && !target.includes("/compact")) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        void createWindow();
      }
      return { action: "deny" };
    }
    shell.openExternal(target);
    return { action: "deny" };
  });

  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (await portOpen()) {
      await createWindow();
    }
  });

  app.whenReady().then(async () => {
    // Packaged builds get the icon from icon.icns; dev runs need it set explicitly.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock.setIcon(join(__dirname, "icon.png"));
    }
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
    isQuitting = true;
    stopServer();
  });
}
