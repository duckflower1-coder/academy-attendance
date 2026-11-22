// 원장용 출결관리
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let sb, students = [], logs = [], curDate = todayKST();
var inRecovery = false;

const UNDO_MS = 5000; // 되돌리기 가능 시간 (이 시간 후 학부모 알림 발송)

document.title = `출결관리 · ${CFG.ACADEMY_NAME || ""}`;
$("#title").textContent = `${CFG.ACADEMY_NAME || "학원"} 출결관리`;
$("#loginTitle").textContent = `${CFG.ACADEMY_NAME || "학원"} 출결관리`;

function show(id) {
  ["#loginView", "#resetView", "#setupView", "#appView"].forEach(v => $(v).classList.toggle("hidden", v !== id));
}

// ---------- 시작 ----------
(async function init() {
  if (!isConfigured()) return show("#setupView");
  const recovering = /type=recovery/.test(location.hash);
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === "SIGNED_OUT") show("#loginView");
    if (ev === "PASSWORD_RECOVERY") { inRecovery = true; show("#resetView"); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (recovering || inRecovery) { inRecovery = true; return show("#resetView"); }
  session ? startApp() : show("#loginView");
})();

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#loginErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pw").value });
  if (error) { $("#loginErr").textContent = "로그인 실패: 이메일/비밀번호를 확인하세요."; return; }
  startApp();
});
$("#logoutBtn").onclick = () => sb.auth.signOut();

let started = false;
async function startApp() {
  show("#appView");
  if (started) return; started = true;
  $("#recDate").value = curDate;
  await loadStudents();
  await loadToday();
  // 다른 기기에서 바뀐 내용 실시간 반영
  sb.channel("att").on("postgres_changes", { event: "*", schema: "public", table: "att_logs" }, debounce(loadToday, 400))
    .on("postgres_changes", { event: "*", schema: "public", table: "att_students" }, debounce(async () => { await loadStudents(); renderToday(); }, 400))
    .subscribe();
  tick(); setInterval(tick, 1000);
  // 화면 다시 켰을 때 최신화
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadToday(); });
}

function tick() {
  const now = new Date();
  $("#clock").textContent = `${dateKo(todayKST(now))} ${hm(now)}`;
  if (todayKST(now) !== curDate) { curDate = todayKST(now); loadToday(); } // 자정 지나면 새 날
}
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

