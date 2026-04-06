#!/usr/bin/env node

import { startServer } from "../src/index.js";

startServer().catch((err) => {
  process.stderr.write(`Failed to start claude-log-analyzer: ${err}\n`);
  process.exit(1);
});
