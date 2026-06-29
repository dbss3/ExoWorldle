const MAX_GUESSES = 6;
const TOL = 0.1;
const RESET_EACH_OPEN_FOR_TESTING = true;
const STELLAR_ORDER = ["O", "B", "A", "F", "G", "K", "M"];
const STELLAR_RANK = new Map(STELLAR_ORDER.map((value, idx) => [value, idx]));
const REF_RADII_RJ = [
  { name: "Earth", rj: 0.0892, color: "#cbd5e1" },
  { name: "Neptune", rj: 0.3466, color: "#93c5fd" },
  { name: "Jupiter", rj: 1.0, color: "#f9a8d4" }
];
const HELPER_DOT_RADIUS = 3.6;
const SINGLE_HINT_TEXT = "Hints are not yet implemented, sorry. Good luck!";

const PROPERTY_CONFIG = [
  { key: "Mp", label: "Mass", unit: "Mj", tolerance: TOL, mode: "numeric" },
  { key: "Rp", label: "Radius", unit: "Rj", tolerance: TOL, mode: "numeric" },
  { key: "Period", label: "Period", unit: "d", tolerance: TOL, mode: "numeric" },
  { key: "StarType", label: "Stellar Type", unit: "(O-B-A-F-G-K-M)", tolerance: null, mode: "stellar" },
  { key: "Teq", label: "Equilibrium Temp", unit: "K", tolerance: TOL, mode: "numeric" }
];

const historyEl = document.getElementById("history");
const guessInputEl = document.getElementById("guessInput");
const guessBtnEl = document.getElementById("guessBtn");
const suggestionsEl = document.getElementById("suggestions");
const feedbackEl = document.getElementById("feedback");
const hintBtnEl = document.getElementById("hintBtn");
const attemptsEl = document.getElementById("attempts");
const resultEl = document.getElementById("result");
const statusBarEl = resultEl ? resultEl.closest(".statusBar") : null;
const dayMetaEl = document.getElementById("dayMeta");
const remainingCountEl = document.getElementById("remainingCount");
const targetBannerEl = document.querySelector(".targetBanner");
const targetMaskEl = document.getElementById("targetMask");
const radiusVizEl = document.getElementById("radiusViz");
const tempVizEl = document.getElementById("tempViz");
const massVizEl = document.getElementById("massViz");
const stellarChipsEl = document.getElementById("stellarChips");
const endModalEl = document.getElementById("endModal");
const endMessageEl = document.getElementById("endMessage");
const shareGridEl = document.getElementById("shareGrid");
const copyShareBtnEl = document.getElementById("copyShareBtn");
const closeModalBtnEl = document.getElementById("closeModalBtn");
const helperToggleBtnEl = document.getElementById("helperToggleBtn");
const modeToggleBtnEl = document.getElementById("modeToggleBtn");
const helperPanelEl = document.getElementById("helperPanel");
const helperSelectionEl = document.getElementById("helperSelection");
const helperPeriodMassEl = document.getElementById("helperPeriodMass");
const helperMassRadiusEl = document.getElementById("helperMassRadius");
const helperTempGravityEl = document.getElementById("helperTempGravity");

let dataset = [];
let planetByName = new Map();
let state = null;
let targetPlanet = null;
let dayNumber = null;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
let endModalShown = false;
let hintRevealed = false;
let featuredPool = [];
let gameMode = "easy";

function getUtcDayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

function deterministicIndexForDay(day, length) {
  const mixed = (day * 1103516245 + 12345) >>> 0;
  return mixed % length;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function valueDisplay(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "?";
  }
  if (typeof value === "number") {
    if (Math.abs(value) >= 1000) {
      return value.toFixed(0);
    }
    if (Math.abs(value) >= 10) {
      return value.toFixed(2);
    }
    return value.toFixed(3);
  }
  return String(value);
}

function formatSci(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "?";
  }
  return Number(value).toExponential(2);
}

function compareValue(target, guess, tolerance) {
  if (target === null || target === undefined || guess === null || guess === undefined) {
    return "unknown";
  }

  if (tolerance === null) {
    return target === guess ? "correct" : "wrong";
  }

  const t = Number(target);
  const g = Number(guess);
  if (Number.isNaN(t) || Number.isNaN(g)) {
    return "unknown";
  }

  if (t === 0) {
    if (g === 0) {
      return "correct";
    }
    return g > t ? "high" : "low";
  }

  const delta = (g - t) / t;
  if (Math.abs(delta) <= tolerance) {
    return "correct";
  }

  return g > t ? "high" : "low";
}

function compareStellar(target, guess) {
  const targetRank = STELLAR_RANK.get(target);
  const guessRank = STELLAR_RANK.get(guess);
  if (targetRank === undefined || guessRank === undefined) {
    return "unknown";
  }
  if (targetRank === guessRank) {
    return "correct";
  }
  return guessRank > targetRank ? "low" : "high";
}

function statusSuffix(status) {
  if (status === "correct") {
    return " ✓";
  }
  if (status === "low") {
    return " ↑";
  }
  if (status === "high") {
    return " ↓";
  }
  if (status === "wrong") {
    return " ✗";
  }
  return "";
}

function evaluateGuess(guessPlanet) {
  const statuses = PROPERTY_CONFIG.map((config) => {
    const targetValue = targetPlanet.properties[config.key];
    const guessValue = guessPlanet.properties[config.key];

    let status = "unknown";
    if (config.mode === "stellar") {
      status = compareStellar(targetValue, guessValue);
    } else {
      status = compareValue(targetValue, guessValue, config.tolerance);
    }

    return {
      key: config.key,
      label: config.label,
      value: guessValue,
      status
    };
  });

  const solved = normalizeName(guessPlanet.name) === normalizeName(targetPlanet.name);

  return {
    name: guessPlanet.name,
    statuses,
    solved
  };
}

function inNumericRange(value, rangeObj) {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return true;
  }
  if (rangeObj.min !== null && num < rangeObj.min) {
    return false;
  }
  if (rangeObj.max !== null && num > rangeObj.max) {
    return false;
  }
  return true;
}

function inStellarRange(value, rangeObj) {
  const rank = STELLAR_RANK.get(value);
  if (rank === undefined) {
    return true;
  }
  return rank >= rangeObj.min && rank <= rangeObj.max;
}

function countRemainingPlanets() {
  const ranges = computeRanges();
  return dataset.filter((planet) => {
    for (const config of PROPERTY_CONFIG) {
      const pValue = planet.properties[config.key];
      const rangeObj = ranges[config.key];
      if (config.mode === "stellar") {
        if (!inStellarRange(pValue, rangeObj)) {
          return false;
        }
      } else if (!inNumericRange(pValue, rangeObj)) {
        return false;
      }
    }
    return true;
  }).length;
}

function updateRemainingCount() {
  const remaining = countRemainingPlanets();
  remainingCountEl.textContent = `Planets remaining: ${remaining}`;
}

function shareEmoji(status) {
  if (status === "correct") {
    return "🟩";
  }
  if (status === "low") {
    return "🟦";
  }
  if (status === "high") {
    return "🟧";
  }
  if (status === "wrong") {
    return "🟥";
  }
  return "⬜";
}

function buildShareText() {
  const header = `ExoWorldle ${state.result === "won" ? state.guesses.length : "X"}/${MAX_GUESSES}`;
  const lines = state.guesses.map((row) => row.statuses.map((entry) => shareEmoji(entry.status)).join(""));
  return [header, ...lines].join("\n");
}

