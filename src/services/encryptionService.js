import crypto from "crypto";
import { ApiError } from "../utilities/ApiError.js";

const getEncryptionKey = () => {
  const configuredKey =
    process.env.CONNECTOR_ENCRYPTION_KEY ||
    process.env.AUTH_PROFILE_ENCRYPTION_KEY;

  if (configuredKey) {
    const base64Key = Buffer.from(configuredKey, "base64");
    if (base64Key.length === 32) return base64Key;

    const hexKey = Buffer.from(configuredKey, "hex");
    if (hexKey.length === 32) return hexKey;
  }

  const fallbackSecret = process.env.JWT_KEY || process.env.SESSION_SECRET;
  if (!fallbackSecret) {
    throw new ApiError(
      500,
      "Connector encryption is not configured. Set CONNECTOR_ENCRYPTION_KEY."
    );
  }

  return crypto.createHash("sha256").update(fallbackSecret).digest();
};

export const encryptJson = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);

  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
};

export const decryptJson = (encryptedValue) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encryptedValue.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encryptedValue.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue.data, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
};
