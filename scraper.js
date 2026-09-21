#!/usr/bin/env node
const { main } = require('./src/index');

main().catch((err) => {
  console.error('[x] Fatal CLI Error:', err);
  process.exit(1);
});
