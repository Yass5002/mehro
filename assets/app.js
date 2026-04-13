let progressRafId = null,
  spotifyData = null,
  currentAudio = null,
  currentPlayingButton = null,
  refreshCooldown = !1,
  isOffline = !1,
  timestampsInterval = null,
  lastVolume = 0.67,
  currentLyrics = [],
  cachedLyricLines = [],
  lyricsActive = !1,
  lyricsStatus = "loading",
  isLyricsFullscreen = !1,
  currentTrackIdForLyrics = null,
  lastActiveLineIndex = -1,
  imageObserver = null,
  audioContext,
  dataArray,
  analyser,
  sourceNode,
  animationFrameId,
  gainNode,
  isVisualizerInitialized = !1,
  isVisualizerPlaying = !1,
  currentBarHeights = [],
  currentSongTab = "recent",
  switchCooldown = !1,
  nowPlayingInterval = null,
  presenceInterval = null,
  counterAssetsAvailable = null;
const controllerRegistry = new Map(),
  API_BASE_DEFAULT = window.location.origin,
  API_BASE_OVERRIDE =
    window.__MEHRO_API_BASE || localStorage.getItem("mehro_api_base"),
  PLACEHOLDER_IMG = "assets/placeholder.png",
  CONFIG = {
    discordId: "1402361691383005336",
    statsFmId: "mehro",
    apiBase: API_BASE_OVERRIDE || API_BASE_DEFAULT,
    fallbackBanner: "assets/banner.webp",
    fallbackAvatarDecoration:
      "https://cdn.discordapp.com/avatar-decoration-presets/a_52fd31296f501c7875bd09b0c379c2dd.png?size=128&passthrough=true",
  };
