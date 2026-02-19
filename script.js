/**
 * THE PIGEON - Final Master v10 (WAV Crash Fix)
 * - Fixt den Bug mit negativen Zeiten (RangeError) beim Audio-Rendering
 * - Automatische Reparatur von korruptem LocalStorage
 */

// --- PATTERN STATE ---
let patternBanks = { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] };
let isSaveMode = false;
let queuedPattern = null;

// --- CONFIG ---
const chordIntervals = { major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7] };
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

let cachedDistortionCurve = null;
function getDistortionCurve() {
  if (cachedDistortionCurve) return cachedDistortionCurve;
  const n = 22050, curve = new Float32Array(n), amount = 80;
  for (let i = 0; i < n; ++i) { let x = i * 2 / n - 1; curve[i] = (3 + amount) * x * 20 * (Math.PI / 180) / (Math.PI + amount * Math.abs(x)); }
  cachedDistortionCurve = curve; return curve;
}

// --- DRAWING ---
function drawSegmentStandard(ctx, pts, idx1, idx2, size) { ctx.lineWidth = size; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke(); }
function drawSegmentVariable(ctx, pts, idx1, idx2, size) { const dist = Math.hypot(pts[idx2].x - pts[idx1].x, pts[idx2].y - pts[idx1].y); ctx.lineWidth = size * (1 + Math.max(0, (10 - dist) / 5)); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x, pts[idx1].y); ctx.lineTo(pts[idx2].x, pts[idx2].y); ctx.stroke(); }
function drawSegmentCalligraphy(ctx, pts, idx1, idx2, size) { const angle = -Math.PI / 4, dx = Math.cos(angle) * size, dy = Math.sin(angle) * size; ctx.fillStyle = "#000"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[idx1].x - dx, pts[idx1].y - dy); ctx.lineTo(pts[idx1].x + dx, pts[idx1].y + dy); ctx.lineTo(pts[idx2].x + dx, pts[idx2].y + dy); ctx.lineTo(pts[idx2].x - dx, pts[idx2].y - dy); ctx.fill(); }
function drawSegmentParticles(ctx, pts, idx1, idx2, size) { ctx.fillStyle = "rgba(0,0,0,0.6)"; for(let i=0; i<1; i++) { const ox = (Math.random()-0.5)*size*2, oy = (Math.random()-0.5)*size*2; ctx.beginPath(); ctx.arc(pts[idx2].x+ox, pts[idx2].y+oy, Math.max(1, size/3), 0, Math.PI*2); ctx.fill(); } }
function drawSegmentFractal(ctx, pts, idx1, idx2, size) { ctx.lineWidth = size; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pts[idx1].x + (pts[idx1].jX||0), pts[idx1].y + (pts[idx1].jY||0)); ctx.lineTo(pts[idx2].x + (pts[idx2].jX||0), pts[idx2].y + (pts[idx2].jY||0)); ctx.stroke(); }

