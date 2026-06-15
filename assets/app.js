const state = {
  server: window.IPTV_DEFAULTS.server,
  username: window.IPTV_DEFAULTS.username,
  password: window.IPTV_DEFAULTS.password,
  connected: false,
  section: "live",
  categoryId: "",
  categoryFilter: "",
  categories: [],
  items: [],
  search: "",
  liveFormat: "m3u8",
  selectedSeries: null,
  hls: null,
};

const STORAGE_KEY = "iptv-browser:last-config";

const els = {
  form: document.querySelector("#connectionForm"),
  server: document.querySelector("#serverInput"),
  username: document.querySelector("#usernameInput"),
  password: document.querySelector("#passwordInput"),
  badge: document.querySelector("#connectionBadge"),
  account: document.querySelector("#accountPanel"),
  tabs: document.querySelectorAll(".media-tabs button"),
  sectionTitle: document.querySelector("#sectionTitle"),
  resultCount: document.querySelector("#resultCount"),
  categoryList: document.querySelector("#categoryList"),
  categoryFilter: document.querySelector("#categoryFilterInput"),
  itemsGrid: document.querySelector("#itemsGrid"),
  search: document.querySelector("#searchInput"),
  liveFormat: document.querySelector("#liveFormat"),
  player: document.querySelector("#videoPlayer"),
  nowPlaying: document.querySelector("#nowPlaying"),
  nowPlayingMeta: document.querySelector("#nowPlayingMeta"),
  externalLink: document.querySelector("#externalLink"),
  toast: document.querySelector("#toast"),
  seriesPanel: document.querySelector("#seriesPanel"),
};

const sectionConfig = {
  live: {
    title: "Live",
    categoryRequest: "live-categories",
    itemRequest: "live-streams",
    idKey: "stream_id",
    nameKey: "name",
  },
  vod: {
    title: "Movies",
    categoryRequest: "vod-categories",
    itemRequest: "vod-streams",
    idKey: "stream_id",
    nameKey: "name",
  },
  series: {
    title: "Series",
    categoryRequest: "series-categories",
    itemRequest: "series-list",
    idKey: "series_id",
    nameKey: "name",
  },
};

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.server = els.server.value.trim();
  state.username = els.username.value.trim();
  state.password = els.password.value.trim();
  saveConnectionConfig();
  await connect();
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    if (state.section === tab.dataset.section) return;
    state.section = tab.dataset.section;
    state.categoryId = "";
    state.items = [];
    state.selectedSeries = null;
    els.seriesPanel.hidden = true;
    renderTabs();
    renderItems(true);
    if (state.connected) {
      await loadCategoriesAndItems();
    } else {
      renderCategories();
    }
  });
});

els.search.addEventListener("input", () => {
  state.search = els.search.value.trim().toLowerCase();
  renderItems();
});

els.categoryFilter.addEventListener("input", () => {
  state.categoryFilter = els.categoryFilter.value.trim().toLowerCase();
  renderCategories();
});

els.liveFormat.addEventListener("change", () => {
  state.liveFormat = els.liveFormat.value;
});

els.server.addEventListener("input", saveConnectionConfig);
els.username.addEventListener("input", saveConnectionConfig);
els.password.addEventListener("input", saveConnectionConfig);

restoreConnectionConfig();

