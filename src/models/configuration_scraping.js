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
    balance: {
      twoCaptcha: { 
        type: Boolean, 
        default: true 
      }
    }
  },
  {
    collection: "configuracion-scraping",
    timestamps: true // Añade createdAt y updatedAt automáticamente
  }
);

module.exports = mongoose.model("ConfiguracionScraping", schema);