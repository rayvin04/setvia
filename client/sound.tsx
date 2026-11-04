import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { createUISFX } from "uisfx";
import type { CueName, PlayingSFX, UISFXPlayer } from "uisfx";

const PREFERENCES_KEY = "setvia.sound.preferences.v1";
const LEGACY_ENABLED_KEY = "setvia.sound.enabled.v1";
const MASTER_VOLUME = 0.32;

type SoundContextValue = {
  enabled: boolean;
  toggle: () => void;
  unlockFromGesture: () => void;
  play: (cue: CueName) => void;
  startLoop: (key: string, cue: CueName) => void;
  stopLoop: (key: string) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);

function readEnabledPreference(): boolean {
  try {
    const saved = window.localStorage.getItem(PREFERENCES_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "enabled" in parsed &&
        typeof parsed.enabled === "boolean"
      ) {
        return parsed.enabled;
      }
    }
    return window.localStorage.getItem(LEGACY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function SetviaSoundProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [enabled, setEnabled] = useState(readEnabledPreference);
  const enabledRef = useRef(enabled);
  const unlockedRef = useRef(false);
  const playerRef = useRef<UISFXPlayer | null>(null);
  const loopsRef = useRef(new Map<string, PlayingSFX>());

  const player = useCallback(() => {
    if (!playerRef.current) {
      const instance = createUISFX({
        pack: "zen",
        volume: MASTER_VOLUME,
        enabled: enabledRef.current,
        preferences: { key: PREFERENCES_KEY },
      });
      instance.setEnabled(enabledRef.current);
      playerRef.current = instance;
    }
    return playerRef.current;
  }, []);

  const unlockFromGesture = useCallback(() => {
    if (!enabledRef.current) return;
    unlockedRef.current = true;
    void player().unlock();
  }, [player]);

  const play = useCallback(
    (cue: CueName) => {
      if (!enabledRef.current || !unlockedRef.current) return;
      try {
        player().play(cue);
      } catch {
        // Audio remains secondary to visible interface feedback.
      }
    },
    [player],
  );

  const startLoop = useCallback(
    (key: string, cue: CueName) => {
      if (!enabledRef.current || !unlockedRef.current) return;
      const loops = loopsRef.current;
      if (loops.has(key)) return;
      try {
        const handle = player().play(cue, { loop: true, retrigger: "ignore" });
        if (handle) loops.set(key, handle);
      } catch {
        // Looping audio is optional; the mascot and status text show progress.
      }
    },
    [player],
  );

  const stopLoop = useCallback((key: string) => {
    loopsRef.current.get(key)?.stop();
    loopsRef.current.delete(key);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    const instance = player();
    instance.setEnabled(next);
    if (next) {
      unlockedRef.current = true;
      void instance.unlock().then((unlocked) => {
        if (unlocked && enabledRef.current) instance.play("toggle-on");
      });
    } else {
      unlockedRef.current = false;
      loopsRef.current.clear();
      instance.stopAll();
    }
  }, [player]);

  useEffect(() => {
    for (const handle of loopsRef.current.values()) handle.stop();
    loopsRef.current.clear();
    // A route change must never leave a processing or connection loop behind.
  }, [pathname]);

  useEffect(() => {
    const stopAudio = () => {
      playerRef.current?.stopAll();
      loopsRef.current.clear();
    };
    window.addEventListener("pagehide", stopAudio);
    return () => {
      window.removeEventListener("pagehide", stopAudio);
      stopAudio();
      const current = playerRef.current;
      playerRef.current = null;
      if (current) void current.destroy();
    };
  }, []);

  const value = useMemo(
    () => ({ enabled, toggle, unlockFromGesture, play, startLoop, stopLoop }),
    [enabled, toggle, unlockFromGesture, play, startLoop, stopLoop],
  );

  return (
    <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
  );
}

export function useSetviaSounds(): SoundContextValue {
  const value = useContext(SoundContext);
  if (!value)
    throw new Error("useSetviaSounds must be used within SetviaSoundProvider");
  return value;
}
