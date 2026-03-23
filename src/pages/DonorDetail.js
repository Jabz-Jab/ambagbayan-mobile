// src/pages/DonorDetail.js
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  documentId,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./DonorDetail.css";

const BLUE_BAND = "#2F3FB4";

/* -------------------- helpers -------------------- */
const uniq = (arr = []) => {
  const out = [];
  const seen = new Set();
  for (const s of (arr || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)) {
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

// like first(), but does NOT string-check (good for Timestamp/objects)
const firstAny = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
};

const pickImages = (r = {}) => {
  const flat = [
    r.imageUrl,
    r.itemImage,
    r.photo,
    r.cover,
    ...(Array.isArray(r.imageUrls) ? r.imageUrls : []),
    ...(Array.isArray(r.photos) ? r.photos : []),
  ].filter(Boolean);
  return uniq(flat);
};

const gatherTags = (r = {}) =>
  uniq([
    ...(Array.isArray(r.tags) ? r.tags : []),
    ...(Array.isArray(r.tagsPrivate) ? r.tagsPrivate : []),
    ...(Array.isArray(r.visionCanon) ? r.visionCanon : []),
  ])
    .map((t) => String(t).toLowerCase())
    .slice(0, 8);

// ✅ show "Direct / Post / Urgent" consistently in UI
const prettyKind = (k = "") => {
  const v = String(k || "").toLowerCase().trim();
  if (v === "posting" || v === "post") return "Post";
  if (v === "direct") return "Direct";
  if (v === "urgent") return "Urgent";
  return String(k || "—")
    .toLowerCase()
    .replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
};

/* ---------- category: single source of truth ---------- */
const normalizeCategory = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
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
    /(rice|food|meal|noodle|noodles|milk|snack|bread|canned|water|vegetable|fruit|grocer|grocery|sardine|tuna|flour|sugar|salt|oil)/.test(
      s
    )
  )
    return "Food";

  // Essential (IMPORTANT: before Clothes)
  if (
    /(essential|essentials|soap|shampoo|toothbrush|toothpaste|tooth|mask|sanit|sanitizer|alcohol|diaper|pad|medicine|meds|hygiene|tissue|toilet|paper towel|detergent|bleach|disinfect|first[\s-]?aid|bandage|gauze|flashlight|battery|candle|match|trash bag|wipe|blanket|towel)/.test(
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

/** Prefer explicit Firestore category fields, fallback to keyword mapping */
const getCategoryKey = (r = {}) => {
  const explicit =
    normalizeCategory(r.categoryKey) ||
    normalizeCategory(r.category) ||
    normalizeCategory(r.categoryType) ||
    normalizeCategory(r.itemCategory);

  return explicit || mapCategory(categoryTextFromRow(r));
};

const relTime = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const m = 60 * 1000,
    h = 60 * m,
    day = 24 * h;
  if (diff < h) return `${Math.max(1, Math.round(diff / m))}m ago`;
  if (diff < day) return `${Math.round(diff / h)}h ago`;
  return `${Math.round(diff / day)}d ago`;
};

const fmtDate = (ts, longOnly = false) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return "—";
  return longOnly
    ? d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : d.toLocaleString();
};

const dateKeyFromTs = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

