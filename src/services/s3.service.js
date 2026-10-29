const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../utils/logger');
const { ValidationError } = require('../utils/errors');

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Initialize S3 client only if real AWS credentials exist
let s3Client = null;
const isAwsConfigured =
  env.AWS_ACCESS_KEY_ID &&
  env.AWS_SECRET_ACCESS_KEY &&
  !env.AWS_ACCESS_KEY_ID.includes('placeholder') &&
  !env.AWS_SECRET_ACCESS_KEY.includes('placeholder');

if (isAwsConfigured) {
  s3Client = new S3Client({
    region: env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Validates file upload parameters before presigning
 */
function validateUploadParams(fileName, mimeType, size) {
  if (!fileName || typeof fileName !== 'string') {
    throw new ValidationError('A valid fileName string is required.');
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new ValidationError(
      'Invalid file type. Only PDF (.pdf) and Microsoft Word (.docx) documents are accepted.'
    );
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError('File size exceeds the 5MB upload limit.');
  }
}

/**
 * Generate a randomized S3 object key with user isolation
 * Pattern: resumes/{userId}/{uuid}.{ext}
 */
function generateS3Key(userId, mimeType) {
  const randomUUID = uuidv4();
  const extension = mimeType === 'application/pdf' ? 'pdf' : 'docx';
  return `resumes/${userId}/${randomUUID}.${extension}`;
}

/**
 * Generate pre-signed PUT URL for direct client-to-S3 document upload
 */
async function generatePresignedUploadUrl(userId, fileName, mimeType, size) {
  validateUploadParams(fileName, mimeType, size);

  const s3Key = generateS3Key(userId, mimeType);
  const expiresInSeconds = 900; // 15 minutes validity

  if (isAwsConfigured && s3Client) {
    try {
      const command = new PutObjectCommand({
        Bucket: env.AWS_S3_RESUME_BUCKET,
        Key: s3Key,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
      return { uploadUrl, s3Key, expiresInSeconds };
    } catch (err) {
      logger.error('Failed to generate AWS S3 presigned PUT URL', { error: err.message });
      throw err;
    }
  }

  // Graceful development/test mock URL
  const mockUploadUrl = `https://${env.AWS_S3_RESUME_BUCKET}.s3.${env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}?mock-presigned=true&exp=${Date.now() + expiresInSeconds * 1000}`;
  return {
    uploadUrl: mockUploadUrl,
    s3Key,
    expiresInSeconds,
    isMock: true,
  };
}

/**
 * Generate pre-signed GET URL for secure, time-bounded document download
 */
async function generatePresignedDownloadUrl(s3Key, expiresInSeconds = 300) {
  if (isAwsConfigured && s3Client) {
    try {
      const command = new GetObjectCommand({
        Bucket: env.AWS_S3_RESUME_BUCKET,
        Key: s3Key,
      });

      return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    } catch (err) {
      logger.error('Failed to generate AWS S3 presigned GET URL', { error: err.message, s3Key });
      throw err;
    }
  }

  // Graceful development/test mock download URL
  return `https://${env.AWS_S3_RESUME_BUCKET}.s3.${env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}?mock-download=true&exp=${Date.now() + expiresInSeconds * 1000}`;
}

/**
 * Delete resume file object from S3
 */
async function deleteS3Object(s3Key) {
  if (isAwsConfigured && s3Client) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: env.AWS_S3_RESUME_BUCKET,
        Key: s3Key,
      });
      await s3Client.send(command);
    } catch (err) {
      logger.warn('Failed to delete S3 object', { error: err.message, s3Key });
    }
  }
}

module.exports = {
  validateUploadParams,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  deleteS3Object,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
};
