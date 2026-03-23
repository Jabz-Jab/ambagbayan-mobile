// src/pages/OrganizationDetail.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  documentId,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./OrganizationDetail.css";

/* -------------------- constants -------------------- */
const ALL = "All";
const NEWEST = "Newest";
const OLDEST = "Oldest";

const FOOD = "Food";
const CLOTHES = "Clothes";
const ESSENTIAL = "Essential";
const OTHERS = "Others";

const POSTING = "Posting";
const DIRECT = "Direct";
const REQUEST = "Request";
const URGENT = "Urgent";

const COL_USERS = "users";
const COL_ORG_POSTING_DONATIONS = "orgPostingDonations";
const COL_REQUESTS = "request"; // ✅ keep as "request" since that's what your code shows
const COL_DONATIONS = "donations";
const COL_URGENT_DONATIONS = "urgentDonations";
const COL_URGENT_REQUESTS = "urgentRequests";

/* -------------------- helpers -------------------- */

const uniq = (arr = []) => Array.from(new Set((arr || []).filter(Boolean)));

const norm = (s = "") =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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

const first = (o = {}, keys = []) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
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
    ...(Array.isArray(r.visionCanon) ? r.visionCanon : []),
  ])
    .map((t) => norm(t))
    .slice(0, 8);

const pickCategoryText = (r = {}) =>
  first(r, [
    "categoryKey",
    "category",
    "categoryType",
    "categoryName",
    "itemCategory",
    "requestCategory",
    "donationCategory",
    "itemType",
    "type",
    "itemName",
    "item",
    "name",
    "title",
  ]);

/* ---------- category single source of truth (match DonorDetail behavior) ---------- */

const normalizeCategory = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "food") return FOOD;
  if (s === "clothes" || s === "clothing" || s === "apparel") return CLOTHES;
  if (s === "essential" || s === "essentials") return ESSENTIAL;
  if (s === "others" || s === "other") return OTHERS;
  return "";
};

const mapCategory = (raw) => {
  const s = norm(raw);
  if (!s) return OTHERS;

  // Food
  if (/(rice|food|meal|noodle|noodles|milk|snack|water|canned|bread|vegetable|fruit|grocer|grocery)/.test(s))
    return FOOD;

  // Essential (before Clothes)
  if (/(essential|essentials|soap|shampoo|tooth|mask|sanit|diaper|pad|medicine|hygiene)/.test(s))
    return ESSENTIAL;

  // Clothes
  if (
    /(cloth|clothes|clothing|apparel|garment|uniform|jacket|shirt|t[-\s]?shirt|tee|jeans|pants|trousers|shorts|skirt|dress|hoodie|sweater|sock|socks|shoe|shoes|blanket|towel|cap|hat)/.test(
      s
    )
  )
    return CLOTHES;

  return OTHERS;
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

  return explicit || mapCategory(categoryTextFromRow(r));
};

const relTime = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const m = 60 * 1000;
  const h = 60 * m;
  const day = 24 * h;
  if (diff < h) return `${Math.max(1, Math.round(diff / m))}m ago`;
  if (diff < day) return `${Math.round(diff / h)}h ago`;
  return `${Math.round(diff / day)}d ago`;
};

const fmtDate = (ts, longOnly = false) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return "—";
  return longOnly
    ? d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
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
  if (!key || key === ALL) return "all recorded days";
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const formatList = (arr = []) => {
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
};

/* Status mapping */
const normalizeStatus = (s = "") => {
  const v = norm(s).trim();
  if (!v) return "";
  if (/(accepted|accept|approved|approve)/.test(v)) return "accepted";
  if (/(completed|complete|fulfilled|success|done|received)/.test(v)) return "completed";
  if (/(pending|processing|in[\s-]?progress|awaiting|waiting)/.test(v)) return "pending";
  if (/(declined|rejected|cancelled|canceled|failed)/.test(v)) return "declined";
  if (/(posted)/.test(v)) return "posted";
  return v.replace(/\s+/g, "-");
};

const isCompleted = (s = "") => normalizeStatus(s) === "completed";

const prettyStatus = (s = "") => {
  const n = normalizeStatus(s);
  const map = {
    completed: "Completed",
    pending: "Pending",
    declined: "Declined",
    accepted: "Accepted",
    posted: "Posted",
  };
  return (
    map[n] ||
    String(s || "—")
      .toLowerCase()
      .replace(/(^|[\s-])\w/g, (m) => m.toUpperCase())
  );
};

const displayStatusForRequest = (s = "") => {
  const n = normalizeStatus(s);
  if (!n || n === "pending") return "posted"; // ✅ treat empty/pending as posted
  return s;
};

const makeKey = (row) => String(row.requestId || row.donationId || row.id);

const chunk10 = (ids = []) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) out.push(ids.slice(i, i + 10));
  return out;
};

