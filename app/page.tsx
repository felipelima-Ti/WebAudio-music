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
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DIATONIC_ROOTS = [0, 2, 4, 5, 7, 9, 11];
const DIATONIC_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

const QUALITY_KEYS = ["maj", "maj7", "7", "sus4", "m", "m7", "dim", "aug"] as const;
type QualityKey = typeof QUALITY_KEYS[number];

const CHORD_TYPES: Record<QualityKey, { intervals: number[]; suffix: string }> = {
  maj: { intervals: [0, 4, 7], suffix: "" },
  maj7: { intervals: [0, 4, 7, 11], suffix: "maj7" },
  "7": { intervals: [0, 4, 7, 10], suffix: "7" },
  sus4: { intervals: [0, 5, 7], suffix: "sus4" },
  m: { intervals: [0, 3, 7], suffix: "m" },
  m7: { intervals: [0, 3, 7, 10], suffix: "m7" },
  dim: { intervals: [0, 3, 6], suffix: "dim" },
  aug: { intervals: [0, 4, 8], suffix: "aug" },
};

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

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
// Componente principal do aplicativo, que integra a detecção de mãos com o sintetizador de acordes
export default function SoundHandSynth() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("");
  const [simple, setSimple] = useState(true);
  const [wave, setWave] = useState<"sine" | "triangle" | "square" | "sawtooth">("triangle");
  const [cutoff, setCutoff] = useState(1800);

  const waveRef = useRef(wave);
  const simpleRef = useRef(simple);

  const chordOscsRef = useRef<Tone.Oscillator[]>([]);
  const chordGainRef = useRef<Tone.Gain | null>(null);
  const chordFilterRef = useRef<Tone.Filter | null>(null);
  const currentChordGainRef = useRef(0);

  const currentRootRef = useRef<number>(-1);
  const currentQualityRef = useRef<number>(-1);
  const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const RELEASE_SECONDS = 0.9;
// Mantém uma referência atualizada da forma de onda para uso nas funções de mapeamento, evitando problemas de closure
  useEffect(() => {
    waveRef.current = wave;
    chordOscsRef.current.forEach((o) => (o.type = wave as any));
  }, [wave]);
// Mantém uma referência atualizada do modo simples para uso nas funções de mapeamento, evitando problemas de closure
  useEffect(() => {
    simpleRef.current = simple;
  }, [simple]);
// Atualiza a frequência de corte do filtro lowpass sempre que o valor de cutoff mudar, com um pequeno fade para evitar cliques
  useEffect(() => {
    if (chordFilterRef.current) {
      chordFilterRef.current.frequency.rampTo(cutoff, 0.05);
    }
  }, [cutoff]);

  const NUM_QUALITIES = QUALITY_KEYS.length;
  const qualityLabels = QUALITY_KEYS.map((k) => k);
// Função para inicializar o áudio, criando os osciladores, ganho e filtro necessários para tocar os acordes
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
// Função para determinar em qual setor da roda a mão está, com base na posição x,y e no centro cx,cy
  function getSector(x: number, y: number, cx: number, cy: number, num: number) {
    let angle = Math.atan2(y - cy, x - cx);
    angle = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(angle / ((Math.PI * 2) / num));
  }
  // Define uma zona central onde o acorde é silenciado, para evitar mudanças acidentais ao posicionar a mão no centro da roda
  function isInMuteZone(x: number, y: number, cx: number, cy: number, radius: number) {
    return Math.hypot(x - cx, y - cy) < radius * 0.35;
  }
// Função para converter um índice para a respectiva raiz MIDI
  function sliceToRootMidi(i: number) {
    return simpleRef.current ? DIATONIC_ROOTS[i] : i;
  }
  // Função para converter um índice para o nome da nota correspondente, dependendo do modo simples ou completo
  function sliceToRootName(i: number) {
    return simpleRef.current ? DIATONIC_NAMES[i] : NOTE_NAMES[i];
  }
// Constrói as frequências dos 4 osciladores com base na raiz 
  function buildChordFreqs(rootIdx: number, qualityIdx: number): number[] {
    const rootMidi = MIDI_BASE + sliceToRootMidi(rootIdx);
    const intervals = CHORD_TYPES[QUALITY_KEYS[qualityIdx]].intervals;
    const freqs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const iv = i < intervals.length ? intervals[i] : intervals[0] + 12;
      freqs.push(midiToFreq(rootMidi + iv));
    }
    return freqs;
  }
