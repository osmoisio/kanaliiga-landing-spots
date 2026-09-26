// Renders MATCH_DATA (see data.js) as an interactive, zoomable landing-spot map.
(function () {
  "use strict";

  const mapSelect = document.getElementById("map-select");
  const matchListEl = document.getElementById("match-list");
  const teamListEl = document.getElementById("team-list");
  const mapContainer = document.getElementById("map-container");
  const zoomWrap = document.getElementById("zoom-wrap");
  const mapImage = document.getElementById("map-image");
  const flightPathLayer = document.getElementById("flight-path-layer");
  const markersLayer = document.getElementById("markers-layer");
  const tooltip = document.getElementById("tooltip");
  const matchSelectAllBtn = document.getElementById("match-select-all");
  const matchSelectNoneBtn = document.getElementById("match-select-none");
  const teamSelectAllBtn = document.getElementById("team-select-all");
  const teamSelectNoneBtn = document.getElementById("team-select-none");
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const zoomResetBtn = document.getElementById("zoom-reset");
  const zoomLevelEl = document.getElementById("zoom-level");

  const teamsById = new Map(MATCH_DATA.teams.map((t) => [t.team_id, t]));
  const matchesById = new Map(MATCH_DATA.matches.map((m) => [m.match_id, m]));

  let currentMapId = null;
  let selectedRowKey = null; // "<match_id>_<team_id>" of the team currently drilled into
  let hoveredMatchId = null; // match id of the marker currently under the mouse, if any

  // ---- zoom / pan state -----------------------------------------------
  const MIN_SCALE = 1;
  const MAX_SCALE = 8;
  const view = { scale: 1, tx: 0, ty: 0 };

  function applyView() {
    zoomWrap.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    zoomLevelEl.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function clampPan() {
    const rect = mapContainer.getBoundingClientRect();
    const minTx = rect.width * (1 - view.scale);
    const minTy = rect.height * (1 - view.scale);
    view.tx = Math.min(0, Math.max(minTx, view.tx));
    view.ty = Math.min(0, Math.max(minTy, view.ty));
  }

  function zoomAtPoint(px, py, factor) {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    if (newScale === view.scale) return;
    const contentX = (px - view.tx) / view.scale;
    const contentY = (py - view.ty) / view.scale;
    view.scale = newScale;
    view.tx = px - contentX * view.scale;
    view.ty = py - contentY * view.scale;
    clampPan();
    applyView();
  }

  function resetView() {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    applyView();
  }

  mapContainer.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = mapContainer.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAtPoint(px, py, factor);
    },
    { passive: false }
  );

  zoomInBtn.addEventListener("click", () => {
    const rect = mapContainer.getBoundingClientRect();
    zoomAtPoint(rect.width / 2, rect.height / 2, 1.4);
  });
  zoomOutBtn.addEventListener("click", () => {
    const rect = mapContainer.getBoundingClientRect();
    zoomAtPoint(rect.width / 2, rect.height / 2, 1 / 1.4);
  });
  zoomResetBtn.addEventListener("click", resetView);

  let isPanning = false;
  let dragDistance = 0;
  let panStart = { x: 0, y: 0 };
  let panOrigin = { tx: 0, ty: 0 };

  mapContainer.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".marker, .player-marker")) return;
    isPanning = true;
    dragDistance = 0;
    panStart = { x: ev.clientX, y: ev.clientY };
    panOrigin = { tx: view.tx, ty: view.ty };
    mapContainer.classList.add("grabbing");
  });

  window.addEventListener("mousemove", (ev) => {
    if (!isPanning) return;
    const dx = ev.clientX - panStart.x;
    const dy = ev.clientY - panStart.y;
    dragDistance = Math.max(dragDistance, Math.hypot(dx, dy));
    view.tx = panOrigin.tx + dx;
    view.ty = panOrigin.ty + dy;
    clampPan();
    applyView();
  });

  window.addEventListener("mouseup", (ev) => {
    if (!isPanning) return;
    isPanning = false;
    mapContainer.classList.remove("grabbing");
    const clickedBackground = !ev.target.closest(".marker, .player-marker");
    if (dragDistance < 4 && clickedBackground) {
      selectedRowKey = null;
      renderMarkers();
    }
  });

  // ---- data helpers -----------------------------------------------------
  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function matchLabel(match) {
    return `${match.session_name} · Match ${match.match_number} (${formatDate(match.played_at)})`;
  }

  function rowKey(row) {
    return `${row.match_id}_${row.team_id}`;
  }

  function populateMapSelect() {
    const maps = [...MATCH_DATA.maps].sort((a, b) => a.display_name.localeCompare(b.display_name));
    mapSelect.innerHTML = "";
    for (const m of maps) {
      const opt = document.createElement("option");
      opt.value = String(m.map_id);
      opt.textContent = m.display_name;
      mapSelect.appendChild(opt);
    }
  }

  function matchesForMap(mapId) {
    return MATCH_DATA.matches
      .filter((m) => m.map_id === mapId)
      .sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
  }

  function teamsForMap(mapId) {
    const teamIds = new Set(
      MATCH_DATA.landings.filter((l) => l.map_id === mapId).map((l) => l.team_id)
    );
    return [...teamIds]
      .map((id) => teamsById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.team_name.localeCompare(b.team_name));
  }

  function populateMatchList(mapId) {
    matchListEl.innerHTML = "";
    for (const match of matchesForMap(mapId)) {
      const row = document.createElement("label");
      row.className = "check-row";
      row.innerHTML = `<input type="checkbox" checked data-match-id="${match.match_id}"> ${matchLabel(match)}`;
      row.querySelector("input").addEventListener("change", renderMarkers);
      matchListEl.appendChild(row);
    }
  }

  function populateTeamList(mapId) {
    teamListEl.innerHTML = "";
    for (const team of teamsForMap(mapId)) {
      const row = document.createElement("label");
      row.className = "check-row";
      const img = team.logo_path
        ? `<img class="team-mini-logo" src="${team.logo_path}" alt="">`
        : `<span class="team-mini-logo"></span>`;
      row.innerHTML = `<input type="checkbox" checked data-team-id="${team.team_id}"> ${img} ${team.team_name}`;
      row.querySelector("input").addEventListener("change", renderMarkers);
      teamListEl.appendChild(row);
    }
  }

  function selectedIds(container, attr) {
    const ids = new Set();
    container.querySelectorAll(`input[${attr}]:checked`).forEach((el) => {
      ids.add(Number(el.getAttribute(attr)));
    });
    return ids;
  }

  function placementClass(placement) {
    if (placement === 1) return "placement-1";
    if (placement <= 5) return "placement-top5";
    return "placement-other";
  }

  function renderMarkers() {
    const activeMatchIds = selectedIds(matchListEl, "data-match-id");
    const activeTeamIds = selectedIds(teamListEl, "data-team-id");

    const rows = MATCH_DATA.landings.filter(
      (l) =>
        l.map_id === currentMapId &&
        activeMatchIds.has(l.match_id) &&
        activeTeamIds.has(l.team_id)
    );

    if (selectedRowKey && !rows.some((r) => rowKey(r) === selectedRowKey)) {
      selectedRowKey = null;
    }

    markersLayer.innerHTML = "";

    let selectedRow = null;
    for (const row of rows) {
      const team = teamsById.get(row.team_id);
      const match = matchesById.get(row.match_id);
      if (!team) continue;

      const key = rowKey(row);
      const isSelected = key === selectedRowKey;
      if (isSelected) selectedRow = row;

      const marker = document.createElement("div");
      marker.className = `marker ${placementClass(row.placement)}${isSelected ? " selected" : ""}`;
      marker.style.left = `${(row.x_norm * 100).toFixed(3)}%`;
      marker.style.top = `${(row.y_norm * 100).toFixed(3)}%`;

      const img = document.createElement("img");
      img.src = team.logo_path || "";
      img.alt = team.team_name;
      img.loading = "lazy";
      marker.appendChild(img);

      marker.addEventListener("mouseenter", (ev) => {
        hoveredMatchId = row.match_id;
        updateFlightPath();
        showTeamTooltip(ev, team, match, row);
      });
      marker.addEventListener("mousemove", moveTooltip);
      marker.addEventListener("mouseleave", () => {
        hoveredMatchId = null;
        updateFlightPath();
        hideTooltip();
      });
      marker.addEventListener("click", (ev) => {
        ev.preventDefault();
        selectedRowKey = isSelected ? null : key;
        renderMarkers();
      });

      markersLayer.appendChild(marker);
    }

    if (selectedRow) {
      renderPlayerDetail(selectedRow);
    }

    updateFlightPath();
  }

  function renderPlayerDetail(row) {
    const team = teamsById.get(row.team_id);
    const match = matchesById.get(row.match_id);
    const containerRect = mapContainer.getBoundingClientRect();
    const players = row.players || [];

    for (const p of players) {
      const dxPx = (p.x_norm - row.x_norm) * containerRect.width;
      const dyPx = (p.y_norm - row.y_norm) * containerRect.height;
      const lengthPx = Math.hypot(dxPx, dyPx);
      const angleRad = Math.atan2(dyPx, dxPx);

      if (lengthPx > 1) {
        const line = document.createElement("div");
        line.className = "player-link";
        line.style.left = `${(row.x_norm * 100).toFixed(3)}%`;
        line.style.top = `${(row.y_norm * 100).toFixed(3)}%`;
        line.style.width = `${lengthPx}px`;
        line.style.transform = `rotate(${angleRad}rad)`;
        markersLayer.appendChild(line);
      }

      const dot = document.createElement("div");
      dot.className = "player-marker";
      dot.style.left = `${(p.x_norm * 100).toFixed(3)}%`;
      dot.style.top = `${(p.y_norm * 100).toFixed(3)}%`;
      dot.addEventListener("mouseenter", (ev) => {
        hoveredMatchId = row.match_id;
        updateFlightPath();
        showPlayerTooltip(ev, team, match, p);
      });
      dot.addEventListener("mousemove", moveTooltip);
      dot.addEventListener("mouseleave", () => {
        hoveredMatchId = null;
        updateFlightPath();
        hideTooltip();
      });
      markersLayer.appendChild(dot);
    }
  }

  // ---- plane flight path -------------------------------------------------
  // Shown for a match's drop plane when hovering a team/player marker for
  // that match, when a team is drilled into, or automatically when the
  // match checkboxes narrow the view down to a single match.
  const FLIGHT_PATH_NS = "http://www.w3.org/2000/svg";
  let flightPathMatchId = null;

  function currentFocusMatchId() {
    if (hoveredMatchId != null) return hoveredMatchId;
    if (selectedRowKey) return Number(selectedRowKey.split("_")[0]);
    const activeMatchIds = selectedIds(matchListEl, "data-match-id");
    if (activeMatchIds.size === 1) return [...activeMatchIds][0];
    return null;
  }

  function buildFlightPathSvg(plane) {
    const svg = document.createElementNS(FLIGHT_PATH_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");

    const defs = document.createElementNS(FLIGHT_PATH_NS, "defs");
    const marker = document.createElementNS(FLIGHT_PATH_NS, "marker");
    marker.setAttribute("id", "flight-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "3.2");
    marker.setAttribute("markerHeight", "3.2");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrowPath = document.createElementNS(FLIGHT_PATH_NS, "path");
    arrowPath.setAttribute("d", "M0,0 L10,5 L0,10 z");
    arrowPath.setAttribute("fill", "var(--accent)");
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const x1 = plane.start_x_norm * 100;
    const y1 = plane.start_y_norm * 100;
    const x2 = plane.end_x_norm * 100;
    const y2 = plane.end_y_norm * 100;

    const line = document.createElementNS(FLIGHT_PATH_NS, "line");
    line.setAttribute("class", "flight-line");
    line.setAttribute("x1", x1.toFixed(3));
    line.setAttribute("y1", y1.toFixed(3));
    line.setAttribute("x2", x2.toFixed(3));
    line.setAttribute("y2", y2.toFixed(3));
    line.setAttribute("marker-end", "url(#flight-arrow)");
    svg.appendChild(line);

    const startDot = document.createElementNS(FLIGHT_PATH_NS, "circle");
    startDot.setAttribute("class", "flight-endpoint");
    startDot.setAttribute("cx", x1.toFixed(3));
    startDot.setAttribute("cy", y1.toFixed(3));
    startDot.setAttribute("r", "0.8");
    svg.appendChild(startDot);

    // Two animation frames so the CSS transition (opacity 0 -> 1) actually
    // runs instead of the freshly-inserted elements starting at their final
    // "visible" state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        line.classList.add("visible");
        startDot.classList.add("visible");
      });
    });

    return svg;
  }

  function renderFlightPath(match) {
    const plane = match && match.map_id === currentMapId ? match.plane_path : null;
    if (!plane) {
      if (flightPathMatchId !== null) {
        flightPathLayer.innerHTML = "";
        flightPathMatchId = null;
      }
      return;
    }
    if (flightPathMatchId === match.match_id) return; // already showing this match's path
    flightPathMatchId = match.match_id;
    flightPathLayer.innerHTML = "";
    flightPathLayer.appendChild(buildFlightPathSvg(plane));
  }

  function updateFlightPath() {
    const matchId = currentFocusMatchId();
    renderFlightPath(matchId != null ? matchesById.get(matchId) : null);
  }

  function showTeamTooltip(ev, team, match, row) {
    tooltip.innerHTML = `
      <b>${team.team_name}</b><br>
      ${match ? matchLabel(match) : ""}<br>
      Placement: #${row.placement} &nbsp; Kills: ${row.kills}<br>
      <span style="color:var(--muted)">Click to see individual player landings</span>
    `;
    tooltip.classList.remove("hidden");
    moveTooltip(ev);
  }

  function showPlayerTooltip(ev, team, match, player) {
    tooltip.innerHTML = `
      <b>${player.pubg_name || "Unknown player"}</b><br>
      ${team.team_name}<br>
      ${match ? matchLabel(match) : ""}
    `;
    tooltip.classList.remove("hidden");
    moveTooltip(ev);
  }

  function moveTooltip(ev) {
    const pad = 16;
    let left = ev.clientX + pad;
    let top = ev.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = ev.clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight) top = ev.clientY - rect.height - pad;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.add("hidden");
  }

  function selectMap(mapId) {
    currentMapId = mapId;
    selectedRowKey = null;
    hoveredMatchId = null;
    resetView();
    const mapInfo = MATCH_DATA.maps.find((m) => m.map_id === mapId);
    mapImage.src = mapInfo.art_path;
    mapImage.alt = mapInfo.display_name;
    populateMatchList(mapId);
    populateTeamList(mapId);
    renderMarkers();
  }

  mapSelect.addEventListener("change", () => selectMap(Number(mapSelect.value)));

  matchSelectAllBtn.addEventListener("click", () => {
    matchListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
    renderMarkers();
  });
  matchSelectNoneBtn.addEventListener("click", () => {
    matchListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
    renderMarkers();
  });

  teamSelectAllBtn.addEventListener("click", () => {
    teamListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
    renderMarkers();
  });
  teamSelectNoneBtn.addEventListener("click", () => {
    teamListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
    renderMarkers();
  });

  populateMapSelect();
  if (MATCH_DATA.maps.length > 0) {
    const firstMapId = Number(mapSelect.value);
    selectMap(firstMapId);
  }
})();
