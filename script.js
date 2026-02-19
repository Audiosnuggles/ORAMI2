/**
 * THE PIGEON - Final Master v2
 * - Drawing: Fixed (Particles, Calligraphy 45deg, Fractal Jitter)
 * - Audio: Stable (Anti-Crash, Filters, Noise)
 * - IO: Saves Settings (BPM, Loop, Scale) + Tracks
 */

/* =========================================
   1. CONFIG & GLOBALS
   ========================================= */
const chordIntervals = {
  major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6],
  augmented: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7]
};
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

// AUDIO: Noise Buffer
let cachedNoiseBuffer = null;
function getNoiseBuffer(ctx) {
  if (cachedNoiseBuffer) return cachedNoiseBuffer;
  const size = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < size; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (last + (0.02 * white)) / 1.02;
    last = data[i];
    data[i] *= 3.5; 
  }
  cachedNoiseBuffer = buffer;
  return buffer;
}

// AUDIO: Distortion Curve
let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050, curve = new Float32Array(n), amount = 80;
  for (let i = 0; i < n; ++i) {
    let x = i * 2 / n - 1;
    curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  cachedDistortionCurve = curve;
  return curve;
}

/* =========================================
   2. DRAWING LOGIC
   ========================================= */
function drawSegmentStandard(ctx, pts, idx1, idx2, size) {
  ctx.lineWidth = size; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke();
}
function drawSegmentVariable(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  ctx.lineWidth = size * (1 + Math.max(0, (10 - dist) / 5)); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}
function drawSegmentCalligraphy(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  const angle = -Math.PI / 4, dx = Math.cos(angle) * size, dy = Math.sin(angle) * size;
  ctx.fillStyle = "#000"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p1.x - dx, p1.y - dy); ctx.lineTo(p1.x + dx, p1.y + dy);
  ctx.lineTo(p2.x + dx, p2.y + dy); ctx.lineTo(p2.x - dx, p2.y - dy); ctx.fill();
}
function drawSegmentParticles(ctx, pts, idx1, idx2, size) {
  const p2 = pts[idx2]; ctx.fillStyle = "rgba(0,0,0,0.6)"; 
  for(let i=0; i<1; i++) {
    const ox = (Math.random()-0.5)*size*2, oy = (Math.random()-0.5)*size*2;
    ctx.beginPath(); ctx.arc(p2.x+ox, p2.y+oy, Math.max(1, size/3), 0, Math.PI*2); ctx.fill();
  }
}
function drawSegmentFractal(ctx, pts, idx1, idx2, size) {
  const p1 = pts[idx1], p2 = pts[idx2];
  ctx.lineWidth = size; ctx.lineCap = "round";
  ctx.beginPath(); 
  ctx.moveTo(p1.x + (p1.jX||0), p1.y + (p1.jY||0)); 
  ctx.lineTo(p2.x + (p2.jX||0), p2.y + (p2.jY||0)); 
  ctx.stroke();
}

/* =========================================
   3. MAIN APP LOGIC
   ========================================= */
