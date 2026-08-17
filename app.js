import { evaluatePowerballTicket, buildSchemaResponse } from './prize-evaluator.js';
import { PowerballOCREngine } from './ocr-engine.js';

// Sample Presets for instantaneous testing & verification
const SAMPLE_PRESETS = [
  {
    id: 'jackpot-winner',
    title: 'Jackpot Match 5 + PB',
    subtitle: 'Grand Prize winner ($750 Million jackpot example)',
    draw_date: '2026-08-15',
    power_play_active: true,
    state: 'CA',
    plays: [
      { line_id: 'A', white_balls: [11, 24, 38, 53, 67], powerball: 14 },
      { line_id: 'B', white_balls: [4, 18, 26, 42, 60], powerball: 9 }
    ],
    officialDraw: {
      draw_date: '2026-08-15',
      white_balls: [11, 24, 38, 53, 67],
      powerball: 14,
      power_play_multiplier: 3,
      jackpot_display: 'Grand Prize ($750M)'
    }
  },
  {
    id: 'powerplay-match5',
    title: '$2,000,000 Match 5 + Power Play',
    subtitle: '5 White balls with Power Play (fixed $2M payout)',
    draw_date: '2026-08-12',
    power_play_active: true,
    state: 'FL',
    plays: [
      { line_id: 'A', white_balls: [7, 15, 23, 44, 59], powerball: 22 },
      { line_id: 'B', white_balls: [12, 28, 33, 47, 61], powerball: 18 }
    ],
    officialDraw: {
      draw_date: '2026-08-12',
      white_balls: [7, 15, 23, 44, 59],
      powerball: 5,
      power_play_multiplier: 4
    }
  },
  {
    id: 'multi-match-ticket',
    title: 'Multi-Line Mixed Matches',
    subtitle: 'Match 4+PB ($150,000 with 3X) and Match 3 ($21 with 3X)',
    draw_date: '2026-08-08',
    power_play_active: true,
    state: 'NY',
    plays: [
      { line_id: 'A', white_balls: [10, 19, 26, 40, 68], powerball: 12 }, // Match 4 + PB
      { line_id: 'B', white_balls: [10, 19, 26, 50, 55], powerball: 20 }, // Match 3
      { line_id: 'C', white_balls: [2, 14, 31, 48, 62], powerball: 7 }    // No prize
    ],
    officialDraw: {
      draw_date: '2026-08-08',
      white_balls: [10, 19, 26, 40, 52],
      powerball: 12,
      power_play_multiplier: 3
    }
  },
  {
    id: 'standard-no-match',
    title: 'Standard Unmatched Ticket',
    subtitle: 'Non-winning ticket for negative test verification',
    draw_date: '2026-08-05',
    power_play_active: false,
    state: 'TX',
    plays: [
      { line_id: 'A', white_balls: [3, 16, 29, 41, 58], powerball: 8 },
      { line_id: 'B', white_balls: [9, 22, 37, 49, 64], powerball: 15 }
    ],
    officialDraw: {
      draw_date: '2026-08-05',
      white_balls: [14, 21, 35, 48, 67],
      powerball: 24,
      power_play_multiplier: 2
    }
  }
];

class PowerballScannerApp {
  constructor() {
    this.ocrEngine = new PowerballOCREngine();
    this.currentTicket = {
      draw_date: new Date().toISOString().split('T')[0],
      power_play_active: false,
      state: '',
      plays: []
    };
    this.currentEvaluation = null;
    this.confidenceScore = 1.0;
    this.scanStatus = 'success';
    this.scanNotes = '';
    this.cameraStream = null;

    this.initElements();
    this.initEvents();
    this.loadInitialData();
  }

