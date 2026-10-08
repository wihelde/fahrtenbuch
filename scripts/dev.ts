const children = [
  Bun.spawn(["bun", "--watch", "src/server.ts"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["bun", "run", "vite"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }),
];

function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const exitCode = await Promise.race(children.map((child) => child.exited));
stop();
process.exit(exitCode);
