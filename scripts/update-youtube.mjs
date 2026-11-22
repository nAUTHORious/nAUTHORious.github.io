
import { mkdir, writeFile } from 'node:fs/promises';

const KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL = process.env.YOUTUBE_CHANNEL_ID;
const COUNT = 8;
const MIN_SECONDS = 61;
if (!KEY || !CHANNEL || !CHANNEL.startsWith('UC')) {
    throw new Error('Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID (the channel ID starts with UC).');
}

async function api(path, params) {
    const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
    url.search = new URLSearchParams({ ...params, key: KEY });
    const res = await fetch(url);
    if (!res.ok) throw new Error(path + ' failed (' + res.status + '): ' + (await res.text()));
    return res.json();
}

function seconds(iso) {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '') || [];
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

const uploads = await api('playlistItems', {
    part: 'contentDetails',
    playlistId: 'UU' + CHANNEL.slice(2),
    maxResults: 50
});
const ids = uploads.items.map((i) => i.contentDetails.videoId);

const details = ids.length
    ? await api('videos', { part: 'snippet,contentDetails,liveStreamingDetails', id: ids.join(',') })
    : { items: [] };

const items = details.items
    .map((v) => {
        const t = v.snippet.thumbnails || {};
        return {
            id: v.id,
            title: v.snippet.title,
            thumb: (t.maxres || t.medium || t.high || t.default).url,
            date: v.snippet.publishedAt,
            live: v.snippet.liveBroadcastContent,
            stream: Boolean(v.liveStreamingDetails),
            length: seconds(v.contentDetails.duration)
        };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

const pick = ({ id, title, thumb, date, live }) => ({ id, title, thumb, date, live });
const videos = items.filter((v) => !v.stream && v.length >= MIN_SECONDS).slice(0, COUNT).map(pick);
const streams = items.filter((v) => v.stream).slice(0, COUNT).map(pick);

await mkdir('data', { recursive: true });
await writeFile('data/youtube.json', JSON.stringify({ videos, streams }, null, 2) + '\n');
console.log('Saved ' + videos.length + ' videos and ' + streams.length + ' streams.');
