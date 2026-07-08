import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import { ConnectorCredential } from "../models/ConnectorCredential.js";
import { ApiError } from "../utilities/ApiError.js";
import { decryptJson, encryptJson } from "./encryptionService.js";

const pendingGoogleOAuthStates = new Map();

const normalizeSiteUrl = (rawSiteUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawSiteUrl || "").trim());
  } catch {
    throw new ApiError(400, "Enter a valid Atlassian site URL.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new ApiError(400, "Atlassian site URL must start with http or https.");
  }

  return {
    siteUrl: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
  };
};

const getAtlassianAuthHeader = ({ email, apiToken }) =>
  `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;

const stripHtml = (html = "") => {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,canvas,iframe").remove();
  return $.text().replace(/\s\s+/g, " ").trim();
};

export const listConnectorCredentials = async (ownerId) => {
  return ConnectorCredential.find({ owner: ownerId })
    .select("-encryptedCredential")
    .sort({ updatedAt: -1 })
    .lean();
};

export const upsertAtlassianCredential = async ({
  ownerId,
  siteUrl,
  email,
  apiToken,
}) => {
  const normalized = normalizeSiteUrl(siteUrl);

  if (!email || !String(email).includes("@")) {
    throw new ApiError(400, "Enter the Atlassian account email.");
  }

  if (!apiToken || String(apiToken).trim().length < 10) {
    throw new ApiError(400, "Enter a valid Atlassian API token.");
  }

  const encryptedCredential = encryptJson({
    email: String(email).trim(),
    apiToken: String(apiToken).trim(),
  });

  const credential = await ConnectorCredential.findOneAndUpdate(
    {
      owner: ownerId,
      provider: "ATLASSIAN",
      hostname: normalized.hostname,
    },
    {
      $set: {
        owner: ownerId,
        provider: "ATLASSIAN",
        siteUrl: normalized.siteUrl,
        hostname: normalized.hostname,
        encryptedCredential,
        status: "ACTIVE",
        lastError: null,
      },
    },
    { new: true, upsert: true }
  )
    .select("-encryptedCredential")
    .lean();

  return credential;
};

export const upsertGitHubCredential = async ({ ownerId, token }) => {
  if (!token || String(token).trim().length < 20) {
    throw new ApiError(400, "Enter a valid GitHub personal access token.");
  }

  const encryptedCredential = encryptJson({ token: String(token).trim() });
  const credential = await ConnectorCredential.findOneAndUpdate(
    {
      owner: ownerId,
      provider: "GITHUB",
      hostname: "github.com",
    },
    {
      $set: {
        owner: ownerId,
        provider: "GITHUB",
        siteUrl: "https://github.com",
        hostname: "github.com",
        encryptedCredential,
        status: "ACTIVE",
        lastError: null,
      },
    },
    { new: true, upsert: true }
  )
    .select("-encryptedCredential")
    .lean();

  return credential;
};

const getGoogleOAuthConfig = () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    `${process.env.REACT_APP_BACKEND_URL}/connectors/google/callback`;

  if (!clientId || !clientSecret) {
    throw new ApiError(
      400,
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
    );
  }

  return { clientId, clientSecret, redirectUri };
};

export const createGoogleOAuthUrl = ({ ownerId }) => {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const state = crypto.randomUUID();
  pendingGoogleOAuthStates.set(state, {
    ownerId: String(ownerId),
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const completeGoogleOAuth = async ({ code, state }) => {
  const pending = pendingGoogleOAuthStates.get(state);
  pendingGoogleOAuthStates.delete(state);

  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    throw new ApiError(400, "Google connector setup expired. Try again.");
  }

  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const response = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
    }
  );

  const tokenPayload = response.data;
  const encryptedCredential = encryptJson({
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt: Date.now() + tokenPayload.expires_in * 1000,
    tokenType: tokenPayload.token_type || "Bearer",
  });

  return ConnectorCredential.findOneAndUpdate(
    {
      owner: pending.ownerId,
      provider: "GOOGLE",
      hostname: "google.com",
    },
    {
      $set: {
        owner: pending.ownerId,
        provider: "GOOGLE",
        siteUrl: "https://google.com",
        hostname: "google.com",
        encryptedCredential,
        status: "ACTIVE",
        lastError: null,
      },
    },
    { new: true, upsert: true }
  ).select("-encryptedCredential");
};

export const deleteConnectorCredential = async ({ ownerId, credentialId }) => {
  const deleted = await ConnectorCredential.findOneAndDelete({
    _id: credentialId,
    owner: ownerId,
  });

  if (!deleted) {
    throw new ApiError(404, "Connector credential not found.");
  }
};

const getCredentialForUrl = async ({ ownerId, url }) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    return ConnectorCredential.findOne({
      owner: ownerId,
      provider: "GITHUB",
      hostname: "github.com",
    });
  }

  if (
    hostname === "docs.google.com" ||
    hostname === "drive.google.com"
  ) {
    return ConnectorCredential.findOne({
      owner: ownerId,
      provider: "GOOGLE",
      hostname: "google.com",
    });
  }

  return ConnectorCredential.findOne({
    owner: ownerId,
    provider: "ATLASSIAN",
    $or: [{ hostname }, { hostname: hostname.replace(/^www\./, "") }],
  });
};

const fetchConfluencePageById = async ({ credential, pageId }) => {
  const decrypted = decryptJson(credential.encryptedCredential);
  const response = await axios.get(
    `${credential.siteUrl}/wiki/rest/api/content/${pageId}`,
    {
      params: { expand: "body.storage,space,version" },
      headers: {
        Authorization: getAtlassianAuthHeader(decrypted),
        Accept: "application/json",
      },
      timeout: 20000,
    }
  );

  const page = response.data;
  const text = stripHtml(page.body?.storage?.value || "");
  return {
    text: [
      `Title: ${page.title || "Confluence page"}`,
      page.space?.name ? `Space: ${page.space.name}` : "",
      text,
    ]
      .filter(Boolean)
      .join("\n\n"),
    source: "ATLASSIAN_CONFLUENCE",
    title: page.title,
  };
};

const fetchConfluenceSpaceHome = async ({ credential, spaceKey }) => {
  const decrypted = decryptJson(credential.encryptedCredential);
  const response = await axios.get(
    `${credential.siteUrl}/wiki/rest/api/space/${encodeURIComponent(spaceKey)}`,
    {
      params: { expand: "homepage" },
      headers: {
        Authorization: getAtlassianAuthHeader(decrypted),
        Accept: "application/json",
      },
      timeout: 20000,
    }
  );

  const homepageId = response.data?.homepage?.id;
  if (!homepageId) {
    return {
      text: [
        `Space: ${response.data?.name || spaceKey}`,
        response.data?.description?.plain?.value || "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      source: "ATLASSIAN_CONFLUENCE",
      title: response.data?.name || spaceKey,
    };
  }

  return fetchConfluencePageById({ credential, pageId: homepageId });
};

const fetchJiraIssue = async ({ credential, issueKey }) => {
  const decrypted = decryptJson(credential.encryptedCredential);
  const response = await axios.get(
    `${credential.siteUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      params: {
        fields:
          "summary,description,status,assignee,reporter,priority,issuetype,labels",
      },
      headers: {
        Authorization: getAtlassianAuthHeader(decrypted),
        Accept: "application/json",
      },
      timeout: 20000,
    }
  );

  const issue = response.data;
  const fields = issue.fields || {};
  const description =
    typeof fields.description === "string"
      ? fields.description
      : JSON.stringify(fields.description || "");

  return {
    text: [
      `Issue: ${issue.key}`,
      `Summary: ${fields.summary || ""}`,
      fields.status?.name ? `Status: ${fields.status.name}` : "",
      fields.priority?.name ? `Priority: ${fields.priority.name}` : "",
      fields.assignee?.displayName ? `Assignee: ${fields.assignee.displayName}` : "",
      fields.reporter?.displayName ? `Reporter: ${fields.reporter.displayName}` : "",
      fields.labels?.length ? `Labels: ${fields.labels.join(", ")}` : "",
      `Description: ${description}`,
    ]
      .filter(Boolean)
      .join("\n"),
    source: "ATLASSIAN_JIRA",
    title: `${issue.key}: ${fields.summary || ""}`,
  };
};

