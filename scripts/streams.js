
(function () {
    'use strict';
    var dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });

    function esc(text) {
        return String(text).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function tag(item, feed) {
        if (item.live === 'live') return ['Live now', ' tile-tag--live'];
        if (item.live === 'upcoming') return ['Upcoming', ' tile-tag--live'];
        return feed === 'streams' ? ['Stream', ' tile-tag--live'] : ['Video', ''];
    }

    function tileHTML(item, feed) {
        var t = tag(item, feed);
        return '<li><a class="tile" href="https://www.youtube.com/watch?v=' + esc(item.id) +
            '" target="_blank" rel="noopener noreferrer">' +
            '<img class="tile-img" src="' + esc(item.thumb) + '" alt="" loading="lazy">' +
            '<span class="tile-tag' + t[1] + '">' + t[0] + '</span>' +
            '<span class="tile-play" aria-hidden="true">▶</span>' +
            '<span class="tile-info"><span class="tile-title">' + esc(item.title) + '</span>' +
            '<span class="tile-meta">' + esc(dateFormat.format(new Date(item.date))) + '</span></span>' +
            '</a></li>';
    }

    function fill(feed, items) {
        var grid = document.querySelector('[data-feed="' + feed + '"]');
        if (!grid || !items || !items.length) return; // nothing new: keep the tiles already on the page
        grid.innerHTML = items.map(function (item) { return tileHTML(item, feed); }).join('');
    }

    fetch('data/youtube.json')
        .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
        .then(function (data) { fill('videos', data.videos); fill('streams', data.streams); })
        .catch(function () { /* keep the tiles already on the page */ });

    var dialog = document.createElement('dialog');
    dialog.className = 'player';
    dialog.setAttribute('aria-label', 'Video player');
    dialog.innerHTML =
        '<div class="player-bar"><span class="player-label">Now Playing</span>' +
        '<button class="player-close" type="button">Close</button></div>' +
        '<div class="player-frame"></div>';
    document.body.appendChild(dialog);
    var frame = dialog.querySelector('.player-frame');

    function videoId(href) {
        var m = href.match(/(?:[?&]v=|\/live\/|youtu\.be\/|\/embed\/)([\w-]{11})(?:[?&#\/]|$)/);
        return m ? m[1] : null;
    }

    document.addEventListener('click', function (e) {
        var tile = e.target.closest('.tile');
        if (!tile || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // keep new-tab clicks working
        var id = videoId(tile.href);
        if (!id || typeof dialog.showModal !== 'function') return; // fall back to opening YouTube
        e.preventDefault();
        frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id +
            '?autoplay=1&rel=0" title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
        dialog.showModal();
    });

    dialog.querySelector('.player-close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); }); // click outside the box
    dialog.addEventListener('close', function () { frame.innerHTML = ''; }); // removing the iframe stops the video
})();