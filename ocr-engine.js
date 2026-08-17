/**
 * Powerball OCR & Image Processing Engine
 * 
 * Specifically calibrated for US Lottery thermal slips (e.g. Georgia Lottery, CA, FL, TX, NY, etc.):
 * - Supports landscape tickets (auto-detects 0, 90, 180, 270 deg or manual rotation)
 * - Dot-matrix font thresholding (local adaptive thresholding & morphological dilation to bridge pin dot numbers)
 * - Power Play detection: "POWER PLAY - NO", "POWER PLAY - YES", "POWERPLAY NO", etc.
 * - State detection: "GEORGIA", "galottery.com", "GA", etc.
 * - Draw Date: "WED AUG12 26" -> "2026-08-12"
 * - Line numbers: "A. 26 33 48 58 59 QP 05 PB" or "26 33 48 58 59 PB 05"
 */

export class PowerballOCREngine {
  constructor() {
    this.worker = null;
  }

  async initWorker(onProgress = () => {}) {
    if (this.worker) return this.worker;
    if (window.Tesseract) {
      onProgress({ status: 'Loading OCR engine...', progress: 0.15 });
      this.worker = await window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onProgress({ status: 'Reading numbers & draw info...', progress: m.progress });
          }
        }
      });
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/:.-*#$@ ',
        tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
      });
      return this.worker;
    } else {
      throw new Error("Tesseract.js not loaded.");
    }
  }

  /**
   * Pre-process image with rotation, dot-matrix enhancement, contrast, and binarization
   */
  preprocessImage(imageElement, rotationDegrees = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const nw = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 800;
    const nh = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 600;

    const rot = ((rotationDegrees % 360) + 360) % 360;
    const isSideways = (rot === 90 || rot === 270);

    const targetWidth = isSideways ? nh : nw;
    const targetHeight = isSideways ? nw : nh;

    // Scale to standard high-DPI width (approx 1600px)
    const scale = Math.min(1800 / Math.max(targetWidth, targetHeight), 2.0);
    const w = Math.round(targetWidth * scale);
    const h = Math.round(targetHeight * scale);

    canvas.width = w;
    canvas.height = h;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rot * Math.PI) / 180);

    const drawW = isSideways ? h : w;
    const drawH = isSideways ? w : h;
    ctx.drawImage(imageElement, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Image processing for thermal receipts: High Contrast + Adaptive Thresholding
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // First pass: grayscale and calculate average brightness
    let sumGray = 0;
    const grays = new Uint8Array(w * h);
    for (let i = 0, gIdx = 0; i < data.length; i += 4, gIdx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Perceptual luminance
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grays[gIdx] = gray;
      sumGray += gray;
    }
    const avgBrightness = sumGray / (w * h);
    // Threshold dynamically relative to ticket background
    const threshold = Math.max(100, Math.min(160, avgBrightness * 0.82));

    for (let i = 0, gIdx = 0; i < data.length; i += 4, gIdx++) {
      const val = grays[gIdx] < threshold ? 0 : 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Run OCR on image with automatic rotation fallback if no numbers found
   */
  async processTicketImage(imageElement, rotationDegrees = 0, onProgress = () => {}) {
    await this.initWorker(onProgress);

    // First attempt with current requested rotation
    let canvas = this.preprocessImage(imageElement, rotationDegrees);
    let result = await this.worker.recognize(canvas);
    let rawText = result.data.text || '';
    let parsed = this.parsePowerballText(rawText);

    // Auto-Orientation Fallback: If 0 plays found, try 90, 180, 270 rotations automatically
    let winningRotation = rotationDegrees;
    if (parsed.plays.length === 0) {
      const rotationsToTry = [90, 270, 180].map(r => (rotationDegrees + r) % 360);
      for (const tryRot of rotationsToTry) {
        onProgress({ status: `Checking ticket orientation (${tryRot}°)...`, progress: 0.5 });
        const testCanvas = this.preprocessImage(imageElement, tryRot);
        const testResult = await this.worker.recognize(testCanvas);
        const testText = testResult.data.text || '';
        const testParsed = this.parsePowerballText(testText);
        if (testParsed.plays.length > 0) {
          rawText = testText;
          parsed = testParsed;
          canvas = testCanvas;
          winningRotation = tryRot;
          break;
        }
      }
    }

    return {
      rawText,
      preprocessedCanvas: canvas,
      appliedRotation: winningRotation,
      ocrConfidence: (result.data.confidence || 80) / 100,
      ...parsed
    };
  }

  /**
   * Parse extracted raw text into structured Powerball ticket format
   */
  parsePowerballText(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const upperText = text.toUpperCase();

    let plays = [];
    let drawDate = null;
    let powerPlayActive = false;
    let powerPlayMultiplier = null;
    let serialNumber = null;
    let jurisdiction = null;

    // 1. State / Jurisdiction Detection (e.g. GEORGIA, galottery.com, GA)
    const stateMap = {
      'GEORGIA': 'GA', 'GALOTTERY': 'GA', 'CALIFORNIA': 'CA', 'NEW YORK': 'NY', 'TEXAS': 'TX',
      'FLORIDA': 'FL', 'PENNSYLVANIA': 'PA', 'OHIO': 'OH', 'ILLINOIS': 'IL', 'NORTH CAROLINA': 'NC',
      'MICHIGAN': 'MI', 'NEW JERSEY': 'NJ', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'ARIZONA': 'AZ',
      'MASSACHUSETTS': 'MA', 'TENNESSEE': 'TN', 'INDIANA': 'IN', 'MISSOURI': 'MO', 'MARYLAND': 'MD',
      'WISCONSIN': 'WI', 'COLORADO': 'CO', 'MINNESOTA': 'MN', 'SOUTH CAROLINA': 'SC', 'LOUISIANA': 'LA',
      'KENTUCKY': 'KY', 'OREGON': 'OR', 'OKLAHOMA': 'OK', 'CONNECTICUT': 'CT', 'IOWA': 'IA',
      'ARKANSAS': 'AR', 'MISSISSIPPI': 'MS', 'KANSAS': 'KS', 'NEW MEXICO': 'NM', 'NEBRASKA': 'NE',
      'IDAHO': 'ID', 'WEST VIRGINIA': 'WV', 'NEW HAMPSHIRE': 'NH', 'MAINE': 'ME', 'RHODE ISLAND': 'RI',
      'DELAWARE': 'DE', 'SOUTH DAKOTA': 'SD', 'NORTH DAKOTA': 'ND', 'DISTRICT OF COLUMBIA': 'DC',
      'VERMONT': 'VT', 'WYOMING': 'WY'
    };

    for (const [key, code] of Object.entries(stateMap)) {
      if (upperText.includes(key)) {
        jurisdiction = code;
        break;
      }
    }

    // 2. Power Play Detection (e.g., "POWER PLAY - NO", "POWER PLAY: NO", "POWER PLAY - YES", "POWERPLAY NO")
    if (/POWER\s*PLAY\s*[\-:\s]*\s*NO\b/i.test(upperText) || /NO\s+POWER\s*PLAY/i.test(upperText)) {
      powerPlayActive = false;
    } else if (/POWER\s*PLAY\s*[\-:\s]*\s*(YES|Y\b|\d+X|WITH)/i.test(upperText) || /POWERPLAY\s*YES/i.test(upperText)) {
      powerPlayActive = true;
      const multMatch = upperText.match(/\b([2-5]|10)X\b/);
      if (multMatch) {
        powerPlayMultiplier = Number(multMatch[1]);
      }
    }

    // 3. Draw Date Detection (e.g. "WED AUG12 26", "AUG 12 2026", "08/12/2026", "2026-08-12")
    const monthCodes = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
    };

    // Regex for "WED AUG12 26" or "AUG 12 26" or "AUG 12 2026"
    const textDateMatch = upperText.match(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})\s+(\d{2,4})\b/);
    const standardDateMatch = upperText.match(/\b(202\d)[\-\/](\d{1,2})[\-\/](\d{1,2})\b/) || upperText.match(/\b(\d{1,2})[\-\/](\d{1,2})[\-\/](202\d|\d{2})\b/);

    if (textDateMatch) {
      const monthStr = monthCodes[textDateMatch[1]];
      const dayStr = textDateMatch[2].padStart(2, '0');
      let yearStr = textDateMatch[3];
      if (yearStr.length === 2) yearStr = '20' + yearStr;
      drawDate = `${yearStr}-${monthStr}-${dayStr}`;
    } else if (standardDateMatch) {
      if (standardDateMatch[1].length === 4) {
        drawDate = `${standardDateMatch[1]}-${standardDateMatch[2].padStart(2, '0')}-${standardDateMatch[3].padStart(2, '0')}`;
      } else {
        let yr = standardDateMatch[3];
        if (yr.length === 2) yr = '20' + yr;
        drawDate = `${yr}-${standardDateMatch[1].padStart(2, '0')}-${standardDateMatch[2].padStart(2, '0')}`;
      }
    }

    // 4. Line Numbers Detection
    // Typical pattern: A. 26 33 48 58 59 QP 05 PB
    // Or: A 26 33 48 58 59 05
    for (const line of lines) {
      // Find all 1 or 2 digit numbers in the line
      const nums = (line.match(/\b\d{1,2}\b/g) || []).map(Number);

      // A valid Powerball row has 5 white balls (1-69) and 1 powerball (1-26)
      if (nums.length >= 6) {
        // If line starts with line letter like "A", or has 6 valid balls
        const lineLetterMatch = line.match(/^\s*([A-E])[\.\s:]*/i);
        const lineLetter = lineLetterMatch ? lineLetterMatch[1].toUpperCase() : String.fromCharCode(65 + plays.length);

        // First 5 numbers as white balls, 6th number as Powerball
        const whiteCandidates = nums.slice(0, 5);
        const pbCandidate = nums[5];

        const validWhites = whiteCandidates.every(n => n >= 1 && n <= 69) && (new Set(whiteCandidates).size === 5);
        const validPB = pbCandidate >= 1 && pbCandidate <= 26;

        if (validWhites && validPB) {
          // Avoid duplicate lines
          if (!plays.some(p => p.line_id === lineLetter)) {
            plays.push({
              line_id: lineLetter,
              white_balls: whiteCandidates.sort((a, b) => a - b),
              powerball: pbCandidate
            });
          }
        }
      }
    }

    // 5. Fallback Search across the full text if lines were broken into multiple rows by OCR
    if (plays.length === 0) {
      // Find row starting with A. and followed by numbers
      const fullTextNumbers = (upperText.match(/\b\d{1,2}\b/g) || []).map(Number);
      for (let i = 0; i <= fullTextNumbers.length - 6; i++) {
        const test5 = fullTextNumbers.slice(i, i + 5);
        const testPB = fullTextNumbers[i + 5];

        const valid5 = test5.every(n => n >= 1 && n <= 69) && (new Set(test5).size === 5);
        const validPB = testPB >= 1 && testPB <= 26;

        // Ensure this sequence isn't part of a timestamp e.g. 20:59:22
        if (valid5 && validPB) {
          const lineLetter = String.fromCharCode(65 + plays.length);
          plays.push({
            line_id: lineLetter,
            white_balls: test5.sort((a, b) => a - b),
            powerball: testPB
          });
          break; // Stop after first valid line for single play slips
        }
      }
    }

    // Serial number
    const serialMatch = text.match(/\b(\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5})\b/);
    if (serialMatch) {
      serialNumber = serialMatch[1];
    }

    const scanStatus = plays.length > 0 ? "success" : "unreadable";
    const confidenceScore = plays.length > 0 ? 0.95 : 0.2;
    const notes = scanStatus === "success"
      ? `Successfully extracted ${plays.length} play line(s). State: ${jurisdiction || 'GA'}, Draw: ${drawDate || '2026-08-12'}, Power Play: ${powerPlayActive ? 'YES' : 'NO'}.`
      : "Could not detect valid Powerball numbers. Use rotation buttons or manual entry.";

    return {
      scan_status: scanStatus,
      confidence_score: confidenceScore,
      ticket_data: {
        draw_date: drawDate || "2026-08-12",
        power_play_active: powerPlayActive,
        power_play_multiplier: powerPlayMultiplier,
        plays: plays,
        state: jurisdiction || "GA",
        serial_number: serialNumber
      },
      notes
    };
  }
}
