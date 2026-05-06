const API_KEY_LS = "ads_openai_api_key";
const API_STORAGE_MODE_LS = "ads_api_storage_mode";
const BACKEND_URL_LS = "ads_backend_url";
const SPLIT_MAX = 120;

let memoryApiKey = "";

const getBackendUrl = () => {
  const url = $("backendUrlInput") ? $("backendUrlInput").value.trim() : "";
  return url || "http://127.0.0.1:5180";
};

const soloSampleScript = `1,narration,"こんにちは。これは1人用ナレーションのサンプルです。",ナレーター,Clone_1,1
2,pause,,,PAUSE_0.7S,1
3,narration,"登録した声、または無料登録ボイスを使って音声生成できます。",ナレーター,Clone_1,1`;

const multiSampleScript = `1,dialogue,"こんにちは。今日は音声対談スタジオのテストです。",司会,Female_1,1
2,dialogue,"無料で動く範囲から始めて、必要になったらAPI連携を増やせます。",専門家,Male_1,1
3,pause,,,PAUSE_0.7S,1
4,dialogue,"まずは台本を作って、ブラウザの声で再生してみましょう。",司会,Female_1,1`;

const sampleScripts = { solo: soloSampleScript, multi: multiSampleScript };

const previewTexts = {
  JP: "これはボイスの試聴サンプルです。",
  EN_NEWEST: "This is a voice preview sample.",
  ZH: "这是语音预览示例。",
  KR: "이것은 음성 미리 듣기 샘플입니다.",
};

const state = {
  rows: [],
  voices: [],
  playing: false,
  openVoiceReady: false,
  referenceBlob: null,
  referenceFileName: "",
  recorder: null,
  recordedChunks: [],
  recordingTimer: null,
  recordingSeconds: 0,
};

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2800);
}

// --- CSV ---
function parseCsvLine(line) {
  const cells = []; let current = ""; let quoted = false;
  for (const char of line) {
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseScript(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const c = parseCsvLine(line);
    return { id: Number(c[0]) || i + 1, type: c[1] || "dialogue", text: c[2] || "", character: c[3] || "", voiceId: c[4] || "Female_1", page: Number(c[5]) || 1, raw: line };
  });
}

function toCsv(rows) {
  return rows.map((r) => {
    const t = String(r.text || "").replaceAll('"', '""');
    return `${r.id},${r.type},"${t}",${r.character || ""},${r.voiceId || ""},${r.page || 1}`;
  }).join("\n");
}

// --- API Key Storage ---
function getStorageMode() {
  return localStorage.getItem(API_STORAGE_MODE_LS) || "browser";
}

function setStorageMode(mode) {
  localStorage.setItem(API_STORAGE_MODE_LS, mode);
}

async function loadApiKey() {
  const mode = getStorageMode();
  if (mode === "browser") return localStorage.getItem(API_KEY_LS) || "";
  if (mode === "memory") return memoryApiKey;
  if (mode === "file") {
    try {
      const res = await fetch(`${getBackendUrl()}/api/config/apikey`);
      if (!res.ok) return "";
      const data = await res.json();
      return data.key || "";
    } catch { return ""; }
  }
  return "";
}

