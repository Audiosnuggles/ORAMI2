/**
 * THE PIGEON - Professional Web Audio Drawing Tool
 * Final Version: Fixed Coordinates, Dynamic Progress Bar, Visual Brushes & Optimized Audio
 */

// --- KONFIGURATION & GLOBALS ---
const chordIntervals = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  sus4: [0, 5, 7]
};

const chordColors = ['#FF5733', '#33FF57', '#3357FF', '#FF33A8'];

// CACHE: Distortion Curve wird nur 1x berechnet
let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050;
  const curve = new Float32Array(n);
  const amount = 100;
  for (let i = 0; i < n; ++i) {
    let x = i * 2 / n - 1;
    curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  cachedDistortionCurve = curve;
  return curve;
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

  // Settings
  let currentTool = document.getElementById("toolSelect").value;
  let currentBrush = document.getElementById("brushSelect").value;
  let currentBrushSize = parseInt(document.getElementById("brushSizeSlider").value, 10);
  let currentChord = document.getElementById("chordSelect").value;

  // Live Synth Speicher
  let liveOscillators = [];
  let liveGainNode = null;

  // --- AUDIO INIT ---
  function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  // --- UI EVENT LISTENERS ---
  document.getElementById("toolSelect").addEventListener("change", e => currentTool = e.target.value);
  document.getElementById("brushSelect").addEventListener("change", e => currentBrush = e.target.value);
  document.getElementById("brushSizeSlider").addEventListener("input", e => currentBrushSize = parseInt(e.target.value, 10));
  document.getElementById("chordSelect").addEventListener("change", e => currentChord = e.target.value);
  document.getElementById("loopCheckbox").addEventListener("change", e => loopEnabled = e.target.checked);
  
  const harmonizeCheck = document.getElementById("harmonizeCheckbox");
  const scaleContainer = document.getElementById("scaleSelectContainer");
  harmonizeCheck.addEventListener("change", () => {
    scaleContainer.style.display = harmonizeCheck.checked ? "inline" : "none";
  });

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

  // --- TRACKS SETUP ---
  const tracks = [
    { id: "canvas1", wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null },
    { id: "canvas2", wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null },
    { id: "canvas3", wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null },
    { id: "canvas4", wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null }
  ];

  tracks.forEach((track, idx) => {
    track.index = idx;
    track.canvas = document.getElementById(track.id);
    track.ctx = track.canvas.getContext("2d");
    track.segments = []; 
    track.currentSegment = null;

    const container = track.canvas.closest(".track-container");
    
    drawGrid(track);
    container.querySelector(".legend").innerHTML = "1k<br><br>500<br><br>250<br><br>80";

    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.wave = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    const muteBtn = container.querySelector(".mute-btn");
    muteBtn.addEventListener("click", () => {
      track.mute = !track.mute;
      muteBtn.style.backgroundColor = track.mute ? "#ff4444" : "";
      muteBtn.style.color = track.mute ? "white" : "";
      updateTrackVolume(track);
    });

    const volSlider = container.querySelector(".volume-slider");
    volSlider.addEventListener("input", (e) => {
      track.vol = parseFloat(e.target.value);
      updateTrackVolume(track);
    });

    container.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    // --- DRAWING LOGIC ---
    const startDraw = (e) => {
      e.preventDefault();
      if (!audioCtx) initAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const pos = getPos(e, track.canvas);
      let x = track.snap ? snapX(pos.x, track.canvas.width) : pos.x;

      if (currentTool === "draw") {
        track.isDrawing = true;
        let jX = 0, jY = 0;
        if (currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }

        track.currentSegment = {
          points: [{ x: x, y: pos.y, jX, jY }],
          brush: currentBrush,
          size: currentBrushSize,
          chord: (currentBrush === "chord") ? currentChord : null
        };
        track.segments.push(track.currentSegment);
        startLiveSynth(track, pos.y);
      } else {
        eraseAt(track, x, pos.y);
      }
    };

    const moveDraw = (e) => {
      if (!track.isDrawing && currentTool !== "erase") return;
      e.preventDefault();
      
      const pos = getPos(e, track.canvas);
      let x = track.snap ? snapX(pos.x, track.canvas.width) : pos.x;

      if (currentTool === "draw" && track.isDrawing) {
        let jX = 0, jY = 0;
        if (currentBrush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }
        
        track.currentSegment.points.push({ x: x, y: pos.y, jX, jY });
        updateLiveSynth(track, pos.y + jY);
        redrawTrack(track, null);
      } else if (currentTool === "erase") {
        if(e.buttons === 1 || e.type === "touchmove") eraseAt(track, x, pos.y);
      }
    };

    const endDraw = (e) => {
      if (track.isDrawing) {
        track.isDrawing = false;
        undoStack.push({ trackIndex: track.index, segment: track.currentSegment });
        stopLiveSynth(currentBrush);
      }
    };

    track.canvas.addEventListener("mousedown", startDraw);
    track.canvas.addEventListener("touchstart", startDraw, {passive: false});
    track.canvas.addEventListener("mousemove", moveDraw);
    track.canvas.addEventListener("touchmove", moveDraw, {passive: false});
    track.canvas.addEventListener("mouseup", endDraw);
    track.canvas.addEventListener("mouseleave", endDraw);
    track.canvas.addEventListener("touchend", endDraw);
    track.canvas.addEventListener("touchcancel", endDraw);
  });

  // --- HELPER FUNCTIONS ---
  // Fix für Maus-Position bei skalierter Canvas (Zoom/CSS)
  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;   // Faktor X
    const scaleY = canvas.height / rect.height; // Faktor Y
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    return { 
      x: (clientX - rect.left) * scaleX, 
      y: (clientY - rect.top) * scaleY 
    };
  }

  function snapX(x, w) { return Math.round(x / (w/32)) * (w/32); }

  function eraseAt(track, x, y) {
    const radius = 20;
    const initialLen = track.segments.length;
    track.segments = track.segments.filter(seg => 
      !seg.points.some(p => Math.hypot(p.x - x, p.y - y) < radius)
    );
    if(track.segments.length < initialLen) redrawTrack(track, null);
  }

  function updateTrackVolume(track) {
    if (track.gainNode && audioCtx) {
      const val = track.mute ? 0 : track.vol;
      track.gainNode.gain.setTargetAtTime(val, audioCtx.currentTime, 0.05);
    }
  }

  // --- LIVE SYNTH ---
  function startLiveSynth(track, y) {
    if (track.mute || track.vol < 0.01) return;

    liveOscillators = [];
    liveGainNode = audioCtx.createGain();
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    let maxGain = 0.25;
    let attack = 0.05;
    if (currentBrush === "chord") { maxGain = 0.08; attack = 0.02; }
    if (currentBrush === "fractal") { maxGain = 0.15; }
    if (currentBrush === "calligraphy") { maxGain = 0.3; attack = 0.25; }

    liveGainNode.gain.linearRampToValueAtTime(maxGain, audioCtx.currentTime + attack);
    
    const tempTrackGain = audioCtx.createGain();
    tempTrackGain.gain.value = track.vol;
    liveGainNode.connect(tempTrackGain).connect(masterGain);
    liveGainNode.tempOutput = tempTrackGain; 

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
      liveOscillators.push(osc);
    });
  }

  function updateLiveSynth(track, y) {
    if (!liveOscillators.length) return;
    let freq = mapYToFreq(y, track.canvas.height);
    if(document.getElementById("harmonizeCheckbox").checked) {
       freq = quantize(freq, document.getElementById("scaleSelect").value);
    }
    
    liveOscillators.forEach((osc, i) => {
      const intervals = (currentBrush === "chord") ? chordIntervals[currentChord] : [0];
      const iv = intervals[i] || 0;
      const target = freq * Math.pow(2, iv/12);
      osc.frequency.setTargetAtTime(target, audioCtx.currentTime, 0.01);
    });
  }

  function stopLiveSynth(brush) {
    if (!liveGainNode) return;
    const now = audioCtx.currentTime;
    
    let release = 0.05;
    if (brush === "chord") release = 0.005; 
    if (brush === "calligraphy") release = 0.3;

    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, release);

    const oscs = liveOscillators;
    const node = liveGainNode;
    const out = liveGainNode.tempOutput;

    setTimeout(() => {
      oscs.forEach(o => o.stop());
      node.disconnect();
      out.disconnect();
    }, release * 1000 + 100);

    liveOscillators = [];
    liveGainNode = null;
  }

  // --- PLAYBACK ENGINE ---
  function startPlayback() {
    if (isPlaying) return;
    if (!audioCtx) initAudio();
    
    const bpm = document.getElementById("bpmInput").value;
    playbackDuration = (60/bpm) * 32;
    playbackStartTime = audioCtx.currentTime + 0.1;
    isPlaying = true;
    scheduleTracks();
    requestAnimationFrame(renderLoop);
  }

  function stopPlayback() {
    isPlaying = false;
    tracks.forEach(t => { 
        if(t.gainNode) { t.gainNode.disconnect(); t.gainNode = null; }
    });
    tracks.forEach(t => redrawTrack(t, null));
  }

  function scheduleTracks() {
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain();
      track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.mute ? 0 : track.vol;

      track.segments.forEach(seg => {
        const sorted = seg.points.slice().sort((a,b) => a.x - b.x);
        if(sorted.length < 2) return;

        const startT = playbackStartTime + (sorted[0].x / track.canvas.width) * playbackDuration;
        const endT = playbackStartTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;
        
        let vol = 0.3;
        if (seg.brush === "chord") vol = 0.08;
        if (seg.brush === "fractal") vol = 0.12;
        
        const intervals = (seg.brush === "chord" && seg.chord) ? chordIntervals[seg.chord] : [0];

        intervals.forEach(iv => {
          const osc = audioCtx.createOscillator();
          osc.type = track.wave;
          
          const filter = audioCtx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 3000 - (seg.size * 100);
          
          const env = audioCtx.createGain();
          env.gain.setValueAtTime(0, startT);
          env.gain.linearRampToValueAtTime(vol, startT + 0.02);
          env.gain.linearRampToValueAtTime(0, endT);

          let out = env;
          if (seg.brush === "fractal") {
             const shaper = audioCtx.createWaveShaper();
             shaper.curve = getDistortionCurve();
             env.connect(shaper);
             out = shaper;
          }

          sorted.forEach(p => {
             const t = playbackStartTime + (p.x / track.canvas.width) * playbackDuration;
             let f = mapYToFreq(p.y + (p.jY||0), track.canvas.height);
             if(document.getElementById("harmonizeCheckbox").checked) {
                 f = quantize(f, document.getElementById("scaleSelect").value);
             }
             osc.frequency.linearRampToValueAtTime(f * Math.pow(2, iv/12), t);
          });

          osc.connect(filter).connect(out).connect(track.gainNode);
          osc.start(startT);
          osc.stop(endT);
        });
      });
    });
  }

  // --- RENDER LOOP FIX (Dynamische Breite) ---
  function renderLoop() {
    if (!isPlaying) return;
    const elapsed = audioCtx.currentTime - playbackStartTime;
    
    if (elapsed > playbackDuration) {
      if (loopEnabled) {
         playbackStartTime = audioCtx.currentTime;
         scheduleTracks();
      } else {
         stopPlayback();
         return;
      }
    }
    
    // Holt sich die Breite vom ersten Canvas -> Korrekter Balken
    const width = tracks[0].canvas.width; 
    const x = (elapsed / playbackDuration) * width;
    
    tracks.forEach(t => redrawTrack(t, x % width)); 
    animationFrameId = requestAnimationFrame(renderLoop);
  }

  // --- VISUAL RENDERING ---
  function redrawTrack(track, headX) {
    drawGrid(track);
    track.ctx.lineJoin = "round";
    track.ctx.lineCap = "round";

    track.segments.forEach(seg => {
      const pts = seg.points;
      if (pts.length < 2) return;

      // 1. Akkord-Darstellung
      if (seg.brush === "chord") {
        const ivs = chordIntervals[seg.chord] || [0];
        ivs.forEach((iv, i) => {
          track.ctx.strokeStyle = chordColors[i % 4];
          track.ctx.lineWidth = seg.size;
          track.ctx.beginPath();
          const off = iv * 3;
          track.ctx.moveTo(pts[0].x, pts[0].y - off);
          for(let k=1; k<pts.length; k++) track.ctx.lineTo(pts[k].x, pts[k].y - off);
          track.ctx.stroke();
        });
        return; 
      }

      // 2. Andere Pinsel: Spezifisches Rendering
      track.ctx.strokeStyle = "#000";
      track.ctx.fillStyle = "#000";

      for(let i=0; i<pts.length-1; i++) {
        const p1 = pts[i];
        const p2 = pts[i+1];
        
        track.ctx.beginPath();

        if (seg.brush === "bristle") {
           // Borsten: Mehrere feine Linien
           for(let off=-2; off<=2; off++) {
             track.ctx.lineWidth = Math.max(1, seg.size/4);
             track.ctx.globalAlpha = 0.6;
             track.ctx.moveTo(p1.x, p1.y + off*2);
             track.ctx.lineTo(p2.x, p2.y + off*2);
             track.ctx.stroke();
           }
           track.ctx.globalAlpha = 1.0;
        } 
        else if (seg.brush === "calligraphy") {
           // Kalligrafie: Bandzugfeder
           const w = seg.size;
           track.ctx.moveTo(p1.x - w, p1.y + w);
           track.ctx.lineTo(p1.x + w, p1.y - w);
           track.ctx.lineTo(p2.x + w, p2.y - w);
           track.ctx.lineTo(p2.x - w, p2.y + w);
           track.ctx.fill();
        }
        else if (seg.brush === "variable") {
           // Variabel: Dicke basierend auf Abstand
           const dist = Math.hypot(p2.x-p1.x, p2.y-p1.y);
           track.ctx.lineWidth = seg.size * (1 + Math.max(0, (10-dist)/5));
           track.ctx.moveTo(p1.x, p1.y);
           track.ctx.lineTo(p2.x, p2.y);
           track.ctx.stroke();
        }
        else if (seg.brush === "fractal") {
           // Fraktal: Jitter anzeigen
           track.ctx.lineWidth = seg.size;
           track.ctx.moveTo(p1.x + (p1.jX||0), p1.y + (p1.jY||0));
           track.ctx.lineTo(p2.x + (p2.jX||0), p2.y + (p2.jY||0));
           track.ctx.stroke();
        }
        else {
           // Standard
           track.ctx.lineWidth = seg.size;
           track.ctx.moveTo(p1.x, p1.y);
           track.ctx.lineTo(p2.x, p2.y);
           track.ctx.stroke();
        }
      }
    });

    if (headX !== null) {
      track.ctx.strokeStyle = "red";
      track.ctx.lineWidth = 2;
      track.ctx.beginPath();
      track.ctx.moveTo(headX, 0); track.ctx.lineTo(headX, track.canvas.height);
      track.ctx.stroke();
    }
  }

  function drawGrid(track) {
    const ctx = track.ctx;
    const w = track.canvas.width;
    const h = track.canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 1;
    for(let i=0; i<=32; i++) {
       ctx.beginPath(); 
       let x = i*(w/32);
       ctx.moveTo(x,0); ctx.lineTo(x,h);
       if(i%4===0) ctx.lineWidth=2; else ctx.lineWidth=1;
       ctx.stroke();
    }
    for(let j=0; j<4; j++) {
       ctx.beginPath(); ctx.moveTo(0, j*(h/4)); ctx.lineTo(w, j*(h/4)); 
       ctx.lineWidth=1; ctx.stroke();
    }
  }

  function mapYToFreq(y, h) { return 1000 - (y/h)*920; }
  
  function quantize(freq, scale) {
    let midi = 69 + 12*Math.log2(freq/440);
    let r = Math.round(midi);
    let pc = r % 12; 
    let pattern = [0,2,4,5,7,9,11]; 
    if (scale === "minor") pattern = [0,2,3,5,7,8,10];
    if (scale === "pentatonic") pattern = [0,3,5,7,10];
    
    let best = pattern[0];
    let minD = 99;
    pattern.forEach(p => {
       let d = Math.abs(p - pc);
       if(d < minD) { minD = d; best = p; }
    });
    let finalMidi = r - pc + best;
    return 440 * Math.pow(2, (finalMidi-69)/12);
  }

});