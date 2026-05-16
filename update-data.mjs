import fs from "node:fs/promises";
import path from "node:path";

const CURRENT_SEASON = "2526";
const HISTORICAL_SEASONS = ["2526", "2425", "2324", "2223", "2122"];

const MAIN_LEAGUES = {
  "Premier League": "E0",
  "Championship": "E1",
  "League One": "E2",
  "League Two": "E3",
  "National League Inglaterra": "EC",

  "La Liga": "SP1",
  "La Liga 2": "SP2",

  "Serie A": "I1",
  "Serie B": "I2",

  "Bundesliga": "D1",
  "Bundesliga 2": "D2",

  "Ligue 1": "F1",
  "Ligue 2": "F2",

  "Eredivisie": "N1",
  "Primeira Liga": "P1",

  "Scottish Premiership": "SC0",
  "Scottish Championship": "SC1",
  "Scottish League One": "SC2",
  "Scottish League Two": "SC3",

  "Belgian Pro League": "B1",
  "Greek Super League": "G1",
  "Turkish Super Lig": "T1"
};

const EXTRA_LEAGUES = {
  "Argentina Primera División": "ARG",
  "Austria Bundesliga": "AUT",
  "Brasil Serie A": "BRA",
  "China Super League": "CHN",
  "Dinamarca Superliga": "DNK",
  "Finlandia Veikkausliiga": "FIN",
  "Irlanda Premier Division": "IRL",
  "Japón J-League": "JPN",
  "México Liga MX": "MEX",
  "Noruega Eliteserien": "NOR",
  "Polonia Ekstraklasa": "POL",
  "Rumania Liga I": "ROU",
  "Rusia Premier League": "RUS",
  "Suecia Allsvenskan": "SWE",
  "Suiza Super League": "SWZ",
  "USA MLS": "USA"
};
function mainCsvUrl(season, code) {
  return `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;
}

function extraCsvUrl(code) {
  return `https://www.football-data.co.uk/new/${code}.csv`;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (cell || row.length) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (char === "\r" && next === "\n") i++;
    } else {
      cell += char;
    }
  }

  if (cell || row.length) rows.push([...row, cell]);

  return rows;
}

function teamCode(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0])
    .join("")
    .slice(0, 3)
    .padEnd(3, "X")
    .toUpperCase();
}

function emptyTeam(name) {
  return {
    name,
    code: teamCode(name),

    pj: 0,
    g: 0,
    e: 0,
    p: 0,
    gf: 0,
    gc: 0,
    pts: 0,

    homePts: 0,
    awayPts: 0,

    	form: [],
	homeForm: [],
	awayForm: [],

    cornersFor: 0,
    cornersAgainst: 0,
    cornerMatches: 0,

    homeGF: 0,
    homeGA: 0,
    homeGames: 0,

    awayGF: 0,
    awayGA: 0,
    awayGames: 0,

    homeCornersFor: 0,
    homeCornersAgainst: 0,
    homeCornerMatches: 0,

    awayCornersFor: 0,
    awayCornersAgainst: 0,
    awayCornerMatches: 0
  };
}

function findHeader(headers, possibleNames) {
  return possibleNames
    .map(name => headers.indexOf(name))
    .find(index => index >= 0) ?? -1;
}

function getSchema(headers) {
  return {
    seasonIdx: findHeader(headers, ["Season", "season"]),
    dateIdx: findHeader(headers, ["Date", "date"]),
    homeIdx: findHeader(headers, ["HomeTeam", "Home", "home"]),
    awayIdx: findHeader(headers, ["AwayTeam", "Away", "away"]),
    hgIdx: findHeader(headers, ["FTHG", "HG", "hg"]),
    agIdx: findHeader(headers, ["FTAG", "AG", "ag"]),
    resultIdx: findHeader(headers, ["FTR", "Res", "Result", "result"]),
    homeCornersIdx: findHeader(headers, ["HC"]),
    awayCornersIdx: findHeader(headers, ["AC"]),
htHomeGoalsIdx: findHeader(headers, ["HTHG"]),
htAwayGoalsIdx: findHeader(headers, ["HTAG"])
  };
}

function normalizeSeasonValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace("-", "/");
}

function seasonScore(value) {
  const normalized = normalizeSeasonValue(value);

  const years = normalized.match(/\d{4}/g);
  if (years?.length) {
    return Math.max(...years.map(Number));
  }

  const compact = normalized.match(/\d{2}/g);
  if (compact?.length) {
    const last = Number(compact.at(-1));
    return 2000 + last;
  }

  return 0;
}

function getLatestSeasonFromRows(rows, schema) {
  if (schema.seasonIdx < 0) return null;

  const seasons = rows
    .map(row => normalizeSeasonValue(row[schema.seasonIdx]))
    .filter(Boolean);

  if (!seasons.length) return null;

  return seasons.sort((a, b) => seasonScore(b) - seasonScore(a))[0];
}

function rowToMatch(row, schema, fallbackSeason = "") {
  const home = row[schema.homeIdx]?.trim();
  const away = row[schema.awayIdx]?.trim();
  const hg = Number(row[schema.hgIdx]);
  const ag = Number(row[schema.agIdx]);

  if (!home || !away) return null;
  if (!Number.isFinite(hg) || !Number.isFinite(ag)) return null;

  let result = schema.resultIdx >= 0 ? row[schema.resultIdx]?.trim() : "";

  if (!["H", "D", "A"].includes(result)) {
    if (hg > ag) result = "H";
    else if (hg < ag) result = "A";
    else result = "D";
  }

  return {
 season: schema.seasonIdx >= 0 ? normalizeSeasonValue(row[schema.seasonIdx]) : fallbackSeason,
  date: schema.dateIdx >= 0 ? row[schema.dateIdx] : "",
  home,
  away,
  hg,
  ag,
  result,
  homeCorners: schema.homeCornersIdx >= 0 ? Number(row[schema.homeCornersIdx]) : null,
  awayCorners: schema.awayCornersIdx >= 0 ? Number(row[schema.awayCornersIdx]) : null,
  htHomeGoals: schema.htHomeGoalsIdx >= 0 ? Number(row[schema.htHomeGoalsIdx]) : null,
  htAwayGoals: schema.htAwayGoalsIdx >= 0 ? Number(row[schema.htAwayGoalsIdx]) : null
};
}

