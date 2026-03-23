// src/pages/Organizations.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  documentId,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getAuth, signOut } from "firebase/auth";
import { db } from "../firebaseConfig";

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
import { Bar, Pie } from "react-chartjs-2";

import "./Dashboard.css";
import "./Donors.css"; // layout + card styles reused
import "./Organizations.css";

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

/* ---------- helpers ---------- */

const safeAvatar = (u) =>
  u?.profilePicture ||
  u?.photoURL ||
  u?.imageUrl ||
  u?.avatarUrl ||
  u?.logoUrl ||
  null;

const norm = (s = "") =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const uniq = (arr = []) => Array.from(new Set((arr || []).filter(Boolean)));

const chunk10 = (ids = []) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) out.push(ids.slice(i, i + 10));
  return out;
};

const formatList = (arr) => {
  if (!arr?.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
};

const textify = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(textify).filter(Boolean).join(" ");
  if (typeof v === "object") {
    return textify(
      v.label ?? v.name ?? v.title ?? v.category ?? v.type ?? v.value ?? ""
    );
  }
  return String(v);
};

/** tolerant numeric parser (handles "5", "5 pcs", "1,200") */
const toNumber = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim();
  if (!s) return null;

  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
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

/* =========================
   ✅ CATEGORY LOGIC (MATCH Donors.js)
   - explicit category wins
   - mapCategory fallback only if explicit missing
   - ESSENTIAL BEFORE CLOTHES
   ========================= */

const normalizeCategory = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";

  if (/(^|\b)food(\b|$)|\bgrocery\b|\bmeal\b|\bfeeding\b/.test(s)) return "Food";
  if (/(^|\b)(cloth|clothes|clothing|apparel)(\b|$)/.test(s)) return "Clothes";
  if (/(^|\b)essent/.test(s) || /\bhygiene\b|\btoiletr/.test(s)) return "Essential";
  if (/(^|\b)other/.test(s) || /\bmisc/.test(s)) return "Others";

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

/* =========================
   ✅ STATUS HELPERS
   ========================= */

const normalizeStatus = (s = "") => {
  const v = norm(s).trim();
  if (!v) return "";
  if (/(accepted|accept|approved|approve)/.test(v)) return "accepted";
  if (/(completed|complete|fulfilled|success|done|received)/.test(v)) return "completed";
  if (/(pending|processing|in[\s-]?progress|awaiting|waiting)/.test(v)) return "pending";
  if (/(declined|rejected|cancelled|canceled|failed)/.test(v)) return "cancelled";
  if (/(posted)/.test(v)) return "posted";
  return v.replace(/\s+/g, "-");
};

const isCompleted = (s = "") => normalizeStatus(s) === "completed";

// status buckets for pie (record-count based)
const statusBucket = (s = "") => {
  const n = normalizeStatus(s);
  if (n === "completed") return "completed";
  if (n === "accepted") return "accepted";
  if (n === "pending" || n === "posted" || !n) return "pending";
  if (n === "cancelled" || n === "declined") return "cancelled";
  return "other";
};

/* qty pickers */
const pickRequestedQty = (r = {}) =>
  toNumber(
    r.requestedQty ??
      r.requestQty ??
      r.neededQty ??
      r.needQty ??
      r.requiredQty ??
      r.targetQty ??
      r.qty ??
      r.quantity ??
      r.amount ??
      r.count ??
      r.totalQty ??
      r.totalQuantity ??
      r.numberOfItems ??
      r.noOfItems ??
      null
  );

const pickCompletedQty = (r = {}) =>
  toNumber(
    r.completedQty ??
      r.fulfilledQty ??
      r.receivedQty ??
      r.receivedQuantity ??
      r.quantityReceived ??
      r.qtyReceived ??
      r.claimedQty ??
      r.deliveredQty ??
      r.fulfilled ??
      r.fulfilled_quantity ??
      r.completed_quantity ??
      null
  );

/**
 * ✅ Completed qty logic (same spirit as Donors/OrgDetail):
 * - use explicit completed/received fields if any
 * - if status is completed, fall back to requested/donated qty
 * - otherwise 0
 */