const githubHeaders = (credential) => {
  const { token } = decryptJson(credential.encryptedCredential);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
};

const decodeGitHubBase64 = (value = "") =>
  Buffer.from(String(value).replace(/\n/g, ""), "base64").toString("utf8");

const optionalGitHubGet = async (url, { headers, params } = {}) => {
  try {
    const response = await axios.get(url, {
      headers,
      params,
      timeout: 20000,
    });
    return response.data;
  } catch {
    return null;
  }
};

const formatGitHubItems = (label, items = [], formatter) => {
  if (!items.length) return "";
  return [
    `${label}:`,
    ...items
      .map((item, index) => formatter(item, index))
      .filter(Boolean)
      .map((line) => `- ${line}`),
  ].join("\n");
};

const githubSsoUrlFromHeader = (header = "") => {
  const match = String(header).match(/url=([^;,\s]+)/i);
  return match ? match[1] : "";
};

const getConnectorFetchErrorMessage = ({ credential, error }) => {
  const provider = credential.provider;
  const rawMessage =
    error.response?.data?.message ||
    error.response?.data?.errorMessages?.join(", ") ||
    error.message ||
    "Connector fetch failed.";

  if (
    provider === "GITHUB" &&
    error.response?.status === 403 &&
    /saml|single sign-on|sso/i.test(rawMessage)
  ) {
    const ssoUrl = githubSsoUrlFromHeader(error.response?.headers?.["x-github-sso"]);
    return [
      "GitHub organization SAML SSO is blocking this token.",
      "Open GitHub Personal access tokens > Configure SSO and authorize this token for the organization, then re-run analysis.",
      ssoUrl ? `Authorization URL: ${ssoUrl}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (provider === "GITHUB" && error.response?.status === 404) {
    return "GitHub could not find this resource for the configured token. Check that the token has access to the private repository and that the URL points to a repository, issue, pull request, file, or directory.";
  }

  if (provider === "GITHUB" && error.response?.status === 401) {
    return "GitHub rejected the token. Re-save the connector with a valid token that has access to the target repositories.";
  }

  return rawMessage;
};

const extractGitHubTarget = (url) => {
  const parsed = new URL(url);
  const [, owner, repo, section, ...rest] = parsed.pathname.split("/");
  if (!owner || !repo) return null;

  if (section === "issues" && rest[0]) {
    return { type: "issue", owner, repo, number: rest[0] };
  }
  if (section === "pull" && rest[0]) {
    return { type: "pull", owner, repo, number: rest[0] };
  }
  if (section === "blob" && rest.length >= 2) {
    const ref = rest[0];
    const filePath = rest.slice(1).join("/");
    return { type: "file", owner, repo, ref, filePath };
  }
  if (section === "tree" && rest.length >= 1) {
    const ref = rest[0];
    const directoryPath = rest.slice(1).join("/");
    return { type: "directory", owner, repo, ref, directoryPath };
  }
  return { type: "repo", owner, repo };
};

const fetchGitHubContent = async ({ credential, target }) => {
  const headers = githubHeaders(credential);

  if (target.type === "issue" || target.type === "pull") {
    const issueResponse = await axios.get(
      `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}`,
      { headers, timeout: 20000 }
    );
    const issue = issueResponse.data;
    const [issueComments, pull, pullFiles, reviewComments] =
      await Promise.all([
        optionalGitHubGet(
          `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}/comments`,
          { headers, params: { per_page: 20 } }
        ),
        target.type === "pull"
          ? optionalGitHubGet(
              `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}`,
              { headers }
            )
          : null,
        target.type === "pull"
          ? optionalGitHubGet(
              `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}/files`,
              { headers, params: { per_page: 40 } }
            )
          : null,
        target.type === "pull"
          ? optionalGitHubGet(
              `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}/comments`,
              { headers, params: { per_page: 20 } }
            )
          : null,
      ]);

    return {
      text: [
        `${target.type === "pull" ? "Pull request" : "Issue"}: #${issue.number}`,
        `Title: ${issue.title}`,
        `State: ${issue.state}`,
        issue.user?.login ? `Author: ${issue.user.login}` : "",
        issue.created_at ? `Created: ${issue.created_at}` : "",
        issue.updated_at ? `Updated: ${issue.updated_at}` : "",
        issue.labels?.length
          ? `Labels: ${issue.labels.map((label) => label.name).join(", ")}`
          : "",
        pull?.base?.ref && pull?.head?.ref
          ? `Branches: ${pull.head.ref} -> ${pull.base.ref}`
          : "",
        pull
          ? `PR changes: ${pull.changed_files || 0} files, ${pull.additions || 0} additions, ${pull.deletions || 0} deletions`
          : "",
        issue.body || "",
        formatGitHubItems("Changed files", pullFiles || [], (file) =>
          [
            file.filename,
            file.status ? `(${file.status})` : "",
            `+${file.additions || 0}/-${file.deletions || 0}`,
          ]
            .filter(Boolean)
            .join(" ")
        ),
        formatGitHubItems("Discussion comments", issueComments || [], (comment) =>
          [
            comment.user?.login ? `${comment.user.login}:` : "",
            String(comment.body || "").slice(0, 1000),
          ]
            .filter(Boolean)
            .join(" ")
        ),
        formatGitHubItems("Review comments", reviewComments || [], (comment) =>
          [
            comment.user?.login ? `${comment.user.login} on ${comment.path}:` : "",
            String(comment.body || "").slice(0, 1000),
          ]
            .filter(Boolean)
            .join(" ")
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      source: "GITHUB",
      title: issue.title,
    };
  }

  if (target.type === "file") {
    const fileResponse = await axios.get(
      `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.filePath}`,
      {
        params: { ref: target.ref },
        headers,
        timeout: 20000,
      }
    );
    const file = fileResponse.data;
    if (Array.isArray(file)) {
      return {
        text: [
          `Repository: ${target.owner}/${target.repo}`,
          `Directory: ${target.filePath}`,
          formatGitHubItems("Files", file.slice(0, 100), (item) =>
            `${item.type}: ${item.path}`
          ),
        ]
          .filter(Boolean)
          .join("\n\n"),
        source: "GITHUB",
        title: target.filePath,
      };
    }
    const text = decodeGitHubBase64(file.content || "");
    return {
      text: [`Repository: ${target.owner}/${target.repo}`, `File: ${file.path}`, text]
        .filter(Boolean)
        .join("\n\n"),
      source: "GITHUB",
      title: file.path,
    };
  }

  if (target.type === "directory") {
    const directoryResponse = await axios.get(
      `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.directoryPath}`,
      {
        params: { ref: target.ref },
        headers,
        timeout: 20000,
      }
    );
    const entries = Array.isArray(directoryResponse.data)
      ? directoryResponse.data
      : [directoryResponse.data];
    return {
      text: [
        `Repository: ${target.owner}/${target.repo}`,
        `Directory: ${target.directoryPath || "/"}`,
        formatGitHubItems("Files", entries.slice(0, 100), (item) =>
          `${item.type}: ${item.path}`
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      source: "GITHUB",
      title: `${target.owner}/${target.repo}/${target.directoryPath || ""}`,
    };
  }

  const repoResponse = await axios.get(
    `https://api.github.com/repos/${target.owner}/${target.repo}`,
    { headers, timeout: 20000 }
  );
  const [readme, languages, topics, rootContents, openIssues, openPulls] =
    await Promise.all([
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/readme`,
        { headers }
      ),
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/languages`,
        { headers }
      ),
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/topics`,
        {
          headers: {
            ...headers,
            Accept: "application/vnd.github+json",
          },
        }
      ),
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/contents`,
        { headers }
      ),
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/issues`,
        {
          headers,
          params: { state: "open", per_page: 10, sort: "updated" },
        }
      ),
      optionalGitHubGet(
        `https://api.github.com/repos/${target.owner}/${target.repo}/pulls`,
        {
          headers,
          params: { state: "open", per_page: 10, sort: "updated" },
        }
      ),
    ]);

  const repo = repoResponse.data;
  const readmeText = readme?.content ? decodeGitHubBase64(readme.content) : "";
  const languageNames = languages ? Object.keys(languages) : [];
  const topicNames = topics?.names || [];
  return {
    text: [
      `Repository: ${repo.full_name}`,
      repo.description ? `Description: ${repo.description}` : "",
      `Default branch: ${repo.default_branch}`,
      repo.private ? "Visibility: private" : "Visibility: public",
      `Stars: ${repo.stargazers_count}`,
      repo.open_issues_count ? `Open issues and PRs: ${repo.open_issues_count}` : "",
      repo.homepage ? `Homepage: ${repo.homepage}` : "",
      repo.license?.name ? `License: ${repo.license.name}` : "",
      languageNames.length ? `Languages: ${languageNames.join(", ")}` : "",
      topicNames.length ? `Topics: ${topicNames.join(", ")}` : "",
      Array.isArray(rootContents)
        ? formatGitHubItems("Top-level files", rootContents.slice(0, 50), (item) =>
            `${item.type}: ${item.name}`
          )
        : "",
      formatGitHubItems("Recently updated open issues", openIssues || [], (item) =>
        `#${item.number} ${item.title}${item.pull_request ? " (pull request)" : ""}`
      ),
      formatGitHubItems("Open pull requests", openPulls || [], (item) =>
        `#${item.number} ${item.title}`
      ),
      readmeText,
    ]
      .filter(Boolean)
      .join("\n\n"),
    source: "GITHUB",
    title: repo.full_name,
  };
};

