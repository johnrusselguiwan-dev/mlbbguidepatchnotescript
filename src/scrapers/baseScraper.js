class BaseScraper {
  /**
   * Scrapes patch notes from source
   * @returns {Promise<{ originalPatches: Array, advancedPatches: Array }>}
   */
  async scrape() {
    throw new Error('BaseScraper.scrape() must be implemented by subclass.');
  }
}

module.exports = BaseScraper;
