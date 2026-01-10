/**
 * Start Medusa in dev with a dedicated worker process.
 *
 * Why:
 * - If the app runs in server-only mode, subscribers/jobs won't execute.
 * - This script starts:
 *   - Server: `medusa develop` with WORKER_MODE=server
 *   - Worker: `medusa worker` with WORKER_MODE=worker (no HTTP, runs subscribers/jobs)
 *
 * Usage:
 *   yarn dev:with-worker
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

const isWin = process.platform === "win32"

const serverEnv = {
  ...process.env,
  WORKER_MODE: "server",
  MEDUSA_WORKER_MODE: "server",
  ADMIN_DISABLED: "false",
}

const workerEnv = {
  ...process.env,
  WORKER_MODE: "worker",
  MEDUSA_WORKER_MODE: "worker",
  ADMIN_DISABLED: "true",
}

const server = spawn(bin, ["develop"], {
  stdio: "inherit",
  env: serverEnv,
  shell: isWin,
})

const worker = spawn(bin, ["worker"], {
  stdio: "inherit",
  env: workerEnv,
  shell: isWin,
})

function shutdown(code) {
  try {
    server.kill()
  } catch {}
  try {
    worker.kill()
  } catch {}
  process.exit(code ?? 0)
}

server.on("exit", (code) => shutdown(code))
worker.on("exit", (code) => shutdown(code))
server.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Medusa server:", err)
  shutdown(1)
})
worker.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Medusa worker:", err)
  shutdown(1)
})


