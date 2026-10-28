const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    s3Key: {
      type: String,
      required: true,
      unique: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
      enum: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    },
    size: {
      type: Number,
      required: true,
      max: [5242880, 'File size cannot exceed 5MB'],
    },
    scanStatus: {
      type: String,
      enum: ['clean', 'pending', 'flagged'],
      default: 'pending',
    },
    version: {
      type: Number,
      default: 1,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    parsedContent: {
      rawText: { type: String },
      skillsDetected: [{ type: String }],
      experienceYears: { type: Number },
      summary: { type: String },
      missingSections: [{ type: String }],
      suggestions: [{ type: String }],
    },
  },
  {
    timestamps: true,
  }
);

resumeSchema.index({ userId: 1, version: -1 });

const Resume = mongoose.model('Resume', resumeSchema);

module.exports = Resume;

