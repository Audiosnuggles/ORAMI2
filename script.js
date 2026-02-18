// GLOBALE Definition für Chords (Intervalle und Farben)
const chordIntervals = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};
const chordColors = ['#FF5733', '#33FF57', '#3357FF'];

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

  let currentTool = document.getElementById("toolSelect").value;
  let currentBrush = document.getElementById("brushSelect").value;
  let currentBrushSize = parseInt(document.getElementById("brushSizeSlider").value, 10);

  // Steuerungsevents
  document.getElementById("toolSelect").addEventListener("change", e => { currentTool = e.target.value; });
  document.getElementById("brushSelect").addEventListener("change", e => { currentBrush = e.target.value; });
  document.getElementById("brushSizeSlider").addEventListener("input", e => { currentBrushSize = parseInt(e.target.value, 10); });
  document.getElementById("loopCheckbox").addEventListener("change", e => { loopEnabled = e.target.checked; });

  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");
  const scaleSelectContainer = document.getElementById("scaleSelectContainer");
  harmonizeCheckbox.addEventListener("change", () => {
    scaleSelectContainer.style.display = harmonizeCheckbox.checked ? "inline" : "none";
  });

  if(chordElem) {
    chordElem.addEventListener("change", e => { currentChord = e.target.value; });
  }

  const tracks = [
    { canvas: document.getElementById("canvas1"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false, gainNode: null },
    { canvas: document.getElementById("canvas2"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false, gainNode: null },
    { canvas: document.getElementById("canvas3"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false, gainNode: null },
    { canvas: document.getElementById("canvas4"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false, gainNode: null }
  ];

  tracks.forEach((track, index) => {
    track.index = index;
    const container = track.canvas.closest(".track-container");
    track.ctx = track.canvas.getContext("2d");
    drawGrid(track);
    container.querySelector(".legend").innerHTML = generateLegend(track.canvas.height);

    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.waveType = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    container.querySelector(".mute-btn").addEventListener("click", e => {
      track.muted = !track.muted;
      e.target.style.backgroundColor = track.muted ? "#ddd" : "";
      if (track.gainNode && audioCtx) {
        track.gainNode.gain.setTargetAtTime(track.muted ? 0 : 0.5, audioCtx.currentTime, 0.02);
      }
    });

    let drawing = false;
    track.canvas.addEventListener("mousedown", e => {
      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let posX = track.snap ? snapCoordinate(x, track.canvas.width) : x;
      
      if (currentTool === "draw") {
        drawing = true;
        track.currentSegment = {
          points: [{ x: posX, y, fX: (Math.random()-0.5)*10, fY: (Math.random()-0.5)*10 }],
          thickness: currentBrushSize,
          brush: currentBrush,
          chordType: (currentBrush === "chord") ? currentChord : null
        };
        track.segments.push(track.currentSegment);
        
        // ECHTZEIT-AUDIO START (beim Zeichnen)
        if (isPlaying && audioCtx) {
           playLivePoint(track, y, currentBrush);
        }
      } else if (currentTool === "erase") {
        track.segments = track.segments.filter(seg => 
          !seg.points.some(pt => Math.hypot(pt.x - posX, pt.y - y) < 15)
        );
        redrawTrack(track, null);
      }
    });

    track.canvas.addEventListener("mousemove", e => {
      if (!drawing || !track.currentSegment || currentTool !== "draw") return;
      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let posX = track.snap ? snapCoordinate(x, track.canvas.width) : x;
      
      track.currentSegment.points.push({ 
        x: posX, y: y, 
        fX: (Math.random()-0.5)*15, fY: (Math.random()-0.5)*15 
      });

      if (isPlaying && audioCtx) {
         playLivePoint(track, y, currentBrush);
      }
      redrawTrack(track, null);
    });

    track.canvas.addEventListener("mouseup", () => {
      if (drawing) undoStack.push({ trackIndex: track.index, segment: track.currentSegment });
      drawing = false;
      track.currentSegment = null;
    });

    track.canvas.addEventListener("mouseleave", () => {
      drawing = false;
      track.currentSegment = null;
    });
  });

  // Hilfsfunktion für Echtzeit-Sound beim Zeichnen
  function playLivePoint(track, y, brush) {
    if (track.muted) return;
    const freq = mapYToFrequency(y, track.canvas.height);
    const osc = audioCtx.createOscillator();
    osc.type = track.waveType;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
    osc.connect(g).connect(track.gainNode || masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  }

  function redrawTrack(track, markerX) {
    drawGrid(track);
    track.segments.forEach(seg => {
      track.ctx.lineCap = "round";
      if (seg.brush === "chord") {
        drawChordVisual(track.ctx, seg);
      } else {
        track.ctx.strokeStyle = "#000";
        for (let i = 1; i < seg.points.length; i++) {
          renderBrushEffect(track.ctx, seg, i - 1, i);
        }
      }
    });
    if (markerX !== null) {
      track.ctx.strokeStyle = "red";
      track.ctx.lineWidth = 2;
      track.ctx.beginPath();
      track.ctx.moveTo(markerX, 0); track.ctx.lineTo(markerX, track.canvas.height);
      track.ctx.stroke();
    }
  }

  function renderBrushEffect(ctx, seg, i1, i2) {
    const p1 = seg.points[i1], p2 = seg.points[i2];
    ctx.lineWidth = seg.thickness;
    switch(seg.brush) {
      case "variable":
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        ctx.lineWidth = seg.thickness * (1 + Math.max(0, (8 - dist) / 4));
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        break;
      case "calligraphy":
        ctx.lineWidth = seg.thickness * 2;
        ctx.beginPath();
        ctx.moveTo(p1.x - 2, p1.y + 5); ctx.lineTo(p2.x - 2, p2.y + 5);
        ctx.stroke();
        break;
      case "bristle":
        for (let j = -2; j <= 2; j++) {
          ctx.lineWidth = seg.thickness / 3;
          ctx.beginPath(); ctx.moveTo(p1.x + j*2, p1.y + j*2); ctx.lineTo(p2.x + j*2, p2.y + j*2); ctx.stroke();
        }
        break;
      case "fractal":
        ctx.beginPath();
        ctx.moveTo(p1.x + p1.fX, p1.y + p1.fY);
        ctx.lineTo(p2.x + p2.fX, p2.y + p2.fY);
        ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }

  function drawChordVisual(ctx, seg) {
    const avgY = seg.points.reduce((a, b) => a + b.y, 0) / seg.points.length;
    const minX = Math.min(...seg.points.map(p => p.x));
    const maxX = Math.max(...seg.points.map(p => p.x));
    chordIntervals[seg.chordType].forEach((interval, idx) => {
      ctx.strokeStyle = chordColors[idx % chordColors.length];
      ctx.lineWidth = seg.thickness;
      ctx.beginPath();
      ctx.moveTo(minX, avgY - (interval * 4)); ctx.lineTo(maxX, avgY - (interval * 4));
      ctx.stroke();
    });
  }

  function getCanvasCoordinates(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function snapCoordinate(x, width) {
    const step = width / 32;
    return Math.round(x / step) * step;
  }

  function drawGrid(track) {
    const { ctx, canvas } = track;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#eee";
    for (let i = 0; i <= 32; i++) {
      ctx.beginPath();
      ctx.moveTo(i * (canvas.width / 32), 0);
      ctx.lineTo(i * (canvas.width / 32), canvas.height);
      ctx.lineWidth = (i % 4 === 0) ? 2 : 1;
      ctx.stroke();
    }
  }

  function generateLegend(height) {
    return [1000, 500, 250, 80].map(f => `${f}Hz`).join("<br><br>");
  }

  function mapYToFrequency(y, height) {
    return 1000 - ((y / height) * 920);
  }

  function scheduleAudio() {
    tracks.forEach(track => {
      if (!track.gainNode) { track.gainNode = audioCtx.createGain(); track.gainNode.connect(masterGain); }
      track.gainNode.gain.setValueAtTime(track.muted ? 0 : 0.5, audioCtx.currentTime);

      track.segments.forEach(seg => {
        const sorted = seg.points.slice().sort((a,b) => a.x - b.x);
        const start = playbackStartTime + (sorted[0].x / track.canvas.width) * playbackDuration;
        const end = playbackStartTime + (sorted[sorted.length-1].x / track.canvas.width) * playbackDuration;

        if (seg.brush === "chord") {
          const avgY = seg.points.reduce((a, b) => a + b.y, 0) / seg.points.length;
          const rootFreq = mapYToFrequency(avgY, track.canvas.height);
          chordIntervals[seg.chordType].forEach(interval => {
            const osc = audioCtx.createOscillator();
            osc.type = track.waveType;
            osc.frequency.setValueAtTime(rootFreq * Math.pow(2, interval / 12), start);
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.2, start + 0.05);
            g.gain.linearRampToValueAtTime(0, end);
            osc.connect(g).connect(track.gainNode);
            osc.start(start); osc.stop(end);
          });
        } else {
          const osc = audioCtx.createOscillator();
          osc.type = track.waveType;
          const g = audioCtx.createGain();
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.3, start + 0.05);
          g.gain.linearRampToValueAtTime(0, end);
          sorted.forEach(p => {
            osc.frequency.linearRampToValueAtTime(mapYToFrequency(p.y, track.canvas.height), playbackStartTime + (p.x / track.canvas.width) * playbackDuration);
          });
          osc.connect(g).connect(track.gainNode);
          osc.start(start); osc.stop(end);
        }
      });
    });
  }

  function renderLoop() {
    if (!isPlaying) return;
    const elapsed = audioCtx.currentTime - playbackStartTime;
    if (elapsed > playbackDuration) {
      if (loopEnabled) { playbackStartTime = audioCtx.currentTime; scheduleAudio(); }
      else { document.getElementById("stopButton").click(); return; }
    }
    const markerX = (elapsed / playbackDuration) * tracks[0].canvas.width;
    tracks.forEach(t => redrawTrack(t, markerX));
    animationFrameId = requestAnimationFrame(renderLoop);
  }

  document.getElementById("playButton").addEventListener("click", () => {
    if (isPlaying) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.4;
    masterGain.connect(audioCtx.destination);
    playbackDuration = (60 / document.getElementById("bpmInput").value) * 32;
    playbackStartTime = audioCtx.currentTime + 0.1;
    isPlaying = true;
    scheduleAudio(); renderLoop();
  });

  document.getElementById("stopButton").addEventListener("click", () => {
    isPlaying = false;
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    tracks.forEach(t => t.gainNode = null);
    cancelAnimationFrame(animationFrameId);
    tracks.forEach(t => redrawTrack(t, null));
  });

  document.getElementById("clearButton").addEventListener("click", () => {
    tracks.forEach(t => { t.segments = []; redrawTrack(t, null); });
  });
});