const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    fuero: { 
      type: String, 
      required: true,
      enum: ['CIV', 'CSS', 'CNT'] 
    },
    year: { 
      type: Number, 
      required: true 
    },
    number: { 
      type: Number, 
      required: true 
    },
    max_number: { 
      type: Number, 
      required: true 
    },
    consecutive_not_found: { 
      type: Number, 
      default: 0 
    },
    last_check: { 
      type: Date 
    },
    worker_id: {
      type: String,
      required: true,
      default: 'main'
    },
    range_start: {
      type: Number,
      default: 1
    },
    range_end: {
      type: Number
    },
    enabled: {
      type: Boolean,
      default: true
    },
    balance: {
      twoCaptcha: { 
        type: Boolean, 
        default: true 
      },
      startOfDay: {
        type: Number,
        default: 0
      },
      current: {
        type: Number,
        default: 0
      },
      lastUpdate: {
        type: Date
      }
    }
  },
  {
    collection: "configuracion-scraping",
    timestamps: true // Añade createdAt y updatedAt automáticamente
  }
);

module.exports = mongoose.model("ConfiguracionScraping", schema);