const readline = require('readline');
const { c } = require('./constants');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

function closeReadline() {
  rl.close();
}

function showHelp() {
  console.log(`
${c.bold}${c.cyan}=====================================================${c.reset}
${c.bold}${c.yellow}      MLBB PATCH NOTES SCRAPER & SYNC CLI${c.reset}
${c.bold}${c.cyan}=====================================================${c.reset}

${c.bold}USAGE:${c.reset}
  node scraper.js [OPTIONS]

${c.bold}OPTIONS:${c.reset}
  ${c.cyan}-s, --source <name>${c.reset}       Data source to scrape:
                              ${c.bold}mlbbhub${c.reset} or ${c.bold}1${c.reset} (MLBBHub Website)
                              ${c.bold}reddit${c.reset}  or ${c.bold}2${c.reset} (Reddit r/MobileLegendsGame)
                              ${c.bold}cache${c.reset}   or ${c.bold}3${c.reset} (Local Backup JSON Files)

  ${c.cyan}-d, --destination <type>${c.reset}  Export target destination:
                              ${c.bold}local${c.reset}    or ${c.bold}1${c.reset} (Save local JSON files)
                              ${c.bold}firebase${c.reset} or ${c.bold}2${c.reset} (Upload to Firestore)
                              ${c.bold}both${c.reset}     or ${c.bold}3${c.reset} (Local JSON + Firestore)

  ${c.cyan}-c, --collection <name>${c.reset}   Target Firestore collection:
                              ${c.bold}all${c.reset} (Default: data_staging, staging, data, patches)
                              ${c.bold}patches${c.reset} (Individual doc per patch)
                              ${c.bold}data_staging${c.reset}, ${c.bold}staging${c.reset}, ${c.bold}data${c.reset}, or custom name

  ${c.cyan}-o, --output-dir <path>${c.reset}   Directory path for local JSON output ${c.gray}[default: .]${c.reset}
  ${c.cyan}-k, --key <path>${c.reset}          Path to Firebase Service Account JSON key

  ${c.cyan}--local${c.reset}                   Shortcut for ${c.bold}--destination=local${c.reset}
  ${c.cyan}--firebase${c.reset}                Shortcut for ${c.bold}--destination=firebase${c.reset}
  ${c.cyan}-h, --help${c.reset}                Show this help menu and exit

${c.bold}EXAMPLES:${c.reset}
  ${c.gray}# Interactive guided mode:${c.reset}
  node scraper.js

  ${c.gray}# Scrape MLBBHub website and upload to 'patches' collection only:${c.reset}
  node scraper.js -s mlbbhub -d firebase -c patches

  ${c.gray}# Upload local JSON cache instantly to Firestore:${c.reset}
  node scraper.js -s cache -d firebase -c patches
`);
}

function parseArgs(args) {
  const options = {
    source: null,
    destination: null,
    collection: null,
    outputDir: '.',
    keyPath: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--source=')) {
      options.source = arg.split('=')[1].toLowerCase();
    } else if (arg === '-s' || arg === '--source') {
      options.source = (args[++i] || '').toLowerCase();
    } else if (arg.startsWith('--destination=')) {
      options.destination = arg.split('=')[1].toLowerCase();
    } else if (arg === '-d' || arg === '--destination') {
      options.destination = (args[++i] || '').toLowerCase();
    } else if (arg.startsWith('--collection=')) {
      options.collection = arg.split('=')[1];
    } else if (arg === '-c' || arg === '--collection') {
      options.collection = args[++i] || null;
    } else if (arg === '--local') {
      options.destination = 'local';
    } else if (arg === '--firebase') {
      options.destination = 'firebase';
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.split('=')[1];
    } else if (arg === '-o' || arg === '--output-dir') {
      options.outputDir = args[++i] || '.';
    } else if (arg.startsWith('--key=')) {
      options.keyPath = arg.split('=')[1];
    } else if (arg === '-k' || arg === '--key') {
      options.keyPath = args[++i] || null;
    }
  }

  return options;
}

async function promptCollectionSelection() {
  console.log(`\n${c.bold}Select Target Firestore Collection:${c.reset}`);
  console.log(`  ${c.cyan}1)${c.reset} ${c.bold}All Default Collections${c.reset} ${c.gray}(data_staging, staging, data, patches)${c.reset}`);
  console.log(`  ${c.cyan}2)${c.reset} ${c.bold}Individual Patch Documents ('patches')${c.reset}`);
  console.log(`  ${c.cyan}3)${c.reset} ${c.bold}Staging Bundle ('data_staging')${c.reset}`);
  console.log(`  ${c.cyan}4)${c.reset} ${c.bold}Staging Bundle ('staging')${c.reset}`);
  console.log(`  ${c.cyan}5)${c.reset} ${c.bold}Production Bundle ('data')${c.reset}`);
  console.log(`  ${c.cyan}6)${c.reset} ${c.bold}Custom Collection Name${c.reset}`);
  let cAns = await askQuestion(`\n${c.bold}Enter choice (1-6) [default: 1]:${c.reset} `);
  if (cAns === '2') return 'patches';
  if (cAns === '3') return 'data_staging';
  if (cAns === '4') return 'staging';
  if (cAns === '5') return 'data';
  if (cAns === '6') {
    let customCol = await askQuestion(`${c.bold}Enter custom collection name:${c.reset} `);
    return customCol.trim() || 'all';
  }
  return 'all';
}

function printSummary(sourceName, destName, origCount, advCount, files, collectionsSynced, elapsedSec) {
  console.log(`
${c.bold}${c.green}=====================================================${c.reset}
${c.bold}${c.yellow}                 EXECUTION SUMMARY${c.reset}
${c.bold}${c.green}=====================================================${c.reset}
  ${c.bold}Data Source${c.reset}       : ${c.cyan}${sourceName}${c.reset}
  ${c.bold}Export Target${c.reset}     : ${c.cyan}${destName}${c.reset}
  ${c.bold}Official Patches${c.reset}  : ${c.green}${origCount}${c.reset}
  ${c.bold}Advanced Patches${c.reset}  : ${c.green}${advCount}${c.reset}
  ${c.bold}Local Files Saved${c.reset} : ${files.length > 0 ? files.join(', ') : 'None'}
  ${c.bold}Firestore Synced${c.reset}  : ${collectionsSynced ? collectionsSynced : 'None'}
  ${c.bold}Time Elapsed${c.reset}      : ${elapsedSec}s
${c.bold}${c.green}=====================================================${c.reset}
`);
}

module.exports = {
  askQuestion,
  closeReadline,
  showHelp,
  parseArgs,
  promptCollectionSelection,
  printSummary
};
