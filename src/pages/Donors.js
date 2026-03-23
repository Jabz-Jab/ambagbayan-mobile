// src/pages/Donors.js
import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { getAuth, signOut } from "firebase/auth";
import { db } from "../firebaseConfig";

/* Charts */
import { Bar, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";

/* Styles */
import "./Dashboard.css";
import "./Donors.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title
);

const BLUE_BAND = "#2F3FB4";
const CATEGORIES = ["Food", "Clothes", "Essential", "Others"];

const safeAvatar = (u) =>
  u?.profilePicture ||
  u?.photoURL ||
  u?.imageUrl ||
  u?.avatarUrl ||
  u?.logoUrl ||
  null;

/* -------------------- DonorDetail-mirrored helpers -------------------- */

const uniq = (arr = []) => {
  const out = [];
  const seen = new Set();
  for (const s of (arr || []).map((x) => String(x || "").trim()).filter(Boolean)) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
};

const chunk10 = (ids = []) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) out.push(ids.slice(i, i + 10));
  return out;
};

const first = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
};

const gatherTags = (r = {}) =>
  uniq([
    ...(Array.isArray(r.tags) ? r.tags : []),
    ...(Array.isArray(r.tagsPrivate) ? r.tagsPrivate : []),
    ...(Array.isArray(r.visionCanon) ? r.visionCanon : []),
  ])
    .map((t) => String(t).toLowerCase())
    .slice(0, 8);

/* ---------- ✅ CATEGORY: SINGLE SOURCE OF TRUTH (same as DonorDetail/Org pages) ---------- */

const normalizeCategory = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";

  // tolerate variants like "Essential Needs", "Food Packs", etc.
  if (/(^|\b)food(\b|$)|\bgrocery\b|\bmeal\b|\bfeeding\b/.test(s)) return "Food";
  if (/(^|\b)(cloth|clothes|clothing|apparel)(\b|$)/.test(s)) return "Clothes";
  if (/(^|\b)essent/.test(s) || /\bhygiene\b|\btoiletr/.test(s)) return "Essential";
  if (/(^|\b)other/.test(s) || /\bmisc/.test(s)) return "Others";

  // exact matches fallback
  if (s === "food") return "Food";
  if (s === "clothes" || s === "clothing" || s === "apparel") return "Clothes";
  if (s === "essential" || s === "essentials") return "Essential";
  if (s === "others" || s === "other") return "Others";
  return "";
};

/** Keyword fallback mapping (ONLY if explicit category is missing) */
const mapCategory = (raw) => {
  const s = String(raw || "").toLowerCase();
  if (!s) return "Others";

  // Food
  if (
    /(rice|food|meal|noodle|noodles|milk|snack|bread|canned|water|vegetable|fruit|grocer|grocery|sardine|tuna|flour|sugar|salt|oil|feeding|food pack|relief pack)/.test(
      s
    )
  )
    return "Food";

  // Essential (IMPORTANT: before Clothes)
  if (
    /(essential|essentials|hygiene|toiletr|soap|shampoo|toothbrush|toothpaste|tooth|mask|sanit|sanitizer|alcohol|diaper|pad|medicine|meds|tissue|toilet|paper towel|detergent|bleach|disinfect|first[\s-]?aid|bandage|gauze|flashlight|battery|candle|match|trash bag|wipe|blanket|towel)/.test(
      s
    )
  )
    return "Essential";

  // Clothes
  if (
    /(cloth|clothes|clothing|apparel|garment|uniform|jacket|shirt|t[-\s]?shirt|tee|jeans|pants|trousers|shorts|skirt|dress|hoodie|sweater|sock|socks|shoe|shoes|cap|hat|scarf|belt|glove|slipper|slippers|sandals|boots)/.test(
      s
    )
  )
    return "Clothes";

  return "Others";
};

const categoryTextFromRow = (r = {}) => {
  const parts = [
    r.categoryKey,
    r.categoryType,
    r.itemCategory,
    r.category,
    r.itemType,
    r.itemName,
    r.title,
    r.description,
    ...(Array.isArray(r.itemTags) ? r.itemTags : []),
  ].filter(Boolean);
  return parts.join(" ");
};

const getCategoryKey = (r = {}) => {
  const explicit =
    normalizeCategory(r.categoryKey) ||
    normalizeCategory(r.category) ||
    normalizeCategory(r.categoryType) ||
    normalizeCategory(r.itemCategory);

  const out = explicit || mapCategory(categoryTextFromRow(r));
  return CATEGORIES.includes(out) ? out : "Others";
};

const hasExplicitCategory = (r = {}) =>
  !!(
    normalizeCategory(first(r, ["categoryKey"])) ||
    normalizeCategory(first(r, ["category"])) ||
    normalizeCategory(first(r, ["categoryType"])) ||
    normalizeCategory(first(r, ["itemCategory"]))
  );

