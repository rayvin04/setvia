import { Mascot } from "./Mascot";
import type { PlaygroundAgent } from "../shared/playground";

export function AgentCat({ agent }: { agent: PlaygroundAgent }) {
  if (agent === "speaker")
    return (
      <div className="playground-original-cat">
        <Mascot />
      </div>
    );
  return (
    <svg
      className="agent-cat"
      viewBox="0 0 140 112"
      fill="none"
      aria-hidden="true"
    >
      {agent === "listener" && (
        <>
          <path
            d="M103 91c21 2 23-19 15-25"
            stroke="#CFB899"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path d="M39 92c0-20 7-32 29-32s32 12 33 32" fill="#D8C6A9" />
          <path
            d="M33 37c-12-19-7-27 9-19l15 10m28-1 15-9c17-9 20 3 8 20"
            fill="#E8D8BE"
            stroke="#B09C80"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="m31 21 10 14 10-5m49-9-10 14-10-5" fill="#B49B83" />
          <path
            d="M24 55c0-24 17-34 45-34 29 0 46 12 46 35 0 26-20 36-46 36S24 79 24 55"
            fill="#E8D8BE"
          />
          <path
            d="M33 42c-5-6-7-12-6-20m78 20c6-6 9-12 9-20"
            stroke="#B6A083"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <ellipse cx="51" cy="54" rx="7" ry="9" fill="#344D48" />
          <ellipse cx="87" cy="54" rx="7" ry="9" fill="#344D48" />
          <g className="agent-cat-eyes">
            <ellipse cx="52" cy="55" rx="3" ry="6" fill="#102824" />
            <ellipse cx="86" cy="55" rx="3" ry="6" fill="#102824" />
            <circle cx="53" cy="51" r="2" fill="#FFF9E9" />
            <circle cx="87" cy="51" r="2" fill="#FFF9E9" />
          </g>
          <ellipse cx="69" cy="71" rx="20" ry="11" fill="#F7EAD3" />
          <path d="m65 66 4 4 4-4" fill="#AE776B" />
          <path
            d="M69 70v4m0 0c-3 4-7 3-9 0m9 0c3 4 7 3 9 0"
            stroke="#886E60"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="m28 64 15 2M27 72l16-2m52-4 16-2m-16 6 17 2"
            stroke="#B39A7E"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M47 96v-8m44 8v-8" stroke="#AD9679" strokeWidth="1.5" />
          <path
            d="M31 99h21m35 0h20"
            stroke="#E8D8BE"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M20 54v-4c0-27 20-39 49-39 30 0 50 13 50 39v4"
            stroke="#0479AC"
            strokeWidth="4"
          />
          <rect x="14" y="45" width="14" height="26" rx="7" fill="#0297DE" />
          <rect x="111" y="45" width="14" height="26" rx="7" fill="#0297DE" />
        </>
      )}
      {agent === "judge" && (
        <>
          <path
            d="M99 94c23 7 30-10 26-22"
            stroke="#899CA6"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <path d="m35 98 5-28h58l9 28" fill="#A9BAC2" />
          <path
            d="M30 49 33 12l25 18m23 0 26-18 4 37"
            fill="#A9BAC2"
            stroke="#748B98"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="m39 22 3 18 12-7m37 0 9-10 2 18" fill="#D3ADB0" />
          <path
            d="m31 40-9 9 5 6-9 9 10 5-5 10 14 3 1 9 15-3c9 6 26 6 34 0l15 3 2-9 14-3-5-10 9-5-8-9 5-6-9-9C101 24 41 23 31 40"
            fill="#A9BAC2"
          />
          <path
            d="M43 48q9-7 17 0m20 0q9-7 17 0"
            stroke="#5D7380"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <g className="agent-cat-eyes">
            <ellipse cx="51" cy="58" rx="5" ry="7" fill="#D7BB68" />
            <ellipse cx="88" cy="58" rx="5" ry="7" fill="#D7BB68" />
            <path
              d="M51 54v8m37-8v8"
              stroke="#273943"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
          <path d="M49 75q20-19 40 0c-6 16-34 16-40 0" fill="#E7E9DF" />
          <path d="m66 70 4 4 4-4" fill="#7B6668" />
          <path
            d="M70 74v4m-6 2q6 3 12 0"
            stroke="#65727A"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <g stroke="#1B3445" strokeWidth="2.6">
            <circle cx="50" cy="58" r="14" />
            <circle cx="89" cy="58" r="14" />
            <path d="M64 57q6-4 11 0m-39-3-9-3m76 3 9-3" />
          </g>
          <path d="M48 91h43l-4 9H54" fill="#0297DE" />
          <path d="M57 94h24" stroke="#8FD9ED" strokeWidth="1.5" />
          <path
            d="M35 101h20m29 0h21"
            stroke="#BCC9CE"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </>
      )}
      {agent === "negotiator" && (
        <>
          <path
            d="M108 89c20-5 21-25 10-30"
            stroke="#D88949"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <path d="m119 66 6 2m-5 12 5 3" stroke="#A95B34" strokeWidth="4" />
          <path d="M36 98c0-25 10-37 34-37s35 12 35 37" fill="#E4A15C" />
          <ellipse cx="70" cy="91" rx="19" ry="18" fill="#F4D9AD" />
          <path
            d="M31 47 34 13q1-5 5-1l22 20h19l20-20q4-4 5 2l4 32"
            fill="#E4A15C"
            stroke="#BA7845"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="m40 24 2 17 12-6m32 0 12-12 2 18" fill="#DE9A8B" />
          <path
            d="M29 55c0-24 19-32 41-32s42 10 42 32c0 23-18 34-42 34S29 78 29 55"
            fill="#E4A15C"
          />
          <path
            d="m60 29 5 9 5-10 5 10 5-9m-47 22 10 3m-11 8 10-2m59-9-10 3m11 8-10-2"
            stroke="#AE6034"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g className="agent-cat-eyes">
            <ellipse cx="52" cy="54" rx="6" ry="8" fill="#526E58" />
            <ellipse cx="87" cy="54" rx="6" ry="8" fill="#526E58" />
            <ellipse cx="53" cy="55" rx="2.5" ry="6" fill="#263C32" />
            <ellipse cx="86" cy="55" rx="2.5" ry="6" fill="#263C32" />
            <circle cx="54" cy="51" r="1.7" fill="#FFF4DB" />
            <circle cx="87" cy="51" r="1.7" fill="#FFF4DB" />
          </g>
          <path d="M48 68q22-12 43 0c0 16-43 16-43 0" fill="#F8DEB6" />
          <path d="m65 65 5 4 5-4" fill="#B36B61" />
          <path
            d="M70 69v4m0 0q-5 5-10 0m10 0q5 5 10 0"
            stroke="#94613E"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="M41 88 24 95m76-7 16 7"
            stroke="#E4A15C"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d="M45 103h14m24 0h14"
            stroke="#F4D9AD"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
