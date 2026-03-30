// api/imagekit-auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Secure ImageKit authentication endpoint.
//
// SECURITY FIXES vs the old version:
//   1. Verifies the caller's Firebase ID token before signing anything.
//      Only a logged-in Firebase user can get a signature.
//   2. Private key lives ONLY here in server environment variables.
//      It is never sent to the browser, never stored in Firestore.
//   3. Returns 401 if the token is missing, expired, or invalid.
//
// REQUIRED environment variables (set in Vercel/Netlify/Railway):
//   IMAGEKIT_PUBLIC_KEY      — your ImageKit public key
//   IMAGEKIT_PRIVATE_KEY     — your ImageKit PRIVATE key (secret, never share)
//   IMAGEKIT_URL_ENDPOINT    — e.g. https://ik.imagekit.io/your_id
//   FIREBASE_PROJECT_ID      — from Firebase project settings
//   FIREBASE_CLIENT_EMAIL    — from Firebase service account JSON
//   FIREBASE_PRIVATE_KEY     — from Firebase service account JSON (with \n escaped)
//
// HOW TO GET FIREBASE SERVICE ACCOUNT:
//   Firebase console → Project Settings → Service Accounts → Generate new private key
//   Download the JSON. Copy projectId, clientEmail, private_key into env vars.
//
// DEPLOY: This file works as-is on Vercel (pages/api) or Next.js (app/api).
//         For Express, wrap in: app.get("/api/imagekit-auth", handler)
// ─────────────────────────────────────────────────────────────────────────────

import ImageKit from "imagekit";

// Firebase Admin SDK — verify ID tokens server-side
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// ── Initialize Firebase Admin (once) ──────────────────────────────────────────
function getAdminApp() {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores \n literally — replace back to real newlines
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// ── ImageKit instance (uses private key — server only) ─────────────────────────
function getImageKit() {
  return new ImageKit({
    publicKey:   process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey:  process.env.IMAGEKIT_PRIVATE_KEY,   // NEVER sent to browser
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Only GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Step 1: Extract Firebase ID token from Authorization header ──────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!idToken) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "No Firebase ID token provided. You must be logged in.",
    });
  }

  // ── Step 2: Verify the ID token with Firebase Admin ──────────────────────────
  try {
    const adminApp = getAdminApp();
    const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);

    // Optional: also check the user's email is an admin email
    // const adminEmails = ["tusert15@gmail.com", "tusert10@gmail.com"];
    // if (!adminEmails.includes(decodedToken.email?.toLowerCase())) {
    //   return res.status(403).json({ error: "Forbidden", message: "Not an admin account." });
    // }

    // Token is valid — proceed to generate ImageKit auth params
    const ik = getImageKit();
    const authParams = ik.getAuthenticationParameters();

    // Set cache headers to prevent reuse (ImageKit tokens expire in ~60s)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(authParams);

  } catch (err) {
    // Token expired, revoked, or forged
    if (err.code === "auth/id-token-expired" || err.code === "auth/id-token-revoked") {
      return res.status(401).json({
        error: "Token expired",
        message: "Your session has expired. Please sign in again.",
      });
    }
    if (err.code?.startsWith("auth/")) {
      return res.status(401).json({
        error: "Invalid token",
        message: "Authentication failed.",
      });
    }
    // Unexpected error
    console.error("imagekit-auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}