  initElements() {
    // Buttons & Navigation
    this.tabUpload = document.getElementById('tab-upload');
    this.tabCamera = document.getElementById('tab-camera');
    this.uploadZone = document.getElementById('upload-zone');
    this.cameraZone = document.getElementById('camera-zone');
    this.fileInput = document.getElementById('ticket-file-input');

    // Camera elements
    this.cameraVideo = document.getElementById('camera-video');
    this.btnCaptureCamera = document.getElementById('btn-capture-camera');
    this.btnStopCamera = document.getElementById('btn-stop-camera');
    this.btnSwitchCamera = document.getElementById('btn-switch-camera');

    // Preview
    this.imagePreviewCard = document.getElementById('image-preview-card');
    this.previewImage = document.getElementById('preview-image');
    this.preprocessedCanvas = document.getElementById('preprocessed-canvas');
    this.togglePreprocess = document.getElementById('toggle-preprocess-view');
    this.btnClearImage = document.getElementById('btn-clear-image');

    // Progress
    this.ocrProgressContainer = document.getElementById('ocr-progress-container');
    this.ocrProgressBar = document.getElementById('ocr-progress-bar');
    this.ocrStatusText = document.getElementById('ocr-status-text');
    this.ocrPercentage = document.getElementById('ocr-percentage');

    // Ticket Data Inputs
    this.metaDrawDate = document.getElementById('meta-draw-date');
    this.metaPowerPlay = document.getElementById('meta-power-play');
    this.metaState = document.getElementById('meta-state');
    this.playsContainer = document.getElementById('ticket-plays-container');
    this.scanStatusBadge = document.getElementById('scan-status-badge');
    this.btnAddPlay = document.getElementById('btn-add-play');
    this.btnReEvaluate = document.getElementById('btn-re-evaluate');

    // Official Draw Inputs
    this.drawDateDisplay = document.getElementById('draw-date-display');
    this.drawMultiplierSelect = document.getElementById('draw-multiplier-select');
    this.drawW1 = document.getElementById('draw-w1');
    this.drawW2 = document.getElementById('draw-w2');
    this.drawW3 = document.getElementById('draw-w3');
    this.drawW4 = document.getElementById('draw-w4');
    this.drawW5 = document.getElementById('draw-w5');
    this.drawPB = document.getElementById('draw-pb');

    // Results Dashboard
    this.payoutBanner = document.getElementById('payout-banner');
    this.totalPayoutDisplay = document.getElementById('total-payout-display');
    this.winningStatusChip = document.getElementById('winning-status-chip');
    this.winningStatusText = document.getElementById('winning-status-text');
    this.resultsBreakdownContainer = document.getElementById('results-breakdown-container');

    // Modals
    this.jsonModal = document.getElementById('json-modal');
    this.btnViewJson = document.getElementById('btn-view-json-schema');
    this.btnCloseJson = document.getElementById('btn-close-json');
    this.btnCopyJson = document.getElementById('btn-copy-json');
    this.btnDownloadJson = document.getElementById('btn-download-json');
    this.jsonOutputText = document.getElementById('json-output-text');
    this.copyBtnText = document.getElementById('copy-btn-text');

    // Presets Modal
    this.presetsModal = document.getElementById('presets-modal');
    this.btnSampleTickets = document.getElementById('btn-sample-tickets');
    this.btnDrawPresets = document.getElementById('btn-draw-presets');
    this.btnClosePresets = document.getElementById('btn-close-presets');
    this.presetsGrid = document.getElementById('presets-grid-container');
  }

