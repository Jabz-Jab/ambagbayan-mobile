// src/pages/Users.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { collection, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { useNavigate, useLocation } from "react-router-dom";
import { getAuth, signOut } from "firebase/auth";
import { createPortal } from "react-dom";
import { db } from "../firebaseConfig";

/* shared styles */
import "./Dashboard.css";
import "./Users.css";
import "./Donors.css";

export default function Users() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const auth = getAuth();

  // Safe router helper to avoid redundant navigation
  const go = useCallback(
    (path) => {
      if (pathname !== path) navigate(path);
    },
    [navigate, pathname]
  );

  const [users, setUsers] = useState([]);

  // Controls
  const [searchText, setSearchText] = useState("");
  const [committedQuery, setCommittedQuery] = useState(""); // set on Enter/Search
  const [sortOrder, setSortOrder] = useState("Newest");     // Newest | Oldest
  const [typeFilter, setTypeFilter] = useState("All");       // All | Organization | Individual

  // Image viewer state
  const [viewer, setViewer] = useState({ open: false, url: "", error: false });

  // Logout confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);

  const openConfirm = () => setConfirmOpen(true);
  const closeConfirm = () => setConfirmOpen(false);
  const confirmLogout = async () => {
    try {
      await signOut(auth);
    } finally {
      closeConfirm();
      navigate("/login", { replace: true });
    }
  };

  // ESC to close confirm modal
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e) => e.key === "Escape" && closeConfirm();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  // ---- data stream ----
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(fetched);
    });
    return () => unsub();
  }, []);

  // ---- actions ----
  const toggleVerify = async (userId, current) => {
    try {
      await updateDoc(doc(db, "users", userId), { isVerified: !current });
    } catch (e) {
      console.error("toggleVerify failed:", e);
    }
  };

  const openViewer = (url) => setViewer({ open: true, url, error: false });
  const closeViewer = () => setViewer({ open: false, url: "", error: false });

  const copyId = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {/* noop */}
  };

  // try a few common fields for an ID image
  const idImageUrl = (u) =>
    u?.uploadedImage || u?.idImage || u?.id_photo || u?.imageUrl || "";

  // ---- filter + sort (no missing deps; helpers inlined) ----
  const filteredSorted = useMemo(() => {
    const q = committedQuery.trim().toLowerCase();

    // text filter
    const textFiltered = !q
      ? users
      : users.filter((u) => {
          const hay = [
            u.id,
            u.fullName,
            u.email,
            u.accountType,
            u.phoneNumber,
            u.address,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });

    // type filter
    const typeFiltered =
      typeFilter === "All"
        ? textFiltered
        : textFiltered.filter((u) => {
            const s = String(u.accountType || "").trim().toLowerCase();
            const isOrg = s === "organization";
            const isInd = s === "individual" || s === "donor" || s === "";
            return typeFilter === "Organization" ? isOrg : isInd;
          });

    // sort
    const toMs = (x) =>
      x && typeof x.toDate === "function"
        ? x.toDate().getTime()
        : x
        ? new Date(x).getTime()
        : 0;

    const sorted = [...typeFiltered].sort((a, b) => {
      if (sortOrder === "Newest") return toMs(b.createdAt) - toMs(a.createdAt);
      if (sortOrder === "Oldest") return toMs(a.createdAt) - toMs(b.createdAt);
      return 0;
    });

    return sorted;
  }, [users, committedQuery, sortOrder, typeFilter]);

  // ---- search handlers ----
  const runSearch = () => setCommittedQuery(searchText);
  const clearSearch = () => {
    setSearchText("");
    setCommittedQuery("");
  };

  return (
    <div className="dash">
      {/* ====== HERO NAV ====== */}
      <header className="hero">
        <h1 className="hero-title">Users</h1>
        <nav className="hero-cta">
          <button type="button" className="cta home" onClick={() => go("/")}>
            Home
          </button>
          <button type="button" className="cta donors" onClick={() => go("/donors")}>
            Donors
          </button>
          <button type="button" className="cta orgs" onClick={() => go("/organizations")}>
            Organizations
          </button>
          <button
            type="button"
            className="cta users is-active"
            aria-current="page"
            onClick={() => go("/users")}
          >
            Users
          </button>

          {/* Logout (opens confirm modal via Portal; no layout shift, navbar safe) */}
          <button
            type="button"
            className="cta-logout"
            onClick={openConfirm}
            title="Logout"
            aria-label="Logout"
          >
            <svg
              className="logout-icon"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="currentColor"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="4" x2="12" y2="11" />
              <path d="M8.46 5.97a7 7 0 1 0 7.08 0" />
            </svg>
          </button>
        </nav>
      </header>

      {/* ====== BODY ====== */}
      <div className="users-body">
        {/* Controls */}
        <div className="users-controls">
          <div className="search-wrap donors-search-only">
            <input
              className="search" /* Donors pill search styling */
              placeholder="Search by ID, name, email, phone, address…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") clearSearch();
              }}
            />
            {searchText && (
              <button
                type="button"
                className="search-clear"
                onClick={clearSearch}
                aria-label="Clear search"
                title="Clear"
              >
                ×
              </button>
            )}
          </div>

          <div className="sort-wrap">
            <label className="sort-label">Sort:</label>
            <select
              className="sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option>Newest</option>
              <option>Oldest</option>
            </select>

            <label className="sort-label" style={{ marginLeft: 12 }}>Type:</label>
            <select
              className="sort-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option>All</option>
              <option>Organization</option>
              <option>Individual</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <th style={{ width: 220 }}>User ID</th>
                <th style={{ width: 180 }}>Name</th>
                <th style={{ width: 220 }}>Email</th>
                <th style={{ width: 140 }}>Account Type</th>
                <th style={{ width: 140 }}>Phone</th>
                <th>Address</th>
                <th style={{ width: 200 }}>Signed Up</th>
                <th style={{ width: 160 }}>Verified</th>
                <th style={{ width: 120 }}>View ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((u) => (
                <tr key={u.id}>
                  <td className="id-cell">
                    <button
                      type="button"
                      className="btn-copy"
                      onClick={() => copyId(u.id)}
                      title="Copy ID"
                    >
                      Copy
                    </button>
                    <span className="mono" title={u.id}>
                      {u.id}
                    </span>
                  </td>
                  <td>{u.fullName || "—"}</td>
                  <td className="truncate" title={u.email || ""}>
                    {u.email || "—"}
                  </td>
                  <td>{u.accountType || "—"}</td>
                  <td>{u.phoneNumber || "—"}</td>
                  <td className="address-cell" title={u.address || ""}>
                    {u.address || "—"}
                  </td>
                  <td>
                    {u.createdAt && typeof u.createdAt.toDate === "function"
                      ? u.createdAt.toDate().toLocaleString()
                      : u.createdAt
                      ? new Date(u.createdAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={u.isVerified ? "btn-verify verified" : "btn-verify not-verified"}
                      onClick={() => toggleVerify(u.id, u.isVerified)}
                      style={{ color: "#fff" }}
                    >
                      {u.isVerified ? "Verified ✓" : "Not Verified ✗"}
                    </button>
                  </td>
                  <td>
                    {idImageUrl(u) ? (
                      <button
                        type="button"
                        className="btn-view"
                        onClick={() => openViewer(idImageUrl(u))}
                      >
                        View ID
                      </button>
                    ) : (
                      <span className="muted">No ID</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Image Viewer Modal (Portal) ===== */}
      {viewer.open &&
        createPortal(
          <div className="modal-overlay" onClick={closeViewer} role="dialog" aria-modal="true">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              {!viewer.error ? (
                <img
                  src={viewer.url}
                  alt="User ID"
                  className="modal-image"
                  onError={() => setViewer((v) => ({ ...v, error: true }))}
                />
              ) : (
                <div className="image-error">
                  <div className="image-error-title">We couldn't load this ID image.</div>
                  <div className="image-error-sub">The link may be private or expired.</div>
                  <a className="open-link" href={viewer.url} target="_blank" rel="noreferrer">
                    Try opening in a new tab
                  </a>
                </div>
              )}
              <button type="button" className="btn-close" onClick={closeViewer} aria-label="Close">
                ×
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* ===== Logout Confirm Modal (Portal) ===== */}
      {confirmOpen &&
        createPortal(
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            onClick={closeConfirm}
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
               <h3 className="modal-title">Sign out?</h3>
            <p className="modal-sub">You will be returned to the login screen.</p>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={closeConfirm}>
                  Cancel
                </button>
                <button type="button" className="btn danger" onClick={confirmLogout}>
                  Logout
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
