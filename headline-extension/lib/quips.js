// Witty status lines shown while the request runs. The first line is always the same;
// the rest are shuffled, with theme-specific lines and data lines (when the article has
// tables) mixed in.

const FIRST = 'Preparing Stanley cups…';

const COMMON = [
  'Calling Lisa from BLACKPINK for a vibe check…',
  'Lara from KATSEYE is checking the API calls…',
  'Jennie is reading the first paragraph twice…',
  'Rosé is choosing between two Discover angles…',
  'Jisoo is double-checking every number…',
  'Manon from KATSEYE is counting characters…',
  'Sophia from KATSEYE is comparing it with the median…',
  'Megan from KATSEYE is sorting the keywords…',
  'Daniela from KATSEYE is choreographing the subheads…',
  'Yoonchae from KATSEYE is polishing the URL slug…',
  'Refilling the 40 oz tumbler…',
  'Asking Google Discover nicely…',
  'Making sure nobody wrote “You won’t believe”…',
  'Trimming the headline to 65 characters…',
  'Settling the Oxford comma debate…',
  'Bribing the search algorithm with chai…',
  'Checking the headline isn’t secretly clickbait…',
  'Teaching the AI the difference between lakh and crore…',
  'Waking up the night desk…',
  'Running it past the sub-editor in our heads…',
];

const DAY = [
  'Tying the pink bow…',
  'Picking the cutest Stanley colour…',
  'Ironing the gingham…',
  'Adding a sprinkle of hearts…',
  'Asking the kitten to approve the keywords…',
  'Matching the tumbler to the outfit…',
];

const NIGHT = [
  'Lighting the signal over the newsroom…',
  'Alfred is brewing a very strong coffee…',
  'Scanning the rooftops for keywords…',
  'Commissioner Gordon is waiting for the headline…',
  'Checking the utility belt for facts…',
  'Gliding over the search results…',
  'Lisa from BLACKPINK is on the night shift…',
  'Interrogating the clickbait under the streetlight…',
  'The city sleeps; the SEO doesn’t…',
];

const DATA = [
  'Running a Shapiro–Wilk test on your table…',
  'Checking whether that correlation is just a shared trend…',
  'Computing CAGR without a calculator…',
  'Looking for outliers hiding in plain sight…',
  'Weighting the averages properly…',
  'Asking Kendall and Spearman for a second opinion…',
];

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The order of lines for one run. With tables, every third line is a data line.
 * `random` is injectable for tests.
 */
export function quipSequence({ theme = 'day', hasTables = false, random = Math.random } = {}) {
  const pool = shuffle([...COMMON, ...(theme === 'night' ? NIGHT : DAY)], random);
  if (!hasTables) return [FIRST, ...pool];
  const data = shuffle(DATA, random);
  const out = [FIRST];
  pool.forEach((line, i) => {
    out.push(line);
    if (i % 2 === 1 && data.length) out.push(data.shift());
  });
  return out;
}

/**
 * Progress (0–0.95) for an elapsed time: fast at first, then easing towards 95%, since
 * the real duration is unknown. It reaches about 70% at the typical 15 seconds.
 */
export function progressFor(elapsedMs) {
  return Math.min(0.95, 1 - Math.exp(-elapsedMs / 12500));
}
