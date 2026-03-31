// ─────────────────────────────────────────────────────────────────────────────
// FK FASHION v5.0 — Merged Best-of-Both
// Combines: Code 1 (complete UserProfile, LandingPage, full Settings/Customise)
//         + Code 2 (dynamic ImageKit configStore, secure auth token, Capacitor,
//                   ServiceSettings UI, safer date logic, applyServicesConfig)
// Bugs fixed: NativeAdminApp stub, missing ServiceSettings, IS_NATIVE undefined
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signInAnonymously,
  createUserWithEmailAndPassword, updateProfile,
  browserLocalPersistence, setPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, addDoc,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CAPACITOR PLATFORM DETECTION ────────────────────────────────────────────
let _isNative = false;

const IS_NATIVE_PROMISE = import("@capacitor/core")
  .then(mod => {
    const cap = mod?.Capacitor ?? mod?.default?.Capacitor ?? null;
    if (cap && cap.isNativePlatform()) _isNative = true;
  })
  .catch(() => {});

function getIsNative() { return _isNative; }

// ─── NATIVE PLUGIN SETUP ─────────────────────────────────────────────────────
async function setupNativePlugins() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#060610" });
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch (err) {}
}

// ─── LIGHTWEIGHT PUB/SUB STORE (Zustand-compatible, no npm needed) ────────────
function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  const getState = () => state;
  const setState = (updater) => {
    const next = typeof updater === "function" ? updater(state) : updater;
    if (next !== state) { state = { ...state, ...next }; listeners.forEach(fn => fn(state)); }
  };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  return { getState, setState, subscribe };
}

// ─── CONFIG STORE — ImageKit values, live-editable from admin UI via Firestore ─
// Default values are used until Firestore snapshot arrives.
// Admin can update these in Settings → Services and they sync immediately.
const configStore = createStore({
  imagekitPublicKey:   "public_AYglbaxTsZGRiapGe3SKLdy2Z6s=",
  imagekitUrlEndpoint: "https://ik.imagekit.io/jwpfdkm8y",
  imagekitFolder:      "/fk_fashion",
  imagekitUploadUrl:   "https://upload.imagekit.io/api/v1/files/upload",
});

const getCfgValue = (key) => configStore.getState()[key];

/** Called whenever we receive appConfig from Firestore or localStorage */
function applyServicesConfig(appConfig) {
  const svc = appConfig?.services;
  if (!svc) return;
  const update = {};
  if (svc.imagekitPublicKey)   update.imagekitPublicKey   = svc.imagekitPublicKey;
  if (svc.imagekitUrlEndpoint) update.imagekitUrlEndpoint = svc.imagekitUrlEndpoint;
  if (svc.imagekitFolder)      update.imagekitFolder      = svc.imagekitFolder;
  if (svc.imagekitUploadUrl)   update.imagekitUploadUrl   = svc.imagekitUploadUrl;
  if (Object.keys(update).length) configStore.setState(update);
}
/** Called whenever we receive settings from Firestore or localStorage */
function applyAppConfig(settings) {
  if (!settings) return;
  try {
    if (settings.appName   && typeof settings.appName   === "string" && settings.appName.trim())   APP_NAME    = settings.appName.trim();
    if (settings.appNameBn && typeof settings.appNameBn === "string" && settings.appNameBn.trim()) APP_NAME_BN = settings.appNameBn.trim();
  } catch(_) {}
}
// ─── APP-LEVEL DATA & IMAGE CACHE STORES ─────────────────────────────────────
const imageCache = createStore({ urlMap: {}, loading: {} });
function useImageCache() {
  const [cache, setCache] = useState(() => imageCache.getState());
  useEffect(() => imageCache.subscribe(setCache), []);
  return {
    cache: cache.urlMap,
    setImage:  (key, url) => imageCache.setState(s => ({ urlMap: { ...s.urlMap, [key]: url } })),
    isLoading: (key)      => !!cache.loading[key],
    setLoading:(key, v)   => imageCache.setState(s => ({ loading: { ...s.loading, [key]: v } })),
  };
}

const appDataStore = createStore({ data: null, initialized: false });
function useAppData() {
  const [store, setStore] = useState(() => appDataStore.getState());
  useEffect(() => appDataStore.subscribe(setStore), []);
  return {
    cachedData:    store.data,
    setCachedData: (data) => appDataStore.setState({ data, initialized: true }),
    isInitialized: store.initialized,
  };
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const ADMIN_EMAILS    = ["tusert15@gmail.com", "tusert10@gmail.com"];
let APP_NAME        = "FK FASHION";
let APP_NAME_BN     = "এফকে ফ্যাশন";
const ADMIN_WA_NUMBER = "01711000000";
const CATEGORIES      = ["Bridal","Necklace","Earring","Bracelet","Hairpiece","Anklet","Ring","Set","Other"];
const COLORS_PRESET   = ["Gold","Silver","Red","Pink","White","Green","Blue","Purple","Orange","Multi","Black"];
const ORDER_STATUSES  = ["Pending","Processing","Delivered","Cancelled"];
const EXPENSE_CATS    = ["Rent","Utilities","Transport","Packaging","Marketing","Food","Miscellaneous"];
const STOCK_STATUSES  = ["Ready","Making","Need Stock","Pre-Order"];
const getCfg = (data, key, fallback) => (data?.appConfig?.[key]?.length ? data.appConfig[key] : fallback);

const NAV_ADMIN = [
  {id:"dashboard", icon:"🏠", en:"Dashboard"},
  {id:"catalogue", icon:"🌸", en:"Products"},
  {id:"orders",    icon:"📦", en:"Orders"},
  {id:"customers", icon:"👩", en:"Customers"},
  {id:"money",     icon:"💰", en:"Money"},
  {id:"materials", icon:"🧵", en:"Stock"},
  {id:"workers",   icon:"👷", en:"Workers"},
  {id:"reports",   icon:"📊", en:"Reports"},
  {id:"customise", icon:"🎛️", en:"Customise"},
];

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDntPSHR3OyLNOWcAyR6F2PiHIIw7CdsGM",
  authDomain:        "fk-fshion.firebaseapp.com",
  projectId:         "fk-fshion",
  messagingSenderId: "548203936237",
  appId:             "1:548203936237:web:76cf5d39689e834c9f0fe4",
};

let _app, _auth, _db;
function getFirebase() {
  if (!_app) {
    _app  = initializeApp(FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _db   = getFirestore(_app);
    enableIndexedDbPersistence(_db).catch(() => {});
    setPersistence(_auth, browserLocalPersistence).catch(() => {});
  }
  return { auth: _auth, db: _db };
}

// ─── IMAGE HELPERS ────────────────────────────────────────────────────────────
function dataURItoBlob(dataURI) {
  const [header, data] = dataURI.split(",");
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const array  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

/**
 * Upload to ImageKit via signed server endpoint.
 * Sends Firebase ID token in Authorization header (Code 2 security improvement).
 * Falls back to base64 if upload fails.
 */
async function uploadToImageKit(file, onProgress) {
  try {
    const compressed = await new Promise((resolve, reject) => {
      try {
        compressImage(file, r => {
          if (r) resolve(r);
          else   reject(new Error("compress failed — null result"));
        });
      } catch (syncErr) {
        reject(syncErr);
      }
    });

    // Attach Firebase ID token so /api/imagekit-auth can verify the caller
    const { auth } = getFirebase();
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    const authRes = await fetch("/api/imagekit-auth", {
      headers: idToken ? { "Authorization": `Bearer ${idToken}` } : {},
    });
    if (!authRes.ok) throw new Error("Auth endpoint failed: " + authRes.status);
    const { token, expire, signature } = await authRes.json();
    if (!token || !expire || !signature) throw new Error("Invalid auth response");

    // Read config values from live configStore (not hardcoded)
    const publicKey = getCfgValue("imagekitPublicKey");
    const folder    = getCfgValue("imagekitFolder");
    const uploadUrl = getCfgValue("imagekitUploadUrl");

    const blob    = dataURItoBlob(compressed);
    const ext     = file.name?.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpg","jpeg","png","webp","gif"].includes(ext) ? ext : "jpg";

    const formData = new FormData();
    const fileTs = Date.now();
    formData.append("file",      blob, `fk_${fileTs}.${safeExt}`);
    formData.append("publicKey", publicKey);
    formData.append("fileName",  `fk_${fileTs}_${Math.random().toString(36).slice(2)}.${safeExt}`);
    formData.append("folder",    folder);
    formData.append("token",     token);
    formData.append("expire",    String(expire));
    formData.append("signature", signature);

    const xhr = new XMLHttpRequest();
    return await new Promise((resolve, reject) => {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.url) resolve(res.url);
          else reject(new Error(res.message || "Upload failed"));
        } catch { reject(new Error("Parse error on ImageKit response")); }
      };
      xhr.onerror = () => reject(new Error("Network error uploading to ImageKit"));
      xhr.open("POST", uploadUrl);
      xhr.send(formData);
    });
  } catch(e) {
    console.error("ImageKit upload error:", e);
    return null; // Caller falls back to base64
  }
}

/** Build a CDN URL with transformation params */
function ikUrl(src, opts = {}) {
  if (!src || !src.startsWith("https://ik.imagekit.io")) return src;
  const params = [];
  if (opts.w) params.push(`w-${opts.w}`);
  if (opts.h) params.push(`h-${opts.h}`);
  if (opts.q) params.push(`q-${opts.q}`);
  if (opts.f) params.push(`f-${opts.f}`);
  if (!params.length) return src;
  const parts = src.split("/");
  const file  = parts.pop();
  return `${parts.join("/")}/tr:${params.join(",")}/${file}`;
}

// ─── PRODUCT HELPERS ──────────────────────────────────────────────────────────
function normalizeProduct(p) {
  if (p.colorVariants && p.colorVariants.length > 0) return p;
  return { ...p, colorVariants: [{ color: p.color || "Default", images: p.img ? [p.img] : [] }] };
}
function getProductThumb(product) {
  for (const v of (product.colorVariants || [])) {
    if (v.images?.[0]) return v.images[0];
  }
  return null;
}

// ─── INITIAL DATA ─────────────────────────────────────────────────────────────
const INIT_DATA = {
  products: [
    { id:1, name:"Bridal Tiara",    nameBn:"বউ টায়রা",    category:"Bridal",   price:850, stock:12, desc:"Premium bridal headpiece with intricate gold work. Perfect for weddings.", sku:"FKF-001", colorVariants:[{color:"Gold/Red",images:[]},{color:"Silver",images:[]}] },
    { id:2, name:"Flower Necklace", nameBn:"ফুলের মালা",  category:"Necklace", price:450, stock:4,  desc:"Elegant floral necklace for all occasions.", sku:"FKF-002", colorVariants:[{color:"White/Green",images:[]},{color:"Pink",images:[]}] },
    { id:3, name:"Ear Cuff Set",    nameBn:"কানের গহনা",  category:"Earring",  price:220, stock:35, desc:"Delicate pink ear cuffs. Modern and stylish.", sku:"FKF-003", colorVariants:[{color:"Pink",images:[]},{color:"Gold",images:[]}] },
  ],
  orders: [
    { id:1, customer:"Rina Begum",    phone:"01711-234567", product:"Bridal Tiara",    qty:2, price:1700, status:"Delivered", date:"2026-02-10", deliveryDate:"2026-02-14", place:"Dhaka",      paid:1700, note:"",                     discount:0, source:"admin" },
    { id:2, customer:"Sadia Islam",   phone:"01811-345678", product:"Flower Necklace", qty:5, price:2250, status:"Pending",   date:"2026-03-01", deliveryDate:"2026-03-10", place:"Chittagong", paid:1000, note:"Deliver before wedding", discount:0, source:"admin" },
    { id:3, customer:"Nadia Hossain", phone:"01911-555555", product:"Ear Cuff Set",    qty:3, price:660,  status:"Delivered", date:"2026-02-25", deliveryDate:"2026-02-28", place:"Sylhet",     paid:660,  note:"",                     discount:0, source:"admin" },
  ],
  money: [
    { id:1, type:"owe",        name:"Karim Suppliers", amount:5000, note:"Raw material payment", date:"2026-02-20", dueDate:"2026-03-20" },
    { id:2, type:"receivable", name:"Sadia Islam",     amount:1250, note:"Order balance",        date:"2026-03-01", dueDate:"2026-03-15" },
  ],
  materials: [
    { id:1, name:"Silk Flowers", nameBn:"সিল্ক ফুল", supplier:"Karwan Bazar", qty:500, unit:"pcs", cost:2500, date:"2026-02-15", minStock:100, history:[] },
    { id:2, name:"Wire & Pins",  nameBn:"তার ও পিন",  supplier:"Islampur",     qty:200, unit:"pcs", cost:800,  date:"2026-02-18", minStock:50,  history:[] },
  ],
  workers: [
    { id:1, name:"Fatema Khatun", phone:"01711-111111", role:"Maker",    salary:8000, joined:"2025-01-01", status:"Active", tasks:"Makes bridal sets",     nid:"", advance:0   },
    { id:2, name:"Roksana Akter", phone:"01811-222222", role:"Packager", salary:6000, joined:"2025-06-01", status:"Active", tasks:"Packs & labels orders", nid:"", advance:500 },
  ],
  expenses: [
    { id:1, category:"Rent",      amount:5000, note:"Shop rent March", date:"2026-03-01" },
    { id:2, category:"Utilities", amount:800,  note:"Electricity",     date:"2026-03-02" },
  ],
  monthlyTarget:     20000,
  archivedOrders:    [], archivedProducts:  [], archivedMaterials: [],
  archivedWorkers:   [], archivedExpenses:  [], archivedMoney:     [],
  appConfig: {
    categories:        ["Bridal","Necklace","Earring","Bracelet","Hairpiece","Anklet","Ring","Set","Other"],
    orderStatuses:     ["Pending","Processing","Delivered","Cancelled"],
    expenseCategories: ["Rent","Utilities","Transport","Packaging","Marketing","Food","Miscellaneous"],
    workerRoles:       ["Maker","Packager","Designer","Helper","Manager"],
    materialUnits:     ["pcs","kg","g","meter","bundle","packet","roll","liter"],
    adminEmails:       ["tusert15@gmail.com","tusert10@gmail.com"],
    waTemplate:        "🌸 *New Order — {shopName}*\n\n👤 Name: {name}\n📞 Phone: {phone}\n📍 Address: {address}\n\n🛍️ *Items Ordered:*\n{items}\n\n💰 *Total: ৳{total}*\n\n📝 Note: {note}\n\nPlease confirm this order. Thank you! 🌸",
    // Live-editable ImageKit config (synced to/from configStore)
    services: {
      imagekitPublicKey:   "public_AYglbaxTsZGRiapGe3SKLdy2Z6s=",
      imagekitUrlEndpoint: "https://ik.imagekit.io/jwpfdkm8y",
      imagekitFolder:      "/fk_fashion",
      imagekitUploadUrl:   "https://upload.imagekit.io/api/v1/files/upload",
    },
  },
  settings: { waNumber:"01711000000" },
};

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const STORAGE_KEY       = "fk_fashion_local_v7";
const IMG_KEY           = "fk_fashion_imgs_v7";
const OFFLINE_QUEUE_KEY = "fk_offline_queue_v1";

function getOfflineQueue()      { try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]"); } catch(_) { return []; } }
function addToOfflineQueue(data) {
  try {
    const queue = getOfflineQueue();
    queue.push({ data, ts: Date.now() });
    // Keep only the last 50 to avoid exceeding localStorage quota
    const trimmed = queue.slice(-50);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(trimmed));
  } catch(_) {}
}
function clearOfflineQueue()    { try { localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch(_) {} }
async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (!queue.length) return false;
  const latest = queue[queue.length - 1];
  try {
    await saveToFirebase(latest.data, "offline-flush");
    clearOfflineQueue();
    return true;
  } catch(_) {
    return false;
  }
}

function saveImagesLocal(products) {
  try {
    const map = {};
    products.forEach(p =>
      (p.colorVariants || []).forEach((v, vi) =>
        (v.images || []).forEach((img, ii) => {
          if (img && img.startsWith("data:")) map[`${p.id}_v${vi}_i${ii}`] = img;
        })
      )
    );
    localStorage.setItem(IMG_KEY, JSON.stringify(map));
  } catch(_) {}
}
function loadImagesLocal() {
  try { const s = localStorage.getItem(IMG_KEY); return s ? JSON.parse(s) : {}; } catch(_) { return {}; }
}

function mergeImagesIntoProducts(products, imgMap) {
  return products.map(p => {
    const np = normalizeProduct(p);
    const variants = (np.colorVariants || []).map((v, vi) => {
      const inlineImgs = (v.images || []).filter(img => img && img.startsWith("https://"));
      if (inlineImgs.length > 0) return { ...v, images: inlineImgs };
      const imgs = [];
      for (let ii = 0; ii < 6; ii++) { const img = imgMap[`${p.id}_v${vi}_i${ii}`]; if (img) imgs.push(img); }
      if (!imgs.length) { const legacy = imgMap[`legacy_${p.id}`]; if (legacy) imgs.push(legacy); }
      return { ...v, images: imgs };
    });
    return { ...np, colorVariants: variants };
  });
}

function _buildMergedData(d, base = INIT_DATA) {
  return {
    ...base, ...d,
    products:          mergeImagesIntoProducts(d.products || [], {}),
    orders:            d.orders            || [],
    archivedOrders:    d.archivedOrders    || [],
    archivedProducts:  d.archivedProducts  || [],
    archivedMaterials: d.archivedMaterials || [],
    archivedWorkers:   d.archivedWorkers   || [],
    archivedExpenses:  d.archivedExpenses  || [],
    archivedMoney:     d.archivedMoney     || [],
    money:             d.money             || [],
    materials:         d.materials         || [],
    workers:           d.workers           || [],
    expenses:          d.expenses          || [],
    settings:          d.settings          || base.settings,
    appConfig:         d.appConfig         || base.appConfig,
  };
}

function saveLocal(data) {
  try {
    saveImagesLocal(data.products);
    // Keep CDN (https://) URLs in the slim save — only strip base64
    const slim = {
      ...data,
      products: data.products.map(p => ({
        ...p,
        colorVariants: (p.colorVariants||[]).map(v => ({
          ...v,
          images: (v.images||[]).filter(img => img && img.startsWith("https://"))
        }))
      }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch(_) {}
}

function loadLocal() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const d = JSON.parse(s);
      if (d.appConfig) applyServicesConfig(d.appConfig);
      if (d.settings)  applyAppConfig(d.settings);
      const products = mergeImagesIntoProducts(d.products || [], loadImagesLocal());
      return _buildMergedData({ ...d, products });
    }
  } catch(_) {}
  return { ...INIT_DATA };
}

// ─── FIREBASE CRUD ────────────────────────────────────────────────────────────
async function saveToFirebase(data, writerId) {
  try {
    const { db } = getFirebase();
    const slim = {
      ...data,
      _lastWriterId: writerId || "unknown",
      _lastWriteTime: Date.now(),
      products: data.products.map(p => ({
        ...p,
        colorVariants: (p.colorVariants||[]).map(v => ({
          ...v, images: (v.images||[]).filter(img => img && img.startsWith("https://"))
        }))
      }))
    };
    await setDoc(doc(db, "fk_fashion", "data"), slim);
  } catch(e) { console.error("Firebase save error:", e); }
}

async function loadFromFirebase() {
  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, "fk_fashion", "data"));
    if (snap.exists()) {
      const d = snap.data();
      applyServicesConfig(d.appConfig);
      applyAppConfig(d.settings);
      const products = mergeImagesIntoProducts(d.products || [], loadImagesLocal());
      return _buildMergedData({ ...d, products });
    }
  } catch(e) { console.error("Firebase load:", e); }
  return null;
}

const _publicOrderTimestamps = [];
const PUBLIC_ORDER_LIMIT     = 3;   // max orders
const PUBLIC_ORDER_WINDOW_MS = 60 * 60 * 1000; // per hour

async function placePublicOrder(order) {
  // Client-side rate limit (stops accidental double-submits & casual abuse)
  const now = Date.now();
  const windowStart = now - PUBLIC_ORDER_WINDOW_MS;
  // Remove timestamps outside the window
  while (_publicOrderTimestamps.length && _publicOrderTimestamps[0] < windowStart) {
    _publicOrderTimestamps.shift();
  }
  if (_publicOrderTimestamps.length >= PUBLIC_ORDER_LIMIT) {
    console.warn("placePublicOrder: rate limit reached");
    return false;
  }
  _publicOrderTimestamps.push(now);

  // Basic field validation before writing to Firestore
  const customer = (order.customer || "").trim();
  const phone    = (order.phone    || "").trim();
  const place    = (order.place    || "").trim();
  if (!customer || !phone || !place) {
    console.error("placePublicOrder: missing required fields");
    return false;
  }
  if (!Array.isArray(order.items) || !order.items.length) {
    console.error("placePublicOrder: no items");
    return false;
  }

  try {
    const { db } = getFirebase();
    await addDoc(collection(db, "fk_public_orders"), {
      customer,
      phone,
      place,
      note:        (order.note || "").slice(0, 500),  // cap note length
      items:       order.items.slice(0, 20),           // cap items
      totalAmount: Math.max(0, +order.totalAmount || 0),
      status:      "Pending",
      date:        order.date || new Date().toISOString().split("T")[0],
      source:      "store",
      userId:      order.userId  || null,
      userEmail:   order.userEmail || null,
      timestamp:   now,
    });
    return true;
  } catch(e) {
    console.error("placePublicOrder:", e);
    // rollback the rate-limit count on failure
    const idx = _publicOrderTimestamps.indexOf(now);
    if (idx !== -1) _publicOrderTimestamps.splice(idx, 1);
    return false;
  }
}

async function saveUserProfile(uid, data) {
  try { const { db } = getFirebase(); await setDoc(doc(db,"fk_users",uid), { ...data, updatedAt: Date.now() }, { merge:true }); } catch(_) {}
}
async function loadUserProfile(uid) {
  try { const { db } = getFirebase(); const s = await getDoc(doc(db,"fk_users",uid)); return s.exists() ? s.data() : null; } catch(_) { return null; }
}
async function getUserOrders(uid) {
  try { const { db } = getFirebase(); const s = await getDoc(doc(db,"fk_users",uid)); return s.exists() ? (s.data().orders||[]) : []; } catch(_) { return []; }
}
async function saveOrderToUserProfile(uid, order) {
  try {
    const profile = await loadUserProfile(uid);
    const orders  = [...(profile?.orders||[]), { ...order, savedAt: Date.now() }];
    await saveUserProfile(uid, { orders });
  } catch(_) {}
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else                { width  = Math.round(width  * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => callback(ev.target.result || null);
    img.src = ev.target.result;
  };
  reader.onerror = () => callback(null);
  reader.readAsDataURL(file);
}

function waLink(phone, msg) {
  const digits = (phone || "").replace(/\D/g, "");
  let intl;
  if      (digits.startsWith("880")) intl = digits;
  else if (digits.startsWith("88")  && digits.length >= 11)  intl = "880" + digits.slice(2);
  else if (digits.startsWith("0"))   intl = "880" + digits.slice(1);
  else                               intl = "880" + digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
}

function getTheme(dark) {
  return {
    dark,
    bg:          dark ? "bg-gray-950" : "bg-gradient-to-br from-pink-50 to-rose-50",
    card:        dark ? "bg-gray-800 border-gray-700" : "bg-white border-pink-100",
    text:        dark ? "text-gray-100" : "text-gray-800",
    sub:         dark ? "text-gray-400" : "text-gray-500",
    border:      dark ? "border-gray-700" : "border-gray-200",
    input:       dark ? "bg-gray-700 border-gray-600 text-gray-100" : "bg-white border-gray-300 text-gray-800",
    nav:         dark ? "bg-gray-900 border-gray-700" : "bg-white border-pink-100",
    modal:       dark ? "bg-gray-800 text-gray-100" : "bg-white",
    pill:        dark ? "bg-gray-700 text-gray-300 border-gray-600" : "bg-white text-gray-500 border-gray-200",
    pillActive:  "bg-pink-600 text-white border-pink-600",
    green:       dark ? "bg-green-900/40 text-green-300 border-green-800" : "bg-green-50 text-green-700 border-green-200",
    red:         dark ? "bg-red-900/40 text-red-300 border-red-800" : "bg-red-50 text-red-700 border-red-200",
    yellow:      dark ? "bg-yellow-900/40 text-yellow-300 border-yellow-800" : "bg-yellow-50 text-yellow-700 border-yellow-200",
    blue:        dark ? "bg-blue-900/40 text-blue-300 border-blue-800" : "bg-blue-50 text-blue-700 border-blue-200",
    statusColors: dark
      ? { Delivered:"bg-green-900 text-green-300", Pending:"bg-yellow-900 text-yellow-300", Processing:"bg-blue-900 text-blue-300", Cancelled:"bg-red-900 text-red-300" }
      : { Delivered:"bg-green-100 text-green-700",  Pending:"bg-yellow-100 text-yellow-700", Processing:"bg-blue-100 text-blue-700",  Cancelled:"bg-red-100 text-red-600"  },
  };
}

// ─── IMAGEKIT-AWARE UPLOAD COMPONENT ─────────────────────────────────────────
function IKImageUpload({ value, onChange, t }) {
  const ref = useRef();
  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode,     setMode]     = useState("idle");

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setMode("uploading"); setProgress(0);
    const pk    = getCfgValue("imagekitPublicKey");
    const useIK = pk && pk !== "your_public_key_here";
    if (useIK) {
      try {
        const url = await uploadToImageKit(file, setProgress);
        if (url) { setMode("done"); onChange(url); setLoading(false); return; }
      } catch(_) {}
    }
    compressImage(file, result => {
      setLoading(false); setMode(result ? "done" : "error");
      if (result) onChange(result);
    });
  };

  const isIK       = value && value.startsWith("https://ik.imagekit.io");
  const displaySrc = isIK ? ikUrl(value, { w:400, q:80 }) : value;
  const pk         = getCfgValue("imagekitPublicKey");

  return (
    <div
      className={`w-full h-40 relative rounded-xl border-2 border-dashed ${t.border} overflow-hidden cursor-pointer flex items-center justify-center hover:opacity-80 transition`}
      onClick={() => !loading && ref.current.click()}
    >
      {loading ? (
        <div className="text-center text-sm">
          <div className="text-3xl mb-2">⬆️</div>
          <div className={t.sub}>{mode === "uploading" ? `Uploading ${progress}%` : "Processing..."}</div>
          <div className="mt-2 w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-pink-500 rounded-full transition-all" style={{width:`${progress}%`}} />
          </div>
        </div>
      ) : value ? (
        <img src={displaySrc} className="w-full h-full object-cover" alt="" />
      ) : (
        <div className="text-center text-sm p-2">
          <div className="text-4xl mb-1">📷</div>
          <div>Tap to upload</div>
          <div className={`text-xs mt-1 ${t.sub}`}>
            {pk !== "your_public_key_here" ? "Via ImageKit CDN ☁️" : "Auto compressed"}
          </div>
        </div>
      )}
      <input
        ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      {value && !loading && <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">Change</div>}
      {isIK  && !loading && <div className="absolute top-2 left-2 bg-green-500/80 text-white text-xs px-1.5 py-0.5 rounded-full">☁️ CDN</div>}
    </div>
  );
}

