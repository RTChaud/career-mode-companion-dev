/**
 * import.js
 * Screenshot import: extracts a player's Name/Age/Overall/Position/
 * Market Value/PlayStyles from FC26 Squad Hub screenshots, entirely
 * on-device (Tesseract.js OCR + fixed-region crops + fuzzy-matching
 * against Players' own lists). Owns the screenshot import sheet's UI
 * end to end; the only thing it hands back to app.js is the validated
 * result, via the callback passed to init().
 *
 * Depends on: players.js (Players.POSITIONS/PLAYSTYLES for validation)
 * and ui.js (UI.el.screenshot*, UI.openSheet/closeSheet/showToast).
 */
const ScreenshotImport = (() => {

  // ---------- Screenshot import ----------
  //
  // Extracts a player's details from an Attributes screenshot and/or a
  // Financial screenshot of the FC26 Squad Hub, entirely on-device:
  //   1. Crop fixed pixel regions of interest (name, age, overall,
  //      position, market value, up to 8 PlayStyle-label slots) — never
  //      the whole screenshot.
  //   2. Run OCR (Tesseract.js, loaded from a CDN) on only those small
  //      crops.
  //   3. Validate every field independently against this app's own
  //      Players.POSITIONS / Players.PLAYSTYLES lists using a small
  //      fuzzy-match (tolerating the odd OCR letter mix-up) with no
  //      match at all if it isn't confident.
  // A field that can't be read confidently is simply left blank — the
  // whole import only fails if NOTHING usable came out of either
  // screenshot. Nothing here ever touches Storage, Players, or a backup:
  // the screenshots and every canvas/OCR intermediate exist only as
  // local variables for the few seconds of processing, then are
  // discarded (object URLs revoked, canvases cleared, file inputs reset).
  //
  // Coordinates below assume the standard FC26 Squad Hub capture at
  // 1280×720 — the layout FC26 always renders this screen at.

  const TESSERACT_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js';
  let tesseractLoadPromise = null;

  /** Lazily loads Tesseract.js from cdnjs the first time it's needed. */
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_CDN_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the OCR library.'));
      document.head.appendChild(script);
    });
    return tesseractLoadPromise;
  }

  // Crop regions as fractions of the image's width/height (measured
  // against the standard FC26 Squad Hub capture at 1280×720), so they
  // scale correctly even if a screenshot isn't captured at exactly that
  // resolution. All of these sit inside the right-hand player-details
  // panel, which is laid out identically on the First Team "Attributes"
  // screen and the Academy "Youth Squad" screen — never the scrollable
  // squad list on the left.
  const SCREENSHOT_REGIONS = {
    overall: [654 / 1280, 156 / 720, 49 / 1280, 20 / 720],
    // Tight box immediately right of the Overall number: just tall/wide
    // enough for up to three position codes (e.g. "RW · LW · LM") and
    // no further — it must never be wide enough to reach anything else.
    position: [712 / 1280, 155 / 720, 138 / 1280, 23 / 720],
    firstName: [655 / 1280, 184 / 720, 245 / 1280, 17 / 720],
    lastName: [683 / 1280, 202 / 720, 217 / 1280, 25 / 720],
    marketValueBand: [655 / 1280, 325 / 720, 355 / 1280, 155 / 720],
  };
  // Age normally sits in the profile header's first column. The Academy
  // "Youth Squad" development screen inserts a Potential column before
  // it, shifting Age to a second position — so both are tried in turn,
  // and whichever one lands a plausible age (15–45) wins.
  const AGE_REGION_CANDIDATES = [
    [655 / 1280, 253 / 720, 30 / 1280, 15 / 720],  // standard First Team header layout
    [738 / 1280, 253 / 720, 26 / 1280, 15 / 720],  // Academy header layout (Potential column first)
  ];
  // 8 PlayStyle slots: 2 rows x 4 columns. Each box is tall enough to
  // catch a label that wraps to two lines (e.g. "Low Driven Shot").
  const PLAYSTYLE_LABEL_BOXES = [
    [657 / 1280, 378 / 720, 80 / 1280, 30 / 720], [742 / 1280, 378 / 720, 80 / 1280, 30 / 720],
    [827 / 1280, 378 / 720, 80 / 1280, 30 / 720], [912 / 1280, 378 / 720, 80 / 1280, 30 / 720],
    [657 / 1280, 486 / 720, 80 / 1280, 20 / 720], [742 / 1280, 486 / 720, 80 / 1280, 20 / 720],
    [827 / 1280, 486 / 720, 80 / 1280, 20 / 720], [912 / 1280, 486 / 720, 80 / 1280, 20 / 720],
  ];

  const CONFUSABLE_PAIRS = { VW: 0.3, GI: 0.5, AG: 0.5, O0: 0.1, I1: 0.1, S5: 0.3 };
  function subCost(a, b) {
    if (a === b) return 0;
    const key = [a, b].sort().join('');
    return CONFUSABLE_PAIRS[key] !== undefined ? CONFUSABLE_PAIRS[key] : 1;
  }
  /** Edit distance with a small table of commonly-confused OCR letter pairs costing less than a full substitution. */
  function weightedEditDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + subCost(a[i - 1], b[j - 1])
        );
      }
    }
    return dp[m][n];
  }
  function plainEditDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[m][n];
  }

  /** Matches OCR'd position text against Players.POSITIONS, tolerating one likely OCR letter mix-up. */
  function fuzzyMatchPosition(token) {
    let cleaned = (token || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    cleaned = cleaned.replace(/VV/g, 'W'); // "W" is very commonly OCR'd as two V's
    if (!cleaned) return null;
    const distances = Players.POSITIONS.map(p => [p, weightedEditDistance(cleaned, p)]);
    const minDist = Math.min(...distances.map(([, d]) => d));
    // Must be an exact match, or bridged only by known OCR-confusable
    // substitutions (which cost < 1) — a plain single-letter difference
    // (cost exactly 1) is NOT enough on its own. Position codes are
    // mostly 2 letters, so almost any short garbled string is only one
    // generic substitution away from *some* code purely by chance; that
    // shouldn't count as a confident read.
    if (minDist >= 1) return null;
    // Position codes are mostly 2 letters, so garbled OCR text can easily
    // land equally close to more than one of them. Picking whichever
    // happened to come first in Players.POSITIONS in that case would be
    // guessing — an ambiguous tie means no confident match at all.
    const winners = distances.filter(([, d]) => d === minDist);
    return winners.length === 1 ? winners[0][0] : null;
  }

  /**
   * OCR doesn't always render the "·" between position codes as
   * recognizable whitespace, so "RW · LW" can come back as "RW LW",
   * "RWLW", or similar. Try the first whitespace-separated token first;
   * if that's not confident, fall back to the first 2 and 3 letters of
   * the whole (space-stripped) text, since every position code is 2–3
   * letters and the first one is always what we want.
   */
  function extractPositionFromText(rawText) {
    let cleaned = (rawText || '').replace(/[^A-Za-z\s]/g, ' ').toUpperCase();
    cleaned = cleaned.replace(/VV/g, 'W');
    const firstToken = (cleaned.trim().split(/\s+/)[0] || '');
    let match = fuzzyMatchPosition(firstToken);
    if (match) return match;
    const whole = cleaned.replace(/\s+/g, '');
    for (const len of [2, 3]) {
      match = fuzzyMatchPosition(whole.slice(0, len));
      if (match) return match;
    }
    return null;
  }

  /** Matches OCR'd PlayStyle text against Players.PLAYSTYLES; rejects short/garbage OCR noise. */
  function fuzzyMatchPlaystyle(token) {
    const cleaned = (token || '').trim();
    if (cleaned.length < 3) return null;
    let best = null, bestDist = 999;
    for (const name of Players.PLAYSTYLES) {
      if (Math.abs(cleaned.length - name.length) > 3) continue;
      const d = plainEditDistance(cleaned.toUpperCase(), name.toUpperCase());
      const maxD = name.length <= 8 ? 1 : 2;
      if (d <= maxD && d < bestDist) { best = name; bestDist = d; }
    }
    return best;
  }

  /** Draws a source rectangle from `img` onto a new canvas, scaled up.
   *  `region` is [xFrac, yFrac, wFrac, hFrac] — fractions of the image's
   *  actual width/height — so the crop lands in the right place
   *  regardless of the screenshot's exact resolution. */
  function cropToCanvas(img, region, scale) {
    const [xFrac, yFrac, wFrac, hFrac] = region;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const sx = xFrac * iw, sy = yFrac * ih, sw = wFrac * iw, sh = hFrac * ih;
    const canvas = document.createElement('canvas');
    canvas.width = sw * scale;
    canvas.height = sh * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** In-place: takes the brightest of R/G/B per pixel (handles colored text) and binarizes at `thresh`. */
  function maxChannelThreshold(canvas, thresh) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(d[i], d[i + 1], d[i + 2]) > thresh ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file.')); };
      img.src = url;
    });
  }

  /** Runs one OCR pass over a canvas region and returns trimmed text. */
  async function ocrCanvas(worker, canvas, options) {
    if (options && options.whitelist) {
      await worker.setParameters({ tessedit_char_whitelist: options.whitelist, tessedit_pageseg_mode: String(options.psm || 7) });
    } else {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: String(options && options.psm || 7) });
    }
    const { data } = await worker.recognize(canvas);
    return (data && data.text || '').trim();
  }

  function titleCase(str) {
    return (str || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Extracts everything obtainable from the Attributes screenshot:
   * name, age, overall, position, and PlayStyles. Any individual field
   * that can't be read confidently comes back as null (or, for
   * playstyles, simply omitted) rather than guessed.
   */
  async function extractFromAttributesImage(worker, img) {
    const result = { name: null, age: null, overall: null, position: null, playstyles: [] };

    const firstRaw = await ocrCanvas(worker, cropToCanvas(img, SCREENSHOT_REGIONS.firstName, 3), { psm: 7 });
    const lastRaw = await ocrCanvas(worker, cropToCanvas(img, SCREENSHOT_REGIONS.lastName, 3), { psm: 7 });
    const first = firstRaw.replace(/[^A-Za-z' -]/g, '').trim();
    const last = lastRaw.replace(/[^A-Za-z' -]/g, '').trim();
    // Basic plausibility gate: both parts must be real letters of a
    // sane length, and shouldn't be identical (a strong signal that
    // OCR noise, not a real name, ended up in both crops).
    const namesLookValid = first.length >= 2 && last.length >= 2
      && first.length <= 30 && last.length <= 30
      && first.toLowerCase() !== last.toLowerCase();
    if (namesLookValid) result.name = `${titleCase(first)} ${titleCase(last)}`;

    // Age's column position shifts depending on header layout (see
    // AGE_REGION_CANDIDATES) — try each until one yields a plausible age.
    for (const region of AGE_REGION_CANDIDATES) {
      const ageCanvas = maxChannelThreshold(cropToCanvas(img, region, 8), 90);
      const ageText = await ocrCanvas(worker, ageCanvas, { psm: 8, whitelist: '0123456789' });
      const age = parseInt(ageText, 10);
      if (Number.isFinite(age) && age >= 15 && age <= 45) { result.age = age; break; }
    }

    const overallCanvas = maxChannelThreshold(cropToCanvas(img, SCREENSHOT_REGIONS.overall, 8), 90);
    const overallText = await ocrCanvas(worker, overallCanvas, { psm: 8, whitelist: '0123456789' });
    const overall = parseInt(overallText, 10);
    if (Number.isFinite(overall) && overall >= 1 && overall <= 99) result.overall = overall;

    const positionCanvas = maxChannelThreshold(cropToCanvas(img, SCREENSHOT_REGIONS.position, 10), 90);
    const positionText = await ocrCanvas(worker, positionCanvas, { psm: 7 });
    result.position = extractPositionFromText(positionText);

    const seen = new Set();
    for (const box of PLAYSTYLE_LABEL_BOXES) {
      const labelTextRaw = await ocrCanvas(worker, cropToCanvas(img, box, 4), { psm: 6 });
      const labelText = labelTextRaw.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      const matched = fuzzyMatchPlaystyle(labelText);
      if (matched && !seen.has(matched)) { seen.add(matched); result.playstyles.push(matched); }
    }

    return result;
  }

  /** Extracts Market Value from the Financial screenshot's Player Status block. */
  async function extractFromFinancialImage(worker, img) {
    const canvas = cropToCanvas(img, SCREENSHOT_REGIONS.marketValueBand, 3);
    const text = await ocrCanvas(worker, canvas, { psm: 6 });
    const lines = text.split('\n');
    for (const line of lines) {
      if (/market/i.test(line) && /value/i.test(line)) {
        const after = line.split(/value/i)[1] || '';
        const m = after.match(/£?\s*([\d,]+)/);
        if (m) {
          const num = parseInt(m[1].replace(/,/g, ''), 10);
          if (Number.isFinite(num) && num >= 0) return num;
        }
      }
    }
    return null;
  }

  /**
   * Runs the full extraction across whichever of the two screenshots
   * were provided, merges the results, and returns null only if
   * absolutely nothing usable could be read from either one.
   */
  async function extractPlayerFromScreenshots(attributesFile, financialFile) {
    await loadTesseract();
    const worker = await Tesseract.createWorker('eng');

    let attributesImg = null, attributesUrl = null;
    let financialImg = null, financialUrl = null;

    try {
      const merged = { name: null, age: null, overall: null, position: null, value: null, playstyles: [], hasFinancial: !!financialFile };

      if (attributesFile) {
        ({ img: attributesImg, url: attributesUrl } = await loadImageFromFile(attributesFile));
        const a = await extractFromAttributesImage(worker, attributesImg);
        merged.name = a.name;
        merged.age = a.age;
        merged.overall = a.overall;
        merged.position = a.position;
        merged.playstyles = a.playstyles;
      }

      if (financialFile) {
        ({ img: financialImg, url: financialUrl } = await loadImageFromFile(financialFile));
        merged.value = await extractFromFinancialImage(worker, financialImg);
      }

      const gotAnything = merged.name || merged.age || merged.overall || merged.position
        || merged.value !== null || merged.playstyles.length > 0;

      return gotAnything ? merged : null;
    } finally {
      await worker.terminate();
      // Release every bit of image data now that processing has finished.
      if (attributesUrl) URL.revokeObjectURL(attributesUrl);
      if (financialUrl) URL.revokeObjectURL(financialUrl);
      attributesImg = null; financialImg = null;
    }
  }

  // Holds the chosen File objects only while the import sheet is open.
  let screenshotFiles = { attributes: null, financial: null };

  function resetScreenshotImportUI() {
    screenshotFiles.attributes = null;
    screenshotFiles.financial = null;
    UI.el.screenshotAttributesInput.value = '';
    UI.el.screenshotFinancialInput.value = '';
    UI.el.screenshotAttributesName.textContent = 'No file selected.';
    UI.el.screenshotFinancialName.textContent = 'No file selected.';
    UI.el.screenshotStatus.hidden = true;
    UI.el.screenshotError.hidden = true;
    UI.el.screenshotError.textContent = '';
    UI.el.screenshotExtractBtn.disabled = true;
    UI.el.screenshotExtractBtn.textContent = 'Extract & Continue';
  }

  function closeScreenshotImportSheet() {
    UI.closeSheet(UI.el.screenshotBackdrop, UI.el.screenshotSheet);
    resetScreenshotImportUI(); // also releases the selected File objects
  }

  function onScreenshotFileChosen(which) {
    const input = which === 'attributes' ? UI.el.screenshotAttributesInput : UI.el.screenshotFinancialInput;
    const nameEl = which === 'attributes' ? UI.el.screenshotAttributesName : UI.el.screenshotFinancialName;
    const file = input.files && input.files[0] ? input.files[0] : null;

    screenshotFiles[which] = file;
    nameEl.textContent = file ? file.name : 'No file selected.';

    UI.el.screenshotError.hidden = true;
    // Either screenshot alone is enough to extract something.
    UI.el.screenshotExtractBtn.disabled = !(screenshotFiles.attributes || screenshotFiles.financial);
  }

  function showScreenshotError(message) {
    UI.el.screenshotStatus.hidden = true;
    UI.el.screenshotError.textContent = message;
    UI.el.screenshotError.hidden = false;
  }

  async function onExtractScreenshots() {
    if (!screenshotFiles.attributes && !screenshotFiles.financial) return;

    const attributesFile = screenshotFiles.attributes;
    const financialFile = screenshotFiles.financial;

    UI.el.screenshotError.hidden = true;
    UI.el.screenshotStatus.hidden = false;
    UI.el.screenshotStatus.textContent = 'Reading screenshots…';
    UI.el.screenshotExtractBtn.disabled = true;

    try {
      const extracted = await extractPlayerFromScreenshots(attributesFile, financialFile);

      if (!extracted) {
        showScreenshotError('Couldn\u2019t confidently read any usable details from these screenshots. Try clearer screenshots, or enter the player manually.');
        return;
      }

      closeScreenshotImportSheet();
      if (onExtracted) onExtracted(extracted);
      UI.showToast('Player details filled in from screenshots — review and save.');
    } catch (err) {
      console.error('Screenshot extraction failed', err);
      showScreenshotError('Couldn\u2019t read these screenshots. Please try again.');
    } finally {
      // Release the image data now that processing has finished, whether
      // it succeeded or failed.
      screenshotFiles.attributes = null;
      screenshotFiles.financial = null;
      UI.el.screenshotAttributesInput.value = '';
      UI.el.screenshotFinancialInput.value = '';
    }
  }

  // ---- Public interface ----

  // Set by init(): called with the validated extraction result so the
  // caller (app.js) can apply it to the Add Player form. Kept separate
  // from this module since populating that specific form is app.js's
  // job, not this module's.
  let onExtracted = null;

  /**
   * Wires up the screenshot import sheet's own buttons/inputs and
   * records the callback to invoke with a successful extraction result.
   * Call once during app startup.
   */
  function init(onExtractedCallback) {
    onExtracted = onExtractedCallback;

    UI.el.importScreenshotBtn.addEventListener('click', () => {
      resetScreenshotImportUI();
      UI.openSheet(UI.el.screenshotBackdrop, UI.el.screenshotSheet);
    });
    UI.el.screenshotAttributesInput.addEventListener('change', () => onScreenshotFileChosen('attributes'));
    UI.el.screenshotFinancialInput.addEventListener('change', () => onScreenshotFileChosen('financial'));
    UI.el.screenshotExtractBtn.addEventListener('click', onExtractScreenshots);
    UI.el.screenshotCancelBtn.addEventListener('click', closeScreenshotImportSheet);
    UI.el.closeScreenshotBtn.addEventListener('click', closeScreenshotImportSheet);
    UI.el.screenshotBackdrop.addEventListener('click', closeScreenshotImportSheet);
  }

  return { init };
})();