const refreshGoogleAccessToken = async (credential) => {
  const data = decryptJson(credential.encryptedCredential);
  if (data.accessToken && data.expiresAt && data.expiresAt - 60000 > Date.now()) {
    return data.accessToken;
  }

  if (!data.refreshToken) {
    throw new Error("Google connector is missing a refresh token. Reconnect Google.");
  }

  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const response = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refreshToken,
      grant_type: "refresh_token",
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
    }
  );

  const nextData = {
    ...data,
    accessToken: response.data.access_token,
    expiresAt: Date.now() + response.data.expires_in * 1000,
    tokenType: response.data.token_type || "Bearer",
  };
  credential.encryptedCredential = encryptJson(nextData);
  await credential.save();
  return nextData.accessToken;
};

const googleHeaders = async (credential) => ({
  Authorization: `Bearer ${await refreshGoogleAccessToken(credential)}`,
  Accept: "application/json",
});

const extractGoogleDocText = (doc) => {
  const chunks = [];
  const walk = (node) => {
    if (!node) return;
    if (node.textRun?.content) chunks.push(node.textRun.content);
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    });
  };
  walk(doc.body);
  return chunks.join("").replace(/\s\s+/g, " ").trim();
};

const extractGoogleTarget = (url) => {
  const parsed = new URL(url);
  const docId = parsed.pathname.match(/\/document\/d\/([^/]+)/)?.[1];
  if (docId) return { type: "google-doc", id: docId };

  const spreadsheetId = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (spreadsheetId) {
    return { type: "drive-file", id: spreadsheetId, exportMimeType: "text/csv" };
  }

  const presentationId = parsed.pathname.match(/\/presentation\/d\/([^/]+)/)?.[1];
  if (presentationId) {
    return { type: "drive-file", id: presentationId, exportMimeType: "text/plain" };
  }

  const driveFileId =
    parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ||
    parsed.searchParams.get("id");
  if (driveFileId) return { type: "drive-file", id: driveFileId };

  return null;
};