function checkHardwareAcceleration() {
  try {
    let e = document.createElement("canvas");
    ((e.width = 1), (e.height = 1));
    let t = e.getContext("webgl") || e.getContext("experimental-webgl");
    if (t) {
      let n = t.getParameter(t.RENDERER);
      if (n && /(WebGL|Mozilla)/i.test(n)) {
        let i = t.getExtension("WEBGL_debug_renderer_info");
        i && (n = t.getParameter(i.UNMASKED_RENDERER_WEBGL) || n);
      }
      if (
        ((e.width = 0),
        (e.height = 0),
        n &&
          /(swiftshader|llvmpipe|software|softpipe|lavapipe|basic render|microsoft basic display|mesa offscreen|apple software renderer)/i.test(
            n,
          ))
      )
        return !1;
    }
  } catch (r) {}
  try {
    let a = !1,
      s = document.createElement("canvas");
    if (
      (s.getContext("2d", {
        get willReadFrequently() {
          return ((a = !0), !1);
        },
      }),
      !a)
    )
      return !0;
    let l = (e) => {
        let t = document.createElement("canvas");
        ((t.width = 128), (t.height = 128));
        let n = t.getContext("2d", { willReadFrequently: e });
        return (
          n.moveTo(0.5, 0.5),
          n.lineTo(120.3, 121.7),
          n.stroke(),
          n.getImageData(0, 0, 128, 128).data
        );
      },
      o = l(!1),
      c = l(!0),
      d = c.length;
    for (let u = 0; u < d; u++) if (c[u] !== o[u]) return !0;
    return !1;
  } catch (y) {
    return !0;
  }
}
function escapeHTML(e) {
  return e
    ? e
        .toString()
        .replace(
          /[&<>'"`\/]/g,
          (e) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              "'": "&#39;",
              '"': "&quot;",
              "`": "&#96;",
              "/": "&#x2F;",
            })[e],
        )
    : "";
}
function updateDynamicFavicon(e) {
  if (!e) return;
  let t = document.querySelector('link[rel="icon"]');
  t && t.href !== e && (t.href = e);
}
function formatTime(e) {
  return isNaN(e)
    ? "0:00"
    : `${Math.floor(e / 60)}:${Math.floor(e % 60)
        .toString()
        .padStart(2, "0")}`;
}
function progressLoop() {
  (updateProgress(), (progressRafId = requestAnimationFrame(progressLoop)));
}
function parseLrc(e) {
  let t = e.split("\n"),
    n = [],
    i = /\[(\d{2}):(\d{2})\.(\d{2})\]/;
  for (let r of t) {
    let a = i.exec(r);
    if (a) {
      let s = parseInt(a[1], 10),
        l = parseInt(a[2], 10),
        o = parseInt(a[3], 10),
        c = 60 * s + l + o / 100,
        d = r.replace(i, "").trim(),
        u = !d;
      if (u && n.length > 0 && n[n.length - 1].isInstrumental) continue;
      n.push({ time: c, text: d, isInstrumental: u });
    }
  }
  return n;
}
async function fetchLyrics(e, t, n, i, r) {
  let a = document.getElementById("lyrics-content"),
    s = document.getElementById("unsynced-label"),
    l = controllerRegistry.get("lyrics-fetch");
  l && l.abort();
  let o = new AbortController();
  controllerRegistry.set("lyrics-fetch", o);
  let { signal: c } = o;
  ((a.dataset.currentTrackId = r),
    a.classList.remove("unsynced"),
    a.classList.add("locked"),
    (a.innerHTML =
      '<div class="lyrics-status-message loading">Loading..</div>'),
    (s.style.display = "none"),
    (currentLyrics = []),
    (document.getElementById("lyrics-song-title").textContent = e),
    (document.getElementById("lyrics-song-artist").textContent = t.replace(
      /; /g,
      ", ",
    )));
  try {
    let d = t.split(";")[0].trim(),
      u = await fetch(
        `https://lrclib.net/api/search?track_name=${encodeURIComponent(e)}&artist_name=${encodeURIComponent(d)}&album_name=${encodeURIComponent(n)}`,
        { signal: c },
      );
    if (c.aborted || r !== currentTrackIdForLyrics) return;
    if (!u.ok) throw Error("Failed to fetch");
    let y = await u.json();
    if (c.aborted || r !== currentTrackIdForLyrics) return;
    let m = y.filter(
      (e) => !!(!i || isNaN(i)) || 2 >= Math.abs(e.duration - i),
    );
    if (0 === m.length) throw Error("No lyrics found");
    m.sort((e, t) => {
      let n = !!e.syncedLyrics,
        i = !!t.syncedLyrics;
      return n && !i ? -1 : !n && i ? 1 : 0;
    });
    let g = m[0];
    if (c.aborted || r !== currentTrackIdForLyrics) return;
    if (g.syncedLyrics) {
      if (
        ((lyricsStatus = "synced"),
        a.classList.remove("locked"),
        (currentLyrics = (currentLyrics = parseLrc(g.syncedLyrics)).filter(
          (e, t, n) => {
            if (!e.isInstrumental) return !0;
            let i = n[t + 1];
            return !i || i.time - e.time > 3;
          },
        )).length > 0)
      ) {
        currentLyrics[0].time > 3 &&
          !currentLyrics[0].isInstrumental &&
          currentLyrics.unshift({ time: 0, text: "", isInstrumental: !0 });
        let p = currentLyrics[currentLyrics.length - 1];
        !p.isInstrumental &&
          i - p.time > 3 &&
          currentLyrics.push({
            time: p.time + 2,
            text: "",
            isInstrumental: !0,
          });
      }
      renderLyrics();
    } else if (g.plainLyrics)
      ((lyricsStatus = "unsynced"),
        a.classList.remove("locked"),
        (currentLyrics = g.plainLyrics
          .split("\n")
          .map((e) => ({ time: void 0, text: e }))),
        renderLyrics(),
        a.classList.add("unsynced"),
        (s.style.display = "block"));
    else if (g.instrumental)
      ((lyricsStatus = "instrumental"),
        (a.innerHTML =
          '<div class="lyrics-status-message">No lyrics found<br>(instrumental)</div>'),
        a.classList.add("locked"),
        (currentLyrics = []));
    else throw Error("No lyrics found");
  } catch ($) {
    if ("AbortError" === $.name || r !== currentTrackIdForLyrics) return;
    lyricsStatus = "error";
    let f = !["No lyrics found"].includes($.message);
    if (
      ((a.innerHTML = ` <div class="lyrics-status-message" style="flex-direction:column;"><span>${escapeHTML($.message)}</span> ${f ? '<button class="retry-lyrics-btn" id="retry-lyrics-btn">Try again</button>' : ""} </div> `),
      a.classList.add("locked"),
      (currentLyrics = []),
      f)
    ) {
      document.getElementById("lyrics-btn").classList.remove("disabled");
      let _ = document.getElementById("retry-lyrics-btn");
      _ &&
        _.addEventListener("click", () => {
          fetchLyrics(e, t, n, i, r);
        });
    } else document.getElementById("lyrics-btn").classList.add("disabled");
  }
}
function renderLyrics() {
  let e = document.getElementById("lyrics-content");
  ((lastActiveLineIndex = -1),
    (e.innerHTML = currentLyrics
      .map((e, t) => {
        let n = e.isInstrumental ? "instrumental" : "";
        if (e.isInstrumental)
          return `<div class="lyric-line ${n}" data-index="${t}"><div class="music-dots"><span></span><span></span><span></span></div></div>`;
        let i = e.text
          .split(" ")
          .map((e) => {
            if (/[-—–]/.test(e)) {
              let t = e.split(/([-—–])/),
                n = [],
                i = "";
              for (let r = 0; r < t.length; r++)
                ((i += t[r]),
                  (r % 2 != 0 || r === t.length - 1) &&
                    (i &&
                      n.push(
                        `<span class="lyric-word">${escapeHTML(i)}</span>`,
                      ),
                    (i = "")));
              return `<span class="word-wrapper">${n.join("<wbr>")}</span>`;
            }
            return `<span class="lyric-word">${escapeHTML(e)}</span>`;
          })
          .join("");
        return `<div class="lyric-line" data-index="${t}">${i}</div>`;
      })
      .join("")),
    (cachedLyricLines = Array.from(e.querySelectorAll(".lyric-line"))));
}
function syncLyrics(e, t = !1) {
  if (
    !lyricsActive ||
    0 === currentLyrics.length ||
    0 === cachedLyricLines.length
  )
    return;
  let n = -1,
    i = 0;
  -1 !== lastActiveLineIndex &&
    currentLyrics[lastActiveLineIndex] &&
    e >= currentLyrics[lastActiveLineIndex].time &&
    (i = lastActiveLineIndex);
  for (let r = i; r < currentLyrics.length; r++)
    if (currentLyrics[r].time <= e) n = r;
    else break;
  if (n !== lastActiveLineIndex || t) {
    let a = document.getElementById("lyrics-content");
    (cachedLyricLines.forEach((e, i) => {
      let r = e.querySelectorAll(".lyric-word");
      if (i === n) {
        (e.classList.add("active"), e.classList.remove("past"));
        let s = a.clientHeight,
          l = e.clientHeight,
          o = e.offsetTop - 0.43 * s + l / 2;
        a.scrollTo({ top: o, behavior: t ? "auto" : "smooth" });
      } else
        i < n
          ? e.classList.contains("past") ||
            (e.classList.add("past"),
            e.classList.remove("active"),
            r.forEach((e) => {
              (e.classList.add("past"),
                e.classList.remove("current"),
                e.style.removeProperty("--word-progress"));
            }))
          : (e.classList.contains("active") ||
              e.classList.contains("past") ||
              e.querySelector(".lyric-word.past, .lyric-word.current")) &&
            (e.classList.remove("active", "past"),
            r.forEach((e) => {
              (e.classList.remove("past", "current"),
                e.style.removeProperty("--word-progress"));
            }));
    }),
      (lastActiveLineIndex = n));
  }
  if (-1 !== n && cachedLyricLines[n]) {
    let s = cachedLyricLines[n],
      l = currentLyrics[n].time,
      o;
    o =
      n < currentLyrics.length - 1
        ? currentLyrics[n + 1].time
        : spotifyData
          ? (spotifyData.timestamps.end - spotifyData.timestamps.start) / 1e3
          : l + 5;
    let c = o - l,
      d = e - l;
    if (c > 0) {
      let u = s.querySelectorAll(".lyric-word");
      if (u.length > 0) {
        let y = currentLyrics[n].text,
          m = y.replace(/\s/g, "").length || 1,
          g = 0;
        u.forEach((e) => {
          let t = e.textContent.length,
            n = g / m,
            i = (g + t) / m,
            r = n * c,
            a = i * c;
          (d >= a
            ? "lyric-word past" !== e.className &&
              ((e.className = "lyric-word past"),
              e.style.removeProperty("--word-progress"))
            : d >= r
              ? (e.classList.contains("current") ||
                  (e.className = "lyric-word current"),
                e.style.setProperty(
                  "--word-progress",
                  `${Math.min(Math.max(((d - r) / (a - r)) * 100, 0), 100)}%`,
                ))
              : "lyric-word" !== e.className &&
                ((e.className = "lyric-word"),
                e.style.removeProperty("--word-progress")),
            (g += t));
        });
      }
    }
  }
}
function updateProgress() {
  if (!spotifyData) return;
  let e = Date.now(),
    t = e - spotifyData.timestamps.start,
    n = spotifyData.timestamps.end - spotifyData.timestamps.start,
    i = Math.min((t / n) * 100, 100),
    r = n - t;
  (document.getElementById("progress-fill") &&
    document
      .getElementById("progress-fill")
      .style.setProperty("--bar-progress", i),
    document.getElementById("time-elapsed") &&
      (document.getElementById("time-elapsed").textContent = formatTime(
        t / 1e3,
      )),
    document.getElementById("time-remaining") &&
      (document.getElementById("time-remaining").textContent =
        `-${formatTime(r > 0 ? r / 1e3 : 0)}`),
    lyricsActive &&
      (syncLyrics(t / 1e3),
      document.getElementById("lyrics-progress-fill") &&
        document
          .getElementById("lyrics-progress-fill")
          .style.setProperty("--bar-progress", i),
      document.getElementById("lyrics-time-elapsed") &&
        (document.getElementById("lyrics-time-elapsed").textContent =
          formatTime(t / 1e3)),
      document.getElementById("lyrics-time-remaining") &&
        (document.getElementById("lyrics-time-remaining").textContent =
          `-${formatTime(r > 0 ? r / 1e3 : 0)}`)));
}
function triggerUpdateAnimation(e) {
  requestAnimationFrame(() => {
    (e.classList.remove("updated"),
      e.offsetWidth,
      e.classList.add("updated"),
      e.addEventListener("animationend", () => e.classList.remove("updated"), {
        once: !0,
      }));
  });
}
function updateStatus(e) {
  if (!e) {
    updateStatusDisconnected();
    return;
  }
  let t = document.getElementById("profile-banner");
  if (e.kv && e.kv.banner && e.discord_user) {
    let n = e.kv.banner,
      i = e.discord_user.id,
      r = n.startsWith("a_") ? "gif" : "png",
      a = `https://cdn.discordapp.com/banners/${i}/${n}.${r}?size=600`;
    (t.src !== a && (t.src = a), (t.style.display = "block"));
  } else
    (t.src !== CONFIG.fallbackBanner && (t.src = CONFIG.fallbackBanner),
      (t.style.display = "block"));
  let s = document.getElementById("avatar"),
    l = document.getElementById("avatar-decoration"),
    o = document.getElementById("display-name"),
    c = document.getElementById("at-username"),
    d = document.getElementById("custom-status"),
    u = document.getElementById("status-icon"),
    y = document.getElementById("devices"),
    m = document.getElementById("guild-badge"),
    g = document.getElementById("guild-badge-icon"),
    p = document.getElementById("guild-badge-tag");
  if (e.discord_user) {
    let $ = e.discord_user,
      f = $.global_name || $.username;
    if (o.textContent.trim() !== f) {
      let _ = o.querySelector(".display-name-inner");
      (_ && ((_.textContent = f), applyDisplayNameScroll()),
        triggerUpdateAnimation(o));
    }
    let v = `@${$.username}`;
    c.textContent !== v && ((c.textContent = v), triggerUpdateAnimation(c));
    let h = $.avatar
      ? `https://cdn.discordapp.com/avatars/${$.id}/${$.avatar}.${$.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
      : PLACEHOLDER_IMG;
    s.src !== h && ((s.src = h), triggerUpdateAnimation(s));
    updateDynamicFavicon(h);
    let L = $.avatar_decoration_data
      ? `https://cdn.discordapp.com/avatar-decoration-presets/${$.avatar_decoration_data.asset}.png?size=96`
      : CONFIG.fallbackAvatarDecoration;
    l.src !== L && ((l.src = L), (l.style.display = L ? "block" : "none"));
    let I = document.getElementById("discord-link");
    if (
      (I &&
        !I.href.includes("discord.com") &&
        (I.href = `https://discord.com/users/${$.id}`),
      $.primary_guild && $.primary_guild.identity_enabled)
    ) {
      let b = $.primary_guild,
        E = `https://cdn.discordapp.com/clan-badges/${b.identity_guild_id}/${b.badge}.png?size=32`;
      (g.src !== E && (g.src = E),
        (g.style.display = ""),
        p.textContent !== b.tag && (p.textContent = b.tag),
        (m.style.display = "inline-flex"));
    } else m.style.display = "none";
  }
  let B = {
      online: { icon: "assets/states/online.png" },
      idle: { icon: "assets/states/idle.png" },
      dnd: { icon: "assets/states/dnd.png" },
      offline: { icon: "assets/states/offline.png" },
    },
    w = B[e.discord_status] || B.offline;
  u.src.endsWith(w.icon) || ((u.src = w.icon), triggerUpdateAnimation(u));
  let k =
    (e.active_on_discord_web ? "w" : "") +
    (e.active_on_discord_desktop ? "d" : "") +
    (e.active_on_discord_mobile ? "m" : "") +
    (e.active_on_discord_embedded ? "e" : "") +
    (e.active_on_discord_vr ? "v" : "");
  y.dataset.active !== k &&
    ((y.dataset.active = k),
    (y.innerHTML = ""),
    e.active_on_discord_web &&
      (y.innerHTML +=
        '<svg class="device-icon web" height="20" width="20" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93Zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39Z"></path></svg>'),
    e.active_on_discord_desktop &&
      (y.innerHTML +=
        '<svg class="device-icon desktop" height="20" width="20" viewBox="0 0 24 24"><path d="M4 2.5c-1.103 0-2 .897-2 2v11c0 1.104.897 2 2 2h7v2H7v2h10v-2h-4v-2h7c1.103 0 2-.896 2-2v-11c0-1.103-.897-2-2-2H4Zm16 2v9H4v-9h16Z"></path></svg>'),
    e.active_on_discord_mobile &&
      (y.innerHTML +=
        '<svg class="device-icon mobile" height="20" width="20" viewBox="0 0 1000 1500"><path d="M 187 0 L 813 0 C 916.277 0 1000 83.723 1000 187 L 1000 1313 C 1000 1416.277 916.277 1500 813 1500 L 187 1500 C 83.723 1500 0 1416.277 0 1313 L 0 187 C 0 83.723 83.723 0 187 0 Z M 125 1000 L 875 1000 L 875 250 L 125 250 Z M 500 1125 C 430.964 1125 375 1180.964 375 1250 C 375 1319.036 430.964 1375 500 1375 C 569.036 1375 625 1319.036 625 1250 C 625 1180.964 569.036 1125 500 1125 Z"></path></svg>'),
    e.active_on_discord_embedded &&
      (y.innerHTML +=
        '<svg class="device-icon embedded " height="20" width="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z"/></svg>'),
    e.active_on_discord_vr &&
      (y.innerHTML +=
        '<svg class="device-icon vr" height="20" width="20" viewBox="0 0 24 24"><path d="M8.46 8.64a1 1 0 0 1 1 1c0 .44-.3.8-.72.92l-.11.07c-.08.06-.2.19-.2.41a.99.99 0 0 1-.98.86h-.06a1 1 0 0 1-.94-1.05l.02-.32c.05-1.06.92-1.9 1.99-1.9ZM15.55 5a5.5 5.5 0 0 1 5.15 3.67h.3a2 2 0 0 1 2 2v3.18a2 2 0 0 1-2 1.99h-.2A4.54 4.54 0 0 1 16.55 19a4.45 4.45 0 0 1-3.6-1.83 1.2 1.2 0 0 0-1.9 0 4.44 4.44 0 0 1-3.9 1.82 4.54 4.54 0 0 1-3.94-3.15H3a2 2 0 0 1-2-2v-3.18c0-1.1.9-1.99 2-1.99h.3A5.5 5.5 0 0 1 8.46 5h7.09Zm-7.1 2C6.6 7 5.06 8.5 4.97 10.41l-.02.66v3.18c0 1.43 1.05 2.66 2.34 2.74.85.06 1.63-.32 2.14-1.01a3.2 3.2 0 0 1 2.57-1.3c1 0 1.97.48 2.57 1.3.5.69 1.3 1.08 2.14 1.01 1.3-.08 2.34-1.31 2.34-2.74l-.02-3.84a3.54 3.54 0 0 0-3.49-3.43H8.45Z"></path></svg>'));
  let A = document.getElementById("spotify-card"),
    S = document.getElementById("album-art"),
    T = document.getElementById("song-name"),
    x = document.getElementById("artist-name"),
    C = document.getElementById("album-name"),
    P = document.getElementById("open-spotify-btn"),
    M = document.getElementById("lyrics-btn");
  if (e.listening_to_spotify && e.spotify) {
    let F = e.spotify.track_id,
      H = F && "null" !== F ? F : `local:${e.spotify.song}-${e.spotify.artist}`;
    if (A.dataset.trackId !== H) {
      let N = controllerRegistry.get("spotify-fetch");
      N && N.abort();
      let q = new AbortController();
      controllerRegistry.set("spotify-fetch", q);
      let { signal: D } = q;
      ((A.dataset.trackId = H),
        (S.src =
          e.spotify.album_art_url && "null" !== e.spotify.album_art_url
            ? e.spotify.album_art_url
            : PLACEHOLDER_IMG),
        (T.textContent = e.spotify.song),
        (x.textContent = e.spotify.artist.replace(/; /g, ", ")),
        (C.textContent = e.spotify.album));
      let z = document.getElementById("spotify-code-container");
      if (
        (F && "null" !== F
          ? ((z.style.display = ""),
            (P.href = `https://open.spotify.com/track/${F}`),
            P.classList.remove("disabled"),
            z.dataset.scannableId !== F &&
              ((z.innerHTML = ""),
              fetch(
                `https://scannables.scdn.co/uri/plain/svg/000000/white/1024/spotify:track:${F}`,
                { signal: D },
              )
                .then((e) => {
                  if (!e.ok) throw Error("Failed to fetch");
                  return e.text();
                })
                .then((e) => {
                  let t = e
                    .replace(/<rect[^>]+fill="#000000"[^>]*>/i, "")
                    .replace(/#ffffff/gi, "#8B949E");
                  ((z.innerHTML = t), (z.dataset.scannableId = F));
                })
                .catch((e) => {
                  "AbortError" !== e.name && (z.style.display = "none");
                })))
          : ((z.style.display = "none"),
            (z.innerHTML = ""),
            delete z.dataset.scannableId,
            P.removeAttribute("href"),
            P.classList.add("disabled")),
        M.classList.remove("disabled"),
        triggerUpdateAnimation(document.querySelector(".spotify-container")),
        lyricsActive)
      ) {
        if (currentTrackIdForLyrics !== H) {
          ((currentTrackIdForLyrics = H), (currentLyrics = []));
          let R = (e.spotify.timestamps.end - e.spotify.timestamps.start) / 1e3;
          fetchLyrics(e.spotify.song, e.spotify.artist, e.spotify.album, R, H);
          let V =
            e.spotify.album_art_url && "null" !== e.spotify.album_art_url
              ? e.spotify.album_art_url
              : null;
          ((document.getElementById("lyrics-backdrop").style.backgroundImage =
            `url(${V})`),
            (document.getElementById("lyrics-song-title").textContent =
              e.spotify.song),
            (document.getElementById("lyrics-song-artist").textContent =
              e.spotify.artist.replace(/; /g, ", ")),
            triggerUpdateAnimation(document.getElementById("lyrics-backdrop")),
            triggerUpdateAnimation(
              document.getElementById("lyrics-song-title"),
            ),
            triggerUpdateAnimation(
              document.getElementById("lyrics-song-artist"),
            ),
            triggerUpdateAnimation(document.getElementById("lyrics-content")));
        } else {
          let O = document.getElementById("lyrics-content"),
            j = O.innerHTML.includes("Playback ended");
          j &&
            currentLyrics.length > 0 &&
            (renderLyrics(),
            void 0 === currentLyrics[0].time
              ? (O.classList.add("unsynced"),
                (document.getElementById("unsynced-label").style.display =
                  "block"))
              : (O.classList.remove("unsynced"),
                (document.getElementById("unsynced-label").style.display =
                  "none")));
        }
      }
    }
    (A.classList.remove("inactive"),
      (spotifyData = e.spotify),
      progressRafId && cancelAnimationFrame(progressRafId),
      document.hidden
        ? (updateProgress(), (progressRafId = null))
        : (updateProgress(),
          (progressRafId = requestAnimationFrame(progressLoop))));
  } else {
    if (!A.classList.contains("inactive")) {
      let G = controllerRegistry.get("lyrics-fetch");
      (G && G.abort(),
        (A.dataset.trackId = "none"),
        (S.src = PLACEHOLDER_IMG),
        (T.textContent = "Not Listening"),
        (x.textContent = "No song currently playing."),
        (C.textContent = ""),
        document.getElementById("spotify-code-container"),
        triggerUpdateAnimation(document.querySelector(".spotify-container")),
        lyricsActive &&
          (document.getElementById("lyrics-content").innerHTML =
            '<div class="lyrics-status-message">Playback ended</div>'));
    }
    (A.classList.add("inactive"),
      (spotifyData = null),
      progressRafId &&
        (cancelAnimationFrame(progressRafId), (progressRafId = null)));
  }
  let U = e.activities.find((e) => 4 === e.type),
    Z = "",
    W = !1,
    Y = !1;
  if (U) {
    if (U) {
      if (U.emoji) {
        if (U.emoji.id) {
          let K = `https://cdn.discordapp.com/emojis/${U.emoji.id}.${U.emoji.animated ? "gif" : "png"}?size=96`;
          ((Z += `<img src="${K}" class="custom-status-emoji" draggable="false">`),
            (W = !0));
        } else
          U.emoji.name &&
            ((Z += `<span class="custom-status-text-emoji">${U.emoji.name}</span>`),
            (W = !0));
      }
      U.state && ((Z += `<span>${escapeHTML(U.state)}</span>`), (Y = !0));
    }
  } else
    ((Z = '<img src="assets/dance.webp" class="dance-gif" draggable="false">'),
      (Y = !0));
  d.innerHTML !== Z &&
    ((d.innerHTML = Z),
    (d.style.display = W || Y ? "block" : "none"),
    W && !Y ? d.classList.add("only-emoji") : d.classList.remove("only-emoji"),
    (W || Y) && triggerUpdateAnimation(d));
}
function resetLoaders() {
  ["profile-loader", "spotify-loader"].forEach((e) => {
    let t = document.getElementById(e);
    t &&
      (t.classList.remove("hidden", "error"),
      (t.querySelector("span").textContent = "Loading.."));
  });
}
function updateStatusDisconnected() {
  ((isOffline = !0),
    (document.getElementById("profile-banner").style.display = "none"),
    ["profile-loader", "spotify-loader"].forEach((e) => {
      let t = document.getElementById(e);
      t &&
        (t.classList.remove("hidden"),
        t.classList.add("error"),
        (t.querySelector("span").textContent = "You are offline"));
    }));
}
function formatTimeAgo(e) {
  let t = new Date(),
    n = new Date(e),
    i = Math.floor((t - n) / 6e4),
    r = Math.floor(i / 60);
  return i < 1
    ? "Just now"
    : i < 60
      ? `${i}m ago`
      : r < 24
        ? `${r}h ago`
        : `${Math.floor(r / 24)}d ago`;
}
function formatDuration(e) {
  if (isNaN(e) || e < 0) return "0:00";
  let t = Math.floor(e / 1e3);
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
}
function updatePlayIcons(e) {
  let t = document.getElementById("media-play-pause-btn"),
    n = t.querySelector(".play-icon"),
    i = t.querySelector(".pause-icon"),
    r = t.querySelector(".loading-icon"),
    a = r && "block" === r.style.display;
  if (
    (!1 === e &&
      currentAudio &&
      (currentAudio._wasLoadingBeforePause = a || !!window.audioLoadingTimeout),
    "load" === e)
  ) {
    ((n.style.display = "none"),
      currentPlayingButton &&
        (currentPlayingButton.classList.add("playing"),
        (currentPlayingButton.querySelector(".play-icon").style.display =
          "none"),
        (currentPlayingButton.querySelector(".pause-icon").style.display =
          "block")));
    let s = a || (currentAudio && currentAudio._wasLoadingBeforePause);
    s
      ? ((i.style.display = "none"),
        r && (r.style.display = "block"),
        window.audioLoadingTimeout &&
          (clearTimeout(window.audioLoadingTimeout),
          (window.audioLoadingTimeout = null)))
      : ((i.style.display = "block"),
        r && (r.style.display = "none"),
        window.audioLoadingTimeout ||
          (window.audioLoadingTimeout = setTimeout(() => {
            ((i.style.display = "none"),
              r && (r.style.display = "block"),
              (window.audioLoadingTimeout = null));
          }, 130)));
  } else
    (window.audioLoadingTimeout &&
      (clearTimeout(window.audioLoadingTimeout),
      (window.audioLoadingTimeout = null)),
      !0 === e || "pause" === e
        ? ((n.style.display = "none"),
          (i.style.display = "block"),
          r && (r.style.display = "none"),
          currentPlayingButton &&
            (currentPlayingButton.classList.add("playing"),
            (currentPlayingButton.querySelector(".play-icon").style.display =
              "none"),
            (currentPlayingButton.querySelector(".pause-icon").style.display =
              "block")),
          currentAudio && (currentAudio._wasLoadingBeforePause = !1))
        : ((n.style.display = "block"),
          (i.style.display = "none"),
          r && (r.style.display = "none"),
          currentPlayingButton &&
            (currentPlayingButton.classList.remove("playing"),
            (currentPlayingButton.querySelector(".play-icon").style.display =
              "block"),
            (currentPlayingButton.querySelector(".pause-icon").style.display =
              "none"))));
}
function closeMediaPlayer() {
  let e = document.getElementById("media-player");
  (e && e.classList.remove("visible"),
    currentAudio &&
      (currentAudio.pause(),
      currentAudio.removeAttribute("src"),
      currentAudio.load()),
    (isVisualizerPlaying = !1),
    animationFrameId &&
      (cancelAnimationFrame(animationFrameId), (animationFrameId = null)));
  let t = document.getElementById("visualizer-canvas");
  if (t) {
    let n = t.getContext("2d");
    n.clearRect(0, 0, t.width, t.height);
  }
  (audioContext && "closed" !== audioContext.state && audioContext.suspend(),
    updatePlayIcons(!1),
    (currentPlayingButton = null),
    clearMediaSession());
}
function stopCurrentAudio() {
  (currentAudio && (currentAudio.pause(), updatePlayIcons(!1)),
    currentPlayingButton &&
      (currentPlayingButton.classList.remove("playing"),
      (currentPlayingButton.querySelector(".play-icon").style.display =
        "block"),
      (currentPlayingButton.querySelector(".pause-icon").style.display =
        "none")));
}
function toggleMediaPlayerState() {
  currentAudio &&
    (currentAudio.paused
      ? (audioContext &&
          "suspended" === audioContext.state &&
          audioContext.resume(),
        currentAudio.play().catch(() => {}))
      : currentAudio.pause());
}
function updateVolumeIcon() {
  let e = document.querySelector(".volume-icon-high"),
    t = document.querySelector(".volume-icon-low"),
    n = document.querySelector(".volume-icon-muted"),
    i = parseInt(document.getElementById("volume-slider").value) / 100;
  ((e.style.display = "none"),
    (t.style.display = "none"),
    (n.style.display = "none"),
    0 === i
      ? (n.style.display = "block")
      : i < 0.5
        ? (t.style.display = "block")
        : (e.style.display = "block"));
}
function updateMediaSession(e, t) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: e.name,
      artist: e.artists.map((e) => e.name).join(", "),
      album: e.albums[0]?.name || "",
      artwork: [{ src: t, sizes: "512x512", type: "image/png" }],
    });
    let n = [
      ["play", () => toggleMediaPlayerState()],
      ["pause", () => toggleMediaPlayerState()],
      ["stop", () => closeMediaPlayer()],
      ["previoustrack", () => handleSkip("prev")],
      ["nexttrack", () => handleSkip("next")],
      [
        "seekto",
        (e) => {
          currentAudio && (currentAudio.currentTime = e.seekTime);
        },
      ],
    ];
    for (let [i, r] of n)
      try {
        navigator.mediaSession.setActionHandler(i, r);
      } catch (a) {}
  }
}
function clearMediaSession() {
  if ("mediaSession" in navigator)
    for (let e of ((navigator.mediaSession.playbackState = "none"),
    (navigator.mediaSession.metadata = null),
    [
      "play",
      "pause",
      "stop",
      "seekto",
      "previoustrack",
      "nexttrack",
      "seekbackward",
      "seekforward",
    ]))
      try {
        navigator.mediaSession.setActionHandler(e, null);
      } catch (t) {}
}
function togglePlay(e, t) {
  let n = t.spotifyPreview || t.appleMusicPreview;
  if (!n) return;
  if (e === currentPlayingButton) {
    toggleMediaPlayerState();
    return;
  }
  if (
    (currentAudio && (currentAudio.pause(), (isVisualizerPlaying = !1)),
    currentPlayingButton)
  ) {
    currentPlayingButton.classList.remove("playing");
    let i = currentPlayingButton.querySelector(".play-icon"),
      r = currentPlayingButton.querySelector(".pause-icon");
    (i && (i.style.display = "block"), r && (r.style.display = "none"));
  }
  let a = document.getElementById("media-player"),
    s = document.getElementById("media-album-art"),
    l = t.albums[0]?.image || PLACEHOLDER_IMG;
  (s.src !== l && (s.src = l),
    (document.getElementById("media-song-title").textContent = t.name),
    (document.getElementById("media-song-artist").textContent = t.artists
      .map((e) => e.name)
      .join(", ")));
  let o = document.getElementById("seek-slider"),
    c = document.getElementById("media-current-time"),
    d = document.getElementById("media-total-time");
  (currentAudio ||
    (((currentAudio = new Audio()).crossOrigin = "anonymous"),
    (currentAudio.onerror = (e) => {
      e.target === currentAudio &&
        (updatePlayIcons(!1),
        (isVisualizerPlaying = !1),
        "mediaSession" in navigator &&
          (navigator.mediaSession.playbackState = "none"));
    }),
    (currentAudio.onwaiting = (e) => {
      e.target === currentAudio && updatePlayIcons("load");
    }),
    (currentAudio.onplaying = (e) => {
      e.target === currentAudio && updatePlayIcons(!0);
    }),
    (currentAudio.onloadedmetadata = (e) => {
      e.target === currentAudio &&
        ((o.max = currentAudio.duration),
        (d.textContent = formatTime(currentAudio.duration)));
    }),
    (currentAudio.ontimeupdate = (e) => {
      e.target === currentAudio &&
        ((o.value = currentAudio.currentTime),
        (c.textContent = formatTime(currentAudio.currentTime)));
    }),
    (currentAudio.onplay = (e) => {
      if (e.target === currentAudio) {
        if (
          (currentAudio.readyState < 3
            ? updatePlayIcons("load")
            : updatePlayIcons(!0),
          "mediaSession" in navigator &&
            ((navigator.mediaSession.playbackState = "playing"),
            isFinite(currentAudio.duration) && currentAudio.duration > 0))
        )
          try {
            navigator.mediaSession.setPositionState({
              duration: currentAudio.duration,
              playbackRate: currentAudio.playbackRate,
              position: currentAudio.currentTime,
            });
          } catch (t) {}
        (audioContext &&
          "suspended" === audioContext.state &&
          audioContext.resume(),
          (isVisualizerPlaying = !0),
          animationFrameId || drawVisualizer());
      }
    }),
    (currentAudio.onpause = (e) => {
      if (e.target === currentAudio) {
        if (
          (updatePlayIcons(!1),
          "mediaSession" in navigator &&
            ((navigator.mediaSession.playbackState = "paused"),
            isFinite(currentAudio.duration) && currentAudio.duration > 0))
        )
          try {
            navigator.mediaSession.setPositionState({
              duration: currentAudio.duration,
              playbackRate: currentAudio.playbackRate,
              position: currentAudio.currentTime,
            });
          } catch (t) {}
        isVisualizerPlaying = !1;
      }
    }),
    (currentAudio.onended = closeMediaPlayer)),
    (currentAudio.src = n),
    (currentAudio.volume = lastVolume * lastVolume),
    updateMediaSession(t, l),
    setupAudioVisualizer(),
    (document.getElementById("volume-slider").value = 100 * lastVolume),
    (document.getElementById("volume-percentage").textContent =
      `${Math.round(100 * lastVolume)}%`),
    updateVolumeIcon(),
    (currentPlayingButton = e),
    (o.oninput = () => {
      if (
        currentAudio &&
        ((currentAudio.currentTime = o.value),
        "mediaSession" in navigator &&
          isFinite(currentAudio.duration) &&
          currentAudio.duration > 0)
      )
        try {
          navigator.mediaSession.setPositionState({
            duration: currentAudio.duration,
            playbackRate: currentAudio.playbackRate,
            position: currentAudio.currentTime,
          });
        } catch (e) {}
    }),
    currentAudio.readyState < 3 && updatePlayIcons("load"),
    currentAudio.play().catch(() => {}),
    resizeCanvas(),
    a.classList.add("visible"));
}
function handleSkip(e) {
  if (!currentPlayingButton) return;
  let t =
      "recent" === currentSongTab
        ? "recent-songs-container"
        : "top-songs-container",
    n = document.getElementById(t),
    i = Array.from(n.querySelectorAll(".song-item")).filter(
      (e) => "none" !== window.getComputedStyle(e).display,
    ),
    r = currentPlayingButton.closest(".song-item"),
    a = i.indexOf(r);
  if (-1 !== a)
    for (let s = 0; s < i.length; s++) {
      "next" === e ? ++a >= i.length && (a = 0) : --a < 0 && (a = i.length - 1);
      let l = i[a],
        o = l.querySelector(".play-button");
      if (o) {
        o.click();
        return;
      }
    }
}
function addPlayButtonListeners(e) {
  document.querySelectorAll(".play-button").forEach((t) => {
    let n = t.dataset.previewUrl;
    if (!n) return;
    let i = e.find(
      (e) => e.track.spotifyPreview === n || e.track.appleMusicPreview === n,
    );
    i && t.addEventListener("click", () => togglePlay(t, i.track));
  });
}
function updateTimestamps() {
  if ("recent" !== currentSongTab) return;
  let e = document.querySelectorAll(
    "#recent-songs-container .song-timestamp[data-timestamp]",
  );
  for (let t = 0; t < e.length; t++) {
    let n = e[t],
      i = n.dataset.timestamp,
      r = formatTimeAgo(i);
    n.textContent !== r && (n.textContent = r);
  }
}
function renderSongList(e, t, n) {
  let i = document.getElementById(n),
    r = currentAudio && !currentAudio.paused,
    a = currentAudio ? currentAudio.src : null;
  if (((i.innerHTML = ""), e && e.length > 0)) {
    let s = document.createDocumentFragment();
    if (
      (e.forEach((e) => {
        let n = e.track,
          i = n.albums[0]?.image || PLACEHOLDER_IMG,
          r = n.name,
          a = n.artists.map((e) => e.name).join(", "),
          l = n.spotifyPreview || n.appleMusicPreview,
          o = formatDuration(n.durationMs),
          c = n.externalIds?.spotify?.[0],
          d = n.externalIds?.appleMusic?.[0],
          u = "";
        if ("recent" === t) {
          let y = formatTimeAgo(e.endTime);
          u = `<div class="song-timestamp" data-timestamp="${e.endTime}">${y}</div>`;
        } else
          u = `<div class="song-timestamp">${e.streams.toLocaleString()} streams</div>`;
        let m = document.createElement("div");
        ((m.className = "song-item"),
          (m.innerHTML = ` <div class="song-links"> ${c ? `<a href="https://open.spotify.com/track/${c}" target="_blank" rel="noopener noreferrer"><img src="assets/icons/spotify.png" draggable="false"></a>` : ""} ${d ? `<a href="https://music.apple.com/song/${d}" target="_blank" rel="noopener noreferrer"><img src="assets/icons/applemusic.png" draggable="false"></a>` : ""} </div><div class="song-album-art-wrapper"><img src="${PLACEHOLDER_IMG}" data-src="${i}" width="56" height="56" class="song-album-art lazy-image" draggable="false"> ${l ? `<button class="play-button" data-preview-url="${l}"><svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg><svg class="pause-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/></svg></button>` : ""} </div><div class="song-details"><div class="song-title">${escapeHTML(r)}</div><div class="song-artist-container"> ${n.explicit ? '<span class="explicit-tag">E</span>' : ""} <span class="song-artist-name">${escapeHTML(a)}</span></div></div><div class="song-meta"><span>${o}</span>${u}</div> `),
          s.appendChild(m));
      }),
      i.appendChild(s),
      addPlayButtonListeners(e),
      imageObserver ||
        (imageObserver = new IntersectionObserver(
          (e, t) => {
            e.forEach((e) => {
              if (e.isIntersecting) {
                let n = e.target;
                ((n.src = n.dataset.src),
                  n.classList.remove("lazy-image"),
                  t.unobserve(n));
              }
            });
          },
          { root: null, rootMargin: "100px" },
        )),
      i
        .querySelectorAll(".lazy-image")
        .forEach((e) => imageObserver.observe(e)),
      r)
    ) {
      let l = document.querySelector(`.play-button[data-preview-url="${a}"]`);
      l &&
        ((currentPlayingButton = l),
        currentAudio && currentAudio.readyState < 3
          ? updatePlayIcons("load")
          : updatePlayIcons(!0));
    }
  } else i.innerHTML = '<div class="empty-state">No songs found</div>';
}
async function loadRecentSongs() {
  let e = document.getElementById("recent-songs-container"),
    t = document.getElementById("songs-loader");
  (timestampsInterval &&
    (clearInterval(timestampsInterval), (timestampsInterval = null)),
    (t.querySelector("span").textContent = "Loading.."),
    t.classList.remove("hidden", "error"),
    (e.style.opacity = 0));
  try {
    let n = await fetch(
      `https://api.stats.fm/api/v1/users/${CONFIG.statsFmId}/streams/recent?_=${Date.now()}`,
    );
    if (!n.ok) throw Error("Failed to fetch");
    let i = await n.json(),
      r = i.items ? i.items.slice(0, 40) : [];
    setTimeout(() => {
      (renderSongList(r, "recent", "recent-songs-container"),
        (e.dataset.loaded = "true"),
        (timestampsInterval = setInterval(updateTimestamps, 3e4)),
        (e.style.opacity = 1));
    }, 300);
  } catch (a) {
    setTimeout(() => {
      ((e.innerHTML =
        '<div class="empty-state" style="color:#f87171;">Failed to load</div>'),
        (e.style.opacity = 1));
    }, 300);
  } finally {
    setTimeout(() => t.classList.add("hidden"), 300);
  }
}
async function loadTopTracks() {
  let e = document.getElementById("top-songs-container"),
    t = document.getElementById("songs-loader");
  ((t.querySelector("span").textContent = "Loading.."),
    t.classList.remove("hidden", "error"),
    (e.style.opacity = 0));
  try {
    let n = await fetch(
      `https://api.stats.fm/api/v1/users/${CONFIG.statsFmId}/top/tracks?range=lifetime`,
    );
    if (!n.ok) throw Error("Failed to fetch");
    let i = await n.json(),
      r = i.items ? i.items : [];
    (r.sort((e, t) => t.streams - e.streams),
      (r = r.slice(0, 40)),
      setTimeout(() => {
        (renderSongList(r, "top", "top-songs-container"),
          (e.dataset.loaded = "true"),
          (e.style.opacity = 1));
      }, 300));
  } catch (a) {
    setTimeout(() => {
      ((e.innerHTML =
        '<div class="empty-state" style="color:#f87171;">Failed to load</div>'),
        (e.style.opacity = 1));
    }, 300);
  } finally {
    setTimeout(() => t.classList.add("hidden"), 300);
  }
}
function switchSongTab(e) {
  if (currentSongTab === e) return;
  currentSongTab = e;
  let t = document.getElementById("songs-loader"),
    n = document.getElementById("songs-list-wrapper");
  t &&
    n &&
    t.parentNode !== n &&
    (n.appendChild(t), (t.style.borderRadius = "8px"));
  let i = document.getElementById("stream-type-toggle");
  i.textContent = "recent" === e ? "Recent" : "Top";
  let r = document.getElementById("refresh-songs-btn"),
    a = document.getElementById("song-search-input"),
    s = document.getElementById("clear-search-btn");
  a.value && ((a.value = ""), s.classList.remove("visible"), filterSongs(""));
  let l = document.getElementById("recent-songs-container"),
    o = document.getElementById("top-songs-container");
  "recent" === e
    ? ((r.disabled = refreshCooldown),
      (o.style.display = "none"),
      (o.style.opacity = 0),
      (l.style.display = "block"),
      setTimeout(() => (l.style.opacity = 1), 10),
      "true" !== l.dataset.loaded
        ? loadRecentSongs()
        : timestampsInterval ||
          (timestampsInterval = setInterval(updateTimestamps, 3e4)))
    : ((r.disabled = !0),
      timestampsInterval &&
        (clearInterval(timestampsInterval), (timestampsInterval = null)),
      (l.style.display = "none"),
      (l.style.opacity = 0),
      (o.style.display = "block"),
      setTimeout(() => (o.style.opacity = 1), 10),
      "true" !== o.dataset.loaded && loadTopTracks());
}
function setupAudioVisualizer() {
  if (currentAudio) {
    if (!audioContext) {
      (analyser = (audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )()).createAnalyser()).fftSize = 256;
      let e = analyser.frequencyBinCount;
      ((dataArray = new Uint8Array(e)),
        (gainNode = audioContext.createGain()),
        analyser.connect(gainNode),
        gainNode.connect(audioContext.destination),
        (audioContext.onstatechange = () => {
          "suspended" === audioContext.state &&
          currentAudio &&
          !currentAudio.paused
            ? (updatePlayIcons(!1), (isVisualizerPlaying = !1))
            : "running" !== audioContext.state ||
              currentAudio.paused ||
              (currentAudio.readyState < 3
                ? updatePlayIcons("load")
                : updatePlayIcons(!0),
              (isVisualizerPlaying = !0),
              animationFrameId || drawVisualizer());
        }));
    }
    try {
      sourceNode ||
        (sourceNode =
          audioContext.createMediaElementSource(currentAudio)).connect(
          analyser,
        );
      let t = parseInt(document.getElementById("volume-slider").value) / 100;
      ((gainNode.gain.value = t * t), (currentAudio.volume = 1));
    } catch (n) {
      let i = parseInt(document.getElementById("volume-slider").value) / 100;
      currentAudio.volume = i * i;
    }
    isVisualizerInitialized = !0;
  }
}
function stopAndClearVisualizer() {
  animationFrameId &&
    (cancelAnimationFrame(animationFrameId), (animationFrameId = null));
  let e = document.getElementById("visualizer-canvas");
  if (e) {
    let t = e.getContext("2d");
    t.clearRect(0, 0, e.width, e.height);
  }
}
function drawVisualizer() {
  if (document.hidden) return;
  let e = document.getElementById("visualizer-canvas");
  if (!e || !analyser || !dataArray) return;
  let t = e.getContext("2d"),
    n = analyser.frequencyBinCount;
  (isVisualizerPlaying &&
    currentAudio &&
    !currentAudio.paused &&
    analyser.getByteFrequencyData(dataArray),
    t.clearRect(0, 0, e.width, e.height));
  let i = (e.width / n) * 1.5,
    r = 0,
    a = !0,
    s = t.createLinearGradient(0, 0, 0, e.height);
  (s.addColorStop(0, "rgba(201, 209, 217, 0.5)"),
    s.addColorStop(1, "rgba(201, 209, 217, 0.1)"),
    (t.fillStyle = s),
    currentBarHeights.length !== n && (currentBarHeights = Array(n).fill(0)));
  for (let l = 0; l < n; l++) {
    let o = dataArray[l] / 255,
      c = isVisualizerPlaying ? Math.pow(o, 3) * e.height : 0,
      d = currentBarHeights[l],
      u = d + (c - d) * 0.1;
    (t.fillRect(r, e.height - u, i, u),
      (currentBarHeights[l] = u),
      (r += i + 1),
      u > 0.1 && (a = !1));
  }
  !a || isVisualizerPlaying
    ? (animationFrameId = requestAnimationFrame(drawVisualizer))
    : stopAndClearVisualizer();
}
function resizeCanvas() {
  let e = document.getElementById("visualizer-canvas"),
    t = document.getElementById("media-player");
  if (e && t) {
    let n = window.devicePixelRatio || 1,
      i = Math.floor(t.clientWidth * n),
      r = Math.floor(t.clientHeight * n);
    (e.width !== i || e.height !== r) && ((e.width = i), (e.height = r));
  }
}
function applyDisplayNameScroll() {
  let e = document.getElementById("display-name"),
    t = e.querySelector(".display-name-inner");
  e &&
    t &&
    (e.classList.remove("scrolling"),
    t.style.removeProperty("--scroll-distance"),
    (t.style.transform = "translateX(0)"),
    requestAnimationFrame(() => {
      let n = e.clientWidth,
        i = t.scrollWidth;
      i > n &&
        (t.style.setProperty("--scroll-distance", `${n - i}px`),
        e.classList.add("scrolling"));
    }));
}
function animateCypherText(e, t) {
  let n = document.getElementById("cypher-text");
  if (!n) return;
  let i =
      "\xa1™\xa3\xa2∞\xa7\xb6•\xaa\xba–≠œ∑\xb4\xae†\xa5\xa8ˆ\xf8π“‘\xab\xe5\xdf∂ƒ\xa9˙∆˚\xac…\xe6≈\xe7√∫˜\xb5≤≥\xf7/?`~",
    r = 0;
  function a(s) {
    requestAnimationFrame(a);
    let l = s - r;
    if (l > t) {
      r = s - (l % t);
      let o = "";
      for (let c = 0; c < e; c++)
        o += i.charAt(Math.floor(Math.random() * i.length));
      n.textContent = o;
    }
  }
  requestAnimationFrame(a);
}
(!(function () {
  let t = "made by mehro with lots of <3";
  console.load = function (e, t = 100, n = null) {
    return new Promise((i) => {
      fetch(e)
        .then((e) => e.blob())
        .then((e) => {
          if (
            0 !== e.type.indexOf("image") ||
            (e.size > 8192 &&
              (!window.chrome || navigator.userAgent.indexOf("Firefox") > 0))
          )
            return i(!1);
          let r = new FileReader();
          ((r.onloadend = () => {
            let e = r.result,
              a = new Image();
            ((a.onload = function () {
              let r = t || a.naturalHeight,
                s = n || (r * a.naturalWidth) / a.naturalHeight,
                l = `display: inline-block; font-size: 0px; line-height: 0px; color: transparent; padding: ${r / 2}px ${s / 2}px; background: url(${e}) no-repeat; background-size: contain;`;
              (console.log("%c ", l), i(!0));
            }),
              (a.onerror = () => i(!1)),
              (a.src = e));
          }),
            r.readAsDataURL(e));
        })
        .catch(() => {
          i(!1);
        });
    });
  };
  let n = () => {
      if (n.running) return;
      n.running = !0;
      let i = (i) => {
        let l = "",
          o = [];
        for (let c = 0; c < t.length; c++)
          if (((l += "%c" + t[c]), c >= 8 && c <= 12)) {
            let d = 255 - (c - 8) * 20;
            o.push(
              `color:rgb(${d},${d},${d});font-family:monospace;font-weight:bold;`,
            );
          } else if (c >= 27) {
            let u = 255 - (c - 27) * 50,
              y = 71 - (c - 27) * 40,
              m = 87 - (c - 27) * 50;
            o.push(
              `color:rgb(${u},${y},${m});font-family:monospace;font-weight:bold;`,
            );
          } else
            o.push("color:#8a8a8a;font-family:monospace;font-weight:bold;");
        for (let g of (console.log(l, ...o),
        ["build v1.8.13 @ March 28, 2026"])) {
          let p = "",
            $ = [];
          for (let f = 0; f < g.length; f++) {
            p += "%c" + g[f];
            let _ = 140 + f * (80 / g.length);
            $.push(
              `color:rgb(${_},${_},${_}); font-family:monospace; font-size: 10px; font-weight:bold;`,
            );
          }
          console.log(p, ...$);
        }
        n.running = !1;
      };
      console.load("assets/console.png", 250, 500).then(i);
    },
    i = console.clear,
    r = function () {
      (i && i.apply(console, arguments), n());
    };
  ((console.clear = r),
    (window.clear = r),
    (console.cls = r),
    (window.cls = r));
  try {
    Object.defineProperty(window, "banner", {
      get: function () {
        r();
      },
    });
  } catch (a) {}
  n();
})(),
  checkHardwareAcceleration() ||
    setTimeout(() => {
      let e = document.getElementById("hw-warning-popup");
      e && e.classList.add("visible");
    }, 1250),
  document
    .getElementById("stream-type-toggle")
    .addEventListener("click", () => {
      if (switchCooldown) return;
      let e = "recent" === currentSongTab ? "top" : "recent";
      (switchSongTab(e),
        (switchCooldown = !0),
        setTimeout(() => {
          switchCooldown = !1;
        }, 400));
    }));
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Casablanca",
  hour: "2-digit",
  minute: "2-digit",
  hour12: !1,
});
function updateLocalTime() {
  let e = new Date(),
    t = document.getElementById("time-text");
  t && (t.textContent = timeFormatter.format(e));
  let n = document.getElementById("time-diff-display");
  if (n) {
    let i = e.toLocaleString("en-US", { timeZone: "Africa/Casablanca" }),
      r = e.toLocaleString("en-US"),
      a = new Date(i),
      s = new Date(r),
      l = Math.round((a.getTime() - s.getTime()) / 6e4);
    if (0 === l) n.textContent = "Same time as you";
    else {
      let o = Math.abs(l),
        c = Math.floor(o / 60),
        d = o % 60,
        u = d > 0 ? `:${d.toString().padStart(2, "0")}` : "";
      l > 0
        ? (n.textContent = `${c}${u}h ahead of you`)
        : (n.textContent = `${c}${u}h behind you`);
    }
  }
}
function startClock() {
  updateLocalTime();
  let e = new Date(),
    t = (60 - e.getSeconds()) * 1e3 - e.getMilliseconds();
  setTimeout(() => {
    (updateLocalTime(), setInterval(updateLocalTime, 6e4));
  }, t);
}
function loadViewCounter() {
  let e = document.getElementById("view-counter"),
    t = document.getElementById("mobile-view-text");
  let n = () =>
    null !== counterAssetsAvailable
      ? Promise.resolve(counterAssetsAvailable)
      : new Promise((e) => {
          let t = new Image();
          ((t.onload = () => {
            ((counterAssetsAvailable = !0), e(!0));
          }),
            (t.onerror = () => {
              ((counterAssetsAvailable = !1), e(!1));
            }),
            (t.src = "assets/counter/0.gif"));
        });
  fetch(`${CONFIG.apiBase}/api/views`, { method: "POST" })
    .then((e) => e.json())
    .then((i) => {
      let r = Number(i.count || 0),
        a = r.toString();
      if ((t && (t.textContent = Number(a).toLocaleString()), !e)) return;
      n().then((t) => {
        if (t) {
          let n = "";
          for (let i = 0; i < a.length; i++) {
            let r = a[i];
            n += `<img src="assets/counter/${r}.gif" class="digit-image" width="27" height="60" draggable="false">`;
          }
          e.innerHTML = n;
        } else
          e.innerHTML = `<span style="color:#dce3de;font-family:monospace;font-size:28px;font-variant-numeric:tabular-nums;">${Number(a).toLocaleString()}</span>`;
      });
    })
    .catch(() => {
      (t && (t.textContent = "error"),
        e &&
          (e.innerHTML =
            '<span style="color:#f87171;font-size:16px;">error</span>'));
    });
}
function applyNowPlayingFromApi(e) {
  let t = document.getElementById("spotify-card"),
    n = document.getElementById("album-art"),
    i = document.getElementById("song-name"),
    r = document.getElementById("artist-name"),
    a = document.getElementById("album-name"),
    s = document.getElementById("open-spotify-btn"),
    l = document.getElementById("lyrics-btn"),
    o = document.getElementById("spotify-code-container");
  if (!e?.isListening || !e.nowPlaying) {
    (t.classList.add("inactive"),
      (spotifyData = null),
      (t.dataset.trackId = "none"),
      (n.src = PLACEHOLDER_IMG),
      (i.textContent = "Not Listening"),
      (r.textContent = "No song currently playing."),
      (a.textContent = ""),
      (o.style.display = "none"),
      o.removeAttribute("data-scannable-id"),
      (o.innerHTML = ""),
      s.removeAttribute("href"),
      s.classList.add("disabled"),
      l.classList.add("disabled"),
      progressRafId &&
        (cancelAnimationFrame(progressRafId), (progressRafId = null)));
    return;
  }
  let c = e.nowPlaying,
    d = c.trackId && "null" !== c.trackId,
    u = d ? c.trackId : `local:${c.song || "unknown"}-${c.artist || "unknown"}`,
    y = Date.parse(c.startedAt || ""),
    m = Date.parse(c.endsAt || "");
  ((spotifyData = {
    song: c.song || "Unknown",
    artist: c.artist || "Unknown",
    album: c.album || "",
    track_id: d ? c.trackId : null,
    album_art_url: c.albumArtUrl || null,
    timestamps: {
      start: Number.isNaN(y) ? Date.now() : y,
      end: Number.isNaN(m) ? Date.now() : m,
    },
  }),
    (t.dataset.trackId = u),
    t.classList.remove("inactive"),
    (n.src = c.albumArtUrl || PLACEHOLDER_IMG),
    (i.textContent = c.song || "Unknown"),
    (r.textContent = (c.artist || "Unknown").replace(/; /g, ", ")),
    (a.textContent = c.album || ""),
    d
      ? ((s.href = `https://open.spotify.com/track/${c.trackId}`),
        s.classList.remove("disabled"),
        l.classList.remove("disabled"))
      : (s.classList.add("disabled"), l.classList.add("disabled")),
    (o.style.display = "none"),
    (o.innerHTML = ""),
    document.hidden
      ? (updateProgress(), (progressRafId = null))
      : (updateProgress(),
        progressRafId ||
          (progressRafId = requestAnimationFrame(progressLoop))),
    document.getElementById("spotify-loader")?.classList.add("hidden"));
}
function pollNowPlaying() {
  let e = controllerRegistry.get("now-playing-fetch");
  e && e.abort();
  let t = new AbortController();
  controllerRegistry.set("now-playing-fetch", t);
  let { signal: n } = t;
  fetch(`${CONFIG.apiBase}/api/now-playing`, { signal: n })
    .then((e) => {
      if (!e.ok) throw Error("Failed to fetch now playing");
      return e.json();
    })
    .then((e) => {
      e?.ok && applyNowPlayingFromApi(e.data);
    })
    .catch(() => {});
}
function startNowPlayingPolling() {
  (pollNowPlaying(),
    nowPlayingInterval && clearInterval(nowPlayingInterval),
    (nowPlayingInterval = setInterval(pollNowPlaying, 7e3)));
}
function pollPresence() {
  let e = controllerRegistry.get("presence-fetch");
  e && e.abort();
  let t = new AbortController();
  controllerRegistry.set("presence-fetch", t);
  let { signal: n } = t;
  fetch(`${CONFIG.apiBase}/api/presence`, { signal: n })
    .then((e) => {
      if (!e.ok) throw Error("Failed to fetch presence");
      return e.json();
    })
    .then((e) => {
      e?.ok &&
        e.data &&
        (document.getElementById("profile-loader")?.classList.add("hidden"),
        document.getElementById("spotify-loader")?.classList.add("hidden"),
        updateStatus(e.data));
    })
    .catch(() => {
      updateStatusDisconnected();
    });
}
function startPresencePolling() {
  (pollPresence(),
    presenceInterval && clearInterval(presenceInterval),
    (presenceInterval = setInterval(pollPresence, 7e3)));
}
function toggleLyricsFullscreen(e = null) {
  let t = document.querySelector(".lyrics-window"),
    n = document.getElementById("lyrics-content"),
    i = document.getElementById("fullscreen-lyrics-btn"),
    r = i.querySelector(".maximize-icon"),
    a = i.querySelector(".minimize-icon"),
    s = n.classList.contains("unsynced"),
    l = null !== e ? e : !isLyricsFullscreen;
  if (
    l === isLyricsFullscreen ||
    ((isLyricsFullscreen = l),
    t.classList.toggle("fullscreen", l),
    (r.style.display = l ? "none" : "block"),
    (a.style.display = l ? "block" : "none"),
    s)
  )
    return;
  let o = n.querySelector(".lyric-line.active");
  if (!o) return;
  let c = null;
  function d(e) {
    c || (c = e);
    let t = e - c,
      i = n.clientHeight,
      r = o.clientHeight,
      a = o.offsetTop - 0.43 * i + r / 2;
    (n.scrollTo({ top: a, behavior: "auto" }),
      t < 400 && requestAnimationFrame(d));
  }
  requestAnimationFrame(d);
}
function updateAge() {
  let e = document.getElementById("static-age"),
    t = document.getElementById("animated-age"),
    n = new Date(2005, 5, 24);
  if (e && t) {
    let i = new Date(),
      r = i.getFullYear() - n.getFullYear(),
      a = i.getMonth() - n.getMonth(),
      s = i.getDate() - n.getDate();
    (a < 0 || (0 === a && s < 0)) && r--;
    let l = new Date(n);
    (l.setFullYear(i.getFullYear()),
      i < l && l.setFullYear(i.getFullYear() - 1));
    let o = new Date(l);
    o.setFullYear(l.getFullYear() + 1);
    let c = r + (i - l) / (o - l);
    ((t.textContent = c.toFixed(10)),
      e.textContent != r && (e.textContent = r));
  }
  requestAnimationFrame(updateAge);
}
function initTooltips() {
  let e = document.getElementById("global-tooltip-container");
  e ||
    (((e = document.createElement("div")).id = "global-tooltip-container"),
    document.body.appendChild(e));
  let t = null,
    n = null,
    i = 0,
    r = null,
    a = null,
    s = () => {
      if (!n || !e.classList.contains("visible")) {
        r = null;
        return;
      }
      let t = n.getBoundingClientRect(),
        i = e.getBoundingClientRect(),
        a = t.left + t.width / 2 - i.width / 2;
      (a < 10 && (a = 10),
        a + i.width > window.innerWidth - 10 &&
          (a = window.innerWidth - i.width - 10));
      let l = t.top - i.height;
      l < 10
        ? ((l = t.bottom + 8), e.classList.add("flipped"))
        : e.classList.remove("flipped");
      let o = t.left + t.width / 2,
        c = o - a;
      (e.classList.remove("edge-left", "edge-right"),
        c <= 10
          ? (e.classList.add("edge-left"), (c = Math.max(6, c)))
          : c >= i.width - 10 &&
            (e.classList.add("edge-right"), (c = Math.min(i.width - 8, c))),
        e.style.setProperty("--arrow-x", `${c}px`),
        (e.style.left = `${a}px`),
        (e.style.top = `${l}px`),
        (r = requestAnimationFrame(s)));
    },
    l = (i) => {
      if (n === i && e.classList.contains("visible")) return;
      let l = i.querySelector(".tooltip-box");
      l &&
        (a && (clearTimeout(a), (a = null)),
        e.classList.contains("visible") &&
          (e.classList.remove("visible"),
          (e.style.transition = "none"),
          (e.style.opacity = "0"),
          (e.style.transform = "translateY(0)"),
          e.offsetWidth,
          (e.style.transition = ""),
          (e.style.opacity = ""),
          (e.style.transform = "")),
        (n = i),
        (e.innerHTML = l.innerHTML),
        t && t.disconnect(),
        (t = new MutationObserver(() => {
          e.innerHTML = l.innerHTML;
        })).observe(l, { childList: !0, characterData: !0, subtree: !0 }),
        e.classList.add("visible"),
        r && cancelAnimationFrame(r),
        s());
    },
    o = () => {
      (e.classList.remove("visible"),
        (n = null),
        a && clearTimeout(a),
        (a = setTimeout(() => {
          t && (t.disconnect(), (t = null));
        }, 200)),
        r && (cancelAnimationFrame(r), (r = null)));
    };
  (document.body.addEventListener("mouseover", (e) => {
    if (Date.now() - i < 500) return;
    let t = e.target.closest(".tooltip-trigger");
    t && l(t);
  }),
    document.body.addEventListener("mouseout", (e) => {
      if (Date.now() - i < 500) return;
      let t = e.target.closest(".tooltip-trigger");
      t && !t.contains(e.relatedTarget) && o();
    }),
    document.body.addEventListener(
      "touchstart",
      (t) => {
        i = Date.now();
        let r = t.target.closest(".tooltip-trigger");
        r ? (n === r && e.classList.contains("visible") ? o() : l(r)) : o();
      },
      { passive: !0 },
    ),
    window.addEventListener("scroll", o, { capture: !0, passive: !0 }));
}
document.getElementById("refresh-songs-btn").addEventListener("click", () => {
  if (refreshCooldown || "recent" !== currentSongTab) return;
  let e = document.getElementById("songs-loader"),
    t = document.getElementById("songs-list-wrapper");
  e &&
    t &&
    e.parentNode !== t &&
    (t.appendChild(e), (e.style.borderRadius = "8px"));
  let n = document.getElementById("refresh-songs-btn");
  ((n.disabled = !0),
    document
      .getElementById("recent-songs-container")
      .removeAttribute("data-loaded"),
    loadRecentSongs(),
    (refreshCooldown = !0),
    setTimeout(() => {
      ("recent" === currentSongTab && (n.disabled = !1),
        (refreshCooldown = !1));
    }, 3e4));
});
const searchInput = document.getElementById("song-search-input"),
  clearSearchBtn = document.getElementById("clear-search-btn");
