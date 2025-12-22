const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  worker_id: {
    type: String,
    default: 'email_verification',
    unique: true,
    required: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  dailyLimit: {
    type: Number,
    default: 1000,
    min: 1,
    max: 10000
  },
  batchSize: {
    type: Number,
    default: 100,
    min: 1,
    max: 1000
  },
  schedule: {
    type: String,
    default: '0 9 * * *'
  },
  lastRun: {
    type: Date
  },
  todayVerified: {
    type: Number,
    default: 0
  },
  todayJobs: {
    type: Number,
    default: 0
  },
  dailyJobsLimit: {
    type: Number,
    default: 10,
    min: 1,
    max: 100
  },
  todayDate: {
    type: Date
  },
  totalVerified: {
    type: Number,
    default: 0
  },
  totalFailed: {
    type: Number,
    default: 0
  },
  neverBounceCredits: {
    type: Number
  },
  priorityTags: {
    type: [String],
    default: []
  },
  retryAttempts: {
    type: Number,
    default: 3,
    min: 0,
    max: 10
  },
  retryDelay: {
    type: Number,
    default: 5000,
    min: 1000,
    max: 60000
  },
  neverBouncePollingInterval: {
    type: Number,
    default: 5000,
    min: 1000,
    max: 30000
  },
  neverBounceMaxPollingAttempts: {
    type: Number,
    default: 60,
    min: 10,
    max: 300
  },
  stats: {
    valid: {
      type: Number,
      default: 0
    },
    invalid: {
      type: Number,
      default: 0
    },
    disposable: {
      type: Number,
      default: 0
    },
    catchall: {
      type: Number,
      default: 0
    },
    unknown: {
      type: Number,
      default: 0
    }
  },
  processing: {
    isRunning: {
      type: Boolean,
      default: false
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    }
  }
}, {
  timestamps: true,
  collection: 'configuracion-email-verification'
});

schema.methods.resetDailyCounters = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!this.todayDate || this.todayDate < today) {
    this.todayDate = today;
    this.todayVerified = 0;
    this.todayJobs = 0;
  }
};

schema.methods.hasReachedDailyLimit = function() {
  this.resetDailyCounters();
  return this.todayVerified >= this.dailyLimit;
};

schema.methods.hasReachedDailyJobsLimit = function() {
  this.resetDailyCounters();
  return this.todayJobs >= this.dailyJobsLimit;
};

module.exports = mongoose.model('ConfiguracionEmailVerification', schema);
