// Renders GitHub profile stats as 4 static UNO-style cards, laid out side by side.

const login = process.env.GH_LOGIN;
const outPath = process.argv[2] || process.env.SVG_OUT_PATH || "dist/uno-stats.svg";

const COLORS = {
  red: "#ED1C24",
  yellow: "#FFCC00",
  green: "#38B449",
  blue: "#0072BC",
};

// Scrapes the public, unauthenticated contributions HTML instead of calling GraphQL, since GraphQL requires a bearer
// token outside the default GITHUB_TOKEN's scope. Avoids requiring any secret or setup step for forks.
async function fetchProfile() {
  const userRes = await fetch(`https://api.github.com/users/${login}`, {
    headers: { "User-Agent": login },
  });
  if (!userRes.ok) throw new Error(`REST user lookup failed: ${userRes.status}`);
  const { created_at } = await userRes.json();

  const contribRes = await fetch(`https://github.com/users/${login}/contributions`, {
    headers: { "User-Agent": login },
  });
  if (!contribRes.ok) throw new Error(`Contributions page fetch failed: ${contribRes.status}`);
  const html = await contribRes.text();

  const dateById = new Map();
  for (const match of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})" id="(contribution-day-component-[\d-]+)"/g)) {
    dateById.set(match[2], match[1]);
  }

  const days = [];
  for (const match of html.matchAll(/<tool-tip[^>]*for="(contribution-day-component-[\d-]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const date = dateById.get(match[1]);
    if (!date) continue;
    const text = match[2].trim();
    const count = /^no contributions/i.test(text) ? 0 : parseInt(text, 10) || 0;
    days.push({ date, contributionCount: count });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  if (days.length === 0) {
    throw new Error("Parsed 0 contribution days - GitHub likely changed the contributions page markup");
  }

  return { createdAt: created_at, days };
}

export function computeStats({ createdAt, days }) {
  const yearsJoined = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (365.25 * 24 * 3600 * 1000)
  );

  let longestStreak = 0;
  let running = 0;
  for (const day of days) {
    running = day.contributionCount > 0 ? running + 1 : 0;
    longestStreak = Math.max(longestStreak, running);
  }

  // Counts backward from the last active day, so a streak still in progress with zero contributions today isn't misread
  // as broken.
  let currentStreak = 0;
  let index = days.length - 1;
  if (days[index] && days[index].contributionCount === 0) index--;
  for (; index >= 0 && days[index].contributionCount > 0; index--) currentStreak++;

  const lastWeek = days.slice(-7).reduce((sum, d) => sum + d.contributionCount, 0);
  const todayCount = days.length ? days[days.length - 1].contributionCount : 0;

  // Filters by year prefix instead of issuing a second request, since the scraped page's trailing ~12-month window
  // already covers Jan 1 through today of the current year.
  const currentYear = String(new Date().getUTCFullYear());
  const daysThisYear = days.filter((d) => d.date.startsWith(currentYear));
  const contributionsThisYear = daysThisYear.reduce((sum, d) => sum + d.contributionCount, 0);

  let longestStreakThisYear = 0;
  let runningThisYear = 0;
  for (const day of daysThisYear) {
    runningThisYear = day.contributionCount > 0 ? runningThisYear + 1 : 0;
    longestStreakThisYear = Math.max(longestStreakThisYear, runningThisYear);
  }

  return {
    yearsJoined,
    longestStreak,
    currentStreak,
    lastWeek,
    todayCount,
    contributionsThisYear,
    longestStreakThisYear,
  };
}

// Scales the center digit and corner index down as the value grows more digits, so a 3+ digit stat (e.g. "512") still
// fits inside the card instead of spilling past its edges.
function digitFontSizes(text) {
  const sizesByLength = [
    { center: 46, corner: 15 },
    { center: 46, corner: 15 },
    { center: 34, corner: 13 },
    { center: 26, corner: 11 },
  ];
  return sizesByLength[Math.min(text.length, sizesByLength.length) - 1];
}

function numberCard({ value, label, color, index }) {
  const text = String(value);
  const { center, corner } = digitFontSizes(text);

  return `
    <g class="deck-card" data-i="${index}">
      <rect x="-45" y="-65" width="90" height="130" rx="12" fill="#111"/>
      <rect x="-40" y="-60" width="80" height="120" rx="10" fill="${color}" stroke="#fff" stroke-width="3"/>
      <g transform="rotate(18)">
        <ellipse cx="0" cy="0" rx="34" ry="48" fill="#fff"/>
        <text x="0" y="${center * 0.34}" font-family="Georgia, 'Times New Roman', serif" font-size="${center}"
          font-weight="700" fill="${color}" text-anchor="middle">${text}</text>
      </g>
      <text x="-34" y="-44" font-family="Arial, sans-serif" font-size="${corner}" font-weight="700" fill="#fff">${text}</text>
      <text x="0" y="-72" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle"
        letter-spacing="1">${label}</text>
    </g>`;
}

