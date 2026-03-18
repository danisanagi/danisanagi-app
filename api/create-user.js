// Vercel Serverless Function — Create User (Admin Only)
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

    // Get user from token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: "Geçersiz token" });
    const user = await userRes.json();

    // Check profile role
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

    // 2. Parse request body
    const { email, password, full_name, role, specialty, areas_of_expertise, phone, expert_id, age, gender, marital_status, session_fee, available_hours, previous_therapy, medication_use, pre_interview_summary, client_capacity, work_model, monthly_fee } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "email, password, full_name ve role zorunludur" });
    }
    if (role !== "expert" && role !== "client") {
      return res.status(400).json({ error: "Rol 'expert' veya 'client' olmalıdır" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Şifre en az 6 karakter olmalıdır" });
    }

    // 3. Create auth user via Supabase Admin API
    const adminHeaders = {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };

    const authCreateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: email,
        password: password,
        email_confirm: true
      })
    });

    if (!authCreateRes.ok) {
      const errBody = await authCreateRes.json();
      const msg = errBody.msg || errBody.message || errBody.error || "Bilinmeyen hata";
      return res.status(400).json({ error: `Hesap oluşturulamadı: ${msg}` });
    }

    const userData = await authCreateRes.json();
    const userId = userData.id;

    // 4. Create profile
    const profileData = {
      id: userId,
      email: email,
      full_name: full_name,
      role: role,
      phone: phone || null,
      specialty: specialty || null,
      areas_of_expertise: areas_of_expertise || null,
      age: age || null,
      gender: gender || null,
      marital_status: marital_status || null,
      session_fee: session_fee || null,
      available_hours: available_hours || null,
      previous_therapy: previous_therapy || null,
      medication_use: medication_use || null,
      pre_interview_summary: pre_interview_summary || null,
      client_capacity: client_capacity != null ? client_capacity : null,
      work_model: work_model || null,
      monthly_fee: monthly_fee != null ? monthly_fee : null
    };

    const profileCreateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...adminHeaders, Prefer: "return=representation" },
      body: JSON.stringify(profileData)
    });

    if (!profileCreateRes.ok) {
      // Rollback: delete auth user
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: adminHeaders
      });
      return res.status(400).json({ error: "Profil oluşturulamadı" });
    }

    // 5. Create assignment if expert_id provided (for clients)
    if (role === "client" && expert_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/assignments`, {
        method: "POST",
        headers: { ...adminHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ expert_id: expert_id, client_id: userId })
      });
    }

    return res.status(200).json({
      success: true,
      user_id: userId,
      message: `${full_name} başarıyla eklendi`
    });

  } catch (err) {
    console.error("create-user error:", err);
    return res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
};
