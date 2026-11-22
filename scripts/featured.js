
(() => {
    'use strict';

    const YT_API_KEY = process.env.YOUTUBE_API_KEY;
    const YT_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
    const CACHE_SECONDS = 120; // reuse a live check for this long, to save quota

    const root = document.getElementById('featured');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const player = $('featured-player');
    const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
    const CACHE_KEY = 'yt-featured-v1';

    const newestFirst = (a, b) => new Date(b.date) - new Date(a.date);

    function normalize(v) {
        const t = v.snippet.thumbnails || {};
        const state = v.snippet.liveBroadcastContent;
        const live = state === 'live' && !v.liveStreamingDetails.actualEndTime;
        return {
            id: v.id,
            title: v.snippet.title,
            thumb: (t.maxres || t.medium || t.high || t.default).url,
            date: v.snippet.publishedAt,
            live: live ? 'live' : (state === 'upcoming' ? 'upcoming' : 'none')
        };
    }

    function pick(list) {
        const streams = (list || []).filter((s) => s.live !== 'upcoming');
        return streams.find((s) => s.live === 'live') || streams[0] || null;
    }

    async function fetchStreams() {
        if (!YT_API_KEY || !YT_CHANNEL_ID) return null;
        try {
            const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
            if (cached && Date.now() - cached.time < CACHE_SECONDS * 1000) return cached.streams;
        } catch (e) { }

        const api = async (path, params) => {
            const query = new URLSearchParams({ ...params, key: YT_API_KEY });
            const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`);
            if (!res.ok) throw new Error(`${path} failed (${res.status})`);
            return res.json();
        };
        const list = await api('playlistItems', { part: 'contentDetails', playlistId: 'UU' + YT_CHANNEL_ID.slice(2), maxResults: 10 });
        const ids = list.items.map((i) => i.contentDetails.videoId);
        if (!ids.length) return [];
        const vids = await api('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') });
        const streams = vids.items.filter((v) => v.liveStreamingDetails).map(normalize).sort(newestFirst);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), streams })); } catch (e) { /* ignore */ }
        return streams;
    }
    let shown = null;

    function embed(id, muted) {
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0${muted ? '&mute=1' : ''}`;
        frame.title = 'Featured stream';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        player.replaceChildren(frame);
    }

    function facade(item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'feat-facade';
        button.setAttribute('aria-label', `Play: ${item.title}`);
        const img = document.createElement('img');
        img.src = item.thumb;
        img.alt = '';
        const icon = document.createElement('span');
        icon.className = 'feat-play';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▶';
        button.append(img, icon);
        button.addEventListener('click', () => embed(item.id, false));
        player.replaceChildren(button);
    }

    function showChat(id) {
        const box = $('featured-chat');
        const host = location.hostname;
        if (!id || !host) { box.hidden = true; $('chat-frame').replaceChildren(); return; }
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube.com/live_chat?v=${encodeURIComponent(id)}&embed_domain=${encodeURIComponent(host)}&dark_theme=1`;
        frame.title = 'Live chat';
        $('chat-frame').replaceChildren(frame);
        $('chat-pop').href = `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(id)}`;
        box.hidden = false;
    }

    function show(item) {
        if (!item || (shown && shown.id === item.id && shown.live === item.live)) return;
        shown = item;
        const live = item.live === 'live';
        root.classList.toggle('is-live', live);
        $('featured-title').textContent = live ? 'Live Now' : 'Latest Stream';
        $('featured-tag').textContent = live ? 'Live now' : 'Stream';
        $('featured-name').textContent = item.title;
        $('featured-meta').textContent = live ? 'Playing muted. Use the speaker icon for sound.' : dateFormat.format(new Date(item.date));
        $('featured-watch').href = `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;
        $('featured-info').hidden = false;
        if (live) embed(item.id, true); else facade(item);
        showChat(live ? item.id : null);
    }

    let fresh = false;

    function refresh() {
        return fetchStreams()
            .then((streams) => { if (streams) { fresh = true; show(pick(streams)); } })
            .catch((err) => console.warn('Live check failed:', err.message));
    }

    fetch('data/youtube.json')
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => { if (!fresh) show(pick(data.streams)); })
        .catch(() => { /* keep the fallback link */ });

    refresh();
    if (YT_API_KEY && YT_CHANNEL_ID) {
        setInterval(() => {
            if (document.hidden || (shown && shown.live === 'live') || player.querySelector('iframe')) return;
            refresh();
        }, (CACHE_SECONDS + 30) * 1000);
    }
})();