/* ✅ Status helper (MIRROR DonorDetail): accepted/pending/completed/declined (+ posted ignored) */
const normalizeStatus = (s = "") => {
  const v = String(s || "").toLowerCase().trim();
  if (!v) return "";
  if (/(accepted|accept|approved|approve)/.test(v)) return "accepted";
  if (/(completed|complete|fulfilled|success|done|received)/.test(v)) return "completed";
  if (/(pending|processing|in[\s-]?progress|awaiting|waiting)/.test(v)) return "pending";
  if (/(declined|rejected|cancelled|canceled|failed)/.test(v)) return "declined";
  if (/(posted)/.test(v)) return "posted";
  return v.replace(/\s+/g, "-");
};

/* Qty helpers */
const parseQty = (v) => {
  const n = Number(
    String(v || "")
      .replace(/,/g, "")
      .match(/-?\d+(\.\d+)?/)?.[0]
  );
  return Number.isFinite(n) && n > 0 ? n : null;
};

const formatList = (arr) => {
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
};

const ZERO = { Food: 0, Clothes: 0, Essential: 0, Others: 0 };
const STATUS_ZERO = { accepted: 0, declined: 0, pending: 0, completed: 0 };

/* urgent/direct category rule: only completed records count into category */
const OK_DIRECT = new Set(["completed"]);

/* Request qty (Posting org requests) */
const pickRequestQty = (r = {}) =>
  parseQty(
    first(r, [
      "requestedQty",
      "requestQty",
      "neededQty",
      "needQty",
      "requiredQty",
      "targetQty",
      "qty",
      "quantity",
      "amount",
      "count",
      "totalQty",
      "totalQuantity",
      "numberOfItems",
      "noOfItems",
    ])
  );

/** same “visible posting” rule used in DonorDetail */
const isVisiblePosting = (r = {}) =>
  r?.listedInCategory === true || r?.scope === "category" || r?.isPublic === true;

