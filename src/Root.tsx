import { Outlet, useLoaderData } from "react-router-dom";
import { supabase } from '../supabase'
import type { LIVE_DATA_COMBINED, StatisticPercentile, TeamColumnSorted, TeamStatistic, TeamValues, TeamValuesWithFetched } from '../types';
import NavBar from "./components/NavBar";
import { useEffect } from "react";
import { fetchEventData, TBA_KEY, useRawDataStore } from "./data-store";
import type { Database } from "../database.types";

export default function Root() {
    const rawData: LIVE_DATA_COMBINED = useLoaderData();

    const rawDataStore = useRawDataStore();

    useEffect(() => {
        async function e() {
            rawDataStore.setRawDataCombined(rawData);
            rawDataStore.setDistrictEventKeys(await fetchEventsWI());
            rawDataStore.setEventData(await fetchEventData(rawDataStore.eventKey));
            rawDataStore.loadTeamImages();
        }
        e();
    }, [rawData.all_match_data]);

    return (
        <div className="bg-[#ebe8d8] dark:bg-[#4C8695] w-full h-screen overflow-y-auto pt-14 pb-14 pr-7">
            <NavBar />
            <div className="ml-7 bg-white flex-1 rounded-b-xl z-20 relative min-h-20 h-fit w-fit min-w-[calc(100%-1.75rem)]">
                <Outlet />
            </div>
        </div>
    );
}

export async function loader(): Promise<LIVE_DATA_COMBINED> {
    var [
        { data: all_match_data },
        { data: all_pit_data },
        { data: all_pick_list_data },
        { data: fetched_team_data },
        eventDataRes
    ] = await Promise.all([
        supabase.from('Live Data').select('*'),
        supabase.from('Pit Scouting').select('*'),
        supabase.from('Pick List').select('*'),
        supabase.from('Fetched Team Data').select('*'),
        //fetchEventData(localStorage.getItem('event-key') ?? '2026iltrr')
        fetchEventData('2026iltrr');
    ]);

    console.log(fetched_team_data)

    const oprMap = new Map<string, number>();
    const oprSource = eventDataRes?.opr?.oprs;
    console.warn(eventDataRes)

    if (oprSource) {
        // If it's an object { "123": 10 }, use Object.entries
        Object.entries(oprSource).forEach(([team, val]) => {
            oprMap.set(team, val as number);
        });
    }

    if (all_match_data && all_match_data.length > 0) {
        all_match_data = all_match_data.filter((m) => {
            return m.match_type == 'match' || 
                (JSON.parse(localStorage.getItem('use-practice-data') ?? 'false') && m.match_type == 'practice')
                || (JSON.parse(localStorage.getItem('use-pre-data') ?? 'false') && m.match_type == 'pre')
        })
    }
    const fetchedTeamMap = new Map(fetched_team_data?.map(t => [t.team, t]));
    const teamRows = all_match_data ? compileTeamData(all_match_data) : {};

    const stat = (val: number) => ({
        min: val, max: val, median: val, mean: val, q3: val
    });

    // keys from teamRows (Compiled Team Summaries)
    const team_rows_with_fetched: Record<number, any> = {};

    Object.keys(teamRows).forEach((teamStr) => {
        const teamNum = parseInt(teamStr);
        const fetched = fetchedTeamMap.get(teamNum);
        const oprVal = oprMap.get('frc' + teamStr) ?? -1;


        team_rows_with_fetched[teamNum] = {
            ...teamRows[teamNum],
            epa: stat(fetched?.epa ?? -1),
            opr: stat(oprVal),
            auto_fuel: stat(fetched?.auto_fuel ?? -1),
            rank: eventDataRes?.rankings.rankings.find((t) => t.team_key == 'frc' + teamNum)?.rank,
        };
    });

    console.log(team_rows_with_fetched);

    return {
        all_match_data: all_match_data ?? [],
        all_pit_data: all_pit_data ?? [],
        all_pick_list_data: all_pick_list_data ?? [],
        team_rows: teamRows,
        fetched_team_data: fetched_team_data,
        team_rows_with_fetched: team_rows_with_fetched,
        pit_scout_data: all_pit_data ?? [],
        team_columns_sorted: getTeamColumnsSorted(teamRows),
        team_percentile_thresholds: compileTeamPercentileThresholds(team_rows_with_fetched),
    } as LIVE_DATA_COMBINED;
}

async function fetchEventsWI(): Promise<string[]> {
    let events = await fetch(
        `https://www.thebluealliance.com/api/v3/district/2026win/events`,
        { headers: { "X-TBA-Auth-Key": TBA_KEY } }
    );
    let parsedEvents = await events.json();
    return parsedEvents.map((item: any) => item['first_event_code']);
}