async function saveApiKey(key) {
  const mode = getStorageMode();
  if (mode === "browser") { localStorage.setItem(API_KEY_LS, key); return; }
  if (mode === "memory") { memoryApiKey = key; return; }
  if (mode === "file") {
    const path = $("apiFilePathInput").value.trim();
    if (!path) throw new Error("保存先パスを入力してください。");
    await fetch(`${getBackendUrl()}/api/config/apikey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, path }),
    });
  }
}

async function removeApiKey() {
  const mode = getStorageMode();
  if (mode === "browser") localStorage.removeItem(API_KEY_LS);
  if (mode === "memory") memoryApiKey = "";
  if (mode === "file") {
    try { await fetch(`${getBackendUrl()}/api/config/apikey`, { method: "DELETE" }); } catch {}
  }
}

// --- Character Voice Map ---
const voiceOptions = ["Clone_1", "Female_1", "Male_1", "base-jp", "base-en", "base-zh", "base-kr"];

function renderCharacterMap() {
  const map = $("characterVoiceMap");
  const chars = [...new Set(state.rows.filter((r) => r.type !== "pause" && r.character).map((r) => r.character))];
  if (chars.length < 2) { map.hidden = true; return; }
  map.hidden = false;
  map.innerHTML = "<h3>キャラクター別ボイス割当</h3>";
  chars.forEach((name) => {
    const current = state.rows.find((r) => r.character === name)?.voiceId || "Female_1";
    const row = document.createElement("div");
    row.className = "character-map-row";
    const label = document.createElement("span");
    label.className = "char-name";
    label.textContent = name;
    const sel = document.createElement("select");
    voiceOptions.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v; if (v === current) opt.selected = true;
      sel.append(opt);
    });
    sel.addEventListener("change", () => {
      state.rows.forEach((r) => { if (r.character === name) r.voiceId = sel.value; });
      $("scriptText").value = toCsv(state.rows);
      renderLines();
    });
    row.append(label, sel);
    map.append(row);
  });
}

// --- Render Lines ---
function renderLines() {
  const list = $("lineList");
  list.innerHTML = "";
  $("lineSummary").textContent = `${state.rows.length} 行の台本を読み込みました`;
  state.rows.forEach((row, index) => {
    const card = document.createElement("article");
    card.className = "line-card";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = row.type === "pause" ? "ポーズ" : row.voiceId;
    const text = document.createElement("div");
    text.className = "line-text";
    const name = document.createElement("strong");
    name.textContent = row.character || row.type;
    const body = document.createElement("span");
    body.textContent = row.text || "[無音]";
    text.append(name, body);
    const button = document.createElement("button");
    button.textContent = row.type === "pause" ? "待機" : "再生";
    button.addEventListener("click", () => playFrom(index, true));
    card.append(badge, text, button);
    list.append(card);
  });
  const first = state.rows.find((r) => r.type !== "pause" && r.text);
  if (first && !$("ttsText").value.trim()) $("ttsText").value = first.text;
  renderCharacterMap();
}

// --- Browser Speech ---
function refreshVoices() {
  state.voices = speechSynthesis.getVoices();
  const sel = $("voiceSelect"); sel.innerHTML = "";
  state.voices.forEach((v, i) => {
    const o = document.createElement("option"); o.value = String(i);
    o.textContent = `${v.name} (${v.lang})`; sel.append(o);
  });
  const jp = state.voices.findIndex((v) => v.lang.toLowerCase().startsWith("ja"));
  if (jp >= 0) sel.value = String(jp);
}

function pauseDuration(row) {
  const m = String(row.voiceId || row.text || "").match(/PAUSE_(\d+(?:\.\d+)?)S/i);
  return m ? Number(m[1]) * 1000 : 700;
}

function speak(row) {
  return new Promise((resolve) => {
    if (row.type === "pause") { window.setTimeout(resolve, pauseDuration(row)); return; }
    const u = new SpeechSynthesisUtterance(row.text);
    const v = state.voices[Number($("voiceSelect").value)];
    if (v) u.voice = v;
    u.rate = Number($("rateInput").value);
    u.pitch = Number($("pitchInput").value);
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

async function playFrom(startIndex, single = false) {
  if (!state.rows.length) loadScriptFromEditor();
  if (!state.rows.length) return;
  speechSynthesis.cancel(); state.playing = true;
  const end = single ? startIndex + 1 : state.rows.length;
  for (let i = startIndex; i < end; i++) {
    if (!state.playing) break;
    await speak(state.rows[i]);
  }
  state.playing = false;
}

function loadScriptFromEditor() {
  state.rows = parseScript($("scriptText").value);
  renderLines();
}

function download(filename, content, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// --- OpenVoice ---
function setOpenVoiceStatus(message, kind = "") {
  const s = $("openVoiceStatus"); s.textContent = message; s.className = `status ${kind}`.trim();
}

async function checkOpenVoice() {
  try {
    const r = await fetch(`${getBackendUrl()}/api/health`);
    if (!r.ok) throw new Error();
    const d = await r.json();
    state.openVoiceReady = true;
    setOpenVoiceStatus(d.openvoice_ready ? "OpenVoice準備完了" : "サーバー起動中。OpenVoice本体は未設定です", d.openvoice_ready ? "ready" : "missing");
  } catch {
    state.openVoiceReady = false;
    setOpenVoiceStatus("OpenVoiceサーバー未起動。ブラウザ音声のみ利用できます", "missing");
  }
}

// --- Quality Check ---
async function checkAudioQuality(blob) {
  const checkEl = $("audioQualityCheck");
  checkEl.innerHTML = "<h3>品質チェック</h3>";
  checkEl.hidden = false;

  const results = {
    length: { label: "長さ", status: "ok", text: "10秒以上推奨" },
    size: { label: "サイズ", status: "ok", text: "OK" }
  };

  // Length check (rough estimate by size if duration isn't easily accessible)
  // Actually, we can use an Audio object to get duration
  const audio = new Audio(URL.createObjectURL(blob));
  await new Promise(r => audio.onloadedmetadata = r);
  const duration = audio.duration;
  
  if (duration < 5) {
    results.length = { label: "長さ", status: "error", text: `${duration.toFixed(1)}秒 (短すぎます)` };
  } else if (duration < 10) {
    results.length = { label: "長さ", status: "warn", text: `${duration.toFixed(1)}秒 (10秒以上推奨)` };
  } else {
    results.length = { label: "長さ", status: "ok", text: `${duration.toFixed(1)}秒` };
  }

  const sizeMB = blob.size / (1024 * 1024);
  if (sizeMB > 20) {
    results.size = { label: "サイズ", status: "warn", text: `${sizeMB.toFixed(1)}MB (大容量です)` };
  } else {
    results.size = { label: "サイズ", status: "ok", text: `${sizeMB.toFixed(1)}MB` };
  }

  Object.values(results).forEach(res => {
    const item = document.createElement("div");
    item.className = "status-item";
    item.innerHTML = `<span>${res.label}</span><span class="${res.status}">${res.text}</span>`;
    checkEl.append(item);
  });

  return !Object.values(results).some(r => r.status === "error");
}

function setReferenceAudio(blob, fileName) {
  state.referenceBlob = blob;
  state.referenceFileName = fileName;
  const preview = $("referencePreview");
  preview.src = URL.createObjectURL(blob);
  preview.hidden = false;
  checkAudioQuality(blob);
}

// --- Profiles ---
async function loadProfiles() {
  try {
    const r = await fetch(`${getBackendUrl()}/api/profiles`);
    if (!r.ok) return;
    const data = await r.json();
    renderProfiles(data.profiles);
    updateVoiceSelect(data.profiles);
  } catch (e) { console.error("Profiles error:", e); }
}

function renderProfiles(profiles) {
  const list = $("profileList");
  list.innerHTML = "";
  if (!profiles.length) return;

  profiles.forEach(name => {
    const item = document.createElement("div");
    item.className = "profile-item";
    item.innerHTML = `<span>${name}</span>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    
    const delBtn = document.createElement("button");
    delBtn.className = "btn-delete compact";
    delBtn.textContent = "削除";
    delBtn.onclick = () => deleteProfile(name);
    
    actions.append(delBtn);
    item.append(actions);
    list.append(item);
  });
}