// ---------- 탭 ----------
$$("nav.tabs button").forEach(b => b.onclick = () => {
  $$("nav.tabs button").forEach(x => x.classList.toggle("on", x === b));
  ["today", "records", "students"].forEach(t => $("#tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  if (b.dataset.tab === "records") loadRecords();
  if (b.dataset.tab === "students") renderStudents();
});

// ---------- 데이터 ----------
async function loadStudents() {
  const { data, error } = await sb.from("att_students").select("*").eq("active", true).order("class_name").order("name");
  if (error) return toast("학생 목록을 불러오지 못했어요: " + error.message);
  students = data;
  const classes = [...new Set(students.map(s => s.class_name).filter(Boolean))].sort();
  const cur = $("#classFilter").value;
  $("#classFilter").innerHTML = `<option value="">전체 반</option>` + classes.map(c => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
  renderStudents();
}
async function loadToday() {
  const { data, error } = await sb.from("att_logs").select("*").eq("log_date", curDate).order("created_at");
  if (error) return toast("출결 기록을 불러오지 못했어요: " + error.message);
  logs = data; renderToday();
}
function lastLog(sid) { const l = logs.filter(x => x.student_id === sid); return l[l.length - 1]; }
function statusOf(sid) {
  const l = lastLog(sid);
  if (!l || !l.check_in) return "none";
  return l.check_out ? "out" : "in";
}

// ---------- 오늘 출결 화면 ----------
$("#search").oninput = renderToday;
$("#classFilter").onchange = renderToday;

function renderToday() {
  const q = $("#search").value.trim(), cf = $("#classFilter").value;
  let cIn = 0, cOut = 0, cNone = 0;
  students.forEach(s => { const st = statusOf(s.id); st === "in" ? cIn++ : st === "out" ? cOut++ : cNone++; });
  $("#cIn").textContent = cIn; $("#cOut").textContent = cOut; $("#cNone").textContent = cNone;

  const list = students.filter(s => (!q || s.name.includes(q)) && (!cf || s.class_name === cf));
  const order = { in: 0, none: 1, out: 2 };
  $("#grid").innerHTML = list.map(s => {
    const st = statusOf(s.id), l = lastLog(s.id);
    const label = st === "in" ? "수업 중 · 누르면 하원" : st === "out" ? "하원 완료" : "미등원 · 누르면 등원";
    let tm = "";
    if (l && l.check_in) tm = `등원 ${hm(l.check_in)}` + (l.check_out ? ` · 하원 ${hm(l.check_out)}` : "");
    return `<button class="scard ${st}" data-id="${s.id}">
      <span class="nm">${esc(s.name)}</span><span class="cl">${esc(s.class_name || "")}</span>
      <span class="tm">${tm}</span><span class="st">${label}</span></button>`;
  }).join("");
  $("#emptyMsg").classList.toggle("hidden", students.length > 0);
  $("#emptyMsg").textContent = "등록된 학생이 없어요. ‘학생 관리’ 탭에서 먼저 학생을 등록하세요.";
  $$("#grid .scard").forEach(b => b.onclick = () => tap(b.dataset.id, b));
}

let busy = false;
async function tap(sid, btn) {
  if (busy) return; busy = true; btn.disabled = true;
  try {
    const s = students.find(x => x.id === sid), st = statusOf(sid), now = new Date().toISOString();
    if (st === "out") {
      if (!confirm(`${s.name} 학생은 이미 하원했어요.\n다시 등원 처리할까요?`)) return;
    }
    if (st === "none" || st === "out") {
      const { data, error } = await sb.from("att_logs").insert({ student_id: sid, log_date: curDate, check_in: now }).select().single();
      if (error) throw error;
      logs.push(data); renderToday();
      withUndo(`${s.name} 등원 ${hm(now)}`, () => notify(s, "in", now),
        async () => { await sb.from("att_logs").delete().eq("id", data.id); logs = logs.filter(x => x.id !== data.id); renderToday(); });
    } else {
      const l = lastLog(sid);
      const { error } = await sb.from("att_logs").update({ check_out: now }).eq("id", l.id);
      if (error) throw error;
      l.check_out = now; renderToday();
      withUndo(`${s.name} 하원 ${hm(now)}`, () => notify(s, "out", now, l.check_in),
        async () => { await sb.from("att_logs").update({ check_out: null }).eq("id", l.id); l.check_out = null; renderToday(); });
    }
  } catch (e) {
    toast("저장 실패: " + (e.message || e)); loadToday();
  } finally { busy = false; btn.disabled = false; }
}

// ---------- 학부모 알림 (ntfy) ----------
async function notify(s, kind, ts, inTs) {
  const academy = CFG.ACADEMY_NAME || "학원";
  const message = kind === "in"
    ? `${s.name} 학생이 ${hmKo(ts)}에 ${academy}에 등원했습니다.`
    : `${s.name} 학생이 ${hmKo(ts)}에 ${academy}에서 하원했습니다.` + (inTs ? ` (등원 ${hmKo(inTs)})` : "");
  try {
    await fetch(ntfyServer(), {
      method: "POST",
      body: JSON.stringify({
        topic: ntfyTopic(s.parent_code),
        title: `[${academy}] ${kind === "in" ? "등원" : "하원"} 알림`,
        message,
        tags: [kind === "in" ? "school" : "house"],
        click: parentUrl(s.parent_code),
      }),
    });
  } catch (e) { console.warn("알림 전송 실패", e); }
}

// ---------- 토스트 / 되돌리기 ----------
let toastTimer, pending = null;
function flushPending() { if (pending) { clearTimeout(pending.t); pending.send(); pending = null; } }
function withUndo(msg, send, undo) {
  flushPending(); // 직전 건은 즉시 발송
  const p = { send, t: setTimeout(() => { if (pending === p) pending = null; send(); }, UNDO_MS) };
  pending = p;
  toast(msg + " · 학부모 알림 예정", async () => {
    if (pending === p) { clearTimeout(p.t); pending = null; }
    await undo(); toast("되돌렸어요 (알림 보내지 않음)");
  });
}
window.addEventListener("pagehide", flushPending);
function toast(msg, undo) {
  $("#toastMsg").textContent = msg;
  $("#toastUndo").classList.toggle("hidden", !undo);
  $("#toastUndo").onclick = () => { $("#toast").classList.add("hidden"); undo && undo(); };
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), undo ? UNDO_MS : 3000);
}

// ---------- 출결 기록 ----------
$("#recDate").onchange = loadRecords;
async function loadRecords() {
  const d = $("#recDate").value || curDate;
  $("#recTitle").textContent = `${dateKo(d)} 기록`;
  const { data, error } = await sb.from("att_logs").select("*, att_students(name,class_name)").eq("log_date", d).order("check_in");
  if (error) return toast(error.message);
  $("#recBody").innerHTML = data.length ? data.map(l => `<tr data-id="${l.id}" data-date="${d}">
      <td><b>${esc(l.att_students?.name)}</b><div class="muted">${esc(l.att_students?.class_name || "")}</div></td>
      <td><input type="time" class="tin" value="${hm(l.check_in)}"></td>
      <td><input type="time" class="tout" value="${hm(l.check_out)}"></td>
      <td><button class="ghost sm del">삭제</button></td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">이 날짜의 기록이 없어요.</td></tr>`;
  $$("#recBody tr[data-id]").forEach(tr => {
    const id = tr.dataset.id, date = tr.dataset.date;
    const toTs = v => v ? new Date(`${date}T${v}:00+09:00`).toISOString() : null;
    tr.querySelector(".tin").onchange = async e => { await saveRec(id, { check_in: toTs(e.target.value) }); };
    tr.querySelector(".tout").onchange = async e => { await saveRec(id, { check_out: toTs(e.target.value) }); };
    tr.querySelector(".del").onclick = async () => {
      if (!confirm("이 기록을 삭제할까요?")) return;
      const { error } = await sb.from("att_logs").delete().eq("id", id);
      error ? toast(error.message) : (toast("삭제했어요"), loadRecords(), loadToday());
    };
  });
}
async function saveRec(id, patch) {
  const { error } = await sb.from("att_logs").update(patch).eq("id", id);
  error ? toast("수정 실패: " + error.message) : (toast("수정했어요"), loadToday());
}
$("#csvBtn").onclick = async () => {
  const d = $("#recDate").value || curDate, ym = d.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const { data, error } = await sb.from("att_logs").select("*, att_students(name,class_name)")
    .gte("log_date", ym + "-01").lt("log_date", end).order("log_date").order("check_in");
  if (error) return toast(error.message);
  const rows = [["날짜", "이름", "반", "등원", "하원", "체류(분)"]].concat(data.map(l => {
    const mins = l.check_in && l.check_out ? Math.round((new Date(l.check_out) - new Date(l.check_in)) / 60000) : "";
    return [l.log_date, l.att_students?.name, l.att_students?.class_name, hm(l.check_in), hm(l.check_out), mins];
  }));
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `출결_${ym}.csv`; a.click();
};

// ---------- 학생 관리 ----------
$("#addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const row = { name: $("#nName").value.trim(), class_name: $("#nClass").value.trim(), parent_phone: $("#nPhone").value.trim(), memo: $("#nMemo").value.trim() };
  if (!row.name) return;
  const { error } = await sb.from("att_students").insert(row);
  if (error) return toast("등록 실패: " + error.message);
  toast(`${row.name} 학생을 등록했어요`);
  $("#nName").value = ""; $("#nMemo").value = ""; $("#nPhone").value = "";
  $("#nName").focus();
  await loadStudents(); renderToday();
});

function renderStudents() {
  $("#stuCount").textContent = `(${students.length}명)`;
  $("#stuBody").innerHTML = students.map(s => `<tr data-id="${s.id}">
    <td><b>${esc(s.name)}</b>${s.memo ? `<div class="muted">${esc(s.memo)}</div>` : ""}</td>
    <td>${esc(s.class_name || "")}</td><td>${esc(s.parent_phone || "")}</td>
    <td><button class="sm share">링크·QR</button></td>
    <td class="row"><button class="ghost sm edit">수정</button><button class="ghost sm del">삭제</button></td></tr>`).join("")
    || `<tr><td colspan="5" class="muted">아직 등록된 학생이 없어요.</td></tr>`;
  $$("#stuBody tr[data-id]").forEach(tr => {
    const s = students.find(x => x.id === tr.dataset.id);
    tr.querySelector(".share").onclick = () => shareModal(s);
    tr.querySelector(".edit").onclick = () => editModal(s);
    tr.querySelector(".del").onclick = async () => {
      if (!confirm(`${s.name} 학생을 삭제할까요?\n이 학생의 출결 기록도 모두 삭제됩니다.`)) return;
      const { error } = await sb.from("att_students").delete().eq("id", s.id);
      if (error) return toast(error.message);
      toast("삭제했어요"); await loadStudents(); loadToday();
    };
  });
}

function openModal(html) { $("#modal").innerHTML = html; $("#modalBg").classList.remove("hidden"); }
function closeModal() { $("#modalBg").classList.add("hidden"); }
$("#modalBg").onclick = e => { if (e.target.id === "modalBg") closeModal(); };

function shareModal(s) {
  const url = parentUrl(s.parent_code);
  const academy = CFG.ACADEMY_NAME || "학원";
  const msg = `[${academy}] ${students.filter(x => x.parent_code === s.parent_code).map(x => x.name).join("·")} 학생 등·하원 확인 페이지입니다.\n${url}\n\n페이지 안의 ‘알림 받기’를 설정하시면 등원/하원 시 휴대폰으로 바로 알림이 갑니다.`;
  const sibs = students.filter(x => x.parent_code === s.parent_code).map(x => x.name);
  openModal(`<h3>${esc(sibs.join(" · "))} 학부모 안내</h3>
    <p class="muted">학부모님께 아래 링크를 보내거나 QR을 찍게 해주세요.${sibs.length > 1 ? `<br><b>형제 묶음:</b> 링크 1개·알림 구독 1번으로 ${esc(sibs.join(", "))} 모두 확인됩니다.` : ""}</p>
    <div class="qr"><img src="${qrDataUrl(url)}" alt="QR"></div>
    <p><code>${esc(url)}</code></p>
    <div class="row">
      <button id="cp">링크 복사</button>
      ${s.parent_phone ? `<a class="btn ghost" href="sms:${esc(s.parent_phone.replace(/[^0-9+]/g, ""))}?body=${encodeURIComponent(msg)}">문자로 보내기</a>` : ""}
      <a class="btn ghost" href="${esc(url)}" target="_blank">열어보기</a>
      <button class="ghost" id="cl">닫기</button>
    </div>`);
  $("#cp").onclick = async () => {
    try { await navigator.clipboard.writeText(msg); toast("안내 문구와 링크를 복사했어요"); }
    catch { prompt("아래 내용을 복사하세요", url); }
  };
  $("#cl").onclick = closeModal;
}

function editModal(s) {
  const cur = students.filter(x => x.id !== s.id && x.parent_code === s.parent_code);
  openModal(`<h3>학생 정보 수정</h3>
    <div style="display:grid;gap:8px">
      <input id="eName" value="${esc(s.name)}" placeholder="이름">
      <input id="eClass" value="${esc(s.class_name || "")}" placeholder="반">
      <input id="ePhone" value="${esc(s.parent_phone || "")}" placeholder="학부모 연락처">
      <input id="eMemo" value="${esc(s.memo || "")}" placeholder="메모">
      <label class="muted">형제·자매 묶기 (같은 학부모 링크·알림)</label>
      <select id="eSib">
        <option value="">${cur.length ? `현재 묶음 유지 (${esc(cur.map(x => x.name).join(", "))})` : "묶지 않음"}</option>
        ${cur.length ? `<option value="__none">묶음 해제 (따로 받기)</option>` : ""}
        ${students.filter(x => x.id !== s.id && x.parent_code !== s.parent_code).map(x => `<option value="${x.id}">${esc(x.name)} (${esc(x.class_name || "")})와 묶기</option>`).join("")}
      </select>
      <div class="row"><button id="sv">저장</button><button class="ghost" id="cl">취소</button></div>
    </div>`);
  $("#cl").onclick = closeModal;
  $("#sv").onclick = async () => {
    const patch = { name: $("#eName").value.trim(), class_name: $("#eClass").value.trim(), parent_phone: $("#ePhone").value.trim(), memo: $("#eMemo").value.trim() };
    if (!patch.name) return;
    const sib = $("#eSib").value;
    if (sib === "__none") patch.parent_code = [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, "0")).join("");
    else if (sib) {
      const t = students.find(x => x.id === sib);
      patch.parent_code = t.parent_code;
      if (!patch.parent_phone && t.parent_phone) patch.parent_phone = t.parent_phone;
    }
    const { error } = await sb.from("att_students").update(patch).eq("id", s.id);
    if (error) return toast(error.message);
    closeModal(); toast("저장했어요"); await loadStudents(); renderToday();
  };
}

