// Shared-password login screen. Posts to /api/login, which sets the session
// cookie the proxy checks. No client JS needed — plain form POST.

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const error = sp?.error === "1";
  const next = sp?.next && sp.next.startsWith("/") ? sp.next : "/";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <form
        action="/api/login"
        method="post"
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="Sarthak" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Sarthak Singapore</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>AI Sales Engine</div>
          </div>
        </div>

        <label
          htmlFor="password"
          style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 8, letterSpacing: 0.3 }}
        >
          Dashboard password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          required
          placeholder="••••••••"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: `1px solid ${error ? "#e0526b" : "var(--border)"}`,
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 14,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <input type="hidden" name="next" value={next} />

        {error && (
          <p style={{ color: "#e0526b", fontSize: 12, margin: "10px 0 0" }}>Incorrect password. Try again.</p>
        )}

        <button
          type="submit"
          style={{
            width: "100%",
            marginTop: 18,
            padding: "12px 14px",
            borderRadius: 10,
            border: "none",
            background: "var(--gold-2)",
            color: "#1a1407",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>

        <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 18, textAlign: "center", letterSpacing: 0.4 }}>
          OLTAFLOCK · Authorized access only
        </p>
      </form>
    </div>
  );
}
