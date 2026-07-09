import mongoose from "mongoose";
import { KnowledgeAsset } from "../models/KnowledgeAsset.js";
import { Link } from "../models/Link.js";
import { Collection } from "../models/Collection.js";

const COLLECTION_BY_ASSET_TYPE = {
  github_repo: "GitHub Repos & PRs",
  github_pr: "GitHub Repos & PRs",
  github_issue: "GitHub Repos & PRs",
  doc: "Confluence Docs",
  sheet: "Google Docs & Sheets",
  figma: "Figma Designs",
  krd: "KRD / PRD Docs",
  prd: "KRD / PRD Docs",
  dashboard: "Dashboards & Reports",
  sop: "SOPs & Runbooks",
  runbook: "SOPs & Runbooks",
  incident: "Incidents & RCA",
  rca: "Incidents & RCA",
  onboarding: "Onboarding Docs",
  other: "Other Work Links",
};

const SOURCE_COLLECTION_HINTS = {
  github: "GitHub Repos & PRs",
  confluence: "Confluence Docs",
  google: "Google Docs & Sheets",
  figma: "Figma Designs",
};

const TEAM_HINTS = [
  ["seller", "Seller Experience"],
  ["catalog", "Catalog Ops"],
  ["pricing", "Pricing"],
  ["growth", "Growth"],
  ["checkout", "Checkout"],
  ["payment", "Payments"],
  ["logistics", "Logistics"],
  ["support", "Support"],
  ["ads", "Ads"],
  ["experiment", "Product Experiments"],
  ["incident", "Engineering Reliability"],
];

const ROLE_PRESETS = {
  engineering: [
    "github_repo",
    "github_pr",
    "github_issue",
    "runbook",
    "incident",
    "rca",
  ],
  product: ["prd", "krd", "figma", "dashboard"],
  data: ["dashboard", "sheet"],
  ops: ["sop", "runbook", "incident", "rca"],
  support: ["sop", "runbook", "onboarding", "doc"],
  leadership: ["dashboard", "prd", "krd", "rca"],
};

const KNOWLEDGE_PACKS = {
  engineering_onboarding: {
    title: "Engineering onboarding",
    role: "engineering",
    description: "Repos, runbooks, architecture docs, incidents, and setup links for engineers joining or rotating into a team.",
    assetTypes: ["github_repo", "runbook", "doc", "incident", "rca"],
    keywords: ["onboarding", "setup", "architecture", "runbook", "incident", "repo"],
    requiredTypes: ["github_repo", "runbook", "doc"],
  },
  product_launch: {
    title: "Product launch pack",
    role: "product",
    description: "PRDs, KRDs, Figma files, dashboards, and decision docs needed to understand a launch.",
    assetTypes: ["prd", "krd", "figma", "dashboard", "doc"],
    keywords: ["launch", "prd", "krd", "experiment", "figma", "metric"],
    requiredTypes: ["prd", "krd", "figma"],
  },
  data_review: {
    title: "Data review pack",
    role: "data",
    description: "Dashboards, sheets, metric definitions, and decision-support docs for analysis reviews.",
    assetTypes: ["dashboard", "sheet", "doc", "prd", "krd"],
    keywords: ["dashboard", "metric", "report", "analysis", "dataset", "sheet"],
    requiredTypes: ["dashboard", "sheet"],
  },
  incident_response: {
    title: "Incident response pack",
    role: "ops",
    description: "Runbooks, incident docs, RCA links, and dashboards for fast recovery during production issues.",
    assetTypes: ["runbook", "incident", "rca", "dashboard", "github_issue"],
    keywords: ["incident", "rca", "runbook", "outage", "rollback", "war room"],
    requiredTypes: ["runbook", "incident", "rca"],
  },
  support_ops: {
    title: "Support operations pack",
    role: "support",
    description: "SOPs, playbooks, onboarding docs, and support dashboards for repeated business operations.",
    assetTypes: ["sop", "runbook", "onboarding", "dashboard", "doc"],
    keywords: ["support", "seller", "sop", "playbook", "ticket", "escalation"],
    requiredTypes: ["sop", "runbook"],
  },
};

