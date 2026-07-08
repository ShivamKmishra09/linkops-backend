import { GoogleGenerativeAI } from "@google/generative-ai";
import puppeteer from "puppeteer";
import "dotenv/config";
import {
  applyAuthProfileToPage,
  markAuthProfileFailed,
} from "./authProfileService.js";
import { fetchConnectorContentForUrl } from "./connectorService.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const summaryPromptTemplate = `You are an assistant that summarizes the content of webpages. 
    The following text is the scraped content from a given URL. 
    Task:
    1. Identify the main purpose of the webpage.  
    2. Provide a concise summary of the key information.  
    3. Highlight important entities (people, companies, products, dates, numbers, links, etc.) if available.  
    4. If the page is an article, summarize it in 3–5 sentences.  
    5. If the page is a product/service page, summarize what it offers, its features, and any pricing or benefits.  
    6. Ignore navigation menus, ads, and irrelevant text.  
    7. Keep the summary clear and non-verbose (max 150 words).  
    8. Extract up to 5 relevant keywords as a JSON array.
    9. Do not hallucinate — only base your summary on the provided content.
    Your response must be a single valid JSON object with keys "summary" and "tags".
    Return your output ONLY as a valid JSON object, nothing else. 
    Do not include explanations or extra text outside the JSON. 

    JSON schema:
    {
      "summary": "string, concise summary of the webpage (max 150 words)",
      "tags": ["string", "string", ...] // up to 5 keywords
    }
    Text: """\${text}"""`;

// Safety and classification prompts
const safetyPromptTemplate = `You are a security and safety auditor for web content.
  The following text is the scraped content from a given URL. 

  Task:
    1. Check if the page contains any harmful, malicious, or unsafe content (e.g., phishing attempts, malware links, scams, explicit/abusive material, misinformation, illegal activities).  
    2. If you see ANY keywords related to malware, viruses, exploits, trojans, or malicious software, you MUST lower the safety rating significantly (to 2 or below).
    3 It does NOT matter if the context says it's a "test" or "safe." The presence of these keywords is a major red flag.
    4 Be highly suspicious of any page that offers file downloads.
    5. Detect suspicious patterns such as repeated download prompts, requests for personal information, or unusual redirects.  
    6. Rate the overall safety level of the website on a scale of 1–5:
      - 1 = Very Unsafe (likely harmful or malicious)
      - 2 = Unsafe (some clear red flags)
      - 3 = Neutral (mixed, unclear, needs caution)
      - 4 = Mostly Safe (no obvious risks, but not authoritative)
      - 5 = Safe (legitimate, trustworthy, no red flags detected)
      7. Explain briefly why you gave this rating (max 3 sentences).  
      8. Do not hallucinate — only base your analysis on the provided content.  
    Return your output ONLY as a valid JSON object, nothing else. 
    Do not include explanations or extra text outside the JSON. 
    JSON schema:
    {
      "safety_rating": 1-5,
      "explanation": "string";
    }
    Here is the scraped content from the URL: """\${text}"""`;

const classificationPromptTemplate = `
      You are a Meesho internal knowledge operations classifier.
      Your job is to analyze scraped webpage content and classify the link into the simple work-artifact collection where a Meesho employee would most likely search for it later.
      Prefer the source/artifact type over complex business-domain guessing.

      Categories:
      - GitHub Repos & PRs
      - Confluence Docs
      - Google Docs & Sheets
      - Figma Designs
      - KRD / PRD Docs
      - Dashboards & Reports
      - SOPs & Runbooks
      - Incidents & RCA
      - Onboarding Docs
      - Other Work Links

      Guidance:
      - Use "GitHub Repos & PRs" for GitHub repositories, pull requests, issues, code files, or engineering repo pages.
      - Use "Confluence Docs" for Confluence/wiki pages unless the text clearly identifies a KRD, PRD, SOP, runbook, incident, or RCA.
      - Use "Google Docs & Sheets" for Google Docs, Sheets, Slides, or Drive documents unless the text clearly identifies a KRD, PRD, SOP, runbook, incident, or RCA.
      - Use "Figma Designs" for Figma files, mocks, design specs, prototypes, UX flows, or visual design links.
      - Use "KRD / PRD Docs" for knowledge requirement documents, product requirement documents, strategy specs, feature specs, or planning docs.
      - Use "Dashboards & Reports" for dashboards, analytics reports, metrics, sheets primarily used for reporting, and BI views.
      - Use "SOPs & Runbooks" for process steps, operations SOPs, engineering runbooks, troubleshooting guides, and execution playbooks.
      - Use "Incidents & RCA" for incident docs, war-room links, postmortems, RCAs, and outage analysis.
      - Use "Onboarding Docs" for onboarding, training, getting-started, or team intro content.
      - Use "Other Work Links" when none of the above clearly fit.
      Return your output ONLY as a valid JSON object, nothing else. 
      Do not include explanations or extra text outside the JSON. 
      JSON schema:
      {
        "category": "one of the categories above",
        "confidence": "number between 0 and 1 indicating confidence level",
        "reason": "brief explanation of why this category was chosen"
      }
      Here is the scraped text:
      """\${text}"""
      `;

// --- 1. Puppeteer Web Scraper (Unchanged) ---
async function scrapeTextFromUrl(url, options = {}) {
  let browser = null;
  let appliedAuthProfile = null;
  try {
    console.log(`Launching headless browser to scrape: ${url}`);
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );
    if (options.authProfileId) {
      appliedAuthProfile = await applyAuthProfileToPage({
        page,
        ownerId: options.ownerId,
        authProfileId: options.authProfileId,
        url,
      });
      console.log(
        `Applied auth profile ${appliedAuthProfile?._id} for ${appliedAuthProfile?.hostname}`
      );
    }
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    const textContent = await page.evaluate(() => document.body.innerText);
    console.log(`Successfully scraped ${textContent.length} characters.`);
    return {
      text: textContent.replace(/\s\s+/g, " ").trim(),
      usedAuthProfile: Boolean(appliedAuthProfile),
    };
  } catch (error) {
    console.error(`Puppeteer scraping failed for URL: ${url}`, error.message);
    if (options.authProfileId) {
      await markAuthProfileFailed(options.authProfileId, error.message);
    }
    return {
      text: null,
      authError: options.authProfileId ? error.message : null,
      usedAuthProfile: Boolean(options.authProfileId),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// --- ⭐ NEW: A Resilient Function to Call the AI with Retries ⭐ ---
async function generateContentWithRetry(model, prompt) {
  const maxRetries = 5;
  const baseDelaySeconds = 2; // base for exponential backoff

  // Helper to sleep
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (error) {
      // Normalize status detection across error shapes
      const status = error?.status || error?.response?.status || null;

      // Treat 429, 503 and other 5xx as transient and retryable
      const isTransient =
        status === 429 || status === 503 || (status >= 500 && status < 600);

      if (!isTransient) {
        // Non-transient: rethrow immediately
        throw error;
      }

      const attemptNumber = attempt + 1;
      if (attemptNumber >= maxRetries) {
        // Last attempt failed — throw
        console.warn(
          `Transient error on final attempt (${attemptNumber}):`,
          error.message || error
        );
        throw error;
      }

      console.warn(
        `Transient error (status=${status}). Retrying attempt ${attemptNumber} of ${maxRetries}...`
      );

      // Prefer server-suggested retry delay if provided (gRPC RetryInfo), else exponential backoff with jitter
      let delaySeconds = null;
      try {
        const retryDetails = error?.errorDetails?.find(
          (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
        );
        if (retryDetails && retryDetails.retryDelay) {
          // retryDelay like '30s'
          delaySeconds =
            parseInt(
              String(retryDetails.retryDelay).replace(/[^0-9]/g, ""),
              10
            ) || null;
        }
      } catch (e) {
        // ignore parsing errors
      }

      if (!delaySeconds) {
        // exponential backoff: base * 2^attempt, add jitter up to 0.5x
        const expo = baseDelaySeconds * Math.pow(2, attempt);
        const jitter = Math.random() * expo * 0.5;
        delaySeconds = Math.max(1, Math.round(expo + jitter));
      }

      console.log(
        `Waiting ${delaySeconds}s before retrying (attempt ${attemptNumber}).`
      );
      await sleep(delaySeconds * 1000);
    }
  }
  // Shouldn't reach here, but throw defensively
  throw new Error("Failed to generate content after multiple retries.");
}

// --- 2. MapReduce Pipeline for Long Text Summarization ---
async function getSummarizationFromChunks(text, model, finalSummaryUserPrompt) {
  const tokenLimit = 3000 * 4;
  const textChunks = [];
  for (let i = 0; i < text.length; i += tokenLimit) {
    textChunks.push(text.substring(i, i + tokenLimit));
  }
  console.log(
    `Split text into ${textChunks.length} chunks for MapReduce pipeline.`
  );

  // --- ⭐ THE RATE LIMIT FIX ⭐ ---
  // Instead of Promise.all, we process chunks sequentially with a delay.
  const chunkSummaries = [];
  for (const chunk of textChunks) {
    const prompt = `This is a snippet from a larger document. Summarize its main points concisely. Snippet: """${chunk}"""`;
    const result = await generateContentWithRetry(model, prompt);
    chunkSummaries.push(result.response.text());
    console.log(
      `Summarized chunk ${chunkSummaries.length} of ${textChunks.length}.`
    );
    // Wait for 1 second before sending the next request to be polite to the API
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("Finished summarizing all chunks sequentially.");

  const combinedSummaries = chunkSummaries.join("\n\n");
  const finalSummaryPrompt = finalSummaryUserPrompt.replace(
    "${text}",
    combinedSummaries
  );
  const finalResult = await generateContentWithRetry(model, finalSummaryPrompt); // Use retry function
  return finalResult.response.text();
}

// --- 3. FINAL AI Analysis Function with Conditional Logic ---
export async function analyzeUrlContent(url, options = {}) {
  const snapshotText =
    typeof options.textOverride === "string"
      ? options.textOverride.replace(/\s\s+/g, " ").trim()
      : "";
  const connectorResult =
    !snapshotText && options.ownerId
      ? await fetchConnectorContentForUrl({ ownerId: options.ownerId, url })
      : null;
  const scrapeResult = snapshotText
    ? { text: snapshotText, usedSnapshot: true }
    : connectorResult?.text
        ? {
            text: connectorResult.text,
            usedConnector: true,
            connectorSource: connectorResult.source,
          }
      : connectorResult?.attempted
        ? {
            text: null,
            usedConnector: true,
            connectorSource: connectorResult.source,
            connectorError: connectorResult.error,
          }
    : await scrapeTextFromUrl(url, options);
  const text = scrapeResult?.text;
  const characterThreshold = scrapeResult?.usedConnector ? 30 : 100;

  if (!text || text.length < characterThreshold) {
    const authenticatedMessage = scrapeResult?.usedAuthProfile
      ? "Authenticated analysis could not extract enough content. The auth profile may be expired, the account may not have access, or the page may require an extra approval/MFA step."
      : scrapeResult?.usedSnapshot
        ? "The pasted private page snapshot did not contain enough readable content for AI analysis."
        : scrapeResult?.usedConnector
          ? scrapeResult?.connectorError
            ? `Connector could not read this URL: ${scrapeResult.connectorError}`
            : `The ${scrapeResult.connectorSource || "configured"} connector returned too little readable content for AI analysis.`
      : "Could not extract sufficient text content from this URL.";

    return {
      summary: authenticatedMessage,
      tags: [],
      safety: {
        safety_rating: 3,
        justification:
          scrapeResult?.authError ||
          scrapeResult?.connectorError ||
          "Unable to analyze content. The page may be an image, a login wall, or a complex application.",
      },
      classification: {
        category: "Other Work Links",
        confidence: 0.5,
        reason: scrapeResult?.usedAuthProfile
          ? "Authenticated scrape did not return enough readable content."
          : scrapeResult?.usedSnapshot
            ? "Private page snapshot was too short or not readable enough."
            : scrapeResult?.usedConnector
              ? "Connector content was too short or not readable enough."
          : "Could not scrape content.",
      },
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      summary:
        "AI analysis is disabled because GEMINI_API_KEY is not configured. The link was saved and can still be organized manually.",
      tags: ["manual-review"],
      safety: {
        safety_rating: 3,
        justification:
          "No Gemini API key is configured, so automated safety analysis was skipped.",
      },
      classification: {
        category: "Other Work Links",
        confidence: 0.5,
        reason: "AI classification skipped because GEMINI_API_KEY is missing.",
      },
    };
  }

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  try {
    let summaryData, safety, classification;

    if (text.length <= characterThreshold) {
      // --- FAST PATH: Use a single, combined prompt for efficiency ---
      console.log("Text is short. Using single, combined prompt (fast path).");
      const combinedPrompt = `
        Analyze the following text and provide a complete analysis. Your response must be a single, valid JSON object with the top-level keys "summary_and_tags", "safety", and "classification".

        1.  For "summary_and_tags": Use the following rules: ${summaryPromptTemplate}
        2.  For "safety": Use the following rules: ${safetyPromptTemplate}
        3.  For "classification": Use the following rules: ${classificationPromptTemplate}

        Text to analyze: """${text}"""
      `;

      const result = await generateContentWithRetry(model, combinedPrompt); // Use retry function
      const fullResponse = JSON.parse(
        result.response
          .text()
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim()
      );

      summaryData = fullResponse.summary_and_tags;
      safety = fullResponse.safety;
      classification = fullResponse.classification;
    } else {
      // --- ROBUST PATH: Use the chunking pipeline for long texts ---
      console.log("Text is long. Using chunking pipeline (robust path).");
      const summaryJsonText = await getSummarizationFromChunks(
        text,
        model,
        summaryPromptTemplate
      );
      summaryData = JSON.parse(
        summaryJsonText
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim()
      );

      const firstChunk = text.slice(0, 8000);
      // Use the retry wrapper for safety and classification calls as well
      const safetyResult = await generateContentWithRetry(
        model,
        safetyPromptTemplate.replace("${text}", firstChunk)
      );
      const classificationResult = await generateContentWithRetry(
        model,
        classificationPromptTemplate.replace("${text}", firstChunk)
      );

      safety = JSON.parse(
        safetyResult.response
          .text()
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim()
      );
      classification = JSON.parse(
        classificationResult.response
          .text()
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim()
      );
    }

    return {
      summary: summaryData.summary,
      tags: summaryData.tags,
      safety: {
        safety_rating: safety.safety_rating,
        justification: safety.explanation, // Match your prompt's key
      },
      classification,
    };
  } catch (error) {
    console.error("Error in AI analysis pipeline:", error);
    throw new Error("Failed to get a valid response from the AI model.");
  }
}
