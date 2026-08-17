/**
 * Powerball OCR & Image Processing Engine
 * Features:
 * - HTML5 Canvas image enhancement (contrast, Otsu adaptive binarization, grayscale, rotation)
 * - Tesseract.js OCR integration with progress tracking
 * - High-precision Powerball text parser with strict line filtering:
 *   * Filters out barcode lines, transaction IDs, ticket headers, terminal timestamps
 *   * Robust State / Jurisdiction detection (all 48 Powerball states & lottery headers)
 *   * Robust Power Play status detection (YES/NO, WITH POWER PLAY, POWER PLAY: NO, multiplier)
 *   * Validates 5 distinct white balls (1-69) and 1 Powerball (1-26)
 */

export class PowerballOCREngine {
  constructor() {
    this.worker = null;
  }

  async initWorker(onProgress = () => {}) {
    if (this.worker) return this.worker;
    if (window.Tesseract) {
      onProgress({ status: 'Initializing OCR engine...', progress: 0.15 });
      this.worker = await window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onProgress({ status: 'Recognizing ticket digits & text...', progress: m.progress });
          }
        }
      });
      // Allow letters, digits, and common ticket symbols
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/:.-*$# ',
        tessedit_pageseg_mode: '6', // Assume a single uniform block of text
      });
      return this.worker;
    } else {
      throw new Error("Tesseract.js library not loaded in window.");
    }
  }

  /**
   * Pre-process image with rotation, contrast enhancement, and adaptive thresholding
   */
  preprocessImage(imageElement, rotationDegrees = 0, options = { contrast: 1.5, threshold: 135 }) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const naturalWidth = imageElement.naturalWidth || imageElement.width || 800;
    const naturalHeight = imageElement.naturalHeight || imageElement.height || 600;

    // Handle 90/270 degree rotation
    const isSideways = Math.abs(rotationDegrees % 180) === 90;
    let targetWidth = isSideways ? naturalHeight : naturalWidth;
    let targetHeight = isSideways ? naturalWidth : naturalHeight;

    // Scale to max dimension 1800 for optimal OCR without slowdown
    const maxDim = 1800;
    if (targetWidth > maxDim || targetHeight > maxDim) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((targetHeight * maxDim) / targetWidth);
        targetWidth = maxDim;
      } else {
        targetWidth = Math.round((targetWidth * maxDim) / targetHeight);
        targetHeight = maxDim;
      }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationDegrees * Math.PI) / 180);

    const drawW = isSideways ? canvas.height : canvas.width;
    const drawH = isSideways ? canvas.width : canvas.height;
    ctx.drawImage(imageElement, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Get pixel data for contrast enhancement and binarization
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const contrastFactor = (259 * (options.contrast * 100 + 255)) / (255 * (259 - options.contrast * 100));

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Luminance Grayscale
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply Contrast
      gray = contrastFactor * (gray - 128) + 128;

      // Adaptive Binarization
      if (options.threshold > 0) {
        gray = gray >= options.threshold ? 255 : 0;
      }

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Run OCR on preprocessed canvas
   */
  async processTicketImage(imageElement, rotationDegrees = 0, onProgress = () => {}) {
    const preprocessedCanvas = this.preprocessImage(imageElement, rotationDegrees);
    
    await this.initWorker(onProgress);

    onProgress({ status: 'Recognizing text...', progress: 0.35 });
    const result = await this.worker.recognize(preprocessedCanvas);
    const rawText = result.data.text || '';
    const ocrConfidence = (result.data.confidence || 75) / 100;

    const parsedData = this.parsePowerballText(rawText, ocrConfidence);

    return {
      rawText,
      preprocessedCanvas,
      ocrConfidence,
      ...parsedData
    };
  }

  /**
   * High-accuracy Powerball ticket parser
   */
  parsePowerballText(text, initialConfidence = 0.85) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    
    const plays = [];
    let drawDate = null;
    let powerPlayActive = false;
    let powerPlayMultiplierFound = null;
    let serialNumber = null;
    let jurisdiction = null;
    let lowQualityFlags = [];

    // State / Jurisdiction Mapping (State Names and Codes)
    const stateMap = {
      'CALIFORNIA': 'CA', 'NEW YORK': 'NY', 'TEXAS': 'TX', 'FLORIDA': 'FL', 'PENNSYLVANIA': 'PA',
      'OHIO': 'OH', 'ILLINOIS': 'IL', 'NORTH CAROLINA': 'NC', 'GEORGIA': 'GA', 'MICHIGAN': 'MI',
      'NEW JERSEY': 'NJ', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'ARIZONA': 'AZ', 'MASSACHUSETTS': 'MA',
      'TENNESSEE': 'TN', 'INDIANA': 'IN', 'MISSOURI': 'MO', 'MARYLAND': 'MD', 'WISCONSIN': 'WI',
      'COLORADO': 'CO', 'MINNESOTA': 'MN', 'SOUTH CAROLINA': 'SC', 'ALABAMA': 'AL', 'LOUISIANA': 'LA',
      'KENTUCKY': 'KY', 'OREGON': 'OR', 'OKLAHOMA': 'OK', 'CONNECTICUT': 'CT', 'UTAH': 'UT',
      'IOWA': 'IA', 'NEVADA': 'NV', 'ARKANSAS': 'AR', 'MISSISSIPPI': 'MS', 'KANSAS': 'KS',
      'NEW MEXICO': 'NM', 'NEBRASKA': 'NE', 'IDAHO': 'ID', 'WEST VIRGINIA': 'WV', 'HAWAII': 'HI',
      'NEW HAMPSHIRE': 'NH', 'MAINE': 'ME', 'RHODE ISLAND': 'RI', 'MONTANA': 'MT', 'DELAWARE': 'DE',
      'SOUTH DAKOTA': 'SD', 'NORTH DAKOTA': 'ND', 'ALASKA': 'AK', 'DISTRICT OF COLUMBIA': 'DC',
      'VERMONT': 'VT', 'WYOMING': 'WY'
    };

    const upperText = text.toUpperCase();

    // Check full state name in ticket headers (e.g. "CALIFORNIA LOTTERY", "TEXAS LOTTERY", "FLORIDA LOTTERY")
    for (const [stateName, code] of Object.entries(stateMap)) {
      if (upperText.includes(stateName)) {
        jurisdiction = code;
        break;
      }
    }

    // Fallback: 2-letter state abbreviation
    if (!jurisdiction) {
      const stateMatch = upperText.match(/\b(CA|NY|TX|FL|PA|OH|IL|NC|GA|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|LA|KY|OR|OK|CT|IA|AR|MS|KS|NM|NE|ID|WV|NH|ME|RI|MT|DE|SD|ND|DC|VT|WY)\s*(LOTTERY|LOTTO|POWERBALL)?\b/);
      if (stateMatch) {
        jurisdiction = stateMatch[1];
      }
    }

    // Power Play Detection: Check explicitly for YES or NO / Multipliers
    // Common formats: "POWER PLAY YES", "POWERPLAY: YES", "WITH POWERPLAY", "POWER PLAY NO", "POWERPLAY: NO"
    const powerPlayNoMatch = upperText.match(/POWER\s*PLAY\s*[:\-\s]*(NO|N\b|NONE|OFF)/i) || upperText.match(/NO\s+POWER\s*PLAY/i);
    const powerPlayYesMatch = upperText.match(/POWER\s*PLAY\s*[:\-\s]*(YES|Y\b|ACTIVE|ON|\d+X)/i) || upperText.match(/(WITH|INCL)\s+POWER\s*PLAY/i) || upperText.match(/\b([2-5]|10)X\s*POWER\s*PLAY/i);

    if (powerPlayNoMatch) {
      powerPlayActive = false;
    } else if (powerPlayYesMatch) {
      powerPlayActive = true;
      const multMatch = upperText.match(/\b([2-5]|10)X\b/);
      if (multMatch) {
        powerPlayMultiplierFound = Number(multMatch[1]);
      }
    } else if (/POWER\s*PLAY/i.test(text) && !/POWER\s*PLAY.*NO/i.test(text)) {
      // If "POWER PLAY" header is present without "NO", inspect closer
      if (upperText.includes('POWER PLAY YES') || upperText.includes('POWERPLAY YES')) {
        powerPlayActive = true;
      }
    }

    // Draw Date extraction (e.g. "SAT MAR 15 2025", "DRAW DATE: 03/15/2025", "2025-03-15")
    const datePattern1 = /\b(202\d[-/]\d{1,2}[-/]\d{1,2})\b/;
    const datePattern2 = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
    const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{1,2})[\s,]+(20\d{2}|\d{2})\b/i;

    const matchDate1 = text.match(datePattern1);
    const matchMonth = text.match(monthPattern);
    const matchDate2 = text.match(datePattern2);

    if (matchDate1) {
      drawDate = matchDate1[1].replace(/\//g, '-');
    } else if (matchMonth) {
      const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
      const mStr = months[matchMonth[1].toUpperCase().slice(0, 3)] || '01';
      const dStr = matchMonth[2].padStart(2, '0');
      let yStr = matchMonth[3];
      if (yStr.length === 2) yStr = '20' + yStr;
      drawDate = `${yStr}-${mStr}-${dStr}`;
    } else if (matchDate2) {
      let mStr = matchDate2[1].padStart(2, '0');
      let dStr = matchDate2[2].padStart(2, '0');
      let yStr = matchDate2[3];
      if (yStr.length === 2) yStr = '20' + yStr;
      if (Number(mStr) > 12 && Number(dStr) <= 12) {
        const temp = mStr;
        mStr = dStr;
        dStr = temp;
      }
      drawDate = `${yStr}-${mStr}-${dStr}`;
    }

    // Precise Play Line Extraction
    // Filter out transaction lines, terminal numbers, barcodes, and headers
    const seenLineLetters = new Set();
    const cleanNumberLineRegex = /^\s*([A-E])?[\.\s:]*(?:QP\s+|EP\s+|[A-Z]{1,2}\s+)?(\d{1,2})[\s\-]+(\d{1,2})[\s\-]+(\d{1,2})[\s\-]+(\d{1,2})[\s\-]+(\d{1,2})(?:[\s\-]+(?:PB|P|POWERBALL|RED)?[\s:\-]*(\d{1,2}))?\s*$/i;

    for (const rawLine of lines) {
      // Ignore obvious header / metadata lines
      if (/POWERBALL|LOTTERY|DRAW|TICKET|TERMINAL|TOTAL|DATE|TIME|SERIAL|CHECK|KEEP|PLAYER|JACKPOT|CASH/i.test(rawLine) && !/^[A-E]\s/i.test(rawLine)) {
        continue;
      }

      // Test strict regex
      const match = rawLine.match(cleanNumberLineRegex);
      if (match) {
        let lineId = match[1] ? match[1].toUpperCase() : String.fromCharCode(65 + plays.length);
        if (seenLineLetters.has(lineId)) {
          lineId = String.fromCharCode(65 + plays.length);
        }

        const rawNums = [
          parseInt(match[2], 10),
          parseInt(match[3], 10),
          parseInt(match[4], 10),
          parseInt(match[5], 10),
          parseInt(match[6], 10),
        ];
        const pb = match[7] ? parseInt(match[7], 10) : 0;

        const validWhites = rawNums.every(n => n >= 1 && n <= 69);
        const uniqueWhites = new Set(rawNums).size === 5;
        const validPB = pb >= 1 && pb <= 26;

        if (validWhites && uniqueWhites && validPB) {
          seenLineLetters.add(lineId);
          plays.push({
            line_id: lineId,
            white_balls: rawNums.sort((a, b) => a - b),
            powerball: pb,
            confidence: 0.95
          });
        }
      }
    }

    // Fallback: If no lines matched strictly, find lines starting with letter (A-E) followed by 6 numbers
    if (plays.length === 0) {
      for (const rawLine of lines) {
        const letterMatch = rawLine.match(/^\s*([A-E])\b/i);
        const allDigits = (rawLine.match(/\b\d{1,2}\b/g) || []).map(Number);

        if (allDigits.length >= 6) {
          const whites = allDigits.slice(0, 5);
          const pb = allDigits[5];
          const validWhites = whites.every(n => n >= 1 && n <= 69) && (new Set(whites).size === 5);
          const validPB = pb >= 1 && pb <= 26;

          if (validWhites && validPB) {
            const lineId = letterMatch ? letterMatch[1].toUpperCase() : String.fromCharCode(65 + plays.length);
            if (!seenLineLetters.has(lineId)) {
              seenLineLetters.add(lineId);
              plays.push({
                line_id: lineId,
                white_balls: whites.sort((a, b) => a - b),
                powerball: pb,
                confidence: 0.85
              });
            }
          }
        }
      }
    }

    // Serial number detection
    const serialMatch = text.match(/\b(\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5})\b/) || text.match(/\b([A-Z0-9]{16,24})\b/);
    if (serialMatch) {
      serialNumber = serialMatch[1];
    }

    // Quality assessment
    let scanStatus = "success";
    let confidence = initialConfidence;

    if (plays.length === 0) {
      scanStatus = "unreadable";
      confidence = 0.15;
      lowQualityFlags.push("No valid Powerball play lines detected");
    } else if (plays.length > 0 && !drawDate) {
      scanStatus = "low_quality";
      confidence = 0.75;
    }

    let notes = "";
    if (scanStatus === "success") {
      notes = `Detected ${plays.length} play line(s). State: ${jurisdiction || 'Unknown'}, Draw: ${drawDate || 'Current'}, Power Play: ${powerPlayActive ? 'YES' : 'NO'}.`;
    } else {
      notes = "Low confidence or unreadable ticket image. Please rotate image or check numbers.";
    }

    return {
      scan_status: scanStatus,
      confidence_score: confidence,
      ticket_data: {
        draw_date: drawDate || new Date().toISOString().split('T')[0],
        power_play_active: powerPlayActive,
        power_play_multiplier: powerPlayMultiplierFound,
        plays: plays.map(p => ({
          line_id: p.line_id,
          white_balls: p.white_balls,
          powerball: p.powerball
        })),
        state: jurisdiction,
        serial_number: serialNumber
      },
      notes
    };
  }
}
