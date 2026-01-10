/**
 * Cross-platform worker starter for Medusa v2.
 *
 * This runs the Medusa app in worker mode (subscribers/jobs only).
 *
 * Usage:
 *   yarn start:worker
 */

const path = require("path")
const { spawn } = require("child_process")

const bin = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "medusa.cmd" : "medusa"
)

const env = {
  ...process.env,
  WORKER_MODE: process.env.WORKER_MODE || process.env.MEDUSA_WORKER_MODE || "worker",
  ADMIN_DISABLED: process.env.ADMIN_DISABLED || "true",
}

const isWin = process.platform === "win32"

// On Windows, spawning a .cmd requires a shell.
// Use the dedicated worker command so it won't try to bind the HTTP port.
const child = spawn(bin, ["worker"], {
  stdio: "inherit",
  env,
  shell: isWin,
})

child.on("exit", (code) => process.exit(code ?? 0))
child.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Medusa worker:", err)
  process.exit(1)
})


