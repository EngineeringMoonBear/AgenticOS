import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

/** receipts/YYYY/MM/YYYY-MM-DD_<msgId>_<attId>_<safe-filename> — the single source of key naming. */
export function receiptKeyFor(
  postedAtIso: string,
  messageId: string,
  attachmentId: string,
  filename: string,
): string {
  const day = postedAtIso.slice(0, 10);
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `receipts/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}_${messageId}_${attachmentId}_${safe}`;
}

export class ReceiptArchive {
  constructor(
    private readonly s3: S3ClientLike,
    private readonly bucket: string,
  ) {}

  static fromConfig(cfg: {
    spacesKey: string;
    spacesSecret: string;
    spacesBucket: string;
    spacesRegion: string;
    spacesEndpoint: string;
  }): ReceiptArchive {
    const s3 = new S3Client({
      region: cfg.spacesRegion,
      endpoint: cfg.spacesEndpoint,
      credentials: { accessKeyId: cfg.spacesKey, secretAccessKey: cfg.spacesSecret },
    });
    return new ReceiptArchive(s3, cfg.spacesBucket);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.s3 as S3Client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
