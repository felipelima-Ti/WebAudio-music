"use client";
import { useEffect, useRef, useState } from "react";
// Tipos globais MediaPipe 
declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

// ===== CONFIG =====
const CONFIG = {
  mode: "melody-chord" as const,
  wave: "triangle" as OscillatorType,
  scale: "major" as const,
  key: "D" as const,
  snap: true,
  simple: true,
};

// Notas customizadas da roda de melodia (mão direita)
const MELODY_NOTES = [
  "A3", "B3", "C#4", "D4", "E4", "F#4",
  "G4", "A4", "B4", "C#5", "D5", "F#5"
];

// Notas dominantes -> cada uma vira um acorde (raiz + 3ª + 5ª da escala)
const DOMINANT_NOTES = [
  "D4", // I
  "G4", // IV
  "A4", // V
  "B3", // vi
  "F#4" // iii
];

//Teoria 
const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};
const SEMI_TO_NAME = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
};

// midi hz
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const noteName = (midi: number) => `${SEMI_TO_NAME[midi % 12]}${Math.floor(midi / 12) - 1}`;

// "A#3" midi
function nameToMidi(name: string): number {
  const m = name.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) throw new Error("Nota inválida: " + name);
  const semi = NOTE_TO_SEMITONE[m[1]];
  const octave = parseInt(m[2], 10);
  return 12 * (octave + 1) + semi;
}

// Constrói acorde a partir de uma nota raiz, usando 3ª e 5ª da escala (D maior)
function chordFromRoot(rootName: string, key: string, scale: string): number[] {
  const rootMidi = nameToMidi(rootName);
  const keySemi = NOTE_TO_SEMITONE[key];
  const intervals = SCALES[scale]; // semitons a partir da tônica
  // Encontrar grau da raiz dentro da escala (assumindo que pertence)
  const rel = ((rootMidi - keySemi) % 12 + 12) % 12;
  let degree = intervals.indexOf(rel);
  if (degree === -1) {
    // se não diatônica, retorna tríade maior simples
    return [rootMidi, rootMidi + 4, rootMidi + 7];
  }
  const third = intervals[(degree + 2) % 7] + (degree + 2 >= 7 ? 12 : 0);
  const fifth = intervals[(degree + 4) % 7] + (degree + 4 >= 7 ? 12 : 0);
  const base = rootMidi - rel;
  return [rootMidi, base + third, base + fifth];
}

//const ROMAN_SIMPLE = ["I", "IV", "V", "ii", "iii"];

// ===== Carregador de scripts MediaPipe =====
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

// ===== Voz Web Audio (osc + filtro + envelope) =====
class Voice {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  out: AudioNode;
  released = false;

  constructor(ctx: AudioContext, dest: AudioNode, freq: number, wave: OscillatorType, peakGain = 0.2) {
    this.ctx = ctx;
    this.out = dest;
    this.osc = ctx.createOscillator();
    this.osc.type = wave;
    this.osc.frequency.value = freq;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1800;
    this.filter.Q.value = 0.7;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.filter).connect(this.gain).connect(dest);
    const now = ctx.currentTime;
    // attack suave
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(peakGain, now + 0.35);
    // sustain
    this.gain.gain.linearRampToValueAtTime(peakGain * 0.85, now + 0.6);
    this.osc.start();
  }

  setVolume(v: number) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(v, now, 0.08);
  }

  release(time = 1.2) {
    if (this.released) return;
    this.released = true;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + time);
    this.osc.stop(now + time + 0.05);
    setTimeout(() => {
      try { this.osc.disconnect(); this.filter.disconnect(); this.gain.disconnect(); } catch {}
    }, (time + 0.2) * 1000);
  }
}