export default function Donors() {
  const navigate = useNavigate();
  const auth = getAuth();

  /* ===== left list ===== */
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");

  /* verified IDs */
  const [verifiedIds, setVerifiedIds] = useState(new Set());

  /* tallies (by category) — quantity-based (COMPLETED ONLY) */
  const [urgentCounts, setUrgentCounts] = useState({ ...ZERO });
  const [postedCounts, setPostedCounts] = useState({ ...ZERO });

  /* tallies (by status) — record-count based (MIRROR DonorDetail incl. posting transactions) */
  const [urgentStatus, setUrgentStatus] = useState({ ...STATUS_ZERO });
  const [postedStatus, setPostedStatus] = useState({ ...STATUS_ZERO });

  /* chart tab: "status" | "category" | "count" */
  const [activeChartTab, setActiveChartTab] = useState("status");

  /* ---------- Logout confirm modal ---------- */
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

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  /* ---------- PRINT MODAL STATE ---------- */
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const openPrintModal = () => setPrintModalOpen(true);
  const closePrintModal = () => setPrintModalOpen(false);

  /* ---------- caches (used for hydration: qty + missing category only) ---------- */
  const donationCacheRef = useRef(new Map()); // donationId -> data|null
  const requestCacheRef = useRef(new Map()); // requestId -> data|null

  const fetchDonationById = async (donationId) => {
    if (!donationId) return null;
    if (donationCacheRef.current.has(donationId)) {
      return donationCacheRef.current.get(donationId) || null;
    }
    try {
      const snap = await getDoc(doc(db, "donations", donationId));
      const data = snap.exists() ? snap.data() || {} : null;
      donationCacheRef.current.set(donationId, data);
      return data;
    } catch {
      donationCacheRef.current.set(donationId, null);
      return null;
    }
  };

  const fetchRequestById = async (requestId) => {
    if (!requestId) return null;
    if (requestCacheRef.current.has(requestId)) {
      return requestCacheRef.current.get(requestId) || null;
    }
    try {
      const snap = await getDoc(doc(db, "urgentRequests", requestId));
      const data = snap.exists() ? snap.data() || {} : null;
      requestCacheRef.current.set(requestId, data);
      return data;
    } catch {
      requestCacheRef.current.set(requestId, null);
      return null;
    }
  };

  /* ========== ✅ Posting transaction mirror (DonorDetail status logic) ========== */
  const postingTxnTokenRef = useRef(0);

  const POST_LINK_FIELDS = [
    "donationId",
    "donationID",
    "postId",
    "postingId",
    "listingId",
    "sourceDonationId",
  ];

  /**
   * Fetch all Posting-linked org request "transactions" from:
   * - orgPostingDonations
   * - request (type=request)
   *
   * Returns:
   *  - completedQtyTotals: Map(donationId -> sum completed qty)
   *  - txnStatusByDonationId: Map(donationId -> {total, accepted, pending, completed, declined})
   *
   * IMPORTANT: missing status is counted as "pending" (same as DonorDetail)
   */
  const fetchPostingTxnStats = async (donationIds = []) => {
    const ids = (donationIds || []).filter(Boolean);
    if (!ids.length) {
      return {
        completedQtyTotals: new Map(),
        txnStatusByDonationId: new Map(),
      };
    }

    const byKey = new Map();

    const pull = async (colName) => {
      for (const f of POST_LINK_FIELDS) {
        for (const ch of chunk10(ids)) {
          try {
            const snap = await getDocs(query(collection(db, colName), where(f, "in", ch)));
            snap.forEach((d) => {
              byKey.set(`${colName}:${d.id}`, {
                id: d.id,
                _src: colName,
                ...(d.data() || {}),
              });
            });
          } catch {
            // ignore missing index / field / etc.
          }
        }
      }
    };

    await Promise.all([pull("orgPostingDonations"), pull("request")]);

    // filter /request collection to request-type only (same as DonorDetail)
    const mergedRaw = Array.from(byKey.values()).filter((r) => {
      if (r._src !== "request") return true;
      const t = String(r.type || "").toLowerCase().trim();
      return !t || t === "request";
    });

    const completedQtyTotals = new Map(); // donationId -> sum completed qty
    const txnStatusByDonationId = new Map(); // donationId -> status counters

    const ensure = (did) => {
      const cur =
        txnStatusByDonationId.get(did) || {
          total: 0,
          accepted: 0,
          pending: 0,
          completed: 0,
          declined: 0,
        };
      txnStatusByDonationId.set(did, cur);
      return cur;
    };

    mergedRaw.forEach((r) => {
      const donationId = first(r, POST_LINK_FIELDS);
      if (!donationId) return;

      // IMPORTANT: DonorDetail treats missing status as pending so it COUNTS
      const statusRaw = String(r.status || "").trim() || "pending";
      const ns = normalizeStatus(statusRaw);

      const counters = ensure(donationId);
      counters.total += 1;

      if (ns === "accepted") counters.accepted += 1;
      else if (ns === "pending") counters.pending += 1;
      else if (ns === "completed") counters.completed += 1;
      else if (ns === "declined") counters.declined += 1;

      // completed qty totals (for category counts)
      if (ns === "completed") {
        const qRaw = pickRequestQty(r);
        const qty = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1;
        completedQtyTotals.set(donationId, (completedQtyTotals.get(donationId) || 0) + qty);
      }
    });

    return { completedQtyTotals, txnStatusByDonationId };
  };

  /* ---------- load verified individual users ---------- */
  useEffect(() => {
    const qq = query(
      collection(db, "users"),
      where("isVerified", "==", true),
      where("accountType", "in", ["individual", "Individual", ""])
    );
    const off = onSnapshot(qq, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => String(u.accountType || "individual").toLowerCase() !== "organization")
        .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
      setUsers(list);
      setVerifiedIds(new Set(list.map((u) => u.id)));
    });
    return off;
  }, []);

  /* urgentDonations:
     - status counts: record-based
     - category counts: qty-based but ONLY for completed
     - hydrate CATEGORY from urgentRequests/{requestId} or donations/{donationId} (only when missing)
  */
  useEffect(() => {
    let alive = true;

    const un = onSnapshot(collection(db, "urgentDonations"), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

      (async () => {
        const next = { ...ZERO };
        const nextStatus = { ...STATUS_ZERO };

        // status counts (record-based)
        for (const r of docs) {
          const uid = r.userId;
          if (!uid || !verifiedIds.has(uid)) continue;

          const n = normalizeStatus(r.status);
          if (n === "accepted") nextStatus.accepted += 1;
          else if (n === "pending") nextStatus.pending += 1;
          else if (n === "completed") nextStatus.completed += 1;
          else if (n === "declined") nextStatus.declined += 1;
        }

        // category counts (completed-only)
        const completedRows = docs.filter((r) => {
          const uid = r.userId;
          if (!uid || !verifiedIds.has(uid)) return false;
          return OK_DIRECT.has(normalizeStatus(r.status));
        });

        const contribs = await Promise.all(
          completedRows.map(async (r) => {
            const baseRow = {
              category: first(r, ["category", "categoryType", "itemCategory", "itemType"]) || "",
              categoryType: first(r, ["categoryType"]) || "",
              itemCategory: first(r, ["itemCategory"]) || "",
              categoryKey: first(r, ["categoryKey"]) || "",
              itemType: first(r, ["itemType", "itemName", "item"]) || "",
              itemName: first(r, ["itemName", "item"]) || "",
              title: first(r, ["title", "itemType", "category"]) || "Donation",
              description: r.description || "",
              itemTags: gatherTags(r),
            };

            // ✅ hydrate category only if missing
            let resolvedForCategory = baseRow;

            if (!hasExplicitCategory(baseRow)) {
              // Try urgentRequests doc (best for urgent)
              if (r.requestId) {
                const rq = await fetchRequestById(r.requestId);
                if (rq) {
                  resolvedForCategory = {
                    ...resolvedForCategory,
                    category:
                      resolvedForCategory.category ||
                      first(rq, ["category", "categoryType", "itemCategory", "itemType"]) ||
                      "",
                    categoryType:
                      resolvedForCategory.categoryType || first(rq, ["categoryType"]) || "",
                    itemCategory:
                      resolvedForCategory.itemCategory || first(rq, ["itemCategory"]) || "",
                    categoryKey:
                      resolvedForCategory.categoryKey || first(rq, ["categoryKey"]) || "",
                    title:
                      resolvedForCategory.title ||
                      first(rq, ["title", "itemType", "category"]) ||
                      "Donation",
                    description: resolvedForCategory.description || rq.description || "",
                    itemTags: resolvedForCategory.itemTags?.length
                      ? resolvedForCategory.itemTags
                      : gatherTags(rq),
                  };
                }
              }

              // Try donations doc (good for direct)
              if (!hasExplicitCategory(resolvedForCategory) && r.donationId) {
                const dn = await fetchDonationById(r.donationId);
                if (dn) {
                  resolvedForCategory = {
                    ...resolvedForCategory,
                    category:
                      resolvedForCategory.category ||
                      first(dn, ["category", "categoryType", "itemCategory", "itemType"]) ||
                      "",
                    categoryType:
                      resolvedForCategory.categoryType || first(dn, ["categoryType"]) || "",
                    itemCategory:
                      resolvedForCategory.itemCategory || first(dn, ["itemCategory"]) || "",
                    categoryKey:
                      resolvedForCategory.categoryKey || first(dn, ["categoryKey"]) || "",
                    title:
                      resolvedForCategory.title ||
                      first(dn, ["title", "itemType", "category"]) ||
                      "Donation",
                    description: resolvedForCategory.description || dn.description || "",
                    itemTags: resolvedForCategory.itemTags?.length
                      ? resolvedForCategory.itemTags
                      : gatherTags(dn),
                  };
                }
              }
            }

            const cat = getCategoryKey(resolvedForCategory);

            // qty: urgent row qty first, then hydrate qty only if missing
            let qty = parseQty(first(r, ["quantity", "qty"])) ?? null;

            if (!Number.isFinite(qty)) {
              if (r.requestId) {
                const rq = await fetchRequestById(r.requestId);
                const q2 = parseQty(first(rq || {}, ["quantity", "qty"]));
                if (Number.isFinite(q2)) qty = q2;
              }
            }

            if (!Number.isFinite(qty)) {
              if (r.donationId) {
                const dn = await fetchDonationById(r.donationId);
                const q3 = parseQty(first(dn || {}, ["quantity", "qty"]));
                if (Number.isFinite(q3)) qty = q3;
              }
            }

            return { cat, qty: Number.isFinite(qty) ? qty : 1 };
          })
        );

        contribs.forEach(({ cat, qty }) => {
          next[cat] = (next[cat] || 0) + qty;
        });

        if (!alive) return;
        setUrgentCounts(next);
        setUrgentStatus(nextStatus);
      })();
    });

    return () => {
      alive = false;
      un();
    };
  }, [verifiedIds]);

  /* donations (Posting):
     - mirror DonorDetail visibility filter
     - category qty counts ONLY COMPLETED (mirror Footprint rules):
        1) if donation has completed org request rows -> use sum of those request qty
        2) else if donation itself is completed -> use donation qty
        3) else -> 0
     - ✅ status counts MIRROR DonorDetail:
        - if donation has ANY posting transactions -> IGNORE donation status and COUNT EACH transaction status
        - else -> count donation status (record-based)
  */
  useEffect(() => {
    let alive = true;
    const un = onSnapshot(collection(db, "donations"), (snap) => {
      const token = (postingTxnTokenRef.current += 1);

      (async () => {
        // collect relevant visible postings by verified donors
        const baseByDonationId = new Map(); // donationId -> { cat, qty, donationStatus }
        snap.forEach((d) => {
          const r = d.data() || {};
          const uid = r.userId;
          if (!uid || !verifiedIds.has(uid)) return;
          if (!isVisiblePosting(r)) return;

          const donationStatus = normalizeStatus(r.status);

          const row = {
            category: first(r, ["category", "categoryType", "itemCategory"]) || "",
            categoryType: first(r, ["categoryType"]) || "",
            itemCategory: first(r, ["itemCategory"]) || "",
            categoryKey: first(r, ["categoryKey"]) || "",
            itemType: first(r, ["itemType", "itemName", "item"]) || "",
            itemName: first(r, ["itemName", "item"]) || "",
            title: first(r, ["title", "description", "category"]) || "Donation",
            description: r.description || "",
            itemTags: gatherTags(r),
          };

          const cat = getCategoryKey(row);
          const qRaw = parseQty(first(r, ["quantity", "qty"])) ?? null;
          const qty = Number.isFinite(qRaw) ? qRaw : 1;

          baseByDonationId.set(d.id, { cat, qty, donationStatus });
        });

        const donationIds = Array.from(baseByDonationId.keys());

        // fetch posting txn stats (counts by status + completed qty totals)
        let completedQtyTotals = new Map();
        let txnStatusByDonationId = new Map();
        try {
          const res = await fetchPostingTxnStats(donationIds);
          completedQtyTotals = res.completedQtyTotals;
          txnStatusByDonationId = res.txnStatusByDonationId;
        } catch {
          completedQtyTotals = new Map();
          txnStatusByDonationId = new Map();
        }

        // ---- category counts (completed-only mirror) ----
        const add = { ...ZERO };
        baseByDonationId.forEach((base, donationId) => {
          const reqQty = completedQtyTotals.get(donationId) || 0;
          const finalQty =
            reqQty > 0 ? reqQty : base.donationStatus === "completed" ? base.qty : 0;

          if (finalQty > 0) add[base.cat] = (add[base.cat] || 0) + finalQty;
        });

        // ---- status counts (DonorDetail mirror) ----
        const statusNext = { ...STATUS_ZERO };
        baseByDonationId.forEach((base, donationId) => {
          const tx = txnStatusByDonationId.get(donationId);

          // If donation has ANY transactions, ignore donation status and count each transaction
          if (tx && tx.total > 0) {
            statusNext.accepted += tx.accepted || 0;
            statusNext.pending += tx.pending || 0;
            statusNext.completed += tx.completed || 0;
            statusNext.declined += tx.declined || 0;
            return;
          }

          // Otherwise, count donation status (record-based), same buckets DonorDetail uses
          const n = base.donationStatus;
          if (n === "accepted") statusNext.accepted += 1;
          else if (n === "pending") statusNext.pending += 1;
          else if (n === "completed") statusNext.completed += 1;
          else if (n === "declined") statusNext.declined += 1;
          // (posted is intentionally ignored, same as DonorDetail summary)
        });

        if (!alive || postingTxnTokenRef.current !== token) return;
        setPostedCounts(add);
        setPostedStatus(statusNext);
      })();
    });

    return () => {
      alive = false;
      un();
    };
  }, [verifiedIds]);

  /* final combined counts (by category) — qty sum of urgent + posted (both completed-only now) */
  const counts = useMemo(
    () => ({
      Food: (urgentCounts.Food || 0) + (postedCounts.Food || 0),
      Clothes: (urgentCounts.Clothes || 0) + (postedCounts.Clothes || 0),
      Essential: (urgentCounts.Essential || 0) + (postedCounts.Essential || 0),
      Others: (urgentCounts.Others || 0) + (postedCounts.Others || 0),
    }),
    [urgentCounts, postedCounts]
  );

  /* ✅ final combined counts (by status) — MIRROR DonorDetail buckets */
  const statusCounts = useMemo(
    () => ({
      accepted: (urgentStatus.accepted || 0) + (postedStatus.accepted || 0),
      declined: (urgentStatus.declined || 0) + (postedStatus.declined || 0),
      pending: (urgentStatus.pending || 0) + (postedStatus.pending || 0),
      completed: (urgentStatus.completed || 0) + (postedStatus.completed || 0),
    }),
    [urgentStatus, postedStatus]
  );

  /* filter left list */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        (u.fullName || "").toLowerCase().includes(s) ||
        (u.email || "").toLowerCase().includes(s)
    );
  }, [users, q]);

  /* ---------- Charts data ---------- */

  const chartData = useMemo(
    () => ({
      labels: CATEGORIES,
      datasets: [
        {
          label: "Donations by Category",
          data: CATEGORIES.map((k) => counts[k] || 0),
          backgroundColor: ["#4C63D2", "#E58E57", "#18A15A", "#C23B37"],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    }),
    [counts]
  );

  const chartOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#0f172a", font: { weight: 700 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(15,23,42,.08)" },
          ticks: { stepSize: 1, precision: 0, color: "#334155" },
        },
      },
    }),
    []
  );

  const statusPieData = useMemo(() => {
    const total =
      statusCounts.accepted +
        statusCounts.declined +
        statusCounts.pending +
        statusCounts.completed || 1;

    const pct = (v) => Math.round((v / total) * 1000) / 10;

    return {
      labels: [
        `Accepted (${statusCounts.accepted} | ${pct(statusCounts.accepted)}%)`,
        `Declined (${statusCounts.declined} | ${pct(statusCounts.declined)}%)`,
        `Pending (${statusCounts.pending} | ${pct(statusCounts.pending)}%)`,
        `Completed (${statusCounts.completed} | ${pct(statusCounts.completed)}%)`,
      ],
      datasets: [
        {
          data: [
            statusCounts.accepted,
            statusCounts.declined,
            statusCounts.pending,
            statusCounts.completed,
          ],
          backgroundColor: ["#4C63D2", "#C23B37", "#E58E57", "#18A15A"],
          borderWidth: 0,
          hoverOffset: 10,
        },
      ],
    };
  }, [statusCounts]);

  const statusPieOpts = useMemo(
    () => ({
      plugins: { legend: { position: "right" } },
      maintainAspectRatio: false,
    }),
    []
  );

  const categoryPivot = useMemo(() => {
    const grandTotal = CATEGORIES.reduce((sum, cat) => {
      const urgent = urgentCounts[cat] || 0;
      const posted = postedCounts[cat] || 0;
      return sum + urgent + posted;
    }, 0);

    return CATEGORIES.map((cat) => {
      const urgent = urgentCounts[cat] || 0;
      const posted = postedCounts[cat] || 0;
      const total = urgent + posted;
      const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0;
      return { key: cat, label: cat, urgent, posted, total, pct };
    });
  }, [urgentCounts, postedCounts]);

  const totalCategoryCount = useMemo(
    () =>
      CATEGORIES.reduce((sum, cat) => {
        const urgent = urgentCounts[cat] || 0;
        const posted = postedCounts[cat] || 0;
        return sum + urgent + posted;
      }, 0),
    [urgentCounts, postedCounts]
  );

  const countNarrative = useMemo(() => {
    if (!totalCategoryCount) return null;

    const nonZero = categoryPivot.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    if (!nonZero.length) return null;

    const high = [];
    const medium = [];
    const low = [];

    nonZero.forEach((row) => {
      if (row.pct >= 40) high.push(row.label);
      else if (row.pct >= 15) medium.push(row.label);
      else low.push(row.label);
    });

    const sentences = [];
    sentences.push(
      `There are ${totalCategoryCount} completed donation items from verified donors across ${nonZero.length} active categories, combining urgent/direct and posting.`
    );

    const pieces = [];
    if (high.length) pieces.push(`most donations come from ${formatList(high)}`);
    if (medium.length) pieces.push(`followed by ${formatList(medium)}`);
    if (low.length) pieces.push(`with smaller shares in ${formatList(low)}`);

    if (pieces.length) sentences.push(pieces.join(", ") + ".");
    return sentences.slice(0, 2).join(" ");
  }, [categoryPivot, totalCategoryCount]);

  /* ---------- PRINT HANDLER ---------- */
  const handlePrintReport = () => {
    const now = new Date().toLocaleString();

    const totalStatus =
      statusCounts.accepted +
      statusCounts.declined +
      statusCounts.pending +
      statusCounts.completed;

    const safeTotalStatus = totalStatus || 1;

    const pctStatus = (v) => (safeTotalStatus ? Math.round((v / safeTotalStatus) * 1000) / 10 : 0);

    const statusRowsHtml = `
      <tr><td>Accepted</td><td>${statusCounts.accepted}</td><td>${pctStatus(
      statusCounts.accepted
    )}%</td></tr>
      <tr><td>Declined</td><td>${statusCounts.declined}</td><td>${pctStatus(
      statusCounts.declined
    )}%</td></tr>
      <tr><td>Pending</td><td>${statusCounts.pending}</td><td>${pctStatus(
      statusCounts.pending
    )}%</td></tr>
      <tr><td>Completed</td><td>${statusCounts.completed}</td><td>${pctStatus(
      statusCounts.completed
    )}%</td></tr>
    `;

    const categoryRowsHtml = categoryPivot
      .map(
        (row) => `
      <tr>
        <td>${row.label}</td>
        <td>${row.urgent}</td>
        <td>${row.posted}</td>
        <td>${row.total}</td>
        <td>${row.pct.toFixed(1)}%</td>
      </tr>
    `
      )
      .join("");

    const narrative = countNarrative
      ? countNarrative
      : "No completed donation records yet. Once data is available, this summary will automatically describe the distribution per category.";

    const printHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Donor Transactions Summary</title>
          <style>
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; font-size: 14px; }
            h1,h2,h3 { margin: 0 0 8px; }
            .header { text-align: center; margin-bottom: 16px; }
            .header h1 { font-size: 22px; font-weight: 800; }
            .header .sub { font-size: 13px; color: #64748b; }
            .meta { margin-bottom: 16px; font-size: 13px; color: #475569; }
            .section { margin-bottom: 18px; }
            .section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
            .narrative { font-size: 13px; margin-bottom: 8px; color: #334155; }
            table { width: 100%; border-collapse: collapse; margin-top: 6px; }
            th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-variant-numeric: tabular-nums; }
            thead th { background: #eff6ff; font-weight: 700; }
            tfoot td { font-weight: 700; background: #f9fafb; }
            .text-right { text-align: right; }
            .muted { color: #64748b; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Donor Transactions Summary</h1>
            <div class="sub">AmbagBayan &mdash; Overall donations from verified donors</div>
          </div>

          <div class="meta">
            Generated on: <strong>${now}</strong><br/>
            Total completed donation items (all categories): <strong>${totalCategoryCount}</strong><br/>
            Total transaction records (all statuses): <strong>${totalStatus}</strong>
          </div>

          <div class="section">
            <div class="section-title">Automatic Narrative</div>
            <p class="narrative">${narrative}</p>
          </div>

          <div class="section">
            <div class="section-title">Transactions by Status</div>
            <p class="muted">
              Posting records are counted like DonorDetail: if a posting has organization request transactions, each transaction is counted by status (and the posting's own status is ignored).
            </p>
            <table>
              <thead>
                <tr><th>Status</th><th class="text-right">Count</th><th class="text-right">Share</th></tr>
              </thead>
              <tbody>${statusRowsHtml}</tbody>
              <tfoot>
                <tr><td>Total</td><td class="text-right">${totalStatus}</td><td class="text-right">100%</td></tr>
              </tfoot>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Category Donation Count (Urgent/Direct vs Posting)</div>
            <p class="muted">
              Urgent/Direct counts include only <strong>completed</strong> records.
              Posting counts include only <strong>completed quantity</strong> (completed org request rows when available; otherwise a completed posting donation fallback).
            </p>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="text-right">Urgent/Direct (Completed)</th>
                  <th class="text-right">Posting (Completed Qty)</th>
                  <th class="text-right">Total</th>
                  <th class="text-right">Share</th>
                </tr>
              </thead>
              <tbody>${categoryRowsHtml}</tbody>
              <tfoot>
                <tr><td>Total</td><td class="text-right" colspan="3">${totalCategoryCount}</td><td class="text-right">100%</td></tr>
              </tfoot>
            </table>
          </div>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      alert("Please allow pop-ups to print this report.");
      return;
    }
    win.document.open();
    win.document.write(printHtml);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="dash">
      <header className="hero">
        <h1 className="hero-title">Donors</h1>
        <nav className="hero-cta">
          <button className="cta home" onClick={() => navigate("/")}>
            Home
          </button>
          <button
            className="cta donors is-active"
            aria-current="page"
            onClick={() => navigate("/donors")}
          >
            Donors
          </button>
          <button className="cta orgs" onClick={() => navigate("/organizations")}>
            Organizations
          </button>
          <button className="cta users" onClick={() => navigate("/users")}>
            Users
          </button>

          <button
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

      <div className="donors-wrap" style={{ background: BLUE_BAND }}>
        <div className="donors-band">
          <div className="panel left">
            <div className="donors-left-card">
              <input
                className="search"
                placeholder="Search donor name or email…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <div className="list">
                {filtered.map((u) => {
                  const avatar = safeAvatar(u);
                  const initials = (u.fullName || "U")
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <button
                      key={u.id}
                      className="row"
                      onClick={() => navigate(`/donors/${u.id}`)}
                    >
                      <div className="avatar">
                        {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
                      </div>
                      <div className="info">
                        <div className="name">{u.fullName || "—"}</div>
                        <div className="sub">{u.email || "—"}</div>
                      </div>
                    </button>
                  );
                })}
                {!filtered.length && <div className="empty">No verified donors found.</div>}
              </div>
            </div>
          </div>

          <div className="panel right">
            <div className="donors-chart-row">
              <div className="donors-chart-tabs">
                <button
                  type="button"
                  className={"donors-chart-tab" + (activeChartTab === "status" ? " is-active" : "")}
                  onClick={() => setActiveChartTab("status")}
                >
                  Transactions by Status
                </button>
                <button
                  type="button"
                  className={"donors-chart-tab" + (activeChartTab === "category" ? " is-active" : "")}
                  onClick={() => setActiveChartTab("category")}
                >
                  Category Breakdown
                </button>
                <button
                  type="button"
                  className={"donors-chart-tab" + (activeChartTab === "count" ? " is-active" : "")}
                  onClick={() => setActiveChartTab("count")}
                >
                  Category Donation Count
                </button>
              </div>

              <button type="button" className="donors-print-btn" onClick={openPrintModal}>
                Printable Report
              </button>
            </div>

            {activeChartTab === "status" && (
              <div className="card">
                <div className="card-head">
                  <div className="title">Transactions by Status</div>
                </div>
                <div className="chart">
                  <Pie data={statusPieData} options={statusPieOpts} />
                </div>
              </div>
            )}

            {activeChartTab === "category" && (
              <div className="card">
                <div className="card-head">
                  <div className="title">Overall Completed Donations by Category</div>
                </div>
                <div className="chart">
                  <Bar data={chartData} options={chartOpts} />
                </div>
              </div>
            )}

            {activeChartTab === "count" && (
              <div className="card">
                <div className="card-head">
                  <div className="title">Category Donation Count (Completed Qty)</div>
                  <div className="sub">
                    Total completed donation items: <strong>{totalCategoryCount}</strong>
                  </div>
                </div>

                {countNarrative ? (
                  <p className="card-desc">{countNarrative}</p>
                ) : (
                  <p className="card-desc">
                    No completed donation records yet. This section will automatically describe the
                    levels of each category once data is available.
                  </p>
                )}

                <div className="pivot-wrap">
                  <table className="pivot-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>
                          Urgent/Direct
                          <br />
                          (Completed)
                        </th>
                        <th>
                          Posting
                          <br />
                          (Completed Qty)
                        </th>
                        <th>Total</th>
                        <th style={{ width: "40%" }}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPivot.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.urgent}</td>
                          <td>{row.posted}</td>
                          <td>{row.total}</td>
                          <td>
                            <div
                              className="pivot-bar-track"
                              style={{
                                position: "relative",
                                height: 8,
                                borderRadius: 999,
                                overflow: "hidden",
                                background: "rgba(148,163,184,0.25)",
                                marginBottom: 4,
                              }}
                            >
                              <div
                                className="pivot-bar-fill"
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: `${Math.min(Math.max(row.pct, 0), 100)}%`,
                                  background: "linear-gradient(90deg,#4C63D2,#18A15A)",
                                }}
                              />
                            </div>
                            <span className="pivot-pct-label">{row.pct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {!totalCategoryCount && (
                    <div className="empty" style={{ marginTop: 12 }}>
                      No completed donation records yet for pivot view.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {printModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-report-title"
          onClick={closePrintModal}
        >
          <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
            <h3 id="print-report-title" className="modal-title">
              Printable Donor Transactions Summary
            </h3>
            <p className="modal-sub">
              This summary covers completed urgent/direct + completed posting quantity (completed org
              request rows when available). Status counts also mirror DonorDetail (posting transaction
              statuses override the posting record status when transactions exist).
            </p>

            <div className="print-report-preview">
              <div className="print-report-section">
                <h4>Quick Snapshot</h4>
                <p>
                  Total completed donation items: <strong>{totalCategoryCount}</strong>
                  <br />
                  Total transaction records (all statuses):{" "}
                  <strong>
                    {statusCounts.accepted +
                      statusCounts.declined +
                      statusCounts.pending +
                      statusCounts.completed}
                  </strong>
                </p>
                <p className="print-report-narrative">
                  {countNarrative ? (
                    countNarrative
                  ) : (
                    <>
                      No completed donation records yet. Once donation data is available, this summary
                      will automatically describe the distribution per category.
                    </>
                  )}
                </p>
              </div>

              <div className="print-report-grid">
                <div className="print-report-section">
                  <h4>Transactions by Status</h4>
                  <table className="print-mini-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Accepted</td>
                        <td>{statusCounts.accepted}</td>
                      </tr>
                      <tr>
                        <td>Declined</td>
                        <td>{statusCounts.declined}</td>
                      </tr>
                      <tr>
                        <td>Pending</td>
                        <td>{statusCounts.pending}</td>
                      </tr>
                      <tr>
                        <td>Completed</td>
                        <td>{statusCounts.completed}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="print-report-section">
                  <h4>Category Donation Count (Completed Qty)</h4>
                  <table className="print-mini-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Urgent/Direct</th>
                        <th>Posting</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPivot.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.urgent}</td>
                          <td>{row.posted}</td>
                          <td>{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={closePrintModal}>
                Close
              </button>
              <button type="button" className="btn primary" onClick={handlePrintReport}>
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
          onClick={closeConfirm}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title" id="logout-title">
              Sign out?
            </h3>
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
        </div>
      )}
    </div>
  );
}