// One small colored "mini card" per UNO color, each carrying that color's suit icon (matching the reference deck's
// red-circle/blue-triangle/green-diamond/yellow-heart convention), scattered and overlapping inside the wild card's
// oval like the real +2/+4 artwork.
const MINI_CARDS = [
  { color: COLORS.red, icon: `<circle cx="0" cy="0" r="6" fill="#fff"/>`, x: -11, y: -9, rotation: -14 },
  { color: COLORS.blue, icon: `<path d="M0,-7 L6,5 L-6,5 Z" fill="#fff"/>`, x: 11, y: -10, rotation: 12 },
  { color: COLORS.green, icon: `<path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill="#fff"/>`, x: 9, y: 10, rotation: -10 },
  {
    color: COLORS.yellow,
    icon: `<path d="M0,6 C-8,-2 -8,-8 0,-4 C8,-8 8,-2 0,6 Z" fill="#fff"/>`,
    x: -9,
    y: 9,
    rotation: 16,
  },
];

function wildPlusCard({ value, label, index }) {
  const text = `+${value}`;
  const { corner } = digitFontSizes(text);

  const miniCards = MINI_CARDS.map(
    (card) => `
      <g transform="translate(${card.x},${card.y}) rotate(${card.rotation})">
        <rect x="-11" y="-15" width="22" height="30" rx="4" fill="${card.color}" stroke="#fff" stroke-width="1.5"/>
        ${card.icon}
      </g>`
  ).join("");

  return `
    <g class="deck-card" data-i="${index}">
      <rect x="-45" y="-65" width="90" height="130" rx="12" fill="#111"/>
      <g transform="rotate(18)">
        <ellipse cx="0" cy="0" rx="34" ry="48" fill="#fff"/>
        ${miniCards}
      </g>
      <text x="-34" y="-44" font-family="Arial, sans-serif" font-size="${corner}" font-weight="700" fill="#fff">${text}</text>
      <text x="0" y="-72" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle"
        letter-spacing="1">${label}</text>
    </g>`;
}

// Plays once: jitters in place like a shuffle, then slides out to finalX and freezes there via fill="freeze" -
// repeatCount defaults to 1, so it never loops back to the stacked pile.
function dealAnimation({ index, finalX }) {
  const jitterSign = index % 2 === 0 ? 1 : -1;
  const keyTimes = "0; 0.15; 0.3; 0.45; 0.6; 1";
  const values = [
    "0,0",
    `${jitterSign * 18},0`,
    `${-jitterSign * 18},0`,
    `${jitterSign * 18},0`,
    "0,0",
    `${finalX},0`,
  ].join("; ");

  return `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}"
    dur="1.6s" fill="freeze"/>`;
}

export function buildSvg(stats) {
  // Flips the wild card's metric once per day via days-since-epoch parity.
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const showToday = daysSinceEpoch % 2 === 0;
  const wildValue = showToday ? stats.todayCount : stats.lastWeek;
  const wildLabel = showToday ? "TODAY" : "PAST 7 DAYS";

  const cardsDef = [
    { kind: "number", value: stats.yearsJoined, label: "JOINED YEARS", color: COLORS.blue },
    { kind: "number", value: stats.longestStreakThisYear, label: "STREAK THIS YEAR", color: COLORS.green },
    { kind: "number", value: stats.contributionsThisYear, label: "THIS YEAR", color: COLORS.red },
    { kind: "wild", value: wildValue, label: wildLabel },
  ];

  const n = cardsDef.length;
  const width = 900;
  const height = 220;
  const cx = width / 2;
  const cy = height / 2;
  const spacing = 160;

  // Deals each card once from the stacked center pile out to its flat, side-by-side slot, then freezes there -
  // no loop back to the pile, no repeat.
  const cardsMarkup = cardsDef.map((card, index) => {
    const x = (index - (n - 1) / 2) * spacing;
    const inner =
      card.kind === "wild"
        ? wildPlusCard({ value: card.value, label: card.label, index })
        : numberCard({ value: card.value, label: card.label, color: card.color, index });

    return `<g>${inner}${dealAnimation({ index, finalX: x })}</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g transform="translate(${cx},${cy})">
    ${cardsMarkup.join("\n")}
  </g>
</svg>`;
}

async function main() {
  if (!login) {
    throw new Error("GH_LOGIN env var is required");
  }

  const profile = await fetchProfile();
  const stats = computeStats(profile);
  const svg = buildSvg(stats);

  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, svg, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(stats);
}

const { pathToFileURL } = await import("node:url");
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
