const BaseScraper = require('./baseScraper');
const { c } = require('../config/constants');
const { fetchWithRetry, mapConcurrent } = require('../utils/httpClient');
const { parseRscScriptChunks, extractJsonArray, extractJsonObject } = require('../utils/rscParser');

class MlbbHubScraper extends BaseScraper {
  async fetchFullPatchDetails(server, version) {
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
      console.error(`${c.red}[!] Failed to fetch details for ${server} patch ${version}:${c.reset}`, err.message);
    }
    return null;
  }

  async enrichPatches(patches, serverName) {
    if (!patches || !Array.isArray(patches)) return [];
    console.log(`${c.cyan}[+] Fetching full details for ${patches.length} ${serverName} server patches...${c.reset}`);
    
    const enriched = await mapConcurrent(patches, 5, async (indexPatch) => {
      const detailPatch = await this.fetchFullPatchDetails(indexPatch.server || serverName, indexPatch.version);
      if (detailPatch) {
        return { ...indexPatch, ...detailPatch };
      }
      return indexPatch;
    });
    return enriched;
  }

  async scrape() {
    console.log(`\n${c.bold}[+] Fetching patch notes index from MLBBHub...${c.reset}`);
    const response = await fetchWithRetry('https://mlbbhub.com/patch-notes');
    if (!response || !response.ok) {
      throw new Error(`HTTP error! status: ${response ? response.status : 'No response'}`);
    }
    const html = await response.text();

    console.log(`${c.cyan}[+] Extracting RSC payload scripts...${c.reset}`);
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

    // Fallback: Extract patch links directly from HTML and RSC payload if structured arrays weren't found
    if (!originalPatches || !advancedPatches) {
      const combinedContent = html + '\n' + chunks.join('\n');
      const linkRegex = /\/patch-notes\/(original|advanced)\/([a-zA-Z0-9._-]+)/g;
      let match;
      const origVersions = new Set();
      const advVersions = new Set();
      while ((match = linkRegex.exec(combinedContent)) !== null) {
        const [, server, version] = match;
        if (server === 'original') origVersions.add(version);
        if (server === 'advanced') advVersions.add(version);
      }

      if (!originalPatches && origVersions.size > 0) {
        originalPatches = Array.from(origVersions).map(version => ({ version, server: 'original' }));
      }
      if (!advancedPatches && advVersions.size > 0) {
        advancedPatches = Array.from(advVersions).map(version => ({ version, server: 'advanced' }));
      }
    }

    if (originalPatches) {
      originalPatches = await this.enrichPatches(originalPatches, 'original');
    } else {
      console.warn(`${c.yellow}[!] Could not find originalPatches in RSC payload.${c.reset}`);
    }

    if (advancedPatches) {
      advancedPatches = await this.enrichPatches(advancedPatches, 'advanced');
    } else {
      console.warn(`${c.yellow}[!] Could not find advancedPatches in RSC payload.${c.reset}`);
    }

    return { originalPatches: originalPatches || [], advancedPatches: advancedPatches || [] };
  }
}

module.exports = MlbbHubScraper;