const clean = (value = "") => String(value || "").replace(/\s\s+/g, " ").trim();

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(url || "").trim();
  }
};

export const inferSourceApp = (url = "") => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("github.com")) return "github";
    if (hostname.includes("atlassian.net") || hostname.includes("confluence")) {
      return "confluence";
    }
    if (hostname.includes("docs.google.com") || hostname.includes("drive.google.com")) {
      return "google";
    }
    if (hostname.includes("figma.com")) return "figma";
    if (
      hostname.includes("looker") ||
      hostname.includes("metabase") ||
      hostname.includes("tableau") ||
      hostname.includes("grafana") ||
      hostname.includes("superset")
    ) {
      return "dashboard";
    }
    return "other";
  } catch {
    return "other";
  }
};

export const inferAssetType = ({ url = "", classification = {}, text = "" }) => {
  const sourceApp = inferSourceApp(url);
  const haystack = `${url} ${classification?.category || ""} ${
    classification?.reason || ""
  } ${text}`.toLowerCase();

  if (sourceApp === "github") {
    if (/\/pull\/\d+/.test(url)) return "github_pr";
    if (/\/issues\/\d+/.test(url)) return "github_issue";
    return "github_repo";
  }
  if (sourceApp === "figma") return "figma";
  if (sourceApp === "google" && /\/spreadsheets\//i.test(url)) return "sheet";
  if (/\bkrd\b|knowledge requirement/.test(haystack)) return "krd";
  if (/\bprd\b|product requirement|product requirements/.test(haystack)) {
    return "prd";
  }
  if (/dashboard|report|metric|analytics|looker|metabase|tableau|grafana/.test(haystack)) {
    return "dashboard";
  }
  if (/\bsop\b|standard operating|playbook/.test(haystack)) return "sop";
  if (/runbook|troubleshoot|debug|rollback/.test(haystack)) return "runbook";
  if (/incident|war room|sev[ -]?\d|outage/.test(haystack)) return "incident";
  if (/\brca\b|root cause|postmortem|post-mortem/.test(haystack)) return "rca";
  if (/onboarding|getting started|new joiner|training/.test(haystack)) {
    return "onboarding";
  }
  if (sourceApp === "google" && /sheet|spreadsheet|csv|dataset/.test(haystack)) {
    return "sheet";
  }
  if (sourceApp === "confluence" || sourceApp === "google") return "doc";
  return "other";
};

const inferAudiences = ({ assetType, text = "" }) => {
  const values = new Set();
  const haystack = text.toLowerCase();

  if (["github_repo", "github_pr", "github_issue", "runbook"].includes(assetType)) {
    values.add("engineering");
  }
  if (["prd", "krd", "figma"].includes(assetType)) {
    values.add("product");
  }
  if (["dashboard", "sheet"].includes(assetType)) {
    values.add("data");
  }
  if (["sop", "incident", "rca"].includes(assetType)) {
    values.add("ops");
  }
  if (/support|seller|ticket|escalation/.test(haystack)) values.add("support");
  if (/leadership|business impact|exec|weekly review/.test(haystack)) {
    values.add("leadership");
  }

  return Array.from(values);
};

const inferOwnerTeam = ({ text = "", url = "" }) => {
  const haystack = `${text} ${url}`.toLowerCase();
  const match = TEAM_HINTS.find(([keyword]) => haystack.includes(keyword));
  return match?.[1] || "";
};

const extractFreshness = ({ text = "", updatedAt }) => {
  const datesFound = [];
  const datePatterns = [
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
  ];

  datePatterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) datesFound.push(...matches.slice(0, 5));
  });

  const referenceDate = updatedAt ? new Date(updatedAt) : new Date();
  const ageDays = Number.isNaN(referenceDate.getTime())
    ? 0
    : Math.floor((Date.now() - referenceDate.getTime()) / 86400000);

  let staleRisk = "unknown";
  if (ageDays <= 45) staleRisk = "low";
  else if (ageDays <= 120) staleRisk = "medium";
  else staleRisk = "high";

  return {
    lastUpdatedHint: updatedAt ? referenceDate.toISOString() : "",
    datesFound: Array.from(new Set(datesFound)).slice(0, 8),
    staleRisk,
    reason:
      staleRisk === "low"
        ? "The saved link was updated recently in LinkOps."
        : "Freshness is inferred from when the saved link was last updated in LinkOps.",
  };
};