async function connect() {
  setBusy(true);
  try {
    const account = await api("account", {});
    state.connected = true;
    els.badge.textContent = "Online";
    els.badge.classList.add("online");
    renderAccount(account);
    await loadCategoriesAndItems();
  } catch (error) {
    state.connected = false;
    els.badge.textContent = "Offline";
    els.badge.classList.remove("online");
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadCategoriesAndItems() {
  const config = sectionConfig[state.section];
  setBusy(true);
  try {
    const categories = await api(config.categoryRequest, {});
    state.categories = Array.isArray(categories) ? categories : [];
    renderCategories();
    await loadItems();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadItems() {
  const config = sectionConfig[state.section];
  setBusy(true);
  try {
    const payload = state.categoryId ? { category_id: state.categoryId } : {};
    const items = await api(config.itemRequest, payload);
    state.items = Array.isArray(items) ? items : [];
    renderItems();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function api(request, extra) {
  const response = await fetch(`index.php?ajax=${encodeURIComponent(request)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server: state.server,
      username: state.username,
      password: state.password,
      ...extra,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(payload?.error || "Request failed.");
  }

  return payload.data ?? payload.url;
}

function renderTabs() {
  els.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.section === state.section);
  });
  els.sectionTitle.textContent = sectionConfig[state.section].title;
  els.liveFormat.parentElement.hidden = state.section !== "live";
}

function renderAccount(account) {
  const user = account?.user_info || {};
  const server = account?.server_info || {};
  const expiry = formatExpiry(user.exp_date);
  const rows = [
    ["Status", user.status || "Unknown"],
    ["Expires", expiry],
    ["Active", `${user.active_cons ?? 0}/${user.max_connections ?? "-"}`],
    ["Server time", server.time_now || "-"],
  ];

  els.account.innerHTML = rows.map(([label, value]) => (
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`
  )).join("");
  els.account.hidden = false;
}

function renderCategories() {
  const filteredCategories = state.categories.filter((category) => {
    const name = String(category.category_name || "").toLowerCase();
    return !state.categoryFilter || name.includes(state.categoryFilter);
  });
  const buttons = [
    { category_id: "", category_name: "All" },
    ...filteredCategories,
  ];

  els.categoryList.innerHTML = buttons.map((category) => {
    const id = String(category.category_id ?? "");
    const active = id === String(state.categoryId);
    return `<button type="button" class="${active ? "active" : ""}" data-category="${escapeAttr(id)}">
      <span>${escapeHtml(category.category_name || "Untitled")}</span>
    </button>`;
  }).join("");

  els.categoryList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.categoryId = button.dataset.category || "";
      renderCategories();
      await loadItems();
    });
  });

  if (buttons.length === 1 && state.categoryFilter) {
    els.categoryList.insertAdjacentHTML("beforeend", `<div class="category-empty">No categories</div>`);
  }
}

function renderItems(isEmptyReset = false) {
  const config = sectionConfig[state.section];
  const query = state.search;
  const items = isEmptyReset ? [] : state.items.filter((item) => {
    const name = String(item[config.nameKey] || "").toLowerCase();
    return !query || name.includes(query);
  });

  els.resultCount.textContent = `${items.length.toLocaleString()} result${items.length === 1 ? "" : "s"}`;

  if (items.length === 0) {
    els.itemsGrid.innerHTML = `<div class="empty-state">${state.connected ? "No matches" : "Connect to browse"}</div>`;
    return;
  }

  els.itemsGrid.innerHTML = items.map((item) => renderItem(item, config)).join("");
  els.itemsGrid.querySelectorAll("[data-play-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findItem(button.dataset.playId);
      if (item) await playItem(item);
    });
  });
  els.itemsGrid.querySelectorAll("[data-series-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = findItem(button.dataset.seriesId);
      if (item) await openSeries(item);
    });
  });
}

function renderItem(item, config) {
  const id = String(item[config.idKey] ?? "");
  const name = item[config.nameKey] || "Untitled";
  const logo = item.stream_icon || item.cover || item.cover_big || "";
  const year = item.releaseDate || item.release_date || "";
  const rating = item.rating || "";
  const action = state.section === "series"
    ? `<button type="button" class="item-action" data-series-id="${escapeAttr(id)}">Open</button>`
    : `<button type="button" class="item-action" data-play-id="${escapeAttr(id)}">Play</button>`;

  return `<article class="item-card">
    <div class="poster">${logo ? `<img src="${escapeAttr(logo)}" alt="">` : `<span>${escapeHtml(initials(name))}</span>`}</div>
    <div class="item-body">
      <h3 title="${escapeAttr(name)}">${escapeHtml(name)}</h3>
      <p>${escapeHtml([year, rating ? `Rating ${rating}` : ""].filter(Boolean).join(" / ") || item.category_name || "")}</p>
    </div>
    ${action}
  </article>`;
}

async function playItem(item, override = {}) {
  const type = override.type || state.section;
  const id = override.id || item.stream_id || item.episode_id || item.id;
  const name = override.name || item.name || item.title || "Untitled";
  const extension = override.extension || item.container_extension || (type === "live" ? state.liveFormat : "mp4");

  try {
    const directUrl = await api("stream-url", { type, id, extension });
    const playerUrl = type === "live" && extension === "m3u8"
      ? buildHlsProxyUrl(id)
      : directUrl;

    const managedByHls = attachPlayerSource(playerUrl, type, extension);
    if (!managedByHls) {
      els.player.load();
      els.player.play().catch(() => {});
    }
    els.nowPlaying.textContent = name;
    els.nowPlayingMeta.textContent = type === "live" && extension === "m3u8"
      ? "Live / proxied HLS"
      : `${typeLabel(type)} / ${extension}`;
    els.externalLink.href = directUrl;
    els.externalLink.classList.remove("disabled");
  } catch (error) {
    showToast(error.message);
  }
}

