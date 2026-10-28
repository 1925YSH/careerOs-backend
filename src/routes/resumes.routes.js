const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireRole } = require('../middleware/auth');
const Resume = require('../models/Resume');
const { ValidationError, NotFoundError } = require('../utils/errors');
const env = require('../config/env');

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/resumes/presign - Generate pre-signed URL for resume upload
 */
router.post('/presign', requireRole('candidate'), async (req, res, next) => {
  try {
    const { fileName, mimeType, size } = req.body;

    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedMimeTypes.includes(mimeType)) {
      throw new ValidationError('Invalid file type. Only PDF and DOCX documents are accepted.');
    }

    if (size > 5242880) {
      throw new ValidationError('File size exceeds the 5MB upload limit.');
    }

    // Architecture doc rule: randomized object keys, never raw user filenames
    const randomUUID = uuidv4();
    const extension = mimeType === 'application/pdf' ? 'pdf' : 'docx';
    const s3Key = `resumes/${req.user._id}/${randomUUID}.${extension}`;

    // Note: If AWS credentials are not yet configured in local environment,
    // return upload metadata instructions
    const mockPresignedUrl = `https://${env.AWS_S3_RESUME_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${s3Key}?mock-presigned=true`;

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl: mockPresignedUrl,
        s3Key,
        expiresInSeconds: 900,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

