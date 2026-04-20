/**
 * MinIO 客户端封装
 * 提供 presigned URL 生成和对象操作能力
 */
import { Client } from 'minio';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'game-files';

// 单例 MinIO Client
let minioClient: Client | null = null;

function getClient(): Client {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: MINIO_ENDPOINT.split(':')[0],
      port: parseInt(MINIO_ENDPOINT.split(':')[1] || '9000', 10),
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY
    });
  }
  return minioClient;
}

// 确保 Bucket 存在
export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await client.makeBucket(MINIO_BUCKET);
  }
}

// 生成上传 presigned URL
export async function getPresignedUploadUrl(
  objectKey: string,
  expirySeconds = 3600
): Promise<string> {
  await ensureBucket();
  const client = getClient();
  return client.presignedPutObject(MINIO_BUCKET, objectKey, expirySeconds);
}

// 生成下载 presigned URL
export async function getPresignedDownloadUrl(
  objectKey: string,
  expirySeconds = 3600
): Promise<string> {
  await ensureBucket();
  const client = getClient();
  return client.presignedGetObject(MINIO_BUCKET, objectKey, expirySeconds);
}

// 删除对象
export async function deleteObject(objectKey: string): Promise<void> {
  const client = getClient();
  await client.removeObject(MINIO_BUCKET, objectKey);
}

// 上传对象（Buffer）
export async function putObject(
  objectKey: string,
  buffer: Buffer,
  size: number,
  contentType: string
): Promise<void> {
  const client = getClient();
  await client.putObject(MINIO_BUCKET, objectKey, buffer, size, { contentType });
}

// 检查对象是否存在
export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    const client = getClient();
    await client.statObject(MINIO_BUCKET, objectKey);
    return true;
  } catch {
    return false;
  }
}
