const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['saved', 'applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn'],
      default: 'saved',
      index: true,
    },
    notes: {
      type: String,
    },
    history: [
      {
        status: { type: String, required: true },
        note: { type: String },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound indexes from Architecture Section 11
applicationSchema.index({ candidateId: 1, updatedAt: -1 });
applicationSchema.index({ companyId: 1, status: 1 });
applicationSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

const Application = mongoose.model('Application', applicationSchema);

module.exports = Application;

