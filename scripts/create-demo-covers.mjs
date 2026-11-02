import { mkdir, writeFile } from "node:fs/promises";
const out = new URL("../public/covers/", import.meta.url);
await mkdir(out, { recursive: true });
let catCursor = 0;
const coats = [
  { name: "tuxedo", body: "#14242E", eye: "#FFF3DC", accent: "#FFF0DB" },
  { name: "orange-tabby", body: "#D47F45", eye: "#20313A", accent: "#A7522E" },
  { name: "cream-point", body: "#F4D9B2", eye: "#263B46", accent: "#9B735B" },
  { name: "silver-gray", body: "#81939F", eye: "#192E3A", accent: "#DCE5E7" },
  { name: "calico", body: "#F5E7CF", eye: "#253745", accent: "#DB8F53" },
];
const cat = (x, y, s = 1) => {
  const k = catCursor++ % coats.length;
  const c = coats[k];
  const shape =
    k % 2 === 0
      ? "M7 48 4 7q0-9 8-3l24 16q14-5 26 0L84 2q7-5 7 5l-2 43q12 45-40 45Q-3 95 7 48Z"
      : "M6 48 8 12q0-8 7-2l21 14q15-4 28 0L83 6q7-5 8 5l-2 38q17 43-39 45Q-9 93 6 48Z";
  const marks = [
    '<path d="M29 73q18-18 36 0l-7 20H37Z" fill="#FFF0DB"/><path d="m37 57 10-15 12 15-12 13Z" fill="#FFF0DB"/>',
    '<path d="m25 28 9 7m11-13v12m17-7-7 8M12 52l10 3m56-4-9 4" stroke="#A7522E" stroke-width="5" stroke-linecap="round"/>',
    '<path d="m10 13 18 13-16 10Zm72-2L66 26l20 9Z" fill="#9B735B"/><ellipse cx="47" cy="62" rx="18" ry="11" fill="#FFF0D8"/>',
    '<path d="m28 26 8 8m12-11v10m14-6-7 7" stroke="#526977" stroke-width="4" stroke-linecap="round"/><ellipse cx="46" cy="65" rx="17" ry="10" fill="#DCE5E7"/>',
    '<ellipse cx="17" cy="32" rx="12" ry="15" fill="#DB8F53"/><path d="M60 23 84 6l4 34q-20 5-28-17" fill="#33404A"/><ellipse cx="68" cy="78" rx="16" ry="12" fill="#DB8F53"/>',
  ][k];
  const eyes =
    k === 2
      ? '<path d="M27 49q6-8 12 0m15 0q6-8 12 0" fill="none" stroke="' +
        c.eye +
        '" stroke-width="4" stroke-linecap="round"/>'
      : '<ellipse cx="33" cy="48" rx="' +
        (k === 1 ? 5 : 7) +
        '" ry="' +
        (k === 1 ? 9 : 11) +
        '" fill="' +
        c.eye +
        '"/><ellipse cx="60" cy="48" rx="' +
        (k === 1 ? 5 : 7) +
        '" ry="' +
        (k === 1 ? 9 : 11) +
        '" fill="' +
        c.eye +
        '"/>';
  return (
    '<g data-cat-style="' +
    c.name +
    '" transform="translate(' +
    x +
    " " +
    y +
    ") scale(" +
    s +
    ')"><path d="M70 65q50 8 43-30" fill="none" stroke="' +
    c.body +
    '" stroke-width="13" stroke-linecap="round"/><path d="' +
    shape +
    '" fill="' +
    c.body +
    '"/>' +
    marks +
    eyes +
    '<path d="m43 66 4 3 4-3" fill="none" stroke="' +
    (k === 0 ? "#FC9E78" : "#715047") +
    '" stroke-width="3" stroke-linecap="round"/><ellipse cx="20" cy="88" rx="16" ry="8" fill="' +
    (k === 0 || k === 3 ? c.accent : c.body) +
    '"/><ellipse cx="76" cy="88" rx="16" ry="8" fill="' +
    (k === 0 || k === 3 ? c.accent : c.body) +
    '"/></g>'
  );
};
const leaf = (x, y, rotation) =>
  '<ellipse cx="' +
  x +
  '" cy="' +
  y +
  '" rx="38" ry="13" fill="#225C56" transform="rotate(' +
  rotation +
  " " +
  x +
  " " +
  y +
  ')"/>';
