const MlbbHubScraper = require('./mlbbHubScraper');
const RedditScraper = require('./redditScraper');
const LocalCacheScraper = require('./localCacheScraper');

class ScraperFactory {
  static getScraper(sourceChoice, options = {}) {
    const choice = String(sourceChoice || '1').toLowerCase();
    
    if (choice === '2' || choice === 'reddit') {
      return new RedditScraper();
    } else if (choice === '3' || choice === 'cache' || choice === 'local') {
      return new LocalCacheScraper(options.outputDir || '.');
    } else {
      return new MlbbHubScraper();
    }
  }
}

module.exports = ScraperFactory;
