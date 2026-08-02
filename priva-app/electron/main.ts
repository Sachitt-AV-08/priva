import { app, BrowserWindow, ipcMain, dialog, shell, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import initSqlJs, { Database as SqlJsDatabase } from "sql.js";

let mainWindow: BrowserWindow | null = null;
let db: SqlJsDatabase | null = null;

const DB_PATH = path.join(app.getPath("userData"), "priva.db");

function getPreloadPath() {
  return path.join(__dirname, "preload.js");
}

function getDevUrl() {
  return "http://localhost:5173";
}

function isDev() {
  return !app.isPackaged;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const tempPath = `${DB_PATH}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, "w");
    fs.writeFileSync(descriptor, buffer);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, DB_PATH);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(tempPath); } catch { /* noop */ }
    console.error("[main] database save failed:", error);
  }
}

function runQuery(sql: string, params: any[] = []): any[] {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const rows: any[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function runExecute(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number } {
  if (!db) throw new Error("Database not initialized");
  if (params && params.length > 0) {
    db.run(sql, params);
  } else {
    db.run(sql);
  }
  const changes = db.getRowsModified();
  const lastRow = runQuery("SELECT last_insert_rowid() as id");
  return { changes, lastInsertRowid: lastRow[0]?.id || 0 };
}

async function initDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  let database: SqlJsDatabase;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    database = new SQL.Database(fileBuffer);
  } else {
    database = new SQL.Database();
  }

  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA foreign_keys = ON");

  database.run(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      root_id TEXT,
      sort_key TEXT NOT NULL,
      properties TEXT NOT NULL DEFAULT '{}',
      content TEXT,
      icon TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id, sort_key);
    CREATE INDEX IF NOT EXISTS idx_nodes_root ON nodes(root_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);

    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      sort_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cells (
      row_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      value TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (row_id, column_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_id);

    CREATE TABLE IF NOT EXISTS views (
      id TEXT PRIMARY KEY,
      database_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      sort_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return database;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#090909",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: 1.12,
    },
    show: false,
  });

  // Voice shopping: allow mic + audio capture without a permission prompt.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });

  // If the renderer dies natively (e.g. an audio-stack edge case), the window
  // would otherwise sit black — auto-reload so the app always bounces back.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] renderer gone:", details.reason, details.exitCode);
    if (["crashed", "oom", "launch-failed", "integration-failure"].includes(details.reason)) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 500);
    }
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("[main] renderer unresponsive — reloading");
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 2000);
  });

  if (isDev()) {
    mainWindow.loadURL(getDevUrl());
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIPC() {
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle("db:query", (_event, sql: string, params: unknown[]) => {
    return runQuery(sql, params || []);
  });

  ipcMain.handle("db:execute", (_event, sql: string, params: unknown[]) => {
    const result = runExecute(sql, params || []);
    saveDb();
    return result;
  });

  ipcMain.handle("db:transaction", (_event, operations: { sql: string; params: unknown[] }[]) => {
    if (!db) throw new Error("Database not initialized");
    db.run("BEGIN TRANSACTION");
    const results: unknown[] = [];
    try {
      for (const op of operations) {
        const isSelect = op.sql.trimStart().toUpperCase().startsWith("SELECT");
        if (isSelect) {
          results.push(runQuery(op.sql, op.params || []));
        } else {
          results.push(runExecute(op.sql, op.params || []));
        }
      }
      db.run("COMMIT");
      saveDb();
      return results;
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  });

  ipcMain.handle("dialog:openFile", async (_event, options?: Electron.OpenDialogOptions) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      ...options,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:saveFile", async (_event, options?: Electron.SaveDialogOptions) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    const external = safeExternalUrl(url);
    if (!external) throw new Error("Only secure external URLs are allowed");
    return shell.openExternal(external);
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getPath", (_event, name: string) => app.getPath(name as any));
}

app.whenReady().then(async () => {
  db = await initDatabase();
  registerIPC();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  setInterval(saveDb, 30000);
});

app.on("window-all-closed", () => {
  saveDb();
  if (process.platform !== "darwin") app.quit();
});
