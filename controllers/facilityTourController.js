const facilityTourService = require('../services/facilityTourService');

const scheduleTour = async (req, res) => {
  try {
    const result = await facilityTourService.scheduleTour(req.user, req.body, req);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const listTourHistory = async (req, res) => {
  try {
    const result = await facilityTourService.listTourHistory(req.user, req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const cancelTour = async (req, res) => {
  try {
    const result = await facilityTourService.cancelTour(req.user, req.params.tourId, req.body, req);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = { scheduleTour, listTourHistory, cancelTour };
