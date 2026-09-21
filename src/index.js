const path = require('path');
const { c } = require('./config/constants');
const {
  askQuestion,
  closeReadline,
  showHelp,
  parseArgs,
  promptCollectionSelection,
  printSummary
} = require('./config/cli');
const ScraperFactory = require('./scrapers/scraperFactory');
const ExporterManager = require('./exporters/exporterManager');

async function main() {
  const startTime = Date.now();
  const cliArgs = parseArgs(process.argv.slice(2));

  if (cliArgs.help) {
    showHelp();
    closeReadline();
    return;
  }

  console.log(`
${c.bold}${c.cyan}=====================================================${c.reset}
${c.bold}${c.yellow}      MLBB PATCH NOTES SCRAPER & SYNC CLI${c.reset}
${c.bold}${c.cyan}=====================================================${c.reset}`);

  // Step 1: Data Source Selection
  let sourceChoice = cliArgs.source;
  if (sourceChoice === 'mlbbhub' || sourceChoice === '1') {
    sourceChoice = '1';
  } else if (sourceChoice === 'reddit' || sourceChoice === '2') {
    sourceChoice = '2';
  } else if (sourceChoice === 'cache' || sourceChoice === '3' || sourceChoice === 'local') {
    sourceChoice = '3';
  } else {
    console.log(`\n${c.bold}Select Data Source:${c.reset}`);
    console.log(`  ${c.cyan}1)${c.reset} ${c.bold}MLBBHub Website${c.reset} ${c.gray}(Official & Advanced Server)${c.reset}`);
    console.log(`  ${c.cyan}2)${c.reset} ${c.bold}Reddit r/MobileLegendsGame${c.reset} ${c.gray}(Early Leaks & News)${c.reset}`);
    console.log(`  ${c.cyan}3)${c.reset} ${c.bold}Use Local Backup JSON Files${c.reset} ${c.gray}(Instant / Skip Web Fetch)${c.reset}`);
    let ans = await askQuestion(`\n${c.bold}Enter choice (1-3) [default: 1]:${c.reset} `);
    if (ans === '2' || ans.toLowerCase() === 'reddit') sourceChoice = '2';
    else if (ans === '3' || ans.toLowerCase() === 'cache' || ans.toLowerCase() === 'local') sourceChoice = '3';
    else sourceChoice = '1';
  }

  const sourceNameMap = {
    '1': 'MLBBHub Website',
    '2': 'Reddit (r/MobileLegendsGame)',
    '3': 'Local Backup JSON Files'
  };
  const sourceName = sourceNameMap[sourceChoice];

  // Step 2: Export Destination Selection
  let destChoice = cliArgs.destination;
  if (['local', '1'].includes(destChoice)) {
    destChoice = '1';
  } else if (['firebase', '2'].includes(destChoice)) {
    destChoice = '2';
  } else if (['both', '3'].includes(destChoice)) {
    destChoice = '3';
  } else {
    console.log(`\n${c.bold}Select Export Destination:${c.reset}`);
    console.log(`  ${c.cyan}1)${c.reset} Save locally as JSON files`);
    console.log(`  ${c.cyan}2)${c.reset} Upload to Firebase Firestore`);
    console.log(`  ${c.cyan}3)${c.reset} Both (Save locally and publish to Firebase)`);
    let ans = await askQuestion(`\n${c.bold}Enter choice (1-3) [default: 1]:${c.reset} `);
    if (ans === '2' || ans.toLowerCase() === 'firebase') destChoice = '2';
    else if (ans === '3' || ans.toLowerCase() === 'both') destChoice = '3';
    else destChoice = '1';
  }

  const destNameMap = { '1': 'Local JSON', '2': 'Firebase Firestore', '3': 'Both (Local JSON + Firebase)' };
  const destName = destNameMap[destChoice];

  let localDir = cliArgs.outputDir || '.';
  if ((destChoice === '1' || destChoice === '3') && !cliArgs.destination) {
    const inputDir = await askQuestion(`\n${c.bold}Enter local output directory path [press Enter for current directory]:${c.reset} `);
    if (inputDir) {
      localDir = path.resolve(inputDir);
    }
  }

  // Step 3: Firebase Collection Selection & Key Resolution
  const isFirebase = destChoice === '2' || destChoice === '3';
  let targetCollection = cliArgs.collection;
  let firebaseKeyPath = null;

  if (isFirebase) {
    if (!cliArgs.collection) {
      targetCollection = await promptCollectionSelection();
    }
    firebaseKeyPath = await ExporterManager.resolveFirebaseKeyPath(cliArgs.keyPath, cliArgs.destination);
  }

  try {
    // Instantiate scraper strategy via Factory Pattern
    const scraper = ScraperFactory.getScraper(sourceChoice, { outputDir: localDir });
    const patchData = await scraper.scrape();

    const { originalPatches, advancedPatches } = patchData;

    // Handle export destinations
    const exportResult = await ExporterManager.handleExport(patchData, {
      destChoice,
      localDir,
      isFirebase,
      firebaseKeyPath,
      targetCollection,
      isInteractive: !cliArgs.destination
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    printSummary(
      sourceName,
      destName,
      originalPatches.length,
      advancedPatches.length,
      exportResult.savedFiles,
      exportResult.firebaseSyncedCols,
      elapsedSec
    );

  } catch (error) {
    console.error(`\n${c.red}[x] Error during scraping process:${c.reset}`, error.message || error);
  } finally {
    closeReadline();
  }
}

module.exports = { main };
