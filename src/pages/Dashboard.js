// src/pages/Dashboard.js
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";
import { Line, Pie } from "react-chartjs-2";
import { collection, onSnapshot } from "firebase/firestore";
import { getAuth, signOut } from "firebase/auth";
import { db } from "../firebaseConfig";
import "./Dashboard.css";
import "./Donors.css"; // for .cta-logout styling

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Title
);

/* ---- plugin (unchanged) ---- */
const pieHoverLabelPlugin = {
  id: "pieHoverLabel",
  afterDatasetsDraw(chart, _args, opts) {
    const active = chart.getActiveElements?.() || [];
    if (!active.length) return;
    const { ctx } = chart;
    const { index } = active[0];
    const ds = chart.data?.datasets?.[0];
    if (!ds) return;

    const meta = chart.getDatasetMeta(0);
    const arc = meta?.data?.[index];
    if (!arc) return;

    const dataArr = Array.isArray(ds.data) ? ds.data : [];
    const value = +dataArr[index] || 0;
    const total = dataArr.reduce((a, b) => a + (+b || 0), 0) || 0;
    if (!total) return;

    const decimals = Number.isFinite(opts?.decimals) ? opts.decimals : 1;
    const pct = ((value / total) * 100).toFixed(decimals);
    const showCount = opts?.showCount ?? true;
    const text = showCount ? `${pct}% (${value})` : `${pct}%`;

    const angle = arc.startAngle + arc.circumference / 2;
    const r = (arc.outerRadius + arc.innerRadius) / 2;
    const x = arc.x + Math.cos(angle) * r;
    const y = arc.y + Math.sin(angle) * r;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${opts?.fontWeight || "700"} ${opts?.fontSize || 14}px "Poppins", ui-sans-serif, system-ui`;
    ctx.fillStyle = opts?.color || "#fff";
    if (opts?.shadow !== false) {
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    }
    if (opts?.stroke !== false) {
      ctx.strokeStyle = "rgba(0,0,0,.25)";
      ctx.lineWidth = 3;
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  },
};

/* -------------------- helpers (MIRROR DonorDetail status logic) -------------------- */
const THIS_YEAR = new Date().getFullYear();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** DonorDetail-style status normalization */
const normalizeStatus = (s = "") => {
  const v = String(s || "").toLowerCase().trim();
  if (!v) return "pending";
  if (/(accepted|accept|approved|approve)/.test(v)) return "accepted";
  if (/(completed|complete|fulfilled|success|done|received)/.test(v)) return "completed";
  if (/(pending|processing|in[\s-]?progress|awaiting|waiting)/.test(v)) return "pending";
  if (/(declined|rejected|cancelled|canceled|failed)/.test(v)) return "declined";
  if (/(posted)/.test(v)) return "posted";
  return v.replace(/\s+/g, "-");
};

const firstAny = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
};

/** robust timestamp -> ms */
const tsToMs = (ts) => {
  try {
    if (!ts) return NaN;
    if (ts?.toDate) return ts.toDate().getTime(); // Firestore Timestamp
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === "number") return ts; // ms
    return new Date(ts).getTime(); // string or fallback
  } catch {
    return NaN;
  }
};

/**
 * ✅ "Mirror" the DonorDetail idea: use status-relevant timestamp first,
 * then fall back to statusUpdatedAt/updatedAt/createdAt.
 */
const pickEventAt = (row = {}) => {
  const ns = normalizeStatus(row.status);

  const completedFields = [
    "completedAt",
    "fulfilledAt",
    "receivedAt",
    "doneAt",
    "dateCompleted",
    "completed_on",
  ];
  const declinedFields = [
    "declinedAt",
    "rejectedAt",
    "cancelledAt",
    "canceledAt",
    "failedAt",
    "dateDeclined",
  ];
  const genericFields = [
    "statusUpdatedAt",
    "updatedAt",
    "modifiedAt",
    "createdAt",
    "timestamp",
    "date",
  ];

  if (ns === "completed") return firstAny(row, completedFields) || firstAny(row, genericFields);
  if (ns === "declined") return firstAny(row, declinedFields) || firstAny(row, genericFields);
  return firstAny(row, genericFields);
};

const monthIndexOf = (ts) => {
  const ms = tsToMs(ts);
  if (!Number.isFinite(ms)) return -1;
  const d = new Date(ms);
  if (d.getFullYear() !== THIS_YEAR) return -1;
  return d.getMonth();
};

const bumpMonth = (arr, idx, amount = 1) => {
  if (idx < 0 || idx > 11) return;
  arr[idx] += amount;
};

// If your /request has mixed doc types, keep only "request" or missing type (mirrors DonorDetail filter)
const isRequestDoc = (r = {}) => {
  const t = String(r.type || "").toLowerCase().trim();
  return !t || t === "request";
};

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = getAuth();

  // --- modal open state ---
  const [confirmOpen, setConfirmOpen] = useState(false);

  // --- Lock scroll + remove scrollbar gutter while modal is open (fixes the white strip) ---
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    if (confirmOpen) {
      html.classList.add("modal-open");
      body.classList.add("modal-open");
    } else {
      html.classList.remove("modal-open");
      body.classList.remove("modal-open");
    }
    return () => {
      html.classList.remove("modal-open");
      body.classList.remove("modal-open");
    };
  }, [confirmOpen]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.clear();
      sessionStorage.clear();
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Logout failed:", err);
      alert("Could not log out right now.");
    }
  };

  /* ---------- KPIs & pie breakdown ---------- */
  const [kpi, setKpi] = useState({ orgTotal: 0, userTotal: 0 });
  const [breakdown, setBreakdown] = useState({
    orgVerified: 0,
    userVerified: 0,
    orgPending: 0,
    userPending: 0,
  });

  /* ---------- line series parts (Completed + Declined only, but MIRROR status logic) ---------- */
  const [urgentComp, setUrgentComp] = useState(Array(12).fill(0));
  const [urgentDec, setUrgentDec] = useState(Array(12).fill(0));

  const [reqComp, setReqComp] = useState(Array(12).fill(0));
  const [reqDec, setReqDec] = useState(Array(12).fill(0));

  // ✅ NEW: include posting transactions too (orgPostingDonations)
  const [postComp, setPostComp] = useState(Array(12).fill(0));
  const [postDec, setPostDec] = useState(Array(12).fill(0));

  // users
  useEffect(() => {
    const off = onSnapshot(collection(db, "users"), (snap) => {
      let orgTotal = 0,
        userTotal = 0;
      let orgVerified = 0,
        userVerified = 0,
        orgPending = 0,
        userPending = 0;

      snap.forEach((d) => {
        const u = d.data() || {};
        const acct = String(u.accountType || "individual").toLowerCase();
        const isOrg = acct === "organization";
        const isVerified = !!u.isVerified;

        if (isOrg) {
          orgTotal++;
          isVerified ? orgVerified++ : orgPending++;
        } else {
          userTotal++;
          isVerified ? userVerified++ : userPending++;
        }
      });

      setKpi({ orgTotal, userTotal });
      setBreakdown({ orgVerified, userVerified, orgPending, userPending });
    });
    return off;
  }, []);

  // urgentDonations (Completed + Declined) using mirrored timestamp selection
  useEffect(() => {
    const off = onSnapshot(collection(db, "urgentDonations"), (snap) => {
      const comp = Array(12).fill(0);
      const dec = Array(12).fill(0);

      snap.forEach((doc) => {
        const r = doc.data() || {};
        const ns = normalizeStatus(r.status);
        const m = monthIndexOf(pickEventAt(r));
        if (m < 0) return;

        if (ns === "completed") bumpMonth(comp, m, 1);
        else if (ns === "declined") bumpMonth(dec, m, 1);
      });

      setUrgentComp(comp);
      setUrgentDec(dec);
    });
    return off;
  }, []);

  // request (Completed + Declined) using mirrored timestamp selection and request-only filter
  useEffect(() => {
    const off = onSnapshot(collection(db, "request"), (snap) => {
      const comp = Array(12).fill(0);
      const dec = Array(12).fill(0);

      snap.forEach((doc) => {
        const r = doc.data() || {};
        if (!isRequestDoc(r)) return;

        // DonorDetail treats missing status as pending (so it doesn't jump to declined/complete)
        const ns = normalizeStatus(r.status || "pending");
        const m = monthIndexOf(pickEventAt(r));
        if (m < 0) return;

        if (ns === "completed") bumpMonth(comp, m, 1);
        else if (ns === "declined") bumpMonth(dec, m, 1);
      });

      setReqComp(comp);
      setReqDec(dec);
    });
    return off;
  }, []);

  // ✅ orgPostingDonations (Posting transactions) - adds missing completed/declined that DonorDetail counts
  useEffect(() => {
    const off = onSnapshot(collection(db, "orgPostingDonations"), (snap) => {
      const comp = Array(12).fill(0);
      const dec = Array(12).fill(0);

      snap.forEach((doc) => {
        const r = doc.data() || {};
        const ns = normalizeStatus(r.status || "pending");
        const m = monthIndexOf(pickEventAt(r));
        if (m < 0) return;

        if (ns === "completed") bumpMonth(comp, m, 1);
        else if (ns === "declined") bumpMonth(dec, m, 1);
      });

      setPostComp(comp);
      setPostDec(dec);
    });
    return off;
  }, []);

  /* ---------- derived charts (Completed + Declined lines only) ---------- */
  const completedByMonth = useMemo(
    () => urgentComp.map((v, i) => v + reqComp[i] + postComp[i]),
    [urgentComp, reqComp, postComp]
  );

  const declinedByMonth = useMemo(
    () => urgentDec.map((v, i) => v + reqDec[i] + postDec[i]),
    [urgentDec, reqDec, postDec]
  );

  const lineData = useMemo(
    () => ({
      labels: MONTHS,
      datasets: [
        {
          label: "Completed Transactions",
          data: completedByMonth,
          borderColor: "#18A15A",
          backgroundColor: "rgba(24,161,90,.18)",
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
        },
        {
          label: "Declined / Cancelled",
          data: declinedByMonth,
          borderColor: "#C23B37",
          backgroundColor: "rgba(194,59,55,.15)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
        },
      ],
    }),
    [completedByMonth, declinedByMonth]
  );

  const lineOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#0f172a" } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0, color: "#334155" },
          grid: { color: "rgba(15,23,42,.06)" },
        },
      },
    }),
    []
  );

  const totalAccounts =
    breakdown.orgVerified +
    breakdown.userVerified +
    breakdown.orgPending +
    breakdown.userPending;

  const pieLegendLabels = useMemo(() => {
    const pct = (v) => (totalAccounts ? Math.round((v / totalAccounts) * 1000) / 10 : 0);
    const { orgVerified, userVerified, orgPending, userPending } = breakdown;
    return [
      `Verified Organization (${orgVerified} | ${pct(orgVerified)}%)`,
      `Verified Individual (${userVerified} | ${pct(userVerified)}%)`,
      `Pending Organization (${orgPending} | ${pct(orgPending)}%)`,
      `Pending Individual (${userPending} | ${pct(userPending)}%)`,
    ];
  }, [breakdown, totalAccounts]);

  const pieData = useMemo(
    () => ({
      labels: pieLegendLabels,
      datasets: [
        {
          data: [breakdown.orgVerified, breakdown.userVerified, breakdown.orgPending, breakdown.userPending],
          backgroundColor: ["#18A15A", "#4C63D2", "#D86C3E", "#C23B37"],
          borderWidth: 0,
          hoverOffset: 12,
        },
      ],
    }),
    [breakdown, pieLegendLabels]
  );

  const pieOpts = useMemo(
    () => ({
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: {
            color: "#0f172a",
            usePointStyle: true,
            pointStyle: "rect",
            padding: 16,
            boxWidth: 14,
          },
        },
        title: { display: true, text: "Accounts by Status & Type" },
        pieHoverLabel: {
          decimals: 1,
          showCount: true,
          fontSize: 14,
          fontWeight: "700",
          color: "#ffffff",
          shadow: true,
          stroke: true,
        },
        tooltip: { enabled: false },
      },
      maintainAspectRatio: false,
    }),
    []
  );

  const isActive = (path) => location.pathname === path;

  return (
    <div className="dash">
      {/* HEADER */}
      <header className="hero">
        <h1 className="hero-title">Dashboard</h1>
        <nav className="hero-cta">
          <button className={`cta ${isActive("/") ? "is-active" : ""}`} onClick={() => navigate("/")}>
            Home
          </button>
          <button className={`cta ${isActive("/donors") ? "is-active" : ""}`} onClick={() => navigate("/donors")}>
            Donors
          </button>
          <button
            className={`cta ${isActive("/organizations") ? "is-active" : ""}`}
            onClick={() => navigate("/organizations")}
          >
            Organizations
          </button>
          <button className={`cta ${isActive("/users") ? "is-active" : ""}`} onClick={() => navigate("/users")}>
            Users
          </button>

          {/* LOGOUT → open confirm modal */}
          <button
            className="cta-logout"
            onClick={() => setConfirmOpen(true)}
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

      {/* ==== Smooth enter wrapper ==== */}
      <div className="route-fade">
        {/* KPIs */}
        <section className="kpi-band">
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-title">Total Organizations</div>
              <div className="kpi-number">{kpi.orgTotal}</div>
              <div className="kpi-sub">All organization accounts.</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title">Total Donors</div>
              <div className="kpi-number">{kpi.userTotal}</div>
              <div className="kpi-sub">All individual accounts.</div>
            </div>
          </div>
        </section>

        {/* CHARTS */}
        <section className="band">
          <div className="band-inner">
            <div className="card">
              <h3 className="card-title">Completed / Declined Transactions</h3>
              <div className="chart-body">
                <Line data={lineData} options={lineOpts} />
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Verified / Pending by User Type</h3>
              <div className="chart-body">
                <Pie data={pieData} options={pieOpts} plugins={[pieHoverLabelPlugin]} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ===== LOGOUT CONFIRM MODAL (inline, no new files) ===== */}
      {confirmOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Sign out?</h3>
            <p className="modal-sub">You will be returned to the login screen.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
