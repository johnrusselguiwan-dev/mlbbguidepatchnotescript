const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// Setup readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

async function fetchWithRetry(url, options = {}, retries = 3) {
  const mergedOptions = {
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options
  };
  delete mergedOptions.headers;
  mergedOptions.headers = { ...DEFAULT_HEADERS, ...(options.headers || {}) };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, mergedOptions);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// Evaluates <script>self.__next_f.push(...)</script> tags into an isolated array of chunks
function parseRscScriptChunks(html) {
  const chunks = [];
  const self = {
    __next_f: {
      push: (data) => {
        if (data && data[1]) {
          chunks.push(data[1]);
        }
      }
    }
  };
  const regex = /<script>self\.__next_f\.push\((.*?)\)<\/script>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      eval(`self.__next_f.push(${match[1]})`);
    } catch (e) {}
  }
  return chunks;
}

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

// Bracket matching parser to extract JSON objects
function extractJsonObject(chunk, keyName) {
  const startKey = `"${keyName}":`;
  const keyIndex = chunk.indexOf(startKey);
  if (keyIndex === -1) return null;

  const objStart = chunk.indexOf('{', keyIndex + startKey.length - 1);
  if (objStart === -1) return null;

  let open = 0;
  let i = objStart;
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
      if (chunk[i] === '{') open++;
      else if (chunk[i] === '}') {
        open--;
        if (open === 0) {
          break;
        }
      }
    }
  }

  const jsonStr = chunk.substring(objStart, i + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Failed to parse extracted JSON object for ${keyName}:`, e.message);
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

// Fetch single patch detail page and extract detailed "patch" object with image assets
async function fetchFullPatchDetails(server, version) {
  const url = `https://mlbbhub.com/patch-notes/${server}/${version}`;
  try {
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) return null;
    const html = await res.text();
    const chunks = parseRscScriptChunks(html);

    for (const chunk of chunks) {
      if (typeof chunk === 'string' && chunk.includes('heroPortraits')) {
        const idx = chunk.indexOf(':');
        try {
          const parsed = JSON.parse(chunk.substring(idx + 1));
          const props = parsed[0]?.[3];
          if (props && props.patch) {
            const patch = props.patch;
            const splashArts = props.heroSplashArts || {};
            const portraits = props.heroPortraits || {};

            let patchImage = null;
            if (patch.heroChanges && patch.heroChanges.length > 0) {
              const firstHero = patch.heroChanges[0].heroSlug;
              patchImage = splashArts[firstHero] || portraits[firstHero] || null;
            }

            if (patch.heroChanges) {
              patch.heroChanges = patch.heroChanges.map(h => ({
                ...h,
                image: splashArts[h.heroSlug] || portraits[h.heroSlug] || null,
                portrait: portraits[h.heroSlug] || null
              }));
            }

            return {
              ...patch,
              image: patchImage
            };
          }
        } catch (e) {}
      }
    }

    for (const chunk of chunks) {
      if (typeof chunk === 'string' && chunk.includes('"patch":')) {
        const patchObj = extractJsonObject(chunk, 'patch');
        if (patchObj) return patchObj;
      }
    }
  } catch (err) {
    console.error(`Failed to fetch details for ${server} patch ${version}:`, err.message);
  }
  return null;
}

// Process concurrent async mapping with worker pool limit
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Enrich an array of patch index items with their full details
async function enrichPatches(patches, serverName) {
  if (!patches || !Array.isArray(patches)) return [];
  console.log(`Fetching full details for ${patches.length} ${serverName} server patches...`);
  
  const enriched = await mapConcurrent(patches, 5, async (indexPatch) => {
    const detailPatch = await fetchFullPatchDetails(indexPatch.server || serverName, indexPatch.version);
    if (detailPatch) {
      return { ...indexPatch, ...detailPatch };
    }
    return indexPatch;
  });
  return enriched;
}

