// ===== 학원 출결관리 설정 =====
// 버스 탑승시스템과 같은 Supabase 프로젝트를 사용합니다.
// (anon public key 는 공개되어도 안전한 키입니다. service_role 키는 절대 넣지 마세요)
window.APP_CONFIG = {
  ACADEMY_NAME: "우리학원",
  SUPABASE_URL: "https://asevmjpbhckvywphywju.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZXZtanBiaGNrdnl3cGh5d2p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NzYxMDMsImV4cCI6MjEwODA1MjEwM30.dv-lTmarkEhc5BFGZDLR3bnGZ2PnnJ6dCxA5hnZY5H4",
  // 학부모 푸시 알림 서버 (무료 ntfy.sh)
  NTFY_SERVER: "https://ntfy.sh",
  NTFY_PREFIX: "hagwon-att-",
};