const prettyDateKey = (key) => {
  if (!key || key === "All") return "all recorded days";
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatList = (arr = []) => {
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
};

/* Status helpers */
const normalizeStatus = (s = "") => {
  const v = String(s || "").toLowerCase().trim();
  if (!v) return "";
  if (/(accepted|accept|approved|approve)/.test(v)) return "accepted";
  if (/(completed|complete|fulfilled|success|done|received)/.test(v))
    return "completed";
  if (/(pending|processing|in[\s-]?progress|awaiting|waiting)/.test(v))
    return "pending";
  if (/(declined|rejected|cancelled|canceled|failed)/.test(v))
    return "declined";
  if (/(posted)/.test(v)) return "posted";
  return v.replace(/\s+/g, "-");
};

const prettyStatus = (s = "") => {
  const n = normalizeStatus(s);
  if (n === "accepted") return "Accepted";
  if (n === "completed") return "Completed";
  if (n === "pending") return "Pending";
  if (n === "declined") return "Declined";
  if (n === "posted") return "Posted";
  return String(s || "—")
    .toLowerCase()
    .replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
};

const parseQty = (v) => {
  const n = Number(
    String(v || "")
      .replace(/,/g, "")
      .match(/-?\d+(\.\d+)?/)?.[0]
  );
  return Number.isFinite(n) && n > 0 ? n : null;
};

const getQtyValue = (r) => {
  const q = Number(r?.qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
};

const isPlaceholderTitle = (t) => {
  const s = String(t || "").trim().toLowerCase();
  return !s || s === "donation";
};

/* Request helpers (for Org Requests under Posting) */
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

const pickOrgRequesterId = (r = {}) =>
  first(r, [
    "orgId",
    "organizationId",
    "requestingOrgId",
    "requesterOrgId",
    "targetOrgId",
    "receiverOrgId",
    "orgUid",
    "organizationUID",
    "userId",
    "requesterUserId",
    "ownerUserId",
    "createdBy",
  ]);

const pickOrgRequesterName = (r = {}) =>
  first(r, ["orgName", "organizationName", "receiverName", "requesterName", "name"]);

const orgDisplayName = (u, fallback = "Organization") =>
  u?.orgName || u?.fullName || u?.displayName || fallback;

const orgAvatar = (u) =>
  u?.photoURL ||
  u?.profilePicture ||
  u?.imageUrl ||
  u?.avatarUrl ||
  u?.avatar ||
  null;

// Posting <-> request link fields we support
const POST_LINK_FIELDS = [
  "donationId",
  "donationID",
  "postId",
  "postingId",
  "listingId",
  "sourceDonationId",
];

/* -------------------- component -------------------- */
export default function DonorDetail() {
  const { uid } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  // live partitions
  const [urgentRows, setUrgentRows] = useState([]);
  const [directRows, setDirectRows] = useState([]);
  const [postedRows, setPostedRows] = useState([]);

  // merged + ui
  const [rows, setRows] = useState([]);

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [kindFilter, setKindFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Newest");

  const [selectedDateKey, setSelectedDateKey] = useState("All");

  // lightbox
  const [lightbox, setLightbox] = useState({
    open: false,
    images: [],
    index: 0,
  });

  // details modal
  const [detail, setDetail] = useState({ open: false, item: null });

  // org-requests modal
  const [orgReqModal, setOrgReqModal] = useState({
    open: false,
    loading: false,
    item: null,
    groups: [], // [{ orgId, user, name, totalRequestedQty, requests: [] }]
    error: "",
  });
  const orgReqTokenRef = useRef(0);
  const orgUserMapRef = useRef(new Map()); // orgId -> user object

  // caches
  const donationCacheRef = useRef(new Map()); // donationId -> DocumentSnapshot
  const requestCacheRef = useRef(new Map()); // requestId -> DocumentSnapshot
  const userCacheRef = useRef(new Map()); // userId -> DocumentSnapshot

  // ✅ NEW: all org-request "transactions" linked to this donor's postings
  // shape: { requestId, requestSrc, donationId, orgId, orgName, qty, status, eventAt }
  const [postingTxnRows, setPostingTxnRows] = useState([]);
  const postingTxnTokenRef = useRef(0);

  const openLightbox = useCallback((images = [], startIndex = 0) => {
    const arr = (images || []).filter(Boolean);
    if (!arr.length) return;
    const idx = Math.max(0, Math.min(startIndex, arr.length - 1));
    setLightbox({ open: true, images: arr, index: idx });
  }, []);

  const closeLightbox = useCallback(
    () => setLightbox({ open: false, images: [], index: 0 }),
    []
  );

  const prevImg = useCallback((e) => {
    e?.stopPropagation();
    setLightbox((lb) => ({
      ...lb,
      index: (lb.index - 1 + lb.images.length) % lb.images.length,
    }));
  }, []);

  const nextImg = useCallback((e) => {
    e?.stopPropagation();
    setLightbox((lb) => ({
      ...lb,
      index: (lb.index + 1) % lb.images.length,
    }));
  }, []);

  const closeOrgReqModal = useCallback(() => {
    orgReqTokenRef.current += 1;
    setOrgReqModal({
      open: false,
      loading: false,
      item: null,
      groups: [],
      error: "",
    });
  }, []);

  const fetchUsersByIds = useCallback(async (ids = []) => {
    const unique = uniq(ids).filter(Boolean);
    const need = unique.filter((id) => !orgUserMapRef.current.has(id));
    const fetched = {};

    if (need.length) {
      for (const ch of chunk10(need)) {
        const snap = await getDocs(
          query(collection(db, "users"), where(documentId(), "in", ch))
        );
        snap.forEach((d) => {
          const u = { id: d.id, ...d.data() };
          orgUserMapRef.current.set(d.id, u);
          fetched[d.id] = u;
        });
      }
    }

    const out = {};
    unique.forEach((id) => {
      const u = orgUserMapRef.current.get(id);
      if (u) out[id] = u;
    });
    return { ...fetched, ...out };
  }, []);

  /**
   * ✅ NEW: Prefetch all org request "transactions" per Posting (donor side),
   * so we can COUNT them and include them in Status Summary.
   */
  useEffect(() => {
    let cancelled = false;
    const token = (postingTxnTokenRef.current += 1);

    (async () => {
      const donationIds = uniq(
        (postedRows || [])
          .map((r) => r?.donationId || r?.id)
          .filter(Boolean)
      );

      if (!donationIds.length) {
        if (!cancelled && postingTxnTokenRef.current === token) setPostingTxnRows([]);
        return;
      }

      const byKey = new Map();

      const pull = async (colName) => {
        for (const f of POST_LINK_FIELDS) {
          for (const ch of chunk10(donationIds)) {
            try {
              const snap = await getDocs(
                query(collection(db, colName), where(f, "in", ch))
              );
              snap.forEach((d) => {
                byKey.set(`${colName}:${d.id}`, {
                  id: d.id,
                  _src: colName,
                  ...(d.data() || {}),
                });
              });
            } catch {
              // ignore missing index / unsupported field / etc
            }
          }
        }
      };

      await Promise.all([pull("orgPostingDonations"), pull("request")]);

      // Only "request" type rows from /request
      const mergedRaw = Array.from(byKey.values()).filter((r) => {
        if (r._src !== "request") return true;
        const t = String(r.type || "").toLowerCase().trim();
        return !t || t === "request";
      });

      const normalized = mergedRaw
        .map((r) => {
          const donationId = first(r, POST_LINK_FIELDS) || "";
          const orgId = pickOrgRequesterId(r);
          const orgName = pickOrgRequesterName(r);

          // IMPORTANT: treat missing status as pending so it COUNTS
          const status = String(r.status || "").trim() || "pending";
          const qtyRaw = pickRequestQty(r);
          const qty = Number.isFinite(qtyRaw) ? qtyRaw : null;

          const eventAt =
            firstAny(r, [
              "completedAt",
              "fulfilledAt",
              "receivedAt",
              "doneAt",
              "dateCompleted",
              "statusUpdatedAt",
              "updatedAt",
              "createdAt",
              "timestamp",
              "date",
            ]) || null;

          return {
            requestId: String(r.id || ""),
            requestSrc: r._src,
            donationId,
            orgId,
            orgName,
            qty,
            status,
            eventAt,
          };
        })
        .filter((x) => !!x.donationId && !!x.orgId);

      // hydrate org display names (for modal + nice labels)
      const orgIds = uniq(normalized.map((x) => x.orgId).filter(Boolean));
      let usersMap = {};
      try {
        if (orgIds.length) usersMap = await fetchUsersByIds(orgIds);
      } catch {
        usersMap = {};
      }

      const withNames = normalized.map((x) => {
        const u = usersMap[x.orgId] || null;
        const nm = orgDisplayName(u, x.orgName || "Organization");
        return { ...x, orgName: nm };
      });

      if (cancelled || postingTxnTokenRef.current !== token) return;
      setPostingTxnRows(withNames);
    })();

    return () => {
      cancelled = true;
    };
  }, [postedRows, fetchUsersByIds]);

  /**
   * ✅ counts per posting donationId
   * (THIS is what you wanted: count EACH org request transaction inside Posting)
   */
  const postingTxnStatsByDonationId = useMemo(() => {
    const map = {};
    (postingTxnRows || []).forEach((t) => {
      const did = t.donationId;
      if (!did) return;

      if (!map[did]) {
        map[did] = {
          total: 0,
          accepted: 0,
          pending: 0,
          completed: 0,
          declined: 0,
        };
      }

      map[did].total += 1;
      const ns = normalizeStatus(t.status);

      if (ns === "accepted") map[did].accepted += 1;
      else if (ns === "pending") map[did].pending += 1;
      else if (ns === "completed") map[did].completed += 1;
      else if (ns === "declined") map[did].declined += 1;
    });
    return map;
  }, [postingTxnRows]);

  // ✅ Completed Posting transactions (synthetic rows) used ONLY by Daily Donation Footprint
  const postingCompletedReqRows = useMemo(() => {
    const donationRowMap = new Map(
      (postedRows || [])
        .map((p) => [p?.donationId || p?.id, p])
        .filter((x) => !!x[0])
    );

    return (postingTxnRows || [])
      .filter((t) => normalizeStatus(t.status) === "completed")
      .map((t) => {
        const base = donationRowMap.get(t.donationId) || {};

        const ts = t.eventAt || base.updatedAt || base.createdAt || null;

        const row = {
          id: `posttxn:${t.requestSrc}:${t.requestId}`,
          kind: "Posting",
          donationId: t.donationId,
          requestId: t.requestId,
          requestSrc: t.requestSrc,

          itemType: base.itemType || "",
          itemName: base.itemName || "",
          title: base.title || "Donation",

          category: base.category || "",
          categoryType: base.categoryType || "",
          itemCategory: base.itemCategory || "",
          categoryKey: base.categoryKey || "",

          qty: t.qty,

          locationText: base.locationText || "",
          orgName: t.orgName || base.orgName || "Organization",
          orgId: t.orgId || base.orgId || "",

          images: Array.isArray(base.images) ? base.images : [],
          thumb: base.thumb || "",

          createdAt: ts,
          updatedAt: ts,
          status: "completed",

          scope: base.scope,
          listedInCategory: !!base.listedInCategory,
          isPublic: !!base.isPublic,
          description: base.description || "",
          itemTags: Array.isArray(base.itemTags) ? base.itemTags : [],
        };

        row.categoryKey = getCategoryKey(row);
        return row;
      });
  }, [postingTxnRows, postedRows]);

  /**
   * DonorDetail reads org requests from BOTH:
   *  - orgPostingDonations
   *  - request
   * ✅ UPDATED: use prefetched postingTxnRows first (FAST), fallback to queries if needed.
   */
  const openOrgRequests = useCallback(
    async (postingRow) => {
      const donationId = postingRow?.donationId || postingRow?.id;
      if (!donationId) return;

      const token = (orgReqTokenRef.current += 1);
      setOrgReqModal({
        open: true,
        loading: true,
        item: postingRow,
        groups: [],
        error: "",
      });

      try {
        let normalized = (postingTxnRows || [])
          .filter((x) => x.donationId === donationId)
          .map((x) => ({
            id: `${x.requestSrc}:${x.requestId}`,
            orgId: x.orgId,
            orgName: x.orgName,
            qty: Number.isFinite(x.qty) ? x.qty : 0,
            status: x.status || "pending",
            createdAt: x.eventAt || null,
          }))
          .filter((r) => !!r.orgId);

        // fallback if prefetched not ready yet
        if (!normalized.length) {
          const orgPostingSnaps = await Promise.all(
            POST_LINK_FIELDS.map(async (f) => {
              try {
                return await getDocs(
                  query(collection(db, "orgPostingDonations"), where(f, "==", donationId))
                );
              } catch {
                return null;
              }
            })
          );

          const requestSnaps = await Promise.all(
            POST_LINK_FIELDS.map(async (f) => {
              try {
                return await getDocs(
                  query(collection(db, "request"), where(f, "==", donationId))
                );
              } catch {
                return null;
              }
            })
          );

          const byKey = new Map();

          orgPostingSnaps
            .filter(Boolean)
            .forEach((snap) =>
              snap.docs.forEach((d) =>
                byKey.set(`orgPostingDonations:${d.id}`, {
                  id: d.id,
                  _src: "orgPostingDonations",
                  ...(d.data() || {}),
                })
              )
            );

          requestSnaps
            .filter(Boolean)
            .forEach((snap) =>
              snap.docs.forEach((d) =>
                byKey.set(`request:${d.id}`, {
                  id: d.id,
                  _src: "request",
                  ...(d.data() || {}),
                })
              )
            );

          const mergedRaw = Array.from(byKey.values()).filter((r) => {
            if (r._src !== "request") return true;
            const t = String(r.type || "").toLowerCase().trim();
            return !t || t === "request";
          });

          normalized = mergedRaw
            .map((r) => {
              const orgId = pickOrgRequesterId(r);
              const name = pickOrgRequesterName(r);
              const qty = pickRequestQty(r);
              const status = String(r.status || "").trim() || "pending";
              const createdAt =
                firstAny(r, ["statusUpdatedAt", "updatedAt", "createdAt", "timestamp", "date"]) ||
                null;

              return {
                id: `${r._src}:${r.id}`,
                orgId,
                orgName: name,
                qty: Number.isFinite(qty) ? qty : 0,
                status,
                createdAt,
              };
            })
            .filter((r) => !!r.orgId);
        }

        const orgIds = uniq(normalized.map((r) => r.orgId));
        const usersMap = await fetchUsersByIds(orgIds);

        const groupsMap = new Map();
        normalized.forEach((r) => {
          const entry = groupsMap.get(r.orgId) || {
            orgId: r.orgId,
            totalRequestedQty: 0,
            requests: [],
          };
          entry.totalRequestedQty += r.qty || 0;
          entry.requests.push(r);
          groupsMap.set(r.orgId, entry);
        });

        const groups = Array.from(groupsMap.values())
          .map((g) => {
            const u = usersMap[g.orgId] || null;
            const nm = orgDisplayName(u, g.requests[0]?.orgName || "Organization");

            const requestsSorted = [...g.requests].sort((a, b) => {
              const ta = a.createdAt?.toDate
                ? a.createdAt.toDate().getTime()
                : new Date(a.createdAt || 0).getTime();
              const tb = b.createdAt?.toDate
                ? b.createdAt.toDate().getTime()
                : new Date(b.createdAt || 0).getTime();
              return tb - ta;
            });

            return {
              ...g,
              user: u,
              name: nm,
              requests: requestsSorted,
            };
          })
          .sort((a, b) => b.totalRequestedQty - a.totalRequestedQty);

        if (orgReqTokenRef.current !== token) return;
        setOrgReqModal({
          open: true,
          loading: false,
          item: postingRow,
          groups,
          error: "",
        });
      } catch (e) {
        if (orgReqTokenRef.current !== token) return;
        setOrgReqModal({
          open: true,
          loading: false,
          item: postingRow,
          groups: [],
          error: String(e?.message || "Failed to load organization requests."),
        });
      }
    },
    [fetchUsersByIds, postingTxnRows]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (lightbox.open) {
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") prevImg();
        if (e.key === "ArrowRight") nextImg();
      }
      if (detail.open && e.key === "Escape") setDetail({ open: false, item: null });
      if (orgReqModal.open && e.key === "Escape") closeOrgReqModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    lightbox.open,
    detail.open,
    orgReqModal.open,
    closeLightbox,
    prevImg,
    nextImg,
    closeOrgReqModal,
  ]);

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, "users", uid)).then((s) => s.exists() && setUser({ id: uid, ...s.data() }));
  }, [uid]);

  // urgent + direct (from urgentDonations)
  useEffect(() => {
    if (!uid) return;
    const un = onSnapshot(
      query(collection(db, "urgentDonations"), where("userId", "==", uid)),
      (snap) => {
        const all = snap.docs.map((d) => {
          const r = d.data() || {};
          const images = pickImages(r);
          const itemTags = gatherTags(r);

          const q = parseQty(first(r, ["quantity", "qty"])) ?? null;

          const base = {
            id: d.id,
            donationId: first(r, ["donationId"]) || null,

            itemType: first(r, ["itemType", "itemName", "item"]) || "",
            itemName: first(r, ["itemName", "item"]) || "",

            title: first(r, ["title", "itemType", "category"]) || "Donation",

            // ✅ FIX: do NOT treat itemType as a category source
            category: first(r, ["category", "categoryType", "itemCategory"]) || "",
            categoryType: first(r, ["categoryType"]) || "",
            itemCategory: first(r, ["itemCategory"]) || "",
            categoryKey: first(r, ["categoryKey"]) || "",

            qty: q,
            locationText: first(r, ["address", "locationText", "location"]) || "",
            orgName: first(r, ["orgName", "receiverName"]),
            orgId: first(r, ["organizationId", "orgId", "targetOrgId"]),
            images,
            thumb: images[0] || "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            status: r.status || "pending",
            requestId: first(r, ["requestId"]) || null,
            description: r.description || "",
            itemTags,
          };

          base.categoryKey = getCategoryKey(base);
          return base;
        });

        setUrgentRows(
          all
            .filter((x) => !!x.requestId)
            .map(({ requestId, ...rest }) => ({
              ...rest,
              kind: "Urgent",
              requestId,
            }))
        );

        setDirectRows(
          all.filter((x) => !x.requestId).map(({ requestId, ...rest }) => ({
            ...rest,
            kind: "Direct",
          }))
        );
      }
    );
    return () => un();
  }, [uid]);

  // posting (from donations)
  useEffect(() => {
    if (!uid) return;
    const un = onSnapshot(
      query(collection(db, "donations"), where("userId", "==", uid)),
      (snap) => {
        const allMine = snap.docs.map((d) => {
          const r = d.data() || {};
          const images = pickImages(r);
          const itemTags = gatherTags(r);

          const q = parseQty(first(r, ["quantity", "qty"])) ?? null;

          const row = {
            id: d.id,
            kind: "Posting",
            donationId: d.id,

            itemType: first(r, ["itemType", "itemName", "item"]) || "",
            itemName: first(r, ["itemName", "item"]) || "",

            title: first(r, ["title", "description", "category"]) || "Donation",

            category: first(r, ["category", "categoryType", "itemCategory"]) || "",
            categoryType: first(r, ["categoryType"]) || "",
            itemCategory: first(r, ["itemCategory"]) || "",
            categoryKey: first(r, ["categoryKey"]) || "",

            qty: q,
            locationText: first(r, ["location", "locationText", "address"]) || "",
            orgName:
              r.scope === "category"
                ? "Category List"
                : first(r, ["orgName", "receiverName"]) || "",
            orgId: first(r, ["organizationId", "orgId", "targetOrgId"]),
            images,
            thumb: images[0] || "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            status: r.status || "posted",
            scope: r.scope,
            listedInCategory: !!r.listedInCategory,
            isPublic: !!r.isPublic,
            description: r.description || "",
            itemTags,
          };

          row.categoryKey = getCategoryKey(row);
          return row;
        });

        setPostedRows(
          allMine.filter(
            (r) =>
              r.listedInCategory === true || r.scope === "category" || r.isPublic === true
          )
        );
      }
    );
    return () => un();
  }, [uid]);

  // merge + hydrate missing details
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const merged = [...urgentRows, ...postedRows, ...directRows];

      const hydrated = await Promise.all(
        merged.map(async (r) => {
          let row = { ...r };

          // org display name hydration
          if (!row.orgName && row.orgId) {
            try {
              const cachedU = userCacheRef.current.get(row.orgId);
              const usnap = cachedU || (await getDoc(doc(db, "users", row.orgId)));
              if (!cachedU) userCacheRef.current.set(row.orgId, usnap);
              if (usnap.exists()) {
                const u = usnap.data() || {};
                row.orgName = u.fullName || u.orgName || row.orgName || "Organization";
              }
            } catch {}
          }

          // direct hydration from donations/{donationId}
          const needsDirectHydration =
            row.kind === "Direct" &&
            !!row.donationId &&
            (!row.locationText ||
              !row.itemTags?.length ||
              !row.images?.length ||
              !row.category ||
              isPlaceholderTitle(row.title));

          if (needsDirectHydration) {
            try {
              const cached = donationCacheRef.current.get(row.donationId);
              const snap = cached || (await getDoc(doc(db, "donations", row.donationId)));
              if (!cached) donationCacheRef.current.set(row.donationId, snap);

              if (snap.exists()) {
                const d = snap.data() || {};

                row.locationText =
                  row.locationText || first(d, ["location", "locationText", "address"]) || "";

                row.itemType =
                  row.itemType || first(d, ["itemType", "itemName", "item"]) || "";
                row.itemName = row.itemName || first(d, ["itemName", "item"]) || "";

                const tags = gatherTags(d);
                if (!row.itemTags?.length && tags.length) row.itemTags = tags;

                const imgs = pickImages(d);
                if ((!row.images || row.images.length === 0) && imgs.length) row.images = imgs;
                if (!row.thumb && imgs[0]) row.thumb = imgs[0];

                row.category =
                  row.category || first(d, ["category", "categoryType", "itemCategory"]) || "";
                row.categoryType = row.categoryType || first(d, ["categoryType"]) || "";
                row.itemCategory = row.itemCategory || first(d, ["itemCategory"]) || "";
                row.categoryKey = row.categoryKey || first(d, ["categoryKey"]) || "";

                if (isPlaceholderTitle(row.title)) {
                  row.title = d.title || d.description || row.title;
                }

                const q = parseQty(d.quantity) ?? parseQty(d.qty);
                if (!Number.isFinite(row.qty) && q) row.qty = q;

                row.description = row.description || d.description || "";
              }
            } catch {}
          }

          // ✅ urgent rows should ALWAYS hydrate from urgentRequests/{requestId}
          const needsUrgentHydration = row.kind === "Urgent" && !!row.requestId;

          if (needsUrgentHydration) {
            try {
              const cachedR = requestCacheRef.current.get(row.requestId);
              const rsnap =
                cachedR || (await getDoc(doc(db, "urgentRequests", row.requestId)));
              if (!cachedR) requestCacheRef.current.set(row.requestId, rsnap);

              if (rsnap.exists()) {
                const rq = rsnap.data() || {};

                const imgs = pickImages(rq);
                if ((!row.images || row.images.length === 0) && imgs.length) row.images = imgs;
                if (!row.thumb && imgs[0]) row.thumb = imgs[0];

                row.itemType =
                  row.itemType || first(rq, ["itemType", "itemName", "item"]) || "";
                row.itemName = row.itemName || first(rq, ["itemName", "item"]) || "";

                if (isPlaceholderTitle(row.title)) {
                  row.title = rq.title || rq.description || row.title;
                }

                row.category = first(rq, ["category", "categoryType", "itemCategory"]) || row.category;
                row.categoryType = first(rq, ["categoryType"]) || row.categoryType;
                row.itemCategory = first(rq, ["itemCategory"]) || row.itemCategory;

                const rqExplicitKey =
                  normalizeCategory(first(rq, ["categoryKey"])) ||
                  normalizeCategory(first(rq, ["category"])) ||
                  normalizeCategory(first(rq, ["categoryType"])) ||
                  normalizeCategory(first(rq, ["itemCategory"]));

                if (rqExplicitKey) {
                  row.categoryKey = rqExplicitKey;
                } else {
                  const currentExplicit =
                    normalizeCategory(row.categoryKey) ||
                    normalizeCategory(row.category) ||
                    normalizeCategory(row.categoryType) ||
                    normalizeCategory(row.itemCategory);

                  if (!currentExplicit || currentExplicit === "Others") {
                    row.categoryKey = mapCategory(categoryTextFromRow({ ...row, ...rq }));
                  }
                }

                row.locationText =
                  row.locationText ||
                  first(rq, ["address", "locationText", "location"]) ||
                  row.locationText;

                const tags = gatherTags(rq);
                if (!row.itemTags?.length && tags.length) row.itemTags = tags;

                row.orgName = row.orgName || rq.orgName || row.orgName;
                row.orgId = row.orgId || rq.orgId || row.orgId;

                const q = parseQty(rq.quantity);
                if (!Number.isFinite(row.qty) && q) row.qty = q;

                row.description = row.description || rq.description || "";
              }
            } catch {}
          }

          row.categoryKey = getCategoryKey(row);
          return row;
        })
      );

      hydrated.sort((a, b) => {
        const ta = a.updatedAt || a.createdAt;
        const tb = b.updatedAt || b.createdAt;
        const aMs = ta?.toDate ? ta.toDate().getTime() : new Date(ta || 0).getTime();
        const bMs = tb?.toDate ? tb.toDate().getTime() : new Date(tb || 0).getTime();
        return bMs - aMs;
      });

      if (!cancelled) setRows(hydrated);
    })();

    return () => {
      cancelled = true;
    };
  }, [urgentRows, postedRows, directRows]);

  /**
   * ✅ Footprint base rows:
   * - include completed Urgent/Direct
   * - for Posting:
   *    - use ONLY completed request-rows (postingCompletedReqRows)
   *    - do NOT count "posted" donation qty
   *    - avoid double count: if donationId has completed req rows, exclude a completed Posting donation row
   *    - fallback: if Posting donation itself is completed and has NO req rows, count it
   */
  const footprintRowsAllDays = useMemo(() => {
    const hasPostingReq = new Set(
      (postingCompletedReqRows || []).map((r) => r?.donationId).filter(Boolean)
    );

    const completedNonPosting = (rows || []).filter(
      (r) => normalizeStatus(r.status) === "completed" && r.kind !== "Posting"
    );

    const completedPostingFallback = (rows || []).filter((r) => {
      if (r.kind !== "Posting") return false;
      if (normalizeStatus(r.status) !== "completed") return false;
      const did = r.donationId || r.id;
      return did && !hasPostingReq.has(did);
    });

    return [
      ...completedNonPosting,
      ...(postingCompletedReqRows || []),
      ...completedPostingFallback,
    ];
  }, [rows, postingCompletedReqRows]);

  const availableFootprintDateKeys = useMemo(() => {
    const set = new Set();
    footprintRowsAllDays.forEach((r) => {
      const ts = r.updatedAt || r.createdAt;
      const key = dateKeyFromTs(ts);
      if (key) set.add(key);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [footprintRowsAllDays]);

  useEffect(() => {
    if (selectedDateKey !== "All" && !availableFootprintDateKeys.includes(selectedDateKey)) {
      setSelectedDateKey("All");
    }
  }, [availableFootprintDateKeys, selectedDateKey]);

  const filteredRows = useMemo(() => {
    let list = rows;

    if (catFilter !== "All") list = list.filter((r) => getCategoryKey(r) === catFilter);
    if (kindFilter !== "All") list = list.filter((r) => r.kind === kindFilter);

    if (search.trim()) {
      const q2 = search.trim().toLowerCase();
      list = list.filter((r) => {
        const hay = [
          r.title,
          r.orgName,
          r.locationText,
          r.category,
          r.categoryKey,
          r.itemType,
          r.itemName,
          r.kind,
          ...(r.itemTags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q2);
      });
    }

    if (sortBy === "Oldest") {
      list = [...list].sort((a, b) => {
        const ta = a.updatedAt || a.createdAt;
        const tb = b.updatedAt || b.createdAt;
        const aMs = ta?.toDate ? ta.toDate().getTime() : new Date(ta || 0).getTime();
        const bMs = tb?.toDate ? tb.toDate().getTime() : new Date(tb || 0).getTime();
        return aMs - bMs;
      });
    }

    return list;
  }, [rows, search, catFilter, kindFilter, sortBy]);

  /* ---------- status counts (UPDATED: includes posting transactions) ---------- */
  const statusCounts = useMemo(() => {
    const base = { accepted: 0, pending: 0, completed: 0, declined: 0 };

    const txnDonationIds = new Set(
      (postingTxnRows || []).map((t) => t.donationId).filter(Boolean)
    );

    // 1) count core rows, but ignore Posting donation rows that have transactions (to avoid misleading/double logic)
    (rows || []).forEach((r) => {
      if (r.kind === "Posting") {
        const did = r.donationId || r.id;
        if (did && txnDonationIds.has(did)) return;
      }

      const n = normalizeStatus(r.status);
      if (n === "accepted" || n === "pending" || n === "completed" || n === "declined") {
        base[n] += 1;
      }
    });

    // 2) add each posting transaction as a row in counts
    (postingTxnRows || []).forEach((t) => {
      const n = normalizeStatus(t.status);
      if (n === "accepted" || n === "pending" || n === "completed" || n === "declined") {
        base[n] += 1;
      }
    });

    return base;
  }, [rows, postingTxnRows]);

  // ✅ completed only (for footprint) WITH posting completed-requests merged
  const rowsForChart = useMemo(() => {
    if (selectedDateKey === "All") return footprintRowsAllDays;
    return footprintRowsAllDays.filter((r) => {
      const ts = r.updatedAt || r.createdAt;
      return dateKeyFromTs(ts) === selectedDateKey;
    });
  }, [footprintRowsAllDays, selectedDateKey]);

  const counts = useMemo(() => {
    const c = { Food: 0, Clothes: 0, Essential: 0, Others: 0 };
    rowsForChart.forEach((r) => {
      const k = getCategoryKey(r);
      const qty = getQtyValue(r);
      c[k] = (c[k] || 0) + qty;
    });
    return c;
  }, [rowsForChart]);

  // ✅ "Merged" kind totals (Urgent/Posting/Direct) inside Donation Footprint
  const dayKindCounts = useMemo(() => {
    const base = { Urgent: 0, Posting: 0, Direct: 0 };
    rowsForChart.forEach((r) => {
      const qty = getQtyValue(r);
      const kind =
        r.kind === "Urgent" || r.kind === "Posting" || r.kind === "Direct" ? r.kind : "Posting";
      base[kind] = (base[kind] || 0) + qty;
    });
    return base;
  }, [rowsForChart]);

  const dayOrgs = useMemo(() => {
    const set = new Set();
    rowsForChart.forEach((r) => {
      if (r.orgName) set.add(r.orgName);
    });
    return Array.from(set);
  }, [rowsForChart]);

  const dailyMatrix = useMemo(() => {
    const categories = ["Food", "Clothes", "Essential", "Others"];
    const matrix = {};
    categories.forEach((cat) => {
      matrix[cat] = { Urgent: 0, Posting: 0, Direct: 0, total: 0 };
    });

    rowsForChart.forEach((r) => {
      const qty = getQtyValue(r);
      const cat = getCategoryKey(r);
      const kind =
        r.kind === "Urgent" || r.kind === "Posting" || r.kind === "Direct" ? r.kind : "Posting";
      if (!matrix[cat]) matrix[cat] = { Urgent: 0, Posting: 0, Direct: 0, total: 0 };
      matrix[cat][kind] += qty;
      matrix[cat].total += qty;
    });

    return { categories, matrix };
  }, [rowsForChart]);

  const snapshotNarrative = useMemo(() => {
    const totalQty = rowsForChart.reduce((s, r) => s + getQtyValue(r), 0);
    if (!totalQty) {
      return selectedDateKey === "All"
        ? "No completed donations recorded yet for this donor."
        : `No completed donations recorded on ${prettyDateKey(selectedDateKey)} for this donor.`;
    }

    const periodText =
      selectedDateKey === "All" ? "across all recorded days" : `on ${prettyDateKey(selectedDateKey)}`;
    const orgCount = dayOrgs.length;

    const nonZeroCats = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);

    const nonZeroKinds = Object.entries(dayKindCounts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key.toLowerCase());

    const orgPart = orgCount
      ? `supporting ${orgCount} organization${orgCount > 1 ? "s" : ""}`
      : "supporting different beneficiaries";

    const pieces = [];
    if (nonZeroKinds.length) pieces.push(`mostly through ${formatList(nonZeroKinds)} donations`);
    if (nonZeroCats.length) pieces.push(`focused on ${formatList(nonZeroCats)}`);
    const tail = pieces.length ? " " + pieces.join(" and ") + "." : ".";

    return `Completed ${totalQty} item${totalQty === 1 ? "" : "s"} ${periodText}, ${orgPart}${tail}`;
  }, [rowsForChart, selectedDateKey, dayOrgs, counts, dayKindCounts]);

  const graphCategories = ["Food", "Clothes", "Essential", "Others"];
  const maxGraphValue = Math.max(...graphCategories.map((c) => counts[c] || 0), 0);

  return (
    <div className="donors-wrap donor-detail-page" style={{ background: BLUE_BAND }}>
      <div className="donors-hero">
        <h1 className="hero-title">
          <i className="fi fi-rr-home" aria-hidden="true" />
          <span>{user?.fullName || "Donor"}</span>
        </h1>
        <div style={{ marginLeft: "auto" }}>
          <nav className="hero-cta">
            <button className="cta" onClick={() => navigate(-1)}>
              Back
            </button>
          </nav>
        </div>
      </div>

      <div className="donors-band">
        <div className="panel left">
          <div className="card donations-card">
            <div className="card-head" style={{ gap: 8 }}>
              <div className="title">
                Donations <span className="count-pill">{filteredRows.length}</span>
              </div>
              <div className="filters">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title/org/location…"
                />
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  style={{ minWidth: 150 }}
                >
                  <option value="All">All Category</option>
                  <option value="Food">Food</option>
                  <option value="Clothes">Clothes</option>
                  <option value="Essential">Essential</option>
                  <option value="Others">Others</option>
                </select>
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  style={{ minWidth: 150 }}
                >
                  <option value="All">All Donation</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Posting">Posting</option>
                  <option value="Direct">Direct</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ minWidth: 130 }}
                >
                  <option>Newest</option>
                  <option>Oldest</option>
                </select>
              </div>
            </div>

            <div className="donations-scroll">
              <div className="donor-detail-list" role="list">
                {filteredRows.map((it) => {
                  const when = relTime(it.updatedAt || it.createdAt);
                  const imgs = Array.isArray(it.images) ? it.images : it.thumb ? [it.thumb] : [];
                  const normStatus = normalizeStatus(it.status);
                  const qtyForDisplay = getQtyValue(it);

                  const did = it.donationId || it.id;
                  const txStats = it.kind === "Posting" && did ? postingTxnStatsByDonationId[did] : null;

                  return (
                    <div
                      key={it.id}
                      className="donor-detail-row compact"
                      role="listitem"
                      tabIndex={0}
                      aria-label={it.title || "Donation"}
                      onKeyDown={(e) =>
                        (e.key === "Enter" || e.key === " ") && setDetail({ open: true, item: it })
                      }
                    >
                      <div className="thumb">
                        {imgs.length ? (
                          <img
                            className="donation-thumb"
                            src={imgs[0]}
                            alt=""
                            loading="lazy"
                            width={112}
                            height={112}
                            role="button"
                            onClick={() => openLightbox(imgs, 0)}
                            title="Click to view"
                          />
                        ) : (
                          <div className="thumb-fallback" />
                        )}
                      </div>

                      <div className="dinfo compact">
                        <div className="dtitle clamp-2">{it.title || "Donation"}</div>

                        <div className="compact-meta">
                          <div
                            className="compact-meta-left"
                            style={{ gap: 8, display: "flex", flexWrap: "wrap" }}
                          >
                            <span className={`status-badge ${normStatus}`}>{prettyStatus(it.status)}</span>

                            {/* ✅ Transaction type indicator */}
                            <span className="time-dot" title="Transaction type">
                              Type: <b>{prettyKind(it.kind)}</b>
                            </span>

                            <span className="time-dot" title="Quantity">
                              Qty: <b>{qtyForDisplay}</b>
                            </span>

                            {/* ✅ NEW: count each org request transaction inside Posting */}
                            {it.kind === "Posting" && txStats?.total > 0 && (
                              <>
                                <span className="time-dot" title="Total org requests for this posting">
                                  Txns: <b>{txStats.total}</b>
                                </span>
                                <span className="time-dot" title="Completed org request transactions">
                                  Done: <b>{txStats.completed}</b>
                                </span>
                              </>
                            )}

                            {when && <span className="time-dot">{when}</span>}
                          </div>

                          {it.kind === "Posting" && (
                            <button
                              className="btn btn-view"
                              onClick={() => openOrgRequests(it)}
                              title="See organizations that requested this posting"
                            >
                              View org requests
                            </button>
                          )}

                          <button className="btn btn-view" onClick={() => setDetail({ open: true, item: it })}>
                            View details
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!rows.length && (
                  <div className="empty">{user ? "No donations found for this donor." : "Loading donor…"}</div>
                )}
                {rows.length > 0 && filteredRows.length === 0 && (
                  <div className="empty">No results match your filters.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="panel right">
          <div className="status-summary-grid">
            <div className="status-box accepted">
              <div className="status-label">Accepted</div>
              <div className="status-value">{statusCounts.accepted}</div>
            </div>
            <div className="status-box pending">
              <div className="status-label">Pending</div>
              <div className="status-value">{statusCounts.pending}</div>
            </div>
            <div className="status-box completed">
              <div className="status-label">Completed</div>
              <div className="status-value">{statusCounts.completed}</div>
            </div>
            <div className="status-box declined">
              <div className="status-label">Declined</div>
              <div className="status-value">{statusCounts.declined}</div>
            </div>
          </div>

          <div className="card analytics-card footprint-card">
            <div className="card-head footprint-head">
              <div className="title">Daily Donation Footprint</div>
              <div className="filters footprint-filters">
                <label
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  Day:
                </label>
                <select
                  value={selectedDateKey}
                  onChange={(e) => setSelectedDateKey(e.target.value)}
                  style={{ minWidth: 150 }}
                >
                  <option value="All">All days</option>
                  {availableFootprintDateKeys.map((k) => (
                    <option key={k} value={k}>
                      {prettyDateKey(k)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="card-desc" style={{ marginBottom: 8 }}>
              {snapshotNarrative}
            </p>

            {maxGraphValue > 0 ? (
              <div className="footprint-graph">
                {graphCategories.map((cat) => {
                  const val = counts[cat] || 0;
                  const pct = maxGraphValue ? Math.max(10, (val / maxGraphValue) * 100) : 0;
                  return (
                    <div key={cat} className="footprint-bar-row">
                      <span className="footprint-bar-label">{cat}</span>
                      <div className="footprint-bar-track">
                        <div className="footprint-bar-fill" style={{ width: `${pct}%` }}>
                          <span className="footprint-bar-value">{val}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="footprint-graph empty-graph">
                No completed donations to display for this day.
              </div>
            )}

            {/* ✅ MERGED: Kind totals inside Donation Footprint */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginTop: 12,
              }}
            >
              {["Urgent", "Posting", "Direct"].map((k) => (
                <div
                  key={k}
                  style={{
                    background: "#fff",
                    borderRadius: 14,
                    padding: 12,
                    boxShadow: "0 10px 24px rgba(15,23,42,.08)",
                    border: "1px solid rgba(226,232,240,.9)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                    {k === "Posting" ? "Post" : k}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 4 }}>
                    {dayKindCounts[k] || 0}
                  </div>
                </div>
              ))}
            </div>

            <div className="snapshot-table-wrap">
              <table className="snapshot-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Category</th>
                    <th>Urgent</th>
                    <th>Posting</th>
                    <th>Direct</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyMatrix.categories.map((cat) => {
                    const row = dailyMatrix.matrix[cat] || {
                      Urgent: 0,
                      Posting: 0,
                      Direct: 0,
                      total: 0,
                    };
                    return (
                      <tr key={cat}>
                        <td style={{ textAlign: "left" }}>{cat}</td>
                        <td>{row.Urgent}</td>
                        <td>{row.Posting}</td>
                        <td>{row.Direct}</td>
                        <td>{row.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* LIGHTBOX */}
      {lightbox.open && (
        <div className="lightbox" onClick={closeLightbox} aria-modal="true" role="dialog">
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {lightbox.images.length > 1 && (
              <>
                <button
                  className="lightbox-nav lightbox-prev"
                  onClick={prevImg}
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button className="lightbox-nav lightbox-next" onClick={nextImg} aria-label="Next image">
                  ›
                </button>
                <div className="lightbox-counter">
                  {lightbox.index + 1} / {lightbox.images.length}
                </div>
              </>
            )}
            <img className="lightbox-img" src={lightbox.images[lightbox.index]} alt="" />
            <button className="lightbox-close" onClick={closeLightbox} aria-label="Close">
              ×
            </button>
          </div>
        </div>
      )}

      {/* ORG REQUESTS MODAL */}
      {orgReqModal.open && (
        <div className="detail-overlay" onClick={closeOrgReqModal} aria-modal="true" role="dialog">
          <div className="detail-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="detail-close" onClick={closeOrgReqModal} aria-label="Close">
              ×
            </button>

            <h2 className="detail-title">Organization Requests</h2>

            <div style={{ marginTop: 6, marginBottom: 12, color: "#475569", fontSize: 13 }}>
              <div>
                <b>Posting:</b> {orgReqModal.item?.title || "—"}
              </div>
              <div>
                <b>Total organizations:</b> {orgReqModal.groups.length}
              </div>
              <div>
                <b>Total requested qty:</b>{" "}
                <span style={{ fontWeight: 900 }}>
                  {orgReqModal.groups.reduce((s, g) => s + (g.totalRequestedQty || 0), 0)}
                </span>
              </div>
            </div>

            {orgReqModal.loading ? (
              <div className="empty">Loading organization requests…</div>
            ) : orgReqModal.error ? (
              <div className="empty">{orgReqModal.error}</div>
            ) : orgReqModal.groups.length === 0 ? (
              <div className="empty">No organization requests found for this posting yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {orgReqModal.groups.map((g) => {
                  const u = g.user;
                  const nm = g.name || "Organization";
                  const av = orgAvatar(u);

                  return (
                    <div
                      key={g.orgId}
                      style={{
                        border: "1px solid #eef2ff",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fff",
                        boxShadow: "0 1px 0 rgba(17,24,39,0.03)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            overflow: "hidden",
                            background: "#e5e7eb",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: "1px solid #e6eafc",
                            flexShrink: 0,
                          }}
                        >
                          {av ? (
                            <img
                              src={av}
                              alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <span style={{ fontWeight: 900, fontSize: 12, color: "#1a2140" }}>
                              {(nm || "O").charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{nm}</div>
                          <div style={{ color: "#475569", fontSize: 12 }}>
                            Total requested qty: <b>{g.totalRequestedQty}</b> • Requests:{" "}
                            <b>{g.requests.length}</b>
                          </div>
                        </div>

                        <button
                          className="btn btn-view"
                          onClick={() => {
                            closeOrgReqModal();
                            navigate(`/organizations/${g.orgId}`);
                          }}
                          title="Open organization detail"
                        >
                          Open organization
                        </button>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {g.requests.slice(0, 8).map((r) => {
                          const ns = normalizeStatus(r.status);
                          return (
                            <div
                              key={r.id}
                              style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 10px",
                                borderRadius: 10,
                                background: "#f8fafc",
                                border: "1px solid #eef2ff",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>
                                  Request
                                </div>
                                <div style={{ fontSize: 12, color: "#64748b" }}>
                                  {r.createdAt ? fmtDate(r.createdAt, true) : "—"}
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: "#0f172a" }}>
                                  Qty: <b>{r.qty}</b>
                                </span>
                                <span className={`status-badge ${ns}`}>{prettyStatus(r.status)}</span>
                              </div>
                            </div>
                          );
                        })}
                        {g.requests.length > 8 && (
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            +{g.requests.length - 8} more request(s) not shown
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DETAILS MODAL */}
      {detail.open && detail.item && (
        <div
          className="detail-overlay"
          onClick={() => setDetail({ open: false, item: null })}
          aria-modal="true"
          role="dialog"
        >
          <div className="detail-card wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="detail-close"
              onClick={() => setDetail({ open: false, item: null })}
              aria-label="Close"
            >
              ×
            </button>

            <h2 className="detail-title">
              Donation <span style={{ color: "#64748b", fontWeight: 900 }}>• {prettyKind(detail.item.kind)}</span>
            </h2>

            <div className="receipt">
              <div className="receipt-img">
                {detail.item.thumb ? (
                  <img
                    src={detail.item.thumb}
                    alt=""
                    onClick={() =>
                      openLightbox(
                        detail.item.images?.length ? detail.item.images : [detail.item.thumb],
                        0
                      )
                    }
                    title="View photo"
                  />
                ) : (
                  <div className="receipt-img-fallback" />
                )}
              </div>

              <div className="receipt-main">
                <div className="receipt-itemline">
                  <span className="receipt-label">Item:</span>{" "}
                  <span className="receipt-value">{detail.item.title || "—"}</span>
                </div>

                <div className="receipt-itemline">
                  <span className="receipt-label">Transaction Type:</span>{" "}
                  <span className="receipt-value">{prettyKind(detail.item.kind)}</span>
                </div>

                <div className="receipt-itemline">
                  <span className="receipt-label">Quantity:</span>{" "}
                  <span className="receipt-value">{getQtyValue(detail.item)}</span>
                </div>

                {/* ✅ NEW: show posting transaction counts inside details */}
                {detail.item.kind === "Posting" && (() => {
                  const did = detail.item.donationId || detail.item.id;
                  const s = did ? postingTxnStatsByDonationId[did] : null;
                  if (!s || !s.total) return null;
                  return (
                    <div className="receipt-itemline">
                      <span className="receipt-label">Posting Transactions:</span>{" "}
                      <span className="receipt-value">
                        {s.total} total (Done: {s.completed}, Pending: {s.pending}, Accepted: {s.accepted}, Declined: {s.declined})
                      </span>
                    </div>
                  );
                })()}

                <div className="receipt-itemline">
                  <span className="receipt-label">Category:</span>{" "}
                  <span className="receipt-value">{getCategoryKey(detail.item)}</span>
                </div>

                <div className="receipt-datetime">
                  <div className="receipt-dt-label">Date of Transaction:</div>
                  <div className="receipt-dt">{fmtDate(detail.item.createdAt, true)}</div>
                </div>
              </div>

              <div className="receipt-side">
                <div className="receipt-status">
                  <div className="receipt-status-label">Status:</div>
                  <div className={`receipt-status-badge ${normalizeStatus(detail.item.status)}`}>
                    {prettyStatus(detail.item.status)}
                  </div>
                </div>

                {detail.item.kind === "Posting" && (
                  <>
                    <div className="receipt-location">
                      <div className="receipt-org-label">Posted Location:</div>
                      <div className="receipt-org-badge alt">📍 {detail.item.locationText || "—"}</div>
                    </div>

                    <div className="receipt-org" style={{ marginTop: 10 }}>
                      <div className="receipt-org-label">Organization Requests:</div>
                      <button
                        className="btn btn-view"
                        onClick={() => openOrgRequests(detail.item)}
                        title="See organizations that requested this posting"
                      >
                        View organization requests
                      </button>
                    </div>
                  </>
                )}

                {detail.item.kind === "Direct" && (
                  <div className="receipt-location">
                    <div className="receipt-org-label">Donor Location:</div>
                    <div className="receipt-org-badge alt">📍 {detail.item.locationText || "—"}</div>
                  </div>
                )}

                {detail.item.kind !== "Posting" && (
                  <div className="receipt-org">
                    <div className="receipt-org-label">Organization:</div>
                    <div className="receipt-org-badge">🏠 {detail.item.orgName || "—"}</div>
                  </div>
                )}
              </div>
            </div>

            {Array.isArray(detail.item.images) && detail.item.images.length > 1 && (
              <>
                <div className="detail-sub">Photos</div>
                <div className="detail-photos">
                  {detail.item.images.map((src, i) => (
                    <button
                      key={`${src}-${i}`}
                      className="detail-photo"
                      onClick={() => openLightbox(detail.item.images, i)}
                      title="Open image"
                    >
                      <img src={src} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