const inferMissingInfo = ({ ownerTeam, assetType, sourceOfTruth, freshness }) => {
  const missing = [];
  if (!ownerTeam) missing.push("Owner team");
  if (sourceOfTruth === "unknown") missing.push("Source of truth status");
  if (freshness?.staleRisk === "unknown") missing.push("Freshness signal");
  if (["prd", "krd", "figma", "dashboard", "sop", "runbook"].includes(assetType)) {
    missing.push("Business owner");
  }
  return Array.from(new Set(missing));
};

const inferTitle = (link, analysisResult) => {
  const summary = clean(analysisResult?.summary);
  if (summary) {
    const sentence = summary.split(/[.!?]\s/)[0];
    return sentence.length > 90 ? `${sentence.slice(0, 87)}...` : sentence;
  }
  try {
    const parsed = new URL(link.longUrl);
    return parsed.pathname.split("/").filter(Boolean).slice(-1)[0] || parsed.hostname;
  } catch {
    return link.shortId || "Work link";
  }
};

const buildEmployeeBrief = (analysisResult) => {
  const summary = clean(analysisResult?.summary);
  const reason = clean(analysisResult?.classification?.reason);

  return {
    whatThisIs: summary || "This work link has not been summarized yet.",
    whoShouldUseIt: "Employees who need context from this saved work asset.",
    whenToUseIt:
      "Use it when searching for the related repo, document, dashboard, SOP, design, or planning artifact.",
    whyItMatters:
      reason || "It preserves context so the link can be found and reused later.",
  };
};

const buildRoleBriefs = ({ assetType, analysisResult }) => {
  const summary = clean(analysisResult?.summary);
  const tags = analysisResult?.tags || [];
  const basePoints = tags.slice(0, 5);

  return {
    engineering: {
      summary: ["github_repo", "github_pr", "github_issue", "runbook"].includes(assetType)
        ? summary
        : "",
      keyPoints: basePoints,
      actions: assetType.startsWith("github") ? ["Review repo/PR context"] : [],
    },
    product: {
      summary: ["prd", "krd", "figma"].includes(assetType) ? summary : "",
      keyPoints: basePoints,
      actions: ["Check owner, status, and related launch artifacts"],
    },
    data: {
      summary: ["dashboard", "sheet"].includes(assetType) ? summary : "",
      keyPoints: basePoints,
      actions: ["Validate metric/source freshness before reuse"],
    },
    ops: {
      summary: ["sop", "runbook", "incident", "rca"].includes(assetType) ? summary : "",
      keyPoints: basePoints,
      actions: ["Check whether this is still the current operating reference"],
    },
    leadership: {
      summary,
      keyPoints: basePoints,
      actions: ["Use reliability fields before treating this as source of truth"],
    },
  };
};

const buildSearchText = ({ link, asset }) =>
  [
    asset.title,
    asset.sourceApp,
    asset.assetType,
    asset.ownerTeam,
    asset.ownerPerson,
    asset.audiences?.join(" "),
    asset.status,
    asset.sourceOfTruth,
    asset.employeeBrief?.whatThisIs,
    asset.employeeBrief?.whoShouldUseIt,
    asset.employeeBrief?.whenToUseIt,
    asset.employeeBrief?.whyItMatters,
    Object.values(asset.roleBriefs || {})
      .map((role) => [role?.summary, ...(role?.keyPoints || []), ...(role?.actions || [])].join(" "))
      .join(" "),
    asset.tags?.join(" "),
    asset.searchPhrases?.join(" "),
    asset.suggestedCollection,
    link.longUrl,
    link.shortId,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s\s+/g, " ")
    .trim();