const getCompletedQty = (r = {}) => {
  const direct = pickCompletedQty(r);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  if (isCompleted(r.status)) {
    const req = pickRequestedQty(r);
    return Number.isFinite(req) && req > 0 ? req : 0;
  }
  return 0;
};

/**
 * Find org id in many fields:
 * - urgentDonations: orgId/receiverOrgId/etc
 * - posting transaction docs: orgId or sometimes userId/createdBy is org uid
 */
const possibleOrgId = (r = {}) =>
  r.orgId ||
  r.organizationId ||
  r.targetOrgId ||
  r.receiverId ||
  r.receiverOrgId ||
  r.beneficiaryId ||
  r.userId ||
  r.ownerUserId ||
  r.createdBy ||
  null;

/** same “visible posting” rule used in Donors.js */
const isVisiblePosting = (r = {}) =>
  r?.listedInCategory === true || r?.scope === "category" || r?.isPublic === true;

/* one-label-on-hover plugin for pie */
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
    const text = opts?.showCount === false ? `${pct}%` : `${pct}% (${value})`;

    const angle = arc.startAngle + arc.circumference / 2;
    const rr = (arc.outerRadius + arc.innerRadius) / 2;
    const x = arc.x + Math.cos(angle) * rr;
    const y = arc.y + Math.sin(angle) * rr;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${opts?.fontWeight || "700"} ${opts?.fontSize || 14}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
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

/* ==============
   Posting transaction linkage fields (match Donors.js)
   ============== */
const POST_LINK_FIELDS = [
  "donationId",
  "donationID",
  "postId",
  "postingId",
  "listingId",
  "sourceDonationId",
];

const pickPostingDonationId = (r = {}) => first(r, POST_LINK_FIELDS);

