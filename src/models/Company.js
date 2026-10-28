const mongoose = require('mongoose');

const companySchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending_review', 'active', 'rejected', 'suspended'],
      default: 'pending_review',
      index: true,
    },
    careersUrl: {
      type: String,
      trim: true,
    },
    logoUrl: {
      type: String,
    },
    description: {
      type: String,
    },
    industry: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    companySize: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'],
    },
  },
  {
    timestamps: true,
  }
);

companySchema.index({ status: 1, verified: 1 });

const Company = mongoose.model('Company', companySchema);

module.exports = Company;

