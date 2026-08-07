const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Safe mock of self.__next_f.push
const chunks = [];
const self = {
  __next_f: {
    push: (data) => {
      if (data[1]) {
        chunks.push(data[1]);
      }
    }
  }
};

// Setup readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

// Bracket matching parser to extract JSON arrays
function extractJsonArray(chunk, keyName) {
  const startKey = `"${keyName}":`;
  const keyIndex = chunk.indexOf(startKey);
  if (keyIndex === -1) return null;

  const arrayStart = chunk.indexOf('[', keyIndex);
  if (arrayStart === -1) return null;

  let open = 0;
  let i = arrayStart;
  let inString = false;
  let escape = false;

  for (; i < chunk.length; i++) {
    if (escape) {
      escape = false;
      continue;
    }
    if (chunk[i] === '\\') {
      escape = true;
      continue;
    }
    if (chunk[i] === '"') {
      inString = !inString;
    }
    if (!inString) {
      if (chunk[i] === '[') open++;
      else if (chunk[i] === ']') {
        open--;
        if (open === 0) {
          break;
        }
      }
    }
  }

  const jsonStr = chunk.substring(arrayStart, i + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Failed to parse extracted JSON array for ${keyName}:`, e.message);
    return null;
  }
}

// Find files containing Firebase Admin credentials in directory
function findFirebaseKeys() {
  try {
    const files = fs.readdirSync(__dirname);
    return files.filter(f => f.endsWith('.json') && (f.includes('firebase') || f.includes('adminsdk')));
  } catch (e) {
    return [];
  }
}

async function scrape() {
  console.log('\n--- MLBBHub Patch Notes Scraper ---\n');
  
  // CLI Step 1: Choose Export Destination
  console.log('Choose export destination:');
  console.log('1) Save locally as JSON files');
  console.log('2) Publish to Firebase Firestore (Monolithic)');
  console.log('3) Both (Save locally and publish to Firebase)');
  
  let choice = await askQuestion('Enter choice (1-3) [default: 1]: ');
  if (!choice) choice = '1';
  
  if (!['1', '2', '3'].includes(choice)) {
    console.error('Invalid choice. Exiting.');
    rl.close();
    return;
  }

  let localDir = '.';
  // CLI Step 2: Choose local path if saving locally
  if (choice === '1' || choice === '3') {
    const inputDir = await askQuestion('\nEnter local output directory path (press Enter for current directory): ');
    if (inputDir) {
      localDir = path.resolve(inputDir);
      if (!fs.existsSync(localDir)) {
        console.log(`Directory "${localDir}" does not exist. Creating it...`);
        fs.mkdirSync(localDir, { recursive: true });
      }
    }
  }

  let firebaseKeyPath = null;
  // CLI Step 3: Firebase Config
  if (choice === '2' || choice === '3') {
    const keys = findFirebaseKeys();
    if (keys.length === 1) {
      console.log(`\nAuto-detected Firebase service account key: "${keys[0]}"`);
      firebaseKeyPath = path.join(__dirname, keys[0]);
    } else if (keys.length > 1) {
      console.log('\nMultiple Firebase keys detected:');
      keys.forEach((key, idx) => console.log(`${idx + 1}) ${key}`));
      let keyChoice = await askQuestion(`Select a key (1-${keys.length}): `);
      const selectedIndex = parseInt(keyChoice, 10) - 1;
      if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= keys.length) {
        console.error('Invalid selection. Exiting.');
        rl.close();
        return;
      }
      firebaseKeyPath = path.join(__dirname, keys[selectedIndex]);
    } else {
      console.log('\nNo Firebase keys auto-detected in this directory.');
      const customKey = await askQuestion('Enter path to your Firebase service account JSON key: ');
      if (!customKey) {
        console.error('Firebase key path is required for upload. Exiting.');
        rl.close();
        return;
      }
      firebaseKeyPath = path.resolve(customKey);
    }

    if (!fs.existsSync(firebaseKeyPath)) {
      console.error(`Firebase key file not found at: "${firebaseKeyPath}". Exiting.`);
      rl.close();
      return;
    }
  }

  console.log('\nFetching patch notes from MLBBHub...');
  try {
    const response = await fetch('https://mlbbhub.com/patch-notes');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();

    console.log('Extracting RSC payload scripts...');
    const regex = /<script>self\.__next_f\.push\((.*?)\)<\/script>/g;
    let match;
    let evalCount = 0;
    while ((match = regex.exec(html)) !== null) {
      try {
        eval(`self.__next_f.push(${match[1]})`);
        evalCount++;
      } catch (e) {}
    }
    console.log(`Evaluated ${evalCount} scripts.`);

    let originalPatches = null;
    let advancedPatches = null;

    for (const chunk of chunks) {
      if (typeof chunk === 'string') {
        if (!originalPatches && chunk.includes('originalPatches')) {
          originalPatches = extractJsonArray(chunk, 'originalPatches');
        }
        if (!advancedPatches && chunk.includes('advancedPatches')) {
          advancedPatches = extractJsonArray(chunk, 'advancedPatches');
        }
      }
    }

    if (!originalPatches) {
      console.warn('Could not find originalPatches in RSC payload.');
    } else if (choice === '1' || choice === '3') {
      const origFile = path.join(localDir, 'patch-notes-original.json');
      fs.writeFileSync(origFile, JSON.stringify(originalPatches, null, 2));
      console.log(`Saved Official Server patches to: ${origFile}`);
    }

    if (!advancedPatches) {
      console.warn('Could not find advancedPatches in RSC payload.');
    } else if (choice === '1' || choice === '3') {
      const advFile = path.join(localDir, 'patch-notes-advanced.json');
      fs.writeFileSync(advFile, JSON.stringify(advancedPatches, null, 2));
      console.log(`Saved Advanced Server patches to: ${advFile}`);
    }

    // Upload to Firebase if selected
    if (choice === '2' || choice === '3') {
      await uploadToFirebase(originalPatches, advancedPatches, firebaseKeyPath);
    }

    console.log('\nProcess finished successfully!');

  } catch (error) {
    console.error('Error during scraping process:', error);
  } finally {
    rl.close();
  }
}

async function uploadToFirebase(originalPatches, advancedPatches, keyPath) {
  console.log('\nInitializing Firebase Admin SDK...');
  try {
    const admin = require('firebase-admin');
    const serviceAccount = require(keyPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    const db = admin.firestore();
    const batch = db.batch();
    let totalUploaded = 0;

    const prepareBatch = (patches, type) => {
      if (!patches || !Array.isArray(patches)) return;
      patches.forEach((patch) => {
        // Monolithic Document under 'patches' collection
        // Doc ID format: original_2.1.88, advanced_2.1.74
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

    if (totalUploaded > 0) {
      console.log(`Uploading ${totalUploaded} patch records to Firestore 'patches' collection...`);
      await batch.commit();
      console.log('Firebase upload completed successfully!');
    } else {
      console.log('No patches found to upload.');
    }

  } catch (error) {
    console.error('Firebase upload failed:', error);
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error('Please run "npm install" to ensure firebase-admin is installed.');
    }
  }
}

scrape();