/* ------------- component ------------- */
export default function Organizations() {
  const navigate = useNavigate();
  const auth = getAuth();

  const [orgsLower, setOrgsLower] = useState([]);
  const [orgsUpper, setOrgsUpper] = useState([]);
  const [hydratedExtra, setHydratedExtra] = useState([]);

  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  // chart tab: "status" | "category" | "count"
  const [activeChartTab, setActiveChartTab] = useState("status");

  /* ===== Logout confirm modal ===== */
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
    const onKey = (e) => e.key === "Escape" && closeConfirm();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  /* ===== Printable Report modal state ===== */
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const openPrintModal = () => setPrintModalOpen(true);
  const closePrintModal = () => setPrintModalOpen(false);

  /* accountType === "organization" */
  useEffect(() => {
    const q1 = query(
      collection(db, "users"),
      where("accountType", "==", "organization")
    );
    const off1 = onSnapshot(q1, (snap) => {
      setOrgsLower(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => off1();
  }, []);

  /* accountType === "Organization" */
  useEffect(() => {
    const q2 = query(
      collection(db, "users"),
      where("accountType", "==", "Organization")
    );
    const off2 = onSnapshot(q2, (snap) => {
      setOrgsUpper(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => off2();
  }, []);

  /* merge w/o duplicates + include hydrated extras */
  const allOrgs = useMemo(() => {
    const map = new Map();
    [...orgsLower, ...orgsUpper, ...hydratedExtra].forEach((o) => {
      if (!o?.id) return;
      const prev = map.get(o.id);
      map.set(o.id, prev ? { ...prev, ...o } : o);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.fullName || a.orgName || "").localeCompare(
        String(b.fullName || b.orgName || "")
      )
    );
  }, [orgsLower, orgsUpper, hydratedExtra]);

  const orgIdSet = useMemo(() => new Set(allOrgs.map((o) => o.id)), [allOrgs]);

  const filteredOrgs = useMemo(() => {
    const n = norm(q);
    if (!n) return allOrgs;
    return allOrgs.filter((o) => {
      const name = norm(o.fullName || o.orgName || "");
      const addr = norm(o.address || "");
      return name.includes(n) || addr.includes(n);
    });
  }, [q, allOrgs]);

  /* -------------------------
     Live streams (MATCH OrgDetail + Donors logic)
     ✅ urgentDonations: donations received by org (includes direct + request-linked)
     ✅ posting transactions: orgPostingDonations + request(type==request) (linked to donations/{donationId})
     ✅ urgentRequests: ONLY for category inheritance of request-linked urgentDonations (NOT counted as items)
     ------------------------- */

  const [txnOrgIds, setTxnOrgIds] = useState([]);

  const [urgentRowsRaw, setUrgentRowsRaw] = useState([]); // /urgentDonations
  const [urgentNeedsRaw, setUrgentNeedsRaw] = useState([]); // /urgentRequests (inherit only)

  const [postingTxnOrgPostingRaw, setPostingTxnOrgPostingRaw] = useState([]); // /orgPostingDonations
  const [postingTxnRequestRaw, setPostingTxnRequestRaw] = useState([]); // /request type=request

  const cacheUsersRef = useRef(new Map());

  // urgentDonations
  useEffect(() => {
    const off = onSnapshot(collection(db, "urgentDonations"), (snap) => {
      const ids = [];
      const rows = [];

      snap.forEach((d) => {
        const r = d.data() || {};
        const oid = possibleOrgId(r);
        if (!oid) return;
        ids.push(oid);

        rows.push({
          id: d.id,
          orgId: oid,
          requestId: r.requestId || null, // urgent request id (urgentRequests)
          donationId: r.donationId || r.id,

          // category fields (for fallback mapping)
          categoryKey: r.categoryKey || "",
          category: first(r, ["category", "categoryType", "itemCategory", "itemType"]) || "",
          categoryType: first(r, ["categoryType"]) || "",
          itemCategory: first(r, ["itemCategory"]) || "",
          itemType: first(r, ["itemType", "itemName", "item"]) || "",
          itemName: first(r, ["itemName", "item"]) || "",
          title: first(r, ["title", "itemName", "description", "category"]) || "Donation",
          description: r.description || "",
          itemTags: gatherTags(r),

          qty: pickRequestedQty(r), // donated qty in most schemas
          completedQty: pickCompletedQty(r),
          status: r.status || "",
        });
      });

      setTxnOrgIds((p) => uniq([...(p || []), ...ids]));
      setUrgentRowsRaw(rows);
    });

    return () => off();
  }, []);

  // urgentRequests (inherit-only; do NOT count as completed items here)
  useEffect(() => {
    const off = onSnapshot(collection(db, "urgentRequests"), (snap) => {
      const ids = [];
      const rows = [];

      snap.forEach((d) => {
        const r = d.data() || {};
        const oid = possibleOrgId(r);
        if (!oid) return;

        ids.push(oid);

        rows.push({
          id: d.id,
          orgId: oid,
          requestId: d.id,

          categoryKey: r.categoryKey || "",
          category: first(r, ["category", "categoryType", "itemCategory", "itemType"]) || "",
          categoryType: first(r, ["categoryType"]) || "",
          itemCategory: first(r, ["itemCategory"]) || "",
          itemType: first(r, ["itemType", "itemName", "item"]) || "",
          itemName: first(r, ["itemName", "item"]) || "",
          title: first(r, ["title", "itemType", "category"]) || "Request",
          description: r.description || "",
          itemTags: gatherTags(r),

          status: r.status || "",
        });
      });

      setTxnOrgIds((p) => uniq([...(p || []), ...ids]));
      setUrgentNeedsRaw(rows);
    });

    return () => off();
  }, []);

  // posting transactions: orgPostingDonations
  useEffect(() => {
    const off = onSnapshot(collection(db, "orgPostingDonations"), (snap) => {
      const ids = [];
      const rows = [];

      snap.forEach((d) => {
        const r = d.data() || {};
        const oid = possibleOrgId(r);
        if (!oid) return;

        const donationId = pickPostingDonationId(r);
        if (!donationId) return; // must link to donation

        ids.push(oid);

        rows.push({
          id: d.id,
          _src: "orgPostingDonations",
          orgId: oid,
          donationId,
          status: String(r.status || "").trim() || "pending",
          qty: pickRequestedQty(r), // request qty
        });
      });

      setTxnOrgIds((p) => uniq([...(p || []), ...ids]));
      setPostingTxnOrgPostingRaw(rows);
    });

    return () => off();
  }, []);

  // posting transactions: request collection (type=request)
  useEffect(() => {
    const off = onSnapshot(
      query(collection(db, "request"), where("type", "==", "request")),
      (snap) => {
        const ids = [];
        const rows = [];

        snap.forEach((d) => {
          const r = d.data() || {};
          const oid = possibleOrgId(r);
          if (!oid) return;

          const donationId = pickPostingDonationId(r);
          if (!donationId) return;

          ids.push(oid);

          rows.push({
            id: d.id,
            _src: "request",
            orgId: oid,
            donationId,
            status: String(r.status || "").trim() || "pending",
            qty: pickRequestedQty(r),
          });
        });

        setTxnOrgIds((p) => uniq([...(p || []), ...ids]));
        setPostingTxnRequestRaw(rows);
      }
    );

    return () => off();
  }, []);

  // hydrate orgs referenced by transactions (not in /users snapshots yet)
  useEffect(() => {
    const known = new Set(allOrgs.map((o) => o.id));
    const need = uniq(
      txnOrgIds.filter((id) => !known.has(id) && !cacheUsersRef.current.has(id))
    );
    if (!need.length) return;

    (async () => {
      const acc = [];
      for (const chunk of chunk10(need)) {
        const snap = await getDocs(
          query(collection(db, "users"), where(documentId(), "in", chunk))
        );
        snap.forEach((d) => {
          const row = { id: d.id, ...d.data() };
          acc.push(row);
          cacheUsersRef.current.set(d.id, row);
        });
      }

      setHydratedExtra((prev) => {
        const m = new Map((prev || []).map((o) => [o.id, o]));
        acc.forEach((o) => m.set(o.id, o));
        return Array.from(m.values());
      });
    })();
  }, [txnOrgIds, allOrgs]);

  // Only keep rows that belong to known org users (prevents individual docs from polluting org charts)
  const urgentRows = useMemo(
    () => urgentRowsRaw.filter((r) => orgIdSet.has(r.orgId)),
    [urgentRowsRaw, orgIdSet]
  );

  const urgentNeeds = useMemo(
    () => urgentNeedsRaw.filter((r) => orgIdSet.has(r.orgId)),
    [urgentNeedsRaw, orgIdSet]
  );

  // merge posting txns (dedupe by src:id)
  const postingTxnRows = useMemo(() => {
    const m = new Map();
    [...postingTxnOrgPostingRaw, ...postingTxnRequestRaw].forEach((r) => {
      if (!r?.id) return;
      if (!orgIdSet.has(r.orgId)) return;
      m.set(`${r._src}:${r.id}`, r);
    });
    return Array.from(m.values());
  }, [postingTxnOrgPostingRaw, postingTxnRequestRaw, orgIdSet]);

  /* =========================
     ✅ Donation hydration for posting txns (MATCH Donors.js)
     - categorize posting txns based on donations/{donationId}
     - respect isVisiblePosting()
     ========================= */

  const [donationDocs, setDonationDocs] = useState({}); // donationId -> data|null
  const donationSeenRef = useRef(new Set());

  useEffect(() => {
    const ids = uniq(postingTxnRows.map((t) => t.donationId).filter(Boolean));
    const need = ids.filter((id) => !donationSeenRef.current.has(id));
    if (!need.length) return;

    (async () => {
      const add = {};
      for (const ch of chunk10(need)) {
        try {
          const snap = await getDocs(
            query(collection(db, "donations"), where(documentId(), "in", ch))
          );
          const got = new Set();
          snap.forEach((d) => {
            got.add(d.id);
            add[d.id] = d.data() || {};
            donationSeenRef.current.add(d.id);
          });

          // mark missing as null to prevent refetch loops
          ch.forEach((id) => {
            if (!got.has(id)) {
              add[id] = null;
              donationSeenRef.current.add(id);
            }
          });
        } catch {
          // if chunk fails, still mark as seen to avoid infinite refetch
          ch.forEach((id) => {
            add[id] = null;
            donationSeenRef.current.add(id);
          });
        }
      }

      if (Object.keys(add).length) {
        setDonationDocs((prev) => ({ ...prev, ...add }));
      }
    })();
  }, [postingTxnRows]);

  const donationCatById = useMemo(() => {
    const m = new Map();
    Object.entries(donationDocs || {}).forEach(([id, dn]) => {
      if (!dn) return;

      const row = {
        categoryKey: dn.categoryKey || "",
        category: first(dn, ["category", "categoryType", "itemCategory"]) || "",
        categoryType: first(dn, ["categoryType"]) || "",
        itemCategory: first(dn, ["itemCategory"]) || "",
        itemType: first(dn, ["itemType", "itemName", "item"]) || "",
        itemName: first(dn, ["itemName", "item"]) || "",
        title: first(dn, ["title", "description", "category"]) || "Donation",
        description: dn.description || "",
        itemTags: gatherTags(dn),
      };

      m.set(id, getCategoryKey(row));
    });
    return m;
  }, [donationDocs]);

  const donationVisibleById = useMemo(() => {
    const m = new Map();
    Object.entries(donationDocs || {}).forEach(([id, dn]) => {
      if (!dn) return;
      m.set(id, isVisiblePosting(dn));
    });
    return m;
  }, [donationDocs]);

  /* =========================
     ✅ CATEGORY COUNTS (NOW MATCH Donors.js)
     - urgentDonations: COMPLETED only, qty-based
     - posting transactions: COMPLETED only, qty-based,
       categorized by donations/{donationId} categoryKey,
       and only for visible postings
     - urgentRequests are NOT included as “items”
     ========================= */

  // urgent request category map (inherit for urgentDonations that fell to Others)
  const urgentNeedCatById = useMemo(() => {
    const m = new Map();
    urgentNeeds.forEach((r) => {
      const rid = r.requestId || r.id;
      if (!rid) return;
      m.set(rid, getCategoryKey(r));
    });
    return m;
  }, [urgentNeeds]);

  const urgentCounts = useMemo(() => {
    const counts = { Food: 0, Clothes: 0, Essential: 0, Others: 0 };

    for (const r of urgentRows) {
      if (!isCompleted(r.status)) continue;

      let cat = getCategoryKey(r);

      // inherit from urgent request if donation is weak/others
      if (cat === "Others" && r.requestId) {
        const reqCat = urgentNeedCatById.get(r.requestId);
        if (reqCat && reqCat !== "Others") cat = reqCat;
      }

      const qty = getCompletedQty(r); // uses completed/received fields; fallback to donated qty if completed
      if (qty > 0) counts[cat] = (counts[cat] || 0) + qty;
    }

    return counts;
  }, [urgentRows, urgentNeedCatById]);

  const postingCompletedCounts = useMemo(() => {
    const counts = { Food: 0, Clothes: 0, Essential: 0, Others: 0 };

    for (const t of postingTxnRows) {
      const did = t.donationId;
      if (!did) continue;

      // match Donors.js visibility rule
      const vis = donationVisibleById.get(did);
      if (vis !== true) continue;

      if (!isCompleted(t.status)) continue;

      const cat = donationCatById.get(did) || "Others";
      const qRaw = toNumber(t.qty);
      const qty = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1; // same default as Donors.js for completed txns

      counts[cat] = (counts[cat] || 0) + qty;
    }

    return counts;
  }, [postingTxnRows, donationVisibleById, donationCatById]);

  const combinedCounts = useMemo(
    () => ({
      Food: (urgentCounts.Food || 0) + (postingCompletedCounts.Food || 0),
      Clothes: (urgentCounts.Clothes || 0) + (postingCompletedCounts.Clothes || 0),
      Essential: (urgentCounts.Essential || 0) + (postingCompletedCounts.Essential || 0),
      Others: (urgentCounts.Others || 0) + (postingCompletedCounts.Others || 0),
    }),
    [urgentCounts, postingCompletedCounts]
  );

  const totalCategoryCount = useMemo(
    () => CATEGORIES.reduce((s, k) => s + (combinedCounts[k] || 0), 0),
    [combinedCounts]
  );

  /* =========================
     STATUS COUNTS (record-count based)
     - urgentDonations records
     - posting transaction records (visible donations only)
     ========================= */
  const statusCounts = useMemo(() => {
    const c = { accepted: 0, cancelled: 0, pending: 0, completed: 0 };

    // urgent donation records
    for (const row of urgentRows) {
      const b = statusBucket(row.status);
      if (b === "accepted") c.accepted += 1;
      else if (b === "pending") c.pending += 1;
      else if (b === "completed") c.completed += 1;
      else if (b === "cancelled") c.cancelled += 1;
    }

    // posting txn records (ONLY for visible postings to match Donors.js)
    for (const t of postingTxnRows) {
      const did = t.donationId;
      if (!did) continue;
      const vis = donationVisibleById.get(did);
      if (vis !== true) continue;

      const b = statusBucket(t.status);
      if (b === "accepted") c.accepted += 1;
      else if (b === "pending") c.pending += 1;
      else if (b === "completed") c.completed += 1;
      else if (b === "cancelled") c.cancelled += 1;
    }

    return c;
  }, [urgentRows, postingTxnRows, donationVisibleById]);

  const statusTotal = useMemo(
    () => Object.values(statusCounts).reduce((a, b) => a + b, 0),
    [statusCounts]
  );

  const statusLegendLabels = useMemo(() => {
    const pct = (v) =>
      statusTotal ? Math.round((v / statusTotal) * 1000) / 10 : 0;
    return [
      `Accepted (${statusCounts.accepted} | ${pct(statusCounts.accepted)}%)`,
      `Cancelled (${statusCounts.cancelled} | ${pct(statusCounts.cancelled)}%)`,
      `Pending (${statusCounts.pending} | ${pct(statusCounts.pending)}%)`,
      `Completed (${statusCounts.completed} | ${pct(statusCounts.completed)}%)`,
    ];
  }, [statusCounts, statusTotal]);

  const statusPieData = useMemo(
    () => ({
      labels: statusLegendLabels,
      datasets: [
        {
          data: [
            statusCounts.accepted,
            statusCounts.cancelled,
            statusCounts.pending,
            statusCounts.completed,
          ],
          backgroundColor: ["#4C63D2", "#C23B37", "#E58E57", "#18A15A"],
          borderWidth: 0,
          hoverOffset: 12,
        },
      ],
    }),
    [statusCounts, statusLegendLabels]
  );

  const statusPieOpts = useMemo(
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
        title: { display: true, text: "Transactions by Status" },
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

  /* =========================
     BAR CHART (completed qty)
     ========================= */

  const barData = useMemo(
    () => ({
      labels: CATEGORIES,
      datasets: [
        {
          label: "Completed Quantity (Urgent + Posting Transactions)",
          data: CATEGORIES.map((k) => combinedCounts[k] || 0),
          backgroundColor: ["#4C63D2", "#E58E57", "#18A15A", "#C23B37"],
          borderWidth: 0,
        },
      ],
    }),
    [combinedCounts]
  );

  const barOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Category Breakdown (Completed Quantity)" },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#0f172a" } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0, color: "#334155" },
        },
      },
    }),
    []
  );

  /* ---- Pivot table uses SAME totals as bar (fix mismatch) ---- */
  const categoryPivot = useMemo(() => {
    const cats = CATEGORIES;
    const grandTotal = cats.reduce((sum, cat) => sum + (combinedCounts[cat] || 0), 0);

    return cats.map((cat) => {
      const urgent = urgentCounts[cat] || 0;
      const posting = postingCompletedCounts[cat] || 0;
      const total = urgent + posting;
      const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0;
      return { key: cat, label: cat, urgent, posting, total, pct };
    });
  }, [urgentCounts, postingCompletedCounts, combinedCounts]);

  const countNarrative = useMemo(() => {
    if (!totalCategoryCount) return null;

    const nonZero = categoryPivot
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

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
      `There are ${totalCategoryCount} completed item(s) referenced by organization activity across ${nonZero.length} active categories.`
    );

    const pieces = [];
    if (high.length) pieces.push(`most items are from ${formatList(high)}`);
    if (medium.length) pieces.push(`followed by ${formatList(medium)}`);
    if (low.length) pieces.push(`with smaller shares in ${formatList(low)}`);
    if (pieces.length) sentences.push(pieces.join(", ") + ".");

    return sentences.slice(0, 2).join(" ");
  }, [categoryPivot, totalCategoryCount]);

  /* ===== Printable HTML export ===== */
  const handlePrintReport = () => {
    const now = new Date().toLocaleString();
    const totalStatus =
      statusCounts.accepted +
      statusCounts.cancelled +
      statusCounts.pending +
      statusCounts.completed;

    const safeTotalStatus = totalStatus || 1;
    const pctStatus = (v) =>
      safeTotalStatus ? Math.round((v / safeTotalStatus) * 1000) / 10 : 0;

    const statusRowsHtml = `
      <tr><td>Accepted</td><td>${statusCounts.accepted}</td><td>${pctStatus(statusCounts.accepted)}%</td></tr>
      <tr><td>Cancelled</td><td>${statusCounts.cancelled}</td><td>${pctStatus(statusCounts.cancelled)}%</td></tr>
      <tr><td>Pending</td><td>${statusCounts.pending}</td><td>${pctStatus(statusCounts.pending)}%</td></tr>
      <tr><td>Completed</td><td>${statusCounts.completed}</td><td>${pctStatus(statusCounts.completed)}%</td></tr>
    `;

    const categoryRowsHtml = categoryPivot
      .map(
        (row) => `
      <tr>
        <td>${row.label}</td>
        <td class="text-right">${row.total}</td>
        <td class="text-right">${row.pct.toFixed(1)}%</td>
      </tr>
    `
      )
      .join("");

    const narrative =
      countNarrative ||
      "No completed quantity yet. Once there is completed activity, this summary will describe the distribution per category.";

    const printHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Organization Activity Summary</title>
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
            <h1>Organization Activity Summary</h1>
            <div class="sub">AmbagBayan — completed quantity overview</div>
          </div>

          <div class="meta">
            Generated on: <strong>${now}</strong><br/>
            Total completed items (all categories): <strong>${totalCategoryCount}</strong><br/>
            Total transaction records (all statuses): <strong>${totalStatus}</strong>
          </div>

          <div class="section">
            <div class="section-title">Automatic Narrative</div>
            <p class="narrative">${narrative}</p>
          </div>

          <div class="section">
            <div class="section-title">Transactions by Status</div>
            <table>
              <thead><tr><th>Status</th><th class="text-right">Count</th><th class="text-right">Share</th></tr></thead>
              <tbody>${statusRowsHtml}</tbody>
              <tfoot><tr><td>Total</td><td class="text-right">${totalStatus}</td><td class="text-right">100%</td></tr></tfoot>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Category (Completed Quantity)</div>
            <p class="muted">
              Category totals count only completed quantity from urgent donations and completed posting transactions.
              Posting transactions are categorized using the linked donation's category (same as Donors.js).
            </p>
            <table>
              <thead><tr><th>Category</th><th class="text-right">Total Items</th><th class="text-right">Share</th></tr></thead>
              <tbody>${categoryRowsHtml}</tbody>
              <tfoot><tr><td>Total</td><td class="text-right">${totalCategoryCount}</td><td class="text-right">100%</td></tr></tfoot>
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
        <h1 className="hero-title">Organizations</h1>
        <nav className="hero-cta">
          <button className="cta home" onClick={() => navigate("/")}>
            Home
          </button>
          <button className="cta donors" onClick={() => navigate("/donors")}>
            Donors
          </button>
          <button className="cta orgs is-active" aria-current="page">
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
                ref={inputRef}
                className="search"
                placeholder="Search organization name or address…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQ("");
                    inputRef.current?.focus();
                  }
                }}
              />

              <div className="list">
                {filteredOrgs.map((o) => {
                  const avatar = safeAvatar(o);
                  const displayName = o.fullName || o.orgName || "Organization";
                  const initials = String(displayName || "O")
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();

                  return (
                    <button
                      key={o.id}
                      className="row"
                      onClick={() => navigate(`/organizations/${o.id}`)}
                      title={displayName}
                    >
                      <div className="avatar">
                        {avatar ? (
                          <img src={avatar} alt="" loading="lazy" />
                        ) : (
                          <span>{initials}</span>
                        )}
                      </div>
                      <div className="info">
                        <div className="name">{displayName}</div>
                        <div className="sub">{o.address || "—"}</div>
                      </div>
                    </button>
                  );
                })}

                {!filteredOrgs.length && (
                  <div className="empty">No organizations match “{q || "…"}”.</div>
                )}
              </div>
            </div>
          </div>

          <div className="panel right">
            <div className="donors-chart-row">
              <div className="donors-chart-tabs">
                <button
                  type="button"
                  className={
                    "orgs-chart-tab" +
                    (activeChartTab === "status" ? " is-active" : "")
                  }
                  onClick={() => setActiveChartTab("status")}
                >
                  Transactions by Status
                </button>
                <button
                  type="button"
                  className={
                    "orgs-chart-tab" +
                    (activeChartTab === "category" ? " is-active" : "")
                  }
                  onClick={() => setActiveChartTab("category")}
                >
                  Category Breakdown
                </button>
                <button
                  type="button"
                  className={
                    "orgs-chart-tab" +
                    (activeChartTab === "count" ? " is-active" : "")
                  }
                  onClick={() => setActiveChartTab("count")}
                >
                  Category Request Count
                </button>
              </div>

              <button
                type="button"
                className="donors-print-btn"
                onClick={openPrintModal}
              >
                Printable Report
              </button>
            </div>

            {activeChartTab === "status" && (
              <div className="card">
                <div className="card-head">
                  <div className="title">Transactions by Status</div>
                </div>
                <div className="chart">
                  <Pie
                    data={statusPieData}
                    options={statusPieOpts}
                    plugins={[pieHoverLabelPlugin]}
                  />
                </div>
              </div>
            )}

            {activeChartTab === "category" && (
              <div className="card">
                <div className="card-head">
                  <div className="title">Category Breakdown</div>
                  <div className="sub">
                    Completed quantity: <strong>{totalCategoryCount}</strong>
                  </div>
                </div>
                <div className="chart">
                  <Bar data={barData} options={barOpts} />
                </div>
              </div>
            )}

            {activeChartTab === "count" && (
              <div className="card">
                <div className="card-head">
                 <div className="title">
  Category Request Count <br />
  (Completed Qty)
</div>

                  <div className="sub">
                    Total completed items: <strong>{totalCategoryCount}</strong>
                  </div>
                </div>

                {countNarrative ? (
                  <p className="card-desc">{countNarrative}</p>
                ) : (
                  <p className="card-desc">
                    No completed quantity yet. This section will describe the
                    distribution by category once data is available.
                  </p>
                )}

                <div className="pivot-wrap">
                  <table className="pivot-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Total</th>
                        <th style={{ width: "40%" }}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPivot.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
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
                                  background:
                                    "linear-gradient(90deg,#4C63D2,#18A15A)",
                                }}
                              />
                            </div>
                            <span className="pivot-pct-label">
                              {row.pct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {!totalCategoryCount && (
                    <div className="empty" style={{ marginTop: 12 }}>
                      No completed records yet for pivot view.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Printable Report Modal ===== */}
      {printModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-org-report-title"
          onClick={closePrintModal}
        >
          <div
            className="modal-card modal-card-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="print-org-report-title" className="modal-title">
              Printable Organization Activity Summary
            </h3>
            <p className="modal-sub">
              Click <strong>Print</strong> to generate a printable report in a new tab.
            </p>

            <div className="print-report-preview">
              <div className="print-report-section">
                <h4>Quick Snapshot</h4>
                <p>
                  Total completed items: <strong>{totalCategoryCount}</strong>
                  <br />
                  Total transaction records (all statuses):{" "}
                  <strong>{statusTotal}</strong>
                </p>
                <p className="print-report-narrative">
                  {countNarrative ? (
                    countNarrative
                  ) : (
                    <>
                      No completed data yet. Once there is completed activity, this
                      summary will describe the distribution per category.
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
                      <tr><td>Accepted</td><td>{statusCounts.accepted}</td></tr>
                      <tr><td>Cancelled</td><td>{statusCounts.cancelled}</td></tr>
                      <tr><td>Pending</td><td>{statusCounts.pending}</td></tr>
                      <tr><td>Completed</td><td>{statusCounts.completed}</td></tr>
                    </tbody>
                  </table>
                </div>

                <div className="print-report-section">
                  <h4>Category (Completed Quantity)</h4>
                  <table className="print-mini-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPivot.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={closePrintModal}
              >
                Close
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handlePrintReport}
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Logout Confirm Modal ===== */}
      {confirmOpen && (
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
        </div>
      )}
    </div>
  );
}
