// Login.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import "./Login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const data = userSnap.data() || {};

      if (!data.isAdmin) {
        setError("Access denied: not an admin.");
        await signOut(auth);
        return;
      }
      if (!data.isVerified) {
        setError("Your admin account is not yet verified.");
        await signOut(auth);
        return;
      }

      navigate("/", { replace: true });
    } catch (err) {
      setError(err?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card login-card--two" role="dialog" aria-modal="true">
        {/* LEFT */}
        <aside className="login-aside">
          <h1 className="aside-title">
            <span></span>
            <br />
            <span className="aside-sub"></span>
          </h1>
          <img
            className="aside-illustration"
            src="/ambag-character.png"
            alt="AmbagBayan helper"
          />
        </aside>

        {/* RIGHT */}
            <div className="login-main">
        <div className="login-header">
          <h1>Admin Portal</h1>
          <img
            className="aside-ambaglogo"
            src="/adaptive-icon.png"
            alt="AmbagBayan logo"
          />
        </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {/* EMAIL */}
            <label className="field">
              <input
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            {/* PASSWORD */}
            <label className="field">
              <div className="input-wrap has-icon">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="input-icon-btn"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    // eye-off
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94 6.06 6.06" />
                      <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84" />
                      <path d="M9.88 4.15A10.42 10.42 0 0 1 12 4c5 0 9 4 9 8 0 1.2-.38 2.32-1.06 3.29" />
                      <path d="M6.42 6.42C4.01 7.33 2 9.64 2 12c0 1.16.37 2.24 1.02 3.17" />
                      <path d="M12 4c-1.1 0-2.16.22-3.14.62" />
                    </svg>
                  ) : (
                    // eye
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

            <button
              className="login-btn"
              type="submit"
              disabled={loading || !email || !password}
            >
              {loading ? "Signing in…" : "Log In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