function filterSongs(e) {
  let t =
      "recent" === currentSongTab
        ? "recent-songs-container"
        : "top-songs-container",
    n = document.getElementById(t),
    i = n.getElementsByClassName("song-item"),
    r = e.toLowerCase().trim(),
    a = !1,
    s = n.querySelector(".search-empty-state");
  if (
    (s && s.remove(),
    Array.from(i).forEach((e) => {
      let t = e.querySelector(".song-title").textContent.toLowerCase(),
        n = e.querySelector(".song-artist-name").textContent.toLowerCase();
      t.includes(r) || n.includes(r)
        ? ((e.style.display = "flex"), (a = !0))
        : (e.style.display = "none");
    }),
    !a && i.length > 0)
  ) {
    let l = document.createElement("div");
    ((l.className = "empty-state search-empty-state"),
      (l.innerHTML = ` <div>No songs found matching your search.</div><button class="clear-search-btn" id="empty-clear-search-btn" style="margin-top:4px;">Clear Search</button> `),
      n.appendChild(l),
      document
        .getElementById("empty-clear-search-btn")
        .addEventListener("click", () => {
          let e = document.getElementById("song-search-input"),
            t = document.getElementById("clear-search-btn");
          ((e.value = ""),
            t.classList.remove("visible"),
            filterSongs(""),
            e.focus());
        }));
  }
}
(searchInput.addEventListener("input", (e) => {
  let t = e.target.value;
  (t.length > 0
    ? clearSearchBtn.classList.add("visible")
    : clearSearchBtn.classList.remove("visible"),
    filterSongs(t));
}),
  clearSearchBtn.addEventListener("click", () => {
    ((searchInput.value = ""),
      clearSearchBtn.classList.remove("visible"),
      filterSongs(""),
      searchInput.focus());
  }));