// ---------- 비밀번호 찾기 / 재설정 / 변경 ----------
$("#forgotBtn").onclick = async () => {
  const email = $("#email").value.trim();
  if (!email) { $("#loginErr").textContent = "위 칸에 이메일을 먼저 입력한 뒤 눌러주세요."; return; }
  $("#forgotBtn").disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("#forgotBtn").disabled = false;
  $("#loginErr").textContent = error ? "메일 발송 실패: " + error.message
    : "비밀번호 재설정 메일을 보냈어요. 메일의 링크를 누르면 새 비밀번호를 정할 수 있어요.";
};

$("#resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  const p1 = $("#np1").value, p2 = $("#np2").value;
  if (p1.length < 6) { $("#resetErr").textContent = "6자 이상 입력하세요."; return; }
  if (p1 !== p2) { $("#resetErr").textContent = "두 비밀번호가 서로 달라요."; return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { $("#resetErr").textContent = "변경 실패: " + error.message; return; }
  inRecovery = false;
  history.replaceState(null, "", location.pathname);
  alert("비밀번호를 변경했어요.");
  startApp();
});

$("#pwBtn").onclick = () => {
  openModal(`<h3>비밀번호 변경</h3>
    <div style="display:grid;gap:8px">
      <input type="password" id="cp0" placeholder="현재 비밀번호" autocomplete="current-password">
      <input type="password" id="cp1" placeholder="새 비밀번호 (6자 이상)" autocomplete="new-password">
      <input type="password" id="cp2" placeholder="새 비밀번호 확인" autocomplete="new-password">
      <div class="err" id="cpErr"></div>
      <p class="muted" style="margin:0">버스 탑승시스템과 같은 계정이라 그쪽 비밀번호도 함께 바뀌어요.</p>
      <div class="row"><button id="cpSave">변경</button><button class="ghost" id="cl">취소</button></div>
    </div>`);
  $("#cl").onclick = closeModal;
  $("#cpSave").onclick = async () => {
    const p0 = $("#cp0").value, p1 = $("#cp1").value, p2 = $("#cp2").value;
    if (p1.length < 6) { $("#cpErr").textContent = "새 비밀번호는 6자 이상이어야 해요."; return; }
    if (p1 !== p2) { $("#cpErr").textContent = "새 비밀번호 두 칸이 서로 달라요."; return; }
    $("#cpSave").disabled = true;
    const { data: { user } } = await sb.auth.getUser();
    const chk = await sb.auth.signInWithPassword({ email: user.email, password: p0 });
    if (chk.error) { $("#cpErr").textContent = "현재 비밀번호가 맞지 않아요."; $("#cpSave").disabled = false; return; }
    const { error } = await sb.auth.updateUser({ password: p1 });
    $("#cpSave").disabled = false;
    if (error) { $("#cpErr").textContent = "변경 실패: " + error.message; return; }
    closeModal(); toast("비밀번호를 변경했어요");
  };
};