async function scrape() {
  console.log('\n--- MLBBHub Patch Notes Scraper ---\n');
  
  const hasFirebaseFlag = process.argv.includes('--firebase');
  const hasLocalFlag = process.argv.includes('--local');
  
  let choice = '1';
  if (hasFirebaseFlag && hasLocalFlag) {
    choice = '3';
  } else if (hasFirebaseFlag) {
    choice = '2';
  } else if (hasLocalFlag) {
    choice = '1';
  } else {
    // CLI Step 1: Choose Export Destination
    console.log('Choose export destination:');
    console.log('1) Save locally as JSON files');
    console.log('2) Publish to Firebase Firestore (Monolithic)');
    console.log('3) Both (Save locally and publish to Firebase)');
    
    choice = await askQuestion('Enter choice (1-3) [default: 1]: ');
    if (!choice) choice = '1';
  }
  
  if (!['1', '2', '3'].includes(choice)) {
    console.error('Invalid choice. Exiting.');
    rl.close();
    return;
  }

  let localDir = '.';
  // CLI Step 2: Choose local path if saving locally
  if (choice === '1' || choice === '3') {
    if (!hasFirebaseFlag && !hasLocalFlag) {
      const inputDir = await askQuestion('\nEnter local output directory path (press Enter for current directory): ');
      if (inputDir) {
        localDir = path.resolve(inputDir);
      }
    }
    if (!fs.existsSync(localDir)) {
      console.log(`Directory "${localDir}" does not exist. Creating it...`);
      fs.mkdirSync(localDir, { recursive: true });
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
      if (hasFirebaseFlag) {
        firebaseKeyPath = path.join(__dirname, keys[0]);
        console.log(`Using auto-selected Firebase service account key: "${keys[0]}"`);
      } else {
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
      }
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

  console.log('\nFetching patch notes index from MLBBHub...');
  try {
    const response = await fetchWithRetry('https://mlbbhub.com/patch-notes');
    if (!response || !response.ok) {
      throw new Error(`HTTP error! status: ${response ? response.status : 'No response'}`);
    }
    const html = await response.text();

    console.log('Extracting RSC payload scripts...');
    const chunks = parseRscScriptChunks(html);

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

    if (originalPatches) {
      originalPatches = await enrichPatches(originalPatches, 'original');
    } else {
      console.warn('Could not find originalPatches in RSC payload.');
    }

    if (advancedPatches) {
      advancedPatches = await enrichPatches(advancedPatches, 'advanced');
    } else {
      console.warn('Could not find advancedPatches in RSC payload.');
    }

    if (choice === '1' || choice === '3') {
      if (originalPatches) {
        const origFile = path.join(localDir, 'patch-notes-original.json');
        fs.writeFileSync(origFile, JSON.stringify(originalPatches, null, 2));
        console.log(`Saved Official Server patches to: ${origFile}`);
      }
      if (advancedPatches) {
        const advFile = path.join(localDir, 'patch-notes-advanced.json');
        fs.writeFileSync(advFile, JSON.stringify(advancedPatches, null, 2));
        console.log(`Saved Advanced Server patches to: ${advFile}`);
      }
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

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    const batch = db.batch();
    let totalUploaded = 0;

    // 1. Update JSON documents in data_staging, staging, and data collections
    if (originalPatches) {
      const origJson = JSON.stringify(originalPatches);
      batch.set(db.collection('data_staging').doc('patch_notes_original'), { json: origJson }, { merge: true });
      batch.set(db.collection('staging').doc('patch_notes_original'), { json: origJson }, { merge: true });
      batch.set(db.collection('data').doc('patch_notes_original'), { json: origJson }, { merge: true });
      totalUploaded += 3;
    }

    if (advancedPatches) {
      const advJson = JSON.stringify(advancedPatches);
      batch.set(db.collection('data_staging').doc('patch_notes_advanced'), { json: advJson }, { merge: true });
      batch.set(db.collection('staging').doc('patch_notes_advanced'), { json: advJson }, { merge: true });
      batch.set(db.collection('data').doc('patch_notes_advanced'), { json: advJson }, { merge: true });
      totalUploaded += 3;
    }

    // 2. Update metadata timestamp
    batch.set(
      db.collection('data_staging_meta').doc('patch_info'),
      { lastPatchNotesUpdate: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // 3. Update individual monolithic documents under 'patches' collection
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

    if (totalUploaded > 0) {
      console.log(`Uploading patch records to Firestore ('data_staging', 'staging', 'data', 'data_staging_meta', 'patches')...`);
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