export const buildAssetFromAnalysis = ({ link, analysisResult }) => {
  const analyzedText = `${analysisResult?.summary || ""} ${(analysisResult?.tags || []).join(" ")} ${
    analysisResult?.classification?.reason || ""
  }`;
  const sourceApp = inferSourceApp(link.longUrl);
  const assetType = inferAssetType({
    url: link.longUrl,
    classification: analysisResult?.classification,
    text: analyzedText,
  });
  const tags = (analysisResult?.tags || []).map(clean).filter(Boolean);
  const ownerTeam = inferOwnerTeam({ text: analyzedText, url: link.longUrl });
  const freshness = extractFreshness({
    text: analyzedText,
    updatedAt: link.updatedAt || link.createdAt,
  });
  const sourceOfTruth =
    /source of truth|canonical|official|primary/.test(analyzedText.toLowerCase())
      ? "yes"
      : "unknown";
  const suggestedCollection =
    COLLECTION_BY_ASSET_TYPE[assetType] ||
    SOURCE_COLLECTION_HINTS[sourceApp] ||
    analysisResult?.classification?.category ||
    "Other Work Links";

  const asset = {
    link: link._id,
    owner: link.owner,
    canonicalUrl: normalizeUrl(link.longUrl),
    sourceApp,
    assetType,
    title: inferTitle(link, analysisResult),
    ownerTeam,
    ownerPerson: "",
    audiences: inferAudiences({
      assetType,
      text: analyzedText,
    }),
    status: "unknown",
    sourceOfTruth,
    employeeBrief: buildEmployeeBrief(analysisResult),
    roleBriefs: buildRoleBriefs({ assetType, analysisResult }),
    freshness,
    suggestedCollection,
    tags,
    searchPhrases: [
      clean(analysisResult?.summary),
      suggestedCollection,
      sourceApp,
      assetType.replace(/_/g, " "),
      ...tags,
    ].filter(Boolean),
    missingInfo: inferMissingInfo({
      ownerTeam,
      assetType,
      sourceOfTruth,
      freshness,
    }),
    reliability: {
      missingOwner: !ownerTeam,
      duplicateCandidateCount: 0,
      brokenLink: false,
      connectorError:
        analysisResult?.safety?.justification?.includes("Connector")
          ? analysisResult.safety.justification
          : "",
      confidence: Number(analysisResult?.classification?.confidence || 0),
    },
    analysisStatus: "COMPLETED",
    analysisVersion: 2,
  };

  asset.searchText = buildSearchText({ link, asset });
  return asset;
};

const refreshDuplicateSignals = async ({ ownerId, canonicalUrl, assetType }) => {
  const similarAssets = await KnowledgeAsset.find({
    owner: ownerId,
    assetType,
  })
    .select("_id canonicalUrl title tags")
    .lean();

  const groupedByCanonical = similarAssets.filter(
    (asset) => asset.canonicalUrl === canonicalUrl
  );

  const duplicateCount = Math.max(groupedByCanonical.length - 1, 0);
  await KnowledgeAsset.updateMany(
    {
      owner: ownerId,
      canonicalUrl,
      assetType,
    },
    { $set: { "reliability.duplicateCandidateCount": duplicateCount } }
  );
};