const cleanPostTitle = (t) => {
  const s = String(t || "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "others") return "";
  return s;
};

const pickQty = (r = {}) =>
  toNumber(
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

const pickCompletedQty = (r = {}) =>
  toNumber(
    first(r, [
      "completedQty",
      "fulfilledQty",
      "receivedQty",
      "receivedQuantity",
      "quantityReceived",
      "qtyReceived",
      "claimedQty",
      "deliveredQty",
      "fulfilled",
      "fulfilled_quantity",
      "completed_quantity",
    ])
  );

const getRequestedQtyValue = (r) => {
  const q = toNumber(r?.qty);
  return Number.isFinite(q) && q > 0 ? q : 0;
};

const getCompletedQty = (r = {}) => {
  const direct = toNumber(r.completedQty);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  const candidates = [
    "fulfilledQty",
    "receivedQty",
    "receivedQuantity",
    "quantityReceived",
    "qtyReceived",
    "claimedQty",
    "deliveredQty",
    "fulfilled",
    "fulfilled_quantity",
    "completed_quantity",
  ];

  for (const k of candidates) {
    const v = toNumber(r?.[k]);
    if (Number.isFinite(v) && v >= 0) return v;
  }

  if (normalizeStatus(r.status) === "completed") {
    const req = getRequestedQtyValue(r);
    return req > 0 ? req : 0;
  }

  return 0;
};

const pickDonorId = (r = {}) =>
  first(r, ["userId", "donorUserId", "donorId", "ownerUserId", "createdBy", "postedBy"]);

const pickEventTs = (r = {}) =>
  r.completedAt ||
  r.statusUpdatedAt ||
  r.updatedAt ||
  r.createdAt ||
  r.timestamp ||
  r.date ||
  null;

/* -------------------- main component -------------------- */

export default function OrganizationDetail() {
  const { uid } = useParams();
  const navigate = useNavigate();

  const [org, setOrg] = useState(null);

  const [postingMirror, setPostingMirror] = useState([]);
  const [postingFromRequest, setPostingFromRequest] = useState([]);
  const [directRows, setDirectRows] = useState([]);
  const [requestRows, setRequestRows] = useState([]);

  // request-linked urgent donations (drives View Donors + Daily Activity)
  const [requestDonationRows, setRequestDonationRows] = useState([]);

  const [donors, setDonors] = useState({});
  const donorsSeenRef = useRef(new Set());

  const [donationMeta, setDonationMeta] = useState({});
  const [reqMetaMap, setReqMetaMap] = useState({});

  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState(ALL);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [sortBy, setSortBy] = useState(NEWEST);

  const [selectedDateKey, setSelectedDateKey] = useState(ALL);

  const [lightbox, setLightbox] = useState({ open: false, images: [], index: 0 });
  const [detail, setDetail] = useState({ open: false, item: null });

  const reqUnsubsRef = useRef({});
  const [reqStatusMap, setReqStatusMap] = useState({});

  const [donorModal, setDonorModal] = useState({
    open: false,
    loading: false,
    item: null,
    groups: [], // [{ donorId, user, totalCompletedQty, donations: [] }]
    error: "",
  });
  const donorModalTokenRef = useRef(0);

  /* -------------------- lightbox handlers -------------------- */

  const openLightbox = useCallback((images = [], startIndex = 0) => {
    const arr = (images || []).filter(Boolean);
    if (!arr.length) return;
    const idx = Math.max(0, Math.min(startIndex, arr.length - 1));
    setLightbox({ open: true, images: arr, index: idx });
  }, []);

  const closeLightbox = useCallback(() => setLightbox({ open: false, images: [], index: 0 }), []);

  const prevImg = useCallback((e) => {
    e.stopPropagation();
    setLightbox((lb) => ({
      ...lb,
      index: (lb.index - 1 + lb.images.length) % lb.images.length,
    }));
  }, []);

  const nextImg = useCallback((e) => {
    e.stopPropagation();
    setLightbox((lb) => ({
      ...lb,
      index: (lb.index + 1) % lb.images.length,
    }));
  }, []);

  /* -------------------- org header -------------------- */

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, COL_USERS, uid)).then((s) => {
      if (s.exists()) setOrg({ id: uid, ...s.data() });
    });
  }, [uid]);

  /* -------------------- Fetch user docs (shared) -------------------- */

  const fetchUsersByIds = useCallback(async (ids = []) => {
    const uniqueIds = uniq(ids).filter(Boolean);
    const need = uniqueIds.filter((id) => !donorsSeenRef.current.has(id));
    if (!need.length) return {};

    const newUsers = {};
    for (const chunk of chunk10(need)) {
      const snap = await getDocs(
        query(collection(db, COL_USERS), where(documentId(), "in", chunk))
      );
      snap.forEach((d) => {
        newUsers[d.id] = { id: d.id, ...d.data() };
        donorsSeenRef.current.add(d.id);
      });
    }

    if (Object.keys(newUsers).length) {
      setDonors((prev) => ({ ...prev, ...newUsers }));
    }
    return newUsers;
  }, []);

  /* -------------------- subscribe to request docs -------------------- */

  const syncRequestSubscriptions = useCallback((currentRows) => {
    const nextIds = new Set(currentRows.map((p) => p.requestId).filter(Boolean));

    for (const [rid, off] of Object.entries(reqUnsubsRef.current)) {
      if (!nextIds.has(rid) && off) {
        off();
        delete reqUnsubsRef.current[rid];
      }
    }

    nextIds.forEach((rid) => {
      if (reqUnsubsRef.current[rid]) return;

      const off = onSnapshot(
        doc(db, COL_REQUESTS, rid),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          const status = data?.status ?? null;

          const userId =
            data?.userId || data?.requesterUserId || data?.ownerUserId || data?.createdBy || null;

          const locText =
            first(data || {}, ["address", "locationText", "location", "city", "barangay", "province"]) ||
            "";

          const reqQty = pickQty(data || {});
          const reqCompletedQty = pickCompletedQty(data || {});

          setReqStatusMap((m) => ({ ...m, [rid]: status }));
          setReqMetaMap((m) => ({
            ...m,
            [rid]: { userId, locationText: locText, qty: reqQty, completedQty: reqCompletedQty },
          }));
        },
        () => {
          setReqStatusMap((m) => ({ ...m, [rid]: null }));
          setReqMetaMap((m) => ({
            ...m,
            [rid]: { userId: null, locationText: "", qty: null, completedQty: null },
          }));
        }
      );

      reqUnsubsRef.current[rid] = off;
    });
  }, []);

  /* -------------------- Posting Requests (mirrors) -------------------- */

  useEffect(() => {
    if (!uid) return;
    const off = onSnapshot(
      query(collection(db, COL_ORG_POSTING_DONATIONS), where("orgId", "==", uid)),
      (snap) => {
        const arr = snap.docs.map((d) => {
          const r = d.data() || {};
          const images = pickImages(r);

          const itemTags = gatherTags(r);
          const categoryText = pickCategoryText(r);

          const row = {
            id: d.id,
            kind: POSTING,
            requestId: r.requestId || null,
            donationId: r.donationId || null,

            itemType: first(r, ["itemType", "itemName", "item"]) || "",
            itemName: first(r, ["itemName", "item"]) || "",

            title: first(r, ["title"]) || categoryText || "Requested Donation",
            category: categoryText || "",

            qty: pickQty(r),
            locationText: first(r, ["location", "address", "locationText"]) || "",
            images,
            thumb: images[0] || "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            status: r.status || "pending",
            description: r.description || "",
            itemTags,

            completedQty: pickCompletedQty(r),
          };

          row.categoryKey = getCategoryKey(row);
          return row;
        });

        setPostingMirror(arr);
        syncRequestSubscriptions(arr);
      }
    );

    return () => {
      off();
      Object.values(reqUnsubsRef.current).forEach((fn) => fn && fn());
      reqUnsubsRef.current = {};
    };
  }, [uid, syncRequestSubscriptions]);

  /* -------------------- request docs created by the org -------------------- */

  useEffect(() => {
    if (!uid) return;
    const unsubs = [];

    const collect = (snap) => {
      const arr = snap.docs.map((d) => {
        const r = d.data() || {};
        const images = pickImages(r);

        const itemTags = gatherTags(r);
        const categoryText = pickCategoryText(r);

        const row = {
          id: d.id,
          kind: POSTING,
          requestId: d.id,
          donationId: r.donationId || null,

          itemType: first(r, ["itemType", "itemName", "item"]) || "",
          itemName: first(r, ["itemName", "item"]) || "",

          title: first(r, ["title"]) || categoryText || "Requested Donation",
          category: categoryText || "",

          qty: pickQty(r),

          locationText: first(r, ["address", "locationText", "location"]) || "",
          images,
          thumb: images[0] || "",
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          status: r.status || "pending",
          description: r.description || "",
          itemTags,

          completedQty: pickCompletedQty(r),
        };

        row.categoryKey = getCategoryKey(row);
        return row;
      });

      setPostingFromRequest(arr);
      syncRequestSubscriptions(arr);
    };

    unsubs.push(
      onSnapshot(
        query(
          collection(db, COL_REQUESTS),
          where("type", "==", "request"),
          where("userId", "==", uid)
        ),
        collect
      )
    );

    unsubs.push(
      onSnapshot(
        query(
          collection(db, COL_REQUESTS),
          where("type", "==", "request"),
          where("orgId", "==", uid)
        ),
        collect
      )
    );

    return () => unsubs.forEach((u) => u && u());
  }, [uid, syncRequestSubscriptions]);

  /* -------------------- urgentDonations inbound to org (Direct + Request-linked donors) -------------------- */

  useEffect(() => {
    if (!uid) return;

    const un = onSnapshot(
      query(collection(db, COL_URGENT_DONATIONS), where("orgId", "==", uid)),
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

        // A) Direct donations (no requestId)
        const direct = all
          .filter((r) => !r.requestId)
          .map((r) => {
            const images = pickImages(r);
            const itemTags = gatherTags(r);
            const categoryText = pickCategoryText(r);

            const row = {
              id: r.id,
              kind: DIRECT,
              donationId: first(r, ["donationId"]) || r.id,
              userId: r.userId || r.donorUserId || null,

              itemType: first(r, ["itemType", "itemName", "item"]) || "",
              itemName: first(r, ["itemName", "item"]) || "",

              title: first(r, ["title", "itemName", "description"]) || categoryText || "Donation",
              category: categoryText || "",

              qty: pickQty(r),

              locationText: first(r, ["address", "locationText", "location"]) || "",
              images,
              thumb: images[0] || "",
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              status: r.status || "pending",
              description: r.description || "",
              itemTags,

              completedQty: pickCompletedQty(r),
            };

            row.categoryKey = getCategoryKey(row);
            return row;
          });

        // B) Request-linked donor donations (HAS requestId)
        const reqLinked = all
          .filter((r) => !!r.requestId)
          .map((r) => {
            const images = pickImages(r);
            const itemTags = gatherTags(r);
            const categoryText = pickCategoryText(r);

            const row = {
              id: r.id,
              kind: URGENT,
              requestId: r.requestId || null,
              donationId: first(r, ["donationId"]) || r.id,
              userId: pickDonorId(r) || null,

              itemType: first(r, ["itemType", "itemName", "item"]) || "",
              itemName: first(r, ["itemName", "item"]) || "",

              title:
                first(r, ["title", "itemName", "description"]) ||
                categoryText ||
                "Urgent Donation",
              category: categoryText || "",

              qty: pickQty(r),

              locationText: first(r, ["address", "locationText", "location"]) || "",
              images,
              thumb: images[0] || "",
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              status: r.status || "pending",
              description: r.description || "",
              itemTags,

              completedQty: pickCompletedQty(r),

              eventAt: pickEventTs(r),
            };

            row.categoryKey = getCategoryKey(row);
            return row;
          });

        setDirectRows(direct);
        setRequestDonationRows(reqLinked);
      }
    );

    return () => un();
  }, [uid]);

  /* -------------------- Org urgentRequests (as Request) -------------------- */

  useEffect(() => {
    if (!uid) return;
    const un = onSnapshot(
      query(
        collection(db, COL_URGENT_REQUESTS),
        where("orgId", "==", uid),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        const arr = snap.docs.map((d) => {
          const r = d.data() || {};
          const images = pickImages(r);

          const itemTags = gatherTags(r);
          const categoryText = pickCategoryText(r);

          const row = {
            id: d.id,
            kind: REQUEST,
            title: first(r, ["title"]) || categoryText || "Request",

            itemType: first(r, ["itemType", "itemName", "item"]) || "",
            itemName: first(r, ["itemName", "item"]) || "",

            category: categoryText || "",
            qty: pickQty(r),

            locationText: first(r, ["address", "locationText", "location"]) || "",
            images,
            thumb: images[0] || "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,

            status: displayStatusForRequest(r.status || ""),

            description: r.description || "",
            itemTags,
            requestId: d.id,

            completedQty: pickCompletedQty(r),
          };

          row.categoryKey = getCategoryKey(row);
          return row;
        });
        setRequestRows(arr);
      }
    );
    return () => un();
  }, [uid]);

  // ✅ If request is Essential but donor urgentDonation category is missing/weak, inherit request categoryKey
  useEffect(() => {
    if (!requestRows.length || !requestDonationRows.length) return;

    const reqCatById = new Map();
    requestRows.forEach((r) => {
      const rid = r.requestId || r.id;
      if (!rid) return;
      reqCatById.set(rid, {
        categoryKey: getCategoryKey(r),
        categoryText: String(r.category || "").trim() || String(r.title || "").trim() || "",
      });
    });

    setRequestDonationRows((prev) => {
      let changed = false;

      const next = prev.map((d) => {
        const rid = d.requestId;
        const reqInfo = rid ? reqCatById.get(rid) : null;
        if (!reqInfo) return d;

        const donationKey = getCategoryKey(d);
        const reqKey = reqInfo.categoryKey;

        if (donationKey === OTHERS && reqKey && reqKey !== OTHERS) {
          changed = true;
          return {
            ...d,
            category: String(d.category || "").trim() || reqInfo.categoryText,
            categoryKey: reqKey,
          };
        }

        if (!String(d.category || "").trim() && reqInfo.categoryText) {
          const patched = { ...d, category: reqInfo.categoryText };
          const patchedKey = getCategoryKey(patched);
          if (patchedKey !== getCategoryKey(d)) changed = true;
          return { ...patched, categoryKey: patchedKey };
        }

        return d;
      });

      return changed ? next : prev;
    });
  }, [requestRows, requestDonationRows]);

  /* -------------------- fetch donation meta (posters) -------------------- */

  useEffect(() => {
    const postingDonationIds = uniq(
      [...postingMirror, ...postingFromRequest].map((p) => p.donationId).filter(Boolean)
    );
    const need = postingDonationIds.filter((id) => !donationMeta[id]);
    if (!need.length) return;

    (async () => {
      for (const ch of chunk10(need)) {
        const snap = await getDocs(
          query(collection(db, COL_DONATIONS), where(documentId(), "in", ch))
        );
        const add = {};
        snap.forEach((d) => {
          const r = d.data() || {};
          const userId =
            r.userId || r.ownerUserId || r.donorUserId || r.postedBy || r.createdBy || null;
          const title = first(r, ["title", "itemName", "category", "description"]);
          add[d.id] = { userId, title };
        });
        setDonationMeta((prev) => ({ ...prev, ...add }));
      }
    })();
  }, [postingMirror, postingFromRequest, donationMeta]);

  /* -------------------- Fetch donor user docs -------------------- */

  useEffect(() => {
    const ids = uniq([
      ...directRows.map((r) => r.userId).filter(Boolean),
      ...requestDonationRows.map((r) => r.userId).filter(Boolean),
      ...Object.values(donationMeta).map((m) => m.userId).filter(Boolean),
      ...Object.values(reqMetaMap).map((m) => m.userId).filter(Boolean),
    ]);
    fetchUsersByIds(ids);
  }, [directRows, requestDonationRows, donationMeta, reqMetaMap, fetchUsersByIds]);

  /* -------------------- Combine & hydrate Posting rows -------------------- */

  useEffect(() => {
    const byKey = new Map();
    const put = (r) => byKey.set(makeKey(r), r);

    postingMirror.forEach(put);
    postingFromRequest.forEach(put);

    const postingCombined = Array.from(byKey.values()).map((row) => {
      if (row.kind !== POSTING || !row.requestId) return row;

      const rid = row.requestId;
      const reqStatus = reqStatusMap[rid];
      const meta = reqMetaMap[rid] || {};

      const patched = {
        ...row,
        status: reqStatus || row.status,
        qty: row.qty ?? meta.qty ?? null,
        completedQty: row.completedQty ?? meta.completedQty ?? null,
        locationText: row.locationText || meta.locationText || "",
      };

      patched.categoryKey = getCategoryKey(patched);
      return patched;
    });

    const merged = [...postingCombined, ...directRows, ...requestRows].map((r) => ({
      ...r,
      categoryKey: getCategoryKey(r),
    }));

    merged.sort((a, b) => {
      const ta = a.updatedAt || a.createdAt;
      const tb = b.updatedAt || b.createdAt;
      const aMs = ta?.toDate ? ta.toDate().getTime() : new Date(ta || 0).getTime();
      const bMs = tb?.toDate ? tb.toDate().getTime() : new Date(tb || 0).getTime();
      return bMs - aMs;
    });

    setRows(merged);
  }, [postingMirror, postingFromRequest, directRows, requestRows, reqStatusMap, reqMetaMap]);

  /* -------------------- filters/sort for list -------------------- */

  const filteredRows = useMemo(() => {
    let list = rows;

    if (catFilter !== ALL) list = list.filter((r) => getCategoryKey(r) === catFilter);
    if (kindFilter !== ALL) list = list.filter((r) => r.kind === kindFilter);

    const st = (search || "").trim();
    if (st) {
      const q = norm(st).trim();
      list = list.filter((r) => {
        const hay = [
          r.title,
          r.locationText,
          r.category,
          r.itemType,
          r.itemName,
          r.description,
          ...(r.itemTags || []),
        ]
          .filter(Boolean)
          .map(norm)
          .join(" ");
        return hay.includes(q);
      });
    }

    if (sortBy === OLDEST) {
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

  /* -------------------- ✅ status counts (TOP BOXES) -------------------- */
  const statusCounts = useMemo(() => {
    const base = { accepted: 0, pending: 0, completed: 0, declined: 0 };
    const seen = new Set();

    const bump = (rawStatus) => {
      const n = normalizeStatus(rawStatus);
      if (n === "accepted" || n === "pending" || n === "completed" || n === "declined") {
        base[n] += 1;
      }
    };

    const safeKey = (r, fallbackKind) => `${fallbackKind || r.kind || "x"}:${String(r.id || "")}`;

    // A) activity items (posting/direct) - exclude request posts
    rows.forEach((r) => {
      if (r.kind === REQUEST) return;
      const k = safeKey(r, r.kind);
      if (seen.has(k)) return;
      seen.add(k);
      bump(r.status);
    });

    // B) urgentDonations that are linked to requests (seen in View donors)
    requestDonationRows.forEach((r) => {
      const k = safeKey(r, URGENT);
      if (seen.has(k)) return;
      seen.add(k);
      bump(r.status);
    });

    return base;
  }, [rows, requestDonationRows]);

  /* -------------------- analytics date keys (include request-linked urgent donations) -------------------- */

  const availableDateKeys = useMemo(() => {
    const set = new Set();

    rows.forEach((r) => {
      const ts = r.updatedAt || r.createdAt;
      const key = dateKeyFromTs(ts);
      if (key) set.add(key);
    });

    requestDonationRows.forEach((r) => {
      const ts = r.eventAt || r.updatedAt || r.createdAt;
      const key = dateKeyFromTs(ts);
      if (key) set.add(key);
    });

    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows, requestDonationRows]);

  useEffect(() => {
    if (selectedDateKey !== ALL && !availableDateKeys.includes(selectedDateKey)) {
      setSelectedDateKey(ALL);
    }
  }, [availableDateKeys, selectedDateKey]);

  /* -------------------- completed rows for selected day -------------------- */

  const rowsForChart = useMemo(() => {
    const baseCompleted = rows.filter((r) => {
      if (r.kind === REQUEST) return false;
      if (!isCompleted(r.status)) return false;

      const ts = r.updatedAt || r.createdAt;
      if (selectedDateKey === ALL) return true;
      return dateKeyFromTs(ts) === selectedDateKey;
    });

    const urgentCompleted = requestDonationRows.filter((r) => {
      if (!isCompleted(r.status)) return false;
      const ts = r.eventAt || r.updatedAt || r.createdAt;
      if (selectedDateKey === ALL) return true;
      return dateKeyFromTs(ts) === selectedDateKey;
    });

    return [...baseCompleted, ...urgentCompleted];
  }, [rows, requestDonationRows, selectedDateKey]);

  /* -------------------- category counts (completed) -------------------- */

  const counts = useMemo(() => {
    const c = { [FOOD]: 0, [CLOTHES]: 0, [ESSENTIAL]: 0, [OTHERS]: 0 };
    rowsForChart.forEach((r) => {
      const k = getCategoryKey(r);
      const qty = getCompletedQty(r);
      c[k] = (c[k] || 0) + qty;
    });
    return c;
  }, [rowsForChart]);

  const graphCategories = [FOOD, CLOTHES, ESSENTIAL, OTHERS];
  const maxGraphValue = Math.max(...graphCategories.map((c) => counts[c] || 0), 0);

  const activityMatrix = useMemo(() => {
    const categories = [FOOD, CLOTHES, ESSENTIAL, OTHERS];
    const matrix = {};
    categories.forEach((cat) => {
      matrix[cat] = { [URGENT]: 0, [POSTING]: 0, [DIRECT]: 0, total: 0 };
    });

    rowsForChart.forEach((r) => {
      const cat = getCategoryKey(r);
      const qty = getCompletedQty(r);

      let col = null;
      if (r.kind === URGENT) col = URGENT;
      else if (r.kind === POSTING) col = POSTING;
      else if (r.kind === DIRECT) col = DIRECT;
      if (!col) return;

      matrix[cat][col] += qty;
      matrix[cat].total += qty;
    });

    return { categories, matrix };
  }, [rowsForChart]);

  const activityNarrative = useMemo(() => {
    const totalQty = rowsForChart.reduce((s, r) => s + getCompletedQty(r), 0);

    if (!totalQty) {
      return selectedDateKey === ALL
        ? "No completed activity recorded yet for this organization."
        : `No completed activity on ${prettyDateKey(selectedDateKey)} for this organization.`;
    }

    const periodText =
      selectedDateKey === ALL ? "across all recorded days" : `on ${prettyDateKey(selectedDateKey)}`;

    const kindCounts = rowsForChart.reduce((acc, r) => {
      const qty = getCompletedQty(r);
      const key =
        r.kind === URGENT ? URGENT : r.kind === POSTING ? POSTING : r.kind === DIRECT ? DIRECT : null;
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + qty;
      return acc;
    }, {});

    const nonZeroKinds = Object.entries(kindCounts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k.toLowerCase());

    const nonZeroCats = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);

    const pieces = [];
    if (nonZeroKinds.length) pieces.push(`mostly from ${formatList(nonZeroKinds)} activity`);
    if (nonZeroCats.length) pieces.push(`focused on ${formatList(nonZeroCats)}`);

    const tail = pieces.length ? ` — ${pieces.join(" and ")}.` : ".";
    return `Completed activity (${totalQty} item${totalQty === 1 ? "" : "s"}) ${periodText}${tail}`;
  }, [rowsForChart, selectedDateKey, counts]);

  const donorName = (u = {}) => u.fullName || u.displayName || "Individual";
  const donorAvatar = (u = {}) =>
    u.photoURL || u.profilePicture || u.imageUrl || u.avatarUrl || u.avatar || null;

  /* -------------------- Request View Donors modal logic -------------------- */

  const closeDonorModal = useCallback(() => {
    donorModalTokenRef.current += 1;
    setDonorModal({ open: false, loading: false, item: null, groups: [], error: "" });
  }, []);

  const openRequestDonors = useCallback(
    async (item) => {
      const rid = item.requestId || item.id;
      if (!rid) return;

      const token = (donorModalTokenRef.current += 1);
      setDonorModal({ open: true, loading: true, item, groups: [], error: "" });

      try {
        const donations = requestDonationRows.filter((d) => d.requestId === rid);
        const donorIds = uniq(donations.map((d) => d.userId).filter(Boolean));
        const newlyFetched = await fetchUsersByIds(donorIds);

        const groupsMap = new Map();
        donations.forEach((d) => {
          const did = d.userId;
          if (!did) return;

          const qty = pickQty(d) || 0;
          const status = d.status || "pending";

          const entry = groupsMap.get(did) || {
            donorId: did,
            totalCompletedQty: 0,
            donations: [],
          };

          if (isCompleted(status)) {
            entry.totalCompletedQty += Number.isFinite(toNumber(qty)) ? Number(qty) : 0;
          }

          entry.donations.push({
            id: d.id,
            title: d.title || "Donation",
            qty: Number.isFinite(toNumber(qty)) ? Number(qty) : 0,
            status,
            createdAt: pickEventTs(d),
          });

          groupsMap.set(did, entry);
        });

        const groups = Array.from(groupsMap.values())
          .map((g) => ({
            ...g,
            user: donors[g.donorId] || newlyFetched[g.donorId] || null,
            donations: g.donations.sort((a, b) => {
              const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
              const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
              return tb - ta;
            }),
          }))
          .sort((a, b) => (b.totalCompletedQty || 0) - (a.totalCompletedQty || 0));

        if (donorModalTokenRef.current !== token) return;
        setDonorModal({ open: true, loading: false, item, groups, error: "" });
      } catch (e) {
        if (donorModalTokenRef.current !== token) return;
        setDonorModal({
          open: true,
          loading: false,
          item,
          groups: [],
          error: String(e?.message || "Failed to load donors."),
        });
      }
    },
    [donors, fetchUsersByIds, requestDonationRows]
  );

  /* -------------------- render -------------------- */

  return (
    <div className="donors-wrap" style={{ background: "#fff" }}>
      <div className="donors-hero">
        <h1 className="hero-title">
          <i className="fi fi-rr-home" aria-hidden="true" />
          <span>{org?.orgName || org?.fullName || "Organization"}</span>
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
        {/* LEFT */}
        <div className="panel left">
          <div className="card donations-card">
            <div className="card-head">
              <div className="title">
                Activity <span className="count-pill">{filteredRows.length}</span>
              </div>

              <div className="filters">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title/location/tags…"
                />

                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ minWidth: 150 }}>
                  <option value={ALL}>All Category</option>
                  <option value={FOOD}>Food</option>
                  <option value={CLOTHES}>Clothes</option>
                  <option value={ESSENTIAL}>Essential</option>
                  <option value={OTHERS}>Others</option>
                </select>

                <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ minWidth: 150 }}>
                  <option value={ALL}>All Donation</option>
                  <option value={POSTING}>Posting</option>
                  <option value={DIRECT}>Direct</option>
                  <option value={REQUEST}>Urgent Request</option>
                </select>

                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ minWidth: 130 }}>
                  <option value={NEWEST}>Newest</option>
                  <option value={OLDEST}>Oldest</option>
                </select>
              </div>
            </div>

            <div className="donations-scroll">
              <div className="donor-detail-list" role="list">
                {filteredRows.map((it) => {
                  const cat = getCategoryKey(it);

                  const qNum = toNumber(it.qty);
                  const qty = Number.isFinite(qNum) ? qNum : "—";

                  const when = relTime(it.updatedAt || it.createdAt);
                  const imgs = Array.isArray(it.images)
                    ? it.images
                    : it.thumb
                    ? [it.thumb]
                    : [];
                  const st = normalizeStatus(it.status);

                  const receivedQty = it.kind === POSTING ? getCompletedQty(it) : null;

                  return (
                    <div
                      key={`${it.kind}-${it.id}`}
                      className="donor-detail-row"
                      role="listitem"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setDetail({ open: true, item: it });
                      }}
                      aria-label={`${it.title || "Item"} • ${it.kind} • ${cat}`}
                    >
                      <div className="thumb">
                        {imgs.length <= 1 ? (
                          it.thumb ? (
                            <img
                              className="donation-thumb"
                              src={it.thumb}
                              alt=""
                              loading="lazy"
                              width={104}
                              height={104}
                              role="button"
                              onClick={() => openLightbox(imgs, 0)}
                              title="Click to view"
                            />
                          ) : (
                            <div className="thumb-fallback" />
                          )
                        ) : (
                          <div className={`img-grid ${imgs.length === 2 ? "two" : "four"}`}>
                            {imgs.slice(0, 4).map((src, i) => {
                              const extra = imgs.length - 4;
                              const showOverlay = i === 3 && extra > 0;
                              return (
                                <button
                                  key={`${src}-${i}`}
                                  className="img-cell"
                                  onClick={() => openLightbox(imgs, i)}
                                  title="Click to view"
                                  type="button"
                                >
                                  <img src={src} alt="" loading="lazy" />
                                  {showOverlay && <span className="more-badge">+{extra}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="dinfo">
                        <div className="dheader">
                          <div className="dheader-main">
                            <div className="dtitle">{it.title}</div>

                            <div className="dpills">
                              <span className={`pill kind ${String(it.kind || "").toLowerCase()}`}>
                                {it.kind}
                              </span>

                              <span className="pill qty">
                                Qty <b>{qty}</b>
                              </span>

                              {it.kind === POSTING && (
                                <span className="pill qty" title="Quantity received by the organization">
                                  Received <b>{receivedQty}</b>
                                </span>
                              )}

                              <span className={`pill cat ${String(cat || "").toLowerCase()}`}>{cat}</span>
                            </div>
                          </div>

                          <div className="dheader-right">
                            {it.status && (
                              <span className={`status-badge ${st}`}>{prettyStatus(it.status)}</span>
                            )}

                            {it.kind === REQUEST && (
                              <button
                                className="btn btn-view"
                                style={{
                                  background: "#ffffff",
                                  color: "#000000",
                                  border: "1px solid #e5e7eb",
                                }}
                                onClick={() => openRequestDonors(it)}
                                title="See individuals who donated to this request"
                                type="button"
                              >
                                View donors
                              </button>
                            )}

                            <button className="btn btn-view" onClick={() => setDetail({ open: true, item: it })} type="button">
                              View details
                            </button>
                          </div>
                        </div>

                        <div className="meta">
                          {it.locationText && <span>📍 {it.locationText}</span>}
                          {when && <span>{when}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!rows.length && (
                  <div className="empty">{org ? "No activity for this organization yet." : "Loading organization…"}</div>
                )}

                {rows.length > 0 && filteredRows.length === 0 && (
                  <div className="empty">No results match your filters.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
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
              <div className="title">Daily Activity Footprint</div>
              <div className="filters footprint-filters">
                <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center" }}>
                  Day
                </label>
                <select
                  value={selectedDateKey}
                  onChange={(e) => setSelectedDateKey(e.target.value)}
                  style={{ minWidth: 150 }}
                >
                  <option value={ALL}>All days</option>
                  {availableDateKeys.map((k) => (
                    <option key={k} value={k}>
                      {prettyDateKey(k)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(() => {
              const totalQty = rowsForChart.reduce((s, r) => s + getCompletedQty(r), 0);
              return (
                <p className="card-desc" style={{ marginBottom: 4 }}>
                  Completed in selected range <strong>{totalQty}</strong> item{totalQty === 1 ? "" : "s"}.
                </p>
              );
            })()}

            <p className="card-desc" style={{ marginTop: -2 }}>
              {activityNarrative}
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
              <div className="footprint-graph empty-graph">No completed activity to display for this day.</div>
            )}

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
                  {activityMatrix.categories.map((cat) => {
                    const row = activityMatrix.matrix[cat] || { [URGENT]: 0, [POSTING]: 0, [DIRECT]: 0, total: 0 };
                    return (
                      <tr key={cat}>
                        <td style={{ textAlign: "left" }}>{cat}</td>
                        <td>{row[URGENT]}</td>
                        <td>{row[POSTING]}</td>
                        <td>{row[DIRECT]}</td>
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
                <button className="lightbox-nav lightbox-prev" onClick={prevImg} aria-label="Previous image" type="button">
                  ‹
                </button>
                <button className="lightbox-nav lightbox-next" onClick={nextImg} aria-label="Next image" type="button">
                  ›
                </button>
                <div className="lightbox-counter">
                  {lightbox.index + 1} / {lightbox.images.length}
                </div>
              </>
            )}

            <img className="lightbox-img" src={lightbox.images[lightbox.index]} alt="" />
            <button className="lightbox-close" onClick={closeLightbox} aria-label="Close" type="button">
              ×
            </button>
          </div>
        </div>
      )}

      {/* REQUEST DONORS MODAL */}
      {donorModal.open && (
        <div className="detail-overlay" onClick={closeDonorModal} aria-modal="true" role="dialog">
          <div className="detail-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="detail-close" onClick={closeDonorModal} aria-label="Close" type="button">
              ×
            </button>

            <h2 className="detail-title">Request Donors</h2>

            <div style={{ marginTop: 6, marginBottom: 12, color: "#475569", fontSize: 13 }}>
              <div>
                <b>Request</b> {donorModal.item?.title || "—"}
              </div>
              <div>
                <b>Requested Qty</b>{" "}
                {Number.isFinite(toNumber(donorModal.item?.qty)) ? toNumber(donorModal.item?.qty) : "—"}
              </div>
              <div>
                <b>Total Completed Qty (from donors)</b>{" "}
                <span style={{ fontWeight: 900 }}>
                  {donorModal.groups.reduce((s, g) => s + (g.totalCompletedQty || 0), 0)}
                </span>
              </div>
            </div>

            {donorModal.loading ? (
              <div className="empty">Loading donors…</div>
            ) : donorModal.error ? (
              <div className="empty">{donorModal.error}</div>
            ) : donorModal.groups.length === 0 ? (
              <div className="empty">No donors yet for this request.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {donorModal.groups.map((g) => {
                  const user = g.user || {};
                  const nm = donorName(user);
                  const av = donorAvatar(user);

                  return (
                    <div
                      key={g.donorId}
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
                            <img src={av} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ fontWeight: 900, fontSize: 12, color: "#1a2140" }}>
                              {(nm || "I").charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{nm}</div>
                          <div style={{ color: "#475569", fontSize: 12 }}>
                            Completed donated qty <b>{g.totalCompletedQty}</b> • Donations <b>{g.donations.length}</b>
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {g.donations.slice(0, 8).map((d) => {
                          const ns = normalizeStatus(d.status);
                          return (
                            <div
                              key={d.id}
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
                                <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>{d.title}</div>
                                <div style={{ fontSize: 12, color: "#64748b" }}>
                                  {d.createdAt ? fmtDate(d.createdAt, true) : "—"}
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: "#0f172a" }}>
                                  Qty <b>{d.qty}</b>
                                </span>
                                <span className={`status-badge ${ns}`}>{prettyStatus(d.status)}</span>
                              </div>
                            </div>
                          );
                        })}

                        {g.donations.length > 8 && (
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            +{g.donations.length - 8} more donation(s) not shown
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
            <button className="detail-close" onClick={() => setDetail({ open: false, item: null })} aria-label="Close" type="button">
              ×
            </button>

            <h2 className="detail-title">
              {detail.item.kind === REQUEST
                ? "Organization Request"
                : detail.item.kind === POSTING
                ? "Posting Request"
                : detail.item.kind === URGENT
                ? "Urgent Donation"
                : "Direct Donation"}
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
                  <span className="receipt-label">Item</span>{" "}
                  <span className="receipt-value">{detail.item.title || "—"}</span>
                </div>

                <div className="receipt-itemline">
                  <span className="receipt-label">Quantity (requested)</span>{" "}
                  <span className="receipt-value">
                    {Number.isFinite(toNumber(detail.item.qty)) ? toNumber(detail.item.qty) : "—"}
                  </span>
                </div>

                <div className="receipt-itemline">
                  <span className="receipt-label">Quantity (received)</span>{" "}
                  <span className="receipt-value">{getCompletedQty(detail.item)}</span>
                </div>

                <div className="receipt-itemline">
                  <span className="receipt-label">Category</span>{" "}
                  <span className="receipt-value">{getCategoryKey(detail.item)}</span>
                </div>

                <div className="receipt-datetime">
                  <div className="receipt-dt-label">Date</div>
                  <div className="receipt-dt">{fmtDate(detail.item.createdAt, true)}</div>
                </div>
              </div>

              <div className="receipt-side">
                <div className="receipt-status">
                  <div className="receipt-status-label">Status</div>
                  <div className={`receipt-status-badge ${normalizeStatus(detail.item.status)}`}>
                    {prettyStatus(detail.item.status)}
                  </div>
                </div>

                {detail.item.locationText && (
                  <div className="receipt-org">
                    <div className="receipt-org-label">Org Location</div>
                    <div className="receipt-org-badge alt">📍 {detail.item.locationText}</div>
                  </div>
                )}

                {detail.item.kind === POSTING && detail.item.donationId && (() => {
                  const t = cleanPostTitle(donationMeta?.[detail.item.donationId]?.title);
                  return t ? (
                    <div className="receipt-org">
                      <div className="receipt-org-label">Original Post</div>
                      <div className="receipt-org-badge alt">{t}</div>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