document.addEventListener("DOMContentLoaded", function() {
  let audioCtx, masterGain, isPlaying=false;
  let playbackStartTime=0, playbackDuration=0, animationFrameId;
  let undoStack=[], liveNodes=[], liveGainNode=null, liveFilterNode=null;

  // UI Refs
  const toolSelect = document.getElementById("toolSelect");
  const brushSelect = document.getElementById("brushSelect");
  const sizeSlider = document.getElementById("brushSizeSlider");
  const chordSelect = document.getElementById("chordSelect");
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");
  const scaleSelect = document.getElementById("scaleSelect");
  const bpmInput = document.getElementById("bpmInput");
  const loopCheckbox = document.getElementById("loopCheckbox");

  const tracks = Array.from(document.querySelectorAll(".track-container")).map((c, i) => ({
    index: i, canvas: c.querySelector("canvas"), ctx: c.querySelector("canvas").getContext("2d"),
    segments: [], wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null
  }));

  tracks.forEach(track => {
    drawGrid(track);
    const cont = track.canvas.parentElement;
    cont.querySelector(".legend").innerHTML = "1k<br><br>500<br><br>250<br><br>80";
    cont.querySelectorAll(".wave-btn").forEach(b => b.addEventListener("click", () => {
      track.wave = b.dataset.wave;
      cont.querySelectorAll(".wave-btn").forEach(btn => btn.classList.remove("active"));
      b.classList.add("active");
    }));
    cont.querySelector('.wave-btn[data-wave="sine"]').classList.add("active");
    
    cont.querySelector(".mute-btn").addEventListener("click", e => {
      track.mute = !track.mute; e.target.style.backgroundColor = track.mute ? "#ff4444" : "";
      updateTrackVolume(track);
    });
    const slider = cont.querySelector(".volume-slider");
    track.vol = parseFloat(slider.value);
    slider.addEventListener("input", e => { track.vol = parseFloat(e.target.value); updateTrackVolume(track); });
    cont.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    // DRAWING
    let drawing = false, currentSegment = null;
    const start = e => {
      e.preventDefault(); if(!audioCtx) initAudio(); if(audioCtx.state === "suspended") audioCtx.resume();
      const pos = getPos(e, track.canvas);
      const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      if(toolSelect.value === "draw") {
        drawing = true;
        let jX=0, jY=0; if(brushSelect.value==="fractal"){ jX=Math.random()*20-10; jY=Math.random()*40-20; }
        currentSegment = { points: [{x, y:pos.y, jX, jY}], brush: brushSelect.value, thickness: parseInt(sizeSlider.value), chordType: (brushSelect.value==="chord")?chordSelect.value:null };
        track.segments.push(currentSegment);
        
        if(brushSelect.value === "particles") triggerParticleGrain(track, pos.y); else startLiveSynth(track, pos.y);
        redrawTrack(track);
      } else erase(track, x, pos.y);
    };
    const move = e => {
      if(!drawing && toolSelect.value!=="erase") return;
      e.preventDefault();
      const pos = getPos(e, track.canvas);
      const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      if(toolSelect.value==="draw" && drawing) {
        let jX=0, jY=0; if(brushSelect.value==="fractal"){ jX=Math.random()*20-10; jY=Math.random()*40-20; }
        currentSegment.points.push({x, y:pos.y, jX, jY});
        if(brushSelect.value==="particles") triggerParticleGrain(track, pos.y); else updateLiveSynth(track, pos.y+jY);
        redrawTrack(track);
      } else if(toolSelect.value==="erase" && (e.buttons===1 || e.type==="touchmove")) erase(track, x, pos.y);
    };
    const end = () => {
      if(drawing) { undoStack.push({trackIdx:track.index, segment:currentSegment}); if(brushSelect.value!=="particles") stopLiveSynth(brushSelect.value); }
      drawing = false; currentSegment = null;
    };
    track.canvas.addEventListener("mousedown", start); track.canvas.addEventListener("mousemove", move);
    track.canvas.addEventListener("mouseup", end); track.canvas.addEventListener("mouseleave", end);
    track.canvas.addEventListener("touchstart", start, {passive:false}); track.canvas.addEventListener("touchmove", move, {passive:false});
    track.canvas.addEventListener("touchend", end);
  });

  // --- AUDIO ---
  function initAudio() {
    if(audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.5;
    const comp = audioCtx.createDynamicsCompressor();
    masterGain.connect(comp).connect(audioCtx.destination);
  }

  function startLiveSynth(track, y) {
    if(track.mute || track.vol < 0.01) return;
    liveNodes = []; liveGainNode = audioCtx.createGain(); liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    liveGainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime+0.01);
    
    liveFilterNode = audioCtx.createBiquadFilter();
    liveFilterNode.type = "lowpass"; liveFilterNode.Q.value = 10; liveFilterNode.frequency.value = 20000;

    const trackGain = audioCtx.createGain(); trackGain.gain.value = track.vol;
    liveGainNode.connect(liveFilterNode).connect(trackGain).connect(masterGain);
    liveGainNode.tempOut = trackGain;

    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);
    const brush = brushSelect.value;
    const intervals = (brush==="chord") ? chordIntervals[chordSelect.value] : [0];

    if(brush==="calligraphy") {
       const th = parseInt(sizeSlider.value);
       liveFilterNode.frequency.setValueAtTime(Math.max(100, 5000-(th*250)), audioCtx.currentTime);
    }

    intervals.forEach(iv => {
      const osc = audioCtx.createOscillator(); osc.type = track.wave;
      const fVal = freq * Math.pow(2, iv/12);
      if (Number.isFinite(fVal) && fVal > 0) {
          osc.frequency.setValueAtTime(fVal, audioCtx.currentTime);
          let out = osc;
          if(brush==="fractal") { const shaper = audioCtx.createWaveShaper(); shaper.curve = getDistortionCurve(); osc.connect(shaper); out = shaper; }
          out.connect(liveGainNode); osc.start(); liveNodes.push(osc);
      }
    });
  }

  function updateLiveSynth(track, y) {
    if(!liveOscillators) return;
    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);
    liveNodes.forEach((node, i) => {
      if(node.frequency) {
         const ivs = (brushSelect.value==="chord") ? chordIntervals[chordSelect.value] : [0];
         const iv = ivs[i] || 0;
         const fVal = freq * Math.pow(2, iv/12);
         if (Number.isFinite(fVal) && fVal > 0) node.frequency.setTargetAtTime(fVal, audioCtx.currentTime, 0.01);
      }
    });
    if(brushSelect.value==="calligraphy" && liveFilterNode) {
       const th = parseInt(sizeSlider.value);
       const fVal = Math.max(100, 5000-(th*250));
       if (Number.isFinite(fVal)) liveFilterNode.frequency.setTargetAtTime(fVal, audioCtx.currentTime, 0.05);
    }
  }

  function stopLiveSynth(brush) {
    if(!liveGainNode) return;
    const now = audioCtx.currentTime;
    liveGainNode.gain.cancelScheduledValues(now);
    liveGainNode.gain.setTargetAtTime(0, now, (brush==="chord")?0.005:0.1);
    const nodes=liveNodes, gn=liveGainNode, fn=liveFilterNode, out=liveGainNode.tempOut;
    setTimeout(() => { nodes.forEach(n=>n.stop()); gn.disconnect(); if(fn)fn.disconnect(); out.disconnect(); }, 200);
    liveNodes = []; liveGainNode = null; liveFilterNode = null;
  }

  function triggerParticleGrain(track, y) {
    if(track.mute || track.vol < 0.01) return;
    let freq = mapY(y, track.canvas.height);
    if(harmonizeCheckbox.checked) freq = quantize(freq);
    if(!Number.isFinite(freq) || freq<=0) return;

    const osc = audioCtx.createOscillator(); osc.type = track.wave; osc.frequency.value = freq;
    const env = audioCtx.createGain(); env.gain.setValueAtTime(0, audioCtx.currentTime);
    env.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime+0.01);
    env.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime+0.15);
    const tg = audioCtx.createGain(); tg.gain.value = track.vol;
    osc.connect(env).connect(tg).connect(masterGain);
    osc.start(); osc.stop(audioCtx.currentTime+0.2);
    setTimeout(()=>tg.disconnect(), 250);
  }

  // --- PLAYBACK ---
  function scheduleTracks(start) {
    tracks.forEach(track => {
      track.gainNode = audioCtx.createGain(); track.gainNode.connect(masterGain);
      track.gainNode.gain.value = track.mute ? 0 : track.vol;
      track.segments.forEach(seg => {
        // PARTICLES
        if(seg.brush==="particles") {
           seg.points.forEach(p => {
             const t = start + (p.x/track.canvas.width)*playbackDuration;
             if(!Number.isFinite(t)) return;
             const osc = audioCtx.createOscillator(); osc.type = track.wave;
             let f = mapY(p.y, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f);
             if(!Number.isFinite(f) || f<=0) return;
             osc.frequency.value = f;
             const env = audioCtx.createGain(); env.gain.setValueAtTime(0, t);
             env.gain.linearRampToValueAtTime(0.4, t+0.01); env.gain.exponentialRampToValueAtTime(0.01, t+0.15);
             osc.connect(env).connect(track.gainNode); osc.start(t); osc.stop(t+0.2);
           });
           return;
        }
        
        // CONTINUOUS
        const sorted = seg.points.slice().sort((a,b)=>a.x-b.x); if(sorted.length<2) return;
        const sT = start + (sorted[0].x/track.canvas.width)*playbackDuration;
        const eT = start + (sorted[sorted.length-1].x/track.canvas.width)*playbackDuration;
        if(!Number.isFinite(sT) || !Number.isFinite(eT)) return;

        // CHORD
        if(seg.brush==="chord" && seg.chordType) {
           chordIntervals[seg.chordType].forEach(iv => {
             const osc=audioCtx.createOscillator(); osc.type=track.wave;
             const g=audioCtx.createGain(); g.gain.setValueAtTime(0, sT);
             g.gain.linearRampToValueAtTime(0.2, sT+0.005); g.gain.setValueAtTime(0.2, eT); g.gain.linearRampToValueAtTime(0, eT+0.05);
             osc.connect(g).connect(track.gainNode);
             sorted.forEach(p => {
                const t = start + (p.x/track.canvas.width)*playbackDuration;
                let f = mapY(p.y, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f);
                const val = f*Math.pow(2, iv/12);
                if(Number.isFinite(val) && Number.isFinite(t) && val>0) osc.frequency.linearRampToValueAtTime(val, t);
             });
             osc.start(sT); osc.stop(eT+0.1);
           });
           return;
        }
        
        // STANDARD/FRACTAL/CALLIGRAPHY
        const osc = audioCtx.createOscillator(); osc.type = track.wave;
        const filter = audioCtx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 10; filter.frequency.value = 20000;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(0, sT);
        g.gain.linearRampToValueAtTime(0.3, sT+0.02); g.gain.setValueAtTime(0.3, eT); g.gain.linearRampToValueAtTime(0, eT+0.1);
        let chain = g;
        if(seg.brush==="fractal"){ const shaper=audioCtx.createWaveShaper(); shaper.curve=getDistortionCurve(); g.connect(shaper); chain=shaper; }
        if(seg.brush==="calligraphy"){ 
            const cutoff = Math.max(100, 5000-(seg.thickness*250));
            filter.frequency.setValueAtTime(cutoff, sT); osc.connect(filter).connect(g); 
        } else { osc.connect(g); }
        chain.connect(track.gainNode);
        sorted.forEach(p => {
           const t = start + (p.x/track.canvas.width)*playbackDuration;
           let yVal = p.y; if(seg.brush==="fractal") yVal+=(p.jY||0);
           let f = mapY(yVal, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f);
           if(Number.isFinite(f) && Number.isFinite(t) && f>0) osc.frequency.linearRampToValueAtTime(f, t);
        });
        osc.start(sT); osc.stop(eT+0.2);
      });
    });
  }

  // --- HELPERS ---
  function getPos(e, c) { const r=c.getBoundingClientRect(), sx=c.width/r.width, sy=c.height/r.height; const cx=e.touches?e.touches[0].clientX:e.clientX, cy=e.touches?e.touches[0].clientY:e.clientY; return {x:(cx-r.left)*sx, y:(cy-r.top)*sy}; }
  function snap(x, w) { return Math.round(x/(w/32))*(w/32); }
  function mapY(y, h) { const val=1000-(y/h)*920; return Math.max(20, Math.min(val, 20000)); } // Clamp
  function quantize(f) { 
      if(!Number.isFinite(f) || f<=0) return 440;
      const s=scaleSelect.value; 
      let m=69+12*Math.log2(f/440), r=Math.round(m), pat=(s==="major")?[0,2,4,5,7,9,11]:(s==="minor")?[0,2,3,5,7,8,10]:[0,3,5,7,10], mod=r%12, b=pat[0], md=99; 
      pat.forEach(p=>{let d=Math.abs(p-mod); if(d<md){md=d;b=p;}}); 
      return 440*Math.pow(2,(r-mod+b-69)/12); 
  }
  function updateTrackVolume(t) { if(t.gainNode&&audioCtx) t.gainNode.gain.setTargetAtTime(t.mute?0:t.vol, audioCtx.currentTime, 0.05); }
  function drawGrid(t) { t.ctx.clearRect(0,0,t.canvas.width,t.canvas.height); t.ctx.strokeStyle="#eee"; for(let i=0;i<=32;i++){t.ctx.beginPath();let x=i*(t.canvas.width/32);t.ctx.moveTo(x,0);t.ctx.lineTo(x,t.canvas.height);t.ctx.lineWidth=(i%4===0)?2:1;t.ctx.stroke();} }
  function erase(t,x,y) { t.segments=t.segments.filter(s=>!s.points.some(p=>Math.hypot(p.x-x,p.y-y)<20)); redrawTrack(t); }
  
  function redrawTrack(t,hx) {
    drawGrid(t);
    t.segments.forEach(seg => {
      const pts=seg.points; if(pts.length<1) return;
      t.ctx.strokeStyle="#000"; t.ctx.fillStyle="#000";
      if(seg.brush==="chord" && seg.chordType) {
         chordIntervals[seg.chordType].forEach((iv,i)=>{
           t.ctx.strokeStyle=chordColors[i%3]; t.ctx.lineWidth=seg.thickness;
           t.ctx.beginPath(); t.ctx.moveTo(pts[0].x, pts[0].y-iv*5);
           for(let k=1;k<pts.length;k++) t.ctx.lineTo(pts[k].x, pts[k].y-iv*5);
           t.ctx.stroke();
         });
      } else if(seg.brush==="particles") {
         for(let i=1;i<pts.length;i++) drawSegmentParticles(t.ctx, pts, i-1, i, seg.thickness);
      } else {
         for(let i=1;i<pts.length;i++) {
            switch(seg.brush) {
              case "variable": drawSegmentVariable(t.ctx, pts, i-1, i, seg.thickness); break;
              case "calligraphy": drawSegmentCalligraphy(t.ctx, pts, i-1, i, seg.thickness); break;
              case "fractal": drawSegmentFractal(t.ctx, seg.points, i-1, i, seg.thickness); break;
              default: drawSegmentStandard(t.ctx, pts, i-1, i, seg.thickness);
            }
         }
      }
    });
    if(hx!==undefined){ t.ctx.strokeStyle="red"; t.ctx.lineWidth=2; t.ctx.beginPath(); t.ctx.moveTo(hx,0); t.ctx.lineTo(hx,100); t.ctx.stroke(); }
  }

  // --- LOOP ---
  function loop() {
    if(!isPlaying) return;
    const elapsed = audioCtx.currentTime - playbackStartTime;
    if(elapsed >= playbackDuration) {
       if(loopCheckbox.checked) {
          playbackStartTime = audioCtx.currentTime + 0.05;
          scheduleTracks(playbackStartTime);
       } else {
          document.getElementById("stopButton").click();
          return;
       }
    }
    const x = (elapsed/playbackDuration) * 750;
    tracks.forEach(t => redrawTrack(t, x));
    animationFrameId = requestAnimationFrame(loop);
  }

  document.getElementById("playButton").addEventListener("click", () => {
     if(isPlaying) return; initAudio(); if(audioCtx.state==="suspended") audioCtx.resume();
     const bpmVal = parseFloat(bpmInput.value);
     const bpm = (Number.isFinite(bpmVal) && bpmVal > 10) ? bpmVal : 120;
     playbackDuration = (60/bpm)*32;
     playbackStartTime = audioCtx.currentTime+0.1;
     isPlaying=true; scheduleTracks(playbackStartTime); requestAnimationFrame(loop);
  });
  document.getElementById("stopButton").addEventListener("click", () => { isPlaying=false; cancelAnimationFrame(animationFrameId); tracks.forEach(t=>{if(t.gainNode){t.gainNode.disconnect();t.gainNode=null;} redrawTrack(t);}); });
  document.getElementById("clearButton").addEventListener("click", () => { tracks.forEach(t=>{t.segments=[]; redrawTrack(t);}); undoStack=[]; });
  document.getElementById("undoButton").addEventListener("click", () => { if(undoStack.length){const o=undoStack.pop(); tracks[o.trackIdx].segments.pop(); redrawTrack(tracks[o.trackIdx]);} });
  
  // EXPORT (Saves Settings + Tracks)
  document.getElementById("exportButton").addEventListener("click", () => {
     const data = {
         settings: { bpm: bpmInput.value, loop: loopCheckbox.checked, scale: scaleSelect.value, harmonize: harmonizeCheckbox.checked },
         tracks: tracks.map(t => t.segments)
     };
     const blob = new Blob([JSON.stringify(data)], {type:"application/json"});
     const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="pigeon.json"; a.click();
  });

  // IMPORT (Loads Settings + Tracks)
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", e => {
     const r = new FileReader(); r.onload = evt => { 
        try { 
          const d=JSON.parse(evt.target.result); 
          if(d.settings) {
              bpmInput.value = d.settings.bpm;
              loopCheckbox.checked = d.settings.loop;
              scaleSelect.value = d.settings.scale;
              harmonizeCheckbox.checked = d.settings.harmonize;
              document.getElementById("scaleSelectContainer").style.display = d.settings.harmonize ? "inline" : "none";
          }
          const segs = d.tracks || d;
          if(Array.isArray(segs)) segs.forEach((s,i)=>{if(tracks[i])tracks[i].segments=s;redrawTrack(tracks[i]);});
        } catch(e){ alert("Fehler beim Import"); } 
     }; 
     r.readAsText(e.target.files[0]);
     e.target.value = ''; // Reset input
  });

  harmonizeCheckbox.addEventListener("change", () => document.getElementById("scaleSelectContainer").style.display=harmonizeCheckbox.checked?"inline":"none");
});