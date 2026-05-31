/**
 * services/hplc-parser.js — HPLC CSV parser.
 * Parses Waters Empower and Agilent OpenLAB CSV exports into standardized HPLC result objects.
 * Handles the two dominant pharma QC CSV formats.
 */

/**
 * Parse an HPLC CSV file buffer.
 * Returns { format, peaks, metadata }
 * Supports Waters Empower and Agilent OpenLAB formats.
 */
function parseHplcCsv(buffer) {
  const raw = buffer.toString('utf8').trim();
  const lines = raw.split(/\r?\n/);

  if (lines.length < 3) {
    throw new Error('CSV has fewer than 3 lines — not a valid HPLC export');
  }

  // Find the first row that looks like an actual peak table header
  // (many Agilent exports have metadata lines before the real header)
  let headerCandidate = null;
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    const looksLikeHeader =
      (l.includes('ret') && l.includes('time') && l.includes('area')) ||
      (l.includes('rettime') && l.includes('area')) ||
      (l.includes('retention time') && l.includes('area')) ||
      (l.includes('peak#') && l.includes('area'));

    if (looksLikeHeader) {
      headerCandidate = lines[i];
      headerIdx = i;
      break;
    }
  }

  if (!headerCandidate) {
    throw new Error(
      'Could not find a peak table header row containing RetTime + Area columns.\n' +
      'First line was: ' + lines[0].substring(0, 100)
    );
  }

  // Extract metadata from lines before the actual peak table (common in Agilent exports)
  const metadata = extractCsvMetadata(lines, headerIdx);

  const format = detectFormat(headerCandidate, lines[headerIdx + 1] || '');

  if (format === 'waters') {
    return parseWatersEmpower(lines);
  } else if (format === 'agilent') {
    return parseAgilentOpenLAB(lines);
  } else {
    throw new Error(
      'Unrecognized CSV format. Expected Waters Empower or Agilent OpenLAB export.\n' +
      'Header row found: ' + headerCandidate.substring(0, 120)
    );
  }
}

/**
 * Detect format from the first two rows.
 * Waters: "Retention Time" (full phrase) OR "Peak Name" + "Area" columns
 * Agilent: "Ret. Time" (abbreviated) — the period and shortened form are signature
 */
function detectFormat(header, secondRow) {
  const h = header.toLowerCase();

  // Waters Empower: "Retention Time" as a phrase OR peak-related columns together
  if (
    /\bretention time\b/i.test(h) ||
    (h.includes('peak') && h.includes('retention') && h.includes('area'))
  ) {
    return 'waters';
  }

  // Agilent OpenLAB / ChemStation: various "RetTime", "Ret. Time", "Ret Time" formats
  if (
    /ret.?time/i.test(h) ||                    // catches RetTime[min], Ret. Time, Ret Time, etc.
    (h.includes('peak#') && h.includes('area')) ||
    (h.includes('area') && /ret/i.test(h))     // fallback: any row with area + ret
  ) {
    return 'agilent';
  }

  // Date-based fallback (some Agilent exports start with a date row)
  if (/^[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}/.test(secondRow)) {
    return 'agilent';
  }

  return null;
}

/**
 * Parse Waters Empower export.
 * Header row contains "Retention Time" and "Area" columns. Data rows follow.
 */
function parseWatersEmpower(lines) {
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('retention') && l.includes('area')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error('Could not find retention time / area header row in Waters Empower CSV');
  }

  const headers = splitCsvLine(lines[headerIdx]).map(h => h.trim().toLowerCase());

  const colMap = {
    retentionTime: findCol(headers, ['retention time', 'ret time', 'retention']),
    peakName:     findCol(headers, ['peak name', 'component', 'name', 'compound']),
    peakArea:     findCol(headers, ['area', 'area (', 'peak area']),
    resolution:   findCol(headers, ['resolution', ' res']),
    tailingFactor:findCol(headers, ['tailing factor', 'tailing factor (tf)', 'tailing', 'asymmetric']),
    height:       findCol(headers, ['height']),
    amount:       findCol(headers, ['amount', 'concentration']),
  };

  if (colMap.retentionTime === -1 || colMap.peakArea === -1) {
    throw new Error(
      'Waters Empower CSV missing required columns. Found: ' + headers.join(', ') + '\n' +
      'Expected: Retention Time, Area'
    );
  }

  const peaks = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip Empower sample info / metadata rows (not data peaks)
    const stripped = line.replace(/^"+|"+$/g, '');
    if (/^inj[0-9]/i.test(stripped) || /^sample\tset/i.test(stripped) || /^channel\t/i.test(stripped)) continue;

    const cols = splitCsvLine(line);
    const rt = parseFloat(cols[colMap.retentionTime]);
    const area = parseFloat(cols[colMap.peakArea]);

    if (isNaN(rt) || isNaN(area)) continue;

    peaks.push({
      retentionTime: rt,
      peakArea: area,
      name: colMap.peakName !== -1 ? cols[colMap.peakName] : null,
      resolution: colMap.resolution !== -1 ? parseFloat(cols[colMap.resolution]) || null : null,
      tailingFactor: colMap.tailingFactor !== -1 ? parseFloat(cols[colMap.tailingFactor]) || null : null,
      height: colMap.height !== -1 ? parseFloat(cols[colMap.height]) || null : null,
      amount: colMap.amount !== -1 ? parseFloat(cols[colMap.amount]) || null : null,
    });
  }

  return { format: 'waters_empower', peaks, metadata };
}

