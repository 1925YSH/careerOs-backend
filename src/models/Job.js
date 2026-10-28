const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ['company_posted', 'ingested'],
      required: true,
      default: 'company_posted',
      index: true,
    },
    sourceUrl: {
      type: String,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    workMode: {
      type: String,
      enum: ['remote', 'hybrid', 'on-site'],
      default: 'on-site',
      index: true,
    },
    employmentType: {
      type: String,
      enum: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'],
      default: 'FULL_TIME',
    },
    skills: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    experienceMin: {
      type: Number,
      default: 0,
    },
    experienceMax: {
      type: Number,
    },
    salary: {
      min: { type: Number },
      max: { type: Number },
      currency: { type: String, default: 'USD' },
      isDisclosed: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: ['active', 'draft', 'archived', 'flagged'],
      default: 'active',
      index: true,
    },
    fingerprint: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    applicationUrl: {
      type: String,
      required: true,
      trim: true,
    },
    sourceAttribution: {
      domain: { type: String },
      verifiedSource: { type: Boolean, default: false },
      lastCheckedAt: { type: Date, default: Date.now },
    },
    postedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes specified in Architecture Doc Section 11
jobSchema.index({ status: 1, postedAt: -1 });
jobSchema.index({ companyId: 1, status: 1 });
jobSchema.index({ skills: 1 });
jobSchema.index({ location: 1, status: 1 });
jobSchema.index({ title: 'text', description: 'text' });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;

