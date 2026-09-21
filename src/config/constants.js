// ANSI Color tokens for CLI formatting
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const REDLIB_FALLBACK_INSTANCES = [
  'https://safereddit.com',
  'https://redlib.privacyredirect.com',
  'https://redlib.perennialte.ch',
  'https://l.josh.run'
];

module.exports = {
  c,
  DEFAULT_HEADERS,
  REDLIB_FALLBACK_INSTANCES
};