function compileTeamData(matchData: Database['public']['Tables']['Live Data']['Row'][]): Record<number, TeamValues> {
    var teams: number[] = [];
    matchData.forEach((item) => {
        if (!teams.includes(item.team_number)) {
            teams.push(item.team_number);
        }
    });
    let data: Record<number, TeamValues> = {};
    teams.forEach((team) => {
        let defaultTeamStatistic: TeamStatistic = {
            min: 0,
            max: 0,
            mean: 0,
            median: 0,
            q3: 0,
        };

        let tempTeamValues: TeamValues = {
            team_number: 0,
            auto_fuel_taken_NZ: defaultTeamStatistic,
            auto_sos: defaultTeamStatistic,
            defense_strength: defaultTeamStatistic,
            driver_rating: defaultTeamStatistic,
            endgame_points: defaultTeamStatistic,
            how_defendable: defaultTeamStatistic,
            tele_fuel_dozed: defaultTeamStatistic,
            tele_fuel_impacted: defaultTeamStatistic,
            tele_fuel_passed: defaultTeamStatistic,
            tele_fuel_scored: defaultTeamStatistic,
            tele_points: defaultTeamStatistic,
            throughput_speed: defaultTeamStatistic,
            tioi_rating: defaultTeamStatistic
        };
        let matches = matchData.filter((t) => t.team_number == team);
        if (matches.length < 1)
            return;

        tempTeamValues.team_number = team;
        Object.keys(matches[0]).forEach((key) => {
            const keyTyped = key as keyof TeamValues;
            // collect numeric values only
            const valuesInKey = matches.map((m) => (m as any)[key]).filter((v) => typeof v === 'number') as number[];
            const len = valuesInKey.length;
            if (len === 0) return; // nothing numeric to compute

            const getPercentile = (p: number) => {
                valuesInKey.sort((a, b) => a-b)
                const index = p * (len - 1);
                const lower = Math.floor(index);
                const upper = Math.ceil(index);
                const weight = index - lower;
                const lowerVal = valuesInKey[lower];
                const upperVal = valuesInKey[upper];
                if(team == 3197)
                console.log(valuesInKey)
                return upperVal;
            };

            const sortedAsc = [...valuesInKey].sort((a, b) => a - b);
            const sortedDesc = [...valuesInKey].sort((a, b) => b - a);

            let tempTeamStats: TeamStatistic = {
                'min': sortedAsc[0],
                'max': sortedDesc[0],
                'mean': valuesInKey.reduce((accumulator, current) => accumulator + current, 0) / len,
                'median': getPercentile(0.5),
                'q3': getPercentile(0.75),
            }
            // skip assigning to team_number, this is useless
            if (keyTyped !== 'team_number') {
                (tempTeamValues as any)[keyTyped] = tempTeamStats;
            }
        });
        data[team] = (tempTeamValues);
    });
    return data;
}

const getPercentile = (sortedList: number[], percentile: number): number => {
    if (sortedList.length === 0) return 0;
    const index = Math.ceil(percentile * sortedList.length) - 1;
    return sortedList[Math.max(0, index)];
};

function compileTeamPercentileThresholds(teamRows: Record<number, any>): Record<string, StatisticPercentile>[] {
    const allTeams = Object.values(teamRows);
    if (allTeams.length === 0) return [];

    // Extract keys from the first team, excluding metadata
    const statKeys = Object.keys(allTeams[0]).filter(k => k !== 'team_number' && k !== 'match_number');
    const metrics: (keyof StatisticPercentile)[] = ['min', 'max', 'mean', 'median', 'q3'];

    return statKeys.map((key) => {
        const percentileData: any = {};

        metrics.forEach((metric) => {
            const allPoints = allTeams
                .flatMap((team) => team[key] || [])
                .map((matchEntry: any) => matchEntry[metric])
                .filter((val) => typeof val === 'number')
                .sort((a, b) => a - b);

            percentileData[metric] = {
                '10': getPercentile(allPoints, 0.10),
                '25': getPercentile(allPoints, 0.25),
                '75': getPercentile(allPoints, 0.75),
                '90': getPercentile(allPoints, 0.90),
            };
        });

        return { [key]: percentileData as StatisticPercentile };
    });
}

function getTeamColumnsSorted(teamRows: Record<number, any>): Record<string, TeamColumnSorted>[] {
    const allTeams = Object.values(teamRows);
    if (allTeams.length === 0) return [];

    const metrics: (keyof StatisticPercentile)[] = ['min', 'max', 'mean', 'median', 'q3'];
    const statKeys = Object.keys(allTeams[0]).filter(k => k !== 'team_number' && k !== 'match_number');

    return statKeys.map((key) => {
        const columnData: TeamColumnSorted = {
            min: [],
            max: [],
            median: [],
            mean: [],
            q3: []
        };

        metrics.forEach((metric) => {
            const allPoints = allTeams
                .flatMap((team) => team[key] || [])
                .map((matchEntry: any) => matchEntry[metric])
                .filter((val) => typeof val === 'number')
                .sort((a, b) => a - b);

            columnData[metric] = allPoints;
        });

        return { [key]: columnData as TeamColumnSorted };
    });
}
