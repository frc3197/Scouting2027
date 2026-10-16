import { Link } from "react-router-dom";
import { TBA_KEY, useRawDataStore } from "../data-store";
import { supabase } from "../../supabase";
import type { Database } from "../../database.types";
import { useEffect, useState } from "react";
import { getGenerativeModel } from "firebase/ai";
import { ai } from "../firebase-client";

const UpdateFetched = () => {

    const rawData = useRawDataStore();

    const generationConfig = {
        temperature: 0.6,
        topP: 0.1,
        topK: 16,
    };

    const [localValue, setLocalValue] = useState(rawData.eventKey);
    useEffect(() => {
        setLocalValue(rawData.eventKey);
        console.warn(rawData.eventKey)
    }, [rawData.eventKey]);

    const model = getGenerativeModel(ai, { model: "gemini-3-flash-preview", generationConfig, systemInstruction: "You are a scouting assistant on team 3197, the hexhounds, competing in FRC robotics. give helpful tips that will help our team win, use insights from our data to answer questions" });

    const updateData = async () => {
        //if (prompt('Password?') != 'chomp')
        //return;

        //alert('Udating data...');

        const aiRaw = await generateAIOverviewsTeamsJSON();
        console.log(aiRaw.replaceAll('json', '').replaceAll('`', ''));
        const aiParsed = JSON.parse(aiRaw.replaceAll('json', '').replaceAll('`', ''));
        console.log(aiParsed);

        const teams = Object.keys(rawData.rawDataCombined.team_rows);

        var newData: Database['public']['Tables']['Fetched Team Data']['Insert'][] = [];

        const tbaData = await fetchTbaEventData(rawData.eventKey);

        for (const team of teams) {
            let colorData = null;
            let statboticsData = null;

            // 1. Independent Color Fetch
            try {
                const colorResponse = await fetch(`https://api.frc-colors.com/v1/team/${team}`);
                if (colorResponse.ok) {
                    colorData = await colorResponse.json();
                }
            } catch (err) {
                console.error(`Color fetch failed for ${team}:`, err);
            }

            // 2. Independent Statbotics Fetch
            try {
                const statboticsResponse = await fetch(`https://api.statbotics.io/v3/team_year/${team}/2026`);
                if (statboticsResponse.ok) {
                    statboticsData = await statboticsResponse.json();
                }
            } catch (err) {
                console.error(`Statbotics fetch failed for ${team}:`, err);
            }

            // 3. Combine results with safe fallbacks
            newData.push({
                'team': parseInt(team),
                'primary_hex': colorData?.primaryHex ?? '#FFFFFF',
                'secondary_hex': colorData?.secondaryHex ?? '#000000',
                'team_name': tbaData?.teamData?.[parseInt(team)] ?? 'Unknown',
                'epa': statboticsData?.epa?.breakdown?.['total_points'] ?? -1,
                'ai_overview': aiParsed[team] ?? null,
                'auto_fuel': statboticsData?.epa?.breakdown?.['auto_fuel'] ?? -1,
            });
        }


        console.log(newData);

        if (newData.length > 1) {
            let res = await supabase.from('Fetched Team Data').upsert(newData);
            if (!res.error) {
                alert('Success!');
            }
        } else {
            alert('No new data.');
        }
    }

    async function fetchTbaEventData(eventKey: string): Promise<{ rankings: string[]; opr: string[], matches: any[], teamData: Record<number, string> } | null> {
        if (!eventKey) return null;
        try {
            const [rankingsRes, oprsRes, matchesRes, teamsRes] = await Promise.all([
                fetch(
                    `https://www.thebluealliance.com/api/v3/event/${eventKey}/rankings`,
                    { headers: { "X-TBA-Auth-Key": TBA_KEY } }
                ),
                fetch(
                    `https://www.thebluealliance.com/api/v3/event/${eventKey}/oprs`,
                    { headers: { "X-TBA-Auth-Key": TBA_KEY } }
                ),
                fetch(
                    `https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`,
                    { headers: { "X-TBA-Auth-Key": TBA_KEY } }
                ),
                fetch(
                    `https://www.thebluealliance.com/api/v3/event/${eventKey}/teams`,
                    { headers: { "X-TBA-Auth-Key": TBA_KEY } }
                ),
            ]);

            const rankings = await rankingsRes.json();
            const oprData = await oprsRes.json();
            const matches = await matchesRes.json();
            const teams = await teamsRes.json();

            const teamMap: Record<number, string> = (teams ?? []).reduce((acc: Record<number, string>, team: any) => {
                const num = parseInt(team.key.replace('frc', ''));
                acc[num] = team.nickname;
                return acc;
            }, {});

            return {
                'opr': oprData,
                'rankings': rankings,
                'matches': matches,
                'teamData': teamMap,
            }
        } catch (err) {
            console.error("TBA fetch error", err);
            return null;
        }
    }

    async function generateAIOverviewsTeamsJSON() {

        const context = [
            `Provide a team overview for each team. Respond in two sentences, give a quick overview of the team with any things. Ensure the data has a reliable source. that stand otu from the rest. in the following format as a VALID JSON, 9999 being their team number:
            {
            [
            9999: {
                This is the section to write about the team.
            }
            ]
        }
            `,
            'Your response should only be valid JSON and nothing else, make sure it can be parsed directly.',
            'Only include the teams in the arrays below...',
            JSON.stringify(rawData.rawDataCombined.all_match_data),
            JSON.stringify(rawData.rawDataCombined.team_rows),
        ];

        // To generate text output, call generateContent with the text input
        var result;
        try {
            result = await model.generateContent(context);

            alert('Successfully generated overviews... uploading now.');
        } catch (error) {
            alert('Error: ' + error);

        }

        const response = result?.response ?? null;
        const text = response?.text();

        return text ?? '{}';
    }

    return <div className="w-full pt-5 flex flex-1 flex-col justify-center items-center pb-10 gap-5">
        <h2 className='text-center text-3xl font-rubik font-light w-full mb-5'>Update Fetched Data</h2>
        <select onChange={(e) => rawData.setEventKey(e.target.value)} id="event-key-select" className="bg-[#ebe8d8]/67 px-3 min-w-25 py-1 rounded-md border-1 border-gray-500 hover:border-gray-800 transition cursor-pointer active:ring-2">
            {rawData.districtEventKeys.map((key, i) => {
                console.log("Current Event Key:", rawData.eventKey);
                return <option key={i} value={key}>{key}</option>
            }
            )}
        </select>
        <button onClick={updateData} className="bg-[#ebe8d8]/67 text-xl px-5 py-2 w-fit shadow-sm rounded-lg border-1 border-gray-600 flex flex-row items-center justify-center gap-3 cursor-pointer hover:ring-2 hover:shadow-md hover:scale-101 transition">
            Update Data
        </button>
    </div>
}

export default UpdateFetched;