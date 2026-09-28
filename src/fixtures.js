// Upcoming Manchester City matches from football-data.org (free API key).

import { addDays } from './dates.js';

const MAN_CITY_TEAM_ID = 65;
const TTL_MS = 6 * 60 * 60 * 1000;
let cache = null;

// Overnight Denver -> UK flights land the next day, so leave two days before
// the match to arrive with a buffer; fly home the day after.
export function suggestedDates(matchDate) {
  return {
    departFrom: addDays(matchDate, -3),
    departTo: addDays(matchDate, -2),
    returnFrom: addDays(matchDate, 1),
    returnTo: addDays(matchDate, 2),
  };
}

export async function upcomingFixtures(config) {
  if (!config.footballDataKey) {
    const err = new Error('Set FOOTBALL_DATA_API_KEY to load Man City fixtures');
    err.status = 501;
    throw err;
  }
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.fixtures;

  const res = await fetch(`https://api.football-data.org/v4/teams/${MAN_CITY_TEAM_ID}/matches?status=SCHEDULED,TIMED`, {
    headers: { 'X-Auth-Token': config.footballDataKey },
  });
  if (!res.ok) throw new Error(`football-data.org request failed: HTTP ${res.status}`);
  const body = await res.json();

  const fixtures = (body.matches || []).map((m) => {
    const home = m.homeTeam?.id === MAN_CITY_TEAM_ID;
    const opponent = home ? m.awayTeam?.shortName || m.awayTeam?.name : m.homeTeam?.shortName || m.homeTeam?.name;
    const matchDate = m.utcDate.slice(0, 10);
    return {
      id: m.id,
      utcDate: m.utcDate,
      matchDate,
      home,
      opponent,
      competition: m.competition?.name,
      label: `${home ? 'Man City vs' : 'Man City at'} ${opponent} (${m.competition?.name})`,
      ...suggestedDates(matchDate),
    };
  });
  cache = { fetchedAt: Date.now(), fixtures };
  return fixtures;
}
