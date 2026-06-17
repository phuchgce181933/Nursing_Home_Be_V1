const Cognitive = require('../models/cognitiveAssessment');
const Functional = require('../models/functionalAssessment');
const FallRisk = require('../models/fallRiskAssessment');
const Nutrition = require('../models/nutritionalAssessment');

// Generic list/get/create/update/finalize factory helpers are kept simple and consistent
const makeController = (Model) => ({
  list: async (req, res) => {
    try {
      const q = req.query || {};
      const filter = {};
      if (q.residentId) filter.residentId = q.residentId;
      const data = await Model.find(filter).sort({ performedAt: -1 }).limit(200).lean();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
  get: async (req, res) => {
    try {
      const doc = await Model.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ message: 'Not found' });
      return res.json({ success: true, data: doc });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
  create: async (req, res) => {
    try {
      const d = new Model(req.body);
      await d.save();
      return res.json({ success: true, data: d });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
  update: async (req, res) => {
    try {
      const d = await Model.findById(req.params.id);
      if (!d) return res.status(404).json({ message: 'Not found' });
      Object.assign(d, req.body);
      await d.save();
      return res.json({ success: true, data: d });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
  finalize: async (req, res) => {
    try {
      const d = await Model.findById(req.params.id);
      if (!d) return res.status(404).json({ message: 'Not found' });
      d.status = 'COMPLETED';
      await d.save();
      return res.json({ success: true, data: d });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
});

module.exports = {
  cognitive: makeController(Cognitive),
  functional: makeController(Functional),
  fallRisk: makeController(FallRisk),
  nutrition: makeController(Nutrition),
};
