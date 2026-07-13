import { create } from "zustand";

// Timer + cronômetro. Estado efêmero, mas persistido em localStorage pra
// sobreviver a reload/bandeja (o timer usa um instante-alvo, não um contador).

const KEY = "localagenda.clock";

interface Snapshot {
  timerTotal: number;
  timerEndsAt: number | null;
  timerLeft: number;
  timerRunning: boolean;
  swRunning: boolean;
  swBase: number | null;
  swAccum: number;
  laps: number[];
}

function load(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...(JSON.parse(raw) as Snapshot) };
  } catch {
    /* ignore */
  }
  return blank();
}

function blank(): Snapshot {
  return {
    timerTotal: 5 * 60,
    timerEndsAt: null,
    timerLeft: 5 * 60,
    timerRunning: false,
    swRunning: false,
    swBase: null,
    swAccum: 0,
    laps: [],
  };
}

interface ClockState extends Snapshot {
  setTimerTotal(sec: number): void;
  startTimer(sec?: number): void;
  pauseTimer(): void;
  resetTimer(): void;
  /** Chamado pelo tick do App: se venceu, zera e retorna true (uma única vez). */
  fireTimer(): boolean;
  timerRemaining(): number;

  swStart(): void;
  swPause(): void;
  swReset(): void;
  swLap(): void;
  swElapsed(): number;
}

export const useClock = create<ClockState>((set, get) => {
  const persist = () => {
    const s = get();
    const snap: Snapshot = {
      timerTotal: s.timerTotal,
      timerEndsAt: s.timerEndsAt,
      timerLeft: s.timerLeft,
      timerRunning: s.timerRunning,
      swRunning: s.swRunning,
      swBase: s.swBase,
      swAccum: s.swAccum,
      laps: s.laps,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(snap));
    } catch {
      /* ignore */
    }
  };
  const setP = (patch: Partial<ClockState>) => {
    set(patch);
    persist();
  };

  return {
    ...load(),

    setTimerTotal: (sec) => setP({ timerTotal: sec, timerLeft: sec, timerEndsAt: null, timerRunning: false }),

    startTimer: (sec) => {
      const total = sec ?? (get().timerRunning ? get().timerTotal : get().timerLeft || get().timerTotal);
      if (total <= 0) return;
      setP({
        timerTotal: sec ?? get().timerTotal,
        timerEndsAt: Date.now() + total * 1000,
        timerRunning: true,
      });
    },

    pauseTimer: () => {
      const left = get().timerRemaining();
      setP({ timerRunning: false, timerEndsAt: null, timerLeft: left });
    },

    resetTimer: () => setP({ timerRunning: false, timerEndsAt: null, timerLeft: get().timerTotal }),

    fireTimer: () => {
      const s = get();
      if (s.timerRunning && s.timerEndsAt !== null && Date.now() >= s.timerEndsAt) {
        setP({ timerRunning: false, timerEndsAt: null, timerLeft: s.timerTotal });
        return true;
      }
      return false;
    },

    timerRemaining: () => {
      const s = get();
      if (s.timerRunning && s.timerEndsAt !== null) {
        return Math.max(0, Math.round((s.timerEndsAt - Date.now()) / 1000));
      }
      return s.timerLeft;
    },

    swStart: () => setP({ swRunning: true, swBase: Date.now() }),
    swPause: () => {
      const s = get();
      const add = s.swRunning && s.swBase !== null ? Date.now() - s.swBase : 0;
      setP({ swRunning: false, swBase: null, swAccum: s.swAccum + add });
    },
    swReset: () => setP({ swRunning: false, swBase: null, swAccum: 0, laps: [] }),
    swLap: () => setP({ laps: [...get().laps, get().swElapsed()] }),
    swElapsed: () => {
      const s = get();
      return s.swAccum + (s.swRunning && s.swBase !== null ? Date.now() - s.swBase : 0);
    },
  };
});
