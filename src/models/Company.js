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
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'starter', 'growth', 'enterprise'],
        default: 'free',
      },
      status: {
        type: String,
        enum: ['active', 'trialing', 'past_due', 'canceled'],
        default: 'active',
      },
      billingCycle: {
        type: String,
        enum: ['monthly', 'annual'],
        default: 'monthly',
      },
      jobPostingQuota: {
        type: Number,
        default: 2, // Free accounts can have up to 2 active postings
      },
      stripeCustomerId: {
        type: String,
      },
      stripeSubscriptionId: {
        type: String,
      },
      currentPeriodEnd: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  }
);

companySchema.index({ status: 1, verified: 1 });

const Company = mongoose.model('Company', companySchema);

module.exports = Company;

