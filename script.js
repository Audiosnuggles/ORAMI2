/**
 * THE PIGEON - Final Master
 * - "Particles" (Granular Synthesis)
 * - "Calligraphy" (Dynamic Filtering)
 * - "Fractal" (Distortion & Live-Fix)
 * - "Chords" (Zero Latency)
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

// Distortion Curve für Fractal
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

/* =========================================
   2. DRAWING FUNCTIONS (VISUALS)
   ========================================= */
function drawSegmentStandard(ctx, pts, idx1, idx2, size) {
  ctx.lineWidth = size; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke();
}

function drawSegmentVariable(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  ctx.lineWidth = size * (1 + Math.max(0, (10 - dist) / 5)); // Mehr Dynamik
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}

function drawSegmentCalligraphy(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const angle = -Math.PI / 4; 
  const dx = Math.cos(angle) * size;
  const dy = Math.sin(angle) * size;
  ctx.fillStyle = "#000"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p1.x - dx, p1.y - dy);
  ctx.lineTo(p1.x + dx, p1.y + dy);
  ctx.lineTo(p2.x + dx, p2.y + dy);
  ctx.lineTo(p2.x - dx, p2.y - dy);
  ctx.fill();
}

function drawSegmentParticles(ctx, pts, idx1, idx2, size) {
  // Zeichnet Partikel (Punkte) um die Koordinate
  const p2 = pts[idx2];
  const count = Math.ceil(size / 2);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  for (let i = 0; i < count; i++) {
    const offX = (Math.random() - 0.5) * size * 4;
    const offY = (Math.random() - 0.5) * size * 4;
    ctx.beginPath(); 
    ctx.arc(p2.x + offX, p2.y + offY, 1, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawSegmentFractal(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  ctx.lineWidth = size; ctx.lineCap = "round";
  // WICHTIG: Nutze gespeicherten Jitter, sonst flackert es anders
  ctx.beginPath(); 
  ctx.moveTo(p1.x + (p1.jX||0), p1.y + (p1.jY||0)); 
  ctx.lineTo(p2.x + (p2.jX||0), p2.y + (p2.jY||0)); 
  ctx.stroke();
}

/* =========================================
   3. MAIN LOGIC
   ========================================= */
document.addEventListener("DOMContentLoaded", function() {
  
  let audioCtx = null;
  let masterGain;
  let isPlaying = false;
  let playbackStartTime = 0;
  let playbackDuration = 0;
  let animationFrameId;
  let undoStack = [];

  // Live State
  let liveOscillators = [];
  let liveGainNode = null;
  // Live Calligraphy Filter
  let liveFilterNode = null; 

  const loopCheckbox = document.getElementById("loopCheckbox");
  const toolSelect = document.getElementById("toolSelect");
  const brushSelect = document.getElementById("brushSelect");
  const sizeSlider = document.getElementById("brushSizeSlider");
  const chordSelect = document.getElementById("chordSelect");
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");

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

    container.querySelector(".mute-btn").addEventListener("click", (e) => {
      track.mute = !track.mute;
      e.target.style.backgroundColor = track.mute ? "#ff4444" : "";
      if(track.gainNode) track.gainNode.gain.setTargetAtTime(track.mute ? 0 : track.vol, audioCtx.currentTime, 0.05);
    });

    const slider = container.querySelector(".volume-slider");
    track.vol = parseFloat(slider.value);
    slider.addEventListener("input", e => {
      track.vol = parseFloat(e.target.value);
      if(track.gainNode && !track.mute) track.gainNode.gain.setTargetAtTime(track.vol, audioCtx.currentTime, 0.05);
    });

    container.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    // --- DRAWING ---
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
        if(brush === "fractal") { jX = Math.random()*15-7.5; jY = Math.random()*30-15; }

        currentSegment = {
          points: [{ x, y: pos.y, jX, jY }],
          brush: brush,
          thickness: parseInt(sizeSlider.value),
          chordType: (brush === "chord") ? chordSelect.value : null
        };
        track.segments.push(currentSegment);
        
        // Start Live Sound (Particles starts per point, others continuous)
        if (brush !== "particles") startLiveSynth(track, pos.y);
        else triggerParticleGrain(track, pos.y); // First grain

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
        if(brushSelect.value === "fractal") { jX = Math.random()*15-7.5; jY = Math.random()*30-15; }
        
        currentSegment.points.push({ x, y: pos.y, jX, jY });
        
        // Audio Updates
        if (brushSelect.value === "particles") {
            triggerParticleGrain(track, pos.y); // Trigger grain on move
        } else {
            updateLiveSynth(track, pos.y + jY);
        }

        redrawTrack(track); // Visuals update (includes Fractal line)
      } else if (toolSelect.value === "erase") {
        if(e.buttons === 1 || e.type === "touchmove") erase(track, x, pos.y);
      }
    };

    const end = () => {
      if (drawing) {
        undoStack.push({ trackIdx: track.index, segment: currentSegment });
        if(brushSelect.value !== "particles") stopLiveSynth(brushSelect.value);
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

  // A. Live Continuous Synth (Standard, Calligraphy, Fractal, Chord)
  function startLiveSynth(track, y) {
    if (track.mute || track.vol < 0.01) return;
    liveOscillators = [];
    liveGainNode = audioCtx.createGain();
    liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    liveGainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);

    // Calligraphy Filter Setup
    liveFilterNode = audioCtx.createBiquadFilter();
    liveFilterNode.type = "lowpass";
    liveFilterNode.frequency.value = 20000; // Default Open

    // Connect Chain
    const trackGain = audioCtx.createGain();
    trackGain.gain.value = track.vol;
    
    // Osc -> LiveGain -> Filter -> TrackGain -> Master
    liveGainNode.connect(liveFilterNode).connect(trackGain).connect(masterGain);
    liveGainNode.tempOut = trackGain; // Store for cleanup

    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);

    const brush = brushSelect.value;
    const intervals = (brush === "chord") ? chordIntervals[chordSelect.value] : [0];

    // Filter Logic for Calligraphy (Start)
    if(brush === "calligraphy") {
       const thickness = parseInt(sizeSlider.value);
       // Dick = Dumpf (500Hz), Dünn = Hell (5000Hz)
       const cutoff = Math.max(200, 5000 - (thickness * 150));
       liveFilterNode.frequency.setTargetAtTime(cutoff, audioCtx.currentTime, 0.01);
    }

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
      liveOscillators.push(osc);
    });
  }

  function updateLiveSynth(track, y) {
    if (!liveOscillators.length) return;
    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);
    
    // Pitch Update
    liveOscillators.forEach((osc, i) => {
       const brush = brushSelect.value;
       const intervals = (brush === "chord") ? chordIntervals[chordSelect.value] : [0];
       const iv = intervals[i] || 0; 
       osc.frequency.setTargetAtTime(freq * Math.pow(2, iv/12), audioCtx.currentTime, 0.01);
    });

    // Calligraphy Filter Dynamic Update
    if(brushSelect.value === "calligraphy" && liveFilterNode) {
       // Wir schätzen die "Geschwindigkeit" über den Abstand der letzten Punkte nicht hier,
       // sondern nutzen einfach die statische Dicke oder müssten Speed berechnen.
       // Einfacher: Wir nutzen die aktuelle BrushSize (Variable Pinsel ändert size visuell, aber slider bleibt gleich)
       // Um den Effekt hörbar zu machen, binden wir es an den Slider:
       const thickness = parseInt(sizeSlider.value);
       const cutoff = Math.max(200, 6000 - (thickness * 200));
       liveFilterNode.frequency.setTargetAtTime(cutoff, audioCtx.currentTime, 0.05);
    }
  }

  function stopLiveSynth(brush) {
    if (!liveGainNode) return;
    const now = audioCtx.currentTime;
    // Release
    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, 0.05);
    
    const oscs = liveOscillators;
    const gn = liveGainNode;
    const fn = liveFilterNode;
    const out = liveGainNode.tempOut;
    setTimeout(() => {
      oscs.forEach(o => o.stop());
      gn.disconnect();
      if(fn) fn.disconnect();
      out.disconnect();
    }, 100);
    liveOscillators = [];
    liveGainNode = null;
    liveFilterNode = null;
  }

  // B. Particle Grain Trigger (One-Shot)
  function triggerParticleGrain(track, y) {
    if (track.mute || track.vol < 0.01) return;
    
    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);

    const osc = audioCtx.createOscillator();
    osc.type = track.wave; // Oder "triangle" für weichere Tropfen
    osc.frequency.value = freq;

    const env = audioCtx.createGain();
    env.gain.value = 0;
    
    // Kurzer Pling (Grain)
    const now = audioCtx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.4, now + 0.01); // Attack
    env.gain.exponentialRampToValueAtTime(0.01, now + 0.1); // Decay

    // Track Volume
    const trackGain = audioCtx.createGain();
    trackGain.gain.value = track.vol;

    osc.connect(env).connect(trackGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
    
    // Garbage collection timeout (internal cleanup handle)
    setTimeout(()=>{ trackGain.disconnect(); }, 200);
  }

  // --- SEQUENCER PLAYBACK ---
  function scheduleTracks(start) {
    const scale = document.getElementById("scaleSelect").value;
    
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain();
      track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.mute ? 0 : track.vol;

      track.segments.forEach(seg => {
        
        // 1. PARTICLES (Granular Playback)
        if (seg.brush === "particles" || seg.brush === "bristle") { // Fallback name
            seg.points.forEach(p => {
                const t = start + (p.x / track.canvas.width) * playbackDuration;
                // Schedule grains
                const osc = audioCtx.createOscillator();
                osc.type = track.wave;
                let f = mapY(p.y, track.canvas.height);
                if(harmonizeCheckbox.checked) f = quantize(f);
                osc.frequency.value = f;
                
                const env = audioCtx.createGain();
                env.gain.setValueAtTime(0, t);
                env.gain.linearRampToValueAtTime(0.4, t + 0.01);
                env.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
                
                osc.connect(env).connect(track.gainNode);
                osc.start(t);
                osc.stop(t + 0.15);
            });
            return; // Done for this segment
        }

        // 2. CONTINUOUS BRUSHES
        const sorted = seg.points.slice().sort((a,b)=>a.x-b.x);
        if(sorted.length < 2) return;
        
        const sT = start + (sorted[0].x/track.canvas.width)*playbackDuration;
        const eT = start + (sorted[sorted.length-1].x/track.canvas.width)*playbackDuration;
        
        // CHORDS
        if (seg.brush === "chord" && seg.chordType) {
           const ivs = chordIntervals[seg.chordType] || [0];
           ivs.forEach(iv => {
             const osc = audioCtx.createOscillator();
             osc.type = track.wave;
             const g = audioCtx.createGain();
             g.gain.setValueAtTime(0, sT);
             g.gain.linearRampToValueAtTime(0.2, sT+0.005); // Instant Attack
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

        // STANDARD / CALLIGRAPHY / FRACTAL / VARIABLE
        const osc = audioCtx.createOscillator();
        osc.type = track.wave;
        
        // Filter Setup (for Calligraphy)
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 20000; 

        // Gain Envelope
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, sT);
        g.gain.linearRampToValueAtTime(0.3, sT+0.02);
        g.gain.setValueAtTime(0.3, eT); // Sustain
        g.gain.linearRampToValueAtTime(0, eT+0.1); // Release
        
        let chain = g;
        
        // Fractal Distortion
        if(seg.brush === "fractal") {
          const shaper = audioCtx.createWaveShaper();
          shaper.curve = getDistortionCurve();
          g.connect(shaper); 
          chain = shaper;
        }

        // Apply Filter if Calligraphy
        if (seg.brush === "calligraphy") {
             const cutoff = Math.max(200, 6000 - (seg.thickness * 200));
             filter.frequency.setValueAtTime(cutoff, sT);
             osc.connect(filter).connect(g);
        } else {
             osc.connect(g);
        }

        chain.connect(track.gainNode);

        // Pitch Automation
        sorted.forEach(p => {
           const t = start + (p.x/track.canvas.width)*playbackDuration;
           
           // Fractal Jitter für Audio (muss auch im Playback zappeln!)
           let yVal = p.y;
           if (seg.brush === "fractal") yVal += (p.jY || 0);

           let f = mapY(yVal, track.canvas.height);
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
       if(pts.length < 1) return;
       
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
          // Special drawing for particles
          if(seg.brush === "particles" || seg.brush === "bristle") {
              for(let i=1; i<pts.length; i++) drawSegmentParticles(track.ctx, pts, i-1, i, seg.thickness);
          } else {
              // Standard drawing loop
              for(let i=1; i<pts.length; i++) {
                 switch(seg.brush) {
                   case "variable": drawSegmentVariable(track.ctx, pts, i-1, i, seg.thickness); break;
                   case "calligraphy": drawSegmentCalligraphy(track.ctx, pts, i-1, i, seg.thickness); break;
                   case "fractal": drawSegmentFractal(track.ctx, seg.points, i-1, i, seg.thickness); break;
                   default: drawSegmentStandard(track.ctx, pts, i-1, i, seg.thickness);
                 }
              }
          }
       }
     });
     if(headX !== undefined) {
        track.ctx.strokeStyle = "red"; track.ctx.lineWidth=2;
        track.ctx.beginPath(); track.ctx.moveTo(headX,0); track.ctx.lineTo(headX,100); track.ctx.stroke();
     }
  }

  // --- LOOP & CONTROLS ---
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
    const x = (elapsed/playbackDuration) * 700;
    tracks.forEach(t => redrawTrack(t, x));
    animationFrameId = requestAnimationFrame(loop);
  }

  document.getElementById("playButton").addEventListener("click", () => {
     if(isPlaying) return;
     initAudio();
     const bpm = parseFloat(document.getElementById("bpmInput").value);
     playbackDuration = (60/bpm)*32;
     playbackStartTime = audioCtx.currentTime + 0.1;
     isPlaying = true;
     scheduleTracks(playbackStartTime);
     requestAnimationFrame(loop);
  });
  
  document.getElementById("stopButton").addEventListener("click", () => {
     isPlaying = false;
     tracks.forEach(t => { if(t.gainNode) { t.gainNode.disconnect(); t.gainNode=null; } redrawTrack(t); });
  });

  document.getElementById("clearButton").addEventListener("click", () => {
     tracks.forEach(t => { t.segments = []; redrawTrack(t); });
     undoStack = [];
  });

  document.getElementById("exportButton").addEventListener("click", () => {
     const data = JSON.stringify(tracks.map(t => t.segments));
     const blob = new Blob([data], {type:"application/json"});
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a"); a.href=url; a.download="pigeon.json"; a.click();
  });

  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", (e) => {
     const reader = new FileReader();
     reader.onload = (evt) => {
        const data = JSON.parse(evt.target.result);
        if(Array.isArray(data)) {
           data.forEach((segs, i) => { if(tracks[i]) tracks[i].segments = segs; redrawTrack(tracks[i]); });
        }
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