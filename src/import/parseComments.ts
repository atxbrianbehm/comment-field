import type { CommentRecord } from "../models/types";
import { createPrng, seededId } from "../utils/prng";

const AVATAR_COLORS = ["#F2A65A", "#6EC5B8", "#A78BFA", "#E87979", "#78A8E8", "#C5D86D"];

export interface ParseResult {
  records: CommentRecord[];
  errors: Array<{ line: number; source: string; reason: string }>;
}

function cleanCampaignLine(value: string) {
  let result = value.trim();
  if (result.startsWith("**") && result.endsWith("**") && result.length > 4) result = result.slice(2, -2).trim();
  return result.replace(/^[•*-]\s+/, "").trim();
}

function isCampaignHeading(value: string) {
  return /^(?:PMI\b.*\bCAMPAIGN\b.*|TWEETS|APPROVED MAIN COMMENTS\b.*|SEA OF TWEETS\b.*)$/i.test(value);
}

function splitAuthorAndMessage(line: string) {
  const separator = line.indexOf("|");
  if (separator < 0) return { handle: "", message: line };

  const candidateHandle = line.slice(0, separator).trim();
  const candidateMessage = line.slice(separator + 1).trim();
  // In this campaign @PapaMurphys is the account being replied to, not the
  // author of the supplied copy. Keep that mention as part of the post body.
  if (/^@papamurphys$/i.test(candidateHandle)) {
    return { handle: "", message: `${candidateHandle} ${candidateMessage}`.trim() };
  }
  return { handle: candidateHandle, message: candidateMessage };
}

function fallbackRecord(handle: string, message: string, index: number): CommentRecord {
  const normalizedHandle = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
  const seed = `${normalizedHandle || "message-only"}|${message}|${index}`;
  const random = createPrng(seed);
  return {
    id: seededId("comment", seed),
    username: normalizedHandle ? normalizedHandle.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2") : "",
    handle: normalizedHandle,
    message,
    timestamp: `${1 + Math.floor(random() * 8)}m`,
    replies: Math.floor(random() * 6),
    reposts: Math.floor(random() * 12),
    likes: 2 + Math.floor(random() * 80),
    heroEligible: true,
    avatarColor: AVATAR_COLORS[Math.floor(random() * AVATAR_COLORS.length)],
  };
}

export function parsePlainText(source: string): ParseResult {
  const records: CommentRecord[] = [];
  const errors: ParseResult["errors"] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = cleanCampaignLine(raw);
    if (!line || isCampaignHeading(line)) return;
    const parsed = splitAuthorAndMessage(line);
    const handle = parsed.handle;
    const message = cleanCampaignLine(parsed.message);
    if (!message) {
      errors.push({ line: index + 1, source: raw, reason: "Comment message is empty" });
      return;
    }
    records.push(fallbackRecord(handle, message, index));
  });
  return { records, errors };
}

export function parseCommentJson(source: string): ParseResult {
  try {
    const value: unknown = JSON.parse(source);
    if (!Array.isArray(value)) return { records: [], errors: [{ line: 1, source: "JSON", reason: "Expected an array" }] };
    const records: CommentRecord[] = [];
    const errors: ParseResult["errors"] = [];
    value.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        errors.push({ line: index + 1, source: JSON.stringify(item), reason: "Expected an object" });
        return;
      }
      const candidate = item as Record<string, unknown>;
      const handle = String(candidate.handle ?? candidate.username ?? "").trim();
      const message = String(candidate.message ?? "").trim();
      if (!message) {
        errors.push({ line: index + 1, source: JSON.stringify(item), reason: "message is required" });
        return;
      }
      records.push({
        ...fallbackRecord(handle, message, index),
        ...candidate,
        id: String(candidate.id ?? seededId("comment", `${handle}|${message}|${index}`)),
        username: String(candidate.username ?? (handle ? handle.replace(/^@/, "") : "")),
        handle: handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "",
        message,
        heroEligible: candidate.heroEligible !== false,
      } as CommentRecord);
    });
    return { records, errors };
  } catch (error) {
    return { records: [], errors: [{ line: 1, source: "JSON", reason: error instanceof Error ? error.message : "Invalid JSON" }] };
  }
}
