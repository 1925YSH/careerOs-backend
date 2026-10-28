const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    proficiency: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'expert'],
      default: 'intermediate',
    },
    yearsOfExperience: { type: Number, default: 0 },
  },
  { _id: false }
);

const experienceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    current: { type: Boolean, default: false },
    description: { type: String },
  },
  { _id: false }
);

const candidateProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    headline: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      index: true,
    },
    targetRoles: [
      {
        type: String,
        trim: true,
      },
    ],
    skills: [skillSchema],
    experience: [experienceSchema],
    preferences: {
      salaryExpectationMin: { type: Number },
      salaryCurrency: { type: String, default: 'USD' },
      remotePreference: {
        type: String,
        enum: ['remote', 'hybrid', 'on-site', 'any'],
        default: 'any',
      },
      preferredLocations: [{ type: String }],
      industries: [{ type: String }],
    },
    visibility: {
      type: String,
      enum: ['public', 'private', 'companies_only'],
      default: 'companies_only',
    },
    completenessScore: {
      type: Number,
      default: 20,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

candidateProfileSchema.index({ 'skills.name': 1 });

const CandidateProfile = mongoose.model('CandidateProfile', candidateProfileSchema);

module.exports = CandidateProfile;

