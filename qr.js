/*
 * qr.js - a small, dependency-free QR Code encoder.
 *
 * Why this exists: the QR is generated entirely in the browser, with no
 * external library, CDN or server. The text you pass in is stored in the
 * QR *exactly as given* (UTF-8 bytes, "byte mode"), so a phone camera that
 * scans it receives the same URL.
 *
 * Settings: byte mode, error-correction level M (~15% damage tolerated),
 * automatic version (1-40) and automatic mask selection.
 *
 * Usage:   const matrix = QREncoder.encode("https://example.com");
 *          // matrix[y][x] === true  -> dark module
 */
(function (global) {
  "use strict";

  // Per-version tables for error-correction level M (index 0 is unused).
  const ECC_CODEWORDS_PER_BLOCK = [-1,
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const NUM_ERROR_CORRECTION_BLOCKS = [-1,
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  const FORMAT_BITS_ECC_M = 0; // 2-bit indicator for level M

  // ---------- helpers ----------

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  // Total modules that can hold data + error-correction bits for a version.
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // Number of data (non error-correction) codewords for a version.
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ver] * NUM_ERROR_CORRECTION_BLOCKS[ver];
  }

  // ---------- Reed-Solomon error correction over GF(256) ----------

  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsComputeDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }

  function rsComputeRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
    }
    return result;
  }

  // Split data into blocks, add error correction to each, then interleave.
  function addEccAndInterleave(data, ver) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const divisor = rsComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsComputeRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0); // placeholder, skipped below
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  // ---------- matrix construction ----------

  function alignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function buildMatrix(ver, codewords) {
    const size = ver * 4 + 17;
    const modules = [];
    const isFunction = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function setFunction(x, y, dark) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    }

    function drawFinder(cx, cy) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }

    function drawAlignment(cx, cy) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    function drawFormatBits(mask) {
      const data = (FORMAT_BITS_ECC_M << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFunction(8, i, getBit(bits, i));
      setFunction(8, 7, getBit(bits, 6));
      setFunction(8, 8, getBit(bits, 7));
      setFunction(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++) setFunction(14 - i, 8, getBit(bits, i));
      for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, getBit(bits, i));
      setFunction(8, size - 8, true); // always-dark module
    }

    function drawVersionBits() {
      if (ver < 7) return;
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = getBit(bits, i);
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(a, b, dark);
        setFunction(b, a, dark);
      }
    }

    // Function patterns: timing, finders, alignment, format/version areas.
    for (let i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);
    const align = alignmentPatternPositions(ver);
    const last = align.length - 1;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        drawAlignment(align[i], align[j]);
      }
    }
    drawFormatBits(0); // reserve the area; real value is drawn after masking
    drawVersionBits();

    // Place the data bits in the zig-zag order required by the spec.
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
            modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }

    // XOR the data area with a mask pattern (toggle, so calling twice undoes it).
    function applyMask(mask) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let invert;
          switch (mask) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          }
          if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x];
        }
      }
    }

    // Pick the mask with the lowest penalty score (fewest scanner-confusing patterns).
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormatBits(mask);
      const p = penaltyScore(modules, size);
      if (p < bestPenalty) { bestPenalty = p; bestMask = mask; }
      applyMask(mask); // undo
    }
    applyMask(bestMask);
    drawFormatBits(bestMask);
    return modules;
  }

  const FINDER_LIKE_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const FINDER_LIKE_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

  function penaltyScore(m, size) {
    let score = 0;

    // Rules 1 and 3: long runs of one colour, and finder-like patterns.
    for (let dir = 0; dir < 2; dir++) {
      for (let a = 0; a < size; a++) {
        const line = [];
        for (let b = 0; b < size; b++) line.push((dir === 0 ? m[a][b] : m[b][a]) ? 1 : 0);

        let run = 1;
        for (let i = 1; i < size; i++) {
          if (line[i] === line[i - 1]) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else {
            run = 1;
          }
        }
        for (let i = 0; i + 11 <= size; i++) {
          let a1 = true, b1 = true;
          for (let k = 0; k < 11; k++) {
            if (line[i + k] !== FINDER_LIKE_A[k]) a1 = false;
            if (line[i + k] !== FINDER_LIKE_B[k]) b1 = false;
          }
          if (a1) score += 40;
          if (b1) score += 40;
        }
      }
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }

    // Rule 4: balance of dark and light modules.
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += Math.max(0, k) * 10;

    return score;
  }

  // ---------- public API ----------

  /**
   * Encode text into a QR matrix.
   * @param {string} text  Stored exactly as given (as UTF-8 bytes).
   * @returns {boolean[][]} square matrix, true = dark module
   * @throws {Error} with code "TOO_LONG" if the text can't fit in a QR code
   */
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));

    // Find the smallest version that fits: mode(4) + count(8|16) + data bits.
    let ver = 1;
    for (; ver <= 40; ver++) {
      const countBits = ver <= 9 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= numDataCodewords(ver) * 8) break;
    }
    if (ver > 40) {
      const err = new Error("Text is too long for a QR code.");
      err.code = "TOO_LONG";
      throw err;
    }

    const bits = [];
    function appendBits(value, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }

    appendBits(0x4, 4);                         // byte mode
    appendBits(bytes.length, ver <= 9 ? 8 : 16); // character count
    bytes.forEach((b) => appendBits(b, 8));      // the data itself

    const capacityBits = numDataCodewords(ver) * 8;
    appendBits(0, Math.min(4, capacityBits - bits.length)); // terminator
    appendBits(0, (8 - (bits.length % 8)) % 8);              // align to byte
    for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      dataCodewords.push(v);
    }

    return buildMatrix(ver, addEccAndInterleave(dataCodewords, ver));
  }

  const api = { encode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.QREncoder = api;
})(typeof window !== "undefined" ? window : globalThis);
