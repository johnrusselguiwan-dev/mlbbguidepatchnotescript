const BaseScraper = require('./baseScraper');
const { c, REDLIB_FALLBACK_INSTANCES } = require('../config/constants');
const { fetchWithRetry, fetchBare, mapConcurrent } = require('../utils/httpClient');
const { parseRscScriptChunks } = require('../utils/rscParser');

class RedditScraper extends BaseScraper {
  async findWorkingRedlibInstance() {
    for (const baseUrl of REDLIB_FALLBACK_INSTANCES) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${baseUrl}/r/MobileLegendsGame/search?q=flair%3A%22Patch+Notes%22&restrict_sr=on&sort=new`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (res && res.ok) {
          const text = await res.text();
          if (text.includes('comments') || text.includes('Patch Notes') || text.includes('post_title')) {
            return baseUrl;
          }
        }
      } catch (e) {}
    }

    try {
      const listRes = await fetchBare('https://raw.githubusercontent.com/redlib-org/redlib-instances/main/instances.json', {}, 1);
      if (listRes && listRes.ok) {
        const data = await listRes.json();
        if (data && Array.isArray(data.instances)) {
          for (const inst of data.instances.slice(0, 10)) {
            if (!inst.url) continue;
            const baseUrl = inst.url.replace(/\/$/, '');
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 2500);
              const res = await fetch(`${baseUrl}/r/MobileLegendsGame/search?q=flair%3A%22Patch+Notes%22&restrict_sr=on&sort=new`, {
                signal: controller.signal
              });
              clearTimeout(timeout);
              if (res && res.ok) {
                const text = await res.text();
                if (text.includes('comments') || text.includes('Patch Notes') || text.includes('post_title')) {
                  return baseUrl;
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    return 'https://safereddit.com';
  }

  parseHeroDetailsFromText(rawContent, heroChangeType) {
    const details = [];
    const skillBlockRegex = /\[([^\]]+)\](?:\s*\(([^)]+)\))?([\s\S]*?)(?=\[[^\]]+\]|$)/gi;
    let match;
    while ((match = skillBlockRegex.exec(rawContent)) !== null) {
      const skillName = match[1].trim();
      const skillSymbol = match[2] ? match[2].trim() : '';
      const body = match[3].trim();

      let skillChangeType = heroChangeType;
      if (skillSymbol.includes('↑')) skillChangeType = 'buff';
      else if (skillSymbol.includes('↓')) skillChangeType = 'nerf';

      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach(line => {
        const cleanLine = line.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
        const arrowMatch = cleanLine.match(/([^:]+):\s*(.*?)\s*(?:>>|->)\s*(.*)/);
        if (arrowMatch) {
          details.push({
            skill: skillName,
            attribute: arrowMatch[1].trim(),
            from: arrowMatch[2].trim(),
            to: arrowMatch[3].trim(),
            changeType: skillChangeType
          });
        } else if (cleanLine.length > 0 && !cleanLine.startsWith('[')) {
          details.push({
            skill: skillName,
            attribute: 'Note',
            note: cleanLine,
            changeType: skillChangeType
          });
        }
      });
    }
    return details;
  }

  parseRedditPostHtml(html, postTitle = '') {
    const titleMatch = html.match(/<h1 class=\"post_title\">([\s\S]*?)<\/h1>/);
    const rawTitle = postTitle || (titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '');

    const versionMatch = rawTitle.match(/Patch\s+Notes\s+([0-9\.]+a?)/i) || html.match(/Patch\s+Notes\s+([0-9\.]+a?)/i);
    const version = versionMatch ? versionMatch[1] : 'Unknown';

    const isAdvanced = /adv/i.test(rawTitle) || /advanced\s+server/i.test(html);
    const server = isAdvanced ? 'advanced' : 'original';

    const dateMatch = html.match(/(?:released|live|updated)\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const date = dateMatch ? dateMatch[1] : '';

    const bodyMatch = html.match(/<div class=\"post_body\">([\s\S]*?)<\/div>/);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;

    let summary = '';
    const summaryMatch = bodyHtml.match(/<h1>From the Designers<\/h1>([\s\S]*?)(?=<hr|<h1|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const ignoreWords = ['ultimate', 'skill', 'passive', 'attribute', 'attributes', 'team-up', 'battlefield', 'cards', 'equipment', 'spells', 'feature', 'system', 'revamped hero', 'new hero', 'match-related'];

    const heroChanges = [];
    const heroBlockRegex = /<p>[^<]*<strong>\[?\s*([^\]<]+?)\s*\]?(?:\s*\((?:<code>)?\s*([↑↓~]+|\bBuff\b|\bNerf\b|\bAdjust\b)?\s*(?:<\/code>)?\))?<\/strong><\/p>([\s\S]*?)(?=<p>[^<]*<strong>|<h1|<hr|$)/gi;
    let hMatch;
    while ((hMatch = heroBlockRegex.exec(bodyHtml)) !== null) {
      const rawHeroName = hMatch[1].replace(/^[^A-Za-z0-9]+/, '').trim();
      const symbol = hMatch[2] ? hMatch[2].trim() : '';
      const content = hMatch[3].replace(/<[^>]+>/g, '\n').trim();

      const heroSlug = rawHeroName.split('-')[0].split(':')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (ignoreWords.some(w => heroSlug.includes(w) || rawHeroName.toLowerCase().includes(w))) continue;

      let changeType = 'adjust';
      if (symbol.includes('↑') || /buff/i.test(symbol)) changeType = 'buff';
      else if (symbol.includes('↓') || /nerf/i.test(symbol)) changeType = 'nerf';
      else if (/new/i.test(rawTitle) || rawHeroName.toLowerCase().includes('new hero')) changeType = 'new';
      else if (symbol.includes('~') || /adjust/i.test(symbol)) changeType = 'adjust';

      const parsedDetails = this.parseHeroDetailsFromText(content, changeType);

      heroChanges.push({
        heroName: rawHeroName,
        heroSlug: heroSlug,
        changeType: changeType,
        summary: content.substring(0, 250),
        details: parsedDetails
      });
    }

    return {
      version,
      date,
      server,
      summary,
      heroChanges,
      equipmentChanges: [],
      systemChanges: []
    };
  }

  calculateCounts(heroChanges = [], equipmentChanges = []) {
    const counts = { buff: 0, nerf: 0, rework: 0, new: 0, adjust: 0 };
    heroChanges.forEach(h => {
      if (counts[h.changeType] !== undefined) counts[h.changeType]++;
      else counts.adjust++;
    });
    equipmentChanges.forEach(e => {
      if (counts[e.changeType] !== undefined) counts[e.changeType]++;
      else counts.adjust++;
    });
    return counts;
  }

  async fetchHeroAssets() {
    try {
      const res = await fetchWithRetry('https://mlbbhub.com/patch-notes/original/2.1.88');
      if (res && res.ok) {
        const html = await res.text();
        const chunks = parseRscScriptChunks(html);
        for (const chunk of chunks) {
          if (typeof chunk === 'string' && chunk.includes('heroPortraits')) {
            const idx = chunk.indexOf(':');
            try {
              const parsed = JSON.parse(chunk.substring(idx + 1));
              const props = parsed[0]?.[3];
              if (props) {
                return {
                  heroSplashArts: props.heroSplashArts || {},
                  heroPortraits: props.heroPortraits || {}
                };
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    return { heroSplashArts: {}, heroPortraits: {} };
  }

  async scrape() {
    console.log(`\n${c.bold}[+] Connecting to Reddit (via keyless public web instance)...${c.reset}`);
    
    const [baseUrl, assets] = await Promise.all([
      this.findWorkingRedlibInstance(),
      this.fetchHeroAssets()
    ]);

    console.log(`${c.cyan}[+] Using active web node: ${baseUrl}${c.reset}`);

    const searchUrl = `${baseUrl}/r/MobileLegendsGame/search?q=flair%3A%22Patch+Notes%22&restrict_sr=on&sort=new`;
    const res = await fetchBare(searchUrl);
    if (!res || !res.ok) {
      throw new Error(`Failed to fetch Reddit search results from ${baseUrl}`);
    }

    const html = await res.text();
    const matches = html.match(/href=\"(\/r\/MobileLegendsGame\/comments\/[^\"]+)\"/g);
    if (!matches) {
      console.warn(`${c.yellow}[!] No Reddit patch posts found in search.${c.reset}`);
      return { originalPatches: [], advancedPatches: [] };
    }

    const rawUrls = matches.map(m => m.replace(/^href=\"/, '').replace(/\"$/, ''));
    const patchUrls = rawUrls.filter(u => /patch/i.test(u));
    const postUrls = [...new Set(patchUrls)].slice(0, 15);
    
    console.log(`${c.cyan}[+] Found ${postUrls.length} recent Reddit patch discussions. Fetching details...${c.reset}`);

    const results = await mapConcurrent(postUrls, 5, async (relPath) => {
      const postUrl = `${baseUrl}${relPath}`;
      try {
        const postRes = await fetchBare(postUrl);
        if (postRes && postRes.ok) {
          const postHtml = await postRes.text();
          const patchData = this.parseRedditPostHtml(postHtml);
          if (patchData && patchData.version !== 'Unknown') {
            const firstHeroSlug = patchData.heroChanges[0]?.heroSlug;
            const topImage = firstHeroSlug ? (assets.heroSplashArts[firstHeroSlug] || assets.heroPortraits[firstHeroSlug] || null) : null;

            return {
              version: patchData.version,
              date: patchData.date,
              image: topImage,
              server: patchData.server,
              summary: patchData.summary,
              source: postUrl,
              counts: this.calculateCounts(patchData.heroChanges, patchData.equipmentChanges),
              heroChanges: patchData.heroChanges.map(h => ({
                ...h,
                image: assets.heroSplashArts[h.heroSlug] || assets.heroPortraits[h.heroSlug] || null,
                portrait: assets.heroPortraits[h.heroSlug] || null
              })),
              equipmentChanges: patchData.equipmentChanges || [],
              systemChanges: patchData.systemChanges || []
            };
          }
        }
      } catch (e) {
        console.error(`${c.red}[!] Failed to fetch Reddit post ${relPath}:${c.reset}`, e.message);
      }
      return null;
    });

    const originalPatches = [];
    const advancedPatches = [];

    results.filter(Boolean).forEach((patchData) => {
      if (patchData.server === 'advanced') {
        advancedPatches.push(patchData);
      } else {
        originalPatches.push(patchData);
      }
    });

    console.log(`${c.green}[✔] Successfully scraped ${originalPatches.length} Official & ${advancedPatches.length} Advanced patches from Reddit!${c.reset}`);
    return { originalPatches, advancedPatches };
  }
}

module.exports = RedditScraper;