function showEndModal() {
  if (state.result === "playing" || endModalShown) {
    return;
  }
  endModalShown = true;

  if (state.result === "won") {
    endMessageEl.textContent = gameMode === "hard"
      ? `Solved in ${state.guesses.length} guesses.`
      : `Solved in ${state.guesses.length} guesses. Target: ${targetPlanet.name}`;
  } else {
    endMessageEl.textContent = gameMode === "hard"
      ? "Out of guesses."
      : `Out of guesses. Target was ${targetPlanet.name}.`;
  }
  const p = targetPlanet.properties;
  const propertiesLine = `Mass ${formatSci(p.Mp)} Mj | Radius ${valueDisplay(p.Rp)} Rj | Period ${formatSci(p.Period)} days | Stellar ${p.StarType} | Teq ${valueDisplay(p.Teq)} K`;
  endMessageEl.textContent = `${endMessageEl.textContent} ${propertiesLine}`;
  shareGridEl.textContent = buildShareText();
  endModalEl.classList.remove("hidden");
}

function hideEndModal() {
  endModalEl.classList.add("hidden");
}

function createInitialRanges() {
  const ranges = {};
  PROPERTY_CONFIG.forEach((config) => {
    if (config.mode === "stellar") {
      ranges[config.key] = { min: 0, max: STELLAR_ORDER.length - 1 };
    } else {
      ranges[config.key] = { min: null, max: null, hasKnownBound: false };
    }
  });
  return ranges;
}

function tightenNumericRange(rangeObj, guess, status, tolerance) {
  const g = Number(guess);
  if (Number.isNaN(g)) {
    return;
  }

  const lowerForCorrect = g / (1 + tolerance);
  const upperForCorrect = g / (1 - tolerance);

  if (status === "correct") {
    rangeObj.min = rangeObj.min === null ? lowerForCorrect : Math.max(rangeObj.min, lowerForCorrect);
    rangeObj.max = rangeObj.max === null ? upperForCorrect : Math.min(rangeObj.max, upperForCorrect);
    rangeObj.hasKnownBound = true;
    return;
  }

  if (status === "low") {
    const newMin = g / (1 - tolerance);
    rangeObj.min = rangeObj.min === null ? newMin : Math.max(rangeObj.min, newMin);
    rangeObj.hasKnownBound = true;
    return;
  }

  if (status === "high") {
    const newMax = g / (1 + tolerance);
    rangeObj.max = rangeObj.max === null ? newMax : Math.min(rangeObj.max, newMax);
    rangeObj.hasKnownBound = true;
  }
}

function tightenStellarRange(rangeObj, guess, status) {
  const rank = STELLAR_RANK.get(guess);
  if (rank === undefined) {
    return;
  }

  if (status === "correct") {
    rangeObj.min = rank;
    rangeObj.max = rank;
    return;
  }

  if (status === "low") {
    rangeObj.min = Math.max(rangeObj.min, 0);
    rangeObj.max = Math.max(rangeObj.min, Math.min(rangeObj.max, rank - 1));
    return;
  }

  if (status === "high") {
    rangeObj.min = Math.min(rangeObj.max, Math.max(rangeObj.min, rank + 1));
    rangeObj.max = Math.max(rangeObj.min, STELLAR_ORDER.length - 1);
  }
}

function computeRanges() {
  const ranges = createInitialRanges();

  state.guesses.forEach((guessRow) => {
    guessRow.statuses.forEach((entry) => {
      const config = PROPERTY_CONFIG.find((item) => item.key === entry.key);
      if (!config) {
        return;
      }

      if (config.mode === "stellar") {
        tightenStellarRange(ranges[entry.key], entry.value, entry.status);
      } else if (config.mode === "numeric") {
        tightenNumericRange(ranges[entry.key], entry.value, entry.status, config.tolerance);
      }
    });
  });

  return ranges;
}

function buildInitialMask(name) {
  const chars = [...name];
  return chars.map((char) => (/[A-Za-z0-9]/.test(char) ? "_" : char));
}

function numericTokenInfo(chars, index) {
  if (!/\d/.test(chars[index] || "")) {
    return null;
  }
  let start = index;
  let end = index;
  while (start > 0 && /\d/.test(chars[start - 1])) {
    start -= 1;
  }
  while (end < chars.length - 1 && /\d/.test(chars[end + 1])) {
    end += 1;
  }
  return {
    start,
    end,
    len: end - start + 1,
    offsetFromRight: end - index
  };
}

function canRevealAtIndex(targetChars, guessChars, index) {
  const t = targetChars[index];
  const g = guessChars[index];
  if (t === undefined || g === undefined) {
    return false;
  }

  const tIsDigit = /\d/.test(t);
  const gIsDigit = /\d/.test(g);

  if (tIsDigit || gIsDigit) {
    if (!(tIsDigit && gIsDigit)) {
      return false;
    }
    const tInfo = numericTokenInfo(targetChars, index);
    const gInfo = numericTokenInfo(guessChars, index);
    if (!tInfo || !gInfo) {
      return false;
    }
    if (tInfo.len !== gInfo.len || tInfo.offsetFromRight !== gInfo.offsetFromRight) {
      return false;
    }
    return t === g;
  }

  return g.toLowerCase() === t.toLowerCase();
}

function updateNameMask() {
  if (gameMode === "hard") {
    targetMaskEl.textContent = `${buildInitialMask(targetPlanet.name).join("")}`;
    return;
  }

  const targetChars = [...targetPlanet.name];
  const mask = buildInitialMask(targetPlanet.name);

  state.guesses.forEach((guessRow) => {
    const guessChars = [...guessRow.name];
    for (let i = 0; i < targetChars.length; i += 1) {
      if (!(/[A-Za-z0-9]/.test(targetChars[i]))) {
        continue;
      }
      if (i < guessChars.length && canRevealAtIndex(targetChars, guessChars, i)) {
        mask[i] = targetChars[i];
      }
    }
  });

  if (state.result === "won") {
    targetMaskEl.textContent = `${targetPlanet.name}`;
  } else {
    targetMaskEl.textContent = `${mask.join("")}`;
  }
}

function updateModeButton() {
  modeToggleBtnEl.textContent = gameMode === "easy" ? "Mode: Easy" : "Mode: Hard";
  if (targetBannerEl) {
    targetBannerEl.classList.toggle("hidden", gameMode === "hard");
  }
}

function clearSuggestions() {
  currentSuggestions = [];
  activeSuggestionIndex = -1;
  suggestionsEl.innerHTML = "";
  suggestionsEl.classList.remove("visible");
  guessInputEl.setAttribute("aria-expanded", "false");
}

function rankSuggestion(queryNorm, candidateName) {
  const candNorm = normalizeName(candidateName);
  if (candNorm.startsWith(queryNorm)) {
    return 0;
  }
  const idx = candNorm.indexOf(queryNorm);
  if (idx >= 0) {
    return 1 + idx;
  }
  return 999;
}

function updateSuggestions() {
  const raw = guessInputEl.value;
  const queryNorm = normalizeName(raw);
  if (!queryNorm) {
    clearSuggestions();
    return;
  }

  const allMatches = dataset
    .filter((planet) => normalizeName(planet.name).includes(queryNorm))
    .sort((a, b) => {
      const ra = rankSuggestion(queryNorm, a.name);
      const rb = rankSuggestion(queryNorm, b.name);
      if (ra !== rb) {
        return ra - rb;
      }
      return a.name.localeCompare(b.name);
    });
  const matches = allMatches.slice(0, 5);

  currentSuggestions = matches;
  activeSuggestionIndex = -1;
  suggestionsEl.innerHTML = "";

  if (!matches.length) {
    suggestionsEl.classList.remove("visible");
    guessInputEl.setAttribute("aria-expanded", "false");
    return;
  }

  matches.forEach((planet, idx) => {
    const option = document.createElement("div");
    option.className = "suggestion";
    option.role = "option";
    option.textContent = planet.name;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      guessInputEl.value = planet.name;
      clearSuggestions();
    });
    option.addEventListener("mouseenter", () => {
      activeSuggestionIndex = idx;
      renderActiveSuggestion();
    });
    suggestionsEl.appendChild(option);
  });

  if (allMatches.length > 5) {
    const more = document.createElement("div");
    more.className = "suggestion moreHint";
    more.textContent = `... showing top 5 of ${allMatches.length} matches`;
    suggestionsEl.appendChild(more);
  }

  suggestionsEl.classList.add("visible");
  guessInputEl.setAttribute("aria-expanded", "true");
}

