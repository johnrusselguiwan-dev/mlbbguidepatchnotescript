const path = require('path');
const fs = require('fs');
const { c } = require('../config/constants');
const { exportLocalJson } = require('./localExporter');
const { findFirebaseKeys, uploadToFirebase } = require('./firebaseExporter');
const { askQuestion, promptCollectionSelection } = require('../config/cli');

class ExporterManager {
  static async resolveFirebaseKeyPath(cliKeyPath, destination) {
    let keyPath = cliKeyPath;
    if (!keyPath) {
      const keys = findFirebaseKeys(process.cwd());
      if (keys.length === 1) {
        console.log(`\n${c.green}[✔] Auto-detected Firebase service account key: "${keys[0]}"${c.reset}`);
        keyPath = path.join(process.cwd(), keys[0]);
      } else if (keys.length > 1) {
        if (destination) {
          keyPath = path.join(process.cwd(), keys[0]);
          console.log(`\n${c.cyan}[+] Using auto-selected Firebase key: "${keys[0]}"${c.reset}`);
        } else {
          console.log(`\n${c.bold}Multiple Firebase keys detected:${c.reset}`);
          keys.forEach((key, idx) => console.log(`  ${c.cyan}${idx + 1})${c.reset} ${key}`));
          let keyChoice = await askQuestion(`\n${c.bold}Select a key (1-${keys.length}):${c.reset} `);
          const selectedIndex = parseInt(keyChoice, 10) - 1;
          if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= keys.length) {
            throw new Error('Invalid key selection.');
          }
          keyPath = path.join(process.cwd(), keys[selectedIndex]);
        }
      } else {
        console.log(`\n${c.yellow}[!] No Firebase keys auto-detected in this directory.${c.reset}`);
        const customKey = await askQuestion(`${c.bold}Enter path to your Firebase service account JSON key:${c.reset} `);
        if (!customKey) {
          throw new Error('Firebase key path is required for upload.');
        }
        keyPath = path.resolve(customKey);
      }
    }

    if (!fs.existsSync(keyPath)) {
      throw new Error(`Firebase key file not found at: "${keyPath}".`);
    }
    return keyPath;
  }

  static async handleExport(patchData, options) {
    const { originalPatches, advancedPatches } = patchData;
    const { destChoice, localDir, isFirebase, firebaseKeyPath, targetCollection, isInteractive } = options;

    // 1. Always back up locally
    const savedFiles = exportLocalJson(originalPatches, advancedPatches, localDir);

    // 2. Firebase upload if selected
    const firebaseSyncedCols = [];
    if (isFirebase) {
      const synced = await uploadToFirebase(originalPatches, advancedPatches, firebaseKeyPath, targetCollection);
      if (synced) firebaseSyncedCols.push(synced);

      // Re-upload interactive loop
      if (isInteractive) {
        let keepUploading = true;
        while (keepUploading) {
          const again = await askQuestion(`\n${c.bold}Would you like to upload this data to another collection? (y/N):${c.reset} `);
          if (again.toLowerCase() === 'y' || again.toLowerCase() === 'yes') {
            const nextCol = await promptCollectionSelection();
            const nextSynced = await uploadToFirebase(originalPatches, advancedPatches, firebaseKeyPath, nextCol);
            if (nextSynced) firebaseSyncedCols.push(nextSynced);
          } else {
            keepUploading = false;
          }
        }
      }
    }

    return {
      savedFiles,
      firebaseSyncedCols: firebaseSyncedCols.length > 0 ? firebaseSyncedCols.join(' | ') : 'None'
    };
  }
}

module.exports = ExporterManager;
