import { contextBridge, ipcRenderer } from "electron";

export interface PrivaAPI {
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
  };
  db: {
    query: (sql: string, params?: unknown[]) => Promise<any[]>;
    execute: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number | bigint }>;
    transaction: (operations: { sql: string; params: unknown[] }[]) => Promise<any[]>;
  };
  dialog: {
    openFile: (options?: any) => Promise<string | null>;
    saveFile: (options?: any) => Promise<string | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };
}

const api: PrivaAPI = {
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  },
  db: {
    query: (sql, params = []) => ipcRenderer.invoke("db:query", sql, params),
    execute: (sql, params = []) => ipcRenderer.invoke("db:execute", sql, params),
    transaction: (operations) => ipcRenderer.invoke("db:transaction", operations),
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke("dialog:openFile", options),
    saveFile: (options) => ipcRenderer.invoke("dialog:saveFile", options),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPath: (name) => ipcRenderer.invoke("app:getPath", name),
  },
};

contextBridge.exposeInMainWorld("priva", api);
