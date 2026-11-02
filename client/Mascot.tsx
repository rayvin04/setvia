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
export function Avatar({ index = 0 }: { index?: number }) {
  const colors = ["#F5AA91", "#72BEDF", "#E6CF9D", "#A4BABB"];
  return (
    <svg viewBox="0 0 48 48" className="avatar" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill={colors[index % 4]} />
      <path
        d="M8 48q0-18 16-18t16 18"
        fill={index % 2 ? "#144A65" : "#423936"}
      />
      <ellipse cx="24" cy="23" rx="11" ry="13" fill="#F4C8A2" />
      <path
        d={
          index % 2
            ? "M12 24V14q12-17 25 0v13l-5-12-17 5Z"
            : "M13 21q-7-14 5-14 14-8 19 9l-8-3-7 7Z"
        }
        fill="#15242E"
      />
      <circle cx="20" cy="23" r="1.3" fill="#17252e" />
      <circle cx="28" cy="23" r="1.3" fill="#17252e" />
      <path
        d="M21 29q3 3 6 0"
        stroke="#845442"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