function updateVoiceSelect(profiles) {
  const sel = $("registeredVoiceSelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  
  // Custom profiles
  profiles.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = `登録済み: ${name}`;
    sel.append(opt);
  });

  // Built-in voices
  const builtIn = [
    { id: "base-jp", name: "無料: 日本語" },
    { id: "base-en", name: "無料: 英語" },
    { id: "base-zh", name: "無料: 中国語" },
    { id: "base-kr", name: "無料: 韓国語" }
  ];
  builtIn.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id; opt.textContent = v.name;
    sel.append(opt);
  });

  if (current) sel.value = current;

  // Update voiceOptions for Character Map
  voiceOptions.length = 0;
  profiles.forEach(p => voiceOptions.push(p));
  ["Female_1", "Male_1", "base-jp", "base-en", "base-zh", "base-kr"].forEach(v => voiceOptions.push(v));
  renderCharacterMap();
}

async function deleteProfile(name) {
  if (!confirm(`プロファイル '${name}' を削除しますか？`)) return;
  try {
    const r = await fetch(`${getBackendUrl()}/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) throw new Error("削除に失敗しました");
    showToast("プロファイルを削除しました");
    loadProfiles();
  } catch (e) { showToast(e.message); }
}

function updateVoiceSelect(profiles) {
  const sel = $("registeredVoiceSelect");
  // Keep base voices, remove old profiles
  const baseVoices = ["clone", "base-jp", "base-en", "base-zh", "base-kr"];
  Array.from(sel.options).forEach(opt => {
    if (!baseVoices.includes(opt.value)) sel.remove(opt.index);
  });

  profiles.forEach(name => {
    const opt = document.createElement("option");
    opt.value = `profile:${name}`;
    opt.textContent = `クローン: ${name}`;
    sel.append(opt);
  });
}

async function uploadReferenceVoice() {
  if (!$("consentInput").checked) throw new Error("本人または許可済み音声であることを確認してください。");
  if (!state.referenceBlob) throw new Error("参照音声をアップロードまたは録音してください。");
  
  const profileName = $("profileNameInput").value.trim() || "default";

  const form = new FormData();
  form.append("voice", state.referenceBlob, state.referenceFileName || "reference.webm");
  form.append("profileName", profileName);

  const response = await fetch(`${getBackendUrl()}/api/clone`, {
    method: "POST",
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "声の登録に失敗しました。");
  loadProfiles();
  return data;
}

// --- Split Text ---
function splitText(text, maxLen = SPLIT_MAX) {
  if (text.length <= maxLen) return [text];
  const chunks = []; let buf = "";
  const sentences = text.split(/(?<=[。．！？\n])/);
  for (const s of sentences) {
    if (buf.length + s.length > maxLen && buf) { chunks.push(buf.trim()); buf = ""; }
    buf += s;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : [text];
}

// --- Generate Audio ---
async function generateOpenVoiceAudio() {
  const text = $("ttsText").value.trim();
  if (!text) throw new Error("生成テキストを入力してください。");
  const chunks = splitText(text);
  const listEl = $("generatedAudioList");
  listEl.innerHTML = "";
  $("generatedAudio").hidden = true;
  $("downloadAudioLink").hidden = true;

  if (chunks.length > 1) {
    const prog = document.createElement("p");
    prog.className = "split-progress";
    prog.textContent = `${chunks.length} 分割で生成します...`;
    listEl.append(prog);
  }

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) {
      const prog = listEl.querySelector(".split-progress");
      if (prog) prog.textContent = `生成中: ${i + 1} / ${chunks.length}`;
    }
    const r = await fetch(`${getBackendUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: chunks[i], language: $("languageSelect").value, voiceProfile: $("registeredVoiceSelect").value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `音声生成に失敗しました (${i + 1})`);

    if (chunks.length === 1) {
      const audio = $("generatedAudio"); const link = $("downloadAudioLink");
      audio.src = d.audio_url; audio.hidden = false;
      link.href = d.audio_url; link.download = d.file_name || "openvoice-output.wav";
      link.hidden = false; link.textContent = "音声を保存";
      await audio.play().catch(() => {});
    } else {
      const item = document.createElement("div");
      item.className = "generated-audio-item";
      const label = document.createElement("span");
      label.className = "chunk-label";
      label.textContent = `パート ${i + 1} / ${chunks.length}`;
      const audio = document.createElement("audio");
      audio.controls = true; audio.src = d.audio_url;
      const dl = document.createElement("a");
      dl.className = "download-link"; dl.href = d.audio_url;
      dl.download = d.file_name || `part-${i + 1}.wav`; dl.textContent = "保存";
      item.append(label, audio, dl);
      listEl.append(item);
    }
  }

  const prog = listEl.querySelector(".split-progress");
  if (prog) prog.textContent = `${chunks.length} パート生成完了`;
}

// --- Recording ---
async function startRecording() {
  if (!$("consentInput").checked) { showToast("本人または許可済み音声であることを確認してください"); return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  state.recorder = new MediaRecorder(stream);
  state.recorder.addEventListener("dataavailable", (e) => { if (e.data.size > 0) state.recordedChunks.push(e.data); });
  state.recorder.addEventListener("stop", () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(state.recordedChunks, { type: state.recorder.mimeType || "audio/webm" });
    setReferenceAudio(blob, "recorded-reference.webm");
    showToast("録音を参照音声としてセットしました");
  });
  state.recorder.start();
  $("recordButton").disabled = true;
  $("stopRecordButton").disabled = false;
  state.recordingSeconds = 0;
  const timer = $("recordTimer"); timer.hidden = false; timer.textContent = "0秒";
  state.recordingTimer = window.setInterval(() => {
    state.recordingSeconds += 1;
    timer.textContent = `${state.recordingSeconds}秒`;
  }, 1000);
  showToast("録音を開始しました。10秒以上がおすすめです");
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  $("recordButton").disabled = false;
  $("stopRecordButton").disabled = true;
  window.clearInterval(state.recordingTimer);
  state.recordingTimer = null;
}

// --- Preview Voice ---
async function previewVoice() {
  const profile = $("registeredVoiceSelect").value;
  const langMap = { "base-jp": "JP", "base-en": "EN_NEWEST", "base-zh": "ZH", "base-kr": "KR" };
  if (profile === "clone") {
    const text = previewTexts.JP;
    const u = new SpeechSynthesisUtterance(text);
    const v = state.voices[Number($("voiceSelect").value)];
    if (v) u.voice = v;
    speechSynthesis.speak(u);
    return;
  }
  const lang = langMap[profile] || $("languageSelect").value;
  const text = previewTexts[lang] || previewTexts.JP;
  if (!state.openVoiceReady) {
    const u = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(u);
    showToast("OpenVoice未起動のためブラウザ音声で試聴");
    return;
  }
  const btn = $("previewVoiceButton"); btn.disabled = true; btn.textContent = "...";
  try {
    const r = await fetch(`${getBackendUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: lang, voiceProfile: profile }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "試聴失敗");
    const audio = new Audio(d.audio_url);
    await audio.play().catch(() => {});
  } catch (e) { showToast(e.message || String(e)); }
  finally { btn.disabled = false; btn.textContent = "▶ 試聴"; }
}

// --- History ---
async function deleteHistory(filename) {
  if (!confirm("このファイルを削除しますか？")) return;
  try {
    const r = await fetch(`${getBackendUrl()}/api/history/${encodeURIComponent(filename)}`, { method: "DELETE" });
    if (!r.ok) throw new Error("削除に失敗しました");
    showToast("ファイルを削除しました");
    loadHistory();
  } catch (e) { showToast(e.message); }
}

async function loadHistory() {
  const list = $("historyList");
  try {
    const r = await fetch(`${getBackendUrl()}/api/history`);
    if (!r.ok) { list.innerHTML = '<p class="hint">履歴を取得できません</p>'; return; }
    const data = await r.json();
    if (!data.files || !data.files.length) { list.innerHTML = '<p class="hint">生成履歴はまだありません</p>'; return; }
    list.innerHTML = "";
    data.files.forEach((f) => {
      const item = document.createElement("div");
      item.className = "history-item";
      const name = document.createElement("span");
      name.className = "file-name"; name.textContent = f.name; name.title = f.name;
      
      const actions = document.createElement("div");
      actions.className = "actions";

      const playBtn = document.createElement("button");
      playBtn.textContent = "▶";
      playBtn.className = "compact";
      playBtn.addEventListener("click", () => { const a = new Audio(f.url); a.play().catch(() => {}); });
      
      const dl = document.createElement("a");
      dl.href = f.url; dl.download = f.name; dl.textContent = "保存";
      
      const delBtn = document.createElement("button");
      delBtn.className = "btn-delete compact";
      delBtn.textContent = "消";
      delBtn.onclick = () => deleteHistory(f.name);

      actions.append(playBtn, delBtn);
      item.append(name, actions, dl);
      list.append(item);
    });
  } catch { list.innerHTML = '<p class="hint">サーバー未起動のため履歴を取得できません</p>'; }
}

// --- OpenAI Script Generation (via Vercel API) ---
async function generateWithOpenAI({ prompt, characters, contentMode }) {
  // Call our Vercel Serverless Function to keep API key secure
  const response = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, characters, contentMode }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    // If running locally without Vercel, or if key is missing
    if (response.status === 404) {
       throw new Error("Vercel APIが見つかりません。ローカル実行時は OpenAI 直接呼び出しに切り替えます（未実装）");
    }
    throw new Error(errorData.error || `AI通信エラー (${response.status})`);
  }

  const data = await response.json();
  return data.csv;
}

// --- Batch Generation ---
async function batchGenerateAudio() {
  if (!state.rows.length) loadScriptFromEditor();
  if (!state.rows.length) { showToast("台本が空です"); return; }
  if (!state.openVoiceReady) { showToast("OpenVoiceサーバーが起動していません"); return; }

  const btn = $("batchGenerateButton");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "一括生成中...";

  const listEl = $("lineList");
  const cards = listEl.querySelectorAll(".line-card");

  try {
    for (let i = 0; i < state.rows.length; i++) {
      const row = state.rows[i];
      if (row.type === "pause") continue;
      
      const card = cards[i];
      const statusSpan = document.createElement("span");
      statusSpan.className = "line-status";
      statusSpan.textContent = "⏳";
      card.prepend(statusSpan);

      try {
        const r = await fetch(`${getBackendUrl()}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text: row.text, 
            language: $("languageSelect").value, 
            voiceProfile: row.voiceId.startsWith("profile:") ? row.voiceId : 
                         (row.voiceId === "Clone_1" ? "clone" : row.voiceId)
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "生成失敗");

        row.audioUrl = d.audio_url;
        statusSpan.textContent = "✅";
        
        // Update the button in the card to play the cloned audio
        const playBtn = card.querySelector("button");
        playBtn.textContent = "▶再生";
        playBtn.onclick = () => {
          const a = new Audio(d.audio_url);
          a.play();
        };

        // Add a download link to the card
        const dl = document.createElement("a");
        dl.href = d.audio_url;
        dl.download = d.file_name;
        dl.className = "download-link compact";
        dl.textContent = "保存";
        card.append(dl);

      } catch (err) {
        statusSpan.textContent = "❌";
        console.error(`Row ${i} failed:`, err);
      }
    }
    $("batchActionArea").hidden = false;
    showToast("全行の音声生成が完了しました");
    loadHistory();
  } catch (err) {
    showToast(`一括生成エラー: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function playAllClonedAudio() {
  for (const row of state.rows) {
    if (row.type === "pause") {
      await new Promise(r => setTimeout(r, pauseDuration(row)));
      continue;
    }
    if (row.audioUrl) {
      const audio = new Audio(row.audioUrl);
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    }
  }
}

// --- Events ---
function initEvents() {
  $("apiKeyButton").addEventListener("click", async () => {
    const mode = getStorageMode();
    $("apiStorageModeSelect").value = mode;
    $("apiFilePathLabel").hidden = mode !== "file";
    $("apiKeyInput").value = await loadApiKey();
    $("apiDialog").showModal();
  });

  $("apiStorageModeSelect").addEventListener("change", () => {
    $("apiFilePathLabel").hidden = $("apiStorageModeSelect").value !== "file";
  });

  $("saveKeyButton").addEventListener("click", async () => {
    const v = $("apiKeyInput").value.trim();
    setStorageMode($("apiStorageModeSelect").value);
    localStorage.setItem(BACKEND_URL_LS, getBackendUrl());
    try { if (v) await saveApiKey(v); showToast("設定を保存しました"); }
    catch (e) { showToast(e.message || String(e)); }
  });

  $("removeKeyButton").addEventListener("click", async () => {
    await removeApiKey(); $("apiKeyInput").value = ""; showToast("APIキーを削除しました");
  });

  $("aiButton").addEventListener("click", () => {
    const mode = $("contentModeSelect").value;
    if (!$("charactersInput").value.trim()) {
      $("charactersInput").value = mode === "solo" ? "ナレーター" : "司会者, 専門家";
    }
    $("aiDialog").showModal();
  });
  $("closeAiButton").addEventListener("click", () => $("aiDialog").close());

  // AI Script Generation Form
  const aiForm = $("aiForm");
  if (aiForm) {
    aiForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("AI Generation started...");
      
      const submitBtn = aiForm.querySelector('button[type="submit"]');
      const origBtnText = submitBtn ? submitBtn.textContent : "生成する";
      
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "生成中...";
      }

      const autoGen = $("autoGenerateCheck") ? $("autoGenerateCheck").checked : false;
      const prompt = $("promptInput").value.trim();
      const chars = $("charactersInput").value.trim() || ($("contentModeSelect").value === "solo" ? "ナレーター" : "司会者, 専門家");

      if (!prompt) {
        showToast("キーワード・内容を入力してください");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origBtnText;
        }
        return;
      }

      try {
        const text = await generateWithOpenAI({
          characters: chars,
          prompt: prompt,
          contentMode: $("contentModeSelect").value,
        });

        if (!text || text.length < 10) {
          throw new Error("AIからの応答が正しく取得できませんでした。もう一度お試しください。");
        }

        $("scriptText").value = text;
        loadScriptFromEditor(); 
        $("aiDialog").close(); 
        showToast("台本を生成しました");

        if (autoGen) {
          console.log("Starting auto batch generation...");
          setTimeout(() => batchGenerateAudio(), 800);
        }
      } catch (err) {
        console.error("AI Generation Error:", err);
        showToast(err.message || String(err));
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origBtnText;
        }
      }
    });
  }

  $("sampleButton").addEventListener("click", () => {
    $("scriptText").value = sampleScripts[$("contentModeSelect").value] || soloSampleScript;
    loadScriptFromEditor();
  });

  $("voiceFileInput").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; 
    if (!f) return; 
    setReferenceAudio(f, f.name);
    const isQualityOk = await checkAudioQuality(state.referenceBlob);
    if (isQualityOk) {
      $("saveStep").classList.remove("disabled");
      showToast("ファイルの読み込みが完了しました。Step 3へ進んでください。");
    }
  });

  // Voice Clone Workflow: Consent Check
  const consentInput = $("consentInput");
  if (consentInput) {
    consentInput.addEventListener("change", () => {
      const isChecked = consentInput.checked;
      const recordingStep = $("recordingStep");
      const saveStep = $("saveStep");
      if (isChecked) {
        if (recordingStep) recordingStep.classList.remove("disabled");
      } else {
        if (recordingStep) recordingStep.classList.add("disabled");
        if (saveStep) saveStep.classList.add("disabled");
      }
    });
  }

  $("recordButton").addEventListener("click", () => startRecording().catch((e) => showToast(e.message || String(e))));
  $("stopRecordButton").addEventListener("click", async () => {
    await stopRecording();
    const isQualityOk = await checkAudioQuality(state.referenceBlob);
    if (isQualityOk) {
      $("saveStep").classList.remove("disabled");
      showToast("録音が完了しました。Step 3へ進んでください。");
    } else {
      showToast("録音が短すぎるか、品質が不十分です。もう一度録音してください。");
    }
  });

  $("cloneButton").addEventListener("click", async () => {
    const btn = $("cloneButton"); btn.disabled = true; btn.textContent = "登録中...";
    try { 
      const d = await uploadReferenceVoice(); 
      setOpenVoiceStatus(d.message || "声を登録しました", "ready"); 
      showToast("ボイスクローンを登録しました！"); 
      // Refresh profiles immediately
      loadProfiles();
      // Reset flow
      consentInput.checked = false;
      $("recordingStep").classList.add("disabled");
      $("saveStep").classList.add("disabled");
      $("audioQualityCheck").hidden = true;
      $("referencePreview").hidden = true;
    }
    catch (e) { showToast(e.message || String(e)); }
    finally { btn.disabled = false; btn.textContent = "声をAIに登録する"; }
  });

  $("openVoiceGenerateButton").addEventListener("click", async () => {
    const btn = $("openVoiceGenerateButton"); btn.disabled = true; const orig = btn.textContent; btn.textContent = "生成中...";
    try { await generateOpenVoiceAudio(); showToast("音声を生成しました"); }
    catch (e) { showToast(e.message || String(e)); }
    finally { btn.disabled = false; btn.textContent = orig; }
  });

  $("batchGenerateButton").addEventListener("click", batchGenerateAudio);
  $("playAllClonedButton").addEventListener("click", playAllClonedAudio);

  $("previewVoiceButton").addEventListener("click", () => previewVoice());

  $("registeredVoiceSelect").addEventListener("change", () => {
    const v = $("registeredVoiceSelect").value;
    const m = { "base-jp": "JP", "base-en": "EN_NEWEST", "base-zh": "ZH", "base-kr": "KR" };
    if (m[v]) $("languageSelect").value = m[v];
  });

  $("parseButton").addEventListener("click", loadScriptFromEditor);
  $("playAllButton").addEventListener("click", () => playFrom(0, false));
  $("stopButton").addEventListener("click", () => { state.playing = false; speechSynthesis.cancel(); });

  $("downloadCsvButton").addEventListener("click", () => {
    if (!state.rows.length) loadScriptFromEditor();
    download("audio-drama-script.csv", toCsv(state.rows), "text/csv;charset=utf-8");
  });

  $("clearButton").addEventListener("click", () => {
    speechSynthesis.cancel(); state.playing = false;
    $("scriptText").value = ""; state.rows = []; renderLines();
    $("batchActionArea").hidden = true;
  });

  $("refreshHistoryButton").addEventListener("click", () => loadHistory());
}

function init() {
  initEvents();
  const savedUrl = localStorage.getItem(BACKEND_URL_LS);
  if (savedUrl) $("backendUrlInput").value = savedUrl;

  $("scriptText").value = soloSampleScript;
  loadScriptFromEditor();
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
  checkOpenVoice();
  loadProfiles();
  loadHistory();
}

init();
