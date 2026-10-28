const mongoose = require('mongoose');

const jobSourceSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    careersUrl: {
      type: String,
      required: true,
      trim: true,
    },
    allowedDomains: [
      {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
      },
    ],
    parserStrategy: {
      type: String,
      enum: ['generic_html', 'json_ld', 'ats_specific', 'browser'],
      default: 'generic_html',
    },
    crawlIntervalHours: {
      type: Number,
      default: 24,
      min: 1,
    },
    robotsStatus: {
      type: String,
      enum: ['allowed', 'disallowed', 'not_found', 'unchecked'],
      default: 'unchecked',
    },
    permissionStatus: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected'],
      default: 'pending_review',
      index: true,
    },
    active: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastRunAt: {
      type: Date,
    },
    lastSuccessAt: {
      type: Date,
    },
    nextRunAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index from architecture report
jobSourceSchema.index({ active: 1, nextRunAt: 1 });

const JobSource = mongoose.model('JobSource', jobSourceSchema);

module.exports = JobSource;

