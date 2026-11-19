(() => {
    'use strict';

    const REPO_OWNER = 'nAUTHORious';
    const REPO_NAME = 'nAUTHORious.github.io';
    const REPO_BRANCH = 'main';
    const DATA_PATH = 'data/projects.json';

    const TOKEN_KEY = 'prj-gh-token';
    const NAME_KEY = 'prj-name';
    const MAX_IMG = 900;
    const STATUSES = {
        idea: 'Idea',
        discussion: 'Discussion',
        planning: 'Planning',
        progress: 'In progress',
        done: 'Done',
        dropped: 'Dropped'
    };
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const pad = (n) => String(n).padStart(2, '0');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const stamp = (t) => {
        const d = new Date(t);
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)}(${DAYS[d.getDay()]})${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const store = {
        get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
        del: (k) => { try { localStorage.removeItem(k); } catch (e) { } }
    };

    const getToken = () => store.get(TOKEN_KEY) || '';
    const isOwner = () => Boolean(getToken());

    function clean(raw) {
        const text = (v, max) => String(v == null ? '' : v).slice(0, max);
        const post = (p) => ({
            no: Number(p.no) || 0,
            name: text(p.name, 40) || 'nAUTHORious',
            time: Number(p.time) || Date.now(),
            body: text(p.body, 8000),
            img: /^data:image\/(jpeg|png|webp|gif);base64,/.test(p.img) ? p.img : null,
            role: p.role === 'public' ? 'public' : 'owner'
        });
        const threads = (Array.isArray(raw && raw.threads) ? raw.threads : []).map((t) => {
            const allowPublicReply = Boolean(t.allowPublicReply);
            const rawCredits = Number(t.publicCredits);
            return {
                ...post(t),
                role: 'owner',
                subject: text(t.subject, 80),
                status: STATUSES[t.status] ? t.status : 'idea',
                allowPublicReply,
                publicCredits: Number.isFinite(rawCredits) && rawCredits >= 0 ? Math.floor(rawCredits) : (allowPublicReply ? 1 : 0),
                bump: Number(t.bump) || Number(t.time) || 0,
                replies: (Array.isArray(t.replies) ? t.replies : []).map(post)
            };
        });
        const top = Math.max(0, ...threads.flatMap((t) => [t.no, ...t.replies.map((r) => r.no)]));
        return { next: Math.max(Number(raw && raw.next) || 1, top + 1), threads };
    }

    let state = clean(null);
    let fileSha = null;

    const toBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
    const fromBase64 = (b64) => decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));

    async function loadBoard() {
        const syncEl = $('#sync-status');
        try {
            if (isOwner()) {
                const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}?ref=${REPO_BRANCH}`, {
                    headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/vnd.github+json' },
                    cache: 'no-store'
                });
                if (res.ok) {
                    const meta = await res.json();
                    fileSha = meta.sha;
                    state = clean(JSON.parse(fromBase64(meta.content)));
                    syncEl.textContent = 'Owner mode active (synced with GitHub).';
                    render();
                    return;
                }
            }

            const res = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Could not load board data.');
            state = clean(await res.json());
            syncEl.textContent = isOwner() ? 'Owner mode active.' : 'Public read-only view.';
        } catch (err) {
            syncEl.textContent = 'Could not load posts yet.';
        }
        render();
    }

    async function commit(change) {
        const token = getToken();
        if (!token) return;

        const syncEl = $('#sync-status');
        const backup = JSON.stringify(state);
        change();
        render();
        syncEl.textContent = 'Publishing to GitHub...';

        try {
            const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
            const headers = {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
            };
            if (!fileSha) {
                const check = await fetch(`${apiUrl}?ref=${REPO_BRANCH}`, { headers, cache: 'no-store' });
                if (check.ok) {
                    const meta = await check.json();
                    fileSha = meta.sha;
                }
            }

            const payload = {
                message: `Update project board (${new Date().toISOString().slice(0, 10)})`,
                content: toBase64(JSON.stringify(state, null, 2) + '\n'),
                branch: REPO_BRANCH
            };
            if (fileSha) payload.sha = fileSha;

            const put = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(payload) });
            if (!put.ok) {
                const errData = await put.json().catch(() => ({}));
                throw new Error(errData.message || `GitHub API error (${put.status})`);
            }

            const result = await put.json();
            fileSha = result.content.sha;
            syncEl.textContent = 'Published! Live site updates after GitHub Pages finishes deploying.';
        } catch (err) {
            state = JSON.parse(backup);
            render();
            syncEl.textContent = `Publish failed: ${err.message}`;
            alert(`Could not save to GitHub: ${err.message}`);
        }
    }

    function readImage(file) {
        if (!file) return Promise.resolve(null);
        if (!/^image\//.test(file.type)) return Promise.reject(new Error('That file is not an image.'));
        if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error('That image is over 15 MB.'));
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, MAX_IMG / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#0d0a05';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
            img.src = url;
        });
    }

    const savedName = () => store.get(NAME_KEY) || 'nAUTHORious';

    function canPublicReply(t) {
        return Boolean(t.allowPublicReply) && Number(t.publicCredits) > 0;
    }

    function updateAuthUI() {
        const owner = isOwner();
        $$('.owner-only').forEach((el) => {
            if (el.id === 'new-form') {
                if (!owner) el.hidden = true;
            } else {
                el.hidden = !owner;
            }
        });
        $('#auth-toggle').hidden = owner;
        if (owner) $('#auth-form').hidden = true;
    }

    function render() {
        updateAuthUI();
        const owner = isOwner();

        const drafts = {};
        $$('.reply-form').forEach((f) => {
            drafts[f.dataset.thread] = {
                open: !f.hidden,
                text: f.elements.comment.value,
                mode: f.dataset.mode || 'owner'
            };
        });

        const exists = new Set();
        state.threads.forEach((t) => [t, ...t.replies].forEach((p) => exists.add(String(p.no))));
        const refs = {};
        state.threads.forEach((t) => [t, ...t.replies].forEach((p) => {
            (p.body.match(/>>\d+/g) || []).forEach((m) => {
                const n = m.slice(2);
                if (exists.has(n) && !(refs[n] || []).includes(p.no)) (refs[n] = refs[n] || []).push(p.no);
            });
        }));

        const link = (n) => `<a class="quotelink" href="#p${n}" data-no="${n}">&gt;&gt;${n}</a>`;
        const format = (text) => esc(text).split('\n').map((line) => {
            const html = line.replace(/&gt;&gt;(\d+)/g, (m, n) => (exists.has(n) ? link(n) : `<span class="deadlink">${m}</span>`));
            return /^&gt;(?!&gt;)/.test(line) ? `<span class="greentext">${html}</span>` : html;
        }).join('<br>');

        const statusOptions = (current) => Object.keys(STATUSES)
            .map((k) => `<option value="${k}"${k === current ? ' selected' : ''}>${STATUSES[k]}</option>`).join('');

        const statusControl = (t) => owner
            ? `<select class="status-select status-${t.status}" data-thread="${t.no}" aria-label="Project status">${statusOptions(t.status)}</select>`
            : `<span class="pill ${t.status === 'dropped' ? 'pill--red' : ''}">[${esc(STATUSES[t.status] || 'Idea')}]</span>`;

        const publicBadge = (t) => {
            if (!t.allowPublicReply) return '';
            return t.publicCredits > 0
                ? `<span class="pill">[1-Time Reply Open: ${t.publicCredits}]</span>`
                : `<span class="pill pill--red">[1-Time Reply Used — Awaiting Approval]</span>`;
        };

        const postHTML = (p, t, op) => `
            <div class="post ${op ? 'op' : 'reply'}" id="p${p.no}">
                <div class="post-head">
                    ${op && p.subject ? `<span class="post-subject">${esc(p.subject)}</span>` : ''}
                    <span class="post-name">${esc(p.name)}</span>
                    ${!op && p.role === 'public' ? `<span class="pill">[Guest]</span>` : ''}
                    <span class="post-time">${stamp(p.time)}</span>
                    ${owner
                ? `<a class="post-no" href="#p${p.no}" data-quote="${p.no}" data-thread="${t.no}">No.${p.no}</a>`
                : `<a class="post-no" href="#p${p.no}">No.${p.no}</a>`}
                    ${op ? statusControl(t) : ''}
                    ${op ? publicBadge(t) : ''}
                    ${owner ? `
                    <span class="post-tools">
                        ${op ? `<button class="post-link" type="button" data-reply="${t.no}">Reply</button>` : ''}
                        ${op ? `<button class="post-link" type="button" data-toggle-public="${t.no}">${t.allowPublicReply ? 'Disable 1-Time' : 'Enable 1-Time'}</button>` : ''}
                        ${op && t.allowPublicReply ? `<button class="post-link" type="button" data-grant-reply="${t.no}">+1 Public Reply</button>` : ''}
                        <button class="post-link" type="button" data-delete="${p.no}" data-thread="${t.no}">Delete</button>
                    </span>` : ''}
                </div>
                <div class="post-main">
                    ${p.img ? `<img class="post-img" src="${esc(p.img)}" alt="Attached image">` : ''}
                    <div class="post-body">${format(p.body)}</div>
                </div>
                ${refs[p.no] ? `<div class="backlinks">Replies: ${refs[p.no].map(link).join(' ')}</div>` : ''}
            </div>`;

        const replyForm = (t) => {
            if (owner) {
                return `
                <form class="post-form reply-form" data-thread="${t.no}" data-mode="owner" hidden>
                    <div class="form-row">
                        <label>Name <input type="text" name="poster" maxlength="40" value="${esc(savedName())}"></label>
                        <label>Image (optional) <input type="file" name="file" accept="image/*"></label>
                    </div>
                    <label>Comment <textarea name="comment" required maxlength="8000"></textarea></label>
                    <div class="form-row form-actions">
                        <button class="board-btn" type="submit">Post reply</button>
                        <span class="form-msg" role="status"></span>
                    </div>
                </form>`;
            }
            if (canPublicReply(t)) {
                return `
                <form class="post-form reply-form" data-thread="${t.no}" data-mode="public" hidden>
                    <p class="form-hint">One-time reply slot available (${t.publicCredits} remaining). Once posted, further replies require owner approval.</p>
                    <div class="form-row">
                        <label>Name <input type="text" name="poster" maxlength="40" placeholder="Anonymous"></label>
                        <label>Image (optional) <input type="file" name="file" accept="image/*"></label>
                    </div>
                    <label>Comment <textarea name="comment" required maxlength="8000"></textarea></label>
                    <div class="form-row form-actions">
                        <button class="board-btn" type="submit">Post one-time reply</button>
                        <span class="form-msg" role="status"></span>
                    </div>
                </form>`;
            }
            return '';
        };

        const sorted = [...state.threads].sort((a, b) => b.bump - a.bump);
        $('#threads').innerHTML = sorted.length
            ? sorted.map((t) => {
                const publicBtn = !owner && canPublicReply(t)
                    ? `<div class="post-head"><span class="post-tools"><button class="post-link" type="button" data-public-reply="${t.no}">One-Time Reply (${t.publicCredits})</button></span></div>`
                    : '';
                return `<article class="thread" id="t${t.no}">${postHTML(t, t, true)}${publicBtn}<div class="replies">${t.replies.map((r) => postHTML(r, t, false)).join('')}</div>${replyForm(t)}</article>`;
            }).join('')
            : '<p class="empty">No project threads posted yet.</p>';

        $$('.reply-form').forEach((f) => {
            const d = drafts[f.dataset.thread];
            if (d && d.mode === f.dataset.mode) {
                f.hidden = !d.open;
                f.elements.comment.value = d.text;
            }
        });

        const posts = state.threads.reduce((n, t) => n + 1 + t.replies.length, 0);
        $('#stats').textContent = `${state.threads.length} threads / ${posts} posts`;
    }

    function submitForm(form, threadNo) {
        const mode = form.dataset.mode === 'public' ? 'public' : 'owner';
        if (mode === 'owner' && !isOwner()) return;

        const msg = $('.form-msg', form);
        const body = form.elements.comment.value.trim();
        if (!body) { msg.textContent = 'Write something first.'; return; }
        msg.textContent = '';

        const defaultName = mode === 'public' ? 'Anonymous' : savedName();
        const name = form.elements.poster.value.trim() || defaultName;
        if (mode === 'owner') store.set(NAME_KEY, name);

        const subject = form.elements.subject ? form.elements.subject.value.trim() : '';
        const status = form.elements.status ? form.elements.status.value : 'idea';
        const allowPublicReply = Boolean(form.elements.allowPublicReply && form.elements.allowPublicReply.checked);

        readImage(form.elements.file.files[0]).then((img) => {
            if (threadNo) { form.elements.comment.value = ''; form.hidden = true; }
            else { form.reset(); form.hidden = true; }

            if (mode === 'owner') {
                commit(() => {
                    const now = Date.now();
                    const post = { no: state.next++, name, time: now, body, img, role: 'owner' };
                    if (threadNo) {
                        const t = state.threads.find((x) => x.no === threadNo);
                        t.replies.push(post);
                        t.bump = now;
                    } else {
                        state.threads.push({
                            ...post,
                            subject,
                            status: STATUSES[status] ? status : 'idea',
                            allowPublicReply,
                            publicCredits: allowPublicReply ? 1 : 0,
                            bump: now,
                            replies: []
                        });
                    }
                });
            } else {
                const t = state.threads.find((x) => x.no === threadNo);
                if (!t || !canPublicReply(t)) {
                    msg.textContent = 'Public reply slot is closed.';
                    return;
                }
                const now = Date.now();
                t.replies.push({ no: state.next++, name, time: now, body, img, role: 'public' });
                t.publicCredits = Math.max(0, Number(t.publicCredits) - 1);
                t.bump = now;
                render();
                msg.textContent = 'Posted locally (requires owner commit to publish to GitHub).';
            }
        }).catch((err) => { msg.textContent = err.message; });
    }

    function toggleReply(threadNo, quote, mode = 'owner') {
        const form = $(`.reply-form[data-thread="${threadNo}"][data-mode="${mode}"]`);
        if (!form) return;

        if (!quote) {
            form.hidden = !form.hidden;
            if (!form.hidden) form.elements.comment.focus();
            return;
        }

        form.hidden = false;
        const box = form.elements.comment;
        box.value += (box.value && !box.value.endsWith('\n') ? '\n' : '') + quote;
        box.focus();
    }

    function flash(no) {
        const el = document.getElementById(`p${no}`);
        if (!el) return;
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 1600);
    }

    function removePost(no, threadNo) {
        if (!isOwner()) return;
        const t = state.threads.find((x) => x.no === threadNo);
        if (!t) return;
        if (!confirm(t.no === no ? 'Delete this whole thread?' : 'Delete this post?')) return;
        commit(() => {
            if (t.no === no) state.threads = state.threads.filter((x) => x.no !== no);
            else t.replies = t.replies.filter((r) => r.no !== no);
        });
    }

    const threadsEl = $('#threads');
    threadsEl.addEventListener('click', (e) => {
        const el = e.target;
        const quote = el.closest('[data-quote]');
        if (quote && isOwner()) { e.preventDefault(); toggleReply(quote.dataset.thread, `>>${quote.dataset.quote}\n`, 'owner'); return; }

        const reply = el.closest('[data-reply]');
        if (reply && isOwner()) { toggleReply(reply.dataset.reply, '', 'owner'); return; }

        const pubReply = el.closest('[data-public-reply]');
        if (pubReply) { toggleReply(pubReply.dataset.publicReply, '', 'public'); return; }

        const togglePub = el.closest('[data-toggle-public]');
        if (togglePub && isOwner()) {
            const threadNo = Number(togglePub.dataset.togglePublic);
            commit(() => {
                const t = state.threads.find((x) => x.no === threadNo);
                if (!t) return;
                t.allowPublicReply = !t.allowPublicReply;
                if (t.allowPublicReply && t.publicCredits <= 0) t.publicCredits = 1;
                if (!t.allowPublicReply) t.publicCredits = 0;
            });
            return;
        }

        const grantReply = el.closest('[data-grant-reply]');
        if (grantReply && isOwner()) {
            const threadNo = Number(grantReply.dataset.grantReply);
            commit(() => {
                const t = state.threads.find((x) => x.no === threadNo);
                if (!t) return;
                t.allowPublicReply = true;
                t.publicCredits = Number(t.publicCredits || 0) + 1;
            });
            return;
        }

        const del = el.closest('[data-delete]');
        if (del && isOwner()) { removePost(Number(del.dataset.delete), Number(del.dataset.thread)); return; }

        const quoted = el.closest('.quotelink');
        if (quoted) { flash(quoted.dataset.no); return; }

        if (el.matches('.post-img')) el.classList.toggle('expanded');
    });

    threadsEl.addEventListener('submit', (e) => {
        if (!e.target.matches('.reply-form')) return;
        e.preventDefault();
        submitForm(e.target, Number(e.target.dataset.thread));
    });

    threadsEl.addEventListener('change', (e) => {
        if (!e.target.matches('.status-select') || !STATUSES[e.target.value] || !isOwner()) return;
        commit(() => { state.threads.find((x) => x.no === Number(e.target.dataset.thread)).status = e.target.value; });
    });

    /* ---------- Toolbar & Auth ---------- */
    const newForm = $('#new-form');
    newForm.elements.status.innerHTML = Object.keys(STATUSES).map((k) => `<option value="${k}">${STATUSES[k]}</option>`).join('');
    newForm.elements.poster.value = newForm.elements.poster.defaultValue = savedName();
    newForm.addEventListener('submit', (e) => { e.preventDefault(); submitForm(newForm, 0); });
    $('#new-toggle').addEventListener('click', () => {
        newForm.hidden = !newForm.hidden;
        if (!newForm.hidden) newForm.elements.subject.focus();
    });

    $('#export').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
        link.download = `project-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    $('#import-btn').addEventListener('click', () => $('#import').click());
    $('#import').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        file.text().then((text) => {
            const data = JSON.parse(text);
            if (!data || !Array.isArray(data.threads)) throw new Error('not a board backup');
            if (!confirm('Replace everything on this board with the backup?')) return;
            commit(() => { state = clean(data); });
        }).catch(() => alert('That file is not a valid board backup.'));
    });

    const authForm = $('#auth-form');
    $('#auth-toggle').addEventListener('click', () => {
        authForm.hidden = !authForm.hidden;
        if (!authForm.hidden) $('#auth-token').focus();
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = $('#auth-msg');
        const token = $('#auth-token').value.trim();
        if (!token) return;
        msg.textContent = 'Verifying token...';

        try {
            const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
            });
            if (!res.ok) throw new Error('Invalid token or repository name.');
            const repo = await res.json();
            if (!repo.permissions || !repo.permissions.push) throw new Error('Token lacks write access to this repo.');

            store.set(TOKEN_KEY, token);
            $('#auth-token').value = '';
            msg.textContent = '';
            authForm.hidden = true;
            await loadBoard();
        } catch (err) {
            msg.textContent = err.message;
        }
    });

    $('#logout-btn').addEventListener('click', () => {
        store.del(TOKEN_KEY);
        fileSha = null;
        loadBoard();
    });

    loadBoard();
})();