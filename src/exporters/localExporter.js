const fs = require('fs');
const path = require('path');
const { c } = require('../config/constants');

function exportLocalJson(originalPatches, advancedPatches, localDir = '.') {
  const savedFiles = [];

  if (!fs.existsSync(localDir)) {
    console.log(`${c.cyan}[+] Creating local output directory: "${localDir}"${c.reset}`);
    fs.mkdirSync(localDir, { recursive: true });
  }

  if (originalPatches && originalPatches.length > 0) {
    const origFile = path.join(localDir, 'patch-notes-original.json');
    fs.writeFileSync(origFile, JSON.stringify(originalPatches, null, 2));
    savedFiles.push('patch-notes-original.json');
  }

  if (advancedPatches && advancedPatches.length > 0) {
    const advFile = path.join(localDir, 'patch-notes-advanced.json');
    fs.writeFileSync(advFile, JSON.stringify(advancedPatches, null, 2));
    savedFiles.push('patch-notes-advanced.json');
  }

  console.log(`${c.green}[✔] Local backup updated automatically: patch-notes-original.json, patch-notes-advanced.json${c.reset}`);
  return savedFiles;
}

module.exports = {
  exportLocalJson
};
