/* ============================================================
   Bond Quest — motion layer
   Springy micro-interactions for the HUD, panels and modals.
   Patterns borrowed from transitions.dev (panel reveal, toast
   spring, card tilt, number pop, text shimmer) and the
   aceternity / obsidianui hover treatments.
   Plain JS on purpose: the game ships as one static page.
   ============================================================ */
(function () {
  'use strict';
  if (window.__moReady) return;
  window.__moReady = true;

  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }

  var STAGGER_TARGETS = [
    '.modalCard .modalHead',
    '.modalCard .modalBody',
    '.modalCard .modalFoot',
    '#startCard > *',
    '.startScroll > *',
    '.startFoot > *',
    '#glossaryList > *',
    '.qpList > *',
    '.wpList > *',
    '#charList > *',
    '#shopItems > *',
    '#dailyBody > *',
    '#trialPips'
  ];

  /* ---------- stagger: give every child an index for CSS delay ---------- */
  function stagger(root) {
    if (!root) return;
    STAGGER_TARGETS.forEach(function (sel) {
      var lists = [];
      if (root.matches && root.matches(sel)) lists.push(root);
      if (root.querySelectorAll) Array.prototype.push.apply(lists, root.querySelectorAll(sel));
      lists.forEach(function (list) {
        var kids = list.children;
        for (var i = 0; i < kids.length; i++) {
          kids[i].style.setProperty('--mo-i', Math.min(i, 14));
          if (!kids[i].classList.contains('mo-rise')) {
            kids[i].classList.add('mo-rise');
          }
        }
      });
    });
  }

  /* replay the rise animation (used when a panel re-opens) */
  function replay(root) {
    if (!root || reduce) return;
    STAGGER_TARGETS.forEach(function (sel) {
      var lists = [];
      if (root.matches && root.matches(sel)) lists.push(root);
      if (root.querySelectorAll) Array.prototype.push.apply(lists, root.querySelectorAll(sel));
      lists.forEach(function (list) {
        Array.prototype.forEach.call(list.children, function (kid, i) {
          kid.style.setProperty('--mo-i', Math.min(i, 14));
          kid.classList.remove('mo-rise');
          /* force a reflow so the animation can start again */
          void kid.offsetWidth;
          kid.classList.add('mo-rise');
        });
      });
    });
  }

  /* ---------- press ripple ---------- */
  var RIPPLE = '.primary,.ghost,.iconBtn,.toolBtn,.tBtn,.shopTab,.startBtn,.pill,.charCard button';
  document.addEventListener('pointerdown', function (e) {
    if (reduce) return;
    var target = e.target && e.target.closest ? e.target.closest(RIPPLE) : null;
    if (!target || target.disabled) return;
    var rect = target.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.6;
    var span = document.createElement('span');
    span.className = 'mo-ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - rect.left - size / 2) + 'px';
    span.style.top = (e.clientY - rect.top - size / 2) + 'px';
    target.appendChild(span);
    setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 620);
  }, { passive: true });

  /* ---------- pop feedback for changing numbers ---------- */
  function pop(el, cls) {
    if (!el || reduce) return;
    el.classList.remove(cls || 'mo-pop');
    void el.offsetWidth;
    el.classList.add(cls || 'mo-pop');
  }

  /* ---------- number count-up (anime.js when available) ---------- */
  var anime = window.anime;
  function countUp(el) {
    if (!el || reduce) return;
    var digits = (el.textContent || '').replace(/[^0-9.-]/g, '');
    var to = parseFloat(digits);
    if (!isFinite(to)) return;
    var from = parseFloat(el.getAttribute('data-mo-num'));
    el.setAttribute('data-mo-num', String(to));
    if (!anime || !isFinite(from) || from === to) { pop(el); return; }
    var obj = { v: from };
    el.classList.add('mo-counting');
    anime({
      targets: obj,
      v: to,
      duration: 520,
      easing: 'easeOutCubic',
      update: function () {
        el.textContent = String(Math.round(obj.v));
      },
      complete: function () { el.classList.remove('mo-counting'); }
    });
  }

  /* ---------- springy pop that CSS keyframes cannot express ---------- */
  function spring(el, scale) {
    if (!el || reduce || !anime) return false;
    anime.remove(el);
    anime({
      targets: el,
      scale: [{ value: (scale || 1.18), duration: 120, easing: 'easeOutQuad' }, { value: 1, duration: 520, easing: 'spring(1, 80, 12, 0)' }],
      complete: function () { el.style.transform = ''; }
    });
    return true;
  }

  window.Motion = {
    pop: pop,
    stagger: stagger,
    replay: replay,
    spring: spring,
    reduce: reduce,
    lib: anime ? 'anime.js' : 'none'
  };

  var NUM_IDS = ['scoreNum', 'goldNum', 'shardNum', 'comboBadge', 'zoneLabel'];
  function watchNumbers() {
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el) return;
        if (el.id === 'comboBadge') { if (!spring(el, 1.4)) pop(el, 'mo-pop-big'); }
        else countUp(el);
      });
    });
    NUM_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ---------- open / close choreography for modals, screens, drawer ---------- */
  function wirePanels() {
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var el = m.target;
        if (!el.classList) return;
        var isPanel = el.classList.contains('modal') || el.classList.contains('screen') || el.id === 'glossaryDrawer';
        if (!isPanel) return;
        var before = m.oldValue || '';
        var had = /(^|\s)(show|open)(\s|$)/.test(before);
        var has = el.classList.contains('show') || el.classList.contains('open');
        if (!had && has) {
          el.classList.remove('mo-out');
          el.classList.add('mo-in');
          stagger(el);
          replay(el);
          clearTimeout(el.__moTimer);
          el.__moTimer = setTimeout(function () { el.classList.remove('mo-in'); }, 520);
        } else if (had && !has) {
          if (el.id === 'startScreen') replayHud();
          if (reduce) return;
          el.classList.add('mo-out');
          clearTimeout(el.__moTimer);
          el.__moTimer = setTimeout(function () { el.classList.remove('mo-out'); }, 240);
        }
      });
    });
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
      subtree: true
    });
  }

  /* ---------- pointer-tracked tilt + spotlight for character cards ---------- */
  var TILT = '.charCard, .shopItem, .gachaCard';
  document.addEventListener('pointermove', function (e) {
    if (reduce) return;
    var card = e.target && e.target.closest ? e.target.closest(TILT) : null;
    if (!card) return;
    var r = card.getBoundingClientRect();
    var mx = (e.clientX - r.left) / r.width - 0.5;
    var my = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--mx', mx.toFixed(3));
    card.style.setProperty('--my', my.toFixed(3));
    card.classList.add('mo-tilting');
  }, { passive: true });
  document.addEventListener('pointerout', function (e) {
    var card = e.target && e.target.closest ? e.target.closest(TILT) : null;
    if (!card) return;
    if (card.contains(e.relatedTarget)) return;
    card.classList.remove('mo-tilting');
    card.style.setProperty('--mx', 0);
    card.style.setProperty('--my', 0);
  }, { passive: true });

  /* ---------- toasts: spring in, gentle push for the ones already there ---------- */
  function wireToasts() {
    var wrap = document.getElementById('toastWrap');
    if (!wrap || !window.MutationObserver) return;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (node) {
          if (node.nodeType !== 1) return;
          node.classList.add('mo-toast');
        });
      });
    });
    obs.observe(wrap, { childList: true });
  }

  /* ---------- keyboard / focus polish ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var open = document.querySelector('.modal.show .modalCard, .screen.show .startCard');
      if (open) pop(open, 'mo-nudge');
    }
  });

  function replayHud() {
    if (reduce) return;
    Array.prototype.forEach.call(document.querySelectorAll('#topbar > *, #bottomBar > *'), function (el, i) {
      el.classList.remove('mo-hud-in');
      void el.offsetWidth;
      el.style.setProperty('--mo-i', i);
      el.classList.add('mo-hud-in');
    });
  }

  /* ambient motes behind the title card */
  function spawnSparks() {
    var screen = document.getElementById('startScreen');
    if (!screen || screen.querySelector('.mo-sparks')) return;
    var box = document.createElement('div');
    box.className = 'mo-sparks';
    for (var i = 0; i < 18; i++) {
      var s = document.createElement('i');
      s.className = 'mo-spark';
      var size = 3 + Math.random() * 5;
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (55 + Math.random() * 45).toFixed(2) + '%';
      s.style.width = size.toFixed(1) + 'px';
      s.style.height = size.toFixed(1) + 'px';
      s.style.animationDuration = (9 + Math.random() * 9).toFixed(1) + 's';
      s.style.animationDelay = (-Math.random() * 12).toFixed(1) + 's';
      box.appendChild(s);
    }
    screen.appendChild(box);
  }

  function boot() {
    document.body.classList.add('mo-ready');
    /* sheen for the big call-to-action buttons */
    Array.prototype.forEach.call(document.querySelectorAll('.primary, .startBtn'), function (btn) {
      btn.classList.add('mo-sheen');
    });
    /* HUD chips drift in with a small cascade */
    Array.prototype.forEach.call(document.querySelectorAll('#topbar > *, #bottomBar > *'), function (el, i) {
      el.classList.add('mo-hud-in');
      el.style.setProperty('--mo-i', i);
    });
    spawnSparks();
    stagger(document);
    wirePanels();
    wireToasts();
    watchNumbers();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
