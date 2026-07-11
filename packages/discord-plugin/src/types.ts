/** Shared result shape, matching github-plugin's convention. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Plugin instance config (mirrors manifest instanceConfigSchema). */
export interface DiscordPluginConfig {
  discordBotToken: string;
  receiptsChannelId: string;
  companyId: string;
  pennyAgentId: string;
  joshDiscordUserId: string;
  spacesKey: string;
  spacesSecret: string;
  spacesBucket: string;
  spacesRegion: string;
  spacesEndpoint: string;
  presignExpirySeconds: number;
  // --- #assets ingest (GOL-92). Optional: the assets-ingest job only registers when set. ---
  /** Discord #assets channel id (brand-asset uploads). */
  assetsChannelId?: string;
  /** Base URL of the grove-sites optimize service (wraps @grove/assets; runs sharp server-side). */
  groveAssetsOptimizeUrl?: string;
  /** Bearer token authorizing calls to the optimize service. */
  groveAssetsOptimizeToken?: string;
}

/** Machine-readable metadata embedded in every receipt issue description. */
export interface ReceiptMeta {
  v: 1;
  spacesKey: string;
  discordChannelId: string;
  discordMessageId: string;
  discordAttachmentId: string;
  poster: string;
  postedAt: string; // ISO 8601 from the Discord message timestamp
  caption: string;  // message content, may be ""
}

/** Penny's extraction payload — the contract for receipt_record_extraction. */
export interface ReceiptExtraction {
  v: 1;
  vendor: string;
  date: string;            // YYYY-MM-DD as printed on the receipt
  total: number;           // dollars, e.g. 84.12
  payment_method: "card" | "cash" | "check" | "unknown";
  line_items: Array<{ description: string; amount: number }>;
  suggested_category: string; // Schedule F or custom category name
  confidence: number;         // 0..1
  flags: string[];            // e.g. ["possible-duplicate", "looks-personal"]
}
