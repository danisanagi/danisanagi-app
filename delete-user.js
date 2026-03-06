// Vercel Serverless Function — Delete User (Admin Only)
// Uses Supabase Admin API with service_role key

const SUPABASE_URL = "https://zolgyykgbibamtezfpnl.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvbGd5eWtnYmliYW10ZXpmcG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDYwODMsImV4cCI6MjA4ODM4MjA4M30.zJvvb0Hsza3OOXKAe5wU1jHbbFe0UoVkvOtgJI7fw6Q";

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. Verify caller is admin
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Token gerekli" });

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: "Geçersiz token" });
    const user = await userRes.json();

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          Accept: "application/json"
        }
      }
    );
    const profiles = await profileRes.json();
    if (!profiles || !profiles[0] || profiles[0].role !== "admin") {
      return res.status(403).json({ error: "Sadece admin bu işlemi yapabilir" });
    }

    // 2. Parse request
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id zorunludur" });

    const adminHeaders = {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };

    // 3. Delete assignments & notes
    await fetch(
      `${SUPABASE_URL}/rest/v1/assignments?or=(expert_id.eq.${user_id},client_id.eq.${user_id})`,
      { method: "DELETE", headers: adminHeaders }
    );
    await fetch(
      `${SUPABASE_URL}/rest/v1/notes?or=(expert_id.eq.${user_id},client_id.eq.${user_id})`,
      { method: "DELETE", headers: adminHeaders }
    );

    // 4. Delete profile
    await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`,
      { method: "DELETE", headers: adminHeaders }
    );

    // 5. Delete auth user
    await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${user_id}`,
      { method: "DELETE", headers: adminHeaders }
    );

    return res.status(200).json({ success: true, message: "Kullanıcı silindi" });

  } catch (err) {
    console.error("delete-user error:", err);
    return res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
};
