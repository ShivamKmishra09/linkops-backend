import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import puppeteer from "puppeteer";
import { AuthProfile } from "../models/AuthProfile.js";
import { ApiError } from "../utilities/ApiError.js";
import { decryptJson, encryptJson } from "./encryptionService.js";

const pendingSessions = new Map();
const captureTtlMs = 10 * 60 * 1000;

export const encryptSessionState = encryptJson;
export const decryptSessionState = decryptJson;

export const normalizeUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new ApiError(400, "A valid URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new ApiError(400, "Enter a valid URL including http:// or https://.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(400, "Only http and https URLs are supported.");
  }

  return parsed;
};

const isHostnameAllowedForProfile = (targetHostname, profileHostname) => {
  const normalizedTarget = targetHostname.toLowerCase();
  const normalizedProfile = profileHostname.toLowerCase();
  return (
    normalizedTarget === normalizedProfile ||
    normalizedTarget.endsWith(`.${normalizedProfile}`)
  );
};

export const listUserAuthProfiles = async (ownerId) => {
  const now = new Date();
  await AuthProfile.updateMany(
    {
      owner: ownerId,
      expiresAt: { $ne: null, $lte: now },
      status: "ACTIVE",
    },
    { $set: { status: "EXPIRED", lastError: "Session expired." } }
  );

  return AuthProfile.find({ owner: ownerId })
    .select("-encryptedState")
    .sort({ updatedAt: -1 })
    .lean();
};