function buildTableFromMatches(matches) {
  const table = new Map();

  let totalCorners = 0;
  let cornerMatches = 0;

  for (const match of matches) {
    const { home, away, hg, ag, result, homeCorners, awayCorners } = match;

    if (!table.has(home)) table.set(home, emptyTeam(home));
    if (!table.has(away)) table.set(away, emptyTeam(away));

    const h = table.get(home);
    const a = table.get(away);

    h.pj++;
    a.pj++;

    h.homeGames++;
    a.awayGames++;

    h.gf += hg;
    h.gc += ag;
    a.gf += ag;
    a.gc += hg;

    h.homeGF += hg;
    h.homeGA += ag;

    a.awayGF += ag;
    a.awayGA += hg;

    if (Number.isFinite(homeCorners) && Number.isFinite(awayCorners)) {
      totalCorners += homeCorners + awayCorners;
      cornerMatches++;

      h.cornersFor += homeCorners;
      h.cornersAgainst += awayCorners;
      h.cornerMatches++;

      a.cornersFor += awayCorners;
      a.cornersAgainst += homeCorners;
      a.cornerMatches++;

      h.homeCornersFor += homeCorners;
      h.homeCornersAgainst += awayCorners;
      h.homeCornerMatches++;

      a.awayCornersFor += awayCorners;
      a.awayCornersAgainst += homeCorners;
      a.awayCornerMatches++;
    }

    if (result === "H") {
  h.g++;
  a.p++;
  h.pts += 3;
  h.homePts += 3;

  h.form.push("G");
  a.form.push("P");

  h.homeForm.push("G");
  a.awayForm.push("P");
} else if (result === "A") {
  a.g++;
  h.p++;
  a.pts += 3;
  a.awayPts += 3;

  a.form.push("G");
  h.form.push("P");

  a.awayForm.push("G");
  h.homeForm.push("P");
} else {
  h.e++;
  a.e++;
  h.pts++;
  a.pts++;
  h.homePts++;
  a.awayPts++;

  h.form.push("E");
  a.form.push("E");

  h.homeForm.push("E");
  a.awayForm.push("E");
}
  }

  const standings = [...table.values()]
    .map(team => {
      const dg = team.gf - team.gc;

      return [
        team.name,
        team.code,
        team.pj,
        team.g,
        team.e,
        team.p,
        team.gf,
        team.gc,
        dg,
        team.pts,
        team.homePts,
        team.awayPts,
        team.form.slice(-5).join("-"),
team.homeForm.slice(-5).join("-"),
team.awayForm.slice(-5).join("-")
      ];
    })
    .sort((a, b) => b[9] - a[9] || b[8] - a[8] || b[6] - a[6]);

  const teamCorners = {};
  const teamSplits = {};

  for (const team of table.values()) {
    teamCorners[team.name] = {
      for: team.cornerMatches ? Number((team.cornersFor / team.cornerMatches).toFixed(2)) : null,
      against: team.cornerMatches ? Number((team.cornersAgainst / team.cornerMatches).toFixed(2)) : null,

      homeFor: team.homeCornerMatches ? Number((team.homeCornersFor / team.homeCornerMatches).toFixed(2)) : null,
      homeAgainst: team.homeCornerMatches ? Number((team.homeCornersAgainst / team.homeCornerMatches).toFixed(2)) : null,

      awayFor: team.awayCornerMatches ? Number((team.awayCornersFor / team.awayCornerMatches).toFixed(2)) : null,
      awayAgainst: team.awayCornerMatches ? Number((team.awayCornersAgainst / team.awayCornerMatches).toFixed(2)) : null
    };

    teamSplits[team.name] = {
      homeGF: team.homeGames ? Number((team.homeGF / team.homeGames).toFixed(2)) : null,
      homeGA: team.homeGames ? Number((team.homeGA / team.homeGames).toFixed(2)) : null,
      awayGF: team.awayGames ? Number((team.awayGF / team.awayGames).toFixed(2)) : null,
      awayGA: team.awayGames ? Number((team.awayGA / team.awayGames).toFixed(2)) : null
    };

}

  return {
    standings,
    avgCorners: cornerMatches ? Number((totalCorners / cornerMatches).toFixed(2)) : null,
    teamCorners,
    teamSplits
  };
}
function buildLeagueAverages(matches){
  let totalHTGoals = 0;
  let htMatches = 0;
  let htOver05 = 0;
  let htOver15 = 0;

  for(const match of matches){
    const htHome = match.htHomeGoals;
    const htAway = match.htAwayGoals;

    if(Number.isFinite(htHome) && Number.isFinite(htAway)){
      const htTotal = htHome + htAway;

      totalHTGoals += htTotal;
      htMatches++;

      if(htTotal > 0.5) htOver05++;
      if(htTotal > 1.5) htOver15++;
    }
  }

  return {
    avgHTGoals: htMatches ? Number((totalHTGoals / htMatches).toFixed(2)) : null,
    htOver05: htMatches ? Math.round((htOver05 / htMatches) * 100) : null,
    htOver15: htMatches ? Math.round((htOver15 / htMatches) * 100) : null
  };
}
function parseMatchesFromCSV(csvText, fallbackSeason = "") {
  const parsed = parseCSV(csvText).filter(row => row.length > 5);
  if (!parsed.length) return { matches: [], latestSeason: null };

  const headers = parsed[0].map(h => h.trim());
  const rows = parsed.slice(1);
  const schema = getSchema(headers);

  if ([schema.homeIdx, schema.awayIdx, schema.hgIdx, schema.agIdx].some(index => index < 0)) {
    return { matches: [], latestSeason: null };
  }

  const latestSeason = getLatestSeasonFromRows(rows, schema);

  const matches = rows
    .map(row => rowToMatch(row, schema, fallbackSeason))
    .filter(Boolean);

  return { matches, latestSeason };
}