// --- MAIN ---
document.addEventListener("DOMContentLoaded", function() {
  let audioCtx, masterGain, analyser, isPlaying=false;
  let playbackStartTime=0, playbackDuration=0, animationFrameId;
  let undoStack=[], liveNodes=[], liveGainNode=null, liveFilterNode=null;
  let dataArray, lastAvg = 0;

  const toolSelect = document.getElementById("toolSelect");
  const brushSelect = document.getElementById("brushSelect");
  const sizeSlider = document.getElementById("brushSizeSlider");
  const chordSelect = document.getElementById("chordSelect");
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");
  const pigeonImg = document.getElementById("pigeon");

  const tracks = Array.from(document.querySelectorAll(".track-container")).map((c, i) => ({
    index: i, canvas: c.querySelector("canvas"), ctx: c.querySelector("canvas").getContext("2d"),
    segments: [], wave: "sine", mute: false, vol: 0.8, snap: false, gainNode: null
  }));

  // === INIT PATTERN MACHINE (Mit Repair-Funktion) ===
  const savedBanks = localStorage.getItem("pigeonBanks");
  if (savedBanks) {
      try { 
          patternBanks = JSON.parse(savedBanks); 
          updatePadUI(); 
      } catch(e) { 
          console.error("Corrupted LocalStorage repariert!"); 
          localStorage.removeItem("pigeonBanks"); // Löscht die kaputten Daten
          loadFactoryPresets();
      }
  } else {
      loadFactoryPresets();
  }

  function loadFactoryPresets() {
      Promise.all([
          fetch('1.json').then(res => res.json()).catch(() => null),
          fetch('2.json').then(res => res.json()).catch(() => null),
          fetch('3.json').then(res => res.json()).catch(() => null),
          fetch('4.json').then(res => res.json()).catch(() => null)
      ]).then(presets => { patternBanks.A = presets; updatePadUI(); }).catch(err => console.error(err));
  }
  
  const pads = document.querySelectorAll(".pad");
  const saveModeBtn = document.getElementById("saveModeBtn");
  
  function updatePadUI() {
      pads.forEach(pad => {
          const b = pad.dataset.bank, i = parseInt(pad.dataset.idx);
          if (patternBanks[b] && patternBanks[b][i]) pad.classList.add("filled");
          else pad.classList.remove("filled");
      });
  }

  saveModeBtn.addEventListener("click", () => {
      isSaveMode = !isSaveMode;
      saveModeBtn.classList.toggle("active", isSaveMode);
  });

  pads.forEach(pad => {
      pad.addEventListener("click", () => {
          const b = pad.dataset.bank, i = parseInt(pad.dataset.idx);
          if (isSaveMode) {
              patternBanks[b][i] = {
                  settings: { bpm: document.getElementById("bpmInput").value, loop: document.getElementById("loopCheckbox").checked, scale: document.getElementById("scaleSelect").value, harmonize: document.getElementById("harmonizeCheckbox").checked },
                  tracks: tracks.map(t => ({ segments: t.segments, vol: t.vol, mute: t.mute, wave: t.wave, snap: t.snap }))
              };
              localStorage.setItem("pigeonBanks", JSON.stringify(patternBanks)); 
              isSaveMode = false; saveModeBtn.classList.remove("active");
              updatePadUI();
              pads.forEach(p => { p.classList.remove("active"); p.classList.remove("queued"); });
              pad.classList.add("active");
          } else {
              const data = patternBanks[b][i];
              if (data) {
                  if (isPlaying) {
                      queuedPattern = { data: data, pad: pad };
                      pads.forEach(p => p.classList.remove("queued"));
                      pad.classList.add("queued");
                  } else {
                      loadPatternData(data);
                      pads.forEach(p => { p.classList.remove("active"); p.classList.remove("queued"); });
                      pad.classList.add("active");
                  }
              }
          }
      });
  });

  function loadPatternData(d) {
      if(d.settings) {
          document.getElementById("bpmInput").value = d.settings.bpm;
          document.getElementById("loopCheckbox").checked = d.settings.loop;
          document.getElementById("scaleSelect").value = d.settings.scale;
          document.getElementById("harmonizeCheckbox").checked = d.settings.harmonize;
          document.getElementById("scaleSelectContainer").style.display = d.settings.harmonize ? "inline" : "none";
      }
      
      const trackData = d.tracks || d;
      if(Array.isArray(trackData)) {
          trackData.forEach((td, idx) => {
              if(!tracks[idx]) return;
              let t = tracks[idx];
              if (Array.isArray(td)) { t.segments = td; } else {
                  t.segments = td.segments || []; t.vol = td.vol !== undefined ? td.vol : t.vol; t.mute = td.mute !== undefined ? td.mute : t.mute;
                  t.wave = td.wave || t.wave; t.snap = td.snap !== undefined ? td.snap : t.snap;
                  const cont = t.canvas.parentElement;
                  cont.querySelector(".volume-slider").value = t.vol; cont.querySelector(".mute-btn").style.backgroundColor = t.mute ? "#ff4444" : "";
                  cont.querySelector(".snap-checkbox").checked = t.snap;
                  cont.querySelectorAll(".wave-btn").forEach(btn => { btn.classList.toggle("active", btn.dataset.wave === t.wave); });
                  updateTrackVolume(t);
              }
              redrawTrack(t);
          });
      }
      
      if (isPlaying) {
          const bpmVal = parseFloat(document.getElementById("bpmInput").value);
          const bpm = (Number.isFinite(bpmVal) && bpmVal > 10) ? bpmVal : 120;
          playbackDuration = (60/bpm)*32;
      }
  }

  // === TRACK SETUP ===
  tracks.forEach(track => {
    drawGrid(track);
    const cont = track.canvas.parentElement;
    cont.querySelector(".legend").innerHTML = "1k<br><br>500<br><br>250<br><br>80";
    cont.querySelectorAll(".wave-btn").forEach(b => b.addEventListener("click", () => { track.wave = b.dataset.wave; cont.querySelectorAll(".wave-btn").forEach(btn => btn.classList.remove("active")); b.classList.add("active"); }));
    cont.querySelector('.wave-btn[data-wave="sine"]').classList.add("active");
    cont.querySelector(".mute-btn").addEventListener("click", e => { track.mute = !track.mute; e.target.style.backgroundColor = track.mute ? "#ff4444" : ""; updateTrackVolume(track); });
    const slider = cont.querySelector(".volume-slider"); track.vol = parseFloat(slider.value);
    slider.addEventListener("input", e => { track.vol = parseFloat(e.target.value); updateTrackVolume(track); });
    cont.querySelector(".snap-checkbox").addEventListener("change", e => track.snap = e.target.checked);

    let drawing = false, currentSegment = null;
    const start = e => {
      e.preventDefault(); if(!audioCtx) initAudio(); if(audioCtx.state === "suspended") audioCtx.resume();
      const pos = getPos(e, track.canvas); const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
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
      if(!drawing && toolSelect.value!=="erase") return; e.preventDefault();
      const pos = getPos(e, track.canvas); const x = track.snap ? snap(pos.x, track.canvas.width) : pos.x;
      if(toolSelect.value==="draw" && drawing) {
        let jX=0, jY=0; if(brushSelect.value==="fractal"){ jX=Math.random()*20-10; jY=Math.random()*40-20; }
        currentSegment.points.push({x, y:pos.y, jX, jY});
        try { if(brushSelect.value==="particles") triggerParticleGrain(track, pos.y); else updateLiveSynth(track, pos.y+jY); } catch(err) { }
        redrawTrack(track);
      } else if(toolSelect.value==="erase" && (e.buttons===1 || e.type==="touchmove")) erase(track, x, pos.y);
    };
    const end = () => { if(drawing) { undoStack.push({trackIdx:track.index, segment:currentSegment}); if(brushSelect.value!=="particles") stopLiveSynth(brushSelect.value); } drawing = false; currentSegment = null; };
    track.canvas.addEventListener("mousedown", start); track.canvas.addEventListener("mousemove", move);
    track.canvas.addEventListener("mouseup", end); track.canvas.addEventListener("mouseleave", end);
    track.canvas.addEventListener("touchstart", start, {passive:false}); track.canvas.addEventListener("touchmove", move, {passive:false}); track.canvas.addEventListener("touchend", end);
  });

  // --- AUDIO ENGINE ---
  function initAudio() {
    if(audioCtx) return; audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.5;
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 64; dataArray = new Uint8Array(analyser.frequencyBinCount);
    const comp = audioCtx.createDynamicsCompressor();
    masterGain.connect(comp).connect(analyser).connect(audioCtx.destination);
  }

  function startLiveSynth(track, y) {
    if(track.mute || track.vol < 0.01) return;
    liveNodes = []; liveGainNode = audioCtx.createGain(); liveGainNode.gain.setValueAtTime(0, audioCtx.currentTime); liveGainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime+0.01);
    liveFilterNode = audioCtx.createBiquadFilter(); liveFilterNode.type = "lowpass"; liveFilterNode.Q.value = 10; liveFilterNode.frequency.value = 20000;
    const trackGain = audioCtx.createGain(); trackGain.gain.value = track.vol;
    liveGainNode.connect(liveFilterNode).connect(trackGain).connect(masterGain); liveGainNode.tempOut = trackGain;
    let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq);
    const brush = brushSelect.value, intervals = (brush==="chord") ? chordIntervals[chordSelect.value] : [0];
    if(brush==="calligraphy") { const th = parseInt(sizeSlider.value); liveFilterNode.frequency.setValueAtTime(Math.max(100, 5000-(th*250)), audioCtx.currentTime); }
    intervals.forEach(iv => {
      const osc = audioCtx.createOscillator(); osc.type = track.wave; const fVal = freq * Math.pow(2, iv/12);
      if (Number.isFinite(fVal) && fVal > 0) {
          osc.frequency.setValueAtTime(fVal, audioCtx.currentTime); let out = osc;
          if(brush==="fractal") { const shaper = audioCtx.createWaveShaper(); shaper.curve = getDistortionCurve(); osc.connect(shaper); out = shaper; }
          out.connect(liveGainNode); osc.start(); liveNodes.push(osc);
      }
    });
  }

  function updateLiveSynth(track, y) {
    if(!liveNodes || !liveNodes.length) return; let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq);
    liveNodes.forEach((node, i) => {
      if(node.frequency) { const ivs = (brushSelect.value==="chord") ? chordIntervals[chordSelect.value] : [0]; const iv = ivs[i] || 0; const fVal = freq * Math.pow(2, iv/12);
         if (Number.isFinite(fVal) && fVal > 0) node.frequency.setTargetAtTime(fVal, audioCtx.currentTime, 0.02); }
    });
    if(brushSelect.value==="calligraphy" && liveFilterNode) { const th = parseInt(sizeSlider.value); const fVal = Math.max(100, 5000-(th*250)); if (Number.isFinite(fVal)) liveFilterNode.frequency.setTargetAtTime(fVal, audioCtx.currentTime, 0.05); }
  }

  function stopLiveSynth(brush) {
    if(!liveGainNode) return; const now = audioCtx.currentTime; liveGainNode.gain.cancelScheduledValues(now); liveGainNode.gain.setTargetAtTime(0, now, (brush==="chord")?0.005:0.1);
    const nodes=liveNodes, gn=liveGainNode, fn=liveFilterNode, out=liveGainNode.tempOut;
    setTimeout(() => { nodes.forEach(n=>n.stop()); gn.disconnect(); if(fn)fn.disconnect(); out.disconnect(); }, 200);
    liveNodes = []; liveGainNode = null; liveFilterNode = null;
  }

  function triggerParticleGrain(track, y) {
    if(track.mute || track.vol < 0.01) return; let freq = mapY(y, track.canvas.height); if(harmonizeCheckbox.checked) freq = quantize(freq); if(!Number.isFinite(freq) || freq<=0) return;
    const osc = audioCtx.createOscillator(); osc.type = track.wave; osc.frequency.value = freq;
    const env = audioCtx.createGain(); env.gain.setValueAtTime(0, audioCtx.currentTime); env.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime+0.01); env.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime+0.15);
    const tg = audioCtx.createGain(); tg.gain.value = track.vol; osc.connect(env).connect(tg).connect(masterGain);
    osc.start(); osc.stop(audioCtx.currentTime+0.2); setTimeout(()=>tg.disconnect(), 250);
  }

  // --- REFACTORED: Akzeptiert Offline-Context und Sichert negative Zeiten ab (Math.max) ---
  function scheduleTracks(start, targetCtx = audioCtx, targetDest = masterGain) {
    tracks.forEach(track => {
      const trkGain = targetCtx.createGain(); 
      trkGain.connect(targetDest); 
      trkGain.gain.value = track.mute ? 0 : track.vol;
      if (targetCtx === audioCtx) track.gainNode = trkGain;

      track.segments.forEach(seg => {
        if(seg.brush==="particles") {
           seg.points.forEach(p => {
             // FIX: Math.max verhindert negative Zeiten beim Rendering
             const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); 
             if(!Number.isFinite(t)) return;
             const osc = targetCtx.createOscillator(); osc.type = track.wave; let f = mapY(p.y, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f); if(!Number.isFinite(f) || f<=0) return;
             osc.frequency.value = f; const env = targetCtx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.4, t+0.01); env.gain.exponentialRampToValueAtTime(0.01, t+0.15);
             osc.connect(env).connect(trkGain); osc.start(t); osc.stop(t+0.2);
           }); return;
        }
        
        const sorted = seg.points.slice().sort((a,b)=>a.x-b.x); if(sorted.length<2) return;
        
        // FIX: Math.max sichert die Start- und Endzeiten ab
        let sT = start + (sorted[0].x/track.canvas.width)*playbackDuration;
        let eT = start + (sorted[sorted.length-1].x/track.canvas.width)*playbackDuration;
        sT = Math.max(0, sT); 
        eT = Math.max(0, eT);
        if(!Number.isFinite(sT) || !Number.isFinite(eT)) return;

        if(seg.brush==="chord" && seg.chordType) {
           chordIntervals[seg.chordType].forEach(iv => {
             const osc=targetCtx.createOscillator(); osc.type=track.wave; const g=targetCtx.createGain(); g.gain.setValueAtTime(0, sT); g.gain.linearRampToValueAtTime(0.2, sT+0.005); g.gain.setValueAtTime(0.2, eT); g.gain.linearRampToValueAtTime(0, eT+0.05); osc.connect(g).connect(trkGain);
             sorted.forEach(p => { const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); let f = mapY(p.y, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f); const val = f*Math.pow(2, iv/12); if(Number.isFinite(val) && Number.isFinite(t) && val>0) osc.frequency.linearRampToValueAtTime(val, t); });
             osc.start(sT); osc.stop(eT+0.1);
           }); return;
        }
        
        const osc = targetCtx.createOscillator(); osc.type = track.wave; const filter = targetCtx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 10; filter.frequency.value = 20000;
        const g = targetCtx.createGain(); g.gain.setValueAtTime(0, sT); g.gain.linearRampToValueAtTime(0.3, sT+0.02); g.gain.setValueAtTime(0.3, eT); g.gain.linearRampToValueAtTime(0, eT+0.1); 
        if(seg.brush==="fractal"){ const shaper=targetCtx.createWaveShaper(); shaper.curve=getDistortionCurve(); osc.connect(shaper); shaper.connect(g); }
        else if(seg.brush==="calligraphy"){ const cutoff = Math.max(100, 5000-(seg.thickness*250)); filter.frequency.setValueAtTime(cutoff, sT); osc.connect(filter).connect(g); } else { osc.connect(g); }
        g.connect(trkGain);
        sorted.forEach(p => { const t = Math.max(0, start + (p.x/track.canvas.width)*playbackDuration); let yVal = p.y; if(seg.brush==="fractal") yVal+=(p.jY||0); let f = mapY(yVal, track.canvas.height); if(harmonizeCheckbox.checked) f = quantize(f); if(Number.isFinite(f) && Number.isFinite(t) && f>0) osc.frequency.linearRampToValueAtTime(f, t); });
        osc.start(sT); osc.stop(eT+0.2);
      });
    });
  }

  function updatePigeonViz(currentX) {
     if(!analyser || !pigeonImg) return; analyser.getByteFrequencyData(dataArray);
     let sum = 0; for(let i=0; i<dataArray.length; i++) sum += dataArray[i]; const avg = sum / dataArray.length;
     const diff = avg - lastAvg; lastAvg = avg; 
     let isFractalActive = false;
     if (currentX !== undefined) {
         tracks.forEach(t => { if(t.mute) return; t.segments.forEach(seg => { if (seg.brush === "fractal") { const xs = seg.points.map(p => p.x); const minX = Math.min(...xs); const maxX = Math.max(...xs); if (currentX >= minX && currentX <= maxX) isFractalActive = true; } }); });
     }
     let transformStr = "scale(1)", filterStr = "";
     if (isFractalActive) {
         if(avg > 10) { const highEnd = dataArray[dataArray.length-5] || 0; const rOff = (avg/10) * (Math.random()>0.5?1:-1); const bOff = (highEnd/5) * (Math.random()>0.5?1:-1); filterStr = `drop-shadow(${rOff}px 0px 0px rgba(255,0,0,0.7)) drop-shadow(${bOff}px 0px 0px rgba(0,255,255,0.7))`; }
     } else {
         const kickForce = Math.max(0, diff); 
         const squashY = 1 - Math.min(0.5, (kickForce / 100) * 1.9); 
         const stretchX = 1 + Math.min(0.2, (kickForce / 100) * 0.5);
         transformStr = `scale(${stretchX}, ${squashY})`;
     }
     pigeonImg.style.transform = transformStr; pigeonImg.style.filter = filterStr;
  }

  function loop() {
    if(!isPlaying) return; 
    const elapsed = audioCtx.currentTime - playbackStartTime;
    if(elapsed >= playbackDuration) {
       if (queuedPattern) {
           loadPatternData(queuedPattern.data); 
           pads.forEach(p => { p.classList.remove("active"); p.classList.remove("queued"); });
           queuedPattern.pad.classList.add("active"); 
           queuedPattern = null; 
       }
       if(document.getElementById("loopCheckbox").checked) { 
           playbackStartTime = audioCtx.currentTime; 
           scheduleTracks(playbackStartTime); 
       } else { document.getElementById("stopButton").click(); return; }
    }
    const x = (elapsed/playbackDuration) * 750; 
    tracks.forEach(t => redrawTrack(t, x)); 
    updatePigeonViz(x);
    animationFrameId = requestAnimationFrame(loop);
  }

  // --- HELPERS ---
  function getPos(e, c) { const r=c.getBoundingClientRect(), sx=c.width/r.width, sy=c.height/r.height; const cx=e.touches?e.touches[0].clientX:e.clientX, cy=e.touches?e.touches[0].clientY:e.clientY; return {x:(cx-r.left)*sx, y:(cy-r.top)*sy}; }
  function snap(x, w) { return Math.round(x/(w/32))*(w/32); }
  function mapY(y, h) { const val=1000-(y/h)*920; return Math.max(20, Math.min(val, 20000)); } 
  function quantize(f) { if(!Number.isFinite(f) || f<=0) return 440; const s=document.getElementById("scaleSelect").value; let m=69+12*Math.log2(f/440), r=Math.round(m), pat=(s==="major")?[0,2,4,5,7,9,11]:(s==="minor")?[0,2,3,5,7,8,10]:[0,3,5,7,10], mod=r%12, b=pat[0], md=99; pat.forEach(p=>{let d=Math.abs(p-mod); if(d<md){md=d;b=p;}}); return 440*Math.pow(2,(r-mod+b-69)/12); }
  function updateTrackVolume(t) { if(t.gainNode&&audioCtx) t.gainNode.gain.setTargetAtTime(t.mute?0:t.vol, audioCtx.currentTime, 0.05); }
  function drawGrid(t) { t.ctx.clearRect(0,0,t.canvas.width,t.canvas.height); t.ctx.strokeStyle="#eee"; for(let i=0;i<=32;i++){t.ctx.beginPath();let x=i*(t.canvas.width/32);t.ctx.moveTo(x,0);t.ctx.lineTo(x,t.canvas.height);t.ctx.lineWidth=(i%4===0)?2:1;t.ctx.stroke();} }
  function erase(t,x,y) { t.segments=t.segments.filter(s=>!s.points.some(p=>Math.hypot(p.x-x,p.y-y)<20)); redrawTrack(t); }
  function redrawTrack(t,hx) { drawGrid(t); t.segments.forEach(seg => { const pts=seg.points; if(pts.length<1) return; t.ctx.strokeStyle="#000"; t.ctx.fillStyle="#000"; if(seg.brush==="chord" && seg.chordType) { chordIntervals[seg.chordType].forEach((iv,i)=>{ t.ctx.strokeStyle=chordColors[i%3]; t.ctx.lineWidth=seg.thickness; t.ctx.beginPath(); t.ctx.moveTo(pts[0].x, pts[0].y-iv*5); for(let k=1;k<pts.length;k++) t.ctx.lineTo(pts[k].x, pts[k].y-iv*5); t.ctx.stroke(); }); } else if(seg.brush==="particles") { for(let i=1;i<pts.length;i++) drawSegmentParticles(t.ctx, pts, i-1, i, seg.thickness); } else { for(let i=1;i<pts.length;i++) { switch(seg.brush) { case "variable": drawSegmentVariable(t.ctx, pts, i-1, i, seg.thickness); break; case "calligraphy": drawSegmentCalligraphy(t.ctx, pts, i-1, i, seg.thickness); break; case "fractal": drawSegmentFractal(t.ctx, seg.points, i-1, i, seg.thickness); break; default: drawSegmentStandard(t.ctx, pts, i-1, i, seg.thickness); } } } }); if(hx!==undefined){ t.ctx.strokeStyle="red"; t.ctx.lineWidth=2; t.ctx.beginPath(); t.ctx.moveTo(hx,0); t.ctx.lineTo(hx,100); t.ctx.stroke(); } }

  // --- BUTTONS ---
  document.getElementById("playButton").addEventListener("click", () => {
     if(isPlaying) return; initAudio(); if(audioCtx.state==="suspended") audioCtx.resume();
     const bpmVal = parseFloat(document.getElementById("bpmInput").value); const bpm = (Number.isFinite(bpmVal) && bpmVal > 10) ? bpmVal : 120;
     playbackDuration = (60/bpm)*32; playbackStartTime = audioCtx.currentTime+0.1;
     isPlaying=true; scheduleTracks(playbackStartTime); requestAnimationFrame(loop);
  });
  
  document.getElementById("stopButton").addEventListener("click", () => { 
      isPlaying=false; queuedPattern=null; cancelAnimationFrame(animationFrameId); 
      tracks.forEach(t=>{if(t.gainNode){t.gainNode.disconnect();t.gainNode=null;} redrawTrack(t);}); 
      if(pigeonImg) { pigeonImg.style.transform="scale(1)"; pigeonImg.style.filter=""; } 
      pads.forEach(p => p.classList.remove("queued"));
  });
  
  document.getElementById("clearButton").addEventListener("click", () => { 
      tracks.forEach(t=>{t.segments=[]; redrawTrack(t);}); undoStack=[]; 
      pads.forEach(p => { p.classList.remove("active"); p.classList.remove("queued"); }); queuedPattern = null;
  });
  
  document.getElementById("undoButton").addEventListener("click", () => { if(undoStack.length){const o=undoStack.pop(); tracks[o.trackIdx].segments.pop(); redrawTrack(tracks[o.trackIdx]);} });
  
  // === MASTER EXPORT/IMPORT ===
  document.getElementById("exportButton").addEventListener("click", () => {
     const data = { current: { settings: { bpm: document.getElementById("bpmInput").value, loop: document.getElementById("loopCheckbox").checked, scale: document.getElementById("scaleSelect").value, harmonize: document.getElementById("harmonizeCheckbox").checked }, tracks: tracks.map(t => ({ segments: t.segments, vol: t.vol, mute: t.mute, wave: t.wave, snap: t.snap })) }, banks: patternBanks };
     const blob = new Blob([JSON.stringify(data)], {type:"application/json"}); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="pigeon_live_set.json"; a.click();
  });
  
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", e => {
     const r = new FileReader(); r.onload = evt => { 
        try { const d=JSON.parse(evt.target.result); if(d.banks) { patternBanks = d.banks; localStorage.setItem("pigeonBanks", JSON.stringify(patternBanks)); updatePadUI(); }
          const currentData = d.current || d; loadPatternData(currentData);
        } catch(e){ alert("Fehler beim Import"); } 
     }; r.readAsText(e.target.files[0]); e.target.value = '';
  });
  
  harmonizeCheckbox.addEventListener("change", () => document.getElementById("scaleSelectContainer").style.display=harmonizeCheckbox.checked?"inline":"none");

  // === WAV EXPORT ===
  function audioBufferToWav(buffer) {
      let numOfChan = buffer.numberOfChannels, length = buffer.length * numOfChan * 2 + 44, bufferArray = new ArrayBuffer(length), view = new DataView(bufferArray), channels = [], i, sample, offset = 0, pos = 0;
      function setUint16(data) { view.setUint16(offset, data, true); offset += 2; }
      function setUint32(data) { view.setUint32(offset, data, true); offset += 4; }
      setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
      for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
      while(pos < buffer.length) {
          for(i = 0; i < numOfChan; i++) {
              sample = Math.max(-1, Math.min(1, channels[i][pos])); sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
              view.setInt16(offset, sample, true); offset += 2;
          } pos++;
      }
      return new Blob([bufferArray], {type: "audio/wav"});
  }

  document.getElementById("exportWavButton").addEventListener("click", () => {
      const btn = document.getElementById("exportWavButton");
      btn.innerText = "Rendering..."; btn.style.backgroundColor = "#ff4444"; btn.style.color = "#fff";
      
      setTimeout(() => { 
          const targetBpm = parseFloat(document.getElementById("bpmInput").value) || 120;
          const targetDuration = (60/targetBpm)*32;
          
          const tempDuration = playbackDuration;
          playbackDuration = targetDuration;
          
          const sampleRate = 44100;
          const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, sampleRate * targetDuration, sampleRate);
          
          const offlineMaster = offlineCtx.createGain();
          offlineMaster.gain.value = 0.5;
          const comp = offlineCtx.createDynamicsCompressor();
          offlineMaster.connect(comp).connect(offlineCtx.destination);
          
          scheduleTracks(0, offlineCtx, offlineMaster);
          
          offlineCtx.startRendering().then(renderedBuffer => {
              const wavBlob = audioBufferToWav(renderedBuffer);
              const url = URL.createObjectURL(wavBlob);
              const a = document.createElement("a");
              a.style.display = "none";
              a.href = url;
              a.download = `pigeon_loop_${targetBpm}bpm.wav`;
              document.body.appendChild(a);
              a.click();
              
              setTimeout(() => { 
                  document.body.removeChild(a); URL.revokeObjectURL(url); 
                  btn.innerText = "Export WAV"; btn.style.backgroundColor = ""; btn.style.color = "";
              }, 100);
              
              playbackDuration = tempDuration; 
          });
      }, 50);
  });
});