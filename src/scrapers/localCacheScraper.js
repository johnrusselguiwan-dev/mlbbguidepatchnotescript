const fs = require('fs');
const path = require('path');
const BaseScraper = require('./baseScraper');
const { c } = require('../config/constants');

class LocalCacheScraper extends BaseScraper {
  constructor(localDir = '.') {
    super();
    this.localDir = localDir;
  }

  async scrape() {
    console.log(`\n${c.cyan}[+] Loading local cached JSON files...${c.reset}`);
    const result = { originalPatches: [], advancedPatches: [] };
    const origFile = path.join(this.localDir, 'patch-notes-original.json');
    const advFile = path.join(this.localDir, 'patch-notes-advanced.json');

    if (fs.existsSync(origFile)) {
      try {
        result.originalPatches = JSON.parse(fs.readFileSync(origFile, 'utf8'));
      } catch (e) {
        console.error(`${c.red}[!] Failed to parse ${origFile}:${c.reset}`, e.message);
      }
    }

    if (fs.existsSync(advFile)) {
      try {
        result.advancedPatches = JSON.parse(fs.readFileSync(advFile, 'utf8'));
      } catch (e) {
        console.error(`${c.red}[!] Failed to parse ${advFile}:${c.reset}`, e.message);
      }
    }

    console.log(`${c.green}[✔] Loaded ${result.originalPatches.length} Official & ${result.advancedPatches.length} Advanced patches from local cache.${c.reset}`);
    return result;
  }
}

module.exports = LocalCacheScraper;
