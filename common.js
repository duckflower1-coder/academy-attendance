// 공통 유틸
const CFG = window.APP_CONFIG || {};
const TZ = "Asia/Seoul";

function isConfigured() {
  return CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR-PROJECT") &&
         CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("YOUR-ANON");
}

// 한국시간 기준 YYYY-MM-DD
function todayKST(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
// 한국시간 HH:MM
function hm(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
}
function hmKo(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));
}
function dateKo(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ntfyTopic(code) { return (CFG.NTFY_PREFIX || "hagwon-att-") + code; }
function ntfyServer() { return (CFG.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, ""); }
function baseUrl() { return location.href.replace(/[^/]*(\?.*)?(#.*)?$/, ""); }
function parentUrl(code) { return baseUrl() + "parent.html?c=" + code; }
function qrDataUrl(text, cell = 6) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createDataURL(cell, 2);
}
