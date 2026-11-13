/* Vestige — Urbex Atlas
   Vanilla JS, no build step, no required API keys.
   All first-party URLs are relative so the app works from any subpath. */
(function () {
  "use strict";

  var CFG = window.VESTIGE_CONFIG || {};
  var MAPBOX_TOKEN = String(CFG.MAPBOX_TOKEN || "").trim();

  var PHONE_MQ = "(max-width: 768px), (max-height: 539px)";
  var RESULT_CAP = 300;
  var NOMINATIM_WAIT = 700;
  var FAV_KEY = "vestige.favorites.v1";
  var AI_KEY = "vestige.ai.v1";
  var GEO_KEY = "vestige.geo.granted.v1";

  /* Type ids match teammate CSS: .v-pin[data-type="..."] in style.css.
     Verified Wikidata QIDs only (wbsearchentities + wbgetentities / SPARQL). */
  var TYPE_INFO = {
    Q74047:      { id: "ghost-town",         label: "Ghost town" },
    Q109607:     { id: "ruins",              label: "Ruins" },
    Q17715832:   { id: "ruins",              label: "Castle ruin" },
    Q106765618:  { id: "abandoned-building", label: "Abandoned building" },
    Q350895:     { id: "abandoned-village",  label: "Abandoned village" },
    Q110721660:  { id: "amusement-park",     label: "Abandoned amusement park" },
    Q42412840:   { id: "mine",               label: "Abandoned mine" },
    Q4663385:    { id: "station",            label: "Disused railway station" },
    Q106772341:  { id: "station",            label: "Abandoned railway station" },
    Q65464941:   { id: "station",            label: "Former railway stop" },
    Q357685:     { id: "station",            label: "Abandoned railway" },
    Q136005637:  { id: "station",            label: "Abandoned railway bridge" },
    Q134969220:  { id: "factory",            label: "Abandoned factory" },
    Q123223157:  { id: "factory",            label: "Former factory" },
    Q113377182:  { id: "factory",            label: "Former power station" },
    Q11853566:   { id: "church",             label: "Abandoned church" },
    Q64578911:   { id: "hospital",           label: "Former hospital" },
    Q96086399:   { id: "school",             label: "Former school" },
    Q87487749:   { id: "abandoned-building", label: "Former hotel" },
    Q111340353:  { id: "abandoned-building", label: "Abandoned prison" },
    Q113150763:  { id: "abandoned-building", label: "Defunct prison" },
    Q116257904:  { id: "abandoned-building", label: "Former barracks" },
    Q20992031:   { id: "abandoned-building", label: "Abandoned airport" },
    Q134969223:  { id: "abandoned-building", label: "Abandoned police post" }
  };

  /* P5817 "state of use" values, verified from P5817 one-of constraint + entity records. */
  var USE_VALUES = {
    Q63065035:  "abandoned",
    Q56651571:  "out of service",
    Q104664889: "permanently closed",
    Q11639308:  "decommissioned",
    Q11486291:  "permanently closed school",
    Q56557159:  "ruinous"
  };
  var DEMOLISHED_QID = "Q56556915"; /* P5817 "demolished or destroyed" — exclude */
  var CHIP_LABEL = {
    "ghost-town": "Ghost town", "abandoned-village": "Abandoned village",
    "ruins": "Ruins", "abandoned-building": "Abandoned building",
    "factory": "Industrial site", "mine": "Abandoned mine",
    "hospital": "Former hospital", "school": "Former school",
    "church": "Abandoned church", "station": "Disused station",
    "amusement-park": "Abandoned amusement park"
  };

  /* When an item is found via P5817 only, map a well-known P31 to a CSS type id.
     QIDs confirmed as P279 targets of the class items above, or standard classes. */
  var P31_FALLBACK = {
    Q16917: "hospital",
    Q3914: "school", Q1244442: "school", Q9826: "school",
    Q16970: "church",
    Q27686: "abandoned-building",
    Q40357: "abandoned-building",
    Q41176: "abandoned-building", Q3947: "abandoned-building",
    Q83405: "factory", Q159719: "factory",
    Q55488: "station", Q55678: "station", Q928830: "station", Q728937: "station",
    Q16659553: "mine",
    Q194195: "amusement-park",
    Q39715: "abandoned-building",
    Q1248784: "abandoned-building",
    Q91122: "abandoned-building", Q131263: "abandoned-building"
  };

  var CONTINENTS = [
    { id: "africa", name: "Africa", south: -35, north: 37.5, west: -18, east: 52 },
    { id: "asia", name: "Asia", south: -11, north: 77, west: 26, east: 170 },
    { id: "europe", name: "Europe", south: 35, north: 72, west: -25, east: 45 },
    { id: "north-america", name: "North America", south: 7, north: 72, west: -168, east: -52 },
    { id: "south-america", name: "South America", south: -56, north: 13, west: -82, east: -34 },
    { id: "oceania", name: "Oceania", south: -47, north: 5, west: 110, east: 180 },
    { id: "antarctica", name: "Antarctica", south: -85, north: -60, west: -180, east: 180 }
  ];

  var OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];
  var overpassLastGood = null;

  var SAFETY_TEXT =
    "These listings come from public open data and are not permission to enter. " +
    "Many sites are private property; going in without permission can be trespassing. " +
    "Abandoned structures can hide rotten floors, unstable stairs, asbestos, and open shafts. " +
    "Only visit places you have permission to enter, go with a buddy, and tell someone your plans.";

  var SYSTEM_PROMPT =
    "You are a friendly urbex (urban exploration) guide named Vestige. " +
    "You give practical advice on gear, photography, history, and safety. " +
    "You encourage only legal, permitted visits. You never help anyone break in, trespass, " +
    "bypass locks, evade security, disable alarms, or commit any crime. " +
    "If asked for help doing those things, you refuse clearly and suggest legal alternatives " +
    "such as licensed tours, publicly accessible ruins, museums, and photography from public rights of way. " +
    "Be concise, warm, and practical. Do not invent exact access instructions for a specific site.";

  var state = {
    map: null,
    bases: {},
    overlays: {},
    activeBase: null,
    cluster: null,
    markers: {},
    spots: [],
    selected: null,
    favorites: loadFavorites(),
    typeFilter: "all",
    textFilter: "",
    searchLabel: "",
    bbox: null,
    abort: null,
    chat: [],
    chatBusy: false,
    mapboxErrors: 0,
    mapboxDisabled: !MAPBOX_TOKEN,
    continentId: null,
    nominatimTimer: null,
    nominatimAbort: null,
    nominatimInflight: false,
    lastNominatim: 0
  };

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isPhone() {
    return window.matchMedia(PHONE_MQ).matches;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function fmtNum(n) {
    return Number(n).toFixed(5);
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function parsePoint(wkt) {
    var m = String(wkt || "").match(/Point\(\s*([+-]?\d+(\.\d+)?)\s+([+-]?\d+(\.\d+)?)\s*\)/i);
    if (!m) return null;
    return { lon: parseFloat(m[1]), lat: parseFloat(m[3]) };
  }

  function qidFromUri(uri) {
    var m = String(uri || "").match(/(Q\d+)$/);
    return m ? m[1] : null;
  }

  function padBBox(b, minSpan) {
    minSpan = minSpan == null ? 0.7 : minSpan;
    var latSpan = b.north - b.south;
    var lonSpan = b.east - b.west;
    if (lonSpan < 0) lonSpan += 360;
    var padLat = Math.max((minSpan - latSpan) / 2, latSpan * 0.08, 0.02);
    var padLon = Math.max((minSpan - lonSpan) / 2, lonSpan * 0.08, 0.02);
    return {
      south: clamp(b.south - padLat, -90, 90),
      north: clamp(b.north + padLat, -90, 90),
      west: ((b.west - padLon + 540) % 360) - 180,
      east: ((b.east + padLon + 540) % 360) - 180
    };
  }

  /* Read --accent from the teammate stylesheet. iOS-blue fallback, never orange. */
  function accentColor() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (v) return v;
    } catch (e) { /* ignore */ }
    return "#0a84ff";
  }

  var _typeColorCache = {};
  function typeColor(typeId) {
    if (!typeId) return accentColor();
    if (_typeColorCache[typeId]) return _typeColorCache[typeId];
    var el = document.createElement("div");
    el.className = "v-pin";
    el.setAttribute("data-type", typeId);
    el.style.cssText = "position:absolute;left:-9999px;visibility:hidden;";
    document.body.appendChild(el);
    var v = (getComputedStyle(el).getPropertyValue("--pin") || "").trim();
    document.body.removeChild(el);
    _typeColorCache[typeId] = v || accentColor();
    return _typeColorCache[typeId];
  }

  function kmOffset(lat, km) {
    return {
      dLat: km / 111.32,
      dLon: km / (111.32 * Math.max(0.15, Math.cos(lat * Math.PI / 180)))
    };
  }

  /* City: at least ~40 km around the Nominatim center, unioned with the place bbox.
     State / country / large admin areas: the full Nominatim bbox, unpadded. */
  function searchAreaBBox(geo) {
    var bbox = geo.bbox;
    var kind = String(geo.addresstype || geo.type || "").toLowerCase();
    var cls = String(geo.cls || "").toLowerCase();
    var rank = Number(geo.placeRank) || 99;
    var isBroadAdmin = rank <= 10 ||
      /^(country|state|region|province|territory|nation)$/.test(kind) ||
      (cls === "boundary" && rank <= 12 && /administrative|political/.test(String(geo.type || "")));
    var latSpan = bbox.north - bbox.south;
    var lonSpan = bbox.east - bbox.west;
    if (lonSpan < 0) lonSpan += 360;
    var midLat = (bbox.north + bbox.south) / 2;
    var kmLat = Math.abs(latSpan) * 111.32;
    var kmLon = lonSpan * 111.32 * Math.max(0.15, Math.cos(midLat * Math.PI / 180));
    if (isBroadAdmin || kmLat > 150 || kmLon > 150) {
      return bbox;
    }
    var o = kmOffset(geo.lat, 40);
    return {
      south: clamp(Math.min(bbox.south, geo.lat - o.dLat), -90, 90),
      north: clamp(Math.max(bbox.north, geo.lat + o.dLat), -90, 90),
      west: ((Math.min(bbox.west, geo.lon - o.dLon) + 540) % 360) - 180,
      east: ((Math.max(bbox.east, geo.lon + o.dLon) + 540) % 360) - 180
    };
  }

  function shouldTile(b) {
    var lat = Math.abs(b.north - b.south);
    var lon = b.east - b.west;
    if (lon < 0) lon += 360;
    return lat > 7 || lon > 7 || lat * lon > 36;
  }

  function makeTiles(b, maxSpan) {
    var segments = [];
    if (b.west <= b.east) segments.push([b.west, b.east]);
    else {
      segments.push([b.west, 180]);
      segments.push([-180, b.east]);
    }
    var tiles = [];
    var height = b.north - b.south;
    for (var s = 0; s < segments.length; s++) {
      var w = segments[s][0], e = segments[s][1];
      var width = e - w;
      var cols = Math.max(1, Math.ceil(width / maxSpan));
      var rows = Math.max(1, Math.ceil(height / maxSpan));
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          tiles.push({
            south: b.south + (height * r) / rows,
            north: b.south + (height * (r + 1)) / rows,
            west: w + (width * c) / cols,
            east: w + (width * (c + 1)) / cols
          });
        }
      }
    }
    return interleaveTiles(tiles);
  }

  function interleaveTiles(tiles) {
    if (tiles.length <= 2) return tiles.slice();
    var mid = Math.floor(tiles.length / 2);
    var out = [];
    var i = mid, step = 1, dir = 1, counted = 0;
    out.push(tiles[mid]);
    counted = 1;
    while (counted < tiles.length) {
      var idx = mid + step * dir;
      if (idx >= 0 && idx < tiles.length) {
        out.push(tiles[idx]);
        counted++;
      }
      if (dir < 0) step++;
      dir = -dir;
    }
    return out;
  }

  function haversine(a, b) {
    var R = 6371000;
    var r1 = a.lat * Math.PI / 180, r2 = b.lat * Math.PI / 180;
    var dlat = r2 - r1, dlon = (b.lon - a.lon) * Math.PI / 180;
    var h = Math.sin(dlat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dlon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function commonsThumb(image, width) {
    if (!image) return null;
    var raw = String(image);
    if (!/^https?:\/\//i.test(raw) && raw.indexOf("Special:FilePath") === -1 && raw.indexOf("/") === -1) {
      raw = "https://commons.wikimedia.org/wiki/Special:FilePath/" + raw;
    }
    var allowed = /^(https?:)?\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org)\//i;
    var file = raw;
    var m = raw.match(/Special:FilePath\/(.+?)(?:\?|$)/);
    if (m) file = decodeURIComponent(m[1]);
    else {
      var m2 = raw.match(/\/([^/]+\.(?:jpe?g|png|gif|webp|tif|svg))$/i);
      if (m2) file = decodeURIComponent(m2[1]);
    }
    file = file.replace(/^File:/i, "");
    var url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=" + (width || 800);
    if (!allowed.test(url)) return null;
    return url;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function directionsUrl(lat, lon) {
    if (isIOS()) return "https://maps.apple.com/?daddr=" + lat + "," + lon + "&dirflg=d";
    return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lon;
  }

  function loadFavorites() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); } catch (e) { /* quota */ }
  }

  function isFav(spot) {
    var k = spotKey(spot);
    return state.favorites.some(function (f) { return spotKey(f) === k; });
  }

  function toggleFav(spot) {
    var k = spotKey(spot);
    var idx = state.favorites.findIndex(function (f) { return spotKey(f) === k; });
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(spot);
    saveFavorites();
  }

  function spotKey(s) {
    if (s.qid) return "wd:" + s.qid;
    if (s.osmType && s.osmId) return "osm:" + s.osmType + "/" + s.osmId;
    return "geo:" + Number(s.lat).toFixed(5) + "," + Number(s.lon).toFixed(5);
  }

  function loadAI() {
    try { return JSON.parse(localStorage.getItem(AI_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function saveAI(obj) {
    try { localStorage.setItem(AI_KEY, JSON.stringify(obj)); } catch (e) { /* quota */ }
  }

  function abortableTimeout(ms, parent) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(new Error("timeout")); }, ms);
    if (parent) {
      parent.addEventListener("abort", function () {
        clearTimeout(t);
        ctrl.abort();
      });
    }
    return { signal: ctrl.signal, cancel: function () { clearTimeout(t); } };
  }

  async function fetchJson(url, opts, timeoutMs, parentSignal) {
    var wrap = abortableTimeout(timeoutMs || 20000, parentSignal);
    try {
      var res = await fetch(url, Object.assign({}, opts || {}, { signal: wrap.signal }));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      wrap.cancel();
    }
  }

  function setStatus(text, isError) {
    var el = $("status");
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
  }

  function showProgress(show, frac, label) {
    var box = $("progress");
    box.hidden = !show;
    if (show) {
      $("progress-fill").style.width = Math.round((frac || 0) * 100) + "%";
      $("progress-label").textContent = label || "";
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3800);
  }

  /* ---------- data: Nominatim ---------- */

  async function geocode(query, signal) {
    var wait = 1100 - (Date.now() - state.lastNominatim);
    if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(query);
    state.lastNominatim = Date.now();
    var data = await fetchJson(url, { headers: { Accept: "application/json" } }, 15000, signal);
    if (!data || !data.length) return null;
    var hit = data[0];
    var bb = hit.boundingbox;
    return {
      label: hit.display_name,
      lat: parseFloat(hit.lat),
      lon: parseFloat(hit.lon),
      addresstype: hit.addresstype || "",
      type: hit.type || "",
      cls: hit["class"] || "",
      placeRank: hit.place_rank,
      bbox: {
        south: parseFloat(bb[0]),
        north: parseFloat(bb[1]),
        west: parseFloat(bb[2]),
        east: parseFloat(bb[3])
      }
    };
  }

  /* ---------- data: Wikidata ---------- */

  function leanSparql(b) {
    var typeList = Object.keys(TYPE_INFO).map(function (q) { return "wd:" + q; }).join(" ");
    var useList = Object.keys(USE_VALUES).map(function (q) { return "wd:" + q; }).join(" ");
    return (
      "SELECT ?i ?coord ?t ?use ?image WHERE {\n" +
      "  SERVICE wikibase:box {\n" +
      "    ?i wdt:P625 ?coord .\n" +
      '    bd:serviceParam wikibase:cornerWest "Point(' + fmtNum(b.west) + " " + fmtNum(b.south) + ')"^^geo:wktLiteral .\n' +
      '    bd:serviceParam wikibase:cornerEast "Point(' + fmtNum(b.east) + " " + fmtNum(b.north) + ')"^^geo:wktLiteral .\n' +
      "  }\n" +
      "  {\n" +
      "    ?i wdt:P31 ?t .\n" +
      "    VALUES ?t { " + typeList + " }\n" +
      "  } UNION {\n" +
      "    ?i wdt:P5817 ?use .\n" +
      "    VALUES ?use { " + useList + " }\n" +
      "  }\n" +
      "  FILTER NOT EXISTS { ?i wdt:P576 ?dissolved }\n" +
      "  FILTER NOT EXISTS { ?i wdt:P5817 wd:" + DEMOLISHED_QID + " }\n" +
      "  FILTER NOT EXISTS { ?i wdt:P31 wd:Q19860854 }\n" +
      "  OPTIONAL { ?i wdt:P18 ?image . }\n" +
      "}\nLIMIT 300"
    );
  }

  function resolveType(tQid, useQid) {
    if (tQid && TYPE_INFO[tQid]) return TYPE_INFO[tQid];
    if (tQid && P31_FALLBACK[tQid]) {
      var id = P31_FALLBACK[tQid];
      return { id: id, label: CHIP_LABEL[id] || "Abandoned site" };
    }
    if (useQid && USE_VALUES[useQid]) {
      return { id: "abandoned-building", label: "Abandoned site" };
    }
    return { id: "abandoned-building", label: "Abandoned site" };
  }

  function parseWdBindings(bindings) {
    var byId = {};
    for (var i = 0; i < bindings.length; i++) {
      var row = bindings[i];
      var qid = qidFromUri(row.i && row.i.value);
      var pt = parsePoint(row.coord && row.coord.value);
      if (!qid || !pt) continue;
      var tQid = qidFromUri(row.t && row.t.value);
      var useQid = qidFromUri(row.use && row.use.value);
      var info = resolveType(tQid, useQid);
      var prev = byId[qid];
      if (prev && TYPE_INFO[prev.typeQid] && !TYPE_INFO[tQid]) continue;
      byId[qid] = {
        qid: qid,
        name: qid,
        description: "",
        lat: pt.lat,
        lon: pt.lon,
        typeId: info.id,
        typeLabel: info.label,
        typeQid: tQid || useQid,
        image: row.image ? commonsThumb(row.image.value, 800) : ((prev && prev.image) || null),
        wiki: null,
        source: "wikidata",
        sourceUrl: "https://www.wikidata.org/wiki/" + qid
      };
    }
    var out = [];
    Object.keys(byId).forEach(function (k) { out.push(byId[k]); });
    return out;
  }

  async function sparqlBox(bbox, timeout, signal) {
    var q = leanSparql(bbox);
    var url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(q) + "&format=json";
    var data = await fetchJson(url, {
      headers: { Accept: "application/sparql-results+json" }
    }, timeout || 20000, signal);
    return parseWdBindings((data.results && data.results.bindings) || []);
  }

  function yearFromText(val) {
    if (!val) return null;
    var m = String(val).match(/(\d{4})/);
    if (!m) return null;
    var y = parseInt(m[1], 10);
    return (y >= 1000 && y <= 2100) ? y : null;
  }

  function claimIds(claims, prop) {
    var out = [];
    var arr = (claims && claims[prop]) || [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] && arr[i].mainsnak && arr[i].mainsnak.datavalue && arr[i].mainsnak.datavalue.value;
      if (v && v.id) out.push(v.id);
    }
    return out;
  }

  function firstYear(claims, props) {
    for (var p = 0; p < props.length; p++) {
      var arr = (claims && claims[props[p]]) || [];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i] && arr[i].mainsnak && arr[i].mainsnak.datavalue && arr[i].mainsnak.datavalue.value;
        if (!v || !v.time) continue;
        var prec = v.precision == null ? 11 : v.precision;
        if (prec < 9) continue; /* need at least a year */
        var m = String(v.time).match(/^([+-])0*(\d+)/);
        if (!m) continue;
        var y = parseInt(m[2], 10);
        if (y) return y;
      }
    }
    return null;
  }

  async function enrichLabels(spots, signal) {
    var ids = [];
    var seen = {};
    spots.forEach(function (s) {
      if (s.qid && !seen[s.qid]) { seen[s.qid] = true; ids.push(s.qid); }
    });
    if (!ids.length) return;
    var info = {};
    var chunk = 50;
    for (var i = 0; i < ids.length; i += chunk) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      var batch = ids.slice(i, i + chunk);
      var url = "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" +
        batch.join("|") +
        "&format=json&props=labels|descriptions|sitelinks|claims&languages=en|mul&sitefilter=enwiki&origin=*";
      try {
        var data = await fetchJson(url, {}, 15000, signal);
        var ents = data.entities || {};
        Object.keys(ents).forEach(function (id) {
          var ent = ents[id];
          if (!ent || ent.missing) return;
          var label = (ent.labels && ((ent.labels.en && ent.labels.en.value) || (ent.labels.mul && ent.labels.mul.value))) || null;
          var desc = (ent.descriptions && ent.descriptions.en && ent.descriptions.en.value) || null;
          var wiki = null;
          if (ent.sitelinks && ent.sitelinks.enwiki && ent.sitelinks.enwiki.title) {
            wiki = "https://en.wikipedia.org/wiki/" + encodeURIComponent(ent.sitelinks.enwiki.title.replace(/ /g, "_"));
          }
          var claims = ent.claims || {};
          info[id] = {
            label: label,
            description: desc,
            wiki: wiki,
            yearBuilt: firstYear(claims, ["P571", "P1619", "P580"]),
            yearAbandoned: firstYear(claims, ["P3999", "P730", "P2669", "P582"]),
            p31: claimIds(claims, "P31")
          };
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        /* keep QIDs as names if this fails */
      }
    }
    spots.forEach(function (s) {
      var e = info[s.qid];
      if (!e) return;
      if (e.label) s.name = e.label;
      if (e.description) s.description = e.description;
      if (e.wiki) s.wiki = e.wiki;
      if (e.yearBuilt) s.yearBuilt = e.yearBuilt;
      if (e.yearAbandoned) s.yearAbandoned = e.yearAbandoned;
      if (e.p31 && e.p31.length) {
        var resolved = null;
        for (var pi = 0; pi < e.p31.length; pi++) {
          if (TYPE_INFO[e.p31[pi]]) { resolved = TYPE_INFO[e.p31[pi]]; break; }
        }
        if (!resolved) {
          for (var pj = 0; pj < e.p31.length; pj++) {
            if (P31_FALLBACK[e.p31[pj]]) {
              var id = P31_FALLBACK[e.p31[pj]];
              resolved = { id: id, label: CHIP_LABEL[id] || s.typeLabel };
              break;
            }
          }
        }
        if (resolved && (!TYPE_INFO[s.typeQid] || resolved.id !== s.typeId)) {
          if (!TYPE_INFO[s.typeQid]) {
            s.typeId = resolved.id;
            s.typeLabel = resolved.label;
            s.typeQid = s.typeQid || e.p31[0];
          }
        }
      }
    });
  }

  async function queryWikidata(bbox, signal, onProgress) {
    var tiles;
    if (shouldTile(bbox)) tiles = makeTiles(bbox, 10);
    else tiles = [bbox];

    var collected = [];
    var seen = {};
    var failed = [];

    async function runTile(tile, timeout) {
      var rows = await sparqlBox(tile, timeout, signal);
      var added = 0;
      for (var i = 0; i < rows.length; i++) {
        var k = rows[i].qid;
        if (seen[k]) continue;
        var maxPer = tiles.length > 8 ? 50 : tiles.length > 1 ? 120 : RESULT_CAP;
        var fromThis = rows.slice(0, i + 1).filter(function (r) { return true; });
        /* count already taken from this tile via added */
        if (added >= maxPer) break;
        if (collected.length >= RESULT_CAP) break;
        seen[k] = true;
        collected.push(rows[i]);
        added++;
      }
      return added;
    }

    if (tiles.length === 1) {
      try {
        if (onProgress) onProgress(0.15, "Querying Wikidata…");
        await runTile(tiles[0], 22000);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        tiles = makeTiles(bbox, 6);
      }
    }

    if (collected.length < RESULT_CAP && (tiles.length > 1 || !Object.keys(seen).length)) {
      if (tiles.length === 1) tiles = makeTiles(bbox, 6);
      var done = 0;
      var total = tiles.length;
      var cursor = 0;
      var workers = Math.min(2, total);

      async function worker() {
        while (cursor < tiles.length && collected.length < RESULT_CAP) {
          if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
          var idx = cursor++;
          var tile = tiles[idx];
          try {
            await runTile(tile, 20000);
          } catch (e) {
            if (e.name === "AbortError") throw e;
            var lat = tile.north - tile.south;
            var lon = tile.east - tile.west;
            if (lat > 4 || lon > 4) {
              var sub = makeTiles(tile, Math.max(lat, lon) / 2);
              for (var s = 0; s < sub.length; s++) tiles.push(sub[s]);
              total = tiles.length;
            } else {
              failed.push(tile);
            }
          }
          done++;
          if (onProgress) {
            onProgress(
              Math.min(0.9, done / Math.max(total, 1)),
              "Searching " + (state.searchLabel || "this area") + "… " +
                done + "/" + total + " regions · " + collected.length + " places"
            );
          }
        }
      }
      var wrk = [];
      for (var w = 0; w < workers; w++) wrk.push(worker());
      await Promise.all(wrk);
    }

    if (onProgress) onProgress(0.93, "Fetching names and descriptions…");
    await enrichLabels(collected, signal);
    return collected;
  }

  /* ---------- data: Overpass (best-effort, never blocks Wikidata) ---------- */

  function overpassQuery(b) {
    var s = fmtNum(b.south), w = fmtNum(b.west), n = fmtNum(b.north), e = fmtNum(b.east);
    var box = "(" + s + "," + w + "," + n + "," + e + ")";
    return (
      "[out:json][timeout:16];\n(" +
      'nwr["abandoned"="yes"]' + box + ";" +
      'nwr["historic"="ruins"]' + box + ";" +
      'nwr["ruins"="yes"]' + box + ";" +
      'nwr["building"="ruins"]' + box + ";" +
      'nwr["building"="abandoned"]' + box + ";" +
      'nwr["abandoned:amenity"]' + box + ";" +
      'nwr["abandoned:railway"]' + box + ";" +
      'nwr["abandoned:building"]' + box + ";" +
      'nwr["disused:amenity"]' + box + ";" +
      'nwr["disused:railway"]' + box + ";" +
      'nwr["disused:building"]' + box + ";" +
      ");out center 300;"
    );
  }

  function osmTypeOf(tags) {
    tags = tags || {};
    var amenity = tags.amenity || tags["abandoned:amenity"] || tags["disused:amenity"] || "";
    var building = tags.building || tags["abandoned:building"] || tags["disused:building"] || "";
    var landuse = tags.landuse || "";
    if (tags.historic === "ruins" || tags.ruins === "yes" || building === "ruins") {
      return { id: "ruins", label: "Ruins" };
    }
    if (amenity === "hospital" || amenity === "clinic") {
      return { id: "hospital", label: "Former hospital" };
    }
    if (amenity === "school" || amenity === "college" || amenity === "university" || building === "school") {
      return { id: "school", label: "Former school" };
    }
    if (amenity === "place_of_worship" || building === "church" || building === "chapel" || tags.historic === "church") {
      return { id: "church", label: "Abandoned church" };
    }
    if (landuse === "industrial" || building === "industrial" || building === "factory" || amenity === "power") {
      return { id: "factory", label: "Industrial site" };
    }
    if (tags.man_made === "mineshaft" || tags.historic === "mine" || landuse === "quarry") {
      return { id: "mine", label: "Abandoned mine" };
    }
    if (tags.tourism === "theme_park" || tags.leisure === "theme_park" || tags.leisure === "water_park") {
      return { id: "amusement-park", label: "Abandoned amusement park" };
    }
    if (tags["abandoned:railway"] || tags["disused:railway"] || tags.railway === "abandoned" || tags.railway === "disused" || tags.railway === "station") {
      return { id: "station", label: "Disused railway" };
    }
    if (building === "abandoned" || tags["abandoned:building"] || tags["disused:building"]) {
      return { id: "abandoned-building", label: "Abandoned building" };
    }
    if (tags["abandoned:amenity"] || tags["disused:amenity"] || tags.abandoned === "yes") {
      return { id: "abandoned-building", label: "Abandoned site" };
    }
    return { id: "abandoned-building", label: "OpenStreetMap site" };
  }

  function parseOverpass(data) {
    var els = (data && data.elements) || [];
    var out = [];
    for (var i = 0; i < els.length && out.length < RESULT_CAP; i++) {
      var el = els[i];
      var lat = el.lat, lon = el.lon;
      if (el.center) { lat = el.center.lat; lon = el.center.lon; }
      if (lat == null || lon == null) continue;
      var tags = el.tags || {};
      var t = osmTypeOf(tags);
      var name = tags.name || tags["name:en"] || tags.ref || t.label;
      out.push({
        osmType: el.type,
        osmId: el.id,
        name: name,
        description: tags.description || tags.note || "",
        lat: lat,
        lon: lon,
        typeId: t.id,
        typeLabel: t.label,
        yearBuilt: yearFromText(tags.start_date || tags["building:date"] || tags.opened),
        yearAbandoned: yearFromText(tags.end_date || tags.closed || tags.disused),
        image: null,
        wiki: tags.wikipedia && tags.wikipedia.indexOf("en:") === 0
          ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(tags.wikipedia.slice(3).replace(/ /g, "_"))
          : null,
        source: "osm",
        sourceUrl: "https://www.openstreetmap.org/" + el.type + "/" + el.id
      });
    }
    return out;
  }

  async function queryOverpass(bbox, parentSignal) {
    var q = overpassQuery(bbox);
    var lastErr = null;
    var list = OVERPASS_ENDPOINTS.slice();
    if (overpassLastGood) {
      list = [overpassLastGood].concat(list.filter(function (e) { return e !== overpassLastGood; }));
    }
    for (var i = 0; i < list.length; i++) {
      if (parentSignal && parentSignal.aborted) throw new DOMException("Aborted", "AbortError");
      var ep = list[i];
      var ctrl = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        try { ctrl.abort(); } catch (err) { /* */ }
      }, 16000);
      function onParentAbort() {
        try { ctrl.abort(); } catch (err) { /* */ }
      }
      if (parentSignal) parentSignal.addEventListener("abort", onParentAbort);
      try {
        var res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: "data=" + encodeURIComponent(q),
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var data = await res.json();
        overpassLastGood = ep;
        return parseOverpass(data);
      } catch (e) {
        /* Parent cancelled the search: stop. Per-endpoint timeout, CORS,
           TypeError (failed to fetch), and HTTP errors: try the next host. */
        var parentAborted = parentSignal && parentSignal.aborted;
        if (parentAborted) throw new DOMException("Aborted", "AbortError");
        lastErr = timedOut ? new Error("timeout " + ep) : e;
      } finally {
        clearTimeout(timer);
        if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
    throw lastErr || new Error("Overpass unavailable");
  }

  function mergeSpots(wd, osm) {
    var out = wd.slice();
    var keys = {};
    out.forEach(function (s) { keys[spotKey(s)] = s; });
    (osm || []).forEach(function (s) {
      var dup = out.some(function (w) {
        return haversine(w, s) < 80 && namesClose(w.name, s.name);
      });
      if (dup) return;
      if (keys[spotKey(s)]) return;
      out.push(s);
    });
    return out;
  }

  function namesClose(a, b) {
    a = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    b = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!a || !b) return true;
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  /* ---------- map ---------- */

  function mapboxUrl(style) {
    return "https://api.mapbox.com/styles/v1/mapbox/" + style +
      "/tiles/512/{z}/{x}/{y}@2x?access_token=" + encodeURIComponent(MAPBOX_TOKEN);
  }

  var MAPBOX_ATTR =
    '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
    '<a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener">Improve this map</a>';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var ESRI_ATTR =
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
  var CARTO_ATTR =
    OSM_ATTR + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

  function makeMapboxLayer(style, maxZoom) {
    return L.tileLayer(mapboxUrl(style), {
      tileSize: 512,
      zoomOffset: -1,
      attribution: MAPBOX_ATTR,
      maxZoom: maxZoom || 22,
      crossOrigin: true
    });
  }

  function initMap() {
    var map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 2
    }).setView([24, 8], 3);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    var osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: OSM_ATTR,
      maxZoom: 19
    });
    var esri = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: ESRI_ATTR, maxZoom: 19 }
    );
    var carto = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: CARTO_ATTR, maxZoom: 20, subdomains: "abcd" }
    );
    var esriLabels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Labels &copy; Esri", maxZoom: 19, pane: "overlayPane" }
    );

    var bases = [];
    if (MAPBOX_TOKEN) {
      var mbStreets = makeMapboxLayer("streets-v12");
      var mbSat = makeMapboxLayer("satellite-streets-v12");
      var mbOut = makeMapboxLayer("outdoors-v12");
      var mbDark = makeMapboxLayer("dark-v11");
      bases.push(
        { id: "mb-streets", title: "Mapbox Streets", layer: mbStreets, mapbox: true, fallback: "osm" },
        { id: "mb-sat", title: "Mapbox Satellite Streets", layer: mbSat, mapbox: true, fallback: "esri" },
        { id: "mb-out", title: "Mapbox Outdoors", layer: mbOut, mapbox: true, fallback: "osm" },
        { id: "mb-dark", title: "Mapbox Dark", layer: mbDark, mapbox: true, fallback: "carto" }
      );
      watchMapbox(mbStreets, "osm");
      watchMapbox(mbSat, "esri");
      watchMapbox(mbOut, "osm");
      watchMapbox(mbDark, "carto");
    }
    bases.push(
      { id: "osm", title: "OpenStreetMap", layer: osm, mapbox: false },
      { id: "esri", title: "Esri World Imagery", layer: esri, mapbox: false },
      { id: "carto", title: "CARTO Dark", layer: carto, mapbox: false }
    );

    bases.forEach(function (b) { state.bases[b.id] = b; });
    state.overlays.labels = esriLabels;
    state.baseList = bases;
    state.map = map;

    var initial = MAPBOX_TOKEN ? "mb-dark" : "osm";
    setBase(initial, true);

    state.cluster = L.markerClusterGroup({
      maxClusterRadius: 48,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount();
        var size = n < 10 ? 36 : n < 50 ? 44 : 54;
        return L.divIcon({
          html: "<span>" + n + "</span>",
          className: "v-cluster",
          iconSize: [size, size]
        });
      }
    });
    map.addLayer(state.cluster);

    buildLayerMenu();
    setTimeout(function () { map.invalidateSize(); }, 200);
    window.addEventListener("resize", function () {
      map.invalidateSize();
      applyPhoneChrome();
    });
  }

  function watchMapbox(layer, fallbackId) {
    layer.on("tileerror", function () {
      if (state.mapboxDisabled) return;
      state.mapboxErrors += 1;
      if (state.mapboxErrors >= 6) {
        state.mapboxDisabled = true;
        if (state.activeBase && state.bases[state.activeBase] && state.bases[state.activeBase].mapbox) {
          setBase(fallbackId || "osm");
          toast("Mapbox tiles are unavailable, so the map switched to a free fallback.");
          buildLayerMenu();
        }
      }
    });
  }

  function setBase(id, silent) {
    if (state.mapboxDisabled && state.bases[id] && state.bases[id].mapbox) {
      id = state.bases[id].fallback || "osm";
    }
    var next = state.bases[id];
    if (!next) return;
    if (state.activeBase && state.bases[state.activeBase]) {
      state.map.removeLayer(state.bases[state.activeBase].layer);
    }
    next.layer.addTo(state.map);
    next.layer.bringToBack();
    state.activeBase = id;
    var logo = $("mapbox-logo");
    if (logo) logo.hidden = !next.mapbox || state.mapboxDisabled;
    if (!silent) buildLayerMenu();
  }

  function buildLayerMenu() {
    var menu = $("layer-menu");
    var html = "<h3>Base map</h3>";
    state.baseList.forEach(function (b) {
      if (b.mapbox && state.mapboxDisabled) return;
      var on = state.activeBase === b.id;
      html += '<button type="button" class="layer-option" role="menuitemradio" aria-checked="' +
        (on ? "true" : "false") + '" data-base="' + esc(b.id) + '">' +
        (on ? "● " : "○ ") + esc(b.title) + "</button>";
    });
    html += "<hr><h3>Overlay</h3>";
    var labOn = state.map && state.map.hasLayer(state.overlays.labels);
    html += '<button type="button" class="layer-toggle" role="menuitemcheckbox" aria-checked="' +
      (labOn ? "true" : "false") + '" data-overlay="labels">' +
      (labOn ? "☑ " : "☐ ") + "Esri place labels</button>";
    menu.innerHTML = html;
  }

  function pinIcon(active, typeId) {
    var tid = typeId || "abandoned-building";
    return L.divIcon({
      className: "",
      html: '<div class="v-pin' + (active ? " is-active" : "") + '" data-type="' + tid + '"><span></span></div>',
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -30]
    });
  }

  function renderMarkers(spots) {
    state.cluster.clearLayers();
    state.markers = {};
    spots.forEach(function (s) {
      var m = L.marker([s.lat, s.lon], {
        icon: pinIcon(state.selected && spotKey(state.selected) === spotKey(s), s.typeId),
        title: s.name,
        alt: s.name
      });
      m.on("click", function () { openDetail(s, true); });
      state.markers[spotKey(s)] = m;
      state.cluster.addLayer(m);
    });
  }

  function fitToSpots(spots, bbox) {
    if (!spots.length) {
      if (bbox) {
        state.map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]], fitPad());
      }
      return;
    }
    var g = L.latLngBounds(spots.map(function (s) { return [s.lat, s.lon]; }));
    state.map.fitBounds(g, Object.assign({ maxZoom: 13 }, fitPad()));
  }

  function fitPad() {
    if (isPhone()) return { paddingTopLeft: [16, 150], paddingBottomRight: [16, 200] };
    return { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24] };
  }

  /* ---------- search orchestration ---------- */

  async function runSearch(opts) {
    opts = opts || {};
    if (state.abort) state.abort.abort();
    var ctrl = new AbortController();
    state.abort = ctrl;
    $("btn-cancel").hidden = false;

    var label = opts.label || "";
    var bbox = opts.bbox;
    state.searchLabel = label;
    state.continentId = opts.continentId || null;
    state.selected = null;
    closeDetail();
    state.spots = [];
    renderAll();
    setStatus("Looking up " + (label || "this area") + "…");
    showProgress(true, 0.05, "Starting search…");
    $("filters").hidden = true;
    $("results-heading").textContent = label ? "Searching " + label : "Searching…";
    if (isPhone()) snapSheet("mid");

    try {
      if (!bbox && opts.query) {
        var geo = await geocode(opts.query, ctrl.signal);
        if (!geo) {
          setStatus("No place called “" + (opts.query) + "” turned up. Try a city, region, or country.", true);
          showProgress(false);
          $("btn-cancel").hidden = true;
          state.spots = [];
          renderAll();
          return;
        }
        bbox = searchAreaBBox(geo);
        label = geo.label;
        state.searchLabel = label;
      }
      if (!bbox) throw new Error("No area to search");
      state.bbox = bbox;
      state.map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]], fitPad());

      var lonSpan = bbox.east - bbox.west;
      if (lonSpan < 0) lonSpan += 360;
      var latSpan = bbox.north - bbox.south;
      var smallEnoughForOverpass = latSpan < 5 && lonSpan < 5;

      var wdPromise = queryWikidata(bbox, ctrl.signal, function (frac, msg) {
        showProgress(true, frac, msg);
        setStatus(msg);
      });

      var osmPromise = null;
      if (smallEnoughForOverpass) {
        osmPromise = queryOverpass(bbox, ctrl.signal).catch(function () { return []; });
      }

      var wd = await wdPromise;
      var spots = wd;
      showProgress(false);
      renderSpots(spots, bbox, label, { partial: !!osmPromise });

      if (osmPromise) {
        setStatus((spots.length ? spots.length + " place" + (spots.length === 1 ? "" : "s") + " from Wikidata. " : "") + "Checking OpenStreetMap…");
        var osm = await osmPromise;
        if (state.abort !== ctrl) return;
        spots = mergeSpots(wd, osm);
        renderSpots(spots, bbox, label, { osmCount: osm.length });
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setStatus("Search cancelled.");
      } else {
        console.error(e);
        setStatus("Could not finish that search. " + (e.message || "Please try again."), true);
      }
    } finally {
      showProgress(false);
      $("btn-cancel").hidden = true;
    }
  }

  function renderSpots(spots, bbox, label, extra) {
    extra = extra || {};
    state.spots = spots;
    $("filters").hidden = spots.length === 0 && state.typeFilter === "all";
    if (spots.length) $("filters").hidden = false;
    var bits = [];
    if (label) bits.push(label.split(",")[0]);
    bits.push(spots.length + " place" + (spots.length === 1 ? "" : "s"));
    if (extra.osmCount) bits.push(extra.osmCount + " from OpenStreetMap");
    if (spots.length >= RESULT_CAP) bits.push("showing the first " + RESULT_CAP);
    setStatus(bits.join(" · "));
    var continent = CONTINENTS.some(function (c) { return c.name === (label || "").split(",")[0] || c.id === state.continentId; });
    $("results-heading").textContent = label ? ((continent ? "Places in " : "Places near ") + label.split(",")[0]) : "Forgotten places";
    renderAll();
    var visible = filteredSpots();
    if (!extra.partial) fitToSpots(visible, bbox);
  }

  function filteredSpots() {
    var list = state.spots;
    if (state.typeFilter === "favorites") {
      var keys = {};
      state.favorites.forEach(function (f) { keys[spotKey(f)] = true; });
      list = state.spots.filter(function (s) { return keys[spotKey(s)]; });
      if (!state.spots.length) list = state.favorites.slice();
    } else if (state.typeFilter !== "all") {
      list = list.filter(function (s) { return s.typeId === state.typeFilter; });
    }
    var q = state.textFilter.trim().toLowerCase();
    if (q) {
      list = list.filter(function (s) {
        return (s.name || "").toLowerCase().indexOf(q) >= 0 ||
          (s.description || "").toLowerCase().indexOf(q) >= 0 ||
          (s.typeLabel || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function allTypeCounts() {
    var counts = { all: state.spots.length, favorites: 0 };
    var keys = {};
    state.favorites.forEach(function (f) { keys[spotKey(f)] = true; });
    state.spots.forEach(function (s) {
      counts[s.typeId] = (counts[s.typeId] || 0) + 1;
      if (keys[spotKey(s)]) counts.favorites++;
    });
    if (!state.spots.length) counts.favorites = state.favorites.length;
    return counts;
  }

  /* Chip / pin type ids — exact selectors used in style.css .v-pin[data-type="..."] */
  var CHIP_DEFS = [
    { id: "all", label: "All" },
    { id: "favorites", label: "Favorites" },
    { id: "abandoned-building", label: "Buildings" },
    { id: "factory", label: "Industrial" },
    { id: "mine", label: "Mines" },
    { id: "hospital", label: "Hospitals" },
    { id: "school", label: "Schools" },
    { id: "church", label: "Churches" },
    { id: "ghost-town", label: "Ghost towns" },
    { id: "abandoned-village", label: "Villages" },
    { id: "ruins", label: "Ruins" },
    { id: "station", label: "Stations" },
    { id: "amusement-park", label: "Amusement parks" }
  ];

  function renderAll() {
    var counts = allTypeCounts();
    var chips = $("type-chips");
    chips.innerHTML = CHIP_DEFS.filter(function (c) {
      return c.id === "all" || c.id === "favorites" || counts[c.id];
    }).map(function (c) {
      var on = state.typeFilter === c.id;
      var n = counts[c.id] || 0;
      var dot = (c.id !== "all" && c.id !== "favorites")
        ? '<span class="type-dot" style="--pin:' + typeColor(c.id) + '"></span>'
        : "";
      return '<button type="button" class="chip' + (on ? " is-on" : "") +
        '" aria-pressed="' + (on ? "true" : "false") + '" data-type="' + c.id + '">' +
        dot + esc(c.label) + (c.id !== "all" ? " " + n : n ? " " + n : "") + "</button>";
    }).join("");
    renderLegend(counts);

    var list = filteredSpots();
    renderMarkers(list);
    var ul = $("results");
    if (!list.length) {
      var emptyTitle = "No places yet";
      var emptyBody = "Search a city, region, or country, or pick a continent. Results come from Wikidata and OpenStreetMap.";
      if (state.spots.length && state.typeFilter === "favorites") {
        emptyTitle = "No favorites in this view";
        emptyBody = "Tap the star on a place to save it on this device.";
      } else if (state.spots.length) {
        emptyTitle = "Nothing matches that filter";
        emptyBody = "Clear the text filter or pick another type.";
      } else if (state.typeFilter === "favorites" && state.favorites.length) {
        list = state.favorites;
      }
      if (!list.length) {
        ul.innerHTML = '<li class="empty"><h3>' + esc(emptyTitle) + "</h3><p>" + esc(emptyBody) + "</p></li>";
        return;
      }
    }
    ul.innerHTML = list.map(function (s) {
      var sel = state.selected && spotKey(state.selected) === spotKey(s);
      var thumb;
      if (s.image) {
        thumb = '<div class="result-thumb"><img src="' + esc(s.image) + '" alt="" loading="lazy"></div>';
      } else {
        thumb = '<div class="result-thumb">No photo</div>';
      }
      return '<li class="result' + (sel ? " is-selected" : "") + '" tabindex="0" role="button" data-key="' +
        esc(spotKey(s)) + '">' +
        thumb +
        '<div class="result-body"><span class="entry-no">' + esc(entryNoLabel(s, list)) + "</span>" +
        '<span class="type-tag"><span class="type-dot" style="--pin:' +
        typeColor(s.typeId) + '"></span>' + esc(s.typeLabel) + "</span>" +
        (s.yearAbandoned || s.yearBuilt ? " " + recordYearHTML(s) : "") +
        "<h3>" + esc(s.name) + "</h3>" +
        (s.description ? "<p>" + esc(s.description) + "</p>" : "") +
        "</div>" +
        '<button type="button" class="fav-btn' + (isFav(s) ? " is-on" : "") +
        '" aria-label="' + (isFav(s) ? "Remove from favorites" : "Save to favorites") +
        '" data-fav="' + esc(spotKey(s)) + '">' + (isFav(s) ? "★" : "☆") + "</button>" +
        "</li>";
    }).join("");
  }

  function renderLegend(counts) {
    counts = counts || {};
    var el = $("type-legend");
    if (!el) {
      el = document.createElement("details");
      el.id = "type-legend";
      el.className = "type-legend";
      var cap = document.createElement("summary");
      cap.textContent = "Map colors";
      el.appendChild(cap);
      var list = document.createElement("ul");
      list.id = "legend-list";
      list.style.cssText = "list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px 12px;";
      el.appendChild(list);
      el.style.cssText = "padding:0 18px 10px;font-size:12px;color:inherit;";
      var filters = $("filters");
      if (filters && filters.parentNode) filters.parentNode.insertBefore(el, filters.nextSibling);
    }
    if (!isPhone()) el.open = true;
    var list = $("legend-list");
    if (!list) return;
    var items = CHIP_DEFS.filter(function (c) {
      return c.id !== "all" && c.id !== "favorites" && (counts[c.id] || !state.spots.length);
    });
    if (!items.length) items = CHIP_DEFS.filter(function (c) { return c.id !== "all" && c.id !== "favorites"; });
    list.innerHTML = items.map(function (c) {
      return '<li style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">' +
        '<span class="type-dot" style="--pin:' + typeColor(c.id) + '"></span>' +
        esc(c.label) + "</li>";
    }).join("");
  }

  function findSpot(key) {
    var all = state.spots.concat(state.favorites);
    for (var i = 0; i < all.length; i++) {
      if (spotKey(all[i]) === key) return all[i];
    }
    return null;
  }

  /* ---------- detail ---------- */

  function entryNoLabel(spot, list) {
    list = list || filteredSpots();
    var idx = -1, i;
    for (i = 0; i < list.length; i++) {
      if (spotKey(list[i]) === spotKey(spot)) { idx = i; break; }
    }
    if (idx < 0) {
      for (i = 0; i < state.spots.length; i++) {
        if (spotKey(state.spots[i]) === spotKey(spot)) { idx = i; break; }
      }
    }
    if (idx < 0) return "";
    return "No. " + String(idx + 1).padStart(3, "0");
  }

  function recordYearHTML(spot) {
    var parts = [];
    if (spot.yearAbandoned) parts.push('<span class="record-year">Abandoned ' + esc(String(spot.yearAbandoned)) + "</span>");
    if (spot.yearBuilt) parts.push('<span class="record-year">Built ' + esc(String(spot.yearBuilt)) + "</span>");
    return parts.join(" ");
  }


  /* ---------- layer history (iOS edge-swipe / Android back) ---------- */

  var layerStack = [];

  function reduceMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  function pushLayer(id) {
    if (layerStack[layerStack.length - 1] === id) return;
    layerStack.push(id);
    try { history.pushState({ vestige: id, n: layerStack.length }, ""); } catch (e) { /* */ }
  }

  function hideLayer(id) {
    var el, card;
    if (id === "detail") {
      el = $("detail");
      el.hidden = true;
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transition = "";
      el.classList.remove("is-dragging");
      if (state.selected) {
        var prev = state.selected;
        state.selected = null;
        var m = state.markers[spotKey(prev)];
        if (m) m.setIcon(pinIcon(false, prev.typeId));
        renderAll();
      } else if ($("detail-body")) {
        $("detail-body").innerHTML = "";
      }
    } else if (id === "chat") {
      el = $("chat");
      el.hidden = true;
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transition = "";
      el.style.paddingBottom = "";
      el.classList.remove("is-dragging");
      $("chat-fab").setAttribute("aria-expanded", "false");
      if (state.typeFilter === "favorites") setTab("favorites");
      else setTab("search");
    } else if (id === "modal") {
      el = $("modal");
      el.hidden = true;
      card = el.querySelector(".modal-card");
      if (card) {
        card.style.transform = "";
        card.style.opacity = "";
        card.style.transition = "";
        card.classList.remove("is-dragging");
      }
      $("modal-body").innerHTML = "";
    }
  }

  function dismissLayer(id) {
    if (layerStack[layerStack.length - 1] === id) {
      try { history.back(); return; } catch (e) { /* fall through */ }
    }
    var i = layerStack.lastIndexOf(id);
    if (i >= 0) layerStack.splice(i, 1);
    hideLayer(id);
  }

  window.addEventListener("popstate", function () {
    if (!layerStack.length) return;
    hideLayer(layerStack.pop());
  });

  function openDetail(spot, fromMap) {
    state.selected = spot;
    renderAll();
    var m = state.markers[spotKey(spot)];
    if (m) {
      m.setIcon(pinIcon(true, spot.typeId));
      if (fromMap) { /* already on map */ }
      else {
        state.map.flyTo([spot.lat, spot.lon], Math.max(state.map.getZoom(), 13), { duration: reduceMotion() ? 0 : 0.7 });
        if (m.getElement) { /* ok */ }
      }
    }
    var body = $("detail-body");
    var photo = spot.image
      ? '<img class="detail-photo" src="' + esc(spot.image) + '" alt="Photo of ' + esc(spot.name) + '">'
      : "";
    var q = encodeURIComponent(spot.name);
    var qUrbex = encodeURIComponent(spot.name + " urbex abandoned");
    var wikiOrSource = spot.wiki || spot.sourceUrl;
    var sourceLabel = spot.wiki ? "Wikipedia" : (spot.source === "osm" ? "OpenStreetMap" : "Wikidata");
    var dir = directionsUrl(spot.lat, spot.lon);
    var dirLabel = isIOS() ? "Directions in Apple Maps" : "Directions in Google Maps";

    body.innerHTML =
      photo +
      '<h2 id="detail-title">' + esc(spot.name) + "</h2>" +
      '<p class="detail-meta"><span class="entry-no">' + esc(entryNoLabel(spot)) + "</span>" +
      '<span class="type-tag">' + esc(spot.typeLabel) + "</span> " +
      recordYearHTML(spot) + "</p>" +
      (spot.description ? '<p class="detail-desc">' + esc(spot.description) + "</p>" : "") +
      '<p class="coords">' + esc(Number(spot.lat).toFixed(5) + ", " + Number(spot.lon).toFixed(5)) + "</p>" +
      '<div class="btn-row">' +
        '<a class="btn btn-primary" href="' + esc(dir) + '" target="_blank" rel="noopener noreferrer">' + esc(dirLabel) + "</a>" +
        '<button type="button" class="btn" id="detail-fav">' + (isFav(spot) ? "★ Saved" : "☆ Save") + "</button>" +
        (wikiOrSource ? '<a class="btn" href="' + esc(wikiOrSource) + '" target="_blank" rel="noopener noreferrer">' + esc(sourceLabel) + "</a>" : "") +
        (spot.qid ? '<a class="btn" href="https://www.wikidata.org/wiki/' + esc(spot.qid) + '" target="_blank" rel="noopener noreferrer">Wikidata</a>' : "") +
        (spot.source === "osm" ? '<a class="btn" href="' + esc(spot.sourceUrl) + '" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' : "") +
      "</div>" +
      '<div class="research"><h3>Research more</h3><div class="research-links">' +
        '<a href="https://www.atlasobscura.com/search?q=' + q + '" target="_blank" rel="noopener noreferrer">Atlas Obscura</a>' +
        '<a href="https://www.reddit.com/r/urbanexploration/search/?q=' + q + '&restrict_sr=1" target="_blank" rel="noopener noreferrer">Reddit r/urbanexploration</a>' +
        '<a href="https://www.28dayslater.co.uk/search/?q=' + q + '" target="_blank" rel="noopener noreferrer">28 Days Later</a>' +
        '<a href="https://www.youtube.com/results?search_query=' + qUrbex + '" target="_blank" rel="noopener noreferrer">YouTube</a>' +
        '<a href="https://www.google.com/search?q=' + qUrbex + '" target="_blank" rel="noopener noreferrer">Google</a>' +
      "</div></div>" +
      '<div class="safety"><h3>Safety &amp; the law</h3><p>' + esc(SAFETY_TEXT) + "</p></div>" +
      '<div class="sources"><h3>Source</h3><p>Drawn from open data' +
        (spot.source === "osm" ? " on OpenStreetMap (ODbL)." : " on Wikidata (CC0) and, where linked, Wikipedia.") +
        " Locations can be outdated or on private land.</p></div>";

    $("detail").hidden = false;
    $("detail").style.transform = "";
    $("detail").style.opacity = "";
    $("detail").style.transition = "";
    $("detail").classList.remove("is-dragging");
    $("detail-fav").addEventListener("click", function () {
      toggleFav(spot);
      openDetail(spot, false);
    });
    pushLayer("detail");
    if (isPhone()) snapSheet("peek");
  }

  function closeDetail() { dismissLayer("detail"); }

  /* ---------- chat ---------- */

  function chatContext() {
    var parts = [];
    if (state.searchLabel) parts.push("The user is looking at: " + state.searchLabel + ".");
    if (state.spots.length) parts.push(state.spots.length + " places are currently listed.");
    if (state.selected) {
      parts.push(
        "Currently selected place: " + state.selected.name +
        " (" + state.selected.typeLabel + "). " +
        (state.selected.description || "") +
        " Coordinates: " + state.selected.lat + ", " + state.selected.lon + "."
      );
    }
    return parts.join(" ");
  }

  function openChat() {
    var chat = $("chat");
    if (!chat) return;
    chat.hidden = false;
    chat.removeAttribute("hidden");
    chat.style.transform = "";
    chat.style.opacity = "";
    chat.style.transition = "";
    chat.classList.remove("is-dragging");
    var fab = $("chat-fab");
    if (fab) fab.setAttribute("aria-expanded", "true");
    setTab("guide");
    if (!state.chat.length) {
      try {
        pushGuide(
          "Hi — I am the Urbex Guide. Ask me about gear, photography, history, or staying safe. " +
          "I will only help with legal, permitted visits. I will not help anyone break in or evade security." +
          (state.selected ? " I can see you have “" + state.selected.name + "” open." : "")
        );
      } catch (err) { console.error(err); }
    }
    var log = $("chat-log");
    if (log) log.scrollTop = log.scrollHeight;
    if (isPhone()) {
      var tab = $("tabbar");
      var th = tab && getComputedStyle(tab).display !== "none" ? tab.getBoundingClientRect().height : 0;
      chat.style.paddingBottom = th ? th + "px" : "";
    } else {
      chat.style.paddingBottom = "";
    }
    var input = $("chat-input");
    if (input) {
      try { input.focus(); } catch (err) { /* mobile browsers may ignore */ }
    }
    pushLayer("chat");
  }

  function closeChat() { dismissLayer("chat"); }

  function pushBubble(role, text, cls) {
    state.chat.push({ role: role, text: text });
    var log = $("chat-log");
    var div = document.createElement("div");
    div.className = "bubble " + (cls || role);
    if (role === "guide" || role === "error") div.innerHTML = renderLite(text);
    else div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function pushGuide(text) { return pushBubble("guide", text, "guide"); }

  function renderLite(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^### (.+)$/gm, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  async function sendChat(text) {
    if (state.chatBusy) return;
    text = String(text || "").trim();
    if (!text) return;
    pushBubble("user", text, "user");
    $("chat-input").value = "";
    autoGrow($("chat-input"));
    state.chatBusy = true;
    $("chat-send").disabled = true;
    var thinking = document.createElement("div");
    thinking.className = "bubble guide thinking";
    thinking.textContent = "Thinking…";
    $("chat-log").appendChild(thinking);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;

    var messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: "Context for this session: " + (chatContext() || "No place is selected yet.") }
    ];
    state.chat.forEach(function (m) {
      if (m.role === "user") messages.push({ role: "user", content: m.text });
      else if (m.role === "guide") messages.push({ role: "assistant", content: m.text });
    });

    try {
      var reply = await completeChat(messages);
      thinking.remove();
      if (reply && reply.offline) {
        pushGuide(reply.text);
      } else {
        pushGuide(typeof reply === "string" ? reply : (reply && reply.text) || "");
      }
    } catch (e) {
      console.error(e);
      thinking.remove();
      var off = offlineGuideReply(messages);
      pushGuide(off.text);
    } finally {
      state.chatBusy = false;
      $("chat-send").disabled = false;
    }
  }

  var OFFLINE_NOTE =
    "\n\n— Offline guide (the live AI is unavailable). For a smarter chat, add your own API key in Settings.";

  function openaiContent(data) {
    var c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof data === "string" && data.trim() && data.trim()[0] !== "{") return data.trim();
    return "";
  }

  function lastUserText(messages) {
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === "user") return String(messages[i].content || "");
    }
    return "";
  }

  async function fetchTimed(url, opts, ms) {
    var wrap = abortableTimeout(ms || 14000);
    try {
      var res = await fetch(url, Object.assign({}, opts || {}, { signal: wrap.signal }));
      return res;
    } finally {
      wrap.cancel();
    }
  }

  async function completeUserAI(messages, ai) {
    var root = String(ai.baseUrl).replace(/\/$/, "");
    if (!/\/chat\/completions$/.test(root)) root += "/chat/completions";
    var res = await fetchTimed(root, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ai.apiKey
      },
      body: JSON.stringify({
        model: ai.model || "gpt-4o-mini",
        messages: messages
      })
    }, 18000);
    if (!res.ok) throw new Error("AI HTTP " + res.status);
    var content = openaiContent(await res.json());
    if (!content) throw new Error("empty");
    return content;
  }

  /* Keyless: POST OpenAI-compatible Pollinations endpoint. */
  async function completePollinationsPost(messages) {
    var res = await fetchTimed("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        referrer: (typeof location !== "undefined" && location.origin) || "https://hamzasalahuddin46-ai.github.io",
        messages: messages
      })
    }, 16000);
    if (res.status === 403) throw new Error("Pollinations Turnstile 403");
    if (!res.ok) throw new Error("Pollinations POST HTTP " + res.status);
    var content = openaiContent(await res.json());
    if (!content) throw new Error("empty");
    return content;
  }

  /* Keyless: GET variant (system prompt + last user message in the URL). */
  async function completePollinationsGet(messages) {
    var user = lastUserText(messages) || "Give a short urbex safety reminder.";
    var sysParts = [];
    messages.forEach(function (m) {
      if (m.role === "system") sysParts.push(m.content);
    });
    var sys = sysParts.join(" ").slice(0, 1200);
    var url = "https://text.pollinations.ai/" + encodeURIComponent(user.slice(0, 1200)) +
      "?model=openai&referrer=" + encodeURIComponent((typeof location !== "undefined" && location.origin) || "") +
      (sys ? "&system=" + encodeURIComponent(sys) : "");
    var res = await fetchTimed(url, { method: "GET" }, 16000);
    if (res.status === 403) throw new Error("Pollinations GET Turnstile 403");
    if (res.status === 402) throw new Error("Pollinations GET rate limit");
    if (!res.ok) throw new Error("Pollinations GET HTTP " + res.status);
    var ct = (res.headers.get("content-type") || "");
    if (/json/i.test(ct)) {
      var content = openaiContent(await res.json());
      if (content) return content;
      throw new Error("empty json");
    }
    var text = (await res.text()).trim();
    if (!text || /^Free limit reached|^error/i.test(text)) throw new Error(text.slice(0, 120) || "empty");
    return text;
  }

  function isDisallowedAsk(q) {
    q = String(q || "").toLowerCase();
    return /break\s*in|breaking\s*in|bypass(?:ing)? (?:the )?(?:lock|alarm|security|camera|cctv)|pick(?:ing)? (?:a |the )?lock|evade (?:security|guards?|cops|police)|disable (?:the )?(?:alarm|camera|cctv|lock)|how (?:do i|to|can i) (?:trespass|sneak (?:in|into)|get in(?:side|to)?(?: the)?(?: building|site|place|compound)?)|cut(?:ting)? (?:the )?(?:lock|fence|chain)|bolt\s*cutter|avoid (?:the )?(?:cops|police|security|guards?)|forced entry|jimmy(?:ing)? (?:the )?(?:door|lock|window)|crowbar (?:the|a) (?:door|window|gate)/i.test(q);
  }

  function offlineGuideReply(messages) {
    var q = lastUserText(messages);
    var ql = q.toLowerCase();
    var spot = state.selected;
    var text;

    if (isDisallowedAsk(q)) {
      text =
        "I can’t help with breaking in, bypassing locks or alarms, evading security, or anything else that’s illegal. " +
        "Those things can get people hurt or arrested. " +
        "Legal ways to enjoy a place like this: look for a licensed tour or open-house, visit museums and preserved ruins, " +
        "and photograph from public rights of way. If you have permission from the owner, go with a buddy, tell someone your plans, and stay out of unsafe structures.";
    } else if (/\b(gear|kit|pack|bring|flashlight|torch|headlamp|boots|respirator|mask|gloves|ppe|equipment|what (should|to) (i )?(wear|take|pack|bring))\b/i.test(ql)) {
      text =
        "For a legal, permitted visit, keep the kit simple and safety-first: a reliable headlamp plus a backup light, sturdy boots with good grip, gloves, and a dust mask or respirator if the site may have debris or fibers (many old buildings can have asbestos — don’t disturb dusty materials). " +
        "Add water, a charged phone, a small first-aid kit, and a reflective layer. " +
        "A wide-angle lens and a tripod help in dark interiors — but only where you have permission to be. Leave climbing and “entry” tools at home; they’re a safety and legal problem.";
    } else if (/\b(photo|photograph|camera|lens|tripod|exposure|low[- ]light|iso|aperture|shutter|film|shoot|composition)\b/i.test(ql)) {
      text =
        "Low light is the usual challenge. A fast wide-angle (something in the 16–24 mm range on full frame, or equivalent) and a tripod let you keep ISO under control and capture the whole room. " +
        "Expose for the highlights coming through broken windows, then lift shadows later; a single long exposure often looks more natural than a stack of harsh flashes. " +
        "Shoot from public rights of way or with permission — never damage a site for a picture. A cloth and a spare battery go a long way in damp buildings.";
    } else if (/\b(safe|safety|legal|law|trespass|permission|owner|asbestos|danger|risk|injur|hazard|allowed|permit|private property)\b/i.test(ql)) {
      text =
        SAFETY_TEXT +
        " In short: if you don’t have permission, look from the public street, or find a tour. Rotten floors, open shafts, and bad air are common. A buddy and a check-in time are not optional.";
    } else if (/\b(how (do i|to) use|this app|vestige|search|favorit|satellite|near me|locate|map layer|home screen|tab bar|continent)\b/i.test(ql)) {
      text =
        "In Vestige, type a city, state, or country in the search bar, or pick a continent. “Near me” searches around your current location; the locate button on the map just shows (and can follow) your blue dot, without starting a new search. " +
        "Tap a pin or a row for details, directions, and research links. Save places with the star — they’re stored only on this device. " +
        "The layers control switches street, satellite, and dark maps. On an iPhone, use Share → Add to Home Screen so Vestige opens like an app.";
    } else if (spot && /\b(histor|histor(?:y|ic)|built|when|story|about (this|the|it)|what is (this|it)|descri|this (place|site|building|spot)|selected|year|abandon)\b/i.test(ql)) {
      var bits = [];
      bits.push("You’re looking at “" + spot.name + "”" + (spot.typeLabel ? " (" + spot.typeLabel + ")" : "") + ".");
      if (spot.yearBuilt || spot.yearAbandoned) {
        bits.push(
          (spot.yearBuilt ? "Records point to it being built around " + spot.yearBuilt + ". " : "") +
          (spot.yearAbandoned ? "It appears to have been abandoned around " + spot.yearAbandoned + ". " : "")
        );
      }
      if (spot.description) bits.push(spot.description);
      else bits.push("I only have what’s in the open-data record here — there’s no longer description on file in this offline guide.");
      bits.push("Treat that as a starting point, not a complete history; Wikipedia or Wikidata (linked on the place card) is the next stop. And it’s not permission to enter.");
      if (spot.wiki) bits.push("There’s a Wikipedia link on the place card.");
      text = bits.join(" ");
    } else if (spot && /\b(this|here|there|the (place|site|building|spot))\b/i.test(ql)) {
      text =
        "The selected place is “" + spot.name + "”" + (spot.typeLabel ? ", listed as " + spot.typeLabel : "") + ". " +
        (spot.description ? spot.description + " " : "There’s no longer write-up in the open-data record. ") +
        "I can talk about gear, photography, safety, or the history in that record. I won’t help with getting in. " +
        "The place card has directions and research links.";
    } else {
      text =
        "I’m the Urbex Guide. I can help with gear, photography, staying safe and legal, how to use Vestige, " +
        (spot ? "or the open-data history of “" + spot.name + "”." : "or the history of a place once you select one on the map.") +
        " I only support legal, permitted visits — I won’t help anyone break in or evade security. What would you like to know?";
    }
    return { text: text + OFFLINE_NOTE, offline: true };
  }

  async function completeChat(messages) {
    var ai = loadAI();
    if (ai.baseUrl && ai.apiKey) {
      try {
        var owned = await completeUserAI(messages, ai);
        if (owned) return { text: owned, offline: false, via: "user" };
      } catch (e) {
        console.warn("User-configured AI failed, trying keyless providers.", e);
      }
    }
    var keyless = [
      { name: "pollinations-post", run: completePollinationsPost },
      { name: "pollinations-get", run: completePollinationsGet }
    ];
    for (var i = 0; i < keyless.length; i++) {
      try {
        var t = await keyless[i].run(messages);
        if (t) return { text: t, offline: false, via: keyless[i].name };
      } catch (e) {
        console.warn(keyless[i].name + " failed:", e && (e.message || e));
      }
    }
    return offlineGuideReply(messages);
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  /* ---------- settings / about ---------- */

  function openModal(html) {
    $("modal-body").innerHTML = html;
    $("modal").hidden = false;
    var card = $("modal").querySelector(".modal-card");
    if (card) {
      card.style.transform = "";
      card.style.opacity = "";
      card.style.transition = "";
      card.classList.remove("is-dragging");
    }
    var focusable = $("modal").querySelector("input, button, textarea");
    if (focusable) focusable.focus();
    pushLayer("modal");
  }

  function closeModal() { dismissLayer("modal"); }

  function openAbout() {
    openModal(
      '<h2 id="modal-title">About Vestige</h2>' +
      "<p>Vestige is an open urbex atlas. It finds abandoned and historic places from " +
      "<strong>Wikidata</strong> and <strong>OpenStreetMap</strong> — not by scraping other urbex sites. " +
      "Maps use OpenStreetMap, Esri, CARTO, and optional Mapbox layers. Nothing here requires you to create an account.</p>" +
      "<h3>Safety and the law</h3><p>" + esc(SAFETY_TEXT) + "</p>" +
      "<h3>On your iPhone</h3><p>Open this site in Safari, tap the Share button, then <strong>Add to Home Screen</strong>. Vestige opens like an app, without the browser chrome.</p>" +
      "<h3>Data credits</h3><p>Place data © OpenStreetMap contributors (ODbL) and Wikidata (CC0). " +
      "Map tiles © their respective providers. Photos, when shown, come from Wikimedia Commons and remain under their original licenses.</p>"
    );
  }

  function openSettings() {
    var ai = loadAI();
    openModal(
      '<h2 id="modal-title">Settings</h2>' +
      "<p>The Urbex Guide uses a key-free public endpoint by default. If you would rather use your own OpenAI-compatible API, add it here. The key is stored only in this browser (localStorage) and is never sent anywhere except the URL you provide.</p>" +
      '<form id="settings-form">' +
      '<div class="field"><label for="ai-url">API base URL</label>' +
      '<input id="ai-url" type="url" inputmode="url" placeholder="https://api.openai.com/v1" value="' + esc(ai.baseUrl || "") + '">' +
      '<span class="hint">The app will call <code>/chat/completions</code> on this base.</span></div>' +
      '<div class="field"><label for="ai-key">API key</label>' +
      '<input id="ai-key" type="password" autocomplete="off" placeholder="sk-…" value="' + esc(ai.apiKey || "") + '"></div>' +
      '<div class="field"><label for="ai-model">Model</label>' +
      '<input id="ai-model" type="text" placeholder="gpt-4o-mini" value="' + esc(ai.model || "") + '"></div>' +
      '<div class="btn-row"><button type="submit" class="btn btn-primary">Save</button>' +
      '<button type="button" class="btn" id="ai-clear">Clear saved key</button></div>' +
      "</form>"
    );
    $("settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      saveAI({
        baseUrl: $("ai-url").value.trim(),
        apiKey: $("ai-key").value.trim(),
        model: $("ai-model").value.trim()
      });
      toast("Saved on this device.");
      closeModal();
    });
    $("ai-clear").addEventListener("click", function () {
      saveAI({});
      $("ai-url").value = "";
      $("ai-key").value = "";
      $("ai-model").value = "";
      toast("Cleared.");
    });
  }

  /* ---------- sheet + tabs (phone) ---------- */

  function snapSheet(which) {
    var panel = $("panel");
    if (!panel) return;
    if (which === "half") which = "mid";
    panel.classList.remove("is-dragging");
    panel.style.height = "";
    panel.style.transition = "";
    panel.dataset.snap = which;
    applyPhoneChrome();
  }

  function applyPhoneChrome() {
    /* reserved if we need JS measurements */
  }

  function sheetSnaps() {
    var vh = window.innerHeight;
    var peek = 132;
    var half = Math.round(vh * 0.5);
    var full = Math.round(vh - 12 - (isPhone() ? 56 : 0));
    if (isPhone()) {
      /* full sheet stops just under the search bar and sits above the tab bar */
      var pnl = $("panel"), sf = document.querySelector(".search-form");
      if (pnl && sf) full = Math.round(pnl.getBoundingClientRect().bottom - (sf.getBoundingClientRect().bottom + 10));
    }
    return { peek: peek, half: half, mid: half, full: full };
  }

  function rubberHeight(h, snaps) {
    if (h > snaps.full) {
      var over = h - snaps.full;
      return snaps.full + over / (1 + over / 160);
    }
    if (h < snaps.peek) {
      var under = snaps.peek - h;
      return snaps.peek - under / (1 + under / 160);
    }
    return h;
  }

  function pickSheetSnap(h, vel) {
    var s = sheetSnaps();
    var flick = reduceMotion() ? 9 : 0.55;
    if (vel > flick) {
      if (h > (s.half + s.full) / 2) return "mid";
      return "peek";
    }
    if (vel < -flick) {
      if (h < (s.peek + s.half) / 2) return "mid";
      return "full";
    }
    if (h < (s.peek + s.half) / 2) return "peek";
    if (h < (s.half + s.full) / 2) return "mid";
    return "full";
  }

  function eventPoint(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (t) return { x: t.clientX, y: t.clientY, id: "touch", cancelable: e.cancelable, preventDefault: function () { if (e.cancelable) e.preventDefault(); }, target: e.target, currentTarget: e.currentTarget, button: 0, pointerType: "touch" };
    return { x: e.clientX, y: e.clientY, id: e.pointerId, cancelable: e.cancelable, preventDefault: function () { if (e.cancelable) e.preventDefault(); }, target: e.target, currentTarget: e.currentTarget, button: e.button, pointerType: e.pointerType, raw: e };
  }

  function setupSheetDrag() {
    var handle = $("sheet-handle");
    var panel = $("panel");
    var head = panel ? panel.querySelector(".panel-head") : null;
    var results = $("results");
    if (!handle || !panel) return;
    var drag = null;

    function currentH() { return panel.getBoundingClientRect().height; }

    function beginDrag(e, fromList) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (!isPhone()) return;
      if (drag) return;
      var p = eventPoint(e);
      if (p.button && p.button !== 0) return;
      if (p.target && p.target.closest && p.target.closest("button, a, input, textarea, select, .chip, .chips, .continent-row")) return;
      drag = {
        id: p.id,
        startY: p.y,
        startH: currentH(),
        lastY: p.y,
        lastT: performance.now(),
        vel: 0,
        fromList: !!fromList,
        captured: !fromList,
        el: e.currentTarget || p.currentTarget
      };
      if (!fromList) {
        try { if (e.pointerId != null && drag.el.setPointerCapture) drag.el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        panel.classList.add("is-dragging");
        if (!reduceMotion()) panel.style.transition = "none";
      }
    }

    function moveDrag(e) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (!drag) return;
      var p = eventPoint(e);
      if (p.id !== drag.id && !(drag.id === "touch" && p.pointerType === "touch") && p.id !== "touch") {
        /* ignore other pointers; allow touch+pointer aliasing only if ids match */
        if (drag.id !== p.id) return;
      }
      var now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      var inst = (p.y - drag.lastY) / dt;
      drag.vel = drag.vel * 0.55 + inst * 0.45;
      drag.lastY = p.y;
      drag.lastT = now;
      var dy = drag.startY - p.y;

      if (drag.fromList && !drag.captured) {
        var atTop = !results || results.scrollTop <= 0;
        var atFull = (panel.dataset.snap === "full") || currentH() >= sheetSnaps().full - 10;
        if (!atTop) { drag = null; return; }
        if (atFull && dy > 0) { drag = null; return; }
        if ((atTop && dy < -8) || (!atFull && dy > 8)) {
          drag.captured = true;
          drag.startY = p.y;
          drag.startH = currentH();
          dy = 0;
          try { if (e.pointerId != null && drag.el.setPointerCapture) drag.el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
          panel.classList.add("is-dragging");
          if (!reduceMotion()) panel.style.transition = "none";
        } else {
          return;
        }
      }

      if (!drag.captured) return;
      p.preventDefault();
      if (reduceMotion()) return;
      var snaps = sheetSnaps();
      var h = rubberHeight(drag.startH + dy, snaps);
      panel.style.height = h + "px";
    }

    var suppressClick = false;
    function endDrag(e) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (!drag) return;
      if (e) {
        var ep = eventPoint(e);
        if (ep.id !== drag.id && drag.id !== "touch") return;
      }
      var h = currentH();
      var vel = drag.captured ? drag.vel : 0;
      var captured = drag.captured;
      var moved = Math.abs(h - drag.startH) > 8;
      drag = null;
      panel.classList.remove("is-dragging");
      panel.style.transition = "";
      panel.style.height = "";
      if (captured) snapSheet(pickSheetSnap(h, vel));
      if (captured && moved) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 120);
      }
    }

    function bind(el, fromList) {
      if (!el) return;
      el.addEventListener("pointerdown", function (e) { beginDrag(e, fromList); });
      el.addEventListener("touchstart", function (e) {
        if (drag) return;
        beginDrag(e, fromList);
      }, { passive: true });
    }

    /* Document-level move/up so the gesture keeps tracking after the
       finger leaves the small handle (setPointerCapture is unreliable on iOS). */
    document.addEventListener("pointermove", moveDrag, { passive: false });
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener("touchmove", function (e) {
      if (!drag) return;
      moveDrag(e);
    }, { passive: false });
    document.addEventListener("touchend", endDrag);
    document.addEventListener("touchcancel", endDrag);

    bind(handle, false);
    bind(head, false);
    bind(results, true);
    if (results) {
      results.addEventListener("click", function (e) {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
    }
  }

  function animateDismiss(card, closeFn) {
    if (!card || reduceMotion()) { closeFn(); return; }
    card.style.transition = "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease";
    card.style.transform = "translate3d(0, " + Math.round(window.innerHeight) + "px, 0)";
    card.style.opacity = "0";
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      closeFn();
    }
    card.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 340);
  }

  function setupSwipeDismiss(root, opts) {
    if (!root) return;
    var drag = null;
    var card = opts.card || root;
    var getScroll = opts.getScroll || function () { return root; };

    function allowed(e, p) {
      if (!isPhone()) return false;
      if (root.hidden) return false;
      if (p.button && p.button !== 0) return false;
      if (p.target && p.target.closest && p.target.closest("button, a, input, textarea, select, .send-btn")) return false;
      return true;
    }

    function onDown(e) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (drag) return;
      var p = eventPoint(e);
      if (!allowed(e, p)) return;
      var scroll = getScroll();
      var top = root.getBoundingClientRect().top;
      var fromHead = !!(opts.head && opts.head.contains(p.target)) || (p.y - top < 56);
      drag = {
        id: p.id,
        startY: p.y,
        lastY: p.y,
        lastT: performance.now(),
        vel: 0,
        captured: fromHead,
        fromHead: fromHead,
        el: e.currentTarget || p.currentTarget,
        atTop: !scroll || scroll.scrollTop <= 0
      };
      if (fromHead) {
        try { if (e.pointerId != null && drag.el && drag.el.setPointerCapture) drag.el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        card.classList.add("is-dragging");
        if (!reduceMotion()) {
          card.style.transition = "none";
          if (opts.backdrop) opts.backdrop.style.transition = "none";
        }
      }
    }

    function onMove(e) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (!drag) return;
      var p = eventPoint(e);
      if (p.id !== drag.id && drag.id !== "touch") return;
      var now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      drag.vel = drag.vel * 0.55 + ((p.y - drag.lastY) / dt) * 0.45;
      drag.lastY = p.y;
      drag.lastT = now;
      var dy = p.y - drag.startY;

      if (!drag.captured) {
        var scroll = getScroll();
        var atTop = !scroll || scroll.scrollTop <= 0;
        if (!atTop || dy < 10) {
          if (!atTop && dy > 0) drag = null;
          return;
        }
        drag.captured = true;
        drag.startY = p.y;
        dy = 0;
        try { if (e.pointerId != null && drag.el && drag.el.setPointerCapture) drag.el.setPointerCapture(e.pointerId); } catch (err) { /* */ }
        card.classList.add("is-dragging");
        if (!reduceMotion()) {
          card.style.transition = "none";
          if (opts.backdrop) opts.backdrop.style.transition = "none";
        }
      }

      p.preventDefault();
      if (reduceMotion()) return;
      var y = dy < 0 ? dy / (1 + Math.abs(dy) / 160) : dy;
      card.style.transform = "translate3d(0, " + y + "px, 0)";
      if (opts.backdrop) {
        var fade = Math.max(0.2, 1 - Math.max(0, y) / (window.innerHeight * 0.7));
        opts.backdrop.style.opacity = String(fade);
      }
    }

    function onUp(e) {
      if (e && e.pointerType === "touch") return; /* touch is handled by touch events (iOS cancels pointers on scroll) */
      if (!drag) return;
      if (e) {
        var up = eventPoint(e);
        if (up.id !== drag.id && drag.id !== "touch") return;
      }
      var dy = (drag.lastY - drag.startY);
      var vel = drag.vel;
      var captured = drag.captured;
      drag = null;
      card.classList.remove("is-dragging");
      if (!captured) return;
      var should = dy > 80 || vel > 0.55;
      if (should) {
        animateDismiss(card, opts.onDismiss);
        return;
      }
      card.style.transition = reduceMotion() ? "none" : "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease";
      card.style.transform = "";
      card.style.opacity = "";
      if (opts.backdrop) {
        opts.backdrop.style.transition = reduceMotion() ? "none" : "opacity 0.25s ease";
        opts.backdrop.style.opacity = "";
      }
    }

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("touchstart", function (e) { if (!drag) onDown(e); }, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("touchmove", function (e) { if (drag) onMove(e); }, { passive: false });
    document.addEventListener("touchend", onUp);
    document.addEventListener("touchcancel", onUp);
  }

  function setupDismissSwipes() {
    var detail = $("detail");
    setupSwipeDismiss(detail, {
      card: detail,
      head: detail ? detail.querySelector(".detail-head") : null,
      getScroll: function () { return detail; },
      onDismiss: function () { closeDetail(); }
    });
    var chat = $("chat");
    setupSwipeDismiss(chat, {
      card: chat,
      head: chat ? chat.querySelector(".chat-head") : null,
      getScroll: function () { return $("chat-log"); },
      onDismiss: function () { closeChat(); }
    });
    var modal = $("modal");
    var card = modal ? modal.querySelector(".modal-card") : null;
    setupSwipeDismiss(card || modal, {
      card: card || modal,
      head: card,
      backdrop: modal ? modal.querySelector(".modal-backdrop") : null,
      getScroll: function () { return card; },
      onDismiss: function () { closeModal(); }
    });
  }

  function setTab(id) {
    ["search", "favorites", "guide"].forEach(function (t) {
      var btn = $("tab-" + t);
      if (btn) { if (t === id) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current"); }
    });
  }

  /* ---------- events ---------- */


  /* ---------- locate (Apple Maps-style floating control) ---------- */

  var geo = { watchId: null, follow: false, marker: null, accuracy: null, last: null };

  function geoDeniedTip() {
    if (isIOS()) {
      return "Location is off for this site. On iPhone go to Settings > Privacy & Security > Location Services > Safari Websites, then choose While Using (or allow it in the site settings).";
    }
    return "Location is off for this site. You can allow it in your browser’s site settings.";
  }

  function rememberGeoGranted() {
    try { localStorage.setItem(GEO_KEY, "1"); } catch (e) { /* */ }
  }

  function wasGeoGranted() {
    try { return localStorage.getItem(GEO_KEY) === "1"; } catch (e) { return false; }
  }

  function userDotIcon() {
    return L.divIcon({
      className: "v-user",
      html: '<span class="v-user-pulse" aria-hidden="true"></span><span class="v-user-dot" aria-hidden="true"></span>',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  function showUserLocation(lat, lon, acc, opts) {
    opts = opts || {};
    if (!state.map) return;
    var ll = L.latLng(lat, lon);
    if (!geo.accuracy) {
      geo.accuracy = L.circle(ll, {
        radius: Math.max(acc || 30, 12),
        color: "#0a84ff",
        weight: 1,
        fillColor: "#0a84ff",
        fillOpacity: 0.14,
        interactive: false
      }).addTo(state.map);
    } else {
      geo.accuracy.setLatLng(ll);
      if (acc) geo.accuracy.setRadius(Math.max(acc, 12));
    }
    if (!geo.marker) {
      geo.marker = L.marker(ll, { icon: userDotIcon(), interactive: false, keyboard: false, zIndexOffset: 1200 }).addTo(state.map);
    } else {
      geo.marker.setLatLng(ll);
    }
    geo.last = { lat: lat, lon: lon, acc: acc };
    if (opts.fly) {
      var z = Math.max(state.map.getZoom() || 3, opts.zoom || 15);
      state.map.flyTo(ll, z, { duration: reduceMotion() ? 0 : 0.8 });
    } else if (geo.follow) {
      state.map.panTo(ll, { animate: !reduceMotion(), duration: 0.4 });
    }
    updateLocateBtn();
  }

  function stopWatching() {
    if (geo.watchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(geo.watchId); } catch (e) { /* */ }
    }
    geo.watchId = null;
  }

  function startWatching(opts) {
    opts = opts || {};
    if (!navigator.geolocation) {
      if (opts.warn) toast("Geolocation is not available in this browser.");
      return;
    }
    if (geo.watchId != null) {
      if (opts.fly && geo.last) showUserLocation(geo.last.lat, geo.last.lon, geo.last.acc, { fly: true, zoom: opts.zoom });
      return;
    }
    geo.watchId = navigator.geolocation.watchPosition(
      function (pos) {
        rememberGeoGranted();
        var first = !geo.last;
        showUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, {
          fly: !!(opts.fly && first),
          zoom: opts.zoom
        });
        opts.fly = false;
      },
      function (err) {
        if (opts.onError) opts.onError(err);
        else if (opts.warn || (err && err.code === 1 && !opts.silent)) toast(err && err.code === 1 ? geoDeniedTip() : "Could not read your location.");
        updateLocateBtn();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  }

  function setFollow(on) {
    geo.follow = !!on;
    updateLocateBtn();
    if (geo.follow && geo.last && state.map) {
      state.map.flyTo([geo.last.lat, geo.last.lon], Math.max(state.map.getZoom(), 15), { duration: reduceMotion() ? 0 : 0.55 });
    }
  }

  function updateLocateBtn() {
    var btn = $("btn-locate");
    if (!btn) return;
    btn.setAttribute("aria-pressed", geo.last || geo.watchId != null ? "true" : "false");
    btn.classList.toggle("is-follow", !!geo.follow);
    var label = geo.follow ? "Stop following your location" : (geo.last ? "Follow your location" : "Show my location");
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function onLocateTap() {
    if (!navigator.geolocation) {
      toast("Geolocation is not available in this browser.");
      return;
    }
    if (geo.follow) {
      setFollow(false);
      return;
    }
    if (geo.last && geo.watchId != null) {
      setFollow(true);
      return;
    }
    startWatching({
      fly: true,
      zoom: 15,
      warn: true,
      onError: function (err) {
        toast(err && err.code === 1 ? geoDeniedTip() : "Could not read your location.");
      }
    });
  }

  function setupLocate() {
    var btn = $("btn-locate");
    if (btn) btn.addEventListener("click", onLocateTap);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopWatching();
      } else if (wasGeoGranted() || geo.follow || geo.last) {
        startWatching({ fly: false, silent: true });
      }
    });
    function autostart() {
      if (!navigator.permissions || !navigator.permissions.query) {
        if (wasGeoGranted()) startWatching({ fly: false, silent: true });
        return;
      }
      navigator.permissions.query({ name: "geolocation" }).then(function (st) {
        if (st.state === "granted") startWatching({ fly: false, silent: true });
        st.addEventListener("change", function () {
          if (st.state === "granted") startWatching({ fly: false, silent: true });
          if (st.state === "denied") { stopWatching(); setFollow(false); }
        });
      }).catch(function () {
        if (wasGeoGranted()) startWatching({ fly: false, silent: true });
      });
    }
    autostart();
  }

  function setupEvents() {
    var form = $("search-form");
    var input = $("search-input");

    var debounced = debounce(function () {
      var q = input.value.trim();
      if (q.length < 2) return;
      runSearch({ query: q });
    }, NOMINATIM_WAIT);

    input.addEventListener("input", function () {
      if (input.value.trim().length >= 2) debounced();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      runSearch({ query: q });
    });

    $("btn-near").addEventListener("click", function () {
      if (!navigator.geolocation) {
        toast("Geolocation is not available in this browser.");
        return;
      }
      $("btn-near").setAttribute("aria-pressed", "true");
      setStatus("Finding your location…");
      navigator.geolocation.getCurrentPosition(function (pos) {
        $("btn-near").setAttribute("aria-pressed", "false");
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        rememberGeoGranted();
        showUserLocation(lat, lon, pos.coords.accuracy, { fly: true, zoom: 12 });
        startWatching({ fly: false, silent: true });
        var d = 0.35;
        var bbox = { south: lat - d, north: lat + d, west: lon - d, east: lon + d };
        runSearch({ bbox: bbox, label: "Near me" });
      }, function (err) {
        $("btn-near").setAttribute("aria-pressed", "false");
        toast(err && err.code === 1 ? geoDeniedTip() : "Could not read your location.");
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });

    var row = $("continent-row");
    CONTINENTS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = c.name;
      b.setAttribute("role", "option");
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(row.querySelectorAll(".chip"), function (x) {
          x.classList.toggle("is-on", x === b);
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        input.value = "";
        runSearch({
          bbox: { south: c.south, north: c.north, west: c.west, east: c.east },
          label: c.name,
          continentId: c.id
        });
      });
      row.appendChild(b);
    });

    $("btn-cancel").addEventListener("click", function () {
      if (state.abort) state.abort.abort();
    });

    $("type-chips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-type]");
      if (!btn) return;
      state.typeFilter = btn.getAttribute("data-type");
      if (state.typeFilter === "favorites") setTab("favorites");
      else setTab("search");
      renderAll();
    });
    $("text-filter").addEventListener("input", function (e) {
      state.textFilter = e.target.value;
      renderAll();
    });

    $("results").addEventListener("click", function (e) {
      var fav = e.target.closest("[data-fav]");
      if (fav) {
        e.stopPropagation();
        var s = findSpot(fav.getAttribute("data-fav"));
        if (s) { toggleFav(s); renderAll(); if (!$("detail").hidden && state.selected) openDetail(state.selected, false); }
        return;
      }
      var rowEl = e.target.closest(".result[data-key]");
      if (rowEl) {
        var spot = findSpot(rowEl.getAttribute("data-key"));
        if (spot) openDetail(spot, false);
      }
    });
    $("results").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var rowEl = e.target.closest(".result[data-key]");
      if (!rowEl) return;
      e.preventDefault();
      var spot = findSpot(rowEl.getAttribute("data-key"));
      if (spot) openDetail(spot, false);
    });

    $("detail-close").addEventListener("click", closeDetail);

    $("btn-layers").addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = $("layer-menu");
      var open = menu.hidden;
      menu.hidden = !open;
      $("btn-layers").setAttribute("aria-expanded", open ? "true" : "false");
      if (open) buildLayerMenu();
    });
    $("layer-menu").addEventListener("click", function (e) {
      var base = e.target.closest("[data-base]");
      if (base) {
        setBase(base.getAttribute("data-base"));
        return;
      }
      var ov = e.target.closest("[data-overlay]");
      if (ov && ov.getAttribute("data-overlay") === "labels") {
        if (state.map.hasLayer(state.overlays.labels)) state.map.removeLayer(state.overlays.labels);
        else state.overlays.labels.addTo(state.map);
        buildLayerMenu();
      }
    });
    document.addEventListener("click", function (e) {
      if (!$("layer-menu").hidden && !e.target.closest(".map-tools")) {
        $("layer-menu").hidden = true;
        $("btn-layers").setAttribute("aria-expanded", "false");
      }
    });

    $("chat-fab").addEventListener("click", openChat);
    $("chat-close").addEventListener("click", closeChat);
    $("chat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      sendChat($("chat-input").value);
    });
    $("chat-input").addEventListener("input", function () { autoGrow($("chat-input")); });
    $("chat-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat($("chat-input").value);
      }
    });

    $("btn-about").addEventListener("click", openAbout);
    $("btn-settings").addEventListener("click", openSettings);
    $("modal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("modal").hidden) closeModal();
        else if (!$("chat").hidden) closeChat();
        else if (!$("detail").hidden) closeDetail();
        else if (!$("layer-menu").hidden) {
          $("layer-menu").hidden = true;
        }
      }
    });

    $("tab-search").addEventListener("click", function () {
      var already = $("tab-search").getAttribute("aria-current") === "page" && $("chat").hidden;
      if (!$("chat").hidden) closeChat();
      setTab("search");
      if (state.typeFilter === "favorites") {
        state.typeFilter = "all";
        renderAll();
      }
      if (already) {
        var list = $("results");
        if (list) list.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
        return;
      }
      snapSheet("mid");
    });
    $("tab-favorites").addEventListener("click", function () {
      var already = $("tab-favorites").getAttribute("aria-current") === "page" && $("chat").hidden;
      if (!$("chat").hidden) closeChat();
      setTab("favorites");
      state.typeFilter = "favorites";
      $("filters").hidden = false;
      if (already) {
        var favList = $("results");
        if (favList) favList.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
        return;
      }
      snapSheet("mid");
      renderAll();
      $("results-heading").textContent = "Favorites";
      if (!state.favorites.length) setStatus("Save places with the star to keep them on this device.");
      else setStatus(state.favorites.length + " saved on this device.");
    });
    $("tab-guide").addEventListener("click", function () {
      openChat();
    });

    setupSheetDrag();
    setupDismissSwipes();
    setupLocate();
  }

  /* ---------- PWA ---------- */

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    /* Relative URL so this works on a subpath (GitHub Pages project sites, etc.). */
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () { /* offline first load */ });
  }

  /* ---------- boot ---------- */

  function boot() {
    initMap();
    setupEvents();
    renderAll();
    registerSW();
    applyPhoneChrome();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