const fetchGoogleContent = async ({ credential, target }) => {
  const headers = await googleHeaders(credential);

  if (target.type === "google-doc") {
    const response = await axios.get(
      `https://docs.googleapis.com/v1/documents/${target.id}`,
      { headers, timeout: 20000 }
    );
    const doc = response.data;
    return {
      text: [`Title: ${doc.title || "Google Doc"}`, extractGoogleDocText(doc)]
        .filter(Boolean)
        .join("\n\n"),
      source: "GOOGLE_DOCS",
      title: doc.title,
    };
  }

  if (target.type === "drive-file") {
    const metaResponse = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${target.id}`,
      {
        params: { fields: "id,name,mimeType,description,webViewLink" },
        headers,
        timeout: 20000,
      }
    );
    const meta = metaResponse.data;
    let text = meta.description || "";
    const googleExportMimeTypes = {
      "application/vnd.google-apps.document": "text/plain",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
    };
    const exportMimeType =
      target.exportMimeType || googleExportMimeTypes[meta.mimeType];
    if (exportMimeType) {
      const exportResponse = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${target.id}/export`,
        {
          params: { mimeType: exportMimeType },
          headers,
          timeout: 20000,
        }
      );
      text = exportResponse.data;
    } else if (
      meta.mimeType?.startsWith("text/") ||
      ["application/json", "application/xml", "text/markdown"].includes(
        meta.mimeType
      )
    ) {
      const fileResponse = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${target.id}`,
        {
          params: { alt: "media" },
          headers,
          timeout: 20000,
          responseType: "text",
        }
      );
      text = fileResponse.data;
    }
    return {
      text: [
        `Drive file: ${meta.name}`,
        `MIME type: ${meta.mimeType}`,
        meta.webViewLink ? `Link: ${meta.webViewLink}` : "",
        text,
      ]
        .filter(Boolean)
        .join("\n\n"),
      source: "GOOGLE_DRIVE",
      title: meta.name,
    };
  }
};

const extractAtlassianTarget = (url) => {
  const parsed = new URL(url);
  const pageId =
    parsed.pathname.match(/\/pages\/(\d+)/)?.[1] ||
    parsed.pathname.match(/\/pages\/edit-v2\/(\d+)/)?.[1] ||
    parsed.search.match(/[?&]pageId=(\d+)/)?.[1];
  if (pageId) return { type: "confluence-page", pageId };

  const spaceOverviewKey = parsed.pathname.match(
    /\/wiki\/spaces\/([^/]+)(?:\/overview)?\/?$/
  )?.[1];
  if (spaceOverviewKey) {
    return {
      type: "confluence-space-home",
      spaceKey: decodeURIComponent(spaceOverviewKey),
    };
  }

  const issueKey =
    parsed.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1] ||
    parsed.search.match(/[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/i)?.[1];
  if (issueKey) return { type: "jira-issue", issueKey: issueKey.toUpperCase() };

  return null;
};

export const fetchConnectorContentForUrl = async ({ ownerId, url }) => {
  const credential = await getCredentialForUrl({ ownerId, url });
  if (!credential) return null;

  if (credential.status !== "ACTIVE") {
    return {
      attempted: true,
      error:
        credential.lastError ||
        "The Atlassian connector is not active. Re-save the connector credentials.",
      source: credential.provider,
    };
  }

  const target =
    credential.provider === "ATLASSIAN"
      ? extractAtlassianTarget(url)
      : credential.provider === "GITHUB"
        ? extractGitHubTarget(url)
        : extractGoogleTarget(url);
  if (!target) {
    return {
      attempted: true,
      source: credential.provider,
      error:
        credential.provider === "ATLASSIAN"
          ? "Atlassian connector is configured, but this URL is not a specific Confluence page, space overview, or Jira issue. Use a Confluence URL with /pages/{pageId}/..., a space overview URL, or a Jira /browse/KEY-123 URL."
          : credential.provider === "GITHUB"
            ? "GitHub connector is configured, but this URL is not a supported repository, issue, pull request, or file URL."
            : "Google connector is configured, but this URL is not a supported Google Docs, Sheets, Slides, or Drive file URL.",
    };
  }

  try {
    let result;
    if (credential.provider === "ATLASSIAN") {
      if (target.type === "confluence-page") {
        result = await fetchConfluencePageById({
          credential,
          pageId: target.pageId,
        });
      } else if (target.type === "confluence-space-home") {
        result = await fetchConfluenceSpaceHome({
          credential,
          spaceKey: target.spaceKey,
        });
      } else {
        result = await fetchJiraIssue({ credential, issueKey: target.issueKey });
      }
    } else if (credential.provider === "GITHUB") {
      result = await fetchGitHubContent({ credential, target });
    } else {
      result = await fetchGoogleContent({ credential, target });
    }

    credential.lastUsedAt = new Date();
    credential.lastError = null;
    await credential.save();

    return result;
  } catch (error) {
    if ([401, 403].includes(error.response?.status)) {
      credential.status = "FAILED";
    }
    credential.lastError = getConnectorFetchErrorMessage({
      credential,
      error,
    }).slice(0, 600);
    await credential.save();
    return {
      attempted: true,
      source: credential.provider,
      error: credential.lastError,
    };
  }
};