async function loadMainLeague(league, code) {
  const allMatches = [];
  let currentMatches = [];

  for (const season of HISTORICAL_SEASONS) {
    try {
      const response = await fetch(mainCsvUrl(season, code));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const csv = await response.text();
      const { matches } = parseMatchesFromCSV(csv, season);

      allMatches.push(...matches);

      if (season === CURRENT_SEASON) {
        currentMatches = matches;
      }
    } catch (error) {
      console.warn(`⚠ ${league} ${season}: no se pudo cargar - ${error.message}`);
    }
  }

  const currentTable = buildTableFromMatches(currentMatches);
  const leagueAverages = buildLeagueAverages(currentMatches);

  return {
    snapshot: currentTable.standings,
    stats: {
      avgCorners: currentTable.avgCorners,
      avgHTGoals: leagueAverages.avgHTGoals,
      htOver05: leagueAverages.htOver05,
      htOver15: leagueAverages.htOver15,
      teamCorners: currentTable.teamCorners,
      teamSplits: currentTable.teamSplits,
      matches: allMatches.map(({ homeCorners, awayCorners, htHomeGoals, htAwayGoals, result, ...match }) => match)
    }
  };
}
async function loadExtraLeague(league, code) {
  const response = await fetch(extraCsvUrl(code));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const csv = await response.text();
  const { matches, latestSeason } = parseMatchesFromCSV(csv);

  const currentMatches = latestSeason
    ? matches.filter(match => normalizeSeasonValue(match.season) === latestSeason)
    : matches;

  const currentTable = buildTableFromMatches(currentMatches);
  const leagueAverages = buildLeagueAverages(currentMatches);

  return {
    snapshot: currentTable.standings,
    stats: {
      avgCorners: currentTable.avgCorners,
      avgHTGoals: leagueAverages.avgHTGoals,
      htOver05: leagueAverages.htOver05,
      htOver15: leagueAverages.htOver15,
      teamCorners: currentTable.teamCorners,
      teamSplits: currentTable.teamSplits,
      matches: matches.map(({ homeCorners, awayCorners, htHomeGoals, htAwayGoals, result, ...match }) => match)
    }
  };
}
async function update() {
  const snapshot = {};
  const leagueStats = {};

  for (const [league, code] of Object.entries(MAIN_LEAGUES)) {
    try {
      const result = await loadMainLeague(league, code);

      if (!result.snapshot.length) {
        throw new Error("Tabla vacía");
      }

      snapshot[league] = result.snapshot;
      leagueStats[league] = result.stats;

      console.log(`✔ ${league}: ${result.snapshot.length} equipos · ${result.stats.matches.length} partidos`);
    } catch (error) {
      console.warn(`⚠ ${league}: no se pudo cargar - ${error.message}`);

      leagueStats[league] = {
        avgCorners: null,
        teamCorners: {},
        teamSplits: {},
        matches: []
      };
    }
  }

  for (const [league, code] of Object.entries(EXTRA_LEAGUES)) {
    try {
      const result = await loadExtraLeague(league, code);

      if (!result.snapshot.length) {
        throw new Error("Tabla vacía");
      }

      snapshot[league] = result.snapshot;
      leagueStats[league] = result.stats;

      console.log(`✔ ${league}: ${result.snapshot.length} equipos · ${result.stats.matches.length} partidos`);
    } catch (error) {
      console.warn(`⚠ ${league}: no se pudo cargar - ${error.message}`);

      leagueStats[league] = {
        avgCorners: null,
        teamCorners: {},
        teamSplits: {},
        matches: []
      };
    }
  }

  await fs.mkdir("data", { recursive: true });

  const output =
    `window.SNAPSHOT_DATA = ${JSON.stringify(snapshot, null, 2)};\n` +
    `window.LEAGUE_STATS = ${JSON.stringify(leagueStats, null, 2)};\n`;

  await fs.writeFile(path.join("data", "snapshot-data.js"), output, "utf8");

  console.log("\n✅ Listo: data/snapshot-data.js actualizado con más ligas");
}

update();