/**
 * THE PIGEON - Final Master Version
 * Fixes: 
 * 1. Infinite Sustain for long lines (no early cutoff)
 * 2. Real Fixed-Angle Calligraphy (Ribbon effect)
 * 3. Animated Atmosphere/Noise for Bristle
 * 4. Matched Fractal Sound (Live == Playback)
 */

/* =========================================
   1. CONFIG & GLOBALS
   ========================================= */
const chordIntervals = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

/* =========================================
   2. AUDIO UTILITIES
   ========================================= */
let cachedNoiseBuffer = null;
function getNoiseBuffer(ctx) {
  if (cachedNoiseBuffer) return cachedNoiseBuffer;
  // 5 Sekunden Puffer für Variation
  const bufferSize = ctx.sampleRate * 5; 
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Pink Noise Annäherung (wärmer als White Noise)
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5; 
  }
  cachedNoiseBuffer = buffer;
  return buffer;
}
let lastOut = 0;

let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050;
  const curve = new Float32Array(n);
  const amount = 50; 
  for (let i = 0; i < n; ++i) {
    let x = i * 2 / n - 1;
    curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  cachedDistortionCurve = curve;
  return curve;
}

/* =========================================
   3. DRAWING LOGIC (VISUAL FIXES)
   ========================================= */
function drawSegmentStandard(ctx, pts, idx1, idx2, size) {
  ctx.lineWidth = size; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke();
}

function drawSegmentVariable(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  ctx.lineWidth = size * (1 + Math.max(0, (10 - dist) / 10));
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}

// FIX: Kalligrafie mit festem 45° Winkel (Bandzugfeder)
function drawSegmentCalligraphy(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const angle = -Math.PI / 4; // 45 Grad fest
  const dx = Math.cos(angle) * size;
  const dy = Math.sin(angle) * size;
  
  ctx.fillStyle = "#000";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Zeichnet ein Polygon (Band) zwischen den Punkten
  ctx.moveTo(p1.x - dx, p1.y - dy);
  ctx.lineTo(p1.x + dx, p1.y + dy);
  ctx.lineTo(p2.x + dx, p2.y + dy);
  ctx.lineTo(p2.x - dx, p2.y - dy);
  ctx.fill();
}

function drawSegmentBristle(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const count = 5;
  ctx.lineWidth = Math.max(1, size * 0.3); 
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < count; i++) {
    // Random Offset simuliert einzelne Haare
    const offX = (Math.random() - 0.5) * size * 3;
    const offY = (Math.random() - 0.5) * size * 3;
    ctx.beginPath(); 
    ctx.moveTo(p1.x + offX, p1.y + offY); 
    ctx.lineTo(p2.x + offX, p2.y + offY); 
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
}

function drawSegmentFractal(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  ctx.lineWidth = size; ctx.lineCap = "round";
  ctx.beginPath(); 
  // Jitter-Koordinaten nutzen
  ctx.moveTo(p1.x + (p1.jX||0), p1.y + (p1.jY||0)); 
  ctx.lineTo(p2.x + (p2.jX||0), p2.y + (p2.jY||0)); 
  ctx.stroke();
}

/* =========================================
   4. MAIN APP LOGIC
   ========================================= */
