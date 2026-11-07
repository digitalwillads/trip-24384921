// Shared by ideas-krabi.html and ideas-phiphi.html: idea cards, an idea panel, and a comment thread per idea.
// Comments live in the trip-comments Cloudflare Worker (~/Desktop/projects/trip-comments). No login: Will or Yana
// picks a name once per device. The page fetches comments on load, when a panel opens, and when the tab comes back.
(() => {
  'use strict';
  const API = 'https://trip-comments.digitalwillads.workers.dev';
  const log = (...a) => console.log('[ideas]', ...a);
  const fail = (...a) => console.error('[ideas]', ...a);
  const PAGE = document.body.dataset.page;
  const IDEAS = JSON.parse(document.getElementById('ideas-data').textContent);
  const NAMES = ['Will', 'Yana'];
  const ME_KEY = 'krabi-trip-me';
  log('init', { page: PAGE, ideas: IDEAS.length });

  const ICON_PATHS = {
    'Beach': '<circle cx="17" cy="7" r="3"/><path d="M2 16c2 0 2-1.5 4-1.5S8 16 10 16s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 20.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/>',
    'Boat trip': '<path d="M3 15l2 5h14l2-5z"/><path d="M12 3v12M12 3l6 9h-6"/>',
    'Snorkel': '<rect x="2.5" y="8" width="14" height="8" rx="3"/><path d="M9.5 16v-2M20 3v11a5 5 0 0 1-5 5h-1"/>',
    'Dive': '<circle cx="8" cy="6" r="2"/><circle cx="13" cy="3.5" r="1.2"/><path d="M3 20c3-4 6-6 10-6 3 0 5 1 8 3M14 14l3-4"/>',
    'Hike': '<path d="M3 20l6-10 4 6 3-4 5 8z"/>',
    'Nature': '<path d="M5 19C5 11 11 5 20 5c0 9-6 15-14 15M5 19l8-8"/>',
    'Culture': '<path d="M3 20h18M6 20v-9M18 20v-9M10 20v-5h4v5M2.5 11 12 4.5 21.5 11"/>',
    'Food': '<path d="M3 11h18a9 9 0 0 1-18 0zM8 7.5c0-1.2 1-2 1-3.5M12 7.5c0-1.2 1-2 1-3.5M16 7.5c0-1.2 1-2 1-3.5"/>',
    'Nightlife': '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/><path d="M17 3v3M15.5 4.5h3"/>',
  };
  const icon = tag => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[tag] || ICON_PATHS.Nature}</svg>`;
  const tagClass = tag => `tag-${String(tag).toLowerCase().replace(/\s+/g, '-')}`;
  const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let me = null;
  try { me = localStorage.getItem(ME_KEY); } catch (e) { /* storage blocked: pick a name each visit */ }
  if (!NAMES.includes(me)) me = null;
  let comments = [];
  let openSlug = null;

  const $ = id => document.getElementById(id);
  const grid = $('grid'), whoStatus = $('who-status'), dialog = $('panel'), thread = $('thread');
  const textBox = $('comment-text'), sendBtn = $('send'), hint = $('composer-hint');

  // ---------- Who is commenting ----------
  function setMe(name) {
    me = name;
    try { localStorage.setItem(ME_KEY, name); } catch (e) { /* not saved: fine for this visit */ }
    document.querySelectorAll('[data-name]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.name === me)));
    renderHint();
    log('me', me);
  }
  document.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => setMe(b.dataset.name)));
  document.querySelectorAll('[data-name]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.name === me)));

  // ---------- Cards ----------
  function renderGrid() {
    grid.innerHTML = '';
    IDEAS.forEach((idea, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `card ${tagClass(idea.tag)} reveal`;
      card.style.setProperty('--i', String(Math.min(i, 8)));
      card.dataset.slug = idea.slug;
      card.innerHTML = `
        <span class="card__top"><span class="card__icon">${icon(idea.tag)}</span><span class="card__tag">${esc(idea.tag)}</span></span>
        <span class="card__title">${esc(idea.title)}</span>
        <span class="card__blurb">${esc(idea.blurb)}</span>
        <span class="card__foot"><span class="card__time">${esc(idea.time || '')}</span><span class="talk" data-talk="${esc(idea.slug)}">No comments yet</span></span>`;
      card.addEventListener('click', () => openIdea(idea.slug));
      grid.appendChild(card);
    });
  }
  function renderTalk() {
    if (!whoStatus.classList.contains('is-error')) whoStatus.textContent = `${comments.length} comment${comments.length === 1 ? '' : 's'} on this page`;
    document.querySelectorAll('[data-talk]').forEach(el => {
      const list = comments.filter(c => c.idea === el.dataset.talk);
      if (!list.length) { el.textContent = 'No comments yet'; return; }
      const who = NAMES.filter(n => list.some(c => c.author === n));
      el.innerHTML = `<span class="dots">${who.map(n => `<span class="dot dot--${n.toLowerCase()}" title="${n}">${n[0]}</span>`).join('')}</span>${list.length} comment${list.length === 1 ? '' : 's'}`;
    });
  }

  // ---------- Server ----------
  async function fetchComments(reason) {
    const t0 = performance.now();
    log('fetch: comments', { page: PAGE, reason });
    try {
      const r = await fetch(`${API}/comments?page=${encodeURIComponent(PAGE)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      comments = (await r.json()).comments || [];
      log('fetch: comments ok', { count: comments.length, ms: Math.round(performance.now() - t0) });
      whoStatus.classList.remove('is-error');
      renderTalk();
      if (openSlug) renderThread();
    } catch (e) {
      fail('fetch: comments failed', { reason, error: String(e) });
      whoStatus.textContent = 'Comments did not load. Check the connection, then reload.';
      whoStatus.classList.add('is-error');
    }
  }
  async function postComment(text) {
    const t0 = performance.now();
    const body = { page: PAGE, idea: openSlug, author: me, text };
    log('post: comment', { idea: openSlug, author: me, chars: text.length });
    const r = await fetch(`${API}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    log('post: comment ok', { id: data.comment.id, ms: Math.round(performance.now() - t0) });
    return data.comment;
  }

  // ---------- Panel ----------
  function openIdea(slug) {
    const idea = IDEAS.find(x => x.slug === slug);
    if (!idea) return;
    openSlug = slug;
    $('panel-icon').className = `card__icon ${tagClass(idea.tag)}`;
    $('panel-icon').innerHTML = icon(idea.tag);
    $('panel-tag').className = `card__tag ${tagClass(idea.tag)}`;
    $('panel-tag').textContent = idea.tag;
    $('panel-title').textContent = idea.title;
    $('panel-blurb').textContent = idea.blurb;
    const facts = [['Getting there', idea.how], ['Time', idea.time], ['Cost', idea.cost], ['Tip', idea.tip]].filter(([, v]) => v);
    $('panel-facts').innerHTML = facts.map(([k, v]) => `<div class="fact${k === 'Getting there' || k === 'Tip' ? ' fact--wide' : ''}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('panel-sources').innerHTML = (idea.sources || []).length
      ? `Sources: ${idea.sources.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace(/^www\./, ''))}</a>`).join(', ')}`
      : '';
    renderThread();
    renderHint();
    if (!dialog.open) dialog.showModal();
    history.replaceState(null, '', `#${slug}`);
    log('panel: open', slug);
    fetchComments('panel opened');
  }
  function renderThread() {
    const list = comments.filter(c => c.idea === openSlug);
    thread.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li');
      li.className = `msg msg--${c.author.toLowerCase()}`;
      li.innerHTML = `<span class="msg__meta"><b></b><span></span></span><p class="msg__text"></p>`;
      li.querySelector('b').textContent = c.author;
      li.querySelector('.msg__meta span').textContent = when(c.created_at);
      li.querySelector('.msg__text').textContent = c.text;
      thread.appendChild(li);
    }
    $('thread-empty').hidden = list.length > 0;
  }
  function renderHint(error) {
    hint.classList.toggle('is-error', !!error);
    if (error) { hint.textContent = error; return; }
    hint.innerHTML = me
      ? `Writing as <b>${me}</b>. <span class="composer__pick">${NAMES.filter(n => n !== me).map(n => `<button type="button" data-switch="${n}">I am ${n}</button>`).join('')}</span>`
      : `Who is writing? <span class="composer__pick">${NAMES.map(n => `<button type="button" data-switch="${n}">${n}</button>`).join('')}</span>`;
    hint.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => { setMe(b.dataset.switch); syncSend(); textBox.focus(); }));
    syncSend();
  }
  const syncSend = () => { sendBtn.disabled = !me || !textBox.value.trim(); };
  textBox.addEventListener('input', syncSend);
  $('composer').addEventListener('submit', async e => {
    e.preventDefault();
    const text = textBox.value.trim();
    if (!me) { renderHint('Choose Will or Yana first.'); return; }
    if (!text) return;
    sendBtn.disabled = true;
    try {
      const c = await postComment(text);
      comments.push(c);
      textBox.value = '';
      renderThread();
      renderTalk();
      renderHint();
      thread.lastElementChild && thread.lastElementChild.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      fail('post: comment failed', String(err));
      renderHint('Could not send. Check the connection and try again.');
      syncSend();
    }
  });
  $('panel-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // a tap outside the panel closes it
  dialog.addEventListener('close', () => {
    log('panel: close', openSlug);
    openSlug = null;
    history.replaceState(null, '', location.pathname + location.search);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fetchComments('tab visible again'); });

  // ---------- Boot ----------
  const tabs = document.querySelector('.tabs'), current = tabs && tabs.querySelector('[aria-current="page"]');
  if (current) tabs.scrollLeft = current.offsetLeft - (tabs.clientWidth - current.clientWidth) / 2;
  renderGrid();
  renderHint();
  fetchComments('page load');
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && IDEAS.some(x => x.slug === fromHash)) openIdea(fromHash); // a shared link opens its idea
})();
