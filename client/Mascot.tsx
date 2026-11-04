export function Mascot() {
  return (
    <svg className="mascot" viewBox="0 0 100 80" fill="none" aria-hidden="true">
      <path
        d="M77 59c20-2 24-21 15-27-5-3-10 1-8 6 3 7-1 11-9 12"
        stroke="#FC734D"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M19 45 17 14q0-8 7-3l17 12q11-4 20 0L76 9q7-5 7 4l-1 32q9 27-30 29Q11 75 19 45Z"
        fill="#080D11"
        stroke="#536774"
        strokeWidth="1.5"
      />
      <ellipse cx="40" cy="45" rx="6" ry="9" fill="#FAF8EB" />
      <ellipse cx="61" cy="45" rx="6" ry="9" fill="#FAF8EB" />
      <path
        d="m48 59 3 2 3-2"
        stroke="#FC734D"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M27 69q-8 0-8 6t13 3q7-3 2-7M66 71q-5 5 2 7t13-3q0-7-8-6"
        fill="#080D11"
        stroke="#536774"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function ComposerCat() {
  return (
    <svg className="composer-cat" viewBox="0 0 88 76" fill="none" aria-hidden="true">
      <path d="M20 28 19 12q0-7 6-2l11 10q10-3 20 1l10-9q6-5 6 3l-1 16q10 8 6 20-4 14-32 14T14 52q-5-13 6-24Z" fill="#FC734D" stroke="#A44731" strokeWidth="1.5" />
      <path d="m24 17 7 8-7 2ZM66 18l-7 8 8 3Z" fill="#FFB493" />
      <path d="m39 24 2 7m7-7-1 7M21 41l7 2m-7 5 7 1m38-7-6 2m7 4-7 1" stroke="#B94E30" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M27 38q6-7 13-1-5 8-13 1ZM50 37q7-5 12 1-7 7-12-1Z" fill="#14252C" />
      <circle cx="32" cy="38" r="1.3" fill="#FFF1D8" />
      <circle cx="55" cy="37" r="1.3" fill="#FFF1D8" />
      <path d="M32 50q4-6 12-3 8-3 13 2 3 10-12 10-14 0-13-9Z" fill="#FFDBAD" />
      <path d="m41 47 4 3 4-3Z" fill="#743C32" />
      <path d="M45 50v3m-5 0q2 3 5 0 3 3 6-1" stroke="#743C32" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 61q-8 1-8 7 0 6 14 5 9-1 9-6 0-7-15-6ZM60 61q-10 0-10 7 1 6 14 5 12-1 11-7-1-5-15-5Z" fill="#FC734D" stroke="#A44731" strokeWidth="1.5" />
      <path d="m23 67 1 4m5-4 1 4m29-4 1 4m5-4 1 4" stroke="#BE5436" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const catAvatars = [
  {
    name: "black-cat",
    background: "#174254",
    fur: "#11191e",
    innerEar: "#fc734d",
    muzzle: "#ece8dc",
    eye: "#fff8e8",
    pupil: "#20201d",
    nose: "#fc734d",
    marking: "black",
  },
  {
    name: "tuxedo",
    background: "#3d5663",
    fur: "#141b20",
    innerEar: "#71838a",
    muzzle: "#f2efe5",
    eye: "#fff8e8",
    pupil: "#20201d",
    nose: "#d98171",
    marking: "tuxedo",
  },
  {
    name: "orange-tabby",
    background: "#81513b",
    fur: "#df8047",
    innerEar: "#f0a36e",
    muzzle: "#f5d9b6",
    eye: "#fff1d7",
    pupil: "#422d22",
    nose: "#a94f39",
    marking: "tabby",
  },
  {
    name: "silver-gray",
    background: "#3d5965",
    fur: "#9eabb0",
    innerEar: "#667d87",
    muzzle: "#eeeade",
    eye: "#fff9e8",
    pupil: "#26343a",
    nose: "#d98989",
    marking: "gray",
  },
  {
    name: "cream-point",
    background: "#66584f",
    fur: "#e7d3b4",
    innerEar: "#a77a60",
    muzzle: "#f6ead3",
    eye: "#463b38",
    pupil: "#242526",
    nose: "#a66d5d",
    marking: "point",
  },
  {
    name: "calico",
    background: "#6a5048",
    fur: "#f0dfc5",
    innerEar: "#c38a69",
    muzzle: "#fbefdb",
    eye: "#4c4038",
    pupil: "#222629",
    nose: "#cb7e70",
    marking: "calico",
  },
] as const;

type CatMarking = (typeof catAvatars)[number]["marking"];

function CatMarkings({
  marking,
  color,
}: {
  marking: CatMarking;
  color: string;
}) {
  if (marking === "tuxedo") {
    return (
      <path
        d="M20.2 16.4q3.8-2.4 7.6 0l2.6 11.3-6.4 5.1-6.4-5.1z"
        fill={color}
      />
    );
  }
  if (marking === "tabby" || marking === "gray") {
    return (
      <g fill="none" stroke={color} strokeLinecap="round" strokeWidth="2.1">
        <path d="m17.5 15.8 2.1 4.2M24 14.8v5.1m6.5-4.1-2.1 4.2M10.5 27l4.1 1.2m22.9-1.2-4.1 1.2" />
      </g>
    );
  }
  if (marking === "point") {
    return (
      <g fill={color}>
        <path d="m9.2 11.5 8.4 4.8-3.1 5.1-5.3-1.8zM38.8 11.5l-8.4 4.8 3.1 5.1 5.3-1.8z" />
        <path d="M12.8 28.8q4-6.1 8.1-1.5l-1 7.2q-5.1.4-7.1-5.7ZM35.2 28.8q-4-6.1-8.1-1.5l1 7.2q5.1.4 7.1-5.7Z" />
      </g>
    );
  }
  if (marking === "calico") {
    return (
      <g>
        <path
          d="M9.1 10.1q5.6-4.1 11.1 1.4L19 21.8l-7 3.1-3-5.3z"
          fill={color}
        />
        <path
          d="M38.7 10.5q-5.7-3.7-10.8 1.7l1.1 8.7 6.8 2.5 3-5.1z"
          fill="#d77d47"
        />
        <path d="M34.2 29.2q4.5-.8 5.8 3.3l-5.2 4.4-4.5-3.5z" fill={color} />
      </g>
    );
  }
  return (
    <path
      d="M19.4 15.5q4.6-4.2 9.2.2l-1.5 4.2h-6.2z"
      fill="#27363b"
      opacity="0.72"
    />
  );
}

export function Avatar({ index = 0 }: { index?: number }) {
  const avatar =
    catAvatars[
      ((index % catAvatars.length) + catAvatars.length) % catAvatars.length
    ];
  return (
    <svg
      viewBox="0 0 48 48"
      className="avatar cat-avatar"
      data-cat-variant={avatar.name}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="23.2" fill={avatar.background} />
      <path
        d="M6.5 24 8 8.8q.3-3.2 3.1-1.2l8.5 7.7q4.4-1.8 8.8 0l8.5-7.7q2.8-2 3.1 1.2l1.5 15.1c1.3 10.4-5.7 18.2-17.5 18.2S5.2 34.4 6.5 24Z"
        fill={avatar.fur}
      />
      <path
        d="m10.1 11.1 7.4 6.6-5.4 1.2zM37.9 11.1l-7.4 6.6 5.4 1.2z"
        fill={avatar.innerEar}
      />
      <CatMarkings
        marking={avatar.marking}
        color={
          avatar.marking === "tabby"
            ? "#a45232"
            : avatar.marking === "gray"
              ? "#667a83"
              : avatar.innerEar
        }
      />
      <ellipse cx="18.4" cy="21.9" rx="2.4" ry="2.7" fill={avatar.eye} />
      <ellipse cx="29.6" cy="21.9" rx="2.4" ry="2.7" fill={avatar.eye} />
      <ellipse cx="18.8" cy="22" rx="0.9" ry="1.4" fill={avatar.pupil} />
      <ellipse cx="30" cy="22" rx="0.9" ry="1.4" fill={avatar.pupil} />
      <ellipse cx="24" cy="30.3" rx="7.6" ry="5.1" fill={avatar.muzzle} />
      <path d="m22.1 29.4 1.9-1.2 1.9 1.2-1.9 1.7z" fill={avatar.nose} />
      <path
        d="M24 31.1v1.8m0 0q-2.2 2.6-4.4 0m4.4 0q2.2 2.6 4.4 0"
        fill="none"
        stroke="#3d3934"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="m15.8 30.4-4.6-1m4.5 3-4.2.4m20.7-2.4 4.6-1m-4.5 3 4.2.4"
        fill="none"
        stroke={avatar.muzzle}
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