document.addEventListener("DOMContentLoaded", function() {
  
  let audioCtx = null;
  let masterGain;
  let isPlaying = false;
  let playbackStartTime = 0;
  let playbackDuration = 0;
  let animationFrameId;
  let undoStack = [];

  // Live Synth State
  let liveNodes = [];
  let liveGainNode = null;

  // UI
  const loopCheckbox = document.getElementById("loopCheckbox");
  const toolSelect = document.getElementById("toolSelect");
  const brushSelect = document.getElementById("brushSelect");
  const sizeSlider = document.getElementById("brushSizeSlider");
  const chordSelect = document.getElementById("chordSelect");
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");

  // --- INITIALIZATION ---
  const tracks = Array.from(document.querySelectorAll(".track-container")).map((container, idx) => ({
    index: idx,
    canvas: container.querySelector("canvas"),
    ctx: container.querySelector("canvas").getContext("2d"),
    segments: [],
    wave: "sine",
    mute: false,
    vol: 0.8,
    snap: false,
    gainNode: null
  }));

  tracks.forEach(track => {
    drawGrid(track);
    const container = track.canvas.parentElement;
    container.querySelector(".legend").innerHTML = "1k<br><br>500<br><br>250<br><br>80";

    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.wave = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    container.querySelector('.wave-btn[data-wave="sine"]').classList.add("active");

    // Mute/Volume
    const muteBtn = container.querySelector(".mute-btn");
    muteBtn.addEventListener("click", () => {
      track.mute = !track.mute;
      muteBtn.style.backgroundColor = track.mute ? "#ff4444" : "";
      updateTrackVolume(track);
    });
    const slider = container.querySelector(".volume-slider");
    track.vol = parseFloat(slider.value);
    slider.addEventListener("input", e => {
      track.vol = parseFloat(e.target.value);
      updateTrackVolume(track);
    });

    // Snap
    container.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    // --- INTERACTION ---
    let drawing = false;
    let currentSegment = null;

    const start = (e) => {
      e.preventDefault();
      if (!audioCtx) initAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const pos = getPos(e, track.canvas);
      const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      const brush = brushSelect.value;

      if (toolSelect.value === "draw") {
        drawing = true;
        let jX = 0, jY = 0;
        if(brush === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }

        currentSegment = {
          points: [{ x, y: pos.y, jX, jY }],
          brush: brush,
          thickness: parseInt(sizeSlider.value),
          chordType: (brush === "chord") ? chordSelect.value : null
        };
        track.segments.push(currentSegment);
        startLiveSynth(track, pos.y);
        redrawTrack(track);
      } else {
        erase(track, x, pos.y);
      }
    };

    const move = (e) => {
      if (!drawing && toolSelect.value !== "erase") return;
      e.preventDefault();
      const pos = getPos(e, track.canvas);
      const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;

      if (toolSelect.value === "draw" && drawing) {
        let jX = 0, jY = 0;
        if(brushSelect.value === "fractal") { jX = Math.random()*10-5; jY = Math.random()*20-10; }
        
        currentSegment.points.push({ x, y: pos.y, jX, jY });
        updateLiveSynth(track, pos.y + jY);
        redrawTrack(track);
      } else if (toolSelect.value === "erase") {
        if(e.buttons === 1 || e.type === "touchmove") erase(track, x, pos.y);
      }
    };

    const end = () => {
      if (drawing) {
        undoStack.push({ trackIdx: track.index, segment: currentSegment });
        stopLiveSynth(brushSelect.value);
      }
      drawing = false;
      currentSegment = null;
    };

    track.canvas.addEventListener("mousedown", start);
    track.canvas.addEventListener("mousemove", move);
    track.canvas.addEventListener("mouseup", end);
    track.canvas.addEventListener("mouseleave", end);
    track.canvas.addEventListener("touchstart", start, {passive:false});
    track.canvas.addEventListener("touchmove", move, {passive:false});
    track.canvas.addEventListener("touchend", end);
  });

  // --- AUDIO ENGINE ---
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;
    const comp = audioCtx.createDynamicsCompressor();
    masterGain.connect(comp).connect(audioCtx.destination);
  }

  function startLiveSynth(track, y) {
    if (track.mute || track.vol < 0.01) return;
    liveNodes = [];
    liveGainNode = audioCtx.createGain();
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    liveGainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);

    const trackGain = audioCtx.createGain();
    trackGain.gain.value = track.vol;
    liveGainNode.connect(trackGain).connect(masterGain);
    liveGainNode.tempOut = trackGain;

    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);

    const brush = brushSelect.value;
    const intervals = (brush === "chord") ? chordIntervals[chordSelect.value] : [0];

    // OSCILLATORS
    intervals.forEach(iv => {
      const osc = audioCtx.createOscillator();
      osc.type = track.wave;
      osc.frequency.setValueAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime);
      
      let out = osc;
      if (brush === "fractal") {
        const shaper = audioCtx.createWaveShaper();
        shaper.curve = getDistortionCurve();
        osc.connect(shaper);
        out = shaper;
      }
      out.connect(liveGainNode);
      osc.start();
      liveNodes.push(osc);
    });

    // BRISTLE NOISE
    if (brush === "bristle") {
        const noise = audioCtx.createBufferSource();
        noise.buffer = getNoiseBuffer(audioCtx);
        noise.loop = true;
        const nFilter = audioCtx.createBiquadFilter();
        nFilter.type = "bandpass";
        nFilter.frequency.value = freq * 2; // Brightness follows pitch
        const nGain = audioCtx.createGain();
        nGain.gain.value = 0.5; 
        
        noise.connect(nFilter).connect(nGain).connect(liveGainNode);
        noise.start();
        liveNodes.push(noise);
    }
  }

  function updateLiveSynth(track, y) {
    if (!liveNodes.length) return;
    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);
    
    liveNodes.forEach((node, i) => {
      if(node.frequency && node.type !== "triangle") { 
         // Oszillator Pitch Update
         const brush = brushSelect.value;
         const intervals = (brush === "chord") ? chordIntervals[chordSelect.value] : [0];
         // Simple Index-Mapping für Chords, ignoriert Noise Nodes
         const iv = (brush === "chord" && intervals[i]) ? intervals[i] : 0;
         node.frequency.setTargetAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime, 0.01);
      }
      // Update Filter Frequency für Noise (Bristle)
      if (node instanceof BiquadFilterNode) {
          node.frequency.setTargetAtTime(freq * 2, audioCtx.currentTime, 0.01);
      }
    });
  }

  function stopLiveSynth(brush) {
    if (!liveGainNode) return;
    const now = audioCtx.currentTime;
    let release = (brush === "chord") ? 0.005 : 0.1;
    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, release);
    
    const nodes = liveNodes;
    const gn = liveGainNode;
    const out = liveGainNode.tempOut;
    setTimeout(() => {
      nodes.forEach(n => n.stop && n.stop());
      gn.disconnect();
      out.disconnect();
    }, release * 1000 + 100);
    liveNodes = [];
    liveGainNode = null;
  }

  function scheduleTracks(start) {
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain();
      track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.mute ? 0 : track.vol;

      track.segments.forEach(seg => {
        const sorted = seg.points.slice().sort((a,b)=>a.x-b.x);
        if(sorted.length < 2) return;
        
        const sT = start + (sorted[0].x/track.canvas.width)*playbackDuration;
        const eT = start + (sorted[sorted.length-1].x/track.canvas.width)*playbackDuration;
        
        // FIX 1: LANGE STRICHE HALTEN (Sustain statt Fade)
        // Envelope: Attack -> Sustain -> Release (nach eT)
        
        // --- CHORD LOGIC ---
        if (seg.brush === "chord" && seg.chordType) {
           const ivs = chordIntervals[seg.chordType] || [0];
           ivs.forEach(iv => {
             const osc = audioCtx.createOscillator();
             osc.type = track.wave;
             const g = audioCtx.createGain();
             
             // ENVELOPE FIX
             g.gain.setValueAtTime(0, sT);
             g.gain.linearRampToValueAtTime(0.2, sT+0.01); // Fast Attack
             g.gain.setValueAtTime(0.2, eT); // Sustain
             g.gain.linearRampToValueAtTime(0, eT+0.05); // Release
             
             osc.connect(g).connect(track.gainNode);
             
             sorted.forEach(p => {
               const t = start + (p.x/track.canvas.width)*playbackDuration;
               let f = mapY(p.y, track.canvas.height);
               if(harmonizeCheckbox.checked) f = quantize(f);
               osc.frequency.linearRampToValueAtTime(f * Math.pow(2, iv/12), t);
             });
             osc.start(sT); osc.stop(eT+0.1);
           });
           return;
        }

        // --- STANDARD LOGIC ---
        const osc = audioCtx.createOscillator();
        osc.type = track.wave;
        const g = audioCtx.createGain();
        
        // ENVELOPE FIX (Sustain)
        g.gain.setValueAtTime(0, sT);
        g.gain.linearRampToValueAtTime(0.3, sT+0.02);
        g.gain.setValueAtTime(0.3, eT);
        g.gain.linearRampToValueAtTime(0, eT+0.1);
        
        let out = g;
        if(seg.brush === "fractal") {
          const shaper = audioCtx.createWaveShaper();
          shaper.curve = getDistortionCurve();
          g.connect(shaper); out = shaper;
        }

        // --- BRISTLE ATMOSPHERE (Animated) ---
        if(seg.brush === "bristle") {
          const noise = audioCtx.createBufferSource();
          noise.buffer = getNoiseBuffer(audioCtx);
          noise.loop = true;
          
          const nFilter = audioCtx.createBiquadFilter();
          nFilter.type = "bandpass";
          nFilter.Q.value = 1.0;
          
          // LFO für Bewegung
          const lfo = audioCtx.createOscillator();
          lfo.type = "triangle";
          lfo.frequency.value = 6; // 6Hz Wabern
          const lfoG = audioCtx.createGain();
          lfoG.gain.value = 600; // Modulationstiefe
          lfo.connect(lfoG).connect(nFilter.frequency);
          lfo.start(sT); lfo.stop(eT+0.1);

          const nGain = audioCtx.createGain();
          nGain.gain.setValueAtTime(0, sT);
          nGain.gain.linearRampToValueAtTime(0.4, sT+0.05);
          nGain.gain.setValueAtTime(0.4, eT);
          nGain.gain.linearRampToValueAtTime(0, eT+0.1);

          // Filter folgt der Pitch-Kurve
          sorted.forEach(p => {
             const t = start + (p.x/track.canvas.width)*playbackDuration;
             let f = mapY(p.y, track.canvas.height);
             nFilter.frequency.linearRampToValueAtTime(f * 2, t);
          });

          noise.connect(nFilter).connect(nGain).connect(track.gainNode);
          noise.start(sT); noise.stop(eT+0.1);
        }

        osc.connect(out).connect(track.gainNode);

        sorted.forEach(p => {
           const t = start + (p.x/track.canvas.width)*playbackDuration;
           let f = mapY(p.y, track.canvas.height);
           if(harmonizeCheckbox.checked) f = quantize(f);
           osc.frequency.linearRampToValueAtTime(f, t);
        });
        osc.start(sT); osc.stop(eT+0.1);
      });
    });
  }

  // --- HELPERS ---
  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  }
  function snap(x, w) { return Math.round(x / (w/32)) * (w/32); }
  function mapY(y, h) { return 1000 - (y/h)*920; }
  function quantize(freq) {
    const scale = document.getElementById("scaleSelect").value;
    let midi = 69 + 12 * Math.log2(freq / 440);
    let r = Math.round(midi);
    let pattern = (scale==="major")?[0,2,4,5,7,9,11]:(scale==="minor")?[0,2,3,5,7,8,10]:[0,3,5,7,10];
    let mod = r % 12;
    let best = pattern[0], minD = 99;
    pattern.forEach(p => {
       let diff = Math.abs(p-mod);
       if(diff < minD) { minD = diff; best = p; }
    });
    return 440 * Math.pow(2, (r - mod + best - 69)/12);
  }
  function updateTrackVolume(track) {
    if(track.gainNode && audioCtx) {
       track.gainNode.gain.setTargetAtTime(track.mute ? 0 : track.vol, audioCtx.currentTime, 0.05);
    }
  }
  function drawGrid(track) {
    const ctx = track.ctx;
    ctx.clearRect(0,0,track.canvas.width, track.canvas.height);
    ctx.strokeStyle = "#eee";
    for(let i=0; i<=32; i++) {
       ctx.beginPath(); let x = i*(track.canvas.width/32);
       ctx.moveTo(x,0); ctx.lineTo(x,track.canvas.height);
       ctx.lineWidth=(i%4===0)?2:1; ctx.stroke();
    }
  }
  function erase(track, x, y) {
     track.segments = track.segments.filter(s => !s.points.some(p => Math.hypot(p.x-x, p.y-y) < 20));
     redrawTrack(track);
  }
  function redrawTrack(track, headX) {
     drawGrid(track);
     track.segments.forEach(seg => {
       const pts = seg.points;
       if(pts.length < 2) return;
       
       if(seg.brush === "chord" && seg.chordType) {
          const ivs = chordIntervals[seg.chordType];
          const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
          const avgY = ys.reduce((a,b)=>a+b,0)/ys.length;
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          track.ctx.strokeStyle = "#000"; track.ctx.lineWidth = seg.thickness;
          ivs.forEach((iv, i) => {
             track.ctx.strokeStyle = chordColors[i%3];
             track.ctx.beginPath(); 
             track.ctx.moveTo(minX, avgY - iv*5); 
             track.ctx.lineTo(maxX, avgY - iv*5); 
             track.ctx.stroke();
          });
       } else {
          track.ctx.strokeStyle = "#000"; 
          // FIX: Zeichnet die komplette Linie neu (kein "live only" draw)
          for(let i=1; i<pts.length; i++) {
             switch(seg.brush) {
               case "variable": drawSegmentVariable(track.ctx, pts, i-1, i, seg.thickness); break;
               case "calligraphy": drawSegmentCalligraphy(track.ctx, pts, i-1, i, seg.thickness); break;
               case "bristle": drawSegmentBristle(track.ctx, pts, i-1, i, seg.thickness); break;
               case "fractal": drawSegmentFractal(track.ctx, seg, i-1, i, seg.thickness); break;
               default: drawSegmentStandard(track.ctx, pts, i-1, i, seg.thickness);
             }
          }
       }
     });
     if(headX !== undefined && headX !== null) {
        track.ctx.strokeStyle = "red"; track.ctx.lineWidth=2;
        track.ctx.beginPath(); track.ctx.moveTo(headX,0); track.ctx.lineTo(headX,track.canvas.height); track.ctx.stroke();
     }
  }

  // --- LOOP & BUTTONS ---
  function loop() {
    if(!isPlaying) return;
    const elapsed = audioCtx.currentTime - playbackStartTime;
    if(elapsed >= playbackDuration) {
       if(loopEnabled) {
          playbackStartTime = audioCtx.currentTime + 0.05;
          scheduleTracks(playbackStartTime);
       } else {
          document.getElementById("stopButton").click();
          return;
       }
    }
    const x = (elapsed/playbackDuration) * tracks[0].canvas.width;
    tracks.forEach(t => redrawTrack(t, x));
    animationFrameId = requestAnimationFrame(loop);
  }

  document.getElementById("playButton").addEventListener("click", () => {
    if(isPlaying) return;
    initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const bpm = parseFloat(document.getElementById("bpmInput").value);
    playbackDuration = (60/bpm)*32;
    playbackStartTime = audioCtx.currentTime + 0.1;
    isPlaying = true;
    scheduleTracks(playbackStartTime);
    requestAnimationFrame(loop);
  });
  
  document.getElementById("stopButton").addEventListener("click", () => {
     isPlaying = false;
     cancelAnimationFrame(animationFrameId);
     tracks.forEach(t => { if(t.gainNode) { t.gainNode.disconnect(); t.gainNode=null; } redrawTrack(t); });
  });

  document.getElementById("clearButton").addEventListener("click", () => {
     tracks.forEach(t => { t.segments = []; redrawTrack(t); });
     undoStack = [];
  });

  document.getElementById("exportButton").addEventListener("click", () => {
     const data = JSON.stringify({ tracks: tracks.map(t => t.segments) });
     const blob = new Blob([data], {type:"application/json"});
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a"); a.href=url; a.download="pigeon.json"; a.click();
  });

  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", (e) => {
     const reader = new FileReader();
     reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if(data.tracks) {
             data.tracks.forEach((segs, i) => { if(tracks[i]) tracks[i].segments = segs; redrawTrack(tracks[i]); });
          }
        } catch(err) { console.error(err); }
     };
     reader.readAsText(e.target.files[0]);
  });

  document.getElementById("undoButton").addEventListener("click", () => {
     if(undoStack.length) {
        const item = undoStack.pop();
        tracks[item.trackIdx].segments.pop();
        redrawTrack(tracks[item.trackIdx]);
     }
  });

  harmonizeCheckbox.addEventListener("change", () => {
    document.getElementById("scaleSelectContainer").style.display = harmonizeCheckbox.checked ? "inline" : "none";
  });
});