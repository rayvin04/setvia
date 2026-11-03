import { useEffect, useRef } from "react";
export function Waves() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) =>
      el.classList.toggle("is-visible", entry.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="wave-scene" aria-hidden="true">
      <div className="wave-haze wave-haze-blue" />
      <div className="wave-haze wave-haze-orange" />
      <svg
        className="wave-lines wave-lines-back"
        viewBox="0 0 1600 700"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="wave-blue">
            <stop stopColor="#0297DE" stopOpacity="0" />
            <stop offset=".35" stopColor="#0297DE" />
            <stop offset=".65" stopColor="#FC734D" />
            <stop offset="1" stopColor="#FC734D" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 38 }, (_, i) => (
          <path
            key={i}
            d={`M -100 ${450 + i * 5} C 260 ${570 + i * 5}, 410 ${110 + i * 6}, 770 ${290 + i * 5} S 1240 ${570 + i * 4}, 1700 ${300 + i * 5}`}
            fill="none"
            stroke="url(#wave-blue)"
            strokeWidth=".8"
            opacity={0.12 + Math.sin((i / 38) * Math.PI) * 0.35}
          />
        ))}
      </svg>
      <svg
        className="wave-lines wave-lines-front"
        viewBox="0 0 1600 700"
        preserveAspectRatio="none"
      >
        {Array.from({ length: 28 }, (_, i) => (
          <path
            key={i}
            d={`M -100 ${610 + i * 3} C 350 ${630 + i * 4}, 470 ${350 + i * 3}, 850 ${440 + i * 3} S 1230 ${620 + i * 4}, 1700 ${500 + i * 3}`}
            fill="none"
            stroke="url(#wave-blue)"
            strokeWidth=".7"
            opacity={0.14 + Math.sin((i / 28) * Math.PI) * 0.25}
          />
        ))}
      </svg>
    </div>
  );
}