  initEvents() {
    // Tab Switching
    this.tabUpload.addEventListener('click', () => this.switchMode('upload'));
    this.tabCamera.addEventListener('click', () => this.switchMode('camera'));

    // Drag & drop file upload
    this.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadZone.classList.add('drag-over');
    });
    this.uploadZone.addEventListener('dragleave', () => this.uploadZone.classList.remove('drag-over'));
    this.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    // Camera Controls
    this.btnCaptureCamera.addEventListener('click', () => this.captureFromCamera());
    this.btnStopCamera.addEventListener('click', () => this.stopCamera());

    // Image preview toggle
    this.togglePreprocess.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.previewImage.style.display = 'none';
        this.preprocessedCanvas.style.display = 'block';
      } else {
        this.previewImage.style.display = 'block';
        this.preprocessedCanvas.style.display = 'none';
      }
    });
    this.btnClearImage.addEventListener('click', () => this.clearImage());

    // Ticket Metadata & Plays
    this.metaDrawDate.addEventListener('change', (e) => {
      this.currentTicket.draw_date = e.target.value;
      this.drawDateDisplay.textContent = e.target.value;
      this.evaluate();
    });
    this.metaPowerPlay.addEventListener('change', (e) => {
      this.currentTicket.power_play_active = (e.target.value === 'true');
      this.evaluate();
    });
    this.metaState.addEventListener('input', (e) => {
      this.currentTicket.state = e.target.value.toUpperCase();
    });

    this.btnAddPlay.addEventListener('click', () => this.addBlankPlayLine());
    this.btnReEvaluate.addEventListener('click', () => this.evaluate());

    // Official Draw Inputs trigger live evaluation
    [this.drawW1, this.drawW2, this.drawW3, this.drawW4, this.drawW5, this.drawPB, this.drawMultiplierSelect].forEach(elem => {
      elem.addEventListener('input', () => this.evaluate());
    });

    // Modals
    this.btnViewJson.addEventListener('click', () => this.openJsonModal());
    this.btnCloseJson.addEventListener('click', () => this.jsonModal.style.display = 'none');
    this.btnCopyJson.addEventListener('click', () => this.copyJson());
    this.btnDownloadJson.addEventListener('click', () => this.downloadJson());

    this.btnSampleTickets.addEventListener('click', () => this.openPresetsModal());
    this.btnDrawPresets.addEventListener('click', () => this.openPresetsModal());
    this.btnClosePresets.addEventListener('click', () => this.presetsModal.style.display = 'none');
  }

  loadInitialData() {
    this.metaDrawDate.value = this.currentTicket.draw_date;
    this.drawDateDisplay.textContent = this.currentTicket.draw_date;
    this.renderPresetsList();

    // Load default sample preset on startup
    this.loadPreset(SAMPLE_PRESETS[0]);
  }

  switchMode(mode) {
    if (mode === 'upload') {
      this.tabUpload.classList.add('active');
      this.tabCamera.classList.remove('active');
      this.uploadZone.style.display = 'block';
      this.cameraZone.style.display = 'none';
      this.stopCamera();
    } else {
      this.tabCamera.classList.add('active');
      this.tabUpload.classList.remove('active');
      this.uploadZone.style.display = 'none';
      this.cameraZone.style.display = 'flex';
      this.startCamera();
    }
  }

  async startCamera() {
    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.cameraVideo.srcObject = this.cameraStream;
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Could not access device camera. Please check camera permissions or use upload.');
      this.switchMode('upload');
    }
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }
  }

  captureFromCamera() {
    if (!this.cameraVideo.videoWidth) return;

    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = this.cameraVideo.videoWidth;
    snapCanvas.height = this.cameraVideo.videoHeight;
    const ctx = snapCanvas.getContext('2d');
    ctx.drawImage(this.cameraVideo, 0, 0);

    const dataUrl = snapCanvas.toDataURL('image/png');
    this.previewImage.src = dataUrl;
    this.imagePreviewCard.style.display = 'block';

    // Switch back to preview & process
    this.stopCamera();
    this.switchMode('upload');
    this.processImageElement(this.previewImage);
  }

  handleFileUpload(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewImage.src = e.target.result;
      this.imagePreviewCard.style.display = 'block';
      this.previewImage.onload = () => {
        this.processImageElement(this.previewImage);
      };
    };
    reader.readAsDataURL(file);
  }

  async processImageElement(imgElement) {
    this.ocrProgressContainer.style.display = 'block';
    this.ocrProgressBar.style.width = '10%';
    this.ocrPercentage.textContent = '10%';
    this.ocrStatusText.textContent = 'Enhancing ticket image...';

    try {
      // Preprocess image and render to preprocessed canvas
      const procCanvas = this.ocrEngine.preprocessImage(imgElement);
      this.preprocessedCanvas.width = procCanvas.width;
      this.preprocessedCanvas.height = procCanvas.height;
      const pCtx = this.preprocessedCanvas.getContext('2d');
      pCtx.drawImage(procCanvas, 0, 0);

      const result = await this.ocrEngine.processTicketImage(imgElement, (progressInfo) => {
        const pct = Math.round((progressInfo.progress || 0) * 100);
        this.ocrProgressBar.style.width = `${pct}%`;
        this.ocrPercentage.textContent = `${pct}%`;
        this.ocrStatusText.textContent = progressInfo.status;
      });

      this.ocrProgressBar.style.width = '100%';
      this.ocrPercentage.textContent = '100%';
      this.ocrStatusText.textContent = 'Extraction complete';

      setTimeout(() => {
        this.ocrProgressContainer.style.display = 'none';
      }, 1000);

      // Populate current ticket data
      this.currentTicket = {
        draw_date: result.ticket_data.draw_date || this.currentTicket.draw_date,
        power_play_active: result.ticket_data.power_play_active,
        state: result.ticket_data.state || '',
        plays: result.ticket_data.plays.length > 0 ? result.ticket_data.plays : this.currentTicket.plays
      };

      this.scanStatus = result.scan_status;
      this.confidenceScore = result.confidence_score;
      this.scanNotes = result.notes;

      // Update UI
      this.updateStatusBadge(this.scanStatus, this.confidenceScore);
      this.populateFormFields();
      this.renderPlaysList();
      this.evaluate();

    } catch (err) {
      console.error('OCR Processing failed:', err);
      this.ocrProgressContainer.style.display = 'none';
      this.scanStatus = 'unreadable';
      this.confidenceScore = 0.0;
      this.scanNotes = 'OCR engine failed to parse ticket image. Please enter numbers manually.';
      this.updateStatusBadge('unreadable', 0.0);
    }
  }

  updateStatusBadge(status, confidence) {
    this.scanStatusBadge.className = 'status-badge';
    if (status === 'success') {
      this.scanStatusBadge.classList.add('status-success');
      this.scanStatusBadge.textContent = `Success (${Math.round(confidence * 100)}%)`;
    } else if (status === 'low_quality') {
      this.scanStatusBadge.classList.add('status-low-quality');
      this.scanStatusBadge.textContent = `Low Quality (${Math.round(confidence * 100)}%)`;
    } else {
      this.scanStatusBadge.classList.add('status-unreadable');
      this.scanStatusBadge.textContent = `Unreadable (${Math.round(confidence * 100)}%)`;
    }
  }

  clearImage() {
    this.previewImage.src = '';
    this.imagePreviewCard.style.display = 'none';
    this.fileInput.value = '';
    this.scanStatusBadge.className = 'status-badge';
    this.scanStatusBadge.textContent = 'No Scan Yet';
  }

  populateFormFields() {
    this.metaDrawDate.value = this.currentTicket.draw_date;
    this.drawDateDisplay.textContent = this.currentTicket.draw_date;
    this.metaPowerPlay.value = this.currentTicket.power_play_active ? 'true' : 'false';
    this.metaState.value = this.currentTicket.state || '';
  }

  renderPlaysList() {
    this.playsContainer.innerHTML = '';

    if (!this.currentTicket.plays || this.currentTicket.plays.length === 0) {
      this.playsContainer.innerHTML = `
        <div class="empty-placeholder">
          <p>No play lines. Click "+ Add Play Line" or scan a ticket.</p>
        </div>
      `;
      return;
    }

    this.currentTicket.plays.forEach((play, index) => {
      const card = document.createElement('div');
      card.className = 'play-row-card';

      const whites = play.white_balls || [0, 0, 0, 0, 0];
      const pb = play.powerball || 0;

      card.innerHTML = `
        <div class="line-badge">${play.line_id || String.fromCharCode(65 + index)}</div>
        <div class="balls-edit-group">
          <input type="number" class="ball-input white-ball" data-play="${index}" data-pos="0" min="1" max="69" value="${whites[0] || ''}" />
          <input type="number" class="ball-input white-ball" data-play="${index}" data-pos="1" min="1" max="69" value="${whites[1] || ''}" />
          <input type="number" class="ball-input white-ball" data-play="${index}" data-pos="2" min="1" max="69" value="${whites[2] || ''}" />
          <input type="number" class="ball-input white-ball" data-play="${index}" data-pos="3" min="1" max="69" value="${whites[3] || ''}" />
          <input type="number" class="ball-input white-ball" data-play="${index}" data-pos="4" min="1" max="69" value="${whites[4] || ''}" />
          <input type="number" class="ball-input red-ball" data-play="${index}" data-pos="pb" min="1" max="26" value="${pb || ''}" />
        </div>
        <button class="btn-remove-line" data-play="${index}" title="Remove line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      `;

      this.playsContainer.appendChild(card);
    });

    // Attach listeners to input fields
    this.playsContainer.querySelectorAll('.ball-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const playIdx = Number(e.target.dataset.play);
        const pos = e.target.dataset.pos;
        const val = Number(e.target.value) || 0;

        if (pos === 'pb') {
          this.currentTicket.plays[playIdx].powerball = val;
        } else {
          this.currentTicket.plays[playIdx].white_balls[Number(pos)] = val;
        }
        this.evaluate();
      });
    });

    this.playsContainer.querySelectorAll('.btn-remove-line').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const playIdx = Number(btn.dataset.play);
        this.currentTicket.plays.splice(playIdx, 1);
        this.renderPlaysList();
        this.evaluate();
      });
    });
  }

  addBlankPlayLine() {
    const nextLineLetter = String.fromCharCode(65 + (this.currentTicket.plays?.length || 0));
    this.currentTicket.plays.push({
      line_id: nextLineLetter,
      white_balls: [0, 0, 0, 0, 0],
      powerball: 0
    });
    this.renderPlaysList();
    this.evaluate();
  }

  getOfficialDraw() {
    return {
      draw_date: this.metaDrawDate.value,
      white_balls: [
        Number(this.drawW1.value) || 0,
        Number(this.drawW2.value) || 0,
        Number(this.drawW3.value) || 0,
        Number(this.drawW4.value) || 0,
        Number(this.drawW5.value) || 0
      ],
      powerball: Number(this.drawPB.value) || 0,
      power_play_multiplier: Number(this.drawMultiplierSelect.value) || 1,
      jackpot_display: "Grand Prize (Jackpot)"
    };
  }

  evaluate() {
    const officialDraw = this.getOfficialDraw();
    this.currentEvaluation = evaluatePowerballTicket(this.currentTicket, officialDraw);

    // Update Banner
    this.totalPayoutDisplay.textContent = this.currentEvaluation.total_payout;
    if (this.currentEvaluation.is_winner) {
      this.payoutBanner.classList.add('is-winner-banner');
      this.winningStatusText.textContent = this.currentEvaluation.jackpot_won ? 'JACKPOT WINNER!' : 'WINNER!';
    } else {
      this.payoutBanner.classList.remove('is-winner-banner');
      this.winningStatusText.textContent = 'NO WINNER';
    }

    // Render detailed results list
    this.renderResultsList(officialDraw);
  }

  renderResultsList(officialDraw) {
    this.resultsBreakdownContainer.innerHTML = '';

    if (!this.currentEvaluation || this.currentEvaluation.lines.length === 0) {
      this.resultsBreakdownContainer.innerHTML = `
        <div class="empty-placeholder">
          <p>No play lines evaluated yet.</p>
        </div>
      `;
      return;
    }

    const officialWhitesSet = new Set(officialDraw.white_balls.map(Number));
    const officialPB = Number(officialDraw.powerball);

    this.currentEvaluation.lines.forEach((lineRes, idx) => {
      const play = this.currentTicket.plays[idx];
      const row = document.createElement('div');
      row.className = `result-row ${lineRes.is_winner ? 'row-winner' : ''}`;

      const whiteBallsHtml = (play?.white_balls || []).map(w => {
        const isMatched = officialWhitesSet.has(Number(w));
        return `<div class="match-ball-pill ${isMatched ? 'matched-white' : ''}">${w || '-'}</div>`;
      }).join('');

      const isPBMatch = Number(play?.powerball) === officialPB;
      const pbBallHtml = `<div class="match-ball-pill ${isPBMatch ? 'matched-pb' : ''}">${play?.powerball || '-'}</div>`;

      row.innerHTML = `
        <div class="result-left">
          <div class="result-line-id">Line ${lineRes.line_id}</div>
          <div class="matched-balls-display">
            ${whiteBallsHtml}
            ${pbBallHtml}
          </div>
        </div>
        <div class="result-right">
          <span class="result-tier-name">${lineRes.prize_tier}</span>
          <span class="result-payout-text">${lineRes.estimated_payout}</span>
        </div>
      `;

      this.resultsBreakdownContainer.appendChild(row);
    });
  }

  getStrictJsonSchema() {
    return buildSchemaResponse(
      this.scanStatus,
      this.confidenceScore,
      this.currentTicket,
      this.currentEvaluation,
      this.scanNotes
    );
  }

  openJsonModal() {
    this.evaluate();
    const jsonObj = this.getStrictJsonSchema();
    this.jsonOutputText.textContent = JSON.stringify(jsonObj, null, 2);
    this.jsonModal.style.display = 'flex';
  }

  copyJson() {
    const jsonText = this.jsonOutputText.textContent;
    navigator.clipboard.writeText(jsonText).then(() => {
      this.copyBtnText.textContent = 'Copied!';
      setTimeout(() => {
        this.copyBtnText.textContent = 'Copy JSON';
      }, 2000);
    });
  }

  downloadJson() {
    const jsonText = this.jsonOutputText.textContent;
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `powerball-scan-${this.currentTicket.draw_date || 'result'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  renderPresetsList() {
    this.presetsGrid.innerHTML = '';
    SAMPLE_PRESETS.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'preset-item-card';
      card.innerHTML = `
        <div class="preset-item-title">
          <span>${preset.title}</span>
          <span class="preset-prize-tag">Demo</span>
        </div>
        <p class="preset-desc">${preset.subtitle}</p>
      `;
      card.addEventListener('click', () => {
        this.loadPreset(preset);
        this.presetsModal.style.display = 'none';
      });
      this.presetsGrid.appendChild(card);
    });
  }

  openPresetsModal() {
    this.presetsModal.style.display = 'flex';
  }

  loadPreset(preset) {
    this.currentTicket = JSON.parse(JSON.stringify({
      draw_date: preset.draw_date,
      power_play_active: preset.power_play_active,
      state: preset.state,
      plays: preset.plays
    }));

    // Set official draw numbers
    if (preset.officialDraw) {
      this.drawW1.value = preset.officialDraw.white_balls[0];
      this.drawW2.value = preset.officialDraw.white_balls[1];
      this.drawW3.value = preset.officialDraw.white_balls[2];
      this.drawW4.value = preset.officialDraw.white_balls[3];
      this.drawW5.value = preset.officialDraw.white_balls[4];
      this.drawPB.value = preset.officialDraw.powerball;
      this.drawMultiplierSelect.value = String(preset.officialDraw.power_play_multiplier || 3);
    }

    this.scanStatus = 'success';
    this.confidenceScore = 0.99;
    this.scanNotes = `Loaded preset: ${preset.title}`;
    this.updateStatusBadge('success', 0.99);

    this.populateFormFields();
    this.renderPlaysList();
    this.evaluate();
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.powerballApp = new PowerballScannerApp();
});