/**
 * Parse Agilent OpenLAB export.
 * Header row contains "Ret. Time" and "Area" columns.
 */
function parseAgilentOpenLAB(lines) {
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    // Support many real Agilent export variants: RetTime, Ret. Time, Ret Time, RetTime[min], etc.
    const hasRetTime = l.includes('ret. time') || l.includes('ret time') || l.includes('rettime');
    const hasArea = l.includes('area');
    if (hasRetTime && hasArea) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error('Could not find Agilent peak table header (looking for RetTime + Area columns)');
  }

  const headers = splitCsvLine(lines[headerIdx]).map(h => h.trim().toLowerCase());

  const colMap = {
    retentionTime: findCol(headers, ['ret. time', 'ret time', 'rettime', 'ret time [min]', 'ret. time [min]']),
    peakArea:     findCol(headers, ['area', 'area (counts)', 'area (p*a*s)', 'area [mau']),
    peakName:     findCol(headers, ['samplename', 'name', 'compound', 'component']),
    resolution:   findCol(headers, ['resolution', 'res', 'rs']),
    tailingFactor:findCol(headers, ['tailing factor', 'tailing', 'tf']),
    height:       findCol(headers, ['height', 'height (counts)']),
    amount:       findCol(headers, ['amount']),
  };

  if (colMap.retentionTime === -1 || colMap.peakArea === -1) {
    throw new Error(
      'Agilent CSV missing required columns. Found: ' + headers.join(', ') + '\n' +
      'Expected columns containing: RetTime / Ret. Time + Area'
    );
  }

  const peaks = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = splitCsvLine(line);
    const rt = parseFloat(cols[colMap.retentionTime]);
    const area = parseFloat(cols[colMap.peakArea]);

    if (isNaN(rt) || isNaN(area)) continue;

    peaks.push({
      retentionTime: rt,
      peakArea: area,
      name: colMap.peakName !== -1 ? cols[colMap.peakName] : null,
      resolution: colMap.resolution !== -1 ? parseFloat(cols[colMap.resolution]) || null : null,
      tailingFactor: colMap.tailingFactor !== -1 ? parseFloat(cols[colMap.tailingFactor]) || null : null,
      height: colMap.height !== -1 ? parseFloat(cols[colMap.height]) || null : null,
      amount: colMap.amount !== -1 ? parseFloat(cols[colMap.amount]) || null : null,
    });
  }

  return { format: 'agilent_openlab', peaks, metadata };
}

/**
 * Split a CSV line handling quoted fields with commas inside.
 */
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Find the column index for a given name pattern (partial match, case-insensitive).
 * Returns -1 if not found.
 */
function findCol(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => h.includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Extract key-value metadata from lines before the peak table header.
 * Handles common Agilent "Key","Value" format.
 */
function extractCsvMetadata(lines, headerIdx) {
  const metadata = {};

  for (let i = 0; i < headerIdx; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Match "Key","Value" or "Key",Value patterns (quoted or not)
    const match = line.match(/^"([^"]+)"\s*,\s*"([^"]*)"/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (value) {
        // Normalize common keys
        if (key.includes('instrument')) metadata.instrument = value;
        if (key.includes('sample')) metadata.sampleName = value;
        if (key.includes('acq') || key.includes('method')) metadata.method = value;
        if (key.includes('analyst')) metadata.analyst = value;
        if (key.includes('data file')) metadata.dataFile = value;
      }
    }
  }

  return metadata;
}

module.exports = { parseHplcCsv };