function scene(id, c) {
  if (id === "beach")
    return (
      '<path d="M0 250Q180 215 300 250T600 240V450H0Z" fill="' +
      c.water +
      '"/><path d="M0 330Q190 295 320 336T600 310V450H0Z" fill="' +
      c.sand +
      '"/><path d="M0 290Q150 270 265 290M350 280q80 20 160 0" fill="none" stroke="#BEEBEE" stroke-width="7" stroke-linecap="round"/><path d="M107 337Q145 200 111 132" fill="none" stroke="#925A3C" stroke-width="17" stroke-linecap="round"/>' +
      leaf(100, 132, -28) +
      leaf(144, 130, 25) +
      leaf(105, 111, 65) +
      leaf(146, 111, -40) +
      '<rect x="270" y="337" width="173" height="85" rx="12" fill="#FC9773" transform="rotate(-8 270 337)"/><path d="m310 330 12 84m30-90 12 84m30-90 12 84" stroke="#FFF0D8" stroke-width="9" opacity=".7"/>' +
      cat(315, 244, 1.02) +
      '<circle cx="486" cy="362" r="28" fill="#FFF0D8"/><path d="M486 334v56M458 362h56" stroke="#0297DE" stroke-width="9"/>'
    );
  if (id === "family")
    return (
      '<rect x="64" y="60" width="175" height="200" rx="85" fill="' +
      c.water +
      '"/><path d="M151 60v190M67 154h170" stroke="#F8E6CB" stroke-width="10"/><path d="M493 245v102" stroke="#614633" stroke-width="12"/>' +
      leaf(475, 224, -35) +
      leaf(509, 196, 40) +
      leaf(473, 172, -35) +
      '<path d="M455 309h74l-9 55h-54Z" fill="#D98162"/>' +
      cat(94, 230, 0.95) +
      cat(264, 207, 1.06) +
      cat(400, 238, 0.9) +
      '<ellipse cx="304" cy="366" rx="230" ry="64" fill="#A95740"/><ellipse cx="304" cy="348" rx="230" ry="64" fill="' +
      c.sand +
      '"/><ellipse cx="302" cy="350" rx="70" ry="26" fill="#F5F1DA"/><ellipse cx="302" cy="346" rx="44" ry="16" fill="#DD8458"/><circle cx="272" cy="341" r="9" fill="#35665B"/><circle cx="310" cy="346" r="10" fill="#35665B"/><ellipse cx="146" cy="343" rx="35" ry="15" fill="#F5F1DA"/><ellipse cx="457" cy="345" rx="35" ry="15" fill="#F5F1DA"/><path d="M91 382v67m423-67v67" stroke="#6E493C" stroke-width="15"/>'
    );
  if (id === "kickoff")
    return (
      '<rect x="117" y="73" width="359" height="209" rx="20" fill="#EEF0DB"/><rect x="138" y="96" width="317" height="162" rx="8" fill="' +
      c.water +
      '"/><rect x="166" y="126" width="75" height="42" rx="8" fill="#F6B991"/><rect x="265" y="169" width="75" height="42" rx="8" fill="#CEE3CC"/><rect x="363" y="126" width="65" height="42" rx="8" fill="#E9F0DE"/><path d="m241 146 24 44m75 0 23-44" fill="none" stroke="#F1EFDE" stroke-width="5"/>' +
      cat(66, 264, 1.05) +
      cat(411, 260, 1.08) +
      '<path d="M136 349h343l34 56H100Z" fill="' +
      c.sand +
      '"/><path d="M142 405v45m326-45v45" stroke="#32505C" stroke-width="13"/><rect x="247" y="316" width="117" height="71" rx="9" fill="#123343"/><path d="M233 389h145" stroke="#FC9773" stroke-width="10" stroke-linecap="round"/><circle cx="306" cy="351" r="8" fill="#87D2EB"/>'
    );
  if (id === "study")
    return (
      '<rect x="55" y="314" width="490" height="30" rx="13" fill="' +
      c.sand +
      '"/><path d="M88 341v109m426-109v109" stroke="#3C5957" stroke-width="17"/>' +
      cat(89, 202, 1.15) +
      cat(390, 218, 1.03) +
      '<rect x="240" y="218" width="141" height="100" rx="11" fill="#173847"/><rect x="254" y="231" width="113" height="72" rx="5" fill="' +
      c.water +
      '"/><path d="M276 253h58m-58 17h42m-42 17h64" stroke="#DFF0E8" stroke-width="7" stroke-linecap="round"/><path d="M222 320h176" stroke="#FC9773" stroke-width="11" stroke-linecap="round"/><rect x="60" y="120" width="99" height="25" rx="6" fill="#F0C68A" transform="rotate(-12 60 120)"/><rect x="70" y="151" width="91" height="22" rx="5" fill="#FC9671"/><path d="m424 128 44-31 11 15-44 31-19 3Z" fill="#F0C68A"/><path d="m416 146 8-18 11 15Z" fill="#173847"/><path d="M219 137h83m-41-37v74" stroke="#A6CDBE" stroke-width="5" stroke-linecap="round"/>'
    );
  return (
    '<path d="M145 350V170q0-130 155-130t155 130v180" fill="none" stroke="#F8E6CA" stroke-width="22"/><path d="M145 347V170q0-130 155-130" fill="none" stroke="#658C72" stroke-width="8"/><path d="M455 347V170q0-130-155-130" fill="none" stroke="#658C72" stroke-width="8"/>' +
    [
      [156, 150],
      [168, 110],
      [199, 76],
      [240, 51],
      [352, 53],
      [398, 85],
      [431, 127],
    ]
      .map(
        ([x, y]) =>
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="20" fill="#F7B29A"/><circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="8" fill="#F5DEAF"/>',
      )
      .join("") +
    '<path d="M0 372q300-69 600 0v78H0Z" fill="' +
    c.sand +
    '"/>' +
    cat(188, 247, 1.1) +
    cat(327, 247, 1.1) +
    '<path d="M277 215c-20-25-56 0 23 47 79-47 43-72 23-47-15-16-31-16-46 0" fill="#E98B7B"/><path d="M184 362q58-23 109 0m32 0q57-23 109 0" stroke="#F1C29D" stroke-width="7" fill="none"/><path d="m72 323 14 37m429-37-14 37" stroke="#658C72" stroke-width="9" stroke-linecap="round"/>'
  );
}
const ids = ["beach", "family", "kickoff", "study", "wedding"];
const palettes = [
  { bg: "#A6DEEA", water: "#297FA0", sand: "#EBC9A0", sun: "#FC9970" },
  { bg: "#E9B49E", water: "#6D858C", sand: "#E8C8AB", sun: "#FFF0CC" },
  { bg: "#4E7199", water: "#2E5676", sand: "#BAAFBE", sun: "#B9DBEA" },
];
for (const id of ids)
  for (let v = 0; v < 3; v++) {
    catCursor = ids.indexOf(id) + v * 2;
    const c = palettes[v];
    const bg =
      '<rect width="600" height="450" fill="' +
      c.bg +
      '"/><circle cx="' +
      (v === 1 ? 100 : 480) +
      '" cy="83" r="48" fill="' +
      c.sun +
      '"/><path d="M0 397q155-48 300 0t300 0v53H0Z" fill="' +
      c.water +
      '" opacity=".18"/>';
    const sky =
      v === 2
        ? '<g fill="#FFF0D8"><circle cx="75" cy="67" r="3"/><circle cx="199" cy="42" r="3"/><circle cx="379" cy="103" r="3"/><circle cx="552" cy="171" r="3"/></g>'
        : '<path d="M51 76h55m248 50h64" stroke="#FFF5E3" stroke-width="13" stroke-linecap="round" opacity=".6"/>';
    const transform =
      v === 1
        ? "translate(600 0) scale(-1 1)"
        : v === 2
          ? "translate(-24 -12) scale(1.08)"
          : "";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" role="img"><title>Setvia ' +
      id +
      " authored cartoon cover " +
      (v + 1) +
      "</title>" +
      bg +
      sky +
      '<g transform="' +
      transform +
      '">' +
      scene(id, c) +
      "</g></svg>";
    await writeFile(new URL(id + "-" + (v + 1) + ".svg", out), svg);
  }
console.log("Created 15 original authored cartoon covers.");
