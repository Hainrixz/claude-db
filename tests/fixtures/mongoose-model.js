// Sample Mongoose model fixture for claude-db detection/parse tests.
// Mongoose schemas are program source — claude-db parses these best-effort (confidence: directional)
// and nudges the user toward a generated artifact or Tier-1 introspection.
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  amount: { type: Number, required: true }, // money as Number/double — claude-db M4 should flag (use Decimal128)
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  // Unbounded embedded array — claude-db M19/document should flag growth risk.
  events: [{ kind: String, at: Date }],
});

const customerSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  orders: [orderSchema],
});

module.exports = {
  Customer: mongoose.model('Customer', customerSchema),
  Order: mongoose.model('Order', orderSchema),
};