// Função para aplicar um acorde com base na raiz 
  function applyChord(rootIdx: number, qualityIdx: number) {
    const oscs = chordOscsRef.current;
    const cg = chordGainRef.current;
    if (!oscs.length || !cg) return;
    const freqs = buildChordFreqs(rootIdx, qualityIdx);
    freqs.forEach((f, i) => {
      oscs[i]?.frequency.rampTo(f, 0.12);
    });
    currentChordGainRef.current = 0.25;
    cg.gain.cancelScheduledValues(Tone.now());
    cg.gain.rampTo(currentChordGainRef.current, 0.06);
    currentRootRef.current = rootIdx;
    currentQualityRef.current = qualityIdx;
  }
// Função para silenciar o acorde, com um fade-out suave
  function silenceChord() {
    const cg = chordGainRef.current;
    if (!cg) return;
    if (currentChordGainRef.current === 0 && currentRootRef.current === -1) return;
    currentChordGainRef.current = 0;
    cg.gain.cancelScheduledValues(Tone.now());
    cg.gain.rampTo(0, RELEASE_SECONDS);
    currentRootRef.current = -1;
    currentQualityRef.current = -1;
    if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
  }
// Desenha uma roda de acorde com setores para cada nota ou qualidade
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
      ctx.font = "14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i] ?? "", tx, ty);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fill();
  }
// Função chamada a cada frame com os resultados da detecção de mãos, responsável por desenhar as rodas e determinar os acordes a tocar com base na posição das mãos
  function onResults(results: any) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
// Define o tamanho e posição das rodas de acorde, adaptando para telas menores
    const isMobile = canvas.width < 768;

    const R = Math.min(canvas.width, canvas.height) * (isMobile ? 0.22 : 0.30);
    const cy = canvas.height - R * (isMobile ? 1.6 : 1.1);

    const cx1 = canvas.width * 0.25;
    const cx2 = canvas.width * 0.75;

    const NUM_ROOTS = simpleRef.current ? DIATONIC_NAMES.length : NOTE_NAMES.length;
    const rootLabels = simpleRef.current ? DIATONIC_NAMES : NOTE_NAMES;

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
// Se nenhuma mão for detectada, silencia o acorde e desenha as rodas sem seleção
    if (hands.length === 0) {
      silenceChord();
      drawWheel(ctx, cx1, cy, R, NUM_ROOTS, -1, rootLabels);
      drawWheel(ctx, cx2, cy, R, NUM_QUALITIES, -1, qualityLabels as unknown as string[]);
      ctx.fillStyle = "white";
      ctx.font = "14px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`Wave: ${waveRef.current}`, 30, 40);
      ctx.fillText(`Acorde: —`, 30, 64);
      return;
    }
// Se uma ou duas mãos forem detectadas, determina qual é a mão da raiz e qual é a mão da qualidade com base na proximidade das mãos aos centros das rodas
    let rootHand: { x: number; y: number } | null = null;
    let qualityHand: { x: number; y: number } | null = null;
// Se apenas uma mão for detectada, atribui como mão da raiz ou da qualidade com base na proximidade aos centros das rodas
    if (hands.length === 1) {
      const h = hands[0];
      const dL = Math.hypot(h.x - cx1, h.y - cy);
      const dR = Math.hypot(h.x - cx2, h.y - cy);
      if (dL < dR) rootHand = h; else qualityHand = h;
    } else if (hands.length >= 2) {
      const h0 = hands[0], h1 = hands[1];
      const costA = Math.hypot(h0.x - cx1, h0.y - cy) + Math.hypot(h1.x - cx2, h1.y - cy);
      const costB = Math.hypot(h1.x - cx1, h1.y - cy) + Math.hypot(h0.x - cx2, h0.y - cy);
      if (costA <= costB) { rootHand = h0; qualityHand = h1; }
      else { rootHand = h1; qualityHand = h0; }
    }
