/**
 * Powerball OCR & Image Processing Engine
 * Features:
 * - HTML5 Canvas image enhancement (contrast, binarization, grayscale, noise reduction)
 * - Tesseract.js OCR integration with progress tracking
 * - Robust Powerball text parser (Line identification, White Ball validation 1-69, Powerball validation 1-26)
 * - Power Play multiplier detection
 * - Quality score & confidence calculation
 */

export class PowerballOCREngine {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
  }

  async initWorker(onProgress = () => {}) {
    if (this.worker) return this.worker;
    if (window.Tesseract) {
      onProgress({ status: 'initializing', progress: 0.2 });
      this.worker = await window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onProgress({ status: 'recognizing', progress: m.progress });
          }
        }
      });
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/:.-* ',
      });
      return this.worker;
    } else {
      throw new Error("Tesseract.js library not loaded in window.");
    }
  }

  /**
   * Pre-process image on a Canvas for high-contrast thermal receipt OCR
   */
  preprocessImage(imageElement, options = { contrast: 1.4, threshold: 140, deskew: 0 }) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Scale to max width 1600 for performance and optimal OCR DPI
    let width = imageElement.naturalWidth || imageElement.width || 800;
    let height = imageElement.naturalHeight || imageElement.height || 600;

    const maxDim = 1800;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    canvas.width = width;
    canvas.height = height;

    // Draw base image
    ctx.drawImage(imageElement, 0, 0, width, height);

    // Get pixel data
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const contrastFactor = (259 * (options.contrast * 100 + 255)) / (255 * (259 - options.contrast * 100));

    // Grayscale, high-contrast & adaptive binarization
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Luminance
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply contrast
      gray = contrastFactor * (gray - 128) + 128;

      // Thresholding (adaptive black & white)
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
   * Run OCR on preprocessed canvas or raw image
   */
  async processTicketImage(imageElement, onProgress = () => {}) {
    const preprocessedCanvas = this.preprocessImage(imageElement);
    
    // Initialize tesseract
    await this.initWorker(onProgress);

    onProgress({ status: 'recognizing text...', progress: 0.4 });
    const result = await this.worker.recognize(preprocessedCanvas);
    const rawText = result.data.text || '';
    const ocrConfidence = (result.data.confidence || 75) / 100;

    // Parse the extracted text
    const parsedData = this.parsePowerballText(rawText, ocrConfidence);

    return {
      rawText,
      preprocessedCanvas,
      ocrConfidence,
      ...parsedData
    };
  }

  /**
   * Parse extracted raw text into structured Powerball ticket format
   */
  parsePowerballText(text, initialConfidence = 0.85) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    
    const plays = [];
    let drawDate = null;
    let powerPlayActive = false;
    let powerPlayMultiplierFound = null;
    let serialNumber = null;
    let purchaseDate = null;
    let jurisdiction = null;
    let lowQualityFlags = [];

    // State / Jurisdiction detection
    const stateMatches = text.match(/\b(CA|NY|TX|FL|PA|OH|IL|NC|GA|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|RI|MT|DE|SD|ND|AK|DC|VT|WY)\b/i);
    if (stateMatches) {
      jurisdiction = stateMatches[1].toUpperCase();
    }

    // Power Play Detection
    if (/POWER\s*PLAY\s*(YES|Y|ACTIVE|WITH|\d+X)/i.test(text) || /\b(2X|3X|4X|5X|10X)\b/i.test(text) || /POWERPLAY\s*:\s*YES/i.test(text)) {
      powerPlayActive = true;
      const multMatch = text.match(/\b([2-5]|10)X\b/i);
      if (multMatch) {
        powerPlayMultiplierFound = Number(multMatch[1]);
      }
    }

    // Draw Date regex variations: e.g. "SAT MAR 15 25", "03/15/2025", "2025-03-15", "DRAW DATE 03/15/25"
    const datePattern1 = /\b(202\d[-/]\d{1,2}[-/]\d{1,2})\b/; // 2025-03-15 or 2025/03/15
    const datePattern2 = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/; // 03/15/2025 or 03/15/25
    const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*\s+(\d{1,2})[\s,]+(20\d{2}|\d{2})\b/i;

    const matchDate1 = text.match(datePattern1);
    const matchMonth = text.match(monthPattern);
    const matchDate2 = text.match(datePattern2);

    if (matchDate1) {
      drawDate = matchDate1[1].replace(/\//g, '-');
    } else if (matchMonth) {
      const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const mStr = months[matchMonth[1].toLowerCase().slice(0, 3)] || '01';
      const dStr = matchMonth[2].padStart(2, '0');
      let yStr = matchMonth[3];
      if (yStr.length === 2) yStr = '20' + yStr;
      drawDate = `${yStr}-${mStr}-${dStr}`;
    } else if (matchDate2) {
      let mStr = matchDate2[1].padStart(2, '0');
      let dStr = matchDate2[2].padStart(2, '0');
      let yStr = matchDate2[3];
      if (yStr.length === 2) yStr = '20' + yStr;
      // Heuristic: If first number > 12, it might be DD/MM/YYYY
      if (Number(mStr) > 12 && Number(dStr) <= 12) {
        const temp = mStr;
        mStr = dStr;
        dStr = temp;
      }
      drawDate = `${yStr}-${mStr}-${dStr}`;
    }

    // Line detection (A, B, C, D, E, etc.)
    // Examples:
    // A. 05 12 28 45 61 PB 14
    // A 05  12  28  45  61  14
    // A  05 12 28 45 61  PB: 14 [QP]
    // 05 12 28 45 61 14
    const lineRegex = /(?:([A-Z])[\.\s:]+)?(?:QP\s+|EP\s+)?(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})(?:\s+(?:PB|P|POWERBALL|POWER|RED)?\s*[:\s]*(\d{1,2}))/i;

    let lineLetterCode = 65; // 'A'
    for (const rawLine of lines) {
      // Find digit sequences
      const match = rawLine.match(lineRegex);
      if (match) {
        let lineId = match[1] ? match[1].toUpperCase() : String.fromCharCode(lineLetterCode);
        const nums = [
          parseInt(match[2], 10),
          parseInt(match[3], 10),
          parseInt(match[4], 10),
          parseInt(match[5], 10),
          parseInt(match[6], 10),
        ];
        const pb = parseInt(match[7], 10);

        // Validation of numbers range
        const validWhites = nums.every(n => n >= 1 && n <= 69);
        const uniqueWhites = new Set(nums).size === 5;
        const validPB = pb >= 1 && pb <= 26;

        if (validWhites && uniqueWhites && validPB) {
          plays.push({
            line_id: lineId,
            white_balls: nums.sort((a, b) => a - b),
            powerball: pb,
            confidence: 0.95
          });
          lineLetterCode++;
        } else {
          // If range is slightly off or duplicate, still capture but note warning
          plays.push({
            line_id: lineId,
            white_balls: nums,
            powerball: pb || 0,
            confidence: 0.6,
            warning: 'Number outside standard range (1-69 for white, 1-26 for PB)'
          });
          lowQualityFlags.push(`Line ${lineId} contains numbers outside official ranges`);
          lineLetterCode++;
        }
      }
    }

    // Fallback: If lineRegex missed some lines, look for rows containing 6 distinct 1-2 digit numbers
    if (plays.length === 0) {
      for (const rawLine of lines) {
        const numbersFound = (rawLine.match(/\b\d{1,2}\b/g) || []).map(Number);
        if (numbersFound.length >= 6) {
          const whites = numbersFound.slice(0, 5).filter(n => n >= 1 && n <= 69);
          const pb = numbersFound[5];
          if (whites.length === 5 && pb >= 1 && pb <= 26) {
            const lineId = String.fromCharCode(lineLetterCode++);
            plays.push({
              line_id: lineId,
              white_balls: whites.sort((a, b) => a - b),
              powerball: pb,
              confidence: 0.8
            });
          }
        }
      }
    }

    // Serial number detection
    const serialMatch = text.match(/\b(\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5}[-\s]\d{4,5})\b/) || text.match(/\b([A-Z0-9]{16,24})\b/);
    if (serialMatch) {
      serialNumber = serialMatch[1];
    }

    // Determine Scan Status & Final Confidence
    let scanStatus = "success";
    let confidence = initialConfidence;

    if (plays.length === 0) {
      scanStatus = "unreadable";
      confidence = 0.15;
      lowQualityFlags.push("No valid Powerball play lines detected");
    } else {
      const anyInvalidPlay = plays.some(p => p.confidence < 0.8 || p.warning);
      if (anyInvalidPlay || !drawDate || plays.length === 0) {
        scanStatus = "low_quality";
        confidence = Math.min(confidence, 0.65);
      } else {
        confidence = Math.min(confidence, 0.98);
      }
    }

    let notes = "";
    if (scanStatus === "success") {
      notes = `Successfully extracted ${plays.length} play line(s). Draw Date: ${drawDate || 'Current'}. Power Play: ${powerPlayActive ? 'Yes' : 'No'}.`;
    } else if (scanStatus === "low_quality") {
      notes = `Extracted with uncertainty. ${lowQualityFlags.join("; ")}. Please verify extracted numbers.`;
    } else {
      notes = "Unable to reliably read lottery ticket. Please adjust lighting, avoid glare, or enter manually.";
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
