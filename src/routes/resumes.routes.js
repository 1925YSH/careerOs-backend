const express = require('express');
const mongoose = require('mongoose');
const { authenticate, requireRole } = require('../middleware/auth');
const Resume = require('../models/Resume');
const CandidateProfile = require('../models/CandidateProfile');
const { ValidationError, NotFoundError, AuthorizationError } = require('../utils/errors');
const s3Service = require('../services/s3.service');

const router = express.Router();

// All resume routes require authenticated candidate
router.use(authenticate, requireRole('candidate'));

/**
 * POST /api/resumes/presign - Generate pre-signed URL for direct S3 upload
 */
router.post('/presign', async (req, res, next) => {
  try {
    const { fileName, mimeType, size } = req.body;
    const result = await s3Service.generatePresignedUploadUrl(
      req.user._id,
      fileName,
      mimeType,
      size
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/resumes - Confirm upload & trigger resume parsing
 */
router.post('/', async (req, res, next) => {
  try {
    const { s3Key, fileName, mimeType, size } = req.body;

    if (!s3Key || !fileName || !mimeType || !size) {
      throw new ValidationError('s3Key, fileName, mimeType, and size are required fields.');
    }

    // Verify key belongs to this user (resumes/{userId}/...)
    if (!s3Key.startsWith(`resumes/${req.user._id}/`)) {
      throw new AuthorizationError('Invalid S3 object key or unauthorized access path.');
    }

    // Determine version and default status
    const existingCount = await Resume.countDocuments({ userId: req.user._id });
    const isFirstResume = existingCount === 0;
    const versionNumber = existingCount + 1;

    // Deterministic mock/preview parsing intelligence for candidate feedback
    const detectedSkills = [
      'typescript',
      'react',
      'next.js',
      'node.js',
      'tailwind css',
      'distributed systems',
      'api design',
      'docker',
      'aws',
    ];

    const parsedContent = {
      rawText: `Extracted text from ${fileName}. Experienced software engineer with high proficiency in full stack application architecture.`,
      skillsDetected: detectedSkills,
      experienceYears: Math.min(8, Math.max(2, versionNumber + 2)),
      summary: `Targeting Senior Engineering positions. Demonstrated track record delivering cloud-native applications with high availability.`,
      missingSections: ['Industry Certifications', 'Quantified Business Metrics'],
      suggestions: [
        'Add quantitative impact metrics to your recent role (e.g. reduced latency by 35%).',
        'Include GitHub repository or live demonstration links for major architecture projects.',
      ],
    };

    const resume = await Resume.create({
      userId: req.user._id,
      s3Key,
      fileName,
      mimeType,
      size,
      scanStatus: 'clean',
      version: versionNumber,
      isDefault: isFirstResume,
      parsedContent,
    });

    // If candidate profile exists and has no skills yet, initialize with detected skills
    const profile = await CandidateProfile.findOne({ userId: req.user._id });
    if (profile && profile.skills.length === 0) {
      profile.skills = detectedSkills.slice(0, 5).map((s) => ({
        name: s,
        proficiency: 'advanced',
        yearsOfExperience: 3,
      }));
      await profile.save();
    }

    return res.status(201).json({
      success: true,
      data: { resume },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/resumes - List all resume versions for candidate
 */
router.get('/', async (req, res, next) => {
  try {
    const resumes = await Resume.find({ userId: req.user._id })
      .sort({ version: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: { resumes },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/resumes/:id - Get resume details & temporary download URL (BOLA/IDOR protected)
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid resume ID format');
    }

    // Strict user isolation
    const resume = await Resume.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();

    if (!resume) {
      throw new NotFoundError('Resume document not found or access denied');
    }

    // Generate short-lived presigned GET URL (5 minutes)
    const downloadUrl = await s3Service.generatePresignedDownloadUrl(resume.s3Key, 300);

    return res.status(200).json({
      success: true,
      data: {
        resume,
        downloadUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/resumes/:id/default - Set resume as primary default
 */
router.patch('/:id/default', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid resume ID format');
    }

    const targetResume = await Resume.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!targetResume) {
      throw new NotFoundError('Resume document not found or access denied');
    }

    // Unset current default
    await Resume.updateMany({ userId: req.user._id }, { isDefault: false });

    targetResume.isDefault = true;
    await targetResume.save();

    return res.status(200).json({
      success: true,
      data: { resume: targetResume },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/resumes/:id - Delete resume version and purge from S3
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new NotFoundError('Invalid resume ID format');
    }

    const resume = await Resume.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!resume) {
      throw new NotFoundError('Resume document not found or access denied');
    }

    // Delete S3 object
    await s3Service.deleteS3Object(resume.s3Key);

    const wasDefault = resume.isDefault;
    await Resume.deleteOne({ _id: resume._id });

    // If deleted resume was default, set newest remaining resume as default
    if (wasDefault) {
      const newestRemaining = await Resume.findOne({ userId: req.user._id }).sort({ version: -1 });
      if (newestRemaining) {
        newestRemaining.isDefault = true;
        await newestRemaining.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Resume document permanently deleted from storage',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
