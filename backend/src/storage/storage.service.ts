import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';

/**
 * Object storage for meal photos, device exports, imported documents and
 * generated clinician packets. Health record *bytes* live here; Postgres only
 * ever stores the key.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.prefix = env.S3_PREFIX;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Builds a namespaced, user-partitioned key.
   * Keys are opaque and unguessable so a leaked key reveals nothing about
   * the patient, and one user's key can never collide with another's.
   */
  buildKey(userId: string, category: StorageCategory, filename: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    return `${this.prefix}users/${userId}/${category}/${randomUUID()}-${safeName}`;
  }

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Short-lived direct-download URL. Never hand a raw object key to a browser
   * without one — the bucket itself is not public.
   */
  async signedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Guards against a key from one user being read through another user's request. */
  assertOwnedBy(key: string, userId: string): boolean {
    return key.startsWith(`${this.prefix}users/${userId}/`);
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (err) {
      this.logger.error(`Storage unreachable: ${(err as Error).message}`);
      return false;
    }
  }
}

export type StorageCategory =
  | 'meal-photos'
  | 'imports'
  | 'documents'
  | 'reports';