const cleanupPendingSession = async (sessionId) => {
  const pending = pendingSessions.get(sessionId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingSessions.delete(sessionId);

  try {
    await pending.browser?.close();
  } catch (error) {
    console.warn("Failed to close auth capture browser:", error.message);
  }

  if (pending.userDataDir) {
    try {
      await fs.rm(pending.userDataDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean auth capture profile:", error.message);
    }
  }
};

export const startAuthCapture = async ({ ownerId, name, loginUrl }) => {
  const parsedUrl = normalizeUrl(loginUrl);
  const sanitizedName =
    typeof name === "string" && name.trim()
      ? name.trim().slice(0, 80)
      : parsedUrl.hostname;
  const sessionId = crypto.randomUUID();
  const userDataDir = path.join(os.tmpdir(), `linkly-auth-${sessionId}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (error) {
    throw new ApiError(
      500,
      `Could not open an interactive browser for login capture: ${error.message}`
    );
  }

  try {
    const page = await browser.newPage();
    await page.goto(parsedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const timeout = setTimeout(() => {
      cleanupPendingSession(sessionId);
    }, captureTtlMs);

    pendingSessions.set(sessionId, {
      ownerId: String(ownerId),
      name: sanitizedName,
      loginUrl: parsedUrl.toString(),
      hostname: parsedUrl.hostname.toLowerCase(),
      origin: parsedUrl.origin,
      browser,
      page,
      userDataDir,
      timeout,
      createdAt: new Date(),
    });

    return {
      sessionId,
      hostname: parsedUrl.hostname.toLowerCase(),
      origin: parsedUrl.origin,
      expiresInSeconds: Math.floor(captureTtlMs / 1000),
    };
  } catch (error) {
    try {
      await browser?.close();
    } catch {
      // Ignore cleanup errors after a failed capture start.
    }
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors after a failed capture start.
    }
    throw new ApiError(
      500,
      `Could not start login capture for this URL: ${error.message}`
    );
  }
};

const readStorage = async (page) => {
  try {
    return await page.evaluate(() => ({
      localStorage: Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index);
          return [key, window.localStorage.getItem(key)];
        })
      ),
      sessionStorage: Object.fromEntries(
        Array.from({ length: window.sessionStorage.length }, (_, index) => {
          const key = window.sessionStorage.key(index);
          return [key, window.sessionStorage.getItem(key)];
        })
      ),
    }));
  } catch {
    return { localStorage: {}, sessionStorage: {} };
  }
};

const getCookieExpiry = (cookies) => {
  const persistentExpiries = cookies
    .map((cookie) => cookie.expires)
    .filter((expires) => Number.isFinite(expires) && expires > 0)
    .map((expires) => new Date(expires * 1000));

  if (persistentExpiries.length === 0) return null;
  return new Date(Math.min(...persistentExpiries.map((date) => date.getTime())));
};

export const completeAuthCapture = async ({ ownerId, sessionId }) => {
  const pending = pendingSessions.get(sessionId);
  if (!pending || pending.ownerId !== String(ownerId)) {
    throw new ApiError(404, "Login capture session not found or expired.");
  }

  const currentUrl = pending.page.url();
  const currentParsedUrl = normalizeUrl(currentUrl);

  if (
    !isHostnameAllowedForProfile(currentParsedUrl.hostname, pending.hostname)
  ) {
    throw new ApiError(
      400,
      `Finish login on ${pending.hostname} before saving this auth profile. Current page is ${currentParsedUrl.hostname}.`
    );
  }

  const cookieUrls = Array.from(
    new Set([pending.loginUrl, currentParsedUrl.toString(), pending.origin])
  );
  const cookies = await pending.page.cookies(...cookieUrls);
  const storage = await readStorage(pending.page);
  const userAgent = await pending.page.evaluate(() => navigator.userAgent);

  if (cookies.length === 0 && Object.keys(storage.localStorage).length === 0) {
    throw new ApiError(
      400,
      "No cookies or local storage were captured. Please complete login before saving."
    );
  }

  const state = {
    version: 1,
    hostname: pending.hostname,
    origin: pending.origin,
    capturedAt: new Date().toISOString(),
    userAgent,
    cookies,
    localStorage: storage.localStorage,
    sessionStorage: storage.sessionStorage,
  };

  const encryptedState = encryptSessionState(state);
  const expiresAt = getCookieExpiry(cookies);

  const profile = await AuthProfile.findOneAndUpdate(
    {
      owner: ownerId,
      hostname: pending.hostname,
      name: pending.name,
    },
    {
      $set: {
        owner: ownerId,
        name: pending.name,
        hostname: pending.hostname,
        origin: pending.origin,
        encryptedState,
        status: "ACTIVE",
        cookieCount: cookies.length,
        localStorageKeyCount: Object.keys(storage.localStorage).length,
        expiresAt,
        lastValidatedAt: new Date(),
        lastError: null,
      },
    },
    { new: true, upsert: true }
  )
    .select("-encryptedState")
    .lean();

  await cleanupPendingSession(sessionId);
  return profile;
};

export const cancelAuthCapture = async ({ ownerId, sessionId }) => {
  const pending = pendingSessions.get(sessionId);
  if (!pending || pending.ownerId !== String(ownerId)) {
    throw new ApiError(404, "Login capture session not found or expired.");
  }

  await cleanupPendingSession(sessionId);
};

export const getUsableAuthProfile = async ({ ownerId, authProfileId, url }) => {
  if (!authProfileId) return null;

  const parsedUrl = normalizeUrl(url);
  const profile = await AuthProfile.findOne({
    _id: authProfileId,
    owner: ownerId,
  });

  if (!profile) {
    throw new ApiError(404, "Selected auth profile was not found.");
  }

  if (!isHostnameAllowedForProfile(parsedUrl.hostname, profile.hostname)) {
    throw new ApiError(
      400,
      `Selected auth profile is for ${profile.hostname}, not ${parsedUrl.hostname}.`
    );
  }

  if (profile.status !== "ACTIVE") {
    throw new ApiError(400, "Selected auth profile is not active.");
  }

  if (profile.expiresAt && profile.expiresAt <= new Date()) {
    profile.status = "EXPIRED";
    profile.lastError = "Session expired.";
    await profile.save();
    throw new ApiError(400, "Selected auth profile has expired.");
  }

  return profile;
};

export const applyAuthProfileToPage = async ({
  page,
  ownerId,
  authProfileId,
  url,
}) => {
  const profile = await getUsableAuthProfile({ ownerId, authProfileId, url });
  if (!profile) return null;

  const state = decryptSessionState(profile.encryptedState);
  const cookies = (state.cookies || [])
    .filter((cookie) => {
      if (!cookie.expires || cookie.expires < 0) return true;
      return cookie.expires * 1000 > Date.now();
    })
    .map((cookie) => {
      const sanitized = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
      };

      if (cookie.expires && cookie.expires > 0) {
        sanitized.expires = cookie.expires;
      }
      if (cookie.sameSite && ["Strict", "Lax", "None"].includes(cookie.sameSite)) {
        sanitized.sameSite = cookie.sameSite;
      }

      return sanitized;
    });

  if (state.userAgent) {
    await page.setUserAgent(state.userAgent);
  }

  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }

  await page.evaluateOnNewDocument((savedState) => {
    try {
      if (window.location.origin !== savedState.origin) return;

      Object.entries(savedState.localStorage || {}).forEach(([key, value]) => {
        window.localStorage.setItem(key, value);
      });
      Object.entries(savedState.sessionStorage || {}).forEach(([key, value]) => {
        window.sessionStorage.setItem(key, value);
      });
    } catch {
      // Storage may be unavailable on some pages.
    }
  }, state);

  profile.lastUsedAt = new Date();
  profile.lastError = null;
  await profile.save();
  return profile;
};

export const markAuthProfileFailed = async (authProfileId, message) => {
  if (!authProfileId) return;

  await AuthProfile.findByIdAndUpdate(authProfileId, {
    $set: {
      status: "FAILED",
      lastError: String(message || "Authenticated scrape failed.").slice(0, 300),
    },
  });
};