const refreshBtn = document.getElementById("refresh-songs-btn");
(refreshBtn.addEventListener("click", () => {
  ((searchInput.value = ""), clearSearchBtn.classList.remove("visible"));
}),
  document
    .getElementById("close-button")
    .addEventListener("click", closeMediaPlayer),
  document
    .getElementById("media-play-pause-btn")
    .addEventListener("click", toggleMediaPlayerState),
  document.getElementById("lyrics-btn").addEventListener("click", () => {
    if (
      !spotifyData ||
      document.getElementById("lyrics-btn").classList.contains("disabled")
    )
      return;
    let e = document.getElementById("lyrics-popup");
    (e.classList.add("visible"), (lyricsActive = !0));
    let t = spotifyData.album_art_url && "null" !== spotifyData.album_art_url;
    document.getElementById("lyrics-backdrop").style.backgroundImage = t
      ? `url(${spotifyData.album_art_url})`
      : "none";
    let n = spotifyData.track_id,
      i =
        n && "null" !== n
          ? n
          : `local:${spotifyData.song}-${spotifyData.artist}`;
    if (currentTrackIdForLyrics !== i) {
      currentTrackIdForLyrics = i;
      let r = (spotifyData.timestamps.end - spotifyData.timestamps.start) / 1e3;
      fetchLyrics(
        spotifyData.song,
        spotifyData.artist,
        spotifyData.album,
        r,
        i,
      );
    } else {
      let a = document.getElementById("lyrics-content");
      currentLyrics.length > 0 &&
        (a.innerHTML.includes("Playback ended") || "" === a.innerHTML.trim()) &&
        (a.classList.remove("locked"),
        renderLyrics(),
        void 0 === currentLyrics[0].time
          ? (a.classList.add("unsynced"),
            (document.getElementById("unsynced-label").style.display = "block"))
          : (a.classList.remove("unsynced"),
            (document.getElementById("unsynced-label").style.display =
              "none")));
      let s = (Date.now() - spotifyData.timestamps.start) / 1e3;
      syncLyrics(s);
    }
    ((document.getElementById("lyrics-song-title").textContent =
      spotifyData.song),
      (document.getElementById("lyrics-song-artist").textContent =
        spotifyData.artist.replace(/; /g, ", ")));
  }),
  document.getElementById("close-lyrics-btn").addEventListener("click", () => {
    (document.getElementById("lyrics-popup").classList.remove("visible"),
      (lyricsActive = !1),
      setTimeout(() => {
        toggleLyricsFullscreen(!1);
      }, 250));
  }),
  document
    .getElementById("lyrics-overlay-dim")
    .addEventListener("click", () => {
      (document.getElementById("lyrics-popup").classList.remove("visible"),
        (lyricsActive = !1),
        setTimeout(() => {
          toggleLyricsFullscreen(!1);
        }, 250));
    }),
  document
    .getElementById("fullscreen-lyrics-btn")
    .addEventListener("click", () => {
      toggleLyricsFullscreen();
    }));
