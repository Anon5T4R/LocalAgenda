// Som das notificações via Web Audio (sem arquivo de áudio — osciladores).
// O AudioContext exige um gesto do usuário antes de tocar; `armAudio()` é
// chamado no 1º clique. O webview segue vivo na bandeja, então o som toca mesmo
// com a janela "fechada".

let ctx: AudioContext | null = null;

export function armAudio(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctx = new Ctor();
    }
    if (ctx && ctx.state === "suspended") void ctx.resume();
  } catch {
    /* sem áudio disponível */
  }
}

function beep(freq: number, at: number, dur: number, vol: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  // envelope simples (ataque/afrouxamento) pra não estalar
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(vol, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Ding curto e agradável de 2 notas — lembrete de evento/tarefa. */
export function playChime(volume = 0.7): void {
  armAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const v = Math.max(0, Math.min(1, volume)) * 0.6;
  beep(880, t, 0.18, v);
  beep(1174.7, t + 0.16, 0.28, v);
}

/**
 * Alarme: padrão de bipes que repete até `stop()`. Usado por alarme e fim de
 * timer. Retorna a função de parar. Auto-para em 60s por segurança.
 */
export function playAlarm(volume = 0.9): () => void {
  armAudio();
  const v = Math.max(0, Math.min(1, volume)) * 0.55;
  let stopped = false;
  const burst = () => {
    if (stopped || !ctx) return;
    const t = ctx.currentTime;
    beep(1046.5, t, 0.14, v);
    beep(1046.5, t + 0.22, 0.14, v);
    beep(1046.5, t + 0.44, 0.18, v);
  };
  burst();
  const iv = setInterval(burst, 1300);
  const stop = () => {
    stopped = true;
    clearInterval(iv);
  };
  const safety = setTimeout(stop, 60_000);
  return () => {
    clearTimeout(safety);
    stop();
  };
}

// Registro de loops de alarme ativos (por id de toast), pra o botão "Parar".
const loops = new Map<string, () => void>();

export function startAlarmSound(id: string, volume = 0.9): void {
  if (loops.has(id)) return;
  loops.set(id, playAlarm(volume));
}

export function stopAlarmSound(id: string): void {
  const stop = loops.get(id);
  if (stop) {
    stop();
    loops.delete(id);
  }
}
