const { spawn } = require("child_process");

const processes = [
  spawn(process.execPath, ["src/server.js"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["src/queues/clickEvent.worker.js"], {
    stdio: "inherit",
  }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 1000);
}

for (const child of processes) {
  child.on("error", (error) => {
    console.error("Process error:", error);
    shutdown(1);
  });

  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error("A process exited. Shutting down both processes.");
      shutdown(code || 1);
    }
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));