const volumeSlider = document.getElementById("volume-slider"),
  volumePercentage = document.getElementById("volume-percentage");
volumeSlider.addEventListener("input", (e) => {
  let t = e.target.value / 100,
    n = t * t;
  (currentAudio &&
    (void 0 !== gainNode && gainNode && sourceNode
      ? ((gainNode.gain.value = n), (currentAudio.volume = 1))
      : (currentAudio.volume = n)),
    t > 0 && (lastVolume = t),
    (volumePercentage.textContent = `${e.target.value}%`),
    updateVolumeIcon());
});
const volumeButton = document.getElementById("volume-button");
volumeButton.addEventListener("click", () => {
  if (!currentAudio) return;
  let e = parseInt(document.getElementById("volume-slider").value);
  (e > 0
    ? (void 0 !== gainNode && gainNode && sourceNode
        ? ((gainNode.gain.value = 0), (currentAudio.volume = 1))
        : (currentAudio.volume = 0),
      (volumeSlider.value = 0),
      (volumePercentage.textContent = "0%"))
    : (void 0 !== gainNode && gainNode && sourceNode
        ? ((gainNode.gain.value = lastVolume * lastVolume),
          (currentAudio.volume = 1))
        : (currentAudio.volume = lastVolume * lastVolume),
      (volumeSlider.value = 100 * lastVolume),
      (volumePercentage.textContent = `${Math.round(100 * lastVolume)}%`)),
    updateVolumeIcon());
});
const volumeControlsContainer = document.querySelector(".volume-controls");
(volumeControlsContainer.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    let t = document.getElementById("volume-slider"),
      n = parseInt(t.value);
    ((n = e.deltaY < 0 ? Math.min(100, n + 2) : Math.max(0, n - 2)),
      (t.value = n),
      t.dispatchEvent(new Event("input")));
  },
  { passive: !1 },
),
  document.addEventListener("keydown", (e) => {
    (("F12" === e.key ||
      (e.ctrlKey && e.shiftKey && ("I" === e.key || "C" === e.key)) ||
      (e.ctrlKey &&
        ["u", "s", "p", "g", "f", "o", "j", "h", "d", "+", "-"].includes(
          e.key,
        ))) &&
      e.preventDefault(),
      "Tab" === e.key && e.preventDefault(),
      lyricsActive &&
        (" " === e.key &&
          "INPUT" !== e.target.tagName &&
          "TEXTAREA" !== e.target.tagName &&
          e.preventDefault(),
        "Escape" === e.key &&
          (isLyricsFullscreen
            ? toggleLyricsFullscreen(!1)
            : (document
                .getElementById("lyrics-popup")
                .classList.remove("visible"),
              (lyricsActive = !1)))));
  }),
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  }),
  document.addEventListener(
    "error",
    function (e) {
      if (e.target.tagName && "img" === e.target.tagName.toLowerCase()) {
        let t = e.target.getAttribute("src");
        t && "" !== t && (e.target.style.display = "none");
      }
    },
    !0,
  ),
  window === top &&
    window.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) return (e.preventDefault(), !1);
      },
      { passive: !1 },
    ),
  window.addEventListener("online", () => {
    startPresencePolling();
  }),
  window.addEventListener("offline", () => {
    updateStatusDisconnected();
  }));
let resizeTimeout;
const resizeObserver = new ResizeObserver(() => {
  (clearTimeout(resizeTimeout),
    (resizeTimeout = setTimeout(() => {
      (resizeCanvas(), applyDisplayNameScroll());
    }, 30)));
});
resizeObserver.observe(document.body);
const playerEl = document.getElementById("media-player");
(playerEl && resizeObserver.observe(playerEl),
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      (animationFrameId &&
        (cancelAnimationFrame(animationFrameId), (animationFrameId = null)),
        progressRafId &&
          (cancelAnimationFrame(progressRafId), (progressRafId = null)));
    else {
      let e = document
        .getElementById("media-player")
        .classList.contains("visible");
      (isVisualizerInitialized &&
        e &&
        (animationFrameId && cancelAnimationFrame(animationFrameId),
        drawVisualizer()),
        spotifyData &&
          (updateProgress(),
          progressRafId ||
            (progressRafId = requestAnimationFrame(progressLoop))));
    }
  }),
  startPresencePolling(),
  loadRecentSongs(),
  updateLocalTime(),
  startClock(),
  loadViewCounter(),
  animateCypherText(7, 25),
  initTooltips(),
  updateAge());