const Index = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("");
  const [wave, setWave] = useState<OscillatorType>(CONFIG.wave);
  const waveRef = useRef<OscillatorType>(CONFIG.wave);
  useEffect(() => { waveRef.current = wave; }, [wave]);

  // Refs de áudio / estado
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const reverbRef = useRef<ConvolverNode | null>(null);
  const chordVoicesRef = useRef<Voice[]>([]);
  const noteVoiceRef = useRef<Voice | null>(null);
  const currentChordRef = useRef<number>(-1);
  const currentNoteRef = useRef<number>(-1);

  // Conteúdo musical (custom)
  const notesMidi = MELODY_NOTES.map(nameToMidi);
  const chords = DOMINANT_NOTES.map((n) => chordFromRoot(n, CONFIG.key, CONFIG.scale));
  const NUM_NOTES = notesMidi.length;
  const NUM_CHORDS = chords.length;
  const noteLabels = MELODY_NOTES;
  const chordLabels = DOMINANT_NOTES;

  // ===== Reverb impulse simples =====
  function makeImpulse(ctx: AudioContext, duration = 2.2, decay = 2.5) {
    const rate = ctx.sampleRate;
    const length = rate * duration;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const ch = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  async function initAudio() {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    master.connect(dry).connect(ctx.destination);
    master.connect(reverb).connect(wet).connect(ctx.destination);
    masterRef.current = master;
    reverbRef.current = reverb;
  }

  // ===== Helpers geometria =====
  function getSector(x: number, y: number, cx: number, cy: number, num: number) {
    let angle = Math.atan2(y - cy, x - cx);
    angle = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(angle / ((Math.PI * 2) / num));
  }
  function pinch(lm: any) {
    const dx = lm[4].x - lm[8].x;
    const dy = lm[4].y - lm[8].y;
    return 1 - Math.min(Math.sqrt(dx * dx + dy * dy) * 5, 1);
  }
  function isInMuteZone(x: number, y: number, cx: number, cy: number, radius: number) {
    return Math.hypot(x - cx, y - cy) < radius * 0.35;
  }

  // ===== Som =====
  function playChord(idx: number) {
    const ctx = audioCtxRef.current!;
    const master = masterRef.current!;
    stopChord();
    const midis = chords[idx];
    chordVoicesRef.current = midis.map(
      (m) => new Voice(ctx, master, midiToHz(m), waveRef.current, 0.12)
    );
    currentChordRef.current = idx;
  }
  function stopChord() {
    chordVoicesRef.current.forEach((v) => v.release(1.4));
    chordVoicesRef.current = [];
    currentChordRef.current = -1;
  }
  function playNote(idx: number) {
    const ctx = audioCtxRef.current!;
    const master = masterRef.current!;
    stopNote();
    noteVoiceRef.current = new Voice(ctx, master, midiToHz(notesMidi[idx]), waveRef.current, 0.22);
    currentNoteRef.current = idx;
  }
  function stopNote() {
    if (noteVoiceRef.current) noteVoiceRef.current.release(0.9);
    noteVoiceRef.current = null;
    currentNoteRef.current = -1;
  }

  //Desenho das rodas e labels
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
      ctx.fillStyle = i === active ? "rgba(255,255,255,0.5)" : "rgba(34,34,34,0.25)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const tx = cx + Math.cos(mid) * (r * 0.7);
      const ty = cy + Math.sin(mid) * (r * 0.7);
      ctx.fillStyle = "white";
      ctx.font = "13px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i] ?? "", tx, ty);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fill();
  }

  // ===== onResults =====
  function onResults(results: any) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx1 = canvas.width * 0.3;
    const cx2 = canvas.width * 0.7;
    const cy = canvas.height - 220;

    // Coletar as mãos detectadas
    const hands: { x: number; y: number; lm: any }[] = [];
    if (results.multiHandLandmarks) {
      for (const lm of results.multiHandLandmarks) {
        hands.push({
          x: (1 - lm[8].x) * canvas.width,
          y: lm[8].y * canvas.height,
          lm,
        });
      }
    }

    // Atribuir cada mão à roda mais próxima (acorde ou melodia)
    let chordHand: { x: number; y: number; lm: any } | null = null;
    let noteHand: { x: number; y: number; lm: any } | null = null;

    if (hands.length === 1) {
      const h = hands[0];
      const dC = Math.hypot(h.x - cx1, h.y - cy);
      const dN = Math.hypot(h.x - cx2, h.y - cy);
      if (dC < dN) chordHand = h;
      else noteHand = h;
    } else if (hands.length >= 2) {
      const h0 = hands[0], h1 = hands[1];
      // custo de cada atribuição: soma das distâncias às rodas
      const costA =
        Math.hypot(h0.x - cx1, h0.y - cy) + Math.hypot(h1.x - cx2, h1.y - cy);
      const costB =
        Math.hypot(h1.x - cx1, h1.y - cy) + Math.hypot(h0.x - cx2, h0.y - cy);
      if (costA <= costB) {
        chordHand = h0;
        noteHand = h1;
      } else {
        chordHand = h1;
        noteHand = h0;
      }
    }

    // Se nenhuma mão atribuída a uma roda, para o som correspondente
    if (!chordHand && currentChordRef.current !== -1) stopChord();
    if ((!noteHand || (CONFIG.mode === "melody-chord" && !chordHand)) && currentNoteRef.current !== -1) stopNote();

    // RODA DE ACORDES
    if (chordHand) {
      const { x, y } = chordHand;
      const muted = isInMuteZone(x, y, cx1, cy, 180);
      if (muted) {
        if (currentChordRef.current !== -1) stopChord();
      } else {
        const dist = Math.hypot(x - cx1, y - cy);
        if (dist < 180) {
          const chordIndex = getSector(x, y, cx1, cy, NUM_CHORDS);
          if (chordIndex !== currentChordRef.current) playChord(chordIndex);
        } else if (currentChordRef.current !== -1) stopChord();
      }
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = muted ? "blue" : "cyan";
      ctx.fill();
    }

    // RODA DE NOTAS (melody-chord: só toca se acorde ativo)
    if (noteHand) {
      const { x, y } = noteHand;
      const muted = isInMuteZone(x, y, cx2, cy, 180);
      if (muted || (CONFIG.mode === "melody-chord" && currentChordRef.current === -1)) {
        if (currentNoteRef.current !== -1) stopNote();
      } else {
        const dist = Math.hypot(x - cx2, y - cy);
        if (dist < 220) {
          let noteIndex = getSector(x, y, cx2, cy, NUM_NOTES);
          if (CONFIG.snap) noteIndex = Math.max(0, Math.min(NUM_NOTES - 1, noteIndex));
          if (noteIndex !== currentNoteRef.current) playNote(noteIndex);
        } else if (currentNoteRef.current !== -1) stopNote();
      }
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = muted ? "blue" : "red";
      ctx.fill();
    }

    drawWheel(ctx, cx1, cy, 180, NUM_CHORDS, currentChordRef.current, chordLabels);
    drawWheel(ctx, cx2, cy, 180, NUM_NOTES, currentNoteRef.current, noteLabels);

    ctx.fillStyle = "white";
    ctx.font = "14px Arial";
    ctx.fillText(`Key: ${CONFIG.key} ${CONFIG.scale}`, 50, 40);
    ctx.fillText(`wave: ${waveRef.current } | ${NUM_NOTES} notas`, 85, 64);
    ctx.fillText(currentChordRef.current !== -1 ? "ACORDE ON" : "ACORDE OFF", 55, 104);
  }

  async function startApp() {
    setStatus("Carregando MediaPipe...");
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");

      setStatus("Iniciando áudio...");
      await initAudio();
      // Resume after gesture (autoplay policy)
      await audioCtxRef.current?.resume();

      setStatus("Iniciando câmera...");
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
      setStatus("Erro: " + e.message);
    }
  }

  useEffect(() => {
    return () => {
      stopChord();
      stopNote();
      audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover -scale-x-100" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Seletor de waveform — sempre visível */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 rounded-lg bg-background/70 backdrop-blur p-3 border border-border">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Forma de Onda</span>
        <div className="flex gap-1">
          {(["sine", "triangle", "square", "sawtooth"] as OscillatorType[]).map((w) => (
            <button
              key={w}
              onClick={() => setWave(w)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition border border-gray-600 ${
                wave === w
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {!started && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur">
          <h1 className="text-3xl font-semibold">Sound Hand Synth · Web Audio</h1>
          <p className="text-muted-foreground text-sm max-w-md text-center">
            Modo {CONFIG.mode} · Tom {CONFIG.key} {CONFIG.scale} · onda {wave} · {MELODY_NOTES.length} notas · snap {CONFIG.snap ? "on" : "off"}
          </p>
          <button
            onClick={startApp}
            className="rounded-md bg-primary px-6 py-3 text-primary-foreground transition border"
          >
            Iniciar
          </button>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </div>
      )}
    </div>
  );
};

export default Index;

