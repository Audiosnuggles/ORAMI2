/**
 * THE PIGEON - Final Polished Version
 * Fixes: Instant Chord Attack (Zero Latency), Bristle Noise, Audio Balancing
 */

// --- KONFIGURATION & GLOBALS ---
const chordIntervals = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

// --- AUDIO CACHES (Performance) ---

// 1. Distortion Curve (für Fractal)
let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050;
  const curve = new Float32Array(n);
  const amount = 80;
  for (let i = 0; i < n; ++i) {
    let x = i * 2 / n - 1;
    curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  cachedDistortionCurve = curve;
  return curve;
}

// 2. Noise Buffer (für Bristle) - NEU!
let cachedNoiseBuffer = null;
function getNoiseBuffer(ctx) {
  if (cachedNoiseBuffer) return cachedNoiseBuffer;
  const bufferSize = ctx.sampleRate * 2; // 2 Sekunden Loop reicht
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1; // Weißes Rauschen
  }
  cachedNoiseBuffer = buffer;
  return buffer;
}

document.addEventListener("DOMContentLoaded", function() {
  
  // --- STATE ---
  let audioCtx = null;
  let masterGain, compressor;
  let isPlaying = false;
  let playbackStartTime = 0;
  let playbackDuration = 0;
  let animationFrameId;
  
  let loopEnabled = document.getElementById("loopCheckbox").checked;
  let undoStack = [];

  // Live Synth Speicher
  let liveNodes = []; // Umbenannt von liveOscillators, da jetzt auch Noise-Nodes drin sein können
  let liveGainNode = null;

  // UI State
  let currentTool = document.getElementById("toolSelect").value;
  let currentBrush = document.getElementById("brushSelect").value;
  let currentBrushSize = parseInt(document.getElementById("brushSizeSlider").value, 10);
  let currentChord = document.getElementById("chordSelect").value;

  // --- UI EVENT LISTENER ---
  document.getElementById("toolSelect").addEventListener("change", e => currentTool = e.target.value);
  document.getElementById("brushSelect").addEventListener("change", e => currentBrush = e.target.value);
  document.getElementById("brushSizeSlider").addEventListener("input", e => currentBrushSize = parseInt(e.target.value, 10));
  document.getElementById("chordSelect").addEventListener("change", e => currentChord = e.target.value);
  document.getElementById("loopCheckbox").addEventListener("change", e => loopEnabled = e.target.checked);
  document.getElementById("bpmInput").addEventListener("change", () => { if(isPlaying) stopPlayback(); });

  const harmonizeCheck = document.getElementById("harmonizeCheckbox");
  const scaleContainer = document.getElementById("scaleSelectContainer");
  harmonizeCheck.addEventListener("change", () => {
    scaleContainer.style.display = harmonizeCheck.checked ? "inline" : "none";
  });

  // --- AUDIO INIT ---
  function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 12;
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  // --- TRACKS SETUP ---
  const trackContainers = document.querySelectorAll(".track-container");
  const tracks = Array.from(trackContainers).map((container, index) => {
    return {
      index: index,
      canvas: container.querySelector("canvas"),
      ctx: container.querySelector("canvas").getContext("2d"),
      segments: [],
      wave: "sine",
      mute: false,
      vol: 0.8,
      snap: false,
      gainNode: null
    };
  });

  tracks.forEach((track) => {
    const container = track.canvas.parentElement;
    
    // Initiales Zeichnen
    drawGrid(track);
    const leg = container.querySelector(".legend");
    if(leg) leg.innerHTML = "1k<br><br>500<br><br>250<br><br>80";

    // Controls Logic
    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.wave = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    const defBtn = container.querySelector('.wave-btn[data-wave="sine"]');
    if(defBtn) defBtn.classList.add("active");

    const muteBtn = container.querySelector(".mute-btn");
    muteBtn.addEventListener("click", () => {
      track.mute = !track.mute;
      muteBtn.style.backgroundColor = track.mute ? "#ff4444" : "";
      muteBtn.style.color = track.mute ? "white" : "";
      updateTrackVolume(track);
    });

    const volSlider = container.querySelector(".volume-slider");
    if(volSlider) {
        track.vol = parseFloat(volSlider.value);
        volSlider.addEventListener("input", (e) => {
            track.vol = parseFloat(e.target.value);
            updateTrackVolume(track);
        });
    }

    const snapCb = container.querySelector(".snap-checkbox");
    if(snapCb) snapCb.addEventListener("change", e => track.snap = e.target.checked);

    // --- DRAWING ---
    let drawing = false;

    const startDraw = (e) => {
      e.preventDefault();
      if (!audioCtx) initAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const pos = getPos(e, track.canvas);
      let x = track.snap ? snapX(pos.x, track.canvas.width) : pos.x;

      if (currentTool === "draw") {
        drawing = true;
        
        let jX=0, jY=0;
        if(currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }

        track.currentSegment = {
          points: [{ x: x, y: pos.y, jX, jY }],
          brush: currentBrush,
          size: currentBrushSize,
          chord: (currentBrush === "chord") ? currentChord : null
        };
        track.segments.push(track.currentSegment);
        startLiveSynth(track, pos.y);
        redrawTrack(track, null);
      } else {
        eraseAt(track, x, pos.y);
      }
    };

    const moveDraw = (e) => {
      if (!drawing && currentTool !== "erase") return;
      e.preventDefault();
      const pos = getPos(e, track.canvas);
      let x = track.snap ? snapX(pos.x, track.canvas.width) : pos.x;

      if (currentTool === "draw" && drawing) {
        let jX=0, jY=0;
        if(currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }

        const seg = track.currentSegment;
        seg.points.push({ x: x, y: pos.y, jX, jY });
        
        updateLiveSynth(track, pos.y + jY);

        // Effizientes Live-Rendering (nur letzter Abschnitt)
        if (seg.brush !== "chord") {
            const idx2 = seg.points.length - 1;
            const idx1 = idx2 - 1;
            // Fake Segment für die Funktion
            const drawSeg = { points: seg.points, thickness: currentBrushSize, brush: currentBrush };
            switch(seg.brush) {
                case "variable": drawSegmentVariable(track.ctx, drawSeg, idx1, idx2, currentBrushSize); break;
                case "calligraphy": drawSegmentCalligraphy(track.ctx, drawSeg, idx1, idx2, currentBrushSize); break;
                case "bristle": drawSegmentBristle(track.ctx, drawSeg, idx1, idx2, currentBrushSize); break;
                case "fractal": drawSegmentFractal(track.ctx, seg, idx1, idx2, currentBrushSize); break;
                default: drawSegmentStandard(track.ctx, drawSeg, idx1, idx2, currentBrushSize);
            }
        } else {
            redrawTrack(track, null);
        }
      } else if (currentTool === "erase") {
         if(e.buttons === 1 || e.type === "touchmove") eraseAt(track, x, pos.y);
      }
    };

    const endDraw = () => {
      if (drawing) {
        undoStack.push({ trackIndex: track.index, segment: track.currentSegment });
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

  // --- HELPERS ---
  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }
  function snapX(x, w) { return Math.round(x / (w/32)) * (w/32); }
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
  function mapYToFreq(y, h) { return 1000 - (y/h)*920; }
  function updateTrackVolume(track) {
      if(track.gainNode && audioCtx) {
          track.gainNode.gain.setTargetAtTime(track.mute ? 0 : track.vol, audioCtx.currentTime, 0.05);
      }
  }
  function eraseAt(track, x, y) {
      const r = 15;
      track.segments = track.segments.filter(s => !s.points.some(p => Math.hypot(p.x-x, p.y-y) < r));
      redrawTrack(track, null);
  }
  function quantize(freq, scale) {
    let midi = 69 + 12*Math.log2(freq/440);
    let r = Math.round(midi);
    let pc = r % 12;
    let pattern = [0,2,4,5,7,9,11];
    if(scale === "minor") pattern = [0,2,3,5,7,8,10];
    if(scale === "pentatonic") pattern = [0,3,5,7,10];
    let best = pattern.reduce((prev, curr) => Math.abs(curr - pc) < Math.abs(prev - pc) ? curr : prev);
    // Fix für modulo-Vergleich bei Pattern
    let minD = 99, bestP = pattern[0];
    pattern.forEach(p => {
        let d = Math.abs(p - pc);
        if(d < minD) { minD = d; bestP = p; }
    });
    return 440 * Math.pow(2, (r - pc + bestP - 69)/12);
  }

  // --- LIVE SYNTH ENGINE (Optimiert) ---
  function startLiveSynth(track, y) {
    if (track.mute || track.vol < 0.01) return;
    liveNodes = [];
    liveGainNode = audioCtx.createGain();
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    let maxGain = 0.25;
    let attack = 0.05;

    // FIX: Chord Attack fast instant machen für bessere Latenz
    if (currentBrush === "chord") { maxGain = 0.15; attack = 0.005; } 
    if (currentBrush === "fractal") { maxGain = 0.15; }
    if (currentBrush === "calligraphy") { maxGain = 0.3; attack = 0.2; }

    liveGainNode.gain.linearRampToValueAtTime(maxGain, audioCtx.currentTime + attack);
    
    const tempTrackGain = audioCtx.createGain();
    tempTrackGain.gain.value = track.vol;
    liveGainNode.connect(tempTrackGain).connect(masterGain);
    liveGainNode.tempOutput = tempTrackGain; 

    // --- BRISTLE NOISE LOGIC ---
    if (currentBrush === "bristle") {
        const noise = audioCtx.createBufferSource();
        noise.buffer = getNoiseBuffer(audioCtx);
        noise.loop = true;
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.value = 0.4; // Mischverhältnis Noise
        noise.connect(noiseGain).connect(liveGainNode);
        noise.start();
        liveNodes.push(noise);
    }

    const baseFreq = mapYToFreq(y, track.canvas.height);
    const intervals = (currentBrush === "chord") ? chordIntervals[currentChord] : [0];

    intervals.forEach(iv => {
      const osc = audioCtx.createOscillator();
      osc.type = track.wave;
      let freq = baseFreq * Math.pow(2, iv/12);
      if(document.getElementById("harmonizeCheckbox").checked) {
        freq = quantize(freq, document.getElementById("scaleSelect").value);
      }
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

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
  }

  function updateLiveSynth(track, y) {
    if (!liveNodes.length) return;
    let freq = mapYToFreq(y, track.canvas.height);
    if(document.getElementById("harmonizeCheckbox").checked) {
       freq = quantize(freq, document.getElementById("scaleSelect").value);
    }
    
    // Update Oszillatoren (Noise Nodes überspringen, da keine frequency Eigenschaft)
    liveNodes.forEach((node, i) => {
      if(node.frequency) { // Nur Oszillatoren
          // Hier vereinfacht: wir kennen den Index nicht exakt, wenn Noise dabei ist
          // Aber für Chords ist Noise egal (da bristle kein Chord ist)
          // Für Bristle gibt es nur 1 Osc (Index 0 oder 1)
          const intervals = (currentBrush === "chord") ? chordIntervals[currentChord] : [0];
          // Wir müssen den korrekten Intervall-Index finden. 
          // Workaround: Bei Bristle ist interval immer 0. Bei Chord gibt es kein Noise.
          // -> Wir nehmen i % intervals.length passt meistens.
          // Sauberer: Wir speichern "baseFrequency" im Node Objekt. Hier reicht simple Logik:
          let iv = 0;
          if (currentBrush === "chord") {
              // Bei Chord sind alle Nodes Oscillators
              iv = intervals[i] || 0;
          }
          node.frequency.setTargetAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime, 0.01);
      }
    });
  }

  function stopLiveSynth(brush) {
    if (!liveGainNode) return;
    const now = audioCtx.currentTime;
    let release = 0.05;
    if (brush === "chord") release = 0.005; // Instant Stop
    if (brush === "calligraphy") release = 0.3;

    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, release);
    
    const nodes = liveNodes;
    const gn = liveGainNode;
    const out = liveGainNode.tempOutput;

    setTimeout(() => {
      nodes.forEach(n => n.stop());
      gn.disconnect();
      out.disconnect();
    }, release * 1000 + 100);

    liveNodes = [];
    liveGainNode = null;
  }

  // --- VISUAL RENDERING (Original Logic) ---
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
    const norm = Math.sqrt(dx*dx + dy*dy) || 1;
    let nx = -dy/norm, ny = dx/norm;
    const w = baseSize;
    ctx.lineCap = "round"; ctx.lineWidth = 1; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(p1.x + nx*w, p1.y + ny*w);
    ctx.lineTo(p2.x + nx*w, p2.y + ny*w);
    ctx.lineTo(p2.x - nx*w, p2.y - ny*w);
    ctx.lineTo(p1.x - nx*w, p1.y - ny*w);
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
    // Nutze gespeicherten Jitter
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
        // Andere
        const sorted = segment.points.slice().sort((a, b) => a.x - b.x);
        ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
        for (let i = 1; i < sorted.length; i++) {
            const tempSeg = { points: sorted, brush: segment.brush, thickness: segment.thickness };
            const bs = segment.thickness;
            switch(segment.brush) {
                case "variable": drawSegmentVariable(ctx, tempSeg, i-1, i, bs); break;
                case "calligraphy": drawSegmentCalligraphy(ctx, tempSeg, i-1, i, bs); break;
                case "bristle": drawSegmentBristle(ctx, tempSeg, i-1, i, bs); break;
                case "fractal": drawSegmentFractal(ctx, segment, i-1, i, bs); break; // Fractal needs real segment for jitter
                default: drawSegmentStandard(ctx, tempSeg, i-1, i, bs);
            }
        }
      }
    });
    if (markerX !== null) {
      ctx.strokeStyle = "red"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(markerX, 0); ctx.lineTo(markerX, track.canvas.height); ctx.stroke();
    }
  }

  // --- PLAYBACK ENGINE ---
  function startPlayback() {
    if (isPlaying) return;
    initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const bpm = parseFloat(document.getElementById("bpmInput").value);
    playbackDuration = (60 / bpm) * 32;
    playbackStartTime = audioCtx.currentTime + 0.02;
    isPlaying = true;
    scheduleTracks(playbackStartTime);
    animationLoop();
  }

  function stopPlayback() {
    isPlaying = false;
    tracks.forEach(t => { 
        if(t.gainNode) { t.gainNode.disconnect(); t.gainNode=null; } 
        redrawTrack(t, null);
    });
  }

  function scheduleTracks(startTime) {
    const harmonizeEnabled = document.getElementById("harmonizeCheckbox").checked;
    const scaleType = document.getElementById("scaleSelect").value;
    
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain();
      track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.muted ? 0 : track.vol;

      track.segments.forEach(segment => {
        // --- CHORDS IM SEQUENCER ---
        if (segment.brush === "chord" && segment.chordType) {
           const intervals = chordIntervals[segment.chordType] || [0];
           const sorted = segment.points.slice().sort((a, b) => a.x - b.x);
           if(sorted.length < 2) return;
           const start = startTime + (sorted[0].x / track.canvas.width) * playbackDuration;
           const end = startTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;
           
           intervals.forEach(iv => {
               const osc = audioCtx.createOscillator();
               osc.type = track.waveType || "sine";
               const env = audioCtx.createGain();
               env.gain.setValueAtTime(0, start);
               env.gain.linearRampToValueAtTime(0.15, start + 0.01); // Fast Attack!
               env.gain.linearRampToValueAtTime(0, end);
               osc.connect(env).connect(track.gainNode);
               
               sorted.forEach(p => {
                   const t = startTime + (p.x / track.canvas.width) * playbackDuration;
                   let freq = mapYToFreq(p.y, track.canvas.height);
                   if(harmonizeEnabled) freq = quantize(freq, scaleType);
                   osc.frequency.linearRampToValueAtTime(freq * Math.pow(2, iv/12), t);
               });
               osc.start(start); osc.stop(end);
           });
           return;
        }

        // --- BRISTLE / FRACTAL / STANDARD ---
        if (segment.points.length === 0) return;
        const sorted = segment.points.slice().sort((a, b) => a.x - b.x);
        const start = startTime + (sorted[0].x / track.canvas.width) * playbackDuration;
        const end = startTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;
        
        const osc = audioCtx.createOscillator();
        osc.type = track.waveType || "sine";
        
        const env = audioCtx.createGain();
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(0.3, start+0.05);
        env.gain.linearRampToValueAtTime(0, end);
        
        let out = env;
        if (segment.brush === "fractal") {
             const shaper = audioCtx.createWaveShaper();
             shaper.curve = getDistortionCurve();
             env.connect(shaper);
             out = shaper;
        }

        // Noise für Bristle im Playback
        if (segment.brush === "bristle") {
            const noise = audioCtx.createBufferSource();
            noise.buffer = getNoiseBuffer(audioCtx);
            noise.loop = true;
            const noiseGain = audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0, start);
            noiseGain.gain.linearRampToValueAtTime(0.1, start+0.05);
            noiseGain.gain.linearRampToValueAtTime(0, end);
            noise.connect(noiseGain).connect(track.gainNode);
            noise.start(start);
            noise.stop(end);
        }

        osc.connect(out).connect(track.gainNode);
        
        sorted.forEach(p => {
             const t = startTime + (p.x / track.canvas.width) * playbackDuration;
             let f = mapYToFreq(p.y, track.canvas.height);
             if(harmonizeEnabled) f = quantize(f, scaleType);
             osc.frequency.linearRampToValueAtTime(f, t);
        });
        
        osc.start(start); osc.stop(end);
      });
    });
  }

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

  // --- BUTTON BINDINGS ---
  document.getElementById("playButton").addEventListener("click", startPlayback);
  document.getElementById("stopButton").addEventListener("click", stopPlayback);
  document.getElementById("clearButton").addEventListener("click", () => {
    tracks.forEach(t => { t.segments = []; redrawTrack(t, null); });
    undoStack = [];
  });
  document.getElementById("undoButton").addEventListener("click", () => {
    if(undoStack.length) {
       const op = undoStack.pop();
       tracks[op.trackIndex].segments.pop();
       redrawTrack(tracks[op.trackIndex], null);
    }
  });
  document.getElementById("exportButton").addEventListener("click", function() {
    const settings = {
      bpm: document.getElementById("bpmInput").value,
      loop: document.getElementById("loopCheckbox").checked,
      harmonize: document.getElementById("harmonizeCheckbox").checked,
      scale: document.getElementById("scaleSelect").value,
      tool: document.getElementById("toolSelect").value,
      brush: document.getElementById("brushSelect").value,
      brushSize: document.getElementById("brushSizeSlider").value
    };
    const exportData = { settings: settings, tracks: tracks.map(track => track.segments) };
    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "drawing.json"; a.click();
  });
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const d = JSON.parse(evt.target.result);
              if(d.tracks) {
                  d.tracks.forEach((segs, i) => { if(tracks[i]) tracks[i].segments = segs; redrawTrack(tracks[i], null); });
              }
          } catch(e) { alert("Import fehlgeschlagen"); }
      };
      reader.readAsText(file);
  });
});