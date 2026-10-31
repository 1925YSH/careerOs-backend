const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/auth');
const { exportLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Resume = require('../models/Resume');
const Application = require('../models/Application');
const AgentTask = require('../models/AgentTask');
const Notification = require('../models/Notification');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobSource = require('../models/JobSource');
const AuditLog = require('../models/AuditLog');
const { deleteS3Object } = require('../services/s3.service');
const { ValidationError, AuthenticationError } = require('../utils/errors');
const logger = require('../utils/logger');
const env = require('../config/env');

const router = express.Router();

/**
 * GET /api/users/export
 * Complete personal data archive export adhering to:
 * - India Digital Personal Data Protection (DPDP) Act 2023 (Section 11)
 * - GDPR Chapter 3, Article 15 (Right of Access) & Article 20 (Right to Data Portability)
 */
router.get('/export', authenticate, exportLimiter, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user) {
      throw new AuthenticationError('User account not found.');
    }

    const exportTimestamp = new Date().toISOString();
    let profileData = null;
    let resumesData = [];
    let applicationsData = [];
    let tasksData = [];
    let companyData = null;
    let jobsData = [];
    let sourcesData = [];

    if (user.role === 'candidate') {
      const [profile, resumes, applications, tasks] = await Promise.all([
        CandidateProfile.findOne({ userId: user._id }).lean(),
        Resume.find({ userId: user._id })
          .select('-__v')
          .lean(),
        Application.find({ candidateId: user._id })
          .populate('jobId', 'title location workMode employmentType salary status')
          .populate('companyId', 'name domain logoUrl verified')
          .select('-__v')
          .lean(),
        AgentTask.find({ userId: user._id })
          .select('-__v')
          .lean(),
      ]);

      profileData = profile;
      resumesData = resumes;
      applicationsData = applications;
      tasksData = tasks;
    } else if (user.role === 'company') {
      const company = await Company.findOne({ ownerUserId: user._id }).lean();
      if (company) {
        companyData = company;
        const [jobs, sources, applications] = await Promise.all([
          Job.find({ companyId: company._id }).select('-__v').lean(),
          JobSource.find({ companyId: company._id }).select('-__v').lean(),
          Application.find({ companyId: company._id })
            .populate('jobId', 'title')
            .select('candidateId status stageHistory notes createdAt')
            .lean(),
        ]);
        jobsData = jobs;
        sourcesData = sources;
        applicationsData = applications;
      }
    }

    const [notifications, auditLogs] = await Promise.all([
      Notification.find({ userId: user._id }).select('-__v').lean(),
      AuditLog.find({
        $or: [{ actorId: user._id }, { targetId: user._id }],
      })
        .select('-__v')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    // Record audit log for export request
    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: 'DATA_EXPORT_REQUESTED',
      targetType: 'user',
      targetId: user._id,
      metadata: {
        exportTimestamp,
        complianceFrameworks: ['DPDP_ACT_2023', 'GDPR_ART_15_20'],
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const exportPayload = {
      exportMetadata: {
        exportId: `export_${user._id}_${Date.now()}`,
        generatedAt: exportTimestamp,
        compliance: 'India DPDP Act 2023 & GDPR Chapter 3 (Right of Access and Portability)',
        dataController: 'CareerOS Autonomous Career Intelligence Inc.',
        userEmail: user.email,
        role: user.role,
      },
      account: {
        id: user._id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        subscription: user.subscription,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      ...(user.role === 'candidate' && {
        candidateProfile: profileData,
        resumes: resumesData,
        applications: applicationsData,
        careerSprintTasks: tasksData,
      }),
      ...(user.role === 'company' && {
        company: companyData,
        postedJobs: jobsData,
        crawledSources: sourcesData,
        receivedApplications: applicationsData,
      }),
      notifications,
      securityAuditTrail: auditLogs,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="careeros-data-export-${user.email.split('@')[0]}-${Date.now()}.json"`
    );

    return res.status(200).json(exportPayload);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/me
 * Irreversible Account Deletion & Right to Erasure Cascade
 * - India DPDP Act 2023 (Section 12: Right to Erasure)
 * - GDPR Article 17 (Right to be Forgotten)
 * Requires { confirmation: "DELETE" } in request body
 */
router.delete('/me', authenticate, async (req, res, next) => {
  try {
    const { confirmation } = req.body || {};
    if (confirmation !== 'DELETE') {
      throw new ValidationError(
        'Explicit confirmation string "DELETE" is required in request body to permanently erase your account.'
      );
    }

    const userId = req.user._id;
    const userRole = req.user.role;
    const userEmail = req.user.email;

    logger.info('Commencing irreversible account deletion cascade', {
      userId,
      role: userRole,
    });

    if (userRole === 'candidate') {
      // 1. Purge all S3 resume objects
      const resumes = await Resume.find({ userId });
      for (const resume of resumes) {
        if (resume.s3Key) {
          try {
            await deleteS3Object(resume.s3Key);
          } catch (s3Err) {
            logger.warn('Failed to delete S3 resume object during account deletion cascade', {
              s3Key: resume.s3Key,
              error: s3Err.message,
            });
          }
        }
      }

      // 2. Cascade delete database entities
      await Promise.all([
        Resume.deleteMany({ userId }),
        CandidateProfile.deleteOne({ userId }),
        AgentTask.deleteMany({ userId }),
        Notification.deleteMany({ userId }),
        Application.deleteMany({ candidateId: userId }),
      ]);
    } else if (userRole === 'company') {
      const company = await Company.findOne({ ownerUserId: userId });
      if (company) {
        await Promise.all([
          Job.deleteMany({ companyId: company._id }),
          JobSource.deleteMany({ companyId: company._id }),
          Application.deleteMany({ companyId: company._id }),
          Company.deleteOne({ _id: company._id }),
        ]);
      }
      await Notification.deleteMany({ userId });
    }

    // 3. Record final security audit record before user record erasure
    await AuditLog.create({
      actorId: userId,
      actorRole: userRole,
      action: 'USER_ACCOUNT_DELETED',
      targetType: 'user',
      targetId: userId,
      metadata: {
        email: userEmail,
        role: userRole,
        compliance: 'DPDP_GDPR_RIGHT_TO_ERASURE',
        deletedAt: new Date().toISOString(),
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // 4. Delete the User authentication record
    await User.deleteOne({ _id: userId });

    // 5. Invalidate auth cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
    });

    return res.status(200).json({
      success: true,
      message:
        'Your CareerOS account, private resume documents, and all associated personal data have been permanently erased.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/users/password
 * Secure authenticated password change with bcrypt re-hash
 */
router.put('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new ValidationError('Current password is required.');
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters long.');
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user) {
      throw new AuthenticationError('User not found.');
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new AuthenticationError('Current password is incorrect.');
    }

    // Re-hash new password with salt rounds = 12
    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save();

    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: user._id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