// Verifica se as mãos estão dentro das rodas e determina os setores selecionados para raiz e qualidade, desenhando um círculo indicador na posição da mão
    let selectedRoot = -1;
    let selectedQuality = -1;
    let rootHandOnWheel = false;

    if (rootHand) {
      const { x, y } = rootHand;
      const insideWheel = Math.hypot(x - cx1, y - cy) < R;
      if (insideWheel && !isInMuteZone(x, y, cx1, cy, R)) {
        selectedRoot = getSector(x, y, cx1, cy, NUM_ROOTS);
        rootHandOnWheel = true;
      }
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = selectedRoot === -1 ? "blue" : "cyan";
      ctx.fill();
    }

    if (qualityHand) {
      const { x, y } = qualityHand;
      const insideWheel = Math.hypot(x - cx2, y - cy) < R;
      if (insideWheel && !isInMuteZone(x, y, cx2, cy, R)) {
        selectedQuality = getSector(x, y, cx2, cy, NUM_QUALITIES);
      }
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = selectedQuality === -1 ? "blue" : "red";
      ctx.fill();
    }

    if (rootHandOnWheel && selectedRoot !== -1) {
      const effectiveQuality = selectedQuality !== -1 ? selectedQuality : 0;
      applyChord(selectedRoot, effectiveQuality);
    } else {
      silenceChord();
    }
// Desenha as rodas de acorde com os setores selecionados para raiz e qualidade, e exibe informações sobre a forma de onda e o acorde atual
    drawWheel(ctx, cx1, cy, R, NUM_ROOTS, currentRootRef.current, rootLabels);
    drawWheel(ctx, cx2, cy, R, NUM_QUALITIES, currentQualityRef.current, qualityLabels as unknown as string[]);

    ctx.fillStyle = "white";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`Wave: ${waveRef.current}`, 30, 40);
    const label =
      currentRootRef.current !== -1 && currentQualityRef.current !== -1
        ? `${sliceToRootName(currentRootRef.current)}${CHORD_TYPES[QUALITY_KEYS[currentQualityRef.current]].suffix}`
        : "—";
    ctx.fillText(`Acorde: ${label}`, 30, 64);
  }

  async function startApp() {
    setStatus("Carregando MediaPipe...");
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");

      setStatus("Iniciando áudio...");
      await initAudio();

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
      chordOscsRef.current.forEach((o) => { try { o.stop(); o.dispose(); } catch {} });
      chordGainRef.current?.dispose();
      chordFilterRef.current?.dispose();
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover scale-x-[-1]" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />

      <div className="absolute top-4 right-4 z-10 bg-black/60 backdrop-blur p-4 rounded-lg text-white space-y-3 w-100">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70 mb-2 ">Forma de Onda</div>
          <div className="flex flex-wrap gap-2">
            {(["sine", "triangle", "square", "sawtooth"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWave(w)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition border border-white/20 ${
                  wave === w
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {w}
              </button>
            ))}
               <div className="flex justify-between text-xs mb-1 ">
            <span>Filtro Lowpass</span>
            <span>{cutoff} Hz</span>
              <input
            type="checkbox"
            checked={simple}
            onChange={(e) => setSimple(e.target.checked)}
            className="accent-primary ml-2"
          />
          Modo simples (7 raízes diatônicas)
          </div>
          </div>
        </div>
        <div>
          <input
            type="range"
            min={200}
            max={8000}
            step={50}
            value={cutoff}
            onChange={(e) => setCutoff(Number(e.target.value))}
            className="w-full accent-primary cursor-pointer"
          />
        </div>
      </div>

      {!started && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 text-foreground p-6 text-center">
          <h1 className="text-3xl font-bold mb-3">Sound Hand Synth · WebAudio</h1>
          <p className="max-w-md text-sm text-muted-foreground mb-6">
            WebAudioAPI com 4 osciladores, MIDI base 48, filtro lowpass e 8 qualidades de acorde
            (maj, maj7, 7, sus4, m, m7, dim, aug).
          </p>
          <button
            onClick={startApp}
            className="px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition border"
          >
            Iniciar
          </button>
          {status && <p className="mt-4 text-sm text-muted-foreground">{status}</p>}
        </div>
      )}
    </div>
  );
}