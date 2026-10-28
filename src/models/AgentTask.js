const mongoose = require('mongoose');

const agentTaskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['interview_prep', 'resume_update', 'skill_learning', 'application_followup', 'general'],
      default: 'general',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    dueAt: {
      type: Date,
      index: true,
    },
    createdByAgent: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

agentTaskSchema.index({ userId: 1, dueAt: 1, status: 1 });

const AgentTask = mongoose.model('AgentTask', agentTaskSchema);

module.exports = AgentTask;