function renderActiveSuggestion() {
  const children = suggestionsEl.querySelectorAll(".suggestion");
  children.forEach((child, idx) => {
    if (idx === activeSuggestionIndex) {
      child.classList.add("active");
    } else {
      child.classList.remove("active");
    }
  });
}

function acceptActiveSuggestion() {
  if (activeSuggestionIndex < 0 || activeSuggestionIndex >= currentSuggestions.length) {
    return false;
  }
  guessInputEl.value = currentSuggestions[activeSuggestionIndex].name;
  clearSuggestions();
  return true;
}

function updateStatus() {
  attemptsEl.textContent = `Attempts: ${state.guesses.length} / ${MAX_GUESSES}`;

  if (state.result === "won") {
    resultEl.textContent = gameMode === "hard"
      ? `Solved in ${state.guesses.length} guesses.`
      : `Solved in ${state.guesses.length} guesses. Target: ${targetPlanet.name}`;
  } else if (state.result === "lost") {
    resultEl.textContent = gameMode === "hard"
      ? "Out of guesses."
      : `Out of guesses. Target was ${targetPlanet.name}.`;
  } else {
    resultEl.textContent = "";
  }

  if (statusBarEl) {
    statusBarEl.classList.toggle("hidden", !resultEl.textContent);
  }

  const playing = state.result === "playing";
  guessInputEl.disabled = !playing;
  guessBtnEl.disabled = !playing;
  hintBtnEl.disabled = !playing || hintRevealed;
  updateNameMask();
  updateRemainingCount();
  renderHelperPlots();
  showEndModal();
}

function saveState() {
  if (RESET_EACH_OPEN_FOR_TESTING) {
    return;
  }
  localStorage.setItem(`exoworldle-state-${dayNumber}`, JSON.stringify(state));
}

function loadState() {
  if (RESET_EACH_OPEN_FOR_TESTING) {
    localStorage.removeItem(`exoworldle-state-${dayNumber}`);
    return {
      guesses: [],
      used: [],
      result: "playing"
    };
  }

  const key = `exoworldle-state-${dayNumber}`;
  const raw = localStorage.getItem(key);

  if (!raw) {
    return {
      guesses: [],
      used: [],
      result: "playing"
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.guesses) || !Array.isArray(parsed.used)) {
      throw new Error("Malformed state");
    }
    if (!["playing", "won", "lost"].includes(parsed.result)) {
      throw new Error("Malformed result");
    }
    return parsed;
  } catch {
    return {
      guesses: [],
      used: [],
      result: "playing"
    };
  }
}

function getPlanetOrNull(userInput) {
  const normalized = normalizeName(userInput);
  if (!normalized) {
    return null;
  }
  return planetByName.get(normalized) || null;
}

function submitGuess() {
  if (state.result !== "playing") {
    return;
  }

  const rawGuess = guessInputEl.value;
  const planet = getPlanetOrNull(rawGuess);

  if (!planet) {
    feedbackEl.textContent = "Guess must match a planet from valid_planets.csv.";
    return;
  }

  if (state.used.includes(planet.name)) {
    feedbackEl.textContent = "You already guessed that planet.";
    return;
  }

  const row = evaluateGuess(planet);
  state.guesses.push(row);
  state.used.push(planet.name);

  if (row.solved) {
    state.result = "won";
  } else if (state.guesses.length >= MAX_GUESSES) {
    state.result = "lost";
  }

  saveState();
  renderHistory();
  renderRadiusViz();
  renderTemperatureViz();
  renderMassViz();
  renderStellarChips();
  updateStatus();

  guessInputEl.value = "";
  clearSuggestions();
}

