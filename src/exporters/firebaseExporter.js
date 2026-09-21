const fs = require('fs');
const path = require('path');
const { c } = require('../config/constants');

function findFirebaseKeys(dir = process.cwd()) {
  try {
    const files = fs.readdirSync(dir);
    return files.filter(f => f.endsWith('.json') && (f.includes('firebase') || f.includes('adminsdk')));
  } catch (e) {
    return [];
  }
}

async function uploadToFirebase(originalPatches, advancedPatches, keyPath, targetCollection = 'all') {
  console.log(`\n${c.bold}[+] Initializing Firebase Admin SDK...${c.reset}`);
  try {
    const admin = require('firebase-admin');
    const serviceAccount = require(keyPath);

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    const batch = db.batch();
    let totalUploaded = 0;
    const colName = (targetCollection || 'all').toLowerCase();
    const targetCols = [];

    const isAll = colName === 'all' || colName === '1';
    const isPatchesOnly = colName === 'patches' || colName === '2';

    // Monolithic JSON bundle collections
    const bundleCols = [];
    if (isAll) {
      bundleCols.push('data_staging', 'staging', 'data');
    } else if (!isPatchesOnly) {
      bundleCols.push(targetCollection);
    }

    bundleCols.forEach(cName => {
      targetCols.push(cName);
      if (originalPatches && originalPatches.length > 0) {
        const origJson = JSON.stringify(originalPatches);
        batch.set(db.collection(cName).doc('patch_notes_original'), { json: origJson }, { merge: true });
        totalUploaded++;
      }
      if (advancedPatches && advancedPatches.length > 0) {
        const advJson = JSON.stringify(advancedPatches);
        batch.set(db.collection(cName).doc('patch_notes_advanced'), { json: advJson }, { merge: true });
        totalUploaded++;
      }
    });

    // Update metadata timestamp if uploading bundle or all
    if (isAll || bundleCols.includes('data_staging')) {
      batch.set(
        db.collection('data_staging_meta').doc('patch_info'),
        { lastPatchNotesUpdate: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      targetCols.push('data_staging_meta');
    }

    // Individual documents in 'patches' collection
    if (isAll || isPatchesOnly) {
      const prepareBatch = (patches, type) => {
        if (!patches || !Array.isArray(patches)) return;
        patches.forEach((patch) => {
          const docId = `${type}_${patch.version}`;
          const docRef = db.collection('patches').doc(docId);
          
          batch.set(docRef, {
            ...patch,
            serverType: type,
            scrapedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          totalUploaded++;
        });
      };

      prepareBatch(originalPatches, 'original');
      prepareBatch(advancedPatches, 'advanced');
      targetCols.push('patches');
    }

    if (totalUploaded > 0) {
      const displayCols = Array.from(new Set(targetCols)).join(', ');
      console.log(`${c.cyan}[+] Uploading ${totalUploaded} records to Firestore collection(s): ${displayCols}...${c.reset}`);
      await batch.commit();
      console.log(`${c.green}[✔] Firebase upload completed successfully!${c.reset}`);
      return displayCols;
    } else {
      console.log(`${c.yellow}[!] No patches found to upload.${c.reset}`);
      return 'None';
    }

  } catch (error) {
    console.error(`${c.red}[x] Firebase upload failed:${c.reset}`, error);
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error(`${c.yellow}Please run "npm install" to ensure firebase-admin is installed.${c.reset}`);
    }
    return 'Failed';
  }
}

module.exports = {
  findFirebaseKeys,
  uploadToFirebase
};
