// One-command Electron dev: sets ELECTRON_START so vite-plugin-electron's
// main-entry onstart() spawns Electron once the dev server is ready.
process.env.ELECTRON_START = "1";
const { spawn } = require("child_process");
const child = spawn("vite", [], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
