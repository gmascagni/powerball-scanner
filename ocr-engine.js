/**
 * Powerball OCR & Strict Validation Engine
 * 
 * Mandatory Field Requirements for Valid Powerball Tickets:
 * 1. Game Identification: Must contain "POWERBALL" or "POWER"
 * 2. Jurisdiction / State: Must identify a valid lottery state (e.g. GA, CA, FL, NY, TX, etc.)
 * 3. Draw Date: Must detect valid scheduled drawing date (YYYY-MM-DD)
 * 4. Legible Play Lines: Each line MUST contain exactly 5 distinct White Balls (1–69) and exactly 1 Powerball (1–26).
 * 
 * If ANY mandatory field is missing, ambiguous, or fails range checks:
 * -> Scan Status = "unreadable" or "low_quality"
 * -> Clear Error Banner with instruction: "Image unclear or unreadable. Please retake photo with better lighting and flat focus."
 * -> NEVER populate hallucinated / phantom lines.
 */

export class PowerballOCREngine {
  constructor() {
    this.worker = null;
  }

  async initWorker(onProgress = () => {}) {
    if (this.worker) return this.worker;
    if (window.Tesseract) {
      try {
        onProgress({ status: 'Initializing OCR Engine...', progress: 0.15 });
        this.worker = await window.Tesseract.createWorker('eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js',
          logger: (m) => {
            if (m.status === 'recognizing text') {
              onProgress({ status: 'Reading ticket digits & text...', progress: m.progress });
            }
          }
        });
        return this.worker;
      } catch (err) {
        console.warn('Worker init warning:', err);
        return null;
      }
    } else {
      throw new Error("Tesseract library not found.");
    }
  }

  preprocessImage(imageElement, rotationDegrees = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const nw = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 800;
    const nh = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 600;

    const rot = ((rotationDegrees % 360) + 360) % 360;
    const isSideways = (rot === 90 || rot === 270);

    const targetWidth = isSideways ? nh : nw;
    const targetHeight = isSideways ? nw : nh;

    // Scale up for high-precision OCR
    const scale = Math.min(2200 / Math.max(targetWidth, targetHeight), 2.5);
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

    // High dynamic range contrast stretching
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minL = 255;
    let maxL = 0;
    const grays = new Uint8Array(w * h);

    for (let i = 0, gIdx = 0; i < data.length; i += 4, gIdx++) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      grays[gIdx] = gray;
      if (gray < minL) minL = gray;
      if (gray > maxL) maxL = gray;
    }

    const range = Math.max(1, maxL - minL);
    for (let i = 0, gIdx = 0; i < data.length; i += 4, gIdx++) {
      let norm = Math.round(((grays[gIdx] - minL) * 255) / range);
      // Darken text dots
      norm = Math.round(255 * Math.pow(norm / 255, 1.4));
      data[i] = norm;
      data[i + 1] = norm;
      data[i + 2] = norm;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  async processTicketImage(imageElement, rotationDegrees = 0, onProgress = () => {}) {
    const worker = await this.initWorker(onProgress);

    const recognize = async (cvs) => {
      if (worker) {
        return await worker.recognize(cvs);
      } else if (window.Tesseract && window.Tesseract.recognize) {
        return await window.Tesseract.recognize(cvs, 'eng');
      }
      throw new Error("OCR service unavailable.");
    };

    let winningCanvas = this.preprocessImage(imageElement, rotationDegrees);
    let result = await recognize(winningCanvas);
    let rawText = result?.data?.text || '';
    let winningRotation = rotationDegrees;
    let validation = this.validateAndParse(rawText);

    // Multi-angle sweep if not valid
    if (!validation.isValid) {
      const angles = [90, 270, 180].map(a => (rotationDegrees + a) % 360);
      for (const angle of angles) {
        onProgress({ status: `Scanning angle ${angle}°...`, progress: 0.5 });
        const testCanvas = this.preprocessImage(imageElement, angle);
        const testRes = await recognize(testCanvas);
        const testText = testRes?.data?.text || '';
        const testVal = this.validateAndParse(testText);

        if (testVal.isValid) {
          rawText = testText;
          validation = testVal;
          winningCanvas = testCanvas;
          winningRotation = angle;
          break;
        }
      }
    }

    return {
      rawText: rawText || '(No OCR text recognized from image)',
      preprocessedCanvas: winningCanvas,
      appliedRotation: winningRotation,
      ocrConfidence: validation.isValid ? 0.95 : 0.2,
      ...validation
    };
  }

  /**
   * Mandatory Field Validation & Strict Parsing
   */
  validateAndParse(text) {
    const upperText = (text || '').toUpperCase();
    const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const missingFields = [];
    const validationErrors = [];

    // 1. Mandatory Game Check
    const hasGame = /POWER\s*BALL|POWERBALL/i.test(upperText);
    if (!hasGame) {
      missingFields.push('Powerball Game Title');
    }

    // 2. Mandatory State Check
    let detectedState = null;
    const stateMap = [
      { pattern: /GEORGIA|GALOTTERY/i, code: 'GA' },
      { pattern: /CALIFORNIA|CALOTTERY/i, code: 'CA' },
      { pattern: /FLORIDA|FLALOTTERY/i, code: 'FL' },
      { pattern: /TEXAS\s+LOTTERY/i, code: 'TX' },
      { pattern: /NEW\s+YORK\s+LOTTERY/i, code: 'NY' },
      { pattern: /PENNSYLVANIA/i, code: 'PA' },
      { pattern: /NORTH\s+CAROLINA/i, code: 'NC' },
      { pattern: /SOUTH\s+CAROLINA/i, code: 'SC' },
      { pattern: /OHIO/i, code: 'OH' },
      { pattern: /MICHIGAN/i, code: 'MI' },
      { pattern: /ILLINOIS/i, code: 'IL' },
      { pattern: /NEW\s+JERSEY/i, code: 'NJ' },
      { pattern: /VIRGINIA/i, code: 'VA' },
      { pattern: /TENNESSEE/i, code: 'TN' },
      { pattern: /INDIANA|HOOSIER/i, code: 'IN' },
      { pattern: /MISSOURI/i, code: 'MO' },
      { pattern: /MARYLAND/i, code: 'MD' },
      { pattern: /WISCONSIN/i, code: 'WI' },
      { pattern: /COLORADO/i, code: 'CO' },
      { pattern: /MINNESOTA/i, code: 'MN' },
      { pattern: /LOUISIANA/i, code: 'LA' },
      { pattern: /KENTUCKY/i, code: 'KY' },
      { pattern: /OREGON/i, code: 'OR' },
      { pattern: /OKLAHOMA/i, code: 'OK' },
      { pattern: /CONNECTICUT/i, code: 'CT' },
      { pattern: /IOWA/i, code: 'IA' },
      { pattern: /ARKANSAS/i, code: 'AR' },
      { pattern: /KANSAS/i, code: 'KS' },
      { pattern: /NEW\s+MEXICO/i, code: 'NM' },
      { pattern: /NEBRASKA/i, code: 'NE' },
      { pattern: /IDAHO/i, code: 'ID' },
      { pattern: /WEST\s+VIRGINIA/i, code: 'WV' },
      { pattern: /WASHINGTON/i, code: 'WA' },
      { pattern: /ARIZONA/i, code: 'AZ' },
      { pattern: /MASSACHUSETTS/i, code: 'MA' }
    ];

    for (const entry of stateMap) {
      if (entry.pattern.test(upperText)) {
        detectedState = entry.code;
        break;
      }
    }

    if (!detectedState) {
      missingFields.push('State / Jurisdiction');
    }

    // 3. Mandatory Draw Date Check
    let drawDate = null;
    const monthCodes = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
    };

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

    if (!drawDate) {
      missingFields.push('Draw Date');
    }

    // 4. Power Play Option
    let powerPlayActive = false;
    let powerPlayMultiplier = null;

    if (/POWER\s*PLAY\s*[\-:\s]*\s*NO\b/i.test(upperText) || /POWERPLAY\s*NO/i.test(upperText) || /NO\s+POWER\s*PLAY/i.test(upperText)) {
      powerPlayActive = false;
    } else if (/POWER\s*PLAY\s*[\-:\s]*\s*(YES|Y\b|\d+X|WITH)/i.test(upperText) || /POWERPLAY\s*YES/i.test(upperText)) {
      powerPlayActive = true;
      const multMatch = upperText.match(/\b([2-5]|10)X\b/);
      if (multMatch) {
        powerPlayMultiplier = Number(multMatch[1]);
      }
    }

    // 5. Strict Play Line Extraction (NO PHANTOM LINES ALLOWED)
    const validPlays = [];

    for (const rawLine of lines) {
      // Exclude promotional ads & terminal stamps
      if (/MILLION|JACKPOT|FANTASY|MEGA|BRONCO|SCRATCHERS|TODAY|COULD|PRINTED|TERMINAL/i.test(rawLine)) {
        continue;
      }

      // Format 1: Explicit Line prefix A-E followed by numbers
      const lineMatch = rawLine.match(/^\s*([A-E])[\.\s:]+(.*)$/i);
      if (lineMatch) {
        const lineLetter = lineMatch[1].toUpperCase();
        const nums = (lineMatch[2].match(/\b\d{1,2}\b/g) || []).map(Number);

        if (nums.length >= 6) {
          const whites = nums.slice(0, 5);
          const pb = nums[5];

          const validWhites = whites.every(n => n >= 1 && n <= 69) && (new Set(whites).size === 5);
          const validPB = pb >= 1 && pb <= 26;

          if (validWhites && validPB) {
            if (!validPlays.some(p => p.line_id === lineLetter)) {
              validPlays.push({
                line_id: lineLetter,
                white_balls: whites.sort((a, b) => a - b),
                powerball: pb
              });
            }
          }
        }
      }
    }

    // Fallback: Check for exact 6 lottery numbers sequence on an isolated line
    if (validPlays.length === 0) {
      for (const rawLine of lines) {
        if (/MILLION|JACKPOT|FANTASY|MEGA|BRONCO|SCRATCHERS|TODAY|COULD|PRINTED/i.test(rawLine)) continue;
        const nums = (rawLine.match(/\b\d{1,2}\b/g) || []).map(Number);
        if (nums.length === 6) {
          const whites = nums.slice(0, 5);
          const pb = nums[5];
          const validWhites = whites.every(n => n >= 1 && n <= 69) && (new Set(whites).size === 5);
          const validPB = pb >= 1 && pb <= 26;
          if (validWhites && validPB) {
            validPlays.push({
              line_id: 'A',
              white_balls: whites.sort((a, b) => a - b),
              powerball: pb
            });
            break;
          }
        }
      }
    }

    if (validPlays.length === 0) {
      missingFields.push('Play Line Numbers (5 White Balls 1-69 + 1 Powerball 1-26)');
    }

    // Determine Validation Status
    const isValid = missingFields.length === 0 && validPlays.length > 0;
    let scanStatus = isValid ? "success" : "unreadable";

    let notes = "";
    if (isValid) {
      notes = `Successfully verified Powerball ticket. Extracted ${validPlays.length} valid line(s). State: ${detectedState}, Draw: ${drawDate}, Power Play: ${powerPlayActive ? 'YES' : 'NO'}.`;
    } else {
      notes = `Image Unclear or Missing Mandatory Fields: ${missingFields.join(', ')}. Please retake photo with clear flat focus and bright lighting.`;
    }

    return {
      isValid,
      missingFields,
      scan_status: scanStatus,
      ticket_data: {
        draw_date: drawDate || "",
        power_play_active: powerPlayActive,
        power_play_multiplier: powerPlayMultiplier,
        plays: validPlays,
        state: detectedState || ""
      },
      notes
    };
  }
}
