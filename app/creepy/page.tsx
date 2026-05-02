"use client";
import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

const MIDI_BASE = 48;

// Creep by Radiohead: G → B → C → Cm
const CREEP_CHORDS = [
  { name: "G", intervals: [0, 4, 7], rootSemitone: 7 },    // G major
  { name: "B", intervals: [0, 4, 7], rootSemitone: 11 },   // B major
  { name: "C", intervals: [0, 4, 7], rootSemitone: 0 },    // C major
  { name: "Cm", intervals: [0, 3, 7], rootSemitone: 0 },   // C minor
];

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export default function SoundHandSynth() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("");
  const [wave, setWave] = useState<"sine" | "triangle" | "square" | "sawtooth">("triangle");
  const [cutoff, setCutoff] = useState(1800);

  const waveRef = useRef(wave);

  const chordOscsRef = useRef<Tone.Oscillator[]>([]);
  const chordGainRef = useRef<Tone.Gain | null>(null);
  const chordFilterRef = useRef<Tone.Filter | null>(null);
  const currentChordGainRef = useRef(0);

  const currentChordIdxRef = useRef<number>(-1);
  const RELEASE_SECONDS = 0.9;

  useEffect(() => {
    waveRef.current = wave;
    chordOscsRef.current.forEach((o) => (o.type = wave as any));
  }, [wave]);

  useEffect(() => {
    if (chordFilterRef.current) {
      chordFilterRef.current.frequency.rampTo(cutoff, 0.05);
    }
  }, [cutoff]);

  async function initAudio() {
    await Tone.start();
    const chordFilter = new Tone.Filter(cutoff, "lowpass").toDestination();
    const chordGain = new Tone.Gain(0).connect(chordFilter);
    const oscs: Tone.Oscillator[] = [];
    for (let i = 0; i < 4; i++) {
      const o = new Tone.Oscillator(220, waveRef.current).connect(chordGain);
      o.start();
      oscs.push(o);
    }
    chordOscsRef.current = oscs;
    chordGainRef.current = chordGain;
    chordFilterRef.current = chordFilter;
  }

  function getSector(x: number, y: number, cx: number, cy: number, num: number) {
    let angle = Math.atan2(y - cy, x - cx);
    angle = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(angle / ((Math.PI * 2) / num));
  }

  function isInMuteZone(x: number, y: number, cx: number, cy: number, radius: number) {
    return Math.hypot(x - cx, y - cy) < radius * 0.35;
  }

  function buildChordFreqs(chordIdx: number): number[] {
    const chord = CREEP_CHORDS[chordIdx];
    const rootMidi = MIDI_BASE + chord.rootSemitone;
    const freqs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const iv = i < chord.intervals.length ? chord.intervals[i] : chord.intervals[0] + 12;
      freqs.push(midiToFreq(rootMidi + iv));
    }
    return freqs;
  }

  function applyChord(chordIdx: number) {
    const oscs = chordOscsRef.current;
    const cg = chordGainRef.current;
    if (!oscs.length || !cg) return;
    const freqs = buildChordFreqs(chordIdx);
    freqs.forEach((f, i) => {
      oscs[i]?.frequency.rampTo(f, 0.12);
    });
    currentChordGainRef.current = 0.25;
    cg.gain.cancelScheduledValues(Tone.now());
    cg.gain.rampTo(currentChordGainRef.current, 0.06);
    currentChordIdxRef.current = chordIdx;
  }

  function silenceChord() {
    const cg = chordGainRef.current;
    if (!cg) return;
    if (currentChordGainRef.current === 0 && currentChordIdxRef.current === -1) return;
    currentChordGainRef.current = 0;
    cg.gain.cancelScheduledValues(Tone.now());
    cg.gain.rampTo(0, RELEASE_SECONDS);
    currentChordIdxRef.current = -1;
  }

  function drawWheel(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, r: number,
    num: number, active: number, labels: string[]
  ) {
    for (let i = 0; i < num; i++) {
      const a1 = i * ((Math.PI * 2) / num);
      const a2 = (i + 1) * ((Math.PI * 2) / num);
      const mid = (a1 + a2) / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a1, a2);
      ctx.closePath();
      ctx.fillStyle = i === active ? "rgba(255,80,80,0.55)" : "rgba(20,20,20,0.35)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const tx = cx + Math.cos(mid) * (r * 0.65);
      const ty = cy + Math.sin(mid) * (r * 0.65);
      ctx.fillStyle = i === active ? "#fff" : "rgba(255,255,255,0.8)";
      ctx.font = `${i === active ? "bold " : ""}18px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i] ?? "", tx, ty);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fill();
  }

  function onResults(results: any) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const R = Math.min(canvas.width, canvas.height) * 0.28;
    const cy = canvas.height * 0.5;
    const cx1 = canvas.width * 0.5;

    const NUM_CHORDS = CREEP_CHORDS.length;
    const chordLabels = CREEP_CHORDS.map((c) => c.name);

    const hands: { x: number; y: number }[] = [];
    if (results.multiHandLandmarks) {
      for (const lm of results.multiHandLandmarks) {
        hands.push({
          x: (1 - lm[8].x) * canvas.width,
          y: lm[8].y * canvas.height,
        });
      }
    }

    if (hands.length === 0) {
      silenceChord();
      drawWheel(ctx, cx1, cy, R, NUM_CHORDS, -1, chordLabels);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "14px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`Wave: ${waveRef.current}`, 30, 40);
      ctx.fillText(`Chord: —`, 30, 64);
      return;
    }

    const h = hands[0];
    let selectedChord = -1;
    const insideWheel = Math.hypot(h.x - cx1, h.y - cy) < R;
    if (insideWheel && !isInMuteZone(h.x, h.y, cx1, cy, R)) {
      selectedChord = getSector(h.x, h.y, cx1, cy, NUM_CHORDS);
    }

    ctx.beginPath();
    ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = selectedChord === -1 ? "rgba(100,100,255,0.8)" : "rgba(255,80,80,0.9)";
    ctx.fill();

    if (selectedChord !== -1) {
      applyChord(selectedChord);
    } else {
      silenceChord();
    }

    drawWheel(ctx, cx1, cy, R, NUM_CHORDS, currentChordIdxRef.current, chordLabels);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`Wave: ${waveRef.current}`, 30, 40);
    const label = currentChordIdxRef.current !== -1
      ? CREEP_CHORDS[currentChordIdxRef.current].name
      : "—";
    ctx.fillText(`Chord: ${label}`, 30, 64);
  }

  async function startApp() {
    setStatus("Loading MediaPipe...");
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");

      setStatus("Starting audio...");
      await initAudio();

      setStatus("Starting camera...");
      const hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
      });
      hands.onResults(onResults);

      const camera = new window.Camera(videoRef.current!, {
        onFrame: async () => {
          await hands.send({ image: videoRef.current! });
        },
        width: 640,
        height: 480,
      });
      await camera.start();
      setStarted(true);
      setStatus("");
    } catch (e: any) {
      console.error(e);
      setStatus("Error: " + e.message);
    }
  }

  useEffect(() => {
    return () => {
      chordOscsRef.current.forEach((o) => { try { o.stop(); o.dispose(); } catch {} });
      chordGainRef.current?.dispose();
      chordFilterRef.current?.dispose();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-40 scale-x-[-1]" playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-white/60 font-mono">Waveform</span>
          <div className="flex gap-1">
            {(["sine", "triangle", "square", "sawtooth"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWave(w)}
                className={`px-3 py-1.5 rounded text-xs font-mono transition border ${
                  wave === w
                    ? "bg-red-600/80 text-white border-red-400/50"
                    : "bg-black/40 text-white/60 border-white/10 hover:bg-white/10"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 min-w-[140px]">
          <div className="flex justify-between">
            <span className="text-xs text-white/60 font-mono">Lowpass</span>
            <span className="text-xs text-white/40 font-mono">{cutoff} Hz</span>
          </div>
          <input
            type="range"
            min={200}
            max={8000}
            step={50}
            value={cutoff}
            onChange={(e) => setCutoff(Number(e.target.value))}
            className="w-full accent-red-500 cursor-pointer"
          />
        </div>
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-10 text-center">
        <span className="text-xs text-white/30 font-mono">Radiohead — Creep: G → B → C → Cm</span>
      </div>

      {!started && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center max-w-md px-6">
            <h1 className="text-2xl font-bold text-white font-mono mb-2">Sound Hand Synth</h1>
            <p className="text-white/50 text-sm font-mono mb-1">Radiohead — Creep Edition</p>
            <p className="text-white/30 text-xs font-mono mb-6">
              G → B → C → Cm · Move your hand over the wheel to play chords
            </p>
            <button
              onClick={startApp}
              className="px-8 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-lg transition"
            >
              Start
            </button>
            {status && <p className="mt-4 text-white/50 text-sm font-mono">{status}</p>}
          </div>
        </div>
      )}
    </div>
  );
}