function attachPlayerSource(url, type, extension) {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  if (type === "live" && extension === "m3u8" && window.Hls?.isSupported()) {
    state.hls = new window.Hls({
      liveDurationInfinity: true,
      lowLatencyMode: false,
    });
    state.hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) {
        showToast(data.details || "Live stream playback failed.");
      }
    });
    state.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      els.player.play().catch(() => {});
    });
    state.hls.loadSource(url);
    state.hls.attachMedia(els.player);
    return true;
  }

  els.player.src = url;
  return false;
}

function buildHlsProxyUrl(id) {
  const params = new URLSearchParams({
    hls: "playlist",
    server: state.server,
    username: state.username,
    password: state.password,
    id: String(id),
  });
  return `index.php?${params.toString()}`;
}

async function openSeries(series) {
  setBusy(true);
  try {
    const info = await api("series-info", { series_id: series.series_id });
    state.selectedSeries = { series, info };
    renderSeries(series, info);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function renderSeries(series, info) {
  const episodes = info?.episodes || {};
  const seasonKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));

  if (seasonKeys.length === 0) {
    els.seriesPanel.innerHTML = `<div class="empty-state">No episodes</div>`;
    els.seriesPanel.hidden = false;
    return;
  }

  els.seriesPanel.innerHTML = `<header>
      <div>
        <h3>${escapeHtml(series.name || "Series")}</h3>
        <p>${escapeHtml(series.genre || "")}</p>
      </div>
      <button type="button" class="secondary-button" data-close-series>Close</button>
    </header>
    <div class="episodes">
      ${seasonKeys.map((season) => `<section>
        <h4>Season ${escapeHtml(season)}</h4>
        ${episodes[season].map((episode) => renderEpisode(episode)).join("")}
      </section>`).join("")}
    </div>`;

  els.seriesPanel.hidden = false;
  els.seriesPanel.querySelector("[data-close-series]").addEventListener("click", () => {
    els.seriesPanel.hidden = true;
  });
  els.seriesPanel.querySelectorAll("[data-episode-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await playItem({}, {
        type: "series",
        id: button.dataset.episodeId,
        name: button.dataset.episodeName,
        extension: button.dataset.episodeExtension || "mp4",
      });
    });
  });
}

function renderEpisode(episode) {
  const id = String(episode.id ?? episode.episode_id ?? "");
  const title = episode.title || `Episode ${episode.episode_num || ""}`;
  const extension = episode.container_extension || "mp4";
  return `<button type="button" class="episode-row" data-episode-id="${escapeAttr(id)}" data-episode-name="${escapeAttr(title)}" data-episode-extension="${escapeAttr(extension)}">
    <span>${escapeHtml(episode.episode_num ? `${episode.episode_num}. ${title}` : title)}</span>
    <small>${escapeHtml(extension)}</small>
  </button>`;
}

function findItem(id) {
  const config = sectionConfig[state.section];
  return state.items.find((item) => String(item[config.idKey]) === String(id));
}

function formatExpiry(value) {
  if (!value) return "-";
  const timestamp = Number(value) * 1000;
  if (!Number.isFinite(timestamp)) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function setBusy(isBusy) {
  document.body.classList.toggle("busy", isBusy);
}

function restoreConnectionConfig() {
  const saved = readSavedConnectionConfig();
  const server = saved.server || state.server;
  const username = saved.username || state.username;
  const password = saved.password || state.password;

  state.server = server;
  state.username = username;
  state.password = password;

  els.server.value = server;
  els.username.value = username;
  els.password.value = password;
}

function saveConnectionConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      server: els.server.value.trim(),
      username: els.username.value.trim(),
      password: els.password.value.trim(),
    }));
  } catch (error) {
    // Ignore storage failures in private mode or restricted browsers.
  }
}

function readSavedConnectionConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return {
      server: typeof parsed.server === "string" ? parsed.server.trim() : "",
      username: typeof parsed.username === "string" ? parsed.username.trim() : "",
      password: typeof parsed.password === "string" ? parsed.password.trim() : "",
    };
  } catch (error) {
    return {};
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 4500);
}

function typeLabel(type) {
  if (type === "vod") return "Movie";
  if (type === "series") return "Episode";
  return "Live";
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "TV";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

renderTabs();
renderCategories();
renderItems(true);
