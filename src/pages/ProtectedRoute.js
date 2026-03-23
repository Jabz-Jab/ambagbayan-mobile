// components/ProtectedRoute.js
import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/firebase"; // ✅ now this exists

export default function ProtectedRoute() {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    // Quick check from localStorage
    const stored = localStorage.getItem("adminAuth") === "true";
    if (stored) {
      setIsAuthed(true);
      setChecking(false);
      return;
    }

    // Fallback: check Firebase
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthed(true);
        localStorage.setItem("adminAuth", "true");
      } else {
        setIsAuthed(false);
        localStorage.removeItem("adminAuth");
      }
      setChecking(false);
    });

    return () => unsub();
  }, []);

  if (checking) {
    return (
      <div className="route-loading">
        <p>Checking access…</p>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
