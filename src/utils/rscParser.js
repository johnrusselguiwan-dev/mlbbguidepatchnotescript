const { c } = require('../config/constants');

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
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1].trim();
    if (scriptContent.includes('__next_f')) {
      try {
        const fn = new Function('self', scriptContent);
        fn(self);
      } catch (e) {}
    }
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
    console.error(`${c.red}[!] Failed to parse extracted JSON array for ${keyName}:${c.reset}`, e.message);
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
    console.error(`${c.red}[!] Failed to parse extracted JSON object for ${keyName}:${c.reset}`, e.message);
    return null;
  }
}

module.exports = {
  parseRscScriptChunks,
  extractJsonArray,
  extractJsonObject
};