// ─── COLOR VARIANT EDITOR ─────────────────────────────────────────────────────
function ColorVariantEditor({ variants, onChange, t }) {
  const addVariant    = ()      => onChange([...variants, { color:"", images:[] }]);
  const removeVariant = i       => onChange(variants.filter((_,idx) => idx !== i));
  const updateColor   = (i, c)  => onChange(variants.map((v,idx) => idx===i ? {...v,color:c} : v));
  const [uploading, setUploading] = useState({});
  const imgRef = useRef({});

  const addImage = async (vi, file) => {
    if (!file || uploading[vi]) return;
    setUploading(u => ({...u, [vi]:true}));
    try {
      const pk    = getCfgValue("imagekitPublicKey");
      const useIK = pk && pk !== "your_public_key_here";
      if (useIK) {
        const url = await uploadToImageKit(file, null);
        if (url) { onChange(variants.map((v,idx) => idx===vi ? {...v, images:[...v.images,url]} : v)); return; }
      }
      await new Promise(resolve => compressImage(file, result => {
        if (result) onChange(variants.map((v,idx) => idx===vi ? {...v, images:[...v.images,result]} : v));
        resolve();
      }));
    } catch(e) { console.error("addImage:", e); }
    finally { setUploading(u => ({...u, [vi]:false})); }
  };

  const removeImage = (vi, ii) =>
    onChange(variants.map((v,idx) => idx===vi ? {...v, images:v.images.filter((_,i2) => i2!==ii)} : v));

  return (
    <div>
      <div className={`flex items-center justify-between text-xs font-semibold ${t.sub} mb-2`}>
        <span>Color Variants & Photos</span>
        <button type="button" onClick={addVariant} className="text-pink-500 hover:text-pink-600 font-bold">+ Add Color</button>
      </div>

      {variants.map((v, vi) => (
        <div key={vi} className={`border ${t.border} rounded-xl p-3 mb-3`}>
          <div className="flex gap-2 items-center mb-2">
            <div className="flex flex-wrap gap-1 flex-1">
              {COLORS_PRESET.map(c => (
                <button key={c} type="button" onClick={() => updateColor(vi, c)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition ${v.color===c ? "bg-pink-600 text-white border-pink-600" : t.pill}`}>
                  {c}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => removeVariant(vi)} className="text-red-400 text-sm flex-shrink-0">✕</button>
          </div>
          <input
            value={v.color} onChange={e => updateColor(vi, e.target.value)}
            placeholder="Custom color name..."
            className={`w-full border rounded-lg px-3 py-1.5 text-xs mb-2 ${t.input}`}
            style={{fontSize:"14px"}}
          />
          <div className="flex gap-2 flex-wrap">
            {v.images.map((img, ii) => (
              <div key={ii} className="relative w-16 h-16 rounded-lg overflow-hidden border border-pink-100">
                <img src={img && img.startsWith("https://ik.imagekit.io") ? ikUrl(img,{w:120,q:80}) : img}
                  className="w-full h-full object-cover" alt="" />
                <button type="button" onClick={() => removeImage(vi, ii)}
                  className="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-bl-lg">✕</button>
                {img && img.startsWith("https://ik.imagekit.io") &&
                  <span className="absolute bottom-0 left-0 bg-green-500/80 text-white text-[8px] px-1">☁️</span>}
              </div>
            ))}
            {v.images.length < 6 && (
              <button type="button"
                onClick={() => !uploading[vi] && imgRef.current[vi]?.click()}
                disabled={!!uploading[vi]}
                className={`w-16 h-16 rounded-lg border-2 border-dashed ${t.border} flex flex-col items-center justify-center text-xs ${t.sub} hover:border-pink-400 transition`}
                style={{opacity: uploading[vi] ? 0.6 : 1, cursor: uploading[vi] ? "not-allowed" : "pointer"}}>
                {uploading[vi]
                  ? <span style={{fontSize:18, animation:"spin 1s linear infinite", display:"inline-block"}}>⏳</span>
                  : <span className="text-2xl">+</span>}
                {uploading[vi] && <span style={{fontSize:8, marginTop:2}}>Uploading</span>}
              </button>
            )}
            <input
              ref={el => imgRef.current[vi] = el} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files[0]; if (f) addImage(vi,f); e.target.value=""; }}
            />
          </div>
        </div>
      ))}

      {variants.length === 0 && (
        <button type="button" onClick={addVariant}
          className={`w-full py-6 rounded-xl border-2 border-dashed ${t.border} text-xs ${t.sub} hover:border-pink-400 transition`}>
          + Add a color variant with photos
        </button>
      )}
    </div>
  );
}

// ─── IMAGE GALLERY (store product detail) ────────────────────────────────────
function ImageGallery({ variants, selectedVariantIdx, onVariantChange }) {
  const [imgIdx,   setImgIdx]   = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [zoom,     setZoom]     = useState(1);

  const variant = variants[selectedVariantIdx] || variants[0] || { color:"", images:[] };
  const images  = variant.images || [];
  useEffect(() => { setImgIdx(0); }, [selectedVariantIdx]);

  const openLightbox = () => { setZoom(1); setLightbox(true); };
  const closeLightbox= () => { setLightbox(false); setZoom(1); };
  const prevImg = () => { setImgIdx(i => (i - 1 + images.length) % images.length); setZoom(1); };
  const nextImg = () => { setImgIdx(i => (i + 1) % images.length); setZoom(1); };

  return (
    <div>
      <div
        onClick={images[imgIdx] ? openLightbox : undefined}
        style={{width:"100%",borderRadius:16,overflow:"hidden",aspectRatio:"1/1",maxHeight:420,
          background:"#f3f4f6",cursor:images[imgIdx]?"zoom-in":"default",position:"relative"}}
      >
        {images[imgIdx] ? (
          <>
            <img src={images[imgIdx]} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} alt="" />
            <div style={{position:"absolute",bottom:8,right:8,background:"rgba(0,0,0,0.45)",borderRadius:6,
              padding:"3px 7px",fontSize:11,color:"#fff",fontWeight:600,pointerEvents:"none"}}>🔍 Tap to zoom</div>
          </>
        ) : (
          <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:72}}>🌸</div>
        )}
      </div>

      {images.length > 1 && (
        <div style={{display:"flex",gap:8,marginTop:8,overflowX:"auto",paddingBottom:4,WebkitOverflowScrolling:"touch"}}>
          {images.map((img, i) => (
            <button key={i} onClick={() => setImgIdx(i)}
              style={{flexShrink:0,width:56,height:56,borderRadius:10,overflow:"hidden",
                border:`2px solid ${i===imgIdx?"#f43f5e":"transparent"}`,padding:0,cursor:"pointer",background:"#f3f4f6"}}>
              <img src={img} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" />
            </button>
          ))}
        </div>
      )}

      {variants.length > 1 && (
        <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
          {variants.map((v, i) => (
            <button key={i} onClick={() => onVariantChange(i)}
              style={{fontSize:12,padding:"5px 14px",borderRadius:20,
                border:`1px solid ${i===selectedVariantIdx?"#f43f5e":"#d1d5db"}`,
                background:i===selectedVariantIdx?"#f43f5e":"transparent",
                color:i===selectedVariantIdx?"#fff":"#374151",fontWeight:600,cursor:"pointer"}}>
              {v.color}
            </button>
          ))}
        </div>
      )}

      {lightbox && images[imgIdx] && (
        <div onClick={closeLightbox}
          style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.96)",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          <button onClick={closeLightbox}
            style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.12)",
              border:"none",color:"#fff",fontSize:24,width:42,height:42,borderRadius:"50%",
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>×</button>
          <div style={{position:"absolute",top:20,left:"50%",transform:"translateX(-50%)",
            color:"rgba(255,255,255,0.5)",fontSize:12,fontWeight:600}}>{imgIdx+1} / {images.length}</div>
          <div style={{position:"absolute",bottom:24,left:"50%",transform:"translateX(-50%)",display:"flex",gap:12,zIndex:2}}>
            <button onClick={e=>{e.stopPropagation();setZoom(z=>Math.max(1,z-0.5));}}
              style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",fontSize:18,width:40,height:40,borderRadius:"50%",cursor:"pointer"}}>−</button>
            <button onClick={e=>{e.stopPropagation();setZoom(1);}}
              style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",fontSize:12,padding:"0 12px",height:40,borderRadius:20,cursor:"pointer",fontWeight:600}}>{Math.round(zoom*100)}%</button>
            <button onClick={e=>{e.stopPropagation();setZoom(z=>Math.min(4,z+0.5));}}
              style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",fontSize:18,width:40,height:40,borderRadius:"50%",cursor:"pointer"}}>+</button>
          </div>
          {images.length > 1 && <>
            <button onClick={e=>{e.stopPropagation();prevImg();}}
              style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,0.12)",
                border:"none",color:"#fff",fontSize:22,width:44,height:44,borderRadius:"50%",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
            <button onClick={e=>{e.stopPropagation();nextImg();}}
              style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,0.12)",
                border:"none",color:"#fff",fontSize:22,width:44,height:44,borderRadius:"50%",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
          </>}
          <img
            src={images[imgIdx]} onClick={e => e.stopPropagation()}
            style={{maxWidth:"100vw",maxHeight:"100vh",objectFit:"contain",
              transform:`scale(${zoom})`,transition:"transform 0.2s",
              cursor:zoom>1?"zoom-out":"zoom-in",userSelect:"none"}}
            alt=""
          />
        </div>
      )}
    </div>
  );
}

// ─── REPORT BUILDERS ──────────────────────────────────────────────────────────
const reportCSS = `
  .rpt{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:20px;max-width:900px;margin:0 auto;}
  .rpt-hdr{display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #fce7f3;}
  .rpt h2{font-size:14px;color:#be185d;margin:14px 0 6px;border-bottom:1px solid #fce7f3;padding-bottom:3px;}
  .rpt h3{font-size:12px;color:#555;margin:10px 0 5px;}
  .sg{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}
  .sg-c{background:#fdf2f8;border-radius:8px;padding:10px;text-align:center;}
  .sg-v{font-size:18px;font-weight:700;color:#be185d;}
  .sg-l{font-size:10px;color:#888;margin-top:2px;}
  .rpt table{width:100%;border-collapse:collapse;margin-bottom:14px;}
  .rpt th{background:#fdf2f8;color:#be185d;padding:5px 8px;text-align:left;font-size:11px;border:1px solid #fce7f3;}
  .rpt td{padding:5px 8px;border:1px solid #f3e4f5;font-size:11px;}
  .rpt tr:nth-child(even) td{background:#fafafa;}
  .bdg{display:inline-block;padding:2px 6px;border-radius:20px;font-size:10px;font-weight:600;}
  .Delivered{background:#dcfce7;color:#166534;}.Pending{background:#fef9c3;color:#854d0e;}.Processing{background:#dbeafe;color:#1e40af;}.Cancelled{background:#fee2e2;color:#991b1b;}
  .pbox{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin:10px 0;}
  .lbox{background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:12px;margin:10px 0;}
  .rcpt{max-width:400px;margin:0 auto;border:2px solid #fce7f3;border-radius:12px;padding:18px;}
  .rpt-ftr{margin-top:20px;padding-top:10px;border-top:1px solid #fce7f3;text-align:center;font-size:10px;color:#aaa;}
  @media print{body>*{display:none!important;}#fk-print-root{display:block!important;}#fk-print-root *{visibility:visible!important;}}
`;
function _sg(items) {
  return `<div class="sg">${items.map(i=>`<div class="sg-c"><div class="sg-v">${i.v}</div><div class="sg-l">${i.l}</div></div>`).join("")}</div>`;
}
function _tbl(headers, rows) {
  if (!rows.length) return `<p style="color:#aaa;font-size:11px">No data.</p>`;
  return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function buildOrdersReport(orders, title) {
  const rev = orders.reduce((a,o)=>a+(+o.paid||0),0);
  const due = orders.reduce((a,o)=>a+Math.max(0,(+o.price||0)-(+o.paid||0)),0);
  const rows = orders.map((o,i)=>[i+1,o.customer+(o._archived?` <span style="font-size:9px;color:#9ca3af">[archived]</span>`:""),o.phone||"",o.product||"",o.qty||"","৳"+(+o.price||0).toLocaleString(),"৳"+(+o.paid||0).toLocaleString(),"৳"+Math.max(0,(+o.price||0)-(+o.paid||0)).toLocaleString(),o.place||"",`<span class="bdg ${o.status||""}">${o.status||""}</span>`,o.date||""]);
  return {title,html:`<h2>📦 ${title}</h2>${_sg([{v:orders.length,l:"Orders"},{v:"৳"+rev.toLocaleString(),l:"Revenue"},{v:"৳"+due.toLocaleString(),l:"Due"},{v:orders.filter(o=>o.status==="Delivered").length,l:"Delivered"},{v:orders.filter(o=>o.status==="Pending").length,l:"Pending"},{v:orders.filter(o=>o.status==="Cancelled").length,l:"Cancelled"}])}${_tbl(["#","Customer","Phone","Product","Qty","Price","Paid","Due","Place","Status","Date"],rows)}`};
}
function buildMoneyReport(data) {
  const allOrders=[...(data.orders||[]),...(data.archivedOrders||[])];
  const owe=(data.money||[]).filter(m=>m.type==="owe");
  const recv=(data.money||[]).filter(m=>m.type==="receivable");
  const exp=(data.expenses||[]);
  const tO=owe.reduce((a,m)=>a+m.amount,0);
  const tR=recv.reduce((a,m)=>a+m.amount,0);
  const tE=exp.reduce((a,e)=>a+e.amount,0);
  const rev=allOrders.reduce((a,o)=>a+(+o.paid||0),0);
  const sal=(data.workers||[]).filter(w=>w.status==="Active").reduce((a,w)=>a+w.salary,0);
  const net=rev-sal-tE-tO;
  return {
    title:"Money Report",
    html:`<h2>💰 Money Report</h2>
      ${_sg([
        {v:"৳"+rev.toLocaleString(),         l:"Revenue"},
        {v:"৳"+tO.toLocaleString(),          l:"I Owe"},
        {v:"৳"+tR.toLocaleString(),          l:"Owed to Me"},
        {v:"৳"+sal.toLocaleString(),         l:"Salary"},
        {v:"৳"+tE.toLocaleString(),          l:"Expenses"},
        {v:(net>=0?"":"−")+"৳"+Math.abs(net).toLocaleString(), l:net>=0?"Net Profit":"Net Loss"}
      ])}
      <div class="${net>=0?"pbox":"lbox"}">
        <strong>${net>=0?"✅ Profit":"❌ Loss"}: ৳${Math.abs(net).toLocaleString()}</strong>
        <br/><small>Revenue ${rev.toLocaleString()} − Salary ${sal.toLocaleString()} − Expenses ${tE.toLocaleString()} − Debts ${tO.toLocaleString()}</small>
      </div>
      <h3>🔴 I Owe</h3>
      ${_tbl(
        ["Name","Amount","Note","Due Date"],
        owe.map(m=>[m.name,"৳"+m.amount.toLocaleString(),m.note||"—",m.dueDate||"—"])
      )}
      <h3>🟢 Owed to Me</h3>
      ${_tbl(
        ["Name","Amount","Note","Due Date"],
        recv.map(m=>[m.name,"৳"+m.amount.toLocaleString(),m.note||"—",m.dueDate||"—"])
      )}
      <h3>📋 Expenses</h3>
      ${_tbl(
        ["Category","Amount","Note","Date"],
        exp.map(e=>[e.category,"৳"+e.amount.toLocaleString(),e.note||"—",e.date||"—"])
      )}`
  };
}
function buildFullReport(data) {
  const orders=(data.orders||[]);
  const rev=orders.reduce((a,o)=>a+(+o.paid||0),0);
  const iO=(data.money||[]).filter(m=>m.type==="owe").reduce((a,m)=>a+m.amount,0);
  const sal=(data.workers||[]).filter(w=>w.status==="Active").reduce((a,w)=>a+w.salary,0);
  const mat=(data.materials||[]).reduce((a,m)=>a+m.cost,0);
  const exp=(data.expenses||[]).reduce((a,e)=>a+e.amount,0);
  const pr=rev-sal-mat-exp-iO;
  return {
    title:"Full Business Report",
    html:`<h2>📊 Full Business Summary</h2>
      ${_sg([
        {v:"৳"+rev.toLocaleString(),                             l:"Revenue"},
        {v:orders.length,                                        l:"Orders"},
        {v:(data.products||[]).length,                           l:"Products"},
        {v:"৳"+sal.toLocaleString(),                             l:"Salary"},
        {v:"৳"+iO.toLocaleString(),                              l:"Debts"},
        {v:(pr>=0?"":"−")+"৳"+Math.abs(pr).toLocaleString(),    l:pr>=0?"Net Profit":"Net Loss"}
      ])}
      <div class="${pr>=0?"pbox":"lbox"}">
        <strong>📈 Net ${pr>=0?"Profit":"Loss"}: ৳${Math.abs(pr).toLocaleString()}</strong>
        <br/><small>Revenue ${rev.toLocaleString()} − Salary ${sal.toLocaleString()} − Materials ${mat.toLocaleString()} − Expenses ${exp.toLocaleString()} − Debts ${iO.toLocaleString()}</small>
      </div>
      <h3>📦 Orders</h3>
      ${_tbl(
        ["Customer","Product","Price","Paid","Due","Status","Date"],
        orders.map(o=>[
          o.customer+(o._archived?" [arch]":""),
          o.product||"",
          "৳"+(+o.price||0).toLocaleString(),
          "৳"+(+o.paid||0).toLocaleString(),
          "৳"+Math.max(0,(+o.price||0)-(+o.paid||0)).toLocaleString(),
          `<span class="bdg ${o.status||""}">${o.status||""}</span>`,
          o.date||""
        ])
      )}
      <h3>🌸 Products</h3>
      ${_tbl(
        ["Product","Category","Price","Stock"],
        (data.products||[]).map(p=>[p.name,p.category,"৳"+p.price.toLocaleString(),p.stock])
      )}
      <h3>👷 Workers</h3>
      ${_tbl(
        ["Name","Role","Salary","Net"],
        (data.workers||[]).map(w=>[w.name,w.role,"৳"+w.salary.toLocaleString(),"৳"+(w.salary-(+w.advance||0)).toLocaleString()])
      )}`
  };
}
function buildCatalogue(products) {
  return {title:"Product Catalogue",html:`<h2>🌸 Product Catalogue</h2>${_sg([{v:products.length,l:"Products"},{v:"৳"+Math.round(products.reduce((a,p)=>a+p.price,0)/(products.length||1)).toLocaleString(),l:"Avg Price"},{v:products.reduce((a,p)=>a+p.stock,0),l:"Total Stock"}])}${_tbl(["SKU","Product","Category","Price","Stock","Colors"],products.map(p=>[p.sku,`<strong>${p.name}</strong><br/><small>${p.nameBn}</small>`,p.category,"৳"+p.price.toLocaleString(),p.stock+(p.stock<=5?" ⚠️":""),((p.colorVariants||[]).map(v=>v.color).join(", "))]))}`};
}
function buildWorkerReport(workers) {
  const active=workers.filter(w=>w.status==="Active"),tS=active.reduce((a,w)=>a+w.salary,0),tA=workers.reduce((a,w)=>a+(+w.advance||0),0);
  return {title:"Worker Report",html:`<h2>👷 Worker Report</h2>${_sg([{v:workers.length,l:"Total"},{v:active.length,l:"Active"},{v:"৳"+tS.toLocaleString(),l:"Payroll"},{v:"৳"+tA.toLocaleString(),l:"Advances"},{v:"৳"+(tS-tA).toLocaleString(),l:"Net Payable"}])}${_tbl(["Name","Phone","Role","Salary","Advance","Net","Status"],workers.map(w=>[w.name,w.phone,w.role,"৳"+w.salary.toLocaleString(),"৳"+(+w.advance||0).toLocaleString(),"৳"+(w.salary-(+w.advance||0)).toLocaleString(),w.status]))}`};
}
function buildMaterialsReport(materials) {
  return {title:"Materials Report",html:`<h2>🧵 Materials Report</h2>${_tbl(["Material","Supplier","Qty","Unit","Cost","Date"],materials.map(m=>[m.name,m.supplier,m.qty,m.unit,"৳"+m.cost.toLocaleString(),m.date]))}`};
}
function buildCustomerReport(orders) {
  const map={};
  orders.forEach(o=>{ const k=o.phone||o.customer; if(!map[k]) map[k]={name:o.customer,phone:o.phone||"",orders:0,spent:0,paid:0}; map[k].orders++; map[k].spent+=(+o.price||0); map[k].paid+=(+o.paid||0); });
  const cs=Object.values(map).sort((a,b)=>b.paid-a.paid);
  return {title:"Customer Report",html:`<h2>👩 Customer Report</h2>${_sg([{v:cs.length,l:"Customers"},{v:"৳"+cs.reduce((a,c)=>a+c.paid,0).toLocaleString(),l:"Revenue"},{v:"৳"+Math.round(cs.reduce((a,c)=>a+c.paid,0)/(cs.length||1)).toLocaleString(),l:"Avg/Customer"}])}${_tbl(["Customer","Phone","Orders","Total Spent","Paid","Due"],cs.map(c=>[c.name,c.phone,c.orders,"৳"+c.spent.toLocaleString(),"৳"+c.paid.toLocaleString(),"৳"+(c.spent-c.paid).toLocaleString()]))}`};
}
function buildReceipt(order) {
  const due=Math.max(0,(+order.price||0)-(+order.paid||0));
  const inv="FKF-"+String(order.id).padStart(4,"0");
  const items=order.items&&order.items.length>0?order.items:[{product:order.product,color:order.color||"",qty:order.qty,unitPrice:"",subtotal:order.price}];
  const itemRows=items.map(it=>`<tr><td style="padding:5px;font-size:12px;border:1px solid #f3e4f5">${it.product}${it.color?` (${it.color})`:""}</td><td style="padding:5px;text-align:center;font-size:12px;border:1px solid #f3e4f5">${it.qty}</td><td style="padding:5px;text-align:right;font-size:11px;color:#888;border:1px solid #f3e4f5">${it.unitPrice?"৳"+(+it.unitPrice).toLocaleString():""}</td><td style="padding:5px;text-align:right;font-size:12px;font-weight:700;border:1px solid #f3e4f5">৳${(+it.subtotal||0).toLocaleString()}</td></tr>`).join("");
  return {title:`Receipt — ${order.customer}`,html:`<div class="rcpt"><div style="text-align:center;margin-bottom:14px"><div style="font-size:26px">🌸</div><div style="font-size:18px;font-weight:800;letter-spacing:2px;color:#be185d">${APP_NAME}</div><div style="font-size:10px;color:#888">Invoice ${inv}</div></div><table style="width:100%;margin:10px 0;border-collapse:collapse">${itemRows}</table><div style="border-top:1px solid #fce7f3;padding-top:8px;font-size:12px"><div style="display:flex;justify-content:space-between"><span>Balance Due:</span><span style="color:${due>0?"#dc2626":"#16a34a"}">৳${due.toLocaleString()}</span></div></div>${order.note?`<div style="margin-top:8px;background:#fdf2f8;border-radius:6px;padding:7px;font-size:10px;color:#888">Note: ${order.note}</div>`:""}</div>`};
}
function buildWeeklyReport(data) {
  const allOrders=[...(data.orders||[]),...(data.archivedOrders||[])];
  const now=new Date(), wa=new Date(now-7*864e5);
  const isValidDate = d => d && !isNaN(new Date(d).getTime());
  const ir = d => { const dt=new Date(d); return dt>=wa && dt<=now; };
  const wo = allOrders.filter(o => {
    const d = o.date || o._archived;
    return isValidDate(d) && ir(d);
  });
  const we=(data.expenses||[]).filter(e=>ir(e.date));
  const rev=wo.reduce((a,o)=>a+(+o.paid||0),0),exp=we.reduce((a,e)=>a+e.amount,0);
  return {title:"Weekly Report",html:`<h2>📅 Weekly Report (Last 7 Days)</h2>${_sg([{v:wo.length,l:"Orders"},{v:"৳"+rev.toLocaleString(),l:"Revenue"},{v:"৳"+exp.toLocaleString(),l:"Expenses"},{v:wo.filter(o=>o.status==="Delivered").length,l:"Delivered"},{v:wo.filter(o=>o.status==="Pending").length,l:"Pending"},{v:"৳"+(rev-exp).toLocaleString(),l:"Est. Profit"}])}`};
}

// ─── REPORT VIEWER ────────────────────────────────────────────────────────────
function ReportViewer({ report, onClose }) {
  useEffect(() => {
    const h = e => { if (e.key==="Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const fullContent = `<div class="rpt-hdr"><div><div style="font-size:22px">🌸</div><div style="font-size:18px;font-weight:800;color:#be185d;letter-spacing:2px">${APP_NAME}</div><div style="font-size:10px;color:#888">${APP_NAME_BN}</div></div><div style="text-align:right;font-size:10px;color:#888"><strong>${report.title}</strong><br/>${new Date().toLocaleString()}</div></div>${report.html}<div class="rpt-ftr">${APP_NAME} · ${new Date().toLocaleDateString()}</div>`;

  const openPrintWindow = () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.title} — ${APP_NAME}</title><style>${reportCSS.replace(/@media print\{[^}]*\}/g,"")}\nbody{margin:0;padding:16px;background:#fff;}@media print{body{padding:0;}}</style></head><body><div class="rpt">${fullContent}</div><script>window.onload=function(){window.print();}<\/script></body></html>`;
    const blob = new Blob([html], {type:"text/html"});
    const url  = URL.createObjectURL(blob);
    const w    = window.open(url, "_blank", "width=900,height=700");
    if (!w) alert("Please allow popups to open the PDF print window.");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:9990,background:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{background:"#be185d",color:"#fff",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:8}}>
        <span style={{fontWeight:700,fontSize:13,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📄 {report.title}</span>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          <button onClick={openPrintWindow} style={{background:"#fff",color:"#be185d",border:"none",padding:"7px 14px",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer"}}>🖨️ Print / PDF</button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.25)",color:"#fff",border:"none",padding:"7px 12px",borderRadius:8,fontWeight:700,cursor:"pointer"}}>✕</button>
        </div>
      </div>
      <div style={{background:"#fdf2f8",borderBottom:"1px solid #fce7f3",padding:"7px 16px",fontSize:11,color:"#be185d",flexShrink:0}}>
        💡 Tap <strong>Print / PDF</strong> → choose <strong>Save as PDF</strong>
      </div>
      <div style={{flex:1,overflowY:"auto",background:"#fff"}}>
        <div className="rpt" dangerouslySetInnerHTML={{__html:`<style>${reportCSS}</style>${fullContent}`}} />
      </div>
    </div>
  );
}

// ─── SHARED UI PRIMITIVES ─────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide, t }) {
  useEffect(() => {
    const h = e => { if (e.key==="Escape") onClose(); };
    window.addEventListener("keydown", h);
    const wasLocked = document.body.classList.contains("adm-active") || document.body.style.overflow==="hidden";
    if (!wasLocked) document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); if (!wasLocked) document.body.style.overflow = ""; };
  }, [onClose]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const modalBg  = t.dark ? "#12121f" : "#ffffff";
  const closeBg  = t.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)";
  const closeCol = t.dark ? "#e8e6f8" : "#374151";

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.75)",display:"flex",
        alignItems:isMobile?"flex-end":"center",justifyContent:"center",padding:isMobile?"0":"20px"}}>
      <div style={{background:modalBg,borderRadius:isMobile?"20px 20px 0 0":"20px",width:"100%",
        maxWidth:wide?700:520,height:isMobile?"92dvh":"auto",maxHeight:isMobile?"92dvh":"90vh",
        display:"flex",flexDirection:"column",boxShadow:"0 -4px 40px rgba(0,0,0,0.5)",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 12px",
          borderBottom:`1px solid ${t.dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)"}`,flexShrink:0}}>
          <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",width:36,height:4,borderRadius:4,background:t.dark?"rgba(255,255,255,0.18)":"rgba(0,0,0,0.14)"}} />
          <h2 style={{fontSize:16,fontWeight:700,color:"#f43f5e",margin:0,paddingTop:6,lineHeight:1.3,flex:1,paddingRight:8}}>{title}</h2>
          <button onClick={onClose}
            style={{width:32,height:32,borderRadius:"50%",background:closeBg,border:"none",color:closeCol,
              fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",overscrollBehavior:"contain",padding:"16px 16px 32px"}}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Inp({ label, t, ...p }) {
  const bg  = t.dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const col = t.dark ? "#e8e6f8" : "#111827";
  const bdr = t.dark ? "rgba(255,255,255,0.12)" : "#d1d5db";
  return (
    <div className="mb-3">
      {label && <label style={{display:"block",fontSize:11,fontWeight:600,marginBottom:4,color:t.dark?"rgba(255,255,255,0.55)":"#4b5563"}}>{label}</label>}
      <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
        style={{fontSize:"16px",color:col,WebkitTextFillColor:col,background:bg,borderColor:bdr,borderWidth:1,borderStyle:"solid"}} {...p} />
    </div>
  );
}
function Sel({ label, t, children, ...p }) {
  const bg  = t.dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const col = t.dark ? "#e8e6f8" : "#111827";
  const bdr = t.dark ? "rgba(255,255,255,0.12)" : "#d1d5db";
  return (
    <div className="mb-3">
      {label && <label style={{display:"block",fontSize:11,fontWeight:600,marginBottom:4,color:t.dark?"rgba(255,255,255,0.55)":"#4b5563"}}>{label}</label>}
      <select className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
        style={{fontSize:"16px",color:col,background:bg,borderColor:bdr,borderWidth:1,borderStyle:"solid",colorScheme:t.dark?"dark":"light"}} {...p}>{children}</select>
    </div>
  );
}
function Txtarea({ label, t, ...p }) {
  const bg  = t.dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const col = t.dark ? "#e8e6f8" : "#111827";
  const bdr = t.dark ? "rgba(255,255,255,0.12)" : "#d1d5db";
  return (
    <div className="mb-3">
      {label && <label style={{display:"block",fontSize:11,fontWeight:600,marginBottom:4,color:t.dark?"rgba(255,255,255,0.55)":"#4b5563"}}>{label}</label>}
      <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
        style={{fontSize:"16px",color:col,WebkitTextFillColor:col,background:bg,borderColor:bdr,borderWidth:1,borderStyle:"solid"}} rows={3} {...p} />
    </div>
  );
}
function Btn({ children, onClick, color="pink", sm, full, disabled }) {
  const c = {
    pink:"bg-pink-600 hover:bg-pink-700 text-white", green:"bg-green-600 hover:bg-green-700 text-white",
    red:"bg-red-500 hover:bg-red-600 text-white",     orange:"bg-orange-500 hover:bg-orange-600 text-white",
    gray:"bg-gray-100 hover:bg-gray-200 text-gray-700",
  };
  return (
    <button disabled={disabled} onClick={onClick}
      className={`${c[color]||c.pink} ${sm?"px-3 py-1 text-xs":"px-4 py-2 text-sm"} ${full?"w-full":""} rounded-xl font-semibold transition disabled:opacity-40 flex items-center justify-center gap-1`}>
      {children}
    </button>
  );
}
function Pills({ options, value, onChange, t }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-hide" style={{WebkitOverflowScrolling:"touch"}}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap font-semibold transition border flex-shrink-0 ${value===o ? t.pillActive : t.pill}`}>
          {o}
        </button>
      ))}
    </div>
  );
}
function SearchBar({ value, onChange, placeholder, t }) {
  const bg  = t.dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const col = t.dark ? "#e8e6f8" : "#111827";
  const bdr = t.dark ? "rgba(255,255,255,0.12)" : "#d1d5db";
  return (
    <div className="relative mb-3">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder||"Search..."}
        className="w-full border rounded-xl pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
        style={{fontSize:"16px",color:col,background:bg,borderColor:bdr,borderWidth:1,borderStyle:"solid"}} />
    </div>
  );
}
function Empty({ icon, text, t }) {
  return <div className={`text-center py-14 ${t.sub}`}><div className="text-5xl mb-3">{icon}</div><div className="text-sm">{text}</div></div>;
}
function Confirm({ msg, onConfirm, onCancel, t }) {
  return (
    <Modal title="Confirm?" onClose={onCancel} t={t}>
      <p className={`text-sm mb-4 ${t.text}`}>{msg}</p>
      <div className="flex gap-2"><Btn color="red" onClick={onConfirm}>Yes, Delete</Btn><Btn color="gray" onClick={onCancel}>Cancel</Btn></div>
    </Modal>
  );
}
function SecHdr({ icon, title, sub, onAdd, addLabel, t, extra }) {
  return (
    <div className="flex justify-between items-start mb-4">
      <div>
        <h2 className="text-xl font-bold text-pink-500">{icon} {title}</h2>
        {sub && <p className={`text-xs ${t.sub} mt-0.5`}>{sub}</p>}
      </div>
      <div className="flex gap-2 items-center flex-wrap justify-end">
        {extra}
        {onAdd && <Btn onClick={onAdd}>{addLabel||"+ Add"}</Btn>}
      </div>
    </div>
  );
}
function PBtn({ onClick }) {
  return <button onClick={onClick} className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-xl font-semibold transition">🖨️ Print</button>;
}
// ImgUp delegates to IKImageUpload
function ImgUp({ value, onChange, t }) { return <IKImageUpload value={value} onChange={onChange} t={t} />; }

// ─── CUSTOMER STORE CSS ───────────────────────────────────────────────────────
const STORE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=DM+Sans:wght@300;400;500;600&display=swap');
  html,body,#root{width:100%;margin:0;padding:0;background:#0a0a0a;overflow:auto!important;height:auto!important;}
  *{box-sizing:border-box;}
  :root{--rose:#e11d48;--rose-light:#fb7185;--gold:#d4a853;--cream:#fef9f0;--dark:#0a0a0a;--dark2:#141414;--dark3:#1e1e1e;--dark4:#2a2a2a;--text:#f5f0e8;--text2:#a89d8a;--border:rgba(255,255,255,0.08);}
  .fk-store *{font-family:'DM Sans',system-ui,sans-serif;}
  .fk-display{font-family:'Playfair Display',Georgia,serif!important;}
  .fk-card-hover{transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.3s ease;}
  .fk-card-hover:hover{transform:translateY(-6px);box-shadow:0 20px 60px rgba(225,29,72,0.25)!important;}
  .fk-btn-primary{background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;border:none;cursor:pointer;transition:all 0.2s;}
  .fk-btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px);}
  .fk-btn-outline{background:transparent;color:var(--rose-light);border:1.5px solid var(--rose);cursor:pointer;transition:all 0.2s;}
  .fk-btn-outline:hover{background:var(--rose);color:#fff;}
  .fk-input{background:var(--dark3);border:1.5px solid var(--border);color:var(--text);border-radius:12px;padding:14px 16px;font-size:16px;width:100%;outline:none;transition:border-color 0.2s;}
  .fk-input:focus{border-color:var(--rose);}
  .fk-input::placeholder{color:var(--text2);}
  @keyframes fk-fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fk-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}
  @keyframes fk-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  .fk-fade-up{animation:fk-fadeUp 0.4s ease-out both;}
  .fk-cat-chip{background:var(--dark3);color:var(--text2);border:1.5px solid var(--border);border-radius:30px;padding:7px 18px;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s;white-space:nowrap;}
  .fk-cat-chip.active,.fk-cat-chip:hover{background:var(--rose);color:#fff;border-color:var(--rose);}
  .fk-badge{font-size:9px;font-weight:700;border-radius:20px;padding:2px 7px;letter-spacing:0.5px;}
  .fk-scrollbar-hide::-webkit-scrollbar{display:none;}
  .fk-scrollbar-hide{scrollbar-width:none;}
  @media(max-width:380px){.fk-prod-grid{grid-template-columns:repeat(2,1fr)!important;}}
  @media(min-width:768px){.fk-prod-grid{grid-template-columns:repeat(3,1fr)!important;}}
  @media(min-width:1024px){.fk-prod-grid{grid-template-columns:repeat(4,1fr)!important;}.fk-store-wrap{max-width:1200px;margin:0 auto;}}
`;
(function() {
  const id = "fk-responsive";
  if (document.getElementById(id)) return;
  const s = document.createElement("style"); s.id = id; s.textContent = STORE_CSS;
  document.head.appendChild(s);
})();

// ─── ADMIN CSS ────────────────────────────────────────────────────────────────
const ADMIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
  :root{--adm-accent:#f43f5e;--adm-accent2:#e11d48;--adm-gold:#f59e0b;--adm-cyan:#06b6d4;--adm-emerald:#10b981;--adm-sidebar-w:72px;--adm-sidebar-w-lg:220px;--adm-radius:12px;--adm-topbar-h:56px;}
  html,body{margin:0;padding:0;overflow-x:hidden;}*,*::before,*::after{box-sizing:border-box;}
  @keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@keyframes shimmer{from{background-position:-200% 0}to{background-position:200% 0}}@keyframes gridMove{from{transform:translateY(0)}to{transform:translateY(40px)}}@keyframes neonPulse{0%,100%{box-shadow:0 0 6px rgba(244,63,94,0.4)}50%{box-shadow:0 0 14px rgba(244,63,94,0.7)}}
  .adm-wrap{display:flex;min-height:100dvh;width:100%;overflow-x:hidden;font-family:'Space Grotesk',system-ui,sans-serif;position:relative;}
  body.adm-active{overflow-x:hidden;}
  .adm-wrap::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(244,63,94,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(244,63,94,0.025) 1px,transparent 1px);background-size:44px 44px;}
  @media(min-width:768px){.adm-wrap::before{animation:gridMove 10s linear infinite;}}
  .adm-sidebar{position:fixed;left:0;top:0;height:100dvh;width:var(--adm-sidebar-w);z-index:50;display:none;flex-direction:column;overflow-y:auto;overflow-x:hidden;transition:width 0.28s cubic-bezier(.4,0,.2,1);border-right:1px solid rgba(255,255,255,0.06);flex-shrink:0;}
  .adm-sidebar::-webkit-scrollbar{display:none;}
  .adm-main{flex:1;min-width:0;min-height:100dvh;display:flex;flex-direction:column;position:relative;z-index:1;padding-top:90px;overscroll-behavior:none;}
  .adm-topbar{position:fixed;top:0;left:0;right:0;z-index:40;display:flex;flex-direction:column;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06);transform:translateZ(0);}
  .adm-bottomnav{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:50;height:60px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,0.07);padding-bottom:env(safe-area-inset-bottom,0px);transform:translateZ(0);will-change:transform;}
  .adm-bottomnav::-webkit-scrollbar{display:none;}
  .adm-bnav-btn{flex:0 0 60px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;padding:6px 2px 4px;gap:2px;transition:all 0.15s;}
  .adm-bnav-btn span.icon{font-size:18px;line-height:1;display:block;transition:all 0.15s;}
  .adm-bnav-btn span.label{font-size:8px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-family:'Rajdhani',sans-serif;white-space:nowrap;line-height:1;}
  .adm-bnav-btn.active span.icon{filter:drop-shadow(0 0 5px rgba(244,63,94,0.9));transform:translateY(-1px);}
  .adm-content{width:100%;padding:16px 14px 96px;box-sizing:border-box;overflow-x:hidden;}
  .adm-nav-btn{width:100%;display:flex;flex-direction:row;align-items:center;padding:10px 12px;border-radius:8px;border:none;cursor:pointer;background:transparent;transition:all 0.18s;text-align:left;position:relative;overflow:hidden;margin-bottom:2px;}
  .adm-nav-btn:hover{background:rgba(255,255,255,0.04);}
  .adm-nav-btn.active{background:linear-gradient(135deg,rgba(244,63,94,0.14),rgba(244,63,94,0.04));border:1px solid rgba(244,63,94,0.22);}
  .adm-nav-btn.active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:55%;border-radius:0 3px 3px 0;background:var(--adm-accent);box-shadow:0 0 10px rgba(244,63,94,0.7);}
  .adm-nav-lbl{display:none;font-size:13px;font-weight:500;margin-left:10px;white-space:nowrap;}
  .adm-nav-icon{font-size:18px;flex-shrink:0;width:28px;text-align:center;line-height:1;}
  .adm-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
  .adm-fade{animation:fadeIn 0.22s cubic-bezier(.4,0,.2,1);}
  .adm-slide{animation:slideUp 0.24s cubic-bezier(.4,0,.2,1) both;}
  .adm-shimmer{background:linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(255,255,255,0.07) 50%,rgba(255,255,255,0.03) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;}
  .adm-chip{display:inline-flex;align-items:center;font-size:9px;font-weight:700;border-radius:5px;padding:2px 7px;white-space:nowrap;letter-spacing:0.06em;text-transform:uppercase;font-family:'Rajdhani',sans-serif;}
  .adm-alert-pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;border:1px solid;transition:all 0.15s;font-family:'Rajdhani',sans-serif;letter-spacing:0.04em;text-transform:uppercase;}
  .adm-alert-pill:hover{transform:translateY(-1px);filter:brightness(1.1);}
  .adm-neon-btn{transition:all 0.2s;}
  .adm-neon-btn:hover{filter:brightness(1.12);box-shadow:0 0 22px rgba(244,63,94,0.5)!important;}
  .adm-neon-btn:active{transform:scale(0.97);}
  .adm-topbar-search{border-radius:9px;padding:8px 13px;font-size:14px;outline:none;width:100%;box-sizing:border-box;transition:border-color 0.2s,box-shadow 0.2s;font-family:'Space Grotesk',sans-serif;}
  .adm-topbar-search:focus{box-shadow:0 0 0 2px rgba(244,63,94,0.25)!important;}
  .scrollbar-hide::-webkit-scrollbar{display:none;}.scrollbar-hide{scrollbar-width:none;}
  .adm-dark input,.adm-dark select,.adm-dark textarea{font-size:16px!important;background:rgba(255,255,255,0.07)!important;color:#e8e6f8!important;border-color:rgba(255,255,255,0.12)!important;}
  .adm-dark select{color-scheme:dark;}.adm-dark select option{background:#1e293b!important;color:#e8e6f8!important;}
  .adm-dark input::placeholder,.adm-dark textarea::placeholder{color:rgba(255,255,255,0.25)!important;}
  .adm-dark input:focus,.adm-dark select:focus,.adm-dark textarea:focus{outline:none!important;box-shadow:0 0 0 2px rgba(244,63,94,0.25)!important;border-color:rgba(244,63,94,0.5)!important;}
  .adm-light input,.adm-light select,.adm-light textarea{font-size:16px!important;background:#ffffff!important;color:#111827!important;border-color:#d1d5db!important;}
  .adm-light input::placeholder,.adm-light textarea::placeholder{color:#9ca3af!important;}
  .adm-light input:focus,.adm-light select:focus,.adm-light textarea:focus{outline:none!important;box-shadow:0 0 0 2px rgba(244,63,94,0.2)!important;border-color:rgba(244,63,94,0.5)!important;}
  .adm-dark .bg-white,.adm-dark .bg-gray-50,.adm-dark .bg-gray-100{background-color:rgba(255,255,255,0.03)!important;}
  .adm-dark .text-gray-800,.adm-dark .text-gray-900,.adm-dark .text-gray-700{color:#e8e6f8!important;}
  .adm-dark .text-gray-400,.adm-dark .text-gray-500,.adm-dark .text-gray-600{color:rgba(255,255,255,0.45)!important;}
  .adm-dark .border-gray-200,.adm-dark .border-pink-100,.adm-dark .border-gray-300,.adm-dark .border-gray-700{border-color:rgba(255,255,255,0.07)!important;}
  .adm-light .bg-white{background-color:#ffffff!important;}.adm-light .text-gray-800,.adm-light .text-gray-900{color:#1f2937!important;}
  .adm-light .text-gray-500,.adm-light .text-gray-600{color:#6b7280!important;}.adm-light .border-gray-200,.adm-light .border-pink-100{border-color:#e5e7eb!important;}
  @media(min-width:640px){.adm-stat-grid{grid-template-columns:repeat(3,1fr);}.adm-content{padding:20px 20px 72px;}}
  @media(min-width:768px){.adm-sidebar{display:flex;}.adm-main{margin-left:var(--adm-sidebar-w);}.adm-topbar{left:var(--adm-sidebar-w);}.adm-bottomnav{display:none!important;}.adm-stat-grid{grid-template-columns:repeat(4,1fr);}.adm-content{padding:24px 28px 40px;}.adm-dark input,.adm-dark select,.adm-dark textarea{font-size:14px!important;}.adm-light input,.adm-light select,.adm-light textarea{font-size:14px!important;}.adm-wide{display:flex!important;}.adm-mob{display:none!important;}}
  @media(min-width:1024px){.adm-sidebar{width:var(--adm-sidebar-w-lg);align-items:flex-start;}.adm-main{margin-left:var(--adm-sidebar-w-lg);}.adm-topbar{left:var(--adm-sidebar-w-lg);}.adm-nav-lbl{display:inline;}.adm-nav-btn{padding:10px 16px;}.adm-content{padding:28px 36px 40px;}}
  @media(max-width:639px){.adm-tbl table{min-width:400px;font-size:12px;}}
`;
(function() {
  const id = "fk-admin-css";
  if (document.getElementById(id)) return;
  const el = document.createElement("style"); el.id = id; el.textContent = ADMIN_CSS;
  document.head.appendChild(el);
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 2: CUSTOMER STORE COMPONENTS
// CustomerStore · StoreProductDetail · StoreCart · StoreCheckout · StoreSuccess
// UserProfile · AccountTabContent · LandingPage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function CustomerStore({ products, onGoAdmin, waNumber, waTemplate }) {
  useEffect(() => {
    document.body.classList.remove("adm-active");
    document.body.style.overflow = "";
    document.body.style.height   = "";
  }, []);

  const adminWa  = waNumber || ADMIN_WA_NUMBER;
  const [page,            setPage]            = useState("home");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart,            setCart]            = useState([]);
  const [catFilter,       setCatFilter]       = useState("All");
  const [search,          setSearch]          = useState("");
  const [orderResult,     setOrderResult]     = useState(null);
  const [storeUser,       setStoreUser]       = useState(undefined);
  const [wishlist, setWishlist] = useState(() => { try { return JSON.parse(localStorage.getItem("fk_wishlist")||"[]"); } catch(_) { return []; } });

  const toggleWishlist = (id) => setWishlist(w => {
    const next = w.includes(id) ? w.filter(x=>x!==id) : [...w, id];
    try { localStorage.setItem("fk_wishlist", JSON.stringify(next)); } catch(_) {}
    return next;
  });

  useEffect(() => {
    try {
      const { auth } = getFirebase();
      const unsub = onAuthStateChanged(auth, u => setStoreUser(u ?? null));
      return () => unsub();
    } catch(_) { setStoreUser(null); }
  }, []);

  const loginStoreGoogle = async () => {
    try {
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt:"select_account" });
      const result = await signInWithPopup(auth, provider);
      await saveUserProfile(result.user.uid, { name:result.user.displayName, email:result.user.email, photo:result.user.photoURL });
    } catch(e) { console.error(e); }
  };
  const loginStoreEmail = async (email, password) => {
    const { auth } = getFirebase();
    await signInWithEmailAndPassword(auth, email, password);
  };
  const registerStoreEmail = async (email, password, name) => {
    const { auth } = getFirebase();
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName:name });
    await saveUserProfile(result.user.uid, { name, email, photo:null });
  };
  const logoutStore = async () => {
    try { const { auth } = getFirebase(); await signOut(auth); } catch(_) {}
  };

  const addToCart = (product, qty, colorIdx) => {
    const variant = product.colorVariants[colorIdx] || product.colorVariants[0];
    const key     = `${product.id}_${colorIdx}`;
    setCart(prev => {
      const existing = prev.find(i => i.key===key);
      if (existing) return prev.map(i => i.key===key ? {...i, qty:i.qty+qty} : i);
      return [...prev, { key, product, qty, colorIdx, variant }];
    });
  };

  const filteredProducts = products
    .filter(p => catFilter==="All" || p.category===catFilter)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.nameBn||"").includes(search));

  const cartTotal = cart.reduce((a, i) => a + i.product.price * i.qty, 0);
  const cartCount = cart.reduce((a, i) => a + i.qty, 0);

  // Route to sub-pages
  if (page==="product" && selectedProduct)
    return <StoreProductDetail product={selectedProduct} onBack={()=>setPage("home")} cart={cart}
      onAddToCart={(qty,ci)=>addToCart(selectedProduct,qty,ci)} onGoToCart={()=>setPage("cart")} cartCount={cartCount} />;
  if (page==="cart")
    return <StoreCart cart={cart} setCart={setCart} cartTotal={cartTotal} onBack={()=>setPage("home")} onCheckout={()=>setPage("checkout")} />;
  if (page==="checkout")
    return <StoreCheckout cart={cart} cartTotal={cartTotal} onBack={()=>setPage("cart")} adminWa={adminWa}
      waTemplate={waTemplate} storeUser={storeUser}
      onSuccess={result=>{setOrderResult(result);setCart([]);setPage("success");}} />;
  if (page==="success")
    return <StoreSuccess result={orderResult} onContinue={()=>{setPage("home");setOrderResult(null);}} />;
  if (page==="profile")
    return <UserProfile user={storeUser} onBack={()=>setPage("home")} onLogin={loginStoreGoogle}
      onLoginEmail={loginStoreEmail} onRegister={registerStoreEmail} onLogout={logoutStore}
      allProducts={products} contactWaNumber={adminWa} />;

  const userInitial = storeUser && !storeUser.isAnonymous ? (storeUser.displayName||storeUser.email||"U")[0].toUpperCase() : null;

  return (
    <div className="fk-store" style={{width:"100%",minHeight:"100dvh",background:"var(--dark)",color:"var(--text)",boxSizing:"border-box",paddingTop:60}}>
      {/* HEADER */}
      <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",position:"fixed",top:0,left:0,right:0,zIndex:30,width:"100%"}}>
        <div className="fk-store-wrap" style={{display:"flex",alignItems:"center",height:60,padding:"0 16px",gap:10}}>
          <button onClick={onGoAdmin} style={{fontSize:9,color:"#555",background:"none",border:"1px solid #222",borderRadius:6,cursor:"pointer",padding:"3px 7px",flexShrink:0,letterSpacing:1}}>⚙</button>
          <div style={{flex:1,textAlign:"center",minWidth:0}}>
            <div className="fk-display" style={{fontSize:18,fontWeight:700,color:"var(--text)",letterSpacing:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{APP_NAME}</div>
            <div style={{fontSize:7,color:"var(--text2)",letterSpacing:3,marginTop:1}}>HANDCRAFTED JEWELLERY</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {storeUser===undefined
              ? <div style={{width:32,height:32,borderRadius:"50%",background:"var(--dark3)",animation:"fk-shimmer 1.5s infinite"}} />
              : storeUser && !storeUser.isAnonymous
                ? <button onClick={()=>setPage("profile")} style={{width:32,height:32,borderRadius:"50%",overflow:"hidden",border:"2px solid var(--rose)",background:"var(--dark3)",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"var(--rose)"}}>
                    {storeUser.photoURL ? <img src={storeUser.photoURL} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /> : userInitial}
                  </button>
                : <button onClick={()=>setPage("profile")} style={{fontSize:11,color:"var(--text2)",background:"var(--dark3)",border:"1px solid var(--border)",borderRadius:20,padding:"5px 12px",cursor:"pointer",fontWeight:500,letterSpacing:0.5}}>Sign in</button>
            }
            <button onClick={()=>setPage("cart")} style={{position:"relative",background:"none",border:"none",cursor:"pointer",padding:"4px 2px",flexShrink:0}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
              </svg>
              {cartCount > 0 && <span style={{position:"absolute",top:-2,right:-4,background:"var(--rose)",color:"#fff",fontSize:9,fontWeight:800,borderRadius:"50%",width:17,height:17,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <div style={{position:"relative",overflow:"hidden",padding:"60px 20px 52px",textAlign:"center",borderBottom:"1px solid var(--border)"}}>
        <div style={{position:"absolute",top:-100,left:"50%",transform:"translateX(-50%)",width:500,height:400,background:"radial-gradient(ellipse,rgba(225,29,72,0.18) 0%,transparent 70%)",pointerEvents:"none"}} />
        <div className="fk-store-wrap" style={{position:"relative"}}>
          <div style={{fontSize:11,letterSpacing:5,color:"var(--gold)",marginBottom:14,fontWeight:600}}>HANDCRAFTED WITH LOVE</div>
          <h1 className="fk-display fk-fade-up" style={{fontSize:"clamp(32px,7vw,64px)",fontWeight:900,color:"var(--text)",lineHeight:1.05,margin:"0 0 14px",letterSpacing:-1}}>
            Wear Your<br/><span style={{color:"var(--rose)",fontStyle:"italic"}}>Story</span>
          </h1>
          <p style={{fontSize:15,color:"var(--text2)",maxWidth:400,margin:"0 auto 28px",lineHeight:1.7,fontWeight:300}}>
            Premium handmade jewellery for weddings,<br/>festivals & everyday elegance
          </p>
          <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            <button className="fk-btn-primary" onClick={()=>document.getElementById("store-products")?.scrollIntoView({behavior:"smooth"})}
              style={{padding:"13px 32px",borderRadius:30,fontSize:14,fontWeight:600,letterSpacing:0.5}}>
              Shop Collection →
            </button>
            {cartCount > 0 && (
              <button className="fk-btn-outline" onClick={()=>setPage("cart")}
                style={{padding:"13px 24px",borderRadius:30,fontSize:14,fontWeight:600}}>
                Bag ({cartCount}) · ৳{cartTotal.toLocaleString()}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CATEGORIES + SEARCH */}
      <div style={{background:"var(--dark2)",borderBottom:"1px solid var(--border)",position:"sticky",top:60,zIndex:20}}>
        <div className="fk-store-wrap" style={{padding:"12px 16px 0"}}>
          <div style={{position:"relative",marginBottom:10}}>
            <svg style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)"}} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jewellery..."
              className="fk-input" style={{paddingLeft:38,paddingTop:10,paddingBottom:10,fontSize:14,borderRadius:30,background:"var(--dark3)"}} />
          </div>
          <div className="fk-scrollbar-hide" style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:12,WebkitOverflowScrolling:"touch"}}>
            {["All",...[...new Set(products.map(p=>p.category).filter(Boolean))]].map(c=>(
              <button key={c} className={`fk-cat-chip${catFilter===c?" active":""}`} onClick={()=>setCatFilter(c)} style={{flexShrink:0}}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      {/* PRODUCT GRID */}
      <div id="store-products" style={{padding:"24px 12px 100px"}}>
        <div className="fk-store-wrap">
          {filteredProducts.length > 0 && (
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:16,letterSpacing:1}}>{filteredProducts.length} PRODUCTS</div>
          )}
          <div className="fk-prod-grid" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
            {filteredProducts.map((p, idx) => {
              const thumb = getProductThumb(p);
              return (
                <div key={p.id} className="fk-card-hover"
                  onClick={() => {
                    setSelectedProduct(p); setPage("product");
                    try { const rv=JSON.parse(localStorage.getItem("fk_rv")||"[]"); localStorage.setItem("fk_rv",JSON.stringify([p.id,...rv.filter(x=>x!==p.id)].slice(0,10))); } catch(_) {}
                  }}
                  style={{cursor:"pointer",background:"var(--dark2)",borderRadius:18,overflow:"hidden",border:"1px solid var(--border)",position:"relative",animation:`fk-fadeUp 0.4s ease-out ${idx*0.05}s both`}}>
                  <button onClick={e=>{e.stopPropagation();toggleWishlist(p.id);}}
                    style={{position:"absolute",top:10,right:10,zIndex:5,width:30,height:30,borderRadius:"50%",background:"rgba(10,10,10,0.7)",border:"1px solid var(--border)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,backdropFilter:"blur(8px)"}}>
                    {wishlist.includes(p.id) ? "❤️" : "🤍"}
                  </button>
                  {p.category && (
                    <div style={{position:"absolute",top:10,left:10,zIndex:5,fontSize:9,background:"rgba(10,10,10,0.8)",color:"var(--gold)",borderRadius:20,padding:"3px 8px",fontWeight:600,letterSpacing:0.5,backdropFilter:"blur(8px)"}}>
                      {p.category.toUpperCase()}
                    </div>
                  )}
                  <div style={{width:"100%",aspectRatio:"1/1",background:"var(--dark3)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {thumb
                      ? <img src={ikUrl(thumb,{w:400,q:80,f:"webp"})||thumb} style={{width:"100%",height:"100%",objectFit:"cover",transition:"transform 0.4s ease"}} alt={p.name} loading="lazy"
                          onMouseEnter={e=>e.target.style.transform="scale(1.05)"} onMouseLeave={e=>e.target.style.transform="scale(1)"} />
                      : <div style={{fontSize:48,opacity:0.3}}>💎</div>}
                  </div>
                  <div style={{padding:"12px 14px 14px"}}>
                    <div className="fk-display" style={{fontSize:14,fontWeight:600,color:"var(--text)",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                    <div style={{fontSize:10,color:"var(--text2)",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nameBn}</div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontSize:16,fontWeight:700,color:"var(--rose-light)"}}><span style={{fontSize:11,fontWeight:400}}>৳</span>{p.price.toLocaleString()}</span>
                      {p.stock > 0
                        ? <span className="fk-badge" style={{background:"rgba(22,163,74,0.15)",color:"#4ade80",border:"1px solid rgba(74,222,128,0.3)"}}>IN STOCK</span>
                        : <span className="fk-badge" style={{background:"rgba(220,38,38,0.15)",color:"#f87171",border:"1px solid rgba(248,113,113,0.3)"}}>SOLD OUT</span>}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(p.colorVariants||[]).slice(0,3).map((v,i)=>(
                        <span key={i} style={{fontSize:9,padding:"2px 7px",background:"rgba(212,168,83,0.1)",color:"var(--gold)",borderRadius:10,border:"1px solid rgba(212,168,83,0.2)",fontWeight:500}}>{v.color}</span>
                      ))}
                      {(p.colorVariants||[]).length > 3 && <span style={{fontSize:9,color:"var(--text2)"}}>+{(p.colorVariants||[]).length-3}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredProducts.length === 0 && (
            <div style={{textAlign:"center",padding:"80px 20px",color:"var(--text2)"}}>
              <div style={{fontSize:52,marginBottom:16,opacity:0.4}}>💎</div>
              <div style={{fontSize:16,fontWeight:600}}>No products found</div>
              <div style={{fontSize:13,marginTop:6}}>Try a different category or search term</div>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING CART */}
      {cartCount > 0 && (
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:40}}>
          <button className="fk-btn-primary" onClick={()=>setPage("cart")}
            style={{padding:"14px 28px",borderRadius:50,fontSize:14,fontWeight:600,boxShadow:"0 8px 40px rgba(225,29,72,0.5)",display:"flex",alignItems:"center",gap:12,whiteSpace:"nowrap",letterSpacing:0.3}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            View Bag · ৳{cartTotal.toLocaleString()}
            <span style={{background:"rgba(255,255,255,0.2)",borderRadius:20,padding:"2px 8px",fontSize:12}}>{cartCount}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function StoreProductDetail({ product, onBack, cart, onAddToCart, onGoToCart, cartCount }) {
  const [variantIdx, setVariantIdx] = useState(0);
  const [qty,        setQty]        = useState(1);
  const [addedMsg,   setAddedMsg]   = useState(null);
  const [isWide,     setIsWide]     = useState(() => { try { return window.matchMedia("(min-width:640px)").matches; } catch(_) { return false; } });

  useEffect(() => { window.scrollTo(0, 0); }, [product]);
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(min-width:640px)"); } catch(_) { return; }
    const h = e => setIsWide(e.matches);
    setIsWide(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change",h); else mq.addListener(h);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change",h); else mq.removeListener(h); };
  }, []);

  const variant    = product.colorVariants[variantIdx] || product.colorVariants[0] || { color:"", images:[] };
  const inStock    = product.stock > 0;
  const cartKey    = `${product.id}_${variantIdx}`;
  const inCartQty  = (cart.find(i=>i.key===cartKey)?.qty) || 0;
  const totalInCart= cart.reduce((a,i)=>a+i.qty, 0);

  const handleAdd = () => {
    onAddToCart(qty, variantIdx);
    setAddedMsg(`✓ ${qty}× ${variant.color} added!`);
    setQty(1);
    setTimeout(() => setAddedMsg(null), 2500);
  };

  return (
    <div className="fk-store" style={{width:"100%",minHeight:"100dvh",background:"var(--dark)",color:"var(--text)",paddingTop:60}}>
      <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",position:"fixed",top:0,left:0,right:0,zIndex:30}}>
        <div style={{display:"flex",alignItems:"center",height:60,padding:"0 16px",gap:10}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--rose-light)",fontWeight:600,padding:"4px 0",flexShrink:0,display:"flex",alignItems:"center",gap:5}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Back
          </button>
          <div className="fk-display" style={{flex:1,textAlign:"center",fontSize:14,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{product.name}</div>
          <button onClick={onGoToCart} style={{position:"relative",background:"none",border:"none",cursor:"pointer",padding:6,flexShrink:0}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            {totalInCart>0 && <span style={{position:"absolute",top:-2,right:-4,background:"var(--rose)",color:"#fff",fontSize:9,fontWeight:800,borderRadius:"50%",width:17,height:17,display:"flex",alignItems:"center",justifyContent:"center"}}>{totalInCart}</span>}
          </button>
        </div>
      </header>

      {addedMsg && (
        <div style={{background:"#16a34a",color:"#fff",textAlign:"center",padding:"10px 16px",fontSize:13,fontWeight:700,position:"sticky",top:60,zIndex:29,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          {addedMsg}
          <button onClick={onGoToCart} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:12,borderRadius:20,padding:"3px 10px"}}>View Bag →</button>
        </div>
      )}

      <div style={{width:"100%",padding:"0 0 100px"}}>
        <div style={{display:"grid",gridTemplateColumns:isWide?"1fr 1fr":"1fr",maxWidth:1100,margin:"0 auto"}}>
          <div style={{padding:"20px 16px 16px"}}>
            <ImageGallery variants={product.colorVariants} selectedVariantIdx={variantIdx} onVariantChange={setVariantIdx} />
          </div>
          <div style={{padding:isWide?"36px 32px 20px":"0 16px 16px"}}>
            <div style={{fontSize:10,letterSpacing:3,color:"var(--gold)",marginBottom:8,fontWeight:600}}>{product.category?.toUpperCase()}</div>
            <h1 className="fk-display" style={{fontSize:"clamp(22px,4vw,32px)",fontWeight:700,color:"var(--text)",margin:"0 0 4px",lineHeight:1.2}}>{product.name}</h1>
            <div style={{fontSize:13,color:"var(--text2)",marginBottom:12}}>{product.nameBn}</div>
            <div style={{fontSize:32,fontWeight:700,color:"var(--rose-light)",marginBottom:16}}>
              <span style={{fontSize:16,fontWeight:400,color:"var(--text2)",marginRight:2}}>৳</span>{product.price.toLocaleString()}
            </div>
            {product.desc && <p style={{fontSize:14,color:"var(--text2)",lineHeight:1.8,marginBottom:18,padding:"14px 16px",background:"var(--dark3)",borderRadius:12,borderLeft:"3px solid var(--rose)"}}>{product.desc}</p>}

            {/* Color selector */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--text2)",marginBottom:10,letterSpacing:2}}>SELECT COLOR</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {product.colorVariants.map((v,i) => {
                  const ck = `${product.id}_${i}`;
                  const inCart = (cart.find(x=>x.key===ck)?.qty) || 0;
                  const isSel  = i===variantIdx;
                  return (
                    <button key={i} onClick={()=>setVariantIdx(i)}
                      style={{padding:"9px 18px",borderRadius:30,position:"relative",
                        border:`1.5px solid ${isSel?"var(--rose)":"var(--border)"}`,
                        background:isSel?"var(--rose)":"var(--dark3)",
                        color:isSel?"#fff":"#374151",fontSize:13,fontWeight:700,cursor:"pointer",
                        transition:"all 0.15s",boxShadow:isSel?"0 2px 10px rgba(219,39,119,0.35)":"none"}}>
                      {v.color}
                      {inCart > 0 && (
                        <span style={{position:"absolute",top:-6,right:-6,background:"#16a34a",color:"#fff",fontSize:9,fontWeight:800,borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff"}}>{inCart}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div style={{marginTop:10,fontSize:13,color:"#db2777",fontWeight:600}}>
                Selected: <strong>{variant.color}</strong>
                {inCartQty > 0 && <span style={{marginLeft:8,color:"#16a34a"}}>({inCartQty} already in cart)</span>}
              </div>
            </div>

            {/* Quantity */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:10,letterSpacing:1}}>QUANTITY</div>
              <div style={{display:"flex",alignItems:"center",background:"#f9fafb",borderRadius:14,border:"2px solid #fce7f3",overflow:"hidden",width:"fit-content"}}>
                <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{width:48,height:48,border:"none",background:"transparent",fontSize:22,fontWeight:700,cursor:"pointer",color:"#db2777",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                <span style={{fontSize:20,fontWeight:800,minWidth:48,textAlign:"center",color:"#1f2937",background:"#fff",height:48,display:"flex",alignItems:"center",justifyContent:"center",borderLeft:"1px solid #fce7f3",borderRight:"1px solid #fce7f3"}}>{qty}</span>
                <button onClick={()=>setQty(q=>Math.min(product.stock||99,q+1))} style={{width:48,height:48,border:"none",background:"transparent",fontSize:22,fontWeight:700,cursor:"pointer",color:"#db2777",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
              </div>
              <div style={{fontSize:12,color:"#9ca3af",marginTop:6}}>{product.stock} in stock</div>
            </div>

            {/* Subtotal */}
            <div style={{background:"#fdf2f8",borderRadius:14,padding:"14px 18px",marginBottom:16,border:"1px solid #fce7f3"}}>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:4}}>{variant.color} × {qty} unit{qty>1?"s":""}</div>
              <div style={{fontSize:22,fontWeight:800,color:"#db2777"}}>৳{(product.price*qty).toLocaleString()}</div>
            </div>

            {/* Add button */}
            {inStock
              ? <button onClick={handleAdd} style={{width:"100%",background:"#db2777",color:"#fff",border:"none",padding:"16px",borderRadius:16,fontSize:16,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 16px rgba(219,39,119,0.3)",marginBottom:10}}>
                  🛍️ Add {variant.color} to Cart
                </button>
              : <div style={{width:"100%",background:"#f3f4f6",color:"#9ca3af",padding:"16px",borderRadius:16,fontSize:15,fontWeight:700,textAlign:"center",marginBottom:10}}>Out of Stock</div>
            }

            {totalInCart > 0 && (
              <button onClick={onGoToCart} style={{width:"100%",background:"#fff",color:"#db2777",border:"2px solid #db2777",padding:"13px",borderRadius:16,fontSize:15,fontWeight:700,cursor:"pointer"}}>
                View Cart ({totalInCart} item{totalInCart>1?"s":""}) →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreCart({ cart, setCart, cartTotal, onBack, onCheckout }) {
  const updateQty = (key, qty) => setCart(prev => qty<=0 ? prev.filter(i=>i.key!==key) : prev.map(i=>i.key===key?{...i,qty}:i));
  return (
    <div className="fk-store" style={{minHeight:"100dvh",background:"var(--dark)",color:"var(--text)"}}>
      <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",padding:"0 16px",position:"sticky",top:0,zIndex:30}}>
        <div style={{maxWidth:700,margin:"0 auto",display:"flex",alignItems:"center",height:60}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--rose-light)",fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Back
          </button>
          <div className="fk-display" style={{flex:1,textAlign:"center",fontSize:16,fontWeight:600,color:"var(--text)"}}>Shopping Bag</div>
          <div style={{fontSize:12,color:"var(--text2)"}}>{cart.length} item{cart.length!==1?"s":""}</div>
        </div>
      </header>
      <div style={{maxWidth:700,margin:"0 auto",padding:"20px 16px 120px"}}>
        {cart.length === 0 ? (
          <div style={{textAlign:"center",padding:"80px 20px",color:"var(--text2)"}}>
            <div style={{fontSize:52,opacity:0.3,marginBottom:20}}>🛍</div>
            <div style={{fontSize:18,fontWeight:600,marginBottom:8,color:"var(--text)"}}>Your bag is empty</div>
            <div style={{fontSize:13,marginBottom:24}}>Add some beautiful pieces to get started</div>
            <button className="fk-btn-primary" onClick={onBack} style={{padding:"12px 28px",borderRadius:30,fontSize:14,fontWeight:600}}>Continue Shopping</button>
          </div>
        ) : (
          <>
            {cart.map((item,idx) => (
              <div key={item.key} style={{display:"flex",gap:14,padding:"16px 0",borderBottom:"1px solid var(--border)",alignItems:"center",animation:`fk-fadeUp 0.3s ease-out ${idx*0.05}s both`}}>
                <div style={{width:80,height:80,borderRadius:14,overflow:"hidden",background:"var(--dark3)",flexShrink:0,border:"1px solid var(--border)"}}>
                  {getProductThumb(item.product)
                    ? <img src={getProductThumb(item.product)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" />
                    : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,opacity:0.3}}>💎</div>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="fk-display" style={{fontSize:14,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.product.name}</div>
                  <div style={{fontSize:11,color:"var(--gold)",marginTop:2,marginBottom:6}}>{item.variant.color}</div>
                  <div style={{fontSize:15,fontWeight:700,color:"var(--rose-light)"}}>৳{(item.product.price*item.qty).toLocaleString()}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                  <button onClick={()=>updateQty(item.key,item.qty-1)} style={{width:32,height:32,borderRadius:"50%",border:"1px solid var(--border)",background:"var(--dark3)",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text)",fontSize:16}}>−</button>
                  <span style={{fontSize:14,fontWeight:700,minWidth:24,textAlign:"center",color:"var(--text)"}}>{item.qty}</span>
                  <button onClick={()=>updateQty(item.key,item.qty+1)} style={{width:32,height:32,borderRadius:"50%",border:"1px solid var(--border)",background:"var(--dark3)",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text)",fontSize:16}}>+</button>
                </div>
              </div>
            ))}
            <div style={{padding:"20px 0 8px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,color:"var(--text2)",letterSpacing:1}}>SUBTOTAL</span>
                <span className="fk-display" style={{fontSize:24,fontWeight:700,color:"var(--rose-light)"}}>৳{cartTotal.toLocaleString()}</span>
              </div>
              <div style={{fontSize:12,color:"var(--text2)",marginTop:6}}>💡 Payment on delivery available</div>
            </div>
          </>
        )}
      </div>
      {cart.length > 0 && (
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"var(--dark2)",borderTop:"1px solid var(--border)",padding:"16px"}}>
          <div style={{maxWidth:700,margin:"0 auto"}}>
            <button className="fk-btn-primary" onClick={onCheckout} style={{width:"100%",padding:"17px",borderRadius:14,fontSize:15,fontWeight:600,letterSpacing:0.3,boxShadow:"0 4px 30px rgba(225,29,72,0.35)"}}>
              Place Order · ৳{cartTotal.toLocaleString()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreCheckout({ cart, cartTotal, onBack, onSuccess, adminWa, waTemplate, storeUser }) {
  const [form,    setForm]    = useState({ name:storeUser?.displayName||"", phone:"", address:"", note:"" });
  const [loading, setLoading] = useState(false);
  const sf = (k, v) => setForm(p => ({...p, [k]:v}));

  const submit = async () => {
    if (!form.name.trim())    { alert("Please enter your name");         return; }
    if (!form.phone.trim())   { alert("Please enter your phone number"); return; }
    if (!form.address.trim()) { alert("Please enter your address");      return; }
    setLoading(true);

    const orderItems = cart.map(i => ({
      productName: i.product.name, productId: i.product.id,
      color: i.variant.color, qty: i.qty,
      price: i.product.price, subtotal: i.product.price * i.qty
    }));
    const orderLines = orderItems.map(i =>
      `• ${i.productName} (${i.color}) × ${i.qty} = ৳${i.subtotal.toLocaleString()}`
    ).join("\n");
    const orderData = {
      customer: form.name.trim(), phone: form.phone.trim(),
      place: form.address.trim(), note: form.note,
      items: orderItems, totalAmount: cartTotal,
      status: "Pending", date: new Date().toISOString().split("T")[0],
      source: "store", userId: storeUser?.uid || null,
      userEmail: storeUser?.email || null
    };

    const saved = await placePublicOrder(orderData);
    setLoading(false);

    if (saved === false) {
      alert("You've placed too many orders recently. Please wait a few minutes and try again.");
      return;
    }

    if (storeUser && !storeUser.isAnonymous)
      await saveOrderToUserProfile(storeUser.uid, orderData);

    const DEFAULT = "🌸 *New Order — {shopName}*\n\n👤 Name: {name}\n📞 Phone: {phone}\n📍 Address: {address}\n\n🛍️ *Items Ordered:*\n{items}\n\n💰 *Total: ৳{total}*\n\n📝 Note: {note}\n\nPlease confirm this order. Thank you! 🌸";
    const waMsg = (waTemplate || DEFAULT)
      .replace(/{shopName}/g, APP_NAME)
      .replace(/{name}/g,     form.name)
      .replace(/{phone}/g,    form.phone)
      .replace(/{address}/g,  form.address)
      .replace(/{items}/g,    orderLines)
      .replace(/{total}/g,    cartTotal.toLocaleString())
      .replace(/{note}/g,     form.note || "None");

    onSuccess({ saved, waMsg, orderData, adminWa });
  };

  const inputCss = { width:"100%", background:"var(--dark3)", border:"1.5px solid var(--border)", color:"var(--text)", borderRadius:12, padding:"14px 16px", fontSize:16, outline:"none", boxSizing:"border-box", fontFamily:"inherit", transition:"border-color 0.2s" };

  return (
    <div className="fk-store" style={{minHeight:"100dvh",background:"var(--dark)",color:"var(--text)"}}>
      <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",padding:"0 16px",position:"sticky",top:0,zIndex:30}}>
        <div style={{maxWidth:600,margin:"0 auto",display:"flex",alignItems:"center",height:60}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--rose-light)",fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Bag
          </button>
          <div className="fk-display" style={{flex:1,textAlign:"center",fontSize:16,fontWeight:600,color:"var(--text)"}}>Checkout</div>
          <div style={{width:50}} />
        </div>
      </header>
      <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px 120px"}}>
        {/* Order summary */}
        <div style={{background:"var(--dark2)",borderRadius:16,padding:"18px",marginBottom:24,border:"1px solid var(--border)"}}>
          <div style={{fontSize:10,fontWeight:600,color:"var(--text2)",marginBottom:14,letterSpacing:2}}>ORDER SUMMARY</div>
          {cart.map(i => (
            <div key={i.key} style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--text2)",marginBottom:8}}>
              <span>{i.product.name} <span style={{color:"var(--gold)"}}>({i.variant.color})</span> × {i.qty}</span>
              <span style={{fontWeight:600,color:"var(--text)"}}>৳{(i.product.price*i.qty).toLocaleString()}</span>
            </div>
          ))}
          <div style={{borderTop:"1px solid var(--border)",marginTop:12,paddingTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--text2)",letterSpacing:1}}>TOTAL</span>
            <span className="fk-display" style={{fontSize:22,fontWeight:700,color:"var(--rose-light)"}}>৳{cartTotal.toLocaleString()}</span>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {[{key:"name",label:"Full Name",placeholder:"Your full name",type:"text"},{key:"phone",label:"Phone Number",placeholder:"01XXXXXXXXX",type:"tel"}].map(f=>(
            <div key={f.key}>
              <label style={{display:"block",fontSize:10,fontWeight:600,color:"var(--text2)",marginBottom:7,letterSpacing:1.5}}>{f.label.toUpperCase()} *</label>
              <input value={form[f.key]} onChange={e=>sf(f.key,e.target.value)} placeholder={f.placeholder} type={f.type} style={inputCss}
                onFocus={e=>e.target.style.borderColor="var(--rose)"} onBlur={e=>e.target.style.borderColor="var(--border)"} />
            </div>
          ))}
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:600,color:"var(--text2)",marginBottom:7,letterSpacing:1.5}}>DELIVERY ADDRESS *</label>
            <textarea value={form.address} onChange={e=>sf("address",e.target.value)} placeholder="Area, city, district..." rows={2} style={{...inputCss,resize:"vertical"}}
              onFocus={e=>e.target.style.borderColor="var(--rose)"} onBlur={e=>e.target.style.borderColor="var(--border)"} />
          </div>
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:600,color:"var(--text2)",marginBottom:7,letterSpacing:1.5}}>SPECIAL NOTE</label>
            <textarea value={form.note} onChange={e=>sf("note",e.target.value)} placeholder="Any special requests..." rows={2} style={{...inputCss,resize:"vertical"}}
              onFocus={e=>e.target.style.borderColor="var(--rose)"} onBlur={e=>e.target.style.borderColor="var(--border)"} />
          </div>
        </div>
        <div style={{background:"var(--dark3)",borderRadius:12,padding:"12px 16px",marginTop:20,fontSize:12,color:"var(--text2)",lineHeight:1.7,border:"1px solid var(--border)"}}>
          💡 After placing your order, you'll get a WhatsApp link to confirm directly with us.
        </div>
      </div>
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"var(--dark2)",borderTop:"1px solid var(--border)",padding:"16px"}}>
        <div style={{maxWidth:600,margin:"0 auto"}}>
          <button className="fk-btn-primary" onClick={submit} disabled={loading}
            style={{width:"100%",padding:"17px",borderRadius:14,fontSize:15,fontWeight:600,opacity:loading?0.7:1,cursor:loading?"not-allowed":"pointer",letterSpacing:0.3,boxShadow:"0 4px 30px rgba(225,29,72,0.35)"}}>
            {loading ? "⏳ Placing Order..." : "Confirm Order →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreSuccess({ result, onContinue }) {
  const { saved, waMsg, adminWa } = result || {};
  return (
    <div className="fk-store" style={{minHeight:"100dvh",background:"var(--dark)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--dark2)",borderRadius:24,padding:"40px 28px",maxWidth:420,width:"100%",textAlign:"center",border:"1px solid var(--border)",boxShadow:"0 30px 80px rgba(0,0,0,0.5)"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(22,163,74,0.15)",border:"2px solid rgba(74,222,128,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 20px"}}>✓</div>
        <h2 className="fk-display" style={{fontSize:26,fontWeight:700,color:"var(--text)",marginBottom:8}}>Order Received!</h2>
        <p style={{fontSize:14,color:"var(--text2)",marginBottom:24,lineHeight:1.7}}>
          {saved ? "Your order has been saved! We'll contact you shortly to confirm." : "Please send us your order details via WhatsApp to confirm."}
        </p>
        <a href={waLink(adminWa||ADMIN_WA_NUMBER, waMsg)} target="_blank" rel="noopener noreferrer"
          style={{display:"block",background:"#16a34a",color:"#fff",padding:"16px",borderRadius:14,fontSize:15,fontWeight:600,textDecoration:"none",marginBottom:12,letterSpacing:0.3}}>
          💬 Confirm on WhatsApp
        </a>
        <button onClick={onContinue} style={{width:"100%",background:"var(--dark3)",color:"var(--text2)",border:"1px solid var(--border)",padding:"14px",borderRadius:14,fontSize:14,fontWeight:500,cursor:"pointer"}}>
          ← Continue Shopping
        </button>
      </div>
    </div>
  );
}

// ─── USER PROFILE ─────────────────────────────────────────────────────────────
function UserProfile({ user, onBack, onLogin, onLoginEmail, onRegister, onLogout, allProducts, contactWaNumber }) {
  const [tab,           setTab]           = useState(user && !user.isAnonymous ? "overview" : "login");
  const [orders,        setOrders]        = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [authMode,      setAuthMode]      = useState("login");
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [name,          setName]          = useState("");
  const [showPw,        setShowPw]        = useState(false);
  const [authLoading,   setAuthLoading]   = useState(false);
  const [authError,     setAuthError]     = useState("");
  const [wishlist, setWishlist]     = useState(() => { try { return JSON.parse(localStorage.getItem("fk_wishlist")||"[]"); } catch(_) { return []; } });
  const [addresses,setAddresses]    = useState(() => { try { return JSON.parse(localStorage.getItem("fk_addresses")||"[]"); } catch(_) { return []; } });
  const [newAddr,  setNewAddr]      = useState("");
  const [showAddrForm,setShowAddrForm]=useState(false);
  const [notifOn,  setNotifOn]      = useState(() => { try { return localStorage.getItem("fk_notif")==="1"; } catch(_) { return false; } });

  const isLoggedIn = user && !user.isAnonymous;

  useEffect(() => { if(isLoggedIn && (tab==="orders"||tab==="overview")) { setLoadingOrders(true); getUserOrders(user.uid).then(o=>{setOrders(o.reverse());setLoadingOrders(false);}); } }, [isLoggedIn, tab, user]);
  useEffect(() => { if (isLoggedIn) setTab("overview"); }, [isLoggedIn]);
  useEffect(() => { try { localStorage.setItem("fk_wishlist", JSON.stringify(wishlist)); } catch(_) {} }, [wishlist]);
  useEffect(() => { try { localStorage.setItem("fk_addresses", JSON.stringify(addresses)); } catch(_) {} }, [addresses]);

  const removeWishlist = (id) => setWishlist(w => w.filter(x=>x!==id));
  const addAddress     = ()   => { if (!newAddr.trim()) return; setAddresses(a=>[...a,newAddr.trim()]); setNewAddr(""); setShowAddrForm(false); };
  const toggleNotif    = ()   => { const v=!notifOn; setNotifOn(v); try { localStorage.setItem("fk_notif",v?"1":"0"); } catch(_) {} };

  const loyaltyPoints = orders.reduce((a,o)=>a+Math.floor((+o.totalAmount||0)/100), 0);
  const loyaltyLevel  = loyaltyPoints>=500 ? "Gold 🥇" : loyaltyPoints>=200 ? "Silver 🥈" : "Bronze 🥉";
  const nextLevel     = loyaltyPoints>=500 ? null : loyaltyPoints>=200 ? 500 : 200;
  const levelPct      = nextLevel ? Math.min(100, Math.round(loyaltyPoints/nextLevel*100)) : 100;

  const handleEmailAuth = async () => {
    if (!email.trim() || !password) { setAuthError("Please fill all fields."); return; }
    if (authMode==="register" && !name.trim()) { setAuthError("Please enter your name."); return; }
    setAuthLoading(true); setAuthError("");
    try {
      if (authMode==="login") await onLoginEmail(email.trim(), password);
      else                    await onRegister(email.trim(), password, name.trim());
    } catch(err) {
      const msgs = {"auth/user-not-found":"No account with this email.","auth/wrong-password":"Wrong password.","auth/invalid-credential":"Wrong email or password.","auth/email-already-in-use":"Account already exists.","auth/weak-password":"Password must be 6+ chars.","auth/invalid-email":"Invalid email address."};
      setAuthError(msgs[err.code] || "Error: " + err.message);
    } finally { setAuthLoading(false); }
  };

  const wishlistProducts = (allProducts||[]).filter(p => wishlist.includes(p.id));
  const statusColors = { Delivered:"#4ade80", Pending:"#fbbf24", Processing:"#60a5fa", Cancelled:"#f87171" };
  const statusBg     = { Delivered:"rgba(74,222,128,0.1)", Pending:"rgba(251,191,36,0.1)", Processing:"rgba(96,165,250,0.1)", Cancelled:"rgba(248,113,113,0.1)" };
  const waNum        = contactWaNumber || ADMIN_WA_NUMBER;

  // ── Not logged in: show auth ──
  if (!isLoggedIn) {
    return (
      <div style={{minHeight:"100dvh",background:"var(--dark)",fontFamily:"'DM Sans',system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
        <div style={{position:"fixed",top:"-10%",right:"-5%",width:360,height:360,borderRadius:"50%",background:"radial-gradient(circle,rgba(225,29,72,0.12) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}} />
        <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",padding:"0 16px",position:"sticky",top:0,zIndex:10}}>
          <div style={{display:"flex",alignItems:"center",height:58,maxWidth:480,margin:"0 auto"}}>
            <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--rose-light)",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Back
            </button>
            <div className="fk-display" style={{flex:1,textAlign:"center",fontSize:15,fontWeight:700,color:"var(--text)"}}>My Account</div>
          </div>
        </header>
        <div style={{maxWidth:420,margin:"0 auto",padding:"36px 20px 80px",position:"relative",zIndex:1}}>
          <div style={{textAlign:"center",marginBottom:36}}>
            <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,var(--rose),#fb7185)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 18px",boxShadow:"0 8px 32px rgba(225,29,72,0.35)"}}>👤</div>
            <h2 className="fk-display" style={{fontSize:24,fontWeight:700,color:"var(--text)",margin:"0 0 8px"}}>{authMode==="login"?"Welcome Back":"Join FK Fashion"}</h2>
            <p style={{fontSize:13,color:"var(--text2)",margin:0,lineHeight:1.6}}>Save your orders, wishlists & get exclusive offers</p>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginBottom:30}}>
            {["📦 Track Orders","💖 Wishlist","🎁 Loyalty Pts","🏠 Addresses"].map(b=>(
              <span key={b} style={{fontSize:11,background:"rgba(255,255,255,0.05)",border:"1px solid var(--border)",borderRadius:20,padding:"5px 11px",color:"var(--rose-light)",fontWeight:600}}>{b}</span>
            ))}
          </div>
          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:22,padding:"26px 22px",backdropFilter:"blur(20px)"}}>
            {authError && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",color:"#f87171",fontSize:13,borderRadius:12,padding:"11px 14px",marginBottom:18,textAlign:"center"}}>⚠️ {authError}</div>}
            <button onClick={async()=>{setAuthError("");setAuthLoading(true);try{await onLogin();}catch(e){setAuthError("Google sign-in failed.");}finally{setAuthLoading(false);}}} disabled={authLoading}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"14px",border:"1px solid var(--border)",borderRadius:14,background:"rgba(255,255,255,0.06)",fontSize:14,fontWeight:600,cursor:"pointer",marginBottom:18,boxSizing:"border-box",color:"var(--text)",transition:"all 0.2s"}}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              {authLoading ? "Signing in..." : "Continue with Google"}
            </button>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}><div style={{flex:1,height:1,background:"var(--border)"}}/><span style={{fontSize:11,color:"var(--text2)"}}>or with email</span><div style={{flex:1,height:1,background:"var(--border)"}}/></div>
            {authMode==="register" && (
              <div style={{marginBottom:13}}>
                <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text2)",marginBottom:5,letterSpacing:0.5}}>FULL NAME</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" className="fk-input" />
              </div>
            )}
            <div style={{marginBottom:13}}>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text2)",marginBottom:5,letterSpacing:0.5}}>EMAIL</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" className="fk-input" autoComplete="email" />
            </div>
            <div style={{marginBottom:22,position:"relative"}}>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text2)",marginBottom:5,letterSpacing:0.5}}>PASSWORD</label>
              <input type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)}
                placeholder={authMode==="register"?"Create a password (6+ chars)":"Your password"}
                className="fk-input" style={{paddingRight:44}} autoComplete={authMode==="login"?"current-password":"new-password"}
                onKeyDown={e=>e.key==="Enter"&&handleEmailAuth()} />
              <button type="button" onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:14,bottom:14,background:"none",border:"none",fontSize:18,cursor:"pointer",color:"var(--text2)"}}>{showPw?"🙈":"👁️"}</button>
            </div>
            <button onClick={handleEmailAuth} disabled={authLoading}
              style={{width:"100%",background:authLoading?"rgba(225,29,72,0.4)":"linear-gradient(135deg,#e11d48,#be123c)",color:"#fff",border:"none",borderRadius:14,padding:"15px",fontSize:15,fontWeight:700,cursor:authLoading?"not-allowed":"pointer",boxSizing:"border-box",boxShadow:"0 4px 20px rgba(225,29,72,0.35)",letterSpacing:0.2}}>
              {authLoading ? "⏳ Please wait..." : authMode==="login" ? "Sign In →" : "Create Account →"}
            </button>
            <p style={{textAlign:"center",fontSize:13,color:"var(--text2)",marginTop:16,marginBottom:0}}>
              {authMode==="login" ? "No account yet? " : "Already have one? "}
              <button onClick={()=>{setAuthMode(m=>m==="login"?"register":"login");setAuthError("");}} style={{background:"none",border:"none",color:"var(--rose-light)",fontWeight:700,cursor:"pointer",fontSize:13}}>
                {authMode==="login" ? "Sign up free" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Logged in ──
  const TABS = [
    {id:"overview",  icon:"🏠", label:"Overview"},
    {id:"orders",    icon:"📦", label:"Orders"},
    {id:"wishlist",  icon:"💖", label: wishlist.length > 0 ? `Wishlist (${wishlist.length})` : "Wishlist"},
    {id:"addresses", icon:"🏠", label:"Addresses"},
    {id:"account",   icon:"👤", label:"Account"},
  ];

  return (
    <div className="fk-store" style={{minHeight:"100dvh",background:"var(--dark)",color:"var(--text)"}}>
      <header style={{background:"rgba(10,10,10,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",position:"sticky",top:0,zIndex:20}}>
        <div style={{maxWidth:760,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",height:58}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--rose-light)",fontWeight:600,flexShrink:0,display:"flex",alignItems:"center",gap:6}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Back
          </button>
          <div className="fk-display" style={{flex:1,textAlign:"center",fontSize:15,fontWeight:700,color:"var(--text)"}}>My Account</div>
          <button onClick={onLogout} style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:10,padding:"5px 11px",flexShrink:0}}>Sign out</button>
        </div>
      </header>

      {/* Profile hero */}
      <div style={{position:"relative",overflow:"hidden",background:"linear-gradient(160deg,#0f0a14 0%,#1a0d1a 40%,#0a0a12 100%)",borderBottom:"1px solid var(--border)"}}>
        <div style={{position:"absolute",top:-40,right:-20,width:260,height:260,borderRadius:"50%",background:"radial-gradient(circle,rgba(225,29,72,0.18) 0%,transparent 70%)",pointerEvents:"none"}} />
        <div style={{maxWidth:760,margin:"0 auto",padding:"28px 20px 24px",position:"relative"}}>
          <div style={{display:"flex",alignItems:"center",gap:18,marginBottom:20}}>
            <div style={{position:"relative",flexShrink:0}}>
              {user.photoURL
                ? <img src={user.photoURL} style={{width:68,height:68,borderRadius:"50%",objectFit:"cover",border:"2px solid var(--rose-light)",boxShadow:"0 0 0 4px rgba(225,29,72,0.18)"}} alt="" />
                : <div style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(135deg,var(--rose),#fb7185)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:700,color:"#fff"}}>
                    {(user.displayName||user.email||"U")[0].toUpperCase()}
                  </div>}
              <div style={{position:"absolute",bottom:2,right:2,width:16,height:16,background:"#4ade80",borderRadius:"50%",border:"2px solid var(--dark)"}} />
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div className="fk-display" style={{fontSize:20,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName||"Customer"}</div>
              <div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>{user.email}</div>
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <span style={{background:"linear-gradient(135deg,rgba(212,168,83,0.2),rgba(212,168,83,0.1))",border:"1px solid rgba(212,168,83,0.3)",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,color:"var(--gold)"}}>⭐ {loyaltyLevel}</span>
                <span style={{fontSize:11,color:"var(--text2)"}}>{loyaltyPoints} pts</span>
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:11,color:"var(--text2)",letterSpacing:1,marginBottom:2}}>ORDERS</div>
              <div className="fk-display" style={{fontSize:30,fontWeight:700,color:"var(--rose-light)",lineHeight:1}}>{orders.length}</div>
            </div>
          </div>

          {nextLevel && (
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text2)",marginBottom:5}}><span>{loyaltyPoints} pts earned</span><span>{nextLevel-loyaltyPoints} pts to {loyaltyPoints<200?"Silver 🥈":"Gold 🥇"}</span></div>
              <div style={{height:4,background:"var(--dark4)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",background:"linear-gradient(90deg,var(--rose),var(--gold))",borderRadius:2,width:`${levelPct}%`,transition:"width 0.6s ease",boxShadow:"0 0 8px rgba(225,29,72,0.4)"}} />
              </div>
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {[{icon:"💰",val:`৳${orders.reduce((a,o)=>a+(+o.totalAmount||0),0).toLocaleString()}`,lbl:"Total Spent"},{icon:"⭐",val:loyaltyPoints,lbl:"Loyalty Pts"},{icon:"💖",val:wishlist.length,lbl:"Wishlist"}].map(s=>(
              <div key={s.lbl} style={{background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:14,padding:"12px",textAlign:"center"}}>
                <div style={{fontSize:16,marginBottom:4}}>{s.icon}</div>
                <div className="fk-display" style={{fontSize:16,fontWeight:700,color:"var(--rose-light)"}}>{s.val}</div>
                <div style={{fontSize:9,color:"var(--text2)",fontWeight:600,letterSpacing:1,marginTop:2}}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{background:"rgba(10,10,10,0.92)",borderBottom:"1px solid var(--border)",position:"sticky",top:58,zIndex:15,backdropFilter:"blur(16px)",overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}}>
        <div style={{display:"flex",maxWidth:760,margin:"0 auto",padding:"0 12px",minWidth:"max-content"}}>
          {TABS.map(tb=>(
            <button key={tb.id} onClick={()=>setTab(tb.id)}
              style={{padding:"14px 14px",border:"none",background:"none",fontSize:13,fontWeight:tab===tb.id?700:500,
                color:tab===tb.id?"var(--rose-light)":"var(--text2)",
                borderBottom:tab===tb.id?"2px solid var(--rose)":"2px solid transparent",
                cursor:"pointer",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5,transition:"color 0.18s"}}>
              <span>{tb.icon}</span>{tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{maxWidth:760,margin:"0 auto",padding:"20px 16px 100px"}}>

        {tab==="overview" && (
          <div>
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)"}}>📦 Recent Orders</div>
                <button onClick={()=>setTab("orders")} style={{fontSize:12,color:"var(--rose-light)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>See all →</button>
              </div>
              {loadingOrders ? (
                <div style={{textAlign:"center",padding:28,color:"var(--text2)",fontSize:13}}>⏳ Loading...</div>
              ) : orders.length===0 ? (
                <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:18,padding:"28px",textAlign:"center",color:"var(--text2)"}}><div style={{fontSize:40,marginBottom:10,opacity:0.5}}>📭</div><div>No orders yet. Start shopping!</div></div>
              ) : orders.slice(0,3).map((o,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:16,padding:"14px 16px",marginBottom:10,animation:`fk-fadeUp 0.3s ease-out ${i*0.06}s both`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{fontSize:11,color:"var(--text2)"}}>{o.date}</div>
                    <span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:"3px 10px",background:statusBg[o.status]||"rgba(255,255,255,0.06)",color:statusColors[o.status]||"var(--rose-light)"}}>{o.status||"Pending"}</span>
                  </div>
                  <div style={{fontSize:13,color:"var(--text)",fontWeight:600,marginBottom:4}}>{(o.items||[]).map(it=>it.productName).join(", ")}</div>
                  <div className="fk-display" style={{fontSize:16,fontWeight:700,color:"var(--rose-light)"}}>৳{(+o.totalAmount||0).toLocaleString()}</div>
                </div>
              ))}
            </div>
            {wishlistProducts.length>0 && (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)"}}>💖 Wishlist</div>
                  <button onClick={()=>setTab("wishlist")} style={{fontSize:12,color:"var(--rose-light)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>See all →</button>
                </div>
                <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:4,WebkitOverflowScrolling:"touch"}}>
                  {wishlistProducts.slice(0,4).map(p=>(
                    <div key={p.id} style={{flexShrink:0,width:120,background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
                      <div style={{width:"100%",height:90,background:"var(--dark3)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {getProductThumb(p)?<img src={getProductThumb(p)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" />:<span style={{fontSize:28,opacity:0.3}}>🌸</span>}
                      </div>
                      <div style={{padding:"8px 10px"}}><div style={{fontSize:11,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div><div style={{fontSize:12,fontWeight:700,color:"var(--rose-light)",marginTop:2}}>৳{p.price.toLocaleString()}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="orders" && (
          <div>
            <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:16}}>📦 All Orders</div>
            {loadingOrders ? (
              <div style={{textAlign:"center",padding:40,color:"var(--text2)"}}>⏳ Loading your orders...</div>
            ) : orders.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text2)"}}>
                <div style={{fontSize:52,marginBottom:14,opacity:0.4}}>📭</div>
                <div style={{fontSize:16,fontWeight:600,marginBottom:8,color:"var(--text)"}}>No orders yet</div>
                <button onClick={onBack} style={{background:"linear-gradient(135deg,#e11d48,#be123c)",color:"#fff",border:"none",borderRadius:14,padding:"12px 28px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Start Shopping</button>
              </div>
            ) : orders.map((o,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:18,padding:"16px",marginBottom:12,animation:`fk-fadeUp 0.3s ease-out ${i*0.04}s both`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div><div style={{fontSize:11,color:"var(--text2)",marginBottom:2}}>ORDER · {o.date}</div><div className="fk-display" style={{fontSize:16,fontWeight:700,color:"var(--rose-light)"}}>৳{(+o.totalAmount||0).toLocaleString()}</div></div>
                  <span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:"4px 12px",background:statusBg[o.status]||"rgba(255,255,255,0.06)",color:statusColors[o.status]||"var(--rose-light)"}}>{o.status||"Pending"}</span>
                </div>
                {(o.items||[]).map((item,j)=>(
                  <div key={j} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderTop:j>0?"1px solid var(--border)":"none"}}>
                    <div><div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{item.productName}</div><div style={{fontSize:11,color:"var(--text2)",marginTop:1}}>{item.color} · Qty: {item.qty}</div></div>
                    <div style={{fontSize:13,fontWeight:700,color:"var(--rose-light)"}}>৳{(+item.subtotal||0).toLocaleString()}</div>
                  </div>
                ))}
                {o.place && <div style={{fontSize:11,color:"var(--text2)",marginTop:8}}>📍 {o.place}</div>}
              </div>
            ))}
          </div>
        )}

        {tab==="wishlist" && (
          <div>
            <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:16}}>💖 Wishlist ({wishlistProducts.length})</div>
            {wishlistProducts.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text2)"}}>
                <div style={{fontSize:52,marginBottom:14,opacity:0.4}}>💖</div>
                <div style={{fontSize:15,fontWeight:600,marginBottom:8,color:"var(--text)"}}>Your wishlist is empty</div>
                <button onClick={onBack} style={{background:"linear-gradient(135deg,#e11d48,#be123c)",color:"#fff",border:"none",borderRadius:14,padding:"12px 28px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Browse Products</button>
              </div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
                {wishlistProducts.map((p,i)=>(
                  <div key={p.id} style={{background:"rgba(255,255,255,0.03)",borderRadius:18,overflow:"hidden",border:"1px solid var(--border)",animation:`fk-fadeUp 0.3s ease-out ${i*0.05}s both`}}>
                    <div style={{width:"100%",aspectRatio:"1/1",background:"var(--dark3)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                      {getProductThumb(p)?<img src={getProductThumb(p)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" />:<span style={{fontSize:40,opacity:0.3}}>🌸</span>}
                      <button onClick={()=>removeWishlist(p.id)} style={{position:"absolute",top:8,right:8,background:"rgba(10,10,10,0.75)",border:"none",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,cursor:"pointer"}}>💔</button>
                    </div>
                    <div style={{padding:"10px 12px"}}>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span className="fk-display" style={{fontSize:15,fontWeight:700,color:"var(--rose-light)"}}>৳{p.price.toLocaleString()}</span>
                        {p.stock>0?<span style={{fontSize:9,background:"rgba(74,222,128,0.1)",color:"#4ade80",borderRadius:8,padding:"2px 7px",fontWeight:600}}>IN STOCK</span>:<span style={{fontSize:9,background:"rgba(248,113,113,0.1)",color:"#f87171",borderRadius:8,padding:"2px 7px",fontWeight:600}}>SOLD OUT</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab==="addresses" && (
          <div>
            <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:16}}>🏠 Saved Addresses</div>
            {addresses.map((addr,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:16,padding:"14px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:20,flexShrink:0}}>📍</span>
                <div style={{flex:1,fontSize:14,color:"var(--text)",lineHeight:1.5}}>{addr}</div>
                <button onClick={()=>setAddresses(a=>a.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:18,padding:4,flexShrink:0}}>✕</button>
              </div>
            ))}
            {showAddrForm ? (
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:16,padding:"16px"}}>
                <textarea value={newAddr} onChange={e=>setNewAddr(e.target.value)} placeholder="Enter delivery address..." rows={3} className="fk-input" style={{resize:"none",marginBottom:12}} />
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addAddress} style={{flex:1,background:"linear-gradient(135deg,#e11d48,#be123c)",color:"#fff",border:"none",borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer"}}>💾 Save</button>
                  <button onClick={()=>{setShowAddrForm(false);setNewAddr("");}} style={{flex:1,background:"rgba(255,255,255,0.06)",color:"var(--text2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px",fontSize:14,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setShowAddrForm(true)} style={{width:"100%",border:"2px dashed var(--border)",borderRadius:16,padding:"18px",fontSize:14,fontWeight:600,color:"var(--rose-light)",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                + Add New Address
              </button>
            )}
          </div>
        )}

        {tab==="account" && (
          <AccountTabContent user={user} loyaltyLevel={loyaltyLevel} loyaltyPoints={loyaltyPoints}
            notifOn={notifOn} toggleNotif={toggleNotif} onLogout={onLogout} contactWaNumber={waNum} />
        )}
      </div>
    </div>
  );
}

function AccountTabContent({ user, loyaltyLevel, loyaltyPoints, notifOn, toggleNotif, onLogout, contactWaNumber }) {
  const [editingName, setEditingName] = useState(false);
  const [newName,     setNewName]     = useState(user.displayName||"");
  const [savingName,  setSavingName]  = useState(false);
  const [nameError,   setNameError]   = useState("");
  const waNum = contactWaNumber || ADMIN_WA_NUMBER;

  const saveName = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { setNameError("Name cannot be empty."); return; }
    setSavingName(true); setNameError("");
    try {
      const { auth } = getFirebase();
      await updateProfile(auth.currentUser, { displayName:trimmed });
      if (auth.currentUser?.uid) await saveUserProfile(auth.currentUser.uid, { displayName:trimmed });
      setEditingName(false);
    } catch(e) { setNameError("Failed to save. Try again."); }
    setSavingName(false);
  };

  return (
    <div>
      <div className="fk-display" style={{fontSize:17,fontWeight:700,color:"var(--text)",marginBottom:16}}>👤 My Account</div>

      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px"}}>
          <span style={{fontSize:18,width:28,textAlign:"center",flexShrink:0}}>👤</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:"var(--text2)",fontWeight:600,letterSpacing:1,marginBottom:5}}>DISPLAY NAME</div>
            {editingName ? (
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveName()} className="fk-input" style={{flex:1,minWidth:120,padding:"8px 12px"}} autoFocus />
                <button onClick={saveName} disabled={savingName} style={{background:"linear-gradient(135deg,#e11d48,#be123c)",color:"#fff",border:"none",borderRadius:10,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer",flexShrink:0}}>{savingName?"Saving...":"✓ Save"}</button>
                <button onClick={()=>{setEditingName(false);setNewName(user.displayName||"");setNameError("");}} style={{background:"rgba(255,255,255,0.06)",color:"var(--text2)",border:"1px solid var(--border)",borderRadius:10,padding:"8px 12px",fontSize:13,cursor:"pointer",flexShrink:0}}>Cancel</button>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{user.displayName||"—"}</div>
                <button onClick={()=>{setEditingName(true);setNewName(user.displayName||"");}} style={{background:"rgba(225,29,72,0.1)",border:"1px solid rgba(225,29,72,0.2)",color:"var(--rose-light)",borderRadius:8,padding:"3px 10px",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>✏️ Edit</button>
              </div>
            )}
            {nameError && <div style={{fontSize:11,color:"#f87171",marginTop:4}}>{nameError}</div>}
          </div>
        </div>
        {[{label:"Email",value:user.email,icon:"📧"},{label:"Account Type",value:"Customer 🛍️",icon:"🌸"},{label:"Member Since",value:user.metadata?.creationTime?new Date(user.metadata.creationTime).toLocaleDateString("en-BD",{year:"numeric",month:"long"}):"—",icon:"📅"}].map(row=>(
          <div key={row.label} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderTop:"1px solid var(--border)"}}>
            <span style={{fontSize:18,width:28,textAlign:"center",flexShrink:0}}>{row.icon}</span>
            <div style={{flex:1}}><div style={{fontSize:10,color:"var(--text2)",fontWeight:600,letterSpacing:1,marginBottom:2}}>{row.label.toUpperCase()}</div><div style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{row.value}</div></div>
          </div>
        ))}
      </div>

      {/* Loyalty card */}
      <div style={{background:"linear-gradient(135deg,rgba(212,168,83,0.1),rgba(212,168,83,0.05))",border:"1px solid rgba(212,168,83,0.2)",borderRadius:18,padding:"18px",marginBottom:14}}>
        <div style={{fontSize:11,color:"var(--gold)",fontWeight:700,letterSpacing:1,marginBottom:10}}>⭐ LOYALTY PROGRAM</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>Current: <span style={{color:"var(--gold)"}}>{loyaltyLevel}</span></div><div style={{fontSize:12,color:"var(--text2)",marginTop:2}}>{loyaltyPoints} points earned</div></div>
          <div className="fk-display" style={{fontSize:36,fontWeight:700,color:"var(--gold)"}}>{loyaltyPoints}</div>
        </div>
        <div style={{display:"flex",gap:8,fontSize:11}}>
          {[{label:"Bronze",sub:"0–199",color:"#cd7f32"},{label:"Silver 🥈",sub:"200–499",color:"#c0c0c0"},{label:"Gold 🥇",sub:"500+",color:"#d4a853"}].map(tier=>(
            <div key={tier.label} style={{flex:1,background:"rgba(0,0,0,0.2)",borderRadius:10,padding:"7px 8px",border:"1px solid rgba(255,255,255,0.08)",textAlign:"center"}}>
              <div style={{fontWeight:700,color:tier.color,fontSize:10}}>{tier.label}</div>
              <div style={{color:"var(--text2)",fontSize:9,marginTop:2}}>{tier.sub} pts</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:"var(--text2)",marginTop:10}}>💡 Earn 1 point per ৳100 spent. Redeem for discounts.</div>
      </div>

      {/* Contact */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:16,padding:"16px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>💬</span>
          <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>Contact Support</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>WhatsApp: {waNum}</div></div>
          <a href={`https://wa.me/${waNum.replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
            style={{background:"#25D366",color:"#fff",border:"none",borderRadius:12,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none",flexShrink:0,boxShadow:"0 4px 12px rgba(37,211,102,0.3)"}}>Chat →</a>
        </div>
      </div>

      {/* Notifications toggle */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid var(--border)",borderRadius:16,padding:"16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>🔔</span>
          <div><div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>Order Notifications</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{notifOn?"Enabled":"Tap to enable"}</div></div>
        </div>
        <button onClick={toggleNotif} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:notifOn?"linear-gradient(135deg,#e11d48,#be123c)":"rgba(255,255,255,0.1)",position:"relative",transition:"all 0.2s",padding:0,flexShrink:0}}>
          <span style={{position:"absolute",top:3,left:notifOn?23:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.3)"}} />
        </button>
      </div>

      <button onClick={onLogout}
        style={{width:"100%",background:"rgba(239,68,68,0.08)",color:"#f87171",border:"1.5px solid rgba(239,68,68,0.2)",borderRadius:16,padding:"15px",fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        🚪 Sign Out
      </button>
    </div>
  );
}

// ─── LANDING PAGE (from Code 1 — missing in Code 2) ──────────────────────────
function LandingPage({ onSelectMode }) {
  return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(135deg,#fdf2f8 0%,#fce7f3 50%,#fdf4ff 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px",fontFamily:"Georgia,'Times New Roman',serif"}}>
      <div style={{textAlign:"center",marginBottom:48}}>
        <div style={{fontSize:64,marginBottom:16}}>🌸</div>
        <h1 style={{fontSize:"clamp(28px,8vw,52px)",fontWeight:800,color:"#1f2937",letterSpacing:3,margin:"0 0 8px"}}>{APP_NAME}</h1>
        <p style={{fontSize:14,color:"#9ca3af",letterSpacing:2,margin:0}}>{APP_NAME_BN} · HANDMADE JEWELLERY</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16,width:"100%",maxWidth:520}}>
        <button onClick={()=>onSelectMode("store")}
          style={{background:"#db2777",border:"none",borderRadius:20,padding:"28px 24px",cursor:"pointer",textAlign:"left",boxShadow:"0 10px 30px rgba(219,39,119,0.25)",transition:"transform 0.2s"}}
          onMouseEnter={e=>e.currentTarget.style.transform="scale(1.02)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
          <div style={{fontSize:40,marginBottom:12}}>🛍️</div>
          <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:4}}>Shop Now</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.75)"}}>Browse & order beautiful jewellery</div>
        </button>
        <button onClick={()=>onSelectMode("admin")}
          style={{background:"#fff",border:"2px solid #fce7f3",borderRadius:20,padding:"28px 24px",cursor:"pointer",textAlign:"left",boxShadow:"0 4px 16px rgba(219,39,119,0.08)",transition:"transform 0.2s"}}
          onMouseEnter={e=>e.currentTarget.style.transform="scale(1.02)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
          <div style={{fontSize:40,marginBottom:12}}>🔐</div>
          <div style={{fontSize:18,fontWeight:800,color:"#1f2937",marginBottom:4}}>Admin Panel</div>
          <div style={{fontSize:13,color:"#9ca3af"}}>Manage orders, products & business</div>
        </button>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 3: ADMIN PANEL COMPONENTS
// Dashboard · Catalogue · Orders · Customers · Money · Materials · Workers
// Reports · Settings (with ServiceSettings) · Customise · Login · AdminApp
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function Dashboard({ data, setData, t, showReport, setSection }) {
  const allOrders = [...(data.orders||[]),...(data.archivedOrders||[])];
  const rev     = allOrders.reduce((a,o)=>a+(+o.paid||0),0);
  const iO      = (data.money||[]).filter(m=>m.type==="owe").reduce((a,m)=>a+m.amount,0);
  const sal     = (data.workers||[]).filter(w=>w.status==="Active").reduce((a,w)=>a+w.salary,0);
  const mat     = (data.materials||[]).reduce((a,m)=>a+m.cost,0);
  const exp     = (data.expenses||[]).reduce((a,e)=>a+e.amount,0);
  const profit  = rev - sal - mat - exp - iO;
  const pending = (data.orders||[]).filter(o=>o.status==="Pending").length;
  const lowStock= (data.products||[]).filter(p=>p.stock<=5).length;
  const target  = data.monthlyTarget || 20000;
  const pct     = Math.min(100, Math.round(rev/target*100));
  const isDark  = t.dark;

  const card       = {background:isDark?"rgba(255,255,255,0.03)":"#fff",border:`1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)"}`,borderRadius:14,padding:"18px 20px",marginBottom:12};
  const cardTitle  = {fontSize:12,fontWeight:700,color:isDark?"rgba(255,255,255,0.5)":"rgba(0,0,0,0.4)",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif",marginBottom:12};
  const txt        = {color:isDark?"#e8e6f8":"#0a0a18"};
  const sub        = {color:isDark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.4)",fontSize:11};
  const divLine    = {borderTop:`1px solid ${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"}`};
  const statusColor= {Delivered:"#4ade80",Pending:"#fbbf24",Processing:"#60a5fa",Cancelled:"#f87171"};
  const statusBg   = {Delivered:"rgba(74,222,128,0.1)",Pending:"rgba(251,191,36,0.1)",Processing:"rgba(96,165,250,0.1)",Cancelled:"rgba(248,113,113,0.1)"};

  const quickCards = [
    {icon:"💰",label:"Revenue",    value:`৳${rev.toLocaleString()}`,                  color:"#4ade80",sub:`${pct}% of target`,   section:"reports"},
    {icon:"📦",label:"Orders",     value:(data.orders||[]).length,                    color:"#60a5fa",sub:`${pending} pending`,   section:"orders"},
    {icon:"🌸",label:"Products",   value:(data.products||[]).length,                  color:"#f43f5e",sub:lowStock>0?`⚠️ ${lowStock} low stock`:"All stocked",section:"catalogue"},
    {icon:"📈",label:profit>=0?"Profit":"Loss",value:`৳${Math.abs(profit).toLocaleString()}`,color:profit>=0?"#4ade80":"#f87171",sub:"Revenue − costs",section:"reports"},
  ];

  return (
    <div style={{fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:32,height:32,borderRadius:8,background:"rgba(244,63,94,0.12)",border:"1px solid rgba(244,63,94,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🏠</div>
          <h2 style={{fontFamily:"'Rajdhani',sans-serif",fontSize:22,fontWeight:700,color:"#f43f5e",margin:0,letterSpacing:"0.06em",textTransform:"uppercase"}}>Dashboard</h2>
        </div>
        <p style={{...sub,margin:0,marginLeft:42}}>{new Date().toLocaleDateString("en-BD",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
      </div>

      {/* Quick stat cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {quickCards.map(c=>(
          <div key={c.label} onClick={()=>setSection(c.section)}
            style={{...card,cursor:"pointer",position:"relative",overflow:"hidden",transition:"transform 0.2s,box-shadow 0.2s",padding:"16px 18px",marginBottom:0}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,0.3)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
            <div style={{position:"absolute",top:-20,right:-20,width:70,height:70,borderRadius:"50%",background:`${c.color}10`,pointerEvents:"none"}} />
            <div style={{fontSize:22,marginBottom:8}}>{c.icon}</div>
            <div style={{fontSize:20,fontWeight:700,color:c.color,fontFamily:"'Rajdhani',sans-serif"}}>{c.value}</div>
            <div style={{fontSize:12,fontWeight:600,...txt,marginTop:2}}>{c.label}</div>
            <div style={{...sub,marginTop:3}}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Monthly target */}
      <div style={{...card}}>
        <div style={cardTitle}>Monthly Target</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:600,...txt}}>৳{rev.toLocaleString()} of ৳{target.toLocaleString()}</span>
          <span style={{fontSize:13,fontWeight:700,color:"#f43f5e",fontFamily:"'Rajdhani',sans-serif"}}>{pct}%</span>
        </div>
        <div style={{width:"100%",height:8,borderRadius:99,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.08)",overflow:"hidden"}}>
          <div style={{width:`${pct}%`,height:"100%",borderRadius:99,background:"linear-gradient(90deg,#f43f5e,#fb7185)",boxShadow:"0 0 10px rgba(244,63,94,0.5)",transition:"width 0.6s ease"}} />
        </div>
        <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8}}>
          <label style={{...sub,whiteSpace:"nowrap"}}>Update target:</label>
          <input type="number" defaultValue={target}
            onBlur={e=>setData(p=>({...p,monthlyTarget:+e.target.value||20000}))}
            style={{width:90,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.04)",border:`1px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)"}`,borderRadius:8,padding:"6px 10px",fontSize:13,color:isDark?"#e8e6f8":"#0a0a18",outline:"none"}} />
        </div>
      </div>

      {/* Recent orders */}
      <div style={{...card}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={cardTitle}>Recent Orders</span>
          <button onClick={()=>setSection("orders")} style={{fontSize:11,fontWeight:700,color:"#f43f5e",background:"none",border:"none",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>View all →</button>
        </div>
        {!(data.orders||[]).length ? (
          <div style={{...sub,textAlign:"center",padding:"16px 0"}}>No orders yet</div>
        ) : (data.orders||[]).slice(-4).reverse().map(o=>(
          <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",...divLine}}>
            <div><div style={{fontSize:13,fontWeight:600,...txt}}>{o.customer}</div><div style={{...sub,marginTop:2}}>{o.product}</div></div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:700,color:"#f43f5e",marginBottom:4}}>৳{(+o.price||0).toLocaleString()}</div>
              <span style={{fontSize:10,fontWeight:700,borderRadius:6,padding:"2px 8px",background:statusBg[o.status]||"rgba(255,255,255,0.06)",color:statusColor[o.status]||"rgba(255,255,255,0.5)",letterSpacing:"0.05em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>{o.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Financial summary */}
      <div style={{...card}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={cardTitle}>Financial Summary</span>
          <button onClick={()=>showReport(buildFullReport(data))} style={{fontSize:11,fontWeight:700,color:"#f59e0b",background:"none",border:"none",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>🖨️ Report</button>
        </div>
        {[["Revenue",rev,"#4ade80"],["Salary",sal,isDark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.4)"],["Materials",mat,isDark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.4)"],["Expenses",exp,"#fb923c"],["Debts",iO,"#f87171"]].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",...divLine}}>
            <span style={{...sub,fontSize:12}}>{l}</span>
            <span style={{fontSize:12,fontWeight:600,color:c}}>৳{v.toLocaleString()}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px 0 0",borderTop:`2px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)"}`}}>
          <span style={{fontSize:14,fontWeight:700,...txt}}>Net {profit>=0?"Profit":"Loss"}</span>
          <span style={{fontSize:14,fontWeight:700,color:profit>=0?"#4ade80":"#f87171"}}>৳{Math.abs(profit).toLocaleString()}</span>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStock > 0 && (
        <div style={{background:"rgba(234,88,12,0.07)",border:"1px solid rgba(234,88,12,0.2)",borderRadius:14,padding:"16px 20px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fb923c",marginBottom:10,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>⚠️ Low Stock Alert</div>
          {(data.products||[]).filter(p=>p.stock<=5).map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"6px 0",borderTop:"1px solid rgba(234,88,12,0.1)"}}>
              <span style={{color:isDark?"rgba(255,255,255,0.7)":"rgba(0,0,0,0.7)"}}>{p.name}</span>
              <span style={{fontWeight:700,color:"#fb923c"}}>{p.stock} left</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CATALOGUE ────────────────────────────────────────────────────────────────
const BP = { name:"",nameBn:"",category:"Bridal",price:"",stock:"",desc:"",sku:"",stockStatus:"Ready",colorVariants:[{color:"",images:[]}] };

function Catalogue({ data, setData, t, showReport }) {
  const [modal,  setModal]  = useState(false);
  const [editId, setEditId] = useState(null);
  const [viewP,  setViewP]  = useState(null);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState("name");
  const [form,   setForm]   = useState(BP);
  const [cDel,   setCDel]   = useState(null);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = () => {
    const name  = (form.name||"").trim();
    const price = parseFloat(form.price);
    if (!name)        { alert("Please enter a product name."); return; }
    if (!price||price<=0) { alert("Please enter a valid price."); return; }
    const variants = (form.colorVariants||[]).filter(v=>v.color.trim());
    if (!variants.length) { alert("Please add at least one color variant."); return; }
    const np = { ...form, name, price, stock:parseInt(form.stock)||0, sku:(form.sku||"").trim()||"FKF-"+String(Date.now()).slice(-5), colorVariants:variants };
    if (editId) setData(p=>({...p,products:p.products.map(x=>x.id===editId?{...np,id:editId}:x)}));
    else        setData(p=>({...p,products:[...p.products,{...np,id:Date.now()}]}));
    setForm(BP); setEditId(null); setModal(false);
  };

  const del = (id) => {
    setData(p=>{
      const toArchive = p.products.find(x=>x.id===id);
      if (!toArchive) return p;
      return { ...p, products:p.products.filter(x=>x.id!==id), archivedProducts:[...(p.archivedProducts||[]),{...toArchive,_archived:new Date().toISOString().split("T")[0]}] };
    });
    setCDel(null); setViewP(null);
  };

  const updS = (id, d) => setData(p=>({...p,products:p.products.map(x=>x.id===id?{...x,stock:Math.max(0,x.stock+d)}:x)}));

  let prods = (data.products||[]).filter(p=>filter==="All"||p.category===filter).filter(p=>p.name.toLowerCase().includes(search.toLowerCase())||(p.nameBn||"").includes(search));
  if (sort==="price")  prods = [...prods].sort((a,b)=>a.price-b.price);
  else if (sort==="stock") prods = [...prods].sort((a,b)=>b.stock-a.stock);
  else                 prods = [...prods].sort((a,b)=>a.name.localeCompare(b.name));

  const low      = (data.products||[]).filter(p=>p.stock<=5&&p.stock>0).length;
  const out      = (data.products||[]).filter(p=>p.stock===0).length;
  const bg0      = t.dark ? "#1e293b" : "#fdf2f8";
  const liveViewP= viewP ? (data.products||[]).find(x=>x.id===viewP.id)||viewP : null;

  return (
    <div>
      <SecHdr icon="🌸" title="Catalogue"
        sub={`${(data.products||[]).length} products${low>0?` · ⚠️${low} low`:""}${out>0?` · ❌${out} out`:""}`}
        onAdd={()=>{setForm({...BP,colorVariants:[{color:"",images:[]}]});setEditId(null);setModal(true);}}
        addLabel="+ Add Product" t={t} extra={<PBtn onClick={()=>showReport(buildCatalogue(data.products))} />}
      />
      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." t={t} />
      <Pills options={["All",...getCfg(data,"categories",CATEGORIES)]} value={filter} onChange={setFilter} t={t} />
      <div className="flex justify-end mb-3">
        <select value={sort} onChange={e=>setSort(e.target.value)} className={`text-xs border rounded-xl px-3 py-1.5 ${t.input}`}>
          <option value="name">A–Z</option><option value="price">Price</option><option value="stock">Stock</option>
        </select>
      </div>

      <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))"}}>
        {prods.map(p=>{
          const thumb      = getProductThumb(p);
          const colorCount = (p.colorVariants||[]).length;
          return (
            <div key={p.id} className={`${t.card} border rounded-2xl overflow-hidden cursor-pointer hover:shadow-lg transition`} onClick={()=>setViewP(p)}>
              <div className="w-full h-36 flex items-center justify-center overflow-hidden" style={{background:bg0}}>
                {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="" /> : <div className="text-5xl">🌸</div>}
              </div>
              <div className="p-3">
                <div className={`font-bold text-sm truncate ${t.text}`}>{p.name}</div>
                <div className={`text-xs truncate ${t.sub}`}>{p.nameBn}</div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-pink-500 font-bold text-sm">৳{p.price.toLocaleString()}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold border ${p.stock===0?"bg-red-500 text-white border-red-500":p.stock<=5?t.yellow:t.green}`}>
                    {p.stock===0?"Out ⚠️":p.stock<=5?`Low:${p.stock}`:`${p.stock}pcs`}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${t.pill}`}>{p.category}</span>
                  {colorCount > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${t.dark?"bg-purple-900/40 text-purple-300":"bg-purple-50 text-purple-600"}`}>{colorCount} color{colorCount>1?"s":""}</span>}
                  {p.stockStatus && p.stockStatus!=="Ready" && (() => {
                    const ssC={"Making":"bg-blue-100 text-blue-700","Need Stock":"bg-yellow-100 text-yellow-800","Pre-Order":"bg-pink-100 text-pink-700"};
                    return <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${ssC[p.stockStatus]||"bg-gray-100 text-gray-600"}`}>📌 {p.stockStatus}</span>;
                  })()}
                </div>
              </div>
            </div>
          );
        })}
        {prods.length===0 && <div className="col-span-3"><Empty icon="🔍" text="No products found" t={t} /></div>}
      </div>

      {/* Product detail modal */}
      {liveViewP && (
        <Modal title={liveViewP.name} onClose={()=>setViewP(null)} wide t={t}>
          <div style={{marginBottom:16}}><ImageGallery variants={liveViewP.colorVariants||[]} selectedVariantIdx={0} onVariantChange={()=>{}} /></div>
          <div style={{fontSize:13,color:t.dark?"rgba(255,255,255,0.45)":"#6b7280",marginBottom:4}}>{liveViewP.nameBn}{liveViewP.sku?` · ${liveViewP.sku}`:""}</div>
          <div style={{fontSize:26,fontWeight:800,color:"#f43f5e",marginBottom:8}}>৳{liveViewP.price.toLocaleString()}</div>
          {liveViewP.desc && <p style={{fontSize:13,color:t.dark?"#c4c0d8":"#374151",marginBottom:10,lineHeight:1.5}}>{liveViewP.desc}</p>}
          {(liveViewP.colorVariants||[]).some(v=>v.color) && (
            <div style={{fontSize:12,color:t.dark?"rgba(255,255,255,0.4)":"#6b7280",marginBottom:14}}>
              Colors: {(liveViewP.colorVariants||[]).map(v=>v.color).filter(Boolean).join(", ")}
            </div>
          )}
          {/* Stock adjuster */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,background:t.dark?"rgba(255,255,255,0.05)":"#f9fafb",borderRadius:12,padding:"10px 14px",border:`1px solid ${t.dark?"rgba(255,255,255,0.08)":"#e5e7eb"}`}}>
            <span style={{fontSize:12,fontWeight:600,color:t.dark?"rgba(255,255,255,0.5)":"#6b7280",flex:1}}>Stock</span>
            <button onClick={()=>updS(liveViewP.id,-1)} style={{width:34,height:34,borderRadius:"50%",border:`1px solid ${t.dark?"rgba(255,255,255,0.15)":"#d1d5db"}`,background:t.dark?"rgba(255,255,255,0.06)":"#fff",color:t.dark?"#e8e6f8":"#374151",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,lineHeight:1}}>−</button>
            <span style={{fontWeight:800,fontSize:16,color:t.dark?"#e8e6f8":"#111827",minWidth:60,textAlign:"center"}}>{liveViewP.stock} pcs</span>
            <button onClick={()=>updS(liveViewP.id,+1)} style={{width:34,height:34,borderRadius:"50%",border:`1px solid ${t.dark?"rgba(255,255,255,0.15)":"#d1d5db"}`,background:t.dark?"rgba(255,255,255,0.06)":"#fff",color:t.dark?"#e8e6f8":"#374151",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,lineHeight:1}}>+</button>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setForm({...liveViewP});setEditId(liveViewP.id);setModal(true);setViewP(null);}} style={{flex:1,padding:"11px",borderRadius:12,background:"linear-gradient(135deg,#f43f5e,#e11d48)",color:"#fff",border:"none",fontWeight:700,fontSize:14,cursor:"pointer"}}>✏️ Edit</button>
            <button onClick={()=>setCDel(liveViewP.id)} style={{flex:1,padding:"11px",borderRadius:12,background:t.dark?"rgba(239,68,68,0.12)":"#fee2e2",color:"#ef4444",border:`1px solid ${t.dark?"rgba(239,68,68,0.2)":"#fecaca"}`,fontWeight:700,fontSize:14,cursor:"pointer"}}>🗑️ Delete</button>
          </div>
        </Modal>
      )}

      {/* Add/Edit modal */}
      {modal && (
        <Modal title={editId?"Edit Product":"Add Product"} onClose={()=>setModal(false)} wide t={t}>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Name (English)" value={form.name} onChange={e=>sf("name",e.target.value)} t={t} />
            <Inp label="Name (বাংলা)"   value={form.nameBn} onChange={e=>sf("nameBn",e.target.value)} t={t} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Category" value={form.category} onChange={e=>sf("category",e.target.value)} t={t}>
              {getCfg(data,"categories",CATEGORIES).map(c=><option key={c}>{c}</option>)}
            </Sel>
            <Inp label="SKU" value={form.sku} onChange={e=>sf("sku",e.target.value)} t={t} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Price ৳" type="number" min="0" value={form.price} onChange={e=>sf("price",e.target.value)} t={t} />
            <Inp label="Stock"   type="number" min="0" value={form.stock} onChange={e=>sf("stock",e.target.value)} t={t} />
          </div>
          <Sel label="Stock Status" value={form.stockStatus||"Ready"} onChange={e=>sf("stockStatus",e.target.value)} t={t}>
            {STOCK_STATUSES.map(s=><option key={s}>{s}</option>)}
          </Sel>
          <Txtarea label="Description" value={form.desc} onChange={e=>sf("desc",e.target.value)} t={t} />
          <div className={`border-t ${t.border} pt-4 mt-1`}>
            <ColorVariantEditor variants={form.colorVariants||[{color:"",images:[]}]} onChange={v=>sf("colorVariants",v)} t={t} />
          </div>
          <div className="flex gap-2 mt-4">
            <Btn onClick={save}>{editId?"Save Changes":"Add Product"}</Btn>
            <Btn color="gray" onClick={()=>{setModal(false);setForm(BP);setEditId(null);}}>Cancel</Btn>
          </div>
        </Modal>
      )}
      {cDel && <Confirm msg="Delete this product?" onConfirm={()=>del(cDel)} onCancel={()=>setCDel(null)} t={t} />}
    </div>
  );
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────
const EMPTY_ITEM = { product:"", color:"", qty:1, unitPrice:"", subtotal:"" };

function OrderModal({ data, editOrder, onSave, onClose, t }) {
  const initForm = () => {
    if (editOrder) {
      return {
        customer:     editOrder.customer     || "",
        phone:        editOrder.phone        || "",
        place:        editOrder.place        || "",
        items:        editOrder.items && editOrder.items.length>0 ? editOrder.items : [{ product:editOrder.product||"", color:editOrder.color||"", qty:editOrder.qty||1, unitPrice:editOrder.price||"", subtotal:editOrder.price||"" }],
        discount:     editOrder.discount     || 0,
        paid:         editOrder.paid         || "",
        status:       editOrder.status       || "Pending",
        date:         (editOrder.date         && editOrder.date.trim())
                        ? editOrder.date.trim()
                        : new Date().toISOString().split("T")[0],
        deliveryDate: (editOrder.deliveryDate && editOrder.deliveryDate.trim())
                        ? editOrder.deliveryDate.trim()
                        : "",
        note:         editOrder.note         || "",
        source:       editOrder.source       || "admin",
      };
    }
    return { customer:"",phone:"",place:"",items:[{...EMPTY_ITEM}],discount:0,paid:"",status:"Pending",date:new Date().toISOString().split("T")[0],deliveryDate:"",note:"",source:"admin" };
  };

  const [form,           setForm]           = useState(initForm);
  const [custSuggestions,setCustSuggestions]= useState([]);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const handleCustInput = (val) => {
    sf("customer", val);
    if (val.length < 2) { setCustSuggestions([]); return; }
    const seen = {};
    const matches = (data.orders||[]).filter(o=>o.customer.toLowerCase().includes(val.toLowerCase())).filter(o=>{ if(seen[o.phone])return false; seen[o.phone]=true; return true; }).slice(0,5);
    setCustSuggestions(matches);
  };
  const fillCustomer = (o) => { setForm(p=>({...p,customer:o.customer,phone:o.phone,place:o.place||p.place})); setCustSuggestions([]); };

  const updItem = (i,k,v) => {
    const items = [...form.items];
    items[i] = { ...items[i], [k]:v };
    if (k==="product") { const pr=(data.products||[]).find(x=>x.name===v); if(pr){items[i].unitPrice=pr.price;items[i].subtotal=pr.price*(items[i].qty||1);} }
    if (k==="qty"||k==="unitPrice") { const qty=k==="qty"?+v:+items[i].qty; const up=k==="unitPrice"?+v:+items[i].unitPrice; if(!isNaN(qty)&&!isNaN(up)) items[i].subtotal=qty*up; }
    setForm(p=>({...p,items}));
  };
  const addItem = ()  => setForm(p=>({...p,items:[...p.items,{...EMPTY_ITEM}]}));
  const delItem = (i) => setForm(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}));

  const grandTotal = form.items.reduce((a,it)=>a+(+it.subtotal||0),0) - (+form.discount||0);
  const due        = grandTotal - (+form.paid||0);

  const save = () => {
    if (!(form.customer||"").trim())       { alert("Please enter customer name."); return; }
    if (!form.items.length||!form.items[0].product) { alert("Please add at least one product."); return; }
    const cleanItems = form.items.map(it=>({ product:it.product, color:it.color||"", qty:+it.qty||1, unitPrice:+it.unitPrice||0, subtotal:+it.subtotal||0 }));
    const row = { ...form, customer:form.customer.trim(), items:cleanItems, price:grandTotal, paid:Math.min(+form.paid||0,grandTotal), discount:+form.discount||0, product:cleanItems.map(i=>`${i.product}${i.color?" ("+i.color+")":""} ×${i.qty}`).join(", "), qty:cleanItems.reduce((a,i)=>a+i.qty,0) };
    onSave(row);
  };

  const iStyle = { fontSize:"16px", color:t.dark?"#f3f4f6":"#111827", background:t.dark?"#374151":"#fff", colorScheme:t.dark?"dark":"light" };

  return (
    <Modal title={editOrder?"Edit Order":"New Order"} onClose={onClose} t={t}>
      {/* Customer autofill */}
      <div style={{marginBottom:12,position:"relative"}}>
        <label className={`block text-xs font-medium ${t.sub} mb-1`}>👤 Customer Name *</label>
        <input value={form.customer} onChange={e=>handleCustInput(e.target.value)} placeholder="Type name — past customers autofill..."
          className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 ${t.input}`} style={iStyle} />
        {custSuggestions.length > 0 && (
          <div style={{position:"absolute",zIndex:50,left:0,right:0,background:t.dark?"#1f2937":"#fff",border:`1px solid ${t.dark?"#374151":"#fce7f3"}`,borderRadius:12,marginTop:4,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",overflow:"hidden"}}>
            {custSuggestions.map((o,i)=>(
              <div key={i} onClick={()=>fillCustomer(o)} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${t.dark?"#374151":"#fce7f3"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div><div style={{fontWeight:700,fontSize:13,color:t.dark?"#f9fafb":"#111"}}>{o.customer}</div><div style={{fontSize:11,color:t.dark?"#9ca3af":"#6b7280"}}>{o.phone}{o.place?` · ${o.place}`:""}</div></div>
                <span style={{fontSize:10,background:"#fdf2f8",color:"#be185d",padding:"2px 8px",borderRadius:20,fontWeight:600}}>Autofill ✓</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Inp label="Phone / ফোন" value={form.phone} onChange={e=>sf("phone",e.target.value)} t={t} />
        <Inp label="Place / এলাকা" value={form.place} onChange={e=>sf("place",e.target.value)} t={t} />
      </div>

      <div style={{margin:"10px 0 6px",fontWeight:700,fontSize:13,color:"#db2777"}}>🛍️ Products Ordered</div>
      {form.items.map((item,i)=>{
        const selProd  = (data.products||[]).find(p=>p.name===item.product);
        const colorOpts= selProd ? (selProd.colorVariants||[]).map(v=>v.color).filter(Boolean) : [];
        return (
          <div key={i} style={{background:t.dark?"#111827":"#fdf2f8",border:`1px solid ${t.dark?"#374151":"#fce7f3"}`,borderRadius:12,padding:"10px 12px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,color:t.dark?"#d1d5db":"#374151"}}>Item {i+1}</span>
              {form.items.length>1 && <button onClick={()=>delItem(i)} style={{fontSize:11,color:"#ef4444",fontWeight:700,background:"none",border:"none",cursor:"pointer"}}>✕ Remove</button>}
            </div>
            <div style={{marginBottom:6}}>
              <label className={`block text-xs ${t.sub} mb-1`}>Product *</label>
              <select value={item.product} onChange={e=>updItem(i,"product",e.target.value)}
                className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={{...iStyle,colorScheme:t.dark?"dark":"light"}}>
                <option value="">-- Select product --</option>
                {(data.products||[]).map(p=>{
                  const oos=p.stock===0; const low=p.stock>0&&p.stock<=5;
                  const ss=p.stockStatus&&p.stockStatus!=="Ready"?` [${p.stockStatus}]`:"";
                  return <option key={p.id} value={p.name}>{p.name} ৳{p.price}{oos?" ⚠ OUT":low?` (${p.stock} left)`:` (${p.stock})`}{ss}</option>;
                })}
              </select>
              {item.product && (() => {
                const pr = (data.products||[]).find(x=>x.name===item.product); if(!pr) return null;
                const oos=pr.stock===0; const low=pr.stock>0&&pr.stock<=5;
                return (
                  <div style={{marginTop:4,display:"flex",gap:6,flexWrap:"wrap"}}>
                    {oos && <span style={{fontSize:11,fontWeight:700,background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",borderRadius:6,padding:"3px 8px"}}>⛔ Out of Stock</span>}
                    {!oos&&low && <span style={{fontSize:11,fontWeight:700,background:"#fff7ed",border:"1px solid #fed7aa",color:"#ea580c",borderRadius:6,padding:"3px 8px"}}>⚠️ Only {pr.stock} left</span>}
                    {!oos&&!low && <span style={{fontSize:11,background:"#f0fdf4",border:"1px solid #bbf7d0",color:"#16a34a",borderRadius:6,padding:"3px 8px"}}>✓ {pr.stock} in stock</span>}
                    {pr.stockStatus&&pr.stockStatus!=="Ready" && <span style={{fontSize:11,fontWeight:700,background:"#fdf2f8",border:"1px solid #fce7f3",color:"#be185d",borderRadius:6,padding:"3px 8px"}}>📌 {pr.stockStatus}</span>}
                  </div>
                );
              })()}
            </div>
            {colorOpts.length > 0 && (
              <div style={{marginBottom:6}}>
                <label className={`block text-xs ${t.sub} mb-1`}>Style / Color</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                  {colorOpts.map(c=>(
                    <button key={c} type="button" onClick={()=>updItem(i,"color",c)}
                      style={{fontSize:11,padding:"3px 10px",borderRadius:20,border:`1px solid ${item.color===c?"#db2777":t.dark?"#4b5563":"#fce7f3"}`,background:item.color===c?"#db2777":t.dark?"#374151":"#fff",color:item.color===c?"#fff":t.dark?"#d1d5db":"#374151",fontWeight:600,cursor:"pointer"}}>
                      {c}
                    </button>
                  ))}
                </div>
                <input value={item.color} onChange={e=>updItem(i,"color",e.target.value)} placeholder="Or type custom color..."
                  className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={{...iStyle,fontSize:14}} />
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              <div><label className={`block text-xs ${t.sub} mb-1`}>Qty</label><input type="number" min="1" value={item.qty} onChange={e=>updItem(i,"qty",e.target.value)} className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={iStyle} /></div>
              <div><label className={`block text-xs ${t.sub} mb-1`}>Price/pc ৳</label><input type="number" min="0" value={item.unitPrice} onChange={e=>updItem(i,"unitPrice",e.target.value)} className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={iStyle} /></div>
              <div><label className={`block text-xs ${t.sub} mb-1`}>Subtotal ৳</label><input type="number" min="0" value={item.subtotal} onChange={e=>updItem(i,"subtotal",e.target.value)} className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={{...iStyle,fontWeight:700}} /></div>
            </div>
          </div>
        );
      })}
      <button onClick={addItem} style={{fontSize:12,color:"#db2777",fontWeight:700,background:"#fdf2f8",border:"1px solid #fce7f3",borderRadius:10,padding:"7px 14px",cursor:"pointer",marginBottom:12,width:"100%"}}>+ Add Another Product / Style</button>

      <div style={{background:t.dark?"#0f172a":"#fdf2f8",borderRadius:12,padding:"10px 14px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
          <span style={{color:t.dark?"#9ca3af":"#6b7280"}}>Items subtotal:</span>
          <span style={{fontWeight:700}}>৳{form.items.reduce((a,it)=>a+(+it.subtotal||0),0).toLocaleString()}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
          <div><label className={`block text-xs ${t.sub} mb-1`}>Discount ৳</label><input type="number" min="0" value={form.discount} onChange={e=>sf("discount",e.target.value)} className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={iStyle} /></div>
          <div><label className={`block text-xs ${t.sub} mb-1`}>Paid ৳</label><input type="number" min="0" value={form.paid} onChange={e=>sf("paid",e.target.value)} className={`w-full border rounded-lg px-2 py-1.5 text-sm ${t.input}`} style={iStyle} /></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${t.dark?"#374151":"#fce7f3"}`}}>
          <span style={{fontWeight:800,fontSize:14,color:"#db2777"}}>Grand Total: ৳{grandTotal.toLocaleString()}</span>
          <span style={{fontWeight:700,fontSize:13,color:due>0?"#ef4444":"#10b981"}}>Due: ৳{Math.max(0,due).toLocaleString()}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Inp label="Order Date"    type="date" value={form.date}         onChange={e=>sf("date",e.target.value)}         t={t} />
        <Inp label="Delivery Date" type="date" value={form.deliveryDate} onChange={e=>sf("deliveryDate",e.target.value)} t={t} />
      </div>
      <Sel label="Status" value={form.status} onChange={e=>sf("status",e.target.value)} t={t}>
        {getCfg(data,"orderStatuses",ORDER_STATUSES).map(s=><option key={s}>{s}</option>)}
      </Sel>
      <Txtarea label="Note" value={form.note} onChange={e=>sf("note",e.target.value)} t={t} />
      <div className="flex gap-2">
        <Btn onClick={save}>{editOrder?"Save Changes":"Place Order"}</Btn>
        <Btn color="gray" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function Orders({ data, setData, t, showReport }) {
  const [modal,       setModal]       = useState(false);
  const [editOrder,   setEditOrder]   = useState(null);
  const [fSt,         setFSt]         = useState("All");
  const [search,      setSearch]      = useState("");
  const [cDel,        setCDel]        = useState(null);
  const [copied,      setCopied]      = useState(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const save = (row) => {
    if (editOrder) setData(p=>({...p,orders:p.orders.map(x=>x.id===editOrder.id?{...row,id:editOrder.id}:x)}));
    else           setData(p=>({...p,orders:[...p.orders,{...row,id:Date.now()}]}));
    setModal(false); setEditOrder(null);
  };

  const del = (id) => {
    setData(p=>{
      const toArchive = p.orders.find(x=>x.id===id);
      if (!toArchive) return p;
      return { ...p, orders:p.orders.filter(x=>x.id!==id), archivedOrders:[...(p.archivedOrders||[]),{...toArchive,_archived:new Date().toISOString().split("T")[0]}] };
    });
    setCDel(null);
  };

  const bulkArchiveDelivered = () => {
    setData(p=>{
      const toArchive = p.orders.filter(o=>o.status==="Delivered");
      if (!toArchive.length) return p;
      const archiveDate = new Date().toISOString().split("T")[0];
      return { ...p, orders:p.orders.filter(o=>o.status!=="Delivered"), archivedOrders:[...(p.archivedOrders||[]),...toArchive.map(o=>({...o,_archived:archiveDate}))] };
    });
    setConfirmBulk(false);
  };

  const chgSt = (id, s) => setData(p=>({...p,orders:p.orders.map(o=>o.id===id?{...o,status:s}:o)}));
  const copyPhone = ph => { navigator.clipboard?.writeText(ph).catch(()=>{}); setCopied(ph); setTimeout(()=>setCopied(null),1500); };

  const filtered = (data.orders||[])
    .filter(o=>fSt==="All"||o.status===fSt)
    .filter(o=>o.customer.toLowerCase().includes(search.toLowerCase())||(o.product||"").toLowerCase().includes(search.toLowerCase())||(o.items||[]).some(it=>it.product.toLowerCase().includes(search.toLowerCase())));

  const rev           = (data.orders||[]).reduce((a,o)=>a+(+o.paid||0),0);
  const due           = (data.orders||[]).reduce((a,o)=>a+Math.max(0,(+o.price||0)-(+o.paid||0)),0);
  const deliveredCount= (data.orders||[]).filter(o=>o.status==="Delivered").length;

  return (
    <div>
      <SecHdr icon="📦" title="Orders / অর্ডার" sub={`${(data.orders||[]).length} orders`}
        onAdd={()=>{setEditOrder(null);setModal(true);}} addLabel="+ New Order" t={t}
        extra={<PBtn onClick={()=>showReport(buildOrdersReport(data.orders||[],"All Orders"))} />}
      />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Received</div><div className="text-green-500 font-bold text-lg">৳{rev.toLocaleString()}</div></div>
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Due</div><div className="text-yellow-500 font-bold text-lg">৳{due.toLocaleString()}</div></div>
      </div>

      {deliveredCount > 0 && (
        <div style={{background:t.dark?"#14532d22":"#f0fdf4",border:`1px solid ${t.dark?"#166534":"#bbf7d0"}`,borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,fontWeight:600,color:t.dark?"#86efac":"#16a34a"}}>✅ {deliveredCount} delivered order{deliveredCount>1?"s":""} ready to archive</span>
          <button onClick={()=>setConfirmBulk(true)} style={{fontSize:11,fontWeight:700,background:"#16a34a",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",cursor:"pointer",whiteSpace:"nowrap"}}>📦 Archive All Delivered</button>
        </div>
      )}

      <SearchBar value={search} onChange={setSearch} placeholder="Search customer or product..." t={t} />
      <Pills options={["All",...getCfg(data,"orderStatuses",ORDER_STATUSES)]} value={fSt} onChange={setFSt} t={t} />

      <div className="flex flex-col gap-3">
        {filtered.map(o=>{
          const inv   = "FKF-"+String(o.id).padStart(4,"0");
          const items = o.items&&o.items.length>0 ? o.items : [{product:o.product,color:o.color||"",qty:o.qty,unitPrice:o.price,subtotal:o.price}];
          const waMsg = `Hello ${o.customer}! Your order from *${APP_NAME}* is ${o.status.toLowerCase()}.\n${items.map(it=>`• ${it.product}${it.color?` (${it.color})`:""} ×${it.qty} = ৳${(+it.subtotal||0).toLocaleString()}`).join("\n")}\nTotal: ৳${(+o.price||0).toLocaleString()}, Paid: ৳${(+o.paid||0).toLocaleString()}, Due: ৳${Math.max(0,(+o.price||0)-(+o.paid||0)).toLocaleString()}. Invoice: ${inv}. 🌸`;
          return (
            <div key={o.id} className={`${t.card} border rounded-2xl p-4`}>
              {o.source==="store" && <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-semibold mb-2 inline-block">🛍️ Store Order</span>}
              <div className="flex justify-between items-start">
                <div style={{flex:1,minWidth:0}}>
                  <div className={`font-bold ${t.text}`}>{o.customer} <span className={`text-xs font-normal ${t.sub}`}>#{inv}</span></div>
                  <div className={`text-xs ${t.sub} flex items-center gap-1`}>
                    <span>{o.phone}</span>
                    <button onClick={()=>copyPhone(o.phone)} className="text-pink-400 text-xs">{copied===o.phone?"✓":"📋"}</button>
                    {o.place && <span>· {o.place}</span>}
                  </div>
                  <div className={`text-xs ${t.sub}`}>{o.date}{o.deliveryDate?` → 🚚 ${o.deliveryDate}`:""}</div>
                  <div style={{marginTop:6}}>
                    {items.map((it,idx)=>(
                      <div key={idx} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span className={t.text}>• {it.product}{it.color&&<span style={{color:"#db2777",fontWeight:600}}> ({it.color})</span>} ×{it.qty}</span>
                        <span style={{fontWeight:600,marginLeft:8}}>৳{(+it.subtotal||0).toLocaleString()}</span>
                      </div>
                    ))}
                    {items.length > 1 && <div className={`text-xs mt-1 italic ${t.sub}`}>{items.length} items in this order</div>}
                  </div>
                  {o.note && <div className="text-xs text-pink-400 italic mt-1">"{o.note}"</div>}
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <div className="text-pink-500 font-bold">৳{(+o.price||0).toLocaleString()}</div>
                  {(+o.discount)>0 && <div className={`text-xs ${t.sub}`}>−৳{o.discount}</div>}
                  <div className="text-green-500 text-xs">Paid: ৳{(+o.paid||0).toLocaleString()}</div>
                  {(+o.price||0)-(+o.paid||0)>0 && <div className="text-red-400 text-xs">Due: ৳{Math.max(0,(+o.price||0)-(+o.paid||0)).toLocaleString()}</div>}
                </div>
              </div>
              <div className="flex gap-2 mt-3 items-center flex-wrap">
                <span className={`text-xs rounded-full px-2 py-0.5 font-semibold ${t.statusColors[o.status]||t.pill}`}>{o.status}</span>
                <select className={`text-xs border rounded-lg px-1.5 py-0.5 ${t.input}`} value={o.status} onChange={e=>chgSt(o.id,e.target.value)}>
                  {getCfg(data,"orderStatuses",ORDER_STATUSES).map(s=><option key={s}>{s}</option>)}
                </select>
                <div className="ml-auto flex gap-2 flex-wrap">
                  <a href={waLink(o.phone,waMsg)} target="_blank" rel="noopener noreferrer" className="text-xs text-green-500">💬 WA</a>
                  <button onClick={()=>showReport(buildReceipt(o))} className="text-xs text-orange-400">🧾</button>
                  <button onClick={()=>{setEditOrder(o);setModal(true);}} className="text-xs text-blue-400">✏️</button>
                  <button onClick={()=>setCDel(o.id)} className="text-xs text-red-400">🗑️</button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length===0 && <Empty icon="📦" text="No orders found" t={t} />}
      </div>

      {modal && <OrderModal data={data} editOrder={editOrder} onSave={save} onClose={()=>{setModal(false);setEditOrder(null);}} t={t} />}
      {cDel && <Confirm msg="Archive & remove this order? It will still appear in historical reports." onConfirm={()=>del(cDel)} onCancel={()=>setCDel(null)} t={t} />}
      {confirmBulk && <Confirm msg={`Archive all ${deliveredCount} delivered orders? They will still appear in reports.`} onConfirm={bulkArchiveDelivered} onCancel={()=>setConfirmBulk(false)} t={t} />}
    </div>
  );
}

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────
function Customers({ data, t, showReport }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("spent");
  const [viewC,  setViewC]  = useState(null);

  const custMap = {};
  (data.orders||[]).forEach(o=>{
    if(!custMap[o.phone]) custMap[o.phone]={name:o.customer,phone:o.phone,orders:[],place:o.place};
    custMap[o.phone].orders.push(o);
  });
  let cs = Object.values(custMap).map(c=>{
    const tS=c.orders.reduce((a,o)=>a+o.price,0), tP=c.orders.reduce((a,o)=>a+o.paid,0);
    const last=[...c.orders].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    return{...c,tS,tP,due:tS-tP,last,cnt:c.orders.length};
  }).filter(c=>c.name.toLowerCase().includes(search.toLowerCase())||c.phone.includes(search));
  if (sortBy==="spent")  cs.sort((a,b)=>b.tP-a.tP);
  else if (sortBy==="orders") cs.sort((a,b)=>b.cnt-a.cnt);
  else                   cs.sort((a,b)=>new Date(b.last?.date||0)-new Date(a.last?.date||0));

  return (
    <div>
      <SecHdr icon="👩" title="Customers / কাস্টমার" sub={`${cs.length} unique customers`} t={t} extra={<PBtn onClick={()=>showReport(buildCustomerReport(data.orders||[]))} />} />
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Total</div><div className="font-bold text-lg text-pink-500">{cs.length}</div></div>
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Repeat</div><div className="font-bold text-lg text-purple-500">{cs.filter(c=>c.cnt>1).length}</div></div>
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Top</div><div className="font-bold text-xs text-green-500 truncate">{cs[0]?.name||"—"}</div></div>
      </div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search by name or phone..." t={t} />
      <div className="flex justify-end mb-3">
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className={`text-xs border rounded-xl px-3 py-1.5 ${t.input}`}>
          <option value="spent">By Spending</option><option value="orders">By Orders</option><option value="recent">By Recent</option>
        </select>
      </div>
      <div className="flex flex-col gap-3">
        {cs.map((c,i)=>{
          const waMsg=`Hello ${c.name}! Thank you for shopping at *${APP_NAME}*. 🌸 We have new arrivals!`;
          return (
            <div key={c.phone} className={`${t.card} border rounded-2xl p-4 cursor-pointer`} onClick={()=>setViewC(c)}>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0 ${i===0?"bg-yellow-500":i===1?"bg-gray-400":i===2?"bg-orange-400":"bg-pink-500"}`}>
                    {i===0?"🥇":i===1?"🥈":i===2?"🥉":c.name[0].toUpperCase()}
                  </div>
                  <div>
                    <div className={`font-bold text-sm ${t.text}`}>{c.name}</div>
                    <div className={`text-xs ${t.sub}`}>{c.phone}</div>
                    <div className={`text-xs ${t.sub}`}>{c.cnt} orders · Last: {c.last?.date}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-green-500 font-bold text-sm">৳{c.tP.toLocaleString()}</div>
                  {c.due>0 && <div className="text-red-400 text-xs">Due: ৳{c.due.toLocaleString()}</div>}
                  <a href={waLink(c.phone,waMsg)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-xs text-green-500 mt-1 inline-block">💬 WA</a>
                </div>
              </div>
            </div>
          );
        })}
        {cs.length===0 && <Empty icon="👩" text="No customers found" t={t} />}
      </div>
      {viewC && (
        <Modal title={viewC.name} onClose={()=>setViewC(null)} wide t={t}>
          <div className={`${t.blue} border rounded-xl p-3 mb-3`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className={`text-xs ${t.sub}`}>Orders</div><div className="font-bold text-lg">{viewC.cnt}</div></div>
              <div><div className={`text-xs ${t.sub}`}>Spent</div><div className="font-bold text-lg text-green-500">৳{viewC.tP.toLocaleString()}</div></div>
              <div><div className={`text-xs ${t.sub}`}>Due</div><div className="font-bold text-lg text-red-400">৳{viewC.due.toLocaleString()}</div></div>
            </div>
          </div>
          <div className={`text-xs ${t.sub} mb-3`}>{viewC.phone} · {viewC.place}</div>
          <div className="flex flex-col gap-2">
            {viewC.orders.map(o=>(
              <div key={o.id} className={`${t.card} border rounded-xl p-3`}>
                <div className="flex justify-between"><span className={`font-semibold text-sm ${t.text}`}>{o.product} × {o.qty}</span><span className="text-pink-500 font-bold">৳{o.price.toLocaleString()}</span></div>
                <div className={`text-xs ${t.sub} mt-0.5`}>{o.date}</div>
                <span className={`text-xs rounded-full px-2 py-0.5 font-semibold mt-1 inline-block ${t.statusColors[o.status]||t.pill}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── MONEY ────────────────────────────────────────────────────────────────────
const BM = { type:"owe", name:"", amount:"", note:"", date:new Date().toISOString().split("T")[0], dueDate:"" };
const BE = { category:"Rent", amount:"", note:"", date:new Date().toISOString().split("T")[0] };

function Money({ data, setData, t, showReport }) {
  const [modal,   setModal]   = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [form,    setForm]    = useState(BM);
  const [tab,     setTab]     = useState("owe");
  const [cDel,    setCDel]    = useState(null);
  const [showExp, setShowExp] = useState(false);
  const [expF,    setExpF]    = useState(BE);
  const sf  = (k,v) => setForm(p=>({...p,[k]:v}));
  const sef = (k,v) => setExpF(p=>({...p,[k]:v}));

  const save = () => {
    if (!form.name||!form.amount) return;
    const row = {...form,amount:+form.amount};
    if (editId) setData(p=>({...p,money:p.money.map(x=>x.id===editId?{...row,id:editId}:x)}));
    else        setData(p=>({...p,money:[...p.money,{...row,id:Date.now()}]}));
    setForm(BM); setEditId(null); setModal(false);
  };

  const del = (id) => {
    setData(p=>{
      const toArchive = p.money.find(x=>x.id===id);
      if (!toArchive) return p;
      return { ...p, money:p.money.filter(x=>x.id!==id), archivedMoney:[...(p.archivedMoney||[]),{...toArchive,_archived:new Date().toISOString().split("T")[0]}] };
    });
    setCDel(null);
  };

  const addExp = () => {
    if (!expF.amount) return;
    setData(p=>({...p,expenses:[...(p.expenses||[]),{...expF,amount:+expF.amount,id:Date.now()}]}));
    setExpF(BE); setShowExp(false);
  };

  const owe   = (data.money||[]).filter(m=>m.type==="owe");
  const recv  = (data.money||[]).filter(m=>m.type==="receivable");
  const exp   = data.expenses || [];
  const tO    = owe.reduce((a,m)=>a+m.amount,0);
  const tR    = recv.reduce((a,m)=>a+m.amount,0);
  const tE    = exp.reduce((a,e)=>a+e.amount,0);
  const display = tab==="owe" ? owe : recv;

  return (
    <div>
      <SecHdr icon="💰" title="Money / টাকা" sub={`Owe: ৳${tO.toLocaleString()} · Receivable: ৳${tR.toLocaleString()}`}
        onAdd={()=>{setForm({...BM,type:tab==="receivable"?"receivable":"owe"});setEditId(null);setModal(true);}} addLabel="+ Add" t={t}
        extra={<PBtn onClick={()=>showReport(buildMoneyReport(data))} />}
      />
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>I Owe</div><div className="text-red-400 font-bold text-lg">৳{tO.toLocaleString()}</div></div>
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Receivable</div><div className="text-green-500 font-bold text-lg">৳{tR.toLocaleString()}</div></div>
        <div className={`${t.card} border rounded-xl p-3 text-center`}><div className={`text-xs ${t.sub}`}>Expenses</div><div className="text-orange-400 font-bold text-lg">৳{tE.toLocaleString()}</div></div>
      </div>
      <Pills options={["owe","receivable"]} value={tab} onChange={setTab} t={t} />
      <div className="flex flex-col gap-3 mb-4">
        {display.map(m=>(
          <div key={m.id} className={`${t.card} border rounded-2xl p-4`}>
            <div className="flex justify-between items-start">
              <div>
                <div className={`font-bold ${t.text}`}>{m.name}</div>
                <div className={`text-xs ${t.sub}`}>{m.note}</div>
                <div className={`text-xs ${t.sub}`}>{m.date}{m.dueDate?` · Due: ${m.dueDate}`:""}</div>
              </div>
              <div className="text-right">
                <div className={`font-bold text-lg ${m.type==="owe"?"text-red-400":"text-green-500"}`}>৳{m.amount.toLocaleString()}</div>
                <div className="flex gap-2 mt-1">
                  <button onClick={()=>{setForm({...m});setEditId(m.id);setModal(true);}} className="text-xs text-blue-400">✏️</button>
                  <button onClick={()=>setCDel(m.id)} className="text-xs text-red-400">🗑️</button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {display.length===0 && <Empty icon="💸" text="Nothing here" t={t} />}
      </div>

      <div className={`font-bold text-sm mb-2 ${t.text}`}>📋 Expenses <span className={`${t.sub} font-normal`}>৳{tE.toLocaleString()}</span></div>
      {exp.map(e=>(
        <div key={e.id} className={`${t.card} border rounded-xl p-3 flex justify-between items-center mb-2`}>
          <div><div className={`font-semibold text-sm ${t.text}`}>{e.category}</div><div className={`text-xs ${t.sub}`}>{e.note} · {e.date}</div></div>
          <div className="flex items-center gap-2">
            <span className="text-orange-400 font-bold">৳{e.amount.toLocaleString()}</span>
            <button onClick={()=>setData(p=>({...p,expenses:p.expenses.filter(x=>x.id!==e.id),archivedExpenses:[...(p.archivedExpenses||[]),{...e,_archived:new Date().toISOString().split("T")[0]}]}))} className="text-xs text-red-400">🗑️</button>
          </div>
        </div>
      ))}
      {showExp ? (
        <div className={`${t.card} border rounded-xl p-3 mt-2`}>
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Category" value={expF.category} onChange={e=>sef("category",e.target.value)} t={t}>
              {getCfg(data,"expenseCategories",EXPENSE_CATS).map(c=><option key={c}>{c}</option>)}
            </Sel>
            <Inp label="Amount ৳" type="number" min="0" value={expF.amount} onChange={e=>sef("amount",e.target.value)} t={t} />
          </div>
          <Inp label="Note" value={expF.note} onChange={e=>sef("note",e.target.value)} t={t} />
          <Inp label="Date" type="date" value={expF.date} onChange={e=>sef("date",e.target.value)} t={t} />
          <div className="flex gap-2"><Btn sm onClick={addExp}>Add</Btn><Btn sm color="gray" onClick={()=>setShowExp(false)}>Cancel</Btn></div>
        </div>
      ) : <button onClick={()=>setShowExp(true)} className="text-xs text-pink-500 hover:text-pink-600 mt-1">+ Add Expense</button>}

      {modal && (
        <Modal title={editId?"Edit Entry":"Add Money Entry"} onClose={()=>setModal(false)} t={t}>
          <Sel label="Type" value={form.type} onChange={e=>sf("type",e.target.value)} t={t}>
            <option value="owe">I Owe</option><option value="receivable">Owed to Me</option>
          </Sel>
          <Inp label="Name / নাম" value={form.name}   onChange={e=>sf("name",e.target.value)}   t={t} />
          <Inp label="Amount ৳"   type="number" min="0" value={form.amount} onChange={e=>sf("amount",e.target.value)} t={t} />
          <Inp label="Note"       value={form.note}   onChange={e=>sf("note",e.target.value)}   t={t} />
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Date"     type="date" value={form.date}    onChange={e=>sf("date",e.target.value)}    t={t} />
            <Inp label="Due Date" type="date" value={form.dueDate} onChange={e=>sf("dueDate",e.target.value)} t={t} />
          </div>
          <div className="flex gap-2"><Btn onClick={save}>{editId?"Save":"Add"}</Btn><Btn color="gray" onClick={()=>setModal(false)}>Cancel</Btn></div>
        </Modal>
      )}
      {cDel && <Confirm msg="Remove this entry?" onConfirm={()=>del(cDel)} onCancel={()=>setCDel(null)} t={t} />}
    </div>
  );
}

// ─── MATERIALS ────────────────────────────────────────────────────────────────
const BT = { name:"",nameBn:"",supplier:"",qty:"",unit:"pcs",cost:"",date:new Date().toISOString().split("T")[0],minStock:"" };

function Materials({ data, setData, t, showReport }) {
  const [modal,  setModal]  = useState(false);
  const [editId, setEditId] = useState(null);
  const [form,   setForm]   = useState(BT);
  const [search, setSearch] = useState("");
  const [cDel,   setCDel]   = useState(null);
  const [adj,    setAdj]    = useState(null);
  const [adjQty, setAdjQty] = useState("");
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = () => {
    if (!form.name) return;
    const row = {...form,qty:+form.qty,cost:+form.cost,minStock:+form.minStock||0,history:form.history||[]};
    if (editId) setData(p=>({...p,materials:p.materials.map(x=>x.id===editId?{...row,id:editId}:x)}));
    else        setData(p=>({...p,materials:[...p.materials,{...row,id:Date.now()}]}));
    setForm(BT); setEditId(null); setModal(false);
  };

  const del = (id) => {
    setData(p=>{
      const toArchive = p.materials.find(x=>x.id===id);
      if (!toArchive) return p;
      return { ...p, materials:p.materials.filter(x=>x.id!==id), archivedMaterials:[...(p.archivedMaterials||[]),{...toArchive,_archived:new Date().toISOString().split("T")[0]}] };
    });
    setCDel(null);
  };

  const doAdj = (matId, delta, note) => {
    setData(p=>{
      const mat = p.materials.find(x=>x.id===matId); if(!mat) return p;
      const nq  = Math.max(0, mat.qty+delta);
      const e   = {date:new Date().toISOString().split("T")[0],change:delta,note:note||"Adjustment",after:nq};
      return {...p, materials:p.materials.map(x=>x.id===matId?{...x,qty:nq,history:[...(x.history||[]),e]}:x)};
    });
    setAdj(null); setAdjQty("");
  };

  const mats    = (data.materials||[]).filter(m=>m.name.toLowerCase().includes(search.toLowerCase()));
  const liveAdj = adj ? (data.materials||[]).find(x=>x.id===adj.id)||adj : null;

  return (
    <div>
      <SecHdr icon="🧵" title="Stock / কাঁচামাল" sub={`৳${(data.materials||[]).reduce((a,m)=>a+m.cost,0).toLocaleString()}`}
        onAdd={()=>{setForm(BT);setEditId(null);setModal(true);}} addLabel="+ Add" t={t}
        extra={<PBtn onClick={()=>showReport(buildMaterialsReport(data.materials||[]))} />}
      />
      <SearchBar value={search} onChange={setSearch} placeholder="Search materials..." t={t} />
      <div className="flex flex-col gap-3">
        {mats.map(m=>(
          <div key={m.id} className={`${t.card} border rounded-2xl p-4`}>
            <div className="flex justify-between items-start">
              <div>
                <div className={`font-bold ${t.text}`}>{m.name} <span className={`font-normal text-xs ${t.sub}`}>({m.nameBn})</span></div>
                <div className={`text-xs ${t.sub}`}>{m.supplier} · {m.date}</div>
                <div className={`text-xs mt-0.5 ${m.minStock&&m.qty<=m.minStock?"text-red-400":t.sub}`}>{m.qty} {m.unit}{m.minStock&&m.qty<=m.minStock?" ⚠️ Low":""}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-pink-500 font-bold">৳{m.cost.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button onClick={()=>{setAdj(m);setAdjQty("");}} className={`text-xs px-2 py-0.5 rounded-full border ${t.green}`}>+/− Stock</button>
                  <button onClick={()=>{setForm({...m});setEditId(m.id);setModal(true);}} className="text-xs text-blue-400">✏️</button>
                  <button onClick={()=>setCDel(m.id)} className="text-xs text-red-400">🗑️</button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {mats.length===0 && <Empty icon="🧵" text="No materials" t={t} />}
      </div>

      {liveAdj && (
        <Modal title={`Adjust — ${liveAdj.name}`} onClose={()=>setAdj(null)} t={t}>
          <div className="text-center mb-3">
            <div className={`text-3xl font-bold ${t.text}`}>{liveAdj.qty} {liveAdj.unit}</div>
            <div className={`text-xs ${t.sub}`}>Current Stock</div>
          </div>
          <Inp label="Change (use − to decrease, e.g. -20)" type="number" value={adjQty} onChange={e=>setAdjQty(e.target.value)} t={t} />
          <div className={`${t.yellow} border rounded-xl p-2 mb-3 text-xs text-center`}>New: <strong>{Math.max(0,liveAdj.qty+(+adjQty||0))} {liveAdj.unit}</strong></div>
          <div className="flex gap-2 flex-wrap">
            <Btn color="green" onClick={()=>doAdj(liveAdj.id,+adjQty||0,"Adjusted")}>✓ Confirm</Btn>
            <Btn sm color="gray" onClick={()=>doAdj(liveAdj.id,+adjQty||0,"Used")}>🔧 Used</Btn>
            <Btn sm color="gray" onClick={()=>doAdj(liveAdj.id,+adjQty||0,"Bought")}>🛒 Bought</Btn>
            <Btn color="gray" onClick={()=>setAdj(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}
      {modal && (
        <Modal title={editId?"Edit Material":"Add Material"} onClose={()=>setModal(false)} t={t}>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Name (English)" value={form.name}   onChange={e=>sf("name",e.target.value)}   t={t} />
            <Inp label="Name (বাংলা)"   value={form.nameBn} onChange={e=>sf("nameBn",e.target.value)} t={t} />
          </div>
          <Inp label="Supplier" value={form.supplier} onChange={e=>sf("supplier",e.target.value)} t={t} />
          <div className="grid grid-cols-3 gap-2">
            <Inp label="Qty"       type="number" min="0" value={form.qty}      onChange={e=>sf("qty",e.target.value)}      t={t} />
            <Sel label="Unit"      value={form.unit}     onChange={e=>sf("unit",e.target.value)}     t={t}>
              {getCfg(data,"materialUnits",["pcs","kg","g","meter","bundle","packet","roll","liter"]).map(u=><option key={u}>{u}</option>)}
            </Sel>
            <Inp label="Min Stock" type="number" min="0" value={form.minStock} onChange={e=>sf("minStock",e.target.value)} t={t} />
          </div>
          <Inp label="Total Cost ৳" type="number" min="0" value={form.cost} onChange={e=>sf("cost",e.target.value)} t={t} />
          <Inp label="Date" type="date" value={form.date} onChange={e=>sf("date",e.target.value)} t={t} />
          <div className="flex gap-2"><Btn onClick={save}>{editId?"Save":"Add"}</Btn><Btn color="gray" onClick={()=>setModal(false)}>Cancel</Btn></div>
        </Modal>
      )}
      {cDel && <Confirm msg="Delete this material?" onConfirm={()=>del(cDel)} onCancel={()=>setCDel(null)} t={t} />}
    </div>
  );
}

// ─── WORKERS ──────────────────────────────────────────────────────────────────
const BW = { name:"",phone:"",role:"",salary:"",joined:new Date().toISOString().split("T")[0],status:"Active",tasks:"",nid:"",advance:"" };

function Workers({ data, setData, t, showReport }) {
  const [modal, setModal] = useState(false);
  const [editId,setEditId]= useState(null);
  const [form,  setForm]  = useState(BW);
  const [payM,  setPayM]  = useState(null);
  const [cDel,  setCDel]  = useState(null);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = () => {
    if (!form.name) return;
    const row = {...form,salary:+form.salary,advance:+form.advance||0};
    if (editId) setData(p=>({...p,workers:p.workers.map(x=>x.id===editId?{...row,id:editId}:x)}));
    else        setData(p=>({...p,workers:[...p.workers,{...row,id:Date.now()}]}));
    setForm(BW); setEditId(null); setModal(false);
  };

  const del = (id) => {
    setData(p=>{
      const toArchive = p.workers.find(x=>x.id===id);
      if (!toArchive) return p;
      return { ...p, workers:p.workers.filter(x=>x.id!==id), archivedWorkers:[...(p.archivedWorkers||[]),{...toArchive,_archived:new Date().toISOString().split("T")[0]}] };
    });
    setCDel(null);
  };

  const tSal = (data.workers||[]).filter(w=>w.status==="Active").reduce((a,w)=>a+w.salary,0);

  return (
    <div>
      <SecHdr icon="👷" title="Workers / কর্মী" sub={`Payroll: ৳${tSal.toLocaleString()}/mo`}
        onAdd={()=>{setForm(BW);setEditId(null);setModal(true);}} addLabel="+ Add Worker" t={t}
        extra={<PBtn onClick={()=>showReport(buildWorkerReport(data.workers||[]))} />}
      />
      <div className="flex flex-col gap-3">
        {(data.workers||[]).map(w=>{
          const waMsg=`Hello ${w.name}! Your salary of ৳${w.salary.toLocaleString()} from *${APP_NAME}* is ready${+w.advance>0?` (−৳${w.advance} advance = ৳${w.salary-w.advance})`:""}. Thank you!`;
          return (
            <div key={w.id} className={`${t.card} border rounded-2xl p-4`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className={`font-bold ${t.text}`}>{w.name}</div>
                  <div className={`text-xs ${t.sub}`}>{w.phone} · {w.role} · Since {w.joined}</div>
                  {w.tasks && <div className={`text-xs ${t.sub} mt-0.5`}>📋 {w.tasks}</div>}
                  <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block border ${w.status==="Active"?t.green:t.pill}`}>{w.status}</span>
                </div>
                <div className="text-right">
                  <div className="text-pink-500 font-bold">৳{w.salary.toLocaleString()}/mo</div>
                  {+w.advance>0 && <div className="text-xs text-orange-400">Advance: ৳{w.advance}</div>}
                  <div className="text-xs text-green-400">Net: ৳{(w.salary-(+w.advance||0)).toLocaleString()}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                <button onClick={()=>{setForm({...w});setEditId(w.id);setModal(true);}} className="text-xs text-blue-400">✏️ Edit</button>
                <button onClick={()=>setPayM(w)} className={`text-xs px-2 py-0.5 rounded-full border ${t.green}`}>💸 Pay</button>
                <a href={waLink(w.phone,waMsg)} target="_blank" rel="noopener noreferrer" className="text-xs text-green-500">💬 WA</a>
                <button onClick={()=>setCDel(w.id)} className="text-xs text-red-400 ml-auto">🗑️</button>
              </div>
            </div>
          );
        })}
        {!(data.workers||[]).length && <Empty icon="👷" text="No workers added" t={t} />}
      </div>

      {modal && (
        <Modal title={editId?"Edit Worker":"Add Worker"} onClose={()=>setModal(false)} t={t}>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Name"  value={form.name}  onChange={e=>sf("name",e.target.value)}  t={t} />
            <Inp label="Phone" value={form.phone} onChange={e=>sf("phone",e.target.value)} t={t} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Sel label="Role" value={form.role} onChange={e=>sf("role",e.target.value)} t={t}>
              {getCfg(data,"workerRoles",["Maker","Packager","Designer","Helper","Manager"]).map(r=><option key={r}>{r}</option>)}
            </Sel>
            <Inp label="Monthly Salary ৳" type="number" min="0" value={form.salary} onChange={e=>sf("salary",e.target.value)} t={t} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Inp label="Joining Date" type="date" value={form.joined}  onChange={e=>sf("joined",e.target.value)}  t={t} />
            <Inp label="Advance ৳"    type="number" min="0" value={form.advance} onChange={e=>sf("advance",e.target.value)} t={t} />
          </div>
          <Inp label="NID" value={form.nid} onChange={e=>sf("nid",e.target.value)} t={t} />
          <Txtarea label="Tasks" value={form.tasks} onChange={e=>sf("tasks",e.target.value)} t={t} />
          <Sel label="Status" value={form.status} onChange={e=>sf("status",e.target.value)} t={t}>
            <option>Active</option><option>Inactive</option>
          </Sel>
          <div className="flex gap-2"><Btn onClick={save}>{editId?"Save":"Add Worker"}</Btn><Btn color="gray" onClick={()=>setModal(false)}>Cancel</Btn></div>
        </Modal>
      )}
      {payM && (
        <Modal title={`Pay — ${payM.name}`} onClose={()=>setPayM(null)} t={t}>
          <div className="text-center py-4">
            <div className="text-5xl mb-2">💸</div>
            <div className={`text-lg font-bold ${t.text}`}>{payM.name} · {payM.role}</div>
            <div className="text-pink-500 font-bold text-2xl mt-2">৳{payM.salary.toLocaleString()}</div>
            {+payM.advance>0 && <div className="text-orange-400 text-sm">− Advance ৳{payM.advance} = <span className="text-green-400 font-bold">৳{payM.salary-payM.advance}</span></div>}
            <div className="flex gap-2 mt-5 justify-center">
              <Btn color="green" onClick={()=>setPayM(null)}>✓ Confirm Paid</Btn>
              <Btn color="gray" onClick={()=>setPayM(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
      {cDel && <Confirm msg="Remove this worker?" onConfirm={()=>del(cDel)} onCancel={()=>setCDel(null)} t={t} />}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function Reports({ data, t, showReport }) {
  const allOrders = [...(data.orders||[]), ...(data.archivedOrders||[])];
  const rev    = allOrders.reduce((a,o)=>a+(+o.paid||0),0);
  const iO     = (data.money||[]).filter(m=>m.type==="owe").reduce((a,m)=>a+m.amount,0);
  const sal    = (data.workers||[]).filter(w=>w.status==="Active").reduce((a,w)=>a+w.salary,0);
  const mat    = (data.materials||[]).reduce((a,m)=>a+m.cost,0);
  const exp    = (data.expenses||[]).reduce((a,e)=>a+e.amount,0);
  const profit = rev - sal - mat - exp - iO;

  const today        = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0,8)+"01";
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo,   setDateTo]   = useState(today);

  const inRange     = o => { const d=new Date(o.date||o._archived); return d>=new Date(dateFrom)&&d<=new Date(dateTo); };
  const rangeOrders = allOrders.filter(inRange);

  const cards = [
    {icon:"📊",label:"Full Business",  desc:"All time overview",   fn:()=>showReport(buildFullReport({...data,orders:allOrders}))},
    {icon:"📅",label:"Custom Range",   desc:"Date range report",   fn:()=>showReport(buildOrdersReport(rangeOrders,`Report: ${dateFrom} → ${dateTo}`))},
    {icon:"📦",label:"All Orders",     desc:"Active + archived",   fn:()=>showReport(buildOrdersReport(allOrders,"All Orders (incl. archived)"))},
    {icon:"💰",label:"Money",          desc:"Cash flow & debts",   fn:()=>showReport(buildMoneyReport({...data,orders:allOrders}))},
    {icon:"👩",label:"Customers",      desc:"Customer analysis",   fn:()=>showReport(buildCustomerReport(allOrders))},
    {icon:"👷",label:"Workers",        desc:"Salary & payroll",    fn:()=>showReport(buildWorkerReport(data.workers||[]))},
    {icon:"🌸",label:"Catalogue",      desc:"Product list",        fn:()=>showReport(buildCatalogue(data.products||[]))},
    {icon:"🧵",label:"Materials",      desc:"Stock overview",      fn:()=>showReport(buildMaterialsReport(data.materials||[]))},
  ];

  return (
    <div>
      <SecHdr icon="📊" title="Reports / রিপোর্ট" sub="Includes archived orders in all reports" t={t} />

      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[["৳"+rev.toLocaleString(),"Total Revenue","text-green-500"],["৳"+Math.abs(profit).toLocaleString(),profit>=0?"Profit":"Loss",profit>=0?"text-green-500":"text-red-500"],[allOrders.length,"All Orders","text-blue-500"]].map(([v,l,cl])=>(
            <div key={l}><div className={`text-lg font-bold ${cl}`}>{v}</div><div className={`text-xs ${t.sub}`}>{l}</div></div>
          ))}
        </div>
        {(data.archivedOrders||[]).length > 0 && (
          <div className={`text-xs text-center mt-2 ${t.sub}`}>
            📦 {(data.orders||[]).length} active + 🗃️ {(data.archivedOrders||[]).length} archived orders
          </div>
        )}
      </div>

      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className={`text-sm font-bold mb-3 ${t.text}`}>📅 Custom Date Range Report</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className={`block text-xs ${t.sub} mb-1`}>From</label>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className={`w-full border rounded-xl px-3 py-2 text-sm ${t.input}`} style={{fontSize:14}} />
          </div>
          <div>
            <label className={`block text-xs ${t.sub} mb-1`}>To</label>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className={`w-full border rounded-xl px-3 py-2 text-sm ${t.input}`} style={{fontSize:14}} />
          </div>
        </div>
        <div className={`text-xs ${t.sub} mb-3`}>
          Found <strong>{rangeOrders.length}</strong> orders · Revenue: <strong className="text-green-500">৳{rangeOrders.reduce((a,o)=>a+(+o.paid||0),0).toLocaleString()}</strong>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[["This Month",firstOfMonth,today],["Last 7 days",new Date(Date.now()-7*864e5).toISOString().split("T")[0],today],["Last 30 days",new Date(Date.now()-30*864e5).toISOString().split("T")[0],today]].map(([label,from,to])=>(
            <button key={label} onClick={()=>{setDateFrom(from);setDateTo(to);}} className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition ${t.pill}`}>{label}</button>
          ))}
        </div>
        <button onClick={()=>showReport(buildOrdersReport(rangeOrders,`Report ${dateFrom} → ${dateTo}`))}
          className="mt-3 w-full bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold rounded-xl py-2 transition">
          🖨️ Generate Range Report
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {cards.map(c=>(
          <button key={c.label} onClick={c.fn} className={`${t.card} border rounded-2xl p-4 text-left hover:shadow-md transition hover:border-pink-300`}>
            <div className="text-3xl mb-2">{c.icon}</div>
            <div className={`font-bold text-sm ${t.text}`}>{c.label}</div>
            <div className={`text-xs ${t.sub} mt-0.5`}>{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── SERVICE SETTINGS (Code 2 addition — live ImageKit config editor) ─────────
function ServiceSettings({ data, onSave }) {
  const cfg = data.appConfig?.services || INIT_DATA.appConfig.services;
  const [form,  setForm]  = useState({ ...cfg });
  const [saved, setSaved] = useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const save = () => {
    applyServicesConfig({ services: form }); // apply immediately to live configStore
    onSave(form);
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const testImageKit = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("/api/imagekit-auth");
      if (res.ok) {
        const { token } = await res.json();
        setTestResult(token ? { ok:true, msg:"✅ ImageKit auth endpoint working!" } : { ok:false, msg:"⚠️ Auth endpoint returned no token." });
      } else {
        setTestResult({ ok:false, msg:`❌ Auth endpoint returned HTTP ${res.status}` });
      }
    } catch(e) {
      setTestResult({ ok:false, msg:`❌ Network error: ${e.message}` });
    }
    setTesting(false);
  };

  const fields = [
    { key:"imagekitPublicKey",   label:"Public Key",    placeholder:"public_XXXXXXXXXXXX" },
    { key:"imagekitUrlEndpoint", label:"URL Endpoint",  placeholder:"https://ik.imagekit.io/yourID" },
    { key:"imagekitFolder",      label:"Upload Folder", placeholder:"/fk_fashion" },
    { key:"imagekitUploadUrl",   label:"Upload URL",    placeholder:"https://upload.imagekit.io/api/v1/files/upload" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className={`${getCfgValue("imagekitPublicKey")!=="your_public_key_here"?"bg-green-50 border-green-200":"bg-amber-50 border-amber-200"} border rounded-xl p-4`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{getCfgValue("imagekitPublicKey")!=="your_public_key_here"?"✅":"⚠️"}</span>
          <span className={`text-sm font-semibold ${getCfgValue("imagekitPublicKey")!=="your_public_key_here"?"text-green-700":"text-amber-700"}`}>
            {getCfgValue("imagekitPublicKey")!=="your_public_key_here"?"ImageKit configured — CDN uploads active":"ImageKit not configured — using local base64 fallback"}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Changes here update the live app immediately without a reload.</p>
      </div>

      {fields.map(f=>(
        <div key={f.key}>
          <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
          <input value={form[f.key]||""} onChange={e=>sf(f.key,e.target.value)} placeholder={f.placeholder}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 font-mono"
            style={{fontSize:13,background:"#fff",borderColor:"#d1d5db"}} />
        </div>
      ))}

      <div className="flex gap-2 flex-wrap">
        <button onClick={save}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${saved?"bg-green-500":"bg-pink-600"} text-white transition`}>
          {saved?"✓ Saved & Applied!":"💾 Save & Apply"}
        </button>
        <button onClick={testImageKit} disabled={testing}
          className="px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white transition disabled:opacity-50">
          {testing?"Testing...":"🧪 Test"}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-xl p-3 text-sm font-semibold ${testResult.ok?"bg-green-50 text-green-700 border border-green-200":"bg-red-50 text-red-700 border border-red-200"}`}>
          {testResult.msg}
        </div>
      )}

      <div className="text-xs text-gray-400 bg-gray-50 rounded-xl p-3 leading-relaxed">
        <strong>How to set up ImageKit:</strong><br/>
        1. Sign up free at <strong>imagekit.io</strong><br/>
        2. Enable <strong>unsigned uploads</strong> in Settings → Upload API<br/>
        3. Copy your Public Key & URL Endpoint from the dashboard<br/>
        4. Deploy <code>/api/imagekit-auth</code> serverless function with your private key<br/>
        5. Save here — uploads will go to CDN automatically
      </div>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function Settings({ data, setData, t }) {
  const [waNum,            setWaNum]           = useState(data.settings?.waNumber||ADMIN_WA_NUMBER);
  const [waNumSaved,       setWaNumSaved]      = useState(false);
  const [delArchiveId,     setDelArchiveId]    = useState(null);
  const [archiveTab,       setArchiveTab]      = useState("orders");
  const [activeSettingsTab,setActiveSettingsTab]=useState("general");

  const saveWaNum = () => {
    setData(p=>({...p,settings:{...(p.settings||{}),waNumber:waNum.trim()}}));
    setWaNumSaved(true); setTimeout(()=>setWaNumSaved(false),2000);
  };

  const deleteFromArchive = (id) => {
    setData(p=>({...p,archivedOrders:(p.archivedOrders||[]).filter(o=>o.id!==id)}));
    setDelArchiveId(null);
  };
  const restoreFromArchive = (id) => {
    setData(p=>{
      const order=(p.archivedOrders||[]).find(o=>o.id===id); if(!order) return p;
      const{_archived,...clean}=order;
      return{...p,orders:[...p.orders,clean],archivedOrders:(p.archivedOrders||[]).filter(o=>o.id!==id)};
    });
  };

  const archived         = data.archivedOrders    || [];
  const archivedProducts = data.archivedProducts  || [];
  const archivedMaterials= data.archivedMaterials || [];
  const archivedWorkers  = data.archivedWorkers   || [];
  const archivedExpenses = data.archivedExpenses  || [];
  const archivedMoney    = data.archivedMoney     || [];
  const totalArchived    = archived.length+archivedProducts.length+archivedMaterials.length+archivedWorkers.length+archivedExpenses.length+archivedMoney.length;

  const restoreProduct  = (id) => setData(p=>{const item=(p.archivedProducts||[]).find(x=>x.id===id);if(!item)return p;const{_archived,...clean}=item;return{...p,products:[...p.products,clean],archivedProducts:(p.archivedProducts||[]).filter(x=>x.id!==id)};});
  const deleteProduct   = (id) => setData(p=>({...p,archivedProducts:(p.archivedProducts||[]).filter(x=>x.id!==id)}));
  const restoreMaterial = (id) => setData(p=>{const item=(p.archivedMaterials||[]).find(x=>x.id===id);if(!item)return p;const{_archived,...clean}=item;return{...p,materials:[...p.materials,clean],archivedMaterials:(p.archivedMaterials||[]).filter(x=>x.id!==id)};});
  const deleteMaterial  = (id) => setData(p=>({...p,archivedMaterials:(p.archivedMaterials||[]).filter(x=>x.id!==id)}));
  const restoreWorker   = (id) => setData(p=>{const item=(p.archivedWorkers||[]).find(x=>x.id===id);if(!item)return p;const{_archived,...clean}=item;return{...p,workers:[...p.workers,clean],archivedWorkers:(p.archivedWorkers||[]).filter(x=>x.id!==id)};});
  const deleteWorker    = (id) => setData(p=>({...p,archivedWorkers:(p.archivedWorkers||[]).filter(x=>x.id!==id)}));
  const restoreMoney    = (id) => setData(p=>{const item=(p.archivedMoney||[]).find(x=>x.id===id);if(!item)return p;const{_archived,...clean}=item;return{...p,money:[...p.money,clean],archivedMoney:(p.archivedMoney||[]).filter(x=>x.id!==id)};});
  const deleteMoney     = (id) => setData(p=>({...p,archivedMoney:(p.archivedMoney||[]).filter(x=>x.id!==id)}));
  const restoreExpense  = (id) => setData(p=>{const item=(p.archivedExpenses||[]).find(x=>x.id===id);if(!item)return p;const{_archived,...clean}=item;return{...p,expenses:[...p.expenses,clean],archivedExpenses:(p.archivedExpenses||[]).filter(x=>x.id!==id)};});
  const deleteExpense   = (id) => setData(p=>({...p,archivedExpenses:(p.archivedExpenses||[]).filter(x=>x.id!==id)}));

  const SETTINGS_TABS = [
    {id:"general",  label:"⚙️ General"},
    {id:"services", label:"🔑 Services"},
    {id:"archive",  label:"🗃️ Archive"},
  ];

  const ArchiveSection = ({items, emptyIcon, emptyMsg, renderItem}) => (
    items.length===0
      ? <div className={`text-center py-6 ${t.sub} text-sm`}>{emptyIcon} {emptyMsg}</div>
      : <div className="flex flex-col gap-2">{items.slice().reverse().map(renderItem)}</div>
  );

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-pink-500">⚙️ Settings</h2>
        <p className={`text-xs ${t.sub} mt-0.5`}>App configuration & archive management</p>
      </div>

      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:16,scrollbarWidth:"none"}}>
        {SETTINGS_TABS.map(tb=>(
          <button key={tb.id} onClick={()=>setActiveSettingsTab(tb.id)}
            style={{flexShrink:0,fontSize:12,padding:"7px 16px",borderRadius:20,
              border:`1.5px solid ${activeSettingsTab===tb.id?"#db2777":"#fce7f3"}`,
              background:activeSettingsTab===tb.id?"#db2777":"transparent",
              color:activeSettingsTab===tb.id?"#fff":t.dark?"#9ca3af":"#6b7280",
              fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── GENERAL TAB ── */}
      {activeSettingsTab==="general" && (
        <>
          <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
            <div className={`font-bold text-sm mb-1 ${t.text}`}>💬 Admin WhatsApp Number</div>
            <p className={`text-xs ${t.sub} mb-3`}>Used for order confirmations from the customer store.</p>
            <div className="flex gap-2 items-center">
              <input value={waNum} onChange={e=>setWaNum(e.target.value)} placeholder="e.g. 8801711000000"
                className={`flex-1 border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 ${t.input}`} style={{fontSize:16}} />
              <Btn onClick={saveWaNum} color={waNumSaved?"green":"pink"}>{waNumSaved?"✓ Saved!":"Save"}</Btn>
            </div>
            <p className={`text-xs mt-2 ${t.sub}`}>Active: <span className="font-mono font-bold text-pink-500">{data.settings?.waNumber||ADMIN_WA_NUMBER}</span></p>
          </div>

          <div className={`${t.card} border rounded-2xl p-4`}>
            <div className={`font-bold text-sm mb-2 ${t.text}`}>ℹ️ App Info</div>
            <div className={`text-xs ${t.sub} flex flex-col gap-1`}>
              <div>Active orders: <strong className={t.text}>{(data.orders||[]).length}</strong></div>
              <div>Archived items: <strong className={t.text}>{totalArchived}</strong></div>
              <div>Products: <strong className={t.text}>{(data.products||[]).length}</strong></div>
              <div>Workers: <strong className={t.text}>{(data.workers||[]).length}</strong></div>
              <div>App version: <strong className={t.text}>FK Fashion v5.0</strong></div>
            </div>
          </div>
        </>
      )}

      {/* ── SERVICES TAB ── */}
      {activeSettingsTab==="services" && (
        <div className={`${t.card} border rounded-2xl p-4`}>
          <div className={`font-bold text-sm mb-4 ${t.text}`}>🔑 Service Configuration</div>
          <ServiceSettings
            data={data}
            onSave={(svc) => setData(p=>({...p,appConfig:{...(p.appConfig||{}),services:svc}}))}
          />
        </div>
      )}

      {/* ── ARCHIVE TAB ── */}
      {activeSettingsTab==="archive" && (
        <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
          <div className="flex justify-between items-center mb-1">
            <div className={`font-bold text-sm ${t.text}`}>🗃️ Archive <span className={`font-normal text-xs ${t.sub}`}>({totalArchived} total)</span></div>
            {totalArchived>0 && (
              <button onClick={()=>{if(!window.confirm("Clear ALL archives? Cannot be undone."))return;setData(p=>({...p,archivedOrders:[],archivedProducts:[],archivedMaterials:[],archivedWorkers:[],archivedExpenses:[],archivedMoney:[]}));}} className="text-xs text-red-400 font-semibold">🗑️ Clear All</button>
            )}
          </div>
          <p className={`text-xs ${t.sub} mb-3`}>Deleted items are kept here. They still appear in reports.</p>

          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:12,WebkitOverflowScrolling:"touch"}}>
            {[{id:"orders",label:`📦 Orders (${archived.length})`},{id:"products",label:`🌸 Products (${archivedProducts.length})`},{id:"materials",label:`🧵 Stock (${archivedMaterials.length})`},{id:"workers",label:`👷 Workers (${archivedWorkers.length})`},{id:"expenses",label:`💸 Expenses (${archivedExpenses.length})`},{id:"money",label:`💰 Money (${archivedMoney.length})`}].map(tab=>(
              <button key={tab.id} onClick={()=>setArchiveTab(tab.id)}
                style={{flexShrink:0,fontSize:11,padding:"5px 10px",borderRadius:20,border:`1.5px solid ${archiveTab===tab.id?"#db2777":"#fce7f3"}`,background:archiveTab===tab.id?"#db2777":"transparent",color:archiveTab===tab.id?"#fff":t.dark?"#9ca3af":"#6b7280",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                {tab.label}
              </button>
            ))}
          </div>

          {archiveTab==="orders" && <ArchiveSection items={archived} emptyIcon="🗃️" emptyMsg="No archived orders"
            renderItem={o=>{
              const items=o.items&&o.items.length>0?o.items:[{product:o.product,qty:o.qty,subtotal:o.price}];
              return (
                <div key={o.id} className={`border ${t.border} rounded-xl p-3`}>
                  <div className="flex justify-between items-start gap-2">
                    <div style={{flex:1,minWidth:0}}>
                      <div className={`font-bold text-sm ${t.text}`}>{o.customer}</div>
                      <div className={`text-xs ${t.sub}`}>{o.phone} · {o.date}</div>
                      <div className={`text-xs ${t.sub} truncate`}>{items.map(it=>`${it.product}${it.color?` (${it.color})`:""} ×${it.qty}`).join(", ")}</div>
                      {o._archived && <div className="text-xs text-orange-400">Archived: {o._archived}</div>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-pink-500 font-bold text-sm">৳{(+o.price||0).toLocaleString()}</div>
                      <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${t.statusColors?.[o.status]||t.pill}`}>{o.status}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={()=>restoreFromArchive(o.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                    <button onClick={()=>setDelArchiveId(o.id)} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                  </div>
                </div>
              );
            }}
          />}

          {archiveTab==="products" && <ArchiveSection items={archivedProducts} emptyIcon="🌸" emptyMsg="No archived products"
            renderItem={p=>(
              <div key={p.id} className={`border ${t.border} rounded-xl p-3`}>
                <div className={`font-bold text-sm ${t.text}`}>{p.name} <span className={`text-xs font-normal ${t.sub}`}>{p.nameBn}</span></div>
                <div className={`text-xs ${t.sub}`}>{p.category} · ৳{(+p.price||0).toLocaleString()} · {p.stock} pcs</div>
                {p._archived && <div className="text-xs text-orange-400">Archived: {p._archived}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={()=>restoreProduct(p.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                  <button onClick={()=>{if(!window.confirm("Delete forever?"))return;deleteProduct(p.id);}} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                </div>
              </div>
            )}
          />}

          {archiveTab==="materials" && <ArchiveSection items={archivedMaterials} emptyIcon="🧵" emptyMsg="No archived stock items"
            renderItem={m=>(
              <div key={m.id} className={`border ${t.border} rounded-xl p-3`}>
                <div className={`font-bold text-sm ${t.text}`}>{m.name}</div>
                <div className={`text-xs ${t.sub}`}>{m.supplier} · {m.qty} {m.unit} · ৳{(+m.cost||0).toLocaleString()}</div>
                {m._archived && <div className="text-xs text-orange-400">Archived: {m._archived}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={()=>restoreMaterial(m.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                  <button onClick={()=>{if(!window.confirm("Delete forever?"))return;deleteMaterial(m.id);}} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                </div>
              </div>
            )}
          />}

          {archiveTab==="workers" && <ArchiveSection items={archivedWorkers} emptyIcon="👷" emptyMsg="No archived workers"
            renderItem={w=>(
              <div key={w.id} className={`border ${t.border} rounded-xl p-3`}>
                <div className={`font-bold text-sm ${t.text}`}>{w.name} <span className={`text-xs font-normal ${t.sub}`}>{w.role}</span></div>
                <div className={`text-xs ${t.sub}`}>{w.phone} · ৳{(+w.salary||0).toLocaleString()}/mo</div>
                {w._archived && <div className="text-xs text-orange-400">Archived: {w._archived}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={()=>restoreWorker(w.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                  <button onClick={()=>{if(!window.confirm("Delete forever?"))return;deleteWorker(w.id);}} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                </div>
              </div>
            )}
          />}

          {archiveTab==="expenses" && <ArchiveSection items={archivedExpenses} emptyIcon="💸" emptyMsg="No archived expenses"
            renderItem={e=>(
              <div key={e.id} className={`border ${t.border} rounded-xl p-3`}>
                <div className={`font-bold text-sm ${t.text}`}>{e.category} <span className="text-orange-400 font-bold">৳{(+e.amount||0).toLocaleString()}</span></div>
                <div className={`text-xs ${t.sub}`}>{e.note} · {e.date}</div>
                {e._archived && <div className="text-xs text-orange-400">Archived: {e._archived}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={()=>restoreExpense(e.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                  <button onClick={()=>{if(!window.confirm("Delete forever?"))return;deleteExpense(e.id);}} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                </div>
              </div>
            )}
          />}

          {archiveTab==="money" && <ArchiveSection items={archivedMoney} emptyIcon="💰" emptyMsg="No archived money entries"
            renderItem={m=>(
              <div key={m.id} className={`border ${t.border} rounded-xl p-3`}>
                <div className={`font-bold text-sm ${t.text}`}>{m.name} <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${m.type==="owe"?t.red:t.green}`}>{m.type==="owe"?"I Owe":"Receivable"}</span></div>
                <div className={`text-xs ${t.sub}`}>{m.note} · ৳{(+m.amount||0).toLocaleString()} · {m.date}</div>
                {m._archived && <div className="text-xs text-orange-400">Archived: {m._archived}</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={()=>restoreMoney(m.id)} className={`text-xs px-2 py-1 rounded-lg border font-semibold ${t.green}`}>↩️ Restore</button>
                  <button onClick={()=>{if(!window.confirm("Delete forever?"))return;deleteMoney(m.id);}} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-400 font-semibold">🗑️ Delete Forever</button>
                </div>
              </div>
            )}
          />}
        </div>
      )}

      {delArchiveId && (
        <Modal title="Delete Forever?" onClose={()=>setDelArchiveId(null)} t={t}>
          <p className={`text-sm mb-4 ${t.text}`}>This permanently removes the order from all reports. Cannot be undone.</p>
          <div className="flex gap-2">
            <Btn color="red" onClick={()=>deleteFromArchive(delArchiveId)}>Yes, Delete Forever</Btn>
            <Btn color="gray" onClick={()=>setDelArchiveId(null)}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── CUSTOMISE ────────────────────────────────────────────────────────────────
function Customise({ data, setData, t }) {
  const cfg = data.appConfig || INIT_DATA.appConfig;
  const [tab, setTab] = useState("categories");

  function ListEditor({ label, items, cfgKey, icon }) {
    const [newVal,  setNewVal]  = useState("");
    const [editIdx, setEditIdx] = useState(null);
    const [editVal, setEditVal] = useState("");

    const add     = ()  => { const v=newVal.trim(); if(!v||items.includes(v))return; setData(p=>({...p,appConfig:{...(p.appConfig||{}),[cfgKey]:[...items,v]}})); setNewVal(""); };
    const remove  = (i) => { if(!window.confirm(`Remove "${items[i]}"?`))return; setData(p=>({...p,appConfig:{...(p.appConfig||{}),[cfgKey]:items.filter((_,idx)=>idx!==i)}})); };
    const startEdit=(i) => { setEditIdx(i); setEditVal(items[i]); };
    const saveEdit = ()  => { const v=editVal.trim(); if(!v){setEditIdx(null);return;} setData(p=>({...p,appConfig:{...(p.appConfig||{}),[cfgKey]:items.map((x,i)=>i===editIdx?v:x)}})); setEditIdx(null); };
    const reset    = ()  => { if(!window.confirm(`Reset ${label} to defaults?`))return; setData(p=>({...p,appConfig:{...(p.appConfig||{}),[cfgKey]:INIT_DATA.appConfig[cfgKey]}})); };

    return (
      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className="flex justify-between items-center mb-3">
          <div className={`font-bold text-sm ${t.text}`}>{icon} {label}</div>
          <button onClick={reset} className={`text-xs ${t.sub} underline`}>Reset defaults</button>
        </div>
        <div className="flex flex-col gap-2 mb-4">
          {items.map((item,i)=>(
            <div key={i} className={`flex items-center gap-2 border ${t.border} rounded-xl px-3 py-2`}>
              {editIdx===i ? (
                <>
                  <input value={editVal} onChange={e=>setEditVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEdit()}
                    className={`flex-1 text-sm border rounded-lg px-2 py-1 ${t.input}`} style={{fontSize:14}} autoFocus />
                  <button onClick={saveEdit} className="text-xs text-green-500 font-bold px-2">✓</button>
                  <button onClick={()=>setEditIdx(null)} className="text-xs text-gray-400 px-1">✕</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm font-medium ${t.text}`}>{item}</span>
                  <button onClick={()=>startEdit(i)} className="text-xs text-blue-400 px-1.5">✏️</button>
                  <button onClick={()=>remove(i)} className="text-xs text-red-400 px-1.5">🗑️</button>
                </>
              )}
            </div>
          ))}
          {items.length===0 && <div className={`text-xs text-center py-3 ${t.sub}`}>No items. Add one below.</div>}
        </div>
        <div className="flex gap-2">
          <input value={newVal} onChange={e=>setNewVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
            placeholder={`New ${label.toLowerCase().replace(/s$/,"")}...`}
            className={`flex-1 border rounded-xl px-3 py-2 text-sm ${t.input}`} style={{fontSize:14}} />
          <button onClick={add} className="bg-pink-600 text-white text-sm font-bold px-4 py-2 rounded-xl">+ Add</button>
        </div>
      </div>
    );
  }

  const TABS = [
    {id:"categories",  label:"📦 Categories"},
    {id:"statuses",    label:"🔄 Order Statuses"},
    {id:"expenses",    label:"💸 Expense Types"},
    {id:"roles",       label:"👷 Worker Roles"},
    {id:"units",       label:"📏 Stock Units"},
    {id:"whatsapp",    label:"💬 WhatsApp SMS"},
    {id:"appearance",  label:"🎨 App Name/Info"},
    {id:"admins",      label:"🔐 Admin Access"},
  ];

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-pink-500">🎛️ Customise</h2>
        <p className={`text-xs ${t.sub} mt-0.5`}>Edit all dropdown lists, categories, and app settings</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4" style={{WebkitOverflowScrolling:"touch"}}>
        {TABS.map(tb=>(
          <button key={tb.id} onClick={()=>setTab(tb.id)} className={`text-xs px-3 py-2 rounded-full border font-semibold whitespace-nowrap flex-shrink-0 transition ${tab===tb.id?t.pillActive:t.pill}`}>{tb.label}</button>
        ))}
      </div>
      {tab==="categories"  && <ListEditor label="Product Categories"  items={cfg.categories||CATEGORIES}         cfgKey="categories"        icon="🌸" />}
      {tab==="statuses"    && <ListEditor label="Order Statuses"       items={cfg.orderStatuses||ORDER_STATUSES}  cfgKey="orderStatuses"     icon="🔄" />}
      {tab==="expenses"    && <ListEditor label="Expense Categories"   items={cfg.expenseCategories||EXPENSE_CATS}cfgKey="expenseCategories" icon="💸" />}
      {tab==="roles"       && <ListEditor label="Worker Roles"         items={cfg.workerRoles||["Maker","Packager","Designer","Helper","Manager"]} cfgKey="workerRoles" icon="👷" />}
      {tab==="units"       && <ListEditor label="Stock Units"          items={cfg.materialUnits||["pcs","kg","g","meter","bundle","packet","roll","liter"]} cfgKey="materialUnits" icon="📏" />}
      {tab==="whatsapp"    && <WaTemplateEditor   data={data} setData={setData} t={t} />}
      {tab==="appearance"  && <AppAppearance      data={data} setData={setData} t={t} />}
      {tab==="admins"      && <AdminAccessManager data={data} setData={setData} t={t} />}
    </div>
  );
}

function WaTemplateEditor({ data, setData, t }) {
  const DEFAULT = "🌸 *New Order — {shopName}*\n\n👤 Name: {name}\n📞 Phone: {phone}\n📍 Address: {address}\n\n🛍️ *Items Ordered:*\n{items}\n\n💰 *Total: ৳{total}*\n\n📝 Note: {note}\n\nPlease confirm this order. Thank you! 🌸";
  const [tmpl, setTmpl] = useState(data.appConfig?.waTemplate||DEFAULT);
  const [saved,setSaved] = useState(false);

  const sampleItems = "• Bridal Tiara (Gold/Red) × 2 = ৳1700\n• Flower Necklace (Pink) × 1 = ৳450";
  const preview = tmpl.replace(/{shopName}/g,APP_NAME).replace(/{name}/g,"Rina Begum").replace(/{phone}/g,"01711-234567").replace(/{address}/g,"123 Dhanmondi, Dhaka").replace(/{items}/g,sampleItems).replace(/{total}/g,"2150").replace(/{note}/g,"Deliver before wedding");

  const save  = () => { setData(p=>({...p,appConfig:{...(p.appConfig||{}),waTemplate:tmpl}})); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  const reset = () => { if(window.confirm("Reset to default template?")) setTmpl(DEFAULT); };

  const VARS = [["{shopName}","Your shop name"],["{name}","Customer name"],["{phone}","Customer phone"],["{address}","Delivery address"],["{items}","All ordered items (auto-generated)"],["{total}","Order total amount"],["{note}","Customer note"]];

  return (
    <div>
      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className={`font-bold text-sm mb-3 ${t.text}`}>📋 Available Variables</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {VARS.map(([v,desc])=>(
            <button key={v} onClick={()=>setTmpl(prev=>prev+v)} style={{textAlign:"left",background:"#fdf2f8",border:"1px solid #fce7f3",borderRadius:10,padding:"6px 10px",cursor:"pointer"}}>
              <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#db2777"}}>{v}</div>
              <div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>{desc}</div>
            </button>
          ))}
        </div>
        <p className={`text-xs mt-3 ${t.sub}`}>💡 Tap a variable to append it, or type it manually.</p>
      </div>
      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className="flex justify-between items-center mb-3">
          <div className={`font-bold text-sm ${t.text}`}>✏️ Edit Template</div>
          <button onClick={reset} className={`text-xs ${t.sub} underline`}>Reset default</button>
        </div>
        <textarea value={tmpl} onChange={e=>setTmpl(e.target.value)} rows={10}
          className={`w-full border rounded-xl px-3 py-2.5 text-sm font-mono ${t.input}`}
          style={{fontSize:12,lineHeight:1.6,resize:"vertical",minHeight:200}} />
        <button onClick={save} className={`w-full mt-3 py-2.5 rounded-xl text-sm font-bold ${saved?"bg-green-500":"bg-pink-600"} text-white transition`}>
          {saved?"✓ Saved!":"💾 Save Template"}
        </button>
      </div>
      <div className={`${t.card} border rounded-2xl p-4`}>
        <div className={`font-bold text-sm mb-3 ${t.text}`}>👁️ Live Preview <span className={`text-xs font-normal ${t.sub}`}>(sample data)</span></div>
        <div style={{background:"#e7ffdb",borderRadius:16,padding:"12px 14px",border:"1px solid #b7eb8f",fontFamily:"system-ui",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",color:"#1f2937"}}>{preview}</div>
      </div>
    </div>
  );
}

function AppAppearance({ data, setData, t }) {
  const s = data.settings || {};
  const [waNum,    setWaNum]    = useState(s.waNumber  || ADMIN_WA_NUMBER);
  const [appName,  setAppName]  = useState(s.appName   || APP_NAME);
  const [appNameBn,setAppNameBn]= useState(s.appNameBn || APP_NAME_BN);
  const [saved,    setSaved]    = useState(false);

  const save = () => {
    setData(p=>({...p,settings:{...(p.settings||{}),waNumber:waNum.trim(),appName:appName.trim()||APP_NAME,appNameBn:appNameBn.trim()||APP_NAME_BN}}));
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  return (
    <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
      <div className={`font-bold text-sm mb-4 ${t.text}`}>🎨 App Information</div>
      <div className="flex flex-col gap-3">
        <div><label className={`block text-xs font-semibold mb-1 ${t.sub}`}>Shop Name (English)</label><input value={appName}   onChange={e=>setAppName(e.target.value)}   className={`w-full border rounded-xl px-3 py-2.5 text-sm ${t.input}`} style={{fontSize:15}} /></div>
        <div><label className={`block text-xs font-semibold mb-1 ${t.sub}`}>Shop Name (বাংলা)</label>   <input value={appNameBn} onChange={e=>setAppNameBn(e.target.value)} className={`w-full border rounded-xl px-3 py-2.5 text-sm ${t.input}`} style={{fontSize:15}} /></div>
        <div>
          <label className={`block text-xs font-semibold mb-1 ${t.sub}`}>Admin WhatsApp Number</label>
          <input value={waNum} onChange={e=>setWaNum(e.target.value)} placeholder="e.g. 8801711000000" className={`w-full border rounded-xl px-3 py-2.5 text-sm ${t.input}`} style={{fontSize:15}} />
          <p className={`text-xs mt-1 ${t.sub}`}>Include country code without +. Example: 8801711234567</p>
        </div>
        <button onClick={save} className={`w-full py-2.5 rounded-xl text-sm font-bold ${saved?"bg-green-500":"bg-pink-600"} text-white transition`}>
          {saved?"✓ Saved!":"Save Changes"}
        </button>
      </div>
    </div>
  );
}

function AdminAccessManager({ data, setData, t }) {
  const [admins,   setAdmins]   = useState(()=>data.appConfig?.adminEmails||ADMIN_EMAILS);
  const [newEmail, setNewEmail] = useState("");
  const [saved,    setSaved]    = useState(false);

  const save = () => {
    const cleaned = admins.filter(e=>e.trim()).map(e=>e.toLowerCase().trim());
    if (!cleaned.length) { alert("Must keep at least one admin email."); return; }
    // Replace contents safely without mutating the reference unpredictably
    while (ADMIN_EMAILS.length) ADMIN_EMAILS.pop();
    cleaned.forEach(e => ADMIN_EMAILS.push(e));
    setData(p=>({...p,appConfig:{...(p.appConfig||{}),adminEmails:cleaned}}));
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };
  const add    = () => { const e=newEmail.trim().toLowerCase(); if(!e||!e.includes("@")||admins.includes(e))return; setAdmins(a=>[...a,e]); setNewEmail(""); };
  const remove = (email) => { if(admins.length<=1){alert("Must keep at least one admin email.");return;} setAdmins(a=>a.filter(e=>e!==email)); };

  return (
    <div>
      <div className={`${t.card} border rounded-2xl p-4 mb-4`}>
        <div className={`font-bold text-sm mb-1 ${t.text}`}>🔐 Admin Email Access</div>
        <p className={`text-xs mb-3 ${t.sub}`}>Only these emails can log into the admin panel. Changes apply immediately.</p>
        <div style={{background:"#fef3c7",border:"1px solid #fde68a",borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:12,color:"#92400e",lineHeight:1.5}}>
          ⚠️ <strong>Security note:</strong> Only add emails of trusted staff.
        </div>
        {admins.map(email=>(
          <div key={email} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"#fdf2f8",borderRadius:10,marginBottom:6}}>
            <span style={{fontSize:13,color:"#1f2937",wordBreak:"break-all"}}>{email}</span>
            <button onClick={()=>remove(email)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16,flexShrink:0,marginLeft:8}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="new.admin@email.com"
            className={`flex-1 border rounded-xl px-3 py-2 text-sm ${t.input}`} style={{fontSize:14}} />
          <button onClick={add} className="bg-pink-600 text-white text-sm font-bold px-4 py-2 rounded-xl">+ Add</button>
        </div>
      </div>
      <button onClick={save} className={`w-full py-3 rounded-xl text-sm font-bold ${saved?"bg-green-500":"bg-pink-600"} text-white transition`}>
        {saved?"✓ Saved!":"💾 Save Admin Emails"}
      </button>
      <p className={`text-xs text-center mt-2 ${t.sub}`}>⚠️ Don't remove your own email or you'll be locked out.</p>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onBack }) {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [googleLoading,setGoogleLoading]= useState(false);
  const [error,        setError]        = useState("");

  const login = async () => {
    if (!email.trim()||!password) { setError("Please fill in both fields."); return; }
    setLoading(true); setError("");
    try {
      const { auth } = getFirebase();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch(err) {
      const msgs = {"auth/invalid-email":"Invalid email address.","auth/user-not-found":"No account found.","auth/wrong-password":"Wrong password.","auth/invalid-credential":"Wrong email or password.","auth/user-disabled":"Account disabled.","auth/too-many-requests":"Too many attempts. Please wait.","auth/network-request-failed":"No internet connection.","auth/missing-password":"Please enter your password."};
      setError(msgs[err.code]||`Login failed (${err.code})`);
    } finally { setLoading(false); }
  };

  const loginWithGoogle = async () => {
    setGoogleLoading(true); setError("");
    try {
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt:"select_account" });
      await signInWithPopup(auth, provider);
    } catch(err) {
      if (err.code!=="auth/popup-closed-by-user") {
        const msgs = {"auth/popup-blocked":"Please allow popups for Google Sign-In.","auth/network-request-failed":"No internet connection.","auth/unauthorized-domain":"Domain not authorized in Firebase Console."};
        setError(msgs[err.code]||"Google sign-in failed: "+err.message);
      }
    }
    setGoogleLoading(false);
  };

  const inputStyle = { background:"rgba(255,255,255,0.07)", color:"#ffffff", WebkitTextFillColor:"#ffffff", fontSize:"16px", caretColor:"#f43f5e" };

  return (
    <div style={{minHeight:"100dvh",background:"#060610",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Space Grotesk',system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(244,63,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(244,63,94,0.03) 1px,transparent 1px)",backgroundSize:"40px 40px",pointerEvents:"none"}} />
      <div style={{position:"absolute",top:-100,right:-60,width:380,height:380,borderRadius:"50%",background:"radial-gradient(circle,rgba(244,63,94,0.14) 0%,transparent 70%)",pointerEvents:"none"}} />
      {onBack && (
        <button onClick={onBack} style={{position:"fixed",top:16,left:16,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",cursor:"pointer",display:"flex",alignItems:"center",gap:6,zIndex:10,letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>← Store</button>
      )}
      <div style={{width:"100%",maxWidth:400,position:"relative"}}>
        <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:20,padding:"36px 28px 28px",backdropFilter:"blur(24px)",boxShadow:"0 40px 80px rgba(0,0,0,0.6)"}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{width:58,height:58,borderRadius:16,background:"linear-gradient(135deg,#f43f5e,#e11d48)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,margin:"0 auto 14px",boxShadow:"0 0 30px rgba(244,63,94,0.5)"}}>🌸</div>
            <div style={{fontSize:10,letterSpacing:"0.25em",color:"rgba(244,63,94,0.85)",fontWeight:700,marginBottom:6,textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>ADMIN PORTAL</div>
            <h1 style={{fontFamily:"'Rajdhani',sans-serif",fontSize:26,fontWeight:700,color:"#fff",letterSpacing:"0.06em",margin:"0 0 4px",textTransform:"uppercase"}}>{APP_NAME}</h1>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.3)",margin:0}}>Business Management System</p>
          </div>
          {error && <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"#fca5a5",fontSize:12,borderRadius:10,padding:"9px 12px",marginBottom:14,textAlign:"center"}}>⚠️ {error}</div>}
          <button onClick={loginWithGoogle} disabled={googleLoading||loading}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"12px",border:"1px solid rgba(255,255,255,0.12)",borderRadius:11,background:"rgba(255,255,255,0.05)",fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:14,boxSizing:"border-box",color:"rgba(255,255,255,0.85)",transition:"all 0.2s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.09)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {googleLoading||loading ? "Signing in..." : "Continue with Google"}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:"rgba(255,255,255,0.08)"}} />
            <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>or with email</span>
            <div style={{flex:1,height:1,background:"rgba(255,255,255,0.08)"}} />
          </div>
          <div style={{marginBottom:10}}>
            <label style={{display:"block",fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>Email Address</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="admin@email.com" autoComplete="email"
              style={{...inputStyle,width:"100%",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"12px 13px",outline:"none",boxSizing:"border-box",transition:"all 0.2s"}}
              onFocus={e=>{e.target.style.borderColor="rgba(244,63,94,0.5)";e.target.style.boxShadow="0 0 0 2px rgba(244,63,94,0.15)";}}
              onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.1)";e.target.style.boxShadow="none";}} />
          </div>
          <div style={{marginBottom:20}}>
            <label style={{display:"block",fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>Password</label>
            <div style={{position:"relative"}}>
              <input type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="Your password" autoComplete="current-password"
                style={{...inputStyle,width:"100%",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"12px 42px 12px 13px",outline:"none",boxSizing:"border-box",transition:"all 0.2s"}}
                onFocus={e=>{e.target.style.borderColor="rgba(244,63,94,0.5)";e.target.style.boxShadow="0 0 0 2px rgba(244,63,94,0.15)";}}
                onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.1)";e.target.style.boxShadow="none";}} />
              <button type="button" onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",fontSize:15,cursor:"pointer",padding:4,color:"rgba(255,255,255,0.35)"}}>{showPw?"🙈":"👁️"}</button>
            </div>
          </div>
          <button onClick={login} disabled={loading||googleLoading}
            style={{width:"100%",background:loading?"rgba(244,63,94,0.35)":"linear-gradient(135deg,#f43f5e,#e11d48)",color:"#fff",fontWeight:700,fontSize:13,padding:"13px",borderRadius:11,border:"none",cursor:loading?"not-allowed":"pointer",boxShadow:loading?"none":"0 0 20px rgba(244,63,94,0.4)",letterSpacing:"0.08em",transition:"all 0.2s",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>
            {loading?"⏳ Signing in...":"Sign In to Admin →"}
          </button>
          <p style={{textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.2)",marginTop:16,marginBottom:0,lineHeight:1.6}}>🔒 Authorized staff only. All actions are logged.</p>
        </div>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&family=Space+Grotesk:wght@400;600&display=swap');input::placeholder{color:rgba(255,255,255,0.2)!important;}`}</style>
    </div>
  );
}

// ─── ADMIN APP ────────────────────────────────────────────────────────────────
function AdminApp({ onBack }) {
  const [sectionRaw, setSectionRaw] = useState("dashboard");
  const setSection   = useCallback(s=>{window.scrollTo(0,0);setSectionRaw(s);},[]);
  const section      = sectionRaw;
  const { cachedData, setCachedData } = useAppData();
  const [data,    setDataRaw] = useState(()=>cachedData||loadLocal());
  const [dark,    setDark]    = useState(true);
  const [report,  setReport]  = useState(null);
  const [user,    setUser]    = useState(undefined);
  const [dbStatus,setDbStatus]= useState("local");
  const [syncMsg, setSyncMsg] = useState("");
  const t          = getTheme(dark);
  const saveTimerRef = useRef(null);
  const unsub2Ref    = useRef(null);
  const sessionId    = useRef(Math.random().toString(36).slice(2)); // unique per tab

  // Online/offline tracking
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(()=>{
    const goOnline  = async()=>{ setIsOnline(true); const flushed=await flushOfflineQueue(); if(flushed){setDbStatus("synced");setSyncMsg("Back online — synced ✓");setTimeout(()=>setSyncMsg(""),3000);} };
    const goOffline = ()=>{ setIsOnline(false); setDbStatus("offline"); setSyncMsg("Offline — saving locally"); };
    window.addEventListener("online",goOnline); window.addEventListener("offline",goOffline);
    return()=>{ window.removeEventListener("online",goOnline); window.removeEventListener("offline",goOffline); };
  },[]);
  useEffect(()=>{ setCachedData(data); },[data,setCachedData]);
  
  // Firebase auth + data sync
  useEffect(()=>{
    // Offline: only allow if a verified admin session was previously stored
    const storedSession = (() => {
      try { return JSON.parse(localStorage.getItem("fk_admin_session") || "null"); } catch(_) { return null; }
    })();
    const offlineFallback = () => {
      if (!storedSession?.email) {
        // No prior verified session — do not grant access offline
        setUser(null);
        setDbStatus("offline");
        return;
      }
      const local = loadLocal();
      if (local && local.products) {
        setDataRaw(local);
        setUser({ email: storedSession.email, isAnonymous: false, _offlineMode: true, displayName: storedSession.displayName || "" });
        setDbStatus("offline");
      } else {
        setUser(null);
        setDbStatus("offline");
      }
    };

    if (!navigator.onLine) { offlineFallback(); return; }
    const offlineTimer = setTimeout(() => { if (!navigator.onLine) offlineFallback(); }, 2000);
    let unsub = () => {};
    try {
      const { auth } = getFirebase();
      unsub = onAuthStateChanged(auth, async u => {
        clearTimeout(offlineTimer); setUser(u);
        const isAdmin = u && !u.isAnonymous && ADMIN_EMAILS.includes(u.email?.toLowerCase());
        // Persist verified session for secure offline fallback
        if (isAdmin) {
          try {
            localStorage.setItem("fk_admin_session", JSON.stringify({
              email: u.email.toLowerCase(),
              displayName: u.displayName || ""
            }));
          } catch(_) {}
        } else {
          try { localStorage.removeItem("fk_admin_session"); } catch(_) {}
        }
        if (isAdmin) {
          setDbStatus("syncing");
          if (getOfflineQueue().length > 0) { try { await flushOfflineQueue(); } catch(_) {} }
          const fbData = await loadFromFirebase();
          if (fbData) {
            setDataRaw(fbData); setCachedData(fbData); saveLocal(fbData);
            setDbStatus("synced");
          } else {
            const local = loadLocal();
            await saveToFirebase(local);
            setDbStatus("synced");
          }
          const { db } = getFirebase();
          if (unsub2Ref.current) {
  unsub2Ref.current();
  unsub2Ref.current = null;
}

let listenerFirstSnap = true;
unsub2Ref.current = onSnapshot(doc(db, "fk_fashion", "data"), snap => {
    if (!snap.exists()) return;
    const d = snap.data();

    // Always apply config updates
    try { applyServicesConfig(d.appConfig); } catch(_) {}
    try { applyAppConfig(d.settings); } catch(_) {}

    // Merge images before saving/setting
    const products = mergeImagesIntoProducts(d.products || [], loadImagesLocal());
    const merged = _buildMergedData({ ...d, products });
    saveLocal(merged);

    if (listenerFirstSnap) {
      listenerFirstSnap = false;
      setDataRaw(merged);
      setCachedData(merged);
      return;
    }

    const writerMatch = d._lastWriterId === sessionId.current;
    const writeAge    = Date.now() - (d._lastWriteTime || 0);
    if (writerMatch && writeAge < 10000) return;

    setDataRaw(merged);
    setCachedData(merged);
    setDbStatus("synced");
    // Skip update if this tab wrote it recently (prevents echo updates)
  });
        }
      });
    } catch(e) { console.error("AdminApp auth error:", e); clearTimeout(offlineTimer); setUser(null); }
    return () => {
      clearTimeout(offlineTimer);
      unsub();
      if (unsub2Ref.current) { unsub2Ref.current(); unsub2Ref.current = null; }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── setData — stable callback, saves locally + debounces Firebase write ──
  const setData = useCallback((updater) => {
    setDataRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveLocal(next);
      addToOfflineQueue(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!navigator.onLine) { setDbStatus("offline"); return; }
        try {
          await saveToFirebase(next, sessionId.current);
          clearOfflineQueue();
          setDbStatus("synced");
          setSyncMsg("Saved ✓");
          setTimeout(() => setSyncMsg(""), 1800);
        } catch (_) {
          setDbStatus("offline");
          setSyncMsg("📴 Offline — saved locally");
        }
      }, 1200);
      return next;
    });
  }, []);

  const [globalSearch,     setGlobalSearch]     = useState("");
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  const globalSearchResults = useMemo(() => {
    const q = globalSearch.toLowerCase().trim();
    if (!q || q.length < 2) return null;
    const orders = (data.orders || []).filter(o =>
      o.customer.toLowerCase().includes(q) ||
      (o.phone || "").includes(q) ||
      (o.product || "").toLowerCase().includes(q)
    );
    const products = (data.products || []).filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.nameBn || "").includes(q) ||
      (p.sku || "").toLowerCase().includes(q)
    );
    const customers = {};
    (data.orders || []).forEach(o => {
      if (o.phone && (o.customer.toLowerCase().includes(q) || o.phone.includes(q))) {
        customers[o.phone] = o;
      }
    });
    return {
      orders:    orders.slice(0, 5),
      products:  products.slice(0, 5),
      customers: Object.values(customers).slice(0, 4),
    };
  }, [globalSearch, data]);

  const handleLogout = useCallback(async () => {
    try {
      const { auth } = getFirebase();
      await signOut(auth);
      try { localStorage.removeItem("fk_admin_session"); } catch (_) {}
      setUser(null);
      setDbStatus("local");
    } catch (_) {}
  }, []);

  useEffect(() => {
    document.body.classList.add("adm-active");
    return () => document.body.classList.remove("adm-active");
  }, []);

  // PWA meta + service worker
  useEffect(()=>{
    if(!document.querySelector('link[rel="manifest"]')){
      const manifest={name:APP_NAME,short_name:"FK Admin",start_url:"/admin",display:"standalone",background_color:"#060610",theme_color:"#060610",icons:[{src:"https://ik.imagekit.io/jwpfdkm8y/fk_fashion/icon-192.png",sizes:"192x192",type:"image/png"},{src:"https://ik.imagekit.io/jwpfdkm8y/fk_fashion/icon-512.png",sizes:"512x512",type:"image/png"}]};
      const blob=new Blob([JSON.stringify(manifest)],{type:"application/json"});const url=URL.createObjectURL(blob);
      const link=document.createElement("link");link.rel="manifest";link.href=url;document.head.appendChild(link);
    }
    const addMeta=(name,content)=>{ if(!document.querySelector(`meta[name="${name}"]`)){const m=document.createElement("meta");m.name=name;m.content=content;document.head.appendChild(m);} };
    addMeta("mobile-web-app-capable","yes");addMeta("apple-mobile-web-app-capable","yes");
    addMeta("apple-mobile-web-app-status-bar-style","black-translucent");addMeta("apple-mobile-web-app-title","FK Admin");addMeta("theme-color","#060610");
    if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
  },[]);

  // ── Loading spinner ──
  if(user===undefined){return(
    <div style={{minHeight:"100dvh",background:"#060610",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Grotesk',system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"40%",left:"50%",transform:"translate(-50%,-50%)",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(244,63,94,0.10) 0%,transparent 70%)",pointerEvents:"none"}} />
      <div style={{textAlign:"center",position:"relative",zIndex:1}}>
        <div style={{width:64,height:64,borderRadius:18,background:"linear-gradient(135deg,#f43f5e,#e11d48)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 20px",boxShadow:"0 0 30px rgba(244,63,94,0.5)"}}>🌸</div>
        <div style={{color:"#e8e6f8",fontWeight:700,fontSize:18,letterSpacing:"0.12em",fontFamily:"'Rajdhani',sans-serif",textTransform:"uppercase"}}>{APP_NAME}</div>
        <div style={{color:"rgba(255,255,255,0.3)",fontSize:10,marginTop:6,letterSpacing:"0.25em",fontWeight:600,textTransform:"uppercase"}}>ADMIN PANEL</div>
        {!navigator.onLine
          ? <div style={{color:"#fb923c",fontSize:11,marginTop:16,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>📴 Offline — loading local data...</div>
          : <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:20}}>{[0,1,2].map(i=>(<div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#f43f5e",animation:`neonPulse 1.4s ease-in-out ${i*0.22}s infinite`}} />))}</div>
        }
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&family=Space+Grotesk:wght@400;600&display=swap');@keyframes neonPulse{0%,100%{opacity:0.3;transform:scale(0.7)}50%{opacity:1;transform:scale(1.1)}}`}</style>
    </div>
  );}

  if(!user) return <LoginScreen onBack={onBack} />;

  const isAllowed=!user.isAnonymous&&(user._offlineMode||ADMIN_EMAILS.includes(user.email?.toLowerCase()));
  if(!isAllowed){return(
    <div style={{minHeight:"100dvh",background:"#060610",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Grotesk',system-ui,sans-serif",padding:20}}>
      <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:18,padding:"42px 30px",maxWidth:360,width:"100%",textAlign:"center",backdropFilter:"blur(20px)"}}>
        <div style={{width:64,height:64,borderRadius:16,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 20px"}}>🚫</div>
        <h2 style={{fontSize:20,fontWeight:700,color:"#fff",marginBottom:10,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.05em",textTransform:"uppercase"}}>Access Denied</h2>
        <p style={{fontSize:13,fontWeight:700,color:"#f87171",marginBottom:20,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:8,padding:"7px 12px"}}>{user.email||"Unknown"}</p>
        <button onClick={async()=>{const{auth}=getFirebase();await signOut(auth);}}
          style={{width:"100%",background:"linear-gradient(135deg,#f43f5e,#e11d48)",color:"#fff",border:"none",borderRadius:11,padding:"13px",fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>
          Sign Out & Try Again
        </button>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>
    </div>
  );}

  const syncColor=dbStatus==="synced"?"#4ade80":dbStatus==="syncing"?"#fbbf24":dbStatus==="error"?"#f87171":dbStatus==="offline"?"#fb923c":"#64748b";
  const syncIcon =dbStatus==="synced"?"●":dbStatus==="syncing"?"◌":dbStatus==="error"?"⚠":dbStatus==="offline"?"📴":"●";
  const syncLabel=dbStatus==="synced"?"Synced":dbStatus==="syncing"?"Saving...":dbStatus==="error"?"Error":dbStatus==="offline"?"Offline":"Local";

  const bg        = dark?"#060610":"#f0f2f7";
  const sidebarBg = dark?"#06060f":"#ffffff";
  const topbarBg  = dark?"rgba(6,6,15,0.94)":"rgba(255,255,255,0.94)";
  const borderCol = dark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.07)";
  const txtPrimary= dark?"#e8e6f8":"#0a0a18";
  const txtMuted  = dark?"#4a4a6a":"#8a8aaa";
  const accent    = "#f43f5e";
  const accentGrad= "linear-gradient(135deg,#f43f5e,#e11d48)";

  const props = { data, setData, t, showReport, setSection };

  const renderSection = () => {
    switch(section){
      case "catalogue": return <Catalogue {...props}/>;
      case "orders":    return <Orders    {...props}/>;
      case "customers": return <Customers {...props}/>;
      case "money":     return <Money     {...props}/>;
      case "materials": return <Materials {...props}/>;
      case "workers":   return <Workers   {...props}/>;
      case "reports":   return <Reports   {...props}/>;
      case "settings":  return <Settings  {...props}/>;
      case "customise": return <Customise {...props}/>;
      default:          return <Dashboard {...props}/>;
    }
  };

  const currentNav   = NAV_ADMIN.find(n=>n.id===section);
  const sectionTitle = section==="settings"?"Settings":section==="customise"?"Customise":(currentNav?.en||"Dashboard");
  const sectionIcon  = section==="settings"?"⚙️":section==="customise"?"🎛️":(currentNav?.icon||"🏠");
  const allNavItems  = [...NAV_ADMIN,{id:"settings",icon:"⚙️",en:"Settings"}].filter((n,i,arr)=>arr.findIndex(x=>x.id===n.id)===i);

  return (
    <div className={`adm-wrap ${dark?"adm-dark":"adm-light"}`} style={{background:bg,fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      {report && <ReportViewer report={report} onClose={()=>setReport(null)} />}

      {/* Ambient glows */}
      <div style={{position:"fixed",top:"5%",right:"10%",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(244,63,94,0.06) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}} />
      <div style={{position:"fixed",bottom:"10%",left:"10%",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(6,182,212,0.04) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}} />

      {/* ── SIDEBAR ── */}
      <aside className="adm-sidebar" style={{background:sidebarBg}}>
        <div style={{height:60,display:"flex",alignItems:"center",padding:"0 12px",borderBottom:`1px solid ${borderCol}`,flexShrink:0,width:"100%",gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,background:accentGrad,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,boxShadow:"0 0 18px rgba(244,63,94,0.5)",flexShrink:0}}>🌸</div>
          <div className="adm-nav-lbl" style={{overflow:"hidden",display:"none"}}>
            <div style={{fontSize:14,fontWeight:700,color:txtPrimary,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{APP_NAME}</div>
            <div style={{fontSize:9,color:accent,letterSpacing:"0.2em",fontWeight:700,textTransform:"uppercase"}}>ADMIN</div>
          </div>
        </div>
        <div style={{flex:1,width:"100%",overflowY:"auto",padding:"8px 6px",display:"flex",flexDirection:"column",gap:2}}>
          {NAV_ADMIN.map(n=>{const a=section===n.id;return(<button key={n.id} onClick={()=>setSection(n.id)} className={`adm-nav-btn${a?" active":""}`} style={{color:a?accent:txtMuted}}><span className="adm-nav-icon">{n.icon}</span><span className="adm-nav-lbl">{n.en}</span></button>);})}
        </div>
        <div style={{padding:"6px 6px 12px",width:"100%",borderTop:`1px solid ${borderCol}`,display:"flex",flexDirection:"column",gap:2}}>
          {user?.photoURL && (
            <div style={{display:"flex",alignItems:"center",padding:"8px 10px",gap:8,borderRadius:8,background:dark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.03)",border:`1px solid ${borderCol}`,marginBottom:2}}>
              <img src={user.photoURL} alt="" style={{width:26,height:26,borderRadius:"50%",objectFit:"cover",border:`2px solid ${accent}`,flexShrink:0}} />
              <div className="adm-nav-lbl" style={{display:"none",overflow:"hidden"}}>
                <div style={{fontSize:11,fontWeight:600,color:txtPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user.displayName||user.email?.split("@")[0]}</div>
                <div style={{fontSize:8,color:accent,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase"}}>ADMIN</div>
              </div>
            </div>
          )}
          {[{id:"customise",icon:"🎛️",en:"Customise"},{id:"settings",icon:"⚙️",en:"Settings"}].map(item=>{const a=section===item.id;return(<button key={item.id} onClick={()=>setSection(item.id)} className={`adm-nav-btn${a?" active":""}`} style={{color:a?accent:txtMuted}}><span className="adm-nav-icon">{item.icon}</span><span className="adm-nav-lbl">{item.en}</span></button>);})}
          <button onClick={()=>setDark(d=>!d)} className="adm-nav-btn" style={{color:txtMuted}}><span className="adm-nav-icon">{dark?"☀️":"🌙"}</span><span className="adm-nav-lbl">{dark?"Light Mode":"Dark Mode"}</span></button>
          <button onClick={handleLogout} className="adm-nav-btn" style={{color:"#f87171"}}><span className="adm-nav-icon">🚪</span><span className="adm-nav-lbl">Sign Out</span></button>
          <button onClick={onBack} className="adm-nav-btn" style={{color:"#60a5fa"}}><span className="adm-nav-icon">🛍️</span><span className="adm-nav-lbl">View Store</span></button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="adm-main">
        {/* ── TOPBAR ── */}
        <div className="adm-topbar" style={{background:topbarBg,borderBottom:`1px solid ${borderCol}`,flexDirection:"column",padding:0,gap:0,height:"auto"}}>
          {/* Title row */}
          <div style={{display:"flex",alignItems:"center",width:"100%",padding:"0 14px",height:56,gap:10,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:9,flex:"1 1 0",minWidth:0,overflow:"hidden"}}>
              <div style={{width:30,height:30,borderRadius:8,background:dark?"rgba(244,63,94,0.12)":"rgba(244,63,94,0.08)",border:"1px solid rgba(244,63,94,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{sectionIcon}</div>
              <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:15,color:txtPrimary,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",letterSpacing:"0.06em",textTransform:"uppercase"}}>{sectionTitle}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <button onClick={()=>setShowGlobalSearch(s=>!s)} style={{width:32,height:32,borderRadius:8,border:`1px solid ${showGlobalSearch?accent+"55":borderCol}`,background:showGlobalSearch?"rgba(244,63,94,0.1)":dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)",color:showGlobalSearch?accent:txtMuted,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.18s"}}>🔍</button>
              <div className="adm-wide" style={{display:"none",alignItems:"center",gap:4,fontSize:10,color:syncColor,fontWeight:700,background:dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)",borderRadius:6,padding:"4px 9px",border:`1px solid ${syncColor}33`,letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>
                <span style={{fontSize:7}}>{syncIcon}</span><span>{syncLabel}</span>
              </div>
              {(()=>{const lS=(data.products||[]).filter(p=>p.stock>0&&p.stock<=5);const pn=(data.orders||[]).filter(o=>o.status==="Pending");const n=lS.length+pn.length;return n>0?(<button onClick={()=>setSection("dashboard")} style={{position:"relative",width:32,height:32,borderRadius:8,border:`1px solid ${borderCol}`,background:dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:txtMuted}}>🔔<span style={{position:"absolute",top:2,right:2,background:accent,color:"#fff",fontSize:7,fontWeight:800,borderRadius:"50%",width:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 6px ${accent}`}}>{n}</span></button>):null;})()}
              <button onClick={()=>showReport(buildFullReport({...data,orders:[...(data.orders||[]),...(data.archivedOrders||[])]}))}
                className="adm-neon-btn"
                style={{display:"flex",alignItems:"center",gap:5,fontSize:11,background:accentGrad,color:"#fff",border:"none",padding:"7px 13px",borderRadius:8,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 14px rgba(244,63,94,0.35)",letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif",flexShrink:0}}>
                🖨️<span className="adm-wide" style={{display:"none",marginLeft:2}}>Report</span>
              </button>
              <div className="adm-mob" style={{display:"flex",gap:5}}>
                <button onClick={()=>setDark(d=>!d)} style={{width:30,height:30,borderRadius:7,border:`1px solid ${borderCol}`,background:dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.03)",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>{dark?"☀️":"🌙"}</button>
                <button onClick={handleLogout} style={{fontSize:10,background:"rgba(239,68,68,0.1)",color:"#f87171",border:"1px solid rgba(239,68,68,0.2)",padding:"5px 8px",borderRadius:7,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🚪</button>
                <button onClick={onBack} style={{fontSize:10,background:"rgba(96,165,250,0.1)",color:"#60a5fa",border:"1px solid rgba(96,165,250,0.2)",padding:"5px 8px",borderRadius:7,fontWeight:700,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif"}}>🛍️</button>
              </div>
            </div>
          </div>

          {/* Global search */}
          {showGlobalSearch && (
            <div style={{padding:"7px 14px 10px",borderBottom:`1px solid ${borderCol}`,background:topbarBg,backdropFilter:"blur(20px)"}}>
              <input value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search orders, products, customers..." autoFocus
                className="adm-topbar-search" style={{border:`1px solid ${borderCol}`,background:dark?"rgba(255,255,255,0.05)":"#fef5f7",color:txtPrimary}} />
              {globalSearchResults && (
                <div style={{background:dark?"#0e0e1c":"#fff",border:`1px solid ${borderCol}`,borderRadius:10,marginTop:6,boxShadow:"0 8px 30px rgba(0,0,0,0.25)",overflow:"hidden",maxHeight:280,overflowY:"auto"}}>
                  {[{key:"products",icon:"🌸",label:"PRODUCTS",items:globalSearchResults.products,sub:p=>`৳${p.price?.toLocaleString()} · ${p.stock} in stock`,nav:"catalogue"},
                    {key:"orders",  icon:"📦",label:"ORDERS",   items:globalSearchResults.orders,  sub:o=>`${o.phone} · ৳${(+o.price||0).toLocaleString()}`,nav:"orders"},
                    {key:"customers",icon:"👩",label:"CUSTOMERS",items:globalSearchResults.customers,sub:c=>c.phone,nav:"customers"}
                  ].map(({key,icon,label,items,sub,nav})=>items.length>0&&(
                    <div key={key}>
                      <div style={{fontSize:9,fontWeight:700,color:txtMuted,padding:"7px 12px 3px",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'Rajdhani',sans-serif"}}>{label}</div>
                      {items.map((item,i)=>(
                        <div key={i} onClick={()=>{setSection(nav);setShowGlobalSearch(false);setGlobalSearch("");}}
                          style={{display:"flex",alignItems:"center",gap:9,padding:"8px 12px",cursor:"pointer",borderTop:`1px solid ${borderCol}`}}
                          onMouseEnter={e=>e.currentTarget.style.background=dark?"rgba(244,63,94,0.06)":"#fef5f7"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
                          <div><div style={{fontSize:12,fontWeight:600,color:txtPrimary}}>{item.name||item.customer}</div><div style={{fontSize:11,color:txtMuted}}>{sub(item)}</div></div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!globalSearchResults.orders.length&&!globalSearchResults.products.length&&!globalSearchResults.customers.length&&(
                    <div style={{padding:"16px",textAlign:"center",color:txtMuted,fontSize:13}}>No results for "{globalSearch}"</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Alerts row */}
          {(()=>{
            const lS=(data.products||[]).filter(p=>p.stock>0&&p.stock<=5);
            const oS=(data.products||[]).filter(p=>p.stock===0);
            const pn=(data.orders||[]).filter(o=>o.status==="Pending");
            if(!lS.length&&!oS.length&&!pn.length) return null;
    if(section!=="dashboard"&&section!=="orders"&&section!=="catalogue") return null;
            return(
              <div style={{background:dark?"rgba(245,158,11,0.04)":"#fffbeb",borderBottom:`1px solid ${dark?"rgba(245,158,11,0.1)":"#fde68a"}`,padding:"5px 12px",display:"flex",gap:6,overflowX:"auto",overflowY:"visible",flexShrink:0,alignItems:"center",WebkitOverflowScrolling:"touch",scrollbarWidth:"none",flexWrap:"nowrap",width:"100%",boxSizing:"border-box"}}>
                {pn.length>0&&<button onClick={()=>setSection("orders")} className="adm-alert-pill" style={{color:"#d97706",background:"rgba(245,158,11,0.08)",borderColor:"rgba(245,158,11,0.2)"}}>📦 {pn.length} Pending</button>}
                {lS.map(p=><button key={p.id} onClick={()=>setSection("catalogue")} className="adm-alert-pill" style={{color:"#ea580c",background:"rgba(234,88,12,0.08)",borderColor:"rgba(234,88,12,0.2)"}}>⚠️ {p.name}: {p.stock} left</button>)}
                {oS.map(p=><button key={p.id} onClick={()=>setSection("catalogue")} className="adm-alert-pill" style={{color:"#dc2626",background:"rgba(220,38,38,0.08)",borderColor:"rgba(220,38,38,0.2)"}}>🚫 {p.name}: OUT</button>)}
              </div>
            );
          })()}
        </div>

        {/* Content */}
        <div className="adm-content">{renderSection()}</div>

        {/* ── BOTTOM NAV (mobile) ── */}
        <nav className="adm-bottomnav" style={{background:topbarBg}}>
          {allNavItems.map(n=>{const a=section===n.id;return(<button key={n.id} onClick={()=>setSection(n.id)} className={`adm-bnav-btn${a?" active":""}`} style={{color:a?accent:txtMuted}}><span className="icon">{n.icon}</span><span className="label">{n.en}</span></button>);})}
        </nav>

        {/* Sync toast */}
        {(dbStatus==="offline"||dbStatus==="error"||(syncMsg&&dbStatus==="synced"))&&(
          <div style={{position:"fixed",top:"calc(56px + env(safe-area-inset-top,0px) + 40px)",left:"50%",transform:"translateX(-50%)",zIndex:9999,pointerEvents:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
            {dbStatus==="offline"&&<div style={{background:"rgba(20,10,0,0.95)",border:"1px solid #fb923c",color:"#fb923c",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.07em",textTransform:"uppercase",padding:"6px 16px",borderRadius:20,boxShadow:"0 4px 16px rgba(0,0,0,0.5)",whiteSpace:"nowrap",backdropFilter:"blur(12px)"}}>📴 Offline — saved locally, auto-syncs when back online</div>}
            {dbStatus==="error"&&<div style={{background:"rgba(20,0,0,0.95)",border:"1px solid #f87171",color:"#f87171",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.07em",textTransform:"uppercase",padding:"6px 16px",borderRadius:20,boxShadow:"0 4px 16px rgba(0,0,0,0.5)",whiteSpace:"nowrap",backdropFilter:"blur(12px)"}}>⚠️ Save failed — data kept locally</div>}
            {syncMsg&&dbStatus==="synced"&&<div style={{background:"rgba(0,15,5,0.95)",border:"1px solid #4ade80",color:"#4ade80",fontSize:11,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",letterSpacing:"0.07em",textTransform:"uppercase",padding:"6px 16px",borderRadius:20,boxShadow:"0 4px 16px rgba(0,0,0,0.5)",whiteSpace:"nowrap",backdropFilter:"blur(12px)",animation:"fadeIn 0.3s ease"}}>✓ {syncMsg}</div>}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── NATIVE ADMIN APP (Capacitor stub — expands in a future native build) ─────
// When running as an Android/iOS APK, this component is shown instead of the
// full web AdminApp. It re-uses the same AdminApp shell for now — extend here
// with Capacitor-specific plugins (Camera, StatusBar, Haptics, etc.) as needed.
function NativeAdminApp() {
  const [mode,      setMode]      = useState("admin");
  const [storeData, setStoreData] = useState(null);

  useEffect(() => {
    setupNativePlugins();
  }, []);

  // Load local data when switching to store view (never call loadLocal inside render)
  useEffect(() => {
    if (mode === "store") {
      try { setStoreData(loadLocal()); } catch(_) { setStoreData(null); }
    }
  }, [mode]);

  // On native, show a lightweight store view without re-initializing Firebase
  if (mode === "store") {
    return (
      <CustomerStore
        products={storeData?.products || []}
        waNumber={storeData?.settings?.waNumber}
        waTemplate={storeData?.appConfig?.waTemplate}
        onGoAdmin={() => setMode("admin")}
      />
    );
  }
  return <AdminApp onBack={() => setMode("store")} />;
}

// ─── WEB APP (router) ─────────────────────────────────────────────────────────
function WebApp() {
  const [mode, setMode] = useState(()=>{
    const path = window.location.pathname;
    const hash = window.location.hash.replace("#","");
    if (path==="/admin" || hash==="admin" || hash.startsWith("admin")) return "admin";
    if (path==="/store") return "store";
    if (path==="/" || path==="") return "landing";
    return "landing";
  });
  const { cachedData, setCachedData } = useAppData();
  const [storeData,   setStoreData]   = useState(()=>cachedData||loadLocal());
  const [storeLoading,setStoreLoading]= useState(false);

  // Keep storeData in sync with Zustand cache (same-tab admin edits)
  useEffect(()=>appDataStore.subscribe(s=>{ if(s.data)setStoreData(s.data); }),[]);

  // Subscribe to Firestore for store (anonymous auth)
  useEffect(()=>{
    let unsub = null;
    setStoreLoading(true);

    const subscribe = (db) => {
      unsub = onSnapshot(doc(db,"fk_fashion","data"),
        snap=>{
          try{
            if(!snap.exists()){setStoreLoading(false);return;}
            const d=snap.data();
            applyServicesConfig(d.appConfig);
            const products=mergeImagesIntoProducts(d.products||[],{});
            const merged=_buildMergedData({...d,products});
            setStoreData(merged); setCachedData(merged); saveLocal(merged);
          }catch(e){console.error("Store snapshot error:",e);}
          finally{setStoreLoading(false);}
        },
        err=>{console.error("Store Firestore error:",err.code);setStoreLoading(false);}
      );
    };

    try{
      const{auth,db}=getFirebase();
      const unsubAuth=onAuthStateChanged(auth,resolvedUser=>{
        unsubAuth();
        if(resolvedUser){subscribe(db);}
        else{signInAnonymously(auth).catch(()=>{}).finally(()=>subscribe(db));}
      });
    }catch(e){console.error("Store sync error:",e);setStoreLoading(false);}

    return()=>{ if(unsub)unsub(); };
  },[]);

  // Sync adminEmails from Firestore appConfig to ADMIN_EMAILS array
  useEffect(()=>appDataStore.subscribe(s=>{
    if(s.data?.appConfig?.adminEmails?.length){
      const updated = s.data.appConfig.adminEmails.map(e=>e.toLowerCase().trim());
      // Safely replace contents without breaking other references
      ADMIN_EMAILS.splice(0, ADMIN_EMAILS.length, ...updated);
    }
  }),[]);

  // Clean URL routing (no hash)
  useEffect(()=>{
    const target = mode==="admin" ? "/admin" : mode==="store" ? "/store" : "/";
    if (window.location.pathname !== target)
      window.history.replaceState(null, "", target);
  },[mode]);

  useEffect(()=>{
    const onPop = () => {
      const path = window.location.pathname;
      if      (path==="/admin") setMode("admin");
      else if (path==="/store") setMode("store");
      else                      setMode("landing");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  },[]);

  const goAdmin = ()=>{ window.history.pushState(null,"","/admin"); setMode("admin"); };
  const goStore = ()=>{ window.history.pushState(null,"","/"); setMode("landing"); };

  if (mode==="admin") return <AdminApp onBack={goStore} />;

  if (mode==="landing") return (
    <LandingPage onSelectMode={(m)=>{
      if (m==="admin") { window.history.pushState(null,"","/admin"); setMode("admin"); }
      else             { window.history.pushState(null,"","/store"); setMode("store"); }
    }} />
  );

  // Show spinner only on very first load with no cached data
  if (storeLoading && (!storeData?.products?.length)) {
    return (
      <div style={{minHeight:"100dvh",background:"var(--dark)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
        <div style={{width:60,height:60,borderRadius:"50%",border:"2px solid var(--rose)",borderTopColor:"transparent",animation:"fk-spin 0.8s linear infinite",marginBottom:20}} />
        <div style={{fontSize:14,fontWeight:600,color:"var(--text2)",letterSpacing:3}}>FK FASHION</div>
        <style>{`:root{--rose:#e11d48;--dark:#0a0a0a;--text2:#a89d8a;}@keyframes fk-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <CustomerStore
      products={storeData?.products||[]}
      waNumber={storeData?.settings?.waNumber}
      waTemplate={storeData?.appConfig?.waTemplate}
      onGoAdmin={goAdmin}
    />
  );
}

// ─── ROOT EXPORT ──────────────────────────────────────────────────────────────
export default function App() {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    let cancelled = false;
    IS_NATIVE_PROMISE.then(() => {
      if (!cancelled && getIsNative()) setIsNative(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (isNative) return <NativeAdminApp />;
  return <WebApp />;
}