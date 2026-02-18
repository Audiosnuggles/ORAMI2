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
  // Element sicher abrufen – falls nicht vorhanden, Standard "major"
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
  document.getElementById("toolSelect").addEventListener("change", e => {
    currentTool = e.target.value;
  });
  document.getElementById("brushSelect").addEventListener("change", e => {
    currentBrush = e.target.value;
  });
  document.getElementById("brushSizeSlider").addEventListener("input", e => {
    currentBrushSize = parseInt(e.target.value, 10);
  });
  document.getElementById("bpmInput").addEventListener("change", e => {
    if (isPlaying) document.getElementById("stopButton").click();
  });
  const harmonizeCheckbox = document.getElementById("harmonizeCheckbox");
  const scaleSelectContainer = document.getElementById("scaleSelectContainer");
  harmonizeCheckbox.addEventListener("change", () => {
    scaleSelectContainer.style.display = harmonizeCheckbox.checked ? "inline" : "none";
  });
  if(chordElem) {
    chordElem.addEventListener("change", function(e) {
      currentChord = e.target.value;
    });
  }

  // Tracks definieren
  const tracks = [
    { canvas: document.getElementById("canvas1"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false },
    { canvas: document.getElementById("canvas2"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false },
    { canvas: document.getElementById("canvas3"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false },
    { canvas: document.getElementById("canvas4"), segments: [], currentSegment: null, waveType: "sine", muted: false, snap: false }
  ];
  tracks.forEach((track, index) => { track.index = index; });

  // Für jeden Track: Grid, Legende und Canvas-Events
  document.querySelectorAll(".track-container").forEach((container, idx) => {
    const track = tracks[idx];
    const ctx = track.canvas.getContext("2d");
    track.ctx = ctx;
    drawGrid(track);
    container.querySelector(".legend").innerHTML = generateLegend(track.canvas.height);
    container.querySelectorAll(".wave-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        track.waveType = btn.dataset.wave;
        container.querySelectorAll(".wave-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    const defaultBtn = container.querySelector('.wave-btn[data-wave="sine"]');
    if (defaultBtn) defaultBtn.classList.add("active");
    const muteButton = container.querySelector(".mute-btn");
    muteButton.addEventListener("click", () => {
      track.muted = !track.muted;
      muteButton.style.backgroundColor = track.muted ? "#ddd" : "";
      muteButton.style.border = track.muted ? "2px solid #333" : "";
    });
    const snapCheckbox = container.querySelector(".snap-checkbox");
    snapCheckbox.addEventListener("change", e => {
      track.snap = e.target.checked;
    });

    let drawing = false;
    track.canvas.addEventListener("mousedown", function(e) {
      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let snapX = track.snap ? snapCoordinate(x, track.canvas.width) : x;
      if (currentTool === "draw") {
        drawing = true;
        track.currentSegment = {
          points: [{ x: snapX, y, brush: currentBrush, chordType: (currentBrush === "chord") ? currentChord : null }],
          thickness: currentBrushSize,
          brush: currentBrush,
          chordType: (currentBrush === "chord") ? currentChord : null
        };
        track.segments.push(track.currentSegment);
        redrawTrack(track, null);
      } else if (currentTool === "erase") {
        const eraseRadius = 10;
        track.segments = track.segments.filter(segment => {
          return !segment.points.some(pt => Math.hypot(pt.x - snapX, pt.y - y) < eraseRadius);
        });
        redrawTrack(track, null);
      }
    });
    track.canvas.addEventListener("mousemove", function(e) {
      if (currentTool !== "draw" || !drawing) return;
      const { x, y } = getCanvasCoordinates(e, track.canvas);
      let snapX = track.snap ? snapCoordinate(x, track.canvas.width) : x;
      const seg = track.currentSegment;
      seg.points.push({ x: snapX, y });
      // Bei Nicht-Chord-Pinseltypen: Zeichne direkt den letzten Abschnitt
      if (seg.brush !== "chord") {
        switch(seg.brush) {
          case "variable":
            drawSegmentVariable(ctx, seg, seg.points.length - 2, seg.points.length - 1, currentBrushSize);
            break;
          case "calligraphy":
            drawSegmentCalligraphy(ctx, seg, seg.points.length - 2, seg.points.length - 1, currentBrushSize);
            break;
          case "bristle":
            drawSegmentBristle(ctx, seg, seg.points.length - 2, seg.points.length - 1, currentBrushSize);
            break;
          case "fractal":
            drawSegmentFractal(ctx, seg, seg.points.length - 2, seg.points.length - 1, currentBrushSize);
            break;
          default:
            drawSegmentStandard(ctx, seg, seg.points.length - 2, seg.points.length - 1, currentBrushSize);
        }
      }
      redrawTrack(track, null);
    });
    track.canvas.addEventListener("mouseup", function() {
      if (currentTool === "draw" && track.currentSegment) {
        undoStack.push({ trackIndex: track.index, segment: track.currentSegment });
        redoStack = [];
      }
      drawing = false;
      track.currentSegment = null;
    });
    track.canvas.addEventListener("mouseleave", function() {
      drawing = false;
      track.currentSegment = null;
    });
  });

  // Hilfsfunktionen
  function getCanvasCoordinates(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function snapCoordinate(x, canvasWidth) {
    const step = canvasWidth / 32;
    return Math.round(x / step) * step;
  }
  function drawGrid(track) {
    const ctx = track.ctx;
    ctx.clearRect(0, 0, track.canvas.width, track.canvas.height);
    ctx.strokeStyle = "#eee";
    const totalBeats = 32;
    const step = track.canvas.width / totalBeats;
    for (let i = 0; i <= totalBeats; i++) {
      ctx.beginPath();
      let x = i * step;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, track.canvas.height);
      ctx.lineWidth = (i % 4 === 0) ? 2 : 1;
      ctx.stroke();
    }
    for (let y = 0; y < track.canvas.height; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(track.canvas.width, y);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function generateLegend(canvasHeight) {
    const steps = 4;
    let legendHTML = "";
    for (let i = 0; i <= steps; i++) {
      const y = (canvasHeight / steps) * i;
      const freq = Math.round(mapYToFrequency(y, canvasHeight));
      legendHTML += freq + "Hz<br>";
    }
    return legendHTML;
  }
  function mapYToFrequency(y, canvasHeight) {
    const maxFreq = 1000, minFreq = 80;
    return maxFreq - ((y / canvasHeight) * (maxFreq - minFreq));
  }
  function quantizeFrequency(freq, scaleType) {
    let midi = 69 + 12 * Math.log2(freq / 440);
    let midiRounded = Math.round(midi);
    let pattern;
    if (scaleType === "major") pattern = [0,2,4,5,7,9,11];
    else if (scaleType === "minor") pattern = [0,2,3,5,7,8,10];
    else if (scaleType === "pentatonic") pattern = [0,3,5,7,10];
    else return freq;
    let mod = midiRounded % 12;
    let bestDiff = Infinity, bestAdjustment = 0;
    for (let allowed of pattern) {
      let diff = Math.abs(mod - allowed);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAdjustment = allowed - mod;
      }
    }
    let quantizedMidi = midiRounded + bestAdjustment;
    return 440 * Math.pow(2, (quantizedMidi - 69)/12);
  }
  function playChord(audioCtx, startTime, duration, rootFreq, chordType, gainValue) {
    chordIntervals[chordType].forEach(function(interval) {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(gainValue, startTime);
      osc.frequency.setValueAtTime(rootFreq * Math.pow(2, interval / 12), startTime);
      osc.connect(gainNode).connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  // Zeichenfunktionen
  function drawSegmentStandard(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    ctx.lineWidth = baseSize;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  function drawSegmentVariable(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let dynamicWidth = baseSize * (1 + Math.max(0, (10 - distance) / 10));
    ctx.lineWidth = dynamicWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  function drawSegmentCalligraphy(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const norm = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / norm, ny = dx / norm;
    const offset = baseSize;
    ctx.lineCap = "round";
    ctx.lineWidth = baseSize;
    ctx.beginPath();
    ctx.moveTo(p1.x + nx * offset, p1.y + ny * offset);
    ctx.lineTo(p2.x + nx * offset, p2.y + ny * offset);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p1.x - nx * offset, p1.y - ny * offset);
    ctx.lineTo(p2.x - nx * offset, p2.y - ny * offset);
    ctx.stroke();
  }
  function drawSegmentBristle(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    const bristleCount = 5;
    ctx.lineCap = "round";
    for (let i = 0; i < bristleCount; i++) {
      let offsetX = (Math.random() - 0.5) * baseSize * 2;
      let offsetY = (Math.random() - 0.5) * baseSize * 2;
      ctx.lineWidth = baseSize * 0.7;
      ctx.beginPath();
      ctx.moveTo(p1.x + offsetX, p1.y + offsetY);
      ctx.lineTo(p2.x + offsetX, p2.y + offsetY);
      ctx.stroke();
    }
  }
  function drawSegmentFractal(ctx, seg, idx1, idx2, baseSize) {
    if (idx1 < 0 || idx2 < 0) return;
    const p1 = seg.points[idx1], p2 = seg.points[idx2];
    ctx.lineWidth = baseSize;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    for (let i = 0; i < 2; i++) {
      const angle = Math.random() * Math.PI * 2;
      const branchLength = baseSize * (Math.random() * 5);
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + branchLength * Math.cos(angle), midY + branchLength * Math.sin(angle));
      ctx.stroke();
    }
  }

  // Wichtig: redrawTrack – zeichnet Grid, Segmente und (falls markerX nicht null) den Laufzeitmarker
  function redrawTrack(track, markerX) {
    const ctx = track.ctx;
    drawGrid(track);
    track.segments.forEach(segment => {
      if (segment.brush === "chord" && segment.chordType) {
        const xs = segment.points.map(pt => pt.x);
        const ys = segment.points.map(pt => pt.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
        chordIntervals[segment.chordType].forEach((interval, index) => {
          const yOffset = interval * 5;
          ctx.strokeStyle = chordColors[index];
          ctx.lineWidth = segment.thickness;
          ctx.beginPath();
          ctx.moveTo(minX - 10, avgY - yOffset);
          ctx.lineTo(maxX + 10, avgY - yOffset);
          ctx.stroke();
        });
      } else if (segment.points.length >= 2) {
        const sortedPoints = segment.points.slice().sort((a, b) => a.x - b.x);
        for (let i = 1; i < sortedPoints.length; i++) {
          ctx.strokeStyle = "#000";
          drawSegmentStandard(ctx, { points: sortedPoints, thickness: segment.thickness }, i - 1, i, segment.thickness);
        }
      }
    });
    if (markerX !== null) {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, track.canvas.height);
      ctx.stroke();
    }
  }

  // Default JSON laden (hello.json muss im gleichen Ordner liegen)
  fetch('hello.json')
    .then(response => response.json())
    .then(data => {
      if (data.settings) {
        document.getElementById("bpmInput").value = data.settings.bpm;
        document.getElementById("loopCheckbox").checked = data.settings.loop;
        document.getElementById("harmonizeCheckbox").checked = data.settings.harmonize;
        document.getElementById("scaleSelect").value = data.settings.scale;
        document.getElementById("toolSelect").value = data.settings.tool;
        document.getElementById("brushSelect").value = data.settings.brush;
        document.getElementById("brushSizeSlider").value = data.settings.brushSize;
        currentTool = data.settings.tool;
        currentBrush = data.settings.brush;
        currentBrushSize = parseInt(data.settings.brushSize, 10);
      }
      if (Array.isArray(data.tracks)) {
        tracks.forEach((track, index) => {
          track.segments = data.tracks[index] || [];
          redrawTrack(track, null);
        });
      }
    })
    .catch(err => console.error("Fehler beim Laden der Default-JSON:", err));

  // Steuerungs-Buttons
  document.getElementById("clearButton").addEventListener("click", function() {
    tracks.forEach(track => {
      track.segments = [];
      track.currentSegment = null;
      redrawTrack(track, null);
    });
    undoStack = [];
    redoStack = [];
  });
  document.getElementById("undoButton").addEventListener("click", function() {
    if (undoStack.length > 0) {
      const op = undoStack.pop();
      const track = tracks[op.trackIndex];
      const removed = track.segments.pop();
      redoStack.push({ trackIndex: op.trackIndex, segment: removed });
      redrawTrack(track, null);
    }
  });
  document.getElementById("redoButton").addEventListener("click", function() {
    if (redoStack.length > 0) {
      const op = redoStack.pop();
      const track = tracks[op.trackIndex];
      track.segments.push(op.segment);
      undoStack.push({ trackIndex: op.trackIndex, segment: op.segment });
      redrawTrack(track, null);
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
    const exportData = {
      settings: settings,
      tracks: tracks.map(track => track.segments)
    };
    const dataStr = JSON.stringify(exportData);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("importButton").addEventListener("click", function() {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importData = JSON.parse(evt.target.result);
        if (importData.settings) {
          document.getElementById("bpmInput").value = importData.settings.bpm;
          document.getElementById("loopCheckbox").checked = importData.settings.loop;
          document.getElementById("harmonizeCheckbox").checked = importData.settings.harmonize;
          document.getElementById("scaleSelect").value = importData.settings.scale;
          document.getElementById("toolSelect").value = importData.settings.tool;
          document.getElementById("brushSelect").value = importData.settings.brush;
          document.getElementById("brushSizeSlider").value = importData.settings.brushSize;
          currentTool = importData.settings.tool;
          currentBrush = importData.settings.brush;
          currentBrushSize = parseInt(importData.settings.brushSize, 10);
        }
        if (Array.isArray(importData.tracks) && importData.tracks.length === tracks.length) {
          tracks.forEach((track, index) => {
            track.segments = importData.tracks[index];
            redrawTrack(track, null);
          });
          undoStack = [];
          redoStack = [];
        } else {
          alert("Import-Daten stimmen nicht mit den Spuren überein!");
        }
      } catch(err) {
        alert("Fehler beim Importieren: " + err);
      }
    };
    reader.readAsText(file);
  });
  document.getElementById("stopButton").addEventListener("click", function() {
    isPlaying = false;
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(e => console.error("AudioContext close error:", e));
    }
    cancelAnimationFrame(animationFrameId);
    tracks.forEach(track => {
      redrawTrack(track, null);
    });
  });
  document.getElementById("playButton").addEventListener("click", function() {
    // Wenn noch nichts gezeichnet wurde, gib eine Warnung aus.
    if (tracks.every(track => track.segments.length === 0)) {
      console.warn("Keine Segmente vorhanden – bitte zuerst zeichnen!");
      return;
    }
    if (isPlaying) return;
    const bpm = parseFloat(document.getElementById("bpmInput").value);
    playbackDuration = (60 / bpm) * 32;
    loopEnabled = document.getElementById("loopCheckbox").checked;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
    playbackStartTime = audioCtx.currentTime + 0.02;
    isPlaying = true;
    scheduleTracks(playbackStartTime);
    animationLoop();
  });
  
  // scheduleTracks und animationLoop stehen jetzt bereit
  function scheduleTracks(startTime) {
    const harmonizeEnabled = document.getElementById("harmonizeCheckbox").checked;
    const scaleType = document.getElementById("scaleSelect").value;
    tracks.forEach(track => {
      track.segments.forEach(segment => {
        if (segment.brush === "chord" && segment.chordType) {
          const xs = segment.points.map(pt => pt.x);
          const ys = segment.points.map(pt => pt.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
          const chordStart = startTime + (minX / track.canvas.width) * playbackDuration;
          const chordEnd = startTime + (maxX / track.canvas.width) * playbackDuration;
          let duration = chordEnd - chordStart;
          if (duration < 0.1) duration = 0.5;
          let rootFreq = mapYToFrequency(avgY, track.canvas.height);
          if (harmonizeEnabled) rootFreq = quantizeFrequency(rootFreq, scaleType);
          console.log("Playing chord segment:", segment.chordType, rootFreq, chordStart, duration);
          playChord(audioCtx, chordStart, duration, rootFreq, segment.chordType, track.muted ? 0 : 0.4);
          return;
        }
        if (segment.points.length === 0) return;
        const sortedPoints = segment.points.slice().sort((a, b) => a.x - b.x);
        const firstPoint = sortedPoints[0];
        const lastPoint = sortedPoints[sortedPoints.length - 1];
        const segmentStart = startTime + (firstPoint.x / track.canvas.width) * playbackDuration;
        const segmentEnd = startTime + (lastPoint.x / track.canvas.width) * playbackDuration;
        const osc = audioCtx.createOscillator();
        osc.type = track.waveType || "sine";
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(mapThicknessToCutoff(segment.thickness), segmentStart);
        const gainNode = audioCtx.createGain();
        let gainVal = track.muted ? 0 : 0.5;
        gainNode.gain.setValueAtTime(gainVal, segmentStart);
        osc.connect(filter);
        filter.connect(gainNode);
        if (segment.brush === "effect-delay") {
          let effectNode = audioCtx.createDelay();
          effectNode.delayTime.value = 0.2;
          gainNode.connect(effectNode);
          effectNode.connect(masterGain);
        } else if (segment.brush === "effect-distortion") {
          let effectNode = audioCtx.createWaveShaper();
          effectNode.curve = makeDistortionCurve(50);
          gainNode.connect(effectNode);
          effectNode.connect(masterGain);
        } else {
          gainNode.connect(masterGain);
        }
        let initFreq = mapYToFrequency(firstPoint.y, track.canvas.height);
        if (harmonizeEnabled) initFreq = quantizeFrequency(initFreq, scaleType);
        osc.frequency.setValueAtTime(initFreq, segmentStart);
        if (sortedPoints.length > 1) {
          sortedPoints.forEach(point => {
            let timeOffset = (point.x / track.canvas.width) * playbackDuration;
            timeOffset = Math.max(0, timeOffset);
            let freq = mapYToFrequency(point.y, track.canvas.height);
            if (harmonizeEnabled) freq = quantizeFrequency(freq, scaleType);
            osc.frequency.linearRampToValueAtTime(freq, startTime + timeOffset);
          });
        } else {
          osc.frequency.setValueAtTime(initFreq, segmentStart);
        }
        osc.start(segmentStart);
        osc.stop(segmentEnd);
      });
    });
  }
  function animationLoop() {
    if (!isPlaying) return;
    let currentTime = audioCtx.currentTime;
    let elapsed = currentTime - playbackStartTime;
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
    const markerX = (elapsed / playbackDuration) * tracks[0].canvas.width;
    tracks.forEach(track => {
      redrawTrack(track, markerX);
    });
    animationFrameId = requestAnimationFrame(animationLoop);
  }
  function mapThicknessToCutoff(thickness) {
    const maxCutoff = 1200, minCutoff = 400;
    let norm = (thickness - 1) / (10 - 1);
    return maxCutoff - norm * (maxCutoff - minCutoff);
  }
  function makeDistortionCurve(amount) {
    let n_samples = 44100,
        curve = new Float32Array(n_samples),
        deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      let x = i * 2 / n_samples - 1;
      curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // Default JSON laden (stelle sicher, dass hello.json im selben Ordner liegt)
  fetch('hello.json')
    .then(response => response.json())
    .then(data => {
      if (data.settings) {
        document.getElementById("bpmInput").value = data.settings.bpm;
        document.getElementById("loopCheckbox").checked = data.settings.loop;
        document.getElementById("harmonizeCheckbox").checked = data.settings.harmonize;
        document.getElementById("scaleSelect").value = data.settings.scale;
        document.getElementById("toolSelect").value = data.settings.tool;
        document.getElementById("brushSelect").value = data.settings.brush;
        document.getElementById("brushSizeSlider").value = data.settings.brushSize;
        currentTool = data.settings.tool;
        currentBrush = data.settings.brush;
        currentBrushSize = parseInt(data.settings.brushSize, 10);
      }
      if (Array.isArray(data.tracks)) {
        tracks.forEach((track, index) => {
          track.segments = data.tracks[index] || [];
          redrawTrack(track, null);
        });
      }
    })
    .catch(err => console.error("Fehler beim Laden der Default-JSON:", err));

  // Steuerungs-Buttons
  document.getElementById("clearButton").addEventListener("click", function() {
    tracks.forEach(track => {
      track.segments = [];
      track.currentSegment = null;
      redrawTrack(track, null);
    });
    undoStack = [];
    redoStack = [];
  });
  document.getElementById("undoButton").addEventListener("click", function() {
    if (undoStack.length > 0) {
      const op = undoStack.pop();
      const track = tracks[op.trackIndex];
      const removed = track.segments.pop();
      redoStack.push({ trackIndex: op.trackIndex, segment: removed });
      redrawTrack(track, null);
    }
  });
  document.getElementById("redoButton").addEventListener("click", function() {
    if (redoStack.length > 0) {
      const op = redoStack.pop();
      const track = tracks[op.trackIndex];
      track.segments.push(op.segment);
      undoStack.push({ trackIndex: op.trackIndex, segment: op.segment });
      redrawTrack(track, null);
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
    const exportData = {
      settings: settings,
      tracks: tracks.map(track => track.segments)
    };
    const dataStr = JSON.stringify(exportData);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("importButton").addEventListener("click", function() {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importData = JSON.parse(evt.target.result);
        if (importData.settings) {
          document.getElementById("bpmInput").value = importData.settings.bpm;
          document.getElementById("loopCheckbox").checked = importData.settings.loop;
          document.getElementById("harmonizeCheckbox").checked = importData.settings.harmonize;
          document.getElementById("scaleSelect").value = importData.settings.scale;
          document.getElementById("toolSelect").value = importData.settings.tool;
          document.getElementById("brushSelect").value = importData.settings.brush;
          document.getElementById("brushSizeSlider").value = importData.settings.brushSize;
          currentTool = importData.settings.tool;
          currentBrush = importData.settings.brush;
          currentBrushSize = parseInt(importData.settings.brushSize, 10);
        }
        if (Array.isArray(importData.tracks) && importData.tracks.length === tracks.length) {
          tracks.forEach((track, index) => {
            track.segments = importData.tracks[index];
            redrawTrack(track, null);
          });
          undoStack = [];
          redoStack = [];
        } else {
          alert("Import-Daten stimmen nicht mit den Spuren überein!");
        }
      } catch(err) {
        alert("Fehler beim Importieren: " + err);
      }
    };
    reader.readAsText(file);
  });
  document.getElementById("stopButton").addEventListener("click", function() {
    isPlaying = false;
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(e => console.error("AudioContext close error:", e));
    }
    cancelAnimationFrame(animationFrameId);
    tracks.forEach(track => {
      redrawTrack(track, null);
    });
  });
  document.getElementById("playButton").addEventListener("click", function() {
    // Falls noch nichts gezeichnet wurde, Warnung ausgeben.
    if (tracks.every(track => track.segments.length === 0)) {
      console.warn("Keine Segmente vorhanden – bitte zuerst zeichnen!");
      return;
    }
    if (isPlaying) return;
    const bpm = parseFloat(document.getElementById("bpmInput").value);
    playbackDuration = (60 / bpm) * 32;
    loopEnabled = document.getElementById("loopCheckbox").checked;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
    playbackStartTime = audioCtx.currentTime + 0.02;
    isPlaying = true;
    scheduleTracks(playbackStartTime);
    animationLoop();
  });
});