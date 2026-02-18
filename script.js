/**
 * THE PIGEON - Final Pro Audio Version
 * Features:
 * - Granular Bristle Brush (Noise + LFO + Stereo)
 * - Zero-Latency Chords
 * - Preserved Visual Styles
 * - Volume Sliders & Mixing
 */

// --- KONFIGURATION ---
const chordIntervals = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

// 1. Noise Buffer (für Bristle Textur)
let noiseBuffer = null;
function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  // 5 Sekunden Rauschen reichen für den Loop
  const bufferSize = ctx.sampleRate * 5; 
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Pink Noise Annäherung (klingt natürlicher als White Noise)
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5; // Gain Ausgleich
  }
  noiseBuffer = buffer;
  return buffer;
}
let lastOut = 0;

// 2. Distortion Curve (für Fractal Crunch)
let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050;
  const curve = new Float32Array(n);
  const amount = 80; // Moderate Verzerrung
  for (let i = 0; i < n; ++i) {
    let x = i * 2 / n - 1;
    curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  cachedDistortionCurve = curve;
  return curve;
}

document.addEventListener("DOMContentLoaded", function() {
  const chordElem = document.getElementById("chordSelect");
  let currentChord = chordElem ? chordElem.value : "major";

  let isPlaying = false;
  let audioCtx;
  let masterGain;
  let playbackStartTime;
  let playbackDuration;
  let loopEnabled = document.getElementById("loopCheckbox").checked;
  let animationFrameId;
  let undoStack = [];
  let redoStack = [];

  // Live Synth Speicher
  let liveNodes = []; 
  let liveGainNode = null;

  let currentTool = document.getElementById("toolSelect").value;
  let currentBrush = document.getElementById("brushSelect").value;
  let currentBrushSize = parseInt(document.getElementById("brushSizeSlider").value, 10);

  // --- UI Listener ---
  document.getElementById("toolSelect").addEventListener("change", e => currentTool = e.target.value);
  document.getElementById("brushSelect").addEventListener("change", e => currentBrush = e.target.value);
  document.getElementById("brushSizeSlider").addEventListener("input", e => currentBrushSize = parseInt(e.target.value, 10));
  document.getElementById("bpmInput").addEventListener("change", e => { if (isPlaying) document.getElementById("stopButton").click(); });
  document.getElementById("loopCheckbox").addEventListener("change", e => loopEnabled = e.target.checked);
  
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");
  const scaleSelectContainer = document.getElementById("scaleSelectContainer");
  harmonizeCheckbox.addEventListener("change", () => {
    scaleSelectContainer.style.display = harmonizeCheckbox.checked ? "inline" : "none";
  });
  if(chordElem) chordElem.addEventListener("change", e => currentChord = e.target.value);

  // --- Audio Engine Setup ---
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    // Master Compressor (Limiter)
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 12;
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  // --- Tracks Setup ---
  const tracks = [
    { canvas: document.getElementById("canvas1"), segments: [], waveType: "sine", muted: false, snap: false, vol: 0.8, gainNode: null },
    { canvas: document.getElementById("canvas2"), segments: [], waveType: "sine", muted: false, snap: false, vol: 0.8, gainNode: null },
    { canvas: document.getElementById("canvas3"), segments: [], waveType: "sine", muted: false, snap: false, vol: 0.8, gainNode: null },
    { canvas: document.getElementById("canvas4"), segments: [], waveType: "sine", muted: false, snap: false, vol: 0.8, gainNode: null }
  ];
  tracks.forEach((track, idx) => { track.index = idx; });

  // Init UI Elements pro Track
  document.querySelectorAll(".track-container").forEach((container, idx) => {
    const track = tracks[idx];
    track.ctx = track.canvas.getContext("2d");
    
    drawGrid(track);
    container.querySelector(".legend").innerHTML = generateLegend(track.canvas.height);

    // Wave Buttons
    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.waveType = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    const defBtn = container.querySelector('.wave-btn[data-wave="sine"]');
    if(defBtn) defBtn.classList.add("active");

    // Mute
    const muteButton = container.querySelector(".mute-btn");
    muteButton.addEventListener("click", () => {
      track.muted = !track.muted;
      muteButton.style.backgroundColor = track.muted ? "#ddd" : "";
      muteButton.style.border = track.muted ? "2px solid #333" : "";
      updateTrackVolume(track);
    });

    // Volume Slider
    const volSlider = container.querySelector(".volume-slider");
    if(volSlider) {
        track.vol = parseFloat(volSlider.value);
        volSlider.addEventListener("input", (e) => {
            track.vol = parseFloat(e.target.value);
            updateTrackVolume(track);
        });
    }

    const snapCheckbox = container.querySelector(".snap-checkbox");
    snapCheckbox.addEventListener("change", e => track.snap = e.target.checked);

    // --- Drawing Interaction ---
    let drawing = false;

    const startDraw = (e) => {
      e.preventDefault();
      if (!audioCtx) initAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let snapX = track.snap ? snapCoordinate(x, track.canvas.width) : x;

      if (currentTool === "draw") {
        drawing = true;
        
        let jX=0, jY=0;
        if(currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }

        track.currentSegment = {
          points: [{ x: snapX, y, jX, jY }],
          thickness: currentBrushSize,
          brush: currentBrush,
          chordType: (currentBrush === "chord") ? currentChord : null
        };
        track.segments.push(track.currentSegment);
        startLiveSynth(track, y);
        redrawTrack(track, null);
      } else {
        eraseAt(track, x, y);
      }
    };

    const moveDraw = (e) => {
      if (!drawing && currentTool !== "erase") return;
      e.preventDefault();
      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let snapX = track.snap ? snapCoordinate(x, track.canvas.width) : x;

      if (currentTool === "draw" && drawing) {
        let jX=0, jY=0;
        if(currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }
        
        track.currentSegment.points.push({ x: snapX, y, jX, jY });
        updateLiveSynth(track, y + jY);
        
        // Optimiertes Live-Drawing (nur letzte Punkte)
        const seg = track.currentSegment;
        if (seg.brush !== "chord") {
           const i = seg.points.length - 1;
           const tempSeg = { points: seg.points, thickness: currentBrushSize, brush: currentBrush };
           // Visuelle Logik bewahren!
           switch(seg.brush) {
             case "variable": drawSegmentVariable(track.ctx, tempSeg, i-1, i, currentBrushSize); break;
             case "calligraphy": drawSegmentCalligraphy(track.ctx, tempSeg, i-1, i, currentBrushSize); break;
             case "bristle": drawSegmentBristle(track.ctx, tempSeg, i-1, i, currentBrushSize); break;
             case "fractal": drawSegmentFractal(track.ctx, seg, i-1, i, currentBrushSize); break;
             default: drawSegmentStandard(track.ctx, tempSeg, i-1, i, currentBrushSize);
           }
        } else {
           redrawTrack(track, null);
        }
      } else if (currentTool === "erase") {
        if(e.buttons === 1 || e.type === "touchmove") eraseAt(track, x, y);
      }
    };

    const endDraw = () => {
      if (drawing) {
        undoStack.push({ trackIndex: track.index, segment: track.currentSegment });
        redoStack = [];
        stopLiveSynth(currentBrush);
      }
      drawing = false;
      track.currentSegment = null;
    };

    track.canvas.addEventListener("mousedown", startDraw);
    track.canvas.addEventListener("touchstart", startDraw, {passive: false});
    track.canvas.addEventListener("mousemove", moveDraw);
    track.canvas.addEventListener("touchmove", moveDraw, {passive: false});
    track.canvas.addEventListener("mouseup", endDraw);
    track.canvas.addEventListener("mouseleave", endDraw);
    track.canvas.addEventListener("touchend", endDraw);
  });

  // --- LIVE SYNTH (Echtzeit + Bristle Noise) ---
  function startLiveSynth(track, y) {
    if (track.muted || track.vol < 0.01) return;
    liveNodes = [];
    liveGainNode = audioCtx.createGain();
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    let maxGain = 0.25;
    let attack = 0.05;
    // Latenz-Fix für Chords
    if (currentBrush === "chord") { maxGain = 0.1; attack = 0.005; } 
    if (currentBrush === "fractal") { maxGain = 0.15; }
    
    liveGainNode.gain.linearRampToValueAtTime(maxGain, audioCtx.currentTime + attack);

    const tempTrackGain = audioCtx.createGain();
    tempTrackGain.gain.value = track.vol;
    liveGainNode.connect(tempTrackGain).connect(masterGain);
    liveGainNode.tempOutput = tempTrackGain;

    let freq = mapYToFrequency(y, track.canvas.height);
    if(document.getElementById("harmonizeCheckbox").checked) {
        freq = quantizeFrequency(freq, document.getElementById("scaleSelect").value);
    }

    // A) TONALER TEIL
    const intervals = (currentBrush === "chord") ? chordIntervals[currentChord] : [0];
    intervals.forEach(iv => {
        const osc = audioCtx.createOscillator();
        osc.type = track.waveType;
        osc.frequency.setValueAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime);
        
        let out = osc;
        if (currentBrush === "fractal") {
            const shaper = audioCtx.createWaveShaper();
            shaper.curve = getDistortionCurve();
            osc.connect(shaper);
            out = shaper;
        }
        out.connect(liveGainNode);
        osc.start();
        liveNodes.push(osc);
    });

    // B) BRISTLE SPEZIAL: Granulares Rauschen + Bewegung
    if (currentBrush === "bristle") {
        // 1. Noise Source
        const noise = audioCtx.createBufferSource();
        noise.buffer = getNoiseBuffer(audioCtx);
        noise.loop = true;
        
        // 2. Filter (bewegt sich!)
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.Q.value = 1.0;
        noiseFilter.frequency.setValueAtTime(freq * 2, audioCtx.currentTime); // Filter folgt Maus
        
        // 3. LFO für "Wuseln" (moduliert Filter)
        const lfo = audioCtx.createOscillator();
        lfo.type = "triangle";
        lfo.frequency.value = 8; // 8Hz Zittern
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 500; // Modulations-Tiefe
        lfo.connect(lfoGain).connect(noiseFilter.frequency);
        lfo.start();
        liveNodes.push(lfo);

        // 4. Stereo Breite (Panning)
        const panner = audioCtx.createStereoPanner();
        // Leichter Random Pan beim Start
        panner.pan.value = (Math.random() * 0.5) - 0.25; 

        // 5. Noise Mix
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0.6; // Rauschen dazu mischen

        noise.connect(noiseFilter).connect(noiseGain).connect(panner).connect(liveGainNode);
        noise.start();
        liveNodes.push(noise);
    }
  }

  function updateLiveSynth(track, y) {
    if (!liveNodes.length) return;
    let freq = mapYToFrequency(y, track.canvas.height);
    if(document.getElementById("harmonizeCheckbox").checked) {
        freq = quantizeFrequency(freq, document.getElementById("scaleSelect").value);
    }
    
    // Update Frequency of Oscillators
    liveNodes.forEach(node => {
        if(node.frequency && node.type !== "triangle") { // Nicht den LFO ändern
           // Simple Logik: Alle Tonalen Oszillatoren updaten
           // Wir nehmen an, die Grundfrequenz reicht für das Live-Feedback
           node.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
        }
        // Update Noise Filter für Bristle
        if (node instanceof BiquadFilterNode) {
             node.frequency.setTargetAtTime(freq * 2, audioCtx.currentTime, 0.01);
        }
    });
  }

  function stopLiveSynth(brush) {
    if (!liveGainNode) return;
    const now = audioCtx.currentTime;
    let release = 0.05;
    if (brush === "chord") release = 0.005; // Instant Stop für Chords!

    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, release);
    
    const nodes = liveNodes;
    const gn = liveGainNode;
    const out = liveGainNode.tempOutput;

    setTimeout(() => {
        nodes.forEach(n => n.stop && n.stop());
        gn.disconnect();
        out.disconnect();
    }, release * 1000 + 100);

    liveNodes = [];
    liveGainNode = null;
  }

  // --- PLAYBACK ENGINE (Sequencer mit Bristle-Effekt) ---
  function scheduleTracks(startTime) {
    const harmonizeEnabled = document.getElementById("harmonizeCheckbox").checked;
    const scaleType = document.getElementById("scaleSelect").value;
    
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain();
      track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.muted ? 0 : track.vol;

      track.segments.forEach(segment => {
        // --- CHORDS (Latenzfrei) ---
        if (segment.brush === "chord" && segment.chordType) {
           const intervals = chordIntervals[segment.chordType] || [0];
           const sorted = segment.points.slice().sort((a, b) => a.x - b.x);
           if(sorted.length < 2) return;
           const start = startTime + (sorted[0].x / track.canvas.width) * playbackDuration;
           const end = startTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;
           
           intervals.forEach(iv => {
               const osc = audioCtx.createOscillator();
               osc.type = track.waveType;
               const env = audioCtx.createGain();
               env.gain.setValueAtTime(0, start);
               env.gain.linearRampToValueAtTime(0.15, start + 0.005); // SUPER FAST ATTACK
               env.gain.linearRampToValueAtTime(0, end);
               osc.connect(env).connect(track.gainNode);
               
               sorted.forEach(p => {
                   const t = startTime + (p.x / track.canvas.width) * playbackDuration;
                   let f = mapYToFrequency(p.y, track.canvas.height);
                   if(harmonizeEnabled) f = quantizeFrequency(f, scaleType);
                   osc.frequency.linearRampToValueAtTime(f * Math.pow(2, iv/12), t);
               });
               osc.start(start); osc.stop(end);
           });
           return;
        }

        // --- STANDARD & BRISTLE ---
        if (segment.points.length === 0) return;
        const sorted = segment.points.slice().sort((a, b) => a.x - b.x);
        const start = startTime + (sorted[0].x / track.canvas.width) * playbackDuration;
        const end = startTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;
        
        const osc = audioCtx.createOscillator();
        osc.type = track.waveType;
        
        const env = audioCtx.createGain();
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(0.25, start+0.02);
        env.gain.linearRampToValueAtTime(0, end);
        
        let out = env;
        if (segment.brush === "fractal") {
             const shaper = audioCtx.createWaveShaper();
             shaper.curve = getDistortionCurve();
             env.connect(shaper);
             out = shaper;
        }

        // BRISTLE NOISE IM LOOP
        if (segment.brush === "bristle") {
            const noise = audioCtx.createBufferSource();
            noise.buffer = getNoiseBuffer(audioCtx);
            noise.loop = true;
            
            const nFilter = audioCtx.createBiquadFilter();
            nFilter.type = "bandpass";
            nFilter.Q.value = 1.0;
            
            // LFO für Bewegung
            const lfo = audioCtx.createOscillator();
            lfo.type = "triangle";
            lfo.frequency.value = 6;
            const lfoG = audioCtx.createGain();
            lfoG.gain.value = 600;
            lfo.connect(lfoG).connect(nFilter.frequency);
            lfo.start(start); lfo.stop(end);

            const nGain = audioCtx.createGain();
            nGain.gain.setValueAtTime(0, start);
            nGain.gain.linearRampToValueAtTime(0.4, start+0.05);
            nGain.gain.linearRampToValueAtTime(0, end);

            // Filter Automation
            sorted.forEach(p => {
                const t = startTime + (p.x / track.canvas.width) * playbackDuration;
                let f = mapYToFrequency(p.y, track.canvas.height);
                nFilter.frequency.linearRampToValueAtTime(f * 2, t);
            });

            noise.connect(nFilter).connect(nGain).connect(track.gainNode);
            noise.start(start); noise.stop(end);
        }

        osc.connect(out).connect(track.gainNode);
        
        sorted.forEach(p => {
             const t = startTime + (p.x / track.canvas.width) * playbackDuration;
             let f = mapYToFrequency(p.y, track.canvas.height);
             if(harmonizeEnabled) f = quantizeFrequency(f, scaleType);
             osc.frequency.linearRampToValueAtTime(f, t);
        });
        
        osc.start(start); osc.stop(end);
      });
    });
  }

  // --- VISUAL RENDERING (ORIGINAL UNVERÄNDERT) ---
  function drawSegmentStandard(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    ctx.lineWidth = baseSize; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  function drawSegmentVariable(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let dynamicWidth = baseSize * (1 + Math.max(0, (10 - distance) / 10));
    ctx.lineWidth = dynamicWidth; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  function drawSegmentCalligraphy(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const norm = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / norm, ny = dx / norm;
    const offset = baseSize;
    ctx.lineCap = "round"; ctx.lineWidth = 1; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(p1.x + nx * offset, p1.y + ny * offset);
    ctx.lineTo(p2.x + nx * offset, p2.y + ny * offset);
    ctx.lineTo(p2.x - nx * offset, p2.y - ny * offset);
    ctx.lineTo(p1.x - nx * offset, p1.y - ny * offset);
    ctx.fill();
  }
  function drawSegmentBristle(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const bristleCount = 5; ctx.lineCap = "round";
    for (let i = 0; i < bristleCount; i++) {
      let offsetX = (Math.random() - 0.5) * baseSize * 2;
      let offsetY = (Math.random() - 0.5) * baseSize * 2;
      ctx.lineWidth = baseSize * 0.7;
      ctx.beginPath(); ctx.moveTo(p1.x + offsetX, p1.y + offsetY); ctx.lineTo(p2.x + offsetX, p2.y + offsetY); ctx.stroke();
    }
  }
  function drawSegmentFractal(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    ctx.lineWidth = baseSize; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(p1.x + (p1.jX||0), p1.y + (p1.jY||0)); ctx.lineTo(p2.x + (p2.jX||0), p2.y + (p2.jY||0)); ctx.stroke();
  }

  function redrawTrack(track, markerX) {
    const ctx = track.ctx;
    drawGrid(track);
    track.segments.forEach(segment => {
      // Chords
      if (segment.brush === "chord" && segment.chordType) {
        const xs = segment.points.map(pt => pt.x);
        const ys = segment.points.map(pt => pt.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
        chordIntervals[segment.chordType].forEach((interval, index) => {
          const yOffset = interval * 5;
          ctx.strokeStyle = chordColors[index % 3];
          ctx.lineWidth = segment.thickness;
          ctx.beginPath(); ctx.moveTo(minX - 10, avgY - yOffset); ctx.lineTo(maxX + 10, avgY - yOffset); ctx.stroke();
        });
      } else if (segment.points.length >= 2) {
        // Andere Pinsel (Unsortierte Punkte für Original-Look!)
        const pts = segment.points;
        ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
        for (let i = 1; i < pts.length; i++) {
            const tempSeg = { points: pts, thickness: segment.thickness, brush: segment.brush };
            const bs = segment.thickness;
            switch(segment.brush) {
                case "variable": drawSegmentVariable(ctx, tempSeg, i-1, i, bs); break;
                case "calligraphy": drawSegmentCalligraphy(ctx, tempSeg, i-1, i, bs); break;
                case "bristle": drawSegmentBristle(ctx, tempSeg, i-1, i, bs); break;
                case "fractal": drawSegmentFractal(ctx, segment, i-1, i, bs); break;
                default: drawSegmentStandard(ctx, tempSeg, i-1, i, bs);
            }
        }
      }
    });
    if (markerX !== null) {
      ctx.strokeStyle = "red"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(markerX, 0); ctx.lineTo(markerX, track.canvas.height); ctx.stroke();
    }
  }

  // --- HELPERS ---
  function getCanvasCoordinates(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }
  function snapCoordinate(x, w) { return Math.round(x / (w/32)) * (w/32); }
  function drawGrid(track) {
    const ctx = track.ctx;
    ctx.clearRect(0, 0, track.canvas.width, track.canvas.height);
    ctx.strokeStyle = "#eee";
    for(let i=0; i<=32; i++) {
       ctx.beginPath(); let x = i*(track.canvas.width/32);
       ctx.moveTo(x,0); ctx.lineTo(x,track.canvas.height);
       ctx.lineWidth = (i%4===0) ? 2 : 1; ctx.stroke();
    }
    for(let j=0; j<4; j++) {
       ctx.beginPath(); let y = j*(track.canvas.height/4);
       ctx.moveTo(0, y); ctx.lineTo(track.canvas.width, y); ctx.lineWidth=1; ctx.stroke();
    }
  }
  function generateLegend(h) { return "1k<br>500<br>250<br>80"; }
  function mapYToFrequency(y, h) { return 1000 - ((y / h) * 920); }
  function quantizeFrequency(freq, scaleType) {
    let midi = 69 + 12 * Math.log2(freq / 440);
    let r = Math.round(midi);
    let pattern = (scaleType === "major")?[0,2,4,5,7,9,11]:(scaleType === "minor")?[0,2,3,5,7,8,10]:[0,3,5,7,10];
    let mod = r % 12;
    let best = pattern.reduce((prev, curr) => Math.abs(curr - mod) < Math.abs(prev - mod) ? curr : prev);
    return 440 * Math.pow(2, (r - mod + best - 69)/12);
  }
  function eraseAt(track, x, y) {
      const r = 15;
      track.segments = track.segments.filter(s => !s.points.some(p => Math.hypot(p.x-x, p.y-y) < r));
      redrawTrack(track, null);
  }

  // --- LOOP & BUTTONS ---
  function animationLoop() {
    if (!isPlaying) return;
    let elapsed = audioCtx.currentTime - playbackStartTime;
    if (elapsed >= playbackDuration) {
      if (loopEnabled) {
        playbackStartTime = audioCtx.currentTime + 0.02;
        scheduleTracks(playbackStartTime);
        elapsed = 0;
      } else {
        isPlaying = false;
        return;
      }
    }
    const w = tracks[0].canvas.width;
    tracks.forEach(track => redrawTrack(track, (elapsed / playbackDuration) * w));
    animationFrameId = requestAnimationFrame(animationLoop);
  }

  document.getElementById("playButton").addEventListener("click", () => {
    if (tracks.every(t => t.segments.length === 0)) return;
    if (isPlaying) return;
    initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const bpm = parseFloat(document.getElementById("bpmInput").value);
    playbackDuration = (60 / bpm) * 32;
    playbackStartTime = audioCtx.currentTime + 0.02;
    isPlaying = true;
    scheduleTracks(playbackStartTime);
    animationLoop();
  });
  document.getElementById("stopButton").addEventListener("click", () => {
    isPlaying = false;
    cancelAnimationFrame(animationFrameId);
    tracks.forEach(t => { if(t.gainNode){t.gainNode.disconnect(); t.gainNode=null;} redrawTrack(t, null); });
  });
});