function renderHistory() {
  historyEl.innerHTML = "";

  if (!state.guesses.length) {
    const empty = document.createElement("p");
    empty.className = "boardSub";
    empty.textContent = "No guesses yet.";
    historyEl.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "historyHeader";
  header.style.gridTemplateColumns = "1.2fr repeat(5, 1fr)";
  const headers = ["Guesses", ...PROPERTY_CONFIG.map((c) => c.label)];
  headers.forEach((label) => {
    const h = document.createElement("span");
    h.textContent = label;
    header.appendChild(h);
  });
  historyEl.appendChild(header);

  state.guesses.forEach((guessRow) => {
    const row = document.createElement("div");
    row.className = "historyRow";
    row.style.gridTemplateColumns = "1.2fr repeat(5, 1fr)";

    const nameCell = document.createElement("div");
    nameCell.className = "historyCell name";
    nameCell.dataset.label = "Guess";
    nameCell.textContent = guessRow.name;
    row.appendChild(nameCell);

    guessRow.statuses.forEach((entry) => {
      const config = PROPERTY_CONFIG.find((c) => c.key === entry.key);
      const cell = document.createElement("div");
      cell.className = `historyCell ${entry.status}`;
      cell.dataset.label = config ? config.label : entry.label;
      const unit = config && config.key !== "StarType" ? ` ${config.unit}` : "";
      const displayValue = entry.key === "Mp" || entry.key === "Period"
        ? formatSci(entry.value)
        : valueDisplay(entry.value);
      cell.textContent = `${displayValue}${unit}${statusSuffix(entry.status)}`;
      row.appendChild(cell);
    });

    historyEl.appendChild(row);
  });
}

function svgEl(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function mapLinear(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) {
    return (outMin + outMax) / 2;
  }
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

function mapLog(value, inMin, inMax, outMin, outMax) {
  if (inMin <= 0 || inMax <= 0 || inMax === inMin) {
    return (outMin + outMax) / 2;
  }
  const t = (Math.log10(value) - Math.log10(inMin)) / (Math.log10(inMax) - Math.log10(inMin));
  return outMin + t * (outMax - outMin);
}

function tickValuesLinear(min, max, count = 5) {
  if (max <= min) {
    return [min];
  }
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    ticks.push(min + (i / (count - 1)) * (max - min));
  }
  return ticks;
}

function tickValuesLog(min, max) {
  if (min <= 0 || max <= 0 || max <= min) {
    return [min, max].filter((v) => Number.isFinite(v));
  }
  const ticks = [];
  const eMin = Math.floor(Math.log10(min));
  const eMax = Math.ceil(Math.log10(max));
  for (let e = eMin; e <= eMax; e += 1) {
    const v = 10 ** e;
    if (v >= min && v <= max) {
      ticks.push(v);
    }
  }
  return ticks.length ? ticks : [min, max];
}

function formatTick(value) {
  if (!Number.isFinite(value)) {
    return "?";
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return Number(value).toExponential(1);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function chooseWindowLinear(dataMin, dataMax, boundMin, boundMax) {
  if (boundMin !== null && boundMax !== null && boundMax > boundMin) {
    const span = boundMax - boundMin;
    const pad = Math.max(span * 0.25, (dataMax - dataMin) * 0.01);
    return {
      min: Math.max(dataMin, boundMin - pad),
      max: Math.min(dataMax, boundMax + pad)
    };
  }
  return { min: dataMin, max: dataMax };
}

function chooseWindowLog(dataMin, dataMax, boundMin, boundMax) {
  if (dataMin <= 0 || dataMax <= 0) {
    return { min: dataMin, max: dataMax };
  }
  if (boundMin !== null && boundMax !== null && boundMin > 0 && boundMax > boundMin) {
    const logMin = Math.log10(boundMin);
    const logMax = Math.log10(boundMax);
    const pad = Math.max((logMax - logMin) * 0.25, 0.05);
    return {
      min: Math.max(dataMin, 10 ** (logMin - pad)),
      max: Math.min(dataMax, 10 ** (logMax + pad))
    };
  }
  return { min: dataMin, max: dataMax };
}

function appendTitle(node, text) {
  const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
  t.textContent = text;
  node.appendChild(t);
}

function setHelperSelection(name) {
  if (!helperSelectionEl) {
    return;
  }
  helperSelectionEl.textContent = `Selected planet: ${name}`;
}

function drawPlotScaffold(svg, xLabel, yLabel) {
  const W = 520;
  const H = 320;
  const margin = { left: 64, right: 20, top: 18, bottom: 50 };
  const x0 = margin.left;
  const x1 = W - margin.right;
  const y0 = H - margin.bottom;
  const y1 = margin.top;

  svg.appendChild(svgEl("rect", {
    x: x0,
    y: y1,
    width: x1 - x0,
    height: y0 - y1,
    fill: "rgba(15,23,42,0.35)",
    stroke: "rgba(148,163,184,0.28)",
    "stroke-width": 1
  }));

  svg.appendChild(svgEl("line", { x1: x0, y1: y0, x2: x1, y2: y0, stroke: "rgba(203,213,225,0.9)", "stroke-width": 1.5 }));
  svg.appendChild(svgEl("line", { x1: x0, y1: y0, x2: x0, y2: y1, stroke: "rgba(203,213,225,0.9)", "stroke-width": 1.5 }));

  const xText = svgEl("text", {
    x: (x0 + x1) / 2,
    y: H - 16,
    fill: "#dbeafe",
    "font-size": 15,
    "text-anchor": "middle",
    "font-family": "Space Mono, monospace"
  });
  xText.textContent = xLabel;
  svg.appendChild(xText);

  const yText = svgEl("text", {
    x: 18,
    y: (y0 + y1) / 2,
    fill: "#dbeafe",
    "font-size": 15,
    "text-anchor": "middle",
    "font-family": "Space Mono, monospace",
    transform: `rotate(-90 18 ${(y0 + y1) / 2})`
  });
  yText.textContent = yLabel;
  svg.appendChild(yText);

  return { x0, x1, y0, y1 };
}

function drawTicks(svg, frame, xTicks, yTicks, xMap, yMap) {
  xTicks.forEach((tick) => {
    const x = xMap(tick);
    svg.appendChild(svgEl("line", {
      x1: x,
      y1: frame.y0,
      x2: x,
      y2: frame.y0 + 6,
      stroke: "rgba(203,213,225,0.9)",
      "stroke-width": 1
    }));
    const label = svgEl("text", {
      x,
      y: frame.y0 + 18,
      fill: "#dbeafe",
      "font-size": 10,
      "text-anchor": "middle",
      "font-family": "Space Mono, monospace"
    });
    label.textContent = formatTick(tick);
    svg.appendChild(label);
  });

  yTicks.forEach((tick) => {
    const y = yMap(tick);
    svg.appendChild(svgEl("line", {
      x1: frame.x0 - 6,
      y1: y,
      x2: frame.x0,
      y2: y,
      stroke: "rgba(203,213,225,0.9)",
      "stroke-width": 1
    }));
    const label = svgEl("text", {
      x: frame.x0 - 10,
      y: y + 3,
      fill: "#dbeafe",
      "font-size": 10,
      "text-anchor": "end",
      "font-family": "Space Mono, monospace"
    });
    label.textContent = formatTick(tick);
    svg.appendChild(label);
  });
}

function renderHelperPeriodMass() {
  helperPeriodMassEl.innerHTML = "";
  const frame = drawPlotScaffold(helperPeriodMassEl, "Period (days)", "Mass (Mj)");
  const ranges = computeRanges();

  const pts = dataset
    .map((p) => ({ name: p.name, period: Number(p.properties.Period), mass: Number(p.properties.Mp) }))
    .filter((p) => p.period > 0 && p.mass > 0);
  if (!pts.length) {
    return;
  }

  const dataXMin = Math.min(...pts.map((p) => p.period));
  const dataXMax = Math.max(...pts.map((p) => p.period));
  const dataYMin = Math.min(...pts.map((p) => p.mass));
  const dataYMax = Math.max(...pts.map((p) => p.mass));

  const xWindow = chooseWindowLog(dataXMin, dataXMax, ranges.Period.min, ranges.Period.max);
  const yWindow = chooseWindowLog(dataYMin, dataYMax, ranges.Mp.min, ranges.Mp.max);

  const xMap = (v) => mapLog(v, xWindow.min, xWindow.max, frame.x0, frame.x1);
  const yMap = (v) => mapLog(v, yWindow.min, yWindow.max, frame.y0, frame.y1);

  drawTicks(helperPeriodMassEl, frame, tickValuesLog(xWindow.min, xWindow.max), tickValuesLog(yWindow.min, yWindow.max), xMap, yMap);

  pts.forEach((p) => {
    if (p.period < xWindow.min || p.period > xWindow.max || p.mass < yWindow.min || p.mass > yWindow.max) {
      return;
    }
    const dot = svgEl("circle", {
      cx: xMap(p.period),
      cy: yMap(p.mass),
      r: HELPER_DOT_RADIUS,
      fill: "rgba(191,219,254,0.4)",
      cursor: "pointer"
    });
    appendTitle(dot, p.name);
    dot.addEventListener("click", () => setHelperSelection(p.name));
    helperPeriodMassEl.appendChild(dot);
  });

  const pMin = ranges.Period.min !== null ? ranges.Period.min : xWindow.min;
  const pMax = ranges.Period.max !== null ? ranges.Period.max : xWindow.max;
  const mMin = ranges.Mp.min !== null ? ranges.Mp.min : yWindow.min;
  const mMax = ranges.Mp.max !== null ? ranges.Mp.max : yWindow.max;

  const pMinX = xMap(Math.max(xWindow.min, pMin));
  const pMaxX = xMap(Math.min(xWindow.max, pMax));
  const mMinY = yMap(Math.max(yWindow.min, mMin));
  const mMaxY = yMap(Math.min(yWindow.max, mMax));
  helperPeriodMassEl.appendChild(svgEl("line", { x1: pMinX, y1: frame.y0, x2: pMinX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperPeriodMassEl.appendChild(svgEl("line", { x1: pMaxX, y1: frame.y0, x2: pMaxX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperPeriodMassEl.appendChild(svgEl("line", { x1: frame.x0, y1: mMinY, x2: frame.x1, y2: mMinY, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperPeriodMassEl.appendChild(svgEl("line", { x1: frame.x0, y1: mMaxY, x2: frame.x1, y2: mMaxY, stroke: "#22c55e", "stroke-width": 1.5 }));
}

function renderHelperMassRadius() {
  helperMassRadiusEl.innerHTML = "";
  const frame = drawPlotScaffold(helperMassRadiusEl, "Radius (Rj)", "Mass (Mj)");
  const ranges = computeRanges();

  const pts = dataset
    .map((p) => ({ name: p.name, mass: Number(p.properties.Mp), radius: Number(p.properties.Rp) }))
    .filter((p) => p.mass > 0 && p.radius > 0);
  if (!pts.length) {
    return;
  }

  const dataXMin = Math.min(...pts.map((p) => p.radius));
  const dataXMax = Math.max(...pts.map((p) => p.radius));
  const dataYMin = Math.min(...pts.map((p) => p.mass));
  const dataYMax = Math.max(...pts.map((p) => p.mass));

  const xWindow = chooseWindowLog(dataXMin, dataXMax, ranges.Rp.min, ranges.Rp.max);
  const yWindow = chooseWindowLog(dataYMin, dataYMax, ranges.Mp.min, ranges.Mp.max);

  const xMap = (v) => mapLog(v, xWindow.min, xWindow.max, frame.x0, frame.x1);
  const yMap = (v) => mapLog(v, yWindow.min, yWindow.max, frame.y0, frame.y1);

  drawTicks(helperMassRadiusEl, frame, tickValuesLog(xWindow.min, xWindow.max), tickValuesLog(yWindow.min, yWindow.max), xMap, yMap);

  pts.forEach((p) => {
    if (p.radius < xWindow.min || p.radius > xWindow.max || p.mass < yWindow.min || p.mass > yWindow.max) {
      return;
    }
    const dot = svgEl("circle", {
      cx: xMap(p.radius),
      cy: yMap(p.mass),
      r: HELPER_DOT_RADIUS,
      fill: "rgba(191,219,254,0.4)",
      cursor: "pointer"
    });
    appendTitle(dot, p.name);
    dot.addEventListener("click", () => setHelperSelection(p.name));
    helperMassRadiusEl.appendChild(dot);
  });

  const densityLines = [
    { name: "H2", rho: 0.09, color: "#93c5fd" },
    { name: "Water", rho: 1.0, color: "#38bdf8" },
    { name: "Rock", rho: 5.5, color: "#f59e0b" },
    { name: "Iron", rho: 7.9, color: "#f43f5e" }
  ];
  const rhoJ = 1.326;

  densityLines.forEach((line) => {
    const pathPoints = [];
    for (let i = 0; i < 70; i += 1) {
      const t = i / 69;
      const r = 10 ** (Math.log10(xWindow.min) + t * (Math.log10(xWindow.max) - Math.log10(xWindow.min)));
      const m = (line.rho / rhoJ) * (r ** 3);
      if (r <= 0 || Number.isNaN(r)) {
        continue;
      }
      if (m < yWindow.min || m > yWindow.max) {
        continue;
      }
      const x = xMap(r);
      const y = yMap(m);
      pathPoints.push(`${x},${y}`);
    }
    if (pathPoints.length >= 2) {
      helperMassRadiusEl.appendChild(svgEl("polyline", {
        points: pathPoints.join(" "),
        fill: "none",
        stroke: line.color,
        "stroke-width": 1.2,
        "stroke-opacity": 0.9
      }));
      const last = pathPoints[pathPoints.length - 1].split(",");
      const label = svgEl("text", {
        x: Number(last[0]) - 4,
        y: Number(last[1]) - 4,
        fill: line.color,
        "font-size": 10,
        "text-anchor": "end",
        "font-family": "Space Mono, monospace"
      });
      label.textContent = line.name;
      helperMassRadiusEl.appendChild(label);
    }
  });

  const rpMin = ranges.Rp.min !== null ? ranges.Rp.min : xWindow.min;
  const rpMax = ranges.Rp.max !== null ? ranges.Rp.max : xWindow.max;
  const mpMin = ranges.Mp.min !== null ? ranges.Mp.min : yWindow.min;
  const mpMax = ranges.Mp.max !== null ? ranges.Mp.max : yWindow.max;

  const rpMinX = xMap(Math.max(xWindow.min, rpMin));
  const rpMaxX = xMap(Math.min(xWindow.max, rpMax));
  const mpMinY = yMap(Math.max(yWindow.min, mpMin));
  const mpMaxY = yMap(Math.min(yWindow.max, mpMax));

  helperMassRadiusEl.appendChild(svgEl("line", { x1: rpMinX, y1: frame.y0, x2: rpMinX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperMassRadiusEl.appendChild(svgEl("line", { x1: rpMaxX, y1: frame.y0, x2: rpMaxX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperMassRadiusEl.appendChild(svgEl("line", { x1: frame.x0, y1: mpMinY, x2: frame.x1, y2: mpMinY, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperMassRadiusEl.appendChild(svgEl("line", { x1: frame.x0, y1: mpMaxY, x2: frame.x1, y2: mpMaxY, stroke: "#22c55e", "stroke-width": 1.5 }));
}

function renderHelperTempGravity() {
  helperTempGravityEl.innerHTML = "";
  const frame = drawPlotScaffold(helperTempGravityEl, "Teq (K)", "log(g [cgs])");
  const ranges = computeRanges();
  const JUPITER_G_CGS = 2479;

  const pts = dataset
    .map((p) => {
      const temp = Number(p.properties.Teq);
      const mass = Number(p.properties.Mp);
      const radius = Number(p.properties.Rp);
      const gravJ = mass > 0 && radius > 0 ? mass / (radius * radius) : NaN;
      const loggCgs = gravJ > 0 ? Math.log10(gravJ * JUPITER_G_CGS) : NaN;
      return { name: p.name, temp, loggCgs };
    })
    .filter((p) => !Number.isNaN(p.temp) && Number.isFinite(p.loggCgs));
  if (!pts.length) {
    return;
  }

  const dataXMin = Math.min(...pts.map((p) => p.temp));
  const dataXMax = Math.max(...pts.map((p) => p.temp));
  const dataYMin = Math.min(...pts.map((p) => p.loggCgs));
  const dataYMax = Math.max(...pts.map((p) => p.loggCgs));

  const gravityMinBound = (ranges.Mp.min !== null && ranges.Rp.max !== null && ranges.Rp.max > 0)
    ? ranges.Mp.min / (ranges.Rp.max ** 2)
    : null;
  const gravityMaxBound = (ranges.Mp.max !== null && ranges.Rp.min !== null && ranges.Rp.min > 0)
    ? ranges.Mp.max / (ranges.Rp.min ** 2)
    : null;

  const loggMinBound = gravityMinBound && gravityMinBound > 0
    ? Math.log10(gravityMinBound * JUPITER_G_CGS)
    : null;
  const loggMaxBound = gravityMaxBound && gravityMaxBound > 0
    ? Math.log10(gravityMaxBound * JUPITER_G_CGS)
    : null;

  const xWindow = chooseWindowLinear(dataXMin, dataXMax, ranges.Teq.min, ranges.Teq.max);
  const yWindow = chooseWindowLinear(dataYMin, dataYMax, loggMinBound, loggMaxBound);

  const xMap = (v) => mapLinear(v, xWindow.min, xWindow.max, frame.x0, frame.x1);
  const yMap = (v) => mapLinear(v, yWindow.min, yWindow.max, frame.y0, frame.y1);

  drawTicks(helperTempGravityEl, frame, tickValuesLinear(xWindow.min, xWindow.max), tickValuesLinear(yWindow.min, yWindow.max), xMap, yMap);

  pts.forEach((p) => {
    if (p.temp < xWindow.min || p.temp > xWindow.max || p.loggCgs < yWindow.min || p.loggCgs > yWindow.max) {
      return;
    }
    const dot = svgEl("circle", {
      cx: xMap(p.temp),
      cy: yMap(p.loggCgs),
      r: HELPER_DOT_RADIUS,
      fill: "rgba(191,219,254,0.4)",
      cursor: "pointer"
    });
    appendTitle(dot, p.name);
    dot.addEventListener("click", () => setHelperSelection(p.name));
    helperTempGravityEl.appendChild(dot);
  });

  const teqMin = ranges.Teq.min !== null ? ranges.Teq.min : xWindow.min;
  const teqMax = ranges.Teq.max !== null ? ranges.Teq.max : xWindow.max;
  const gravMin = loggMinBound !== null ? loggMinBound : yWindow.min;
  const gravMax = loggMaxBound !== null ? loggMaxBound : yWindow.max;

  const teqMinX = xMap(Math.max(xWindow.min, teqMin));
  const teqMaxX = xMap(Math.min(xWindow.max, teqMax));
  const gravMinY = yMap(Math.max(yWindow.min, gravMin));
  const gravMaxY = yMap(Math.min(yWindow.max, gravMax));

  helperTempGravityEl.appendChild(svgEl("line", { x1: teqMinX, y1: frame.y0, x2: teqMinX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperTempGravityEl.appendChild(svgEl("line", { x1: teqMaxX, y1: frame.y0, x2: teqMaxX, y2: frame.y1, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperTempGravityEl.appendChild(svgEl("line", { x1: frame.x0, y1: gravMinY, x2: frame.x1, y2: gravMinY, stroke: "#22c55e", "stroke-width": 1.5 }));
  helperTempGravityEl.appendChild(svgEl("line", { x1: frame.x0, y1: gravMaxY, x2: frame.x1, y2: gravMaxY, stroke: "#22c55e", "stroke-width": 1.5 }));
}

function renderHelperPlots() {
  if (!helperPeriodMassEl || !helperMassRadiusEl || !helperTempGravityEl) {
    return;
  }
  renderHelperPeriodMass();
  renderHelperMassRadius();
  renderHelperTempGravity();
}

function renderRadiusViz() {
  radiusVizEl.innerHTML = "";

  const ranges = computeRanges();
  const rpRange = ranges.Rp;
  const lastGuess = state.guesses[state.guesses.length - 1];
  const guessRpEntry = lastGuess ? lastGuess.statuses.find((s) => s.key === "Rp") : null;
  const guessRp = guessRpEntry ? Number(guessRpEntry.value) : null;

  const modelMaxCandidates = [1.8, ...REF_RADII_RJ.map((r) => r.rj)];
  if (guessRp && !Number.isNaN(guessRp)) {
    modelMaxCandidates.push(guessRp * 1.15);
  }
  if (rpRange.max !== null) {
    modelMaxCandidates.push(rpRange.max * 1.1);
  }
  if (rpRange.min !== null) {
    modelMaxCandidates.push(rpRange.min * 1.35);
  }
  const modelMax = Math.max(...modelMaxCandidates);

  const cx = 170;
  const cy = 170;
  const maxPx = 130;
  const scale = maxPx / modelMax;

  const bg = svgEl("circle", {
    cx,
    cy,
    r: maxPx,
    fill: "rgba(15, 23, 42, 0.45)",
    stroke: "rgba(148, 163, 184, 0.3)",
    "stroke-width": 1
  });
  radiusVizEl.appendChild(bg);

  if (rpRange.min !== null || rpRange.max !== null) {
    const minRj = rpRange.min !== null ? Math.max(0, rpRange.min) : 0;
    const maxRj = rpRange.max !== null ? Math.max(minRj + 0.001, rpRange.max) : modelMax;
    const minPx = minRj * scale;
    const maxPxRange = Math.min(maxPx, maxRj * scale);
    const edgePadPx = 1.5;
    const innerPx = Math.max(0, minPx - edgePadPx);
    const outerPx = Math.min(maxPx, maxPxRange + edgePadPx);
    const midPx = (innerPx + outerPx) / 2;
    const widthPx = Math.max(2, outerPx - innerPx);

    const annulus = svgEl("circle", {
      cx,
      cy,
      r: midPx,
      fill: "none",
      stroke: "rgba(34, 197, 94, 0.85)",
      "stroke-width": widthPx,
      "stroke-opacity": 0.55
    });
    radiusVizEl.appendChild(annulus);
  }

  REF_RADII_RJ.forEach((ref) => {
    const refR = ref.rj * scale;
    const refCircle = svgEl("circle", {
      cx,
      cy,
      r: refR,
      fill: "none",
      stroke: ref.color,
      "stroke-width": 1.5,
      "stroke-dasharray": "5 4",
      "stroke-opacity": 0.95
    });
    radiusVizEl.appendChild(refCircle);

    const label = svgEl("text", {
      x: cx,
      y: cy - refR - 4,
      fill: ref.color,
      "font-size": 13,
      "text-anchor": "middle",
      "font-family": "Space Mono, monospace"
    });
    label.textContent = `${ref.name}`;
    radiusVizEl.appendChild(label);
  });

  if (guessRp !== null && !Number.isNaN(guessRp)) {
    const guessCircle = svgEl("circle", {
      cx,
      cy,
      r: Math.max(1, guessRp * scale),
      fill: "none",
      stroke: "#e2e8f0",
      "stroke-width": 2.4
    });
    radiusVizEl.appendChild(guessCircle);
  }

  state.guesses.forEach((guessRow, idx) => {
    const entry = guessRow.statuses.find((s) => s.key === "Rp");
    if (!entry) {
      return;
    }
    const g = Number(entry.value);
    if (Number.isNaN(g) || !inNumericRange(g, rpRange)) {
      return;
    }
    const r = Math.max(1, g * scale);
    const gCircle = svgEl("circle", {
      cx,
      cy,
      r,
      fill: "none",
      stroke: "rgba(219,234,254,0.28)",
      "stroke-width": 1
    });
    const txt = svgEl("text", {
      x: cx,
      y: Math.max(12, cy - r - (idx % 3) * 10),
      fill: "rgba(219,234,254,0.55)",
      "font-size": 9,
      "text-anchor": "middle",
      "font-family": "Space Mono, monospace"
    });
    txt.textContent = guessRow.name;
    radiusVizEl.appendChild(gCircle);
    radiusVizEl.appendChild(txt);
  });

}

function renderTemperatureViz() {
  tempVizEl.innerHTML = "";

  const ranges = computeRanges();
  const teqRange = ranges.Teq;
  const teqValues = dataset
    .map((planet) => Number(planet.properties.Teq))
    .filter((value) => !Number.isNaN(value));

  const dataMin = teqValues.length ? Math.min(...teqValues) : 0;
  const dataMax = teqValues.length ? Math.max(...teqValues) : 5000;

  const minVal = teqRange.min !== null ? teqRange.min : 0;
  const maxVal = teqRange.max !== null ? teqRange.max : 5000;

  const pad = Math.max(80, 0.15 * Math.max(1, maxVal - minVal));
  let axisMin = Math.max(0, Math.floor(minVal - pad));
  let axisMax = Math.min(5000, Math.ceil(maxVal + pad));
  axisMin = Math.max(axisMin, Math.floor(dataMin));
  axisMax = Math.min(axisMax, Math.ceil(dataMax));
  if (axisMax - axisMin < 200) {
    const mid = (axisMax + axisMin) / 2;
    axisMin = Math.max(0, Math.floor(mid - 100));
    axisMax = Math.min(5000, Math.ceil(mid + 100));
  }

  const yTop = 10;
  const yBottom = 304;
  const tubeX = 86;
  const tubeInnerWidth = 22;
  const tubeOuterWidth = 32;
  const bulbOuterR = 30;
  const bulbInnerR = 20;

  const yForTemp = (temp) => {
    const t = Math.max(axisMin, Math.min(axisMax, temp));
    const ratio = (t - axisMin) / (axisMax - axisMin);
    return yBottom - ratio * (yBottom - yTop);
  };

  const tubeOuter = svgEl("rect", {
    x: tubeX - tubeOuterWidth / 2,
    y: yTop,
    width: tubeOuterWidth,
    height: yBottom - yTop,
    rx: tubeOuterWidth / 2,
    fill: "rgba(15, 23, 42, 0.85)",
    stroke: "rgba(203, 213, 225, 0.9)",
    "stroke-width": 2
  });
  const bulbOuter = svgEl("circle", {
    cx: tubeX,
    cy: yBottom + bulbOuterR - 4,
    r: bulbOuterR,
    fill: "rgba(15, 23, 42, 0.92)",
    stroke: "rgba(203, 213, 225, 0.9)",
    "stroke-width": 2
  });
  tempVizEl.appendChild(tubeOuter);
  tempVizEl.appendChild(bulbOuter);

  const tickCount = 6;
  for (let i = 0; i <= tickCount; i += 1) {
    const ratio = i / tickCount;
    const y = yBottom - ratio * (yBottom - yTop);
    const value = axisMin + ratio * (axisMax - axisMin);
    const tick = svgEl("line", {
      x1: tubeX + 18,
      y1: y,
      x2: tubeX + 31,
      y2: y,
      stroke: "rgba(219, 234, 254, 0.9)",
      "stroke-width": 1.5
    });
    const label = svgEl("text", {
      x: tubeX + 35,
      y: y + 4,
      fill: "#dbeafe",
      "font-size": 12,
      "font-family": "Space Mono, monospace"
    });
    label.textContent = `${Math.round(value)}K`;
    tempVizEl.appendChild(tick);
    tempVizEl.appendChild(label);
  }

  const yUpper = yForTemp(maxVal);
  const yLower = yForTemp(minVal);

  const validLiquid = svgEl("rect", {
    x: tubeX - tubeInnerWidth / 2,
    y: Math.min(yUpper, yLower),
    width: tubeInnerWidth,
    height: Math.max(3, Math.abs(yLower - yUpper)),
    rx: tubeInnerWidth / 2,
    fill: "rgba(34, 197, 94, 0.75)",
    stroke: "rgba(34, 197, 94, 0.95)",
    "stroke-width": 1
  });
  const bulbFill = svgEl("circle", {
    cx: tubeX,
    cy: yBottom + bulbOuterR - 4,
    r: bulbInnerR,
    fill: "#f8fafc",
    stroke: "rgba(226, 232, 240, 0.95)",
    "stroke-width": 1
  });
  tempVizEl.appendChild(validLiquid);
  tempVizEl.appendChild(bulbFill);

  const lastGuess = state.guesses[state.guesses.length - 1];
  const guessTeqEntry = lastGuess ? lastGuess.statuses.find((s) => s.key === "Teq") : null;
  const guessTeq = guessTeqEntry ? Number(guessTeqEntry.value) : null;
  if (guessTeq !== null && !Number.isNaN(guessTeq)) {
    const gy = yForTemp(guessTeq);
    const marker = svgEl("circle", {
      cx: tubeX,
      cy: gy,
      r: 6,
      fill: "#f8fafc",
      stroke: "#1e293b",
      "stroke-width": 1.5
    });
    tempVizEl.appendChild(marker);
  }

  state.guesses.forEach((guessRow, idx) => {
    const entry = guessRow.statuses.find((s) => s.key === "Teq");
    if (!entry) {
      return;
    }
    const g = Number(entry.value);
    if (Number.isNaN(g) || !inNumericRange(g, teqRange)) {
      return;
    }
    const gy = yForTemp(g);
    const line = svgEl("line", {
      x1: tubeX - 14,
      y1: gy,
      x2: tubeX + 14,
      y2: gy,
      stroke: "rgba(219,234,254,0.35)",
      "stroke-width": 1
    });
    const txt = svgEl("text", {
      x: tubeX - 22,
      y: gy + ((idx % 2) ? -2 : 10),
      fill: "rgba(219,234,254,0.55)",
      "font-size": 9,
      "text-anchor": "end",
      "font-family": "Space Mono, monospace"
    });
    txt.textContent = guessRow.name;
    tempVizEl.appendChild(line);
    tempVizEl.appendChild(txt);
  });

  const title = svgEl("text", {
    x: tubeX,
    y: 374,
    fill: "#dbeafe",
    "font-size": 18,
    "text-anchor": "middle",
    "font-family": "Space Mono, monospace"
  });
  title.textContent = "Equilibrium Temp";

  tempVizEl.appendChild(title);
}

function renderMassViz() {
  massVizEl.innerHTML = "";

  const ranges = computeRanges();
  const massRange = ranges.Mp;
  const masses = dataset
    .map((planet) => Number(planet.properties.Mp))
    .filter((value) => !Number.isNaN(value) && value > 0);
  const periodRange = ranges.Period;
  const periods = dataset
    .map((planet) => Number(planet.properties.Period))
    .filter((value) => !Number.isNaN(value) && value > 0);

  const massAxisMin = masses.length ? Math.min(...masses) : 0.001;
  const massAxisMax = masses.length ? Math.max(...masses) : 10;
  const periodAxisMin = periods.length ? Math.min(...periods) : 0.1;
  const periodAxisMax = periods.length ? Math.max(...periods) : 100;

  const left = 70;
  const right = 650;
  const beamY = 52;
  const panY = 84;
  const width = right - left;

  const xForMass = (mass) => {
    const m = Math.max(massAxisMin, Math.min(massAxisMax, mass));
    const ratio = (m - massAxisMin) / (massAxisMax - massAxisMin);
    return left + ratio * width;
  };
  const xForPeriod = (period) => {
    const p = Math.max(periodAxisMin, Math.min(periodAxisMax, period));
    const ratio = (Math.log10(p) - Math.log10(periodAxisMin)) / (Math.log10(periodAxisMax) - Math.log10(periodAxisMin));
    return left + ratio * width;
  };

  const lowerBoundMass = massRange.min !== null ? massRange.min : massAxisMin;
  const upperBoundMass = massRange.max !== null ? massRange.max : massAxisMax;

  const xLeftPan = 220;
  const xRightPan = 480;
  const fulcrumX = (xLeftPan + xRightPan) / 2;

  const beam = svgEl("line", {
    x1: xLeftPan,
    y1: beamY,
    x2: xRightPan,
    y2: beamY,
    stroke: "rgba(203, 213, 225, 0.9)",
    "stroke-width": 6,
    "stroke-linecap": "round"
  });
  const fulcrum = svgEl("polygon", {
    points: `${fulcrumX - 14},86 ${fulcrumX + 14},86 ${fulcrumX},56`,
    fill: "rgba(148, 163, 184, 0.85)",
    stroke: "rgba(203, 213, 225, 0.95)",
    "stroke-width": 2
  });
  massVizEl.appendChild(beam);
  massVizEl.appendChild(fulcrum);

  const drawPan = (x, label, value) => {
    const hanger = svgEl("line", {
      x1: x,
      y1: beamY,
      x2: x,
      y2: panY - 6,
      stroke: "rgba(203, 213, 225, 0.95)",
      "stroke-width": 1.6
    });
    const pan = svgEl("rect", {
      x: x - 28,
      y: panY - 6,
      width: 56,
      height: 10,
      rx: 5,
      fill: "rgba(34, 197, 94, 0.8)",
      stroke: "rgba(34, 197, 94, 0.95)",
      "stroke-width": 1
    });
    const txt = svgEl("text", {
      x,
      y: panY + 24,
      fill: "#86efac",
      "font-size": 10,
      "text-anchor": "middle",
      "font-family": "Space Mono, monospace"
    });
    txt.textContent = value === null ? `${label}: --` : `${label}: ${formatSci(value)} Mj`;
    massVizEl.appendChild(hanger);
    massVizEl.appendChild(pan);
    massVizEl.appendChild(txt);
  };

  drawPan(xLeftPan, "Lower Bound", lowerBoundMass);
  drawPan(xRightPan, "Upper Bound", upperBoundMass);

  const massTitle = svgEl("text", {
    x: 350,
    y: 24,
    fill: "#dbeafe",
    "font-size": 14,
    "text-anchor": "middle",
    "font-family": "Space Mono, monospace"
  });
  massTitle.textContent = "Planet Mass";
  massVizEl.appendChild(massTitle);

  const periodMin = periodRange.min !== null ? periodRange.min : periodAxisMin;
  const periodMax = periodRange.max !== null ? periodRange.max : periodAxisMax;
  const periodY = 170;

  const periodBase = svgEl("line", {
    x1: left,
    y1: periodY,
    x2: right,
    y2: periodY,
    stroke: "rgba(203, 213, 225, 0.9)",
    "stroke-width": 4,
    "stroke-linecap": "round"
  });
  const periodSegment = svgEl("line", {
    x1: Math.min(xForPeriod(periodMin), xForPeriod(periodMax)),
    y1: periodY,
    x2: Math.max(xForPeriod(periodMin), xForPeriod(periodMax)),
    y2: periodY,
    stroke: "rgba(34, 197, 94, 0.95)",
    "stroke-width": 9,
    "stroke-linecap": "round"
  });
  const periodLeftBound = svgEl("line", {
    x1: xForPeriod(periodMin),
    y1: periodY - 16,
    x2: xForPeriod(periodMin),
    y2: periodY + 16,
    stroke: "#22c55e",
    "stroke-width": 2
  });
  const periodRightBound = svgEl("line", {
    x1: xForPeriod(periodMax),
    y1: periodY - 16,
    x2: xForPeriod(periodMax),
    y2: periodY + 16,
    stroke: "#22c55e",
    "stroke-width": 2
  });
  const periodTitle = svgEl("text", {
    x: 350,
    y: 146,
    fill: "#dbeafe",
    "font-size": 14,
    "text-anchor": "middle",
    "font-family": "Space Mono, monospace"
  });
  periodTitle.textContent = "Orbital Period";
  const tickExponents = [];
  for (let p = Math.floor(Math.log10(periodAxisMin)); p <= Math.ceil(Math.log10(periodAxisMax)); p += 1) {
    tickExponents.push(p);
  }
  tickExponents.forEach((exp) => {
    const val = 10 ** exp;
    if (val < periodAxisMin || val > periodAxisMax) {
      return;
    }
    const x = xForPeriod(val);
    const tLine = svgEl("line", {
      x1: x,
      y1: periodY + 10,
      x2: x,
      y2: periodY + 18,
      stroke: "rgba(203,213,225,0.9)",
      "stroke-width": 1
    });
    const tLabel = svgEl("text", {
      x,
      y: periodY + 32,
      fill: "rgba(203,213,225,0.9)",
      "font-size": 10,
      "text-anchor": "middle",
      "font-family": "Space Mono, monospace"
    });
    tLabel.textContent = `${formatSci(val)} d`;
    massVizEl.appendChild(tLine);
    massVizEl.appendChild(tLabel);
  });

  massVizEl.appendChild(periodTitle);
  massVizEl.appendChild(periodBase);
  massVizEl.appendChild(periodSegment);
  massVizEl.appendChild(periodLeftBound);
  massVizEl.appendChild(periodRightBound);
}

function renderStellarChips() {
  stellarChipsEl.innerHTML = "";

  const guessedTypes = new Set();
  state.guesses.forEach((guessRow) => {
    const entry = guessRow.statuses.find((status) => status.key === "StarType");
    if (entry && typeof entry.value === "string") {
      guessedTypes.add(entry.value);
    }
  });

  STELLAR_ORDER.forEach((type) => {
    const chip = document.createElement("div");
    chip.className = "stellarChip";
    chip.textContent = type;

    if (guessedTypes.has(type)) {
      if (type === targetPlanet.properties.StarType) {
        chip.classList.add("correct");
      } else {
        chip.classList.add("wrong");
      }
    }

    stellarChipsEl.appendChild(chip);
  });
}

async function init() {
  const response = await fetch("./planets.json", { cache: "no-store" });
  if (!response.ok) {
    feedbackEl.textContent = "Could not load planets dataset.";
    return;
  }

  const payload = await response.json();
  dataset = payload.planets || [];

  if (!dataset.length) {
    feedbackEl.textContent = "No planets available in dataset.";
    return;
  }

  dataset.forEach((planet) => {
    planetByName.set(normalizeName(planet.name), planet);
  });

  try {
    const featuredResponse = await fetch("./featured_planets.json", { cache: "no-store" });
    if (featuredResponse.ok) {
      const featuredPayload = await featuredResponse.json();
      const names = Array.isArray(featuredPayload.planets) ? featuredPayload.planets : [];
      const allowed = new Set(names.map((name) => normalizeName(String(name))));
      featuredPool = dataset.filter((planet) => allowed.has(normalizeName(planet.name)));
    }
  } catch {
    featuredPool = [];
  }

  dayNumber = getUtcDayNumber();
  const activePool = featuredPool.length ? featuredPool : dataset;
  const idx = deterministicIndexForDay(dayNumber, activePool.length);
  targetPlanet = activePool[idx];

  const utcDate = new Date(dayNumber * 86400000);
  const yyyy = utcDate.getUTCFullYear();
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcDate.getUTCDate()).padStart(2, "0");
  dayMetaEl.textContent = `${yyyy}-${mm}-${dd}`;

  state = loadState();
  updateModeButton();
  renderHistory();
  renderRadiusViz();
  renderTemperatureViz();
  renderMassViz();
  renderStellarChips();
  updateStatus();

  hintBtnEl.addEventListener("click", () => {
    if (hintRevealed) {
      return;
    }
    feedbackEl.textContent = SINGLE_HINT_TEXT;
    hintRevealed = true;
    updateStatus();
  });

  helperToggleBtnEl.addEventListener("click", () => {
    helperPanelEl.classList.toggle("hidden");
    if (!helperPanelEl.classList.contains("hidden")) {
      renderHelperPlots();
    }
  });

  modeToggleBtnEl.addEventListener("click", () => {
    gameMode = gameMode === "hard" ? "easy" : "hard";
    updateModeButton();
    renderHistory();
    updateStatus();
  });

  closeModalBtnEl.addEventListener("click", hideEndModal);
  copyShareBtnEl.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareGridEl.textContent || "");
      copyShareBtnEl.textContent = "Copied";
      window.setTimeout(() => {
        copyShareBtnEl.textContent = "Copy Share";
      }, 1200);
    } catch {
      copyShareBtnEl.textContent = "Copy failed";
      window.setTimeout(() => {
        copyShareBtnEl.textContent = "Copy Share";
      }, 1200);
    }
  });

  guessBtnEl.addEventListener("click", submitGuess);
  guessInputEl.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!currentSuggestions.length) {
        updateSuggestions();
      }
      if (currentSuggestions.length) {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
        renderActiveSuggestion();
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (currentSuggestions.length) {
        event.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
        renderActiveSuggestion();
      }
      return;
    }

    if (event.key === "Enter") {
      if (acceptActiveSuggestion()) {
        return;
      }
      submitGuess();
      return;
    }

    if (event.key === "Escape") {
      clearSuggestions();
    }
  });

  guessInputEl.addEventListener("input", updateSuggestions);
  guessInputEl.addEventListener("blur", () => {
    window.setTimeout(() => {
      clearSuggestions();
    }, 100);
  });

  guessInputEl.addEventListener("focus", updateSuggestions);
}

init();
