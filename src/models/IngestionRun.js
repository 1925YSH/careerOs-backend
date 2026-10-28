const mongoose = require('mongoose');

const ingestionRunSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobSource',
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    finishedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['running', 'success', 'partial', 'failed'],
      default: 'running',
      index: true,
    },
    counts: {
      fetched: { type: Number, default: 0 },
      candidateJobs: { type: Number, default: 0 },
      extracted: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
    },
    errors: [
      {
        timestamp: { type: Date, default: Date.now },
        stage: { type: String },
        message: { type: String },
      },
    ],
    durationMs: {
      type: Number,
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

ingestionRunSchema.index({ sourceId: 1, startedAt: -1 });

const IngestionRun = mongoose.model('IngestionRun', ingestionRunSchema);

module.exports = IngestionRun;