export const upsertKnowledgeAssetFromAnalysis = async ({ link, analysisResult }) => {
  const asset = buildAssetFromAnalysis({ link, analysisResult });
  const updatedAsset = await KnowledgeAsset.findOneAndUpdate(
    { owner: link.owner, link: link._id },
    { $set: asset },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  await refreshDuplicateSignals({
    ownerId: link.owner,
    canonicalUrl: asset.canonicalUrl,
    assetType: asset.assetType,
  });
  return updatedAsset;
};

export const markKnowledgeAssetFailed = async ({ link, errorMessage = "" }) => {
  return KnowledgeAsset.findOneAndUpdate(
    { owner: link.owner, link: link._id },
    {
      $set: {
        owner: link.owner,
        link: link._id,
        canonicalUrl: normalizeUrl(link.longUrl),
        sourceApp: inferSourceApp(link.longUrl),
        assetType: inferAssetType({ url: link.longUrl }),
        title: inferTitle(link, { summary: "" }),
        analysisStatus: "FAILED",
        "reliability.connectorError": clean(errorMessage).slice(0, 500),
        searchText: `${link.longUrl} ${link.shortId}`,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
};

export const backfillKnowledgeAssetsForUser = async ({ ownerId, limit = 300 }) => {
  const completedLinks = await Link.find({
    owner: ownerId,
    analysisStatus: "COMPLETED",
  })
    .select(
      "shortId longUrl owner aiSummary aiTags aiSafetyRating aiSafetyJustification aiClassification analysisStatus"
    )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  if (!completedLinks.length) return 0;

  const existingAssets = await KnowledgeAsset.find({
    owner: ownerId,
    link: { $in: completedLinks.map((link) => link._id) },
  })
    .select("link")
    .lean();

  const existingLinkIds = new Set(
    existingAssets.map((asset) => String(asset.link))
  );
  const missingLinks = completedLinks.filter(
    (link) => !existingLinkIds.has(String(link._id))
  );

  await Promise.all(
    missingLinks.map((link) =>
      upsertKnowledgeAssetFromAnalysis({
        link,
        analysisResult: {
          summary: link.aiSummary,
          tags: link.aiTags || [],
          safety: {
            safety_rating: link.aiSafetyRating || "unknown",
            justification: link.aiSafetyJustification || "",
          },
          classification: link.aiClassification || {},
        },
      }).catch((error) => {
        console.error("Knowledge asset backfill failed:", error);
        return null;
      })
    )
  );

  return missingLinks.length;
};

export const getAssetsForUser = async ({ ownerId, filters = {} }) => {
  const query = { owner: ownerId };
  if (filters.assetType) query.assetType = filters.assetType;
  if (filters.sourceApp) query.sourceApp = filters.sourceApp;
  if (filters.sourceOfTruth) query.sourceOfTruth = filters.sourceOfTruth;
  if (filters.staleRisk) query["freshness.staleRisk"] = filters.staleRisk;
  if (filters.audience) query.audiences = filters.audience;

  return KnowledgeAsset.find(query)
    .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
    .sort({ updatedAt: -1 })
    .lean();
};

export const getAssetForUser = async ({ ownerId, assetId }) => {
  if (!mongoose.Types.ObjectId.isValid(assetId)) return null;
  return KnowledgeAsset.findOne({ _id: assetId, owner: ownerId })
    .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
    .lean();
};

export const updateAssetForUser = async ({ ownerId, assetId, updates }) => {
  if (!mongoose.Types.ObjectId.isValid(assetId)) return null;
  const allowed = {};
  [
    "ownerTeam",
    "ownerPerson",
    "audiences",
    "status",
    "sourceOfTruth",
    "missingInfo",
    "tags",
  ].forEach((field) => {
    if (updates[field] !== undefined) allowed[field] = updates[field];
  });
  if (updates.freshness) allowed.freshness = updates.freshness;

  let updated = await KnowledgeAsset.findOneAndUpdate(
    { _id: assetId, owner: ownerId },
    { $set: allowed },
    { new: true }
  ).lean();

  if (!updated) return null;
  const link = { longUrl: updated.canonicalUrl, shortId: "" };
  const missingInfo = inferMissingInfo({
    ownerTeam: updated.ownerTeam,
    assetType: updated.assetType,
    sourceOfTruth: updated.sourceOfTruth,
    freshness: updated.freshness,
  });

  updated = {
    ...updated,
    missingInfo,
    reliability: {
      ...(updated.reliability || {}),
      missingOwner: !updated.ownerTeam,
    },
  };
  updated.searchText = buildSearchText({ link, asset: updated });
  await KnowledgeAsset.updateOne(
    { _id: updated._id },
    {
      $set: {
        searchText: updated.searchText,
        missingInfo,
        "reliability.missingOwner": !updated.ownerTeam,
      },
    }
  );
  return updated;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const searchAssetsForUser = async ({
  ownerId,
  query = "",
  role = "",
  assetTypes = [],
  sourceOfTruthOnly = false,
  staleRisk = [],
  limit = 20,
}) => {
  const filter = { owner: ownerId };
  if (role) filter.audiences = role;
  if (Array.isArray(assetTypes) && assetTypes.length > 0) {
    filter.assetType = { $in: assetTypes };
  }
  if (sourceOfTruthOnly) filter.sourceOfTruth = "yes";
  if (Array.isArray(staleRisk) && staleRisk.length > 0) {
    filter["freshness.staleRisk"] = { $in: staleRisk };
  }

  const trimmed = clean(query);
  let assets;
  if (trimmed) {
    const regex = new RegExp(escapeRegex(trimmed), "i");
    try {
      assets = await KnowledgeAsset.find({
        ...filter,
        $text: { $search: trimmed },
      })
        .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
        .limit(Number(limit) || 20)
        .lean();
    } catch {
      assets = [];
    }

    if (!assets.length) {
      assets = await KnowledgeAsset.find({
        ...filter,
        $or: [
          { searchText: regex },
          { title: regex },
          { tags: regex },
          { searchPhrases: regex },
        ],
      })
        .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
        .limit(Number(limit) || 20)
        .lean();
    }
  } else {
    assets = await KnowledgeAsset.find(filter)
      .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
      .sort({ updatedAt: -1 })
      .limit(Number(limit) || 20)
      .lean();
  }

  return assets.map((asset) => ({
    ...asset,
    whyMatched: getWhyMatched(asset, trimmed),
  }));
};

export const getRelatedAssetsForUser = async ({ ownerId, assetId, limit = 8 }) => {
  const asset = await getAssetForUser({ ownerId, assetId });
  if (!asset) return null;

  const tagMatches = asset.tags || [];
  const query = {
    owner: ownerId,
    _id: { $ne: asset._id },
    $or: [
      { assetType: asset.assetType },
      { sourceApp: asset.sourceApp },
      { suggestedCollection: asset.suggestedCollection },
      ...(tagMatches.length ? [{ tags: { $in: tagMatches } }] : []),
    ],
  };

  const related = await KnowledgeAsset.find(query)
    .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
    .sort({ updatedAt: -1 })
    .limit(Number(limit) || 8)
    .lean();

  return {
    asset,
    related: related.map((item) => ({
      ...item,
      whyRelated: getWhyRelated(asset, item),
    })),
  };
};

export const getKnowledgeInsightsForUser = async ({ ownerId }) => {
  const assets = await KnowledgeAsset.find({ owner: ownerId })
    .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
    .sort({ updatedAt: -1 })
    .lean();

  const byRole = Object.fromEntries(
    Object.entries(ROLE_PRESETS).map(([role, assetTypes]) => [
      role,
      assets
        .filter(
          (asset) =>
            asset.audiences?.includes(role) || assetTypes.includes(asset.assetType)
        )
        .slice(0, 6),
    ])
  );

  const collectionSuggestions = Object.entries(
    assets.reduce((acc, asset) => {
      const name = asset.suggestedCollection || "Other Work Links";
      if (!acc[name]) acc[name] = { name, linkIds: [], assets: [] };
      const linkId =
        typeof asset.link === "object" ? asset.link?._id : asset.link;
      if (linkId) acc[name].linkIds.push(String(linkId));
      acc[name].assets.push(asset);
      return acc;
    }, {})
  )
    .map(([, value]) => ({
      name: value.name,
      linkCount: new Set(value.linkIds).size,
      assetTypes: Array.from(new Set(value.assets.map((asset) => asset.assetType))),
    }))
    .filter((item) => item.linkCount > 0)
    .sort((a, b) => b.linkCount - a.linkCount);

  const actionItems = [
    ...assets
      .filter((asset) => asset.reliability?.missingOwner)
      .slice(0, 5)
      .map((asset) => ({
        type: "missing_owner",
        severity: "medium",
        assetId: asset._id,
        title: asset.title,
        message: "Add an owner team so employees know who maintains this asset.",
      })),
    ...assets
      .filter((asset) => ["medium", "high"].includes(asset.freshness?.staleRisk))
      .slice(0, 5)
      .map((asset) => ({
        type: "freshness_risk",
        severity: asset.freshness?.staleRisk === "high" ? "high" : "medium",
        assetId: asset._id,
        title: asset.title,
        message: "Review freshness before treating this as current guidance.",
      })),
    ...assets
      .filter((asset) => Number(asset.reliability?.duplicateCandidateCount || 0) > 0)
      .slice(0, 5)
      .map((asset) => ({
        type: "duplicate_candidate",
        severity: "low",
        assetId: asset._id,
        title: asset.title,
        message: "Similar saved assets exist. Mark one as source of truth.",
      })),
  ].slice(0, 12);

  return {
    byRole,
    collectionSuggestions,
    actionItems,
  };
};

export const organizeAssetsIntoSuggestedCollections = async ({ ownerId }) => {
  const assets = await KnowledgeAsset.find({ owner: ownerId })
    .populate("link", "_id")
    .lean();
  const collectionsByName = new Map();
  const existingCollections = await Collection.find({ owner: ownerId }).lean();
  existingCollections.forEach((collection) =>
    collectionsByName.set(collection.name, collection)
  );

  let collectionsCreated = 0;
  let linksOrganized = 0;

  for (const asset of assets) {
    const collectionName = asset.suggestedCollection || "Other Work Links";
    const linkId =
      typeof asset.link === "object" ? asset.link?._id : asset.link;
    if (!linkId) continue;

    let collection = collectionsByName.get(collectionName);
    if (!collection) {
      collection = await Collection.create({
        owner: ownerId,
        name: collectionName,
        isSystem: true,
        systemCategory: COLLECTION_BY_ASSET_TYPE[asset.assetType]
          ? collectionName
          : "Other Work Links",
      });
      collectionsByName.set(collectionName, collection.toObject());
      collectionsCreated += 1;
    }

    await Promise.all([
      Collection.updateOne(
        { _id: collection._id, owner: ownerId },
        { $addToSet: { links: linkId } }
      ),
      Link.updateOne(
        { _id: linkId, owner: ownerId },
        { $addToSet: { collections: collection._id } }
      ),
    ]);
    linksOrganized += 1;
  }

  return {
    collectionsCreated,
    linksOrganized,
  };
};

export const getKnowledgePacksForUser = async ({ ownerId }) => {
  const assets = await KnowledgeAsset.find({ owner: ownerId })
    .populate("link", "shortId longUrl viewerCount collections createdAt updatedAt analysisStatus")
    .sort({ updatedAt: -1 })
    .lean();

  return Object.entries(KNOWLEDGE_PACKS).map(([key, definition]) =>
    buildKnowledgePack({ key, definition, assets })
  );
};

export const createCollectionFromKnowledgePack = async ({ ownerId, packKey }) => {
  const definition = KNOWLEDGE_PACKS[packKey];
  if (!definition) return null;

  const packs = await getKnowledgePacksForUser({ ownerId });
  const pack = packs.find((item) => item.key === packKey);
  if (!pack) return null;

  const linkIds = pack.assets
    .map((asset) => (typeof asset.link === "object" ? asset.link?._id : asset.link))
    .filter(Boolean);

  if (!linkIds.length) {
    return {
      pack,
      collection: null,
      linksAdded: 0,
      message: "No analyzed links are available for this pack yet.",
    };
  }

  const collection = await Collection.findOneAndUpdate(
    { owner: ownerId, name: definition.title },
    {
      $setOnInsert: {
        owner: ownerId,
        name: definition.title,
        description: definition.description,
        color: "#10B981",
      },
      $addToSet: { links: { $each: linkIds } },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  await Link.updateMany(
    { owner: ownerId, _id: { $in: linkIds } },
    { $addToSet: { collections: collection._id } }
  );

  return {
    pack,
    collection,
    linksAdded: linkIds.length,
    message: `${definition.title} collection is ready.`,
  };
};

const getWhyMatched = (asset, query) => {
  if (!query) return "Recently updated knowledge asset";
  const lower = query.toLowerCase();
  if (asset.title?.toLowerCase().includes(lower)) return "Matched asset title";
  if (asset.tags?.some((tag) => tag.toLowerCase().includes(lower))) {
    return "Matched AI tags";
  }
  if (asset.searchPhrases?.some((phrase) => phrase.toLowerCase().includes(lower))) {
    return "Matched generated search phrase";
  }
  if (asset.employeeBrief?.whatThisIs?.toLowerCase().includes(lower)) {
    return "Matched employee brief";
  }
  return "Matched saved link context";
};

const buildKnowledgePack = ({ key, definition, assets }) => {
  const scoredAssets = assets
    .map((asset) => ({
      asset,
      score: scoreAssetForPack(asset, definition),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => ({
      ...item.asset,
      packReason: getPackReason(item.asset, definition),
    }));

  const presentTypes = new Set(scoredAssets.map((asset) => asset.assetType));
  const gaps = definition.requiredTypes
    .filter((assetType) => !presentTypes.has(assetType))
    .map((assetType) => ({
      assetType,
      label: assetType.replace(/_/g, " "),
      message: `Add a ${assetType.replace(/_/g, " ")} link to make this pack stronger.`,
    }));

  return {
    key,
    title: definition.title,
    role: definition.role,
    description: definition.description,
    assetTypes: definition.assetTypes,
    keywords: definition.keywords,
    requiredTypes: definition.requiredTypes,
    readiness: Math.round(
      ((definition.requiredTypes.length - gaps.length) /
        Math.max(definition.requiredTypes.length, 1)) *
        100
    ),
    assets: scoredAssets,
    gaps,
  };
};

const scoreAssetForPack = (asset, definition) => {
  let score = 0;
  if (definition.assetTypes.includes(asset.assetType)) score += 4;
  if (asset.audiences?.includes(definition.role)) score += 3;
  if (asset.sourceOfTruth === "yes") score += 1;
  if (asset.freshness?.staleRisk === "low") score += 1;

  const text = [
    asset.title,
    asset.employeeBrief?.whatThisIs,
    asset.employeeBrief?.whyItMatters,
    asset.tags?.join(" "),
    asset.searchPhrases?.join(" "),
    asset.ownerTeam,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  definition.keywords.forEach((keyword) => {
    if (text.includes(keyword)) score += 1;
  });

  if (Number(asset.reliability?.duplicateCandidateCount || 0) > 0) score -= 1;
  if (asset.analysisStatus !== "COMPLETED") score -= 3;
  return score;
};

const getPackReason = (asset, definition) => {
  if (definition.assetTypes.includes(asset.assetType)) {
    return `Fits ${definition.title} as ${asset.assetType.replace(/_/g, " ")}`;
  }
  if (asset.audiences?.includes(definition.role)) {
    return `Relevant for ${definition.role}`;
  }
  return "Matched pack keywords";
};

const getWhyRelated = (source, candidate) => {
  if (source.assetType === candidate.assetType) return "Same asset type";
  if (source.suggestedCollection === candidate.suggestedCollection) {
    return "Same suggested collection";
  }
  if ((source.tags || []).some((tag) => (candidate.tags || []).includes(tag))) {
    return "Shared AI tag";
  }
  if (source.sourceApp === candidate.sourceApp) return "Same source app";
  return "Related work context";
};
